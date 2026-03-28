# Tigerclaw: Intelligent Outreach At Scale

Standalone Chrome extension testbed for:

- LinkedIn session detection in the current Chrome profile
- self/profile/company/post-analytics page scraping
- bulk post analytics sync for your recent activity items
- full first-degree connection sync
- JSON/CSV export from the popup
- Convex-backed snapshot upload for remote storage

Standalone founder-facing app surface for:

- ranked warm investor-intro paths
- graph replay of saved network, reasoning, and execution
- draft + approval state before Mission Control handoff

## Setup

```bash
npm install
npm run build
```

Open the standalone app UI from:

```text
dist/app.html
```

Load the unpacked extension from:

```text
dist/
```

## Workflow

1. Log into LinkedIn in the same Chrome profile.
2. Open the extension popup.
3. Run `Connect LinkedIn`.
4. Run `Read My Profile`.
5. Run `Scrape My Activity` to capture your recent posts/activity.
6. Run `Sync Post Analytics` to enrich those posts with per-post analytics.
7. Open a LinkedIn profile, company, or post analytics page and run `Scrape Current Page` when you want a one-off page scrape.
8. Run `Sync 1st-Degree Connections`.
9. Export JSON or CSV from the popup if you want a local file.
10. Push the current snapshot to Convex when you want a remote copy.

## Convex Setup

This repo now includes a dedicated Convex backend under [`convex/`](./convex).

1. Create or choose a Convex deployment.
2. Run:

```bash
npm run convex:dev
```

3. Let Convex generate `convex/_generated`.
4. Copy your deployment URL from Convex, for example `https://your-deployment.convex.cloud`.
5. Optional but recommended: create `.env.extension.local` from `.env.extension.local.example` and set:
   - `TIGERCLAW_CONVEX_URL`
   - `TIGERCLAW_CONVEX_WORKSPACE_KEY`
   - `TIGERCLAW_CONVEX_SYNC_TOKEN`
   - `TIGERCLAW_CONVEX_LABEL`
6. Run `npm run build` again after editing `.env.extension.local`.
7. Reload the extension. The popup will now prefill and use the bundled Convex defaults automatically.
8. Click `Push Snapshot to Convex`.

If you skip `.env.extension.local`, the build still bundles defaults from `.env.local` plus fallback values for workspace key and sync token, but those defaults are visible inside the extension bundle and should be treated as development-only.

The extension pushes to Convex through the public HTTP Functions API using these functions:

- `linkedinSync:upsertInstallation`
- `linkedinSync:startSyncUpload`
- `linkedinSync:uploadConnectionBatch`
- `linkedinSync:completeSyncUpload`

## Notes

- Raw session material is kept in extension local storage and not shown in the popup.
- The popup JSON inspector defaults to normalized output and can switch to raw payloads.
- This is a prototype against private LinkedIn web endpoints, not a production-safe integration.
- Convex uploads are chunked in batches of 100 connections so large networks can be stored remotely.
