import type { ConvexConfig } from "../types";

declare const __DEFAULT_CONVEX_URL__: string | undefined;
declare const __DEFAULT_CONVEX_WORKSPACE_KEY__: string | undefined;
declare const __DEFAULT_CONVEX_SYNC_TOKEN__: string | undefined;
declare const __DEFAULT_CONVEX_LABEL__: string | undefined;

function normalizeOptional(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function getBundledConvexConfig(): ConvexConfig | null {
  const deploymentUrl = normalizeOptional(__DEFAULT_CONVEX_URL__);
  const workspaceKey = normalizeOptional(__DEFAULT_CONVEX_WORKSPACE_KEY__);
  const syncToken = normalizeOptional(__DEFAULT_CONVEX_SYNC_TOKEN__);
  const label = normalizeOptional(__DEFAULT_CONVEX_LABEL__);

  if (!deploymentUrl || !workspaceKey || !syncToken) {
    return null;
  }

  return {
    deploymentUrl,
    workspaceKey,
    syncToken,
    label,
    savedAt: "build-time-default"
  };
}
