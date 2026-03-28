import { openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export interface MiroFishDocumentInput {
  filename: string;
  content: string;
}

export interface InterviewCandidate {
  fullName: string;
  prompt: string;
}

export interface MiroFishImportedProjectOptions {
  projectName: string;
  simulationRequirement: string;
  documents: MiroFishDocumentInput[];
  ontology: Record<string, unknown>;
  analysisSummary?: string;
  graphId?: string;
}

export interface MiroFishImportedProjectResult {
  projectId: string;
  projectName: string | null;
  status: string | null;
  graphId: string | null;
  totalTextLength: number | null;
}

export interface MiroFishBuildGraphOptions {
  projectId: string;
  graphName: string;
  force?: boolean;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface MiroFishGraphBuildResult {
  projectId: string;
  graphId: string;
  taskId: string;
  task: Record<string, unknown>;
}

export interface MiroFishScenarioRunOptions {
  projectId: string;
  graphId?: string;
  maxRounds: number;
  enableGraphMemoryUpdate: boolean;
  entityTypes?: string[];
  useLlmForProfiles: boolean;
  parallelProfileCount: number;
  reuseProfilesFromSimulationId?: string;
  includeInterviews?: boolean;
  includeReport?: boolean;
  interviewCandidates?: InterviewCandidate[];
}

export interface MiroFishScenarioRunResult {
  projectId: string;
  simulationId: string;
  prepareStatus: Record<string, unknown>;
  runStatus: Record<string, unknown>;
  runDetail: Record<string, unknown>;
  profiles: Array<Record<string, unknown>>;
  interviews: Record<string, unknown> | null;
  report: Record<string, unknown>;
}

export interface MiroFishClientOptions {
  baseUrl: string;
  rootDir: string;
  autoStart?: boolean;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
  startupLogDir?: string;
  envOverrides?: Record<string, string>;
}

interface JsonEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  traceback?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isTerminalTaskStatus(status: string | null): boolean {
  return status === "completed" || status === "failed";
}

function isTerminalRunStatus(status: string | null): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}

export class MiroFishClient {
  private readonly baseUrl: string;
  private readonly rootDir: string;
  private readonly autoStart: boolean;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly startupLogDir?: string;
  private readonly envOverrides: Record<string, string>;

  constructor(options: MiroFishClientOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.rootDir = options.rootDir;
    this.autoStart = options.autoStart ?? true;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 90_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    this.startupLogDir = options.startupLogDir;
    this.envOverrides = options.envOverrides ?? {};
  }

  async ensureReady(): Promise<void> {
    if (await this.healthCheck()) {
      return;
    }

    if (!this.autoStart) {
      throw new Error(`MiroFish backend is not reachable at ${this.baseUrl}.`);
    }

    await this.startBackend();

    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (await this.healthCheck()) {
        return;
      }
      await sleep(2_000);
    }

    throw new Error(`Timed out waiting for MiroFish backend at ${this.baseUrl}.`);
  }

  async importProject(options: MiroFishImportedProjectOptions): Promise<MiroFishImportedProjectResult> {
    await this.ensureReady();

    const imported = await this.postJson<Record<string, unknown>>("/api/graph/project/import", {
      project_name: options.projectName,
      simulation_requirement: options.simulationRequirement,
      documents: options.documents,
      ontology: options.ontology,
      analysis_summary: options.analysisSummary,
      graph_id: options.graphId
    });

    const projectId = asString(imported.project_id);
    if (!projectId) {
      throw new Error("MiroFish project import did not return a project_id.");
    }

    return {
      projectId,
      projectName: asString(imported.project_name),
      status: asString(imported.status),
      graphId: asString(imported.graph_id),
      totalTextLength: asNumber(imported.total_text_length)
    };
  }

  async buildGraph(options: MiroFishBuildGraphOptions): Promise<MiroFishGraphBuildResult> {
    await this.ensureReady();

    const graphBuild = await this.postJson<{ task_id?: string; project_id?: string }>(
      "/api/graph/build",
      {
        project_id: options.projectId,
        graph_name: options.graphName,
        force: options.force ?? false,
        chunk_size: options.chunkSize,
        chunk_overlap: options.chunkOverlap
      }
    );

    const taskId = asString(graphBuild.task_id);
    if (!taskId) {
      throw new Error("MiroFish graph build did not return a task_id.");
    }

    const task = await this.pollTask(`/api/graph/task/${taskId}`, "graph build");
    const project = await this.getProject(options.projectId);
    const graphId = asString(project.graph_id);

    if (!graphId) {
      throw new Error("MiroFish graph build completed without a graph_id.");
    }

    return {
      projectId: options.projectId,
      graphId,
      taskId,
      task
    };
  }

  async runScenario(options: MiroFishScenarioRunOptions): Promise<MiroFishScenarioRunResult> {
    await this.ensureReady();

    const simulation = await this.postJson<{ simulation_id?: string }>("/api/simulation/create", {
      project_id: options.projectId,
      graph_id: options.graphId,
      enable_twitter: true,
      enable_reddit: true
    });
    const simulationId = asString(simulation.simulation_id);
    if (!simulationId) {
      throw new Error("MiroFish simulation creation did not return a simulation_id.");
    }

    const prepare = await this.postJson<Record<string, unknown>>("/api/simulation/prepare", {
      simulation_id: simulationId,
      entity_types: options.entityTypes,
      use_llm_for_profiles: options.useLlmForProfiles,
      parallel_profile_count: options.parallelProfileCount,
      reuse_profiles_from_simulation_id: options.reuseProfilesFromSimulationId
    });
    const prepareTaskId = asString(prepare.task_id);
    const prepareStatus =
      prepareTaskId !== null
        ? await this.pollJsonStatus(
            "/api/simulation/prepare/status",
            { task_id: prepareTaskId, simulation_id: simulationId },
            "simulation prepare",
            (data) => isTerminalTaskStatus(asString(data.status)) || asString(data.status) === "ready"
          )
        : prepare;

    await this.postJson<Record<string, unknown>>("/api/simulation/start", {
      simulation_id: simulationId,
      platform: "parallel",
      max_rounds: options.maxRounds,
      enable_graph_memory_update: options.enableGraphMemoryUpdate,
      force: true
    });

    const runStatus = await this.pollGetStatus(
      `/api/simulation/${simulationId}/run-status`,
      "simulation run",
      (data) => isTerminalRunStatus(asString(data.runner_status))
    );

    const runDetail = await this.getJson<Record<string, unknown>>(`/api/simulation/${simulationId}/run-status/detail`);
    const profilesResponse = await this.getJson<{ profiles?: Array<Record<string, unknown>> }>(
      `/api/simulation/${simulationId}/profiles?platform=reddit`
    );
    const profiles = Array.isArray(profilesResponse.profiles) ? profilesResponse.profiles : [];

    const includeInterviews = options.includeInterviews ?? true;
    const includeReport = options.includeReport ?? true;

    let interviews: Record<string, unknown> | null = null;
    if (includeInterviews && options.interviewCandidates && options.interviewCandidates.length > 0) {
      try {
        interviews = await this.runInterviews(simulationId, profiles, options.interviewCandidates);
      } catch (error) {
        interviews = {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    let report: Record<string, unknown>;
    if (!includeReport) {
      report = {
        success: true,
        status: "skipped",
        markdown_content: "",
        error: null
      };
    } else {
      try {
        const reportStart = await this.postJson<Record<string, unknown>>("/api/report/generate", {
          simulation_id: simulationId,
          force_regenerate: true
        });
        const reportTaskId = asString(reportStart.task_id);
        if (reportTaskId) {
          await this.pollJsonStatus(
            "/api/report/generate/status",
            { task_id: reportTaskId, simulation_id: simulationId },
            "report generation",
            (data) => isTerminalTaskStatus(asString(data.status))
          );
        }
        report = await this.getJson<Record<string, unknown>>(`/api/report/by-simulation/${simulationId}`);
      } catch (error) {
        report = {
          success: false,
          status: "failed",
          markdown_content: "",
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    return {
      projectId: options.projectId,
      simulationId,
      prepareStatus,
      runStatus,
      runDetail,
      profiles,
      interviews,
      report
    };
  }

  async getProject(projectId: string): Promise<Record<string, unknown>> {
    await this.ensureReady();
    return this.getJson<Record<string, unknown>>(`/api/graph/project/${projectId}`);
  }

  private async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) {
        return false;
      }
      const data = (await response.json()) as Record<string, unknown>;
      return asString(data.status) === "ok";
    } catch {
      return false;
    }
  }

  private async startBackend(): Promise<void> {
    let stdio: "ignore" | ["ignore", number, number] = "ignore";

    if (this.startupLogDir) {
      await mkdir(this.startupLogDir, { recursive: true });
      const logPath = path.join(this.startupLogDir, "mirofish-backend.log");
      const fd = openSync(logPath, "a");
      stdio = ["ignore", fd, fd];
    }

    const child = spawn("npm", ["run", "backend"], {
      cwd: this.rootDir,
      detached: true,
      stdio,
      env: {
        ...process.env,
        ...this.envOverrides
      }
    });
    child.unref();
  }

  private async runInterviews(
    simulationId: string,
    profiles: Array<Record<string, unknown>>,
    interviewCandidates: InterviewCandidate[]
  ): Promise<Record<string, unknown> | null> {
    const interviews = interviewCandidates
      .map((candidate) => {
        const profile = profiles.find((current) => asString(current.name) === candidate.fullName);
        const agentId = typeof profile?.user_id === "number" ? profile.user_id : null;
        if (agentId === null) {
          return null;
        }
        return {
          agent_id: agentId,
          prompt: candidate.prompt
        };
      })
      .filter((candidate): candidate is { agent_id: number; prompt: string } => candidate !== null);

    if (!interviews.length) {
      return null;
    }

    return this.postJson<Record<string, unknown>>("/api/simulation/interview/batch", {
      simulation_id: simulationId,
      platform: "reddit",
      timeout: 120,
      interviews
    });
  }

  private async pollTask(endpoint: string, label: string): Promise<Record<string, unknown>> {
    return this.pollGetStatus(endpoint, label, (data) => isTerminalTaskStatus(asString(data.status)));
  }

  private async pollGetStatus(
    endpoint: string,
    label: string,
    isDone: (data: Record<string, unknown>) => boolean
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 30 * 60_000;
    let lastData: Record<string, unknown> | null = null;

    while (Date.now() < deadline) {
      const data = await this.getJson<Record<string, unknown>>(endpoint);
      lastData = data;
      if (isDone(data)) {
        const status = asString(data.status) ?? asString(data.runner_status);
        if (status === "failed") {
          throw new Error(`MiroFish ${label} failed: ${asString(data.error) ?? "Unknown error"}`);
        }
        return data;
      }
      await sleep(this.pollIntervalMs);
    }

    throw new Error(`Timed out while waiting for MiroFish ${label}. Last payload: ${JSON.stringify(lastData)}`);
  }

  private async pollJsonStatus(
    endpoint: string,
    payload: Record<string, unknown>,
    label: string,
    isDone: (data: Record<string, unknown>) => boolean
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 30 * 60_000;
    let lastData: Record<string, unknown> | null = null;

    while (Date.now() < deadline) {
      const data = await this.postJson<Record<string, unknown>>(endpoint, payload);
      lastData = data;
      if (isDone(data)) {
        const status = asString(data.status);
        if (status === "failed") {
          throw new Error(`MiroFish ${label} failed: ${asString(data.error) ?? "Unknown error"}`);
        }
        return data;
      }
      await sleep(this.pollIntervalMs);
    }

    throw new Error(`Timed out while waiting for MiroFish ${label}. Last payload: ${JSON.stringify(lastData)}`);
  }

  private async getJson<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`);
    return this.readEnvelope<T>(response, endpoint);
  }

  private async postJson<T>(endpoint: string, payload: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    return this.readEnvelope<T>(response, endpoint);
  }

  private async readEnvelope<T>(response: Response, label: string): Promise<T> {
    let body: JsonEnvelope<T>;

    try {
      body = (await response.json()) as JsonEnvelope<T>;
    } catch (error) {
      throw new Error(
        `Failed to parse MiroFish response for ${label}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (!response.ok || !body.success || typeof body.data === "undefined") {
      throw new Error(body.error ?? `MiroFish request failed for ${label} with status ${response.status}.`);
    }

    return body.data;
  }
}
