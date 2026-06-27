# LatexDo

LatexDo is a desktop LaTeX editor built with Electron, React, TypeScript, and
Monaco. It compiles local projects with `latexmk` and displays the resulting PDF
beside the source.

## Requirements

- Node.js 20 or newer
- A TeX distribution containing `latexmk`:
  - macOS: MacTeX
  - Windows: MiKTeX or TeX Live
  - Linux: TeX Live

## Development

```bash
npm install
npm run dev
```

Use `Cmd/Ctrl + Enter` to compile and `Cmd/Ctrl + S` to save.

To run only the browser editor on localhost:

```bash
npm run web
```

## CLI

The `latexdo` command is published from the sibling
[`latexdo-cli`](https://github.com/latexdo/latexdo-cli) repo. Users install it
with:

```bash
curl -fsSL https://latexdo.org/install.sh | bash
```

The CLI caches this source repo under `~/.latexdo/app`, installs npm
dependencies when they change, starts the local web editor, and opens the
localhost URL in the browser.

Source for the CLI lives in `cli/` here so the main app stays the source of
truth. To refresh `../latexdo-cli`, `../latexdo.org`, and
`../editor.latexdo.org` from this checkout:

```bash
npm run sync:downstream
```

## Production build

```bash
npm run dist
```

## CI installers

GitHub Actions runs on pull requests, pushes to `main`, and manual dispatches.
After the `latexdo-ci` workflow succeeds, download the
`latexdo-installers-<commit>` artifact from the workflow run. It contains:

- `LatexDo-macos-arm64.dmg`
- `LatexDo-windows-x64.exe`
- `SHA256SUMS.txt`

The CI macOS installer is an ad-hoc signed development build. Public macOS
releases are built by `latexdo-release`. When configured, the release workflow
uses Developer ID signing and notarization secrets:

- `MACOS_CERTIFICATE_P12`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_P8` as base64-encoded `.p8` content
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`

When those secrets are missing, the release workflow still publishes ad-hoc
signed macOS DMGs. macOS users may need to allow the app from Privacy &
Security before opening it.
