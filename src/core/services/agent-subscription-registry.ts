export interface AgentSubscription {
  sessionId: string;
  taskId: string;
  autoNotify: boolean;
  createdAt: number;
}

const MAX_SUBSCRIPTIONS_PER_SESSION = 50;

export class AgentSubscriptionRegistry {
  private subscriptions = new Map<string, AgentSubscription[]>();
  private cleanupTimer: ReturnType<typeof setInterval>;
  private readonly ttlMs: number;

  constructor(ttlMs = 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

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

  /** Returns and removes all subscribers for a task (single-fire). */
  getAndRemove(taskId: string): AgentSubscription[] {
    const subs = this.subscriptions.get(taskId) ?? [];
    this.subscriptions.delete(taskId);
    return subs;
  }

  hasSubscribers(taskId: string): boolean {
    return (this.subscriptions.get(taskId)?.length ?? 0) > 0;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [taskId, subs] of this.subscriptions) {
      const alive = subs.filter(s => s.createdAt > cutoff);
      if (alive.length === 0) {
        this.subscriptions.delete(taskId);
      } else {
        this.subscriptions.set(taskId, alive);
      }
    }
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
  }
}
