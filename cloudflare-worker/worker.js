/**
 * Cloudflare Worker - Steam CORS & Mobile Confirmation Proxy
 * 
 * Provides a 100% serverless, zero-maintenance CORS proxy for SteamGuard Web Authenticator.
 * Runs on Cloudflare's global edge network (Free tier: 100,000 requests/day).
 * 
 * Features:
 * - Strict whitelist: only allows steamcommunity.com and api.steampowered.com
 * - Full CORS headers injection (Access-Control-Allow-Origin: *)
 * - Forwards X-Steam-Cookie into real Cookie header for authenticated requests
 * - Optional PROXY_SECRET authentication to protect your quota
 */

function isAllowedHost(hostname) {
  return (
    hostname === 'steamcommunity.com' ||
    hostname.endsWith('.steamcommunity.com') ||
    hostname === 'steampowered.com' ||
    hostname.endsWith('.steampowered.com') ||
    hostname === 'steam.tv' ||
    hostname.endsWith('.steam.tv')
  );
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Steam-Cookie, X-Proxy-Secret, Accept',
  'Access-Control-Expose-Headers': 'X-Steam-Set-Cookie, Set-Cookie',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS preflight OPTIONS request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    // 2. Optional Secret Protection (if configured in Cloudflare Environment Variables)
    if (env && env.PROXY_SECRET) {
      const clientSecret = request.headers.get('x-proxy-secret');
      if (clientSecret !== env.PROXY_SECRET) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid X-Proxy-Secret' }), {
          status: 401,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    // 3. Extract Target Steam URL
    const reqUrl = new URL(request.url);
    let targetUrlStr = reqUrl.searchParams.get('url');

    if (!targetUrlStr) {
      // Support path-based format: /https://steamcommunity.com/...
      const rawPath = reqUrl.pathname.slice(1) + reqUrl.search;
      if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
        targetUrlStr = rawPath;
      } else if (rawPath.startsWith('https:/') || rawPath.startsWith('http:/')) {
        targetUrlStr = rawPath.replace(/^https?:\//, 'https://');
      }
    }

    if (!targetUrlStr) {
      return new Response(
        JSON.stringify({
          status: 'ok',
          message: 'SteamGuard Cloudflare Proxy is active.',
          usage: 'Append target URL as ?url=https://steamcommunity.com/... or /https://steamcommunity.com/...'
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid Target URL' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // 4. Security Whitelist: Only permit Steam domains
    if (!isAllowedHost(targetUrl.hostname)) {
      return new Response(
        JSON.stringify({ error: `Forbidden host "${targetUrl.hostname}". Only Steam domains are allowed.` }),
        {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );
    }

    // 5. Build outgoing request to Steam
    const forwardHeaders = new Headers();
    const copyHeaders = ['accept', 'content-type', 'user-agent'];
    for (const h of copyHeaders) {
      const val = request.headers.get(h);
      if (val) forwardHeaders.set(h, val);
    }

    // Use default browser-like user agent if not provided
    if (!forwardHeaders.has('user-agent')) {
      forwardHeaders.set(
        'user-agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      );
    }

    // Forward Cookie (supports browser-friendly X-Steam-Cookie or standard Cookie)
    const cookieVal = request.headers.get('x-steam-cookie') || request.headers.get('cookie');
    if (cookieVal) {
      forwardHeaders.set('cookie', cookieVal);
    }

    const init = {
      method: request.method,
      headers: forwardHeaders,
      redirect: 'follow'
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.arrayBuffer();
    }

    try {
      const steamResponse = await fetch(targetUrl.toString(), init);

      // 6. Return response with CORS headers injected
      const responseHeaders = new Headers(steamResponse.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        responseHeaders.set(k, v);
      }

      // Remove restrictive headers
      responseHeaders.delete('x-frame-options');
      responseHeaders.delete('content-security-policy');

      // Forward Set-Cookie as X-Steam-Set-Cookie so browser JS can read it for session renewal
      if (typeof steamResponse.headers.getSetCookie === 'function') {
        const cookies = steamResponse.headers.getSetCookie();
        if (cookies.length > 0) {
          responseHeaders.set('X-Steam-Set-Cookie', cookies.join('; '));
        }
      } else {
        const sc = steamResponse.headers.get('set-cookie');
        if (sc) {
          responseHeaders.set('X-Steam-Set-Cookie', sc);
        }
      }

      return new Response(steamResponse.body, {
        status: steamResponse.status,
        statusText: steamResponse.statusText,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to contact Steam: ' + (err?.message || err) }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
  }
};
