import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { ITaskStore } from '../interfaces/task-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import type { Task, Transition, TransitionContext, HookResult } from '../../shared/types';
import { getActivePhaseIndex, hasPendingPhases } from '../../shared/phase-utils';

export interface PhaseHandlerDeps {
  taskStore: ITaskStore;
  projectStore: IProjectStore;
  taskEventLog: ITaskEventLog;
  pipelineEngine: IPipelineEngine;
  createWorktreeManager: (projectPath: string) => IWorktreeManager;
}

export function registerPhaseHandler(engine: IPipelineEngine, deps: PhaseHandlerDeps): void {
  engine.registerHook('advance_phase', async (task: Task, _transition: Transition, _context: TransitionContext, _params?: Record<string, unknown>): Promise<HookResult> => {
    const log = (message: string, severity: 'info' | 'warning' | 'error' | 'debug' = 'info', data?: Record<string, unknown>) =>
      deps.taskEventLog.log({ taskId: task.id, category: 'system', severity, message, data });

    // No phases or no pending phases — no-op (single-phase or last phase)
    if (!task.phases || !hasPendingPhases(task.phases)) {
      await log('advance_phase: no pending phases — no-op', 'debug');
      return { success: true };
    }

    // Find the current in_progress phase and mark it completed
    const activeIdx = getActivePhaseIndex(task.phases);
    if (activeIdx < 0) {
      await log('advance_phase: no active phase found despite pending phases — unexpected state', 'warning');
      return { success: true };
    }

    const updatedPhases = [...task.phases];
    const completedPhase = updatedPhases[activeIdx];
    updatedPhases[activeIdx] = {
      ...completedPhase,
      status: 'completed',
      prLink: task.prLink ?? undefined,
    };

    await log(`advance_phase: marking phase "${completedPhase.name}" as completed`, 'info', {
      phaseId: completedPhase.id,
      phaseName: completedPhase.name,
      prLink: task.prLink,
    });

    // Find and activate the next pending phase
    const nextIdx = updatedPhases.findIndex(p => p.status === 'pending');
    if (nextIdx < 0) {
      // All phases completed — update and stay at done
      try {
        await deps.taskStore.updateTask(task.id, { phases: updatedPhases });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await log(`advance_phase: failed to persist completed phases: ${errMsg}`, 'error');
        return { success: false, error: `Failed to update phases: ${errMsg}` };
      }
      await log('advance_phase: all phases completed — task stays at done', 'info');
      return { success: true };
    }

    updatedPhases[nextIdx] = {
      ...updatedPhases[nextIdx],
      status: 'in_progress',
    };

    await log(`advance_phase: activating phase "${updatedPhases[nextIdx].name}"`, 'info', {
      phaseId: updatedPhases[nextIdx].id,
      phaseName: updatedPhases[nextIdx].name,
      phaseNumber: nextIdx + 1,
      totalPhases: updatedPhases.length,
    });

    // Clear task-level PR and branch for the new phase
    try {
      await deps.taskStore.updateTask(task.id, {
        phases: updatedPhases,
        prLink: null,
        branchName: null,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await log(`advance_phase: failed to persist phase update: ${errMsg}`, 'error');
      return { success: false, error: `Failed to update phases: ${errMsg}` };
    }

    // Delete worktree so the next phase gets a fresh branch
    try {
      const project = await deps.projectStore.getProject(task.projectId);
      if (project?.path) {
        const wm = deps.createWorktreeManager(project.path);
        try { await wm.unlock(task.id); } catch (unlockErr) {
          await log(`advance_phase: worktree unlock failed (expected if not locked): ${unlockErr instanceof Error ? unlockErr.message : String(unlockErr)}`, 'debug');
        }
        await wm.delete(task.id);
        await log('advance_phase: worktree deleted for fresh branch', 'debug');
      }
    } catch (err) {
      await log(`advance_phase: worktree cleanup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }

    // Trigger system transition done → implementing
    // We need the fresh task (with updated phases) for the pipeline engine
    try {
      const freshTask = await deps.taskStore.getTask(task.id);
      if (!freshTask) {
        await log('advance_phase: task not found after update', 'error');
        return { success: false, error: 'Task not found after phase update' };
      }
      const transitionResult = await deps.pipelineEngine.executeTransition(freshTask, 'implementing', {
        trigger: 'system',
        data: { reason: 'advance_phase', phaseId: updatedPhases[nextIdx].id },
      });
      if (transitionResult.success) {
        await log(`advance_phase: triggered done → implementing for phase ${nextIdx + 1}`, 'info');
      } else {
        await log(`advance_phase: done → implementing transition failed: ${transitionResult.error ?? 'unknown'}`, 'error');
        return { success: false, error: transitionResult.error ?? 'Transition failed' };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await log(`advance_phase: failed to trigger done → implementing: ${errMsg}`, 'error');
      return { success: false, error: errMsg };
    }

    return { success: true };
  });
}
