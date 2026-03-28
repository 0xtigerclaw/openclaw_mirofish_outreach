import { ConvexHttpClient } from "convex/browser";
import { api as missionControlApi } from "../../../../../clawd/mission-control/convex/_generated/api.js";
import type { DemoGraphStage } from "./demoTypes";

const MISSION_CONTROL_CONVEX_URL = "http://127.0.0.1:3210";
const MISSION_CONTROL_APP_URL = "http://localhost:3000";

export const MISSION_CONTROL_WORKFLOW = ["Curie", "Ogilvy", "Carnegie", "Ive"] as const;

export type MissionControlMission = {
  taskId: string;
  title: string;
  url: string;
  workflow: readonly string[];
};

let missionControlClient: ConvexHttpClient | null = null;

function getMissionControlClient() {
  if (!missionControlClient) {
    missionControlClient = new ConvexHttpClient(MISSION_CONTROL_CONVEX_URL);
  }

  return missionControlClient;
}

function buildMissionTitle(stage: DemoGraphStage) {
  const connectorName = stage.narrative.connector.name;
  const destinationName = stage.narrative.likelyInvestorDestination.name;
  return `LinkedIn outreach campaign: ${connectorName} -> ${destinationName}`;
}

function buildMissionDescription(stage: DemoGraphStage) {
  const narrative = stage.narrative;
  const supportingProof = narrative.supportingProof
    .map((proof) => `- ${proof}`)
    .join("\n");

  const executionNotes = narrative.executionRows
    .map((row) => `- ${row.label}: ${row.value}`)
    .join("\n");

  return [
    "Tigerclaw founder-selected outreach mission.",
    "",
    "Use the selected route below to build the final LinkedIn outreach campaign. Do not reopen route selection.",
    "",
    "FOUNDER",
    `- Name: Swayam Shah`,
    `- Company: Tigerclaw`,
    "",
    "SELECTED ROUTE",
    `- Best person to ask: ${narrative.connector.name}${narrative.connector.company ? ` | ${narrative.connector.company}` : ""}${narrative.connector.title ? ` | ${narrative.connector.title}` : ""}`,
    `- Likely investor destination: ${narrative.likelyInvestorDestination.name} | ${narrative.likelyInvestorDestination.description}`,
    `- Warm path summary: ${narrative.warmPathSummary}`,
    `- Why this route: ${narrative.whyThisPerson}`,
    `- Why now: ${narrative.whyNow}`,
    `- Suggested ask: ${narrative.suggestedAsk}`,
    `- Risk to manage: ${narrative.likelyObjection}`,
    `- Next best step: ${narrative.nextBestStep}`,
    "",
    "SUPPORTING PROOF",
    supportingProof,
    "",
    "DRAFT TO REFINE",
    narrative.draftMessage,
    "",
    "DELIVERABLES",
    "- Curie: tighten the route intelligence, trust signals, and investor/context fit for the chosen path.",
    "- Ogilvy: write the primary LinkedIn outreach message plus one short follow-up.",
    "- Carnegie: polish the outreach package, tighten the ask, and improve objection handling.",
    "- Ive: create a light support asset or visual context card only if it strengthens the outreach package.",
    "",
    "EXECUTION NOTES",
    executionNotes,
    "",
    `MANDATORY WORKFLOW: ${MISSION_CONTROL_WORKFLOW.join(" -> ")}`,
  ].join("\n");
}

export async function createMissionControlMission(stage: DemoGraphStage): Promise<MissionControlMission> {
  const client = getMissionControlClient();
  const title = buildMissionTitle(stage);
  const description = buildMissionDescription(stage);

  const taskId = await client.mutation((missionControlApi as any).tasks.create, {
    title,
    description,
    priority: "high",
    workflow: [...MISSION_CONTROL_WORKFLOW],
  });

  return {
    taskId: String(taskId),
    title,
    url: `${MISSION_CONTROL_APP_URL}/mission/${String(taskId)}`,
    workflow: [...MISSION_CONTROL_WORKFLOW],
  };
}
