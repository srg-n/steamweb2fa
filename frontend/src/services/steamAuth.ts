import { db, type StoredAccount, type AppSettings } from './storage';
import { applyCorsProxy } from './steamClient';
import { generateSteamGuardCode, generateAuthSessionSignature, uint8ArrayToBase64 } from './steamCrypto';

function hexToBigInt(hex: string): bigint {
  return BigInt('0x' + hex);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let res = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) res = (res * base) % mod;
    base = (base * base) % mod;
    exp = exp / 2n;
  }
  return res;
}

/**
 * Encrypts Steam password using RSA public key and PKCS#1 v1.5 padding.
 * 100% native in-browser execution with BigInt.
 */
export function encryptSteamPassword(password: string, publickeyModHex: string, publickeyExpHex: string): string {
  const modBig = hexToBigInt(publickeyModHex);
  const expBig = hexToBigInt(publickeyExpHex);

  const keyLenBytes = Math.ceil(publickeyModHex.length / 2);
  const pwBytes = new TextEncoder().encode(password);

  if (pwBytes.length > keyLenBytes - 11) {
    throw new Error('Password is too long for RSA key');
  }

  const padded = new Uint8Array(keyLenBytes);
  padded[0] = 0x00;
  padded[1] = 0x02; // Block type 2 for encryption

  // Non-zero random padding bytes
  const padLen = keyLenBytes - pwBytes.length - 3;
  const randomBytes = new Uint8Array(padLen);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < padLen; i++) {
    let b = randomBytes[i];
    while (b === 0) {
      const extra = new Uint8Array(1);
      crypto.getRandomValues(extra);
      b = extra[0];
    }
    padded[2 + i] = b;
  }

  padded[2 + padLen] = 0x00; // Separator
  padded.set(pwBytes, 3 + padLen);

  // Convert padded buffer to BigInt
  let mHex = '';
  for (let i = 0; i < padded.length; i++) {
    mHex += padded[i].toString(16).padStart(2, '0');
  }
  const mBig = BigInt('0x' + mHex);

  // Modular exponentiation: c = m^e mod n
  const cBig = modPow(mBig, expBig, modBig);

  // Convert cBig to byte array with exact length keyLenBytes
  let cHex = cBig.toString(16);
  if (cHex.length % 2 !== 0) cHex = '0' + cHex;
  const targetHexLen = keyLenBytes * 2;
  cHex = cHex.padStart(targetHexLen, '0');

  const cBytes = new Uint8Array(keyLenBytes);
  for (let i = 0; i < keyLenBytes; i++) {
    cBytes[i] = parseInt(cHex.substring(i * 2, i * 2 + 2), 16);
  }

  return uint8ArrayToBase64(cBytes);
}

export interface SteamLoginResult {
  success: boolean;
  steamLoginSecure?: string;
  oauthToken?: string;
  refreshToken?: string;
  sessionid?: string;
  error?: string;
}

function isJwtExpired(token?: string): boolean {
  if (!token || token.split('.').length < 2) return true;
  try {
    const payloadBase64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = atob(payloadBase64);
    const payload = JSON.parse(jsonStr);
    if (typeof payload?.exp === 'number') {
      return payload.exp * 1000 <= Date.now() + 60000;
    }
  } catch {
    return true;
  }
  return false;
}

export class SteamAuthService {
  /**
   * Generates a fresh JWT access_token from api.steampowered.com using a refreshToken.
   * Completely reliable official Web API call with zero cookie-scraping dependency.
   */
  async generateAccessToken(steamid: string, refreshToken: string, settings: AppSettings): Promise<string> {
    const targetUrl = 'https://api.steampowered.com/IAuthenticationService/GenerateAccessTokenForApp/v1/';
    const url = applyCorsProxy(targetUrl, settings.corsProxyUrl);

    const body = new URLSearchParams({
      refresh_token: refreshToken,
      steamid: steamid || '0'
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    if (settings.corsProxySecret?.trim()) {
      headers['X-Proxy-Secret'] = settings.corsProxySecret.trim();
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: body.toString()
    });

    if (!res.ok) {
      throw new Error(`GenerateAccessTokenForApp HTTP ${res.status}`);
    }

    const data = await res.json();
    const token = data?.response?.access_token;
    if (!token) {
      throw new Error('Steam yeni access_token döndürmedi (Refresh token süresi dolmuş veya geçersiz olabilir).');
    }

    return token;
  }

  /**
   * Finalizes Steam JWT authentication on steamcommunity.com.
   * Extracts modern access tokens directly from transfer_info params without depending on Set-Cookie headers.
   */
  async finalizeAuthSession(
    refreshToken: string,
    settings: AppSettings
  ): Promise<{ steamLoginSecure?: string; sessionid: string; oauthToken?: string; steamID?: string }> {
    const randomSessionId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const targetUrl = 'https://login.steampowered.com/jwt/finalizelogin';
    const url = applyCorsProxy(targetUrl, settings.corsProxyUrl);

    const body = new URLSearchParams({
      nonce: refreshToken,
      sessionid: randomSessionId,
      redir: 'https://steamcommunity.com/login/home/?goto='
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    if (settings.corsProxySecret?.trim()) {
      headers['X-Proxy-Secret'] = settings.corsProxySecret.trim();
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: body.toString()
    });

    if (!res.ok) {
      let errDetail = '';
      try {
        const errJson = await res.json();
        errDetail = errJson.error || errJson.message || '';
      } catch {
        // ignore
      }
      if (errDetail.includes('Forbidden host') || errDetail.includes('login.steampowered.com')) {
        throw new Error('Cloudflare Worker güncel değil! Lütfen cloudflare-worker/worker.js dosyasındaki yeni kodu Cloudflare panelinize yapıştırıp "Save and Deploy" yapın.');
      }
      throw new Error(`Steam oturumu HTTP ${res.status}${errDetail ? `: ${errDetail}` : ''}`);
    }

    const data = await res.json();
    let extractedCookie = '';
    let extractedSteamID = data?.steamID || '';
    let extractedAuthToken = '';

    // Check Set-Cookie forwarded by Cloudflare Worker
    const setCookieHeader = res.headers.get('x-steam-set-cookie') || res.headers.get('set-cookie');
    if (setCookieHeader) {
      const match = setCookieHeader.match(/steamLoginSecure=([^;]+)/);
      if (match && match[1]) {
        extractedCookie = decodeURIComponent(match[1]);
      }
    }

    // Follow transfer_info specifically to steamcommunity.com/login/settoken
    // IMPORTANT: Two-pass approach - community token must NOT be overwritten by store token.
    // Steam's transfer_info contains domain-specific tokens; we need the steamcommunity.com one.
    if (Array.isArray(data?.transfer_info)) {
      // Pass 1: Find the steamcommunity.com token specifically (highest priority)
      let communityAuthToken = '';
      let communityAuthSteamID = '';
      for (const info of data.transfer_info) {
        if (!info.params || !info.url) continue;
        const isCommunity = info.url.includes('steamcommunity.com');
        if (isCommunity && info.params.auth) {
          communityAuthToken = info.params.auth;
          if (info.params.steamID) {
            communityAuthSteamID = info.params.steamID;
          }
          break; // Found it — stop scanning
        }
      }

      // Pass 2: Fallback — use any token if no community-specific one found
      if (!communityAuthToken) {
        for (const info of data.transfer_info) {
          if (info.params?.auth) {
            communityAuthToken = info.params.auth;
            if (info.params.steamID) communityAuthSteamID = info.params.steamID;
            break;
          }
        }
      }

      if (communityAuthToken) {
        extractedAuthToken = communityAuthToken;
        if (communityAuthSteamID) extractedSteamID = communityAuthSteamID;
      }

      // Pass 3: Ping all settoken endpoints so Steam server-side session registers
      // Prioritize steamcommunity.com first, then others
      const sortedTransfers = [...data.transfer_info].sort((a, b) => {
        const aC = a.url?.includes('steamcommunity.com') ? -1 : 1;
        const bC = b.url?.includes('steamcommunity.com') ? -1 : 1;
        return aC - bC;
      });

      for (const info of sortedTransfers) {
        if (!info.url || !info.params) continue;
        const transferTarget = info.url;
        const transferUrl = applyCorsProxy(transferTarget, settings.corsProxyUrl);
        const transferBody = new URLSearchParams(info.params);

        try {
          const tRes = await fetch(transferUrl, {
            method: 'POST',
            headers,
            body: transferBody.toString()
          });

          // Prefer the cookie from steamcommunity.com response
          const isCommunity = info.url.includes('steamcommunity.com');
          const tCookieHeader = tRes.headers.get('x-steam-set-cookie') || tRes.headers.get('set-cookie');
          if (tCookieHeader) {
            const match = tCookieHeader.match(/steamLoginSecure=([^;]+)/);
            if (match && match[1]) {
              const decoded = decodeURIComponent(match[1]);
              // Only overwrite if we got a community cookie, or we have nothing yet
              if (isCommunity || !extractedCookie) {
                extractedCookie = decoded;
              }
            }
          }
        } catch {
          // Continue to next transfer
        }
      }
    }

    // Modern Steam uses steamid%7C%7Caccess_token for steamLoginSecure
    if (!extractedCookie && extractedSteamID && extractedAuthToken) {
      extractedCookie = `${extractedSteamID}%7C%7C${extractedAuthToken}`;
    }

    return {
      steamLoginSecure: extractedCookie || undefined,
      sessionid: randomSessionId,
      oauthToken: extractedAuthToken || undefined,
      steamID: extractedSteamID || undefined
    };
  }

  /**
   * Refreshes steamLoginSecure directly using stored refreshToken (zero password needed).
   * WebBrowser platform tokens refresh via login.steampowered.com/jwt/finalizelogin
   */
  async refreshWithRefreshToken(account: StoredAccount, settings: AppSettings): Promise<SteamLoginResult> {
    const refreshToken = account.session?.refreshToken;
    if (!refreshToken) {
      return { success: false, error: 'Hesapta kayıtlı refreshToken bulunmuyor.' };
    }

    const steamid = account.steamid || '0';
    const fallbackSessionId =
      account.session?.sessionid ||
      Array.from(crypto.getRandomValues(new Uint8Array(12)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    // Strategy 1: Finalize auth session via login.steampowered.com/jwt/finalizelogin
    // This is the official flow for WebBrowser platform tokens used by Steam web logins.
    try {
      const fin = await this.finalizeAuthSession(refreshToken, settings);
      if (fin.steamLoginSecure) {
        const freshOauthToken = fin.oauthToken || account.session?.oauthToken;
        const freshSteamId =
          fin.steamID && fin.steamID !== '0'
            ? fin.steamID
            : steamid !== '0'
            ? steamid
            : account.steamid;

        const updatedAccount: StoredAccount = {
          ...account,
          steamid: freshSteamId,
          session: {
            ...account.session,
            steamLoginSecure: fin.steamLoginSecure,
            oauthToken: freshOauthToken,
            refreshToken,
            sessionid: fin.sessionid || fallbackSessionId
          },
          updatedAt: new Date().toISOString()
        };

        await db.saveAccount(updatedAccount);
        return {
          success: true,
          steamLoginSecure: fin.steamLoginSecure,
          oauthToken: freshOauthToken,
          refreshToken,
          sessionid: fin.sessionid || fallbackSessionId
        };
      }
    } catch (finErr: any) {
      console.warn('finalizeAuthSession failed during refresh:', finErr?.message || finErr);
    }

    // Strategy 2: GenerateAccessTokenForApp (for mobile/app scoped tokens)
    try {
      const newAccessToken = await this.generateAccessToken(steamid, refreshToken, settings);
      if (newAccessToken) {
        const steamLoginSecure = `${steamid}%7C%7C${newAccessToken}`;
        const updatedAccount: StoredAccount = {
          ...account,
          session: {
            ...account.session,
            steamLoginSecure,
            oauthToken: newAccessToken,
            refreshToken,
            sessionid: fallbackSessionId
          },
          updatedAt: new Date().toISOString()
        };

        await db.saveAccount(updatedAccount);
        return {
          success: true,
          steamLoginSecure,
          oauthToken: newAccessToken,
          refreshToken,
          sessionid: fallbackSessionId
        };
      }
    } catch (genErr: any) {
      console.warn('generateAccessToken notice:', genErr?.message || genErr);
    }

    // Strategy 3: Check if existing oauthToken is still active and valid
    if (account.session?.oauthToken && !isJwtExpired(account.session.oauthToken)) {
      const steamLoginSecure = `${steamid}%7C%7C${account.session.oauthToken}`;
      const updatedAccount: StoredAccount = {
        ...account,
        session: {
          ...account.session,
          steamLoginSecure,
          sessionid: fallbackSessionId
        },
        updatedAt: new Date().toISOString()
      };
      await db.saveAccount(updatedAccount);
      return {
        success: true,
        steamLoginSecure,
        oauthToken: account.session.oauthToken,
        refreshToken,
        sessionid: fallbackSessionId
      };
    }

    return {
      success: false,
      error: 'Refresh token süresi dolmuş veya geçersiz. Lütfen şifrenizle giriş yapın.'
    };
  }

  /**
   * Automated Steam login with Username, Password, and automatic TOTP 2FA submission.
   */
  async loginWithCredentials(
    account: StoredAccount,
    password: string,
    settings: AppSettings,
    onStatus?: (status: string) => void
  ): Promise<SteamLoginResult> {
    if (!account.accountName) {
      throw new Error('Hesap adı (account_name) eksik.');
    }
    if (!account.sharedSecret) {
      throw new Error('Hesapta shared_secret tanımlı değil, 2FA kodu otomatik üretilemez.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    if (settings.corsProxySecret?.trim()) {
      headers['X-Proxy-Secret'] = settings.corsProxySecret.trim();
    }

    // Step 1: Fetch RSA Public Key
    onStatus?.('Steam RSA şifreleme anahtarı alınıyor...');
    const rsaTarget = `https://api.steampowered.com/IAuthenticationService/GetPasswordRSAPublicKey/v1/?account_name=${encodeURIComponent(account.accountName)}`;
    const rsaUrl = applyCorsProxy(rsaTarget, settings.corsProxyUrl);

    const rsaRes = await fetch(rsaUrl, { headers });
    if (!rsaRes.ok) {
      throw new Error(`RSA anahtarı alınamadı (HTTP ${rsaRes.status}). Cloudflare Worker ayarlarını kontrol edin.`);
    }

    const rsaData = await rsaRes.json();
    const rsaResp = rsaData?.response;
    if (!rsaResp?.publickey_mod || !rsaResp?.publickey_exp || !rsaResp?.timestamp) {
      throw new Error('Steam geçersiz RSA anahtarı döndürdü.');
    }

    // Step 2: Encrypt Password
    onStatus?.('Şifre yerel olarak RSA ile şifreleniyor...');
    const encryptedPassword = encryptSteamPassword(password, rsaResp.publickey_mod, rsaResp.publickey_exp);

    // Step 3: Begin Auth Session via Credentials
    onStatus?.('Steam oturumu başlatılıyor...');
    const beginTarget = 'https://api.steampowered.com/IAuthenticationService/BeginAuthSessionViaCredentials/v1/';
    const beginUrl = applyCorsProxy(beginTarget, settings.corsProxyUrl);

    const beginBody = new URLSearchParams({
      device_friendly_name: 'SteamWeb Authenticator',
      account_name: account.accountName,
      encrypted_password: encryptedPassword,
      encryption_timestamp: String(rsaResp.timestamp),
      platform_type: '2',
      persistence: '1'
    });

    const beginRes = await fetch(beginUrl, {
      method: 'POST',
      headers,
      body: beginBody.toString()
    });

    if (!beginRes.ok) {
      throw new Error(`Giriş isteği reddedildi (HTTP ${beginRes.status}).`);
    }

    const beginData = await beginRes.json();
    const beginResp = beginData?.response;
    if (!beginResp?.client_id || !beginResp?.request_id) {
      throw new Error(beginData?.error || 'Steam oturum başlatılamadı. Kullanıcı adı veya şifre yanlış olabilir.');
    }

    const clientId = String(beginResp.client_id);
    const requestId = String(beginResp.request_id);
    const steamid = beginResp.steamid || account.steamid || '0';

    // Step 4: Auto-generate 2FA Code and Submit
    onStatus?.('Steam Guard 2FA kodu otomatik üretiliyor ve onaylanıyor...');
    const twoFactorCode = generateSteamGuardCode(account.sharedSecret, settings.timeOffsetSec);

    // Determine code_type from allowed_confirmations (default to 3 = DeviceCode)
    let codeType = '3';
    if (Array.isArray(beginResp.allowed_confirmations) && beginResp.allowed_confirmations.length > 0) {
      const allowed = beginResp.allowed_confirmations;
      const deviceCode = allowed.find((c: any) => c.confirmation_type === 3);
      const emailCode = allowed.find((c: any) => c.confirmation_type === 1);
      if (deviceCode) {
        codeType = '3';
      } else if (emailCode) {
        codeType = '1';
      } else if (allowed[0]?.confirmation_type) {
        codeType = String(allowed[0].confirmation_type);
      }
    }

    const updateTarget = 'https://api.steampowered.com/IAuthenticationService/UpdateAuthSessionWithSteamGuardCode/v1/';
    const updateUrl = applyCorsProxy(updateTarget, settings.corsProxyUrl);

    const updateBody = new URLSearchParams({
      client_id: clientId,
      steamid,
      code: twoFactorCode,
      code_type: codeType
    });

    try {
      const updateRes = await fetch(updateUrl, {
        method: 'POST',
        headers,
        body: updateBody.toString()
      });
      if (!updateRes.ok) {
        let errTxt = '';
        try {
          const errData = await updateRes.json();
          errTxt = errData?.message || errData?.error || '';
        } catch {}
        console.warn('UpdateAuthSessionWithSteamGuardCode warning:', updateRes.status, errTxt);
      }
    } catch (uErr) {
      console.warn('UpdateAuthSessionWithSteamGuardCode network warning:', uErr);
    }

    // Step 5: Poll Auth Session Status for Tokens
    onStatus?.('Oturum onaylanıyor ve tokenler alınıyor...');
    const pollTarget = 'https://api.steampowered.com/IAuthenticationService/PollAuthSessionStatus/v1/';
    const pollUrl = applyCorsProxy(pollTarget, settings.corsProxyUrl);

    const pollBody = new URLSearchParams({
      client_id: clientId,
      request_id: requestId
    });

    let refreshToken = '';
    let accessToken = '';
    let lastPollData: any = null;

    for (let attempt = 0; attempt < 12; attempt++) {
      const pollRes = await fetch(pollUrl, {
        method: 'POST',
        headers,
        body: pollBody.toString()
      });

      if (pollRes.ok) {
        const pollData = await pollRes.json();
        lastPollData = pollData;
        if (pollData?.response?.refresh_token) {
          refreshToken = pollData.response.refresh_token;
          accessToken = pollData.response.access_token || '';
          break;
        }
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    if (!refreshToken) {
      const detail = lastPollData ? JSON.stringify(lastPollData.response || lastPollData) : 'Steam yanıt vermedi';
      throw new Error(`Steam oturumu tamamlayamadı (Refresh token alınamadı): ${detail}`);
    }

    // Step 6: Construct session tokens & finalize login
    onStatus?.('steamLoginSecure çerezi oluşturuluyor...');
    const randomSessionId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    let steamLoginSecure = '';

    // If Steam returned the JWT access_token directly, build modern steamLoginSecure
    if (accessToken) {
      steamLoginSecure = `${steamid}%7C%7C${accessToken}`;
    }

    // Also attempt finalizeAuthSession to trigger Steam Community settoken session registration
    try {
      const fin = await this.finalizeAuthSession(refreshToken, settings);
      if (fin.steamLoginSecure) {
        steamLoginSecure = fin.steamLoginSecure;
      }
      if (fin.oauthToken && !accessToken) {
        accessToken = fin.oauthToken;
      }
    } catch (finalizeErr) {
      console.warn('finalizeAuthSession non-critical notice:', finalizeErr);
    }

    // If still empty (rare), try GenerateAccessTokenForApp
    if (!steamLoginSecure) {
      try {
        const genRes = await this.generateAccessToken(steamid, refreshToken, settings);
        if (genRes) {
          accessToken = genRes;
          steamLoginSecure = `${steamid}%7C%7C${accessToken}`;
        }
      } catch (genErr) {
        console.warn('generateAccessToken notice:', genErr);
      }
    }

    if (!steamLoginSecure) {
      throw new Error('Steam oturumu tamamlandı fakat steamLoginSecure çerezi üretilemedi.');
    }

    // Step 7: Save to Account Storage
    onStatus?.('Oturum başarıyla kaydediliyor...');
    const updatedAccount: StoredAccount = {
      ...account,
      steamid: steamid !== '0' ? steamid : account.steamid,
      session: {
        steamLoginSecure,
        oauthToken: accessToken || account.session?.oauthToken,
        refreshToken,
        sessionid: randomSessionId
      },
      updatedAt: new Date().toISOString()
    };

    await db.saveAccount(updatedAccount);

    return {
      success: true,
      steamLoginSecure,
      oauthToken: accessToken,
      refreshToken,
      sessionid: randomSessionId
    };
  }
}

export const steamAuth = new SteamAuthService();
