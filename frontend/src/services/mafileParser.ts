import type { StoredAccount } from './storage';

export interface ParsedMaFile {
  shared_secret: string;
  identity_secret: string;
  account_name: string;
  steamid?: string;
  revocation_code?: string;
  Revocation_code?: string;
  Session?: {
    SteamID?: string;
    SteamLoginSecure?: string;
    SessionID?: string;
    OAuthToken?: string;
    AccessToken?: string;
    RefreshToken?: string;
  };
  [key: string]: any;
}

function extractSteamIdFromCookie(cookie?: string): string | undefined {
  if (!cookie) return undefined;
  const match = cookie.match(/^(\d{17})\|\|/);
  return match ? match[1] : undefined;
}

function extractSteamIdFromJwt(token?: string): string | undefined {
  if (!token || token.split('.').length < 2) return undefined;
  try {
    const payloadBase64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = atob(payloadBase64);
    const payload = JSON.parse(jsonStr);
    if (typeof payload?.sub === 'string' && /^\d{17}$/.test(payload.sub)) {
      return payload.sub;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function parseMaFile(raw: string, defaultAlias?: string): StoredAccount {
  let parsed: ParsedMaFile;
  try {
    parsed = JSON.parse(raw.trim());
  } catch (err) {
    throw new Error('Invalid JSON format: Could not parse .maFile');
  }

  if (!parsed.shared_secret) {
    throw new Error('Missing "shared_secret" in .maFile');
  }

  if (!parsed.identity_secret) {
    throw new Error('Missing "identity_secret" in .maFile');
  }

  const accountName = parsed.account_name || 'SteamAccount';

  // Extract SteamID from all possible locations
  const session = parsed.Session || {};
  const cookieSteamId = extractSteamIdFromCookie(session.SteamLoginSecure);
  const jwtSteamId = extractSteamIdFromJwt(session.OAuthToken || session.AccessToken);
  const explicitSteamId = session.SteamID || parsed.steamid;

  const steamid = explicitSteamId || cookieSteamId || jwtSteamId || '';

  const revocationCode = parsed.revocation_code || parsed.Revocation_code;

  const now = new Date().toISOString();

  return {
    id: 'acc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
    alias: defaultAlias?.trim() || accountName,
    accountName,
    steamid,
    sharedSecret: parsed.shared_secret,
    identitySecret: parsed.identity_secret,
    revocationCode,
    session: {
      steamLoginSecure: session.SteamLoginSecure,
      sessionid: session.SessionID,
      oauthToken: session.OAuthToken || session.AccessToken,
      refreshToken: session.RefreshToken
    },
    autoConfirmTrades: false,
    autoConfirmTradeMode: 'all',
    autoConfirmLogins: false,
    autoConfirmDelaySec: 0,
    folderId: null,
    tags: [],
    pinned: false,
    createdAt: now,
    updatedAt: now
  };
}

export function exportToMaFile(account: StoredAccount): string {
  const maData: ParsedMaFile = {
    shared_secret: account.sharedSecret,
    identity_secret: account.identitySecret,
    account_name: account.accountName,
    steamid: account.steamid,
    revocation_code: account.revocationCode,
    fully_enrolled: true,
    Session: {
      SteamID: account.steamid,
      SteamLoginSecure: account.session?.steamLoginSecure,
      SessionID: account.session?.sessionid,
      OAuthToken: account.session?.oauthToken,
      AccessToken: account.session?.oauthToken,
      RefreshToken: account.session?.refreshToken
    }
  };

  return JSON.stringify(maData, null, 2);
}

export function downloadFile(filename: string, content: string, mimeType = 'application/json') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
