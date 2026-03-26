import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLinkedInPostAnalyticsUrl,
  countActivityItemsWithAnalytics,
  extractLinkedInActivityUrn,
  mergeActivityItemAnalytics,
  normalizeActivityItemReferences
} from "../src/lib/activity";
import type { ActivityItem, NormalizedPostAnalytics } from "../src/types";

test("extractLinkedInActivityUrn resolves LinkedIn activity identifiers from multiple URL shapes", () => {
  assert.equal(extractLinkedInActivityUrn("urn:li:activity:7442359911570821120"), "urn:li:activity:7442359911570821120");
  assert.equal(
    extractLinkedInActivityUrn("https://www.linkedin.com/feed/update/urn:li:activity:7442359911570821120/"),
    "urn:li:activity:7442359911570821120"
  );
  assert.equal(
    extractLinkedInActivityUrn("https://www.linkedin.com/posts/exampleuser_example-activity-7442359911570821120-abc"),
    "urn:li:activity:7442359911570821120"
  );
});

test("normalizeActivityItemReferences derives analytics URLs from activity URNs", () => {
  const item = normalizeActivityItemReferences({
    id: "urn:li:activity:7442359911570821120",
    activityUrn: null,
    analyticsUrl: null,
    analyticsStatus: "idle",
    analyticsError: null,
    kind: "post",
    timestampLabel: "1d",
    actor: "Swayam Shah",
    headline: "Post title",
    text: "Post body",
    permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7442359911570821120/",
    reactionCount: "12",
    commentCount: "3",
    repostCount: "1",
    analyticsMetrics: [],
    analyticsCapturedAt: null,
    raw: {}
  } satisfies ActivityItem);

  assert.equal(item.activityUrn, "urn:li:activity:7442359911570821120");
  assert.equal(
    item.analyticsUrl,
    buildLinkedInPostAnalyticsUrl("urn:li:activity:7442359911570821120")
  );
});

test("mergeActivityItemAnalytics enriches a feed item with detailed analytics", () => {
  const item: ActivityItem = {
    id: "urn:li:activity:7442359911570821120",
    activityUrn: "urn:li:activity:7442359911570821120",
    analyticsUrl: "https://www.linkedin.com/analytics/post-summary/urn%3Ali%3Aactivity%3A7442359911570821120/",
    analyticsStatus: "idle",
    analyticsError: null,
    kind: "post",
    timestampLabel: "1d",
    actor: "Swayam Shah",
    headline: "Post title",
    text: "Post body",
    permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7442359911570821120/",
    reactionCount: "12",
    commentCount: "3",
    repostCount: "1",
    analyticsMetrics: [],
    analyticsCapturedAt: null,
    raw: {}
  };
  const analytics: NormalizedPostAnalytics = {
    activityUrn: "urn:li:activity:7442359911570821120",
    analyticsUrl: "https://www.linkedin.com/analytics/post-summary/urn%3Ali%3Aactivity%3A7442359911570821120/",
    postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:7442359911570821120/",
    author: "Swayam Shah",
    postText: "Longer canonical post body",
    publishedLabel: "1d",
    status: "success",
    errorMessage: null,
    metrics: [
      { label: "Impressions", value: "420" },
      { label: "Engagements", value: "35" }
    ],
    raw: { metricCount: 2 }
  };

  const merged = mergeActivityItemAnalytics(item, analytics, "2026-03-25T23:00:00.000Z");

  assert.equal(merged.text, "Longer canonical post body");
  assert.equal(merged.analyticsMetrics.length, 2);
  assert.equal(merged.analyticsCapturedAt, "2026-03-25T23:00:00.000Z");
  assert.equal(merged.analyticsStatus, "success");
  assert.equal(countActivityItemsWithAnalytics([item, merged]), 1);
});

test("mergeActivityItemAnalytics preserves feed text when analytics page is unavailable", () => {
  const item: ActivityItem = {
    id: "urn:li:activity:7434329940344401920",
    activityUrn: "urn:li:activity:7434329940344401920",
    analyticsUrl: "https://www.linkedin.com/analytics/post-summary/urn%3Ali%3Aactivity%3A7434329940344401920/",
    analyticsStatus: "idle",
    analyticsError: null,
    kind: "repost",
    timestampLabel: "1d",
    actor: "Swayam Shah",
    headline: "Original feed headline",
    text: "Original feed text",
    permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7434329940344401920/",
    reactionCount: null,
    commentCount: "1",
    repostCount: "1",
    analyticsMetrics: [],
    analyticsCapturedAt: null,
    raw: {}
  };
  const analytics: NormalizedPostAnalytics = {
    activityUrn: "urn:li:activity:7434329940344401920",
    analyticsUrl: item.analyticsUrl,
    postUrl: item.permalink,
    author: null,
    postText: "Post analytics No results found",
    publishedLabel: "1d",
    status: "unavailable",
    errorMessage: "You do not have permission to view this post analytics page.",
    metrics: [],
    raw: {}
  };

  const merged = mergeActivityItemAnalytics(item, analytics, "2026-03-26T00:30:00.000Z");

  assert.equal(merged.text, "Original feed text");
  assert.equal(merged.headline, "Original feed headline");
  assert.equal(merged.analyticsStatus, "unavailable");
  assert.equal(merged.analyticsError, "You do not have permission to view this post analytics page.");
  assert.equal(merged.analyticsMetrics.length, 0);
});
