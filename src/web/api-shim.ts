/**
 * Web API shim — implements the same ApiShape interface used by the
 * Electron preload bridge, but using direct HTTP (ApiClient) and
 * browser-native WebSocket for push events.
 *
 * Set `window.api = createWebApiShim(...)` before mounting React.
 */

import { createApiClient } from '../client/api-client';
import { createBrowserWsClient } from './ws-browser-client';
import { WS_CHANNELS } from '../daemon/ws/channels';
import type { ApiShape } from '../shared/api-shape';
import type {
  AgentChatMessage, AgentRun, AgentRunStatus,
  ChatSession, InAppNotification, TelegramBotLogEntry,
  DevServerInfo, Task, AgentNotificationPayload,
} from '../shared/types';

export function createWebApiShim(daemonUrl: string, daemonWsUrl: string): ApiShape {
  const api = createApiClient(daemonUrl);
  const ws = createBrowserWsClient(daemonWsUrl, { reconnect: true });

  return {
    // ── Items ──────────────────────────────────────────────────────────
    items: {
      list: () => api.items.list(),
      get: (id) => api.items.get(id),
      create: (input) => api.items.create(input),
      update: (id, input) => api.items.update(id, input),
      delete: (id) => api.items.delete(id).then(() => true),
    },

    // ── Settings ──────────────────────────────────────────────────────
    settings: {
      get: () => api.settings.get(),
      update: (updates) => api.settings.update(updates),
    },

    // ── App ───────────────────────────────────────────────────────────
    app: {
      getVersion: () => api.app.getVersion(),
    },

    // ── Projects ──────────────────────────────────────────────────────
    projects: {
      list: () => api.projects.list(),
      get: (id) => api.projects.get(id),
      create: (input) => api.projects.create(input),
      update: (id, input) => api.projects.update(id, input),
      delete: (id) => api.projects.delete(id).then(() => true),
    },

    // ── Tasks ─────────────────────────────────────────────────────────
    tasks: {
      list: (filter?) => api.tasks.list(filter),
      get: (id) => api.tasks.get(id),
      create: (input) => api.tasks.create(input),
      update: (id, input) => api.tasks.update(id, input),
      delete: (id) => api.tasks.delete(id).then(() => true),
      reset: (id, pipelineId?) => api.tasks.reset(id, pipelineId),
      transition: (taskId, toStatus, actor?) => api.tasks.transition(taskId, toStatus, actor) as Promise<never>,
      transitions: (taskId) => api.tasks.getTransitions(taskId) as Promise<never>,
      dependencies: (taskId) => api.tasks.getDependencies(taskId) as Promise<never>,
      dependents: (taskId) => api.tasks.getDependents(taskId) as Promise<never>,
      addDependency: (taskId, depId) => api.tasks.addDependency(taskId, depId) as Promise<never>,
      removeDependency: (taskId, depId) => api.tasks.removeDependency(taskId, depId),
      allTransitions: (taskId) => api.tasks.getAllTransitions(taskId) as Promise<never>,
      forceTransition: (taskId, toStatus, actor?) => api.tasks.forceTransition(taskId, toStatus, actor) as Promise<never>,
      guardCheck: (taskId, toStatus, trigger) => api.tasks.guardCheck(taskId, toStatus, trigger as string) as Promise<never>,
      hookRetry: (taskId, hookName, from?, to?) => api.tasks.retryHook(taskId, hookName, from, to) as Promise<never>,
      pipelineDiagnostics: (taskId) => api.tasks.getPipelineDiagnostics(taskId) as Promise<never>,
      advancePhase: (taskId) => api.tasks.advancePhase(taskId) as Promise<never>,
      dismissEvent: (taskId, eventId) => api.tasks.dismissEvent(taskId, eventId),
      contextEntries: (taskId) => api.tasks.getContext(taskId) as Promise<never>,
      addContextEntry: (taskId, input) => api.tasks.addContext(taskId, input) as Promise<never>,
      addFeedback: (taskId, input) => api.tasks.addFeedback(taskId, input) as Promise<never>,
      debugTimeline: (taskId) => api.tasks.getTimeline(taskId) as Promise<never>,
      worktree: (taskId) => api.tasks.getWorktree(taskId) as Promise<never>,
      workflowReview: (taskId) => api.agents.workflowReview(taskId) as Promise<never>,
      postMortem: (taskId, input?) => api.agents.postMortem(taskId, input) as Promise<never>,
    },

    // ── Features ──────────────────────────────────────────────────────
    features: {
      list: (filter?) => api.features.list(filter),
      get: (id) => api.features.get(id),
      create: (input) => api.features.create(input),
      update: (id, input) => api.features.update(id, input),
      delete: (id) => api.features.delete(id).then(() => true),
    },

    // ── Kanban Boards ─────────────────────────────────────────────────
    kanbanBoards: {
      get: (id) => api.kanban.getBoard(id) as Promise<never>,
      getByProject: (projectId) => api.kanban.getBoardByProject(projectId) as Promise<never>,
      list: (projectId) => api.kanban.listBoards(projectId) as Promise<never>,
      create: (input) => api.kanban.createBoard(input) as Promise<never>,
      update: (id, input) => api.kanban.updateBoard(id, input) as Promise<never>,
      delete: (id) => api.kanban.deleteBoard(id).then(() => true),
    },

    // ── Agent Definitions ─────────────────────────────────────────────
    agentDefinitions: {
      list: () => api.agentDefinitions.list() as Promise<never>,
      get: (id) => api.agentDefinitions.get(id) as Promise<never>,
      create: (input) => api.agentDefinitions.create(input) as Promise<never>,
      update: (id, input) => api.agentDefinitions.update(id, input) as Promise<never>,
      delete: (id) => api.agentDefinitions.delete(id).then(() => true),
    },

    // ── Agent Libs ────────────────────────────────────────────────────
    agentLibs: {
      list: () => api.agentDefinitions.listLibs() as Promise<never>,
      listModels: () => api.agentDefinitions.listModels() as Promise<never>,
      listFeatures: () => api.agentDefinitions.listFeatures() as Promise<never>,
    },

    // ── Pipelines ─────────────────────────────────────────────────────
    pipelines: {
      list: () => api.pipelines.list(),
      get: (id) => api.pipelines.get(id),
    },

    // ── Agents ────────────────────────────────────────────────────────
    agents: {
      start: (taskId, mode, agentType) => api.agents.start(taskId, mode, agentType) as Promise<never>,
      stop: (runId) => api.agents.stop('_', runId) as Promise<never>,
      runs: (taskId) => api.agents.runs(taskId) as Promise<never>,
      get: (runId) => api.agents.getRun(runId) as Promise<never>,
      activeTaskIds: () => api.agents.getActiveTaskIds(),
      activeRuns: () => api.agents.getActiveRuns() as Promise<never>,
      allRuns: () => api.agents.getAllRuns() as Promise<never>,
      sendMessage: (taskId, message) => api.agents.message(taskId, message) as Promise<never>,
      computeDiagnostics: (runId) => api.agents.computeDiagnostics(runId) as Promise<never>,
    },

    // ── Events ────────────────────────────────────────────────────────
    events: {
      list: (filter?) => api.events.list(filter) as Promise<never>,
    },

    // ── Activity ──────────────────────────────────────────────────────
    activity: {
      list: (filter?) => api.events.listActivities(filter) as Promise<never>,
    },

    // ── Prompts ───────────────────────────────────────────────────────
    prompts: {
      list: (taskId) => api.prompts.getPending(taskId) as Promise<never>,
      respond: (promptId, response) => api.prompts.respond(promptId, response) as Promise<never>,
    },

    // ── Artifacts ─────────────────────────────────────────────────────
    artifacts: {
      list: (taskId) => api.tasks.getArtifacts(taskId) as Promise<never>,
    },

    // ── Git ───────────────────────────────────────────────────────────
    git: {
      diff: (taskId) => api.git.getDiff(taskId).then(r => r?.diff ?? null),
      stat: (taskId) => api.git.getStat(taskId).then((r: unknown) => {
        if (!r) return null;
        return (r as { stat: string }).stat ?? null;
      }),
      workingDiff: (taskId) => api.git.getWorkingDiff(taskId).then(r => r?.diff ?? null),
      status: (taskId) => api.git.getStatus(taskId).then(r => r?.status ?? null),
      resetFile: (taskId, filepath) => api.git.resetFile(taskId, filepath) as Promise<never>,
      clean: (taskId) => api.git.clean(taskId) as Promise<never>,
      pull: (taskId) => api.git.pull(taskId) as Promise<never>,
      log: (taskId) => api.git.getLog(taskId) as Promise<never>,
      show: (taskId, hash) => api.git.showCommit(taskId, hash) as Promise<never>,
      prChecks: (taskId) => api.git.getPRChecks(taskId),
      projectLog: (projectId, count?) => api.git.getProjectLog(projectId, count) as Promise<never>,
      branch: (projectId) => api.git.getProjectBranch(projectId).then(r => r.branch),
      commitDetail: (projectId, hash) => api.git.getProjectCommit(projectId, hash) as Promise<never>,
      syncMain: (projectId) => api.git.syncMain(projectId),
    },

    // ── Dashboard ─────────────────────────────────────────────────────
    dashboard: {
      stats: () => api.dashboard.getStats() as Promise<never>,
    },

    // ── Debug Logs ────────────────────────────────────────────────────
    debugLogs: {
      list: (filter?) => api.debugLogs.list(filter),
      clear: (olderThanMs?) => api.debugLogs.clear(olderThanMs),
    },

    // ── Telegram ──────────────────────────────────────────────────────
    telegram: {
      test: (botToken, chatId) => api.telegram.test(botToken, chatId) as Promise<never>,
      startBot: (projectId) => api.telegram.start(projectId) as Promise<never>,
      stopBot: (projectId) => api.telegram.stop(projectId) as Promise<never>,
      botStatus: (projectId) => api.telegram.getStatus(projectId),
      botSession: (projectId) => api.telegram.getSession(projectId).then(r => (r as { sessionId: string | null }).sessionId),
    },

    // ── Chat ──────────────────────────────────────────────────────────
    chat: {
      send: (sessionId, message, images?) => api.chat.sendMessage(sessionId, message, images) as Promise<never>,
      stop: (sessionId) => api.chat.stopGeneration(sessionId) as Promise<never>,
      messages: (sessionId) => api.chat.getMessages(sessionId) as Promise<never>,
      clear: (sessionId) => api.chat.clearMessages(sessionId) as Promise<never>,
      summarize: (sessionId) => api.chat.summarizeMessages(sessionId) as Promise<never>,
      costs: () => api.chat.getCosts() as Promise<never>,
      chatLiveMessages: (sessionId) => api.chat.getLiveMessages(sessionId) as Promise<never>,
      permissionResponse: (sessionId, requestId, allowed) => api.chat.sendPermissionResponse(sessionId, requestId, allowed),
      trackedTasks: (sessionId) => api.chat.getTrackedTasks(sessionId),
      trackTask: (sessionId, taskId) => api.chat.trackTask(sessionId, taskId),
      untrackTask: (sessionId, taskId) => api.chat.untrackTask(sessionId, taskId),
      answerQuestion: (sessionId, questionId, answers) => api.chat.answerQuestion(sessionId, questionId, answers),
    },

    // ── Chat Sessions ─────────────────────────────────────────────────
    chatSession: {
      create: (scopeType, scopeId, name, agentLib?) =>
        api.chat.createSession({ scopeType, scopeId, name, agentLib }) as Promise<never>,
      list: (scopeType, scopeId) => api.chat.listSessions(scopeType, scopeId) as Promise<never>,
      listTaskSessions: (projectId) => api.chat.listTaskSessionsForProject(projectId),
      listAll: (projectId) => api.chat.listAllForProject(projectId) as Promise<never>,
      update: (sessionId, input) => api.chat.updateSession(sessionId, input) as Promise<never>,
      delete: (sessionId) => api.chat.deleteSession(sessionId).then(() => true),
      hide: (sessionId) => api.chat.hideSession(sessionId).then(() => true),
      hideAll: (projectId) => api.chat.hideAllSessions(projectId).then(() => true),
      getAgentChatSession: (taskId, agentRole) =>
        api.chat.getAgentChatSession(taskId, agentRole) as Promise<never>,
      listAgents: () => api.chat.getRunningAgents() as Promise<never>,
    },

    // ── Automated Agents ──────────────────────────────────────────────
    automatedAgents: {
      list: (projectId?) => api.automatedAgents.list(projectId),
      get: (id) => api.automatedAgents.get(id),
      create: (input) => api.automatedAgents.create(input),
      update: (id, input) => api.automatedAgents.update(id, input),
      delete: (id) => api.automatedAgents.delete(id).then(() => true),
      trigger: (id) => api.automatedAgents.trigger(id),
      getRuns: (id, limit?) => api.automatedAgents.getRuns(id, limit),
      listTemplates: () => api.automatedAgents.listTemplates(),
    },

    // ── Notifications ─────────────────────────────────────────────────
    notifications: {
      list: (filter?) => api.notifications.list(filter),
      markRead: (id) => api.notifications.markRead(id),
      markAllRead: (projectId?) => api.notifications.markAllRead(projectId),
      getUnreadCount: (projectId?) => api.notifications.getUnreadCount(projectId),
    },

    // ── Dev Servers ────────────────────────────────────────────────────
    devServers: {
      start: (taskId) => api.devServers.start(taskId),
      stop: (taskId) => api.devServers.stop(taskId),
      status: (taskId) => api.devServers.status(taskId),
      list: () => api.devServers.list(),
    },

    // ── Screenshots ────────────────────────────────────────────────────
    screenshots: {
      save: (images) => api.screenshots.save(images),
    },

    // ── Shell ─────────────────────────────────────────────────────────
    shell: {
      openInChrome: (url) => api.shell.openInChrome(url),
      openInIterm: (dirPath) => api.shell.openInIterm(dirPath),
      openInVscode: (dirPath) => api.shell.openInVscode(dirPath),
      openFileInVscode: (filePath, line?) => api.shell.openFileInVscode(filePath, line),
    },

    // ── Dialog ────────────────────────────────────────────────────────
    dialog: {
      pickFolder: () => api.shell.pickFolder(),
    },

    // ── Push Events (via browser WebSocket) ───────────────────────────
    on: {
      navigate: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.NAVIGATE, (_id, data) =>
          callback(data as string)),

      agentOutput: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.AGENT_OUTPUT, (taskId, data) =>
          callback(taskId as string, data as string)),

      agentInterruptedRuns: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.AGENT_INTERRUPTED_RUNS, (_id, data) =>
          callback(data as AgentRun[])),

      agentMessage: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.AGENT_MESSAGE, (taskId, data) =>
          callback(taskId as string, data as AgentChatMessage)),

      agentStatus: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.AGENT_STATUS, (taskId, data) =>
          callback(taskId as string, data as AgentRunStatus)),

      chatOutput: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.CHAT_OUTPUT, (sessionId, data) =>
          callback(sessionId as string, data as string)),

      chatMessage: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.CHAT_MESSAGE, (sessionId, data) =>
          callback(sessionId as string, data as AgentChatMessage)),

      chatStreamDelta: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.CHAT_STREAM_DELTA, (sessionId, data) =>
          callback(sessionId as string, data as AgentChatMessage)),

      taskChatOutput: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.TASK_CHAT_OUTPUT, (sessionId, data) =>
          callback(sessionId as string, data as string)),

      taskChatMessage: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.TASK_CHAT_MESSAGE, (sessionId, data) =>
          callback(sessionId as string, data as AgentChatMessage)),

      telegramBotLog: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.TELEGRAM_BOT_LOG, (projectId, data) =>
          callback(projectId as string, data as TelegramBotLogEntry)),

      telegramBotStatusChanged: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.TELEGRAM_BOT_STATUS_CHANGED, (projectId, data) =>
          callback(projectId as string, data as string)),

      mainDiverged: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.MAIN_DIVERGED, (_id, data) =>
          callback(data as { projectId: string })),

      chatSessionRenamed: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.CHAT_SESSION_RENAMED, (sessionId, data) =>
          callback(sessionId as string, data as ChatSession)),

      notificationAdded: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.NOTIFICATION_ADDED, (_id, data) =>
          callback(data as InAppNotification)),

      devServerLog: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.DEV_SERVER_LOG, (taskId, data) =>
          callback(taskId as string, data as { line: string })),

      devServerStatus: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.DEV_SERVER_STATUS, (taskId, data) =>
          callback(taskId as string, data as DevServerInfo)),

      taskStatusChanged: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.TASK_STATUS_CHANGED, (taskId, data) =>
          callback(taskId as string, data as Task)),

      taskDeleted: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.TASK_DELETED, (taskId) =>
          callback(taskId as string)),

      chatPermissionRequest: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.CHAT_PERMISSION_REQUEST, (sessionId, data) =>
          callback(sessionId as string, data as AgentChatMessage)),

      chatAgentNotification: (callback) =>
        ws.subscribeGlobal(WS_CHANNELS.CHAT_AGENT_NOTIFICATION, (sessionId, data) =>
          callback(sessionId as string, data as AgentNotificationPayload)),
    },
  };
}
