import { runMiroFishPilot } from "../lib/mirofishPilot";
import type { PilotScenarioId } from "../sim/types";

function parseArgs(argv: string[]) {
  const result: Record<string, string | boolean> = {};

  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      continue;
    }

    const normalized = argument.slice(2);
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex === -1) {
      result[normalized] = true;
      continue;
    }

    const key = normalized.slice(0, equalsIndex);
    const value = normalized.slice(equalsIndex + 1);
    result[key] = value;
  }

  return result;
}

function parseScenarioIds(value: string | boolean | undefined): PilotScenarioId[] | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) as PilotScenarioId[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectionLimit =
    typeof args["selection-limit"] === "string" ? Number(args["selection-limit"]) : undefined;
  const maxRounds = typeof args["max-rounds"] === "string" ? Number(args["max-rounds"]) : undefined;
  const parallelProfileCount =
    typeof args["parallel-profile-count"] === "string" ? Number(args["parallel-profile-count"]) : undefined;
  const fastMode = Boolean(args.fast);

  const result = await runMiroFishPilot({
    workspaceKey: typeof args["workspace-key"] === "string" ? args["workspace-key"] : undefined,
    syncToken: typeof args["sync-token"] === "string" ? args["sync-token"] : undefined,
    deploymentUrl: typeof args["deployment-url"] === "string" ? args["deployment-url"] : undefined,
    label: typeof args.label === "string" ? args.label : undefined,
    sharedGraphId: typeof args["shared-graph-id"] === "string" ? args["shared-graph-id"] : undefined,
    outputRootDir: typeof args["output-dir"] === "string" ? args["output-dir"] : undefined,
    selectionLimit: Number.isFinite(selectionLimit) ? selectionLimit : undefined,
    maxRounds: Number.isFinite(maxRounds) ? maxRounds : undefined,
    scenarios: parseScenarioIds(args.scenarios),
    mirofishRootDir: typeof args["mirofish-root"] === "string" ? args["mirofish-root"] : undefined,
    mirofishBaseUrl: typeof args["mirofish-url"] === "string" ? args["mirofish-url"] : undefined,
    autoStartMiroFish: args["no-autostart"] ? false : undefined,
    parallelProfileCount: Number.isFinite(parallelProfileCount) ? parallelProfileCount : undefined,
    includeInterviews: fastMode || args["skip-interviews"] ? false : undefined,
    includeReport: fastMode || args["skip-report"] ? false : undefined
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        outputDir: result.outputDir,
        workspaceKey: result.workspaceKey,
        rankedActions: result.consolidated.rankedActions.length,
        recommendedScenarioId: result.consolidated.recommendedScenarioId
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
