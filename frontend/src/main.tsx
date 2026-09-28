import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, MemoryRouter } from 'react-router-dom';
import './i18n';
import './styles/index.css';
import App from './App';

const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';

const getInitialMemoryPath = () => {
  if (typeof window === 'undefined') return '/accounts';
  const rawHash = window.location.hash.replace(/^#\/?/, '');
  return rawHash ? `/${rawHash}` : '/accounts';
};

// PWA Registration for installability on HTTP/HTTPS (disabled on file://)
if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
  // Ensure manifest link exists
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = './manifest.json';
    document.head.appendChild(link);
  }

  // Register lightweight service worker to enable Chrome PWA install prompt
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

const rootElement = document.getElementById('root')!;

createRoot(rootElement).render(
  <StrictMode>
    {isFileProtocol ? (
      <MemoryRouter initialEntries={[getInitialMemoryPath()]}>
        <App />
      </MemoryRouter>
    ) : (
      <HashRouter>
        <App />
      </HashRouter>
    )}
  </StrictMode>
);

