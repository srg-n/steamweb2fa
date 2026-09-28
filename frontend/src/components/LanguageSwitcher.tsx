import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';

type Props = {
  onChange?: (lang: 'en' | 'ru' | 'tr') => void;
};

export function LanguageSwitcher({ onChange }: Props) {
  const { i18n, t } = useTranslation();
  const current = i18n.language.startsWith('tr')
    ? 'tr'
    : i18n.language.startsWith('ru')
      ? 'ru'
      : 'en';

  const setLang = (next: 'en' | 'ru' | 'tr') => {
    if (next === current) {
      return;
    }
    void i18n.changeLanguage(next);
    onChange?.(next);
  };

  return (
    <div className="flex items-center gap-1 rounded-xl border border-base-200 bg-white/70 p-1 dark:border-white/[0.08] dark:bg-black">
      <Globe size={14} className="mx-1 text-base-500" />
      <Button
        variant={current === 'tr' ? 'primary' : 'secondary'}
        className="h-8 px-2 text-xs"
        onClick={() => setLang('tr')}
        title={`${t('settings.language')}: TR`}
      >
        TR
      </Button>
      <Button
        variant={current === 'en' ? 'primary' : 'secondary'}
        className="h-8 px-2 text-xs"
        onClick={() => setLang('en')}
        title={`${t('settings.language')}: EN`}
      >
        EN
      </Button>
      <Button
        variant={current === 'ru' ? 'primary' : 'secondary'}
        className="h-8 px-2 text-xs"
        onClick={() => setLang('ru')}
        title={`${t('settings.language')}: RU`}
      >
        RU
      </Button>
    </div>
  );
}

