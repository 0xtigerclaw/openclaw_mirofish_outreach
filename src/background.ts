import {
  buildCompanyEndpoint,
  buildConnectionsEndpoint,
  buildProfileEndpoint,
  LINKEDIN_FOLLOWERS_URL,
  LINKEDIN_ME_ENDPOINT,
  parseLinkedInUrl
} from "./lib/linkedinEndpoints";
import {
  countActivityItemsWithAnalytics,
  mergeActivityItemAnalytics,
  normalizeActivityItemReferences
} from "./lib/activity";
import { buildLinkedInHeaders, captureLinkedInSession } from "./lib/linkedinAuth";
import { getActiveTab, getOrCreateManagedLinkedInTab, proxyLinkedInRequest } from "./lib/linkedinProxy";
import {
  countConnectionEntities,
  dedupeConnections,
  normalizeCompanyResponse,
  normalizeConnectionsPage,
  normalizeProfileResponse,
  normalizeSelfProfile
} from "./lib/normalize";
import {
  clearAllState,
  clearLinkedInState,
  defaultActivitySync,
  defaultConvexSync,
  defaultConnectionSync,
  defaultFollowerSync,
  readExtensionState,
  writeAuthState,
  writeActivitySnapshot,
  writeActivitySyncState,
  writeConnectionSync,
  writeConnections,
  writeConvexConfig,
  writeConvexSyncState,
  writeFollowerSync,
  writeFollowers,
  writeManagedTabId,
  writePageScrape,
  writeSessionState,
  writeUserProfile
} from "./lib/storage";
import { createLogger } from "./lib/debug";
import { normalizeConvexDeploymentUrl, pushExtensionStateToConvex } from "./lib/convex";
import type {
  ActivityItem,
  ActivityScrapeState,
  ConnectionRecord,
  ConnectionSyncState,
  ConvexConfig,
  ConvexSyncState,
  FollowerRecord,
  FollowerSyncState,
  NormalizedCompany,
  NormalizedPostAnalytics,
  NormalizedProfile,
  OwnActivitySnapshot,
  PageScrape,
  ProfileMetric,
  PopupRequest,
  PopupResponse,
  UserProfile,
  SessionStateInternal
} from "./types";

const CONNECTION_PAGE_SIZE = 40;
const BUILD_TAG = "2026-03-26-followers-mainworld-voyager-seed";
const logger = createLogger("background");

function fail(message: string): PopupResponse {
  return { success: false, error: message };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureAuthenticatedSession(): Promise<{
  session: SessionStateInternal;
  response: PopupResponse;
}> {
  const { session, authState } = await captureLinkedInSession();
  await writeSessionState(session);
  await writeAuthState(authState);

  if (!authState.isAuthenticated || !session) {
    logger.warn("Authenticated session is unavailable.", authState);
    throw new Error("No active LinkedIn session found in this Chrome profile.");
  }

  logger.log("Authenticated LinkedIn session is ready.", {
    cookieCount: authState.cookieCount,
    csrfPresent: authState.csrfPresent
  });

  return {
    session,
    response: {
      success: true,
      authState
    }
  };
}

async function fetchJsonThroughTab(
  tabId: number,
  url: string,
  session: SessionStateInternal,
  headers: Record<string, string>,
  options: {
    failureLogLevel?: "warn" | "error";
  } = {}
): Promise<unknown> {
  const failureLogLevel = options.failureLogLevel ?? "error";
  logger.log("Fetching LinkedIn JSON through tab.", { tabId, url });
  const response = await proxyLinkedInRequest(tabId, {
    url,
    method: "GET",
    headers: buildLinkedInHeaders(session, headers)
  });

  if (!response.success) {
    logger[failureLogLevel]("LinkedIn JSON fetch failed.", {
      tabId,
      url,
      status: response.status,
      error: response.error
    });
    throw new Error(response.error || `LinkedIn request failed with status ${response.status}`);
  }

  if (!response.body) {
    return {};
  }

  try {
    const parsed = JSON.parse(response.body);
    logger.log("LinkedIn JSON fetch parsed successfully.", { tabId, url, status: response.status });
    return parsed;
  } catch (error) {
    logger.error("LinkedIn JSON parsing failed.", {
      tabId,
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new Error(
      `LinkedIn returned a non-JSON response for ${url}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function scrapeActivePageDom(
  tabId: number,
  pageType: "profile" | "company" | "postAnalytics"
): Promise<NormalizedProfile | NormalizedCompany | NormalizedPostAnalytics> {
  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (activePageType: "profile" | "company" | "postAnalytics") => {
      const pickText = (...values: Array<string | null | undefined>): string | null => {
        for (const value of values) {
          if (typeof value === "string" && value.trim()) {
            return value.trim();
          }
        }
        return null;
      };

      const clean = (value: string | null | undefined): string | null => {
        return typeof value === "string" && value.trim() ? value.trim() : null;
      };

      const textFromSelector = (...selectors: string[]): string | null => {
        for (const selector of selectors) {
          const element = document.querySelector<HTMLElement>(selector);
          const text = clean(element?.innerText ?? element?.textContent ?? null);
          if (text) {
            return text;
          }
        }
        return null;
      };

      const metaContent = (...selectors: string[]): string | null => {
        for (const selector of selectors) {
          const element = document.querySelector<HTMLMetaElement>(selector);
          const content = clean(element?.content ?? element?.getAttribute("content") ?? null);
          if (content) {
            return content;
          }
        }
        return null;
      };

      const canonicalUrl =
        clean(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href) ?? window.location.href;

      const parseJsonLd = (): Record<string, unknown>[] => {
        const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'));
        const records: Record<string, unknown>[] = [];

        for (const script of scripts) {
          const raw = clean(script.textContent);
          if (!raw) {
            continue;
          }

          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              records.push(...parsed.filter((value) => typeof value === "object" && value !== null));
            } else if (typeof parsed === "object" && parsed !== null) {
              records.push(parsed as Record<string, unknown>);
            }
          } catch {
            continue;
          }
        }

        return records;
      };

      const findJsonLd = (typeName: string): Record<string, unknown> | null => {
        return (
          parseJsonLd().find((record) => {
            const typeValue = record["@type"];
            if (typeof typeValue === "string") {
              return typeValue === typeName;
            }
            return Array.isArray(typeValue) && typeValue.includes(typeName);
          }) ?? null
        );
      };

      const parseIdentifierFromUrl = (url: string, segment: "in" | "company"): string | null => {
        try {
          const parsed = new URL(url);
          const match = parsed.pathname.match(new RegExp(`/${segment}/([^/?#]+)`));
          return clean(match?.[1] ?? null);
        } catch {
          return null;
        }
      };

      const looksLikeMetricValue = (value: string): boolean => {
        const compact = value.replace(/\s+/gu, " ").trim();
        return compact.length > 0 && compact.length <= 40 && /[\d%]/u.test(compact);
      };

      const parseLabeledMetrics = (
        labels: string[],
        text: string
      ): Array<{
        label: string;
        value: string;
      }> => {
        const labelLookup = new Map(labels.map((label) => [label.toLowerCase(), label]));
        const metrics = new Map<string, string>();
        const blocks = Array.from(document.querySelectorAll<HTMLElement>("main section, main article, main div, main li"));

        for (const block of blocks) {
          const blockText = clean(block.innerText ?? block.textContent ?? null);
          if (!blockText) {
            continue;
          }

          const lines = blockText
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 8);

          if (lines.length < 2) {
            continue;
          }

          for (let index = 0; index < lines.length - 1; index += 1) {
            const current = lines[index] ?? "";
            const next = lines[index + 1] ?? "";
            const nextNext = lines[index + 2] ?? "";
            const currentLabel = labelLookup.get(current.toLowerCase());
            const nextLabel = labelLookup.get(next.toLowerCase());

            if (currentLabel && looksLikeMetricValue(next) && !metrics.has(currentLabel)) {
              metrics.set(currentLabel, next);
            }

            if (nextLabel && looksLikeMetricValue(current) && !metrics.has(nextLabel)) {
              metrics.set(nextLabel, current);
            }

            if (currentLabel && nextNext && looksLikeMetricValue(nextNext) && !metrics.has(currentLabel)) {
              metrics.set(currentLabel, nextNext);
            }
          }
        }

        for (const label of labels) {
          if (metrics.has(label)) {
            continue;
          }

          const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
          const patterns = [
            new RegExp(`${escapedLabel}[\\s:\\n]+([0-9][0-9,.%KkMm+:/ -]*)`, "iu"),
            new RegExp(`([0-9][0-9,.%KkMm+:/ -]*)[\\s:\\n]+${escapedLabel}`, "iu")
          ];

          for (const pattern of patterns) {
            const match = text.match(pattern);
            const value = clean(match?.[1] ?? null);
            if (value) {
              metrics.set(label, value);
              break;
            }
          }
        }

        return Array.from(metrics.entries()).map(([label, value]) => ({ label, value }));
      };

      if (activePageType === "postAnalytics") {
        const analyticsUrl = canonicalUrl ?? window.location.href;
        const analyticsText = clean(document.querySelector("main")?.innerText ?? document.body.innerText ?? null) ?? "";
        const activityUrn =
          clean(window.location.pathname.match(/\/analytics\/post-summary\/([^/?#]+)/u)?.[1] ?? null) ?? null;
        const analyticsMetricLabels = [
          "Impressions",
          "Members reached",
          "Engagements",
          "Clicks",
          "Reactions",
          "Comments",
          "Reposts",
          "Shares",
          "Profile activity",
          "Followers gained",
          "Video views",
          "Watch time",
          "Average watch time"
        ];
        const metrics = parseLabeledMetrics(analyticsMetricLabels, analyticsText);
        const postUrl =
          Array.from(document.querySelectorAll<HTMLAnchorElement>("main a[href]"))
            .map((anchor) => clean(anchor.href))
            .find((href) => href && /linkedin\.com\/(feed\/update|posts|activity)\//iu.test(href)) ?? null;
        const genericAnalyticsText = /^(post analytics|analytics)$/iu;
        const author = pickText(
          textFromSelector('main a[href*="/in/"] span[aria-hidden="true"]'),
          textFromSelector('main a[href*="/company/"] span[aria-hidden="true"]')
        );
        const postText =
          Array.from(document.querySelectorAll<HTMLElement>("main p, main span, main div"))
            .map((element) => clean(element.innerText ?? element.textContent ?? null))
            .find(
              (text) =>
                Boolean(text) &&
                text!.length > 40 &&
                !genericAnalyticsText.test(text!) &&
                !/no results found|you do not have permission to view this page|analytics failed to load|reload page/iu.test(
                  text!
                ) &&
                !/impressions|engagements|reactions|comments|reposts|shares|profile activity|followers gained|watch time|video views/iu.test(
                  text!
                )
            ) ?? null;
        const publishedLabel =
          analyticsText
            .split("\n")
            .map((line) => line.trim())
            .find(
              (line) =>
                /(\d+\s*[smhdw]|mo|yr|ago|edited|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/iu.test(line)
            ) ?? null;
        const permissionDenied = /you do not have permission to view this page/iu.test(analyticsText);
        const noResults = /no results found/iu.test(analyticsText);
        const analyticsFailed = /analytics failed to load|reload page/iu.test(analyticsText);
        const status: "success" | "unavailable" | "failed" =
          metrics.length > 0 ? "success" : permissionDenied || noResults ? "unavailable" : "failed";
        const errorMessage =
          status === "success"
            ? null
            : permissionDenied
              ? "You do not have permission to view this post analytics page."
              : noResults
                ? "LinkedIn returned no analytics results for this post."
                : analyticsFailed
                  ? "LinkedIn analytics failed to load for this post."
                  : "LinkedIn post analytics returned no metrics.";

        return {
          activityUrn,
          analyticsUrl,
          postUrl,
          author,
          postText,
          publishedLabel,
          status,
          errorMessage,
          metrics,
          raw: {
            source: "dom",
            analyticsUrl,
            metricCount: metrics.length,
            status,
            errorMessage
          }
        };
      }

      if (activePageType === "profile") {
        const person = findJsonLd("Person");
        const ogTitle = metaContent('meta[property="og:title"]', 'meta[name="title"]');
        const ogDescription = metaContent('meta[property="og:description"]', 'meta[name="description"]');
        const headline =
          textFromSelector(
            "main section .text-body-medium.break-words",
            ".pv-text-details__left-panel .text-body-medium",
            ".ph5 .mt2 .text-body-medium"
          ) ?? clean(ogDescription);
        const fullName = pickText(
          textFromSelector("main h1", "h1"),
          clean((person?.name as string | undefined) ?? null),
          clean(ogTitle?.replace(/\s*\|\s*LinkedIn\s*$/, ""))
        );
        const profileUrl = pickText(
          clean((person?.url as string | undefined) ?? null),
          canonicalUrl,
          window.location.href
        );
        const publicIdentifier = parseIdentifierFromUrl(profileUrl ?? window.location.href, "in");
        const companyName =
          textFromSelector(
            'main a[href*="/company/"] span[aria-hidden="true"]',
            'main a[href*="/company/"] div[aria-hidden="true"]',
            'main .pv-text-details__right-panel a span[aria-hidden="true"]'
          ) ?? null;
        const location =
          textFromSelector(
            "main .text-body-small.inline.t-black--light.break-words",
            ".pv-text-details__left-panel .text-body-small",
            ".ph5 .mt2 .text-body-small"
          ) ?? null;

        return {
          fullName,
          headline,
          location,
          publicIdentifier,
          profileUrl,
          entityUrn: null,
          companyName,
          raw: {
            source: "dom",
            canonicalUrl,
            ogTitle,
            ogDescription,
            jsonLd: person
          }
        };
      }

      const organization = findJsonLd("Organization");
      const ogTitle = metaContent('meta[property="og:title"]', 'meta[name="title"]');
      const description =
        metaContent('meta[property="og:description"]', 'meta[name="description"]') ??
        textFromSelector("main p", "main .break-words");
      const linkedinUrl = pickText(
        clean((organization?.url as string | undefined) ?? null),
        canonicalUrl,
        window.location.href
      );
      const websiteUrl =
        Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]'))
          .map((anchor) => clean(anchor.href))
          .find((href) => href && !href.includes("linkedin.com")) ?? null;
      const detailsText = clean(document.querySelector("main")?.textContent ?? null) ?? "";
      const employeeCountMatch = detailsText.match(/([0-9][0-9,.\-+ ]*\+?)\s+employees?/i);
      const industryMatch = detailsText.match(/Industry\s*([A-Za-z0-9 ,&/\-]+)/i);
      const universalName = parseIdentifierFromUrl(linkedinUrl ?? window.location.href, "company");

      return {
        name: pickText(
          textFromSelector("main h1", "h1"),
          clean((organization?.name as string | undefined) ?? null),
          clean(ogTitle?.replace(/\s*\|\s*LinkedIn\s*$/, ""))
        ),
        universalName,
        linkedinUrl,
        websiteUrl,
        industry: clean(industryMatch?.[1] ?? null),
        employeeCount: clean(employeeCountMatch?.[1] ?? null),
        description,
        raw: {
          source: "dom",
          canonicalUrl,
          ogTitle,
          jsonLd: organization
        }
      };
    },
    args: [pageType]
  });

  if (!injectionResult?.result) {
    throw new Error("DOM page scrape returned no result.");
  }

  return injectionResult.result;
}

async function waitForTabComplete(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      return;
    }
    await sleep(500);
  }
}

async function navigateTab(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
  await waitForTabComplete(tabId);
}

async function withTemporarilyActivatedTab<T>(tabId: number, task: () => Promise<T>): Promise<T> {
  const previouslyActiveTab = await getActiveTab();
  const previousTabId = previouslyActiveTab?.id;
  const shouldRestore = typeof previousTabId === "number" && previousTabId !== tabId;

  if (shouldRestore) {
    await chrome.tabs.update(tabId, { active: true });
    await sleep(350);
    logger.log("Temporarily activated managed LinkedIn tab for foreground scraping.", {
      tabId,
      previousTabId
    });
  }

  try {
    return await task();
  } finally {
    if (shouldRestore && typeof previousTabId === "number") {
      try {
        await chrome.tabs.update(previousTabId, { active: true });
        logger.log("Restored previously active tab after foreground scrape.", {
          tabId: previousTabId
        });
      } catch (error) {
        logger.warn("Failed to restore previously active tab after foreground scrape.", {
          tabId: previousTabId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}

function parseLinkedInPublicIdentifier(profileUrl: string | null): string | null {
  if (!profileUrl) {
    return null;
  }

  try {
    const parsed = new URL(profileUrl);
    const match = parsed.pathname.match(/\/in\/([^/?#]+)/u);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function normalizeFollowerRecords(records: FollowerRecord[]): FollowerRecord[] {
  const deduped = new Map<string, FollowerRecord>();

  for (const record of records) {
    const profileUrl = record.profileUrl ? record.profileUrl.replace(/\/+$/u, "") : null;
    const publicIdentifier = record.publicIdentifier ?? parseLinkedInPublicIdentifier(profileUrl);
    const key = publicIdentifier ?? profileUrl ?? `${record.fullName ?? "unknown"}::${record.headline ?? ""}`;
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, {
        ...record,
        profileUrl,
        publicIdentifier
      });
      continue;
    }

    deduped.set(key, {
      fullName: existing.fullName ?? record.fullName,
      publicIdentifier: existing.publicIdentifier ?? publicIdentifier,
      profileUrl: existing.profileUrl ?? profileUrl,
      headline: existing.headline ?? record.headline,
      relationshipLabel: existing.relationshipLabel ?? record.relationshipLabel,
      raw: Array.isArray(existing.raw) ? [...existing.raw, record.raw] : [existing.raw, record.raw]
    });
  }

  return [...deduped.values()].sort((left, right) => {
    const leftName = left.fullName ?? left.publicIdentifier ?? "";
    const rightName = right.fullName ?? right.publicIdentifier ?? "";
    return leftName.localeCompare(rightName);
  });
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asTextLike(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const record = asObject(value);
  if (!record) {
    return null;
  }
  return (
    asText(record.text) ??
    asText(record.name) ??
    asText(record.localizedName) ??
    asText(record.defaultLocalizedName) ??
    null
  );
}

function normalizeFollowerProfileUrl(value: string | null): string | null {
  const input = asText(value);
  if (!input) {
    return null;
  }

  try {
    const parsed = new URL(input, "https://www.linkedin.com");
    const match = parsed.pathname.match(/\/in\/([^/?#]+)/u);
    return match?.[1] ? `https://www.linkedin.com/in/${match[1]}` : null;
  } catch {
    return null;
  }
}

function normalizeFollowersFromVoyagerPayload(raw: unknown): FollowerRecord[] {
  const root = asObject(raw);
  const included = asList(root?.included);
  const elements = asList(root?.elements);
  const data = asObject(root?.data);
  const dataElements = asList(data?.elements);
  const pool = [...included, ...elements, ...dataElements];
  const records: FollowerRecord[] = [];

  for (const item of pool) {
    const source = asObject(item);
    if (!source) {
      continue;
    }

    const candidates: Array<Record<string, unknown>> = [
      source,
      asObject(source.profile),
      asObject(source.memberProfile),
      asObject(source.miniProfile),
      asObject(source.actor),
      asObject(source.entity)
    ].filter((value): value is Record<string, unknown> => Boolean(value));

    for (const candidate of candidates) {
      const publicIdentifier =
        asText(candidate.publicIdentifier) ??
        asText(asObject(candidate.miniProfile)?.publicIdentifier) ??
        null;
      const derivedUrl =
        normalizeFollowerProfileUrl(asText(candidate.profileUrl) ?? asText(candidate.publicProfileUrl) ?? null) ??
        (publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : null);
      const firstName = asTextLike(candidate.firstName);
      const lastName = asTextLike(candidate.lastName);
      const fullName =
        [firstName, lastName].filter((value): value is string => Boolean(value)).join(" ").trim() ||
        asTextLike(candidate.fullName) ||
        asTextLike(candidate.name) ||
        null;

      if (!publicIdentifier && !derivedUrl && !fullName) {
        continue;
      }

      const relationshipLabel =
        asTextLike(candidate.relationshipType) ??
        asTextLike(candidate.connectionType) ??
        asTextLike(source.relationshipType) ??
        asTextLike(source.connectionType) ??
        asTextLike(source.secondarySubtitle) ??
        null;
      const headline =
        asTextLike(candidate.headline) ??
        asTextLike(candidate.occupation) ??
        asTextLike(candidate.summary) ??
        asTextLike(source.headline) ??
        asTextLike(source.primarySubtitle) ??
        asTextLike(source.secondarySubtitle) ??
        null;

      records.push({
        fullName,
        publicIdentifier: publicIdentifier ?? parseLinkedInPublicIdentifier(derivedUrl),
        profileUrl: derivedUrl,
        headline,
        relationshipLabel,
        raw: {
          source: "voyager-api",
          candidate,
          item: source
        }
      });
      break;
    }
  }

  return normalizeFollowerRecords(records);
}

function extractFollowerApiSeedUrlFromRaw(raw: unknown): string | null {
  const rawRecord = asObject(raw);
  const urls = asList(rawRecord?.voyagerApiUrlsSample)
    .map((value) => asText(value))
    .filter((value): value is string => Boolean(value));

  if (!urls.length) {
    return null;
  }

  const candidates = urls.filter((url) => {
    if (!url.includes("/voyager/api/")) {
      return false;
    }
    if (!url.includes("start=") || !url.includes("count=")) {
      return false;
    }
    return /(followers|people-follow|follow|relationships\/dash)/iu.test(url);
  });

  if (!candidates.length) {
    return null;
  }

  const prioritized =
    candidates.find((url) => /followers/iu.test(url)) ??
    candidates.find((url) => /people-follow/iu.test(url)) ??
    candidates.find((url) => /relationships\/dash/iu.test(url)) ??
    candidates[0];

  return prioritized ?? null;
}

async function augmentFollowersViaVoyagerApiSeed(params: {
  tabId: number;
  session: SessionStateInternal;
  seedUrl: string;
  initialFollowers: FollowerRecord[];
}): Promise<{
  followers: FollowerRecord[];
  raw: {
    attempted: boolean;
    seedUrl: string;
    pagesFetched: number;
    apiRecordsSeen: number;
    noGrowthPages: number;
    finalCount: number;
  };
}> {
  const { tabId, session, seedUrl, initialFollowers } = params;
  let parsed: URL;
  try {
    parsed = new URL(seedUrl);
  } catch {
    return {
      followers: initialFollowers,
      raw: {
        attempted: false,
        seedUrl,
        pagesFetched: 0,
        apiRecordsSeen: 0,
        noGrowthPages: 0,
        finalCount: initialFollowers.length
      }
    };
  }

  const count = Math.max(1, Number.parseInt(parsed.searchParams.get("count") ?? "40", 10) || 40);
  let start = Math.max(0, Number.parseInt(parsed.searchParams.get("start") ?? "0", 10) || 0);
  let pagesFetched = 0;
  let apiRecordsSeen = 0;
  let noGrowthPages = 0;
  let combinedFollowers = normalizeFollowerRecords(initialFollowers);
  const maxPages = 200;

  for (let page = 0; page < maxPages; page += 1) {
    parsed.searchParams.set("count", String(count));
    parsed.searchParams.set("start", String(start));

    let rawPage: unknown;
    try {
      rawPage = await fetchJsonThroughTab(
        tabId,
        parsed.toString(),
        session,
        {
          accept: "application/vnd.linkedin.normalized+json+2.1"
        },
        { failureLogLevel: "warn" }
      );
    } catch {
      break;
    }

    pagesFetched += 1;
    const pageRecords = normalizeFollowersFromVoyagerPayload(rawPage);
    apiRecordsSeen += pageRecords.length;
    const beforeCount = combinedFollowers.length;
    combinedFollowers = normalizeFollowerRecords([...combinedFollowers, ...pageRecords]);

    if (combinedFollowers.length === beforeCount) {
      noGrowthPages += 1;
    } else {
      noGrowthPages = 0;
    }

    if (!pageRecords.length || noGrowthPages >= 3) {
      break;
    }

    if (pageRecords.length < Math.max(3, Math.floor(count * 0.25))) {
      break;
    }

    start += count;
    await sleep(250);
  }

  return {
    followers: combinedFollowers,
    raw: {
      attempted: true,
      seedUrl,
      pagesFetched,
      apiRecordsSeen,
      noGrowthPages,
      finalCount: combinedFollowers.length
    }
  };
}

function buildRecentActivityUrl(profileUrl: string | null, publicIdentifier: string | null): string {
  if (profileUrl) {
    return `${profileUrl.replace(/\/+$/u, "")}/recent-activity/all/`;
  }
  if (publicIdentifier) {
    return `https://www.linkedin.com/in/${publicIdentifier}/recent-activity/all/`;
  }
  throw new Error("Unable to determine LinkedIn recent activity URL.");
}

function normalizeActivityItems(items: ActivityItem[]): ActivityItem[] {
  return items.map((item) => normalizeActivityItemReferences(item));
}

function mergeAnalyticsIntoSnapshotItem(
  snapshot: OwnActivitySnapshot,
  index: number,
  analytics: NormalizedPostAnalytics,
  capturedAt: string
): OwnActivitySnapshot {
  const nextItems = snapshot.activityItems.map((item, itemIndex) =>
    itemIndex === index ? mergeActivityItemAnalytics(item, analytics, capturedAt) : item
  );

  return {
    ...snapshot,
    activityItems: nextItems,
    capturedAt,
    raw: {
      ...snapshot.raw,
      analytics: {
        syncedAt: capturedAt
      }
    }
  };
}

async function captureOwnActivitySnapshot(userProfile: UserProfile, managedTabId: number): Promise<OwnActivitySnapshot> {
  if (userProfile.profileUrl) {
    await navigateTab(managedTabId, userProfile.profileUrl);
  }
  const profileInsights = await scrapeSelfProfileInsightsDom(managedTabId);

  const recentActivityUrl = buildRecentActivityUrl(userProfile.profileUrl, userProfile.publicIdentifier);
  await navigateTab(managedTabId, recentActivityUrl);
  const activityFeed = await scrapeSelfRecentActivityDom(managedTabId);

  return {
    publicIdentifier: userProfile.publicIdentifier,
    profileUrl: userProfile.profileUrl,
    profileHeadline: profileInsights.profileHeadline,
    followerCount: profileInsights.followerCount,
    connectionCount: profileInsights.connectionCount,
    dashboardMetrics: profileInsights.dashboardMetrics,
    activityItems: normalizeActivityItems(activityFeed.items),
    capturedAt: new Date().toISOString(),
    raw: {
      profile: profileInsights.raw,
      activity: activityFeed.raw
    }
  };
}

async function ensureOwnActivitySnapshot(
  session: SessionStateInternal,
  managedTabId: number
): Promise<OwnActivitySnapshot> {
  const currentState = await readExtensionState();
  if (currentState.activitySnapshot?.activityItems.length) {
    return {
      ...currentState.activitySnapshot,
      activityItems: normalizeActivityItems(currentState.activitySnapshot.activityItems)
    };
  }

  const userProfile = await ensureUserProfile(session);
  return captureOwnActivitySnapshot(userProfile, managedTabId);
}

async function ensureUserProfile(session: SessionStateInternal): Promise<UserProfile> {
  const currentState = await readExtensionState();
  if (currentState.userProfile?.publicIdentifier) {
    return currentState.userProfile;
  }

  const tab = await getOrCreateManagedLinkedInTab();
  if (!tab.id) {
    throw new Error("Unable to acquire a LinkedIn tab.");
  }

  const raw = await fetchJsonThroughTab(tab.id, LINKEDIN_ME_ENDPOINT, session, {
    accept: "application/json"
  });
  const userProfile = normalizeSelfProfile(raw);
  await writeUserProfile(userProfile);
  return userProfile;
}

async function scrapeSelfProfileInsightsDom(tabId: number): Promise<{
  profileHeadline: string | null;
  followerCount: string | null;
  connectionCount: string | null;
  dashboardMetrics: ProfileMetric[];
  raw: unknown;
}> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clean = (value: string | null | undefined): string | null =>
        typeof value === "string" && value.trim() ? value.trim() : null;
      const textFromSelector = (...selectors: string[]): string | null => {
        for (const selector of selectors) {
          const element = document.querySelector<HTMLElement>(selector);
          const text = clean(element?.innerText ?? element?.textContent ?? null);
          if (text) return text;
        }
        return null;
      };
      const parseMetricItems = (sectionText: string): Array<{ label: string; value: string }> => {
        const metrics: Array<{ label: string; value: string }> = [];
        const lines = sectionText
          .split("\n")
          .map((line: string) => line.trim())
          .filter(Boolean);
        for (let index = 0; index < lines.length - 1; index += 1) {
          const value = lines[index];
          const label = lines[index + 1];
          if (/^[\d,.+KkMm]+$/u.test(value) && /[A-Za-z]/u.test(label)) {
            metrics.push({ label, value });
          }
        }
        return metrics;
      };

      const sections = Array.from(document.querySelectorAll("section"));
      const dashboardSection =
        sections.find((section) =>
          /profile views|post impressions|search appearances|dashboard/iu.test((section as HTMLElement).innerText)
        ) ??
        null;

      const metrics = dashboardSection ? parseMetricItems((dashboardSection as HTMLElement).innerText) : [];
      const profileText = clean(document.querySelector("main")?.textContent ?? null) ?? "";
      const followerMatch = profileText.match(/([0-9][0-9,.\-+KkMm]*)\s+followers/iu);
      const connectionMatch = profileText.match(/([0-9][0-9,.\-+KkMm]*)\s+connections/iu);

      return {
        profileHeadline: textFromSelector(
          "main section .text-body-medium.break-words",
          ".pv-text-details__left-panel .text-body-medium",
          ".ph5 .mt2 .text-body-medium"
        ),
        followerCount: clean(followerMatch?.[1] ?? null),
        connectionCount: clean(connectionMatch?.[1] ?? null),
        dashboardMetrics: metrics,
        raw: {
          source: "dom",
          dashboardText: dashboardSection?.innerText ?? null
        }
      };
    }
  });

  if (!result?.result) {
    throw new Error("Profile insights scrape returned no result.");
  }

  return result.result as {
    profileHeadline: string | null;
    followerCount: string | null;
    connectionCount: string | null;
    dashboardMetrics: ProfileMetric[];
    raw: unknown;
  };
}

async function scrapeSelfRecentActivityDom(tabId: number): Promise<{
  items: ActivityItem[];
  raw: unknown;
}> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      const clean = (value: string | null | undefined): string | null =>
        typeof value === "string" && value.trim() ? value.trim() : null;
      const parseCount = (text: string, label: string): string | null => {
        const match = text.match(new RegExp(`([0-9][0-9,.]*)\\s+${label}`, "iu"));
        return clean(match?.[1] ?? null);
      };

      for (let attempt = 0; attempt < 4; attempt += 1) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
        await wait(900);
      }
      window.scrollTo({ top: 0, behavior: "auto" });
      await wait(200);

      const containers = Array.from(
        document.querySelectorAll("main .scaffold-finite-scroll__content > *, main [data-urn], main article")
      );
      const seen = new Set();
      const items: Array<{
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
        analyticsMetrics: Array<{ label: string; value: string }>;
        analyticsCapturedAt: string | null;
        raw: unknown;
      }> = [];

      for (const container of containers) {
        const element = container as HTMLElement;
        const text = clean(element.innerText ?? element.textContent ?? null);
        if (!text || text.length < 25) {
          continue;
        }

        const permalink =
          Array.from(element.querySelectorAll<HTMLAnchorElement>("a"))
            .map((anchor: HTMLAnchorElement) => clean(anchor.href))
            .find((href) => href && /linkedin\.com\/(feed\/update|posts|activity)\//iu.test(href)) ?? null;
        const derivedId: string =
          clean(element.getAttribute("data-urn") ?? null) ??
          permalink ??
          `${text.slice(0, 40)}-${items.length}`;

        if (seen.has(derivedId)) {
          continue;
        }
        seen.add(derivedId);

        const lines = text.split("\n").map((line: string) => line.trim()).filter(Boolean);
        const timestampLabel =
          lines.find((line: string) => /(\d+\s*[smhdw]|mo|yr|ago|edited)/iu.test(line) || /^\d+[smhdw]$/iu.test(line)) ??
          null;
        const actor = lines[0] ?? null;
        const kind =
          lines.find((line: string) => /posted|commented|reposted|shared|liked/iu.test(line)) ??
          (permalink?.includes("/posts/") ? "post" : "activity");
        const headline =
          lines.find((line: string, index: number) => index > 0 && line !== timestampLabel && line !== actor) ?? null;
        const reactionCount = parseCount(text, "reactions?");
        const commentCount = parseCount(text, "comments?");
        const repostCount = parseCount(text, "reposts?");

        items.push({
          id: derivedId,
          activityUrn: null,
          analyticsUrl: null,
          analyticsStatus: "idle",
          analyticsError: null,
          kind,
          timestampLabel,
          actor,
          headline,
          text: text.slice(0, 2000),
          permalink,
          reactionCount,
          commentCount,
          repostCount,
          analyticsMetrics: [],
          analyticsCapturedAt: null,
          raw: {
            source: "dom",
            lines
          }
        });

        if (items.length >= 25) {
          break;
        }
      }

      return {
        items,
        raw: {
          source: "dom",
          visibleCards: containers.length
        }
      };
    }
  });

  if (!result?.result) {
    throw new Error("Recent activity scrape returned no result.");
  }

  return result.result as {
    items: ActivityItem[];
    raw: unknown;
  };
}

async function scrapeFollowersDom(tabId: number): Promise<{
  followers: FollowerRecord[];
  raw: unknown;
}> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      const clean = (value: string | null | undefined): string | null =>
        typeof value === "string" && value.trim() ? value.trim() : null;
      const serializeError = (error: unknown): { name: string; message: string; stack: string | null } => {
        if (error instanceof Error) {
          return {
            name: error.name,
            message: error.message,
            stack: error.stack ?? null
          };
        }
        return {
          name: "UnknownError",
          message: typeof error === "string" ? error : String(error),
          stack: null
        };
      };
      try {
      const globalState = window as Window & {
        __tigerclawFollowerVoyagerCapture?: {
          urls: string[];
          installed: boolean;
        };
      };
      const capture = globalState.__tigerclawFollowerVoyagerCapture ?? {
        urls: [],
        installed: false
      };
      globalState.__tigerclawFollowerVoyagerCapture = capture;
      const trackVoyagerUrl = (value: string | null | undefined): void => {
        const url = clean(value);
        if (!url) {
          return;
        }
        let normalized: string | null = null;
        try {
          const parsed = new URL(url, window.location.origin);
          if (!parsed.hostname.endsWith("linkedin.com")) {
            return;
          }
          if (!parsed.pathname.includes("/voyager/api/")) {
            return;
          }
          normalized = parsed.toString();
        } catch {
          return;
        }
        if (!normalized || capture.urls.includes(normalized)) {
          return;
        }
        capture.urls.push(normalized);
        if (capture.urls.length > 300) {
          capture.urls.splice(0, capture.urls.length - 300);
        }
      };
      const collectVoyagerUrlsFromPerformance = (): void => {
        try {
          const resourceEntries = performance.getEntriesByType("resource");
          for (const entry of resourceEntries) {
            const name = clean((entry as PerformanceResourceTiming).name ?? null);
            trackVoyagerUrl(name);
          }
        } catch {
          // ignore performance entry access errors
        }
      };
      collectVoyagerUrlsFromPerformance();
      if (!capture.installed) {
        capture.installed = true;
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (...args: Parameters<typeof fetch>) => {
          const firstArg = args[0] as RequestInfo | URL | undefined;
          if (typeof firstArg === "string") {
            trackVoyagerUrl(firstArg);
          } else if (firstArg instanceof URL) {
            trackVoyagerUrl(firstArg.toString());
          } else if (firstArg instanceof Request) {
            trackVoyagerUrl(firstArg.url);
          }
          return nativeFetch(...args);
        };

        const nativeOpen = XMLHttpRequest.prototype.open;
        const nativeSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (
          method: string,
          url: string | URL,
          async?: boolean,
          username?: string | null,
          password?: string | null
        ): void {
          const xhr = this as XMLHttpRequest & { __tigerclawRequestUrl?: string };
          xhr.__tigerclawRequestUrl = typeof url === "string" ? url : url.toString();
          return nativeOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
        };
        XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
          const xhr = this as XMLHttpRequest & { __tigerclawRequestUrl?: string };
          trackVoyagerUrl(xhr.__tigerclawRequestUrl);
          (nativeSend as (...args: unknown[]) => unknown).call(this, body ?? null);
        };
      }
      const normalizeProfileUrl = (value: string | null): string | null => {
        const href = clean(value);
        if (!href) {
          return null;
        }

        try {
          const parsed = new URL(href, window.location.origin);
          const match = parsed.pathname.match(/\/in\/([^/?#]+)/u);
          if (!match?.[1]) {
            return null;
          }
          return `${window.location.origin}/in/${match[1]}`;
        } catch {
          return null;
        }
      };
      const parsePublicIdentifier = (value: string | null): string | null => {
        if (!value) {
          return null;
        }
        const match = value.match(/\/in\/([^/?#]+)/u);
        return clean(match?.[1] ?? null);
      };

      const uniqueElements = <T extends HTMLElement>(elements: Array<T | null | undefined>): T[] => {
        const seen = new Set<T>();
        const unique: T[] = [];
        for (const element of elements) {
          if (!element || seen.has(element)) {
            continue;
          }
          seen.add(element);
          unique.push(element);
        }
        return unique;
      };
      const getCardProfileUrl = (card: HTMLElement): string | null => {
        const anchors = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'));
        for (const anchor of anchors) {
          const profileUrl = normalizeProfileUrl(anchor.href);
          if (profileUrl) {
            return profileUrl;
          }
        }
        return null;
      };
      const isFollowerCard = (card: HTMLElement): boolean => {
        const text = clean(card.innerText ?? card.textContent ?? null);
        if (!text || !getCardProfileUrl(card)) {
          return false;
        }
        if (/follows you|following|subscriber|mutual|message|connect|remove|unfollow|invite|pending/iu.test(text)) {
          return true;
        }
        const actionLabels = Array.from(card.querySelectorAll<HTMLElement>("button, [role='button']"))
          .map((element) => clean(element.innerText ?? element.textContent ?? null))
          .filter(Boolean)
          .join(" ");
        return /follow|following|message|connect|remove|unfollow|invite|pending/iu.test(actionLabels);
      };
      const getVisibleFollowerCards = (): HTMLElement[] =>
        uniqueElements(
          Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href*="/in/"]'))
            .map((anchor) => getFollowerCardFromAnchor(anchor))
            .filter((card): card is HTMLElement => Boolean(card))
        ).filter((card) => isFollowerCard(card));
      const getVisibleFollowerAnchors = (): HTMLAnchorElement[] =>
        getVisibleFollowerCards()
          .map((card) =>
            Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')).find((anchor) =>
              Boolean(normalizeProfileUrl(anchor.href))
            ) ?? null
          )
          .filter((anchor): anchor is HTMLAnchorElement => Boolean(anchor));
      const countVisibleFollowerAnchors = (): number => getVisibleFollowerAnchors().length;
      const getVisibleAnchorSignature = (): string =>
        getVisibleFollowerAnchors()
          .map((anchor) => normalizeProfileUrl(anchor.href) ?? anchor.href)
          .filter(Boolean)
          .slice(0, 40)
          .join("|");
      const waitForFollowerDomGrowth = (
        previousCount: number,
        previousSignature: string,
        timeoutMs: number
      ): Promise<void> =>
        new Promise((resolve) => {
          const root = document.querySelector("main") ?? document.body;
          let settled = false;
          const finish = () => {
            if (settled) {
              return;
            }
            settled = true;
            observer.disconnect();
            window.clearTimeout(timeoutId);
            resolve();
          };
          const observer = new MutationObserver(() => {
            if (
              countVisibleFollowerAnchors() > previousCount ||
              getVisibleAnchorSignature() !== previousSignature
            ) {
              finish();
            }
          });
          observer.observe(root, { childList: true, subtree: true });
          const timeoutId = window.setTimeout(finish, timeoutMs);
          if (
            countVisibleFollowerAnchors() > previousCount ||
            getVisibleAnchorSignature() !== previousSignature
          ) {
            finish();
          }
        });
      const canScrollElement = (element: Element): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        return element.clientHeight > 120 && element.scrollHeight > element.clientHeight + 24;
      };
      const getFollowerCardFromAnchor = (anchor: HTMLAnchorElement): HTMLElement | null =>
        anchor.closest<HTMLElement>(
          "li, article, section, .scaffold-finite-scroll__content > div, .artdeco-list__item, [data-view-name]"
        ) ?? anchor.parentElement;
      const describeElement = (element: HTMLElement | null): string | null => {
        if (!element) {
          return null;
        }
        const className = String(element.className ?? "")
          .trim()
          .replace(/\s+/gu, ".");
        return `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}`;
      };
      const clickLoadMoreButton = (): { clicked: boolean; label: string | null } => {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('main button'));
        for (const button of buttons) {
          const label = clean(button.innerText ?? button.textContent ?? null);
          if (!label || button.disabled) {
            continue;
          }
          if (!/show more|load more|see more|next/iu.test(label)) {
            continue;
          }
          button.click();
          return {
            clicked: true,
            label
          };
        }
        return {
          clicked: false,
          label: null
        };
      };
      const scoreScrollCandidate = (element: HTMLElement, lastCard: HTMLElement | null): number => {
        const anchorCount = element.querySelectorAll('a[href*="/in/"]').length;
        const followerCardCount = getVisibleFollowerCards().filter((card) => element.contains(card)).length;
        const containsLastCard = lastCard ? Number(element.contains(lastCard)) : 0;
        return (
          containsLastCard * 1_000_000 + followerCardCount * 100_000 + anchorCount * 1_000 + Math.max(element.clientHeight, 0)
        );
      };
      const collectScrollCandidates = (lastCard: HTMLElement | null): HTMLElement[] => {
        const main = document.querySelector("main");
        const candidateMap = new Map<HTMLElement, number>();
        const addCandidate = (element: HTMLElement | null) => {
          if (!element || candidateMap.has(element) || !canScrollElement(element)) {
            return;
          }
          candidateMap.set(element, scoreScrollCandidate(element, lastCard));
        };

        if (document.scrollingElement instanceof HTMLElement) {
          addCandidate(document.scrollingElement);
        }
        if (main instanceof HTMLElement) {
          addCandidate(main);
        }

        let ancestor: HTMLElement | null = lastCard;
        while (ancestor) {
          addCandidate(ancestor);
          ancestor = ancestor.parentElement;
        }

        const descendantCandidates = Array.from(
          document.querySelectorAll<HTMLElement>("main section, main div, main ul, main ol, main article")
        );
        for (const candidate of descendantCandidates) {
          addCandidate(candidate);
        }

        return [...candidateMap.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 16)
          .map(([element]) => element);
      };
      const attemptScroll = (
        element: HTMLElement
      ): {
        moved: boolean;
        target: string | null;
        strategy: string;
      } => {
        const delta = Math.max(Math.floor(element.clientHeight * 0.9), 480);
        const beforeTop = element.scrollTop;
        const nextTop = Math.min(element.scrollHeight, beforeTop + delta);

        element.scrollTo({ top: nextTop, behavior: "auto" });
        if (Math.abs(element.scrollTop - beforeTop) <= 4) {
          element.scrollTop = nextTop;
        }

        if (Math.abs(element.scrollTop - beforeTop) > 4 || nextTop > beforeTop + 4) {
          return {
            moved: true,
            target: element === document.scrollingElement ? "document" : describeElement(element),
            strategy: element === document.scrollingElement ? "documentScroll" : "containerScroll"
          };
        }

        return {
          moved: false,
          target: element === document.scrollingElement ? "document" : describeElement(element),
          strategy: element === document.scrollingElement ? "documentScroll" : "containerScroll"
        };
      };
      const dispatchWheel = (element: HTMLElement): boolean => {
        try {
          const accepted = element.dispatchEvent(
            new WheelEvent("wheel", {
              deltaY: Math.max(Math.floor(element.clientHeight * 0.9), 480),
              bubbles: true,
              cancelable: true
            })
          );
          return accepted;
        } catch {
          return false;
        }
      };
      const advanceFollowerList = (): {
        scrolled: boolean;
        strategy: string;
        anchorCount: number;
        target: string | null;
      } => {
        const cards = getVisibleFollowerCards();
        const lastCard = cards.at(-1) ?? null;
        let scrolled = false;
        let movedAnyContainer = false;
        const strategyParts: string[] = [];
        const targets: string[] = [];

        if (lastCard) {
          lastCard.scrollIntoView({ block: "end", inline: "nearest", behavior: "auto" });
          strategyParts.push("scrollIntoView");
          const described = describeElement(lastCard);
          if (described) {
            targets.push(described);
          }
        }

        for (const candidate of collectScrollCandidates(lastCard)) {
          const scrollResult = attemptScroll(candidate);
          if (scrollResult.moved) {
            scrolled = true;
            movedAnyContainer = true;
            if (!strategyParts.includes(scrollResult.strategy)) {
              strategyParts.push(scrollResult.strategy);
            }
            if (scrollResult.target) {
              targets.push(scrollResult.target);
            }
          }

          if (dispatchWheel(candidate)) {
            if (!strategyParts.includes("wheelDispatch")) {
              strategyParts.push("wheelDispatch");
            }
            const described = candidate === document.scrollingElement ? "document" : describeElement(candidate);
            if (described) {
              targets.push(described);
            }
          }
        }

        if (!movedAnyContainer) {
          const beforeWindowY = window.scrollY;
          window.scrollBy({ top: Math.max(Math.floor(window.innerHeight * 0.85), 480), behavior: "auto" });
          if (Math.abs(window.scrollY - beforeWindowY) > 4) {
            scrolled = true;
            strategyParts.push("windowScroll");
            targets.push("document");
          }
        }

        const loadMoreResult = clickLoadMoreButton();
        if (loadMoreResult.clicked) {
          strategyParts.push("loadMoreClick");
          if (loadMoreResult.label) {
            targets.push(loadMoreResult.label);
          }
        }

        return {
          scrolled,
          strategy: strategyParts.length ? strategyParts.join("+") : "none",
          anchorCount: cards.length,
          target: targets.filter(Boolean).slice(0, 4).join(" | ") || null
        };
      };

      const followerMap = new Map<
        string,
        {
          fullName: string | null;
          publicIdentifier: string | null;
          profileUrl: string | null;
          headline: string | null;
          relationshipLabel: string | null;
          raw: unknown;
        }
      >();

      const collectVisibleFollowers = (): number => {
        const anchors = getVisibleFollowerAnchors();
        let added = 0;

        for (const anchor of anchors) {
          const profileUrl = normalizeProfileUrl(anchor.href);
          if (!profileUrl) {
            continue;
          }

          const publicIdentifier = parsePublicIdentifier(profileUrl);
          const key = publicIdentifier ?? profileUrl;
          if (followerMap.has(key)) {
            continue;
          }

          const card = getFollowerCardFromAnchor(anchor);
          const cardText = clean(card?.innerText ?? card?.textContent ?? null);
          if (!cardText) {
            continue;
          }

          const lines = cardText
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => !/^(follow|following|message|connect|remove|unfollow|invite|pending)$/iu.test(line));
          const fullName = clean(anchor.textContent ?? null) ?? lines[0] ?? null;
          if (!fullName) {
            continue;
          }

          const relationshipLabel =
            lines.find(
              (line) => line !== fullName && /follows you|following|1st|2nd|3rd|mutual|subscriber/iu.test(line)
            ) ?? null;
          const headline =
            lines.find(
              (line) =>
                line !== fullName &&
                line !== relationshipLabel &&
                !/followers|connections|follow|following|message|connect|remove|unfollow|invite|pending/iu.test(line)
            ) ?? null;

          followerMap.set(key, {
            fullName,
            publicIdentifier,
            profileUrl,
            headline,
            relationshipLabel,
            raw: {
              source: "dom",
              lines: lines.slice(0, 8)
            }
          });
          added += 1;
        }

        return added;
      };

      let noNewFollowerPasses = 0;
      let scrollPasses = 0;
      const startedAt = Date.now();
      const maxDurationMs = 20 * 60 * 1000;
      const maxPasses = 1200;
      const deadlineAt = startedAt + maxDurationMs;
      let stopReason: "maxPasses" | "maxDuration" | "noNewFollowers" = "maxPasses";
      let lastStrategy = "none";
      let lastTarget: string | null = null;
      let lastAddedCount = 0;

      collectVisibleFollowers();
      collectVoyagerUrlsFromPerformance();

      for (let attempt = 0; attempt < maxPasses && Date.now() < deadlineAt; attempt += 1) {
        const visibleCountBefore = countVisibleFollowerAnchors();
        const visibleSignatureBefore = getVisibleAnchorSignature();
        const collectedBefore = followerMap.size;
        const advanceResult = advanceFollowerList();
        lastStrategy = advanceResult.strategy;
        lastTarget = advanceResult.target;

        const growthTimeoutMs = noNewFollowerPasses >= 4 ? 6000 : 2000;
        const settleWaitMs = noNewFollowerPasses >= 4 ? 1800 : 350;

        await waitForFollowerDomGrowth(visibleCountBefore, visibleSignatureBefore, growthTimeoutMs);
        await wait(settleWaitMs);
        collectVoyagerUrlsFromPerformance();
        scrollPasses = attempt + 1;

        const addedCount = collectVisibleFollowers();
        const collectedAfter = followerMap.size;
        lastAddedCount = addedCount;

        if (collectedAfter === collectedBefore) {
          noNewFollowerPasses += 1;
        } else {
          noNewFollowerPasses = 0;
        }

        if (noNewFollowerPasses >= 20) {
          stopReason = "noNewFollowers";
          break;
        }
      }

      if (stopReason !== "noNewFollowers") {
        stopReason = Date.now() >= deadlineAt ? "maxDuration" : "maxPasses";
      }

      const followers = Array.from(followerMap.values());
      collectVoyagerUrlsFromPerformance();

      return {
        followers,
        raw: {
          source: "dom",
          scrollPasses,
          collectedCount: followers.length,
          lastAddedCount,
          noNewFollowerPasses,
          stagnationThreshold: 20,
          stopReason,
          maxPasses,
          maxDurationMs,
          durationMs: Date.now() - startedAt,
          scrollStrategy: lastStrategy,
          scrollTarget: lastTarget,
          finalVisibleAnchors: countVisibleFollowerAnchors(),
          voyagerApiUrlsSample: capture.urls.slice(-80)
        }
      };
      } catch (error) {
        return {
          followers: [],
          raw: {
            source: "dom",
            fatalError: serializeError(error),
            location: window.location.href
          }
        };
      }
    }
  });

  if (!result || typeof result.result === "undefined") {
    throw new Error("Followers page scrape returned no script result from injected context.");
  }

  return result.result as {
    followers: FollowerRecord[];
    raw: unknown;
  };
}

async function handleScrapeSelfActivity(): Promise<PopupResponse> {
  logger.log("Handling SCRAPE_SELF_ACTIVITY.");
  const { session, response } = await ensureAuthenticatedSession();
  const userProfile = await ensureUserProfile(session);
  const managedTab = await getOrCreateManagedLinkedInTab();
  if (!managedTab.id) {
    throw new Error("Unable to acquire a LinkedIn tab.");
  }
  const managedTabId = managedTab.id;

  const runningState: ActivityScrapeState = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    itemCount: 0,
    analyticsCount: 0,
    error: null
  };
  await writeActivitySyncState(runningState);

  try {
    const snapshot = await captureOwnActivitySnapshot(userProfile, managedTabId);
    const successState: ActivityScrapeState = {
      status: "success",
      startedAt: runningState.startedAt,
      finishedAt: new Date().toISOString(),
      itemCount: snapshot.activityItems.length,
      analyticsCount: countActivityItemsWithAnalytics(snapshot.activityItems),
      error: null
    };

    await writeActivitySnapshot(snapshot);
    await writeActivitySyncState(successState);
    logger.log("Stored self activity snapshot.", {
      publicIdentifier: snapshot.publicIdentifier,
      itemCount: snapshot.activityItems.length
    });

    return {
      ...response,
      activitySnapshot: snapshot,
      activitySync: successState,
      state: await readExtensionState()
    };
  } catch (error) {
    const errorState: ActivityScrapeState = {
      status: "error",
      startedAt: runningState.startedAt,
      finishedAt: new Date().toISOString(),
      itemCount: 0,
      analyticsCount: 0,
      error: error instanceof Error ? error.message : String(error)
    };
    await writeActivitySyncState(errorState);
    logger.error("Self activity scrape failed.", errorState);

    return {
      ...response,
      success: false,
      error: errorState.error ?? "Self activity scrape failed.",
      activitySync: errorState,
      state: await readExtensionState()
    };
  }
}

async function scrapePostAnalyticsWithRetry(
  tabId: number,
  analyticsUrl: string
): Promise<NormalizedPostAnalytics> {
  let lastAnalytics: NormalizedPostAnalytics | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt === 0) {
      await navigateTab(tabId, analyticsUrl);
    } else {
      await chrome.tabs.reload(tabId);
      await waitForTabComplete(tabId);
    }

    const analytics = (await scrapeActivePageDom(tabId, "postAnalytics")) as NormalizedPostAnalytics;
    lastAnalytics = analytics;
    if (analytics.status !== "failed") {
      return analytics;
    }

    logger.warn("Post analytics page reported a retryable failure.", {
      analyticsUrl,
      attempt: attempt + 1,
      errorMessage: analytics.errorMessage
      });
  }

  return lastAnalytics ?? ((await scrapeActivePageDom(tabId, "postAnalytics")) as NormalizedPostAnalytics);
}

async function handleSyncPostAnalytics(): Promise<PopupResponse> {
  logger.log("Handling SYNC_POST_ANALYTICS.");
  const { session, response } = await ensureAuthenticatedSession();
  const managedTab = await getOrCreateManagedLinkedInTab();
  if (!managedTab.id) {
    throw new Error("Unable to acquire a LinkedIn tab.");
  }

  const baseSnapshot = await ensureOwnActivitySnapshot(session, managedTab.id);
  const syncableItems = baseSnapshot.activityItems.filter((item) => Boolean(item.analyticsUrl));
  if (!syncableItems.length) {
    const noWorkState: ActivityScrapeState = {
      status: "error",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      itemCount: baseSnapshot.activityItems.length,
      analyticsCount: countActivityItemsWithAnalytics(baseSnapshot.activityItems),
      error: "No recent activity items with derivable LinkedIn analytics URLs were found."
    };
    await writeActivitySnapshot(baseSnapshot);
    await writeActivitySyncState(noWorkState);
    logger.warn("SYNC_POST_ANALYTICS found no syncable activity items.");

    return {
      ...response,
      success: false,
      error: noWorkState.error ?? undefined,
      activitySnapshot: baseSnapshot,
      activitySync: noWorkState,
      state: await readExtensionState()
    };
  }

  const runningState: ActivityScrapeState = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    itemCount: baseSnapshot.activityItems.length,
    analyticsCount: countActivityItemsWithAnalytics(baseSnapshot.activityItems),
    error: null
  };
  await writeActivitySnapshot(baseSnapshot);
  await writeActivitySyncState(runningState);

  let snapshot = baseSnapshot;
  let failureCount = 0;
  let unavailableCount = 0;

  for (const [index, item] of snapshot.activityItems.entries()) {
    if (!item.analyticsUrl) {
      continue;
    }

    try {
      const analytics = await scrapePostAnalyticsWithRetry(managedTab.id, item.analyticsUrl);
      const capturedAt = new Date().toISOString();
      snapshot = mergeAnalyticsIntoSnapshotItem(snapshot, index, analytics, capturedAt);
      await writeActivitySnapshot(snapshot);
      await writeActivitySyncState({
        ...runningState,
        itemCount: snapshot.activityItems.length,
        analyticsCount: countActivityItemsWithAnalytics(snapshot.activityItems)
      });
      if (analytics.status === "unavailable") {
        unavailableCount += 1;
      } else if (analytics.status === "failed") {
        failureCount += 1;
      }
      logger.log("Processed post analytics for activity item.", {
        index,
        status: analytics.status,
        activityUrn: analytics.activityUrn ?? item.activityUrn,
        analyticsUrl: item.analyticsUrl,
        metricCount: analytics.metrics.length,
        errorMessage: analytics.errorMessage
      });
    } catch (error) {
      failureCount += 1;
      logger.warn("Post analytics sync failed for activity item.", {
        index,
        analyticsUrl: item.analyticsUrl,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const analyticsCount = countActivityItemsWithAnalytics(snapshot.activityItems);
  const finishedAt = new Date().toISOString();
  const summaryErrors = [
    unavailableCount ? `${unavailableCount} post analytics page(s) unavailable` : null,
    failureCount ? `${failureCount} post analytics page(s) failed to load` : null
  ].filter(Boolean);
  const finalState: ActivityScrapeState = {
    status: failureCount && analyticsCount === 0 ? "error" : "success",
    startedAt: runningState.startedAt,
    finishedAt,
    itemCount: snapshot.activityItems.length,
    analyticsCount,
    error: summaryErrors.length ? summaryErrors.join("; ") : null
  };

  await writeActivitySnapshot({
    ...snapshot,
    capturedAt: finishedAt
  });
  await writeActivitySyncState(finalState);
  logger.log("Completed SYNC_POST_ANALYTICS.", {
    itemCount: finalState.itemCount,
    analyticsCount: finalState.analyticsCount,
    failureCount,
    unavailableCount
  });

  return {
    ...response,
    success: finalState.status !== "error",
    error: finalState.error ?? undefined,
    activitySnapshot: {
      ...snapshot,
      capturedAt: finishedAt
    },
    activitySync: finalState,
    state: await readExtensionState()
  };
}

async function handleSyncFollowers(): Promise<PopupResponse> {
  logger.log("Handling SYNC_FOLLOWERS.");
  const { session, response } = await ensureAuthenticatedSession();
  const managedTab = await getOrCreateManagedLinkedInTab();
  if (!managedTab.id) {
    throw new Error("Unable to acquire a LinkedIn tab.");
  }
  const managedTabId = managedTab.id;

  const runningState: FollowerSyncState = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    itemCount: 0,
    error: null
  };
  await writeFollowerSync(runningState);

  try {
    const { followers, raw } = await withTemporarilyActivatedTab(managedTabId, async () => {
      await navigateTab(managedTabId, LINKEDIN_FOLLOWERS_URL);
      return scrapeFollowersDom(managedTabId);
    });
    let normalizedFollowers = normalizeFollowerRecords(followers);
    const followerApiSeedUrl = extractFollowerApiSeedUrlFromRaw(raw);
    let voyagerAugmentationRaw: Record<string, unknown> | null = null;

    if (followerApiSeedUrl) {
      const augmentation = await augmentFollowersViaVoyagerApiSeed({
        tabId: managedTabId,
        session,
        seedUrl: followerApiSeedUrl,
        initialFollowers: normalizedFollowers
      });
      normalizedFollowers = augmentation.followers;
      voyagerAugmentationRaw = augmentation.raw;
    }

    const finishedAt = new Date().toISOString();
    const successState: FollowerSyncState = {
      status: "success",
      startedAt: runningState.startedAt,
      finishedAt,
      itemCount: normalizedFollowers.length,
      error: null
    };

    await writeFollowers(
      normalizedFollowers.map((follower) => ({
        ...follower,
        raw:
          follower.raw && typeof follower.raw === "object"
            ? {
                ...(follower.raw as Record<string, unknown>),
                scrapedAt: finishedAt
              }
            : follower.raw
      }))
    );
    await writeFollowerSync(successState);
    logger.log("Completed follower sync.", {
      itemCount: normalizedFollowers.length,
      raw:
        raw && typeof raw === "object"
          ? {
              ...(raw as Record<string, unknown>),
              followerApiSeedUrl,
              voyagerAugmentation: voyagerAugmentationRaw
            }
          : raw
    });

    return {
      ...response,
      followerSync: successState,
      followers: normalizedFollowers,
      state: await readExtensionState()
    };
  } catch (error) {
    const errorState: FollowerSyncState = {
      status: "error",
      startedAt: runningState.startedAt,
      finishedAt: new Date().toISOString(),
      itemCount: 0,
      error: error instanceof Error ? error.message : String(error)
    };
    await writeFollowerSync(errorState);
    logger.error("Follower sync failed.", errorState);

    return {
      ...response,
      success: false,
      error: errorState.error ?? "Follower sync failed.",
      followerSync: errorState,
      state: await readExtensionState()
    };
  }
}

async function handleSaveConvexConfig(message: Extract<PopupRequest, { type: "SAVE_CONVEX_CONFIG" }>): Promise<PopupResponse> {
  logger.log("Handling SAVE_CONVEX_CONFIG.");
  const convexConfig: ConvexConfig = {
    deploymentUrl: normalizeConvexDeploymentUrl(message.payload.deploymentUrl),
    workspaceKey: message.payload.workspaceKey.trim(),
    syncToken: message.payload.syncToken.trim(),
    label: message.payload.label?.trim() || null,
    savedAt: new Date().toISOString()
  };

  if (!convexConfig.workspaceKey) {
    throw new Error("Convex workspace key is required.");
  }
  if (!convexConfig.syncToken) {
    throw new Error("Convex sync token is required.");
  }

  await writeConvexConfig(convexConfig);
  logger.log("Stored Convex config.", {
    deploymentUrl: convexConfig.deploymentUrl,
    workspaceKey: convexConfig.workspaceKey
  });

  return {
    success: true,
    convexConfig,
    state: await readExtensionState()
  };
}

async function handlePushToConvex(): Promise<PopupResponse> {
  logger.log("Handling PUSH_TO_CONVEX.");
  const extensionState = await readExtensionState();
  if (!extensionState.convexConfig) {
    throw new Error("Save a Convex deployment URL, workspace key, and sync token first.");
  }

  const runningState: ConvexSyncState = {
    ...defaultConvexSync,
    status: "uploading",
    startedAt: new Date().toISOString()
  };
  await writeConvexSyncState(runningState);

  try {
    const result = await pushExtensionStateToConvex(extensionState.convexConfig, extensionState, async (progress) => {
      await writeConvexSyncState({
        ...runningState,
        status: "uploading",
        runKey: progress.runKey,
        totalBatches: progress.totalBatches,
        uploadedBatches: progress.uploadedBatches,
        uploadedConnections: progress.uploadedConnections
      });
    });

    const finishedAt = new Date().toISOString();
    const successState: ConvexSyncState = {
      status: "success",
      startedAt: runningState.startedAt,
      finishedAt,
      runKey: result.runKey,
      totalBatches: result.totalBatches,
      uploadedBatches: result.uploadedBatches,
      uploadedConnections: result.connectionCount,
      remoteConnectionCount: result.remoteConnectionCount,
      remoteFollowerCount: result.remoteFollowerCount,
      error: null,
      lastSuccessfulPushAt: finishedAt
    };
    await writeConvexSyncState(successState);
    logger.log("Completed Convex push.", successState);

    return {
      success: true,
      convexSync: successState,
      state: await readExtensionState()
    };
  } catch (error) {
    const errorState: ConvexSyncState = {
      ...runningState,
      status: "error",
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    };
    await writeConvexSyncState(errorState);
    logger.error("Convex push failed.", errorState);

    return {
      success: false,
      error: errorState.error ?? "Convex push failed.",
      convexSync: errorState,
      state: await readExtensionState()
    };
  }
}

async function handlePing(): Promise<PopupResponse> {
  return {
    success: true,
    state: await readExtensionState()
  };
}

async function handleGetLinkedInAuth(): Promise<PopupResponse> {
  logger.log("Handling GET_LINKEDIN_AUTH.");
  const { session, authState } = await captureLinkedInSession();
  await writeSessionState(session);
  await writeAuthState(authState);

  logger.log("Completed GET_LINKEDIN_AUTH.", authState);

  return {
    success: authState.isAuthenticated,
    error: authState.isAuthenticated ? undefined : "No active LinkedIn session found in this Chrome profile.",
    authState,
    state: await readExtensionState()
  };
}

async function handleGetUserProfile(): Promise<PopupResponse> {
  logger.log("Handling GET_LINKEDIN_USER_PROFILE.");
  const { session, response } = await ensureAuthenticatedSession();
  const tab = await getOrCreateManagedLinkedInTab();
  if (!tab.id) {
    throw new Error("Unable to acquire a LinkedIn tab.");
  }

  const raw = await fetchJsonThroughTab(tab.id, LINKEDIN_ME_ENDPOINT, session, {
    accept: "application/json"
  });

  const userProfile = normalizeSelfProfile(raw);
  await writeUserProfile(userProfile);
  logger.log("Stored LinkedIn self profile.", {
    publicIdentifier: userProfile.publicIdentifier,
    profileUrl: userProfile.profileUrl
  });

  return {
    ...response,
    userProfile,
    state: await readExtensionState()
  };
}

async function handleScrapeActivePage(): Promise<PopupResponse> {
  logger.log("Handling SCRAPE_ACTIVE_PAGE.");
  const { session, response } = await ensureAuthenticatedSession();
  const activeTab = await getActiveTab();
  const url = activeTab?.url ?? "";
  const parsed = parseLinkedInUrl(url);

  logger.log("Resolved active tab for page scrape.", {
    tabId: activeTab?.id ?? null,
    url,
    pageType: parsed.pageType,
    identifier: parsed.identifier
  });

  if (!activeTab?.id || parsed.pageType === "unsupported" || !parsed.identifier) {
    const unsupported: PageScrape = {
      pageType: "unsupported",
      url,
      normalized: null,
      raw: null,
      capturedAt: new Date().toISOString()
    };
    await writePageScrape(unsupported);

    return {
      ...response,
      success: false,
      error: "Open a LinkedIn profile, company, or post analytics page in the active tab before scraping.",
      scrapeResult: unsupported,
      state: await readExtensionState()
    };
  }

  let raw: unknown;
  let normalized: PageScrape["normalized"] = null;
  if (parsed.pageType === "postAnalytics") {
    normalized = await scrapeActivePageDom(activeTab.id, "postAnalytics");
    raw = normalized?.raw ?? null;
  } else if (parsed.pageType === "profile") {
    try {
      raw = await fetchJsonThroughTab(activeTab.id, buildProfileEndpoint(parsed.identifier), session, {
        accept: "application/json"
      }, {
        failureLogLevel: "warn"
      });
      normalized = normalizeProfileResponse(raw, parsed.identifier);
    } catch (error) {
      logger.warn("Falling back to DOM scrape for active LinkedIn profile page.", {
        url,
        error: error instanceof Error ? error.message : String(error)
      });
      normalized = await scrapeActivePageDom(activeTab.id, "profile");
      raw = normalized?.raw ?? null;
    }
  } else {
    try {
      raw = await fetchJsonThroughTab(activeTab.id, buildCompanyEndpoint(parsed.identifier), session, {
        accept: "application/json"
      }, {
        failureLogLevel: "warn"
      });
      normalized = normalizeCompanyResponse(raw, parsed.identifier);
    } catch (error) {
      logger.warn("Falling back to DOM scrape for active LinkedIn company page.", {
        url,
        error: error instanceof Error ? error.message : String(error)
      });
      normalized = await scrapeActivePageDom(activeTab.id, "company");
      raw = normalized?.raw ?? null;
    }
  }

  const scrapeResult: PageScrape = {
    pageType: parsed.pageType,
    url,
    normalized,
    raw,
    capturedAt: new Date().toISOString()
  };
  await writePageScrape(scrapeResult);
  logger.log("Stored current page scrape.", {
    pageType: scrapeResult.pageType,
    url: scrapeResult.url
  });

  return {
    ...response,
    scrapeResult,
    state: await readExtensionState()
  };
}

async function handleSyncConnections(): Promise<PopupResponse> {
  logger.log("Handling SYNC_CONNECTIONS.");
  const { session, response } = await ensureAuthenticatedSession();
  const tab = await getOrCreateManagedLinkedInTab();
  if (!tab.id) {
    throw new Error("Unable to acquire a LinkedIn tab.");
  }

  const runningState: ConnectionSyncState = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    pageCount: 0,
    connectionCount: 0,
    error: null
  };
  await writeConnectionSync(runningState);

  const collectedRecords: ConnectionRecord[] = [];
  let pageCount = 0;
  let start = 0;

  try {
    while (true) {
      const raw = await fetchJsonThroughTab(tab.id, buildConnectionsEndpoint(start, CONNECTION_PAGE_SIZE), session, {
        accept: "application/vnd.linkedin.normalized+json+2.1"
      });
      const pageRecords = normalizeConnectionsPage(raw);
      const connectionEntityCount = countConnectionEntities(raw);
      pageCount += 1;
      collectedRecords.push(...pageRecords);

      const dedupedSoFar = dedupeConnections(collectedRecords);
      logger.log("Processed connections page.", {
        pageCount,
        start,
        connectionEntityCount,
        normalizedCount: pageRecords.length,
        dedupedCount: dedupedSoFar.length
      });
      await writeConnectionSync({
        status: "running",
        startedAt: runningState.startedAt,
        finishedAt: null,
        pageCount,
        connectionCount: dedupedSoFar.length,
        error: null
      });

      if (connectionEntityCount < CONNECTION_PAGE_SIZE) {
        break;
      }

      start += CONNECTION_PAGE_SIZE;
    }

    const dedupedConnections = dedupeConnections(collectedRecords);
    const successState: ConnectionSyncState = {
      status: "success",
      startedAt: runningState.startedAt,
      finishedAt: new Date().toISOString(),
      pageCount,
      connectionCount: dedupedConnections.length,
      error: null
    };

    await writeConnections(dedupedConnections);
    await writeConnectionSync(successState);
    logger.log("Completed connection sync.", successState);

    return {
      ...response,
      syncResult: successState,
      connections: dedupedConnections,
      state: await readExtensionState()
    };
  } catch (error) {
    const errorState: ConnectionSyncState = {
      status: "error",
      startedAt: runningState.startedAt,
      finishedAt: new Date().toISOString(),
      pageCount,
      connectionCount: dedupeConnections(collectedRecords).length,
      error: error instanceof Error ? error.message : String(error)
    };
    await writeConnectionSync(errorState);
    logger.error("Connection sync failed.", errorState);

    return {
      ...response,
      success: false,
      error: errorState.error ?? "Connection sync failed.",
      syncResult: errorState,
      connections: dedupeConnections(collectedRecords),
      state: await readExtensionState()
    };
  }
}

async function handleClearSessionState(): Promise<PopupResponse> {
  logger.log("Handling CLEAR_SESSION_STATE.");
  await clearLinkedInState();
  await writeManagedTabId(null);
  await writeActivitySnapshot(null);
  await writeActivitySyncState(defaultActivitySync);
  await writeConnectionSync(defaultConnectionSync);
  await writeFollowerSync(defaultFollowerSync);
  await writeFollowers([]);
  await writeConvexSyncState(defaultConvexSync);
  logger.log("Cleared extension state.");

  return {
    success: true,
    state: await readExtensionState()
  };
}

async function routeMessage(message: PopupRequest): Promise<PopupResponse> {
  logger.log("Received popup message.", { type: message.type });
  switch (message.type) {
    case "PING":
      return handlePing();
    case "GET_LINKEDIN_AUTH":
      return handleGetLinkedInAuth();
    case "GET_LINKEDIN_USER_PROFILE":
      return handleGetUserProfile();
    case "SCRAPE_ACTIVE_PAGE":
      return handleScrapeActivePage();
    case "SCRAPE_SELF_ACTIVITY":
      return handleScrapeSelfActivity();
    case "SYNC_POST_ANALYTICS":
      return handleSyncPostAnalytics();
    case "SYNC_CONNECTIONS":
      return handleSyncConnections();
    case "SYNC_FOLLOWERS":
      return handleSyncFollowers();
    case "SAVE_CONVEX_CONFIG":
      return handleSaveConvexConfig(message);
    case "PUSH_TO_CONVEX":
      return handlePushToConvex();
    case "CLEAR_SESSION_STATE":
      return handleClearSessionState();
    default:
      return fail("Unsupported message type.");
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await readExtensionState();
  const managedTabId = (await chrome.storage.local.get("managed_linkedin_tab_id")).managed_linkedin_tab_id;
  if (managedTabId === tabId) {
    await writeManagedTabId(null);
    logger.warn("Managed LinkedIn tab was removed.", { tabId });
  }
  if (state.connectionSync.status === "running") {
    await writeConnectionSync({
      ...state.connectionSync,
      status: "error",
      finishedAt: new Date().toISOString(),
      error: "Managed LinkedIn tab closed during sync."
    });
    logger.error("Connection sync interrupted because managed tab closed.", { tabId });
  }
  if (state.followerSync.status === "running") {
    await writeFollowerSync({
      ...state.followerSync,
      status: "error",
      finishedAt: new Date().toISOString(),
      error: "Managed LinkedIn tab closed during follower sync."
    });
    logger.error("Follower sync interrupted because managed tab closed.", { tabId });
  }
});

chrome.runtime.onMessage.addListener((message: PopupRequest, _sender, sendResponse) => {
  void routeMessage(message)
    .then(sendResponse)
    .catch((error) => {
      logger.error("Background message handler failed.", {
        type: message.type,
        error: error instanceof Error ? error.message : String(error)
      });
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      } satisfies PopupResponse);
    });

  return true;
});

logger.log("Background service worker initialized.", { buildTag: BUILD_TAG });
