import { LINKEDIN_FEED_URL } from "./linkedinEndpoints";
import { readManagedTabId, writeManagedTabId } from "./storage";
import type { ProxyRequestPayload, ProxyResponse } from "../types";
import { createLogger } from "./debug";

const READY_ATTEMPTS = 20;
const READY_DELAY_MS = 500;
const FORBIDDEN_HEADERS = new Set([
  "cookie",
  "host",
  "content-length",
  "origin",
  "referer"
]);
const logger = createLogger("proxy");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabLoad(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        logger.log("LinkedIn tab finished loading.", {
          tabId,
          attempt: attempt + 1,
          url: tab.url
        });
        return;
      }
      logger.log("Waiting for LinkedIn tab to finish loading.", {
        tabId,
        attempt: attempt + 1,
        status: tab.status,
        url: tab.url
      });
    } catch (error) {
      logger.warn("Unable to inspect LinkedIn tab load state.", {
        tabId,
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    await sleep(READY_DELAY_MS);
  }

  logger.warn("Timed out waiting for LinkedIn tab to report complete load status.", { tabId });
}

function sanitizeHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([key, value]) => {
      return Boolean(value) && !FORBIDDEN_HEADERS.has(key.toLowerCase());
    })
  );
}

async function injectContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    logger.log("Injected content script into LinkedIn tab.", { tabId });
  } catch (error) {
    logger.warn("Content script injection failed.", {
      tabId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function getTabIfValid(tabId: number | null): Promise<chrome.tabs.Tab | null> {
  if (typeof tabId !== "number") {
    return null;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    logger.log("Validated stored managed tab.", { tabId, url: tab.url });
    return tab.url?.startsWith("https://www.linkedin.com/") ? tab : null;
  } catch {
    logger.warn("Stored managed tab is no longer valid.", { tabId });
    return null;
  }
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

export async function getOrCreateManagedLinkedInTab(): Promise<chrome.tabs.Tab> {
  const storedTab = await getTabIfValid(await readManagedTabId());
  if (storedTab?.id) {
    await waitForTabLoad(storedTab.id);
    await injectContentScript(storedTab.id);
    logger.log("Reusing stored managed LinkedIn tab.", { tabId: storedTab.id, url: storedTab.url });
    return storedTab;
  }

  const existingTabs = await chrome.tabs.query({ url: ["https://www.linkedin.com/*"] });
  const reusableTab =
    existingTabs.find((tab) => tab.url?.startsWith(LINKEDIN_FEED_URL) && !tab.active) ??
    existingTabs.find((tab) => tab.url?.startsWith("https://www.linkedin.com/"));

  if (reusableTab?.id) {
    await writeManagedTabId(reusableTab.id);
    await waitForTabLoad(reusableTab.id);
    await injectContentScript(reusableTab.id);
    logger.log("Reusing existing LinkedIn tab as managed tab.", { tabId: reusableTab.id, url: reusableTab.url });
    return reusableTab;
  }

  const createdTab = await chrome.tabs.create({
    url: LINKEDIN_FEED_URL,
    active: false
  });

  if (!createdTab.id) {
    throw new Error("Unable to create a managed LinkedIn tab.");
  }

  await writeManagedTabId(createdTab.id);
  await waitForTabLoad(createdTab.id);
  await injectContentScript(createdTab.id);
  logger.log("Created new managed LinkedIn tab.", { tabId: createdTab.id, url: createdTab.url });
  return createdTab;
}

export async function ensureTabReady(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (response?.ok) {
        logger.log("Managed LinkedIn tab responded to ping.", {
          tabId,
          attempt: attempt + 1
        });
        return;
      }
    } catch (error) {
      logger.warn("Managed LinkedIn tab ping failed.", {
        tabId,
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error)
      });
      await waitForTabLoad(tabId);
      await injectContentScript(tabId);
      await sleep(READY_DELAY_MS);
      continue;
    }

    await sleep(READY_DELAY_MS);
  }

  throw new Error("LinkedIn tab is not ready for proxy requests.");
}

export async function proxyLinkedInRequest(
  tabId: number,
  payload: Omit<ProxyRequestPayload, "id"> & { id?: string }
): Promise<ProxyResponse> {
  await ensureTabReady(tabId);

  const requestPayload: ProxyRequestPayload = {
    id: payload.id ?? crypto.randomUUID(),
    url: payload.url,
    method: payload.method,
    headers: sanitizeHeaders(payload.headers),
    body: payload.body
  };

  logger.log("Proxying LinkedIn request through managed tab.", {
    tabId,
    requestId: requestPayload.id,
    method: requestPayload.method,
    url: requestPayload.url
  });

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "LINKEDIN_API_REQUEST",
      payload: requestPayload
    });

    logger.log("Received LinkedIn proxy response.", {
      tabId,
      requestId: requestPayload.id,
      status: (response as ProxyResponse | undefined)?.status,
      success: (response as ProxyResponse | undefined)?.success
    });

    return response as ProxyResponse;
  } catch (error) {
    logger.error("LinkedIn proxy request failed.", {
      tabId,
      requestId: requestPayload.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      id: requestPayload.id,
      success: false,
      status: 0,
      statusText: "",
      headers: {},
      body: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
