import assert from 'node:assert/strict';
import test from 'node:test';
import {en} from '../locales/en.ts';
import {da} from '../locales/da.ts';
import type {MessageKey} from '../locales/en.ts';
import {createLocalization, describeError, LocalizedError, resolveLocale} from './localization.ts';

test('Danish translations cover every English key and preserve interpolation values', () => {
  assert.deepEqual(Object.keys(da).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as MessageKey[]) {
    assert.ok(da[key].trim(), key);
    const variables = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(variables(da[key]), variables(en[key]), key);
  }
});

test('language selection uses the configured flag and validates supported languages', () => {
  assert.equal(resolveLocale(), 'en');
  assert.equal(resolveLocale('en'), 'en');
  assert.equal(resolveLocale('da'), 'da');
  assert.equal(resolveLocale(' DA '), 'da');
  assert.throws(() => resolveLocale('fr'), /IMPORTER_LANGUAGE must be en or da/);
  assert.throws(() => resolveLocale(''), /IMPORTER_LANGUAGE must be en or da/);
});

test('messages interpolate safely and errors retain English CLI output with translatable codes', () => {
  const instance = createLocalization('da');
  assert.equal(instance.t('byAuthor', {author: '<Student>'}), 'af <Student>');
  const error = new LocalizedError('scratchUnavailable', {status: 503});
  assert.match(error.message, /HTTP 503/);
  assert.equal(instance.t(error.localizedMessage.key, error.localizedMessage.values), 'Scratch er ikke tilgængelig (HTTP 503). Prøv igen.');
  assert.deepEqual(describeError(new TypeError('fetch failed')), {key: 'networkUnavailable'});
});