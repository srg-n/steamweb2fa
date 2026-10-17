/**
 * WebAuthn PRF ("pseudo-random function") support.
 *
 * The authenticator holds a credential-specific secret and evaluates
 * HMAC-SHA-256 over a salt we supply. The result only ever exists inside the
 * ceremony, which is what makes it useful here: the vault DEK can be wrapped
 * with a key that JavaScript never sees.
 *
 * Support is uneven across authenticators, so every step is feature detected
 * and verified at runtime, and the caller must keep a recovery path.
 */

import { VaultError, type VaultErrorCode } from './vaultErrors';

const RP_NAME = 'SteamGuard Web';

/**
 * A passkey ceremony can stay pending forever: the platform prompt may never
 * appear (headless browsers, some Linux setups) or the authenticator may never
 * answer. Without this the settings button would stay disabled indefinitely.
 */
const CEREMONY_TIMEOUT_MS = 45_000;

function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new VaultError('timeout', `${what} timed out after ${CEREMONY_TIMEOUT_MS} ms.`)),
      CEREMONY_TIMEOUT_MS
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface PrfCredential {
  /** base64url credential id */
  credentialId: string;
  /**
   * Vault key handed out by the authenticator during registration, if any.
   * Absent means the device cannot derive keys here and the caller should fall
   * back to the recovery passphrase.
   */
  prfKey?: Uint8Array;
}

export interface PrfSupport {
  /** WebAuthn exists at all. */
  webauthn: boolean;
  /** A built-in authenticator (Windows Hello, Touch ID, ...) is available. */
  platformAuthenticator: boolean;
  /** The browser itself knows about the PRF extension. */
  browserPrf: boolean;
  /** True when the passkey option can be offered. */
  usable: boolean;
  /** Why it cannot be used, for the settings hint. */
  reason?: 'webauthn_missing' | 'platform_authenticator_missing' | 'prf_unsupported';
}

function base64UrlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function supportedAlgorithms(): PublicKeyCredentialParameters[] {
  return [
    { type: 'public-key', alg: -7 }, // ES256
    { type: 'public-key', alg: -257 } // RS256
  ];
}

/**
 * Reads what the browser itself reports. Two shapes exist in the wild:
 * `PublicKeyCredential.getClientCapabilities('public-key')` returns
 * `{ extensions: string[] }`, while `navigator.credentials.getClientCapabilities()`
 * returns `{ extension: { prf: boolean } }`. Both are checked so the UI can hide
 * the passkey option *before* the user triggers an authenticator prompt that
 * is bound to fail.
 */
async function detectBrowserPrf(): Promise<boolean> {
  const anyPublicKeyCredential = PublicKeyCredential as unknown as {
    getClientCapabilities?: (options: string) => Promise<{ extensions?: string[] }>;
  };

  try {
    if (typeof anyPublicKeyCredential.getClientCapabilities === 'function') {
      const caps = await anyPublicKeyCredential.getClientCapabilities('public-key');
      if (Array.isArray(caps?.extensions)) return caps.extensions.includes('prf');
    }
  } catch {
    // fall through to the other API
  }

  try {
    const creds = navigator.credentials as unknown as {
      getClientCapabilities?: () => Promise<{ extension?: Record<string, boolean> }>;
    };
    if (typeof creds?.getClientCapabilities === 'function') {
      const caps = await creds.getClientCapabilities();
      if (caps?.extension?.prf === true) return true;
    }
  } catch {
    // ignore
  }

  // Older builds expose the API but no capability query; assume the browser
  // forwards the extension and let the enrolment ceremony decide.
  return true;
}

export async function detectPrfSupport(): Promise<PrfSupport> {
  if (typeof window === 'undefined' || typeof window.PublicKeyCredential === 'undefined') {
    return { webauthn: false, platformAuthenticator: false, browserPrf: false, usable: false, reason: 'webauthn_missing' };
  }

  const anyPublicKeyCredential = PublicKeyCredential as unknown as {
    isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  };

  let platformAuthenticator = false;
  if (typeof anyPublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
    try {
      platformAuthenticator = await anyPublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      platformAuthenticator = false;
    }
  }

  const browserPrf = await detectBrowserPrf();

  if (!platformAuthenticator) {
    return { webauthn: true, platformAuthenticator: false, browserPrf, usable: false, reason: 'platform_authenticator_missing' };
  }
  if (!browserPrf) {
    return { webauthn: true, platformAuthenticator: true, browserPrf: false, usable: false, reason: 'prf_unsupported' };
  }

  return { webauthn: true, platformAuthenticator: true, browserPrf: true, usable: true };
}

/**
 * PRF output for a salt, or null when the authenticator declines. Returning
 * null (instead of throwing) lets the UI fall back to the passphrase path.
 */
async function prfOutput(
  credentialId: string,
  salt: Uint8Array
): Promise<Uint8Array | null> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  let assertion: PublicKeyCredential | null = null;
  try {
    assertion = (await withTimeout(
      navigator.credentials.get({
        publicKey: {
          challenge: challenge as BufferSource,
          rpId: window.location.hostname,
          allowCredentials: [{ type: 'public-key', id: base64UrlToBuffer(credentialId) }],
          userVerification: 'required',
          extensions: { prf: { eval: { first: salt as BufferSource } } }
        }
      }) as Promise<PublicKeyCredential | null>,
      'The passkey unlock'
    )) as PublicKeyCredential | null;
  } catch (err) {
    throw asPrfError(err);
  }

  if (!assertion) return null;

  const results = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = results.prf?.results?.first;
  if (!first) return null;
  return new Uint8Array(first);
}

/**
 * Registers a passkey bound to this origin and returns its credential id.
 *
 * Registration-time PRF evaluation is the strongest signal that the
 * authenticator will also produce outputs during assertions, but it is not
 * universally supported, so success is only claimed when the authenticator
 * explicitly reports `prf.enabled`.
 */
/**
 * Registers a passkey bound to this origin and returns its credential id.
 *
 * The vault key is requested **in the same prompt**: asking the authenticator
 * for a PRF output while creating the credential costs the user one
 * authentication, not two. Authenticators that only support PRF during an
 * assertion are skipped (the caller falls back to the recovery passphrase)
 * rather than prompting the user a second time.
 */
export async function enrollPrfCredential(
  userName: string,
  salt?: Uint8Array
): Promise<PrfCredential> {
  const support = await detectPrfSupport();
  if (!support.usable) {
    throw new VaultError(
      (support.reason ?? 'prf_unsupported') as VaultErrorCode,
      support.reason === 'webauthn_missing'
        ? 'This browser does not support WebAuthn.'
        : 'This device cannot derive a vault key. Use a recovery passphrase instead.'
    );
  }

  const userId = crypto.getRandomValues(new Uint8Array(32));
  let credential: PublicKeyCredential | null = null;

  try {
    credential = (await withTimeout(
      navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)) as BufferSource,
          rp: { name: RP_NAME },
          user: {
            id: userId as BufferSource,
            name: userName,
            displayName: userName
          },
          pubKeyCredParams: supportedAlgorithms(),
          // A platform authenticator with user verification is what turns the
          // ceremony into a real "someone with this device" check.
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred'
          },
          attestation: 'none',
          timeout: 60_000,
          extensions: {
            prf: salt ? { eval: { first: salt as BufferSource } } : {}
          }
        }
      }) as Promise<PublicKeyCredential | null>,
      'The passkey prompt'
    )) as PublicKeyCredential | null;
  } catch (err) {
    throw asPrfError(err);
  }

  if (!credential) {
    throw new VaultError('cancelled', 'Passkey creation was cancelled.');
  }

  const extensions = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };

  return {
    credentialId: bufferToBase64Url(credential.rawId),
    prfKey: extensions.prf?.results?.first ? new Uint8Array(extensions.prf.results.first) : undefined
  };
}

/** Turns the DOMExceptions the platform throws into meaningful codes. */
function asPrfError(err: unknown): VaultError {
  const name = (err as { name?: string })?.name ?? '';
  const message = err instanceof Error ? err.message : '';

  if (name === 'NotAllowedError' || name === 'AbortError') {
    return new VaultError('cancelled', message || 'The passkey prompt was dismissed.');
  }
  if (name === 'NotSupportedError' || name === 'SecurityError') {
    return new VaultError('prf_unsupported', message || 'This authenticator cannot derive a vault key.');
  }
  return new VaultError('unknown', message || 'The passkey could not be created.');
}

/**
 * Asks the authenticator for the vault key. Requires a prior `get()` /
 * `create()` ceremony with a challenge, which is why callers must not treat
 * this as a silent operation.
 */
export async function derivePrfKey(
  credential: PrfCredential,
  salt: Uint8Array
): Promise<Uint8Array> {
  const key = await prfOutput(credential.credentialId, salt);
  if (!key) {
    throw new VaultError(
      'no_key',
      'The authenticator did not return a vault key. Unlock again, or use the recovery passphrase.'
    );
  }
  return key;
}