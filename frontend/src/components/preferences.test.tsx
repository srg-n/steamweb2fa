/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeToggle } from './ThemeToggle';

const i18nMock = vi.hoisted(() => ({
  language: 'en',
  resolvedLanguage: 'en' as string | undefined,
  changeLanguage: vi.fn(async (next: string) => {
    i18nMock.language = next;
    i18nMock.resolvedLanguage = next;
  }),
  on: vi.fn(),
  off: vi.fn(),
  use: vi.fn(function use() {
    return this;
  }),
  init: vi.fn(),
  t: vi.fn((key: string) => key)
}));

vi.mock('react-i18next', () => ({
  // LanguageSwitcher imports ../i18n, which calls .use(initReactI18next).
  // Without these stubs the i18next singleton throws on import.
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'settings.theme': 'Theme',
        'settings.dark': 'Dark',
        'settings.light': 'Light',
        'settings.language': 'Language'
      };
      return labels[key] ?? key;
    },
    i18n: i18nMock
  })
}));

describe('preference controls', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    i18nMock.language = 'en';
    i18nMock.resolvedLanguage = 'en';
    i18nMock.changeLanguage.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('persists theme changes in localStorage and updates the root class', async () => {
    const onChange = vi.fn();
    render(<ThemeToggle onChange={onChange} />);

    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    expect(localStorage.getItem('steamguard-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: /theme/i }));

    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
    expect(localStorage.getItem('steamguard-theme')).toBe('light');
    expect(onChange).toHaveBeenCalledWith('light');
  });

  it('switches language and reports the selected locale', () => {
    const onChange = vi.fn();
    render(<LanguageSwitcher onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'RU' }));

    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('ru');
    expect(onChange).toHaveBeenCalledWith('ru');
  });
});
