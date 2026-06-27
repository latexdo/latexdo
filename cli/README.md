# LatexDo CLI

`latexdo-cli` installs the `latexdo` command. Running `latexdo` keeps a cached
copy of `github.com/latexdo/latexdo`, installs npm dependencies when they
change, starts the local web editor with Vite, and opens it in the browser.

## Install

```sh
curl -fsSL https://latexdo.org/install.sh | bash
```

The installer writes the command to `~/.local/bin/latexdo` by default, then
bootstraps the app source and dependencies.

Use a different binary directory:

```sh
LATEXDO_BIN_DIR=/usr/local/bin curl -fsSL https://latexdo.org/install.sh | bash
```

Skip first-run bootstrap:

```sh
LATEXDO_SKIP_BOOTSTRAP=1 curl -fsSL https://latexdo.org/install.sh | bash
```

## Usage

```sh
latexdo              # start the local web editor and open localhost
latexdo update       # update source and install npm dependencies
latexdo doctor       # check local tools
latexdo path         # print the cached app path
latexdo reset        # remove the cached app checkout
```

## Requirements

- Git
- Node.js 20 or newer
- npm
- A browser

The browser editor works without a TeX distribution. Local PDF compilation needs
`latexmk` from MacTeX, TeX Live, or MiKTeX.

## Development

The source for this repo lives in `cli/` inside `github.com/latexdo/latexdo`.
Run this from the main app repo to refresh the publish repos:

```sh
npm run sync:downstream
```
