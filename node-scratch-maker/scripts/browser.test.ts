import assert from 'node:assert/strict';
import test from 'node:test';
import {getBrowserArguments, shouldOpenBrowser} from './browser.ts';

test('release launch opens the website by default and supports explicit server-only mode', () => {
  assert.equal(shouldOpenBrowser([], true), true);
  assert.equal(shouldOpenBrowser(['--open'], true), true);
  assert.equal(shouldOpenBrowser(['--no-browser'], true), false);
  assert.equal(shouldOpenBrowser(['--open', '--no-browser'], true), false);
  assert.equal(shouldOpenBrowser([], false), false);
  assert.equal(shouldOpenBrowser(['--open'], false), true);
});

test('browser receives kiosk flags and the actual importer URL as separate arguments', () => {
  const url = 'http://127.0.0.1:4567';
  const args = getBrowserArguments(url, 'C:/Arcade User/browser profile');
  assert.ok(args.includes('--kiosk'));
  assert.ok(args.includes('--new-window'));
  assert.ok(args.includes('--user-data-dir=C:/Arcade User/browser profile'));
  assert.equal(args.at(-1), url);
  assert.ok(!args.some((argument) => argument.startsWith('--app=')));
});