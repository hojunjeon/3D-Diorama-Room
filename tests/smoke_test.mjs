import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const ROOT = resolve(import.meta.dirname, '..');
const RECORD_DEMO = process.argv.includes('--record-demo');
const DEMO_FRAMES = join(ROOT, 'test-artifacts', 'demo-frames-v2');
const DEMO_VIDEO = join(ROOT, 'demo-interactions-and-room-tools.mp4');
const POSE_QA_DIR = join(ROOT, 'test-artifacts', 'interaction-poses');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
};

const checks = [];
const runtimeErrors = [];

function record(name, status, detail = '') {
  checks.push({ name, status, ...(detail ? { detail } : {}) });
}

async function required(name, fn) {
  try {
    await fn();
    record(name, 'PASS');
  } catch (error) {
    record(name, 'FAIL', error.message);
    throw error;
  }
}

async function optional(name, fn, reason) {
  try {
    await fn();
    record(name, 'PASS');
  } catch (error) {
    record(name, 'SKIP', reason || error.message);
  }
}

function wait(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

async function waitFor(fn, timeout = 7000, interval = 80) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(interval);
  }
  throw new Error(lastError ? `Timed out: ${lastError.message}` : `Timed out after ${timeout}ms`);
}

function allReady(value) {
  if (value === true) return true;
  if (Array.isArray(value)) return value.length > 0 && value.every(allReady);
  if (!value || typeof value !== 'object') return false;
  if (typeof value.ready === 'boolean' && !value.ready) return false;
  if (Object.hasOwn(value, 'assets')) return allReady(value.assets);
  if (typeof value.ready === 'boolean' && Object.keys(value).every(key => key === 'ready' || key === 'status' || typeof value[key] === 'string')) return true;
  const values = Object.entries(value)
    .filter(([key, child]) => key !== 'ready' && key !== 'status' && typeof child !== 'string')
    .map(([, child]) => child);
  return values.length > 0 && values.every(allReady);
}

async function waitForInteractionAssets(page) {
  return waitFor(async () => {
    const readiness = await page.evaluate('PhysicalDiorama.getInteractionAssetsReady()');
    return allReady(readiness) ? readiness : false;
  }, 15000, 100);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  const executable = candidates.filter(Boolean).find(existsSync);
  if (!executable) throw new Error(`Chrome/Edge executable not found; checked ${candidates.join(', ')}`);
  return executable;
}

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent((request.url || '/').split('?')[0]);
      const pathname = requestPath === '/' ? '/index.html' : requestPath;
      const filePath = resolve(ROOT, `.${normalize(pathname)}`);
      if (relative(ROOT, filePath).startsWith('..') || relative(ROOT, filePath).includes('..\\')) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
      response.end(body);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener('message', event => this.handleMessage(JSON.parse(event.data)));
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener('open', resolvePromise, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    return this;
  }

  handleMessage(message) {
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) || []) listener(message.params || {}, message.sessionId);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  once(method, sessionId) {
    return new Promise(resolvePromise => {
      const listener = (value, eventSessionId) => {
        if (sessionId && eventSessionId !== sessionId) return;
        const listeners = this.listeners.get(method) || [];
        this.listeners.set(method, listeners.filter(candidate => candidate !== listener));
        resolvePromise(value);
      };
      this.on(method, listener);
    });
  }

  close() {
    this.socket?.close();
  }
}

async function waitForChrome(port) {
  return waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (!response.ok) return false;
      return await response.json();
    } catch {
      return false;
    }
  }, 12000, 100);
}

class BrowserPage {
  constructor(connection, sessionId, targetId) {
    this.connection = connection;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.errors = [];
    connection.on('Runtime.exceptionThrown', (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      const details = params.exceptionDetails || {};
      this.errors.push(details.exception?.description || details.text || 'Runtime exception');
    });
    connection.on('Runtime.consoleAPICalled', (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      if (!['error', 'assert'].includes(params.type)) return;
      this.errors.push((params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' '));
    });
  }

  send(method, params = {}) {
    return this.connection.send(method, params, this.sessionId);
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Evaluation failed');
    }
    return result.result?.value;
  }

  async navigate(url) {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    const loaded = this.connection.once('Page.loadEventFired', this.sessionId);
    await this.send('Page.navigate', { url });
    await Promise.race([loaded, waitFor(() => this.evaluate('document.readyState === "complete"'), 10000, 50)]);
    await waitFor(() => this.evaluate('Boolean(window.PhysicalDiorama && document.querySelector("canvas#world"))'), 10000, 50);
  }

  async setViewport(width, height, deviceScaleFactor = 1) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: false,
    });
  }

  async clearViewport() {
    await this.send('Emulation.clearDeviceMetricsOverride');
  }

  async screenshot(path) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    await writeFile(path, Buffer.from(result.data, 'base64'));
  }

  async close() {
    await this.connection.send('Target.closeTarget', { targetId: this.targetId });
  }
}

async function createPage(connection, url, width = 430, height = 900) {
  const target = await connection.send('Target.createTarget', { url: 'about:blank' });
  const attached = await connection.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const page = new BrowserPage(connection, attached.sessionId, target.targetId);
  await page.setViewport(width, height);
  await page.navigate(url);
  return page;
}

const modalConfig = {
  calendar: {
    selectors: ['#calendarModal', '#calendarDialog', '[data-modal="calendar"]', '[data-dialog="calendar"]'],
    needles: ['calendar', '달력', '일정'],
  },
  budget: {
    selectors: ['#budgetModal', '#budgetDialog', '[data-modal="budget"]', '[data-dialog="budget"]'],
    needles: ['budget', '예산', '소비'],
  },
};

function modalExpression(kind, expression) {
  const config = modalConfig[kind];
  return `(() => {
    const selectors = ${JSON.stringify(config.selectors)};
    const needles = ${JSON.stringify(config.needles)};
    const isVisible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (element.tagName !== 'DIALOG' || element.open)
        && element.getAttribute('aria-hidden') !== 'true'
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && (rect.width > 0 || rect.height > 0);
    };
    const explicit = selectors.map(selector => document.querySelector(selector)).find(Boolean);
    const root = (explicit && isVisible(explicit) ? explicit : null)
      || Array.from(document.querySelectorAll('dialog,[role="dialog"],[data-modal],[data-dialog],.modal,.modal-overlay'))
        .find(element => isVisible(element) && needles.some(needle => [
          element.id,
          String(element.className || ''),
          element.getAttribute('data-modal') || '',
          element.getAttribute('aria-label') || '',
          element.textContent || '',
        ].join(' ').toLowerCase().includes(needle)));
    return ${expression};
  })()`;
}

async function isModalOpen(page, kind) {
  return Boolean(await page.evaluate(modalExpression(kind, 'Boolean(root)')));
}

async function openModal(page, kind, hotspot) {
  await click(page, hotspot);
  await waitFor(() => isModalOpen(page, kind), 3000, 50);
}

async function selectCalendarDate(page) {
  return page.evaluate(modalExpression('calendar', `(() => {
    const dateInput = root?.querySelector('input[type="date"], [data-calendar-date-input]');
    const date = new Date().toISOString().slice(0, 10);
    if (dateInput) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(dateInput, date); else dateInput.value = date;
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
      return { selected: dateInput.value === date, value: dateInput.value };
    }
    const day = root?.querySelector('[data-calendar-date]:not([disabled]), [data-date]:not([disabled]), button.calendar-day:not([disabled]), .calendar-day:not([aria-disabled="true"])');
    if (!day) return { selected: false, value: null };
    day.click();
    return { selected: true, value: day.getAttribute('data-calendar-date') || day.getAttribute('data-date') || day.textContent?.trim() || null };
  })()`));
}

async function fillCalendarMemo(page, memo) {
  const result = await page.evaluate(modalExpression('calendar', `(() => {
    const fields = Array.from(root?.querySelectorAll('textarea, input:not([type="hidden"]):not([type="date"]), [contenteditable="true"]') || []);
    const field = fields.find(element => /memo|메모|note|일정/i.test([
      element.id,
      element.name,
      element.getAttribute('placeholder') || '',
      element.getAttribute('aria-label') || '',
      String(element.className || ''),
    ].join(' '))) || fields.find(element => element.tagName === 'TEXTAREA') || fields[0];
    if (!field) return { ok: false, value: null };
    field.focus();
    if (field.isContentEditable) {
      field.textContent = ${JSON.stringify(memo)};
    } else {
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(field, ${JSON.stringify(memo)}); else field.value = ${JSON.stringify(memo)};
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, value: field.isContentEditable ? field.textContent : field.value };
  })()`));
  assert.equal(result?.ok, true, 'Calendar memo field not found');
  assert.equal(result.value, memo, `Calendar memo did not accept ${memo}`);
}

async function clickModalSave(page, kind = 'calendar') {
  const clicked = await page.evaluate(modalExpression(kind, `(() => {
    const selectors = ['#calendarSave', '#saveCalendar', '[data-calendar-save]', '[data-action="save-calendar"]', '[data-modal-save]'];
    const explicit = selectors.map(selector => root?.querySelector(selector)).find(Boolean);
    const button = explicit || Array.from(root?.querySelectorAll('button,[role="button"],input[type="submit"]') || [])
      .find(element => /save|저장|기록|완료|done/i.test(element.textContent || element.value || element.getAttribute('aria-label') || ''));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`));
  assert.equal(clicked, true, `${kind} save control not found`);
}

async function readCalendarMemo(page) {
  return page.evaluate(modalExpression('calendar', `(() => {
    const fields = Array.from(root?.querySelectorAll('textarea, input:not([type="hidden"]):not([type="date"]), [contenteditable="true"]') || []);
    const field = fields.find(element => /memo|메모|note|일정/i.test([
      element.id,
      element.name,
      element.getAttribute('placeholder') || '',
      element.getAttribute('aria-label') || '',
      String(element.className || ''),
    ].join(' '))) || fields.find(element => element.tagName === 'TEXTAREA') || fields[0];
    return { value: field?.isContentEditable ? field.textContent : field?.value, text: root?.textContent || '' };
  })()`));
}

async function pressEscape(page) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}

async function closeModal(page, kind) {
  await pressEscape(page);
  await waitFor(async () => !(await isModalOpen(page, kind)), 3000, 50);
}

async function assertCanvasHealthy(page, baselineErrorCount = 0) {
  const canvas = await page.evaluate(`(() => {
    const element = document.querySelector('#world');
    const context = element?.getContext('2d');
    const rect = element?.getBoundingClientRect();
    return {
      width: element?.width || 0,
      height: element?.height || 0,
      visibleWidth: rect?.width || 0,
      visibleHeight: rect?.height || 0,
      hasContext: Boolean(context),
    };
  })()`);
  assert.ok(canvas?.width > 0 && canvas?.height > 0 && canvas?.visibleWidth > 0 && canvas?.visibleHeight > 0 && canvas?.hasContext, 'World canvas is not drawable');
  assert.equal(page.errors.length, baselineErrorCount, `Canvas runtime errors: ${page.errors.slice(baselineErrorCount).join(' | ')}`);
}

async function recordDemo(page, connection, url) {
  const fps = 10;
  let frame = 0;
  await rm(DEMO_FRAMES, { recursive: true, force: true });
  await mkdir(DEMO_FRAMES, { recursive: true });
  await connection.send('Target.activateTarget', { targetId: page.targetId });
  await page.setViewport(540, 960, 2);
  await page.navigate(`${url}/widget.html`);
  await waitForInteractionAssets(page);
  await page.evaluate('PhysicalDiorama.reset(); PhysicalDiorama.setAutonomous(false); PhysicalDiorama.setSpeed(4);');

  const setStage = async (title, detail) => page.evaluate(`(() => {
    let label = document.querySelector('#demo-stage-label');
    if (!label) {
      label = document.createElement('div');
      label.id = 'demo-stage-label';
      label.style.cssText = 'position:fixed;top:145px;left:32px;z-index:9999;padding:9px 12px;border-radius:13px;background:rgba(42,35,29,.86);color:white;box-shadow:0 7px 20px rgba(45,38,31,.22);font:800 14px/1.2 system-ui,sans-serif;letter-spacing:-.02em;pointer-events:none';
      document.body.append(label);
    }
    label.innerHTML = '<strong>' + ${JSON.stringify(title)} + '</strong><small style="display:block;margin-top:3px;opacity:.76;font:600 10px/1.2 system-ui,sans-serif">' + ${JSON.stringify(detail)} + '</small>';
  })()`);

  const capture = async seconds => {
    const count = Math.max(1, Math.round(seconds * fps));
    const interval = 1000 / fps;
    for (let index = 0; index < count; index += 1) {
      const started = Date.now();
      await page.screenshot(join(DEMO_FRAMES, `frame-${String(frame).padStart(4, '0')}.png`));
      frame += 1;
      await wait(Math.max(0, interval - (Date.now() - started)));
    }
  };

  const captureUntilMode = async (mode, maxSeconds = 6) => {
    const limit = Math.round(maxSeconds * fps);
    for (let index = 0; index < limit; index += 1) {
      const started = Date.now();
      await page.screenshot(join(DEMO_FRAMES, `frame-${String(frame).padStart(4, '0')}.png`));
      frame += 1;
      if (index >= Math.round(fps * .6) && stateHasMode(await getState(page), mode)) return;
      await wait(Math.max(0, 1000 / fps - (Date.now() - started)));
    }
    throw new Error(`Demo stage did not reach ${mode}`);
  };

  await setStage('대기', '클래식 캐릭터 · 구름빛 방');
  await capture(1.4);
  await setStage('이동', '빈 바닥을 향해 걷기');
  await page.evaluate('PhysicalDiorama.moveTo(8, 4.5)');
  await capture(2.4);
  await setStage('소파 · 앉기', '이동 → 쿠션 앞 정렬 → 자연스럽게 착석');
  await page.evaluate('PhysicalDiorama.use("sofa")');
  await captureUntilMode('sitting');
  await capture(1.4);
  await setStage('침대 · 이불 덮고 자기', '이동 → 눕기 → 이불 레이어 전환');
  await page.evaluate('PhysicalDiorama.use("bed")');
  await captureUntilMode('lying');
  await capture(1.4);
  await setStage('의자 · 앉아 공부', '책상 앞 의자에 정렬 → 집중하기');
  await page.evaluate('PhysicalDiorama.use("desk")');
  await captureUntilMode('studying');
  await capture(1.4);
  await setStage('달력 · 일정 메모 저장', '날짜 선택 → 메모 입력 → 저장 → 다시 열기');
  await openModal(page, 'calendar', '#calendarHotspot');
  await capture(1.1);
  await selectCalendarDate(page);
  await fillCalendarMemo(page, '데모 소비 기록');
  await clickModalSave(page, 'calendar');
  await wait(250);
  await capture(1.1);
  if (await isModalOpen(page, 'calendar')) await closeModal(page, 'calendar');
  await openModal(page, 'calendar', '#calendarHotspot');
  const demoMemo = await readCalendarMemo(page);
  if (!demoMemo?.value?.includes('데모 소비 기록') && !demoMemo?.text?.includes('데모 소비 기록')) throw new Error('Calendar memo was not restored in demo');
  await closeModal(page, 'calendar');
  await setStage('예산 · 카테고리 사용률', '5개 소비 카테고리 · 현재 사용률 목업');
  await openModal(page, 'budget', '#budgetHotspot');
  await capture(1.8);
  await closeModal(page, 'budget');
  await setStage('인사 · 포즈', '손 흔들기');
  await page.evaluate('PhysicalDiorama.gesture("wave")');
  await capture(2);
  await setStage('축하 · 포즈', '점프하며 양팔 들기');
  await page.evaluate('PhysicalDiorama.gesture("celebrate")');
  await capture(2);
  await setStage('둘러보기 · 포즈', '태블릿으로 주변 확인');
  await page.evaluate('PhysicalDiorama.gesture("scan")');
  await capture(2);
  await setStage('스킨 · 2 / 3', '민트 캐릭터 · 선셋 방');
  await page.evaluate('PhysicalDiorama.setRoomSkin("sunset"); PhysicalDiorama.setCharacterSkin("mint");');
  await capture(1.5);
  await setStage('스킨 · 3 / 3', '코랄 캐릭터 · 민트 방');
  await page.evaluate('PhysicalDiorama.setRoomSkin("mint"); PhysicalDiorama.setCharacterSkin("coral");');
  await capture(1.5);
  await setStage('배치 · 가구 이동', '테이블 선택 · 방향 이동');
  await page.evaluate('PhysicalDiorama.setEditMode(true); PhysicalDiorama.nudge("coffee", "left", 0.5);');
  await capture(2);
  await setStage('자율 루틴', '필요 상태에 따라 스스로 행동');
  await page.evaluate('PhysicalDiorama.setEditMode(false); PhysicalDiorama.setAutonomous(true);');
  await capture(2.5);

  const encoded = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', String(fps),
    '-i', join(DEMO_FRAMES, 'frame-%04d.png'),
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-movflags', '+faststart', '-an', DEMO_VIDEO,
  ], { encoding: 'utf8', windowsHide: true });
  if (encoded.status !== 0) throw new Error(encoded.stderr || `ffmpeg exited with ${encoded.status}`);
  await rm(DEMO_FRAMES, { recursive: true, force: true });
  return { frames: frame, fps, path: DEMO_VIDEO };
}

function stateExpression() {
  return 'window.PhysicalDiorama.getState()';
}

async function getState(page) {
  const state = await page.evaluate(stateExpression());
  const objects = state?.objects || state?.furniture || state?.room?.objects;
  if (Array.isArray(objects)) {
    state.objects = objects.map(object => {
      const position = object.position || object;
      const size = object.size || object.footprint || object;
      return {
        ...object,
        x: Number(object.x ?? position.x),
        y: Number(object.y ?? position.y),
        w: Number(object.w ?? size.w ?? size.width),
        d: Number(object.d ?? size.d ?? size.depth),
      };
    });
  }
  return state;
}

function objectCenter(object) {
  return { x: object.x + object.w / 2, y: object.y + object.d / 2 };
}

function footprintContains(object, x, y, margin = 0) {
  return x >= object.x - margin && x <= object.x + object.w + margin && y >= object.y - margin && y <= object.y + object.d + margin;
}

function overlaps(a, b, margin = 0) {
  return !(a.x + a.w + margin <= b.x || b.x + b.w + margin <= a.x || a.y + a.d + margin <= b.y || b.y + b.d + margin <= a.y);
}

function worldSize(state) {
  const room = state.room || state.bounds || {};
  return {
    width: Number(state.world?.width ?? state.world?.w ?? state.worldWidth ?? room.width ?? room.w ?? 10),
    height: Number(state.world?.height ?? state.world?.h ?? state.worldHeight ?? room.height ?? room.h ?? 8),
  };
}

function anchorPoint(object, kind, x, y) {
  const anchor = object.interaction?.[kind] || object.anchors?.[kind] || object[`${kind}Anchor`];
  if (Array.isArray(anchor) && anchor.length >= 2) return { x: x + Number(anchor[0]), y: y + Number(anchor[1]) };
  if (anchor && typeof anchor === 'object' && Number.isFinite(Number(anchor.x)) && Number.isFinite(Number(anchor.y))) {
    return anchor.relative ? { x: x + Number(anchor.x), y: y + Number(anchor.y) } : { x: Number(anchor.x), y: Number(anchor.y) };
  }
  return null;
}

function agentState(state) {
  return state?.agent || state?.character || state?.actor || {};
}

function agentMode(state) {
  const agent = agentState(state);
  return [agent.mode, agent.action, agent.state, state?.mode, state?.action].filter(Boolean).map(String);
}

function agentGesture(state) {
  const agent = agentState(state);
  return agent.gesture || agent.pose || state?.gesture || state?.pose;
}

function stateSkin(state, kind) {
  const agent = agentState(state);
  return kind === 'room'
    ? state?.roomSkin ?? state?.room?.skin ?? state?.theme ?? state?.settings?.roomSkin
    : agent.skin ?? state?.characterSkin ?? state?.settings?.characterSkin;
}

function stateHasMode(state, mode) {
  return agentMode(state).some(value => value.toLowerCase() === mode.toLowerCase())
    || (mode === 'sitting' && agentMode(state).some(value => /sit|앉/i.test(value)));
}

function isRejected(value) {
  if (value === false) return true;
  if (!value || typeof value !== 'object') return false;
  return value.accepted === false || value.ok === false || value.success === false || value.blocked === true || value.status === 'rejected';
}

function findAnchorInvalidCandidate(state) {
  const objects = state.objects || [];
  const { width, height } = worldSize(state);
  for (const source of objects.filter(object => object.interaction)) {
    for (let x = 0.25; x <= width - source.w - 0.25; x += 0.25) {
      for (let y = 0.25; y <= height - source.d - 0.25; y += 0.25) {
        const candidate = { ...source, x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
        if (Math.abs(candidate.x - source.x) < 0.2 && Math.abs(candidate.y - source.y) < 0.2) continue;
        if (objects.some(other => other.id !== source.id && overlaps(candidate, other, 0.05))) continue;
        const unusable = ['approach', 'use']
          .map(kind => anchorPoint(source, kind, candidate.x, candidate.y))
          .filter(Boolean)
          .some(anchor => anchor.x < 0.25 || anchor.x > width - 0.25 || anchor.y < 0.25 || anchor.y > height - 0.25 || objects.some(other => other.id !== source.id && footprintContains(other, anchor.x, anchor.y, 0.12)));
        if (unusable) return { source, candidate };
      }
    }
  }
  return null;
}

async function screenPoint(page, worldPoint) {
  return page.evaluate(`(() => { const canvas = document.querySelector('#world'); const rect = canvas.getBoundingClientRect(); const p = PhysicalDiorama.project(${JSON.stringify(worldPoint.x)}, ${JSON.stringify(worldPoint.y)}); return { x: rect.left + p.x, y: rect.top + p.y }; })()`);
}

async function dragObject(page, source, destination) {
  const start = await screenPoint(page, objectCenter(source));
  const end = await screenPoint(page, objectCenter(destination));
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none', buttons: 0 });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
      button: 'left',
      buttons: 1,
    });
  }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1 });
  await wait(120);
}

async function click(page, selector) {
  const clicked = await page.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
  assert.equal(clicked, true, `Missing clickable element: ${selector}`);
}

async function setSelect(page, selector, value) {
  const changed = await page.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('change', { bubbles: true })); return element.value === ${JSON.stringify(value)}; })()`);
  assert.equal(changed, true, `Missing select/value: ${selector}=${value}`);
}

async function assertMode(page, mode) {
  await waitFor(async () => {
    const state = await getState(page);
    return stateHasMode(state, mode) || new RegExp(mode === 'sitting' ? '앉|sit' : mode, 'i').test(String(await page.evaluate('document.querySelector("#agentState")?.textContent || ""')));
  }, 8000);
}

async function browserErrors(page) {
  runtimeErrors.push(...page.errors);
  if (!page.errors.length) return;
  throw new Error(`Runtime exceptions: ${page.errors.join(' | ')}`);
}

async function main() {
  const { server, url } = await startServer();
  let chrome;
  let connection;
  let indexPage;
  let widgetPage;
  const profile = await mkdtemp(join(tmpdir(), 'physical-diorama-smoke-'));
  try {
    const chromePath = findChrome();
    const debugPortServer = createServer();
    debugPortServer.listen(0, '127.0.0.1');
    await once(debugPortServer, 'listening');
    const debugPort = debugPortServer.address().port;
    debugPortServer.close();
    chrome = spawn(chromePath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-extensions',
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      '--window-size=430,900',
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    chrome.stderr.on('data', () => {});
    const browserInfo = await waitForChrome(debugPort);
    connection = await new CdpConnection(browserInfo.webSocketDebuggerUrl).connect();
    indexPage = await createPage(connection, `${url}/index.html`, 430, 900);

    await required('index.html loads with the world canvas', async () => {
      assert.equal(await indexPage.evaluate('document.title.trim().length > 0'), true);
      assert.equal(await indexPage.evaluate('Boolean(document.querySelector("canvas#world"))'), true);
      assert.equal(await indexPage.evaluate('Boolean(window.PhysicalDiorama)'), true);
    });

    await required('public PhysicalDiorama API exists', async () => {
      const methods = await indexPage.evaluate('Object.fromEntries(["use","gesture","moveTo","getState","getInteractionAssetsReady","setRoomSkin","setCharacterSkin","setAutonomous","setEditMode","project"].map(name => [name, typeof PhysicalDiorama[name]]))');
      for (const method of Object.keys(methods)) assert.equal(methods[method], 'function', `PhysicalDiorama.${method} is not a function`);
    });

    await required('soft blanket and unobstructed sofa render contract', async () => {
      const source = await readFile(join(ROOT, 'src', 'app.js'), 'utf8');
      assert.match(source, /function\s+drawSoftDuvet\s*\(/, 'Missing soft duvet renderer');
      const bedBody = source.slice(source.indexOf('function drawBed('), source.indexOf('function drawSofa('));
      const sofaBody = source.slice(source.indexOf('function drawSofa('), source.indexOf('function drawDesk('));
      assert.match(bedBody, /drawSoftDuvet\s*\(/, 'Bed foreground does not use soft duvet renderer');
      assert.doesNotMatch(sofaBody, /phase\s*===\s*['"]foreground['"][\s\S]*drawIsoBox\s*\(/, 'Sofa foreground still blocks the seated character with a box');
    });

    await indexPage.evaluate('PhysicalDiorama.setAutonomous(false); if (typeof PhysicalDiorama.setSpeed === "function") PhysicalDiorama.setSpeed(6);');
    await required('interaction pose assets finish loading before use', async () => {
      const readiness = await waitForInteractionAssets(indexPage);
      assert.equal(allReady(readiness), true, `Interaction assets are not ready: ${JSON.stringify(readiness)}`);
    });
    await mkdir(POSE_QA_DIR, { recursive: true });
    const initialState = await getState(indexPage);
    assert.ok(Array.isArray(initialState.objects) && initialState.objects.length > 0, 'getState().objects is empty');
    const sofa = initialState.objects.find(object => object.id === 'sofa' || object.type === 'sofa');
    assert.ok(sofa, 'sofa object not found');

    await required('blocked move is rejected by furniture collision', async () => {
      const blocker = initialState.objects.find(object => object.id !== sofa.id && object.w && object.d);
      assert.ok(blocker, 'no furniture blocker available');
      const center = objectCenter(blocker);
      const result = await indexPage.evaluate(`PhysicalDiorama.moveTo(${center.x}, ${center.y})`);
      assert.equal(isRejected(result), true, `moveTo accepted a furniture-occupied cell: ${JSON.stringify(result)}`);
    });

    await required('sofa use reaches sitting state', async () => {
      const baselineErrorCount = indexPage.errors.length;
      await indexPage.evaluate('PhysicalDiorama.use("sofa")');
      await assertMode(indexPage, 'sitting');
      await assertCanvasHealthy(indexPage, baselineErrorCount);
      await wait(120);
      await indexPage.screenshot(join(POSE_QA_DIR, 'sofa.png'));
    });

    await required('bed use reaches lying state with a healthy canvas', async () => {
      const baselineErrorCount = indexPage.errors.length;
      await indexPage.evaluate('PhysicalDiorama.use("bed")');
      await assertMode(indexPage, 'lying');
      await assertCanvasHealthy(indexPage, baselineErrorCount);
      await wait(120);
      await indexPage.screenshot(join(POSE_QA_DIR, 'bed.png'));
    });

    await required('desk use reaches chair-study state with a healthy canvas', async () => {
      const baselineErrorCount = indexPage.errors.length;
      await indexPage.evaluate('PhysicalDiorama.use("desk")');
      await assertMode(indexPage, 'studying');
      await assertCanvasHealthy(indexPage, baselineErrorCount);
      await wait(120);
      await indexPage.screenshot(join(POSE_QA_DIR, 'desk.png'));
    });

    await required('data-use sofa control exposes active or ARIA state', async () => {
      await click(indexPage, '[data-use="sofa"]');
      await assertMode(indexPage, 'sitting');
      const controls = await indexPage.evaluate(`Array.from(document.querySelectorAll('[data-use="sofa"]')).map(element => ({
        className: String(element.className || ''),
        ariaPressed: element.getAttribute('aria-pressed'),
        ariaCurrent: element.getAttribute('aria-current'),
        dataActive: element.getAttribute('data-active'),
      }))`);
      assert.ok(controls.length > 0, 'no [data-use="sofa"] control');
      assert.ok(controls.some(control => control.ariaPressed === 'true' || control.ariaCurrent === 'true' || control.dataActive === 'true' || /(?:^|[\\s_-])(active|is-active)(?:$|[\\s_-])/i.test(control.className)), 'sofa control has no active/ARIA state');
    });

    await required('gesture API and gesture UI update the agent', async () => {
      await indexPage.evaluate('PhysicalDiorama.gesture("wave")');
      await waitFor(async () => agentGesture(await getState(indexPage)) === 'wave', 1500);
      await click(indexPage, '[data-gesture="celebrate"]');
      await waitFor(async () => agentGesture(await getState(indexPage)) === 'celebrate', 1500);
      await indexPage.evaluate('PhysicalDiorama.reset()');
      assert.equal(agentGesture(await getState(indexPage)) ?? null, null);
    });

    await required('calendar hotspot opens a dialog and persists a saved memo', async () => {
      await openModal(indexPage, 'calendar', '#calendarHotspot');
      const selectedDate = await selectCalendarDate(indexPage);
      if (!selectedDate?.selected) record('calendar date selection control', 'SKIP', 'No selectable date control was exposed');
      const memo = `smoke memo ${Date.now()}`;
      await fillCalendarMemo(indexPage, memo);
      await clickModalSave(indexPage, 'calendar');
      await wait(250);
      if (await isModalOpen(indexPage, 'calendar')) await closeModal(indexPage, 'calendar');
      assert.equal(await isModalOpen(indexPage, 'calendar'), false, 'Calendar dialog did not close after save');
      await indexPage.navigate(`${url}/index.html`);
      await openModal(indexPage, 'calendar', '#calendarHotspot');
      if (selectedDate?.value && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate.value)) {
        const reselected = await indexPage.evaluate(modalExpression('calendar', `(() => {
          const day = root?.querySelector('[data-calendar-date="${selectedDate.value}"]');
          if (day) day.click();
          return Boolean(day);
        })()`));
        assert.equal(reselected, true, `Saved calendar date was not available after reload: ${selectedDate.value}`);
      }
      const restored = await readCalendarMemo(indexPage);
      assert.ok(restored?.value === memo || restored?.text?.includes(memo), `Calendar memo was not restored: ${JSON.stringify(restored)}`);
      await closeModal(indexPage, 'calendar');
      assert.equal(await isModalOpen(indexPage, 'calendar'), false, 'Calendar dialog did not close with Escape');
    });

    await required('budget hotspot opens five category rows with amounts and percentages', async () => {
      await openModal(indexPage, 'budget', '#budgetHotspot');
      const summary = await indexPage.evaluate(modalExpression('budget', `(() => {
        const hasAmount = text => {
          const withoutPercent = text.replace(/\\d+(?:\\.\\d+)?\\s*%/g, '');
          return /₩|원|(?:\\d{1,3},){1,}\\d{3}|\\b\\d{3,}\\b/.test(withoutPercent);
        };
        const hasPercent = text => /\\d+(?:\\.\\d+)?\\s*%/.test(text);
        const visible = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const candidateLists = [
          '[data-budget-row]',
          '.budget-row',
          '.budget-item',
          '[data-category-row]',
          '[role="row"]',
          'tbody tr',
          '.category-row',
          'li',
        ].map(selector => Array.from(root?.querySelectorAll(selector) || [])
          .map(element => ({ element, text: element.textContent?.replace(/\\s+/g, ' ').trim() || '' }))
          .filter(row => visible(row.element) && row.text && hasAmount(row.text) && hasPercent(row.text)));
        const candidates = candidateLists.find(rows => rows.length === 5) || [];
        const rows = candidates.map(({ element, text }) => ({
          text,
          category: element.querySelector('[data-budget-category], [data-category], .category-name, .budget-name')?.textContent?.trim() || text,
          hasAmount: hasAmount(text),
          hasPercent: hasPercent(text),
        }));
        return { rows, text: root?.textContent?.replace(/\\s+/g, ' ').trim() || '' };
      })()`));
      assert.equal(summary?.rows?.length, 5, `Expected five budget category rows: ${JSON.stringify(summary)}`);
      assert.ok(summary.rows.every(row => row.category && row.hasAmount && row.hasPercent), `Budget rows lack category, amount, or percentage: ${JSON.stringify(summary.rows)}`);
      await closeModal(indexPage, 'budget');
      assert.equal(await isModalOpen(indexPage, 'budget'), false, 'Budget dialog did not close with Escape');
    });

    await required('visible need values match progress elements', async () => {
      const values = await indexPage.evaluate(`Array.from(document.querySelectorAll('.meter-item')).map(item => ({
        label: item.querySelector('.meter-label strong')?.textContent,
        value: Math.round(item.querySelector('progress')?.value || 0),
      }))`);
      assert.ok(values.length >= 3);
      assert.ok(values.every(item => item.label === `${item.value}%`), JSON.stringify(values));
    });

    let expectedRoomSkin;
    let expectedCharacterSkin;
    await required('room and character skin controls change state', async () => {
      expectedRoomSkin = await indexPage.evaluate(`(() => { const element = document.querySelector('#roomSkin'); return Array.from(element.options).map(option => option.value).find(value => value !== element.value) || element.value; })()`);
      expectedCharacterSkin = await indexPage.evaluate(`(() => { const element = document.querySelector('#characterSkin'); return Array.from(element.options).map(option => option.value).find(value => value !== element.value) || element.value; })()`);
      await setSelect(indexPage, '#roomSkin', expectedRoomSkin);
      await setSelect(indexPage, '#characterSkin', expectedCharacterSkin);
      const state = await getState(indexPage);
      assert.equal(stateSkin(state, 'room') || await indexPage.evaluate('document.querySelector("#roomSkin").value'), expectedRoomSkin);
      assert.equal(stateSkin(state, 'character') || await indexPage.evaluate('document.querySelector("#characterSkin").value'), expectedCharacterSkin);
    });

    await required('localStorage-backed state survives reload', async () => {
      const moved = await indexPage.evaluate(`(() => {
        const before = PhysicalDiorama.getState().objects.find(object => object.id === 'coffee');
        const ok = PhysicalDiorama.nudge('coffee', 'left', 0.5);
        const after = PhysicalDiorama.getState().objects.find(object => object.id === 'coffee');
        return { ok, before, after };
      })()`);
      assert.equal(moved.ok, true, JSON.stringify(moved));
      assert.notDeepEqual([moved.after.x, moved.after.y], [moved.before.x, moved.before.y]);
      await wait(400);
      const beforeReload = await getState(indexPage);
      const persisted = await indexPage.evaluate(`(() => Object.entries(localStorage).some(([key, value]) => /skin|theme|room|diorama/i.test(key) || /sunset|mint|classic|coral/i.test(String(value))))()`);
      assert.equal(persisted, true, 'No localStorage state exposed by the implementation');
      await indexPage.navigate(`${url}/index.html`);
      const state = await getState(indexPage);
      assert.equal(stateSkin(state, 'room'), expectedRoomSkin);
      assert.equal(stateSkin(state, 'character'), expectedCharacterSkin);
      const restoredCoffee = state.objects.find(object => object.id === 'coffee');
      assert.deepEqual([restoredCoffee.x, restoredCoffee.y], [moved.after.x, moved.after.y]);
      for (const key of ['energy', 'focus', 'comfort']) {
        assert.ok(Math.abs(state.needs[key] - beforeReload.needs[key]) < 2, `${key} was not restored`);
      }
    });

    await required('overlap rejection is exercised through an actual furniture drag', async () => {
      const state = await getState(indexPage);
      const objects = state.objects || [];
      const source = objects.find(object => object.id === 'coffee') || objects.find(object => !object.interaction) || objects[0];
      const target = objects.find(object => object.id !== source.id && object.w && object.d);
      assert.ok(source && target, 'not enough furniture for overlap test');
      const { width, height } = worldSize(state);
      const candidate = {
        ...source,
        x: Math.max(0.25, Math.min(width - source.w - 0.25, target.x + target.w / 2 - source.w / 2)),
        y: Math.max(0.25, Math.min(height - source.d - 0.25, target.y + target.d / 2 - source.d / 2)),
      };
      assert.equal(overlaps(candidate, target, 0.05), true, 'generated target does not overlap source');
      await indexPage.evaluate('PhysicalDiorama.setEditMode(true)');
      const before = (await getState(indexPage)).objects.find(object => object.id === source.id);
      await dragObject(indexPage, before, candidate);
      const after = (await getState(indexPage)).objects.find(object => object.id === source.id);
      assert.ok(Math.abs(after.x - before.x) < 0.01 && Math.abs(after.y - before.y) < 0.01, 'overlapping furniture drag was accepted');
    });

    await required('unusable interaction-anchor placement is rejected through an actual furniture drag', async () => {
      const state = await getState(indexPage);
      const candidate = findAnchorInvalidCandidate(state);
      assert.ok(candidate, 'could not derive a non-overlapping placement with a blocked anchor');
      await indexPage.evaluate('PhysicalDiorama.setEditMode(true)');
      const before = (await getState(indexPage)).objects.find(object => object.id === candidate.source.id);
      await dragObject(indexPage, before, candidate.candidate);
      const after = (await getState(indexPage)).objects.find(object => object.id === candidate.source.id);
      assert.ok(Math.abs(after.x - before.x) < 0.01 && Math.abs(after.y - before.y) < 0.01, 'placement with unusable interaction anchor was accepted');
    });

    await required('furniture cannot be placed over the agent', async () => {
      await indexPage.evaluate('PhysicalDiorama.reset(); PhysicalDiorama.setAutonomous(false); PhysicalDiorama.setEditMode(true);');
      const state = await getState(indexPage);
      const source = state.objects.find(object => object.id === 'coffee');
      const candidate = { ...source, x: state.agent.x - source.w / 2, y: state.agent.y - source.d / 2 };
      const before = { ...source };
      await dragObject(indexPage, before, candidate);
      const after = (await getState(indexPage)).objects.find(object => object.id === source.id);
      assert.ok(Math.abs(after.x - before.x) < 0.01 && Math.abs(after.y - before.y) < 0.01, 'furniture placement over the agent was accepted');
    });

    await required('375px layout has no horizontal overflow', async () => {
      await indexPage.setViewport(375, 900);
      await indexPage.navigate(`${url}/index.html`);
      await waitForInteractionAssets(indexPage);
      const dimensions = await indexPage.evaluate('({ innerWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth })');
      assert.ok(dimensions.documentWidth <= dimensions.innerWidth + 1, JSON.stringify(dimensions));
      assert.ok(dimensions.bodyWidth <= dimensions.innerWidth + 1, JSON.stringify(dimensions));
      await openModal(indexPage, 'calendar', '#calendarHotspot');
      const calendarDialogDimensions = await indexPage.evaluate('({ innerWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth })');
      assert.ok(calendarDialogDimensions.documentWidth <= calendarDialogDimensions.innerWidth + 1, JSON.stringify(calendarDialogDimensions));
      assert.ok(calendarDialogDimensions.bodyWidth <= calendarDialogDimensions.innerWidth + 1, JSON.stringify(calendarDialogDimensions));
      await closeModal(indexPage, 'calendar');
      await openModal(indexPage, 'budget', '#budgetHotspot');
      const budgetDialogDimensions = await indexPage.evaluate('({ innerWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth })');
      assert.ok(budgetDialogDimensions.documentWidth <= budgetDialogDimensions.innerWidth + 1, JSON.stringify(budgetDialogDimensions));
      assert.ok(budgetDialogDimensions.bodyWidth <= budgetDialogDimensions.innerWidth + 1, JSON.stringify(budgetDialogDimensions));
      await closeModal(indexPage, 'budget');
    });

    await browserErrors(indexPage);
    record('index runtime exceptions', 'PASS');

    widgetPage = await createPage(connection, `${url}/widget.html`, 430, 900);
    await required('widget.html loads with the same public world API', async () => {
      assert.equal(await widgetPage.evaluate('document.title.includes("Widget")'), true);
      assert.equal(await widgetPage.evaluate('Boolean(document.querySelector("canvas#world") && window.PhysicalDiorama)'), true);
    });
    await required('widget interaction pose assets finish loading before use', async () => {
      const readiness = await waitForInteractionAssets(widgetPage);
      assert.equal(allReady(readiness), true, `Widget interaction assets are not ready: ${JSON.stringify(readiness)}`);
    });
    await browserErrors(widgetPage);
    record('widget runtime exceptions', 'PASS');

    await indexPage.setViewport(1440, 1180);
    await indexPage.navigate(`${url}/index.html`);
    await indexPage.evaluate('PhysicalDiorama.reset(); PhysicalDiorama.setAutonomous(true);');
    await wait(700);
    await indexPage.screenshot(join(ROOT, 'preview-desktop-v2.png'));

    await connection.send('Target.activateTarget', { targetId: widgetPage.targetId });
    await wait(200);
    const previewStart = await widgetPage.evaluate('PhysicalDiorama.reset(); PhysicalDiorama.setAutonomous(false); PhysicalDiorama.setSpeed(6); ({ ok: PhysicalDiorama.use("sofa"), state: PhysicalDiorama.getState() })');
    assert.equal(previewStart.ok, true, JSON.stringify(previewStart.state));
    await waitFor(async () => stateHasMode(await getState(widgetPage), 'sitting'), 8000);
    await wait(250);
    await widgetPage.screenshot(join(ROOT, 'preview-mobile-v2.png'));
    record('desktop and mobile previews captured', 'PASS');
    await browserErrors(indexPage);
    await browserErrors(widgetPage);
    record('preview flow runtime exceptions', 'PASS');
    if (RECORD_DEMO) {
      const recording = await recordDemo(widgetPage, connection, url);
      await browserErrors(widgetPage);
      record('interactions and room tools demo video recorded', 'PASS', `${recording.frames} frames at ${recording.fps}fps: ${recording.path}`);
    }

    console.log(JSON.stringify({ status: 'PASS', checks, runtimeExceptions: runtimeErrors }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', checks, runtimeExceptions: runtimeErrors, error: error.stack || error.message }, null, 2));
    process.exitCode = 1;
  } finally {
    await indexPage?.close().catch(() => {});
    await widgetPage?.close().catch(() => {});
    connection?.close();
    if (chrome && !chrome.killed) chrome.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    server.close();
  }
}

await main();
