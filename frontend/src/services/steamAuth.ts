import { db, type StoredAccount, type AppSettings } from './storage';
import { applyCorsProxy, formatSteamLoginCookie } from './steamClient';
import { generateSteamGuardCode, generateAuthSessionSignature, generateConfirmationKey, getDeviceId, uint8ArrayToBase64 } from './steamCrypto';

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
    settings: AppSettings,
    knownSteamId?: string
  ): Promise<{ steamLoginSecure?: string; sessionid: string; oauthToken?: string; steamID?: string }> {
    const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const proxyHeaders = (): Record<string, string> => {
      const headers: Record<string, string> = {};
      if (settings.corsProxySecret?.trim()) {
        headers['X-Proxy-Secret'] = settings.corsProxySecret.trim();
      }
      return headers;
    };

    const targetUrl = 'https://login.steampowered.com/jwt/finalizelogin';
    const url = applyCorsProxy(targetUrl, settings.corsProxyUrl);

    // Steam's auth endpoints expect multipart/form-data, matching steam-session.
    const form = new FormData();
    form.append('nonce', refreshToken);
    form.append('sessionid', sessionId);
    form.append('redir', 'https://steamcommunity.com/login/home/?goto=');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...proxyHeaders(),
        Origin: 'https://steamcommunity.com',
        Referer: 'https://steamcommunity.com/'
      },
      body: form
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok || data?.error) {
      const errDetail = data?.error || data?.message || '';
      if (errDetail.includes('Forbidden host') || errDetail.includes('login.steampowered.com')) {
        throw new Error('Cloudflare Worker güncel değil! Lütfen cloudflare-worker/worker.js dosyasındaki yeni kodu Cloudflare panelinize yapıştırıp "Save and Deploy" yapın.');
      }
      throw new Error(`Steam oturumu HTTP ${res.status}${errDetail ? `: ${errDetail}` : ''}`);
    }

    if (!data?.transfer_info) {
      throw new Error('Steam geçersiz oturum yanıtı döndü (transfer_info yok).');
    }

    const steamID = data.steamID || knownSteamId || '0';
    let cookieValue = '';
    const transferResults: string[] = [];

    // Execute every transfer, retrying transient failures like steam-session does.
    for (const transfer of data.transfer_info) {
      if (!transfer?.url || !transfer?.params) continue;

      const isCommunity = String(transfer.url).includes('steamcommunity.com');
      const ATTEMPT_COUNT = 5;

      for (let attempt = 0; attempt < ATTEMPT_COUNT; attempt++) {
        try {
          const transferForm = new FormData();
          transferForm.append('steamID', steamID);
          for (const [k, v] of Object.entries(transfer.params)) {
            transferForm.append(k, String(v));
          }

          const tRes = await fetch(applyCorsProxy(transfer.url, settings.corsProxyUrl), {
            method: 'POST',
            headers: proxyHeaders(),
            body: transferForm
          });

          if (!tRes.ok) {
            throw new Error(`HTTP ${tRes.status}`);
          }

          let tJson: any = null;
          try {
            tJson = await tRes.json();
          } catch {
            tJson = null;
          }
          if (tJson?.result && String(tJson.result) !== '1') {
            throw new Error(`Steam sonucu ${tJson.result}`);
          }

          const cookieHeader =
            tRes.headers.get('x-steam-set-cookie') || tRes.headers.get('set-cookie') || '';
          if (!cookieHeader) {
            throw new Error('Yanıtta Set-Cookie yok');
          }

          const match = cookieHeader.match(/steamLoginSecure=([^;]+)/);
          if (!match) {
            throw new Error('Yanıtta steamLoginSecure yok');
          }

          // Keep the value exactly as Steam sent it.
          if (isCommunity || !cookieValue) {
            cookieValue = match[1];
          }
          transferResults.push(`${transfer.url}: OK`);
          break;
        } catch (err: any) {
          if (attempt === ATTEMPT_COUNT - 1) {
            transferResults.push(`${transfer.url}: ${err?.message || err}`);
          } else {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }
    }

    if (!cookieValue) {
      console.error('[steamAuth] transfer_info sonuçları:', transferResults);
      throw new Error(
        'Steam oturum çerezi alınamadı. Transfer adımları: ' + (transferResults.join(' | ') || 'transfer_info boş')
      );
    }

    return {
      steamLoginSecure: cookieValue,
      sessionid: sessionId,
      oauthToken: undefined,
      steamID
    };
  }

  /**
   * Verifies a steamLoginSecure cookie actually works for mobileconf/getlist.
   * Throws with needauth message when Steam rejects the session.
   * Skips verification when identitySecret is missing (nothing to sign with).
   */
  async verifyWebSessionCookie(
    account: StoredAccount,
    steamLoginSecure: string,
    sessionid: string,
    settings: AppSettings
  ): Promise<void> {
    if (!account.identitySecret) return;
    const steamid = account.steamid || '0';
    const time = Math.floor(Date.now() / 1000) + (settings.timeOffsetSec || 0);
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
    const fetchHeaders: Record<string, string> = {
      Accept: 'application/json, text/plain, */*'
    };
    const cleanLogin = formatSteamLoginCookie(steamLoginSecure, steamid);
    const cleanSessionId = (sessionid || '').replace(/^sessionid=\s*/i, '').trim() || '0123456789abcdef01234567';
    fetchHeaders['X-Steam-Cookie'] = `steamLoginSecure=${cleanLogin}; sessionid=${cleanSessionId}`;
    if (settings.corsProxySecret?.trim()) {
      fetchHeaders['X-Proxy-Secret'] = settings.corsProxySecret.trim();
    }
    const res = await fetch(url, { method: 'GET', headers: fetchHeaders });
    if (!res.ok) {
      throw new Error(`Doğrulama isteği başarısız oldu (HTTP ${res.status}).`);
    }
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      throw new Error('Doğrulama yanıtı okunamadı. CORS Proxy ayarlarını kontrol edin.');
    }
    if (!data?.success) {
      if (data?.needauth) {
        throw new Error(
          `"${account.alias}" için yenilenen çerez Steam tarafından kabul edilmedi (needauth: true). RefreshToken eskimiş olabilir — lütfen şifrenizle yeniden giriş yapın.`
        );
      }
      throw new Error(
        `"${account.alias}" için yenilenen çerez doğrulanamadı (${data?.message || 'success: false'}). Şifrenizle yeniden giriş yapın.`
      );
    }
  }

  /**
   * Refreshes steamLoginSecure directly using stored refreshToken (zero password needed).
   * WebBrowser platform tokens refresh via login.steampowered.com/jwt/finalizelogin
   *
   * IMPORTANT: GenerateAccessTokenForApp tokens are NOT valid steamcommunity.com
   * web cookies, so they must never be reported as a successful refresh.
   * Only a finalizeAuthSession cookie that passes getlist verification counts.
   */
  async refreshWithRefreshToken(account: StoredAccount, settings: AppSettings): Promise<SteamLoginResult> {
    const refreshToken = account.session?.refreshToken;
    if (!refreshToken) {
      return { success: false, error: 'Hesapta kayıtlı refreshToken bulunmuyor.' };
    }

    const steamid = account.steamid || '0';

    // Single source of truth: official finalizeLogin flow (steam-session getWebCookies).
    let fin: { steamLoginSecure?: string; sessionid: string; oauthToken?: string; steamID?: string };
    try {
      fin = await this.finalizeAuthSession(refreshToken, settings, steamid);
    } catch (finErr: any) {
      const msg = finErr?.message || 'Steam oturum yenileme isteği başarısız oldu.';
      return {
        success: false,
        error: `${msg} (RefreshToken geçersiz/süresi dolmuş olabilir — şifrenizle giriş yapın.)`
      };
    }

    if (!fin.steamLoginSecure) {
      return {
        success: false,
        error: 'Steam yeni çerez döndürmedi. Şifrenizle giriş yapın.'
      };
    }

    const freshOauthToken = fin.oauthToken || account.session?.oauthToken;
    const freshSteamId =
      fin.steamID && fin.steamID !== '0'
        ? fin.steamID
        : steamid !== '0'
        ? steamid
        : account.steamid;
    const freshSessionId = fin.sessionid;

    // Verify the new cookie actually works before claiming success.
    // This prevents the "başarıyla yenilendi ama hala needauth" false-positive.
    try {
      await this.verifyWebSessionCookie(
        { ...account, steamid: freshSteamId },
        fin.steamLoginSecure,
        freshSessionId,
        settings
      );
    } catch (verifyErr: any) {
      return {
        success: false,
        error: verifyErr?.message || 'Yenilenen çerez doğrulanamadı. Şifrenizle giriş yapın.'
      };
    }

    const updatedAccount: StoredAccount = {
      ...account,
      steamid: freshSteamId,
      session: {
        ...account.session,
        steamLoginSecure: fin.steamLoginSecure,
        oauthToken: freshOauthToken,
        refreshToken,
        sessionid: freshSessionId
      },
      updatedAt: new Date().toISOString()
    };

    await db.saveAccount(updatedAccount);
    return {
      success: true,
      steamLoginSecure: fin.steamLoginSecure,
      oauthToken: freshOauthToken,
      refreshToken,
      sessionid: freshSessionId
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

    // Step 6: Exchange the refresh token for web session cookies.
    // platform_type 2 is EAuthTokenPlatformType.WebBrowser, so per steam-session the
    // access token is NOT the session cookie — the cookie must come from finalizelogin.
    // Never fabricate "steamid||access_token" here; it authenticates WebAPI but not
    // steamcommunity.com, which shows up later as needauth: true on mobileconf.
    onStatus?.('steamLoginSecure çerezi oluşturuluyor...');

    let steamLoginSecure = '';
    let finalizedSessionId = '';
    try {
      const fin = await this.finalizeAuthSession(refreshToken, settings, steamid);
      steamLoginSecure = fin.steamLoginSecure || '';
      finalizedSessionId = fin.sessionid;
    } catch (finalizeErr: any) {
      throw new Error(`Oturum çerezi alınamadı: ${finalizeErr?.message || finalizeErr}`);
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
        sessionid: finalizedSessionId
      },
      updatedAt: new Date().toISOString()
    };

    await db.saveAccount(updatedAccount);

    return {
      success: true,
      steamLoginSecure,
      oauthToken: accessToken,
      refreshToken,
      sessionid: finalizedSessionId
    };
  }
}

export const steamAuth = new SteamAuthService();
