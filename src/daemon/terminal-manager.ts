/**
 * Manages node-pty terminal instances for the in-app terminal feature.
 *
 * Two terminal types:
 * - 'blank': ephemeral shell, not persisted to DB
 * - 'claude': spawns `claude --session-id <uuid>`, persisted to DB,
 *   resumed with `claude --resume <sessionId>` on daemon restart
 */

import { randomUUID } from 'crypto';
import type * as ptyModule from 'node-pty';
import type { TerminalSession, TerminalType } from '../shared/types';
import type { ITerminalStore } from '../core/interfaces/terminal-store';
import type { DaemonWsServer } from './ws/ws-server';
import { WS_CHANNELS } from './ws/channels';

/** Batch PTY output at ~60fps to avoid flooding WS during high-throughput AI output */
const BATCH_INTERVAL_MS = 16;

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
  pendingData: string;
  batchTimer: ReturnType<typeof setTimeout> | null;
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private wsHolder: { server?: DaemonWsServer };
  private terminalStore: ITerminalStore | null;

  constructor(wsHolder: { server?: DaemonWsServer }, terminalStore?: ITerminalStore) {
    this.wsHolder = wsHolder;
    this.terminalStore = terminalStore ?? null;
  }

  /** Restore persisted Claude terminals from DB on daemon startup. */
  async restoreFromDb(): Promise<void> {
    if (!this.terminalStore) return;
    const saved = await this.terminalStore.listTerminals();
    for (const t of saved) {
      if (t.type !== 'claude' || !t.claudeSessionId) continue;
      try {
        this.spawnPty(t.id, t.projectId, t.name, t.cwd, 'claude', t.claudeSessionId, true);
        console.log(`[TerminalManager] Restored claude terminal ${t.id}`);
      } catch (err) {
        console.error(`[TerminalManager] Failed to restore terminal ${t.id}:`, err);
        await this.terminalStore.deleteTerminal(t.id).catch(() => {});
      }
    }
  }

  async create(projectId: string, name: string, cwd: string, type: TerminalType): Promise<TerminalSession> {
    const id = randomUUID();
    const claudeSessionId = type === 'claude' ? randomUUID() : null;

    const session = this.spawnPty(id, projectId, name, cwd, type, claudeSessionId, false);

    // Persist claude terminals to DB
    if (type === 'claude' && this.terminalStore) {
      await this.terminalStore.createTerminal({
        id, projectId, name, cwd, type, claudeSessionId: claudeSessionId ?? undefined,
      });
    }

    return session;
  }

  private spawnPty(
    id: string, projectId: string, name: string, cwd: string,
    type: TerminalType, claudeSessionId: string | null, isResume: boolean,
  ): TerminalSession {
    const nodePty = getPty();

    let command: string;
    let args: string[];
    if (type === 'claude' && claudeSessionId) {
      command = 'claude';
      args = isResume
        ? ['--resume', claudeSessionId]
        : ['--session-id', claudeSessionId];
    } else {
      command = process.env.SHELL || '/bin/zsh';
      args = [];
    }

    let proc: ptyModule.IPty;
    try {
      proc = nodePty.spawn(command, args, {
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
        new Error(`Failed to create terminal: ${errMsg}. Command="${command}", cwd="${cwd}"`),
        { status: 400 },
      );
    }

    const session: TerminalSession = {
      id, projectId, name, cwd, type, claudeSessionId,
      status: 'running', exitCode: null, createdAt: Date.now(),
    };

    const managed: ManagedTerminal = { session, process: proc, pendingData: '', batchTimer: null };
    this.terminals.set(id, managed);

    proc.onData((data) => {
      managed.pendingData += data;
      if (!managed.batchTimer) {
        managed.batchTimer = setTimeout(() => this.flushOutput(id), BATCH_INTERVAL_MS);
      }
    });

    proc.onExit(({ exitCode }) => {
      this.flushOutput(id);
      managed.session.status = 'exited';
      managed.session.exitCode = exitCode;
      this.wsHolder.server?.broadcast(WS_CHANNELS.TERMINAL_EXITED, id, { exitCode });
    });

    return session;
  }

  private flushOutput(terminalId: string): void {
    const managed = this.terminals.get(terminalId);
    if (!managed) return;
    if (managed.batchTimer) { clearTimeout(managed.batchTimer); managed.batchTimer = null; }
    if (managed.pendingData) {
      const data = managed.pendingData;
      managed.pendingData = '';
      this.wsHolder.server?.broadcast(WS_CHANNELS.TERMINAL_OUTPUT, terminalId, data);
    }
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

  async close(terminalId: string): Promise<void> {
    const managed = this.terminals.get(terminalId);
    if (!managed) return;
    if (managed.batchTimer) { clearTimeout(managed.batchTimer); managed.batchTimer = null; }
    try { managed.process.kill(); } catch (err) {
      console.error(`[TerminalManager] kill() failed for terminal ${terminalId}:`, err);
    }
    this.terminals.delete(terminalId);
    if (this.terminalStore) {
      await this.terminalStore.deleteTerminal(terminalId).catch((err) => {
        console.error(`[TerminalManager] DB delete failed for ${terminalId}:`, err);
      });
    }
  }

  /** Kill all terminals — call on daemon shutdown. Does NOT delete from DB (so claude terminals can be restored). */
  disposeAll(): void {
    for (const [, managed] of this.terminals) {
      if (managed.batchTimer) { clearTimeout(managed.batchTimer); managed.batchTimer = null; }
      try { managed.process.kill(); } catch (err) {
        console.error(`[TerminalManager] disposeAll failed:`, err);
      }
    }
    this.terminals.clear();
  }
}
