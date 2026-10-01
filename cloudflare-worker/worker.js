/**
 * Cloudflare Worker - Steam CORS & Mobile Confirmation Proxy
 *
 * Provides a 100% serverless, zero-maintenance CORS proxy for SteamGuard Web Authenticator.
 * Runs on Cloudflare's global edge network (Free tier: 100,000 requests/day).
 *
 * Features:
 * - Strict whitelist: only allows Steam-owned domains
 * - Full CORS headers injection (Access-Control-Allow-Origin: *)
 * - Forwards X-Steam-Cookie into real Cookie header for authenticated requests
 * - Manual redirect handling so Set-Cookie headers from 302 hops are never lost
 * - Optional PROXY_SECRET authentication to protect your quota
 */

const MAX_REDIRECTS = 5;

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
    const copyHeaders = [
      'accept',
      'content-type',
      'user-agent',
      'origin',
      'referer',
      'x-requested-with',
      'sec-fetch-site',
      'sec-fetch-mode',
      'sec-fetch-dest'
    ];
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

    const method = request.method;
    const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

    try {
      // 6. Follow redirects manually.
      // The platform runtime swallows Set-Cookie from intermediate 302 responses when
      // redirect:'follow' is used. Steam's login/settoken endpoints set the session cookie
      // on the redirect response, so those cookies must be captured before following it.
      let currentUrl = targetUrl.toString();
      let currentMethod = method;
      let currentBody = body;
      let steamResponse = null;
      const collectedCookies = [];

      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await fetch(currentUrl, {
          method: currentMethod,
          headers: forwardHeaders,
          redirect: 'manual',
          body: currentBody
        });

        // Harvest Set-Cookie from every hop, including redirects.
        if (typeof response.headers.getSetCookie === 'function') {
          for (const cookie of response.headers.getSetCookie()) {
            collectedCookies.push(cookie);
          }
        } else {
          const sc = response.headers.get('set-cookie');
          if (sc) collectedCookies.push(sc);
        }

        const isRedirect = response.status >= 300 && response.status < 400;
        const location = response.headers.get('location');
        if (isRedirect && location) {
          let nextUrl;
          try {
            nextUrl = new URL(location, currentUrl);
          } catch {
            break;
          }

          // Never follow a redirect off the Steam whitelist.
          if (!isAllowedHost(nextUrl.hostname)) break;

          // 301/302/303 turn a POST into a GET without a body.
          if (response.status === 301 || response.status === 302 || response.status === 303) {
            currentMethod = 'GET';
            currentBody = undefined;
          }
          currentUrl = nextUrl.toString();
          continue;
        }

        steamResponse = response;
        break;
      }

      if (!steamResponse) {
        return new Response(JSON.stringify({ error: 'Too many redirects while contacting Steam' }), {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // 7. Return response with CORS headers injected
      const responseHeaders = new Headers(steamResponse.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        responseHeaders.set(k, v);
      }

      // Remove restrictive headers
      responseHeaders.delete('x-frame-options');
      responseHeaders.delete('content-security-policy');
      responseHeaders.delete('set-cookie');

      // Expose every Set-Cookie seen along the redirect chain so the client can read it.
      if (collectedCookies.length > 0) {
        responseHeaders.set('X-Steam-Set-Cookie', collectedCookies.join('; '));
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
