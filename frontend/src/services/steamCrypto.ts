// Steam Cryptography Utilities: 100% Client-Side / Serverless
// Compatible with Steam Desktop Authenticator (SDA) and official Steam Guard specs.

// Base64 helper
export function base64ToUint8Array(base64: string): Uint8Array {
  // Normalize base64 string (handle url-safe or unpadded)
  let normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4 !== 0) {
    normalized += '=';
  }
  const binaryString = atob(normalized);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function hexToUint8Array(hex: string): Uint8Array {
  const cleanHex = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// -------------------------------------------------------------
// Pure JavaScript SHA-1 and HMAC-SHA1 Implementation
// Guarantees offline/mobile support even when window.crypto.subtle
// is restricted (e.g. non-HTTPS local IP access).
// -------------------------------------------------------------

function rotl(n: number, s: number): number {
  return (n << s) | (n >>> (32 - s));
}

export function sha1(message: Uint8Array): Uint8Array {
  let H0 = 0x67452301;
  let H1 = 0xefcdab89;
  let H2 = 0x98badcfe;
  let H3 = 0x10325476;
  let H4 = 0xc3d2e1f0;

  const msgLen = message.length;
  const bitLen = msgLen * 8;

  // Pre-processing (Padding)
  const padLen = (msgLen + 9 + 63) & ~63;
  const words = new Uint32Array(padLen / 4);

  for (let i = 0; i < msgLen; i++) {
    words[i >>> 2] |= message[i] << (24 - (i % 4) * 8);
  }
  words[msgLen >>> 2] |= 0x80 << (24 - (msgLen % 4) * 8);

  // Length in bits as 64-bit integer
  words[words.length - 1] = bitLen & 0xffffffff;
  words[words.length - 2] = Math.floor(bitLen / 0x100000000);

  const w = new Uint32Array(80);

  for (let i = 0; i < words.length; i += 16) {
    for (let j = 0; j < 16; j++) {
      w[j] = words[i + j];
    }
    for (let j = 16; j < 80; j++) {
      w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    }

    let a = H0;
    let b = H1;
    let c = H2;
    let d = H3;
    let e = H4;

    for (let j = 0; j < 80; j++) {
      let f = 0;
      let k = 0;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (rotl(a, 5) + f + e + k + w[j]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    H0 = (H0 + a) | 0;
    H1 = (H1 + b) | 0;
    H2 = (H2 + c) | 0;
    H3 = (H3 + d) | 0;
    H4 = (H4 + e) | 0;
  }

  const result = new Uint8Array(20);
  const outWords = [H0, H1, H2, H3, H4];
  for (let i = 0; i < 5; i++) {
    result[i * 4] = (outWords[i] >>> 24) & 0xff;
    result[i * 4 + 1] = (outWords[i] >>> 16) & 0xff;
    result[i * 4 + 2] = (outWords[i] >>> 8) & 0xff;
    result[i * 4 + 3] = outWords[i] & 0xff;
  }

  return result;
}

export function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let formattedKey = key;

  if (formattedKey.length > blockSize) {
    formattedKey = sha1(formattedKey);
  }

  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(formattedKey);

  const iPad = new Uint8Array(blockSize);
  const oPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    iPad[i] = paddedKey[i] ^ 0x36;
    oPad[i] = paddedKey[i] ^ 0x5c;
  }

  const innerMsg = new Uint8Array(blockSize + message.length);
  innerMsg.set(iPad, 0);
  innerMsg.set(message, blockSize);
  const innerHash = sha1(innerMsg);

  const outerMsg = new Uint8Array(blockSize + 20);
  outerMsg.set(oPad, 0);
  outerMsg.set(innerHash, blockSize);

  return sha1(outerMsg);
}

// -------------------------------------------------------------
// Pure JavaScript SHA-256 and HMAC-SHA256 Implementation
// -------------------------------------------------------------

function rotr(n: number, s: number): number {
  return (n >>> s) | (n << (32 - s));
}

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

export function sha256(message: Uint8Array): Uint8Array {
  let H0 = 0x6a09e667;
  let H1 = 0xbb67ae85;
  let H2 = 0x3c6ef372;
  let H3 = 0xa54ff53a;
  let H4 = 0x510e527f;
  let H5 = 0x9b05688c;
  let H6 = 0x1f83d9ab;
  let H7 = 0x5be0cd19;

  const msgLen = message.length;
  const bitLen = msgLen * 8;
  const padLen = (msgLen + 9 + 63) & ~63;
  const words = new Uint32Array(padLen / 4);

  for (let i = 0; i < msgLen; i++) {
    words[i >>> 2] |= message[i] << (24 - (i % 4) * 8);
  }
  words[msgLen >>> 2] |= 0x80 << (24 - (msgLen % 4) * 8);
  words[words.length - 1] = bitLen & 0xffffffff;
  words[words.length - 2] = Math.floor(bitLen / 0x100000000);

  const w = new Uint32Array(64);

  for (let i = 0; i < words.length; i += 16) {
    for (let j = 0; j < 16; j++) {
      w[j] = words[i + j];
    }
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }

    let a = H0;
    let b = H1;
    let c = H2;
    let d = H3;
    let e = H4;
    let f = H5;
    let g = H6;
    let h = H7;

    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K256[j] + w[j]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    H0 = (H0 + a) | 0;
    H1 = (H1 + b) | 0;
    H2 = (H2 + c) | 0;
    H3 = (H3 + d) | 0;
    H4 = (H4 + e) | 0;
    H5 = (H5 + f) | 0;
    H6 = (H6 + g) | 0;
    H7 = (H7 + h) | 0;
  }

  const result = new Uint8Array(32);
  const outWords = [H0, H1, H2, H3, H4, H5, H6, H7];
  for (let i = 0; i < 8; i++) {
    result[i * 4] = (outWords[i] >>> 24) & 0xff;
    result[i * 4 + 1] = (outWords[i] >>> 16) & 0xff;
    result[i * 4 + 2] = (outWords[i] >>> 8) & 0xff;
    result[i * 4 + 3] = outWords[i] & 0xff;
  }

  return result;
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let formattedKey = key;

  if (formattedKey.length > blockSize) {
    formattedKey = sha256(formattedKey);
  }

  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(formattedKey);

  const iPad = new Uint8Array(blockSize);
  const oPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    iPad[i] = paddedKey[i] ^ 0x36;
    oPad[i] = paddedKey[i] ^ 0x5c;
  }

  const innerMsg = new Uint8Array(blockSize + message.length);
  innerMsg.set(iPad, 0);
  innerMsg.set(message, blockSize);
  const innerHash = sha256(innerMsg);

  const outerMsg = new Uint8Array(blockSize + 32);
  outerMsg.set(oPad, 0);
  outerMsg.set(innerHash, blockSize);

  return sha256(outerMsg);
}

// -------------------------------------------------------------
// Steam Guard Authenticator Functions
// -------------------------------------------------------------

const STEAM_ALPHABET = '23456789BCDFGHJKMNPQRTVWXY';

/**
 * Generate 5-character Steam Guard TOTP 2FA code.
 * Runs 100% locally in the browser with zero network latency.
 */
export function generateSteamGuardCode(sharedSecret: string, timeOffsetSec = 0): string {
  if (!sharedSecret) return '-----';

  try {
    const key = /^[0-9a-fA-F]{40}$/.test(sharedSecret)
      ? hexToUint8Array(sharedSecret)
      : base64ToUint8Array(sharedSecret);

    const currentTime = Math.floor(Date.now() / 1000) + timeOffsetSec;
    let counter = Math.floor(currentTime / 30);

    const timeBytes = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      timeBytes[i] = counter & 0xff;
      counter = Math.floor(counter / 256);
    }

    const digest = hmacSha1(key, timeBytes);
    const offset = digest[19] & 0x0f;

    let fullCode =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);

    let result = '';
    for (let i = 0; i < 5; i++) {
      result += STEAM_ALPHABET[fullCode % STEAM_ALPHABET.length];
      fullCode = Math.floor(fullCode / STEAM_ALPHABET.length);
    }

    return result;
  } catch (err) {
    console.error('Failed to generate Steam Guard code:', err);
    return 'ERROR';
  }
}

/**
 * Generate Steam Mobile Confirmation Key
 * tag can be: "conf", "details", "allow", "cancel"
 */
export function generateConfirmationKey(identitySecret: string, tag: string, timeSec: number): string {
  try {
    const key = /^[0-9a-fA-F]{40}$/.test(identitySecret)
      ? hexToUint8Array(identitySecret)
      : base64ToUint8Array(identitySecret);

    const tagBytes = new TextEncoder().encode(tag);
    const buffer = new Uint8Array(8 + tagBytes.length);

    let t = timeSec;
    for (let i = 7; i >= 0; i--) {
      buffer[i] = t & 0xff;
      t = Math.floor(t / 256);
    }

    buffer.set(tagBytes, 8);

    const digest = hmacSha1(key, buffer);
    return uint8ArrayToBase64(digest);
  } catch (err) {
    console.error('Failed to generate confirmation key:', err);
    return '';
  }
}

/**
 * Generate standard Steam Android device ID from SteamID64:
 * android:XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */
export function getDeviceId(steamid: string): string {
  try {
    const hash = sha1(new TextEncoder().encode(steamid || '0'));
    const hex = uint8ArrayToHex(hash);
    return `android:${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
  } catch {
    return 'android:00000000-0000-0000-0000-000000000000';
  }
}

/**
 * Generate Steam AuthSession (Mobile Login Confirmation) signature.
 * Version (uint16le) + ClientID (uint64le) + SteamID (uint64le) -> HMAC-SHA256
 */
export function generateAuthSessionSignature(
  sharedSecret: string,
  version: number,
  clientId: string,
  steamId: string
): Uint8Array {
  const key = /^[0-9a-fA-F]{40}$/.test(sharedSecret)
    ? hexToUint8Array(sharedSecret)
    : base64ToUint8Array(sharedSecret);

  const data = new Uint8Array(18);
  const view = new DataView(data.buffer);

  view.setUint16(0, version, true);
  view.setBigUint64(2, BigInt(clientId), true);
  view.setBigUint64(10, BigInt(steamId), true);

  return hmacSha256(key, data);
}
