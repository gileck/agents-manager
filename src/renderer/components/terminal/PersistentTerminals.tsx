import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { XtermTerminal } from './XtermTerminal';
import { useTerminalsContext } from '../../contexts/TerminalsContext';

/**
 * Renders all terminal xterm instances persistently via a portal into <main>.
 * Hidden via CSS when not on a /terminal route — avoids unmount/remount
 * when navigating between pages.
 */
export function PersistentTerminals() {
  const { terminals, currentTerminalId } = useTerminalsContext();
  const location = useLocation();
  const onTerminalPage = location.pathname.startsWith('/terminal');
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.querySelector('main');
    if (el) setMainEl(el);
  }, []);

  if (!mainEl || terminals.length === 0) return null;

  return createPortal(
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: onTerminalPage ? 10 : -1,
        visibility: onTerminalPage ? 'visible' : 'hidden',
        pointerEvents: onTerminalPage ? 'auto' : 'none',
      }}
    >
      {terminals.map((t) => (
        <div
          key={t.id}
          className="w-full h-full"
          style={{ display: t.id === currentTerminalId ? 'block' : 'none' }}
        >
          <XtermTerminal terminalId={t.id} />
        </div>
      ))}
    </div>,
    mainEl,
  );
}
