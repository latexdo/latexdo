import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const artifactsDir = path.resolve(root, process.argv[2] ?? "artifacts");
const outputDir = path.resolve(root, process.argv[3] ?? "public-downloads/downloads");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const baseUrl = process.env.LATEXDO_DOWNLOAD_BASE_URL ?? "https://latexdo.org";
const publishedAt = process.env.LATEXDO_RELEASE_DATE ?? new Date().toISOString();
const commit = process.env.GITHUB_SHA ?? "";
const repository = process.env.GITHUB_REPOSITORY ?? "latexdo/latexdo";
const siteRootDir = path.dirname(outputDir);
const baseUrlRoot = baseUrl.replace(/\/$/, "");
const releaseVersion = normalizeReleaseVersion(
  process.env.LATEXDO_RELEASE_VERSION ?? packageJson.version,
);
const releaseSlug = `v${releaseVersion}`;
const latestDownloadsPageUrl = `${baseUrlRoot}/downloads/`;
const releaseDownloadsPageUrl = `${baseUrlRoot}/downloads/${releaseSlug}/`;
const releaseOutputDir = path.join(outputDir, releaseSlug);
const releaseAssetBaseUrl = (
  process.env.LATEXDO_RELEASE_ASSET_BASE_URL ??
  `https://github.com/${repository}/releases/download/${releaseSlug}`
).replace(/\/$/, "");

const downloads = [
  {
    id: "macos-arm64",
    label: "macOS Apple Silicon",
    platform: "macos",
    arch: "arm64",
    filename: "LatexDo-macos-arm64.dmg",
    note: "For Macs with Apple Silicon chips.",
  },
  {
    id: "macos-x64",
    label: "macOS Intel",
    platform: "macos",
    arch: "x64",
    filename: "LatexDo-macos-x64.dmg",
    note: "For Intel-based Macs.",
  },
  {
    id: "windows-x64",
    label: "Windows",
    platform: "windows",
    arch: "x64",
    filename: "LatexDo-windows-x64.exe",
    note: "For 64-bit Windows PCs.",
  },
];

function normalizeReleaseVersion(value) {
  const version = String(value).trim().replace(/^v/i, "");
  if (
    !version ||
    version.includes("/") ||
    version.includes("\\") ||
    version.includes("..")
  ) {
    throw new Error(`Invalid release version: ${value}`);
  }
  return version;
}

function fileUrl(filename) {
  return `${releaseAssetBaseUrl}/${encodeURIComponent(filename)}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

await mkdir(outputDir, { recursive: true });
await mkdir(releaseOutputDir, { recursive: true });

const files = [];
for (const download of downloads) {
  const source = path.join(artifactsDir, download.filename);
  const fileStat = await stat(source);
  files.push({
    ...download,
    size: fileStat.size,
    sizeLabel: formatBytes(fileStat.size),
    sha256: await sha256(source),
    url: fileUrl(download.filename),
  });
}

const manifest = {
  schemaVersion: 1,
  product: "LatexDo",
  version: releaseVersion,
  publishedAt,
  commit,
  repository,
  downloadsPage: releaseDownloadsPageUrl,
  files,
};

const updateFeed = {
  schemaVersion: 1,
  product: "LatexDo",
  channel: "stable",
  version: releaseVersion,
  publishedAt,
  commit,
  repository,
  release: releaseSlug,
  releaseUrl: releaseDownloadsPageUrl,
  downloadsPage: manifest.downloadsPage,
  manifestUrl: `${manifest.downloadsPage}manifest.json`,
  files,
};

const releaseChecksums = files
  .map((file) => `${file.sha256}  ${file.filename}`)
  .join("\n");

await writeFile(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await writeFile(path.join(outputDir, "SHA256SUMS.txt"), `${releaseChecksums}\n`);
await writeFile(
  path.join(releaseOutputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await writeFile(path.join(releaseOutputDir, "SHA256SUMS.txt"), `${releaseChecksums}\n`);

await mkdir(path.join(siteRootDir, "updates"), { recursive: true });
await writeFile(
  path.join(siteRootDir, "updates", "latest.json"),
  `${JSON.stringify(updateFeed, null, 2)}\n`,
);
await writeFile(
  path.join(siteRootDir, "updates", `${releaseSlug}.json`),
  `${JSON.stringify(updateFeed, null, 2)}\n`,
);

function renderCards(fileHref) {
  return files
    .map(
      (file) => `
          <article class="download-card">
            <div>
              <h2>${htmlEscape(file.label)}</h2>
              <p>${htmlEscape(file.note)}</p>
              <span>${htmlEscape(file.sizeLabel)} - SHA-256 available</span>
            </div>
            <a class="button primary" href="${htmlEscape(
              fileHref(file),
            )}" download>Download</a>
          </article>`,
    )
    .join("\n");
}

function renderDownloadsPage({
  pageTitle,
  description,
  assetPrefix,
  homeHref,
  manifestHref,
  checksumsHref,
  cards,
  canonicalUrl,
  latestHref,
}) {
  const releaseLink = latestHref
    ? `<p>
          This is a permanent release page. The current release is also available at
          <a href="${htmlEscape(latestHref)}">latest downloads</a>.
        </p>`
    : `<p>
          Permanent downloads for this release are available at
          <a href="${htmlEscape(`${releaseSlug}/`)}">${htmlEscape(releaseSlug)}</a>.
        </p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="${htmlEscape(description)}"
    />
    <title>${htmlEscape(pageTitle)}</title>
    <link rel="canonical" href="${htmlEscape(canonicalUrl)}" />
    <link rel="icon" type="image/svg+xml" href="${assetPrefix}assets/icon.svg" />
    <link rel="stylesheet" href="${assetPrefix}style.css" />
  </head>
  <body>
    <header class="site-header">
      <nav class="nav-shell" aria-label="Primary navigation">
        <a class="brand" href="${homeHref}">
          <img src="${assetPrefix}assets/icon.svg" alt="" width="34" height="34" />
          <span>LatexDo</span>
        </a>
        <div class="nav-links">
          <a class="nav-editor-link" href="https://editor.latexdo.org">Open editor</a>
          <a href="${homeHref}">Home</a>
          <a href="${assetPrefix}about/">About</a>
          <a href="${manifestHref}">Manifest</a>
          <a href="${checksumsHref}">Checksums</a>
        </div>
      </nav>
    </header>

    <main class="downloads-page">
      <section class="downloads-hero">
        <p class="eyebrow">Direct downloads</p>
        <h1>${htmlEscape(pageTitle)}</h1>
        <p>${htmlEscape(description)}</p>
        ${releaseLink}
      </section>

      <section class="downloads-grid" aria-label="LatexDo installers">
${cards}
      </section>

      <section class="downloads-meta">
        <h2>Build information</h2>
        <dl>
          <div>
            <dt>Version</dt>
            <dd>${htmlEscape(releaseVersion)}</dd>
          </div>
          <div>
            <dt>Published</dt>
            <dd>${htmlEscape(publishedAt)}</dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd>${htmlEscape(commit.slice(0, 12) || "local")}</dd>
          </div>
        </dl>
        <p>
          For automated checks, use <a href="${manifestHref}">manifest.json</a>.
          For file verification, use <a href="${checksumsHref}">SHA256SUMS.txt</a>.
        </p>
      </section>
    </main>

    <footer class="site-footer">
      <span>LatexDo</span>
      <a href="${assetPrefix}about/">About</a>
      <a href="https://editor.latexdo.org">Editor</a>
      <a href="${homeHref}">Website</a>
      <a href="${manifestHref}">Manifest</a>
    </footer>
  </body>
</html>
`;
}

const latestHtml = renderDownloadsPage({
  pageTitle: "LatexDo Downloads",
  description:
    "Download the latest LatexDo desktop release from the LatexDo website. Installer files are stored in GitHub Releases and indexed here for updates.",
  assetPrefix: "../",
  homeHref: "../",
  manifestHref: "manifest.json",
  checksumsHref: "SHA256SUMS.txt",
  cards: renderCards((file) => file.url),
  canonicalUrl: latestDownloadsPageUrl,
  latestHref: null,
});

const releaseHtml = renderDownloadsPage({
  pageTitle: `LatexDo ${releaseSlug} Downloads`,
  description:
    "Download this exact LatexDo desktop release from the LatexDo website. Installer files are stored in GitHub Releases and indexed here for updates.",
  assetPrefix: "../../",
  homeHref: "../../",
  manifestHref: "manifest.json",
  checksumsHref: "SHA256SUMS.txt",
  cards: renderCards((file) => file.url),
  canonicalUrl: releaseDownloadsPageUrl,
  latestHref: "../",
});

await writeFile(path.join(outputDir, "index.html"), latestHtml);
await writeFile(path.join(releaseOutputDir, "index.html"), releaseHtml);

console.log(`Built LatexDo ${releaseVersion} downloads at ${releaseDownloadsPageUrl}`);
