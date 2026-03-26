import { LINKEDIN_ROOT } from "./linkedinEndpoints";
import type { ActivityItem, NormalizedPostAnalytics } from "../types";

function trimOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractLinkedInActivityUrn(value: string | null | undefined): string | null {
  const text = trimOrNull(value);
  if (!text) {
    return null;
  }

  const urnMatch = text.match(/urn:li:activity:\d+/u);
  if (urnMatch?.[0]) {
    return urnMatch[0];
  }

  const legacyMatch = text.match(/activity-(\d+)/u);
  if (legacyMatch?.[1]) {
    return `urn:li:activity:${legacyMatch[1]}`;
  }

  return null;
}

export function buildLinkedInPostAnalyticsUrl(activityUrn: string | null | undefined): string | null {
  const normalizedUrn = extractLinkedInActivityUrn(activityUrn);
  if (!normalizedUrn) {
    return null;
  }
  return `${LINKEDIN_ROOT}/analytics/post-summary/${encodeURIComponent(normalizedUrn)}/`;
}

export function normalizeActivityItemReferences(item: ActivityItem): ActivityItem {
  const activityUrn =
    extractLinkedInActivityUrn(item.activityUrn) ??
    extractLinkedInActivityUrn(item.id) ??
    extractLinkedInActivityUrn(item.permalink) ??
    extractLinkedInActivityUrn(item.analyticsUrl);

  return {
    ...item,
    activityUrn,
    analyticsUrl: trimOrNull(item.analyticsUrl) ?? buildLinkedInPostAnalyticsUrl(activityUrn),
    analyticsStatus: item.analyticsStatus ?? "idle",
    analyticsError: trimOrNull(item.analyticsError),
    analyticsMetrics: Array.isArray(item.analyticsMetrics) ? item.analyticsMetrics : [],
    analyticsCapturedAt: trimOrNull(item.analyticsCapturedAt)
  };
}

export function mergeActivityItemAnalytics(
  item: ActivityItem,
  analytics: NormalizedPostAnalytics,
  capturedAt: string
): ActivityItem {
  const normalizedItem = normalizeActivityItemReferences(item);
  const activityUrn =
    extractLinkedInActivityUrn(analytics.activityUrn) ??
    extractLinkedInActivityUrn(analytics.postUrl) ??
    normalizedItem.activityUrn;

  const existingRaw =
    normalizedItem.raw && typeof normalizedItem.raw === "object" ? (normalizedItem.raw as Record<string, unknown>) : {};

  return {
    ...normalizedItem,
    id: activityUrn ?? normalizedItem.id,
    activityUrn,
    analyticsUrl: trimOrNull(analytics.analyticsUrl) ?? normalizedItem.analyticsUrl,
    actor: analytics.author ?? normalizedItem.actor,
    headline: analytics.status === "success" ? analytics.postText ?? normalizedItem.headline : normalizedItem.headline,
    text: analytics.status === "success" ? analytics.postText ?? normalizedItem.text : normalizedItem.text,
    permalink: analytics.postUrl ?? normalizedItem.permalink,
    timestampLabel: analytics.publishedLabel ?? normalizedItem.timestampLabel,
    analyticsStatus: analytics.status,
    analyticsError: analytics.errorMessage,
    analyticsMetrics: analytics.status === "success" ? analytics.metrics : normalizedItem.analyticsMetrics,
    analyticsCapturedAt: capturedAt,
    raw: {
      ...existingRaw,
      analytics: analytics.raw
    }
  };
}

export function countActivityItemsWithAnalytics(items: ActivityItem[]): number {
  return items.filter((item) => Array.isArray(item.analyticsMetrics) && item.analyticsMetrics.length > 0).length;
}
