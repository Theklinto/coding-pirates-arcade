import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getConfiguration, registerGame} from './pegasus.ts';
import type {GameRegistration} from './pegasus.ts';

test('configuration preserves standalone defaults and resolves environment paths', () => {
  const cwd = path.resolve('test-root');
  assert.equal(getConfiguration({}, cwd).outputDir, cwd);
  assert.equal(getConfiguration({}, cwd).pegasusDir, null);
  assert.equal(getConfiguration({}, cwd).language, 'en');
  assert.equal(getConfiguration({IMPORTER_LANGUAGE: 'da'}, cwd).language, 'da');
  assert.throws(() => getConfiguration({IMPORTER_LANGUAGE: 'fr'}, cwd), /IMPORTER_LANGUAGE/);
  const config = getConfiguration({PEGASUS_DIR: 'arcade'}, cwd);
  assert.equal(config.outputDir, path.join(cwd, 'arcade', 'games'));
  assert.equal(config.collection, 'Coding Pirates');
  assert.equal(getConfiguration({SCRATCH_OUTPUT_DIR: 'exports'}, cwd).outputDir, path.join(cwd, 'exports'));
  assert.throws(() => getConfiguration({
    PEGASUS_DIR: 'arcade', PEGASUS_COLLECTION: 'Pirates\ninvalid'
  }, cwd), /single-line/);
});

test('registration appends and updates only games in an existing collection', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-pegasus-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const config = getConfiguration({
    PEGASUS_DIR: directory,
    PEGASUS_COLLECTION: 'Pirates'
  });
  const game: GameRegistration = {
    outputPath: path.join(config.outputDir, 'first game.html'),
    source: {kind: 'scratch', id: '123', name: 'Scratch-project-123'},
    title: 'First game', author: 'Creator'
  };
  const metadataPath = path.join(directory, 'metadata.pegasus.txt');
  const header = 'collection: Pirates\nextensions: html\nlaunch: original-browser "{file.uri}"\n';
  const otherCollection = 'collection: Other\nfile: other.html\ngame: Manual game\nfile: other.html\n';
  await writeFile(metadataPath, header + '\n' + otherCollection);
  assert.equal(await registerGame(config, game), metadataPath);
  let contents = await readFile(metadataPath, 'utf8');
  assert.ok(contents.startsWith(header));
  assert.ok(contents.endsWith(otherCollection));
  assert.equal(contents.match(/^collection:/gm)?.length, 2);
  assert.equal(contents.match(/^launch:/gm)?.length, 1);
  assert.match(contents, /game: First game\nfile: games\/first game.html/);
  assert.match(contents, /developer: Creator\nx-scratch-id: 123/);
  const manual = '# Hand-written metadata\r\n';
  await writeFile(metadataPath, manual + contents.replaceAll('\n', '\r\n'));
  await registerGame(config, {...game, title: 'Updated $&\nTitle', outputPath: path.join(config.outputDir, 'renamed.html')});
  await registerGame(config, {
    outputPath: path.join(config.outputDir, 'second.html'),
    source: {kind: 'file', url: 'https://example.com/second.sb3', name: 'Second game'}
  });
  contents = await readFile(metadataPath, 'utf8');
  assert.ok(contents.startsWith(manual));
  assert.ok(contents.includes(header.replaceAll('\n', '\r\n')));
  assert.ok(contents.endsWith(otherCollection.replaceAll('\n', '\r\n')));
  assert.equal(contents.match(/x-scratch-id: 123/g)?.length, 1);
  assert.match(contents, /game: Updated \$& Title/);
  assert.match(contents, /file: games\/renamed.html/);
  assert.doesNotMatch(contents, /first game.html/);
  assert.match(contents, /game: Second game/);
  assert.equal(contents.match(/# BEGIN node-scratch-maker/g)?.length, 2);
  assert.ok(!contents.replaceAll('\r\n', '').includes('\n'));
  await registerGame(config, {
    outputPath: path.join(config.outputDir, 'second.html'),
    source: {kind: 'file', url: 'https://example.com/second.sb3', name: 'Second game updated'}
  });
  contents = await readFile(metadataPath, 'utf8');
  assert.equal(contents.match(/# BEGIN node-scratch-maker/g)?.length, 2);
  assert.match(contents, /game: Second game updated/);
  assert.equal(contents.match(/^launch:/gm)?.length, 1);
});

test('registration rejects missing metadata and missing collections without creating them', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-missing-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const config = getConfiguration({PEGASUS_DIR: directory});
  const game: GameRegistration = {
    outputPath: path.join(config.outputDir, 'game.html'),
    source: {kind: 'scratch', id: '123', name: 'Game'}
  };
  const metadataPath = path.join(directory, 'metadata.pegasus.txt');
  await assert.rejects(registerGame(config, game), /metadata file does not exist/);
  await assert.rejects(readFile(metadataPath), {code: 'ENOENT'});
  const existing = 'collection: Other\nextensions: html\n';
  await writeFile(metadataPath, existing);
  await assert.rejects(registerGame(config, game), /collection "Coding Pirates" does not exist/);
  assert.equal(await readFile(metadataPath, 'utf8'), existing);
});

test('the same game in another collection is not modified', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-collection-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const config = getConfiguration({PEGASUS_DIR: directory});
  const key = Buffer.from('scratch:123').toString('base64url');
  const other = `collection: Other\nextensions: html\n# BEGIN node-scratch-maker ${key}\ngame: Other title\nfile: other.html\n# END node-scratch-maker ${key}\n`;
  const metadataPath = path.join(directory, 'metadata.pegasus.txt');
  await writeFile(metadataPath, `collection: Coding Pirates\nextensions: html\n\n${other}`);
  const game: GameRegistration = {
    outputPath: path.join(config.outputDir, 'game.html'),
    source: {kind: 'scratch', id: '123', name: 'Game'}
  };
  await registerGame(config, game);
  await registerGame(config, {...game, title: 'Updated title'});
  const contents = await readFile(metadataPath, 'utf8');
  assert.ok(contents.endsWith(other));
  assert.match(contents, /game: Updated title/);
  assert.equal(contents.match(/# BEGIN node-scratch-maker/g)?.length, 2);
  assert.doesNotMatch(contents, /^launch:/m);
});

test('registration is a no-op without Pegasus configuration', async () => {
  assert.equal(await registerGame(getConfiguration({}), {
    outputPath: path.resolve('game.html'),
    source: {kind: 'scratch', id: '123', name: 'Game'}
  }), undefined);
});

test('CLI loads .env without launch configuration and validates metadata before downloading', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-env-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  await writeFile(path.join(directory, '.env'), 'PEGASUS_DIR=./arcade\n');
  const env = {...process.env};
  for (const name of Object.keys(env)) {
    if (/^(PEGASUS_|SCRATCH_OUTPUT_DIR$)/i.test(name)) delete env[name];
  }
  const script = fileURLToPath(new URL('./package-project.ts', import.meta.url));
  const result = spawnSync(process.execPath, [...process.execArgv, script, 'https://example.com/game.sb3'], {
    cwd: directory, env, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /metadata file does not exist/);
  assert.doesNotMatch(result.stdout, /Downloading/);
});

test('CLI shell configuration overrides .env values', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-env-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  await writeFile(path.join(directory, '.env'), 'PEGASUS_DIR=./arcade\n');
  const script = fileURLToPath(new URL('./package-project.ts', import.meta.url));
  const result = spawnSync(process.execPath, [...process.execArgv, script, 'https://example.com/game.sb3', 'invalid.txt'], {
    cwd: directory,
    env: {...process.env, PEGASUS_DIR: ''},
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /output path must end in .html/);
  assert.doesNotMatch(result.stdout, /Downloading/);
});

test('CLI rejects missing metadata before loading the packager or downloading', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-preflight-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const script = fileURLToPath(new URL('./package-project.ts', import.meta.url));
  const result = spawnSync(process.execPath, [...process.execArgv, script, 'https://example.com/game.sb3'], {
    cwd: directory,
    env: {...process.env, PEGASUS_DIR: directory},
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /metadata file does not exist/);
  assert.doesNotMatch(result.stdout, /Downloading/);
});