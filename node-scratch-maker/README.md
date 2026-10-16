# SB3 Launchpad

A small TypeScript CLI for Node.js that packages a Scratch project URL into a standalone HTML game using the official `@turbowarp/packager` API.

## Setup

This project uses Yarn 4 (via Corepack) with `nodeLinker: pnpm`, configured in `.yarnrc.yml`.

```sh
corepack enable
yarn install
```

## Ship to the arcade

Build a portable release on your development machine:

```sh
yarn typecheck
yarn build:release
```

Ship `dist/scratch-importer-1.0.0.zip` (the name follows the package version). It contains the bundled importer and CLI, precompiled browser UI, pixel font, pirate logo, configuration template, Windows/Linux launchers, Pegasus examples, and third-party license notices. It does not contain the repository, tests, TypeScript tooling, `node_modules`, your `.env`, or installed games.

The arcade needs Node.js 20.12 or newer, Chrome/Edge/Chromium, and internet access for Scratch downloads. Git, Yarn, dependency installation, and compilation are not needed on the arcade. Node and the browser are not embedded; the same ZIP can be used on Windows or Linux with a compatible local Node installation. Keep the complete release directory together: `scripts/scaffolding` and the other runtime companion files are required to generate games.

1. Extract the ZIP into a writable directory, for example `C:/Arcade/ScratchImporter` or `/opt/scratch-importer`.
2. Copy `.env.example` to `.env` there. Configure the existing Pegasus directory and collection; set `IMPORTER_LANGUAGE=da` for Danish. Prefer absolute game-directory paths.
3. Run `start.cmd` on Windows or `sh start.sh` on Linux. Both open the UI and remain running until it closes. Use an absolute Node path in the launcher if Pegasus does not inherit Node on its PATH.
4. To launch from Pegasus, copy only the appropriate `pegasus-windows.example.txt` or `pegasus-linux.example.txt` to `metadata.pegasus.txt` in the release directory, then add that directory to Pegasus's game directories. This manually adds the importer tool; it does not create or alter the Scratch games collection.

The release opens the website automatically in browser kiosk mode (`--kiosk`), including when started directly with `node scripts/importer.mjs`. For a server-only session, run `node scripts/importer.mjs --no-browser`. The release reads `.env` from its own directory even when Pegasus starts it elsewhere. The bundled CLI is available as `node scripts/package-project.mjs <project-url-or-id>`.

For upgrades, stop the importer, replace program files, and preserve the arcade's `.env`, existing metadata, and installed games. No automatic updater or Pegasus restart is included. Physical arcade controls and returning from the browser still need checking on the target machine.

## Package a project

```sh
yarn package https://scratch.mit.edu/projects/123456789/
```

Without environment configuration, the generated HTML file is written to the current directory. To choose an output path:

```sh
yarn package https://scratch.mit.edu/projects/123456789/ my-game.html
```

Direct SB3 links are supported too:

```sh
yarn package https://example.com/projects/my-game.sb3
```

The packaged game starts automatically on load, without clicking the green flag.

## Student importer

Configure the existing Pegasus directory and collection in `.env` (below), then run:

```sh
yarn importer
```

Open `http://127.0.0.1:4173`. Students enter a public Scratch project ID using the on-screen keypad, or paste a Scratch URL. The keyboard button switches to a full on-screen keyboard. A project preview shows its title, creator, and thumbnail before adding or updating it. Stable Scratch IDs prevent duplicate generated entries. The student importer intentionally does not accept arbitrary SB3 download URLs; the CLI still does.

Navigation supports mouse/touch, arrow keys with Enter/Space and Escape, and standard browser gamepads with D-pad/left stick, button A to select, and button B to go back. Directional input repeats while held; selection and back require a release between presses. Keyboard-emulating arcade controllers should map to those keys. Physical controller mapping and browser focus must be checked on the target arcade.

The service is loopback-only, validates the HTTP host and POST origin, and does not allow students to choose paths or execute commands. Missing metadata or collections are reported without creating them. It shows setup errors until an adult configures the arcade and restarts the service.

Both CLI and web imports use a `.scratch-import.lock` in the Pegasus directory (or output directory without Pegasus), a staged HTML file, and a backup of the previous game. Failed installations restore the previous HTML and metadata. This protects against ordinary import failures, not power loss or external edits during installation. After an unexpected process termination, an adult may need to remove a stale lock after confirming no import is running. Avoid editing metadata or running another non-cooperating importer during installation.

### Launch from Pegasus

```sh
yarn importer:launch
```

This starts the service and opens the website in Chrome/Edge/Chromium kiosk mode (`--kiosk`) with a separate browser profile. It detects common Windows/Linux browser installations, including Snap Chromium; set `IMPORTER_BROWSER` if needed. Browser startup errors are shown in the terminal. The Back to arcade button closes the importer window and service. Closing the window also ends the service after any active import finishes. Do not run the standalone service and launcher on the same port at the same time.

Add a tools entry manually in a separate Pegasus metadata file. For example, replace `C:/arcade/node-scratch-maker` with the actual installation path and use an absolute Node executable path if it is not on Pegasus's PATH:

```text
collection: Arcade tools
file: C:/arcade/node-scratch-maker/scripts/start-importer.ts

game: Add or update a Scratch game
file: C:/arcade/node-scratch-maker/scripts/start-importer.ts
workdir: C:/arcade/node-scratch-maker
launch: node "C:/arcade/node-scratch-maker/node_modules/tsx/dist/cli.mjs" "C:/arcade/node-scratch-maker/scripts/start-importer.ts" --open
```

The importer never writes this tools entry or any collection launch settings. Pegasus metadata rescanning varies by version: restart Pegasus after importing if the new game is not visible. Automatic rescanning/restarting is not implemented, and Pegasus/browser return behavior must be tested on the arcade.

## Environment configuration and Pegasus

Static settings are read from environment variables, or automatically from `.env` in the current working directory. Existing environment variables take precedence. Run commands from `node-scratch-maker` and create a local configuration from the example:

```powershell
Copy-Item .env.example .env
```

Edit `.env` for your arcade machine:

```dotenv
PEGASUS_DIR=./arcade
PEGASUS_COLLECTION=Coding Pirates
IMPORTER_LANGUAGE=da
```

| Variable | Purpose | Default |
| --- | --- | --- |
| `PEGASUS_DIR` | Directory containing an existing `metadata.pegasus.txt`; setting it enables registration | Disabled |
| `PEGASUS_COLLECTION` | Existing collection name in that metadata file | `Coding Pirates` |
| `SCRATCH_OUTPUT_DIR` | Directory for generated HTML files | `PEGASUS_DIR/games`, or the current directory without Pegasus |
| `IMPORTER_PORT` | Loopback HTTP port for the student importer | `4173` |
| `IMPORTER_LANGUAGE` | Page language: `en` (English) or `da` (Danish) | `en` |
| `IMPORTER_BROWSER` | Chrome, Edge, or Chromium executable for `importer:launch` | Auto-detected on Windows/Linux |

Relative directories resolve from the current working directory. An optional relative output filename resolves under the configured output directory; absolute output paths still work.

The metadata file and named collection must already exist. The CLI throws an error before downloading or packaging if either is missing; it never creates them. Configure the collection to include the generated HTML files, for example with this existing collection definition:

```text
collection: Coding Pirates
extensions: html
```

Collection settings, including file discovery rules and collection-level launch commands, remain under manual control. The CLI does not read, validate, or write launch commands; generated games inherit the existing collection's launch configuration.

After configuration, the command only needs a project URL:

```sh
yarn package 123456789
```

After successfully writing the HTML, the CLI adds or updates only game entries within the named collection's section in the existing `metadata.pegasus.txt`, with the title, author (for Scratch URLs), and game path. Repackaging the same Scratch ID updates its generated entry in that section rather than appending a duplicate. Direct SB3 URLs use the output path as their identity and the source filename as their title.

Generated entries are bounded by `node-scratch-maker` comment markers. Collection definitions, other collection sections, and hand-written metadata outside those blocks are preserved; existing unmarked entries are not automatically migrated. Metadata updates use a temporary file followed by a rename. Imports targeting the same collection directory are protected by the shared import lock.

Add `PEGASUS_DIR` to Pegasus's game directories once, then restart Pegasus after adding games. Configure the browser to keep its launched process alive until the game closes, and provide an exit control on the arcade so players can return to Pegasus. Test this on the target machine, since browser process reuse can affect returning to the frontend.

Omit `PEGASUS_DIR` to package HTML without changing Pegasus metadata. `.env` and the default `arcade` output directory are ignored by Git.

## Development

### Localization

The importer supports English and Danish using i18next. Set `IMPORTER_LANGUAGE=da` in `.env` for Danish, or `IMPORTER_LANGUAGE=en` for English (the default when unset), then restart the importer. Unsupported values are rejected at startup. Language is controlled only by configuration: there is no page selector, and browser preferences and previously saved language choices are ignored.

Translation catalogs are in `locales/en.ts` and `locales/da.ts`. Edit `da.ts` to adjust Danish wording. English defines the translation keys, and TypeScript checks that the Danish catalog includes every key. Preserve named interpolation values such as `{{author}}` and `{{status}}`. Tests verify matching keys and interpolation values.

Labels, tooltips, accessible names, progress, validation, and server errors are translated. Scratch project titles, creator names, and the configured Pegasus collection name are left unchanged. The Danish on-screen keyboard also includes the three Danish letters. The CLI keeps its English output; API responses include stable localization keys for the browser.

To add another language, add a typed catalog and register it in `scripts/localization.ts` (resources, supported locales, and configuration validation).

The CLI and tests run directly from TypeScript using `tsx`; no build step is required. Type checking uses the strict package-local `tsconfig.json`.

```sh
yarn typecheck
yarn test
```

Browser tests use an isolated server on port 4178 with mocked Scratch/import responses; they never install real games. They run on desktop and mobile Chromium, including simulated gamepad input:

```sh
yarn playwright install chromium
yarn test:browser
```

Scratch projects must be shared/public. Node.js 20.12 or newer is required for native `.env` loading. The TurboWarp Packager Node API is beta and may change between package versions; the dependency is pinned exactly in `package.json`.