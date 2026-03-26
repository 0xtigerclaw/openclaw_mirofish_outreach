import {
  type ActivityScrapeState,
  type AuthState,
  type ConnectionRecord,
  type ConvexConfig,
  type ConvexSyncState,
  type ConnectionSyncState,
  type ExtensionState,
  type FollowerRecord,
  type FollowerSyncState,
  type OwnActivitySnapshot,
  type PageScrape,
  type SessionStateInternal,
  type UserProfile
} from "../types";
import { getBundledConvexConfig } from "./defaultConfig";

export const STORAGE_KEYS = {
  session: "session_state",
  auth: "auth_state",
  userProfile: "user_profile",
  pageScrape: "page_scrape",
  activitySnapshot: "activity_snapshot",
  activitySync: "activity_sync",
  connectionSync: "connections_sync",
  connections: "connections",
  followerSync: "followers_sync",
  followers: "followers",
  convexConfig: "convex_config",
  convexSync: "convex_sync",
  managedTabId: "managed_linkedin_tab_id"
} as const;

export const defaultAuthState: AuthState = {
  isAuthenticated: false,
  cookieCount: 0,
  csrfPresent: false,
  capturedAt: null
};

export const defaultConnectionSync: ConnectionSyncState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  pageCount: 0,
  connectionCount: 0,
  error: null
};

export const defaultActivitySync: ActivityScrapeState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  itemCount: 0,
  analyticsCount: 0,
  error: null
};

export const defaultFollowerSync: FollowerSyncState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  itemCount: 0,
  error: null
};

export const defaultConvexSync: ConvexSyncState = {
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

async function getLocal<T>(key: string): Promise<T | null> {
  const data = await chrome.storage.local.get(key);
  return (data[key] as T | undefined) ?? null;
}

async function setLocal<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function readSessionState(): Promise<SessionStateInternal | null> {
  return getLocal<SessionStateInternal>(STORAGE_KEYS.session);
}

export async function writeSessionState(session: SessionStateInternal | null): Promise<void> {
  if (session) {
    await setLocal(STORAGE_KEYS.session, session);
    return;
  }
  await chrome.storage.local.remove(STORAGE_KEYS.session);
}

export async function writeAuthState(authState: AuthState): Promise<void> {
  await setLocal(STORAGE_KEYS.auth, authState);
}

export async function writeUserProfile(userProfile: UserProfile | null): Promise<void> {
  if (userProfile) {
    await setLocal(STORAGE_KEYS.userProfile, userProfile);
    return;
  }
  await chrome.storage.local.remove(STORAGE_KEYS.userProfile);
}

export async function writePageScrape(pageScrape: PageScrape | null): Promise<void> {
  if (pageScrape) {
    await setLocal(STORAGE_KEYS.pageScrape, pageScrape);
    return;
  }
  await chrome.storage.local.remove(STORAGE_KEYS.pageScrape);
}

export async function writeActivitySnapshot(activitySnapshot: OwnActivitySnapshot | null): Promise<void> {
  if (activitySnapshot) {
    await setLocal(STORAGE_KEYS.activitySnapshot, activitySnapshot);
    return;
  }
  await chrome.storage.local.remove(STORAGE_KEYS.activitySnapshot);
}

export async function writeActivitySyncState(activitySync: ActivityScrapeState): Promise<void> {
  await setLocal(STORAGE_KEYS.activitySync, activitySync);
}

export async function writeConnectionSync(connectionSync: ConnectionSyncState): Promise<void> {
  await setLocal(STORAGE_KEYS.connectionSync, connectionSync);
}

export async function writeConnections(connections: ConnectionRecord[]): Promise<void> {
  await setLocal(STORAGE_KEYS.connections, connections);
}

export async function writeFollowerSync(followerSync: FollowerSyncState): Promise<void> {
  await setLocal(STORAGE_KEYS.followerSync, followerSync);
}

export async function writeFollowers(followers: FollowerRecord[]): Promise<void> {
  await setLocal(STORAGE_KEYS.followers, followers);
}

export async function writeConvexConfig(convexConfig: ConvexConfig | null): Promise<void> {
  if (convexConfig) {
    await setLocal(STORAGE_KEYS.convexConfig, convexConfig);
    return;
  }
  await chrome.storage.local.remove(STORAGE_KEYS.convexConfig);
}

export async function readConvexConfig(): Promise<ConvexConfig | null> {
  return (await getLocal<ConvexConfig>(STORAGE_KEYS.convexConfig)) ?? getBundledConvexConfig();
}

export async function writeConvexSyncState(convexSync: ConvexSyncState): Promise<void> {
  await setLocal(STORAGE_KEYS.convexSync, convexSync);
}

export async function readManagedTabId(): Promise<number | null> {
  return getLocal<number>(STORAGE_KEYS.managedTabId);
}

export async function writeManagedTabId(tabId: number | null): Promise<void> {
  if (typeof tabId === "number") {
    await setLocal(STORAGE_KEYS.managedTabId, tabId);
    return;
  }
  await chrome.storage.local.remove(STORAGE_KEYS.managedTabId);
}

export async function clearAllState(): Promise<void> {
  await chrome.storage.local.remove(Object.values(STORAGE_KEYS));
}

export async function clearLinkedInState(): Promise<void> {
  await chrome.storage.local.remove([
    STORAGE_KEYS.session,
    STORAGE_KEYS.auth,
    STORAGE_KEYS.userProfile,
    STORAGE_KEYS.pageScrape,
    STORAGE_KEYS.activitySnapshot,
    STORAGE_KEYS.activitySync,
    STORAGE_KEYS.connectionSync,
    STORAGE_KEYS.connections,
    STORAGE_KEYS.followerSync,
    STORAGE_KEYS.followers,
    STORAGE_KEYS.managedTabId
  ]);
}

export async function readExtensionState(): Promise<ExtensionState> {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.auth,
    STORAGE_KEYS.userProfile,
    STORAGE_KEYS.pageScrape,
    STORAGE_KEYS.activitySnapshot,
    STORAGE_KEYS.activitySync,
    STORAGE_KEYS.connectionSync,
    STORAGE_KEYS.connections,
    STORAGE_KEYS.followerSync,
    STORAGE_KEYS.followers,
    STORAGE_KEYS.convexConfig,
    STORAGE_KEYS.convexSync
  ]);

  return {
    authState: (data[STORAGE_KEYS.auth] as AuthState | undefined) ?? defaultAuthState,
    userProfile: (data[STORAGE_KEYS.userProfile] as UserProfile | undefined) ?? null,
    pageScrape: (data[STORAGE_KEYS.pageScrape] as PageScrape | undefined) ?? null,
    activitySnapshot: (data[STORAGE_KEYS.activitySnapshot] as OwnActivitySnapshot | undefined) ?? null,
    activitySync: {
      ...defaultActivitySync,
      ...((data[STORAGE_KEYS.activitySync] as ActivityScrapeState | undefined) ?? {})
    },
    connectionSync:
      (data[STORAGE_KEYS.connectionSync] as ConnectionSyncState | undefined) ?? defaultConnectionSync,
    connections: (data[STORAGE_KEYS.connections] as ConnectionRecord[] | undefined) ?? [],
    followerSync: {
      ...defaultFollowerSync,
      ...((data[STORAGE_KEYS.followerSync] as FollowerSyncState | undefined) ?? {})
    },
    followers: (data[STORAGE_KEYS.followers] as FollowerRecord[] | undefined) ?? [],
    convexConfig:
      (data[STORAGE_KEYS.convexConfig] as ConvexConfig | undefined) ?? getBundledConvexConfig() ?? null,
    convexSync: {
      ...defaultConvexSync,
      ...((data[STORAGE_KEYS.convexSync] as ConvexSyncState | undefined) ?? {})
    }
  };
}
