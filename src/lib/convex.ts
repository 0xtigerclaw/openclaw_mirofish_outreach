import { createLogger } from "./debug";
import type { ConnectionRecord, ConvexConfig, ExtensionState } from "../types";

const logger = createLogger("convex");
const CONVEX_BATCH_SIZE = 100;

interface ConvexHttpResponse<T> {
  status: "success" | "error";
  value?: T;
  errorMessage?: string;
  logLines?: string[];
}

interface PushSnapshotResult {
  runKey: string;
  totalBatches: number;
  connectionCount: number;
  uploadedBatches: number;
  remoteConnectionCount: number;
  remoteFollowerCount: number;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function sanitizeConvexKey(key: string): string {
  return key.startsWith("$") ? `_dollar_${key.slice(1)}` : key;
}

function sanitizeForConvexValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }

  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForConvexValue(item))
      .filter((item): item is Exclude<typeof item, undefined> => typeof item !== "undefined");
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    const sanitizedObject: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      const sanitizedValue = sanitizeForConvexValue(entryValue);
      if (typeof sanitizedValue === "undefined") {
        continue;
      }
      sanitizedObject[sanitizeConvexKey(key)] = sanitizedValue;
    }
    return sanitizedObject;
  }

  return String(value);
}

export function normalizeConvexDeploymentUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Convex deployment URL is required.");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  parsed.pathname = parsed.pathname.replace(/\/api\/(query|mutation|action|run\/.*)$/u, "");
  parsed.search = "";
  parsed.hash = "";
  return stripTrailingSlash(parsed.toString());
}

async function callConvexEndpoint<T>(
  deploymentUrl: string,
  endpointPath: "mutation" | "query",
  path: string,
  args: Record<string, unknown>
): Promise<T> {
  const normalizedUrl = normalizeConvexDeploymentUrl(deploymentUrl);
  const endpoint = `${normalizedUrl}/api/${endpointPath}`;
  logger.log(`Calling Convex ${endpointPath}.`, { endpoint, path });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      path,
      args: sanitizeForConvexValue(args),
      format: "json"
    })
  });

  const responseBody = (await response.json()) as ConvexHttpResponse<T>;

  if (!response.ok || responseBody.status !== "success" || typeof responseBody.value === "undefined") {
    logger.error(`Convex ${endpointPath} failed.`, {
      endpoint,
      path,
      status: response.status,
      errorMessage: responseBody.errorMessage,
      logLines: responseBody.logLines
    });
    throw new Error(responseBody.errorMessage ?? `Convex request failed with status ${response.status}.`);
  }

  return responseBody.value;
}

export async function callConvexMutation<T>(
  deploymentUrl: string,
  path: string,
  args: Record<string, unknown>
): Promise<T> {
  return callConvexEndpoint(deploymentUrl, "mutation", path, args);
}

export async function callConvexQuery<T>(
  deploymentUrl: string,
  path: string,
  args: Record<string, unknown>
): Promise<T> {
  return callConvexEndpoint(deploymentUrl, "query", path, args);
}

function chunkConnections(connections: ConnectionRecord[]): ConnectionRecord[][] {
  const batches: ConnectionRecord[][] = [];
  for (let index = 0; index < connections.length; index += CONVEX_BATCH_SIZE) {
    batches.push(connections.slice(index, index + CONVEX_BATCH_SIZE));
  }
  return batches;
}

function normalizeConfig(config: ConvexConfig): ConvexConfig {
  return {
    ...config,
    deploymentUrl: normalizeConvexDeploymentUrl(config.deploymentUrl),
    workspaceKey: config.workspaceKey.trim(),
    syncToken: config.syncToken.trim(),
    label: config.label?.trim() || null
  };
}

export async function pushExtensionStateToConvex(
  rawConfig: ConvexConfig,
  extensionState: ExtensionState,
  onProgress?: (progress: {
    status: "uploading";
    runKey: string;
    totalBatches: number;
    uploadedBatches: number;
    uploadedConnections: number;
  }) => Promise<void> | void
): Promise<PushSnapshotResult> {
  const config = normalizeConfig(rawConfig);
  if (!config.workspaceKey) {
    throw new Error("Convex workspace key is required.");
  }
  if (!config.syncToken) {
    throw new Error("Convex sync token is required.");
  }

  const runKey = crypto.randomUUID();
  const batches = chunkConnections(extensionState.connections);
  const totalBatches = batches.length;

  await callConvexMutation(config.deploymentUrl, "linkedinSync:upsertInstallation", {
    workspaceKey: config.workspaceKey,
    syncToken: config.syncToken,
    label: config.label ?? undefined,
    deploymentUrl: config.deploymentUrl
  });

  await callConvexMutation(config.deploymentUrl, "linkedinSync:startSyncUpload", {
    workspaceKey: config.workspaceKey,
    syncToken: config.syncToken,
    runKey,
    authState: extensionState.authState,
    userProfile: extensionState.userProfile,
    pageScrape: extensionState.pageScrape,
    activitySnapshot: extensionState.activitySnapshot,
    followerSync: extensionState.followerSync,
    followers: extensionState.followers,
    connectionSync: extensionState.connectionSync,
    connectionCount: extensionState.connections.length,
    totalBatches
  });

  let uploadedConnections = 0;

  for (const [batchIndex, records] of batches.entries()) {
    await callConvexMutation(config.deploymentUrl, "linkedinSync:uploadConnectionBatch", {
      workspaceKey: config.workspaceKey,
      syncToken: config.syncToken,
      runKey,
      batchIndex,
      records
    });
    uploadedConnections += records.length;
    await onProgress?.({
      status: "uploading",
      runKey,
      totalBatches,
      uploadedBatches: batchIndex + 1,
      uploadedConnections
    });
  }

  const completion = await callConvexMutation<{
    runKey: string;
    uploadedBatches: number;
    connectionCount: number;
    followerCount: number;
  }>(config.deploymentUrl, "linkedinSync:completeSyncUpload", {
    workspaceKey: config.workspaceKey,
    syncToken: config.syncToken,
    runKey
  });

  return {
    runKey: completion.runKey,
    totalBatches,
    connectionCount: extensionState.connections.length,
    uploadedBatches: completion.uploadedBatches,
    remoteConnectionCount: completion.connectionCount,
    remoteFollowerCount: completion.followerCount
  };
}
