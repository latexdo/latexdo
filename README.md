# latexdo

LatexDo is the main desktop LaTeX editor and the source of truth for the shared editor experience used across the LatexDo projects. It combines Electron, React, TypeScript, Monaco, Vite, and local LaTeX tooling.

## Repository Role

- Runs the desktop app for local LaTeX projects.
- Provides the browser editor used by the CLI and hosted editor builds.
- Contains source copies for the CLI in `cli/` and public website in `website/`.
- Syncs downstream repositories locally with `npm run sync:downstream` and in
  GitHub Actions after `latexdo-ci` passes on `main`.

## Requirements

- Node.js 22.17 or newer.
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

- `../cli.latexdo.org` from `cli/`.
- `../latexdo.org` from `website/`.
- `../editor.latexdo.org/dist` from the built editor frontend.

In GitHub Actions, the matching downstream deploy workflows run after
`latexdo-ci` succeeds on `main` and push commits to:

- `latexdo/latexdo.org`: static website files, excluding release-owned downloads,
  updates, CLI files, and installer scripts.
- `latexdo/cli.latexdo.org`: the standalone CLI package from `cli/`.
- `latexdo/editor.latexdo.org`: the hosted editor frontend in `dist/`.
- `latexdo/docs.latexdo.org`: shared icon and generated docs `site.js`.
- `latexdo/store.latexdo.org`: `extensions/catalog.json` from the app fallback
  extension catalog.

They only update GitHub repositories; Cloudflare deployment is handled by each
connected GitHub repository, not by this repo's workflows.

## Hosted Production

`https://editor.latexdo.org` is the only public API and WebSocket origin. The
The `collaborations-latexdo-org-v2` Worker owns sessions, authorization, projects,
files, shares, presence, and Yjs rooms behind a service binding. The editor
gateway owns bounded compile/import admission, stateless compiler containers,
and private R2 PDF artifacts.

Deploy in this order:

1. Deploy and verify `collaborations-latexdo-org-v2`, including its Durable
   Object migrations and authenticated internal readiness route. Do not rename,
   replace, or bind the legacy `collaborations-latexdo-org` Worker.
2. Deploy `editor.latexdo.org` from a reviewed commit. Roll out a compiler image
   only through that repository's protected manual workflow.
3. Use this repository's `deploy-editor` workflow to publish the exact hosted
   frontend commit to `editor.latexdo.org`. Only the hosted editor repository
   deploys the production Worker.
4. Run credentialed project, edit, WebSocket reconnect, import, compile, PDF
   range, and rollback smoke tests before moving production traffic.

The v2 Durable Object namespace starts empty by design. Production hostname
cutover is blocked until operators have exported and migrated every retained
legacy project, validated owner access and file hashes in v2, and recorded an
approved disposition for any account that cannot be migrated. Keeping the
legacy Worker available is not itself a migration: reloaded clients receive the
new frontend. The protected editor deployment must require an explicit
migration-complete attestation, and rollback remains open until migrated users
have passed read, edit, compile, share, and reconnect checks.

Production also requires the shared internal service token, independent session
and compiler secrets, the private compile-artifact R2 bucket and lifecycle, paid
Workers/Durable Objects/Containers capacity, scoped deployment credentials, and
an account container quota matching the configured pool. One million registered
users is not a concurrency target: launch approval requires staged distributed
load tests against the expected active WebSocket, edit, import, and compile
arrival rates on the actual Cloudflare account.

## Release

Build local installers with:

```sh
npm run dist
```

CI also builds non-release smoke-test installers. When `latexdo-ci` passes on
`main`, the release workflow publishes a build release named
`v<package version>-build.<run>.<attempt>.<sha>`. Production version tags remain
supported: an immutable `v<package version>` tag whose version exactly matches
`package.json` publishes the same release assets under that stable tag. The
release workflow publishes macOS, Windows, and Linux assets plus the website
release index at `https://latexdo.org/downloads/<release tag>/`.
`https://latexdo.org/updates/latest.json` points the desktop app at that
versioned release. The feed is signed with the Ed25519 key pinned into every
desktop package; the app rejects unsigned, modified, or unknown-key feeds before
downloading an installer. Signed feeds also expire, and both the desktop app and
CLI persist the highest trusted version and publication date to reject rollbacks.
The downloads page also publishes an all-release tag index at
`https://latexdo.org/downloads/` and `https://latexdo.org/downloads/releases.json`.

Production publication requires `LATEXDO_UPDATE_SIGNING_KEY` and
`LATEXDO_WEBSITE_TOKEN`. Apple and Windows signing secrets are optional: when
they are present, the release workflow signs/notarizes the platform installers;
when they are missing, it publishes unsigned macOS and Windows installers. The
release workflow commits only `downloads/` and `updates/` to
`latexdo/latexdo.org`; normal website pages, CLI scripts, and direct site
deployment stay out of that path. The update signing secret is the
base64-encoded PEM private key matching `build/update-public-key.pem`.

The standalone website and downstream publication workflows require
`LATEXDO_WEBSITE_TOKEN`. The token pushes the generated static site to
`latexdo/latexdo.org`, publishes generated downstream content to
`latexdo/cli.latexdo.org`, `latexdo/editor.latexdo.org`,
`latexdo/docs.latexdo.org`, and `latexdo/store.latexdo.org`, and dispatches
downstream validation in `latexdo/cli.latexdo.org`,
`latexdo/editor.latexdo.org`, and `latexdo/store.latexdo.org`. Cloudflare
deploys from the pushed GitHub commits.

Automatic CI publication to `latexdo.org` is scoped to downloads/update data in
`downloads/` and `updates/`. The design-owned `downloads/index.html`, site
pages, CSS, and JavaScript stay in the website repository; the downloads page
hydrates from `downloads/releases.json` and the latest manifests.
