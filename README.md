# latexdo

LatexDo is the main desktop LaTeX editor and the source of truth for the shared editor experience used across the LatexDo projects. It combines Electron, React, TypeScript, Monaco, Vite, and local LaTeX tooling.

## Repository Role

- Runs the desktop app for local LaTeX projects.
- Provides the browser editor used by the CLI and hosted editor builds.
- Contains source copies for the CLI in `cli/` and public website in `website/`.
- Syncs downstream repositories with `npm run sync:downstream`.

## Requirements

- Node.js 20 or newer.
- npm.
- A TeX distribution with `latexmk` for PDF compilation:
  - macOS: MacTeX.
  - Linux: TeX Live.
  - Windows: MiKTeX or TeX Live.

## Run Locally

Run the desktop app:

```sh
npm install
npm run dev
```

Run only the browser editor:

```sh
npm install
npm run web
```

The browser editor defaults to `http://127.0.0.1:5173`. Use `Cmd/Ctrl + Enter` to compile and `Cmd/Ctrl + S` to save.

## Common Commands

```sh
npm run dev              # Start Vite and Electron together.
npm run web              # Start the browser-only editor.
npm run build            # Build web and Electron output.
npm run typecheck        # Run TypeScript checks.
npm run lint             # Run ESLint.
npm run test             # Run Vitest.
npm run package          # Build unpacked desktop app.
npm run dist             # Build distributable installers.
npm run sync:downstream  # Refresh CLI, website, and hosted editor repos.
```

## Downstream Sync

This repo owns the source for pieces published elsewhere. After changing shared editor behavior, CLI files, website files, or hosted frontend expectations, run:

```sh
npm run sync:downstream
```

That refreshes:

- `../latexdo-cli` from `cli/`.
- `../latexdo.org` from `website/`.
- `../editor.latexdo.org/dist` from the built editor frontend.

## Release

Build local installers with:

```sh
npm run dist
```

CI also builds installers. The release workflow uploads macOS and Windows
installers to a new immutable GitHub Release for each main-branch run, using a
tag such as `v<package version>-build.<run>.<attempt>.<sha>`, and publishes the
website release index at `https://latexdo.org/downloads/<release tag>/`.
`https://latexdo.org/updates/latest.json` points the desktop app at that
versioned release manifest, whose download URLs point to the GitHub Release
assets. The downloads page also publishes an all-release tag index at
`https://latexdo.org/downloads/` and `https://latexdo.org/downloads/releases.json`.

Public macOS release signing and notarization depend on the Apple and certificate
secrets configured in GitHub Actions. Without those secrets, CI can still
produce ad-hoc signed development builds.
