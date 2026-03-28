# MiroFish -> Tigerclaw Adaptation Blueprint

## 1) What MiroFish Actually Is

MiroFish is a workflow wrapper around OASIS, not a generic GTM engine by itself.

Pipeline:
1. Upload source docs and simulation requirement.
2. LLM generates ontology (hardcoded for social-opinion simulation).
3. Zep graph is built from chunked episodes.
4. Entities are filtered from graph nodes/edges.
5. OASIS profiles are generated (Twitter/Reddit formats).
6. LLM generates simulation config (time windows, activity levels, platform params).
7. Runner scripts execute Twitter/Reddit simulations with `LLMAction()` per active agent per round.
8. Actions are streamed to `actions.jsonl`.
9. Optional graph memory updater writes simulated activities back into Zep.
10. Report agent runs tool-driven analysis + interviews over post-simulation state.

## 2) Reusable vs Non-Reusable Parts

### Reusable architecture
- State machine for simulation lifecycle (`created -> preparing -> ready -> running -> completed/failed`).
- Async task + progress reporting model.
- IPC command channel (`interview`, `batch_interview`, `close_env`).
- Action-log monitoring and real-time status aggregation.
- Report agent tooling pattern (`tool registry`, iterative call/observe/final-answer loop).

### Strongly coupled to social-media simulation
- Ontology prompt enforces social-media actors and excludes abstract entities.
- Profile schema is platform-centric (`karma`, `friend_count`, `statuses_count`).
- Config schema is social-feed-centric (`posts_per_hour`, `comments_per_hour`, feed weights).
- Runner actions are Twitter/Reddit specific.
- UI step flow and naming are tied to “public opinion simulation.”

## 3) Mapping to Tigerclaw Requirements

Tigerclaw today is a LinkedIn data collection + Convex storage system (connections, followers, posts, analytics).  
Target is a partner-influence GTM rehearsal engine.

Adaptation mapping:
- MiroFish `seed documents` -> Tigerclaw `Convex workspace snapshot` (connections + followers + activity + post analytics + notes).
- MiroFish `ontology` -> GTM ontology (`Buyer`, `Champion`, `Partner`, `Influencer`, `Competitor`, `Account`, `ProofAsset`, `Risk`, `IntroPath`).
- MiroFish `Twitter/Reddit profile` -> GTM persona profile (role, incentives, trust propensity, objection profile, partner affinity, channel preference).
- MiroFish `social actions` -> GTM actions (`request_intro`, `forward_proof_asset`, `book_joint_call`, `raise_risk_flag`, `counter_message`, `ignore`, `escalate`).
- MiroFish `feed outcomes` -> GTM outcomes (intro acceptance rate, meeting creation, partner referral cascades, objection propagation, trust delta, time-to-next-step).
- MiroFish `report` -> GTM playbook recommendation (who first, through whom, with which proof, in what sequence).

## 4) Recommended Implementation Path (Pragmatic)

### Phase A: Data + ontology layer (no OASIS changes yet)
- Build `world builder` over Convex snapshot.
- Emit deterministic GTM graph for one workspace+run.
- Add validation checks for missing IDs, duplicate nodes, and stale signals.

### Phase B: Custom simulation action space
- Implement OASIS custom platform with GTM action set.
- Keep existing runner/IPC patterns, replace platform scripts and action decoding.
- Preserve action log semantics to maintain observability.

### Phase C: Persona + config generation
- Replace social persona generator with role-conditioned GTM persona generator.
- Replace time/feed config with campaign config (`horizon`, `cadence`, `channel mix`, `touch limits`, `proof strategy`).

### Phase D: Decision/report layer
- Keep tool-driven report loop, swap tool semantics to GTM retrieval/interviews.
- Add deterministic scoring over simulation outputs (not LLM-only summaries).

## 5) First Build Slice (What to build next in Tigerclaw)

1. Add `convex/gtmWorld.ts` that converts latest workspace snapshot into typed GTM world JSON.
2. Add `src/sim/types.ts` for GTM entity/action/outcome types.
3. Add a minimal simulator (deterministic first) that runs action sequences over the world graph.
4. Persist each run result in Convex (`gtmSimulationRuns`, `gtmSimulationActions`, `gtmSimulationOutcomes`).
5. Add one query endpoint that returns ranked “next best intro paths” with rationale fields.

This gives a useful system before adding full OASIS integration.

## 6) Key Risk To Decide Early

MiroFish is AGPL-3.0. If you directly reuse/copy substantial implementation, network-served derivatives can trigger AGPL obligations.  
Safe path for commercial control: adapt architecture patterns and reimplement core modules in Tigerclaw from scratch.
