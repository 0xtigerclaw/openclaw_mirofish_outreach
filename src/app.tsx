import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEMO_FOUNDER, DEMO_METADATA, DEMO_STAGES } from "./demoBundle";
import type { DemoGraphModel, DemoGraphNode, DemoGraphStage, DemoStageNarrative } from "./demoTypes";
import { GraphRenderer } from "./graphRenderer";
import { createMissionControlMission, type MissionControlMission } from "./missionControlClient";

const COPY = {
  bundleMissing: "Saved demo graph unavailable. This app only runs on a precomputed founder-investor graph.",
  missionControlUnavailable:
    "Mission Control is unavailable right now. The selected route is still approved, but no mission was created.",
  pendingApproval: "Approval is still pending. No LinkedIn message will be prepared before the founder signs off.",
  sendReady: "Mission Control mission created. The selected route is now in the LinkedIn workflow queue.",
  sendFailed: "Payload generation failed. The draft is still intact and nothing was sent."
} as const;

const HERO_SELECTED_FILE = "linked_connections.csv";

type LayerCard = {
  id: string;
  title: string;
  headline: string;
  supporting?: string[];
  copy: string;
};

type ApprovalState = "pending" | "approved" | "payload_ready";
type SelectedRoute = "direct" | "friend-first";
type AppPage = "hero" | "mirofish" | "handoff";
type AppRoute = {
  page: AppPage;
  stageId: DemoGraphStage["id"];
};

const DEFAULT_STAGE_BY_PAGE: Record<AppPage, DemoGraphStage["id"]> = {
  hero: "network",
  mirofish: "reasoning",
  handoff: "execution"
};

function getStageById(stageId: string) {
  return DEMO_STAGES.find((stage) => stage.id === stageId) ?? null;
}

function getStageIndexById(stageId: string) {
  const index = DEMO_STAGES.findIndex((stage) => stage.id === stageId);
  return index >= 0 ? index : 0;
}

function parseRouteFromLocation(): AppRoute {
  const hash = window.location.hash.replace(/^#/u, "");

  switch (hash) {
    case "":
    case "hero":
      return { page: "hero", stageId: "network" };
    case "mirofish":
    case "network":
      return { page: "mirofish", stageId: "network" };
    case "mirofish-reasoning":
    case "reasoning":
      return { page: "mirofish", stageId: "reasoning" };
    case "mirofish-bridge":
    case "friend-first":
      return { page: "mirofish", stageId: "friend-first" };
    case "mirofish-decision":
    case "decision":
      return { page: "mirofish", stageId: "decision" };
    case "handoff":
    case "execution":
      return { page: "handoff", stageId: "execution" };
    default:
      return { page: "hero", stageId: "network" };
  }
}

function routeToHash(route: AppRoute) {
  if (route.page === "hero") {
    return "#hero";
  }

  if (route.page === "handoff") {
    return "#handoff";
  }

  if (route.stageId === "network") {
    return "#mirofish";
  }

  if (route.stageId === "friend-first") {
    return "#mirofish-bridge";
  }

  if (route.stageId === "decision") {
    return "#mirofish-decision";
  }

  return "#mirofish-reasoning";
}

function prettifyNodeType(type: DemoGraphNode["type"]) {
  return type.replace(/_/gu, " ");
}

function findDefaultGraphNode(model: DemoGraphModel) {
  return (
    model.nodes.find((node) => node.subtitle?.toLowerCase().includes("best person")) ??
    model.nodes.find((node) => node.type === "connector") ??
    model.nodes.find((node) => node.type === "investor") ??
    model.nodes.find((node) => node.type === "founder") ??
    model.nodes[0] ??
    null
  );
}

function findDefaultSpotlightNode(stage: DemoGraphStage) {
  if (stage.id === "network") {
    return stage.nodes.find((node) => node.type === "founder") ?? findDefaultGraphNode(stage);
  }
  return findDefaultGraphNode(stage);
}

function buildSpotlight(stage: DemoGraphStage, nodeId: string | null) {
  const fallbackNode = findDefaultSpotlightNode(stage);
  const node = (nodeId ? stage.nodes.find((entry) => entry.id === nodeId) : null) ?? fallbackNode;

  if (!node) {
    return null;
  }

  const relatedEdges = stage.edges.filter((edge) => edge.source === node.id || edge.target === node.id);

  return {
    node,
    relationshipHint:
      relatedEdges.length > 0
        ? relatedEdges
            .slice(0, 3)
            .map((edge) => edge.label)
            .join(" · ")
        : "No visible relationship edges in this stage.",
    relatedEdges
  };
}

function buildStageStats(stage: DemoGraphStage) {
  return [
    ["Nodes", String(stage.nodes.length)],
    ["Links", String(stage.edges.length)],
    ["Connections", String(DEMO_METADATA.selectedConnectionCount)],
    ["Views", stage.secondaryGraph ? "2" : "1"]
  ];
}

function formatParty(party: DemoStageNarrative["connector"]) {
  return [party.name, party.company, party.title].filter(Boolean).join(" | ");
}

function formatDestination(narrative: DemoStageNarrative) {
  return [
    narrative.likelyInvestorDestination.name,
    narrative.likelyInvestorDestination.description
  ]
    .filter(Boolean)
    .join(" | ");
}

function firstSentence(text: string) {
  const segments = text.split(". ");
  if (segments.length === 0) {
    return text;
  }
  const sentence = segments[0] ?? text;
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}

function getMemoHeading(narrative: DemoStageNarrative) {
  switch (narrative.panelMode) {
    case "overview":
      return {
        title: "Current field memo",
        subtitle: "Tigerclaw is still mapping the warm investor surface before it commits to one route."
      };
    case "execution":
      return {
        title: "Execution memo",
        subtitle: "This is the final route Tigerclaw is carrying into approval and Mission Control."
      };
    default:
      return {
        title: "Selected path memo",
        subtitle: "The active graph and the reasoning replay are describing the same route."
      };
  }
}

function getExecutionHeading(narrative: DemoStageNarrative) {
  if (narrative.panelMode === "overview") {
    return {
      title: "Execution gated",
      subtitle: "Shortlist mode stays read-only until one route is selected and tightened."
    };
  }

  return {
    title: "Mission Control handoff",
    subtitle: "Approval stays visible here before the workflow generates the execution payload."
  };
}

function getSendStateText(narrative: DemoStageNarrative, approvalState: ApprovalState) {
  if (!narrative.actions.canPreparePayload) {
    return {
      className: "send-state pending",
      text: "This stage is still narrowing the route. Approval and payload creation stay disabled until Tigerclaw commits to one path."
    };
  }

  if (approvalState === "payload_ready") {
    return { className: "send-state ready", text: COPY.sendReady };
  }

  return { className: "send-state pending", text: COPY.pendingApproval };
}

function buildMissionControlPayload(stage: DemoGraphStage, approvalState: ApprovalState) {
  const narrative = stage.narrative;
  return {
    workflow: "warm_investor_intro",
    stageId: stage.id,
    stageTitle: stage.title,
    panelMode: narrative.panelMode,
    founder: DEMO_FOUNDER,
    connector: narrative.connector,
    likelyInvestorDestination: narrative.likelyInvestorDestination,
    warmPathSummary: narrative.warmPathSummary,
    whyThisPerson: narrative.whyThisPerson,
    whyNow: narrative.whyNow,
    suggestedAsk: narrative.suggestedAsk,
    supportingProof: narrative.supportingProof,
    likelyObjection: narrative.likelyObjection,
    nextBestStep: narrative.nextBestStep,
    draftMessage: narrative.draftMessage,
    graphId: DEMO_METADATA.graphId,
    workspaceKey: DEMO_METADATA.workspaceKey,
    approvalState,
    channel: "linkedin"
  };
}

function GraphCanvas({
  model,
  mode,
  initialFocusId,
  onNodeSelect,
  className,
  ariaLabel
}: {
  model: DemoGraphModel;
  mode: "overview" | "reasoning";
  initialFocusId: string | null;
  onNodeSelect?: (nodeId: string) => void;
  className: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    const renderer = new GraphRenderer(ref.current, model, {
      mode,
      initialFocusId,
      onNodeSelect
    });

    return () => renderer.destroy();
  }, [model, mode, initialFocusId, onNodeSelect]);

  return <div ref={ref} className={className} aria-label={ariaLabel} />;
}

function TigerclawApp() {
  const [route, setRoute] = useState(parseRouteFromLocation);
  const [approvalState, setApprovalState] = useState<ApprovalState>("pending");
  const [error, setError] = useState("");
  const [ingestStep, setIngestStep] = useState<"idle" | "selected">("idle");
  const [selectedRoute, setSelectedRoute] = useState<SelectedRoute>("direct");
  const [missionControlMission, setMissionControlMission] = useState<MissionControlMission | null>(null);
  const activeStage = getStageById(route.stageId);
  const directStage = getStageById("reasoning");
  const friendFirstStage = getStageById("friend-first");
  const executionBaseStage = getStageById("execution");
  const activeStageIndex = getStageIndexById(route.stageId);
  const [activeSpotlightNodeId, setActiveSpotlightNodeId] = useState<string | null>(
    activeStage ? (findDefaultSpotlightNode(activeStage)?.id ?? null) : null
  );
  useEffect(() => {
    const onHashChange = () => {
      const nextRoute = parseRouteFromLocation();
      setRoute((current) =>
        current.page === nextRoute.page && current.stageId === nextRoute.stageId ? current : nextRoute
      );
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!activeStage) {
      return;
    }

    setApprovalState("pending");
    setMissionControlMission(null);
    setError("");
    setActiveSpotlightNodeId(findDefaultSpotlightNode(activeStage)?.id ?? null);
  }, [activeStage?.id]);

  const spotlight = useMemo(
    () => (activeStage ? buildSpotlight(activeStage, activeSpotlightNodeId) : null),
    [activeSpotlightNodeId, activeStage]
  );

  const mirofishSpotlight = useMemo(() => {
    if (!activeStage || !spotlight) {
      return {
        kicker: "Path focus",
        title: "No graph focus available",
        copy: COPY.bundleMissing,
        pills: [] as string[]
      };
    }

    if (activeStage.id === "network") {
      return {
        kicker: "Network view",
        title: "Founder 1st-Degree +\nTop 5 2nd-Degree Surface",
        copy:
          "Tigerclaw starts with the founder's first-degree LinkedIn network, then expands around the top five strongest connections by mapping their own first-degree relationships as the second-degree investor and operator surface.",
        pills: ["Founder 1st-degree", "Top 5 expanded", "2nd-degree surface"]
      };
    }

    if (activeStage.id === "decision") {
      return {
        kicker: "Founder decision",
        title: selectedRoute === "direct" ? "Direct route selected" : "Friend-first route selected",
        copy:
          selectedRoute === "direct"
            ? "The founder is choosing the faster Harrison -> Hack VC route, where the first message stays calibration-led but moves closest to capital allocation."
            : "The founder is choosing the softer Katia -> Justin -> Decasonic route, where warmth and trust preservation matter more than directness.",
        pills: ["2 finalist routes", "Founder approval", "Route before handoff"]
      };
    }

    return {
      kicker: "Path focus",
      title: spotlight.node.label,
      copy: spotlight.node.subtitle
        ? `${spotlight.node.subtitle}. ${spotlight.relationshipHint}`
        : spotlight.relationshipHint,
      pills: [
        `Role ${prettifyNodeType(spotlight.node.type)}`,
        `${spotlight.relatedEdges.length} visible links`,
        `Stage ${activeStageIndex + 1} of ${
          DEMO_STAGES.filter((stage) => stage.id !== "execution").length
        }`
      ]
    };
  }, [activeStage, activeStageIndex, selectedRoute, spotlight]);

  const stageStats = useMemo(() => (activeStage ? buildStageStats(activeStage) : []), [activeStage]);

  const handoffStage = useMemo<DemoGraphStage | null>(() => {
    if (!executionBaseStage || !directStage) {
      return null;
    }

    if (selectedRoute === "direct" || !friendFirstStage) {
      return {
        ...executionBaseStage,
        title: "Mission Control Handoff",
        subtitle:
          "The founder selected the direct investor route, and Mission Control now receives the Harrison -> Hack VC memo.",
        summary:
          "Mission Control carries the direct Harrison route forward. The message stays narrow, context-first, and calibration-led before any wider investor ask.",
        narrative: {
          ...directStage.narrative,
          panelMode: "execution",
          scoreLabel: "Execution-ready",
          confidenceLabel: "Chosen route",
          connectorLabel: "Selected connector",
          destinationLabel: "Execution destination",
          likelyInvestorDestination: {
            name: "Hack VC venture path",
            description: "The final founder-selected route Tigerclaw is carrying into Mission Control."
          },
          suggestedAsk:
            "Approve the direct Harrison draft and hand it to Mission Control as the downstream execution payload.",
          supportingProof: [
            ...directStage.narrative.supportingProof,
            "The founder explicitly selected the direct route before handoff."
          ],
          likelyObjection:
            "The remaining risk is making the direct ask feel too wide, which is why the draft stays tightly scoped and calibration-led.",
          nextBestStep:
            "Approve the direct-route draft, create the Mission Control payload, and keep the live send as a downstream manual step.",
          executionRows: [
            {
              label: "Route mode",
              value: "Final chosen route is direct via Harrison into Hack VC."
            },
            {
              label: "Draft posture",
              value: "Lead with recent context, fit memo, and a narrow calibration ask."
            }
          ],
          actions: {
            canApprove: true,
            canPreparePayload: true
          }
        }
      };
    }

    return {
      ...executionBaseStage,
      title: "Mission Control Handoff",
      subtitle:
        "The founder chose the friend-first bridge route, and Mission Control now receives that softer memo instead of the direct investor path.",
      summary:
        "Mission Control now carries the friend-first route forward. The message goes to Katia first, keeps the ask trust-led, and only then opens the path into Justin and Decasonic.",
      narrative: {
        ...friendFirstStage.narrative,
        panelMode: "execution",
        scoreLabel: "Execution-ready",
        confidenceLabel: "Chosen route",
        connectorLabel: "Selected connector",
        destinationLabel: "Execution destination",
        likelyInvestorDestination: {
          name: "Justin Patel -> Decasonic",
          description:
            "The final presentation route Tigerclaw is carrying into Mission Control through a friend-first bridge."
        },
        suggestedAsk:
          "Approve the friend-first Katia draft and hand it to Mission Control as the downstream execution payload.",
        supportingProof: [
          ...friendFirstStage.narrative.supportingProof,
          "The founder explicitly selected the friend-first bridge route before handoff."
        ],
        likelyObjection:
          "The remaining risk is sending before the founder is comfortable that the softer bridge framing is right, which is why the approval gate remains visible here.",
        nextBestStep:
          "Approve the bridge-path draft, create the Mission Control payload, and keep the live send as a downstream manual step.",
        executionRows: [
          {
            label: "Route mode",
            value: "Final chosen route is friend-first via Katia into Justin and Decasonic."
          },
          {
            label: "Draft posture",
            value: "Lead with trust and a steer request before any investor-intro ask."
          }
        ],
        actions: {
          canApprove: true,
          canPreparePayload: true
        }
      },
      nodes: [
        { id: "swayam", label: "Swayam Shah", type: "founder", subtitle: "Founder / Tigerclaw", x: 150, y: 235 },
        { id: "katia", label: "Katia Yakovleva", type: "connector", subtitle: "Selected warm target", x: 400, y: 135 },
        { id: "justin", label: "Justin Patel", type: "investor", subtitle: "Investor bridge", x: 690, y: 135 },
        { id: "decasonic", label: "Decasonic path", type: "organization", subtitle: "Investor destination", x: 930, y: 135 },
        { id: "draft", label: "Draft ready", type: "execution_state", subtitle: "Founder-facing message prepared", x: 400, y: 350 },
        { id: "approval", label: "Awaiting approval", type: "execution_state", subtitle: "Manual gate", x: 640, y: 350 },
        { id: "mc", label: "Mission Control payload", type: "execution_state", subtitle: "Ready for downstream execution", x: 900, y: 350 }
      ],
      edges: [
        { id: "exec-warm", source: "swayam", target: "katia", label: "selected warm path", type: "knows" },
        { id: "exec-katia-justin", source: "katia", target: "justin", label: "friend-first bridge", type: "knows" },
        { id: "exec-justin-decasonic", source: "justin", target: "decasonic", label: "investor route", type: "can_intro" },
        { id: "exec-draft", source: "swayam", target: "draft", label: "drafted", type: "drafted" },
        { id: "exec-approval", source: "draft", target: "approval", label: "requires approval", type: "requires" },
        { id: "exec-mc", source: "approval", target: "mc", label: "approved handoff", type: "approved" },
        { id: "exec-send", source: "mc", target: "katia", label: "LinkedIn send", type: "sent" }
      ]
    };
  }, [directStage, executionBaseStage, friendFirstStage, selectedRoute]);

  const decisionRoutes = useMemo(() => {
    if (!directStage || !friendFirstStage) {
      return [];
    }

    return [
      {
        id: "direct" as SelectedRoute,
        label: "Direct investor path",
        narrative: directStage.narrative
      },
      {
        id: "friend-first" as SelectedRoute,
        label: "Friend-first bridge path",
        narrative: friendFirstStage.narrative
      }
    ];
  }, [directStage, friendFirstStage]);

  const networkLayerCards = useMemo<LayerCard[]>(() => {
    if (
      !activeStage ||
      (activeStage.id !== "network" && activeStage.id !== "reasoning" && activeStage.id !== "friend-first")
    ) {
      return [];
    }

    if (activeStage.id === "reasoning") {
      const getLabel = (id: string) =>
        activeStage.nodes.find((node) => node.id === id)?.label ?? id;
      return [
        {
          id: "direct",
          title: "Direct investor layer",
          headline: `${getLabel("harrison")}, Justin Patel`,
          copy: "These are the strongest investor-facing first-degree routes in the founder's network."
        },
        {
          id: "bridge",
          title: "Operator and platform bridge layer",
          headline: "Operator and platform connectors",
          supporting: [
            getLabel("katia") !== "katia" ? getLabel("katia") : "Katia Yakovleva",
            getLabel("sally") !== "sally" ? getLabel("sally") : "Sally Ann Frank",
            getLabel("matt") !== "matt" ? getLabel("matt") : "Matt Garrow-Fisher",
            getLabel("anastasiia") !== "anastasiia" ? getLabel("anastasiia") : "Anastasiia Moshkovska-Lorentzen"
          ],
          copy: "These softer connectors extend the adjacent second-degree surface when a direct venture ask feels too early."
        }
      ];
    }

    const getLabel = (id: string) =>
      activeStage.nodes.find((node) => node.id === id)?.label ?? id;

    if (activeStage.id === "friend-first") {
      return [
        {
          id: "bridge",
          title: "Primary bridge connector",
          headline: getLabel("bridge-katia"),
          copy: "Katia is the warmest first move. She gives the founder a trusted operator-first entry point before the route steps into Justin and Decasonic."
        },
        {
          id: "bridge-support",
          title: "Supporting bridge network",
          headline: "Operator and platform layer in reserve",
          supporting: ["Sally Ann Frank", "Matt Garrow-Fisher", "Anastasiia Moshkovska-Lorentzen"],
          copy: "These softer connectors stay available as backup bridge paths if Katia is not the right route."
        },
        {
          id: "direct",
          title: "Direct investor layer in reserve",
          headline: `Harrison Dahme, ${getLabel("bridge-justin")}`,
          copy: "The investor-facing layer is still visible, but it stays downstream until the friend-first ask earns a cleaner handoff."
        }
      ];
    }

    return [
      {
        id: "direct",
        title: "Direct investor layer",
        headline: `${getLabel("harrison")}, ${getLabel("justin")}`,
        copy: "These are the strongest investor-facing first-degree routes in the founder's network."
      },
      {
        id: "bridge",
        title: "Operator and platform bridge layer",
        headline: "Operator and platform connectors",
        supporting: [
          getLabel("katia"),
          getLabel("sally"),
          getLabel("matt"),
          getLabel("anastasiia")
        ],
        copy: "These softer connectors extend the adjacent second-degree surface when a direct venture ask feels too early."
      }
    ];
  }, [activeStage]);

  const narrative = activeStage?.narrative;
  const memoHeading = narrative ? getMemoHeading(narrative) : null;
  const executionHeading = narrative ? getExecutionHeading(narrative) : null;
  const sendState = narrative ? getSendStateText(narrative, approvalState) : null;
  const handoffNarrative = handoffStage?.narrative ?? null;
  const handoffMemoHeading = handoffNarrative ? getMemoHeading(handoffNarrative) : null;
  const handoffExecutionHeading = handoffNarrative ? getExecutionHeading(handoffNarrative) : null;
  const handoffSendState = handoffNarrative ? getSendStateText(handoffNarrative, approvalState) : null;
  const handoffStats = useMemo(() => (handoffStage ? buildStageStats(handoffStage) : []), [handoffStage]);
  const handoffSpotlight = useMemo(
    () => (handoffStage ? buildSpotlight(handoffStage, activeSpotlightNodeId) : null),
    [activeSpotlightNodeId, handoffStage]
  );

  const navigateTo = useCallback((nextRoute: AppRoute) => {
    window.location.hash = routeToHash(nextRoute);
    setRoute(nextRoute);
  }, []);

  const handlePageSelect = useCallback(
    (page: AppPage) => {
      navigateTo({ page, stageId: DEFAULT_STAGE_BY_PAGE[page] });
    },
    [navigateTo]
  );

  const handleMiroFishStageSelect = useCallback(
    (stageId: DemoGraphStage["id"]) => {
      const stage = getStageById(stageId);
      if (!stage) {
        return;
      }
      navigateTo({ page: "mirofish", stageId: stage.id });
    },
    [navigateTo]
  );

  const openMissionControlPanel = useCallback(() => {
    if (!missionControlMission) {
      return;
    }

    window.open(missionControlMission.url, "_blank", "noopener,noreferrer");
  }, [missionControlMission]);

  const handleMissionControl = useCallback(async () => {
    const payloadStage = route.page === "handoff" ? handoffStage : activeStage;
    const payloadNarrative = payloadStage?.narrative ?? null;

    if (missionControlMission) {
      openMissionControlPanel();
      return;
    }

    if (!payloadStage || !payloadNarrative) {
      setError(COPY.bundleMissing);
      return;
    }

    if (!payloadNarrative.actions.canPreparePayload || approvalState === "pending") {
      setError(COPY.pendingApproval);
      return;
    }

    try {
      const mission = await createMissionControlMission(payloadStage);
      setMissionControlMission(mission);
      setApprovalState("payload_ready");
      setError("");
    } catch (taskError) {
      const message = taskError instanceof Error ? taskError.message : String(taskError);
      setError(message ? `${COPY.missionControlUnavailable} (${message})` : COPY.missionControlUnavailable);
    }
  }, [activeStage, approvalState, handoffStage, missionControlMission, openMissionControlPanel, route.page]);

  const handleCopyMissionLink = useCallback(async () => {
    if (!missionControlMission) {
      return;
    }

    try {
      await navigator.clipboard.writeText(missionControlMission.url);
      setError("");
    } catch {
      setError(COPY.sendFailed);
    }
  }, [missionControlMission]);

  const mirofishStages = useMemo(
    () => DEMO_STAGES.filter((stage) => stage.id !== "execution"),
    []
  );

  if (!activeStage || !narrative || !memoHeading || !executionHeading || !sendState) {
    return (
      <main className="shell">
        <section className="workspace">
          <aside className="side-rail">
            <section className="execution-card rail-card">
              <div className="error-box">{COPY.bundleMissing}</div>
            </section>
          </aside>
        </section>
      </main>
    );
  }

  const renderTopBar = () => (
    <header className="topbar">
      <div className="topbar-brand">
        <div className="brand-mark">T</div>
        <div className="topbar-copy">
          <span className="topbar-title">Tigerclaw</span>
          <span className="topbar-subtitle">Warm intro strategist for founders</span>
        </div>
      </div>
    </header>
  );

  const renderPageNav = () => (
    <nav className="page-nav" aria-label="Tigerclaw pages">
      {[
        ["hero", "01 Hero"],
        ["mirofish", "02 MiroFish"],
        ["handoff", "03 Mission Control"]
      ].map(([page, label]) => (
        <button
          key={page}
          className="page-tab"
          data-active={String(route.page === page)}
          onClick={() => handlePageSelect(page as AppPage)}
        >
          {label}
        </button>
      ))}
    </nav>
  );

  const renderHeroPage = () => (
    <section className="page-shell page-shell-hero">
      <article className="hero hero-core">
        <span className="eyebrow">Tigerclaw</span>
        <h1>TigerClaw: Intelligent Outreach At Scale</h1>
        <p>
          Rank the warmest paths, pressure-test them in MiroFish, and hand the chosen route into
          Mission Control only when the founder is ready.
        </p>
        <div className="hero-actions">
          <button
            className="primary"
            onClick={() => {
              if (ingestStep === "idle") {
                setIngestStep("selected");
                setError("");
                return;
              }

              navigateTo({ page: "mirofish", stageId: "reasoning" });
            }}
          >
            Ingest Data
          </button>
        </div>

        {ingestStep === "selected" ? (
          <div className="hero-ingest-flow" aria-label="Selected ingest source">
            <span className="ingest-status">
              <span className="ingest-status-dot" aria-hidden="true" />
              <span>{`${HERO_SELECTED_FILE} selected`}</span>
            </span>
            <button
              className="secondary"
              onClick={() => navigateTo({ page: "mirofish", stageId: "network" })}
            >
              Run MiroFish Simulation
            </button>
          </div>
        ) : null}
      </article>
    </section>
  );

  const renderMiroFishPage = () => (
    <section className="page-shell page-shell-wide">
      <section className="workspace workspace-mirofish">
        <article className="graph-side">
          <div className="graph-head">
            <div>
              <h2>{activeStage.title}</h2>
            </div>
          </div>

          <div className="stage-rail">
            {mirofishStages.map((stage, index) => (
              <button
                key={stage.id}
                className="stage-tab"
                data-active={String(stage.id === activeStage.id)}
                onClick={() => handleMiroFishStageSelect(stage.id)}
              >
                {`${String(index + 1).padStart(2, "0")} ${stage.title.replace(/^Stage \d+:\s*/u, "")}`}
              </button>
            ))}
          </div>

          <GraphCanvas
            className="app-graph"
            ariaLabel="Tigerclaw warm intro graph"
            model={activeStage}
            mode={activeStage.id === "network" ? "overview" : "reasoning"}
            initialFocusId={
              activeStage.id === "network"
                ? null
                : findDefaultSpotlightNode(activeStage)?.id ?? null
            }
            onNodeSelect={setActiveSpotlightNodeId}
          />

          <div className="graph-foot">
            <div className="graph-notes">
              <div className="graph-summary">{firstSentence(activeStage.summary)}</div>
              <div className="graph-stats">
                {stageStats.map(([label, value]) => (
                  <div key={label} className="mini-stat">
                    <span className="mini-stat-label">{label}</span>
                    <span className="mini-stat-value">{value}</span>
                  </div>
                ))}
              </div>
              <div className="callouts">
                  {activeStage.callouts.slice(0, 2).map((callout) => (
                    <div key={callout} className="callout">
                      {callout}
                    </div>
                  ))}
                </div>
            </div>

            <aside className="spotlight">
              <span className="spotlight-kicker">{mirofishSpotlight.kicker}</span>
              <div className="spotlight-title spotlight-title-preline">{mirofishSpotlight.title}</div>
              <div className="spotlight-copy">{mirofishSpotlight.copy}</div>
              <div className="spotlight-meta">
                {mirofishSpotlight.pills.map((text) => (
                  <span key={text} className="spotlight-pill">
                    {text}
                  </span>
                ))}
              </div>
            </aside>
          </div>

          {activeStage.secondaryGraph ? (
            <section className="secondary-panel">
              <div className="secondary-head">
                <h3>{activeStage.secondaryGraph.title}</h3>
                <p>{activeStage.secondaryGraph.subtitle}</p>
              </div>

              <div className="secondary-body">
                <GraphCanvas
                  className="secondary-graph"
                  ariaLabel="Tigerclaw secondary bridge graph"
                  model={activeStage.secondaryGraph}
                  mode="reasoning"
                  initialFocusId={findDefaultGraphNode(activeStage.secondaryGraph)?.id ?? null}
                />
                <aside className="secondary-summary">
                  <span className="spotlight-kicker">Bridge simulation</span>
                  <p>{firstSentence(activeStage.secondaryGraph.summary)}</p>
                </aside>
              </div>
            </section>
          ) : null}
          {activeStage.id === "decision" ? (
            <section className="decision-panel">
              <section className="rail-card decision-summary-card">
                <div>
                  <h2>Founder route selection</h2>
                  <p>Select the route Tigerclaw should carry into Mission Control.</p>
                </div>
                <div className="score-row compact-row">
                  <span className="badge">2 finalist paths</span>
                  <span className="badge">
                    {selectedRoute === "direct" ? "Direct selected" : "Friend-first selected"}
                  </span>
                </div>
                <div className="decision-grid">
                  {decisionRoutes.map((routeOption) => (
                    <section
                      key={routeOption.id}
                      className="decision-card"
                      data-selected={String(selectedRoute === routeOption.id)}
                      data-tone={routeOption.id}
                    >
                      <div className="decision-card-head">
                        <span className="decision-route-label">{routeOption.label}</span>
                        <div className="decision-headline">{routeOption.narrative.connector.name}</div>
                        <p>{routeOption.narrative.connector.company}</p>
                        <div className="decision-route-pills">
                          <span className="badge">
                            {routeOption.id === "direct" ? "Faster route" : "Warmer route"}
                          </span>
                          <span className="badge">
                            {routeOption.id === "direct"
                              ? "Investor-facing first move"
                              : "Connector-first first move"}
                          </span>
                        </div>
                      </div>

                      <div className="decision-key-grid">
                        <div className="decision-section-card">
                          <span className="label">{routeOption.narrative.connectorLabel}</span>
                          <div className="decision-key-title">
                            {routeOption.narrative.connector.name}
                          </div>
                          <div className="value">
                            {[routeOption.narrative.connector.company, routeOption.narrative.connector.title]
                              .filter(Boolean)
                              .join(" • ")}
                          </div>
                        </div>
                        <div className="decision-section-card">
                          <span className="label">{routeOption.narrative.destinationLabel}</span>
                          <div className="decision-key-title">
                            {routeOption.narrative.likelyInvestorDestination.name}
                          </div>
                          <div className="value">
                            {firstSentence(routeOption.narrative.likelyInvestorDestination.description)}
                          </div>
                        </div>
                      </div>

                      <div className="decision-story-grid">
                        <div className="decision-section-card decision-section-card-primary">
                          <span className="label">Route thesis</span>
                          <div className="value">{firstSentence(routeOption.narrative.warmPathSummary)}</div>
                        </div>
                        <div className="decision-section-card">
                          <span className="label">Why now</span>
                          <div className="value">{firstSentence(routeOption.narrative.whyNow)}</div>
                        </div>
                      </div>

                      <div className="decision-bottom-grid">
                        <div className="decision-section-card">
                          <span className="label">Suggested ask</span>
                          <div className="value">{routeOption.narrative.suggestedAsk}</div>
                        </div>
                        <div className="decision-section-card decision-section-card-risk">
                          <span className="label">Risk to manage</span>
                          <div className="value">{firstSentence(routeOption.narrative.likelyObjection)}</div>
                        </div>
                      </div>

                      <div className="proof-panel decision-proof-panel">
                        <span className="label">Support signals</span>
                        <ul className="proof-list">
                          {routeOption.narrative.supportingProof.slice(0, 2).map((proof) => (
                            <li key={proof}>{proof}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="decision-actions">
                        <button
                          className={selectedRoute === routeOption.id ? "primary" : "secondary"}
                          onClick={() => setSelectedRoute(routeOption.id)}
                        >
                          {selectedRoute === routeOption.id
                            ? "Selected route"
                            : `Choose ${routeOption.label}`}
                        </button>
                      </div>
                    </section>
                  ))}
                </div>

                <div className="decision-footer">
                  <div className="actions">
                    <button
                      className="primary"
                      onClick={() => navigateTo({ page: "handoff", stageId: "execution" })}
                    >
                      Continue to Mission Control
                    </button>
                  </div>
                </div>
              </section>
            </section>
          ) : null}
        </article>

        {activeStage.id !== "decision" && networkLayerCards.length > 0 ? (
          <aside className="side-rail">
            <div className="network-layer-pane">
              {networkLayerCards.map((card) => (
                <div key={card.id} className="network-layer-card" data-tone={card.id}>
                  <span className="network-layer-title">{card.title}</span>
                  <div className="network-layer-headline">{card.headline}</div>
                  {card.supporting?.length ? (
                    <div className="network-layer-list">
                      {card.supporting.map((person) => (
                        <span key={person} className="network-layer-pill">
                          {person}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="network-layer-copy">{card.copy}</div>
                </div>
              ))}
            </div>
          </aside>
        ) : null}
      </section>
    </section>
  );

  const renderHandoffPage = () => {
    if (!handoffStage || !handoffNarrative || !handoffMemoHeading || !handoffExecutionHeading || !handoffSendState) {
      return (
        <section className="page-shell">
          <section className="workspace">
            <aside className="side-rail">
              <section className="execution-card rail-card">
                <div className="error-box">{COPY.bundleMissing}</div>
              </section>
            </aside>
          </section>
        </section>
      );
    }

    return (
      <section className="page-shell">
        <section className="handoff-layout">
          <article className="graph-side handoff-graph-side">
          <div className="graph-head">
            <div>
              <h2>{handoffStage.title}</h2>
              <p>{handoffStage.subtitle}</p>
            </div>
            <div className="graph-meta">{`Execution\n${DEMO_METADATA.graphId.slice(-8)}`}</div>
          </div>

          <GraphCanvas
            className="app-graph"
            ariaLabel="Tigerclaw handoff graph"
            model={handoffStage}
            mode="reasoning"
            initialFocusId={findDefaultSpotlightNode(handoffStage)?.id ?? null}
            onNodeSelect={setActiveSpotlightNodeId}
          />

          <div className="graph-foot">
            <div className="graph-notes">
              <div className="graph-summary">{firstSentence(handoffStage.summary)}</div>
              <div className="graph-stats">
                {handoffStats.map(([label, value]) => (
                  <div key={label} className="mini-stat">
                    <span className="mini-stat-label">{label}</span>
                    <span className="mini-stat-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <aside className="spotlight">
              <span className="spotlight-kicker">Execution focus</span>
              <div className="spotlight-title">{handoffSpotlight?.node.label ?? "No graph focus available"}</div>
              <div className="spotlight-copy">
                {handoffSpotlight
                  ? handoffSpotlight.node.subtitle
                    ? `${handoffSpotlight.node.subtitle}. ${handoffSpotlight.relationshipHint}`
                    : handoffSpotlight.relationshipHint
                  : COPY.bundleMissing}
              </div>
              <div className="spotlight-meta">
                {handoffSpotlight
                  ? [
                      `Role ${prettifyNodeType(handoffSpotlight.node.type)}`,
                      `${handoffSpotlight.relatedEdges.length} visible links`,
                      "Mission Control ready"
                    ].map((text) => (
                      <span key={text} className="spotlight-pill">
                        {text}
                      </span>
                    ))
                  : null}
              </div>
            </aside>
          </div>
        </article>

        <aside className="side-rail">
          <section className="execution-card rail-card">
            <div>
              <h2>{handoffExecutionHeading.title}</h2>
              <p>{handoffExecutionHeading.subtitle}</p>
            </div>

            <div className="execution-grid">
              {[
                ...handoffNarrative.executionRows,
                {
                  label: "Approval state",
                  value: !handoffNarrative.actions.canApprove
                    ? "Disabled in this stage. Select a specific route before moving into approval."
                    : approvalState === "pending"
                      ? "The founder has not approved the outreach yet."
                      : "Approval is on record and the execution payload can be staged."
                },
                {
                  label: "Mission Control status",
                  value: !handoffNarrative.actions.canPreparePayload
                    ? "Mission Control is intentionally gated until Tigerclaw commits to one path."
                    : approvalState === "payload_ready"
                      ? "Payload created for downstream agent execution."
                      : "Mission Control remains downstream of the approval gate."
                }
              ].map((row) => (
                <div key={row.label} className="execution-item">
                  <span className="label">{row.label}</span>
                  <div className="value">{row.value}</div>
                </div>
              ))}
            </div>

            <div className="message-box">
              <span className="label">Draft to review</span>
              {`\n\n${handoffNarrative.draftLabel}\n\n${handoffNarrative.draftMessage}`}
            </div>

            <div className="actions">
              <button
                className="primary"
                onClick={() => {
                  setError("");
                  setApprovalState("approved");
                }}
                disabled={!handoffNarrative.actions.canApprove}
              >
                Approve draft
              </button>
              <button
                className="secondary"
                onClick={() => void handleMissionControl()}
                disabled={!handoffNarrative.actions.canPreparePayload || approvalState === "pending"}
              >
                {missionControlMission ? "Open Mission Control panel" : "Send to Mission Control"}
              </button>
            </div>

            <div className={handoffSendState.className}>{handoffSendState.text}</div>
            {missionControlMission ? (
              <section className="mission-card">
                <div className="mission-card-head">
                  <div>
                    <span className="label">Mission created</span>
                    <h3>{missionControlMission.title}</h3>
                  </div>
                  <span className="badge">Task {missionControlMission.taskId}</span>
                </div>

                <div className="mission-workflow">
                  {missionControlMission.workflow.map((agent) => (
                    <span key={agent} className="workflow-pill">
                      {agent}
                    </span>
                  ))}
                </div>

                <div className="mission-link">{missionControlMission.url}</div>

                <div className="actions">
                  <button className="primary" onClick={openMissionControlPanel}>
                    Open Mission Control panel
                  </button>
                  <button className="secondary" onClick={() => void handleCopyMissionLink()}>
                    Copy mission link
                  </button>
                </div>
              </section>
            ) : null}
            {error ? <div className="error-box">{error}</div> : null}
          </section>
        </aside>
      </section>
    </section>
    );
  };

  return (
    <main className="shell">
      {renderTopBar()}
      {renderPageNav()}

      {route.page === "hero" ? renderHeroPage() : null}
      {route.page === "mirofish" ? renderMiroFishPage() : null}
      {route.page === "handoff" ? renderHandoffPage() : null}
    </main>
  );
}

const rootElement = document.getElementById("app-root");
if (!rootElement) {
  throw new Error("Missing #app-root for Tigerclaw app.");
}

createRoot(rootElement).render(<TigerclawApp />);
