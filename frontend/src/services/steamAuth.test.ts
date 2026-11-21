import { describe, it, expect } from 'vitest';
import { extractSteamIdFromToken } from './steamAuth';

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
