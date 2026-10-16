import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {getConfiguration} from './pegasus.ts';
import {getOutputPath, importProject, parseProjectUrl, parseScratchProject} from './project.ts';
import type {ImportDependencies} from './project.ts';

const dependencies: Partial<ImportDependencies> = {
  fetch: async () => new Response('project data'),
  package: async () => '<html>new game</html>'
};

test('accepts Scratch IDs and URLs but keeps external URLs out of the student importer', () => {
  assert.equal(parseScratchProject(' 12345 ').id, '12345');
  assert.equal(parseScratchProject('https://scratch.mit.edu/projects/12345/').id, '12345');
  assert.throws(() => parseScratchProject('https://example.com/game.sb3'), /public Scratch/);
  assert.throws(() => parseScratchProject('https://scratch.mit.edu.evil.test/projects/123/'));
  assert.throws(() => parseScratchProject('https://user:secret@scratch.mit.edu/projects/123/'));
  assert.throws(() => parseScratchProject('../123'));
  assert.equal(parseProjectUrl('https://example.com/game.sb3').kind, 'file');
});

test('successful installation updates the existing entry and keeps collection settings', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-install-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const config = getConfiguration({PEGASUS_DIR: directory, SCRATCH_OUTPUT_DIR: directory});
  const metadataPath = path.join(directory, 'metadata.pegasus.txt');
  const header = 'collection: Coding Pirates\nextensions: html\nlaunch: existing-browser\n';
  await writeFile(metadataPath, header);
  const source = parseProjectUrl('https://example.com/game.sb3');
  const result = await importProject(config, source, {}, dependencies);
  assert.equal(result.updated, false);
  assert.equal(await readFile(result.outputPath, 'utf8'), '<html>new game</html>');
  const updated = await importProject(config, source, {}, dependencies);
  assert.equal(updated.updated, true);
  const metadata = await readFile(metadataPath, 'utf8');
  assert.ok(metadata.startsWith(header));
  assert.equal(metadata.match(/# BEGIN node-scratch-maker/g)?.length, 1);
  assert.deepEqual((await readdir(directory)).sort(), ['game.html', 'metadata.pegasus.txt']);
});

test('failed registration restores both the installed HTML and metadata', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-rollback-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const config = getConfiguration({PEGASUS_DIR: directory, SCRATCH_OUTPUT_DIR: directory});
  const source = parseProjectUrl('https://example.com/game.sb3');
  const outputPath = getOutputPath(config, source);
  const metadataPath = path.join(directory, 'metadata.pegasus.txt');
  const metadata = 'collection: Coding Pirates\nextensions: html\n';
  await writeFile(metadataPath, metadata);
  await writeFile(outputPath, 'old game');
  await assert.rejects(importProject(config, source, {}, {
    ...dependencies,
    register: async () => {
      await writeFile(metadataPath, 'partially updated metadata');
      throw new Error('registration failed');
    }
  }), /registration failed/);
  assert.equal(await readFile(outputPath, 'utf8'), 'old game');
  assert.equal(await readFile(metadataPath, 'utf8'), metadata);
  assert.deepEqual((await readdir(directory)).sort(), ['game.html', 'metadata.pegasus.txt']);
});

test('failed packaging leaves the installed game unchanged and releases its lock', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-failure-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const config = getConfiguration({SCRATCH_OUTPUT_DIR: directory});
  const source = parseProjectUrl('https://example.com/game.sb3');
  await writeFile(getOutputPath(config, source), 'old game');
  await assert.rejects(importProject(config, source, {}, {
    ...dependencies, package: async () => { throw new Error('packaging failed'); }
  }), /packaging failed/);
  assert.equal(await readFile(getOutputPath(config, source), 'utf8'), 'old game');
  assert.deepEqual(await readdir(directory), ['game.html']);
});

test('an existing import lock prevents another installation', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-lock-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  await writeFile(path.join(directory, '.scratch-import.lock'), '');
  const config = getConfiguration({SCRATCH_OUTPUT_DIR: directory});
  await assert.rejects(importProject(config, parseProjectUrl('https://example.com/game.sb3'), {}, dependencies), /Another game/);
});