export type PageType = "self" | "profile" | "company" | "postAnalytics" | "unsupported";
export type SyncStatus = "idle" | "running" | "success" | "error";
export type ConvexPushStatus = "idle" | "uploading" | "success" | "error";
export type ActivitySyncStatus = "idle" | "running" | "success" | "error";

export interface AuthState {
  isAuthenticated: boolean;
  cookieCount: number;
  csrfPresent: boolean;
  capturedAt: string | null;
}

export interface SessionStateInternal {
  cookieHeader: string;
  csrfToken: string | null;
  cookieCount: number;
  capturedAt: string;
}

export interface UserProfile {
  firstName: string | null;
  lastName: string | null;
  publicIdentifier: string | null;
  profileUrl: string | null;
  dashEntityUrn: string | null;
}

export interface NormalizedProfile {
  fullName: string | null;
  headline: string | null;
  location: string | null;
  publicIdentifier: string | null;
  profileUrl: string | null;
  entityUrn: string | null;
  companyName: string | null;
  raw: unknown;
}

export interface NormalizedCompany {
  name: string | null;
  universalName: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  industry: string | null;
  employeeCount: string | null;
  description: string | null;
  raw: unknown;
}

export interface NormalizedPostAnalytics {
  activityUrn: string | null;
  analyticsUrl: string | null;
  postUrl: string | null;
  author: string | null;
  postText: string | null;
  publishedLabel: string | null;
  status: "success" | "unavailable" | "failed";
  errorMessage: string | null;
  metrics: ProfileMetric[];
  raw: unknown;
}

export interface PageScrape {
  pageType: PageType;
  url: string;
  normalized: UserProfile | NormalizedProfile | NormalizedCompany | NormalizedPostAnalytics | null;
  raw: unknown;
  capturedAt: string;
}

export interface ConnectionRecord {
  fullName: string | null;
  publicIdentifier: string | null;
  profileUrl: string | null;
  entityUrn: string | null;
  headline: string | null;
  companyName: string | null;
  connectedAt: string | null;
  raw: unknown;
}

export interface ConnectionSyncState {
  status: SyncStatus;
  startedAt: string | null;
  finishedAt: string | null;
  pageCount: number;
  connectionCount: number;
  error: string | null;
}

export interface FollowerRecord {
  fullName: string | null;
  publicIdentifier: string | null;
  profileUrl: string | null;
  headline: string | null;
  relationshipLabel: string | null;
  raw: unknown;
}

export interface FollowerSyncState {
  status: SyncStatus;
  startedAt: string | null;
  finishedAt: string | null;
  itemCount: number;
  error: string | null;
}

export interface ConvexConfig {
  deploymentUrl: string;
  workspaceKey: string;
  syncToken: string;
  label: string | null;
  savedAt: string;
}

export interface ConvexSyncState {
  status: ConvexPushStatus;
  startedAt: string | null;
  finishedAt: string | null;
  runKey: string | null;
  totalBatches: number;
  uploadedBatches: number;
  uploadedConnections: number;
  remoteConnectionCount: number | null;
  remoteFollowerCount: number | null;
  error: string | null;
  lastSuccessfulPushAt: string | null;
}

export interface ProfileMetric {
  label: string;
  value: string;
}

export interface ActivityItem {
  id: string;
  activityUrn: string | null;
  analyticsUrl: string | null;
  analyticsStatus: "idle" | "success" | "unavailable" | "failed";
  analyticsError: string | null;
  kind: string | null;
  timestampLabel: string | null;
  actor: string | null;
  headline: string | null;
  text: string | null;
  permalink: string | null;
  reactionCount: string | null;
  commentCount: string | null;
  repostCount: string | null;
  analyticsMetrics: ProfileMetric[];
  analyticsCapturedAt: string | null;
  raw: unknown;
}

export interface OwnActivitySnapshot {
  publicIdentifier: string | null;
  profileUrl: string | null;
  profileHeadline: string | null;
  followerCount: string | null;
  connectionCount: string | null;
  dashboardMetrics: ProfileMetric[];
  activityItems: ActivityItem[];
  capturedAt: string;
  raw: {
    profile: unknown;
    activity: unknown;
    analytics?: unknown;
  };
}

export interface ActivityScrapeState {
  status: ActivitySyncStatus;
  startedAt: string | null;
  finishedAt: string | null;
  itemCount: number;
  analyticsCount: number;
  error: string | null;
}

export interface ExtensionState {
  authState: AuthState;
  userProfile: UserProfile | null;
  pageScrape: PageScrape | null;
  connectionSync: ConnectionSyncState;
  connections: ConnectionRecord[];
  followerSync: FollowerSyncState;
  followers: FollowerRecord[];
  activitySnapshot: OwnActivitySnapshot | null;
  activitySync: ActivityScrapeState;
  convexConfig: ConvexConfig | null;
  convexSync: ConvexSyncState;
}

export type PopupRequest =
  | { type: "PING" }
  | { type: "GET_LINKEDIN_AUTH" }
  | { type: "GET_LINKEDIN_USER_PROFILE" }
  | { type: "SCRAPE_ACTIVE_PAGE" }
  | { type: "SCRAPE_SELF_ACTIVITY" }
  | { type: "SYNC_POST_ANALYTICS" }
  | { type: "SYNC_CONNECTIONS" }
  | { type: "SYNC_FOLLOWERS" }
  | {
      type: "SAVE_CONVEX_CONFIG";
      payload: {
        deploymentUrl: string;
        workspaceKey: string;
        syncToken: string;
        label?: string;
      };
    }
  | { type: "PUSH_TO_CONVEX" }
  | { type: "CLEAR_SESSION_STATE" };

export interface ProxyRequestPayload {
  id: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

export type BackgroundToContentMessage =
  | { type: "PING" }
  | { type: "LINKEDIN_API_REQUEST"; payload: ProxyRequestPayload };

export interface ProxyResponse {
  id: string;
  success: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

export interface PopupResponse {
  success: boolean;
  error?: string;
  authState?: AuthState;
  userProfile?: UserProfile | null;
  scrapeResult?: PageScrape | null;
  activitySnapshot?: OwnActivitySnapshot | null;
  activitySync?: ActivityScrapeState;
  syncResult?: ConnectionSyncState;
  connections?: ConnectionRecord[];
  followerSync?: FollowerSyncState;
  followers?: FollowerRecord[];
  convexConfig?: ConvexConfig | null;
  convexSync?: ConvexSyncState;
  state?: ExtensionState;
}
