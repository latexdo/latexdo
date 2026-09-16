# latexdo

LatexDo is a desktop LaTeX editor built with Electron, React, TypeScript,
Monaco, Vite, and local LaTeX tooling.

This repo owns the desktop app, the shared browser editor, the CLI source in
`cli/`, and the release pipeline that publishes desktop downloads to
`latexdo/latexdo.org`.

## Requirements

- Node.js 22.17 or newer.
- npm.
- A TeX distribution with `latexmk`.
  - macOS: MacTeX.
  - Linux: TeX Live.
  - Windows: MiKTeX or TeX Live.

## Run

```sh
npm install
npm run dev
```

Browser-only editor:

```sh
npm run web
```

The browser editor runs at `http://127.0.0.1:5173`.

## Commands

```sh
npm run build             # Build web and Electron output.
npm run typecheck         # Run TypeScript checks.
npm run lint              # Run ESLint.
npm test                  # Run Vitest.
npm run test:coverage     # Run tests with coverage.
npm run package           # Build an unpacked desktop app.
npm run dist              # Build distributable installers.
npm run release:check     # Run the local release-readiness gate.
npm run ai:check          # Validate AI catalog/source sync.
npm run sync:downstream   # Local-only helper for CLI/editor sibling repos.
```

## CI And Release

There is one GitHub Actions workflow: `latexdo-ci`.

It does three things:

1. Checks formatting, lint, types, tests, coverage, audit, supply-chain rules,
   and production build.
2. Packages and smoke-tests macOS, Windows, and Linux installers.
3. On `main`, version tags, or manual runs on `main`, publishes release assets
   and updates only `downloads/` plus optional signed `updates/` in
   `latexdo/latexdo.org`.

The old split deploy workflows for docs, editor, CLI, store, website, and
release have been removed. This repo no longer deploys those sites.

Release downloads live at:

- `https://www.latexdo.org/downloads/`
- `https://www.latexdo.org/updates/latest.json`

Required publication secret:

- `LATEXDO_WEBSITE_TOKEN`

Optional release secrets:

- macOS signing/notarization:
  `MACOS_CERTIFICATE_P12`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_P8`,
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`
- Windows signing:
  `WINDOWS_CERTIFICATE_P12`, `WINDOWS_CERTIFICATE_PASSWORD`
- signed update feed:
  `LATEXDO_UPDATE_SIGNING_KEY`

If signing secrets are missing, CI still publishes ad-hoc macOS builds and
unsigned Windows builds. If `LATEXDO_UPDATE_SIGNING_KEY` is missing, CI updates
downloads and leaves `updates/` unchanged.

## AI Source

AI catalog/source files are kept in this repo and synced into generated code by
`npm run ai:sync`, which also runs before build and typecheck. The public catalog
is `catalog/latexdo-ai-catalog.v1.json`.
