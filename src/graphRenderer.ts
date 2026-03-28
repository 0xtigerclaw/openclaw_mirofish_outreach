import * as d3 from "d3";
import type { DemoGraphModel, DemoGraphNode } from "./demoTypes";

export interface GraphRenderOptions {
  mode: "overview" | "reasoning";
  initialFocusId?: string | null;
  onNodeSelect?: (nodeId: string) => void;
}

type GraphNodeWithSize = DemoGraphNode & {
  width: number;
  height: number;
};

type GraphEdgeView = DemoGraphModel["edges"][number] & {
  sourceNode: GraphNodeWithSize;
  targetNode: GraphNodeWithSize;
  active: boolean;
};

const TYPE_STYLES = {
  founder: {
    color: "#c94c2d",
    soft: "rgba(201, 76, 45, 0.14)",
    text: "#203046",
    stroke: "rgba(201, 76, 45, 0.32)"
  },
  connector: {
    color: "#6d4de2",
    soft: "rgba(109, 77, 226, 0.14)",
    text: "#213046",
    stroke: "rgba(109, 77, 226, 0.32)"
  },
  investor: {
    color: "#2f7fb6",
    soft: "rgba(47, 127, 182, 0.14)",
    text: "#213046",
    stroke: "rgba(47, 127, 182, 0.3)"
  },
  organization: {
    color: "#314559",
    soft: "rgba(49, 69, 89, 0.08)",
    text: "#314559",
    stroke: "rgba(49, 69, 89, 0.18)"
  },
  proof: {
    color: "#177b55",
    soft: "rgba(23, 123, 85, 0.12)",
    text: "#2d5b47",
    stroke: "rgba(23, 123, 85, 0.24)"
  },
  risk: {
    color: "#a56a12",
    soft: "rgba(165, 106, 18, 0.12)",
    text: "#6a5125",
    stroke: "rgba(165, 106, 18, 0.28)"
  },
  execution_state: {
    color: "#142133",
    soft: "rgba(20, 33, 51, 0.92)",
    text: "#f5f1ea",
    stroke: "rgba(244, 232, 211, 0.2)"
  }
} as const;

function getNodeSize(node: DemoGraphNode) {
  switch (node.type) {
    case "founder":
      return { width: 40, height: 40 };
    case "connector":
    case "investor":
      return { width: 34, height: 34 };
    case "organization":
      return { width: 136, height: 42 };
    case "proof":
      return { width: 162, height: 48 };
    case "risk":
      return { width: 170, height: 50 };
    case "execution_state":
      return { width: 184, height: 58 };
  }
}

function getNodeBounds(node: GraphNodeWithSize) {
  return {
    left: node.x - node.width / 2,
    right: node.x + node.width / 2,
    top: node.y - node.height / 2,
    bottom: node.y + node.height / 2
  };
}

function anchorPoint(source: GraphNodeWithSize, target: GraphNodeWithSize) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const bounds = getNodeBounds(source);

  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      x: dx >= 0 ? bounds.right : bounds.left,
      y: source.y
    };
  }

  return {
    x: source.x,
    y: dy >= 0 ? bounds.bottom : bounds.top
  };
}

function edgePath(edge: GraphEdgeView) {
  const start = anchorPoint(edge.sourceNode, edge.targetNode);
  const end = anchorPoint(edge.targetNode, edge.sourceNode);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const curve = Math.min(48, Math.max(22, Math.abs(dx) * 0.08 + Math.abs(dy) * 0.08));
  const c1x = start.x + dx * 0.35;
  const c1y = start.y + (Math.abs(dx) > Math.abs(dy) ? 0 : Math.sign(dy || 1) * curve);
  const c2x = end.x - dx * 0.35;
  const c2y = end.y - (Math.abs(dx) > Math.abs(dy) ? 0 : Math.sign(dy || 1) * curve);
  return `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`;
}

function edgeLabelPosition(edge: GraphEdgeView) {
  const start = anchorPoint(edge.sourceNode, edge.targetNode);
  const end = anchorPoint(edge.targetNode, edge.sourceNode);
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const lift = Math.abs(end.x - start.x) > Math.abs(end.y - start.y) ? -12 : 0;
  return { x: mx, y: my + lift };
}

function edgeStroke(edgeType: GraphEdgeView["type"]) {
  if (edgeType === "can_intro") {
    return "#c94c2d";
  }
  if (edgeType === "supports") {
    return "#177b55";
  }
  if (edgeType === "blocks") {
    return "#a56a12";
  }
  if (edgeType === "approved" || edgeType === "sent") {
    return "#2f7fb6";
  }
  return "#95a5b4";
}

function edgeDash(edgeType: GraphEdgeView["type"]) {
  if (edgeType === "supports") {
    return "8 6";
  }
  if (edgeType === "blocks") {
    return "9 6";
  }
  return "";
}

function labelChipWidth(text: string) {
  return Math.max(58, Math.min(152, text.length * 6.2 + 18));
}

function wrapText(text: string, maxChars: number) {
  const words = text.split(/\s+/u);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 3);
}

export class GraphRenderer {
  private container: HTMLElement;
  private model: DemoGraphModel;
  private options: GraphRenderOptions;
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private focusId: string | null;

  constructor(container: HTMLElement, model: DemoGraphModel, options: GraphRenderOptions) {
    this.container = container;
    this.model = model;
    this.options = options;
    this.focusId = options.initialFocusId ?? null;
    this.container.replaceChildren();
    this.svg = d3.select(this.container).append("svg").attr("class", "graph-svg");
    this.render();
  }

  destroy() {
    this.container.replaceChildren();
  }

  setFocus(nodeId: string | null) {
    this.focusId = nodeId;
    this.render();
  }

  private render() {
    const nodes = this.model.nodes.map((node) => ({ ...node, ...getNodeSize(node) }));
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const activeNodeIds = this.getActiveNodeIds();
    const activeEdgeIds = this.getActiveEdgeIds();
    const edges: GraphEdgeView[] = this.model.edges
      .map((edge) => {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        if (!sourceNode || !targetNode) {
          return null;
        }
        return {
          ...edge,
          sourceNode,
          targetNode,
          active: activeEdgeIds.has(edge.id)
        };
      })
      .filter((edge): edge is GraphEdgeView => Boolean(edge));

    const bounds = this.computeViewBox(nodes);
    this.svg
      .attr("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`)
      .attr("width", "100%")
      .attr("height", "100%");

    this.svg.selectAll("*").remove();
    this.renderDefs();

    const stage = this.svg.append("g").attr("class", "graph-stage");
    this.renderBackdrop(stage, bounds);
    this.renderEdges(stage, edges, activeNodeIds);
    this.renderNodes(stage, nodes, activeNodeIds);
  }

  private renderDefs() {
    const defs = this.svg.append("defs");

    // Grid dot pattern
    const grid = defs
      .append("pattern")
      .attr("id", "graph-grid")
      .attr("width", 24)
      .attr("height", 24)
      .attr("patternUnits", "userSpaceOnUse");

    grid
      .append("circle")
      .attr("cx", 1)
      .attr("cy", 1)
      .attr("r", 1.2)
      .attr("fill", "rgba(13, 23, 34, 0.055)");

    // Drop shadows
    const shadow = defs.append("filter").attr("id", "graph-shadow").attr("x", "-30%").attr("y", "-30%").attr("width", "160%").attr("height", "160%");
    shadow.append("feDropShadow").attr("dx", 0).attr("dy", 8).attr("stdDeviation", 14).attr("flood-color", "rgba(20, 15, 8, 0.18)");

    const softShadow = defs.append("filter").attr("id", "graph-soft-shadow").attr("x", "-25%").attr("y", "-25%").attr("width", "150%").attr("height", "150%");
    softShadow.append("feDropShadow").attr("dx", 0).attr("dy", 4).attr("stdDeviation", 8).attr("flood-color", "rgba(20, 15, 8, 0.1)");

    // Glow filter for focused nodes
    const glow = defs.append("filter").attr("id", "graph-glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glow.append("feGaussianBlur").attr("in", "SourceAlpha").attr("stdDeviation", "5").attr("result", "blur");
    const glowFlood = glow.append("feFlood").attr("flood-color", "rgba(198, 86, 52, 0.35)").attr("result", "color");
    glow.append("feComposite").attr("in", "color").attr("in2", "blur").attr("operator", "in").attr("result", "glow");
    const glowMerge = glow.append("feMerge");
    glowMerge.append("feMergeNode").attr("in", "glow");
    glowMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Radial gradients for person nodes
    const addGradient = (id: string, light: string, dark: string) => {
      const g = defs.append("radialGradient").attr("id", id).attr("cx", "36%").attr("cy", "30%").attr("r", "70%");
      g.append("stop").attr("offset", "0%").attr("stop-color", light);
      g.append("stop").attr("offset", "100%").attr("stop-color", dark);
    };
    addGradient("grad-founder", "#e5664e", "#b94228");
    addGradient("grad-connector", "#9070f6", "#5e38d4");
    addGradient("grad-investor", "#4aa4d8", "#2468a0");
    addGradient("grad-exec", "#2e3f56", "#111e2e");

    // Arrowhead markers for directed edges
    const addArrow = (id: string, color: string, opacity = 0.88) => {
      defs.append("marker")
        .attr("id", id)
        .attr("markerWidth", 7)
        .attr("markerHeight", 7)
        .attr("refX", 5.5)
        .attr("refY", 3.5)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M 0 1 L 6 3.5 L 0 6 Z")
        .attr("fill", color)
        .attr("opacity", opacity);
    };
    addArrow("arrow-intro", "#c94c2d");
    addArrow("arrow-sent", "#2f7fb6");
    addArrow("arrow-approved", "#2f7fb6");
    addArrow("arrow-default", "#8a9aaa", 0.55);
  }

  private renderBackdrop(stage: d3.Selection<SVGGElement, unknown, null, undefined>, bounds: { x: number; y: number; width: number; height: number }) {
    stage
      .append("rect")
      .attr("x", bounds.x)
      .attr("y", bounds.y)
      .attr("width", bounds.width)
      .attr("height", bounds.height)
      .attr("fill", "url(#graph-grid)")
      .attr("opacity", 0.6);
  }

  private renderEdges(
    stage: d3.Selection<SVGGElement, unknown, null, undefined>,
    edges: GraphEdgeView[],
    activeNodeIds: Set<string>
  ) {
    const edgeGroup = stage.append("g").attr("class", "edges");

    for (const edge of edges) {
      const isVisible = this.options.mode === "overview" ? true : edge.active;
      const stroke = edgeStroke(edge.type);
      const isIntro = edge.type === "can_intro";
      const isSentOrApproved = edge.type === "sent" || edge.type === "approved";
      const activeWidth = isIntro ? 3.6 : 2.6;
      const inactiveWidth = isIntro ? 2.2 : 1.6;

      const path = edgeGroup
        .append("path")
        .attr("d", edgePath(edge))
        .attr("fill", "none")
        .attr("stroke", stroke)
        .attr("stroke-width", edge.active ? activeWidth : inactiveWidth)
        .attr("stroke-dasharray", edgeDash(edge.type))
        .attr("stroke-linecap", "round")
        .attr("opacity", this.options.mode === "overview" ? 0.52 : isVisible ? 0.88 : 0.08);

      if (edge.type === "supports" || edge.type === "blocks") {
        path.attr("stroke-linejoin", "round");
      }

      // Arrowheads on directed edge types
      if (isIntro) {
        path.attr("marker-end", "url(#arrow-intro)");
      } else if (isSentOrApproved) {
        path.attr("marker-end", "url(#arrow-approved)");
      }

      const showLabel = this.options.mode === "reasoning" ? edge.active : false;
      if (!showLabel) {
        continue;
      }

      const pos = edgeLabelPosition(edge);
      const chipWidth = labelChipWidth(edge.label);
      const chip = edgeGroup
        .append("g")
        .attr("transform", `translate(${pos.x}, ${pos.y})`)
        .attr("opacity", edge.active ? 1 : 0);

      chip
        .append("rect")
        .attr("x", -chipWidth / 2)
        .attr("y", -12)
        .attr("width", chipWidth)
        .attr("height", 24)
        .attr("rx", 12)
        .attr("fill", "rgba(255, 248, 239, 0.94)")
        .attr("stroke", "rgba(13, 23, 34, 0.06)")
        .attr("filter", "url(#graph-soft-shadow)");

      chip
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#526273")
        .attr("font-size", 10)
        .attr("font-weight", 600)
        .text(edge.label);
    }
  }

  private renderNodes(
    stage: d3.Selection<SVGGElement, unknown, null, undefined>,
    nodes: GraphNodeWithSize[],
    activeNodeIds: Set<string>
  ) {
    const nodeGroup = stage.append("g").attr("class", "nodes");

    for (const node of nodes) {
      const style = TYPE_STYLES[node.type];
      const isFocused = this.focusId === node.id;
      const isActive = this.options.mode === "overview" ? true : activeNodeIds.has(node.id);
      const group = nodeGroup
        .append("g")
        .attr("transform", `translate(${node.x}, ${node.y})`)
        .attr("opacity", isActive ? 1 : 0.14)
        .style("cursor", "pointer")
        .on("click", () => {
          this.focusId = node.id;
          this.options.onNodeSelect?.(node.id);
          if (this.options.mode !== "overview") {
            this.render();
          }
        });

      if (isFocused) {
        if (node.type === "founder" || node.type === "connector" || node.type === "investor") {
          // Outer pulse ring
          group
            .append("circle")
            .attr("r", 34)
            .attr("fill", "none")
            .attr("stroke", style.color)
            .attr("stroke-width", 1.5)
            .attr("opacity", 0.22);
          group
            .append("circle")
            .attr("r", 28)
            .attr("fill", style.soft)
            .attr("opacity", 1);
        } else {
          group
            .append("rect")
            .attr("x", -node.width / 2 - 10)
            .attr("y", -node.height / 2 - 10)
            .attr("width", node.width + 20)
            .attr("height", node.height + 20)
            .attr("rx", 20)
            .attr("fill", style.soft)
            .attr("opacity", 0.9);
        }
      }

      if (node.type === "founder" || node.type === "connector" || node.type === "investor") {
        this.renderPersonNode(group, node, style, isFocused);
      } else {
        this.renderCardNode(group, node, style, isFocused);
      }
    }
  }

  private renderPersonNode(
    group: d3.Selection<SVGGElement, unknown, null, undefined>,
    node: GraphNodeWithSize,
    style: typeof TYPE_STYLES[keyof typeof TYPE_STYLES],
    isFocused: boolean
  ) {
    const radius = node.type === "founder" ? 20 : 17;
    const gradId = node.type === "founder" ? "grad-founder" : node.type === "connector" ? "grad-connector" : "grad-investor";

    // Outer halo
    group
      .append("circle")
      .attr("r", radius + 7)
      .attr("fill", style.soft)
      .attr("opacity", isFocused ? 1 : 0.75);

    // Inner gradient circle
    group
      .append("circle")
      .attr("r", radius)
      .attr("fill", `url(#${gradId})`)
      .attr("stroke", isFocused ? "rgba(255,255,255,0.92)" : "rgba(255,251,242,0.82)")
      .attr("stroke-width", isFocused ? 3.5 : 2.5)
      .attr("filter", isFocused ? "url(#graph-glow)" : "url(#graph-soft-shadow)");

    // Subtle inner shine
    group
      .append("circle")
      .attr("r", radius * 0.55)
      .attr("cx", -radius * 0.18)
      .attr("cy", -radius * 0.22)
      .attr("fill", "rgba(255,255,255,0.18)")
      .attr("pointer-events", "none");

    const labelY = radius + 20;
    const labelLines = wrapText(node.label, 18);
    const chipWidth = Math.max(100, Math.min(158, labelLines.reduce((max, line) => Math.max(max, line.length * 6.4), 0) + 28));
    const chipHeight = 20 + labelLines.length * 15;
    const labelGroup = group.append("g").attr("transform", `translate(0, ${labelY})`);

    labelGroup
      .append("rect")
      .attr("x", -chipWidth / 2)
      .attr("y", -11)
      .attr("width", chipWidth)
      .attr("height", chipHeight)
      .attr("rx", 16)
      .attr("fill", "rgba(255, 252, 245, 0.96)")
      .attr("stroke", isFocused ? style.stroke : "rgba(13, 23, 34, 0.08)")
      .attr("stroke-width", isFocused ? 1.5 : 1)
      .attr("filter", "url(#graph-soft-shadow)");

    labelLines.forEach((line, index) => {
      labelGroup
        .append("text")
        .attr("x", 0)
        .attr("y", 6 + index * 15)
        .attr("text-anchor", "middle")
        .attr("fill", node.type === "investor" ? "#1e3d58" : "#1e3040")
        .attr("font-size", 11.5)
        .attr("font-weight", 700)
        .attr("letter-spacing", "-0.01em")
        .text(line);
    });
  }

  private renderCardNode(
    group: d3.Selection<SVGGElement, unknown, null, undefined>,
    node: GraphNodeWithSize,
    style: typeof TYPE_STYLES[keyof typeof TYPE_STYLES],
    isFocused: boolean
  ) {
    const isExec = node.type === "execution_state";
    const rx = isExec ? 20 : 14;

    // Card background
    group
      .append("rect")
      .attr("x", -node.width / 2)
      .attr("y", -node.height / 2)
      .attr("width", node.width)
      .attr("height", node.height)
      .attr("rx", rx)
      .attr("fill", isExec ? `url(#grad-exec)` : "rgba(255, 252, 245, 0.97)")
      .attr("stroke", isFocused ? style.color : isExec ? "rgba(255,255,255,0.12)" : style.stroke)
      .attr("stroke-width", isFocused ? 2 : isExec ? 1 : 1.2)
      .attr("filter", "url(#graph-soft-shadow)");

    // Top shine strip on exec nodes
    if (isExec) {
      group
        .append("rect")
        .attr("x", -node.width / 2 + 1)
        .attr("y", -node.height / 2 + 1)
        .attr("width", node.width - 2)
        .attr("height", node.height / 2)
        .attr("rx", rx)
        .attr("fill", "rgba(255,255,255,0.07)")
        .attr("pointer-events", "none");
    }

    // Colored left accent bar for non-exec nodes
    if (!isExec) {
      group
        .append("rect")
        .attr("x", -node.width / 2 + 9)
        .attr("y", -node.height / 2 + 9)
        .attr("width", 5)
        .attr("height", node.height - 18)
        .attr("rx", 3)
        .attr("fill", style.color)
        .attr("opacity", 0.82);
    }

    const textLines = wrapText(node.label, node.type === "organization" ? 18 : 20);
    textLines.forEach((line, index) => {
      group
        .append("text")
        .attr("x", isExec ? 0 : -node.width / 2 + 24)
        .attr("y", -(textLines.length - 1) * 7.5 + index * 15 + 4)
        .attr("text-anchor", isExec ? "middle" : "start")
        .attr("fill", isExec ? "#f0ece4" : style.text)
        .attr("font-size", isExec ? 11.5 : 11)
        .attr("font-weight", 700)
        .attr("letter-spacing", "-0.01em")
        .text(line);
    });
  }

  private computeViewBox(nodes: GraphNodeWithSize[]) {
    const left = Math.min(...nodes.map((node) => node.x - node.width / 2)) - 72;
    const right = Math.max(...nodes.map((node) => node.x + node.width / 2)) + 72;
    const top = Math.min(...nodes.map((node) => node.y - node.height / 2)) - 72;
    const bottom = Math.max(...nodes.map((node) => node.y + node.height / 2)) + 88;

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  private getActiveNodeIds() {
    if (!this.focusId || this.options.mode === "overview") {
      return new Set(this.model.nodes.map((node) => node.id));
    }

    const active = new Set<string>([this.focusId]);
    for (const edge of this.model.edges) {
      if (edge.source === this.focusId || edge.target === this.focusId) {
        active.add(edge.source);
        active.add(edge.target);
      }
    }
    return active;
  }

  private getActiveEdgeIds() {
    if (!this.focusId || this.options.mode === "overview") {
      return new Set(this.model.edges.map((edge) => edge.id));
    }

    const active = new Set<string>();
    for (const edge of this.model.edges) {
      if (edge.source === this.focusId || edge.target === this.focusId) {
        active.add(edge.id);
      }
    }
    return active;
  }
}
