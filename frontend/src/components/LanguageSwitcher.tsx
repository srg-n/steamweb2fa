import { useState, useRef, useEffect } from 'react';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';

type Props = {
  onChange?: (lang: 'en' | 'ru' | 'tr') => void;
};

const LANGUAGES = [
  { code: 'tr' as const, label: 'TR', full: 'Türkçe' },
  { code: 'en' as const, label: 'EN', full: 'English' },
  { code: 'ru' as const, label: 'RU', full: 'Русский' }
];

export function LanguageSwitcher({ onChange }: Props) {
  const { i18n, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current = i18n.language?.startsWith('tr')
    ? 'tr'
    : i18n.language?.startsWith('ru')
      ? 'ru'
      : 'en';

  const setLang = (next: 'en' | 'ru' | 'tr') => {
    setIsOpen(false);
    if (next === current) return;
    void i18n.changeLanguage(next);
    onChange?.(next);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative inline-flex items-center" ref={dropdownRef}>
      {/* Mobile: Compact Dropdown Pill (Fits any phone width without overflow) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="sm:hidden flex items-center gap-1 h-8 px-2 rounded-xl border border-base-200 bg-white/80 dark:border-white/[0.1] dark:bg-black text-xs font-bold text-base-800 dark:text-white active:scale-95 transition-all shadow-sm"
        aria-label={`${t('settings.language')}: ${current.toUpperCase()}`}
        aria-expanded={isOpen}
      >
        <Globe size={13} className="text-accent-500 dark:text-[#00d2ff]" />
        <span className="uppercase text-[11px] font-extrabold tracking-wider">{current}</span>
        <ChevronDown
          size={11}
          className={`transition-transform duration-200 text-base-400 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Mobile Dropdown Popover */}
      {isOpen && (
        <div className="sm:hidden absolute right-0 top-full mt-1.5 z-50 min-w-[125px] rounded-xl border border-base-200 dark:border-white/[0.12] bg-white/95 dark:bg-black/95 backdrop-blur-xl p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => setLang(lang.code)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                current === lang.code
                  ? 'bg-accent-500 text-black font-bold dark:bg-[#00d2ff] dark:text-black'
                  : 'text-base-700 hover:bg-base-100 dark:text-base-300 dark:hover:bg-white/[0.06]'
              }`}
            >
              <span>{lang.full}</span>
              {current === lang.code && <Check size={12} className="stroke-[3]" />}
            </button>
          ))}
        </div>
      )}

      {/* Desktop: Sleek Segmented Control */}
      <div className="hidden sm:flex items-center gap-0.5 rounded-xl border border-base-200 bg-white/70 p-0.5 dark:border-white/[0.08] dark:bg-black">
        <Globe size={13} className="mx-1 text-base-400" />
        {LANGUAGES.map((lang) => (
          <Button
            key={lang.code}
            variant={current === lang.code ? 'primary' : 'secondary'}
            className={`h-7 px-2 text-xs font-bold rounded-lg transition-all ${
              current === lang.code
                ? 'shadow-glow dark:bg-[#00d2ff] dark:text-black'
                : 'hover:text-base-900 dark:hover:text-white'
            }`}
            onClick={() => setLang(lang.code)}
            title={`${t('settings.language')}: ${lang.label}`}
          >
            {lang.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
