export const AGENT_EXECUTION_MODES = ["pty", "exec", "sdk"] as const;

export type AgentExecutionMode = (typeof AGENT_EXECUTION_MODES)[number];
export type AgentRuntimeState = "idle" | "running" | "error";

export interface AgentRunRequest {
  mode: AgentExecutionMode;
  prompt: string;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  output: string;
  sessionId?: string;
}

export type AgentExecutor = (
  request: AgentRunRequest
) => Promise<AgentRunResult>;

export interface AgentRuntimeStatus {
  state: AgentRuntimeState;
  activeMode: AgentExecutionMode | null;
  lastMode: AgentExecutionMode | null;
  supportedModes: AgentExecutionMode[];
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export type AgentRuntimeListener = (status: AgentRuntimeStatus) => void;

export interface AgentRuntimeOptions {
  executors?: Partial<Record<AgentExecutionMode, AgentExecutor>>;
  now?: () => Date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AgentRuntime {
  private readonly executors: Partial<
    Record<AgentExecutionMode, AgentExecutor>
  >;
  private readonly listeners = new Set<AgentRuntimeListener>();
  private readonly now: () => Date;
  private status: AgentRuntimeStatus;

  constructor({
    executors = {},
    now = () => new Date()
  }: AgentRuntimeOptions = {}) {
    this.executors = { ...executors };
    this.now = now;
    this.status = {
      state: "idle",
      activeMode: null,
      lastMode: null,
      supportedModes: AGENT_EXECUTION_MODES.filter(
        (mode) => this.executors[mode] !== undefined
      ),
      startedAt: null,
      completedAt: null,
      error: null
    };
  }

  getStatus(): AgentRuntimeStatus {
    return {
      ...this.status,
      supportedModes: [...this.status.supportedModes]
    };
  }

  subscribe(listener: AgentRuntimeListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const prompt = request.prompt.trim();
    if (!prompt) {
      throw new Error("Agent prompt must not be empty.");
    }

    if (this.status.state === "running") {
      throw new Error("Agent runtime is already running.");
    }

    const executor = this.executors[request.mode];
    if (!executor) {
      throw new Error(
        `Agent execution mode is not configured: ${request.mode}`
      );
    }

    this.updateStatus({
      state: "running",
      activeMode: request.mode,
      lastMode: request.mode,
      startedAt: this.now().toISOString(),
      completedAt: null,
      error: null
    });

    try {
      const result = await executor({ ...request, prompt });
      this.updateStatus({
        state: "idle",
        activeMode: null,
        completedAt: this.now().toISOString(),
        error: null
      });
      return result;
    } catch (error) {
      this.updateStatus({
        state: "error",
        activeMode: null,
        completedAt: this.now().toISOString(),
        error: errorMessage(error)
      });
      throw error;
    }
  }

  resetError(): void {
    if (this.status.state !== "error") return;
    this.updateStatus({
      state: "idle",
      error: null
    });
  }

  private updateStatus(update: Partial<AgentRuntimeStatus>): void {
    this.status = {
      ...this.status,
      ...update
    };
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
