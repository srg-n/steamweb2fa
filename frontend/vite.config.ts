import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/** Endpoints the app always talks to. */
const STEAM_ORIGINS = [
  'https://api.steampowered.com',
  'https://steamcommunity.com',
  'https://login.steampowered.com'
];

/**
 * Reads CSP_CONNECT_ORIGINS from the build environment. Setting it (comma or
 * space separated origins, e.g. "https://my-proxy.workers.dev") replaces the
 * `https:` wildcard in connect-src with an explicit allow-list.
 */
function extraConnectOrigins(env: Record<string, string>): string {
  const raw = env.CSP_CONNECT_ORIGINS || '';
  const origins = raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (origins.length === 0) return ' https: blob: data:';
  return ` ${origins.join(' ')}`;
}

/**
 * Makes a chunk safe to run from inside index.html.
 *
 * Vite's dynamic import helper takes the dev-time dependency optimizer as an
 * argument. In a single-file build that global is never defined, so the first
 * lazy import (the vault loads Argon2id that way) would throw a ReferenceError.
 * `undefined` is the correct value here: with inlineDynamicImports there are no
 * separate chunks left to pre-bundle.
 */
function inlineableCode(code: string): string {
  return code.replace(/\b__VITE_PRELOAD__\b/g, 'undefined');
}

function inlineSingleHtmlPlugin() {
  return {
    name: 'inline-single-html',
    enforce: 'post' as const,
    generateBundle(_: any, bundle: Record<string, any>) {
      const htmlFile = bundle['index.html'];
      if (!htmlFile || htmlFile.type !== 'asset') return;

      let html =
        typeof htmlFile.source === 'string'
          ? htmlFile.source
          : new TextDecoder().decode(htmlFile.source);

      // Inline CSS
      for (const [name, chunk] of Object.entries(bundle)) {
        if (name.endsWith('.css') && chunk.type === 'asset') {
          const css =
            typeof chunk.source === 'string'
              ? chunk.source
              : new TextDecoder().decode(chunk.source);
          html = html.replace(
            new RegExp(`<link[^>]*href="[^"]*${name}"[^>]*>`, 'i'),
            () => `<style>\n${css}\n</style>`
          );
        }
      }

      // Inline JS
      for (const [name, chunk] of Object.entries(bundle)) {
        if (name.endsWith('.js') && chunk.type === 'chunk') {
          html = html.replace(
            new RegExp(`<script[^>]*src="[^"]*${name}"[^>]*></script>`, 'i'),
            ''
          );
          html = html.replace(
            '</body>',
            () => `<script type="module">\n${inlineableCode(chunk.code)}\n</script>\n</body>`
          );
        }
      }

      // Strip static manifest link to prevent CORS error on file:///
      html = html.replace(/<link[^>]*rel="manifest"[^>]*>/i, '');

      htmlFile.source = html;

      // Remove redundant emitted assets since they are completely inlined into index.html
      for (const name of Object.keys(bundle)) {
        if (name !== 'index.html' && (name.endsWith('.css') || name.endsWith('.js') || name.endsWith('.map'))) {
          delete bundle[name];
        }
      }
    }
  };
}

/**
 * Injects a Content-Security-Policy into the built HTML.
 *
 * The production build collapses the whole app into a single inlined HTML
 * file, so `script-src 'self'` alone is not usable. Instead every inline
 * script is hashed and allow-listed, which blocks injected inline handlers
 * and eval while still shipping a portable, dependency-free HTML file.
 *
 * Dev mode is untouched (this only runs in generateBundle).
 */
function injectCspPlugin(extraConnectOrigins: string) {
  const cspFor = (html: string): string => {
    const hashes: string[] = [];
    const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = scriptRe.exec(html)) !== null) {
      const attrs = match[1] || '';
      if (/\bsrc\s*=/i.test(attrs)) continue;
      // The HTML parser normalises CRLF to LF before the script body is hashed,
      // so the hash must be computed over the normalised text.
      const normalized = match[2].replace(/\r\n/g, '\n');
      const digest = createHash('sha256').update(normalized, 'utf8').digest('base64');
      hashes.push("'sha256-" + digest + "'");
    }

    const directives = [
      // Object/base/frame are pure hardening; none of them are used.
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-src 'none'",
      "child-src 'none'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "form-action 'none'",
      // Scripts: only the hashed inline bundle we just inlined. No 'unsafe-inline',
      // no 'unsafe-eval'. 'wasm-unsafe-eval' only permits WebAssembly
      // instantiation, which Argon2id needs for the vault's key derivation; it
      // does not re-enable eval() of JavaScript.
      ["script-src 'self' 'wasm-unsafe-eval'", ...hashes].join(' '),
      // Tailwind CSS and React inline style attributes still need inline
      // styles; style injection is a far weaker vector than script injection.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      // Steam endpoints are always allowed. The CORS proxy is user supplied,
      // so `https:` stays in the default policy; set CSP_CONNECT_ORIGINS at
      // build time to pin it to your own origin(s) and drop the wildcard.
      `connect-src 'self' ${STEAM_ORIGINS.join(' ')}${extraConnectOrigins}`,
      // Trusted Types: DOM XSS sinks may only receive values produced by our
      // own policy (used for the service worker URL).
      "require-trusted-types-for 'script'",
      "trusted-types steamguard-url"
    ];

    return directives.join('; ');
  };

  return {
    name: 'inject-csp',
    enforce: 'post' as const,
    generateBundle(_: any, bundle: Record<string, any>) {
      const htmlFile = bundle['index.html'];
      if (!htmlFile || htmlFile.type !== 'asset') return;

      let html =
        typeof htmlFile.source === 'string'
          ? htmlFile.source
          : new TextDecoder().decode(htmlFile.source);

      if (html.includes('http-equiv="Content-Security-Policy"')) return;

      const content = cspFor(html).replace(/"/g, '&quot;');
      const meta = '<meta http-equiv="Content-Security-Policy" content="' + content + '" />';

      html = html.includes('<head>')
        ? html.replace('<head>', '<head>\n    ' + meta)
        : meta + html;

      htmlFile.source = html;
    }
  };
}

/**
 * Stamps the emitted service worker with the hash of the current shell.
 *
 * Without this the SW keeps the same bytes across releases, so it never
 * reinstalls and browsers stay on the previous (possibly vulnerable) build.
 * Files from `public/` are copied after bundling, hence writeBundle.
 */
function versionServiceWorkerPlugin() {
  return {
    name: 'version-service-worker',
    enforce: 'post' as const,
    writeBundle(options: any) {
      const dir = options.dir;
      if (!dir) return;

      const shellPath = resolve(dir, 'index.html');
      const swPath = resolve(dir, 'sw.js');
      if (!existsSync(shellPath) || !existsSync(swPath)) return;

      const buildId = createHash('sha256')
        .update(readFileSync(shellPath))
        .digest('hex')
        .slice(0, 12);

      const sw = readFileSync(swPath, 'utf8').replace(
        /const VERSION = '[^']*';/,
        `const VERSION = 'steamguard-${buildId}';`
      );
      writeFileSync(swPath, sw, 'utf8');
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const connectOrigins = extraConnectOrigins(env);

  return {
    base: './',
    plugins: [
      react(),
      inlineSingleHtmlPlugin(),
      injectCspPlugin(connectOrigins),
      versionServiceWorkerPlugin()
    ],
    build: {
      rollupOptions: {
        output: {
          inlineDynamicImports: true
        }
      }
    },
    server: {
      host: '0.0.0.0',
      port: 3000
    }
  };
});
