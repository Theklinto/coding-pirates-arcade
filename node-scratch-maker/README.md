# SB3 Launchpad

A small Node.js CLI that packages a Scratch project URL into a standalone HTML game using the official `@turbowarp/packager` API.

## Setup

This project uses Yarn 4 (via Corepack) with `nodeLinker: pnpm`, configured in `.yarnrc.yml`.

```sh
corepack enable
yarn install
```

## Package a project

```sh
yarn package https://scratch.mit.edu/projects/123456789/
```

The generated HTML file is written to the current directory. To choose an output path:

```sh
yarn package https://scratch.mit.edu/projects/123456789/ my-game.html
```

Direct SB3 links are supported too:

```sh
yarn package https://example.com/projects/my-game.sb3
```

The packaged game starts automatically on load, without clicking the green flag.

Scratch projects must be shared/public. Node.js 20 or newer is recommended. The TurboWarp Packager Node API is beta and may change between package versions; the dependency is pinned exactly in `package.json`.