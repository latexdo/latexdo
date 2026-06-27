import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const artifactsDir = path.resolve(root, process.argv[2] ?? "artifacts");
const outputDir = path.resolve(root, process.argv[3] ?? "public-downloads/downloads");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const baseUrl = process.env.LATEXDO_DOWNLOAD_BASE_URL ?? "https://latexdo.github.io";
const publishedAt = process.env.LATEXDO_RELEASE_DATE ?? new Date().toISOString();
const commit = process.env.GITHUB_SHA ?? "";
const repository = process.env.GITHUB_REPOSITORY ?? "latexdo/latexdo";

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

function fileUrl(filename) {
  return `${baseUrl.replace(/\/$/, "")}/downloads/files/${encodeURIComponent(filename)}`;
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

await mkdir(path.join(outputDir, "files"), { recursive: true });

const files = [];
for (const download of downloads) {
  const source = path.join(artifactsDir, download.filename);
  const target = path.join(outputDir, "files", download.filename);
  const fileStat = await stat(source);
  await copyFile(source, target);
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
  version: packageJson.version,
  publishedAt,
  commit,
  repository,
  downloadsPage: `${baseUrl.replace(/\/$/, "")}/downloads/`,
  files,
};

const checksums = files
  .map((file) => `${file.sha256}  files/${file.filename}`)
  .join("\n");

await writeFile(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await writeFile(path.join(outputDir, "SHA256SUMS.txt"), `${checksums}\n`);

const cards = files
  .map(
    (file) => `
          <article class="download-card">
            <div>
              <h2>${htmlEscape(file.label)}</h2>
              <p>${htmlEscape(file.note)}</p>
              <span>${htmlEscape(file.sizeLabel)} · SHA-256 available</span>
            </div>
            <a class="button primary" href="${htmlEscape(
              `files/${file.filename}`,
            )}" download>Download</a>
          </article>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="Download the latest LatexDo desktop installers directly from the LatexDo website."
    />
    <title>LatexDo Downloads</title>
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
          <a href="manifest.json">Manifest</a>
          <a href="SHA256SUMS.txt">Checksums</a>
        </div>
      </nav>
    </header>

    <main class="downloads-page">
      <section class="downloads-hero">
        <p class="eyebrow">Direct downloads</p>
        <h1>LatexDo Downloads</h1>
        <p>
          Download the latest LatexDo desktop builds directly from this website.
          The application also checks this page's manifest for update information.
        </p>
      </section>

      <section class="downloads-grid" aria-label="LatexDo installers">
${cards}
      </section>

      <section class="downloads-meta">
        <h2>Build information</h2>
        <dl>
          <div>
            <dt>Version</dt>
            <dd>${htmlEscape(packageJson.version)}</dd>
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
          For automated checks, use <a href="manifest.json">manifest.json</a>.
          For file verification, use <a href="SHA256SUMS.txt">SHA256SUMS.txt</a>.
        </p>
      </section>
    </main>

    <footer class="site-footer">
      <span>LatexDo</span>
      <a href="https://editor.latexdo.org">Editor</a>
      <a href="../">Website</a>
      <a href="manifest.json">Manifest</a>
    </footer>
  </body>
</html>
`;

await writeFile(path.join(outputDir, "index.html"), html);
