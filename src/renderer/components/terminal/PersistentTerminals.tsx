import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { XtermTerminal } from './XtermTerminal';
import { useTerminalsContext } from '../../contexts/TerminalsContext';

/**
 * Renders all terminal xterm instances persistently via a portal into <main>.
 * Uses display:none when not on a /terminal route to avoid layout interference
 * with the page content underneath. xterm instances survive display:none since
 * they remain in the DOM; re-fit is triggered via the `visible` prop on show.
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
        zIndex: 10,
        display: onTerminalPage ? 'block' : 'none',
      }}
    >
      {terminals.map((t) => (
        <div
          key={t.id}
          className="w-full h-full"
          style={{ display: t.id === currentTerminalId ? 'block' : 'none' }}
        >
          <XtermTerminal
            terminalId={t.id}
            visible={onTerminalPage && t.id === currentTerminalId}
          />
        </div>
      ))}
    </div>,
    mainEl,
  );
}
