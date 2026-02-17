import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { installApiErrorProxy } from './lib/api-proxy';
import { reportError } from './lib/error-handler';
import './styles/globals.css';

declare global {
  interface Window {
    api?: unknown;
  }
}

// Install API proxy before anything else so all IPC calls are intercepted
installApiErrorProxy();

window.addEventListener('error', (event) => {
  console.error('Renderer error event:', event.error || event.message);
  reportError(event.error || event.message, 'Uncaught error');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Renderer unhandled rejection:', event.reason);
  // Skip errors already reported by the API proxy
  if (event.reason && (event.reason as { __reported?: boolean }).__reported) return;
  reportError(event.reason, 'Unhandled rejection');
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </HashRouter>
  </React.StrictMode>
);
