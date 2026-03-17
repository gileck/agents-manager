export interface AgentSubscription {
  sessionId: string;
  taskId: string;
  autoNotify: boolean;
  createdAt: number;
}

const MAX_SUBSCRIPTIONS_PER_SESSION = 50;

/** Terminal task statuses that trigger subscription cleanup. */
const TERMINAL_STATUSES = new Set(['done', 'closed', 'cancelled']);

export class AgentSubscriptionRegistry {
  private subscriptions = new Map<string, AgentSubscription[]>();

  subscribe(sub: AgentSubscription): void {
    const existing = this.subscriptions.get(sub.taskId) ?? [];
    if (!existing.some(s => s.sessionId === sub.sessionId)) {
      // Enforce per-session cap to prevent abuse
      let sessionCount = 0;
      for (const subs of this.subscriptions.values()) {
        for (const s of subs) {
          if (s.sessionId === sub.sessionId) sessionCount++;
        }
      }
      if (sessionCount >= MAX_SUBSCRIPTIONS_PER_SESSION) {
        throw new Error(`Subscription limit reached: max ${MAX_SUBSCRIPTIONS_PER_SESSION} active subscriptions per session`);
      }
      existing.push(sub);
      this.subscriptions.set(sub.taskId, existing);
    }
  }

  /** Returns all subscribers for a task without removing them (persistent). */
  get(taskId: string): AgentSubscription[] {
    return this.subscriptions.get(taskId) ?? [];
  }

  /** Removes all subscriptions for a task (call when task reaches a terminal state). */
  removeTask(taskId: string): void {
    this.subscriptions.delete(taskId);
  }

  hasSubscribers(taskId: string): boolean {
    return (this.subscriptions.get(taskId)?.length ?? 0) > 0;
  }

  /** Returns true if the given status is terminal (done, closed, cancelled). */
  static isTerminalStatus(status: string): boolean {
    return TERMINAL_STATUSES.has(status);
  }

  dispose(): void {
    // no-op — kept for interface compatibility
  }
}
