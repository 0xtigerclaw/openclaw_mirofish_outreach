import type { ConnectionRecord, ConvexConfig, OwnActivitySnapshot, UserProfile } from "../types";

export type PilotScenarioId =
  | "direct_reply"
  | "ecosystem_leverage"
  | "amplifier_route"
  | "bridge_then_expand";

export type PilotBucket = "ecosystem" | "founder_operator" | "amplifier" | "bridge";
export type CandidatePriority = "high" | "medium" | "low";

export interface ScoreBreakdown {
  roleFit: number;
  companyFit: number;
  warmthFit: number;
  proofFit: number;
  pathValue: number;
  timingFit: number;
  riskPenalty: number;
  total: number;
}

export interface WorkspaceConnectionRecord extends ConnectionRecord {
  personKey: string;
}

export interface SelectedConnection extends WorkspaceConnectionRecord {
  bucket: PilotBucket;
  score: number;
  keywordScore: number;
  recencyScore: number;
  matchedKeywords: string[];
  confidence: CandidatePriority;
  scoreBreakdown: ScoreBreakdown;
  whyItMayMatter: string;
  whyThisPerson: string;
  whyNow: string;
  suggestedAsk: string;
  supportingProof: string[];
  riskSummary: string;
}

export interface ProofAsset {
  label: string;
  summary: string;
  sourceType: "activity_snapshot" | "post" | "follower" | "profile";
  sourceUrl: string | null;
}

export interface SeedPackDocument {
  filename: string;
  content: string;
}

export interface SeedPack {
  operatorContext: SeedPackDocument;
  networkFocus: SeedPackDocument;
  clusterSummary: SeedPackDocument;
  proofAssets: SeedPackDocument;
  selectedConnections: SelectedConnection[];
  proofItems: ProofAsset[];
}

export interface ScenarioDefinition {
  id: PilotScenarioId;
  goal: string;
  simulationRequirement: string;
  interviewPrompt: string;
}

export interface ScenarioSequenceStep {
  title: string;
  action: string;
  gatingCondition: string | null;
}

export interface FollowOnTarget {
  personKey: string;
  reason: string;
}

export interface ScenarioTopCandidate {
  personKey: string;
  fullName: string;
  company: string | null;
  headline: string | null;
  baseScore: number | null;
  confidence: CandidatePriority;
  whyThisPerson: string;
  whyNow: string;
  suggestedAsk: string;
  supportingProof: string[];
  risk: string;
  priority: CandidatePriority;
}

export interface ScenarioBundle {
  scenarioId: PilotScenarioId;
  scenarioGoal: string;
  topCandidates: ScenarioTopCandidate[];
  sequence: ScenarioSequenceStep[];
  stopConditions: string[];
  followOnTargets: FollowOnTarget[];
  notes?: string[];
}

export interface RankedAction {
  personKey: string;
  fullName: string;
  company: string | null;
  headline: string | null;
  baseScore: number | null;
  confidence: CandidatePriority;
  scenarioCount: number;
  scenarios: PilotScenarioId[];
  priorityScore: number;
  whyThisPerson: string;
  suggestedAsk: string;
  whyNow: string;
  supportingProof: string[];
  risk: string;
}

export interface ConsolidatedPilotOutput {
  recommendedScenarioId: PilotScenarioId;
  rankedActions: RankedAction[];
  scenarioBundles: ScenarioBundle[];
}

export interface PilotWorkspaceSnapshot {
  convexConfig: ConvexConfig;
  userProfile: UserProfile | null;
  activitySnapshot: OwnActivitySnapshot | null;
  posts: Array<Record<string, unknown>>;
  followers: Array<Record<string, unknown>>;
  connections: WorkspaceConnectionRecord[];
  run: Record<string, unknown> | null;
  installation: Record<string, unknown> | null;
}

export interface PilotRunResult {
  outputDir: string;
  workspaceKey: string;
  runId: string;
  selectedConnections: SelectedConnection[];
  consolidated: ConsolidatedPilotOutput;
  generatedAt: string;
}
