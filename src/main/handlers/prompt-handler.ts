import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IPendingPromptStore } from '../interfaces/pending-prompt-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { Task, Transition, TransitionContext, HookResult } from '../../shared/types';

export interface PromptHandlerDeps {
  pendingPromptStore: IPendingPromptStore;
  taskEventLog: ITaskEventLog;
}

export function registerPromptHandler(engine: IPipelineEngine, deps: PromptHandlerDeps): void {
  engine.registerHook('create_prompt', async (task: Task, transition: Transition, context: TransitionContext, params?: Record<string, unknown>): Promise<HookResult> => {
    const resumeOutcome = params?.resumeOutcome as string | undefined;
    const data = context.data as { agentRunId?: string; payload?: Record<string, unknown> } | undefined;
    if (!data?.agentRunId) {
      throw new Error(`create_prompt hook on ${transition.from} → ${transition.to}: agentRunId missing from transition context`);
    }

    await deps.pendingPromptStore.createPrompt({
      taskId: task.id,
      agentRunId: data.agentRunId,
      promptType: transition.agentOutcome ?? 'prompt',
      payload: { ...data?.payload, resumeToStatus: transition.from },
      resumeOutcome,
    });

    await deps.taskEventLog.log({
      taskId: task.id,
      category: 'agent',
      severity: 'info',
      message: `Prompt created via hook (type: ${transition.agentOutcome ?? 'prompt'}, resumeOutcome: ${resumeOutcome ?? 'none'})`,
      data: { resumeOutcome, agentOutcome: transition.agentOutcome },
    });

    return { success: true };
  });
}
