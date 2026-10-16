import type {Locale, LocalizedMessage} from './localization.ts';

export interface ApiError {
  error: string;
  localizedMessage?: LocalizedMessage;
}

export interface ProjectPreview {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  installed: boolean;
}

export interface ImportJob {
  id: string;
  projectId: string;
  state: 'running' | 'success' | 'error';
  message: string;
  localizedMessage?: LocalizedMessage;
  percent: number;
  title?: string;
  updated?: boolean;
}

export interface ImporterStatus {
  service: 'scratch-importer';
  collection: string;
  language: Locale;
  ready: boolean;
  canExit: boolean;
  error?: string;
  localizedError?: LocalizedMessage;
  job: ImportJob | null;
}