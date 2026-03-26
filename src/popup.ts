import type {
  ActivityItem,
  ActivityScrapeState,
  ConnectionRecord,
  ConnectionSyncState,
  ConvexConfig,
  ConvexSyncState,
  ExtensionState,
  FollowerRecord,
  FollowerSyncState,
  OwnActivitySnapshot,
  PopupRequest,
  PopupResponse
} from "./types";
import { createLogger } from "./lib/debug";

type InspectorDataset = "auth" | "me" | "page" | "activity" | "connections" | "followers" | "convex";
const logger = createLogger("popup");

const state: ExtensionState = {
  authState: {
    isAuthenticated: false,
    cookieCount: 0,
    csrfPresent: false,
    capturedAt: null
  },
  userProfile: null,
  pageScrape: null,
  activitySnapshot: null,
  activitySync: {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    itemCount: 0,
    analyticsCount: 0,
    error: null
  },
  connectionSync: {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    pageCount: 0,
    connectionCount: 0,
    error: null
  },
  connections: [],
  followerSync: {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    itemCount: 0,
    error: null
  },
  followers: [],
  convexConfig: null,
  convexSync: {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    runKey: null,
    totalBatches: 0,
    uploadedBatches: 0,
    uploadedConnections: 0,
    remoteConnectionCount: null,
    remoteFollowerCount: null,
    error: null,
    lastSuccessfulPushAt: null
  }
};

const defaultActivitySyncState: ActivityScrapeState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  itemCount: 0,
  analyticsCount: 0,
  error: null
};

const defaultConvexSyncState: ConvexSyncState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  runKey: null,
  totalBatches: 0,
  uploadedBatches: 0,
  uploadedConnections: 0,
  remoteConnectionCount: null,
  remoteFollowerCount: null,
  error: null,
  lastSuccessfulPushAt: null
};

const defaultFollowerSyncState: FollowerSyncState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  itemCount: 0,
  error: null
};

const authPill = document.querySelector<HTMLSpanElement>("#auth-pill")!;
const authMeta = document.querySelector<HTMLDivElement>("#auth-meta")!;
const pageMeta = document.querySelector<HTMLDivElement>("#page-meta")!;
const activityMeta = document.querySelector<HTMLDivElement>("#activity-meta")!;
const activityPreview = document.querySelector<HTMLOListElement>("#activity-preview")!;
const connectionsMeta = document.querySelector<HTMLDivElement>("#connections-meta")!;
const convexMeta = document.querySelector<HTMLDivElement>("#convex-meta")!;
const connectionsPreview = document.querySelector<HTMLOListElement>("#connections-preview")!;
const followersMeta = document.querySelector<HTMLDivElement>("#followers-meta")!;
const followersPreview = document.querySelector<HTMLOListElement>("#followers-preview")!;
const jsonOutput = document.querySelector<HTMLPreElement>("#json-output")!;
const datasetSelect = document.querySelector<HTMLSelectElement>("#dataset-select")!;
const rawToggle = document.querySelector<HTMLInputElement>("#raw-toggle")!;
const connectButton = document.querySelector<HTMLButtonElement>("#connect-btn")!;
const meButton = document.querySelector<HTMLButtonElement>("#me-btn")!;
const scrapeButton = document.querySelector<HTMLButtonElement>("#scrape-btn")!;
const activityButton = document.querySelector<HTMLButtonElement>("#activity-btn")!;
const activityAnalyticsButton = document.querySelector<HTMLButtonElement>("#activity-analytics-btn")!;
const connectionsButton = document.querySelector<HTMLButtonElement>("#connections-btn")!;
const followersButton = document.querySelector<HTMLButtonElement>("#followers-btn")!;
const exportJsonButton = document.querySelector<HTMLButtonElement>("#export-json-btn")!;
const exportCsvButton = document.querySelector<HTMLButtonElement>("#export-csv-btn")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clear-btn")!;
const convexUrlInput = document.querySelector<HTMLInputElement>("#convex-url")!;
const convexWorkspaceInput = document.querySelector<HTMLInputElement>("#convex-workspace")!;
const convexTokenInput = document.querySelector<HTMLInputElement>("#convex-token")!;
const convexLabelInput = document.querySelector<HTMLInputElement>("#convex-label")!;
const convexSaveButton = document.querySelector<HTMLButtonElement>("#convex-save-btn")!;
const convexPushButton = document.querySelector<HTMLButtonElement>("#convex-push-btn")!;

function normalizeActivitySyncState(activitySync: ActivityScrapeState | null | undefined): ActivityScrapeState {
  return {
    ...defaultActivitySyncState,
    ...(activitySync ?? {})
  };
}

function normalizeFollowerSyncState(followerSync: FollowerSyncState | null | undefined): FollowerSyncState {
  return {
    ...defaultFollowerSyncState,
    ...(followerSync ?? {})
  };
}

async function sendMessage(message: PopupRequest): Promise<PopupResponse> {
  logger.log("Sending message to background.", { type: message.type });
  return chrome.runtime.sendMessage(message) as Promise<PopupResponse>;
}

function applyResponse(response: PopupResponse): void {
  if (response.state) {
    state.authState = response.state.authState;
    state.userProfile = response.state.userProfile;
    state.pageScrape = response.state.pageScrape;
    state.activitySnapshot = response.state.activitySnapshot ?? null;
    state.activitySync = normalizeActivitySyncState(response.state.activitySync);
    state.connectionSync = response.state.connectionSync;
    state.connections = response.state.connections;
    state.followerSync = normalizeFollowerSyncState(response.state.followerSync);
    state.followers = response.state.followers ?? [];
    state.convexConfig = response.state.convexConfig ?? null;
    state.convexSync = response.state.convexSync ?? defaultConvexSyncState;
    return;
  }

  if (response.authState) {
    state.authState = response.authState;
  }
  if (typeof response.userProfile !== "undefined") {
    state.userProfile = response.userProfile;
  }
  if (typeof response.scrapeResult !== "undefined") {
    state.pageScrape = response.scrapeResult;
  }
  if (typeof response.activitySnapshot !== "undefined") {
    state.activitySnapshot = response.activitySnapshot;
  }
  if (response.activitySync) {
    state.activitySync = normalizeActivitySyncState(response.activitySync);
  }
  if (response.syncResult) {
    state.connectionSync = response.syncResult;
  }
  if (response.connections) {
    state.connections = response.connections;
  }
  if (response.followerSync) {
    state.followerSync = normalizeFollowerSyncState(response.followerSync);
  }
  if (response.followers) {
    state.followers = response.followers;
  }
  if (typeof response.convexConfig !== "undefined") {
    state.convexConfig = response.convexConfig;
  }
  if (response.convexSync) {
    state.convexSync = response.convexSync;
  }
}

function formatActivityItem(item: ActivityItem): string {
  const headline = item.headline ?? item.text?.slice(0, 80) ?? "Untitled activity";
  const timestamp = item.timestampLabel ? ` (${item.timestampLabel})` : "";
  const analytics =
    item.analyticsMetrics.length
      ? ` [${item.analyticsMetrics.length} metrics]`
      : item.analyticsStatus === "unavailable"
        ? " [analytics unavailable]"
        : item.analyticsStatus === "failed"
          ? " [analytics failed]"
          : "";
  return `${headline}${timestamp}${analytics}`;
}

function renderActivity(snapshot: OwnActivitySnapshot | null, syncState: ActivityScrapeState): void {
  const syncableCount = snapshot?.activityItems.filter((item) => Boolean(item.analyticsUrl)).length ?? 0;
  const summaryParts = [
    `Status: ${syncState.status}`,
    `Items: ${syncState.itemCount}`,
    `Analytics: ${syncState.analyticsCount}/${syncableCount}`
  ];
  if (snapshot?.followerCount) {
    summaryParts.push(`Followers: ${snapshot.followerCount}`);
  }
  if (snapshot?.connectionCount) {
    summaryParts.push(`Connections: ${snapshot.connectionCount}`);
  }
  if (syncState.error) {
    summaryParts.push(`Error: ${syncState.error}`);
  }
  activityMeta.textContent = summaryParts.join(" | ");

  activityPreview.innerHTML = "";
  for (const item of snapshot?.activityItems.slice(0, 8) ?? []) {
    const entry = document.createElement("li");
    entry.textContent = formatActivityItem(item);
    activityPreview.appendChild(entry);
  }
}

function formatConnection(connection: ConnectionRecord): string {
  const title = connection.headline ?? "No headline";
  const company = connection.companyName ? ` at ${connection.companyName}` : "";
  return `${connection.fullName ?? "Unknown"}${company} - ${title}`;
}

function renderConnections(syncState: ConnectionSyncState, connections: ConnectionRecord[]): void {
  const summaryParts = [
    `Status: ${syncState.status}`,
    `Count: ${syncState.connectionCount}`,
    `Pages: ${syncState.pageCount}`
  ];
  if (syncState.error) {
    summaryParts.push(`Error: ${syncState.error}`);
  }
  connectionsMeta.textContent = summaryParts.join(" | ");

  connectionsPreview.innerHTML = "";
  for (const connection of connections.slice(0, 10)) {
    const item = document.createElement("li");
    item.textContent = formatConnection(connection);
    connectionsPreview.appendChild(item);
  }
}

function formatFollower(follower: FollowerRecord): string {
  const headline = follower.headline ?? "No headline";
  const relationship = follower.relationshipLabel ? ` (${follower.relationshipLabel})` : "";
  return `${follower.fullName ?? "Unknown"}${relationship} - ${headline}`;
}

function renderFollowers(syncState: FollowerSyncState, followers: FollowerRecord[]): void {
  const summaryParts = [`Status: ${syncState.status}`, `Count: ${syncState.itemCount}`];
  if (syncState.error) {
    summaryParts.push(`Error: ${syncState.error}`);
  }
  followersMeta.textContent = summaryParts.join(" | ");

  followersPreview.innerHTML = "";
  for (const follower of followers.slice(0, 10)) {
    const item = document.createElement("li");
    item.textContent = formatFollower(follower);
    followersPreview.appendChild(item);
  }
}

function renderConvex(config: ConvexConfig | null, syncState: ConvexSyncState): void {
  convexUrlInput.value = config?.deploymentUrl ?? "";
  convexWorkspaceInput.value = config?.workspaceKey ?? "";
  convexTokenInput.value = config?.syncToken ?? "";
  convexLabelInput.value = config?.label ?? "";

  const summaryParts = [
    `Status: ${syncState.status}`,
    `Workspace: ${config?.workspaceKey ?? "not configured"}`
  ];
  if (config?.deploymentUrl) {
    summaryParts.push(`URL: ${config.deploymentUrl}`);
  }
  if (syncState.totalBatches > 0) {
    summaryParts.push(`Batches: ${syncState.uploadedBatches}/${syncState.totalBatches}`);
  }
  if (syncState.remoteConnectionCount !== null) {
    summaryParts.push(`Remote connections: ${syncState.remoteConnectionCount}`);
  }
  if (syncState.remoteFollowerCount !== null) {
    summaryParts.push(`Remote followers: ${syncState.remoteFollowerCount}`);
  }
  if (syncState.lastSuccessfulPushAt) {
    summaryParts.push(`Last push: ${syncState.lastSuccessfulPushAt}`);
  }
  if (syncState.error) {
    summaryParts.push(`Error: ${syncState.error}`);
  }

  convexMeta.textContent = summaryParts.join(" | ");
}

function getInspectorValue(dataset: InspectorDataset, raw: boolean): unknown {
  if (dataset === "auth") {
    return state.authState;
  }
  if (dataset === "me") {
    return state.userProfile ?? {};
  }
  if (dataset === "page") {
    if (!state.pageScrape) {
      return {};
    }
    return raw ? state.pageScrape.raw : state.pageScrape.normalized;
  }
  if (dataset === "activity") {
    if (!state.activitySnapshot) {
      return {
        snapshot: null,
        sync: state.activitySync
      };
    }
    return raw
      ? state.activitySnapshot.raw
      : {
          profileUrl: state.activitySnapshot.profileUrl,
          publicIdentifier: state.activitySnapshot.publicIdentifier,
          profileHeadline: state.activitySnapshot.profileHeadline,
          followerCount: state.activitySnapshot.followerCount,
          connectionCount: state.activitySnapshot.connectionCount,
          dashboardMetrics: state.activitySnapshot.dashboardMetrics,
          activityItems: state.activitySnapshot.activityItems,
          capturedAt: state.activitySnapshot.capturedAt
        };
  }
  if (dataset === "convex") {
    return {
      config: state.convexConfig,
      sync: state.convexSync
    };
  }

  if (dataset === "followers") {
    if (raw) {
      return state.followers.map((follower) => follower.raw);
    }
    return state.followers;
  }

  if (raw) {
    return state.connections.map((connection) => connection.raw);
  }
  return state.connections;
}

function renderInspector(): void {
  const dataset = datasetSelect.value as InspectorDataset;
  const value = getInspectorValue(dataset, rawToggle.checked);
  jsonOutput.textContent = JSON.stringify(value, null, 2);
}

function formatPageTypeLabel(pageType: string): string {
  if (pageType === "postAnalytics") {
    return "POST ANALYTICS";
  }
  return pageType.toUpperCase();
}

function render(): void {
  authPill.textContent = state.authState.isAuthenticated ? "Authenticated" : "Not authenticated";
  authMeta.textContent = `Cookies: ${state.authState.cookieCount} | CSRF: ${
    state.authState.csrfPresent ? "yes" : "no"
  } | Captured: ${state.authState.capturedAt ?? "never"}`;

  if (state.pageScrape) {
    pageMeta.textContent = `${formatPageTypeLabel(state.pageScrape.pageType)} | ${state.pageScrape.url}`;
  } else {
    pageMeta.textContent = "Open a LinkedIn profile, company, or post analytics page, then scrape it.";
  }

  renderConnections(state.connectionSync, state.connections);
  renderFollowers(state.followerSync, state.followers);
  renderActivity(state.activitySnapshot, state.activitySync);
  renderConvex(state.convexConfig, state.convexSync);
  renderInspector();
}

async function performAction(message: PopupRequest): Promise<void> {
  const response = await sendMessage(message);
  logger.log("Received response from background.", {
    type: message.type,
    success: response.success,
    error: response.error
  });
  applyResponse(response);
  render();

  if (!response.success && response.error) {
    jsonOutput.textContent = JSON.stringify({ error: response.error }, null, 2);
  }
}

function buildSnapshotExport(): Record<string, unknown> {
  return {
    exportedAt: new Date().toISOString(),
    authState: state.authState,
    userProfile: state.userProfile,
    pageScrape: state.pageScrape,
    activitySnapshot: state.activitySnapshot,
    activitySync: state.activitySync,
    connectionSync: state.connectionSync,
    connections: state.connections,
    followerSync: state.followerSync,
    followers: state.followers,
    convexConfig: state.convexConfig ? { ...state.convexConfig, syncToken: "[redacted]" } : null,
    convexSync: state.convexSync
  };
}

function escapeCsv(value: string | null): string {
  const normalized = value ?? "";
  if (/[",\n]/u.test(normalized)) {
    return `"${normalized.replace(/"/gu, '""')}"`;
  }
  return normalized;
}

function buildConnectionsCsv(connections: ConnectionRecord[]): string {
  const header = [
    "fullName",
    "publicIdentifier",
    "profileUrl",
    "entityUrn",
    "headline",
    "companyName",
    "connectedAt"
  ];
  const rows = connections.map((connection) =>
    [
      connection.fullName,
      connection.publicIdentifier,
      connection.profileUrl,
      connection.entityUrn,
      connection.headline,
      connection.companyName,
      connection.connectedAt
    ]
      .map(escapeCsv)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

function downloadTextFile(filename: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

function saveConvexConfigFromForm(): Promise<void> {
  return performAction({
    type: "SAVE_CONVEX_CONFIG",
    payload: {
      deploymentUrl: convexUrlInput.value,
      workspaceKey: convexWorkspaceInput.value,
      syncToken: convexTokenInput.value,
      label: convexLabelInput.value
    }
  });
}

datasetSelect.addEventListener("change", renderInspector);
rawToggle.addEventListener("change", renderInspector);
connectButton.addEventListener("click", () => void performAction({ type: "GET_LINKEDIN_AUTH" }));
meButton.addEventListener("click", () => void performAction({ type: "GET_LINKEDIN_USER_PROFILE" }));
scrapeButton.addEventListener("click", () => void performAction({ type: "SCRAPE_ACTIVE_PAGE" }));
activityButton.addEventListener("click", () => void performAction({ type: "SCRAPE_SELF_ACTIVITY" }));
activityAnalyticsButton.addEventListener("click", () => void performAction({ type: "SYNC_POST_ANALYTICS" }));
connectionsButton.addEventListener("click", () => void performAction({ type: "SYNC_CONNECTIONS" }));
followersButton.addEventListener("click", () => void performAction({ type: "SYNC_FOLLOWERS" }));
convexSaveButton.addEventListener("click", () => void saveConvexConfigFromForm());
convexPushButton.addEventListener("click", () => void performAction({ type: "PUSH_TO_CONVEX" }));
clearButton.addEventListener("click", () => void performAction({ type: "CLEAR_SESSION_STATE" }));
exportJsonButton.addEventListener("click", () => {
  downloadTextFile(
    `tigerclaw-linkedin-snapshot-${timestampForFilename()}.json`,
    "application/json",
    JSON.stringify(buildSnapshotExport(), null, 2)
  );
});
exportCsvButton.addEventListener("click", () => {
  downloadTextFile(
    `tigerclaw-linkedin-connections-${timestampForFilename()}.csv`,
    "text/csv;charset=utf-8",
    buildConnectionsCsv(state.connections)
  );
});

void (async () => {
  logger.log("Popup initialized.");
  const response = await sendMessage({ type: "PING" });
  logger.log("Received initial state snapshot.", {
    success: response.success,
    error: response.error
  });
  applyResponse(response);
  render();
})();
