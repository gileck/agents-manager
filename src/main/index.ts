import { app, dialog, Tray } from 'electron';
import { initializeApp } from '@template/main/core/app';
import { createTray, buildStandardMenu } from '@template/main/core/tray';
import { sendToRenderer } from '@template/main/core/window';
import { registerIpcHandlers } from './ipc-handlers';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { createApiClient, createWsClient } from '../client';
import { ensureDaemon } from './daemon-launcher';
import { initShellEnv } from '../shared/shell-env';
import { WS_CHANNELS } from '../daemon/ws/channels';
import type { WsClient } from '../client';

// Keep a global reference to prevent garbage collection
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tray: Tray | null = null;
let wsClient: WsClient | null = null;

// Set app name so userData path is ~/Library/Application Support/agents-manager/
app.setName('agents-manager');

// Initialize app with template framework
initializeApp({
  singleInstance: true,
  onReady: async () => {
    try {
      // Pre-warm shell PATH cache so synchronous getShellEnv() calls are instant
      await initShellEnv();

      // Auto-start daemon if not running
      const { url: daemonUrl, wsUrl: daemonWsUrl } = await ensureDaemon();

      // Create the API client to delegate IPC calls to the daemon
      const api = createApiClient(daemonUrl);

      // Register IPC handlers (thin wrappers around the API client)
      registerIpcHandlers(api);

      // Set up WebSocket client for real-time event forwarding
      wsClient = createWsClient(daemonWsUrl, { reconnect: true });

      // Forward daemon WS events to the Electron renderer
      wsClient.subscribeGlobal(WS_CHANNELS.AGENT_OUTPUT, (taskId, data) =>
        sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, taskId, data));
      wsClient.subscribeGlobal(WS_CHANNELS.AGENT_MESSAGE, (taskId, data) =>
        sendToRenderer(IPC_CHANNELS.AGENT_MESSAGE, taskId, data));
      wsClient.subscribeGlobal(WS_CHANNELS.AGENT_STATUS, (taskId, data) =>
        sendToRenderer(IPC_CHANNELS.AGENT_STATUS, taskId, data));
      wsClient.subscribeGlobal(WS_CHANNELS.AGENT_INTERRUPTED_RUNS, (_id, data) =>
        sendToRenderer(IPC_CHANNELS.AGENT_INTERRUPTED_RUNS, data));
      wsClient.subscribeGlobal(WS_CHANNELS.CHAT_OUTPUT, (sessionId, data) =>
        sendToRenderer(IPC_CHANNELS.CHAT_OUTPUT, sessionId, data));
      wsClient.subscribeGlobal(WS_CHANNELS.CHAT_MESSAGE, (sessionId, data) =>
        sendToRenderer(IPC_CHANNELS.CHAT_MESSAGE, sessionId, data));
      wsClient.subscribeGlobal(WS_CHANNELS.TASK_CHAT_OUTPUT, (sessionId, data) =>
        sendToRenderer(IPC_CHANNELS.TASK_CHAT_OUTPUT, sessionId, data));
      wsClient.subscribeGlobal(WS_CHANNELS.TASK_CHAT_MESSAGE, (sessionId, data) =>
        sendToRenderer(IPC_CHANNELS.TASK_CHAT_MESSAGE, sessionId, data));
      wsClient.subscribeGlobal(WS_CHANNELS.TELEGRAM_BOT_LOG, (projectId, data) =>
        sendToRenderer(IPC_CHANNELS.TELEGRAM_BOT_LOG, projectId, data));
      wsClient.subscribeGlobal(WS_CHANNELS.TELEGRAM_BOT_STATUS_CHANGED, (projectId, data) =>
        sendToRenderer(IPC_CHANNELS.TELEGRAM_BOT_STATUS_CHANGED, projectId, data));
      wsClient.subscribeGlobal(WS_CHANNELS.NAVIGATE, (_id, data) =>
        sendToRenderer(IPC_CHANNELS.NAVIGATE, data));
      wsClient.subscribeGlobal(WS_CHANNELS.MAIN_DIVERGED, (_id, data) =>
        sendToRenderer(IPC_CHANNELS.MAIN_DIVERGED, data));
      wsClient.subscribeGlobal(WS_CHANNELS.CHAT_SESSION_RENAMED, (sessionId, data) =>
        sendToRenderer(IPC_CHANNELS.CHAT_SESSION_RENAMED, sessionId, data));
      wsClient.subscribeGlobal(WS_CHANNELS.NOTIFICATION_ADDED, (_id, data) =>
        sendToRenderer(IPC_CHANNELS.NOTIFICATION_ADDED, data));

      // Create the tray icon with a simple menu
      tray = createTray({
        title: '\u{1F4DD}',
        tooltip: 'Agents Manager',
        menuBuilder: () => buildStandardMenu('Agents Manager'),
      });
    } catch (err) {
      console.error('Fatal: onReady failed:', err);
      dialog.showErrorBox(
        'Agents Manager \u2014 Startup Failed',
        `Initialization failed:\n${err instanceof Error ? err.message : String(err)}`,
      );
      throw err; // Re-throw to prevent creating a broken window
    }
  },
  onBeforeQuit: () => {
    if (wsClient) {
      wsClient.close();
      wsClient = null;
    }
  },
});
