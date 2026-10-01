import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ru from './ru.json';
import tr from './tr.json';

export const SUPPORTED_LANGUAGES = ['en', 'tr', 'ru'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Keeps <html lang> in sync with the active language so screen readers, the
 * manifest and browser UI match the selected language.
 */
function syncDocumentLanguage(lang: string) {
  if (typeof document === 'undefined') return;
  const normalized = lang.split('-')[0].toLowerCase();
  if (isSupportedLanguage(normalized)) {
    document.documentElement.lang = normalized;
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
      tr: { translation: tr }
    },
    supportedLngs: [...SUPPORTED_LANGUAGES],
    // Never fall through to a language we did not ship.
    fallbackLng: 'en',
    // Without this, "tr" resolves to "tr-TR" and lookups fall back to en.
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng'
    }
  });

i18n.on('languageChanged', syncDocumentLanguage);
syncDocumentLanguage(i18n.resolvedLanguage || i18n.language);

export default i18n;