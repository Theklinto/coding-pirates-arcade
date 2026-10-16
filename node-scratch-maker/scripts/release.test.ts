import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {strToU8, unzipSync, zipSync} from 'fflate';
import test from 'node:test';
import {buildRelease} from './build-release.ts';
import type {ImporterStatus} from './protocol.ts';

test('release ZIP starts outside the repo without node_modules or development tools', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-release-'));
  const extracted = path.join(directory, 'extracted');
  context.after(() => rm(directory, {recursive: true, force: true}));
  const release = await buildRelease(path.join(directory, 'output'));
  const files = unzipSync(await readFile(release.archivePath));
  assert.ok(Object.keys(files).some((name) => name.endsWith('/start.cmd')));
  assert.ok(Object.keys(files).some((name) => name.endsWith('/start.sh')));
  assert.ok(Object.keys(files).some((name) => name.endsWith('/THIRD-PARTY-NOTICES.txt')));
  assert.ok(files[`${release.name}/scripts/scaffolding/scaffolding-min.js`]);
  assert.ok(files[`${release.name}/scripts/scaffolding/scaffolding-full.js`]);
  for (const [filename, contents] of Object.entries(files)) {
    assert.ok(!filename.includes('node_modules/'));
    assert.ok(!filename.endsWith('.ts'));
    assert.ok(!filename.endsWith('/.env'));
    const destination = path.join(extracted, filename);
    await mkdir(path.dirname(destination), {recursive: true});
    await writeFile(destination, contents);
  }
  const root = path.join(extracted, release.name);
  await writeFile(path.join(root, '.env'), 'IMPORTER_LANGUAGE=da\nIMPORTER_PORT=4197\n');
  const env: NodeJS.ProcessEnv = {...process.env, PEGASUS_DIR: '', IMPORTER_LANGUAGE: '', IMPORTER_PORT: '', NODE_PATH: ''};
  delete env.IMPORTER_LANGUAGE;
  delete env.IMPORTER_PORT;
  const cli = spawnSync(process.execPath, [path.join(root, 'scripts', 'package-project.mjs'), '--help'], {cwd: directory, env, encoding: 'utf8'});
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Usage:/);
  const project = {
    targets: [{
      isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
      currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0, tempo: 60,
      videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null
    }],
    monitors: [], extensions: [] as string[], meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
  };
  const archives = new Map([
    ['/empty.sb3', zipSync({'project.json': strToU8(JSON.stringify(project))})],
    ['/music.sb3', zipSync({'project.json': strToU8(JSON.stringify({...project, extensions: ['music']}))})]
  ]);
  const sourceServer = createServer((request, response) => { response.end(archives.get(request.url || '') || 'not a Scratch project'); });
  await new Promise<void>((resolve) => sourceServer.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => sourceServer.close(() => resolve())));
  const sourceAddress = sourceServer.address();
  assert.ok(sourceAddress && typeof sourceAddress !== 'string');
  const invalidProject = spawn(process.execPath, [
    path.join(root, 'scripts', 'package-project.mjs'), `http://127.0.0.1:${sourceAddress.port}/invalid.sb3`, 'invalid.html'
  ], {cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000});
  let packagingOutput = '';
  let packagingError = '';
  invalidProject.stdout.on('data', (chunk: Buffer) => { packagingOutput += chunk.toString(); });
  invalidProject.stderr.on('data', (chunk: Buffer) => { packagingError += chunk.toString(); });
  const packagingStatus = await new Promise<number | null>((resolve, reject) => {
    invalidProject.once('error', reject);
    invalidProject.once('exit', resolve);
  });
  assert.equal(packagingStatus, 1, packagingError);
  assert.match(packagingOutput, /Building your game/);
  assert.match(packagingError, /Error:/);
  assert.doesNotMatch(packagingError, /Cannot find module|ERR_MODULE_NOT_FOUND|Dynamic require|__dirname is not defined/);
  for (const name of ['empty', 'music']) {
    const packaged = spawn(process.execPath, [
      path.join(root, 'scripts', 'package-project.mjs'), `http://127.0.0.1:${sourceAddress.port}/${name}.sb3`, `${name}.html`
    ], {cwd: directory, env, stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000});
    let errorOutput = '';
    packaged.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString(); });
    const code = await new Promise<number | null>((resolve, reject) => {
      packaged.once('error', reject);
      packaged.once('exit', resolve);
    });
    assert.equal(code, 0, `${name}: ${errorOutput}`);
    const html = await readFile(path.join(directory, `${name}.html`), 'utf8');
    assert.match(html, /<!doctype html>/i);
    assert.ok(html.length > 1000000, `${name} should include the Scratch runtime`);
  }
  const autoLaunch = spawn(process.execPath, [path.join(root, 'scripts', 'importer.mjs')], {
    cwd: directory, env: {...env, IMPORTER_BROWSER: path.join(root, 'missing-browser')},
    stdio: ['ignore', 'ignore', 'pipe'], timeout: 20000
  });
  let launchError = '';
  autoLaunch.stderr.on('data', (chunk: Buffer) => { launchError += chunk.toString(); });
  const launchStatus = await new Promise<number | null>((resolve, reject) => {
    autoLaunch.once('error', reject);
    autoLaunch.once('exit', resolve);
  });
  assert.equal(launchStatus, 1);
  assert.match(launchError, /Could not start the browser/);
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'importer.mjs'), '--no-browser'], {cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe']});
  context.after(() => { child.kill(); });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Release did not start: ${stderr}`)); }, 20000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Release exited (${code}): ${stderr}`)); });
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('Scratch importer:')) { clearTimeout(timer); resolve(); }
    });
  });
  const base = 'http://127.0.0.1:4197';
  const status = await (await fetch(`${base}/api/status`)).json() as ImporterStatus;
  assert.equal(status.language, 'da');
  assert.equal(status.ready, false);
  for (const route of ['/', '/app.js', '/style.css', '/font-arcade.woff2', '/assets/pirates_8bit_transparent.png']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.ok((await response.arrayBuffer()).byteLength > 0, route);
  }
  await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill(); });
});