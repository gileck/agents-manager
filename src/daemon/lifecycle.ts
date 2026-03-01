import type { AppServices } from '../core/providers/setup';

export function startSupervisors(services: AppServices): void {
  services.agentSupervisor.start();
  services.workflowReviewSupervisor.start(5 * 60 * 1000);
}

export function stopSupervisors(services: AppServices): void {
  services.agentSupervisor.stop();
}
