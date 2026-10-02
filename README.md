# latexdo

[![JS/TS line coverage](docs/coverage.svg)](#test-coverage)

LatexDo is a desktop LaTeX editor built with Electron, React, TypeScript,
Monaco, Vite, and local LaTeX tooling.

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

## LaTeX Toolchain

Desktop PDF compilation uses the TeX tools installed on the user's machine.
Install a full TeX distribution before pressing **Compile**:

- macOS: MacTeX
- Windows: MiKTeX or TeX Live
- Linux: TeX Live, including `latexmk`

If compilation fails immediately, first check that `latexmk` is available from
the terminal. Partial TeX installs can also fail when a document needs packages
such as `booktabs`, `microtype`, or `hyperref`.

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

## Test Coverage

`npm run test:coverage` measures all JavaScript and TypeScript source under
`src/`, `electron/`, `collaborations/`, `cli/`, `scripts/`, and `latexdo/`, including
files that no test imports. This includes the application entry points, Monaco
integration, every feature, Electron preload and backend, collaboration server,
generated runtime code, and development/release tooling.

Tests, test harnesses, type declarations, dependencies, and compiled build output
are excluded. Shell scripts (including the current CLI), CSS, HTML, and other
non-JavaScript assets cannot be instrumented by V8 and are not part of this
percentage. Code executed only in a separate process is included as uncovered
unless its coverage is collected; this report does not merge subprocess coverage.

The badge is a snapshot of the last successful full coverage run and refreshes
automatically when `npm run test:coverage` succeeds. Commit `docs/coverage.svg`
alongside test changes to keep the README current. Detailed results are written to
`coverage/lcov-report/index.html`, `coverage/lcov.info`, and
`coverage/coverage-summary.json`.

The coverage command also verifies that every eligible source file appears in the
report, failing if a transformation error silently drops one.

The full-codebase coverage gate requires 43% lines, 42% statements, 45% functions,
and 38% branches. The previously measured subset retains its existing thresholds
of 79% lines, 78% statements, 82% functions, and 66% branches.

## CI And Release

There is one GitHub Actions workflow: `latexdo-ci`.

It does three things:

1. Checks formatting, lint, types, tests, coverage, audit, supply-chain rules,
   and production build.
2. Packages and smoke-tests macOS, Windows, and Linux installers.
3. On `main`, version tags, or manual runs on `main`, publishes release assets
   and updates only `downloads/` plus optional signed `updates/` in
   `latexdo/latexdo.org`.

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

## AI Source

AI catalog/source files are kept in this repo and synced into generated code by
`npm run ai:sync`, which also runs before build and typecheck. The public catalog
is `catalog/latexdo-ai-catalog.v1.json`.
