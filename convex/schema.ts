import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  extensionInstallations: defineTable({
    workspaceKey: v.string(),
    syncToken: v.string(),
    label: v.optional(v.string()),
    deploymentUrl: v.optional(v.string()),
    latestRunKey: v.optional(v.string()),
    lastPushAt: v.optional(v.number()),
    lastConnectionCount: v.optional(v.number()),
    lastFollowerCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_workspaceKey", ["workspaceKey"]),

  linkedinSyncRuns: defineTable({
    workspaceKey: v.string(),
    runKey: v.string(),
    status: v.string(),
    authState: v.any(),
    userProfile: v.any(),
    pageScrape: v.any(),
    activitySnapshot: v.optional(v.any()),
    followerSync: v.optional(v.any()),
    followerCount: v.optional(v.number()),
    connectionSync: v.any(),
    connectionCount: v.number(),
    totalBatches: v.number(),
    uploadedBatches: v.number(),
    lastError: v.optional(v.string()),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number())
  })
    .index("by_workspaceKey", ["workspaceKey"])
    .index("by_workspaceKey_runKey", ["workspaceKey", "runKey"]),

  linkedinConnectionBatches: defineTable({
    workspaceKey: v.string(),
    runKey: v.string(),
    batchIndex: v.number(),
    records: v.array(v.any()),
    recordCount: v.number(),
    uploadedAt: v.number()
  })
    .index("by_workspaceKey_runKey", ["workspaceKey", "runKey"])
    .index("by_workspaceKey_runKey_batchIndex", ["workspaceKey", "runKey", "batchIndex"]),

  linkedinPosts: defineTable({
    workspaceKey: v.string(),
    postKey: v.string(),
    activityUrn: v.optional(v.string()),
    permalink: v.optional(v.string()),
    analyticsUrl: v.optional(v.string()),
    author: v.optional(v.string()),
    postText: v.optional(v.string()),
    publishedLabel: v.optional(v.string()),
    latestActivityStats: v.optional(v.any()),
    latestAnalytics: v.optional(v.any()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    lastRunKey: v.string(),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_workspaceKey", ["workspaceKey"])
    .index("by_workspaceKey_postKey", ["workspaceKey", "postKey"]),

  linkedinFollowers: defineTable({
    workspaceKey: v.string(),
    profileKey: v.string(),
    publicIdentifier: v.optional(v.string()),
    profileUrl: v.optional(v.string()),
    fullName: v.optional(v.string()),
    headline: v.optional(v.string()),
    relationshipLabel: v.optional(v.string()),
    latestRaw: v.optional(v.any()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    lastRunKey: v.string(),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_workspaceKey", ["workspaceKey"])
    .index("by_workspaceKey_profileKey", ["workspaceKey", "profileKey"])
});
