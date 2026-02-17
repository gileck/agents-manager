import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { reportError } from './lib/error-handler';
import './styles/globals.css';

window.addEventListener('error', (event) => {
  console.error('Renderer error event:', event.error || event.message);
  reportError(event.error || event.message, 'Uncaught error');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Renderer unhandled rejection:', event.reason);
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
