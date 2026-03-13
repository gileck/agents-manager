import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface CodexAppServerNotification {
  method: string;
  params: Record<string, unknown>;
}

export interface CodexAppServerServerRequest {
  method: string;
  id: string | number;
  params: Record<string, unknown>;
}

export interface CodexAppServerResponseError {
  message?: string;
  code?: number;
  data?: unknown;
}

export interface CodexAppServerResponseEnvelope<T = unknown> {
  id: string | number;
  result?: T;
  error?: {
    message?: string;
    code?: number;
    data?: unknown;
  };
}

export interface CodexAppServerThreadInfo {
  id: string;
  cwd?: string;
}

export interface CodexAppServerTurnInfo {
  id: string;
  status?: string;
  error?: { message?: string | null; additionalDetails?: string | null } | null;
}

export interface CodexAppServerThreadStartResponse {
  thread: CodexAppServerThreadInfo;
}

export interface CodexAppServerThreadResumeResponse {
  thread: CodexAppServerThreadInfo;
}

export interface CodexAppServerTurnStartResponse {
  turn: CodexAppServerTurnInfo;
}

export interface CodexAppServerInitializeResponse {
  userAgent: string;
}

export interface CodexAppServerUserTextInput {
  type: 'text';
  text: string;
  text_elements: Array<unknown>;
}

export interface CodexAppServerUserLocalImageInput {
  type: 'localImage';
  path: string;
}

export interface CodexAppServerThreadStartParams {
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted' | null;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  experimentalRawEvents: boolean;
  persistExtendedHistory: boolean;
}

export interface CodexAppServerThreadResumeParams {
  threadId: string;
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted' | null;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  persistExtendedHistory: boolean;
}

export interface CodexAppServerTurnStartParams {
  threadId: string;
  input: Array<CodexAppServerUserTextInput | CodexAppServerUserLocalImageInput>;
  cwd?: string | null;
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted' | null;
  sandboxPolicy?: Record<string, unknown> | null;
  model?: string | null;
  outputSchema?: Record<string, unknown> | null;
}

export interface CodexAppServerTurnInterruptParams {
  threadId: string;
  turnId: string;
}

export interface CodexAppServerClientOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  bin?: string;
  args?: string[];
  onNotification?: (notification: CodexAppServerNotification) => void;
  onServerRequest?: (request: CodexAppServerServerRequest) => Promise<unknown> | unknown;
  onStderr?: (chunk: string) => void;
  spawnProcess?: typeof spawn;
  clientInfo?: { name: string; version: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type JsonRpcMessage = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string; code?: number; data?: unknown };
};

export class CodexAppServerClient extends EventEmitter {
  private readonly spawnProcess: typeof spawn;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly childArgs: string[];
  private child: ChildProcess | null = null;
  private stdoutBuffer = '';
  private nextRequestId = 1;
  private started = false;

  constructor(private readonly options: CodexAppServerClientOptions = {}) {
    super();
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.childArgs = options.args ?? ['app-server'];
  }

  async start(): Promise<void> {
    if (this.started) return;

    const child = this.spawnProcess(this.options.bin ?? 'codex', this.childArgs, {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');

    child.stdout?.on('data', (chunk: string | Buffer) => {
      this.handleStdout(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      this.options.onStderr?.(text);
      this.emit('stderr', text);
    });
    child.on('error', (err: Error) => {
      this.rejectAllPending(err instanceof Error ? err : new Error(String(err)));
    });
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      const reason = `codex app-server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
      this.rejectAllPending(new Error(reason));
      this.emit('close', { code, signal });
      this.child = null;
      this.started = false;
    });

    this.started = true;
    await this.initialize();
  }

  async close(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.started = false;
    this.rejectAllPending(new Error('codex app-server client closed'));

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      child.once('close', finish);
      try {
        child.kill('SIGTERM');
      } catch {
        finish();
        return;
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Best effort only.
        }
        finish();
      }, 1000);
    });
  }

  async threadStart(params: CodexAppServerThreadStartParams): Promise<CodexAppServerThreadStartResponse> {
    return this.request<CodexAppServerThreadStartResponse>('thread/start', params as object);
  }

  async threadResume(params: CodexAppServerThreadResumeParams): Promise<CodexAppServerThreadResumeResponse> {
    return this.request<CodexAppServerThreadResumeResponse>('thread/resume', params as object);
  }

  async turnStart(params: CodexAppServerTurnStartParams): Promise<CodexAppServerTurnStartResponse> {
    return this.request<CodexAppServerTurnStartResponse>('turn/start', params as object);
  }

  async turnInterrupt(params: CodexAppServerTurnInterruptParams): Promise<void> {
    await this.request<Record<string, never>>('turn/interrupt', params as object);
  }

  private async initialize(): Promise<CodexAppServerInitializeResponse> {
    return this.request<CodexAppServerInitializeResponse>('initialize', {
      clientInfo: this.options.clientInfo ?? { name: 'agents-manager', version: '0.0.0' },
      capabilities: null,
    });
  }

  private async request<T>(method: string, params: object): Promise<T> {
    if (!this.child?.stdin) {
      throw new Error('codex app-server is not running');
    }
    const id = String(this.nextRequestId++);
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.writeMessage({ method, id, params }, (err?: Error | null) => {
        if (!err) return;
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.handleMessage(trimmed);
    }
  }

  private handleMessage(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emit('parse_error', line);
      return;
    }

    if (message.id != null && (Object.prototype.hasOwnProperty.call(message, 'result') || Object.prototype.hasOwnProperty.call(message, 'error'))) {
      this.handleResponse(message as CodexAppServerResponseEnvelope);
      return;
    }

    if (message.method && message.id != null) {
      const request: CodexAppServerServerRequest = {
        method: message.method,
        id: message.id,
        params: message.params ?? {},
      };
      void this.handleServerRequest(request);
      this.emit('server_request', request);
      return;
    }

    if (message.method) {
      const notification: CodexAppServerNotification = {
        method: message.method,
        params: message.params ?? {},
      };
      this.options.onNotification?.(notification);
      this.emit('notification', notification);
    }
  }

  private handleResponse(envelope: CodexAppServerResponseEnvelope): void {
    const pending = this.pendingRequests.get(String(envelope.id));
    if (!pending) return;
    this.pendingRequests.delete(String(envelope.id));
    if (envelope.error) {
      pending.reject(new Error(envelope.error.message ?? 'codex app-server request failed'));
      return;
    }
    pending.resolve(envelope.result);
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private async handleServerRequest(request: CodexAppServerServerRequest): Promise<void> {
    try {
      const result = await this.options.onServerRequest?.(request);
      this.writeMessage({ id: request.id, result: result ?? null });
    } catch (error) {
      const err = error instanceof Error
        ? { message: error.message }
        : { message: String(error) };
      this.writeMessage({ id: request.id, error: err });
    }
  }

  private writeMessage(
    payload: { method?: string; id?: string | number; params?: object; result?: unknown; error?: CodexAppServerResponseError },
    callback?: (err?: Error | null) => void,
  ): void {
    if (!this.child?.stdin) {
      callback?.(new Error('codex app-server is not running'));
      return;
    }
    const serialized = JSON.stringify(payload);
    this.child.stdin.write(`${serialized}\n`, callback);
  }
}
