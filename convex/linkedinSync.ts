import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function asRecord(value: unknown): Record<string, any> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, any>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toTimestamp(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pickDefinedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function extractActivityUrn(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) {
    return undefined;
  }

  const urnMatch = text.match(/urn:li:activity:\d+/u);
  if (urnMatch?.[0]) {
    return urnMatch[0];
  }

  const postsMatch = text.match(/activity-(\d+)/u);
  if (postsMatch?.[1]) {
    return `urn:li:activity:${postsMatch[1]}`;
  }

  return undefined;
}

function buildPostKey(candidate: {
  activityUrn?: string;
  permalink?: string;
  analyticsUrl?: string;
}): string | undefined {
  return candidate.activityUrn ?? candidate.permalink ?? candidate.analyticsUrl;
}

function buildFollowerKey(candidate: {
  publicIdentifier?: string;
  profileUrl?: string;
}): string | undefined {
  return candidate.publicIdentifier ?? candidate.profileUrl;
}

function mergeMetricArrays(existing: unknown, incoming: unknown): Array<{ label: string; value: string }> | undefined {
  const merged = new Map<string, { label: string; value: string }>();

  for (const source of [existing, incoming]) {
    if (!Array.isArray(source)) {
      continue;
    }

    for (const item of source) {
      const record = asRecord(item);
      const label = asString(record?.label);
      const value = asString(record?.value);
      if (!label || !value) {
        continue;
      }
      merged.set(label.toLowerCase(), { label, value });
    }
  }

  return merged.size ? Array.from(merged.values()) : undefined;
}

function compactActivitySnapshot(snapshot: unknown): unknown {
  const record = asRecord(snapshot);
  if (!record) {
    return snapshot;
  }

  return {
    publicIdentifier: asString(record.publicIdentifier) ?? null,
    profileUrl: asString(record.profileUrl) ?? null,
    profileHeadline: asString(record.profileHeadline) ?? null,
    followerCount: asString(record.followerCount) ?? null,
    connectionCount: asString(record.connectionCount) ?? null,
    dashboardMetrics: Array.isArray(record.dashboardMetrics) ? record.dashboardMetrics : [],
    itemCount: Array.isArray(record.activityItems) ? record.activityItems.length : 0,
    analyticsCount: Array.isArray(record.activityItems)
      ? record.activityItems.filter((item: unknown) => {
          const current = asRecord(item);
          return Array.isArray(current?.analyticsMetrics) && current.analyticsMetrics.length > 0;
        }).length
      : 0,
    capturedAt: asString(record.capturedAt) ?? null
  };
}

function compactPageScrape(pageScrape: unknown): unknown {
  const record = asRecord(pageScrape);
  if (!record) {
    return pageScrape;
  }

  if (record.pageType !== "postAnalytics") {
    return pageScrape;
  }

  const normalized = asRecord(record.normalized);
  const metricCount = Array.isArray(normalized?.metrics) ? normalized.metrics.length : 0;

  return {
    pageType: record.pageType,
    url: asString(record.url) ?? null,
    capturedAt: asString(record.capturedAt) ?? null,
    normalized: normalized
      ? {
          activityUrn: asString(normalized.activityUrn) ?? null,
          analyticsUrl: asString(normalized.analyticsUrl) ?? null,
          postUrl: asString(normalized.postUrl) ?? null,
          author: asString(normalized.author) ?? null,
          publishedLabel: asString(normalized.publishedLabel) ?? null,
          status: asString(normalized.status) ?? null,
          errorMessage: asString(normalized.errorMessage) ?? null,
          metricCount
        }
      : null
  };
}

function compactFollowerSync(followerSync: unknown): unknown {
  const record = asRecord(followerSync);
  if (!record) {
    return followerSync;
  }

  return {
    status: asString(record.status) ?? null,
    startedAt: asString(record.startedAt) ?? null,
    finishedAt: asString(record.finishedAt) ?? null,
    itemCount: typeof record.itemCount === "number" ? record.itemCount : 0,
    error: asString(record.error) ?? null
  };
}

async function upsertWorkspaceFollowers(
  ctx: { db: any },
  workspaceKey: string,
  runKey: string,
  followers: unknown
): Promise<number> {
  const now = Date.now();
  const candidates = new Map<
    string,
    {
      profileKey: string;
      publicIdentifier?: string;
      profileUrl?: string;
      fullName?: string;
      headline?: string;
      relationshipLabel?: string;
      latestRaw?: unknown;
    }
  >();

  for (const item of Array.isArray(followers) ? followers : []) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const publicIdentifier = asString(record.publicIdentifier);
    const profileUrl = asString(record.profileUrl);
    const profileKey = buildFollowerKey({ publicIdentifier, profileUrl });
    if (!profileKey) {
      continue;
    }

    const existing = candidates.get(profileKey);
    candidates.set(profileKey, {
      profileKey,
      publicIdentifier: publicIdentifier ?? existing?.publicIdentifier,
      profileUrl: profileUrl ?? existing?.profileUrl,
      fullName: pickDefinedString(existing?.fullName, record.fullName),
      headline: pickDefinedString(existing?.headline, record.headline),
      relationshipLabel: pickDefinedString(existing?.relationshipLabel, record.relationshipLabel),
      latestRaw: record.raw ?? existing?.latestRaw
    });
  }

  for (const candidate of candidates.values()) {
    const existing = await ctx.db
      .query("linkedinFollowers")
      .withIndex("by_workspaceKey_profileKey", (queryBuilder: any) =>
        queryBuilder.eq("workspaceKey", workspaceKey).eq("profileKey", candidate.profileKey)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        publicIdentifier: candidate.publicIdentifier ?? existing.publicIdentifier,
        profileUrl: candidate.profileUrl ?? existing.profileUrl,
        fullName: candidate.fullName ?? existing.fullName,
        headline: candidate.headline ?? existing.headline,
        relationshipLabel: candidate.relationshipLabel ?? existing.relationshipLabel,
        latestRaw: candidate.latestRaw ?? existing.latestRaw,
        lastSeenAt: now,
        lastRunKey: runKey,
        updatedAt: now
      });
      continue;
    }

    await ctx.db.insert("linkedinFollowers", {
      workspaceKey,
      profileKey: candidate.profileKey,
      publicIdentifier: candidate.publicIdentifier,
      profileUrl: candidate.profileUrl,
      fullName: candidate.fullName,
      headline: candidate.headline,
      relationshipLabel: candidate.relationshipLabel,
      latestRaw: candidate.latestRaw,
      firstSeenAt: now,
      lastSeenAt: now,
      lastRunKey: runKey,
      createdAt: now,
      updatedAt: now
    });
  }

  return candidates.size;
}

async function upsertWorkspacePosts(
  ctx: { db: any },
  workspaceKey: string,
  runKey: string,
  pageScrape: unknown,
  activitySnapshot: unknown
): Promise<number> {
  const now = Date.now();
  const candidates = new Map<
    string,
    {
      postKey: string;
      activityUrn?: string;
      permalink?: string;
      analyticsUrl?: string;
      author?: string;
      postText?: string;
      publishedLabel?: string;
      latestActivityStats?: Record<string, unknown>;
      latestAnalytics?: Array<{ label: string; value: string }>;
    }
  >();

  const activityRecord = asRecord(activitySnapshot);
  const capturedAt = toTimestamp(activityRecord?.capturedAt, now);

  for (const item of Array.isArray(activityRecord?.activityItems) ? activityRecord.activityItems : []) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const permalink = asString(record.permalink);
    const analyticsUrl = asString(record.analyticsUrl);
    const activityUrn =
      extractActivityUrn(record.activityUrn) ??
      extractActivityUrn(record.id) ??
      extractActivityUrn(permalink) ??
      extractActivityUrn(analyticsUrl);
    const postKey = buildPostKey({ activityUrn, permalink, analyticsUrl });
    if (!postKey) {
      continue;
    }

    const existing = candidates.get(postKey);
    candidates.set(postKey, {
      postKey,
      activityUrn: activityUrn ?? existing?.activityUrn,
      permalink: permalink ?? existing?.permalink,
      analyticsUrl: analyticsUrl ?? existing?.analyticsUrl,
      author: pickDefinedString(existing?.author, record.actor),
      postText: pickDefinedString(existing?.postText, record.text, record.headline),
      publishedLabel: pickDefinedString(existing?.publishedLabel, record.timestampLabel),
      latestAnalytics: mergeMetricArrays(existing?.latestAnalytics, record.analyticsMetrics) ?? existing?.latestAnalytics,
      latestActivityStats: {
        kind: asString(record.kind) ?? null,
        timestampLabel: asString(record.timestampLabel) ?? null,
        reactionCount: asString(record.reactionCount) ?? null,
        commentCount: asString(record.commentCount) ?? null,
        repostCount: asString(record.repostCount) ?? null,
        analyticsStatus: asString(record.analyticsStatus) ?? null,
        analyticsError: asString(record.analyticsError) ?? null,
        capturedAt: toTimestamp(record.analyticsCapturedAt, capturedAt)
      }
    });
  }

  const pageScrapeRecord = asRecord(pageScrape);
  if (pageScrapeRecord?.pageType === "postAnalytics") {
    const normalized = asRecord(pageScrapeRecord.normalized);
    const status = asString(normalized?.status);
    const analyticsUrl = pickDefinedString(normalized?.analyticsUrl, pageScrapeRecord.url);
    const activityUrn =
      extractActivityUrn(normalized?.activityUrn) ??
      extractActivityUrn(normalized?.postUrl) ??
      extractActivityUrn(analyticsUrl);
    const permalink = asString(normalized?.postUrl);
    const postKey = buildPostKey({ activityUrn, permalink, analyticsUrl });

    if (postKey) {
      const existing = candidates.get(postKey);
      candidates.set(postKey, {
        postKey,
        activityUrn: activityUrn ?? existing?.activityUrn,
        permalink: permalink ?? existing?.permalink,
        analyticsUrl: analyticsUrl ?? existing?.analyticsUrl,
        author: pickDefinedString(existing?.author, normalized?.author),
        postText: status === "success" ? pickDefinedString(existing?.postText, normalized?.postText) : existing?.postText,
        publishedLabel: pickDefinedString(existing?.publishedLabel, normalized?.publishedLabel),
        latestActivityStats:
          status && status !== "success"
            ? {
                ...(existing?.latestActivityStats ?? {}),
                analyticsStatus: status,
                analyticsError: asString(normalized?.errorMessage) ?? null
              }
            : existing?.latestActivityStats,
        latestAnalytics: status === "success" ? mergeMetricArrays(existing?.latestAnalytics, normalized?.metrics) : existing?.latestAnalytics
      });
    }
  }

  for (const candidate of candidates.values()) {
    const existing = await ctx.db
      .query("linkedinPosts")
      .withIndex("by_workspaceKey_postKey", (queryBuilder: any) =>
        queryBuilder.eq("workspaceKey", workspaceKey).eq("postKey", candidate.postKey)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        activityUrn: candidate.activityUrn ?? existing.activityUrn,
        permalink: candidate.permalink ?? existing.permalink,
        analyticsUrl: candidate.analyticsUrl ?? existing.analyticsUrl,
        author: candidate.author ?? existing.author,
        postText: candidate.postText ?? existing.postText,
        publishedLabel: candidate.publishedLabel ?? existing.publishedLabel,
        latestActivityStats: candidate.latestActivityStats ?? existing.latestActivityStats,
        latestAnalytics: mergeMetricArrays(existing.latestAnalytics, candidate.latestAnalytics) ?? existing.latestAnalytics,
        lastSeenAt: now,
        lastRunKey: runKey,
        updatedAt: now
      });
      continue;
    }

    await ctx.db.insert("linkedinPosts", {
      workspaceKey,
      postKey: candidate.postKey,
      activityUrn: candidate.activityUrn,
      permalink: candidate.permalink,
      analyticsUrl: candidate.analyticsUrl,
      author: candidate.author,
      postText: candidate.postText,
      publishedLabel: candidate.publishedLabel,
      latestActivityStats: candidate.latestActivityStats,
      latestAnalytics: candidate.latestAnalytics,
      firstSeenAt: now,
      lastSeenAt: now,
      lastRunKey: runKey,
      createdAt: now,
      updatedAt: now
    });
  }

  return candidates.size;
}

async function requireInstallation(
  ctx: { db: any },
  workspaceKey: string,
  syncToken: string
) {
  const installation = await ctx.db
    .query("extensionInstallations")
    .withIndex("by_workspaceKey", (queryBuilder: any) => queryBuilder.eq("workspaceKey", workspaceKey))
    .unique();

  if (!installation || installation.syncToken !== syncToken) {
    throw new Error("Invalid Convex workspace key or sync token.");
  }

  return installation;
}

async function getRunByKey(ctx: { db: any }, workspaceKey: string, runKey: string) {
  return ctx.db
    .query("linkedinSyncRuns")
    .withIndex("by_workspaceKey_runKey", (queryBuilder: any) =>
      queryBuilder.eq("workspaceKey", workspaceKey).eq("runKey", runKey)
    )
    .unique();
}

export const upsertInstallation = mutation({
  args: {
    workspaceKey: v.string(),
    syncToken: v.string(),
    label: v.optional(v.string()),
    deploymentUrl: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("extensionInstallations")
      .withIndex("by_workspaceKey", (queryBuilder: any) => queryBuilder.eq("workspaceKey", args.workspaceKey))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        syncToken: args.syncToken,
        label: args.label ?? existing.label,
        deploymentUrl: args.deploymentUrl ?? existing.deploymentUrl,
        updatedAt: now
      });

      return {
        created: false,
        workspaceKey: args.workspaceKey
      };
    }

    await ctx.db.insert("extensionInstallations", {
      workspaceKey: args.workspaceKey,
      syncToken: args.syncToken,
      label: args.label,
      deploymentUrl: args.deploymentUrl,
      createdAt: now,
      updatedAt: now
    });

    return {
      created: true,
      workspaceKey: args.workspaceKey
    };
  }
});

export const startSyncUpload = mutation({
  args: {
    workspaceKey: v.string(),
    syncToken: v.string(),
    runKey: v.string(),
    authState: v.any(),
    userProfile: v.any(),
    pageScrape: v.any(),
    activitySnapshot: v.optional(v.any()),
    followerSync: v.optional(v.any()),
    followers: v.optional(v.array(v.any())),
    connectionSync: v.any(),
    connectionCount: v.number(),
    totalBatches: v.number()
  },
  handler: async (ctx, args) => {
    const installation = await requireInstallation(ctx, args.workspaceKey, args.syncToken);
    const now = Date.now();
    const existingRun = await getRunByKey(ctx, args.workspaceKey, args.runKey);

    if (existingRun) {
      await ctx.db.patch(existingRun._id, {
        status: "uploading",
        authState: args.authState,
        userProfile: args.userProfile,
        pageScrape: compactPageScrape(args.pageScrape),
        activitySnapshot: compactActivitySnapshot(args.activitySnapshot),
        followerSync: compactFollowerSync(args.followerSync),
        followerCount: Array.isArray(args.followers) ? args.followers.length : 0,
        connectionSync: args.connectionSync,
        connectionCount: args.connectionCount,
        totalBatches: args.totalBatches,
        uploadedBatches: 0,
        lastError: undefined,
        updatedAt: now,
        completedAt: undefined
      });
    } else {
      await ctx.db.insert("linkedinSyncRuns", {
        workspaceKey: args.workspaceKey,
        runKey: args.runKey,
        status: "uploading",
        authState: args.authState,
        userProfile: args.userProfile,
        pageScrape: compactPageScrape(args.pageScrape),
        activitySnapshot: compactActivitySnapshot(args.activitySnapshot),
        followerSync: compactFollowerSync(args.followerSync),
        followerCount: Array.isArray(args.followers) ? args.followers.length : 0,
        connectionSync: args.connectionSync,
        connectionCount: args.connectionCount,
        totalBatches: args.totalBatches,
        uploadedBatches: 0,
        startedAt: now,
        updatedAt: now
      });
    }

    const uniquePostCount = await upsertWorkspacePosts(
      ctx,
      args.workspaceKey,
      args.runKey,
      args.pageScrape,
      args.activitySnapshot
    );
    const uniqueFollowerCount = await upsertWorkspaceFollowers(ctx, args.workspaceKey, args.runKey, args.followers);

    await ctx.db.patch(installation._id, {
      updatedAt: now,
      latestRunKey: args.runKey
    });

    return {
      runKey: args.runKey,
      status: "uploading",
      totalBatches: args.totalBatches,
      uniquePostCount,
      uniqueFollowerCount
    };
  }
});

export const uploadConnectionBatch = mutation({
  args: {
    workspaceKey: v.string(),
    syncToken: v.string(),
    runKey: v.string(),
    batchIndex: v.number(),
    records: v.array(v.any())
  },
  handler: async (ctx, args) => {
    await requireInstallation(ctx, args.workspaceKey, args.syncToken);
    const run = await getRunByKey(ctx, args.workspaceKey, args.runKey);
    if (!run) {
      throw new Error("Sync run not found.");
    }

    const now = Date.now();
    const existingBatch = await ctx.db
      .query("linkedinConnectionBatches")
      .withIndex("by_workspaceKey_runKey_batchIndex", (queryBuilder: any) =>
        queryBuilder
          .eq("workspaceKey", args.workspaceKey)
          .eq("runKey", args.runKey)
          .eq("batchIndex", args.batchIndex)
      )
      .unique();

    if (existingBatch) {
      await ctx.db.patch(existingBatch._id, {
        records: args.records,
        recordCount: args.records.length,
        uploadedAt: now
      });
    } else {
      await ctx.db.insert("linkedinConnectionBatches", {
        workspaceKey: args.workspaceKey,
        runKey: args.runKey,
        batchIndex: args.batchIndex,
        records: args.records,
        recordCount: args.records.length,
        uploadedAt: now
      });
    }

    await ctx.db.patch(run._id, {
      uploadedBatches: Math.max(run.uploadedBatches, args.batchIndex + 1),
      updatedAt: now
    });

    return {
      runKey: args.runKey,
      batchIndex: args.batchIndex,
      recordCount: args.records.length
    };
  }
});

export const completeSyncUpload = mutation({
  args: {
    workspaceKey: v.string(),
    syncToken: v.string(),
    runKey: v.string()
  },
  handler: async (ctx, args) => {
    const installation = await requireInstallation(ctx, args.workspaceKey, args.syncToken);
    const run = await getRunByKey(ctx, args.workspaceKey, args.runKey);
    if (!run) {
      throw new Error("Sync run not found.");
    }

    const batches = await ctx.db
      .query("linkedinConnectionBatches")
      .withIndex("by_workspaceKey_runKey", (queryBuilder: any) =>
        queryBuilder.eq("workspaceKey", args.workspaceKey).eq("runKey", args.runKey)
      )
      .collect();

    const connectionCount = batches.reduce((sum, batch) => sum + batch.recordCount, 0);
    const followers = await ctx.db
      .query("linkedinFollowers")
      .withIndex("by_workspaceKey", (queryBuilder: any) => queryBuilder.eq("workspaceKey", args.workspaceKey))
      .collect();
    const followerCount = followers.length;
    const now = Date.now();

    await ctx.db.patch(run._id, {
      status: "success",
      uploadedBatches: batches.length,
      connectionCount,
      followerCount,
      updatedAt: now,
      completedAt: now,
      lastError: undefined
    });

    const installationPatch: Record<string, unknown> = {
      lastPushAt: now,
      latestRunKey: args.runKey,
      updatedAt: now
    };
    const connectionSyncRecord = asRecord(run.connectionSync);
    const followerSyncRecord = asRecord(run.followerSync);
    if (batches.length > 0 || asString(connectionSyncRecord?.status) === "success") {
      installationPatch.lastConnectionCount = connectionCount;
    }
    if (["success", "error", "running"].includes(asString(followerSyncRecord?.status) ?? "")) {
      installationPatch.lastFollowerCount = followerCount;
    }

    await ctx.db.patch(installation._id, installationPatch);

    return {
      runKey: args.runKey,
      uploadedBatches: batches.length,
      connectionCount,
      followerCount
    };
  }
});

export const getLatestWorkspaceSnapshot = query({
  args: {
    workspaceKey: v.string(),
    syncToken: v.string()
  },
  handler: async (ctx, args) => {
    const installation = await requireInstallation(ctx, args.workspaceKey, args.syncToken);
    const latestRunKey = installation.latestRunKey;
    if (!latestRunKey) {
      return {
        installation,
        run: null,
        batches: []
      };
    }

    const run = await getRunByKey(ctx, args.workspaceKey, latestRunKey);
    const batches = await ctx.db
      .query("linkedinConnectionBatches")
      .withIndex("by_workspaceKey_runKey", (queryBuilder: any) =>
        queryBuilder.eq("workspaceKey", args.workspaceKey).eq("runKey", latestRunKey)
      )
      .collect();

    return {
      installation,
      run,
      batches
    };
  }
});

export const getWorkspacePosts = query({
  args: {
    workspaceKey: v.string(),
    syncToken: v.string()
  },
  handler: async (ctx, args) => {
    await requireInstallation(ctx, args.workspaceKey, args.syncToken);
    const posts = await ctx.db
      .query("linkedinPosts")
      .withIndex("by_workspaceKey", (queryBuilder: any) => queryBuilder.eq("workspaceKey", args.workspaceKey))
      .collect();

    return posts.sort((left: any, right: any) => right.updatedAt - left.updatedAt);
  }
});

export const getWorkspaceConnections = query({
  args: {
    workspaceKey: v.string(),
    syncToken: v.string()
  },
  handler: async (ctx, args) => {
    await requireInstallation(ctx, args.workspaceKey, args.syncToken);
    const runs = await ctx.db
      .query("linkedinSyncRuns")
      .withIndex("by_workspaceKey", (queryBuilder: any) => queryBuilder.eq("workspaceKey", args.workspaceKey))
      .collect();

    const sortedRuns = runs.sort((left: any, right: any) => {
      const leftTime = left.completedAt ?? left.updatedAt ?? left.startedAt ?? 0;
      const rightTime = right.completedAt ?? right.updatedAt ?? right.startedAt ?? 0;
      return rightTime - leftTime;
    });

    const selectedRun =
      sortedRuns.find((run: any) => run.status === "success" && run.connectionCount > 0) ??
      sortedRuns.find((run: any) => run.connectionCount > 0) ??
      sortedRuns[0] ??
      null;

    if (!selectedRun) {
      return {
        run: null,
        connections: []
      };
    }

    const batches = await ctx.db
      .query("linkedinConnectionBatches")
      .withIndex("by_workspaceKey_runKey", (queryBuilder: any) =>
        queryBuilder.eq("workspaceKey", args.workspaceKey).eq("runKey", selectedRun.runKey)
      )
      .collect();

    const connections = batches
      .sort((left: any, right: any) => left.batchIndex - right.batchIndex)
      .flatMap((batch: any) => (Array.isArray(batch.records) ? batch.records : []));

    return {
      run: selectedRun,
      connections
    };
  }
});

export const getWorkspaceFollowers = query({
  args: {
    workspaceKey: v.string(),
    syncToken: v.string()
  },
  handler: async (ctx, args) => {
    await requireInstallation(ctx, args.workspaceKey, args.syncToken);
    const followers = await ctx.db
      .query("linkedinFollowers")
      .withIndex("by_workspaceKey", (queryBuilder: any) => queryBuilder.eq("workspaceKey", args.workspaceKey))
      .collect();

    return followers.sort((left: any, right: any) => right.updatedAt - left.updatedAt);
  }
});
