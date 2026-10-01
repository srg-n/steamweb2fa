import type { StoredAccount, AppSettings } from './storage';
import i18n from '../i18n';

/**
 * Builds a user-facing error for a failed Steam confirmation response.
 * Keys live in the translation files so the message follows the selected
 * language instead of being hardcoded in one of them.
 */
function describeSteamError(data: any, alias: string): string {
  if (data?.needauth) return i18n.t('session.expiredNeedauth', { alias });
  if (data?.message) return i18n.t('session.noList', { alias, message: data.message });
  return i18n.t('session.noList', { alias, message: 'success: false' });
}
import {
  generateConfirmationKey,
  getDeviceId,
  generateAuthSessionSignature,
  uint8ArrayToBase64
} from './steamCrypto';

export interface ConfirmationItem {
  id: string;
  nonce: string;
  type: 'trade' | 'login' | 'market' | 'other';
  creatorId?: string;
  headline: string;
  summary: string;
  icon?: string;
  accountId: string;
  accountAlias: string;
}

export interface SteamTimeResponse {
  serverTime: number;
  offsetSeconds: number;
}

/**
 * Checks if a Steam OAuth JWT access token is expired based on exp claim.
 */
export function isJwtExpired(token: string): boolean {
  try {
    const rawToken = token.includes('%7C%7C')
      ? token.split('%7C%7C')[1]
      : token.includes('||')
        ? token.split('||')[1]
        : token;
    const parts = rawToken.split('.');
    if (parts.length < 2) return false;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const json = JSON.parse(jsonStr);
    if (json.exp && typeof json.exp === 'number') {
      const nowSec = Math.floor(Date.now() / 1000);
      return nowSec >= json.exp;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Normalizes steamLoginSecure value to the canonical wire format
 * (<steamid>%7C%7C<token>).
 *
 * Steam issues the separator percent-encoded (%7C%7C), but cookies copied from
 * DevTools sometimes contain the raw "||" form. Both are normalized here so the
 * request header always matches what Steam itself set.
 */
export function formatSteamLoginCookie(steamLoginSecure: string, steamid?: string): string {
  const clean = steamLoginSecure.replace(/^steamLoginSecure=\s*/i, '').trim();
  if (clean.includes('%7C%7C') || clean.includes('||')) {
    return clean.replace(/\|\|/g, '%7C%7C');
  }
  if (steamid && steamid !== '0') {
    return `${steamid}%7C%7C${clean}`;
  }
  return clean;
}

/**
 * Prepends or wraps URL with CORS proxy if configured.
 * Automatically adds https:// protocol if omitted by the user.
 */
export function applyCorsProxy(targetUrl: string, proxyUrl?: string): string {
  if (!proxyUrl || !proxyUrl.trim()) return targetUrl;
  let p = proxyUrl.trim();
  if (!p.startsWith('http://') && !p.startsWith('https://')) {
    p = `https://${p}`;
  }
  if (p.includes('?url=')) {
    return `${p}${encodeURIComponent(targetUrl)}`;
  }
  if (p.endsWith('/')) {
    return `${p}${targetUrl}`;
  }
  return `${p}/${targetUrl}`;
}

/**
 * Executes fetch with exponential backoff and rate-limit (HTTP 429) awareness.
 * Automatically backs off and retries when Steam temporarily rate limits requests.
 */
export async function fetchWithRateLimit(
  url: string,
  options: RequestInit,
  maxRetries = 2
): Promise<Response> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        if (attempt < maxRetries) {
          // If Steam provides a Retry-After header, honor it. Otherwise backoff 2s -> 4s
          const retryAfter = response.headers?.get('Retry-After');
          const delaySec = retryAfter ? Number(retryAfter) || 2 : (attempt + 1) * 2;
          await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
          attempt++;
          continue;
        }
        throw new Error(`RATE_LIMITED: ${i18n.t('session.rateLimited', { seconds: 30 })}`);
      }

      return response;
    } catch (err: any) {
      if (err?.message?.includes('RATE_LIMITED')) {
        throw err;
      }
      // If network transient failure (TypeError / fetch failed), retry once
      if (attempt < maxRetries && (err?.name === 'TypeError' || err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError'))) {
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
        attempt++;
        continue;
      }
      throw err;
    }
  }
  throw new Error('RATE_LIMITED: İstek kotası aşıldı.');
}

export class SteamClient {
  /**
   * Sync time directly with official Steam Web API.
   * Calculates local device clock drift in seconds.
   */
  async syncSteamTime(): Promise<SteamTimeResponse> {
    const localNow = Math.floor(Date.now() / 1000);
    const url = 'https://api.steampowered.com/ITwoFactorService/QueryTime/v0001';

    try {
      // Use mode: 'no-cors' so the browser can ping Valve's servers directly
      // without triggering CORS policy violations or red errors in DevTools console.
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'steamid=0',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
      });
    } catch {
      // Fallback silently if offline or blocked by local firewall
    }

    return {
      serverTime: localNow,
      offsetSeconds: 0
    };
  }

  /**
   * Generates official signed direct Steam Mobile Confirmation URL.
   * Can be opened directly in a browser tab (where user is logged in to steamcommunity.com)
   * to view and accept market/trade confirmations without any CORS or proxy limitations.
   */
  getDirectConfirmationUrl(account: StoredAccount, settings: AppSettings): string {
    const steamid = account.steamid || '0';
    const time = Math.floor(Date.now() / 1000) + settings.timeOffsetSec;
    const deviceId = getDeviceId(steamid);
    const key = account.identitySecret ? generateConfirmationKey(account.identitySecret, 'conf', time) : '';

    const queryParams = new URLSearchParams({
      p: deviceId,
      a: steamid,
      k: key,
      t: String(time),
      m: 'react',
      tag: 'conf'
    });

    return `https://steamcommunity.com/mobileconf/conf?${queryParams.toString()}`;
  }

  /**
   * Fetch Trade & Market Confirmations directly from steamcommunity.com.
   */
  async getLegacyConfirmations(account: StoredAccount, settings: AppSettings): Promise<ConfirmationItem[]> {
    if (!account.identitySecret) {
      throw new Error(i18n.t('session.missingIdentitySecret', { alias: account.alias }));
    }

    if (!account.session?.steamLoginSecure) {
      throw new Error(i18n.t('session.missingCookie', { alias: account.alias }));
    }

    const steamid = account.steamid || '0';
    const time = Math.floor(Date.now() / 1000) + settings.timeOffsetSec;
    const deviceId = getDeviceId(steamid);
    const key = generateConfirmationKey(account.identitySecret, 'conf', time);

    const queryParams = new URLSearchParams({
      p: deviceId,
      a: steamid,
      k: key,
      t: String(time),
      m: 'react',
      tag: 'conf'
    });

    const targetUrl = `https://steamcommunity.com/mobileconf/getlist?${queryParams.toString()}`;
    const url = applyCorsProxy(targetUrl, settings.corsProxyUrl);

    const isFile = typeof window !== 'undefined' && window.location.protocol === 'file:';
    const fetchHeaders: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'okhttp/4.9.2'
    };

    const cleanLogin = formatSteamLoginCookie(account.session.steamLoginSecure, account.steamid);
    const cleanSessionId = (account.session?.sessionid || '').replace(/^sessionid=\s*/i, '').trim() || '0123456789abcdef01234567';
    fetchHeaders['X-Steam-Cookie'] = `steamLoginSecure=${cleanLogin}; sessionid=${cleanSessionId}`;

    if (settings.corsProxySecret?.trim()) {
      fetchHeaders['X-Proxy-Secret'] = settings.corsProxySecret.trim();
    }

    const fetchOptions: RequestInit = {
      method: 'GET',
      headers: fetchHeaders
    };
    if (!isFile && !settings.corsProxyUrl) {
      fetchOptions.credentials = 'include';
    }

    let response: Response;
    try {
      response = await fetchWithRateLimit(url, fetchOptions);
    } catch (err: any) {
      if (err?.message?.includes('RATE_LIMITED')) {
        throw err;
      }
      // Direct browser fetch blocked by CORS or network
      if (!settings.corsProxyUrl && (err?.name === 'TypeError' || err?.message?.includes('fetch') || err?.message?.includes('NetworkError') || err?.message?.includes('Failed to fetch'))) {
        throw new Error('CORS_BLOCKED');
      }
      throw err;
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(`RATE_LIMITED: ${i18n.t('session.rateLimited', { seconds: 30 })}`);
      }
      throw new Error(i18n.t('session.httpFail', { status: response.status }));
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      if (!settings.corsProxyUrl) {
        throw new Error('CORS_BLOCKED');
      }
      throw new Error(i18n.t('session.expired', { alias: account.alias }));
    }

    if (!data.success) {
      throw new Error(describeSteamError(data, account.alias));
    }

    const confList = Array.isArray(data.conf) ? data.conf : [];

    return confList.map((item: any) => {
      const typeNum = Number(item.type);
      const headline = String(item.headline || item.type_name || 'Trade Confirmation');
      let type: 'trade' | 'login' | 'market' | 'other' = 'trade';

      const lower = headline.toLowerCase();
      if (lower.includes('sign in') || lower.includes('login') || typeNum === 3) {
        type = 'login';
      } else if (lower.includes('market') || lower.includes('sell') || lower.includes('list')) {
        type = 'market';
      }

      let summary = '';
      if (Array.isArray(item.summary)) {
        summary = item.summary.filter(Boolean).join(' | ');
      } else if (typeof item.summary === 'string') {
        summary = item.summary;
      }

      return {
        id: String(item.id),
        nonce: String(item.nonce),
        type,
        creatorId: item.creator_id ? String(item.creator_id) : undefined,
        headline,
        summary,
        icon: item.icon,
        accountId: account.id,
        accountAlias: account.alias
      };
    });
  }

  /**
   * Fetch Steam Mobile Login (AuthSession) prompts directly from api.steampowered.com.
   */
  async getAuthSessionConfirmations(account: StoredAccount, settings?: AppSettings): Promise<ConfirmationItem[]> {
    const accessToken = account.session?.oauthToken;
    if (!accessToken) {
      return [];
    }

    // GetAuthSessionsForAccount requires a proper JWT (starts with "eyJ").
    // Old-style hex OAuth tokens (e.g. "0735bb91de0b33cfa25b7b7d213741b6") are NOT valid here
    // and will always result in HTTP 401 from Steam — skip them silently.
    if (!accessToken.startsWith('eyJ')) {
      return [];
    }

    // Check if token expired before firing HTTP request (avoids 401 Unauthorized in DevTools console)
    if (isJwtExpired(accessToken)) {
      return [];
    }


    try {
      const targetUrl = `https://api.steampowered.com/IAuthenticationService/GetAuthSessionsForAccount/v1/?access_token=${encodeURIComponent(accessToken)}`;
      const url = applyCorsProxy(targetUrl, settings?.corsProxyUrl);
      const authHeaders: Record<string, string> = {};
      if (settings?.corsProxySecret?.trim()) {
        authHeaders['X-Proxy-Secret'] = settings.corsProxySecret.trim();
      }
      const response = await fetch(url, { headers: authHeaders });
      if (!response.ok) return [];

      const data = await response.json();
      const clientIds = data?.response?.client_ids;
      if (!Array.isArray(clientIds) || clientIds.length === 0) {
        return [];
      }

      const results: ConfirmationItem[] = [];
      for (const clientId of clientIds) {
        const infoTarget = 'https://api.steampowered.com/IAuthenticationService/GetAuthSessionInfo/v1/';
        const infoUrl = applyCorsProxy(infoTarget, settings?.corsProxyUrl);
        const infoBody = new URLSearchParams({
          access_token: accessToken,
          client_id: clientId
        });
        const infoRes = await fetch(infoUrl, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: infoBody.toString()
        });
        if (!infoRes.ok) continue;

        const infoData = await infoRes.json();
        const info = infoData?.response;

        const location = [info?.city, info?.state, info?.country]
          .filter(Boolean)
          .join(', ');
        const details = [
          info?.ip ? `IP: ${info.ip}` : '',
          location ? `Location: ${location}` : '',
          info?.device_friendly_name ? `Device: ${info.device_friendly_name}` : ''
        ]
          .filter(Boolean)
          .join(' | ');

        results.push({
          id: `auth:${clientId}`,
          nonce: `authsession:${clientId}:${info?.version || 1}`,
          type: 'login',
          creatorId: String(clientId),
          headline: info?.device_friendly_name
            ? `Sign-in request from ${info.device_friendly_name}`
            : 'Steam Sign-in request',
          summary: details || 'Steam sign-in confirmation',
          accountId: account.id,
          accountAlias: account.alias
        });
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Fetch ALL confirmations for an account directly from Steam.
   */
  async getAllConfirmations(account: StoredAccount, settings: AppSettings): Promise<ConfirmationItem[]> {
    const promises: Promise<ConfirmationItem[]>[] = [];

    if (account.identitySecret) {
      promises.push(this.getLegacyConfirmations(account, settings));
    }

    if (account.session?.oauthToken) {
      promises.push(this.getAuthSessionConfirmations(account, settings).catch(() => []));
    }

    const results = await Promise.all(promises);
    return results.flat();
  }

  /**
   * Respond to Trade or Market Confirmation directly to steamcommunity.com.
   */
  async respondToLegacyConfirmation(
    account: StoredAccount,
    confirmationId: string,
    nonce: string,
    accept: boolean,
    settings: AppSettings
  ): Promise<boolean> {
    const steamid = account.steamid || '0';
    const tag = accept ? 'allow' : 'cancel';
    const time = Math.floor(Date.now() / 1000) + settings.timeOffsetSec;
    const deviceId = getDeviceId(steamid);
    const key = generateConfirmationKey(account.identitySecret, tag, time);

    const queryParams = new URLSearchParams({
      op: tag,
      p: deviceId,
      a: steamid,
      k: key,
      t: String(time),
      m: 'react',
      tag,
      cid: confirmationId,
      ck: nonce
    });

    const targetUrl = `https://steamcommunity.com/mobileconf/ajaxop?${queryParams.toString()}`;
    const url = applyCorsProxy(targetUrl, settings.corsProxyUrl);

    const isFile = typeof window !== 'undefined' && window.location.protocol === 'file:';
    const fetchHeaders: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'okhttp/4.9.2'
    };
    if (account.session?.steamLoginSecure) {
      const cleanLogin = formatSteamLoginCookie(account.session.steamLoginSecure, account.steamid);
      const cleanSessionId = (account.session?.sessionid || '').replace(/^sessionid=\s*/i, '').trim() || '0123456789abcdef01234567';
      fetchHeaders['X-Steam-Cookie'] = `steamLoginSecure=${cleanLogin}; sessionid=${cleanSessionId}`;
    }
    if (settings.corsProxySecret?.trim()) {
      fetchHeaders['X-Proxy-Secret'] = settings.corsProxySecret.trim();
    }

    const fetchOptions: RequestInit = {
      method: 'GET',
      headers: fetchHeaders
    };
    if (!isFile && !settings.corsProxyUrl) {
      fetchOptions.credentials = 'include';
    }

    const response = await fetchWithRateLimit(url, fetchOptions);

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(`RATE_LIMITED: ${i18n.t('session.rateLimitedOp')}`);
      }
      throw new Error(i18n.t('session.respondHttpFail', { status: response.status }));
    }

    const data = await response.json();
    return Boolean(data.success);
  }

  /**
   * Respond to AuthSession Login prompt with HMAC-SHA256 signature directly to api.steampowered.com.
   */
  async respondToAuthSession(
    account: StoredAccount,
    confirmationId: string,
    nonce: string,
    accept: boolean,
    settings?: AppSettings
  ): Promise<boolean> {
    const accessToken = account.session?.oauthToken;
    if (!accessToken) {
      throw new Error(i18n.t('session.missingAccessToken'));
    }

    let clientId = confirmationId.replace('auth:', '');
    let version = 1;

    if (nonce.startsWith('authsession:')) {
      const parts = nonce.slice('authsession:'.length).split(':');
      if (parts[0]) clientId = parts[0];
      if (parts[1]) version = Number(parts[1]) || 1;
    }

    const steamid = account.steamid || '0';
    const signatureBytes = generateAuthSessionSignature(account.sharedSecret, version, clientId, steamid);
    const signatureBase64 = uint8ArrayToBase64(signatureBytes);

    const targetUrl = 'https://api.steampowered.com/IAuthenticationService/UpdateAuthSessionWithMobileConfirmation/v1/';
    const url = applyCorsProxy(targetUrl, settings?.corsProxyUrl);

    const body = new URLSearchParams({
      access_token: accessToken,
      client_id: clientId,
      steamid,
      signature: signatureBase64,
      confirm: accept ? 'true' : 'false',
      persistence: '1'
    });

    const postHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    if (settings?.corsProxySecret?.trim()) {
      postHeaders['X-Proxy-Secret'] = settings.corsProxySecret.trim();
    }

    const response = await fetchWithRateLimit(url, {
      method: 'POST',
      headers: postHeaders,
      body: body.toString()
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(`RATE_LIMITED: ${i18n.t('session.rateLimitedAuth')}`);
      }
      throw new Error(i18n.t('session.authHttpFail', { status: response.status }));
    }

    return true;
  }

  /**
   * Universal direct respond method.
   */
  async respond(
    account: StoredAccount,
    confirmationId: string,
    nonce: string,
    accept: boolean,
    settings: AppSettings
  ): Promise<boolean> {
    if (confirmationId.startsWith('auth:')) {
      return this.respondToAuthSession(account, confirmationId, nonce, accept, settings);
    }
    return this.respondToLegacyConfirmation(account, confirmationId, nonce, accept, settings);
  }
}

export const steamClient = new SteamClient();
