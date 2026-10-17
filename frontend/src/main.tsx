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

// PWA registration. Disabled on file:// where manifest and service workers
// are unavailable.
//
// Trusted Types is enforced via CSP, and ServiceWorkerContainer.register()
// only accepts a TrustedScriptURL. The app registers exactly one script, so
// a single named policy is enough.
const trustedTypesApi = (globalThis as any).trustedTypes;
let scriptUrlPolicy: any = null;
try {
  if (trustedTypesApi?.createPolicy) {
    scriptUrlPolicy = trustedTypesApi.createPolicy('steamguard-url', {
      createScriptURL: (url: string) => url
    });
  }
} catch {
  // Policy already created or blocked: registration falls back to a raw URL.
}

if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = new URL('manifest.json', document.baseURI).href;
    document.head.appendChild(link);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const swUrl = new URL('sw.js', document.baseURI).href;
      const swScriptUrl = scriptUrlPolicy ? scriptUrlPolicy.createScriptURL(swUrl) : swUrl;
      // updateViaCache: 'none' keeps the HTTP cache from serving a stale sw.js,
// which would otherwise freeze the app on an old build.
navigator.serviceWorker
        .register(swScriptUrl, {
          scope: new URL('./', document.baseURI).href,
          updateViaCache: 'none'
        })
        .then((registration) => {
          // Pick up a new worker as soon as it is installed instead of waiting
          // for every tab to close.
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                installing.postMessage('SKIP_WAITING');
              }
            });
          });
        })
        .catch(() => {
          // Offline shell is a nice-to-have; the app still works without it.
        });
    });

    let reloading = false;
    // A freshly installed worker claims clients (clients.claim()), which also
    // fires controllerchange. Reloading on that first claim would restart the
    // app on every page load, so only an actual update of a controlling
    // worker triggers a reload.
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
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

