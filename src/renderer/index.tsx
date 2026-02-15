import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/globals.css';

declare global {
  interface Window {
    api?: unknown;
  }
}

window.addEventListener('error', (event) => {
  console.error('Renderer error event:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Renderer unhandled rejection:', event.reason);
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
