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
  releaseWorkflow,
  websiteWorkflow,
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
  readFile(".github/workflows/release.yml", "utf8"),
  readFile(".github/workflows/deploy-website.yml", "utf8"),
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
  renewalWorkflow.includes("wrangler@latest")
) {
  throw new Error("Deployment workflows must not resolve Wrangler dynamically.");
}
for (const requiredReleaseControl of [
  "workflow_run:",
  'workflows: ["latexdo-ci"]',
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.head_branch == 'main'",
  "LATEXDO_RELEASE_TARGET_SHA",
  "LATEXDO_RELEASE_COMMIT: ${{ needs.release_gate.outputs.target_sha }}",
]) {
  if (!releaseWorkflow.includes(requiredReleaseControl)) {
    throw new Error(
      `Release publication control is missing: ${requiredReleaseControl}`,
    );
  }
}
for (const requiredWebsiteControl of [
  "id: deploy_mode",
  "cloudflare_enabled=false",
  "Direct Cloudflare deploy skipped: missing CLOUDFLARE_API_TOKEN",
  "if: ${{ steps.deploy_mode.outputs.cloudflare_enabled == 'true' }}",
  "npm run deploy",
]) {
  if (!websiteWorkflow.includes(requiredWebsiteControl)) {
    throw new Error(
      `Website deployment control is missing: ${requiredWebsiteControl}`,
    );
  }
}
for (const requiredRenewalControl of [
  "schedule:",
  "workflow_dispatch:",
  "group: latexdo-org-deploy",
  "git -C latexdo-org-site add -- updates/latest.json",
  "LATEXDO_UPDATE_MIN_VALIDITY_DAYS: 14",
  "npm ci",
  "npm run deploy",
]) {
  if (!renewalWorkflow.includes(requiredRenewalControl)) {
    throw new Error(
      `Update-feed renewal control is missing: ${requiredRenewalControl}`,
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
for (const excludedReleasePath of [
  "rm -rf website/downloads website/updates",
  "rm -rf website/bin",
  "rm -f website/install.sh",
]) {
  if (!websiteWorkflow.includes(excludedReleasePath)) {
    throw new Error(
      `Normal website deployment can overwrite a release-owned path: ${excludedReleasePath}`,
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
