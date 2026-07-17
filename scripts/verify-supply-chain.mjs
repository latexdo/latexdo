import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const [
  cli,
  websiteCli,
  installer,
  websiteInstaller,
  publicKey,
  cliPackage,
  electronMain,
  ciWorkflow,
  releaseWorkflow,
  websiteWorkflow,
  editorWorkflow,
  cliWorkflow,
  docsWorkflow,
  storeWorkflow,
  renewalWorkflow,
  renewalScript,
  downloadsBuilder,
] = await Promise.all([
  readFile("cli/bin/latexdo", "utf8"),
  readFile("website/bin/latexdo", "utf8"),
  readFile("cli/install.sh", "utf8"),
  readFile("website/install.sh", "utf8"),
  readFile("build/update-public-key.pem", "utf8"),
  readFile("cli/package.json", "utf8").then(JSON.parse),
  readFile("electron/main.ts", "utf8"),
  readFile(".github/workflows/ci.yml", "utf8"),
  readFile(".github/workflows/release.yml", "utf8"),
  readFile(".github/workflows/deploy-website.yml", "utf8"),
  readFile(".github/workflows/deploy-editor.yml", "utf8"),
  readFile(".github/workflows/deploy-cli.yml", "utf8"),
  readFile(".github/workflows/deploy-docs.yml", "utf8"),
  readFile(".github/workflows/deploy-store.yml", "utf8"),
  readFile(".github/workflows/renew-update-feed.yml", "utf8"),
  readFile("scripts/renew-update-feed.mjs", "utf8"),
  readFile("scripts/build-downloads-page.mjs", "utf8"),
]);

if (cli !== websiteCli) throw new Error("website/bin/latexdo is out of sync.");
if (installer !== websiteInstaller)
  throw new Error("website/install.sh is out of sync.");
if (!cli.includes(publicKey.trim())) {
  throw new Error("CLI update key does not match build/update-public-key.pem.");
}
if (cliPackage.engines?.node !== ">=22.17.0") {
  throw new Error("CLI Node.js minimum must remain pinned to >=22.17.0.");
}
for (const requiredProtection of [
  "feed freshness window is invalid or expired",
  "feed version ${payload.version} is older than previously trusted",
  "isReleaseSlugForVersion(payload.release, payload.version)",
  "isBuildReleaseSlugForVersion(payload.release, payload.version)",
  "trusted_cached_checkout",
  "state.highestCommit",
  'cached_commit="$(git -C "$APP_DIR" rev-parse HEAD',
]) {
  if (!cli.includes(requiredProtection)) {
    throw new Error(`CLI update protection is missing: ${requiredProtection}`);
  }
}
for (const requiredProtection of [
  'const updateFeedStateFile = "update-feed-state.json"',
  "Website update feed freshness window is invalid or expired.",
  "older than previously trusted version",
  "isReleaseSlugForVersion(release, version)",
  "isBuildReleaseSlugForVersion(release, version)",
]) {
  if (!electronMain.includes(requiredProtection)) {
    throw new Error(`Desktop update protection is missing: ${requiredProtection}`);
  }
}
if (
  releaseWorkflow.includes("wrangler@latest") ||
  websiteWorkflow.includes("wrangler@latest") ||
  editorWorkflow.includes("wrangler@latest") ||
  cliWorkflow.includes("wrangler@latest") ||
  docsWorkflow.includes("wrangler@latest") ||
  storeWorkflow.includes("wrangler@latest") ||
  renewalWorkflow.includes("wrangler@latest")
) {
  throw new Error("Deployment workflows must not resolve Wrangler dynamically.");
}
for (const requiredCiDispatchControl of [
  "repository: latexdo/cli.latexdo.org",
  "repository: latexdo/editor.latexdo.org",
  "repository: latexdo/store.latexdo.org",
  "workflow: validate-pr.yml",
  "DISPATCH_TOKEN: ${{ secrets.LATEXDO_WEBSITE_TOKEN }}",
  "LATEXDO_WEBSITE_TOKEN is required to trigger downstream CI.",
  "/actions/workflows/${TARGET_WORKFLOW}/dispatches",
]) {
  if (!ciWorkflow.includes(requiredCiDispatchControl)) {
    throw new Error(
      `Downstream CI dispatch control is missing: ${requiredCiDispatchControl}`,
    );
  }
}
if (ciWorkflow.includes("LATEXDO_CI_DISPATCH_TOKEN")) {
  throw new Error("Downstream CI dispatch must use LATEXDO_WEBSITE_TOKEN.");
}
for (const requiredReleaseControl of [
  "workflow_run:",
  'workflows: ["latexdo-ci"]',
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.head_branch == 'main'",
  "LATEXDO_RELEASE_TARGET_SHA",
  "LATEXDO_RELEASE_COMMIT: ${{ needs.release_gate.outputs.target_sha }}",
  "Publishing an unsigned macOS build.",
  "Publishing an unsigned Windows build.",
  "CSC_IDENTITY_AUTO_DISCOVERY=false",
  "steps.macos_signing.outputs.signed == 'true'",
  "steps.windows_signing.outputs.signed == 'true'",
  "Signed update feed disabled; LATEXDO_UPDATE_SIGNING_KEY is not configured.",
  "LATEXDO_UPDATE_FEED_ENABLED: ${{ steps.publication_credentials.outputs.update_feed_enabled }}",
  "rm -f public-downloads/downloads/index.html",
  "if [ -d public-downloads/updates ]; then",
  "No signed update feed generated; leaving latexdo.org updates/ unchanged.",
  "node scripts/build-downloads-release-index.mjs latexdo-org-site/downloads --json-only",
  "git -C latexdo-org-site add -- downloads",
  "Release publication must stage only downloads/ and updates/",
]) {
  if (!releaseWorkflow.includes(requiredReleaseControl)) {
    throw new Error(
      `Release publication control is missing: ${requiredReleaseControl}`,
    );
  }
}
for (const forbiddenReleaseControl of [
  "CLOUDFLARE_API_TOKEN",
  "cp cli/bin/latexdo latexdo-org-site/bin/latexdo",
  "cp cli/install.sh latexdo-org-site/install.sh",
  "git -C latexdo-org-site add downloads updates bin/latexdo install.sh",
  "git -C latexdo-org-site add -A",
  "Refusing to publish an unsigned macOS build",
  "Refusing to publish an unsigned Windows build",
  "Refusing a partial release. Missing",
  "Deploy downloads to Cloudflare",
  "Verify deployed downloads",
]) {
  if (releaseWorkflow.includes(forbiddenReleaseControl)) {
    throw new Error(
      `Release publication must update only latexdo.org downloads: ${forbiddenReleaseControl}`,
    );
  }
}
for (const requiredWebsiteControl of [
  "workflow_run:",
  'workflows: ["latexdo-release"]',
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.head_branch == 'main'",
  "Missing LATEXDO_WEBSITE_TOKEN; cannot update latexdo.org downloads.",
  "This workflow stages only downloads/releases.json.",
  "node scripts/build-downloads-release-index.mjs latexdo-org-site/downloads --json-only",
  "git -C latexdo-org-site add -- downloads/releases.json",
  "Downloads index refresh must stage only downloads/releases.json.",
  "Cloudflare deployment is handled by the latexdo.org Git integration.",
  "Cloudflare Workers Builds can deploy the pushed downloads index commit.",
]) {
  if (!websiteWorkflow.includes(requiredWebsiteControl)) {
    throw new Error(`Website deployment control is missing: ${requiredWebsiteControl}`);
  }
}
for (const forbiddenWebsiteControl of [
  "rsync -a website/",
  "git -C latexdo-org-site add -A",
  "npm ci --prefix website",
  "npm run build --prefix website",
  "CLOUDFLARE_API_TOKEN",
  "deploy_mode",
  "cloudflare_enabled",
  "Deploy website to Cloudflare",
  "npm run deploy",
]) {
  if (websiteWorkflow.includes(forbiddenWebsiteControl)) {
    throw new Error(
      `Website workflow must only push the GitHub repo: ${forbiddenWebsiteControl}`,
    );
  }
}
for (const requiredEditorControl of [
  "workflow_run:",
  'workflows: ["latexdo-ci"]',
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.head_branch == 'main'",
  "repository: latexdo/editor.latexdo.org",
  "LATEXDO_WEBSITE_TOKEN",
  "git -C editor-site add -- dist",
  "Editor publication must stage only dist/.",
]) {
  if (!editorWorkflow.includes(requiredEditorControl)) {
    throw new Error(`Editor deployment control is missing: ${requiredEditorControl}`);
  }
}
for (const requiredCliControl of [
  "workflow_run:",
  'workflows: ["latexdo-ci"]',
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.head_branch == 'main'",
  "repository: latexdo/cli.latexdo.org",
  "LATEXDO_WEBSITE_TOKEN",
  "git -C cli-site add -- README.md package.json install.sh bin/latexdo LICENSE",
  "CLI publication must stage only CLI package files.",
  "cp LICENSE cli-site/LICENSE",
]) {
  if (!cliWorkflow.includes(requiredCliControl)) {
    throw new Error(`CLI deployment control is missing: ${requiredCliControl}`);
  }
}
for (const requiredDocsControl of [
  "workflow_run:",
  'workflows: ["latexdo-ci"]',
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.head_branch == 'main'",
  "repository: latexdo/docs.latexdo.org",
  "LATEXDO_WEBSITE_TOKEN",
  "git -C docs-site add -- assets/icon.svg site.js",
  "Docs publication must stage only assets/icon.svg and site.js.",
]) {
  if (!docsWorkflow.includes(requiredDocsControl)) {
    throw new Error(`Docs deployment control is missing: ${requiredDocsControl}`);
  }
}
for (const requiredStoreControl of [
  "workflow_run:",
  'workflows: ["latexdo-ci"]',
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.head_branch == 'main'",
  "repository: latexdo/store.latexdo.org",
  "LATEXDO_WEBSITE_TOKEN",
  "fallbackExtensionCatalog",
  "git -C store-site add -- extensions/catalog.json",
  "Store publication must stage only extensions/catalog.json.",
]) {
  if (!storeWorkflow.includes(requiredStoreControl)) {
    throw new Error(`Store deployment control is missing: ${requiredStoreControl}`);
  }
}
for (const [label, workflow] of [
  ["Editor", editorWorkflow],
  ["CLI", cliWorkflow],
  ["Docs", docsWorkflow],
  ["Store", storeWorkflow],
]) {
  for (const forbiddenDownstreamControl of [
    "CLOUDFLARE_API_TOKEN",
    "wrangler deploy",
    "npm run deploy",
  ]) {
    if (workflow.includes(forbiddenDownstreamControl)) {
      throw new Error(
        `${label} workflow must only push the GitHub repo: ${forbiddenDownstreamControl}`,
      );
    }
  }
}
if (cliWorkflow.includes("rsync -a --delete")) {
  throw new Error("CLI workflow must not delete unrelated cli.latexdo.org files.");
}
for (const requiredRenewalControl of [
  "schedule:",
  "workflow_dispatch:",
  "group: latexdo-org-deploy",
  "git -C latexdo-org-site add -- updates/latest.json",
  "LATEXDO_UPDATE_MIN_VALIDITY_DAYS: 14",
  "Cloudflare Workers Builds can deploy the pushed feed commit.",
]) {
  if (!renewalWorkflow.includes(requiredRenewalControl)) {
    throw new Error(
      `Update-feed renewal control is missing: ${requiredRenewalControl}`,
    );
  }
}
for (const forbiddenRenewalControl of [
  "CLOUDFLARE_API_TOKEN",
  "Deploy renewed feed to Cloudflare",
  "Verify live signed feed",
  "npm run deploy",
  "curl -fsSL",
]) {
  if (renewalWorkflow.includes(forbiddenRenewalControl)) {
    throw new Error(
      `Update-feed renewal must only push the GitHub repo: ${forbiddenRenewalControl}`,
    );
  }
}
for (const requiredRenewalProtection of [
  "verifyFeedSignature(existingFeed, publicKey)",
  "immutableFeed(existingFeed)",
  'path.join(releaseDirectory, "manifest.json")',
  'path.join(releaseDirectory, "SHA256SUMS.txt")',
  "30 * 24 * 60 * 60 * 1_000",
  "14 * 24 * 60 * 60 * 1_000",
]) {
  if (!renewalScript.includes(requiredRenewalProtection)) {
    throw new Error(
      `Update-feed renewal protection is missing: ${requiredRenewalProtection}`,
    );
  }
}
if (!downloadsBuilder.includes("publishedAtMs + 30 * 24 * 60 * 60 * 1_000")) {
  throw new Error("New release feeds must start with a thirty-day validity window.");
}
for (const requiredDownloadsBuilderControl of [
  "const updateFeedSigningKey",
  "const updateFeedEnabled",
  "if (updateFeedEnabled)",
  "Built downloads without signed update feed; LATEXDO_UPDATE_SIGNING_KEY is not configured.",
]) {
  if (!downloadsBuilder.includes(requiredDownloadsBuilderControl)) {
    throw new Error(
      `Downloads builder optional feed control is missing: ${requiredDownloadsBuilderControl}`,
    );
  }
}
const expectedHash = installer.match(
  /CLI_SHA256="\$\{LATEXDO_CLI_SHA256:-([a-f0-9]{64})\}"/,
)?.[1];
const actualHash = createHash("sha256").update(cli).digest("hex");
if (!expectedHash || expectedHash !== actualHash) {
  throw new Error(`CLI installer hash is stale: expected ${actualHash}.`);
}

console.log(`Verified CLI hash ${actualHash} and update signing key.`);
