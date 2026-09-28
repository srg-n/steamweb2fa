import { describe, expect, it } from 'vitest';
import { shortenSteamId } from './format';
import { applyCorsProxy } from '../services/steamClient';
import { encryptSteamPassword } from '../services/steamAuth';

describe('shortenSteamId', () => {
  it('returns dash for null', () => {
    expect(shortenSteamId(null)).toBe('-');
  });

  it('shortens long values', () => {
    expect(shortenSteamId('76561198000000000')).toBe('76561...0000');
  });
});

describe('applyCorsProxy', () => {
  it('adds https:// if protocol is missing', () => {
    const res = applyCorsProxy('https://api.steampowered.com/test', 'proxy.example.workers.dev');
    expect(res).toBe('https://proxy.example.workers.dev/https://api.steampowered.com/test');
  });

  it('handles trailing slash correctly', () => {
    const res = applyCorsProxy('https://api.steampowered.com/test', 'https://proxy.example.workers.dev/');
    expect(res).toBe('https://proxy.example.workers.dev/https://api.steampowered.com/test');
  });

  it('handles query param proxy correctly', () => {
    const res = applyCorsProxy('https://api.steampowered.com/test', 'https://myproxy.com/?url=');
    expect(res).toBe('https://myproxy.com/?url=https%3A%2F%2Fapi.steampowered.com%2Ftest');
  });
});

describe('encryptSteamPassword', () => {
  it('encrypts password into valid base64 with valid RSA parameters', () => {
    const mod = 'b4a7e713f3730702e0a16b391ac372845da39b48b43ff07b1e27ff9cdfa2d51d968dcd506c45358b16470d734fb201ff730c4b13426e5174863bdf35944d621bf3f83e053183ec070e0b1a9512fa4be3fbe6011a';
    const exp = '010001';
    const encrypted = encryptSteamPassword('mySecretPassword123', mod, exp);
    expect(encrypted).toBeDefined();
    expect(encrypted.length).toBeGreaterThan(20);
    expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});
