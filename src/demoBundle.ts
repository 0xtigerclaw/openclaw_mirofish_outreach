import metadata from "./demo-bundle/metadata.json";
import selectedTarget from "./demo-bundle/selectedTarget.json";
import stage1Network from "./demo-bundle/stage1-network.json";
import stage2Reasoning from "./demo-bundle/stage2-reasoning.json";
import stage3FriendFirst from "./demo-bundle/stage3-friend-first.json";
import stage4Decision from "./demo-bundle/stage4-decision.json";
import stage3Execution from "./demo-bundle/stage3-execution.json";
import type { DemoGraphStage, DemoMetadata, DemoTarget } from "./demoTypes";

export const DEMO_METADATA = metadata as DemoMetadata;
export const DEMO_TARGET = selectedTarget as DemoTarget;
export const DEMO_FOUNDER = DEMO_TARGET.founder;
export const DEMO_STAGES = [
  stage1Network as DemoGraphStage,
  stage2Reasoning as DemoGraphStage,
  stage3FriendFirst as DemoGraphStage,
  stage4Decision as DemoGraphStage,
  stage3Execution as DemoGraphStage
] as const;
