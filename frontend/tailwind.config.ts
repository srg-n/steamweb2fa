import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#3a3a4c',
          700: '#22222c',
          750: '#191922',
          800: '#121218',
          850: '#0a0a0e',
          900: '#050508',
          950: '#000000'
        },
        amoled: '#000000',
        accent: {
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#00d2ff',
          600: '#0284c7'
        },
        success: '#10b981',
        danger: '#ef4444',
        warning: '#f59e0b'
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        glow: '0 0 20px rgba(0, 210, 255, 0.18)',
        'glow-emerald': '0 0 20px rgba(16, 185, 129, 0.25)',
        'glow-danger': '0 0 20px rgba(239, 68, 68, 0.25)',
        'amoled-card': '0 0 0 1px rgba(255, 255, 255, 0.08), 0 10px 40px rgba(0, 0, 0, 0.95)'
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        'fade-in-up': 'fade-in-up 420ms ease-out'
      }
    }
  },
  plugins: [forms]
} satisfies Config;
