import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import type { ChatSessionStatus, RunningAgent, ChatMessage } from '../../shared/types';
import { output, type OutputOptions } from '../output';

export function registerThreadsCommands(program: Command, api: ApiClient, daemonUrl?: string): void {
  const chat = program.command('threads').description('Thread chat diagnostics and interaction');

  // ── chat status ────────────────────────────────────────────────────
  chat
    .command('status')
    .description('Show status of all chat sessions with running agents')
    .option('--project <id>', 'Filter by project ID')
    .option('--all', 'Show all sessions, not just active ones')
    .action(async (cmdOpts: { project?: string; all?: boolean }) => {
      const opts = program.opts() as OutputOptions;

      const agents = await api.chat.getRunningAgents() as RunningAgent[];

      if (opts.json) {
        if (cmdOpts.all && cmdOpts.project) {
          const sessions = await api.chat.listAllForProject(cmdOpts.project) as Array<{ id: string; name: string; status: ChatSessionStatus }>;
          output({ agents, sessions }, opts);
        } else {
          output({ agents }, opts);
        }
        return;
      }

      if (agents.length === 0 && !cmdOpts.all) {
        console.log('No active chat agents.');
        return;
      }

      if (agents.length > 0) {
        console.log(`\n  Active agents (${agents.length}):\n`);
        for (const agent of agents) {
          let dbStatus: string;
          try {
            dbStatus = (await api.chat.getSessionStatus(agent.sessionId)).status;
          } catch {
            dbStatus = '(fetch failed)';
          }
          const mismatch = agent.status !== dbStatus ? '  ⚠ MISMATCH' : '';
          console.log(`  ${agent.sessionName}`);
          console.log(`    session:   ${agent.sessionId}`);
          console.log(`    memory:    ${agent.status}`);
          console.log(`    db:        ${dbStatus}${mismatch}`);
          console.log(`    project:   ${agent.projectName}`);
          console.log(`    started:   ${new Date(agent.startedAt).toLocaleTimeString()}`);
          console.log(`    activity:  ${new Date(agent.lastActivity).toLocaleTimeString()}`);
          console.log('');
        }
      }

      if (cmdOpts.all && cmdOpts.project) {
        const sessions = await api.chat.listAllForProject(cmdOpts.project) as Array<{ id: string; name: string; status: ChatSessionStatus }>;
        const nonIdle = sessions.filter(s => s.status !== 'idle');
        if (nonIdle.length > 0) {
          console.log(`  Non-idle sessions (${nonIdle.length}):\n`);
          for (const s of nonIdle) {
            console.log(`    ${s.name}  →  ${s.status}  (${s.id.slice(0, 8)})`);
          }
          console.log('');
        } else {
          console.log('  All sessions are idle.');
        }
      }
    });

  // ── chat session-status <id> ───────────────────────────────────────
  chat
    .command('session-status <sessionId>')
    .description('Show detailed status for a specific session')
    .action(async (sessionId: string) => {
      const opts = program.opts() as OutputOptions;

      const { status: dbStatus } = await api.chat.getSessionStatus(sessionId);
      const agents = await api.chat.getRunningAgents() as RunningAgent[];
      const agent = agents.find(a => a.sessionId === sessionId);

      const result = {
        sessionId,
        dbStatus,
        memoryStatus: agent?.status ?? null,
        agentRunning: !!agent,
        mismatch: agent ? agent.status !== dbStatus : false,
      };

      if (opts.json) {
        output(result, opts);
        return;
      }

      console.log(`\n  Session: ${sessionId}`);
      console.log(`  DB status:     ${dbStatus}`);
      console.log(`  Agent running: ${result.agentRunning}`);
      if (agent) {
        console.log(`  Memory status: ${agent.status}${result.mismatch ? '  ⚠ MISMATCH with DB' : ''}`);
      }
      console.log('');
    });

  // ── chat send <sessionId> <message> ────────────────────────────────
  chat
    .command('send <sessionId> <message>')
    .description('Send a message to a chat session and stream the response')
    .action(async (sessionId: string, message: string) => {
      const wsUrl = daemonUrl ? daemonUrl.replace(/^http/, 'ws') + '/ws' : undefined;
      if (!wsUrl) {
        console.error('WebSocket URL not available.');
        process.exitCode = 1;
        return;
      }

      // Subscribe to WS events BEFORE sending to catch all output
      const { createWsClient } = await import('../../client/ws-client');
      const { WS_CHANNELS } = await import('../../daemon/ws/channels');
      const ws = createWsClient(wsUrl);

      let done = false;

      // Listen for text output
      ws.subscribeGlobal(WS_CHANNELS.CHAT_OUTPUT, (id, data) => {
        if (id !== sessionId) return;
        process.stdout.write(data as string);
      });

      // Listen for status changes
      ws.subscribeGlobal(WS_CHANNELS.CHAT_SESSION_STATUS_CHANGED, (id, data) => {
        if (id !== sessionId) return;
        const { status } = data as { status: string };
        console.log(`\n[status: ${status}]`);
        if (status === 'idle' || status === 'completed' || status === 'failed' || status === 'error') {
          done = true;
        }
      });

      // Send the message
      try {
        console.log(`[sending to ${sessionId.slice(0, 8)}...]\n`);
        await api.chat.sendMessage(sessionId, message);
      } catch (err) {
        console.error(`Send failed: ${err instanceof Error ? err.message : String(err)}`);
        ws.close();
        process.exitCode = 1;
        return;
      }

      // Wait for completion (timeout after 10 minutes)
      const timeout = setTimeout(() => {
        console.log('\n[timeout: 10 minutes elapsed]');
        done = true;
      }, 600_000);

      while (!done) {
        await new Promise(r => setTimeout(r, 200));
      }

      clearTimeout(timeout);
      ws.close();
    });

  // ── chat stop <sessionId> ──────────────────────────────────────────
  chat
    .command('stop <sessionId>')
    .description('Stop a running chat agent')
    .action(async (sessionId: string) => {
      try {
        await api.chat.stopGeneration(sessionId);
        console.log(`Stopped agent for session ${sessionId.slice(0, 8)}`);
      } catch (err) {
        console.error(`Stop failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  // ── chat messages <sessionId> ──────────────────────────────────────
  chat
    .command('messages <sessionId>')
    .description('List messages in a session')
    .option('--limit <n>', 'Max messages', '20')
    .action(async (sessionId: string, cmdOpts: { limit: string }) => {
      const opts = program.opts() as OutputOptions;
      const messages = await api.chat.getMessages(sessionId) as ChatMessage[];
      const limit = parseInt(cmdOpts.limit, 10) || 20;
      const recent = messages.slice(-limit);

      if (opts.json) {
        output(recent, opts);
        return;
      }

      for (const msg of recent) {
        const time = new Date(msg.createdAt).toLocaleTimeString();
        const preview = msg.content.length > 120 ? msg.content.slice(0, 117) + '...' : msg.content;
        console.log(`  [${time}] ${msg.role}: ${preview}`);
      }
    });

  // ── chat watch <sessionId> ─────────────────────────────────────────
  chat
    .command('watch <sessionId>')
    .description('Watch real-time events for a session (Ctrl+C to stop)')
    .action(async (sessionId: string) => {
      const wsUrl = daemonUrl ? daemonUrl.replace(/^http/, 'ws') + '/ws' : undefined;
      if (!wsUrl) {
        console.error('WebSocket URL not available.');
        process.exitCode = 1;
        return;
      }

      const { createWsClient } = await import('../../client/ws-client');
      const { WS_CHANNELS } = await import('../../daemon/ws/channels');
      const ws = createWsClient(wsUrl);

      console.log(`Watching session ${sessionId.slice(0, 8)}... (Ctrl+C to stop)\n`);

      ws.subscribeGlobal(WS_CHANNELS.CHAT_OUTPUT, (id, data) => {
        if (id !== sessionId) return;
        console.log(`[output] ${(data as string).slice(0, 200)}`);
      });

      ws.subscribeGlobal(WS_CHANNELS.CHAT_MESSAGE, (id, data) => {
        if (id !== sessionId) return;
        const msg = data as { type: string; text?: string; toolName?: string };
        console.log(`[message] type=${msg.type}${msg.text ? ` text=${msg.text.slice(0, 100)}` : ''}${msg.toolName ? ` tool=${msg.toolName}` : ''}`);
      });

      ws.subscribeGlobal(WS_CHANNELS.CHAT_SESSION_STATUS_CHANGED, (id, data) => {
        if (id !== sessionId) return;
        const { status } = data as { status: string };
        console.log(`[STATUS CHANGED] → ${status}`);
      });

      ws.subscribeGlobal(WS_CHANNELS.CHAT_STREAM_DELTA, (id) => {
        if (id !== sessionId) return;
        process.stdout.write('.');
      });

      // Keep alive until Ctrl+C
      process.on('SIGINT', () => {
        console.log('\nStopped watching.');
        ws.close();
        process.exit(0);
      });

      // Keep the process alive
      await new Promise(() => {});
    });
}
