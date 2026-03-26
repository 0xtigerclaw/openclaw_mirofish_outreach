import type { PageType } from "../types";

export const LINKEDIN_ROOT = "https://www.linkedin.com";
export const LINKEDIN_FEED_URL = `${LINKEDIN_ROOT}/feed/`;
export const LINKEDIN_ME_ENDPOINT = `${LINKEDIN_ROOT}/voyager/api/me`;
export const LINKEDIN_FOLLOWERS_URL = `${LINKEDIN_ROOT}/mynetwork/network-manager/people-follow/followers/`;

const PROFILE_QUERY_ID = "voyagerIdentityDashProfiles.df542d77691239a0795555af70eb2fc5";
const COMPANY_QUERY_ID = "voyagerOrganizationDashCompanies.fa2406b3c9a92ef518667209c5e9c3ca";

export function buildProfileEndpoint(publicIdentifier: string): string {
  const variables = encodeURIComponent(`(vanityName:${publicIdentifier})`);
  return `${LINKEDIN_ROOT}/voyager/api/graphql?variables=${variables}&queryId=${PROFILE_QUERY_ID}`;
}

export function buildCompanyEndpoint(universalName: string): string {
  const variables = encodeURIComponent(`(universalName:${universalName})`);
  return `${LINKEDIN_ROOT}/voyager/api/graphql?variables=${variables}&queryId=${COMPANY_QUERY_ID}`;
}

export function buildConnectionsEndpoint(start: number, count = 40): string {
  const params = new URLSearchParams({
    decorationId: "com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16",
    count: String(count),
    start: String(start),
    q: "search",
    sortType: "RECENTLY_ADDED"
  });
  return `${LINKEDIN_ROOT}/voyager/api/relationships/dash/connections?${params.toString()}`;
}

export function parseLinkedInUrl(url: string | null | undefined): {
  pageType: PageType;
  identifier: string | null;
} {
  if (!url) {
    return { pageType: "unsupported", identifier: null };
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("linkedin.com")) {
      return { pageType: "unsupported", identifier: null };
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] === "in" && segments[1]) {
      return { pageType: "profile", identifier: segments[1] };
    }
    if (segments[0] === "company" && segments[1]) {
      return { pageType: "company", identifier: segments[1] };
    }
    if (segments[0] === "analytics" && segments[1] === "post-summary" && segments[2]) {
      return { pageType: "postAnalytics", identifier: decodeURIComponent(segments[2]) };
    }
    return { pageType: "unsupported", identifier: null };
  } catch {
    return { pageType: "unsupported", identifier: null };
  }
}
