/**
 * Shared error vocabulary for the vault.
 *
 * Errors are thrown with a stable `code` so the UI can show a translated,
 * actionable sentence instead of a raw English string from the crypto layer.
 */

export type VaultErrorCode =
  | 'webauthn_missing'
  | 'platform_authenticator_missing'
  | 'prf_unsupported'
  | 'cancelled'
  | 'timeout'
  | 'no_key'
  | 'locked'
  | 'wrong_key'
  | 'no_passphrase'
  | 'no_passkey'
  | 'short_passphrase'
  | 'no_method'
  | 'unknown';

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

const KNOWN_CODES: VaultErrorCode[] = [
  'webauthn_missing',
  'platform_authenticator_missing',
  'prf_unsupported',
  'cancelled',
  'timeout',
  'no_key',
  'locked',
  'wrong_key',
  'no_passphrase',
  'no_passkey',
  'short_passphrase',
  'no_method'
];

/** Reads the code of any error, including DOMExceptions from WebCrypto. */
export function vaultErrorCode(err: unknown): VaultErrorCode {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && (KNOWN_CODES as string[]).includes(code)) {
    return code as VaultErrorCode;
  }
  return 'unknown';
}

/**
 * Turns an error into something worth showing: a translated sentence when the
 * code is known, otherwise the original message (and never an empty box).
 *
 * Takes a plain `key => string` function so it works with any translator
 * (i18next's `t` is passed through an adapter at the call site).
 */
export function describeVaultError(
  err: unknown,
  translate: (key: string) => string,
  fallback = 'The vault operation failed.'
): string {
  const code = vaultErrorCode(err);
  if (code !== 'unknown') {
    const key = `vault.error.${code}`;
    const translated = translate(key);
    // i18next echoes the key back when a translation is missing.
    if (translated && translated !== key) return translated;
  }

  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return fallback;
}