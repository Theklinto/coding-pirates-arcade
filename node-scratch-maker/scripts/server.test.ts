import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {getConfiguration} from './pegasus.ts';
import type {Configuration} from './pegasus.ts';
import {createImportServer} from './server.ts';
import type {ApiError, ImporterStatus, ProjectPreview} from './protocol.ts';

test('local API previews, serializes imports, reports status, and rejects unsafe requests', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scratch-api-'));
  const config: Configuration = getConfiguration({PEGASUS_DIR: directory});
  await writeFile(path.join(directory, 'metadata.pegasus.txt'), 'collection: Coding Pirates\nextensions: html\n');
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const app = createImportServer(config, {dependencies: {
    fetch: async (input) => String(input).includes('api/projects')
      ? Response.json({title: 'Space Race', author: {username: 'Student'}, project_token: 'private-token'})
      : new Response('project data'),
    package: async () => { await gate; return '<html>game</html>'; }
  }});
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  context.after(async () => {
    release?.();
    await app.waitForIdle();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    await rm(directory, {recursive: true, force: true});
  });
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (route: string, input: string, origin = base) => fetch(base + route, {
    method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body: JSON.stringify({input})
  });
  assert.equal((await post('/api/import', '123', 'https://evil.test')).status, 403);
  const invalidPreview = await post('/api/preview', 'https://example.com/game.sb3');
  assert.equal(invalidPreview.status, 400);
  assert.equal((await invalidPreview.json() as ApiError).localizedMessage?.key, 'publicScratchOnly');
  const previewResponse = await post('/api/preview', '123');
  const preview = await previewResponse.json() as ProjectPreview;
  assert.equal(preview.title, 'Space Race');
  assert.equal(preview.installed, false);
  assert.ok(!JSON.stringify(preview).includes('private-token'));
  assert.equal((await post('/api/import', '123')).status, 202);
  assert.equal((await post('/api/import', '456')).status, 409);
  release?.();
  await app.waitForIdle();
  const status = await (await fetch(base + '/api/status')).json() as ImporterStatus;
  assert.equal(status.job?.state, 'success');
  assert.equal(status.language, 'en');
  assert.equal(status.job?.title, 'Space Race');
  assert.equal(status.job?.localizedMessage?.key, 'progressReady');
  assert.equal((await (await post('/api/preview', '123')).json() as ProjectPreview).installed, true);
  assert.match(await readFile(path.join(directory, 'games', 'Scratch-project-123.html'), 'utf8'), /game/);
});

test('unconfigured arcade starts in a recoverable not-ready state', async (context) => {
  const app = createImportServer(getConfiguration({IMPORTER_LANGUAGE: 'da'}));
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  context.after(() => new Promise<void>((resolve) => app.server.close(() => resolve())));
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const status = await (await fetch(`http://127.0.0.1:${address.port}/api/status`)).json() as ImporterStatus;
  assert.equal(status.ready, false);
  assert.equal(status.language, 'da');
  assert.match(status.error || '', /Ask an adult/);
  assert.equal(status.localizedError?.key, 'arcadeUnconfigured');
});