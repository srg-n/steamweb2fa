import { MoonStar, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import { useTheme } from '../hooks/useTheme';

type Props = {
  onChange?: (theme: 'light' | 'dark') => void;
};

export function ThemeToggle({ onChange }: Props) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="secondary"
      className="h-8 sm:h-9 px-2 sm:px-3 text-xs gap-1.5 flex items-center justify-center rounded-xl"
      aria-label={t('settings.theme')}
      onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        onChange?.(next);
      }}
      title={`${t('settings.theme')}: ${theme === 'dark' ? t('settings.dark') : t('settings.light')}`}
    >
      {theme === 'dark' ? <Sun size={15} className="text-amber-400" /> : <MoonStar size={15} className="text-cyan-400" />}
      <span className="hidden sm:inline font-medium">{t('settings.theme')}</span>
    </Button>
  );
}
