import {createInstance} from 'i18next';
import {en} from '../locales/en.ts';
import {da} from '../locales/da.ts';
import type {MessageKey} from '../locales/en.ts';

export type Locale = 'en' | 'da';
export interface LocalizedMessage {
  key: MessageKey;
  values?: Record<string, string | number>;
}

export const resolveLocale = (value = 'en'): Locale => {
  const locale = value.trim().toLowerCase();
  if (locale === 'en' || locale === 'da') return locale;
  throw new Error('IMPORTER_LANGUAGE must be en or da.');
};

export const createLocalization = (locale: Locale = 'en') => {
  const instance = createInstance();
  void instance.init({
    lng: locale, fallbackLng: 'en', supportedLngs: ['en', 'da'],
    resources: {en: {translation: en}, da: {translation: da}},
    initImmediate: false, showSupportNotice: false, interpolation: {escapeValue: false}
  });
  return instance;
};

const english = createLocalization();
export const englishMessage = ({key, values}: LocalizedMessage): string => english.t(key, values);

export class LocalizedError extends Error {
  readonly localizedMessage: LocalizedMessage;

  constructor(key: MessageKey, values?: LocalizedMessage['values'], options?: ErrorOptions) {
    const localizedMessage = {key, values};
    super(englishMessage(localizedMessage), options);
    this.localizedMessage = localizedMessage;
  }
}

export const describeError = (error: unknown): LocalizedMessage => {
  if (error instanceof LocalizedError) return error.localizedMessage;
  if (error instanceof Error && ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)) {
    return {key: 'networkUnavailable'};
  }
  if (error instanceof Error && 'code' in error) return {key: 'fileSystemError'};
  return {key: 'unknownError'};
};