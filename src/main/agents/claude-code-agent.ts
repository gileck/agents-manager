import { spawn, execSync, type ChildProcess } from 'child_process';
import type { AgentContext, AgentConfig, AgentRunResult } from '../../shared/types';
import type { IAgent } from '../interfaces/agent';
import { getShellEnv } from '../services/shell-env';

export class ClaudeCodeAgent implements IAgent {
  readonly type = 'claude-code';
  private runningProcesses = new Map<string, ChildProcess>();

  async isAvailable(): Promise<boolean> {
    try {
      execSync('claude --version', {
        timeout: 5000,
        env: getShellEnv(),
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  async execute(context: AgentContext, config: AgentConfig): Promise<AgentRunResult> {
    const prompt = this.buildPrompt(context);
    const workdir = context.project?.path || context.workdir;
    const timeout = config.timeout || (context.mode === 'plan' ? 5 * 60 * 1000 : 10 * 60 * 1000);

    return new Promise<AgentRunResult>((resolve) => {
      const args = ['-p', prompt, '--output-format', 'json'];
      const proc = spawn('claude', args, {
        cwd: workdir,
        env: getShellEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const runId = context.task.id;
      this.runningProcesses.set(runId, proc);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 5000);
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.runningProcesses.delete(runId);

        const exitCode = code ?? 1;
        let costInputTokens: number | undefined;
        let costOutputTokens: number | undefined;
        let output = stdout || stderr;

        // Try to parse JSON output for token usage
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.result) {
            output = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
          }
          if (parsed.usage) {
            costInputTokens = parsed.usage.input_tokens;
            costOutputTokens = parsed.usage.output_tokens;
          }
        } catch {
          // stdout wasn't valid JSON, use raw output
        }

        const outcome = this.inferOutcome(context.mode, exitCode);

        resolve({
          exitCode,
          output,
          outcome,
          costInputTokens,
          costOutputTokens,
          error: exitCode !== 0 ? (stderr || `Process exited with code ${exitCode}`) : undefined,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.runningProcesses.delete(runId);
        resolve({
          exitCode: 1,
          output: '',
          outcome: 'failed',
          error: err.message,
        });
      });
    });
  }

  async stop(runId: string): Promise<void> {
    const proc = this.runningProcesses.get(runId);
    if (!proc) return;

    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 5000);
    this.runningProcesses.delete(runId);
  }

  private inferOutcome(mode: string, exitCode: number): string {
    if (exitCode !== 0) return 'failed';
    switch (mode) {
      case 'plan': return 'plan_complete';
      case 'implement': return 'pr_ready';
      case 'review': return 'approved';
      default: return 'completed';
    }
  }

  private buildPrompt(context: AgentContext): string {
    const { task, mode } = context;
    const desc = task.description ? ` ${task.description}` : '';

    switch (mode) {
      case 'plan':
        return `Analyze this task and create a detailed implementation plan. Task: ${task.title}.${desc}`;
      case 'implement':
        return `Implement the changes for this task. Task: ${task.title}.${desc}`;
      case 'review':
        return `Review the changes for this task. Task: ${task.title}.${desc}`;
      default:
        return `${task.title}.${desc}`;
    }
  }
}
