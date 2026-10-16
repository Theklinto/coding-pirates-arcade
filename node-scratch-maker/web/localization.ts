import {createLocalization, LocalizedError} from '../scripts/localization.ts';
import type {Locale, LocalizedMessage} from '../scripts/localization.ts';
import type {MessageKey} from '../locales/en.ts';

const instance = createLocalization();
const messages = new Map<string, LocalizedMessage>();

export const t = (key: MessageKey, values?: LocalizedMessage['values']): string => instance.t(key, values);

export const displayMessage = (id: string, value?: LocalizedMessage): void => {
  const target = document.getElementById(id);
  if (value) messages.set(id, value);
  else messages.delete(id);
  if (target) target.textContent = value ? t(value.key, value.values) : '';
};

export const describeClientError = (error: unknown): LocalizedMessage => {
  if (error instanceof LocalizedError) return error.localizedMessage;
  return {key: error instanceof TypeError ? 'arcadeNotResponding' : 'unknownError'};
};

export const translatePage = (): void => {
  document.documentElement.lang = instance.resolvedLanguage || 'en';
  document.title = t('pageTitle');
  for (const target of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    target.textContent = t(target.dataset.i18n as MessageKey);
  }
  for (const attribute of ['aria-label', 'title']) {
    for (const target of document.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      const key = target.getAttribute(`data-i18n-${attribute}`) as MessageKey;
      target.setAttribute(attribute, t(key));
    }
  }
  for (const [id, value] of messages) displayMessage(id, value);
};

export const configureLocale = async (locale: Locale): Promise<boolean> => {
  if (instance.resolvedLanguage === locale) return false;
  await instance.changeLanguage(locale);
  return true;
};