import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
            () => `<script type="module">\n${chunk.code}\n</script>\n</body>`
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

export default defineConfig({
  base: './',
  plugins: [
    react(),
    inlineSingleHtmlPlugin()
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
});
