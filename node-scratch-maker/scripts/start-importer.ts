import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {getConfiguration} from './pegasus.ts';
import {loadEnvironment} from './project.ts';
import {createImportServer} from './server.ts';
import {getBrowserArguments, shouldOpenBrowser} from './browser.ts';

const require = createRequire(import.meta.url);
declare const RELEASE_BUILD: boolean;
const releaseBuild = typeof RELEASE_BUILD !== 'undefined' && RELEASE_BUILD;

const main = async (): Promise<void> => {
  if (releaseBuild) process.chdir(fileURLToPath(new URL('..', import.meta.url)));
  loadEnvironment();
  const portText = process.env.IMPORTER_PORT || '4173';
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    throw new Error('IMPORTER_PORT must be a number between 1 and 65535.');
  }
  const openBrowser = shouldOpenBrowser(process.argv.slice(2), releaseBuild);
  const url = `http://127.0.0.1:${portText}`;
  const script = releaseBuild ? await readFile(new URL('../web/app.js', import.meta.url)) : (await (await import('esbuild')).build({
    entryPoints: [fileURLToPath(new URL('../web/app.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', minify: true
  })).outputFiles[0]?.contents;
  if (!script) throw new Error('Could not build the importer interface.');
  let browser: ChildProcess | undefined;
  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    const closed = new Promise<void>((resolve) => app.server.close(() => resolve()));
    await app.waitForIdle();
    browser?.kill();
    await closed;
  };
  const app = createImportServer(getConfiguration(), {
    onExit: openBrowser ? () => { void shutdown(); } : undefined,
    assets: {
      '/': {body: await readFile(new URL('../web/index.html', import.meta.url)), contentType: 'text/html; charset=utf-8'},
      '/style.css': {body: await readFile(new URL('../web/style.css', import.meta.url)), contentType: 'text/css; charset=utf-8'},
      '/app.js': {body: script, contentType: 'text/javascript; charset=utf-8'},
      '/font-arcade.woff2': {body: await readFile(releaseBuild ? new URL('../web/font-arcade.woff2', import.meta.url) : require.resolve('@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2')), contentType: 'font/woff2'},
      '/assets/pirates_8bit_transparent.png': {body: await readFile(new URL('../web/assets/pirates_8bit_transparent.png', import.meta.url)), contentType: 'image/png'}
    }
  });
  app.server.listen(Number(portText), '127.0.0.1');
  try {
    await once(app.server, 'listening');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') {
      throw new Error(`Port ${portText} is already in use. Close the other importer or set a different IMPORTER_PORT.`);
    }
    throw error;
  }
  console.log(`Scratch importer: ${url}`);
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
  if (openBrowser) {
    const candidates = process.platform === 'win32' ? [
      path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
    ] : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/snap/bin/chromium'];
    const executable = process.env.IMPORTER_BROWSER || candidates.find((candidate) => existsSync(candidate));
    if (!executable) {
      await shutdown();
      throw new Error('Set IMPORTER_BROWSER to the Chrome, Edge, or Chromium executable on this arcade.');
    }
    browser = spawn(executable, getBrowserArguments(url, path.join(os.homedir(), '.scratch-importer-browser')), {
      stdio: ['ignore', 'ignore', 'inherit']
    });
    browser.once('error', (error) => {
      console.error(`Could not start the browser: ${error.message}`);
      process.exitCode = 1;
      void shutdown();
    });
    browser.once('exit', () => { void shutdown(); });
  }
};

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});