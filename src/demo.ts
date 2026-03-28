import { DEMO_FOUNDER, DEMO_METADATA, DEMO_STAGES } from "./demoBundle";
import type { DemoGraphStage, DemoStageNarrative } from "./demoTypes";
import { GraphRenderer } from "./graphRenderer";

const FAILURE_COPY = {
  bundleMissing: "Saved demo graph unavailable. Demo mode requires a precomputed founder-investor network.",
  reasoningMissing: "Reasoning graph unavailable. Tigerclaw cannot show the MiroFish path replay for this target.",
  missionControlMissing:
    "Mission Control handoff is unavailable. The payload is still staged locally and nothing was sent.",
  sendPending: "Approval is still pending. No LinkedIn message will be sent until the founder approves the draft.",
  sendFailed: "Mission Control did not accept the payload. The draft remains available and nothing was sent."
} as const;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Tigerclaw demo page failed to initialize: missing ${selector}`);
  }
  return element;
}

const trustStrip = requireElement<HTMLDivElement>("#trust-strip");
const stageTitle = requireElement<HTMLHeadingElement>("#stage-title");
const stageSubtitle = requireElement<HTMLParagraphElement>("#stage-subtitle");
const metadataPill = requireElement<HTMLDivElement>("#metadata-pill");
const stageTabs = requireElement<HTMLDivElement>("#stage-tabs");
const stageSummary = requireElement<HTMLDivElement>("#stage-summary");
const stageCallouts = requireElement<HTMLDivElement>("#stage-callouts");
const graphElement = requireElement<HTMLDivElement>("#graph");
const targetScore = requireElement<HTMLSpanElement>("#target-score");
const targetConfidence = requireElement<HTMLSpanElement>("#target-confidence");
const memoTitle = requireElement<HTMLHeadingElement>("#demo-memo-title");
const memoSubtitle = requireElement<HTMLParagraphElement>("#demo-memo-subtitle");
const targetDetails = requireElement<HTMLDivElement>("#target-details");
const targetProof = requireElement<HTMLUListElement>("#target-proof");
const executionTitle = requireElement<HTMLHeadingElement>("#demo-execution-title");
const executionSubtitle = requireElement<HTMLParagraphElement>("#demo-execution-subtitle");
const approvalStates = requireElement<HTMLDivElement>("#approval-states");
const draftMessage = requireElement<HTMLDivElement>("#draft-message");
const approveButton = requireElement<HTMLButtonElement>("#approve-btn");
const payloadButton = requireElement<HTMLButtonElement>("#payload-btn");
const sendStatus = requireElement<HTMLDivElement>("#send-status");
const payloadOutput = requireElement<HTMLDivElement>("#payload-output");
const errorOutput = requireElement<HTMLDivElement>("#error-output");

type ApprovalState = "awaiting_approval" | "ready_for_payload" | "payload_created";

function findDefaultGraphNode(stage: DemoGraphStage) {
  return (
    stage.nodes.find((node) => node.subtitle?.toLowerCase().includes("best person")) ??
    stage.nodes.find((node) => node.type === "connector") ??
    stage.nodes.find((node) => node.type === "investor") ??
    stage.nodes.find((node) => node.type === "founder") ??
    stage.nodes[0] ??
    null
  );
}

function getActiveStage(): DemoGraphStage {
  const stage = DEMO_STAGES[activeStageIndex];
  if (!stage) {
    throw new Error("Missing active demo stage.");
  }
  return stage;
}

function getStageNarrative(stage: DemoGraphStage) {
  return stage.narrative;
}

function formatParty(party: DemoStageNarrative["connector"]) {
  return [party.name, party.company, party.title].filter(Boolean).join(" | ");
}

function formatDestination(narrative: DemoStageNarrative) {
  return [narrative.likelyInvestorDestination.name, narrative.likelyInvestorDestination.description]
    .filter(Boolean)
    .join(" | ");
}

function getMemoHeading(narrative: DemoStageNarrative) {
  switch (narrative.panelMode) {
    case "overview":
      return {
        title: "Current field",
        subtitle: "Tigerclaw is still mapping the viable warm routes before it commits to one."
      };
    case "execution":
      return {
        title: "Execution route",
        subtitle: "This is the final path Tigerclaw is carrying into the handoff."
      };
    default:
      return {
        title: "Selected warm path",
        subtitle: "The ranked target and the graph replay now describe the same route."
      };
  }
}

function getExecutionHeading(narrative: DemoStageNarrative) {
  if (narrative.panelMode === "overview") {
    return {
      title: "Execution gated",
      subtitle: "No send action is available until one route is selected and tightened."
    };
  }

  return {
    title: "Draft and approval",
    subtitle: "Mission Control stays downstream of Tigerclaw. The founder approves before any send action."
  };
}

function resetWorkflowState() {
  approvalState = "awaiting_approval";
  payloadOutput.hidden = true;
  payloadOutput.textContent = "";
  clearError();
}

function activateStage(nextStageIndex: number) {
  if (nextStageIndex === activeStageIndex) {
    return;
  }

  activeStageIndex = nextStageIndex;
  resetWorkflowState();
  renderStage();
}

let activeStageIndex = 0;
let approvalState: ApprovalState = "awaiting_approval";
let graph: GraphRenderer | null = null;

function ensureBundle() {
  if (!DEMO_STAGES.length) {
    renderError(FAILURE_COPY.bundleMissing);
    return false;
  }
  return true;
}

function renderTrustStrip() {
  const items = [
    "Saved founder-investor graph loaded",
    "Warm path identified",
    "Draft requires manual approval"
  ];
  trustStrip.replaceChildren(
    ...items.map((item) => {
      const span = document.createElement("span");
      span.className = "trust-pill";
      span.textContent = item;
      return span;
    })
  );
}

function renderStageTabs() {
  stageTabs.replaceChildren(
    ...DEMO_STAGES.map((stage, index) => {
      const button = document.createElement("button");
      button.className = "stage-tab";
      button.dataset.active = String(index === activeStageIndex);
      button.textContent = stage.title.replace(/^Stage\s+/u, "");
      button.addEventListener("click", () => {
        activateStage(index);
      });
      return button;
    })
  );
}

function renderStage() {
  const stage = DEMO_STAGES[activeStageIndex];
  if (!stage) {
    renderError(FAILURE_COPY.reasoningMissing);
    return;
  }

  stageTitle.textContent = stage.title;
  stageSubtitle.textContent = stage.subtitle;
  metadataPill.textContent = `Graph ${DEMO_METADATA.graphId} | ${DEMO_METADATA.generatedAt}`;
  stageSummary.textContent = stage.summary;
  stageCallouts.replaceChildren(
    ...stage.callouts.map((text) => {
      const div = document.createElement("div");
      div.className = "callout";
      div.textContent = text;
      return div;
    })
  );

  graph?.destroy();
  graph = new GraphRenderer(graphElement, stage, {
    mode: stage.id === "network" ? "overview" : "reasoning",
    initialFocusId: stage.id === "network" ? null : findDefaultGraphNode(stage)?.id ?? null
  });
  renderStageTabs();
  renderTargetCard(stage);
  renderApprovalCard(stage);
}

function renderTargetCard(stage: DemoGraphStage) {
  const narrative = getStageNarrative(stage);
  const heading = getMemoHeading(narrative);
  memoTitle.textContent = heading.title;
  memoSubtitle.textContent = heading.subtitle;
  targetScore.textContent = narrative.scoreLabel;
  targetConfidence.textContent = narrative.confidenceLabel;

  const items = [
    {
      label: narrative.connectorLabel,
      value: formatParty(narrative.connector)
    },
    {
      label: narrative.destinationLabel,
      value: formatDestination(narrative)
    },
    {
      label: "Warm path summary",
      value: narrative.warmPathSummary
    },
    {
      label: "Why this person",
      value: narrative.whyThisPerson
    },
    {
      label: "Why now",
      value: narrative.whyNow
    },
    {
      label: "Why this ranked above others",
      value: narrative.whyThisRankedAboveOthers
    },
    {
      label: "Suggested ask",
      value: narrative.suggestedAsk
    },
    {
      label: "Likely objection",
      value: narrative.likelyObjection
    },
    {
      label: "Next best step",
      value: narrative.nextBestStep
    }
  ];

  targetDetails.replaceChildren(
    ...items.map((item) => {
      const wrapper = document.createElement("div");
      wrapper.className = "meta-item";

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = item.label;

      const value = document.createElement("div");
      value.className = "value";
      value.textContent = item.value;

      wrapper.append(label, value);
      return wrapper;
    })
  );

  targetProof.replaceChildren(
    ...narrative.supportingProof.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    })
  );
}

function renderApprovalCard(stage: DemoGraphStage) {
  const narrative = getStageNarrative(stage);
  const heading = getExecutionHeading(narrative);
  executionTitle.textContent = heading.title;
  executionSubtitle.textContent = heading.subtitle;
  draftMessage.textContent = `${narrative.draftLabel}\n\n${narrative.draftMessage}`;

  const stateDescriptors = [
    ...narrative.executionRows,
    {
      label: "Approval state",
      value: !narrative.actions.canApprove
        ? "Disabled in this stage. Select a specific route before moving into approval."
        : approvalState === "awaiting_approval"
          ? "Manual approval is required before Mission Control can take over."
          : "Approval recorded."
    },
    {
      label: "Ready for Mission Control send",
      value: !narrative.actions.canPreparePayload
        ? "Payload creation is disabled until Tigerclaw commits to one route."
        : approvalState === "payload_created"
          ? "Mission Control payload created and ready for downstream execution."
          : approvalState === "ready_for_payload"
            ? "Approved and ready to create the Mission Control payload."
            : "Blocked until approval."
    }
  ];

  approvalStates.replaceChildren(
    ...stateDescriptors.map((item) => {
      const wrapper = document.createElement("div");
      wrapper.className = "state-item";

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = item.label;

      const value = document.createElement("div");
      value.className = "value";
      value.textContent = item.value;

      wrapper.append(label, value);
      return wrapper;
    })
  );

  approveButton.disabled = !narrative.actions.canApprove;
  payloadButton.disabled = !narrative.actions.canPreparePayload || approvalState === "awaiting_approval";
  sendStatus.className = `status-pill ${
    approvalState === "payload_created" ? "status-ready" : "status-pending"
  }`;

  if (!narrative.actions.canPreparePayload) {
    sendStatus.textContent =
      "This stage is still narrowing the route. Payload creation stays disabled until Tigerclaw commits to one path.";
  } else if (approvalState === "awaiting_approval") {
    sendStatus.textContent = FAILURE_COPY.sendPending;
  } else if (approvalState === "ready_for_payload") {
    sendStatus.textContent = "Approval recorded. Prepare the Mission Control payload when ready.";
  } else {
    sendStatus.textContent = "Mission Control payload created. The send remains manual and demo-safe.";
  }
}

function renderError(message: string) {
  errorOutput.hidden = false;
  errorOutput.textContent = message;
}

function clearError() {
  errorOutput.hidden = true;
  errorOutput.textContent = "";
}

function buildMissionControlPayload() {
  const stage = getActiveStage();
  const narrative = getStageNarrative(stage);
  return {
    workflow: "warm_investor_intro",
    stageId: stage.id,
    stageTitle: stage.title,
    panelMode: narrative.panelMode,
    founder: DEMO_FOUNDER,
    connector: narrative.connector,
    likelyInvestorDestination: narrative.likelyInvestorDestination,
    warmPathSummary: narrative.warmPathSummary,
    proofAssets: narrative.supportingProof,
    suggestedAsk: narrative.suggestedAsk,
    likelyObjection: narrative.likelyObjection,
    nextBestStep: narrative.nextBestStep,
    draftMessage: narrative.draftMessage,
    channel: "linkedin",
    approvalState: approvalState,
    graphId: DEMO_METADATA.graphId,
    workspaceKey: DEMO_METADATA.workspaceKey
  };
}

approveButton.addEventListener("click", () => {
  clearError();
  approvalState = "ready_for_payload";
  renderApprovalCard(getActiveStage());
});

payloadButton.addEventListener("click", async () => {
  clearError();
  const stage = getActiveStage();
  const narrative = getStageNarrative(stage);
  if (!narrative.actions.canPreparePayload || approvalState === "awaiting_approval") {
    renderError(FAILURE_COPY.sendPending);
    return;
  }

  try {
    const payload = buildMissionControlPayload();
    payloadOutput.hidden = false;
    payloadOutput.textContent = JSON.stringify(payload, null, 2);
    approvalState = "payload_created";
    renderApprovalCard(stage);

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      renderError(FAILURE_COPY.missionControlMissing);
    }
  } catch {
    renderError(FAILURE_COPY.sendFailed);
  }
});

if (ensureBundle()) {
  renderTrustStrip();
  renderStage();
}
