import {access} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import {validatePegasusCollection} from './pegasus.ts';
import type {Configuration} from './pegasus.ts';
import {getOutputPath, getProjectDetails, importProject, parseScratchProject} from './project.ts';
import type {ImportDependencies} from './project.ts';
import type {ImportJob, ImporterStatus, ProjectPreview} from './protocol.ts';
import {describeError, englishMessage, LocalizedError} from './localization.ts';
import type {LocalizedMessage} from './localization.ts';
import type {MessageKey} from '../locales/en.ts';

export interface StaticAsset {
  body: string | Uint8Array;
  contentType: string;
}

class HttpError extends LocalizedError {
  readonly status: number;

  constructor(status: number, key: MessageKey) {
    super(key);
    this.status = status;
  }
}

const sendJson = (response: ServerResponse, status: number, data: unknown): void => {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  response.end(JSON.stringify(data));
};

const readInput = async (request: IncomingMessage): Promise<string> => {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw new HttpError(415, 'jsonOnly');
  }
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > 4096) throw new HttpError(413, 'inputTooLong');
  }
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new HttpError(400, 'invalidInput');
  }
  if (!data || typeof data !== 'object' || !('input' in data) || typeof data.input !== 'string' || data.input.length > 300) {
    throw new HttpError(400, 'invalidInput');
  }
  return data.input;
};

export const createImportServer = (
  config: Configuration,
  options: {assets?: Record<string, StaticAsset>; dependencies?: Partial<ImportDependencies>; onExit?: () => void} = {}
) => {
  let job: ImportJob | null = null;
  let task: Promise<void> = Promise.resolve();
  const ensureReady = async (): Promise<void> => {
    if (!config.pegasusDir) throw new LocalizedError('arcadeUnconfigured');
    await validatePegasusCollection(config);
  };
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://uploads.scratch.mit.edu; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    void (async () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new HttpError(503, 'starting');
      const host = request.headers.host;
      if (![ `127.0.0.1:${address.port}`, `localhost:${address.port}` ].includes(host || '')) {
        throw new HttpError(403, 'localOnly');
      }
      const origin = `http://${host}`;
      const url = new URL(request.url || '/', origin);
      if (request.method === 'POST' && request.headers.origin !== origin) {
        throw new HttpError(403, 'originRequired');
      }
      if (request.method === 'GET' && url.pathname === '/api/status') {
        let localizedError: LocalizedMessage | undefined;
        try { await ensureReady(); } catch (cause) { localizedError = describeError(cause); }
        const status: ImporterStatus = {
          service: 'scratch-importer', collection: config.collection, language: config.language,
          ready: !localizedError, canExit: !!options.onExit,
          error: localizedError ? englishMessage(localizedError) : undefined, localizedError, job
        };
        sendJson(response, 200, status);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/exit') {
        if (job?.state === 'running') throw new HttpError(409, 'waitForImport');
        if (!options.onExit) throw new HttpError(409, 'notLaunchedFromPegasus');
        sendJson(response, 200, {closed: true});
        setImmediate(options.onExit);
        return;
      }
      if (request.method === 'POST' && ['/api/preview', '/api/import'].includes(url.pathname)) {
        const source = parseScratchProject(await readInput(request));
        await ensureReady();
        if (url.pathname === '/api/preview') {
          const details = await getProjectDetails(source, options.dependencies?.fetch || fetch);
          let installed = false;
          try {
            await access(getOutputPath(config, source));
            installed = true;
          } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
          }
          const preview: ProjectPreview = {
            id: source.id, title: details.title, author: details.author || '',
            thumbnail: details.thumbnail || '', installed
          };
          sendJson(response, 200, preview);
          return;
        }
        if (job?.state === 'running') throw new HttpError(409, 'importBusy');
        const current: ImportJob = {
          id: randomUUID(), projectId: source.id, state: 'running', message: englishMessage({key: 'startingImport'}),
          localizedMessage: {key: 'startingImport'}, percent: 0
        };
        job = current;
        task = importProject(config, source, {
          onProgress: (progress) => Object.assign(current, progress)
        }, options.dependencies).then((result) => {
          Object.assign(current, {state: 'success', message: englishMessage({key: 'progressReady'}),
            localizedMessage: {key: 'progressReady'}, percent: 100, title: result.title, updated: result.updated});
        }).catch((error: unknown) => {
          const localizedMessage = describeError(error);
          Object.assign(current, {state: 'error', message: englishMessage(localizedMessage), localizedMessage});
        });
        sendJson(response, 202, current);
        return;
      }
      const asset = options.assets?.[url.pathname];
      if (request.method === 'GET' && asset) {
        response.writeHead(200, {'Content-Type': asset.contentType});
        response.end(asset.body);
        return;
      }
      throw new HttpError(404, 'notFound');
    })().catch((error: unknown) => {
      const localizedMessage = describeError(error);
      if (!response.headersSent) sendJson(response, error instanceof HttpError ? error.status : 400, {
        error: englishMessage(localizedMessage), localizedMessage
      });
      else response.end();
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return {server, waitForIdle: () => task};
};