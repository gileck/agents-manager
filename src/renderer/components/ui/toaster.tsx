/**
 * App-specific toast component. No template equivalent exists.
 */
import React from 'react';
import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      richColors
      expand
      toastOptions={{
        style: {
          fontFamily: '"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          borderRadius: '14px',
          backdropFilter: 'blur(12px)',
        },
      }}
    />
  );
}
