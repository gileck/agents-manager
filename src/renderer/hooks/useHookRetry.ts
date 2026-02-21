import { useState, useCallback } from 'react';
import type { HookRetryResult } from '../../shared/types';

export function useHookRetry() {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<HookRetryResult | null>(null);

  const retry = useCallback(async (
    taskId: string,
    hookName: string,
    transitionFrom?: string,
    transitionTo?: string,
  ): Promise<HookRetryResult> => {
    setRetrying(hookName);
    setLastResult(null);
    try {
      const result = await window.api.tasks.hookRetry(taskId, hookName, transitionFrom, transitionTo);
      setLastResult(result);
      return result;
    } catch (err) {
      const result: HookRetryResult = {
        success: false,
        hookName,
        error: err instanceof Error ? err.message : 'Retry failed',
      };
      setLastResult(result);
      return result;
    } finally {
      setRetrying(null);
    }
  }, []);

  return { retry, retrying, lastResult };
}
