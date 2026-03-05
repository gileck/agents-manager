import type { AppServices } from '../core/providers/setup';

export function startSupervisors(services: AppServices): void {
  services.agentSupervisor.start();
  services.schedulerSupervisor.start(60_000);
}

export function stopSupervisors(services: AppServices): void {
  services.agentSupervisor.stop();
  services.schedulerSupervisor.stop();
}
