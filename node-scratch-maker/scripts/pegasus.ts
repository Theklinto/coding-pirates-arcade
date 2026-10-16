import {readFile, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {LocalizedError, resolveLocale} from './localization.ts';
import type {Locale} from './localization.ts';

export type ProjectSource =
  | {kind: 'scratch'; id: string; name: string}
  | {kind: 'file'; url: string; name: string};

export interface Configuration {
  pegasusDir: string | null;
  collection: string;
  outputDir: string;
  language: Locale;
}

export interface GameRegistration {
  outputPath: string;
  source: ProjectSource;
  title?: string;
  author?: string;
}

const singleLine = (value: string): string => value.replace(/[\r\n\u0000]+/g, ' ').trim();

export const getConfiguration = (env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Configuration => {
  const pegasusDir = env.PEGASUS_DIR ? path.resolve(cwd, env.PEGASUS_DIR) : null;
  const collection = env.PEGASUS_COLLECTION || 'Coding Pirates';
  if (pegasusDir && (!collection.trim() || /[\r\n\u0000]/.test(collection))) {
    throw new LocalizedError('collectionInvalid');
  }
  return {
    pegasusDir,
    collection,
    language: resolveLocale(env.IMPORTER_LANGUAGE),
    outputDir: env.SCRATCH_OUTPUT_DIR
      ? path.resolve(cwd, env.SCRATCH_OUTPUT_DIR)
      : pegasusDir ? path.join(pegasusDir, 'games') : cwd
  };
};

export const validatePegasusCollection = async (config: Configuration) => {
  if (!config.pegasusDir) return;

  const metadataPath = path.join(config.pegasusDir, 'metadata.pegasus.txt');
  let existing: string;
  try {
    existing = await readFile(metadataPath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new LocalizedError('metadataMissing', {path: metadataPath});
    }
    throw error;
  }
  const collections = [...existing.matchAll(/^collection:[\t ]*([^\r\n]*)(?:\r?\n|$)/gim)];
  const collectionIndex = collections.findIndex((match) => match[1]?.trim() === config.collection);
  const collection = collections[collectionIndex];
  if (!collection) {
    throw new LocalizedError('collectionMissing', {collection: config.collection, path: metadataPath});
  }
  const start = collection.index + collection[0].length;
  const end = collections[collectionIndex + 1]?.index ?? existing.length;
  return {metadataPath, existing, start, end};
};

export const registerGame = async (config: Configuration, {outputPath, source, title, author}: GameRegistration) => {
  const metadata = await validatePegasusCollection(config);
  if (!metadata || !config.pegasusDir) return;

  const {metadataPath, existing, start, end: sectionEnd} = metadata;
  const relativePath = path.relative(config.pegasusDir, outputPath).split(path.sep).join('/');
  if (/[\r\n\u0000]/.test(relativePath)) {
    throw new LocalizedError('gamePathInvalid');
  }
  const identity = source.kind === 'scratch' ? `scratch:${source.id}` : `file:${relativePath}`;
  const key = Buffer.from(identity).toString('base64url');
  const begin = `# BEGIN node-scratch-maker ${key}`;
  const end = `# END node-scratch-maker ${key}`;
  const lines = [
    begin,
    `game: ${singleLine(title || source.name) || 'Scratch project'}`,
    `file: ${relativePath}`
  ];
  if (author) lines.push(`developer: ${singleLine(author)}`);
  if (source.kind === 'scratch') lines.push(`x-scratch-id: ${source.id}`);
  lines.push(end);

  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const block = lines.join(newline);
  const managedBlock = new RegExp(`^${begin}\r?\n[\\s\\S]*?^${end}(?=\r?$)`, 'm');
  const section = existing.slice(start, sectionEnd);
  const updatedSection = managedBlock.test(section)
    ? section.replace(managedBlock, () => block)
    : `${section}${section && !section.endsWith('\n') ? newline : ''}${newline}${block}${newline}${newline}`;
  const prefix = existing.slice(0, start);
  const updated = `${prefix}${prefix.endsWith('\n') ? '' : newline}${updatedSection}${existing.slice(sectionEnd)}`;

  const temporaryPath = `${metadataPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, updated, 'utf8');
    await rename(temporaryPath, metadataPath);
  } finally {
    await rm(temporaryPath, {force: true});
  }
  return metadataPath;
};