import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const downloadsDir = path.resolve(
  root,
  process.argv[2] ?? "public-downloads/downloads",
);
const baseUrl = process.env.LATEXDO_DOWNLOAD_BASE_URL ?? "https://latexdo.org";
const baseUrlRoot = baseUrl.replace(/\/$/, "");
const downloadsPageUrl = `${baseUrlRoot}/downloads/`;
const githubRepository = process.env.GITHUB_REPOSITORY ?? "latexdo/latexdo";

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function comparePublishedAt(a, b) {
  const aTime = Date.parse(a.publishedAt ?? "");
  const bTime = Date.parse(b.publishedAt ?? "");
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return bTime - aTime;
  }
  return b.tag.localeCompare(a.tag);
}

function releaseFromManifest(tag, manifest) {
  const downloadsPage = `${downloadsPageUrl}${encodeURIComponent(tag)}/`;
  const githubReleaseUrl = `https://github.com/${manifest.repository ?? githubRepository}/releases/tag/${encodeURIComponent(tag)}`;
  return {
    tag,
    version: manifest.version,
    publishedAt: manifest.publishedAt,
    commit: manifest.commit,
    repository: manifest.repository ?? githubRepository,
    downloadsPage,
    manifestUrl: `${downloadsPage}manifest.json`,
    checksumsUrl: `${downloadsPage}SHA256SUMS.txt`,
    githubReleaseUrl,
    files: Array.isArray(manifest.files) ? manifest.files : [],
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadReleases() {
  const entries = await readdir(downloadsDir, { withFileTypes: true });
  const releases = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const tag = entry.name;
    if (tag.includes("/") || tag.includes("\\") || tag.includes("..")) {
      continue;
    }

    try {
      const manifest = await readJson(path.join(downloadsDir, tag, "manifest.json"));
      if (manifest?.schemaVersion === 1 && manifest.product === "LatexDo") {
        releases.push(releaseFromManifest(tag, manifest));
      }
    } catch (error) {
      console.warn(
        `Skipping ${tag}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return releases.sort(comparePublishedAt);
}

function renderCards(files) {
  if (!files.length) {
    return `
          <article class="download-card">
            <div>
              <h2>Installers pending</h2>
              <p>No desktop installers are listed in the latest manifest yet.</p>
            </div>
            <a class="button secondary" href="manifest.json">Manifest</a>
          </article>`;
  }

  return files
    .map(
      (file) => `
          <article class="download-card">
            <div>
              <h2>${htmlEscape(file.label)}</h2>
              <p>${htmlEscape(file.note ?? `${file.platform ?? "Desktop"} ${file.arch ?? ""}`)}</p>
              <span>${htmlEscape(file.sizeLabel ?? `${file.size ?? ""} bytes`)} - SHA-256 available</span>
            </div>
            <a class="button primary" href="${htmlEscape(file.url)}" download>Download</a>
          </article>`,
    )
    .join("\n");
}

function renderReleaseList(releases) {
  if (!releases.length) {
    return `
        <section class="downloads-releases" aria-labelledby="release-history-title">
          <div class="release-heading">
            <div>
              <p class="eyebrow">Release tags</p>
              <h2 id="release-history-title">No releases published yet</h2>
            </div>
          </div>
        </section>`;
  }

  return `
        <section class="downloads-releases" aria-labelledby="release-history-title">
          <div class="release-heading">
            <div>
              <p class="eyebrow">Release tags</p>
              <h2 id="release-history-title">All desktop releases</h2>
            </div>
            <a class="button secondary" href="releases.json">JSON index</a>
          </div>
          <div class="release-list">
${releases.map(renderReleaseItem).join("\n")}
          </div>
        </section>`;
}

function renderReleaseItem(release) {
  const published = release.publishedAt
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(release.publishedAt))
    : "Unknown date";
  const commit = release.commit ? release.commit.slice(0, 12) : "unknown";

  return `            <article class="release-item">
              <div>
                <h3><a href="${htmlEscape(`${release.tag}/`)}">${htmlEscape(release.tag)}</a></h3>
                <p>Version ${htmlEscape(release.version ?? "unknown")} - ${htmlEscape(published)} UTC - ${htmlEscape(commit)}</p>
              </div>
              <nav aria-label="${htmlEscape(release.tag)} release links">
                <a href="${htmlEscape(`${release.tag}/`)}">Downloads</a>
                <a href="${htmlEscape(`${release.tag}/manifest.json`)}">Manifest</a>
                <a href="${htmlEscape(`${release.tag}/SHA256SUMS.txt`)}">Checksums</a>
                <a href="${htmlEscape(release.githubReleaseUrl)}">GitHub</a>
              </nav>
            </article>`;
}

function renderDownloadsPage(latestManifest, releases) {
  const latestRelease = releases[0];
  const description = latestRelease
    ? `Download the latest LatexDo desktop installers from ${latestRelease.tag}, or inspect every release tag published for macOS and Windows.`
    : "Download LatexDo desktop installers and inspect release metadata.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="${htmlEscape(description)}"
    />
    <title>LatexDo Downloads</title>
    <link rel="canonical" href="${htmlEscape(downloadsPageUrl)}" />
    <link rel="icon" type="image/svg+xml" href="../assets/icon.svg" />
    <link rel="stylesheet" href="../style.css" />
  </head>
  <body>
    <header class="site-header">
      <nav class="nav-shell" aria-label="Primary navigation">
        <a class="brand" href="../">
          <img src="../assets/icon.svg" alt="" width="34" height="34" />
          <span>LatexDo</span>
        </a>
        <div class="nav-links">
          <a class="nav-editor-link" href="https://editor.latexdo.org">Open editor</a>
          <a href="../">Home</a>
          <a href="../about/">About</a>
          <a href="manifest.json">Manifest</a>
          <a href="releases.json">Releases JSON</a>
        </div>
      </nav>
    </header>

    <main class="downloads-page">
      <section class="downloads-hero">
        <p class="eyebrow">Direct downloads</p>
        <h1>LatexDo Downloads</h1>
        <p>${htmlEscape(description)}</p>
        ${
          latestRelease
            ? `<p>Latest tag: <a href="${htmlEscape(`${latestRelease.tag}/`)}">${htmlEscape(latestRelease.tag)}</a>.</p>`
            : ""
        }
      </section>

      <section class="downloads-grid" aria-label="Latest LatexDo installers">
${renderCards(latestManifest.files ?? [])}
      </section>

      <section class="downloads-meta">
        <h2>Latest build information</h2>
        <dl>
          <div>
            <dt>Version</dt>
            <dd>${htmlEscape(latestManifest.version ?? "unknown")}</dd>
          </div>
          <div>
            <dt>Published</dt>
            <dd>${htmlEscape(latestManifest.publishedAt ?? "unknown")}</dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd>${htmlEscape((latestManifest.commit ?? "unknown").slice(0, 12))}</dd>
          </div>
        </dl>
        <p>
          For automated checks, use <a href="manifest.json">manifest.json</a>,
          <a href="releases.json">releases.json</a>, and
          <a href="SHA256SUMS.txt">SHA256SUMS.txt</a>.
        </p>
      </section>
${renderReleaseList(releases)}
    </main>

    <footer class="site-footer">
      <span>LatexDo</span>
      <a href="../about/">About</a>
      <a href="https://editor.latexdo.org">Editor</a>
      <a href="../">Website</a>
      <a href="manifest.json">Manifest</a>
    </footer>
  </body>
</html>
`;
}

const releases = await loadReleases();
let latestManifest = {};
try {
  latestManifest = await readJson(path.join(downloadsDir, "manifest.json"));
} catch {
  latestManifest = releases[0]
    ? await readJson(path.join(downloadsDir, releases[0].tag, "manifest.json"))
    : { files: [] };
}

const index = {
  schemaVersion: 1,
  product: "LatexDo",
  generatedAt: new Date().toISOString(),
  releases,
};

await writeFile(
  path.join(downloadsDir, "releases.json"),
  `${JSON.stringify(index, null, 2)}\n`,
);
await writeFile(
  path.join(downloadsDir, "index.html"),
  renderDownloadsPage(latestManifest, releases),
);

console.log(`Built downloads release index with ${releases.length} releases.`);
