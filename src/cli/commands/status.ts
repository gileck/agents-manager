import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import { output, type OutputOptions } from '../output';

export function registerStatusCommand(program: Command, api: ApiClient): void {
  program
    .command('status')
    .description('Show system status dashboard')
    .action(async () => {
      const opts = program.opts() as OutputOptions;

      // Use the dashboard stats API endpoint which aggregates everything server-side
      try {
        const stats = await api.dashboard.getStats() as {
          projects: number;
          totalTasks: number;
          tasksByStatus: Record<string, number>;
          activeAgentRuns: number;
          pendingPrompts: number;
        };

        if (opts.json) {
          output(stats, opts);
          return;
        }

        console.log(`Projects: ${stats.projects}`);
        console.log(`Tasks: ${stats.totalTasks}`);
        if (stats.tasksByStatus && Object.keys(stats.tasksByStatus).length > 0) {
          for (const [status, count] of Object.entries(stats.tasksByStatus)) {
            console.log(`  ${status}: ${count}`);
          }
        }
        console.log(`Active agent runs: ${stats.activeAgentRuns}`);
        console.log(`Pending prompts: ${stats.pendingPrompts}`);
      } catch {
        // Fallback: build dashboard from individual API calls
        const projects = await api.projects.list();
        const activeRuns = await api.agents.getActiveRuns();

        const statusCounts: Record<string, number> = {};
        let totalTasks = 0;

        for (const project of projects) {
          const tasks = await api.tasks.list({ projectId: project.id });
          totalTasks += tasks.length;
          for (const task of tasks) {
            statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
          }
        }

        const dashboard = {
          projects: projects.length,
          totalTasks,
          tasksByStatus: statusCounts,
          activeAgentRuns: activeRuns.length,
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
      }
    });
}
