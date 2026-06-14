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

The CI installers are unsigned development builds. Public distribution requires
Apple code signing/notarization and Windows code signing.
