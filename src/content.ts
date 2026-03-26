import type { BackgroundToContentMessage, ProxyResponse } from "./types";
import { createLogger } from "./lib/debug";

const FORBIDDEN_HEADERS = new Set(["cookie", "host", "origin", "referer", "content-length"]);
const logger = createLogger("content");
const contentGlobal = globalThis as typeof globalThis & {
  __tigerclawContentInitialized?: boolean;
};

function sanitizeHeaders(headers: Record<string, string> = {}): HeadersInit {
  return Object.fromEntries(
    Object.entries(headers).filter(([key, value]) => {
      return Boolean(value) && !FORBIDDEN_HEADERS.has(key.toLowerCase());
    })
  );
}

if (!contentGlobal.__tigerclawContentInitialized) {
  contentGlobal.__tigerclawContentInitialized = true;

  chrome.runtime.onMessage.addListener(
    (
      message: BackgroundToContentMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => {
      if (message.type === "PING") {
        logger.log("Received ping from background.");
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === "LINKEDIN_API_REQUEST") {
        void (async () => {
          const { payload } = message;
          logger.log("Executing LinkedIn page-context fetch.", {
            requestId: payload.id,
            method: payload.method,
            url: payload.url
          });

          try {
            const response = await fetch(payload.url, {
              method: payload.method,
              headers: sanitizeHeaders(payload.headers),
              credentials: "include",
              body: payload.body
            });

            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => {
              headers[key] = value;
            });

            const proxyResponse: ProxyResponse = {
              id: payload.id,
              success: response.ok,
              status: response.status,
              statusText: response.statusText,
              headers,
              body: await response.text()
            };

            logger.log("Completed LinkedIn page-context fetch.", {
              requestId: payload.id,
              status: proxyResponse.status,
              success: proxyResponse.success
            });

            sendResponse(proxyResponse);
          } catch (error) {
            logger.error("LinkedIn page-context fetch failed.", {
              requestId: payload.id,
              error: error instanceof Error ? error.message : String(error)
            });
            sendResponse({
              id: payload.id,
              success: false,
              status: 0,
              statusText: "",
              headers: {},
              body: "",
              error: error instanceof Error ? error.message : String(error)
            } satisfies ProxyResponse);
          }
        })();

        return true;
      }

      return false;
    }
  );

  logger.log("Content script initialized.", { url: window.location.href });
} else {
  logger.log("Content script reinjection skipped because it is already initialized.", {
    url: window.location.href
  });
}
