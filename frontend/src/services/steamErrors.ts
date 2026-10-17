/**
 * Steam hataları için makine tarafından okunabilir kodlar.
 *
 * Steam çağrılarının hata mesajları çeviri dosyalarından geliyor, yani bir
 * kullanıcı dili değiştirdiğinde metin de değişiyor. Arayüz "oturum bitti mi?"
 * sorusuna metne bakarak cevap veremez; bu yüzden kod taşıyoruz.
 */

export type SteamErrorCode =
  /** steamLoginSecure / OAuth jetonu geçersiz: oturum yenilenmeli. */
  | 'SESSION_EXPIRED'
  /** Hiç oturum kaydı yok: kullanıcı giriş yapmalı. */
  | 'SESSION_MISSING'
  /** Steam istek kotası aşıldı. */
  | 'RATE_LIMITED'
  /** Tarayıcıdan doğrudan istek CORS tarafından engellendi. */
  | 'CORS_BLOCKED';

export class SteamApiError extends Error {
  readonly code: SteamErrorCode;
  /** Hangi hesabın oturumu sorunlu, biliniyorsa. */
  readonly accountId?: string;

  constructor(code: SteamErrorCode, message: string, accountId?: string) {
    super(message);
    this.name = 'SteamApiError';
    this.code = code;
    this.accountId = accountId;
  }
}

export function isSteamError(err: unknown, code: SteamErrorCode): boolean {
  return err instanceof SteamApiError && err.code === code;
}

/** Oturumun tazelenmesi gereken hatalar (yenile / yeniden giriş kartı). */
export function isSessionError(err: unknown): boolean {
  return isSteamError(err, 'SESSION_EXPIRED') || isSteamError(err, 'SESSION_MISSING');
}

/** Steam'in hata gövdesinden "oturum bitti" mi çıkarıyor. */
export function steamBodyLooksExpired(data: any): boolean {
  return Boolean(data?.needauth);
}
