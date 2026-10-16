import {chmod, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {zipSync} from 'fflate';
import type {Zippable} from 'fflate';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const readme = `SCRATCH IMPORTER

Requirements: Node.js 20.12 or newer, Chrome/Edge/Chromium, and internet access.
No Git, Yarn, TypeScript, or dependency installation is needed on the arcade.

1. Extract the ZIP into a writable directory on the arcade.
2. Copy .env.example to .env. Set PEGASUS_DIR to your existing game directory,
   PEGASUS_COLLECTION to the existing collection, and IMPORTER_LANGUAGE to en or da.
   Prefer absolute paths for the Pegasus and output directories.
3. Windows: run start.cmd. Linux: run sh start.sh.
   Set IMPORTER_BROWSER in .env if the browser cannot be detected.
4. For Pegasus, copy the appropriate pegasus-*.example.txt to
   metadata.pegasus.txt in this directory and add this directory to Pegasus.
   Do not copy both platform examples. These examples define the importer tool,
   not the Scratch games collection; no game metadata is created automatically.

The release opens the website automatically in browser kiosk mode (--kiosk).
For a server-only session: node scripts/importer.mjs --no-browser
For the CLI: node scripts/package-project.mjs <project-url-or-id>
The UI is served at http://127.0.0.1:4173 (override with IMPORTER_PORT).
Closing the importer returns to Pegasus. Restart Pegasus if new games do not appear.

To upgrade, stop the importer and replace the program files, preserving .env
and your game files. Include the complete scripts directory and its scaffolding
subdirectory. Do not extract over an active import.
`;

const windowsLauncher = '@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nnode "%~dp0scripts\\importer.mjs" --open %*\r\nexit /b %errorlevel%\r\n';
const linuxLauncher = '#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\nexec node ./scripts/importer.mjs --open "$@"\n';

const pegasusExample = (file: string, command: string): string => `collection: Arcade tools\nfile: ${file}\n\ngame: Add or update a Scratch game\nfile: ${file}\nlaunch: ${command} "{file.path}"\n`;

const copyNotices = async (inputs: string[], destination: string): Promise<void> => {
  const packages = new Set<string>();
  for (const input of inputs) {
    let directory = path.dirname(path.resolve(projectRoot, input));
    while (directory !== path.dirname(directory)) {
      try {
        const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as {name?: string};
        if (metadata.name) {
          if (directory !== projectRoot) packages.add(directory);
          break;
        }
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      }
      directory = path.dirname(directory);
    }
  }
  const fontPackage = path.dirname(require.resolve('@fontsource/press-start-2p/package.json'));
  packages.add(fontPackage);
  const notices: string[] = ['Third-party packages included in this release.\n'];
  for (const directory of [...packages].sort()) {
    const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as {
      name: string; version: string; license?: string;
    };
    notices.push(`${metadata.name} ${metadata.version} (${metadata.license || 'see license files'})`);
    const licenseFiles = (await readdir(directory)).filter((name) => /^(licen[sc]e|copying|notice|ofl|readme)(?:[.-]|$)/i.test(name));
    const licenseDir = path.join(destination, 'licenses', metadata.name.replace(/[^a-z0-9.-]/gi, '_'));
    await mkdir(licenseDir, {recursive: true});
    await copyFile(path.join(directory, 'package.json'), path.join(licenseDir, 'package.json'));
    for (const filename of licenseFiles) await copyFile(path.join(directory, filename), path.join(licenseDir, filename));
  }
  await writeFile(path.join(destination, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n') + '\n');
};

export const buildRelease = async (outputDirectory = path.join(projectRoot, 'dist')) => {
  const metadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')) as {version: string};
  const name = `scratch-importer-${metadata.version}`;
  await mkdir(outputDirectory, {recursive: true});
  const temporaryDirectory = await mkdtemp(path.join(outputDirectory, '.release-'));
  const stage = path.join(temporaryDirectory, name);
  const webDirectory = path.join(stage, 'web');
  try {
    await mkdir(path.join(webDirectory, 'assets'), {recursive: true});
    const browser = await build({
      absWorkingDir: projectRoot, entryPoints: ['web/app.ts'], outfile: path.join(webDirectory, 'app.js'),
      bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
      metafile: true, legalComments: 'linked'
    });
    const runtime = await build({
      absWorkingDir: projectRoot,
      entryPoints: {'scripts/importer': 'scripts/start-importer.ts', 'scripts/package-project': 'scripts/package-project.ts'},
      outdir: stage, outExtension: {'.js': '.mjs'}, bundle: true, platform: 'node',
      format: 'esm', target: 'node20', define: {RELEASE_BUILD: 'true'},
      external: ['esbuild'], minifySyntax: true, metafile: true, legalComments: 'linked',
      banner: {js: "import {createRequire as releaseRequire} from 'node:module';\nimport {fileURLToPath as releaseFilePath} from 'node:url';\nimport {dirname as releaseDirname} from 'node:path';\nconst require = releaseRequire(import.meta.url);\nconst __filename = releaseFilePath(import.meta.url);\nconst __dirname = releaseDirname(__filename);"}
    });
    await cp(path.dirname(require.resolve('@turbowarp/packager')), path.join(stage, 'scripts'), {
      recursive: true,
      filter: (source) => path.basename(source) !== 'packager.js'
    });
    for (const filename of ['index.html', 'style.css', 'assets/pirates_8bit_transparent.png']) {
      await copyFile(path.join(projectRoot, 'web', filename), path.join(webDirectory, filename));
    }
    await copyFile(require.resolve('@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2'), path.join(webDirectory, 'font-arcade.woff2'));
    await copyFile(path.join(projectRoot, '.env.example'), path.join(stage, '.env.example'));
    await writeFile(path.join(stage, 'start.cmd'), windowsLauncher);
    await writeFile(path.join(stage, 'start.sh'), linuxLauncher);
    await chmod(path.join(stage, 'start.sh'), 0o755);
    await writeFile(path.join(stage, 'README.txt'), readme);
    await writeFile(path.join(stage, 'pegasus-windows.example.txt'), pegasusExample('start.cmd', 'cmd /c'));
    await writeFile(path.join(stage, 'pegasus-linux.example.txt'), pegasusExample('start.sh', 'sh'));
    await copyNotices([...Object.keys(browser.metafile.inputs), ...Object.keys(runtime.metafile.inputs)], stage);
    const files: Zippable = {};
    const addFiles = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, {withFileTypes: true})) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) await addFiles(fullPath);
        else {
          const relative = path.relative(temporaryDirectory, fullPath).split(path.sep).join('/');
          files[relative] = [await readFile(fullPath), {os: 3, attrs: (entry.name === 'start.sh' ? 0o100755 : 0o100644) << 16}];
        }
      }
    };
    await addFiles(stage);
    const archivePath = path.join(outputDirectory, `${name}.zip`);
    const releasePath = path.join(outputDirectory, name);
    const temporaryArchive = path.join(temporaryDirectory, `${name}.zip`);
    await writeFile(temporaryArchive, zipSync(files, {level: 6}));
    await rm(releasePath, {recursive: true, force: true});
    await rename(stage, releasePath);
    await rename(temporaryArchive, archivePath);
    return {releasePath, archivePath, name};
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildRelease().then(({releasePath, archivePath}) => {
    console.log(`Release folder: ${releasePath}`);
    console.log(`Ship this ZIP: ${archivePath}`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}