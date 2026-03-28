# MiroFish Pilot Runbook

## What It Does

The pilot reads a LinkedIn workspace snapshot from Convex, selects a focused first-degree set, generates a four-document seed pack, runs one or more GTM scenarios through local MiroFish, and writes normalized ranked action bundles for downstream agents.

## Entry Point

```bash
npm run pilot:mirofish -- \
  --deployment-url=https://your-deployment.convex.cloud \
  --workspace-key=your-workspace \
  --sync-token=your-sync-token
```

Optional flags:

```bash
--scenarios=direct_reply,ecosystem_leverage,amplifier_route,bridge_then_expand
--selection-limit=120
--max-rounds=24
--output-dir=pilot-runs
--mirofish-root=/Users/swayam/developer/mirofish
--mirofish-url=http://localhost:5001
--no-autostart
```

## Output

Each run writes to `pilot-runs/<timestamp-workspace>/`:

- `seed/`
- `scenarios/<scenario-id>/raw.json`
- `scenarios/<scenario-id>/normalized.json`
- `scenarios/<scenario-id>/normalized.md`
- `consolidated.json`
- `consolidated.md`

## Required Runtime Conditions

1. Local MiroFish backend must be reachable on `http://localhost:5001` or be startable from the configured repo path.
2. The Convex deployment must already expose these public functions:
   - `linkedinSync:getLatestWorkspaceSnapshot`
   - `linkedinSync:getWorkspacePosts`
   - `linkedinSync:getWorkspaceFollowers`
   - `linkedinSync:getWorkspaceConnections`
3. `linkedinSync:getWorkspaceConnections` must be deployed to the remote workspace before the pilot can read the latest successful connection-bearing run.

## Current Local Status

The Tigerclaw code now includes the required flattened connections query and the pilot runner. If the remote deployment has not been updated yet, the CLI will fail with:

```text
Could not find public function for 'linkedinSync:getWorkspaceConnections'
```

The fix is to deploy the updated Convex functions to the same deployment URL used by the extension.
