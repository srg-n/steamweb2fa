import { describe, it, expect } from 'vitest';
import {
  generateSteamGuardCode,
  generateConfirmationKey,
  getDeviceId,
  sha1,
  hmacSha1,
  uint8ArrayToHex
} from './steamCrypto';
import { parseMaFile, exportToMaFile } from './mafileParser';

describe('Steam Crypto & TOTP', () => {
  it('should compute correct SHA-1 hash', () => {
    const msg = new TextEncoder().encode('steamguard');
    const hash = sha1(msg);
    const hex = uint8ArrayToHex(hash);
    expect(hex).toBe('9ed5f293961613122798c57f25b1edca13ab079d');
  });

  it('should generate valid 5-char Steam Guard TOTP code', () => {
    const sharedSecret = 'dGVzdHNoYXJlZHNlY3JldDEyMzQ1Njc4OTA=';
    const code = generateSteamGuardCode(sharedSecret, 0);
    expect(code).toHaveLength(5);
    expect(code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
  });

  it('should generate valid device id formatted properly', () => {
    const deviceId = getDeviceId('76561198000000001');
    expect(deviceId).toMatch(/^android:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('should generate valid confirmation key in base64', () => {
    const identitySecret = 'dGVzdGlkZW50aXR5c2VjcmV0MTIzNDU2Nzg5MA==';
    const key = generateConfirmationKey(identitySecret, 'conf', 1700000000);
    expect(key).toBeDefined();
    expect(key.length).toBeGreaterThan(10);
  });
});

describe('MaFile Parser & Exporter', () => {
  it('should parse SDA .maFile format properly', () => {
    const sampleMaFile = JSON.stringify({
      shared_secret: 'dGVzdHNoYXJlZA==',
      identity_secret: 'dGVzdGlkZW50aXR5',
      account_name: 'test_trader',
      revocation_code: 'R12345',
      Session: {
        SteamID: '76561198000000002',
        SteamLoginSecure: '76561198000000002%7C%7Ccookiesample',
        SessionID: 'abcd1234session'
      }
    });

    const parsed = parseMaFile(sampleMaFile, 'My Trader');
    expect(parsed.alias).toBe('My Trader');
    expect(parsed.accountName).toBe('test_trader');
    expect(parsed.steamid).toBe('76561198000000002');
    expect(parsed.sharedSecret).toBe('dGVzdHNoYXJlZA==');
    expect(parsed.identitySecret).toBe('dGVzdGlkZW50aXR5');
    expect(parsed.revocationCode).toBe('R12345');
    expect(parsed.session?.steamLoginSecure).toBe('76561198000000002%7C%7Ccookiesample');

    const exported = exportToMaFile(parsed);
    const reParsed = JSON.parse(exported);
    expect(reParsed.account_name).toBe('test_trader');
    expect(reParsed.shared_secret).toBe('dGVzdHNoYXJlZA==');
    expect(reParsed.Session.SteamID).toBe('76561198000000002');
  });
});
