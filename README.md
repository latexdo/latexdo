# TeXly

TeXly is a desktop LaTeX editor built with Electron, React, TypeScript, and
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
