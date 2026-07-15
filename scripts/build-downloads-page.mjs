import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const artifactsDir = path.resolve(root, process.argv[2] ?? "artifacts");
const outputDir = path.resolve(root, process.argv[3] ?? "public-downloads/downloads");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const baseUrl = process.env.LATEXDO_DOWNLOAD_BASE_URL ?? "https://latexdo.org";
const publishedAt = process.env.LATEXDO_RELEASE_DATE ?? new Date().toISOString();
const publishedAtMs = Date.parse(publishedAt);
if (!Number.isFinite(publishedAtMs)) {
  throw new Error("LATEXDO_RELEASE_DATE must be a valid timestamp.");
}
const expiresAt =
  process.env.LATEXDO_UPDATE_EXPIRES_AT ??
  new Date(publishedAtMs + 30 * 24 * 60 * 60 * 1_000).toISOString();
const expiresAtMs = Date.parse(expiresAt);
if (!Number.isFinite(expiresAtMs) || expiresAtMs <= publishedAtMs) {
  throw new Error("The signed update feed expiry must follow its publication time.");
}
const commit = process.env.LATEXDO_RELEASE_COMMIT ?? process.env.GITHUB_SHA ?? "";
const repository = process.env.GITHUB_REPOSITORY ?? "latexdo/latexdo";
const siteRootDir = path.dirname(outputDir);
const baseUrlRoot = baseUrl.replace(/\/$/, "");
const releaseVersion = normalizeReleaseVersion(
  process.env.LATEXDO_RELEASE_VERSION ?? packageJson.version,
);
const releaseSlug = normalizeReleaseSlug(
  process.env.LATEXDO_RELEASE_SLUG ?? `v${releaseVersion}`,
);
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
  {
    id: "linux-x64",
    label: "Linux",
    platform: "linux",
    arch: "x64",
    filename: "LatexDo-linux-x64.AppImage",
    note: "For 64-bit Linux distributions that support AppImage.",
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

function normalizeReleaseSlug(value) {
  const slug = String(value).trim();
  if (!slug || slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    throw new Error(`Invalid release slug: ${value}`);
  }
  return slug;
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

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot sign a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Cannot sign an unsupported JSON value.");
}

async function signUpdateFeed(feed) {
  const encodedPrivateKey = process.env.LATEXDO_UPDATE_SIGNING_KEY?.trim();
  if (!encodedPrivateKey) {
    throw new Error("LATEXDO_UPDATE_SIGNING_KEY is required to publish updates.");
  }

  const privateKey = createPrivateKey(
    Buffer.from(encodedPrivateKey, "base64").toString("utf8"),
  );
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("LATEXDO_UPDATE_SIGNING_KEY must contain an Ed25519 private key.");
  }

  const publicKey = createPublicKey(privateKey);
  const expectedPublicKey = createPublicKey(
    await readFile(path.join(root, "build", "update-public-key.pem"), "utf8"),
  );
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const expectedDer = expectedPublicKey.export({ type: "spki", format: "der" });
  if (!Buffer.from(publicDer).equals(Buffer.from(expectedDer))) {
    throw new Error("Update signing key does not match build/update-public-key.pem.");
  }

  const keyId = createHash("sha256").update(publicDer).digest("hex").slice(0, 16);
  const signature = sign(null, Buffer.from(canonicalJson(feed)), privateKey);
  return {
    ...feed,
    signature: {
      algorithm: "ed25519",
      keyId,
      value: signature.toString("base64"),
    },
  };
}

function platformIcon(platform) {
  if (platform === "macos") {
    return `<svg class="platform-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.64 12.08c-.03-2.32 1.9-3.45 1.99-3.5-1.09-1.6-2.79-1.82-3.37-1.84-1.42-.15-2.8.85-3.52.85-.74 0-1.86-.83-3.06-.8-1.56.02-3.02.93-3.82 2.35-1.65 2.86-.42 7.06 1.16 9.37.79 1.13 1.71 2.39 2.92 2.35 1.18-.05 1.62-.75 3.04-.75 1.41 0 1.82.75 3.06.72 1.27-.02 2.06-1.14 2.82-2.28.91-1.3 1.27-2.58 1.29-2.65-.03-.01-2.49-.96-2.52-3.82ZM14.34 5.24c.64-.79 1.07-1.86.95-2.94-.92.04-2.07.63-2.74 1.39-.59.67-1.12 1.78-.98 2.81 1.04.08 2.1-.52 2.77-1.26Z" />
    </svg>`;
  }
  if (platform === "windows") {
    return `<svg class="platform-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 5.15 10.8 4v7.38H3V5.15Z" />
      <path d="M12.15 3.82 21 2.5v8.88h-8.85V3.82Z" />
      <path d="M3 12.62h7.8V20L3 18.85v-6.23Z" />
      <path d="M12.15 12.62H21v8.88l-8.85-1.32v-7.56Z" />
    </svg>`;
  }
  return `<svg class="platform-logo linux-logo" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 5.5h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />
    <path d="m7 10 3 2-3 2" />
    <path d="M12.5 15h4.5" />
  </svg>`;
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
  schemaVersion: 2,
  product: "LatexDo",
  channel: "stable",
  version: releaseVersion,
  publishedAt,
  expiresAt,
  commit,
  repository,
  release: releaseSlug,
  releaseUrl: releaseDownloadsPageUrl,
  downloadsPage: manifest.downloadsPage,
  manifestUrl: `${manifest.downloadsPage}manifest.json`,
  files,
};
const signedUpdateFeed = await signUpdateFeed(updateFeed);

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
  `${JSON.stringify(signedUpdateFeed, null, 2)}\n`,
);
await writeFile(
  path.join(siteRootDir, "updates", `${releaseSlug}.json`),
  `${JSON.stringify(signedUpdateFeed, null, 2)}\n`,
);

function macBuildName(file) {
  const value = `${file.id} ${file.label} ${file.arch}`.toLowerCase();
  if (value.includes("arm64") || value.includes("silicon")) return "Apple Silicon";
  if (value.includes("x64") || value.includes("intel")) return "Intel";
  return file.label;
}

function installerKind(file) {
  const extension = path.extname(file.filename).replace(".", "").toUpperCase();
  return extension ? `${extension} installer` : "Installer";
}

function renderDownloadOption(file, fileHref, label = file.label) {
  return `<a class="download-option" href="${htmlEscape(fileHref(file))}" download>
              <strong>${htmlEscape(label)}</strong>
              <span>${htmlEscape(installerKind(file))}</span>
              <em>${htmlEscape(file.sizeLabel)} - SHA-256</em>
            </a>`;
}

function renderCards(fileHref) {
  const macFiles = files.filter((file) => file.platform === "macos");
  const windowsFiles = files.filter((file) => file.platform === "windows");
  const linuxFiles = files.filter((file) => file.platform === "linux");

  return `
          <article class="platform-download-card macos">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("macos")}</span>
              <div>
                <p class="eyebrow">macOS</p>
                <h2>Apple Mac</h2>
              </div>
            </div>
            <p>Choose the DMG for your Mac. Apple Silicon covers M-series Macs; Intel covers older Intel-based Macs.</p>
            <div class="download-variant-row" aria-label="macOS build choices">
${macFiles.map((file) => renderDownloadOption(file, fileHref, macBuildName(file))).join("\n")}
            </div>
          </article>
          <article class="platform-download-card windows">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("windows")}</span>
              <div>
                <p class="eyebrow">Windows</p>
                <h2>Windows PC</h2>
              </div>
            </div>
            <p>Install LatexDo on a 64-bit Windows PC with the packaged desktop installer.</p>
            <div class="download-variant-row" aria-label="Windows build choices">
${windowsFiles.map((file) => renderDownloadOption(file, fileHref, "Windows x64")).join("\n")}
            </div>
          </article>
          <article class="platform-download-card linux">
            <div class="platform-card-top">
              <span class="platform-logo-shell">${platformIcon("linux")}</span>
              <div>
                <p class="eyebrow">Linux</p>
                <h2>Linux desktop</h2>
              </div>
            </div>
            <p>Run LatexDo on 64-bit Linux distributions with the packaged AppImage.</p>
            <div class="download-variant-row" aria-label="Linux build choices">
${linuxFiles.map((file) => renderDownloadOption(file, fileHref, "Linux x64")).join("\n")}
            </div>
          </article>`;
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

      <section class="download-platform-grid" aria-label="LatexDo installers">
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
