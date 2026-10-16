import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';
import type {ImportJob, ImporterStatus} from '../scripts/protocol.ts';
import type {Locale} from '../scripts/localization.ts';

const mockApi = async (page: Page, installed = false, initial: ImportJob | null = null, language: Locale = 'en') => {
  let job = initial;
  let imports = 0;
  await page.route('**/api/status', (route) => route.fulfill({json: {
    service: 'scratch-importer', ready: true, collection: 'Coding Pirates', language, canExit: false, job
  } satisfies ImporterStatus}));
  await page.route('**/api/preview', (route) => route.fulfill({json: {
    id: '123', title: 'Appel', author: 'griffpatch',
    thumbnail: 'https://uploads.scratch.mit.edu/get_image/project/60917032_480x360.png', installed
  }}));
  await page.route('**/api/import', async (route) => {
    expect(route.request().postDataJSON()).toEqual({input: '123'});
    imports++;
    const running: ImportJob = {id: `job-${imports}`, projectId: '123', state: 'running', message: 'Building your game', localizedMessage: {key: 'progressBuilding'}, percent: 45};
    job = {...running, state: 'success', title: 'Appel', updated: installed, percent: 100, localizedMessage: {key: 'progressReady'}};
    await route.fulfill({status: 202, json: running});
  });
  return {imports: () => imports};
};

test('keypad and arrow navigation work without a physical text keyboard', async ({page}, info) => {
  await mockApi(page);
  await page.goto('/');
  const logo = page.getByRole('img', {name: 'Coding Pirates', exact: true});
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', '/assets/pirates_8bit_transparent.png');
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('button', {name: '1', exact: true})).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Scratch project ID or URL')).toHaveValue('25');
  await page.getByRole('button', {name: 'Backspace', exact: true}).click();
  await expect(page.getByLabel('Scratch project ID or URL')).toHaveValue('2');
  await page.getByRole('button', {name: 'Switch to full keyboard'}).click();
  await page.getByRole('button', {name: 'q', exact: true}).click();
  await expect(page.getByLabel('Scratch project ID or URL')).toHaveValue('2q');
  await page.getByRole('button', {name: 'Switch to number keypad'}).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath('keypad.png'), fullPage: true});
});

for (const installed of [false, true]) {
  test(`${installed ? 'updates' : 'adds'} a game with confirmation and progress`, async ({page}) => {
    const api = await mockApi(page, installed);
    await page.goto('/');
    await page.getByLabel('Scratch project ID or URL').fill('123');
    await page.getByRole('button', {name: 'Find my game', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Appel'})).toBeVisible();
    const install = page.getByRole('button', {name: installed ? 'Update game' : 'Add game', exact: true});
    await expect(install).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', {name: 'Find my game', exact: true})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(install).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', {name: 'Game ready'})).toBeVisible();
    expect(api.imports()).toBe(1);
    await page.getByRole('button', {name: 'Add another game', exact: true}).click();
    await expect(page.getByLabel('Scratch project ID or URL')).toHaveValue('');
  });
}

test('retry works after reloading an unsuccessful import', async ({page}) => {
  const api = await mockApi(page, true, {
    id: 'previous-job', projectId: '123', state: 'error', percent: 45, message: 'Connection lost.'
  });
  await page.goto('/');
  await page.getByRole('button', {name: 'Try again', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Game ready'})).toBeVisible();
  expect(api.imports()).toBe(1);
});

test('holding gamepad select presses a key only once', async ({page}) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('button', {name: '1', exact: true})).toBeFocused();
  const value = await page.evaluate(() => new Promise<string>((resolve) => {
    const buttons = Array.from({length: 16}, () => ({pressed: false}));
    buttons[0]!.pressed = true;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true, value: () => [{connected: true, axes: [0, 0], buttons}]
    });
    let frames = 0;
    const tick = (): void => {
      if (++frames < 40) requestAnimationFrame(tick);
      else {
        buttons[0]!.pressed = false;
        resolve((document.querySelector('#project-input') as HTMLInputElement).value);
      }
    };
    requestAnimationFrame(tick);
  }));
  expect(value).toBe('1');
});

test.describe('Danish localization', () => {
  test.use({locale: 'en-US'});

  test('uses configured Danish regardless of browser or old saved preferences', async ({page}, info) => {
    await page.addInitScript(() => localStorage.setItem('pirates-arcade.locale', 'en'));
    await mockApi(page, false, null, 'da');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'da');
    await expect(page).toHaveTitle('Tilføj et spil | Pirates Arcade');
    await expect(page.getByRole('heading', {name: 'Tilføj / opdater spil'})).toBeVisible();
    await expect(page.locator('[data-locale]')).toHaveCount(0);
    await page.getByRole('button', {name: '1', exact: true}).click();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: info.outputPath('danish.png'), fullPage: true});
    await page.getByRole('button', {name: 'Skift til fuldt tastatur'}).click();
    await page.getByRole('button', {name: 'æ', exact: true}).click();
    await expect(page.getByRole('button', {name: 'ø', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'å', exact: true})).toBeVisible();
    await expect(page.getByLabel('Scratch-projekt-ID eller URL')).toHaveValue('1æ');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'da');
    await expect(page.getByRole('button', {name: '1', exact: true})).toBeFocused();
  });

  test('translates confirmation and completion without translating project data', async ({page}) => {
    await mockApi(page, false, null, 'da');
    await page.goto('/');
    await page.getByLabel('Scratch-projekt-ID eller URL').fill('123');
    await page.getByRole('button', {name: 'Find mit spil', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Appel'})).toBeVisible();
    await expect(page.locator('#author')).toHaveText('af griffpatch');
    await expect(page.locator('#thumbnail')).toHaveAttribute('alt', 'Projektbillede for Appel');
    await page.getByRole('button', {name: 'Tilføj spil', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Spillet er klar'})).toBeVisible();
    await expect(page.locator('#result-description')).toHaveText('Appel');
    await expect(page.getByRole('button', {name: 'Tilføj et spil mere', exact: true})).toBeVisible();
  });

  test('translates API errors using the configured language', async ({page}) => {
    await mockApi(page, false, null, 'da');
    await page.route('**/api/preview', (route) => route.fulfill({status: 400, json: {
      error: 'This project is not shared. Share it on Scratch, then try again.',
      localizedMessage: {key: 'projectNotShared'}
    }}));
    await page.goto('/');
    await page.getByLabel('Scratch-projekt-ID eller URL').fill('123');
    await page.getByRole('button', {name: 'Find mit spil', exact: true}).click();
    await expect(page.locator('#entry-error')).toHaveText('Projektet er ikke delt. Del det på Scratch, og prøv igen.');
    await expect(page.getByLabel('Scratch-projekt-ID eller URL')).toHaveValue('123');
  });

  test('uses the configured language for active import progress', async ({page}) => {
    await mockApi(page, false, {
      id: 'active-job', projectId: '123', state: 'running', message: 'Building your game',
      localizedMessage: {key: 'progressBuilding'}, percent: 45
    }, 'da');
    await page.goto('/');
    await expect(page.getByRole('heading', {name: 'Importerer spil'})).toBeVisible();
    await expect(page.locator('#result-description')).toHaveText('Bygger dit spil');
    await expect(page.getByRole('progressbar', {name: 'Importstatus'})).toHaveAttribute('value', '45');
  });
});

test.describe('English configuration', () => {
  test.use({locale: 'da-DK'});

  test('ignores Danish browser and saved preferences when English is configured', async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('pirates-arcade.locale', 'da'));
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByRole('button', {name: 'Find my game', exact: true})).toBeEnabled();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle('Add a Game | Pirates Arcade');
    await expect(page.locator('[data-locale]')).toHaveCount(0);
  });
});