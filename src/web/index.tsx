import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from '../renderer/App';
import { createWebApiShim } from './api-shim';
import { reportError } from '../renderer/lib/error-handler';
import '../renderer/styles/globals.css';

// When served by webpack-dev-server, the proxy forwards /api and /ws to the daemon,
// so we use same-origin. When served directly by the daemon, same-origin also works.
const DAEMON_URL = window.location.origin;
const DAEMON_WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

// Install the API shim before React renders
window.api = createWebApiShim(DAEMON_URL, DAEMON_WS_URL);

window.addEventListener('error', (event) => {
  console.error('Web client error:', event.error || event.message);
  reportError(event.error || event.message, 'Uncaught error');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Web client unhandled rejection:', event.reason);
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
