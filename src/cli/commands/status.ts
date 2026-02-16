import { Command } from 'commander';
import type { AppServices } from '../../main/providers/setup';
import { output, type OutputOptions } from '../output';

export function registerStatusCommand(program: Command, getServices: () => AppServices): void {
  program
    .command('status')
    .description('Show system status dashboard')
    .action(async () => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();

      const projects = await services.projectStore.listProjects();
      const activeRuns = await services.agentRunStore.getActiveRuns();

      // Aggregate task counts per status across all projects
      const statusCounts: Record<string, number> = {};
      let totalTasks = 0;
      let pendingPrompts = 0;

      for (const project of projects) {
        const tasks = await services.taskStore.listTasks({ projectId: project.id });
        totalTasks += tasks.length;
        for (const task of tasks) {
          statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
          const prompts = await services.pendingPromptStore.getPendingForTask(task.id);
          pendingPrompts += prompts.length;
        }
      }

      const dashboard = {
        projects: projects.length,
        totalTasks,
        tasksByStatus: statusCounts,
        activeAgentRuns: activeRuns.length,
        pendingPrompts,
      };

      if (opts.json) {
        output(dashboard, opts);
        return;
      }

      console.log(`Projects: ${dashboard.projects}`);
      console.log(`Tasks: ${dashboard.totalTasks}`);
      if (Object.keys(statusCounts).length > 0) {
        for (const [status, count] of Object.entries(statusCounts)) {
          console.log(`  ${status}: ${count}`);
        }
      }
      console.log(`Active agent runs: ${dashboard.activeAgentRuns}`);
      console.log(`Pending prompts: ${dashboard.pendingPrompts}`);
    });
}
