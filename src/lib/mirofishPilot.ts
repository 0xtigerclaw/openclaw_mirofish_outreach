import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLogger } from "./debug";
import { callConvexQuery, normalizeConvexDeploymentUrl } from "./convex";
import { MiroFishClient } from "./mirofishClient";
import type {
  ConsolidatedPilotOutput,
  FollowOnTarget,
  PilotBucket,
  PilotRunResult,
  PilotScenarioId,
  PilotWorkspaceSnapshot,
  ProofAsset,
  RankedAction,
  ScenarioBundle,
  ScenarioDefinition,
  ScenarioTopCandidate,
  SeedPack,
  SelectedConnection,
  WorkspaceConnectionRecord
} from "../sim/types";
import type { ConvexConfig, OwnActivitySnapshot, UserProfile } from "../types";

const logger = createLogger("mirofish-pilot");
const DEFAULT_SELECTION_LIMIT = 40;
const DEFAULT_MAX_ROUNDS = 24;
const DEFAULT_OUTPUT_ROOT = "pilot-runs";
const DEFAULT_GRAPH_CACHE_DIR = ".mirofish-cache";
const DEFAULT_MIROFISH_ROOT = "/Users/swayam/developer/mirofish";
const DEFAULT_MIROFISH_URL = "http://localhost:5001";
const DEFAULT_PARALLEL_PROFILE_COUNT = 5;
const DEFAULT_GRAPH_CHUNK_SIZE = 1_200;
const DEFAULT_GRAPH_CHUNK_OVERLAP = 120;
const DEFAULT_MISSION_CONTROL_ENV = "/Users/swayam/clawd/mission-control/.env.local";
const DEFAULT_SHARED_OPENAI_GATEWAY_ENV = "/Users/swayam/.config/openai-gateway.env";
const DEFAULT_SCENARIOS: readonly PilotScenarioId[] = [
  "direct_reply",
  "ecosystem_leverage",
  "amplifier_route",
  "bridge_then_expand"
];

const GTM_PARTNER_WORLD_ONTOLOGY = {
  entity_types: [
    {
      name: "PartnerLeader",
      description: "People responsible for partnerships, alliances, or ecosystem growth.",
      attributes: [
        { name: "full_name", type: "text", description: "Leader name" },
        { name: "role_title", type: "text", description: "Current partnership or ecosystem title" }
      ],
      examples: ["Strategic Partnerships Lead", "Ecosystem Manager"]
    },
    {
      name: "FounderOperator",
      description: "Founders or operators shaping product, growth, or company direction.",
      attributes: [
        { name: "full_name", type: "text", description: "Founder or operator name" },
        { name: "role_title", type: "text", description: "Current operating title" }
      ],
      examples: ["Founder", "CEO"]
    },
    {
      name: "Investor",
      description: "Investors, fund partners, angels, or capital allocators.",
      attributes: [
        { name: "full_name", type: "text", description: "Investor name" },
        { name: "firm_name", type: "text", description: "Fund or firm affiliation" }
      ],
      examples: ["VC Partner", "Angel Investor"]
    },
    {
      name: "SpeakerHost",
      description: "People who host events, podcasts, workshops, or stage-based programs.",
      attributes: [
        { name: "full_name", type: "text", description: "Host or speaker name" },
        { name: "program_name", type: "text", description: "Event, show, or speaking platform" }
      ],
      examples: ["Conference Host", "Podcast Moderator"]
    },
    {
      name: "MediaCreator",
      description: "Journalists, creators, editors, or media operators with audience reach.",
      attributes: [
        { name: "full_name", type: "text", description: "Creator or journalist name" },
        { name: "channel_name", type: "text", description: "Primary media channel or publication" }
      ],
      examples: ["Newsletter Writer", "Podcast Creator"]
    },
    {
      name: "CommunityLeader",
      description: "People running communities, developer programs, or ecosystem groups.",
      attributes: [
        { name: "full_name", type: "text", description: "Community lead name" },
        { name: "community_name", type: "text", description: "Community or program name" }
      ],
      examples: ["Developer Community Lead", "Ambassador Program Manager"]
    },
    {
      name: "TechnicalOperator",
      description: "Technical builders or product operators with implementation context.",
      attributes: [
        { name: "full_name", type: "text", description: "Technical operator name" },
        { name: "focus_area", type: "text", description: "Primary technical focus area" }
      ],
      examples: ["AI Engineer", "Infrastructure Lead"]
    },
    {
      name: "Company",
      description: "Companies or startups participating in the partner ecosystem.",
      attributes: [
        { name: "company_name", type: "text", description: "Company name" },
        { name: "market_focus", type: "text", description: "Primary market or product focus" }
      ],
      examples: ["AI Startup", "Platform Company"]
    },
    {
      name: "Person",
      description: "Fallback type for a person who does not fit a more specific role.",
      attributes: [
        { name: "full_name", type: "text", description: "Person name" },
        { name: "role_title", type: "text", description: "Observed title or role" }
      ],
      examples: ["Advisor", "Operator"]
    },
    {
      name: "Organization",
      description: "Fallback type for an organization outside the more specific categories.",
      attributes: [
        { name: "org_name", type: "text", description: "Organization name" },
        { name: "org_focus", type: "text", description: "Observed focus or mission" }
      ],
      examples: ["Conference", "Association"]
    }
  ],
  edge_types: [
    {
      name: "WORKS_AT",
      description: "A person is affiliated with a company or organization.",
      source_targets: [
        { source: "PartnerLeader", target: "Company" },
        { source: "FounderOperator", target: "Company" },
        { source: "Investor", target: "Organization" },
        { source: "SpeakerHost", target: "Organization" },
        { source: "MediaCreator", target: "Organization" },
        { source: "CommunityLeader", target: "Organization" },
        { source: "TechnicalOperator", target: "Company" },
        { source: "Person", target: "Organization" }
      ],
      attributes: []
    },
    {
      name: "PARTNERS_WITH",
      description: "Two companies or organizations have an ecosystem or partner relationship.",
      source_targets: [
        { source: "Company", target: "Company" },
        { source: "Company", target: "Organization" },
        { source: "Organization", target: "Organization" }
      ],
      attributes: []
    },
    {
      name: "INVESTS_IN",
      description: "An investor or firm backs a company or founder.",
      source_targets: [
        { source: "Investor", target: "Company" },
        { source: "Investor", target: "FounderOperator" },
        { source: "Organization", target: "Company" }
      ],
      attributes: []
    },
    {
      name: "INTRODUCES",
      description: "A person can create a warm path to another person or entity.",
      source_targets: [
        { source: "PartnerLeader", target: "FounderOperator" },
        { source: "FounderOperator", target: "FounderOperator" },
        { source: "Investor", target: "PartnerLeader" },
        { source: "CommunityLeader", target: "TechnicalOperator" },
        { source: "Person", target: "Organization" }
      ],
      attributes: []
    },
    {
      name: "COLLABORATES_WITH",
      description: "People or organizations work together on shared programs or outcomes.",
      source_targets: [
        { source: "FounderOperator", target: "TechnicalOperator" },
        { source: "PartnerLeader", target: "FounderOperator" },
        { source: "CommunityLeader", target: "PartnerLeader" },
        { source: "Company", target: "Organization" }
      ],
      attributes: []
    },
    {
      name: "AMPLIFIES",
      description: "A person or organization can increase reach for another entity.",
      source_targets: [
        { source: "MediaCreator", target: "FounderOperator" },
        { source: "SpeakerHost", target: "Company" },
        { source: "CommunityLeader", target: "Organization" },
        { source: "Person", target: "MediaCreator" }
      ],
      attributes: []
    },
    {
      name: "COVERS",
      description: "Media or speaking entities cover a company, founder, or organization.",
      source_targets: [
        { source: "MediaCreator", target: "Company" },
        { source: "MediaCreator", target: "FounderOperator" },
        { source: "SpeakerHost", target: "Organization" }
      ],
      attributes: []
    },
    {
      name: "SPEAKS_AT",
      description: "A person speaks at or is featured by an event or organization.",
      source_targets: [
        { source: "FounderOperator", target: "Organization" },
        { source: "PartnerLeader", target: "Organization" },
        { source: "SpeakerHost", target: "Organization" },
        { source: "Person", target: "Organization" }
      ],
      attributes: []
    }
  ],
  analysis_summary:
    "Fixed ontology for GTM partner-intro rehearsal using first-degree LinkedIn relationships, partner leverage, amplification, and bridge paths."
} as const;

const BASE_GRAPH_SIMULATION_REQUIREMENT =
  "Build a GTM partner-intro world over the uploaded first-degree LinkedIn network. Preserve people, companies, organizations, speaking platforms, community nodes, and likely partner-introduction paths.";

const BUCKET_ORDER: readonly PilotBucket[] = [
  "ecosystem",
  "founder_operator",
  "amplifier",
  "bridge"
];

const GTM_PERSON_ENTITY_TYPES = [
  "PartnerLeader",
  "FounderOperator",
  "Investor",
  "SpeakerHost",
  "MediaCreator",
  "CommunityLeader",
  "TechnicalOperator",
  "Person"
] as const;

const BUCKET_KEYWORDS: Record<PilotBucket, Array<{ pattern: string; weight: number }>> = {
  ecosystem: [
    { pattern: "partnership", weight: 14 },
    { pattern: "partnerships", weight: 14 },
    { pattern: "ecosystem", weight: 12 },
    { pattern: "alliances", weight: 11 },
    { pattern: "business development", weight: 10 },
    { pattern: "bd ", weight: 7 },
    { pattern: "channel", weight: 8 },
    { pattern: "platform", weight: 7 },
    { pattern: "marketplace", weight: 7 },
    { pattern: "integrations", weight: 6 },
    { pattern: "developer relations", weight: 7 },
    { pattern: "community", weight: 5 }
  ],
  founder_operator: [
    { pattern: "founder", weight: 14 },
    { pattern: "co-founder", weight: 14 },
    { pattern: "ceo", weight: 10 },
    { pattern: "cto", weight: 9 },
    { pattern: "operator", weight: 8 },
    { pattern: "builder", weight: 8 },
    { pattern: "product", weight: 6 },
    { pattern: "growth", weight: 6 },
    { pattern: "ai", weight: 7 },
    { pattern: "artificial intelligence", weight: 7 },
    { pattern: "blockchain", weight: 7 },
    { pattern: "web3", weight: 7 },
    { pattern: "infra", weight: 5 }
  ],
  amplifier: [
    { pattern: "media", weight: 10 },
    { pattern: "journalist", weight: 10 },
    { pattern: "editor", weight: 9 },
    { pattern: "creator", weight: 8 },
    { pattern: "speaker", weight: 8 },
    { pattern: "host", weight: 8 },
    { pattern: "podcast", weight: 8 },
    { pattern: "conference", weight: 8 },
    { pattern: "event", weight: 7 },
    { pattern: "newsletter", weight: 7 },
    { pattern: "content", weight: 5 },
    { pattern: "community", weight: 5 }
  ],
  bridge: [
    { pattern: "investor", weight: 11 },
    { pattern: "venture", weight: 9 },
    { pattern: "vc", weight: 8 },
    { pattern: "principal", weight: 8 },
    { pattern: "partner ", weight: 7 },
    { pattern: "advisor", weight: 7 },
    { pattern: "advisory", weight: 7 },
    { pattern: "network", weight: 6 },
    { pattern: "connector", weight: 6 },
    { pattern: "board", weight: 5 },
    { pattern: "angel", weight: 6 },
    { pattern: "fund", weight: 5 }
  ]
};

const STRATEGIC_COMPANY_KEYWORDS = [
  "openai",
  "anthropic",
  "nvidia",
  "google",
  "meta",
  "microsoft",
  "amazon",
  "aws",
  "coinbase",
  "binance",
  "chainlink",
  "solana",
  "ethereum",
  "web3",
  "ai"
];

const SCENARIO_DEFINITIONS: Record<PilotScenarioId, ScenarioDefinition> = {
  direct_reply: {
    id: "direct_reply",
    goal: "Find first-degree connections most likely to respond now with the least friction.",
    simulationRequirement:
      "Simulate a partner-intro world using only the people explicitly present in the uploaded LinkedIn connection documents. The operator wants to know which first-degree connections are most likely to reply positively to a direct, warm, high-credibility outreach right now. Do not invent people, companies, or events beyond the uploaded materials. Rank who to contact first, what proof to use, and what ask would feel natural.",
    interviewPrompt:
      "You are one of the operator's first-degree LinkedIn connections. What kind of short outreach would make you reply quickly, what proof would make you trust it, and what next step would feel easiest?"
  },
  ecosystem_leverage: {
    id: "ecosystem_leverage",
    goal: "Find who can open the strongest partner, platform, or ecosystem path.",
    simulationRequirement:
      "Simulate a partner-intro world using only the people explicitly present in the uploaded LinkedIn connection documents. The operator wants to identify which first-degree connections can open the strongest ecosystem, platform, or strategic partnership path. Do not invent people, companies, or events beyond the uploaded materials. Rank the best leverage nodes, the proof assets needed, and the likely downstream partner effects.",
    interviewPrompt:
      "You are a first-degree connection evaluating whether to make a partner or platform introduction. What would you need to see to make that intro, and what would make you decline or delay?"
  },
  amplifier_route: {
    id: "amplifier_route",
    goal: "Find who can create second-order reach through events, media, and speaking.",
    simulationRequirement:
      "Simulate a partner-intro world using only the people explicitly present in the uploaded LinkedIn connection documents. The operator wants to identify which first-degree connections can create the strongest second-order reach through events, media, speaking, newsletters, or creator networks. Do not invent people, companies, or events beyond the uploaded materials. Rank the best amplifiers, the right proof assets, and the sequence of asks that would compound credibility.",
    interviewPrompt:
      "You are a first-degree connection with audience, media, or event influence. What angle, proof, and format would make you willing to amplify the operator or open a visibility path?"
  },
  bridge_then_expand: {
    id: "bridge_then_expand",
    goal: "Find which direct connection is best used as a bridge into a larger cluster.",
    simulationRequirement:
      "Simulate a partner-intro world using only the people explicitly present in the uploaded LinkedIn connection documents. The operator wants to identify which first-degree connection is the best bridge into a broader cluster of founders, investors, operators, or ecosystem partners. Do not invent people, companies, or events beyond the uploaded materials. Rank the bridge candidates, show the sequence from direct contact to cluster expansion, and identify the stop conditions before pushing further.",
    interviewPrompt:
      "You are a first-degree connection who could act as a bridge into a broader network. What would make you comfortable opening that network, and what red flags would stop you?"
  }
};

const PRIORITY_SCORES = {
  high: 3,
  medium: 2,
  low: 1
} as const;

interface PilotOptionOverrides {
  workspaceKey?: string;
  syncToken?: string;
  deploymentUrl?: string;
  label?: string;
  sharedGraphId?: string;
  selectionLimit?: number;
  maxRounds?: number;
  outputRootDir?: string;
  scenarios?: PilotScenarioId[];
  mirofishRootDir?: string;
  mirofishBaseUrl?: string;
  autoStartMiroFish?: boolean;
  parallelProfileCount?: number;
  includeInterviews?: boolean;
  includeReport?: boolean;
}

interface ResolvedPilotConfig {
  convexConfig: ConvexConfig;
  sharedGraphId: string | null;
  selectionLimit: number;
  maxRounds: number;
  outputRootDir: string;
  scenarios: ScenarioDefinition[];
  mirofishRootDir: string;
  mirofishBaseUrl: string;
  autoStartMiroFish: boolean;
  parallelProfileCount: number;
  includeInterviews: boolean;
  includeReport: boolean;
  llmApiKey: string | null;
  llmBaseUrl: string | null;
  llmModelName: string | null;
  zepApiKey: string | null;
}

interface CachedGraphMetadata {
  cacheKey: string;
  graphId: string;
  workspaceKey: string;
  createdAt: string;
  seedFingerprint: string;
  chunkSize: number;
  chunkOverlap: number;
}

interface ResolvedMiroFishLlmConfig {
  apiKey: string | null;
  baseUrl: string | null;
  modelName: string | null;
  source: string | null;
}

interface LlmJsonResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

function trimOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function isPlaceholderSecret(value: string | null): boolean {
  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized.includes("your_api_key") ||
    normalized.includes("your_zep_api_key") ||
    normalized.includes("your_key_here") ||
    normalized.includes("placeholder") ||
    normalized === "changeme"
  );
}

function isPlaceholderUrl(value: string | null): boolean {
  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized.includes("your_base_url_here");
}

function resolveMiroFishLlmConfig(
  mirofishEnv: Record<string, string>,
  missionControlEnv: Record<string, string>,
  sharedGatewayEnv: Record<string, string>
): ResolvedMiroFishLlmConfig {
  const mirofishApiKey = trimOrNull(mirofishEnv.LLM_API_KEY);
  const mirofishBaseUrl = trimOrNull(mirofishEnv.LLM_BASE_URL);
  const mirofishModelName = trimOrNull(mirofishEnv.LLM_MODEL_NAME);

  if (!isPlaceholderSecret(mirofishApiKey) && !isPlaceholderUrl(mirofishBaseUrl) && mirofishModelName) {
    return {
      apiKey: mirofishApiKey,
      baseUrl: mirofishBaseUrl,
      modelName: mirofishModelName,
      source: "mirofish-env"
    };
  }

  const gatewayApiKey = trimOrNull(sharedGatewayEnv.OPENAI_GATEWAY_API_KEY ?? sharedGatewayEnv.OPENAI_API_KEY);
  const gatewayBaseUrl = trimOrNull(sharedGatewayEnv.OPENAI_GATEWAY_URL ?? sharedGatewayEnv.OPENAI_BASE_URL);

  if (!isPlaceholderSecret(gatewayApiKey) && !isPlaceholderUrl(gatewayBaseUrl)) {
    const gatewayModel = trimOrNull(sharedGatewayEnv.OPENAI_MODEL) ?? "gpt-4o-mini";
    return {
      apiKey: gatewayApiKey,
      baseUrl: gatewayBaseUrl,
      modelName: gatewayModel,
      source: "shared-openai-gateway"
    };
  }

  const openAiApiKey = trimOrNull(missionControlEnv.OPENAI_API_KEY);
  if (!isPlaceholderSecret(openAiApiKey)) {
    return {
      apiKey: openAiApiKey,
      baseUrl: trimOrNull(missionControlEnv.OPENAI_BASE_URL) ?? "https://api.openai.com/v1",
      modelName: "gpt-4o-mini",
      source: "mission-control-openai"
    };
  }

  const openRouterApiKey = trimOrNull(missionControlEnv.OPENROUTER_API_KEY);
  if (!isPlaceholderSecret(openRouterApiKey)) {
    return {
      apiKey: openRouterApiKey,
      baseUrl: "https://openrouter.ai/api/v1",
      modelName: "openai/gpt-4o-mini",
      source: "mission-control-openrouter"
    };
  }

  return {
    apiKey: null,
    baseUrl: null,
    modelName: null,
    source: null
  };
}

function isLocalOllamaBaseUrl(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return value.includes("127.0.0.1:11434") || value.includes("localhost:11434");
}

function parseEnvContents(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed
      .slice(equalsIndex + 1)
      .split(/\s+#/u)[0]
      .trim()
      .replace(/^['"]|['"]$/gu, "");
    result[key] = value;
  }
  return result;
}

async function loadEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const contents = await readFile(filePath, "utf8");
    return parseEnvContents(contents);
  } catch {
    return {};
  }
}

function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeText(value: string): string {
  return ` ${value.toLowerCase()} `;
}

function summarizeUserProfile(userProfile: UserProfile | null, activitySnapshot: OwnActivitySnapshot | null): string {
  const name = [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(" ").trim() || "Unknown operator";
  const publicIdentifier = userProfile?.publicIdentifier ?? activitySnapshot?.publicIdentifier ?? "unknown";
  const profileUrl = userProfile?.profileUrl ?? activitySnapshot?.profileUrl ?? null;
  const headline = activitySnapshot?.profileHeadline ?? "Headline unavailable";
  const followerCount = activitySnapshot?.followerCount ?? "unknown";
  const connectionCount = activitySnapshot?.connectionCount ?? "unknown";

  return [
    `Operator: ${name}`,
    `Public Identifier: ${publicIdentifier}`,
    `Profile URL: ${profileUrl ?? "unknown"}`,
    `Headline: ${headline}`,
    `Reported Followers: ${followerCount}`,
    `Reported Connections: ${connectionCount}`
  ].join("\n");
}

function buildPersonKey(record: Partial<WorkspaceConnectionRecord>): string {
  return (
    trimOrNull(record.publicIdentifier) ??
    trimOrNull(record.entityUrn) ??
    trimOrNull(record.profileUrl) ??
    slugify(`${trimOrNull(record.fullName) ?? "unknown"}-${trimOrNull(record.companyName) ?? "na"}`)
  );
}

const ROLE_COMPANY_HEADLINE_MARKERS = [
  "founder",
  "co-founder",
  "ceo",
  "cto",
  "cmo",
  "coo",
  "cpo",
  "chief",
  "head",
  "director",
  "partner",
  "chair",
  "advisor",
  "lead",
  "manager",
  "recruiter",
  "speaker",
  "host",
  "officer"
];

function cleanInferredCompanyName(value: string | null): string | null {
  const trimmed = trimOrNull(value);
  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed
    .replace(/^[\s\-–—:|•@]+/u, "")
    .replace(/[\s\-–—:|•,;()]+$/u, "")
    .replace(/\s+/gu, " ");

  if (!cleaned || cleaned.length > 80) {
    return null;
  }

  const normalized = cleaned.toLowerCase();
  if (
    normalized.includes("building") ||
    normalized.includes("speaker") ||
    normalized.includes("investor") ||
    normalized.includes("advisor") ||
    normalized.includes("founder") ||
    normalized.includes("operator")
  ) {
    return null;
  }

  return cleaned;
}

function inferCompanyNameFromHeadline(headline: string | null): string | null {
  const normalizedHeadline = trimOrNull(headline);
  if (!normalizedHeadline) {
    return null;
  }

  const segments = normalizedHeadline
    .split("|")
    .map((segment) => trimOrNull(segment))
    .filter((segment): segment is string => Boolean(segment));

  for (const segment of segments) {
    const atMatch = segment.match(
      /(?:\bat\b|@)\s+([A-Z0-9][A-Za-z0-9&/.+' -]{1,60}?)(?=$|[|•(),;.]|\s{2,})/u
    );
    const atCompany = cleanInferredCompanyName(atMatch?.[1] ?? null);
    if (atCompany) {
      return atCompany;
    }

    const dashMatch = segment.match(/^(.+?)\s+-\s+(.+)$/u);
    if (dashMatch) {
      const left = dashMatch[1].toLowerCase();
      const right = cleanInferredCompanyName(dashMatch[2]);
      const looksLikeRole = ROLE_COMPANY_HEADLINE_MARKERS.some((marker) => left.includes(marker));
      if (looksLikeRole && right) {
        return right;
      }
    }
  }

  return null;
}

function enrichCompanyName(record: Record<string, unknown>): string | null {
  const directCompany = trimOrNull(record.companyName);
  if (directCompany) {
    return directCompany;
  }

  const raw = asRecord(record.raw);
  const profile = asRecord(raw?.profile);
  const profileCompany =
    trimOrNull(profile?.companyName) ??
    trimOrNull(profile?.currentCompanyName) ??
    trimOrNull(profile?.organizationName);
  if (profileCompany) {
    return profileCompany;
  }

  return inferCompanyNameFromHeadline(trimOrNull(record.headline));
}

function normalizeConnectionRecord(record: Record<string, unknown>): WorkspaceConnectionRecord | null {
  const fullName = trimOrNull(record.fullName);
  const companyName = enrichCompanyName(record);
  const personKey = buildPersonKey({
    publicIdentifier: trimOrNull(record.publicIdentifier),
    entityUrn: trimOrNull(record.entityUrn),
    profileUrl: trimOrNull(record.profileUrl),
    fullName,
    companyName
  });

  if (!fullName) {
    return null;
  }

  return {
    personKey,
    fullName,
    publicIdentifier: trimOrNull(record.publicIdentifier),
    profileUrl: trimOrNull(record.profileUrl),
    entityUrn: trimOrNull(record.entityUrn),
    headline: trimOrNull(record.headline),
    companyName,
    connectedAt: trimOrNull(record.connectedAt),
    raw: record.raw ?? null
  };
}

function keywordScoreForBucket(text: string, bucket: PilotBucket): { score: number; matches: string[] } {
  const matches: string[] = [];
  let score = 0;

  for (const entry of BUCKET_KEYWORDS[bucket]) {
    if (text.includes(entry.pattern)) {
      matches.push(entry.pattern.trim());
      score += entry.weight;
    }
  }

  return { score, matches };
}

function recencyScore(connectedAt: string | null): number {
  if (!connectedAt) {
    return 0;
  }

  const parsed = Date.parse(connectedAt);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const ageDays = (Date.now() - parsed) / 86_400_000;
  if (ageDays <= 30) {
    return 8;
  }
  if (ageDays <= 90) {
    return 6;
  }
  if (ageDays <= 180) {
    return 4;
  }
  if (ageDays <= 365) {
    return 3;
  }
  if (ageDays <= 730) {
    return 2;
  }
  return 1;
}

function strategicCompanyBoost(text: string): number {
  return STRATEGIC_COMPANY_KEYWORDS.reduce((score, keyword) => {
    return text.includes(keyword) ? score + 2 : score;
  }, 0);
}

function bucketPriorityScore(bucket: PilotBucket): number {
  switch (bucket) {
    case "ecosystem":
      return 6;
    case "founder_operator":
      return 5;
    case "amplifier":
      return 4;
    case "bridge":
      return 4;
    default:
      return 0;
  }
}

function formatBucketLabel(bucket: PilotBucket): string {
  return bucket === "founder_operator" ? "founder/operator" : bucket;
}

function formatConnectionDate(connectedAt: string | null): string | null {
  if (!connectedAt) {
    return null;
  }

  const parsed = new Date(connectedAt);
  if (Number.isNaN(parsed.valueOf())) {
    return connectedAt;
  }

  return parsed.toISOString().slice(0, 10);
}

function tokenizeReasoningText(value: string | null): string[] {
  const normalized = trimOrNull(value)?.toLowerCase() ?? "";
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function supportingProofForConnection(
  record: WorkspaceConnectionRecord,
  bucket: PilotBucket,
  proofItems: ProofAsset[]
): { selected: string[]; score: number } {
  if (proofItems.length === 0) {
    return { selected: [], score: 0 };
  }

  const sourceTerms = new Set([
    ...tokenizeReasoningText(record.fullName),
    ...tokenizeReasoningText(record.headline),
    ...tokenizeReasoningText(record.companyName),
    ...tokenizeReasoningText(formatBucketLabel(bucket))
  ]);

  const bucketTerms: Record<PilotBucket, string[]> = {
    ecosystem: ["partnership", "ecosystem", "platform", "integration", "community"],
    founder_operator: ["founder", "operator", "builder", "product", "ai", "blockchain", "web3"],
    amplifier: ["audience", "speaker", "podcast", "event", "creator", "content"],
    bridge: ["investor", "venture", "advisor", "network", "fund", "intro"]
  };

  for (const term of bucketTerms[bucket]) {
    sourceTerms.add(term);
  }

  const ranked = proofItems
    .map((item) => {
      const text = `${item.label} ${item.summary}`.toLowerCase();
      let score = item.sourceType === "activity_snapshot" ? 5 : item.sourceType === "post" ? 4 : 3;

      for (const term of sourceTerms) {
        if (term.length >= 3 && text.includes(term)) {
          score += 3;
        }
      }

      if (item.sourceType === "activity_snapshot" && /follower|impression|profile|viewer|reach/u.test(text)) {
        score += 3;
      }

      if (item.sourceType === "post" && /ai|blockchain|agent|web3|ecosystem|partner/u.test(text)) {
        score += 2;
      }

      return {
        label: `${item.label}: ${item.summary}`,
        score
      };
    })
    .sort((left, right) => right.score - left.score);

  const selected = ranked
    .slice(0, 2)
    .filter((item) => item.score >= 5)
    .map((item) => item.label);

  const proofFit = Math.min(
    15,
    selected.length * 4 + ranked.slice(0, 2).reduce((sum, item) => sum + Math.min(item.score, 4), 0)
  );

  return {
    selected,
    score: proofFit
  };
}

function companyFitScore(record: WorkspaceConnectionRecord, sourceText: string): number {
  const directCompany = trimOrNull(record.companyName);
  let score = directCompany ? 6 : 0;
  score += strategicCompanyBoost(sourceText) * 2;
  if (directCompany && sourceText.includes(directCompany.toLowerCase())) {
    score += 2;
  }
  return Math.min(score, 20);
}

function warmthFitScore(record: WorkspaceConnectionRecord, recency: number): number {
  let score = 6;
  if (record.publicIdentifier) {
    score += 2;
  }
  if (record.profileUrl) {
    score += 2;
  }
  score += Math.min(recency, 5);
  return Math.min(score, 15);
}

function timingFitScore(connectedAt: string | null): number {
  if (!connectedAt) {
    return 1;
  }

  const parsed = Date.parse(connectedAt);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  const ageDays = (Date.now() - parsed) / 86_400_000;
  if (ageDays <= 30) {
    return 10;
  }
  if (ageDays <= 90) {
    return 8;
  }
  if (ageDays <= 180) {
    return 6;
  }
  if (ageDays <= 365) {
    return 4;
  }
  if (ageDays <= 730) {
    return 2;
  }
  return 1;
}

function pathValueScore(bucket: PilotBucket, matchedKeywords: string[]): number {
  const baseByBucket: Record<PilotBucket, number> = {
    ecosystem: 15,
    founder_operator: 14,
    amplifier: 12,
    bridge: 13
  };
  return Math.min(baseByBucket[bucket] + Math.min(matchedKeywords.length, 2), 15);
}

function riskPenaltyScore(record: WorkspaceConnectionRecord, matchedKeywords: string[]): number {
  let penalty = 0;

  if (!trimOrNull(record.companyName)) {
    penalty += 4;
  }
  if (!trimOrNull(record.headline)) {
    penalty += 4;
  }
  if (matchedKeywords.length < 2) {
    penalty += 4;
  }

  const parsed = record.connectedAt ? Date.parse(record.connectedAt) : Number.NaN;
  if (Number.isFinite(parsed)) {
    const ageDays = (Date.now() - parsed) / 86_400_000;
    if (ageDays > 730) {
      penalty += 4;
    } else if (ageDays > 365) {
      penalty += 2;
    }
  } else {
    penalty += 2;
  }

  return Math.min(penalty, 12);
}

function rankingConfidence(
  record: WorkspaceConnectionRecord,
  matchedKeywords: string[],
  proofCount: number,
  totalScore: number
): "high" | "medium" | "low" {
  let completeness = 0;
  if (trimOrNull(record.companyName)) {
    completeness += 1;
  }
  if (trimOrNull(record.headline)) {
    completeness += 1;
  }
  if (record.connectedAt) {
    completeness += 1;
  }
  if (matchedKeywords.length >= 2) {
    completeness += 1;
  }
  if (proofCount > 0) {
    completeness += 1;
  }

  if (completeness >= 4 && totalScore >= 55) {
    return "high";
  }
  if (completeness >= 3 && totalScore >= 38) {
    return "medium";
  }
  return "low";
}

function suggestedAskForBucket(bucket: PilotBucket): string {
  switch (bucket) {
    case "ecosystem":
      return "Request a short partner-path conversation focused on one specific ecosystem or platform introduction.";
    case "founder_operator":
      return "Request a 15-minute operator conversation and one tightly scoped founder, customer, or partner introduction.";
    case "amplifier":
      return "Ask for a concrete speaking, podcast, newsletter, or event angle tied to one proof asset.";
    case "bridge":
      return "Ask for one high-context bridge introduction into a relevant cluster instead of a broad referral.";
    default:
      return "Request a short exploratory call or one relevant introduction.";
  }
}

function buildWhyThisPerson(
  bucket: PilotBucket,
  matchedKeywords: string[],
  companyName: string | null,
  scoreBreakdown: { roleFit: number; companyFit: number; pathValue: number }
): string {
  const reasons: string[] = [];
  if (scoreBreakdown.roleFit >= 16) {
    reasons.push(
      `Strong ${formatBucketLabel(bucket)} role fit${matchedKeywords.length ? ` from ${matchedKeywords.slice(0, 3).join(", ")} signals` : ""}`
    );
  }
  if (scoreBreakdown.companyFit >= 10 && companyName) {
    reasons.push(`Strategic company relevance via ${companyName}`);
  }
  if (scoreBreakdown.pathValue >= 13) {
    reasons.push(`High likely path value for a ${formatBucketLabel(bucket)} outreach motion`);
  }

  return reasons.length > 0 ? `${reasons.join(". ")}.` : `Useful ${formatBucketLabel(bucket)} fit inside the current first-degree graph.`;
}

function buildWhyNow(
  connectedAt: string | null,
  supportingProof: string[],
  confidence: "high" | "medium" | "low"
): string {
  const parts: string[] = [];
  const formattedDate = formatConnectionDate(connectedAt);
  if (formattedDate) {
    const parsed = Date.parse(connectedAt ?? "");
    const ageDays = Number.isFinite(parsed) ? (Date.now() - parsed) / 86_400_000 : Number.POSITIVE_INFINITY;
    if (ageDays <= 90) {
      parts.push(`Recent first-degree connection from ${formattedDate}`);
    } else {
      parts.push(`Warm first-degree path already exists${formattedDate ? ` from ${formattedDate}` : ""}`);
    }
  } else {
    parts.push("Warm first-degree path already exists");
  }

  if (supportingProof.length > 0) {
    parts.push("matching proof assets are already available");
  }

  if (confidence === "high") {
    parts.push("the profile fit is well supported by current data");
  }

  return `${parts.join(", ")}.`;
}

function buildRiskSummary(
  record: WorkspaceConnectionRecord,
  matchedKeywords: string[],
  supportingProof: string[]
): string {
  const issues: string[] = [];

  if (!trimOrNull(record.companyName)) {
    issues.push("company context is inferred rather than explicit");
  }
  if (matchedKeywords.length < 2) {
    issues.push("fit is based on relatively weak title and keyword signals");
  }
  if (supportingProof.length === 0) {
    issues.push("proof-to-person match is thin");
  }

  return issues.length > 0
    ? `${issues.join("; ")}, so the ask should stay narrow.`
    : "Primary risk is over-scoping the ask; keep it tight and specific.";
}

export function scoreConnection(record: WorkspaceConnectionRecord, proofItems: ProofAsset[] = []): SelectedConnection {
  const sourceText = normalizeText(
    [
      record.fullName ?? "",
      record.headline ?? "",
      record.companyName ?? ""
    ].join(" ")
  );

  const bucketResults = BUCKET_ORDER.map((bucket) => {
    const { score, matches } = keywordScoreForBucket(sourceText, bucket);
    return { bucket, score, matches };
  });

  bucketResults.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return bucketPriorityScore(right.bucket) - bucketPriorityScore(left.bucket);
  });

  const bestBucket = bucketResults[0] ?? { bucket: "bridge" as PilotBucket, score: 0, matches: [] as string[] };
  const keywordScore = bestBucket.score + strategicCompanyBoost(sourceText);
  const recency = recencyScore(record.connectedAt);
  const { selected: supportingProof, score: proofFit } = supportingProofForConnection(
    record,
    bestBucket.bucket,
    proofItems
  );
  const roleFit = Math.min(25, bestBucket.score + bucketPriorityScore(bestBucket.bucket) + Math.min(bestBucket.matches.length, 3));
  const companyFit = companyFitScore(record, sourceText);
  const warmthFit = warmthFitScore(record, recency);
  const pathValue = pathValueScore(bestBucket.bucket, bestBucket.matches);
  const timingFit = timingFitScore(record.connectedAt);
  const riskPenalty = -riskPenaltyScore(record, bestBucket.matches);
  const totalScore = roleFit + companyFit + warmthFit + proofFit + pathValue + timingFit + riskPenalty;
  const confidence = rankingConfidence(record, bestBucket.matches, supportingProof.length, totalScore);
  const whyThisPerson = buildWhyThisPerson(
    bestBucket.bucket,
    bestBucket.matches,
    record.companyName,
    { roleFit, companyFit, pathValue }
  );
  const whyNow = buildWhyNow(record.connectedAt, supportingProof, confidence);
  const suggestedAsk = suggestedAskForBucket(bestBucket.bucket);
  const riskSummary = buildRiskSummary(record, bestBucket.matches, supportingProof);

  return {
    ...record,
    bucket: bestBucket.bucket,
    score: totalScore,
    keywordScore,
    recencyScore: recency,
    matchedKeywords: bestBucket.matches,
    confidence,
    scoreBreakdown: {
      roleFit,
      companyFit,
      warmthFit,
      proofFit,
      pathValue,
      timingFit,
      riskPenalty,
      total: totalScore
    },
    whyItMayMatter: whyThisPerson,
    whyThisPerson,
    whyNow,
    suggestedAsk,
    supportingProof,
    riskSummary
  };
}

function fillRemainingBuckets(
  selected: SelectedConnection[],
  scored: SelectedConnection[],
  limit: number
): SelectedConnection[] {
  const chosen = new Map(selected.map((entry) => [entry.personKey, entry]));
  for (const entry of scored) {
    if (chosen.has(entry.personKey)) {
      continue;
    }
    chosen.set(entry.personKey, entry);
    if (chosen.size >= limit) {
      break;
    }
  }
  return Array.from(chosen.values());
}

export function selectFocusedConnections(
  connections: WorkspaceConnectionRecord[],
  limit = DEFAULT_SELECTION_LIMIT,
  proofItems: ProofAsset[] = []
): SelectedConnection[] {
  const scored = connections
    .filter((record) => Boolean(record.fullName))
    .map((record) => scoreConnection(record, proofItems))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const leftTime = left.connectedAt ? Date.parse(left.connectedAt) : 0;
      const rightTime = right.connectedAt ? Date.parse(right.connectedAt) : 0;
      return rightTime - leftTime;
    });

  const perBucketTarget = Math.max(1, Math.floor(limit / BUCKET_ORDER.length));
  const selected: SelectedConnection[] = [];

  for (const bucket of BUCKET_ORDER) {
    const bucketEntries = scored.filter((entry) => entry.bucket === bucket).slice(0, perBucketTarget);
    selected.push(...bucketEntries);
  }

  const uniqueSelected = Array.from(new Map(selected.map((entry) => [entry.personKey, entry])).values());
  const completed = fillRemainingBuckets(uniqueSelected, scored, limit)
    .slice(0, limit)
    .sort((left, right) => right.score - left.score);

  return completed;
}

function pickTopCompanies(selectedConnections: SelectedConnection[]): Array<{ company: string; count: number }> {
  const counts = new Map<string, number>();

  for (const connection of selectedConnections) {
    const company = trimOrNull(connection.companyName);
    if (!company) {
      continue;
    }
    counts.set(company, (counts.get(company) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([company, count]) => ({ company, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);
}

function collectProofAssets(snapshot: PilotWorkspaceSnapshot): ProofAsset[] {
  const proofItems: ProofAsset[] = [];
  const profileUrl = snapshot.userProfile?.profileUrl ?? snapshot.activitySnapshot?.profileUrl ?? null;

  if (snapshot.activitySnapshot?.followerCount) {
    proofItems.push({
      label: "LinkedIn follower count",
      summary: snapshot.activitySnapshot.followerCount,
      sourceType: "activity_snapshot",
      sourceUrl: profileUrl
    });
  }

  if (snapshot.activitySnapshot?.connectionCount) {
    proofItems.push({
      label: "LinkedIn connection count",
      summary: snapshot.activitySnapshot.connectionCount,
      sourceType: "activity_snapshot",
      sourceUrl: profileUrl
    });
  }

  for (const metric of snapshot.activitySnapshot?.dashboardMetrics ?? []) {
    if (!trimOrNull(metric.label) || !trimOrNull(metric.value)) {
      continue;
    }
    proofItems.push({
      label: metric.label,
      summary: metric.value,
      sourceType: "activity_snapshot",
      sourceUrl: profileUrl
    });
  }

  for (const post of snapshot.posts.slice(0, 8)) {
    const record = post as Record<string, unknown>;
    const label = trimOrNull(record.postText) ?? trimOrNull(record.publishedLabel) ?? "LinkedIn post";
    const metrics = Array.isArray(record.latestAnalytics)
      ? record.latestAnalytics
          .map((item) => {
            const metric = item as Record<string, unknown>;
            const metricLabel = trimOrNull(metric.label);
            const metricValue = trimOrNull(metric.value);
            return metricLabel && metricValue ? `${metricLabel}: ${metricValue}` : null;
          })
          .filter((item): item is string => item !== null)
      : [];
    if (!label) {
      continue;
    }
    proofItems.push({
      label: "Recent post",
      summary: metrics.length ? `${label} | ${metrics.join(" | ")}` : label,
      sourceType: "post",
      sourceUrl: trimOrNull(record.permalink) ?? trimOrNull(record.analyticsUrl)
    });
  }

  if (snapshot.userProfile?.publicIdentifier) {
    proofItems.push({
      label: "LinkedIn profile",
      summary: snapshot.userProfile.publicIdentifier,
      sourceType: "profile",
      sourceUrl: snapshot.userProfile.profileUrl
    });
  }

  return proofItems.slice(0, 20);
}

export function buildSeedPack(snapshot: PilotWorkspaceSnapshot, selectedConnections: SelectedConnection[]): SeedPack {
  const proofItems = collectProofAssets(snapshot);
  const bucketGroups = BUCKET_ORDER.map((bucket) => ({
    bucket,
    entries: selectedConnections.filter((connection) => connection.bucket === bucket)
  }));
  const topCompanies = pickTopCompanies(selectedConnections);

  const operatorContextContent = [
    "# Operator Context",
    "",
    "This seed pack is for partner-intro planning over a LinkedIn first-degree network.",
    "",
    "## Operator",
    "",
    "```text",
    summarizeUserProfile(snapshot.userProfile, snapshot.activitySnapshot),
    "```",
    "",
    "## Goal",
    "",
    "- Use first-degree LinkedIn connections as the candidate set for GTM brainstorming.",
    "- Rank who to contact first for partner intros, leverage, amplification, and bridge expansion.",
    "- Prefer warm, credible asks backed by visible proof assets from the operator's LinkedIn footprint.",
    "- Do not invent people or entities outside the uploaded documents."
  ].join("\n");

  const networkFocusLines = [
    "# Focused First-Degree Network",
    "",
    `Selected ${selectedConnections.length} connections from the latest successful Convex snapshot.`,
    "",
    "Each line is intentionally compact to keep the graph seed dense and useful.",
    ""
  ];
  for (const [index, connection] of selectedConnections.entries()) {
    networkFocusLines.push(
      `- ${index + 1}. personKey=${connection.personKey} | name=${connection.fullName} | bucket=${connection.bucket} | score=${connection.score} | confidence=${connection.confidence} | company=${connection.companyName ?? "Unknown"} | headline=${connection.headline ?? "Unknown"} | connectedAt=${connection.connectedAt ?? "Unknown"} | whyThisPerson=${connection.whyThisPerson} | whyNow=${connection.whyNow} | suggestedAsk=${connection.suggestedAsk} | supportingProof=${connection.supportingProof.join(" || ") || "None"} | risk=${connection.riskSummary}`
    );
  }

  const clusterSummaryLines = [
    "# Cluster Summary",
    "",
    "## Buckets",
    ""
  ];
  for (const group of bucketGroups) {
    clusterSummaryLines.push(
      `### ${group.bucket}`,
      "",
      `- Count: ${group.entries.length}`,
      `- Example People: ${group.entries.slice(0, 6).map((entry) => entry.fullName).join(", ") || "None"}`,
      ""
    );
  }
  clusterSummaryLines.push("## Top Companies", "");
  for (const company of topCompanies) {
    clusterSummaryLines.push(`- ${company.company}: ${company.count}`);
  }

  const proofLines = [
    "# Proof Assets",
    "",
    "Visible proof signals extracted from LinkedIn data already stored in Convex.",
    ""
  ];
  for (const item of proofItems) {
    proofLines.push(
      `- ${item.label}: ${item.summary}${item.sourceUrl ? ` (${item.sourceUrl})` : ""}`
    );
  }

  return {
    operatorContext: {
      filename: "operator_context.md",
      content: operatorContextContent
    },
    networkFocus: {
      filename: "network_focus.md",
      content: networkFocusLines.join("\n")
    },
    clusterSummary: {
      filename: "cluster_summary.md",
      content: clusterSummaryLines.join("\n")
    },
    proofAssets: {
      filename: "proof_assets.md",
      content: proofLines.join("\n")
    },
    selectedConnections,
    proofItems
  };
}

function coreSeedDocuments(seedPack: SeedPack) {
  return [
    seedPack.operatorContext,
    seedPack.networkFocus,
    seedPack.clusterSummary,
    seedPack.proofAssets
  ];
}

function buildGraphSeedFingerprint(seedPack: SeedPack): string {
  return hashString(
    JSON.stringify({
      operatorContext: seedPack.operatorContext.content,
      networkFocus: seedPack.networkFocus.content,
      clusterSummary: seedPack.clusterSummary.content,
      proofAssets: seedPack.proofAssets.content,
      ontology: GTM_PARTNER_WORLD_ONTOLOGY,
      graphChunkSize: DEFAULT_GRAPH_CHUNK_SIZE,
      graphChunkOverlap: DEFAULT_GRAPH_CHUNK_OVERLAP
    })
  );
}

function graphCacheFilePath(cacheDir: string, cacheKey: string): string {
  return path.join(cacheDir, "graphs", `${cacheKey}.json`);
}

async function readCachedGraphMetadata(cacheDir: string, cacheKey: string): Promise<CachedGraphMetadata | null> {
  try {
    const filePath = graphCacheFilePath(cacheDir, cacheKey);
    const contents = await readFile(filePath, "utf8");
    return JSON.parse(contents) as CachedGraphMetadata;
  } catch {
    return null;
  }
}

async function writeCachedGraphMetadata(
  cacheDir: string,
  metadata: CachedGraphMetadata
): Promise<void> {
  const filePath = graphCacheFilePath(cacheDir, metadata.cacheKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(metadata, null, 2), "utf8");
}

function scenarioContextDocument(seedPack: SeedPack, scenario: ScenarioDefinition) {
  return {
    filename: `${scenario.id}_context.md`,
    content: [
      "# Scenario Context",
      "",
      `Scenario ID: ${scenario.id}`,
      `Goal: ${scenario.goal}`,
      "",
      "## Guidance",
      "",
      "- Use the uploaded materials as the full source of truth.",
      "- Treat the first-degree LinkedIn focus list as the allowed candidate universe.",
      "- Treat the deterministic Tigerclaw ranking as the base prior, then adjust only when scenario reasoning clearly changes priority.",
      "- The operator wants a realistic partner-intro strategy, not a generic social-opinion simulation.",
      "- Output should converge on who to reach out to, why, and with what proof.",
      `- Simulation requirement: ${scenario.simulationRequirement}`,
      "",
      "## Deterministic Ranking Priors",
      "",
      ...seedPack.selectedConnections
        .slice(0, 8)
        .map(
          (connection, index) =>
            `- ${index + 1}. ${connection.fullName} | bucket=${connection.bucket} | score=${connection.score} | confidence=${connection.confidence} | why=${connection.whyThisPerson} | now=${connection.whyNow} | ask=${connection.suggestedAsk} | proof=${connection.supportingProof.join(" || ") || "None"} | risk=${connection.riskSummary}`
        ),
      "",
      "## Top Proof Items",
      "",
      ...seedPack.proofItems
        .slice(0, 8)
        .map((item) => `- ${item.label}: ${item.summary}${item.sourceUrl ? ` (${item.sourceUrl})` : ""}`)
    ].join("\n")
  };
}

function renderScenarioSummaryMarkdown(bundle: ScenarioBundle): string {
  const lines = [
    `# ${bundle.scenarioId}`,
    "",
    bundle.scenarioGoal,
    "",
    "## Top Candidates",
    ""
  ];
  for (const candidate of bundle.topCandidates) {
    lines.push(
      `- ${candidate.fullName} (${candidate.company ?? "Unknown"}) | score=${candidate.baseScore ?? "n/a"} | confidence=${candidate.confidence}`,
      `  Why this person: ${candidate.whyThisPerson}`,
      `  Ask: ${candidate.suggestedAsk}`,
      `  Why now: ${candidate.whyNow}`,
      `  Risk: ${candidate.risk}`
    );
  }
  lines.push("", "## Sequence", "");
  for (const step of bundle.sequence) {
    lines.push(`- ${step.title}: ${step.action}${step.gatingCondition ? ` | Gate: ${step.gatingCondition}` : ""}`);
  }
  if (bundle.stopConditions.length) {
    lines.push("", "## Stop Conditions", "");
    for (const condition of bundle.stopConditions) {
      lines.push(`- ${condition}`);
    }
  }
  return lines.join("\n");
}

function renderConsolidatedMarkdown(output: ConsolidatedPilotOutput): string {
  const lines = [
    "# Consolidated Ranked Action Queue",
    "",
    `Recommended default scenario: ${output.recommendedScenarioId}`,
    "",
    "## Ranked Actions",
    ""
  ];

  for (const [index, action] of output.rankedActions.entries()) {
    lines.push(
      `## ${index + 1}. ${action.fullName}`,
      "",
      `- Person Key: ${action.personKey}`,
      `- Company: ${action.company ?? "Unknown"}`,
      `- Headline: ${action.headline ?? "Unknown"}`,
      `- Base Score: ${action.baseScore ?? "Unknown"}`,
      `- Confidence: ${action.confidence}`,
      `- Scenario Count: ${action.scenarioCount}`,
      `- Scenarios: ${action.scenarios.join(", ")}`,
      `- Priority Score: ${action.priorityScore}`,
      `- Why This Person: ${action.whyThisPerson}`,
      `- Suggested Ask: ${action.suggestedAsk}`,
      `- Why Now: ${action.whyNow}`,
      `- Risk: ${action.risk}`,
      `- Supporting Proof: ${action.supportingProof.join(" | ") || "None"}`,
      ""
    );
  }

  return lines.join("\n");
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => trimOrNull(entry))
    .filter((entry): entry is string => entry !== null);
}

function normalizePriority(value: unknown): "high" | "medium" | "low" {
  const normalized = trimOrNull(value)?.toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  if (normalized === "critical") {
    return "high";
  }
  if (normalized === "moderate") {
    return "medium";
  }
  return "low";
}

function parseJsonObjectFromText(text: string): Record<string, unknown> {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/u);
  const source = fencedMatch?.[1] ?? text;
  return JSON.parse(source) as Record<string, unknown>;
}

function extractLlmContent(response: LlmJsonResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => (entry.type === "text" ? entry.text ?? "" : ""))
      .join("")
      .trim();
  }
  throw new Error("LLM response did not include usable content.");
}

async function callOpenAiCompatibleJson(
  apiKey: string,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<Record<string, unknown>> {
  const endpoint = `${baseUrl.replace(/\/+$/u, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as LlmJsonResponse;
  return parseJsonObjectFromText(extractLlmContent(payload));
}

function buildFallbackScenarioBundle(
  scenario: ScenarioDefinition,
  selectedConnections: SelectedConnection[]
): ScenarioBundle {
  const preferredBuckets: Record<PilotScenarioId, PilotBucket[]> = {
    direct_reply: ["ecosystem", "founder_operator", "bridge", "amplifier"],
    ecosystem_leverage: ["ecosystem", "bridge", "founder_operator", "amplifier"],
    amplifier_route: ["amplifier", "ecosystem", "bridge", "founder_operator"],
    bridge_then_expand: ["bridge", "ecosystem", "founder_operator", "amplifier"]
  };

  const ranked = [...selectedConnections].sort((left, right) => {
    const leftBucketRank = preferredBuckets[scenario.id].indexOf(left.bucket);
    const rightBucketRank = preferredBuckets[scenario.id].indexOf(right.bucket);
    if (leftBucketRank !== rightBucketRank) {
      return leftBucketRank - rightBucketRank;
    }
    return right.score - left.score;
  });

  const topCandidates: ScenarioTopCandidate[] = ranked.slice(0, 10).map((connection, index) => ({
    personKey: connection.personKey,
    fullName: connection.fullName ?? "Unknown",
    company: connection.companyName,
    headline: connection.headline,
    baseScore: connection.score,
    confidence: connection.confidence,
    whyThisPerson: connection.whyThisPerson,
    whyNow: connection.whyNow,
    suggestedAsk:
      scenario.id === "amplifier_route"
        ? "Ask for a visibility, stage, or newsletter angle with one concrete proof point."
        : connection.suggestedAsk,
    supportingProof: connection.supportingProof.length > 0 ? connection.supportingProof.slice(0, 2) : ["LinkedIn first-degree relationship"],
    risk: index < 3 ? connection.riskSummary : `${connection.riskSummary} Keep the ask especially concise after the first few targets.`,
    priority: index < 3 ? "high" : index < 6 ? "medium" : "low"
  }));

  return {
    scenarioId: scenario.id,
    scenarioGoal: scenario.goal,
    topCandidates,
    sequence: [
      {
        title: "Warm open",
        action: "Start with a short note that references a clear point of overlap.",
        gatingCondition: null
      },
      {
        title: "Proof drop",
        action: "Attach one proof asset that matches the connection's bucket and likely incentives.",
        gatingCondition: "Only after the first note gets a positive signal."
      },
      {
        title: "Specific ask",
        action: "Request a short call or one targeted introduction, not a vague collaboration.",
        gatingCondition: "Only if the connection responds with curiosity or availability."
      }
    ],
    stopConditions: [
      "No reply after two concise touches.",
      "The connection asks for proof that is not available.",
      "The intro path depends on weak assumptions about the network."
    ],
    followOnTargets: topCandidates.slice(0, 5).map((candidate) => ({
      personKey: candidate.personKey,
      reason: "High deterministic fit from bucket scoring."
    }))
  };
}

function sanitizeScenarioBundle(
  scenario: ScenarioDefinition,
  selectedConnections: SelectedConnection[],
  raw: Record<string, unknown>
): ScenarioBundle {
  const lookup = new Map(selectedConnections.map((connection) => [connection.personKey, connection]));
  const topCandidatesRaw = Array.isArray(raw.topCandidates) ? raw.topCandidates : [];
  const topCandidates: ScenarioTopCandidate[] = [];

  for (const item of topCandidatesRaw) {
    const record = item as Record<string, unknown>;
    const personKey = trimOrNull(record.personKey);
    if (!personKey || !lookup.has(personKey)) {
      continue;
    }
    const source = lookup.get(personKey)!;
    topCandidates.push({
      personKey,
      fullName: source.fullName ?? "Unknown",
      company: source.companyName,
      headline: source.headline,
      baseScore:
        typeof record.baseScore === "number" && Number.isFinite(record.baseScore) ? record.baseScore : source.score,
      confidence: normalizePriority(record.confidence ?? source.confidence),
      whyThisPerson: trimOrNull(record.whyThisPerson) ?? source.whyThisPerson,
      whyNow: trimOrNull(record.whyNow) ?? source.whyNow,
      suggestedAsk: trimOrNull(record.suggestedAsk) ?? source.suggestedAsk,
      supportingProof: normalizeArray(record.supportingProof).slice(0, 5).length > 0 ? normalizeArray(record.supportingProof).slice(0, 5) : source.supportingProof.slice(0, 5),
      risk: trimOrNull(record.risk) ?? source.riskSummary,
      priority: normalizePriority(record.priority)
    });
  }

  const sequence = Array.isArray(raw.sequence)
    ? raw.sequence
        .map((item) => {
          const record = item as Record<string, unknown>;
          const title = trimOrNull(record.title);
          const action = trimOrNull(record.action);
          if (!title || !action) {
            return null;
          }
          return {
            title,
            action,
            gatingCondition: trimOrNull(record.gatingCondition)
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : [];

  const followOnTargets = Array.isArray(raw.followOnTargets)
    ? raw.followOnTargets
        .map((item) => {
          const record = item as Record<string, unknown>;
          const personKey = trimOrNull(record.personKey);
          if (!personKey || !lookup.has(personKey)) {
            return null;
          }
          return {
            personKey,
            reason: trimOrNull(record.reason) ?? "Mentioned in the scenario output."
          } satisfies FollowOnTarget;
        })
        .filter((item): item is FollowOnTarget => item !== null)
    : [];

  const bundle: ScenarioBundle = {
    scenarioId: scenario.id,
    scenarioGoal: trimOrNull(raw.scenarioGoal) ?? scenario.goal,
    topCandidates: topCandidates.slice(0, 12),
    sequence: sequence.slice(0, 8),
    stopConditions: normalizeArray(raw.stopConditions).slice(0, 6),
    followOnTargets: followOnTargets.slice(0, 8),
    notes: normalizeArray(raw.notes).slice(0, 6)
  };

  if (bundle.topCandidates.length === 0) {
    return buildFallbackScenarioBundle(scenario, selectedConnections);
  }

  if (bundle.sequence.length === 0) {
    bundle.sequence = buildFallbackScenarioBundle(scenario, selectedConnections).sequence;
  }

  if (bundle.stopConditions.length === 0) {
    bundle.stopConditions = buildFallbackScenarioBundle(scenario, selectedConnections).stopConditions;
  }

  return bundle;
}

async function normalizeScenarioBundle(
  scenario: ScenarioDefinition,
  selectedConnections: SelectedConnection[],
  rawScenario: Record<string, unknown>,
  llmConfig: Pick<ResolvedPilotConfig, "llmApiKey" | "llmBaseUrl" | "llmModelName">
): Promise<ScenarioBundle> {
  if (!llmConfig.llmApiKey || !llmConfig.llmBaseUrl || !llmConfig.llmModelName) {
    return buildFallbackScenarioBundle(scenario, selectedConnections);
  }

  const focusList = selectedConnections.map((connection) => ({
    personKey: connection.personKey,
    fullName: connection.fullName,
    baseScore: connection.score,
    confidence: connection.confidence,
    company: connection.companyName,
    headline: connection.headline,
    bucket: connection.bucket,
    scoreBreakdown: connection.scoreBreakdown,
    whyThisPerson: connection.whyThisPerson,
    whyNow: connection.whyNow,
    suggestedAsk: connection.suggestedAsk,
    supportingProof: connection.supportingProof,
    riskSummary: connection.riskSummary
  }));

  const systemPrompt = [
    "You are normalizing a GTM rehearsal output into strict JSON for downstream execution.",
    "Return JSON only.",
    "Use only personKey values that already exist in the provided focus list.",
    "Do not invent new people, companies, or proof assets.",
    "Treat the provided base ranking and score breakdowns as priors, and only override them when the scenario-specific reasoning clearly warrants it."
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: "Convert the raw MiroFish output into the exact schema required for downstream cloud agents.",
      scenario: {
        id: scenario.id,
        goal: scenario.goal
      },
      schema: {
        scenarioId: "string",
        scenarioGoal: "string",
        topCandidates: [
          {
            personKey: "string from focusList",
            baseScore: "number",
            confidence: "high|medium|low",
            whyThisPerson: "string",
            whyNow: "string",
            suggestedAsk: "string",
            supportingProof: ["string"],
            risk: "string",
            priority: "high|medium|low"
          }
        ],
        sequence: [
          {
            title: "string",
            action: "string",
            gatingCondition: "string or null"
          }
        ],
        stopConditions: ["string"],
        followOnTargets: [
          {
            personKey: "string from focusList",
            reason: "string"
          }
        ],
        notes: ["string"]
      },
      focusList,
      rawScenario
    },
    null,
    2
  );

  try {
    const raw = await callOpenAiCompatibleJson(
      llmConfig.llmApiKey,
      llmConfig.llmBaseUrl,
      llmConfig.llmModelName,
      systemPrompt,
      userPrompt
    );
    return sanitizeScenarioBundle(scenario, selectedConnections, raw);
  } catch (error) {
    logger.warn("LLM scenario normalization failed. Falling back to deterministic bundle.", {
      scenarioId: scenario.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return buildFallbackScenarioBundle(scenario, selectedConnections);
  }
}

function pickInterviewCandidates(
  scenario: ScenarioDefinition,
  selectedConnections: SelectedConnection[]
): SelectedConnection[] {
  const preferredBuckets: Record<PilotScenarioId, PilotBucket[]> = {
    direct_reply: ["ecosystem", "founder_operator", "bridge", "amplifier"],
    ecosystem_leverage: ["ecosystem", "bridge", "founder_operator", "amplifier"],
    amplifier_route: ["amplifier", "ecosystem", "bridge", "founder_operator"],
    bridge_then_expand: ["bridge", "ecosystem", "founder_operator", "amplifier"]
  };

  return [...selectedConnections]
    .sort((left, right) => {
      const leftRank = preferredBuckets[scenario.id].indexOf(left.bucket);
      const rightRank = preferredBuckets[scenario.id].indexOf(right.bucket);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return right.score - left.score;
    })
    .slice(0, 6);
}

function priorityToScore(priority: string): number {
  if (priority === "high" || priority === "medium" || priority === "low") {
    return PRIORITY_SCORES[priority];
  }
  return 1;
}

export function consolidateScenarioBundles(
  bundles: ScenarioBundle[],
  selectedConnections: SelectedConnection[]
): ConsolidatedPilotOutput {
  const selectedLookup = new Map(selectedConnections.map((connection) => [connection.personKey, connection]));
  const actionMap = new Map<string, RankedAction>();
  const scenarioScores = new Map<PilotScenarioId, number>();

  for (const bundle of bundles) {
    let scenarioScore = 0;
    for (const candidate of bundle.topCandidates) {
      const existing = actionMap.get(candidate.personKey);
      const priorityScore = priorityToScore(candidate.priority);
      scenarioScore += priorityScore;

      if (existing) {
        existing.scenarioCount += 1;
        existing.scenarios = Array.from(new Set([...existing.scenarios, bundle.scenarioId]));
        existing.priorityScore += priorityScore;
        existing.supportingProof = Array.from(new Set([...existing.supportingProof, ...candidate.supportingProof])).slice(0, 6);
        if (priorityScore > 2) {
          existing.baseScore = candidate.baseScore ?? existing.baseScore;
          existing.confidence = candidate.confidence ?? existing.confidence;
          existing.whyThisPerson = candidate.whyThisPerson;
          existing.suggestedAsk = candidate.suggestedAsk;
          existing.whyNow = candidate.whyNow;
          existing.risk = candidate.risk;
        }
        continue;
      }

      actionMap.set(candidate.personKey, {
        personKey: candidate.personKey,
        fullName: candidate.fullName,
        company: candidate.company,
        headline: candidate.headline,
        baseScore: candidate.baseScore,
        confidence: candidate.confidence,
        scenarioCount: 1,
        scenarios: [bundle.scenarioId],
        priorityScore,
        whyThisPerson: candidate.whyThisPerson,
        suggestedAsk: candidate.suggestedAsk,
        whyNow: candidate.whyNow,
        supportingProof: candidate.supportingProof.slice(0, 6),
        risk: candidate.risk
      });
    }
    scenarioScores.set(bundle.scenarioId, scenarioScore);
  }

  const rankedActions = Array.from(actionMap.values()).sort((left, right) => {
    if (right.scenarioCount !== left.scenarioCount) {
      return right.scenarioCount - left.scenarioCount;
    }
    if (right.priorityScore !== left.priorityScore) {
      return right.priorityScore - left.priorityScore;
    }
    const leftConnection = selectedLookup.get(left.personKey);
    const rightConnection = selectedLookup.get(right.personKey);
    return (rightConnection?.score ?? 0) - (leftConnection?.score ?? 0);
  });

  if (rankedActions.length < 15) {
    const existingKeys = new Set(rankedActions.map((action) => action.personKey));
    const fillers = selectedConnections
      .filter((connection) => !existingKeys.has(connection.personKey))
      .slice(0, 15 - rankedActions.length)
      .map((connection) => ({
        personKey: connection.personKey,
        fullName: connection.fullName ?? "Unknown",
        company: connection.companyName,
        headline: connection.headline,
        baseScore: connection.score,
        confidence: connection.confidence,
        scenarioCount: 0,
        scenarios: [] as PilotScenarioId[],
        priorityScore: Math.max(1, Math.round(connection.score / 10)),
        whyThisPerson: connection.whyThisPerson,
        suggestedAsk: connection.suggestedAsk,
        whyNow: connection.whyNow,
        supportingProof: connection.supportingProof.slice(0, 4),
        risk: "Added from deterministic pre-filter because the simulation produced fewer than 15 unique people."
      }));
    rankedActions.push(...fillers);
  }

  const orderedScenarios = [...DEFAULT_SCENARIOS];
  const recommendedScenarioId =
    bundles
      .slice()
      .sort((left, right) => {
        const scoreDelta =
          (scenarioScores.get(right.scenarioId) ?? 0) - (scenarioScores.get(left.scenarioId) ?? 0);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return orderedScenarios.indexOf(left.scenarioId) - orderedScenarios.indexOf(right.scenarioId);
      })[0]?.scenarioId ?? "direct_reply";

  return {
    recommendedScenarioId,
    rankedActions: rankedActions.slice(0, 20),
    scenarioBundles: bundles
  };
}

async function writeSeedPack(outputDir: string, seedPack: SeedPack): Promise<void> {
  const seedDir = path.join(outputDir, "seed");
  await mkdir(seedDir, { recursive: true });

  await Promise.all([
    writeFile(path.join(seedDir, seedPack.operatorContext.filename), seedPack.operatorContext.content, "utf8"),
    writeFile(path.join(seedDir, seedPack.networkFocus.filename), seedPack.networkFocus.content, "utf8"),
    writeFile(path.join(seedDir, seedPack.clusterSummary.filename), seedPack.clusterSummary.content, "utf8"),
    writeFile(path.join(seedDir, seedPack.proofAssets.filename), seedPack.proofAssets.content, "utf8"),
    writeFile(path.join(seedDir, "selected_connections.json"), JSON.stringify(seedPack.selectedConnections, null, 2), "utf8"),
    writeFile(path.join(seedDir, "proof_items.json"), JSON.stringify(seedPack.proofItems, null, 2), "utf8")
  ]);
}

async function writeScenarioArtifacts(
  baseDir: string,
  scenario: ScenarioDefinition,
  raw: Record<string, unknown>,
  normalized: ScenarioBundle
): Promise<void> {
  const scenarioDir = path.join(baseDir, "scenarios", scenario.id);
  await mkdir(scenarioDir, { recursive: true });

  const rawRun = asRecord(raw.rawRun);
  const reportMarkdown =
    trimOrNull((rawRun?.report as Record<string, unknown> | undefined)?.markdown_content) ??
    trimOrNull((raw.report as Record<string, unknown> | undefined)?.markdown_content) ??
    "";

  await Promise.all([
    writeFile(path.join(scenarioDir, "raw.json"), JSON.stringify(raw, null, 2), "utf8"),
    writeFile(path.join(scenarioDir, "normalized.json"), JSON.stringify(normalized, null, 2), "utf8"),
    writeFile(path.join(scenarioDir, "normalized.md"), renderScenarioSummaryMarkdown(normalized), "utf8"),
    writeFile(path.join(scenarioDir, "report.md"), reportMarkdown, "utf8")
  ]);
}

async function resolvePilotConfig(options: PilotOptionOverrides = {}): Promise<ResolvedPilotConfig> {
  const rootDir = process.cwd();
  const tigerclawEnv = {
    ...(await loadEnvFile(path.join(rootDir, ".env.local"))),
    ...(await loadEnvFile(path.join(rootDir, ".env.extension.local"))),
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    )
  };
  const mirofishRootDir = options.mirofishRootDir ?? DEFAULT_MIROFISH_ROOT;
  const mirofishEnv = {
    ...(await loadEnvFile(path.join(mirofishRootDir, ".env"))),
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    )
  };
  const missionControlEnv = await loadEnvFile(DEFAULT_MISSION_CONTROL_ENV);
  const sharedGatewayEnv = await loadEnvFile(DEFAULT_SHARED_OPENAI_GATEWAY_ENV);

  const deploymentUrl = options.deploymentUrl ?? tigerclawEnv.TIGERCLAW_CONVEX_URL ?? tigerclawEnv.CONVEX_URL;
  const workspaceKey = options.workspaceKey ?? tigerclawEnv.TIGERCLAW_CONVEX_WORKSPACE_KEY;
  const syncToken = options.syncToken ?? tigerclawEnv.TIGERCLAW_CONVEX_SYNC_TOKEN;

  if (!deploymentUrl || !workspaceKey || !syncToken) {
    throw new Error(
      "Missing Convex pilot configuration. Set TIGERCLAW_CONVEX_URL/CONVEX_URL, TIGERCLAW_CONVEX_WORKSPACE_KEY, and TIGERCLAW_CONVEX_SYNC_TOKEN."
    );
  }

  const scenarioIds = (options.scenarios?.length ? options.scenarios : [...DEFAULT_SCENARIOS]).map((scenarioId) => {
    const scenario = SCENARIO_DEFINITIONS[scenarioId];
    if (!scenario) {
      throw new Error(`Unsupported scenario id: ${scenarioId}`);
    }
    return scenario;
  });

  const resolvedLlm = resolveMiroFishLlmConfig(mirofishEnv, missionControlEnv, sharedGatewayEnv);
  const zepApiKey =
    [mirofishEnv.ZEP_API_KEY, tigerclawEnv.ZEP_API_KEY, missionControlEnv.ZEP_API_KEY]
      .map((value) => trimOrNull(value))
      .find((value) => !isPlaceholderSecret(value)) ?? null;

  const missingConfig: string[] = [];
  if (!resolvedLlm.apiKey || !resolvedLlm.baseUrl || !resolvedLlm.modelName) {
    missingConfig.push(
      "LLM config (checked MiroFish .env, shared OpenAI gateway config, and Mission Control .env.local)"
    );
  }
  if (isPlaceholderSecret(zepApiKey)) {
    missingConfig.push("ZEP_API_KEY (checked MiroFish .env, Tigerclaw env, and Mission Control .env.local)");
  }
  if (missingConfig.length > 0) {
    throw new Error(`Missing MiroFish pilot credentials: ${missingConfig.join("; ")}.`);
  }

  const resolvedParallelProfileCount =
    options.parallelProfileCount ?? (isLocalOllamaBaseUrl(resolvedLlm.baseUrl) ? 1 : DEFAULT_PARALLEL_PROFILE_COUNT);

  return {
    convexConfig: {
      deploymentUrl: normalizeConvexDeploymentUrl(deploymentUrl),
      workspaceKey: workspaceKey.trim(),
      syncToken: syncToken.trim(),
      label: trimOrNull(options.label ?? tigerclawEnv.TIGERCLAW_CONVEX_LABEL),
      savedAt: new Date().toISOString()
    },
    sharedGraphId: trimOrNull(options.sharedGraphId),
    selectionLimit: options.selectionLimit ?? DEFAULT_SELECTION_LIMIT,
    maxRounds: options.maxRounds ?? DEFAULT_MAX_ROUNDS,
    outputRootDir: options.outputRootDir ?? DEFAULT_OUTPUT_ROOT,
    scenarios: scenarioIds,
    mirofishRootDir,
    mirofishBaseUrl: options.mirofishBaseUrl ?? DEFAULT_MIROFISH_URL,
    autoStartMiroFish: options.autoStartMiroFish ?? true,
    parallelProfileCount: resolvedParallelProfileCount,
    includeInterviews: options.includeInterviews ?? true,
    includeReport: options.includeReport ?? true,
    llmApiKey: resolvedLlm.apiKey,
    llmBaseUrl: resolvedLlm.baseUrl,
    llmModelName: resolvedLlm.modelName,
    zepApiKey
  };
}

async function loadWorkspaceSnapshot(convexConfig: ConvexConfig): Promise<PilotWorkspaceSnapshot> {
  const queryArgs = {
    workspaceKey: convexConfig.workspaceKey,
    syncToken: convexConfig.syncToken
  };

  let snapshot: {
    installation: Record<string, unknown> | null;
    run: Record<string, unknown> | null;
    batches: Array<Record<string, unknown>>;
  };
  let posts: Array<Record<string, unknown>>;
  let followers: Array<Record<string, unknown>>;
  let connectionsResponse: {
    run: Record<string, unknown> | null;
    connections: Array<Record<string, unknown>>;
  };

  try {
    [snapshot, posts, followers, connectionsResponse] = await Promise.all([
      callConvexQuery<{
        installation: Record<string, unknown> | null;
        run: Record<string, unknown> | null;
        batches: Array<Record<string, unknown>>;
      }>(convexConfig.deploymentUrl, "linkedinSync:getLatestWorkspaceSnapshot", queryArgs),
      callConvexQuery<Array<Record<string, unknown>>>(convexConfig.deploymentUrl, "linkedinSync:getWorkspacePosts", queryArgs),
      callConvexQuery<Array<Record<string, unknown>>>(convexConfig.deploymentUrl, "linkedinSync:getWorkspaceFollowers", queryArgs),
      callConvexQuery<{
        run: Record<string, unknown> | null;
        connections: Array<Record<string, unknown>>;
      }>(convexConfig.deploymentUrl, "linkedinSync:getWorkspaceConnections", queryArgs)
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("linkedinSync:getWorkspaceConnections")) {
      throw new Error(
        "Convex does not expose linkedinSync:getWorkspaceConnections yet. Deploy the updated Convex functions before running the MiroFish pilot."
      );
    }
    throw error;
  }

  const connections = connectionsResponse.connections
    .map((record) => normalizeConnectionRecord(record))
    .filter((record): record is WorkspaceConnectionRecord => record !== null);

  if (connections.length === 0) {
    throw new Error("No flattened connections were returned from Convex.");
  }

  const runRecord = (connectionsResponse.run ?? snapshot.run ?? null) as Record<string, unknown> | null;
  const userProfile = ((snapshot.run as Record<string, unknown> | null)?.userProfile ?? null) as UserProfile | null;
  const activitySnapshot = ((snapshot.run as Record<string, unknown> | null)?.activitySnapshot ?? null) as OwnActivitySnapshot | null;

  return {
    convexConfig,
    userProfile,
    activitySnapshot,
    posts,
    followers,
    connections,
    run: runRecord,
    installation: snapshot.installation
  };
}

export async function runMiroFishPilot(options: PilotOptionOverrides = {}): Promise<PilotRunResult> {
  const config = await resolvePilotConfig(options);
  const snapshot = await loadWorkspaceSnapshot(config.convexConfig);
  const proofItems = collectProofAssets(snapshot);
  const selectedConnections = selectFocusedConnections(snapshot.connections, config.selectionLimit, proofItems);
  const seedPack = buildSeedPack(snapshot, selectedConnections);
  const graphSeedFingerprint = buildGraphSeedFingerprint(seedPack);
  const graphCacheKey = hashString(
    JSON.stringify({
      workspaceKey: config.convexConfig.workspaceKey,
      seedFingerprint: graphSeedFingerprint,
      chunkSize: DEFAULT_GRAPH_CHUNK_SIZE,
      chunkOverlap: DEFAULT_GRAPH_CHUNK_OVERLAP
    })
  ).slice(0, 24);

  const runId = `${createRunId()}-${slugify(config.convexConfig.workspaceKey)}`;
  const outputDir = path.join(process.cwd(), config.outputRootDir, runId);
  await mkdir(outputDir, { recursive: true });
  await writeSeedPack(outputDir, seedPack);
  const graphCacheDir = path.join(process.cwd(), DEFAULT_GRAPH_CACHE_DIR);
  const cachedGraphMetadata = config.sharedGraphId
    ? null
    : await readCachedGraphMetadata(graphCacheDir, graphCacheKey);

  const mirofish = new MiroFishClient({
    baseUrl: config.mirofishBaseUrl,
    rootDir: config.mirofishRootDir,
    autoStart: config.autoStartMiroFish,
    startupLogDir: path.join(outputDir, "logs"),
    envOverrides: {
      LLM_API_KEY: config.llmApiKey ?? "",
      LLM_BASE_URL: config.llmBaseUrl ?? "",
      LLM_MODEL_NAME: config.llmModelName ?? "",
      ZEP_API_KEY: config.zepApiKey ?? ""
    }
  });
  let baseProjectId: string | null = null;
  let graphId = config.sharedGraphId ?? cachedGraphMetadata?.graphId ?? null;
  let graphTask: Record<string, unknown> | null = null;
  let profileReuseSourceSimulationId: string | null = null;

  if (!graphId) {
    const baseProject = await mirofish.importProject({
      projectName: `Tigerclaw base graph ${config.convexConfig.workspaceKey}`,
      simulationRequirement: BASE_GRAPH_SIMULATION_REQUIREMENT,
      documents: coreSeedDocuments(seedPack),
      ontology: GTM_PARTNER_WORLD_ONTOLOGY,
      analysisSummary: GTM_PARTNER_WORLD_ONTOLOGY.analysis_summary
    });
    const graphBuild = await mirofish.buildGraph({
      projectId: baseProject.projectId,
      graphName: `Tigerclaw Graph ${config.convexConfig.workspaceKey}`,
      chunkSize: DEFAULT_GRAPH_CHUNK_SIZE,
      chunkOverlap: DEFAULT_GRAPH_CHUNK_OVERLAP
    });
    baseProjectId = baseProject.projectId;
    graphId = graphBuild.graphId;
    graphTask = graphBuild.task;

    await writeCachedGraphMetadata(graphCacheDir, {
      cacheKey: graphCacheKey,
      graphId,
      workspaceKey: config.convexConfig.workspaceKey,
      createdAt: new Date().toISOString(),
      seedFingerprint: graphSeedFingerprint,
      chunkSize: DEFAULT_GRAPH_CHUNK_SIZE,
      chunkOverlap: DEFAULT_GRAPH_CHUNK_OVERLAP
    });
  }

  if (!graphId) {
    throw new Error("Shared graph id is unavailable.");
  }

  await writeFile(
    path.join(outputDir, "base_graph.json"),
    JSON.stringify(
      {
        projectId: baseProjectId,
        graphId,
        graphTask,
        chunkSize: DEFAULT_GRAPH_CHUNK_SIZE,
        chunkOverlap: DEFAULT_GRAPH_CHUNK_OVERLAP,
        reused: Boolean(config.sharedGraphId),
        graphCacheKey,
        cachedGraphId: cachedGraphMetadata?.graphId ?? null,
        reusedFromCache: Boolean(!config.sharedGraphId && cachedGraphMetadata?.graphId),
        ontology: GTM_PARTNER_WORLD_ONTOLOGY
      },
      null,
      2
    ),
    "utf8"
  );

  const scenarioBundles: ScenarioBundle[] = [];

  for (const scenario of config.scenarios) {
    logger.log("Running MiroFish pilot scenario.", {
      scenarioId: scenario.id,
      workspaceKey: config.convexConfig.workspaceKey
    });

    const scenarioProject = await mirofish.importProject({
      projectName: `Tigerclaw ${scenario.id} ${config.convexConfig.workspaceKey}`,
      simulationRequirement: scenario.simulationRequirement,
      documents: [...coreSeedDocuments(seedPack), scenarioContextDocument(seedPack, scenario)],
      ontology: GTM_PARTNER_WORLD_ONTOLOGY,
      analysisSummary: GTM_PARTNER_WORLD_ONTOLOGY.analysis_summary,
      graphId
    });

    const interviewCandidates = pickInterviewCandidates(scenario, selectedConnections).map((connection) => ({
      fullName: connection.fullName ?? "Unknown",
      prompt: scenario.interviewPrompt
    }));

    const rawRun = await mirofish.runScenario({
      projectId: scenarioProject.projectId,
      graphId,
      maxRounds: config.maxRounds,
      enableGraphMemoryUpdate: false,
      entityTypes: [...GTM_PERSON_ENTITY_TYPES],
      useLlmForProfiles: true,
      parallelProfileCount: config.parallelProfileCount,
      reuseProfilesFromSimulationId: profileReuseSourceSimulationId ?? undefined,
      includeInterviews: config.includeInterviews,
      includeReport: config.includeReport,
      interviewCandidates
    });

    if (!profileReuseSourceSimulationId) {
      profileReuseSourceSimulationId = rawRun.simulationId;
    }

    const normalizedBundle = await normalizeScenarioBundle(
      scenario,
      selectedConnections,
      rawRun as unknown as Record<string, unknown>,
      config
    );

    scenarioBundles.push(normalizedBundle);
    await writeScenarioArtifacts(
      outputDir,
      scenario,
      {
        scenarioProjectId: scenarioProject.projectId,
        sharedGraphId: graphId,
        rawRun
      },
      normalizedBundle
    );
  }

  const consolidated = consolidateScenarioBundles(scenarioBundles, selectedConnections);

  await Promise.all([
    writeFile(
      path.join(outputDir, "consolidated.json"),
      JSON.stringify(consolidated, null, 2),
      "utf8"
    ),
    writeFile(path.join(outputDir, "consolidated.md"), renderConsolidatedMarkdown(consolidated), "utf8"),
    writeFile(
      path.join(outputDir, "metadata.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          workspaceKey: config.convexConfig.workspaceKey,
          deploymentUrl: config.convexConfig.deploymentUrl,
          selectedConnectionCount: selectedConnections.length,
          scenarioIds: config.scenarios.map((scenario) => scenario.id),
          runKey: trimOrNull(snapshot.run?.runKey),
          baseProjectId,
          sharedGraphId: graphId,
          includeInterviews: config.includeInterviews,
          includeReport: config.includeReport
        },
        null,
        2
      ),
      "utf8"
    )
  ]);

  logger.log("MiroFish pilot completed.", {
    workspaceKey: config.convexConfig.workspaceKey,
    outputDir
  });

  return {
    outputDir,
    workspaceKey: config.convexConfig.workspaceKey,
    runId,
    selectedConnections,
    consolidated,
    generatedAt: new Date().toISOString()
  };
}
