import test from "node:test";
import assert from "node:assert/strict";
import { consolidateScenarioBundles, scoreConnection, selectFocusedConnections } from "../src/lib/mirofishPilot";
import type { ScenarioBundle, WorkspaceConnectionRecord } from "../src/sim/types";

function connection(
  partial: Omit<Partial<WorkspaceConnectionRecord>, "fullName"> & { fullName: string }
): WorkspaceConnectionRecord {
  return {
    personKey: partial.personKey ?? partial.fullName.toLowerCase().replace(/\s+/gu, "-"),
    fullName: partial.fullName,
    publicIdentifier: partial.publicIdentifier ?? partial.fullName.toLowerCase().replace(/\s+/gu, "-"),
    profileUrl: partial.profileUrl ?? null,
    entityUrn: partial.entityUrn ?? null,
    headline: partial.headline ?? null,
    companyName: partial.companyName ?? null,
    connectedAt: partial.connectedAt ?? null,
    raw: partial.raw ?? {}
  };
}

test("scoreConnection prioritizes partnership and founder signals", () => {
  const ecosystemCandidate = scoreConnection(
    connection({
      fullName: "Alice Partner",
      headline: "Strategic Partnerships Lead at OpenAI",
      companyName: "OpenAI",
      connectedAt: "2026-03-01T00:00:00.000Z"
    })
  );
  const founderCandidate = scoreConnection(
    connection({
      fullName: "Bob Founder",
      headline: "Founder and CEO, AI Infra startup",
      companyName: "InfraCo",
      connectedAt: "2025-12-01T00:00:00.000Z"
    })
  );

  assert.equal(ecosystemCandidate.bucket, "ecosystem");
  assert.equal(founderCandidate.bucket, "founder_operator");
  assert.ok(ecosystemCandidate.matchedKeywords.includes("partnerships"));
  assert.ok(founderCandidate.matchedKeywords.includes("founder"));
  assert.ok(ecosystemCandidate.scoreBreakdown.roleFit > 0);
  assert.ok(ecosystemCandidate.whyThisPerson.length > 0);
  assert.ok(ecosystemCandidate.whyNow.length > 0);
  assert.ok(ecosystemCandidate.suggestedAsk.length > 0);
});

test("selectFocusedConnections preserves bucket diversity", () => {
  const records: WorkspaceConnectionRecord[] = [
    connection({ fullName: "Ecosystem One", headline: "Partnerships Director", companyName: "A" }),
    connection({ fullName: "Ecosystem Two", headline: "Ecosystem Lead", companyName: "B" }),
    connection({ fullName: "Founder One", headline: "Founder and CEO", companyName: "C" }),
    connection({ fullName: "Founder Two", headline: "Co-Founder", companyName: "D" }),
    connection({ fullName: "Amplifier One", headline: "Podcast Host", companyName: "E" }),
    connection({ fullName: "Amplifier Two", headline: "Conference Speaker", companyName: "F" }),
    connection({ fullName: "Bridge One", headline: "Investor and Advisor", companyName: "G" }),
    connection({ fullName: "Bridge Two", headline: "Venture Principal", companyName: "H" })
  ];

  const selected = selectFocusedConnections(records, 8);
  const buckets = new Set(selected.map((entry) => entry.bucket));

  assert.equal(selected.length, 8);
  assert.ok(buckets.has("ecosystem"));
  assert.ok(buckets.has("founder_operator"));
  assert.ok(buckets.has("amplifier"));
  assert.ok(buckets.has("bridge"));
});

test("consolidateScenarioBundles dedupes overlapping people and keeps the strongest ask", () => {
  const selected = [
    scoreConnection(connection({ fullName: "Alice Partner", headline: "Partnerships Lead", companyName: "OpenAI" })),
    scoreConnection(connection({ fullName: "Bob Founder", headline: "Founder", companyName: "InfraCo" })),
    scoreConnection(connection({ fullName: "Cara Amplifier", headline: "Podcast Host", companyName: "MediaCo" }))
  ];

  const bundleA: ScenarioBundle = {
    scenarioId: "direct_reply",
    scenarioGoal: "Direct reply",
    topCandidates: [
      {
        personKey: selected[0].personKey,
        fullName: selected[0].fullName ?? "Unknown",
        company: selected[0].companyName,
        headline: selected[0].headline,
        baseScore: selected[0].score,
        confidence: selected[0].confidence,
        whyThisPerson: "Fast reply likelihood.",
        whyNow: "Warm connection.",
        suggestedAsk: "Ask for a 15 minute intro call.",
        supportingProof: ["Recent traction"],
        risk: "Low",
        priority: "high"
      }
    ],
    sequence: [],
    stopConditions: [],
    followOnTargets: []
  };

  const bundleB: ScenarioBundle = {
    scenarioId: "ecosystem_leverage",
    scenarioGoal: "Leverage",
    topCandidates: [
      {
        personKey: selected[0].personKey,
        fullName: selected[0].fullName ?? "Unknown",
        company: selected[0].companyName,
        headline: selected[0].headline,
        baseScore: selected[0].score,
        confidence: selected[0].confidence,
        whyThisPerson: "Platform adjacency.",
        whyNow: "Strong ecosystem fit.",
        suggestedAsk: "Ask for a partner-path introduction.",
        supportingProof: ["Speaking proof"],
        risk: "Medium",
        priority: "high"
      },
      {
        personKey: selected[1].personKey,
        fullName: selected[1].fullName ?? "Unknown",
        company: selected[1].companyName,
        headline: selected[1].headline,
        baseScore: selected[1].score,
        confidence: selected[1].confidence,
        whyThisPerson: "Founder credibility.",
        whyNow: "Aligned operator context.",
        suggestedAsk: "Ask for one relevant founder intro.",
        supportingProof: ["Builder signal"],
        risk: "Low",
        priority: "medium"
      }
    ],
    sequence: [],
    stopConditions: [],
    followOnTargets: []
  };

  const consolidated = consolidateScenarioBundles([bundleA, bundleB], selected);

  assert.equal(consolidated.recommendedScenarioId, "ecosystem_leverage");
  assert.equal(consolidated.rankedActions[0]?.personKey, selected[0].personKey);
  assert.equal(consolidated.rankedActions[0]?.scenarioCount, 2);
  assert.equal(consolidated.rankedActions[0]?.whyThisPerson, "Platform adjacency.");
  assert.equal(consolidated.rankedActions[0]?.suggestedAsk, "Ask for a partner-path introduction.");
});
