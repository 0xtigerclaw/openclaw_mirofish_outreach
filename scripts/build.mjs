import { mkdir, rm, copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, "dist");

function parseEnvContents(contents) {
  const result = {};
  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed
      .slice(equalsIndex + 1)
      .split(/\s+#/u)[0]
      .trim()
      .replace(/^['"]|['"]$/gu, "");
    result[key] = value;
  }
  return result;
}

async function loadLocalEnv(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");
    return parseEnvContents(contents);
  } catch {
    return {};
  }
}

const convexEnv = await loadLocalEnv(path.join(rootDir, ".env.local"));
const extensionEnv = await loadLocalEnv(path.join(rootDir, ".env.extension.local"));

const bundledDefaults = {
  __DEFAULT_CONVEX_URL__: JSON.stringify(
    extensionEnv.TIGERCLAW_CONVEX_URL ?? convexEnv.CONVEX_URL ?? ""
  ),
  __DEFAULT_CONVEX_WORKSPACE_KEY__: JSON.stringify(
    extensionEnv.TIGERCLAW_CONVEX_WORKSPACE_KEY ?? "tigerclaw-main"
  ),
  __DEFAULT_CONVEX_SYNC_TOKEN__: JSON.stringify(
    extensionEnv.TIGERCLAW_CONVEX_SYNC_TOKEN ?? "tigerclaw-local-sync-token"
  ),
  __DEFAULT_CONVEX_LABEL__: JSON.stringify(
    extensionEnv.TIGERCLAW_CONVEX_LABEL ?? "Local Chrome profile"
  )
};

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await esbuild.build({
  entryPoints: {
    background: path.join(rootDir, "src/background.ts"),
    content: path.join(rootDir, "src/content.ts"),
    popup: path.join(rootDir, "src/popup.ts")
  },
  outdir: distDir,
  bundle: true,
  platform: "browser",
  target: "chrome120",
  format: "iife",
  sourcemap: true,
  define: bundledDefaults
});

await copyFile(path.join(rootDir, "manifest.json"), path.join(distDir, "manifest.json"));
await copyFile(path.join(rootDir, "src/popup.html"), path.join(distDir, "popup.html"));

console.log(`Built extension to ${distDir}`);
