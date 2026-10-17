import { describe, expect, it } from 'vitest';
import { describeVaultError, VaultError, vaultErrorCode } from './vaultErrors';

const tr = (key: string) => `tr:${key}`;

describe('vaultErrors', () => {
  it('maps a known code to a translated sentence', () => {
    expect(describeVaultError(new VaultError('prf_unsupported', 'raw english'), tr)).toBe(
      'tr:vault.error.prf_unsupported'
    );
  });

  it('falls back to the original message when there is no translation', () => {
    const translate = (key: string) => (key === 'vault.error.unknown' ? key : `tr:${key}`);
    expect(describeVaultError(new VaultError('unknown', 'raw english'), translate)).toBe('raw english');
  });

  it('never returns an empty string', () => {
    expect(
      describeVaultError(new VaultError('unknown', '   '), (key) => (key ? '' : ''), 'fallback text')
    ).toBe('fallback text');

    expect(describeVaultError(new Error(''), () => '', 'fallback text')).toBe('fallback text');
  });

  it('ignores codes it does not know', () => {
    expect(vaultErrorCode({ code: 'SOMETHING_ELSE' })).toBe('unknown');
    expect(vaultErrorCode(new DOMException('boom'))).toBe('unknown');
    expect(vaultErrorCode(new VaultError('timeout', 'slow'))).toBe('timeout');
  });

  it('recognises codes attached by the vault lock error', () => {
    // VaultLockedError carries a code as well; a structurally compatible
    // object must map to the translation, not the raw English text.
    expect(
      describeVaultError({ code: 'wrong_key', message: 'Unlocked with the wrong key.' }, tr)
    ).toBe('tr:vault.error.wrong_key');
  });
});