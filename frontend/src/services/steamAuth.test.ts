import { describe, it, expect, vi } from 'vitest';
import { extractSteamIdFromToken, SteamAuthService } from './steamAuth';
import type { StoredAccount, AppSettings } from './storage';

describe('extractSteamIdFromToken', () => {
  it('returns null for empty or invalid token strings', () => {
    expect(extractSteamIdFromToken('')).toBeNull();
    expect(extractSteamIdFromToken('not-a-jwt')).toBeNull();
    expect(extractSteamIdFromToken(null as any)).toBeNull();
    expect(extractSteamIdFromToken(undefined as any)).toBeNull();
  });

  it('correctly extracts 17-digit 64-bit SteamID from JWT payload sub claim', () => {
    // Header: {"alg":"none"}
    // Payload: {"sub":"76561198012345678","exp":1800000000}
    const token = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiI3NjU2MTE5ODAxMjM0NTY3OCIsImV4cCI6MTgwMDAwMDAwMH0.sig';
    expect(extractSteamIdFromToken(token)).toBe('76561198012345678');
  });

  it('handles base64url characters (- and _) correctly', () => {
    // Payload: {"sub":"76561198099999999","data":"???---___"}
    const header = btoa(JSON.stringify({ alg: 'none' })).replace(/=/g, '');
    const payload = btoa(JSON.stringify({ sub: '76561198099999999', foo: 'bar_baz-qux' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const token = `${header}.${payload}.sig`;
    expect(extractSteamIdFromToken(token)).toBe('76561198099999999');
  });

  it('returns null if token payload lacks sub or has invalid format', () => {
    const header = btoa(JSON.stringify({ alg: 'none' }));
    const payload = btoa(JSON.stringify({ other: 'value' }));
    expect(extractSteamIdFromToken(`${header}.${payload}.sig`)).toBeNull();
  });
});

describe('SteamAuthService session refresh', () => {
  const service = new SteamAuthService();
  const dummySettings: AppSettings = {
    theme: 'dark',
    language: 'tr'
  };

  it('returns error if refreshToken is missing', async () => {
    const account: StoredAccount = {
      id: 'acc_1',
      alias: 'Main',
      accountName: 'testuser',
      steamid: '76561198012345678',
      secretFields: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const res = await service.refreshWithRefreshToken(account, dummySettings);
    expect(res.success).toBe(false);
    expect(res.error).toContain('refreshToken');
  });

  it('returns error if refreshToken is expired', async () => {
    // JWT with exp in the past (1000)
    const header = btoa(JSON.stringify({ alg: 'none' })).replace(/=/g, '');
    const payload = btoa(JSON.stringify({ sub: '76561198012345678', exp: 1000 })).replace(/=/g, '');
    const expiredToken = `${header}.${payload}.sig`;

    const account: StoredAccount = {
      id: 'acc_1',
      alias: 'Main',
      accountName: 'testuser',
      steamid: '76561198012345678',
      session: {
        refreshToken: expiredToken
      },
      secretFields: ['session.refreshToken'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const res = await service.refreshWithRefreshToken(account, dummySettings);
    expect(res.success).toBe(false);
    expect(res.error).toContain('süresi dolmuş');
  });

  it('verifyWebSessionCookie does not throw ReferenceError for refreshToken', async () => {
    const account: StoredAccount = {
      id: 'acc_1',
      alias: 'Main',
      accountName: 'testuser',
      steamid: '76561198012345678',
      identitySecret: 'dummy_secret',
      session: {
        refreshToken: 'dummy_token'
      },
      secretFields: ['identitySecret', 'session.refreshToken'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Mock fetch to simulate successful mobileconf/getlist response
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, conf: [] })
    } as any);

    try {
      await expect(
        service.verifyWebSessionCookie(account, 'dummyCookie', 'dummySessionId', dummySettings)
      ).resolves.not.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
