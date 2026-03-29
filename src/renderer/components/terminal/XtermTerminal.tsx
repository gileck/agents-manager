import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { reportError } from '../../lib/error-handler';
import '@xterm/xterm/css/xterm.css';

interface XtermTerminalProps {
  terminalId: string;
  /** Whether the terminal container is currently visible — triggers re-fit */
  visible?: boolean;
}

/**
 * Resize dance: send nudged dimensions first, then correct ones after 50ms.
 * Forces kernel SIGWINCH even on same-size reconnections (e.g. after navigating
 * away and back). Without the nudge, the shell/tmux may skip the redraw.
 */
function resizeDance(
  terminalId: string,
  cols: number,
  rows: number,
): void {
  // Step 1: nudge by +1 col to force a size change
  window.api.terminals.resize(terminalId, cols + 1, rows)
    .catch(() => { /* ignore nudge errors */ });
  // Step 2: correct dimensions after 50ms — guarantees SIGWINCH fires
  setTimeout(() => {
    window.api.terminals.resize(terminalId, cols, rows)
      .catch((err) => reportError(err, 'Terminal resize'));
  }, 50);
}

export function XtermTerminal({ terminalId, visible = true }: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const handleResize = useCallback(() => {
    const fit = fitRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    try {
      fit.fit();
    } catch {
      // fit() can throw if the container isn't visible — skip resize
      return;
    }
    window.api.terminals.resize(terminalId, term.cols, term.rows)
      .catch((err) => reportError(err, 'Terminal resize'));
  }, [terminalId]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#f8f8f2',
        selectionBackground: '#44475a',
        black: '#21222c',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
      },
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fit;

    // Initial fit + focus
    requestAnimationFrame(() => {
      fit.fit();
      term.focus();
      window.api.terminals.resize(terminalId, term.cols, term.rows)
        .catch((err) => reportError(err, 'Terminal initial resize'));
    });

    // Send user input to the daemon PTY
    const inputDisposable = term.onData((data) => {
      window.api.terminals.write(terminalId, data)
        .catch((err) => {
          reportError(err, 'Terminal write');
          term.write('\r\n\x1b[31m[Error: Failed to send input to terminal]\x1b[0m\r\n');
        });
    });

    // Receive output from daemon PTY
    const unsubOutput = window.api.on.terminalOutput((tid, data) => {
      if (tid === terminalId) {
        term.write(data);
      }
    });

    // Handle terminal exit
    const unsubExited = window.api.on.terminalExited((tid, { exitCode }) => {
      if (tid === terminalId) {
        term.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
      }
    });

    // Resize on window resize
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      inputDisposable.dispose();
      unsubOutput();
      unsubExited();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [terminalId, handleResize]);

  // Re-fit and auto-focus when visibility changes (e.g. navigating back to terminal page).
  // Uses resize dance to force shell redraw even if dimensions haven't changed.
  useEffect(() => {
    if (!visible) return;
    const fit = fitRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    requestAnimationFrame(() => {
      term.focus();
      try {
        fit.fit();
      } catch {
        return;
      }
      resizeDance(terminalId, term.cols, term.rows);
    });
  }, [visible, terminalId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: 200 }}
    />
  );
}
