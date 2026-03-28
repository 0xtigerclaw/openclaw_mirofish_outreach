export type DemoNodeType =
  | "founder"
  | "connector"
  | "investor"
  | "organization"
  | "proof"
  | "risk"
  | "execution_state";

export type DemoEdgeType =
  | "knows"
  | "affiliated_with"
  | "can_intro"
  | "supports"
  | "requires"
  | "blocks"
  | "drafted"
  | "approved"
  | "sent";

export interface DemoGraphNode {
  id: string;
  label: string;
  type: DemoNodeType;
  subtitle?: string;
  x: number;
  y: number;
}

export interface DemoGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  type: DemoEdgeType;
}

export interface DemoGraphModel {
  nodes: DemoGraphNode[];
  edges: DemoGraphEdge[];
}

export interface DemoGraphInset extends DemoGraphModel {
  title: string;
  subtitle: string;
  summary: string;
}

export interface DemoNarrativeParty {
  personKey?: string;
  name: string;
  title?: string;
  company?: string;
}

export interface DemoNarrativeDestination {
  name: string;
  description: string;
}

export interface DemoNarrativeRow {
  label: string;
  value: string;
}

export interface DemoStageNarrative {
  panelMode: "overview" | "path" | "execution";
  scoreLabel: string;
  confidenceLabel: string;
  connectorLabel: string;
  connector: DemoNarrativeParty;
  destinationLabel: string;
  likelyInvestorDestination: DemoNarrativeDestination;
  warmPathSummary: string;
  whyThisPerson: string;
  whyNow: string;
  whyThisRankedAboveOthers: string;
  suggestedAsk: string;
  supportingProof: string[];
  likelyObjection: string;
  nextBestStep: string;
  draftLabel: string;
  draftMessage: string;
  executionRows: DemoNarrativeRow[];
  actions: {
    canApprove: boolean;
    canPreparePayload: boolean;
  };
}

export interface DemoGraphStage extends DemoGraphModel {
  id: string;
  title: string;
  subtitle: string;
  summary: string;
  callouts: string[];
  narrative: DemoStageNarrative;
  secondaryGraph?: DemoGraphInset;
}

export interface DemoTarget {
  founder: {
    name: string;
    title: string;
  };
  connector: {
    personKey: string;
    name: string;
    title: string;
    company: string;
    baseScore: number;
    confidence: string;
  };
  likelyInvestorDestination: {
    name: string;
    description: string;
  };
  warmPathSummary: string;
  whyThisPerson: string;
  whyNow: string;
  whyThisRankedAboveOthers: string;
  suggestedAsk: string;
  supportingProof: string[];
  likelyObjection: string;
  nextBestStep: string;
  draftMessage: string;
}

export interface DemoMetadata {
  workspaceKey: string;
  graphId: string;
  seedFingerprint: string;
  selectedConnectionCount: number;
  generatedAt: string;
  demoLabel: string;
}
