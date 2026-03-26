import type { AuthState, SessionStateInternal } from "../types";
import { createLogger } from "./debug";

const logger = createLogger("auth");

function stripCookieQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, "");
}

function summarizeSession(session: SessionStateInternal | null, hasAuthCookie: boolean): AuthState {
  return {
    isAuthenticated: Boolean(session?.csrfToken && hasAuthCookie),
    cookieCount: session?.cookieCount ?? 0,
    csrfPresent: Boolean(session?.csrfToken),
    capturedAt: session?.capturedAt ?? null
  };
}

export async function captureLinkedInSession(): Promise<{
  session: SessionStateInternal | null;
  authState: AuthState;
}> {
  const cookies = await chrome.cookies.getAll({ url: "https://www.linkedin.com" });
  const hasAuthCookie = cookies.some((cookie) => cookie.name === "li_at");
  const jsessionCookie = cookies.find((cookie) => cookie.name === "JSESSIONID");

  logger.log("Captured LinkedIn cookies.", {
    cookieCount: cookies.length,
    hasAuthCookie,
    hasJsession: Boolean(jsessionCookie)
  });

  if (!cookies.length || !jsessionCookie) {
    logger.warn("LinkedIn session capture failed due to missing cookies or JSESSIONID.");
    return {
      session: null,
      authState: summarizeSession(null, hasAuthCookie)
    };
  }

  const session: SessionStateInternal = {
    cookieHeader: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    csrfToken: stripCookieQuotes(jsessionCookie.value),
    cookieCount: cookies.length,
    capturedAt: new Date().toISOString()
  };

  logger.log("LinkedIn session initialized.", {
    cookieCount: session.cookieCount,
    csrfPresent: Boolean(session.csrfToken),
    capturedAt: session.capturedAt
  });

  return {
    session,
    authState: summarizeSession(session, hasAuthCookie)
  };
}

export function buildLinkedInHeaders(
  session: SessionStateInternal | null,
  overrides: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9",
    "x-restli-protocol-version": "2.0.0"
  };

  if (session?.csrfToken) {
    headers["csrf-token"] = session.csrfToken;
  }

  return {
    ...headers,
    ...overrides
  };
}
