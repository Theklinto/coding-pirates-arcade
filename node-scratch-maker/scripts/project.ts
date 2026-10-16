import {copyFile, mkdir, open, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {registerGame, validatePegasusCollection} from './pegasus.ts';
import type {Configuration, ProjectSource} from './pegasus.ts';
import {englishMessage, LocalizedError} from './localization.ts';
import type {LocalizedMessage} from './localization.ts';
import type {MessageKey} from '../locales/en.ts';

interface ScratchMetadata {
  project_token?: string;
  title?: string;
  author?: {username?: string};
}

export interface ProjectDetails {
  source: ProjectSource;
  title: string;
  author?: string;
  downloadUrl: string;
  thumbnail?: string;
}

export interface ImportProgress {
  message: string;
  localizedMessage?: LocalizedMessage;
  percent: number;
}

export interface ImportDependencies {
  fetch: typeof fetch;
  package: (data: Uint8Array) => Promise<Uint8Array | string>;
  register: typeof registerGame;
}

const MAX_PROJECT_SIZE = 100 * 1024 * 1024;
const isMissing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';

export const loadEnvironment = (): void => {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
};

export const parseProjectUrl = (input: string): ProjectSource => {
  const value = input.trim();
  const scratch = (id: string): ProjectSource => ({kind: 'scratch', id, name: `Scratch-project-${id}`});
  if (/^[1-9]\d{0,19}$/.test(value)) return scratch(value);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LocalizedError('invalidProjectUrl');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new LocalizedError('invalidProtocol');
  }
  if (['scratch.mit.edu', 'www.scratch.mit.edu'].includes(url.hostname)) {
    const id = url.pathname.match(/^\/projects\/([1-9]\d{0,19})\/?$/)?.[1];
    if (!id) throw new LocalizedError('invalidScratchId');
    return scratch(id);
  }
  let filename: string;
  try {
    filename = decodeURIComponent(path.posix.basename(url.pathname));
  } catch {
    throw new LocalizedError('invalidFilename');
  }
  if (!filename.toLowerCase().endsWith('.sb3')) {
    throw new LocalizedError('unsupportedSource');
  }
  return {kind: 'file', url: url.href, name: filename.replace(/\.sb3$/i, '')};
};

export const parseScratchProject = (input: string): ProjectSource & {kind: 'scratch'} => {
  const source = parseProjectUrl(input);
  if (source.kind !== 'scratch') throw new LocalizedError('publicScratchOnly');
  return source;
};

export const getProjectDetails = async (source: ProjectSource, fetcher = fetch): Promise<ProjectDetails> => {
  if (source.kind === 'file') return {source, title: source.name, downloadUrl: source.url};
  const response = await fetcher(`https://trampoline.turbowarp.org/api/projects/${source.id}`, {
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new LocalizedError(response.status === 404 ? 'projectNotFound' : 'scratchUnavailable', {status: response.status});
  }
  const metadata: ScratchMetadata = await response.json();
  if (!metadata.project_token) throw new LocalizedError('projectNotShared');
  return {
    source,
    title: metadata.title || source.name,
    author: metadata.author?.username,
    downloadUrl: `https://projects.scratch.mit.edu/${source.id}?token=${encodeURIComponent(metadata.project_token)}`,
    thumbnail: `https://uploads.scratch.mit.edu/get_image/project/${source.id}_480x360.png`
  };
};

export const getOutputPath = (config: Configuration, source: ProjectSource, requestedOutput?: string): string => {
  const filename = source.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').trim() || 'scratch-project';
  const outputPath = path.resolve(config.outputDir, requestedOutput || `${filename}.html`);
  if (path.extname(outputPath).toLowerCase() !== '.html') throw new LocalizedError('outputHtmlOnly');
  return outputPath;
};

const downloadProject = async (url: string, fetcher: typeof fetch): Promise<Uint8Array> => {
  const response = await fetcher(url, {signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw new LocalizedError('downloadFailed', {status: response.status});
  if (Number(response.headers.get('content-length')) > MAX_PROJECT_SIZE) {
    await response.body?.cancel();
    throw new LocalizedError('projectTooLarge');
  }
  if (!response.body) throw new LocalizedError('emptyDownload');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_PROJECT_SIZE) {
        await reader.cancel();
        throw new LocalizedError('projectTooLarge');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new LocalizedError('emptyDownload');
  return Buffer.concat(chunks, size);
};

const packageHtml = async (data: Uint8Array): Promise<Uint8Array | string> => {
  const {default: api} = await import('@turbowarp/packager');
  const packager = new api.Packager();
  packager.project = await api.loadProject(data);
  packager.options.target = 'html';
  packager.options.autoplay = true;
  return (await packager.package()).data;
};

export const importProject = async (
  config: Configuration,
  source: ProjectSource,
  options: {output?: string; onProgress?: (progress: ImportProgress) => void} = {},
  dependencies: Partial<ImportDependencies> = {}
) => {
  await validatePegasusCollection(config);
  const outputPath = getOutputPath(config, source, options.output);
  const lockPath = path.join(config.pegasusDir || path.dirname(outputPath), '.scratch-import.lock');
  if (!config.pegasusDir) await mkdir(path.dirname(outputPath), {recursive: true});
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new LocalizedError('anotherImport');
    }
    throw error;
  }
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  const backupPath = `${temporaryPath}.backup`;
  let backup = false;
  let installed = false;
  let committed = false;
  let rollbackComplete = false;
  let metadataSnapshot: Buffer | undefined;
  const metadataPath = config.pegasusDir ? path.join(config.pegasusDir, 'metadata.pegasus.txt') : undefined;
  const progress = (key: MessageKey, percent: number): void => options.onProgress?.({
    message: englishMessage({key}), localizedMessage: {key}, percent
  });
  try {
    progress('progressFinding', 10);
    const details = await getProjectDetails(source, dependencies.fetch || fetch);
    progress('progressDownloading', 25);
    const data = await downloadProject(details.downloadUrl, dependencies.fetch || fetch);
    progress('progressBuilding', 45);
    const html = await (dependencies.package || packageHtml)(data);
    await mkdir(path.dirname(outputPath), {recursive: true});
    await writeFile(temporaryPath, html);
    progress('progressSaving', 90);
    if (metadataPath) metadataSnapshot = await readFile(metadataPath);
    try {
      await copyFile(outputPath, backupPath, constants.COPYFILE_EXCL);
      backup = true;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await rename(temporaryPath, outputPath);
    installed = true;
    await (dependencies.register || registerGame)(config, {outputPath, source, title: details.title, author: details.author});
    progress('progressReady', 100);
    committed = true;
    return {outputPath, title: details.title, updated: backup};
  } catch (error) {
    if (installed) {
      try {
        if (backup) await rename(backupPath, outputPath);
        else await rm(outputPath, {force: true});
        if (metadataPath && metadataSnapshot) {
          const restorePath = `${metadataPath}.${randomUUID()}.tmp`;
          try {
            await writeFile(restorePath, metadataSnapshot);
            await rename(restorePath, metadataPath);
          } finally {
            await rm(restorePath, {force: true});
          }
        }
        rollbackComplete = true;
      } catch (rollbackError) {
        throw new LocalizedError('restoreFailed', {path: backupPath}, {cause: new AggregateError([error, rollbackError])});
      }
    }
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, {force: true});
    await rm(temporaryPath, {force: true});
    if (!installed || committed || rollbackComplete) await rm(backupPath, {force: true});
  }
};