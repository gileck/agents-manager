import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from '../renderer/App';
import { createWebApiShim } from './api-shim';
import { reportError } from '../renderer/lib/error-handler';
import '../renderer/styles/globals.css';

// Daemon URL: same origin when served by the daemon, or port 3847 on same host
const DAEMON_URL = `${window.location.protocol}//${window.location.hostname}:3847`;
const DAEMON_WS_URL = DAEMON_URL.replace(/^http/, 'ws') + '/ws';

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
