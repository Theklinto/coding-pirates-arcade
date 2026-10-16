import {createIcons, ArrowLeft, ArrowRight, Check, Delete, Keyboard, LoaderCircle, LogOut, Plus, RotateCcw, X} from 'lucide';
import type {ApiError, ImporterStatus, ImportJob, ProjectPreview} from '../scripts/protocol.ts';
import {LocalizedError} from '../scripts/localization.ts';
import {configureLocale, describeClientError, displayMessage, t, translatePage} from './localization.ts';

const icons = {ArrowLeft, ArrowRight, Check, Delete, Keyboard, LoaderCircle, LogOut, Plus, RotateCcw, X};
const element = <ElementType extends HTMLElement>(id: string): ElementType => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as ElementType;
};
const input = element<HTMLInputElement>('project-input');
const keyboard = element('keyboard');
const previewButton = element<HTMLButtonElement>('preview');
const installButton = element<HTMLButtonElement>('install');
let screen: 'entry' | 'confirm' | 'result' = 'entry';
let preview: ProjectPreview | null = null;
let fullKeyboard = false;
let pending = false;
let ready = false;
let canExit = false;
let running = false;
let lastJobId = '';
let lastJobState = '';
let lastProjectId = '';
let savedFocus: HTMLElement | null = null;
let currentJob: ImportJob | null = null;
let collectionName = '';

const refreshIcons = (): void => createIcons({icons});
const setScreen = (next: typeof screen, focusId?: string): void => {
  screen = next;
  for (const id of ['entry', 'confirm', 'result']) element(id).hidden = id !== next;
  for (const step of document.querySelectorAll<HTMLElement>('[data-step]')) {
    if (step.dataset.step === next) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  }
  if (focusId) requestAnimationFrame(() => element(focusId).focus());
};

const request = async <Result>(route: string, data?: unknown): Promise<Result> => {
  const response = await fetch(`/api/${route}`, data === undefined ? {cache: 'no-store'} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
  });
  const result = await response.json() as Result & ApiError;
  if (!response.ok) throw new LocalizedError(result.localizedMessage?.key || 'unknownError', result.localizedMessage?.values);
  return result as Result;
};

const updateInput = (key: string): void => {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (key === 'clear') {
    input.value = '';
    input.setSelectionRange(0, 0);
  } else {
    const from = key === 'delete' && start === end ? Math.max(0, start - 1) : start;
    const text = key === 'delete' ? '' : key;
    if (input.value.length - (end - from) + text.length > input.maxLength) return;
    input.value = input.value.slice(0, from) + text + input.value.slice(end);
    input.setSelectionRange(from + text.length, from + text.length);
  }
  if (ready) displayMessage('entry-error');
};

const renderKeyboard = (): void => {
  keyboard.classList.toggle('full', fullKeyboard);
  const keys = fullKeyboard
    ? [...t('keyboardCharacters'), 'clear', 'delete']
    : ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'delete'];
  keyboard.replaceChildren(...keys.map((key) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.key = key;
    if (key === 'delete') {
      button.innerHTML = '<i data-lucide="delete"></i>';
      button.setAttribute('aria-label', t('backspace'));
      button.title = t('backspace');
    } else button.textContent = key === 'clear' ? t('clear') : key;
    button.addEventListener('click', () => updateInput(key));
    return button;
  }));
  refreshIcons();
};
const updateKeyboardMode = (): void => {
  const button = element('keyboard-mode');
  button.setAttribute('aria-pressed', String(fullKeyboard));
  button.setAttribute('aria-label', t(fullKeyboard ? 'numberKeypad' : 'fullKeyboard'));
  button.title = button.getAttribute('aria-label') || '';
  input.inputMode = fullKeyboard ? 'url' : 'numeric';
};
element('keyboard-mode').addEventListener('click', () => {
  fullKeyboard = !fullKeyboard;
  updateKeyboardMode();
  renderKeyboard();
});

const renderPreview = (): void => {
  if (!preview) return;
  element('confirm-title').textContent = preview.title;
  element('author').textContent = t('byAuthor', {author: preview.author || t('scratchCreator')});
  element('project-type').textContent = t(preview.installed ? 'updateGame' : 'newGame');
  element('project-number').textContent = t('projectNumber', {id: preview.id});
  const image = element<HTMLImageElement>('thumbnail');
  image.alt = t('thumbnail', {title: preview.title});
  installButton.innerHTML = `<i data-lucide="${preview.installed ? 'rotate-ccw' : 'plus'}"></i><span>${t(preview.installed ? 'updateGame' : 'addGame')}</span>`;
  refreshIcons();
};

const findProject = async (): Promise<void> => {
  if (pending) return;
  if (!input.value.trim()) { displayMessage('entry-error', {key: 'enterProject'}); return; }
  if (!ready) return;
  savedFocus = document.activeElement as HTMLElement;
  pending = true;
  previewButton.disabled = true;
  previewButton.querySelector('span')!.textContent = t('findingGame');
  displayMessage('entry-error');
  try {
    preview = await request<ProjectPreview>('preview', {input: input.value});
    renderPreview();
    const image = element<HTMLImageElement>('thumbnail');
    image.hidden = false;
    image.src = preview.thumbnail;
    image.onerror = () => { image.hidden = true; };
    displayMessage('confirm-error');
    setScreen('confirm', 'install');
    refreshIcons();
  } catch (error) {
    displayMessage('entry-error', describeClientError(error));
    savedFocus?.focus();
  } finally {
    pending = false;
    previewButton.disabled = false;
    previewButton.querySelector('span')!.textContent = t('findGame');
  }
};
previewButton.addEventListener('click', () => { void findProject(); });
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); void findProject(); }
});
input.addEventListener('input', () => { if (ready) displayMessage('entry-error'); });

const back = (): void => {
  if (pending || running) return;
  if (screen === 'confirm') {
    setScreen('entry');
    requestAnimationFrame(() => (savedFocus?.isConnected ? savedFocus : previewButton).focus());
  } else if (screen === 'result') reset();
  else if (canExit) element('exit').click();
};
element('back').addEventListener('click', back);

const renderJobText = (job: ImportJob): void => {
  const importing = job.state === 'running';
  element('result-title').textContent = t(importing ? 'importingGame' : job.state === 'success' ? 'gameReady' : 'importFailed');
  element('result-eyebrow').textContent = t(importing ? 'pleaseWait' : job.state === 'success' ? (job.updated ? 'gameUpdated' : 'gameAdded') : 'error');
  if (job.state === 'success' && job.title) {
    displayMessage('result-description');
    element('result-description').textContent = job.title;
  } else displayMessage('result-description', job.localizedMessage || {
    key: job.state === 'error' ? 'unknownError' : job.state === 'success' ? 'progressReady' : 'importingGame'
  });
};

const showJob = (job: ImportJob): void => {
  currentJob = job;
  running = job.state === 'running';
  element<HTMLButtonElement>('exit').disabled = running;
  const changed = lastJobId !== job.id || lastJobState !== job.state;
  lastJobId = job.id;
  lastJobState = job.state;
  lastProjectId = job.projectId;
  if (running || changed) setScreen('result');
  element('result-actions').hidden = running;
  element<HTMLProgressElement>('progress').value = job.percent;
  element('progress').hidden = !running;
  renderJobText(job);
  if (!changed) return;
  const symbol = element('result-symbol');
  symbol.className = `result-symbol${running ? ' busy' : job.state === 'error' ? ' failed' : ''}`;
  symbol.innerHTML = `<i data-lucide="${running ? 'loader-circle' : job.state === 'error' ? 'x' : 'check'}"></i>`;
  element('retry').hidden = job.state !== 'error';
  if (!running) requestAnimationFrame(() => element(job.state === 'error' ? 'retry' : 'again').focus());
  refreshIcons();
};

const install = async (): Promise<void> => {
  const projectId = preview?.id || lastProjectId;
  if (!projectId || pending || running) return;
  pending = true;
  installButton.disabled = true;
  try {
    const job = await request<ImportJob>('import', {input: projectId});
    showJob(job);
  } catch (error) {
    displayMessage(screen === 'result' ? 'result-description' : 'confirm-error', describeClientError(error));
  } finally {
    pending = false;
    installButton.disabled = false;
  }
};
installButton.addEventListener('click', () => { void install(); });
element('retry').addEventListener('click', () => { void install(); });
const reset = (): void => {
  if (running) return;
  input.value = '';
  preview = null;
  lastProjectId = '';
  if (ready) displayMessage('entry-error');
  setScreen('entry');
  requestAnimationFrame(() => keyboard.querySelector<HTMLButtonElement>('button')?.focus());
};
element('again').addEventListener('click', reset);
element('exit').addEventListener('click', () => {
  if (!running && canExit) void request('exit', {}).catch((error: unknown) => {
    displayMessage(screen === 'entry' ? 'entry-error' : screen === 'confirm' ? 'confirm-error' : 'result-description', describeClientError(error));
  });
});

const poll = async (): Promise<void> => {
  try {
    const status = await request<ImporterStatus>('status');
    if (await configureLocale(status.language)) renderTranslations();
    ready = status.ready;
    canExit = status.canExit;
    element('exit').hidden = !canExit;
    collectionName = status.collection;
    element('collection').textContent = collectionName;
    element('connection-dot').classList.toggle('ready', ready);
    previewButton.disabled = pending || !ready;
    if (!ready && screen === 'entry') displayMessage('entry-error', status.localizedError || {key: 'checkSetup'});
    if (status.job && (status.job.state === 'running' || status.job.id !== lastJobId || status.job.state !== lastJobState)) showJob(status.job);
  } catch {
    if (running) displayMessage('result-description', {key: 'connectionLost'});
    else if (screen === 'entry') displayMessage('entry-error', {key: 'arcadeNotResponding'});
  } finally {
    window.setTimeout(() => { void poll(); }, 1000);
  }
};

const focusables = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]')]
  .filter((item) => item.getClientRects().length > 0);
const move = (direction: 'left' | 'right' | 'up' | 'down'): void => {
  const items = focusables();
  const active = document.activeElement as HTMLElement;
  if (!items.includes(active)) { keyboard.querySelector<HTMLButtonElement>('button')?.focus(); return; }
  const rectangle = active.getBoundingClientRect();
  const centerX = rectangle.left + rectangle.width / 2;
  const centerY = rectangle.top + rectangle.height / 2;
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  const candidates = items.filter((item) => item !== active).map((item) => {
    const bounds = item.getBoundingClientRect();
    const deltaX = bounds.left + bounds.width / 2 - centerX;
    const deltaY = bounds.top + bounds.height / 2 - centerY;
    const along = (horizontal ? deltaX : deltaY) * sign;
    const across = Math.abs(horizontal ? deltaY : deltaX);
    return {item, along, score: along + across * 3};
  }).filter((candidate) => candidate.along > 8).sort((first, second) => first.score - second.score);
  candidates[0]?.item.focus();
};
document.addEventListener('keydown', (event) => {
  const directions: Record<string, 'left' | 'right' | 'up' | 'down'> = {ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down'};
  const direction = directions[event.key];
  if (direction) { event.preventDefault(); move(direction); }
  if (event.key === 'Escape' || event.key === 'BrowserBack') { event.preventDefault(); back(); }
  if (event.key === 'Enter' && document.activeElement === document.body) { event.preventDefault(); keyboard.querySelector<HTMLButtonElement>('button')?.focus(); }
});

let lastAction = '';
let repeatAt = 0;
const gamepadFrame = (time: number): void => {
  const pads = navigator.getGamepads?.() || [];
  const pad = [...pads].find((candidate) => candidate?.connected);
  let action = '';
  if (pad) {
    const pressed = (index: number): boolean => !!pad.buttons[index]?.pressed;
    const axisX = pad.axes[0] || 0;
    const axisY = pad.axes[1] || 0;
    action = pressed(1) ? 'back' : pressed(0) ? 'select' : pressed(14) || axisX < -.55 ? 'left'
      : pressed(15) || axisX > .55 ? 'right' : pressed(12) || axisY < -.55 ? 'up' : pressed(13) || axisY > .55 ? 'down' : '';
  }
  if (action && (action !== lastAction || (time >= repeatAt && action !== 'select' && action !== 'back'))) {
    repeatAt = time + (action !== lastAction ? 400 : 140);
    if (action === 'select') {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement) void findProject();
      else if (active instanceof HTMLElement && focusables().includes(active)) active.click();
      else focusables()[0]?.focus();
    } else if (action === 'back') back();
    else move(action as 'left' | 'right' | 'up' | 'down');
  }
  lastAction = action;
  requestAnimationFrame(gamepadFrame);
};
const renderTranslations = (): void => {
  const focusedKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
  translatePage();
  element('collection').textContent = collectionName || t('connecting');
  previewButton.querySelector('span')!.textContent = t(pending && screen === 'entry' ? 'findingGame' : 'findGame');
  updateKeyboardMode();
  renderKeyboard();
  renderPreview();
  if (currentJob && screen === 'result') renderJobText(currentJob);
  if (focusedKey) [...keyboard.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.dataset.key === focusedKey)?.focus();
};
renderTranslations();
refreshIcons();
requestAnimationFrame(() => keyboard.querySelector<HTMLButtonElement>('button')?.focus());
requestAnimationFrame(gamepadFrame);
void poll();