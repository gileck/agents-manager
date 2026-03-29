/**
 * Manages node-pty terminal instances for the in-app terminal feature.
 * Each terminal is identified by a UUID and relays I/O over WebSocket.
 */

import { randomUUID } from 'crypto';
import type * as ptyModule from 'node-pty';
import type { TerminalSession } from '../shared/types';
import type { DaemonWsServer } from './ws/ws-server';
import { WS_CHANNELS } from './ws/channels';

// Lazy-load node-pty to avoid crashes if native module isn't built
let pty: typeof ptyModule | null = null;
function getPty(): typeof ptyModule {
  if (!pty) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pty = require('node-pty') as typeof ptyModule;
    } catch (err) {
      const msg = 'Terminal support unavailable: native node-pty module failed to load. '
        + 'Run "yarn postinstall" to rebuild native modules.';
      console.error('[TerminalManager] node-pty load failed:', err);
      throw Object.assign(new Error(msg), { status: 503 });
    }
  }
  return pty;
}

interface ManagedTerminal {
  session: TerminalSession;
  process: ptyModule.IPty;
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private wsHolder: { server?: DaemonWsServer };

  constructor(wsHolder: { server?: DaemonWsServer }) {
    this.wsHolder = wsHolder;
  }

  create(projectId: string, name: string, cwd: string): TerminalSession {
    const id = randomUUID();
    const shell = process.env.SHELL || '/bin/zsh';
    const nodePty = getPty();

    let proc: ptyModule.IPty;
    try {
      proc = nodePty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        } as Record<string, string>,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw Object.assign(
        new Error(`Failed to create terminal: ${errMsg}. Shell="${shell}", cwd="${cwd}"`),
        { status: 400 },
      );
    }

    const session: TerminalSession = {
      id,
      projectId,
      name,
      cwd,
      status: 'running',
      exitCode: null,
      createdAt: Date.now(),
    };

    const managed: ManagedTerminal = { session, process: proc };
    this.terminals.set(id, managed);

    // Relay output to WS subscribers
    proc.onData((data) => {
      this.wsHolder.server?.broadcast(WS_CHANNELS.TERMINAL_OUTPUT, id, data);
    });

    proc.onExit(({ exitCode }) => {
      managed.session.status = 'exited';
      managed.session.exitCode = exitCode;
      this.wsHolder.server?.broadcast(WS_CHANNELS.TERMINAL_EXITED, id, { exitCode });
    });

    return session;
  }

  list(): TerminalSession[] {
    return Array.from(this.terminals.values()).map((m) => m.session);
  }

  write(terminalId: string, data: string): void {
    const managed = this.terminals.get(terminalId);
    if (!managed) throw new Error(`Terminal ${terminalId} not found`);
    if (managed.session.status === 'exited') {
      throw Object.assign(new Error(`Terminal ${terminalId} has exited`), { status: 400 });
    }
    managed.process.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const managed = this.terminals.get(terminalId);
    if (!managed) throw new Error(`Terminal ${terminalId} not found`);
    if (managed.session.status === 'exited') return;
    managed.process.resize(cols, rows);
  }

  close(terminalId: string): void {
    const managed = this.terminals.get(terminalId);
    if (!managed) return;
    try {
      managed.process.kill();
    } catch (err) {
      console.error(`[TerminalManager] kill() failed for terminal ${terminalId}:`, err);
    }
    this.terminals.delete(terminalId);
  }

  /** Kill all terminals — call on daemon shutdown */
  disposeAll(): void {
    for (const [id] of this.terminals) {
      try {
        this.close(id);
      } catch (err) {
        console.error(`[TerminalManager] disposeAll: failed to close terminal ${id}:`, err);
      }
    }
  }
}
