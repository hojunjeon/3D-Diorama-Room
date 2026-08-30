const canvas = document.querySelector('#world');
const ctx = canvas.getContext('2d');
const roomSkinEl = document.querySelector('#roomSkin');
const characterSkinEl = document.querySelector('#characterSkin');
const autoModeEl = document.querySelector('#autoMode');
const editModeEl = document.querySelector('#editMode');
const stateLabel = document.querySelector('#agentState');
const hintEl = document.querySelector('#hint');
const energyMeterEl = document.querySelector('#energyMeter');
const focusMeterEl = document.querySelector('#focusMeter');
const comfortMeterEl = document.querySelector('#comfortMeter');
const resetRoomEl = document.querySelector('#resetRoom');
const selectedObjectLabelEl = document.querySelector('#selectedObjectLabel');
const widgetMeterDotsEl = document.querySelector('.widget-meter-dots');
const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const cityWindow = new Image();
cityWindow.src = './assets/environment/city-window.png';

const WORLD_W = 10;
const WORLD_H = 8;
const GRID = 0.5;
const paletteMap = {
  cloud: {
    bg: '#dce7f4', wallA: '#eef2f7', wallB: '#f7f8fb', wallEdge: '#d8dee8',
    floorA: '#d9b98d', floorB: '#e6c99e', floorLine: 'rgba(137,98,52,.12)', rug: '#f4f0e9',
    woodTop: '#c99255', woodLeft: '#aa7440', woodRight: '#b98149',
    blueTop: '#9fc1f5', blueLeft: '#6f95d0', blueRight: '#81a8df',
    bedTop: '#f8fafc', bedSide: '#dfe8f2', blanketTop: '#7397d7', blanketSide: '#5478b6',
    metal: '#d4d9e1', screen: '#263044', green: '#68af62', pot: '#c99a70',
  },
  sunset: {
    bg: '#f1ddcb', wallA: '#f6e7db', wallB: '#fff4eb', wallEdge: '#e7cdb9',
    floorA: '#d3a76d', floorB: '#e1bb84', floorLine: 'rgba(123,73,30,.14)', rug: '#f3e5d6',
    woodTop: '#ba7a3d', woodLeft: '#94562a', woodRight: '#a86431',
    blueTop: '#e8a082', blueLeft: '#c96e53', blueRight: '#da8063',
    bedTop: '#fff7ef', bedSide: '#e6d5c7', blanketTop: '#cf765d', blanketSide: '#aa5644',
    metal: '#cbb7aa', screen: '#3d2d2b', green: '#669c52', pot: '#bd805a',
  },
  mint: {
    bg: '#dcece7', wallA: '#e5f0ec', wallB: '#f3f8f5', wallEdge: '#cbdcd5',
    floorA: '#dfc89d', floorB: '#ebd8b2', floorLine: 'rgba(111,90,53,.12)', rug: '#eff5f1',
    woodTop: '#c3945d', woodLeft: '#a97542', woodRight: '#b5834c',
    blueTop: '#9cd7c8', blueLeft: '#6faf9f', blueRight: '#82c1b2',
    bedTop: '#f7fbf8', bedSide: '#d9e8e1', blanketTop: '#71b9a7', blanketSide: '#509484',
    metal: '#d5ddd9', screen: '#2b3b39', green: '#68a869', pot: '#c2946e',
  },
};

const inlineAssetMap = window.PHYSICAL_DIORAMA_ASSETS || {};
const assets = { classic: {}, mint: {}, coral: {} };
const poseNames = ['idle', 'wave', 'celebrate', 'scan'];
const interactionModes = ['sitting', 'lying', 'studying'];
const interactionSheets = Object.fromEntries(Object.keys(assets).map(skin => [skin, {
  ready: false,
  cells: Object.create(null),
  source: null,
}]));

function clamp(value, min = 0, max = 100) { return Math.max(min, Math.min(max, value)); }

function createPixelCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  return output;
}

function removeMagentaChroma(context, width, height) {
  let pixels;
  try { pixels = context.getImageData(0, 0, width, height); } catch { return false; }
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const chroma = Math.min(r, b) - g;
    if (r < 130 || b < 130 || chroma < 45) continue;
    const distance = Math.hypot(r - 249, g - 4, b - 246);
    const keep = clamp((distance - 24) / 42, 0, 1);
    data[i + 3] = Math.round(data[i + 3] * keep);
  }
  try { context.putImageData(pixels, 0, 0); } catch { return false; }
  return true;
}

function processInteractionSheet(skin, image) {
  const state = interactionSheets[skin];
  if (!state || !image?.naturalWidth || !image?.naturalHeight) return;
  const cellWidth = Math.floor(image.naturalWidth / interactionModes.length);
  const cellHeight = image.naturalHeight;
  if (cellWidth < 1 || cellHeight < 1) return;
  const source = createPixelCanvas(image.naturalWidth, image.naturalHeight);
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) return;
  try { sourceContext.drawImage(image, 0, 0); } catch { return; }
  if (!removeMagentaChroma(sourceContext, source.width, source.height)) return;
  const cells = Object.create(null);
  interactionModes.forEach((mode, index) => {
    const cell = createPixelCanvas(cellWidth, cellHeight);
    const cellContext = cell.getContext('2d');
    if (!cellContext) return;
    cellContext.drawImage(source, index * cellWidth, 0, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
    // ponytail: the generated sleep pose includes shoes outside the mattress; trim only the foot edge that is fully occluded by the duvet.
    if (mode === 'lying') cellContext.clearRect(Math.floor(cellWidth * .76), 0, Math.ceil(cellWidth * .24), cellHeight);
    cells[mode] = cell;
  });
  if (interactionModes.some(mode => !cells[mode])) return;
  state.source = source;
  state.cells = cells;
  state.ready = true;
}

function interactionPose(mode, skin = agent?.skin || 'classic') {
  return interactionSheets[skin]?.ready ? interactionSheets[skin].cells[mode] : null;
}

for (const skin of Object.keys(assets)) {
  for (const pose of poseNames) {
    const image = new Image();
    image.src = inlineAssetMap?.[skin]?.[pose] || `./assets/characters/${skin}/${pose}.png`;
    assets[skin][pose] = image;
  }
  const sheet = new Image();
  sheet.onload = () => processInteractionSheet(skin, sheet);
  sheet.src = inlineAssetMap?.[skin]?.['interactions-v2'] || `./assets/characters/${skin}/interactions-v2.png`;
  interactionSheets[skin].image = sheet;
  if (sheet.complete && sheet.naturalWidth) processInteractionSheet(skin, sheet);
}

const objects = [
  {
    id: 'bed', name: '침대', type: 'bed', x: 0.75, y: 0.9, w: 3.15, d: 2.15,
    interaction: { action: 'lying', approach: [1.55, 2.72], use: [1.55, 1.0], label: '침대에서 자는 중', visual: { z: .64, width: 128, pivot: [.32, .48], flip: true, enter: 620, exit: 560 } },
  },
  {
    id: 'sofa', name: '소파', type: 'sofa', x: 0.8, y: 5.05, w: 2.7, d: 1.45,
    interaction: { action: 'sitting', approach: [1.35, 1.95], use: [1.35, .67], label: '소파에 앉아 쉬는 중', visual: { z: .61, width: 112, pivot: [.5, .64], flip: false, enter: 480, exit: 500 } },
  },
  {
    id: 'desk', name: '책상', type: 'desk', x: 6.2, y: 0.85, w: 2.85, d: 1.2,
    interaction: { action: 'studying', approach: [1.45, 2.72], use: [1.45, 1.55], label: '책상 의자에 앉아 공부하는 중', visual: { z: .34, width: 114, pivot: [.5, .68], flip: true, enter: 440, exit: 500 } },
  },
  { id: 'tv', name: 'TV', type: 'tv', x: 6.7, y: 5.55, w: 2.45, d: 0.8 },
  { id: 'coffee', name: '테이블', type: 'coffee', x: 4.25, y: 5.25, w: 1.75, d: 1.25 },
  { id: 'shelf', name: '수납장', type: 'shelf', x: 8.55, y: 1.55, w: 1.0, d: 1.8 },
  { id: 'plant', name: '화분', type: 'plant', x: 4.25, y: 0.65, w: 0.7, d: 0.7 },
];
const initialObjectPositions = new Map(objects.map(o => [o.id, { x: o.x, y: o.y }]));
const DEFAULT_NEEDS = Object.freeze({ energy: 72, focus: 64, comfort: 78 });
const needs = { ...DEFAULT_NEEDS };
const needCooldowns = { bed: 0, sofa: 0, desk: 0 };
const needForObject = { bed: 'energy', desk: 'focus', sofa: 'comfort' };

const agent = {
  x: 5.0, y: 4.1, path: [], speed: 1.6, skin: 'classic', facing: 1,
  mode: 'idle', gesture: null, gestureUntil: 0, interaction: null,
  afterPath: null, nextDecisionAt: performance.now() + 1600,
  manualHold: false, destination: null, approachTransition: null,
};

let roomSkin = 'cloud';
let autonomous = true;
let editMode = false;
let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
let view = { width: 1000, height: 650, tileW: 75, tileH: 38, z: 42, ox: 500, oy: 105, scale: 1 };
let lastTime = performance.now();
let raf = 0;
let hoverObjectId = null;
let drag = null;
let selectedObjectId = null;
let pendingUseId = null;
let hintTimer = 0;
let persistTimer = 0;
let persistClock = 0;
let particleTimer = 0;
let reducedMotion = Boolean(reducedMotionQuery?.matches);
const particles = [];
const STORAGE_KEY = 'physical-diorama-state-v2';
const CALENDAR_STORAGE_KEY = 'physical-diorama-calendar-memos-v1';
const WALL_BOARDS = Object.freeze({
  calendar: Object.freeze({ x1: 4.86, x2: 6.18, z1: 1.5, z2: 2.62 }),
  budget: Object.freeze({ x1: 6.38, x2: 7.72, z1: 1.5, z2: 2.62 }),
});
const BUDGET_DATA = Object.freeze([
  Object.freeze({ id: 'food', label: '식비', budget: 450000, used: 312000, color: '#ef9b68' }),
  Object.freeze({ id: 'transport', label: '교통', budget: 180000, used: 118000, color: '#75aee9' }),
  Object.freeze({ id: 'shopping', label: '쇼핑', budget: 300000, used: 214000, color: '#c795e8' }),
  Object.freeze({ id: 'leisure', label: '여가', budget: 250000, used: 126000, color: '#77c79a' }),
  Object.freeze({ id: 'fixed', label: '고정비', budget: 1200000, used: 960000, color: '#e1bd62' }),
]);

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDateKey(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value)); }

function loadCalendarMemos() {
  const saved = safeStorage(() => JSON.parse(localStorage.getItem(CALENDAR_STORAGE_KEY) || '{}'));
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return Object.create(null);
  return Object.fromEntries(Object.entries(saved).filter(([key, value]) => validDateKey(key) && typeof value === 'string').map(([key, value]) => [key, value.slice(0, 1000)]));
}

function persistCalendarMemos() {
  safeStorage(() => localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendarState.memos)));
}

const calendarToday = new Date();
const calendarState = {
  month: new Date(calendarToday.getFullYear(), calendarToday.getMonth(), 1),
  selected: dateKey(calendarToday),
  memos: loadCalendarMemos(),
};

function budgetTotals() {
  return BUDGET_DATA.reduce((totals, item) => ({ budget: totals.budget + item.budget, used: totals.used + item.used }), { budget: 0, used: 0 });
}

function wallBoardPoints(board) {
  return [
    project(board.x1, .05, board.z2), project(board.x2, .05, board.z2),
    project(board.x2, .05, board.z1), project(board.x1, .05, board.z1),
  ];
}

function wallBoardScreenBounds(board) {
  const points = wallBoardPoints(board);
  return {
    left: Math.min(...points.map(point => point.x)),
    top: Math.min(...points.map(point => point.y)),
    right: Math.max(...points.map(point => point.x)),
    bottom: Math.max(...points.map(point => point.y)),
  };
}

function bindOptionalHotspot(id, panelId) {
  const element = document.querySelector(`#${id}`);
  if (!element || element.dataset.roomPanelBound === panelId) return;
  element.dataset.roomPanelBound = panelId;
  element.addEventListener('click', () => openPanel(panelId));
}

function positionHotspots() {
  const shell = canvas.parentElement;
  const canvasRect = canvas.getBoundingClientRect();
  const targets = [['calendarHotspot', WALL_BOARDS.calendar, '달력 열기'], ['budgetHotspot', WALL_BOARDS.budget, '카테고리별 예산 열기']];
  for (const [id, board, label] of targets) {
    const element = document.querySelector(`#${id}`);
    if (!element) continue;
    bindOptionalHotspot(id, id === 'calendarHotspot' ? 'calendarPanel' : 'budgetPanel');
    const bounds = wallBoardScreenBounds(board);
    const host = element.offsetParent || shell || document.body;
    const hostRect = host.getBoundingClientRect();
    element.style.position = 'absolute';
    element.style.left = `${canvasRect.left - hostRect.left + bounds.left}px`;
    element.style.top = `${canvasRect.top - hostRect.top + bounds.top}px`;
    element.style.width = `${Math.max(28, bounds.right - bounds.left)}px`;
    element.style.height = `${Math.max(28, bounds.bottom - bounds.top)}px`;
    if (!element.getAttribute('aria-label')) element.setAttribute('aria-label', label);
    if (!element.getAttribute('title')) element.setAttribute('title', label);
  }
}

function drawCalendarBoard() {
  const board = WALL_BOARDS.calendar;
  const points = wallBoardPoints(board);
  poly(points.map(point => ({ x: point.x + 3 * view.scale, y: point.y + 4 * view.scale })), 'rgba(54,45,43,.12)');
  poly(points, '#fffdf6', '#e8d7bd', 1.4 * view.scale);
  const title = project(board.x1 + .14, .045, board.z2 - .19);
  const accent = project(board.x1 + .14, .045, board.z2 - .39);
  ctx.save();
  ctx.fillStyle = '#806454';
  ctx.font = `800 ${Math.max(7, 11 * view.scale)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('CALENDAR', title.x, title.y);
  ctx.strokeStyle = '#e2b980';
  ctx.lineWidth = Math.max(.8, 1.5 * view.scale);
  ctx.beginPath(); ctx.moveTo(accent.x, accent.y); ctx.lineTo(project(board.x2 - .12, .045, board.z2 - .39).x, accent.y); ctx.stroke();
  ctx.font = `700 ${Math.max(6, 8.5 * view.scale)}px system-ui, sans-serif`;
  ctx.fillStyle = '#a27558';
  const monthLabel = `${calendarState.month.getFullYear()}년 ${calendarState.month.getMonth() + 1}월`;
  ctx.fillText(monthLabel, accent.x, accent.y + 11 * view.scale);
  const gridX1 = board.x1 + .14, gridX2 = board.x2 - .13;
  const gridZ1 = board.z1 + .12, gridZ2 = board.z2 - .5;
  ctx.strokeStyle = 'rgba(164,132,105,.32)';
  ctx.lineWidth = Math.max(.55, .8 * view.scale);
  for (let column = 0; column <= 7; column += 1) {
    const x = gridX1 + ((gridX2 - gridX1) * column) / 7;
    line(project(x, .045, gridZ1), project(x, .045, gridZ2), ctx.strokeStyle, ctx.lineWidth);
  }
  for (let row = 0; row <= 5; row += 1) {
    const z = gridZ1 + ((gridZ2 - gridZ1) * row) / 5;
    line(project(gridX1, .045, z), project(gridX2, .045, z), ctx.strokeStyle, ctx.lineWidth);
  }
  ctx.fillStyle = '#7b6659';
  ctx.font = `700 ${Math.max(5, 7 * view.scale)}px system-ui, sans-serif`;
  const daysInMonth = new Date(calendarState.month.getFullYear(), calendarState.month.getMonth() + 1, 0).getDate();
  const firstDay = new Date(calendarState.month.getFullYear(), calendarState.month.getMonth(), 1).getDay();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const index = firstDay + day - 1;
    const column = index % 7, row = Math.floor(index / 7);
    if (row >= 5) continue;
    const x = gridX1 + ((gridX2 - gridX1) * (column + .5)) / 7;
    const z = gridZ2 - ((gridZ2 - gridZ1) * (row + .63)) / 5;
    const point = project(x, .045, z);
    if (dateKey(new Date(calendarState.month.getFullYear(), calendarState.month.getMonth(), day)) === calendarState.selected) {
      ctx.fillStyle = '#efad72';
      ctx.beginPath(); ctx.arc(point.x, point.y - 2 * view.scale, 4 * view.scale, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fffdf6';
    }
    ctx.textAlign = 'center';
    ctx.fillText(String(day), point.x, point.y);
    ctx.fillStyle = '#7b6659';
  }
  ctx.restore();
}

function drawBudgetBoard() {
  const board = WALL_BOARDS.budget;
  const points = wallBoardPoints(board);
  const totals = budgetTotals();
  const overall = clamp(Math.round((totals.used / Math.max(1, totals.budget)) * 100));
  poly(points.map(point => ({ x: point.x + 3 * view.scale, y: point.y + 4 * view.scale })), 'rgba(54,45,43,.12)');
  poly(points, '#f8fbff', '#cbd9e7', 1.4 * view.scale);
  const title = project(board.x1 + .14, .045, board.z2 - .19);
  const overallPoint = project(board.x2 - .16, .045, board.z2 - .2);
  ctx.save();
  ctx.fillStyle = '#546b83';
  ctx.font = `800 ${Math.max(7, 10 * view.scale)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('BUDGET', title.x, title.y);
  ctx.textAlign = 'right';
  ctx.fillStyle = overall > 85 ? '#d66b62' : '#629a78';
  ctx.font = `900 ${Math.max(8, 12 * view.scale)}px system-ui, sans-serif`;
  ctx.fillText(`${overall}%`, overallPoint.x, overallPoint.y);
  const barX1 = board.x1 + .15, barX2 = board.x2 - .15;
  const barWidth = Math.max(1, project(barX2, .045, board.z2 - .41).x - project(barX1, .045, board.z2 - .41).x);
  BUDGET_DATA.forEach((item, index) => {
    const z = board.z2 - .48 - index * .19;
    const labelPoint = project(barX1, .045, z);
    const barPoint = project(barX1 + .43, .045, z - .01);
    const ratio = clamp(item.used / Math.max(1, item.budget), 0, 1);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#67798b';
    ctx.font = `700 ${Math.max(5, 7 * view.scale)}px system-ui, sans-serif`;
    ctx.fillText(item.label, labelPoint.x, labelPoint.y);
    ctx.strokeStyle = 'rgba(102,124,147,.2)';
    ctx.lineWidth = Math.max(2, 3.2 * view.scale);
    line(barPoint, { x: barPoint.x + barWidth - 22 * view.scale, y: barPoint.y }, ctx.strokeStyle, ctx.lineWidth);
    line(barPoint, { x: barPoint.x + (barWidth - 22 * view.scale) * ratio, y: barPoint.y }, item.color, ctx.lineWidth);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#718298';
    ctx.font = `800 ${Math.max(5, 6.5 * view.scale)}px system-ui, sans-serif`;
    ctx.fillText(`${Math.round(ratio * 100)}%`, project(board.x2 - .14, .045, z).x, labelPoint.y);
  });
  ctx.restore();
}

function roomBounds(scale = 1) {
  const tileW = 76 * scale, tileH = 38 * scale, z = 43 * scale;
  const points = [];
  for (const x of [0, WORLD_W]) {
    for (const y of [0, WORLD_H]) {
      for (const height of [0, 3.25]) {
        points.push({ x: (x - y) * tileW / 2, y: (x + y) * tileH / 2 - height * z });
      }
    }
  }
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  view.width = width;
  view.height = height;
  const margin = Math.max(10, Math.min(28, Math.min(width, height) * .045));
  const base = roomBounds(1);
  view.scale = Math.max(.01, Math.min((width - margin * 2) / base.width, (height - margin * 2) / base.height));
  view.tileW = 76 * view.scale;
  view.tileH = 38 * view.scale;
  view.z = 43 * view.scale;
  const bounds = roomBounds(view.scale);
  view.ox = (width - bounds.width) / 2 - bounds.minX;
  view.oy = (height - bounds.height) / 2 - bounds.minY;
  positionHotspots();
}

function project(x, y, z = 0) {
  return {
    x: view.ox + (x - y) * view.tileW / 2,
    y: view.oy + (x + y) * view.tileH / 2 - z * view.z,
  };
}

function inverseProject(screenX, screenY) {
  const dx = screenX - view.ox;
  const dy = screenY - view.oy;
  return {
    x: (dx / (view.tileW / 2) + dy / (view.tileH / 2)) / 2,
    y: (dy / (view.tileH / 2) - dx / (view.tileW / 2)) / 2,
  };
}

function easeOutCubic(value) { return 1 - Math.pow(1 - value, 3); }
function safeStorage(action) {
  try { return action(); } catch { return null; }
}

function updateNeedMeters() {
  for (const [key, el] of [['energy', energyMeterEl], ['focus', focusMeterEl], ['comfort', comfortMeterEl]]) {
    if (!el) continue;
    const value = Math.round(needs[key]);
    if ('value' in el) el.value = value;
    el.setAttribute('aria-label', `${key === 'energy' ? '에너지' : key === 'focus' ? '집중력' : '편안함'} ${value}%`);
    el.setAttribute('aria-valuenow', String(value));
    el.style.setProperty('--meter-value', `${value}%`);
    const visibleValue = el.closest('.meter-item')?.querySelector('.meter-label strong');
    if (visibleValue) visibleValue.textContent = `${value}%`;
  }
  if (widgetMeterDotsEl) widgetMeterDotsEl.setAttribute('aria-label', `에너지 ${Math.round(needs.energy)}%, 집중력 ${Math.round(needs.focus)}%, 편안함 ${Math.round(needs.comfort)}%`);
}

function updateUseControls() {
  document.querySelectorAll('[data-use]').forEach(button => {
    const active = pendingUseId === button.dataset.use || agent.interaction?.objectId === button.dataset.use;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('is-active', active);
  });
  if (selectedObjectLabelEl) {
    const selected = objects.find(object => object.id === selectedObjectId);
    selectedObjectLabelEl.textContent = selected ? `${selected.name} 선택됨` : '가구를 선택하세요';
  }
  document.body.classList.toggle('is-editing', editMode);
}

function persistState() {
  safeStorage(() => localStorage.setItem(STORAGE_KEY, JSON.stringify({
    objects: objects.map(({ id, x, y }) => ({ id, x, y })),
    roomSkin, characterSkin: agent.skin, needs: { ...needs },
  })));
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistState, 250);
}

function loadState() {
  const saved = safeStorage(() => JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  if (!saved || typeof saved !== 'object') return;
  const positions = new Map(Array.isArray(saved.objects) ? saved.objects.map(item => [item.id, item]) : []);
  for (const o of objects) {
    const item = positions.get(o.id);
    if (Number.isFinite(item?.x) && Number.isFinite(item?.y) && canPlace(o, item.x, item.y)) {
      o.x = item.x; o.y = item.y;
    }
  }
  if (paletteMap[saved.roomSkin]) roomSkin = saved.roomSkin;
  if (assets[saved.characterSkin]) agent.skin = saved.characterSkin;
  for (const key of Object.keys(DEFAULT_NEEDS)) if (Number.isFinite(saved.needs?.[key])) needs[key] = clamp(saved.needs[key]);
  if (roomSkinEl) roomSkinEl.value = roomSkin;
  if (characterSkinEl) characterSkinEl.value = agent.skin;
  updateNeedMeters();
}

function resetRoom() {
  exitInteraction();
  for (const o of objects) { const initial = initialObjectPositions.get(o.id); if (initial) { o.x = initial.x; o.y = initial.y; } }
  agent.x = 5; agent.y = 4.1; agent.path = []; agent.afterPath = null; agent.destination = null;
  agent.gesture = null; agent.gestureUntil = 0; agent.mode = 'idle'; agent.approachTransition = null;
  Object.assign(needs, DEFAULT_NEEDS);
  roomSkin = 'cloud'; agent.skin = 'classic'; selectedObjectId = null; hoverObjectId = null;
  if (roomSkinEl) roomSkinEl.value = roomSkin;
  if (characterSkinEl) characterSkinEl.value = agent.skin;
  updateNeedMeters(); updateUseControls(); schedulePersist();
  setState(autonomous ? '자율 이동' : '수동 조작');
  showHint('방 배치와 에이전트 상태를 초기화했습니다.');
}

function poly(points, fill, stroke = null, lineWidth = 1) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function line(a, b, stroke, width = 1) {
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
}

function colorMix(hex, amount) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const target = amount >= 0 ? 255 : 0;
  const a = Math.abs(amount);
  const mix = v => Math.round(v + (target - v) * a);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function drawIsoBox(x, y, z, w, d, h, top, left = colorMix(top, -0.18), right = colorMix(top, -0.1), shadow = true) {
  if (shadow) drawFootShadow(x, y, w, d, 0.15);
  const p000 = project(x, y, z), p100 = project(x + w, y, z), p110 = project(x + w, y + d, z), p010 = project(x, y + d, z);
  const p001 = project(x, y, z + h), p101 = project(x + w, y, z + h), p111 = project(x + w, y + d, z + h), p011 = project(x, y + d, z + h);
  poly([p010, p110, p111, p011], left);
  poly([p100, p110, p111, p101], right);
  poly([p001, p101, p111, p011], top);
}

function drawFootShadow(x, y, w, d, opacity = 0.16) {
  const c = project(x + w / 2 + 0.1, y + d / 2 + 0.13, 0.02);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.scale(1, 0.45);
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(w, d) * view.tileW * 0.32, Math.max(w, d) * view.tileH * 0.32, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(37,43,60,${opacity})`;
  ctx.filter = `blur(${4 * view.scale}px)`;
  ctx.fill();
  ctx.restore();
  ctx.filter = 'none';
}

function drawFloorAndWalls(now = performance.now()) {
  const p = paletteMap[roomSkin];
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, view.width, view.height);

  const floorPts = [project(0,0), project(WORLD_W,0), project(WORLD_W,WORLD_H), project(0,WORLD_H)];
  poly(floorPts, p.floorA, 'rgba(98,80,58,.15)', 1.2);

  // wood slats as real projected floor lines
  for (let x = 0; x <= WORLD_W; x += 0.5) {
    line(project(x, 0, 0.01), project(x, WORLD_H, 0.01), p.floorLine, 0.7);
  }
  for (let y = 0; y <= WORLD_H; y += 1) {
    line(project(0, y, 0.011), project(WORLD_W, y, 0.011), 'rgba(255,255,255,.12)', 0.7);
  }

  const wallH = 3.25;
  poly([project(0,0,0), project(WORLD_W,0,0), project(WORLD_W,0,wallH), project(0,0,wallH)], p.wallB, p.wallEdge, 1.3);
  poly([project(0,0,0), project(0,WORLD_H,0), project(0,WORLD_H,wallH), project(0,0,wallH)], p.wallA, p.wallEdge, 1.3);

  // window: the generated city view is affine-mapped to the wall plane and clipped to its frame.
  const win = [project(0.05,1.15,1.15), project(0.05,3.25,1.15), project(0.05,3.25,2.65), project(0.05,1.15,2.65)];
  poly(win, '#dff0fb', '#ffffff', 6 * view.scale);
  if (cityWindow.complete && cityWindow.naturalWidth) {
    const leftTop = project(0.05,3.25,2.65);
    const rightTop = project(0.05,1.15,2.65);
    const leftBottom = project(0.05,3.25,1.15);
    const iw = cityWindow.naturalWidth, ih = cityWindow.naturalHeight;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(win[0].x, win[0].y);
    for (let i = 1; i < win.length; i++) ctx.lineTo(win[i].x, win[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(
      dpr * (rightTop.x - leftTop.x) / iw,
      dpr * (rightTop.y - leftTop.y) / iw,
      dpr * (leftBottom.x - leftTop.x) / ih,
      dpr * (leftBottom.y - leftTop.y) / ih,
      dpr * leftTop.x,
      dpr * leftTop.y,
    );
    ctx.globalAlpha = .96;
    ctx.drawImage(cityWindow, 0, 0, iw, ih);
    ctx.restore();
  }
  line(project(0.04,2.2,1.16), project(0.04,2.2,2.64), 'rgba(255,255,255,.85)', 3 * view.scale);
  line(project(0.04,1.15,1.15), project(0.04,3.25,1.15), 'rgba(255,255,255,.85)', 3 * view.scale);
  if (!reducedMotion) {
    const glint = .18 + (.1 * (Math.sin(now / 1100) + 1));
    ctx.save();
    ctx.globalAlpha = glint;
    line(project(0.045,1.4,2.46), project(0.045,2.06,2.46), '#ffffff', 2 * view.scale);
    ctx.restore();
  }

  // Wall boards are real clickable room elements; their DOM hotspots follow these bounds.
  drawCalendarBoard();
  drawBudgetBoard();

  // rug is a flat world object, not part of background image
  const rug = [project(3.3,4.2,.015), project(6.1,4.2,.015), project(6.1,6.65,.015), project(3.3,6.65,.015)];
  poly(rug, p.rug, 'rgba(99,83,62,.08)', 1);
  const rugPulse = reducedMotion ? .14 : .14 + .025 * Math.sin(now / 1300);
  line(project(3.65,4.52,.025), project(5.75,4.52,.025), `rgba(255,255,255,${rugPulse})`, 1.2 * view.scale);
  line(project(3.65,6.3,.025), project(5.75,6.3,.025), `rgba(120,95,70,${rugPulse * .55})`, 1.2 * view.scale);
  const rugCenter = project(4.7,5.4,.03);
  ctx.save();
  ctx.translate(rugCenter.x, rugCenter.y);
  ctx.scale(1, .45);
  ctx.beginPath();
  ctx.arc(0, 0, 12 * view.scale, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,255,255,${rugPulse * .8})`;
  ctx.lineWidth = 1.2 * view.scale;
  ctx.stroke();
  ctx.restore();
}

function objectDepth(o) { return o.x + o.y + o.w * 0.5 + o.d * 0.5; }
function agentDepth() { return agent.x + agent.y; }
function renderedObject(o) {
  if (drag?.id !== o.id || !drag.preview) return o;
  return { ...o, x: drag.preview.x, y: drag.preview.y };
}

function drawObject(o, phase = 'full', now = performance.now()) {
  const preview = drag?.id === o.id && drag.preview ? { ...o, x: drag.preview.x, y: drag.preview.y } : null;
  const rendered = preview?.valid ? preview : o;
  const p = paletteMap[roomSkin];
  const selected = editMode && (hoverObjectId === o.id || selectedObjectId === o.id || drag?.id === o.id);
  if (selected && (phase === 'full' || phase === 'base')) drawSelection(preview || rendered, preview ? (preview.valid ? 'valid' : 'invalid') : 'selected');

  if (rendered.type === 'bed') drawBed(rendered, phase, p);
  if (rendered.type === 'sofa') drawSofa(rendered, phase, p);
  if (rendered.type === 'desk') drawDesk(rendered, phase, p);
  if (rendered.type === 'tv' && phase === 'full') drawTV(rendered, p, now);
  if (rendered.type === 'coffee' && phase === 'full') drawCoffee(rendered, p);
  if (rendered.type === 'shelf' && phase === 'full') drawShelf(rendered, p);
  if (rendered.type === 'plant' && phase === 'full') drawPlant(rendered, p);
}

function drawSelection(o, status = 'selected') {
  const pts = [project(o.x,o.y,.02), project(o.x+o.w,o.y,.02), project(o.x+o.w,o.y+o.d,.02), project(o.x,o.y+o.d,.02)];
  const colors = {
    selected: ['rgba(75,118,239,.06)', 'rgba(75,118,239,.7)'],
    valid: ['rgba(56,186,120,.12)', 'rgba(38,157,96,.95)'],
    invalid: ['rgba(235,91,91,.14)', 'rgba(207,57,57,.95)'],
  }[status] || ['rgba(75,118,239,.06)', 'rgba(75,118,239,.7)'];
  ctx.save();
  ctx.setLineDash([7 * view.scale, 6 * view.scale]);
  poly(pts, colors[0], colors[1], 2 * view.scale);
  ctx.restore();
}

function drawDestinationRing(now) {
  if (!agent.destination || (!agent.path.length && !agent.approachTransition)) return;
  const p = project(agent.destination.x, agent.destination.y, .03);
  const pulse = reducedMotion ? 1 : .9 + .1 * Math.sin(now / 180);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1, .45);
  ctx.beginPath();
  ctx.arc(0, 0, 13 * view.scale * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(77,119,239,.72)';
  ctx.lineWidth = 2 * view.scale;
  ctx.setLineDash([4 * view.scale, 4 * view.scale]);
  ctx.stroke();
  ctx.restore();
}

function updateParticles(dt, now) {
  if (reducedMotion || agent.interaction?.phase !== 'active') { particles.length = 0; particleTimer = 0; return; }
  particleTimer += dt;
  const target = getInteractiveObject();
  while (target && particleTimer >= .28) {
    particleTimer -= .28;
    const use = interactionAnchor(target, 'use');
    if (use) particles.push({ x: use.x + (Math.random() - .5) * .5, y: use.y + (Math.random() - .5) * .35, z: .8 + Math.random() * .55, life: .75, size: 1.5 + Math.random() * 2, drift: .22 + Math.random() * .25 });
  }
  for (const particle of particles) { particle.life -= dt; particle.z += particle.drift * dt; }
  while (particles.length && particles[0].life <= 0) particles.shift();
}

function drawParticles() {
  if (reducedMotion) return;
  for (const particle of particles) {
    const p = project(particle.x, particle.y, particle.z);
    const alpha = clamp(particle.life / .75, 0, 1);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff5b3';
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-particle.size, -particle.size, particle.size * 2, particle.size * 2);
    ctx.restore();
  }
}

function interactionProgressFor(objectId) {
  if (agent.interaction?.objectId !== objectId) return 0;
  if (agent.interaction.phase === 'active') return 1;
  const transition = agent.approachTransition;
  return transition ? easeOutCubic(clamp((performance.now() - transition.started) / Math.max(1, transition.duration), 0, 1)) : 0;
}

function drawSoftDuvet(o, p, progress = 1, now = performance.now()) {
  if (progress <= .01) return;
  const amount = easeOutCubic(clamp(progress, 0, 1));
  const leftX = o.x + .1, rightX = o.x + o.w - .1;
  const backY = o.y + 1.36 - .41 * amount, frontY = o.y + o.d + .08;
  const backLeft = project(leftX, backY, .7), backRight = project(rightX, backY, .7);
  const frontRight = project(rightX, frontY, .65), frontLeft = project(leftX, frontY, .65);
  const lowerRight = project(rightX, frontY, .4), lowerLeft = project(leftX, frontY, .4);
  const midpoint = (a, b, t = .5) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  ctx.save();
  ctx.globalAlpha = amount;
  const topGradient = ctx.createLinearGradient(backLeft.x, backLeft.y, frontRight.x, frontRight.y);
  topGradient.addColorStop(0, colorMix(p.blanketTop, .12));
  topGradient.addColorStop(.55, p.blanketTop);
  topGradient.addColorStop(1, colorMix(p.blanketTop, -.06));
  const backMid = midpoint(backLeft, backRight), rightMid = midpoint(backRight, frontRight);
  const frontMid = midpoint(frontRight, frontLeft), leftMid = midpoint(frontLeft, backLeft);
  ctx.beginPath();
  ctx.moveTo(backLeft.x, backLeft.y);
  ctx.quadraticCurveTo(backMid.x, backMid.y - 3 * view.scale, backRight.x, backRight.y);
  ctx.quadraticCurveTo(rightMid.x + 2 * view.scale, rightMid.y, frontRight.x, frontRight.y);
  ctx.quadraticCurveTo(frontMid.x, frontMid.y + 15 * view.scale, frontLeft.x, frontLeft.y);
  ctx.quadraticCurveTo(leftMid.x - 2 * view.scale, leftMid.y, backLeft.x, backLeft.y);
  ctx.closePath();
  ctx.fillStyle = topGradient;
  ctx.shadowColor = 'rgba(41,52,85,.13)';
  ctx.shadowBlur = 5 * view.scale;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,.24)';
  ctx.lineWidth = Math.max(1, view.scale);
  ctx.stroke();

  const lowerMid = midpoint(lowerRight, lowerLeft);
  ctx.beginPath();
  ctx.moveTo(frontLeft.x, frontLeft.y);
  ctx.quadraticCurveTo(frontMid.x, frontMid.y + 15 * view.scale, frontRight.x, frontRight.y);
  ctx.lineTo(lowerRight.x, lowerRight.y);
  ctx.quadraticCurveTo(lowerMid.x, lowerMid.y + 13 * view.scale, lowerLeft.x, lowerLeft.y);
  ctx.closePath();
  const sideGradient = ctx.createLinearGradient(frontMid.x, frontMid.y, lowerMid.x, lowerMid.y);
  sideGradient.addColorStop(0, colorMix(p.blanketSide, .08));
  sideGradient.addColorStop(1, colorMix(p.blanketSide, -.14));
  ctx.fillStyle = sideGradient;
  ctx.fill();

  const moundCenter = midpoint(backMid, frontMid, .57);
  const moundAngle = Math.atan2(frontMid.y - backMid.y, frontMid.x - backMid.x);
  ctx.save();
  ctx.translate(moundCenter.x, moundCenter.y - 2 * view.scale);
  ctx.rotate(moundAngle);
  ctx.scale(1, .48);
  ctx.beginPath();
  ctx.ellipse(0, 0, 36 * view.scale, 16 * view.scale, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.2)';
  ctx.fill();
  ctx.restore();

  for (const t of [.24, .5, .76]) {
    const start = midpoint(backLeft, backRight, t), end = midpoint(frontLeft, frontRight, t);
    const curve = midpoint(start, end);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(curve.x + Math.sin(now / 700 + t * 4) * 2 * view.scale, curve.y + 3 * view.scale, end.x, end.y);
    ctx.strokeStyle = t === .5 ? 'rgba(255,255,255,.28)' : 'rgba(43,58,94,.11)';
    ctx.lineWidth = Math.max(1, view.scale * 1.1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBed(o, phase, p, now = performance.now()) {
  if (phase === 'base' || phase === 'full') {
    drawIsoBox(o.x,o.y,0,o.w,o.d,.32,p.woodTop,p.woodLeft,p.woodRight);
    drawIsoBox(o.x+.12,o.y+.12,.32,o.w-.24,o.d-.24,.25,p.bedTop,p.bedSide,colorMix(p.bedSide,-.08),false);
    drawIsoBox(o.x,o.y-.06,.1,o.w,.16,1.15,p.woodTop,p.woodLeft,p.woodRight,false);
    drawIsoBox(o.x+.2,o.y+.18,.58,.85,.62,.11,'#ffffff','#e8edf3','#edf2f7',false);
    drawIsoBox(o.x+1.12,o.y+.18,.58,.85,.62,.11,'#ffffff','#e8edf3','#edf2f7',false);
    if (phase === 'full') drawSoftDuvet(o, p, 1, now);
  }
  if (phase === 'foreground') {
    const progress = interactionProgressFor(o.id);
    drawSoftDuvet(o, p, progress, now);
  }
}

function drawSofa(o, phase, p) {
  if (phase === 'base' || phase === 'full') {
    drawIsoBox(o.x,o.y,.08,o.w,o.d,.46,p.blueTop,p.blueLeft,p.blueRight);
    drawIsoBox(o.x+.12,o.y+.18,.54,o.w-.24,o.d-.42,.25,colorMix(p.blueTop,.08),p.blueLeft,p.blueRight,false);
    drawIsoBox(o.x,o.y-.02,.25,o.w,.28,1.15,colorMix(p.blueTop,.06),p.blueLeft,p.blueRight,false);
    drawIsoBox(o.x,o.y+.2,.32,.25,o.d-.18,.72,colorMix(p.blueTop,.03),p.blueLeft,p.blueRight,false);
    drawIsoBox(o.x+o.w-.25,o.y+.2,.32,.25,o.d-.18,.72,colorMix(p.blueTop,.03),p.blueLeft,p.blueRight,false);
  }
}

function drawDesk(o, phase, p) {
  if (phase === 'base' || phase === 'full') {
    drawIsoBox(o.x,o.y,.03,o.w,o.d,.14,p.woodTop,p.woodLeft,p.woodRight);
    drawIsoBox(o.x+.12,o.y+.1,.14,.22,.22,.78,p.woodTop,p.woodLeft,p.woodRight,false);
    drawIsoBox(o.x+o.w-.34,o.y+.1,.14,.22,.22,.78,p.woodTop,p.woodLeft,p.woodRight,false);
    drawIsoBox(o.x+.12,o.y+o.d-.32,.14,.22,.22,.78,p.woodTop,p.woodLeft,p.woodRight,false);
    drawIsoBox(o.x+o.w-.34,o.y+o.d-.32,.14,.22,.22,.78,p.woodTop,p.woodLeft,p.woodRight,false);
    drawIsoBox(o.x,o.y,.92,o.w,o.d,.15,colorMix(p.woodTop,.08),p.woodLeft,p.woodRight,false);
    // chair
    drawIsoBox(o.x+1.0,o.y+1.55,.08,.85,.72,.26,p.blueTop,p.blueLeft,p.blueRight);
    drawIsoBox(o.x+1.0,o.y+1.9,.28,.85,.18,.9,colorMix(p.blueTop,.05),p.blueLeft,p.blueRight,false);
    if (phase === 'full') drawLaptop(o,p);
  }
  if (phase === 'foreground') {
    const y = o.y + o.d - .03;
    poly([project(o.x,y,.92),project(o.x+o.w,y,.92),project(o.x+o.w,y,1.07),project(o.x,y,1.07)],p.woodLeft);
  }
}

function drawLaptop(o,p) {
  drawIsoBox(o.x+1.02,o.y+.25,1.08,.95,.58,.07,'#5e6775','#414955','#4b5360',false);
  drawIsoBox(o.x+1.05,o.y+.28,1.14,.9,.08,.58,'#2e3746','#202734','#242b38',false);
}

function drawTV(o,p,now = performance.now()) {
  drawIsoBox(o.x,o.y,0,o.w,o.d,.58,p.woodTop,p.woodLeft,p.woodRight);
  const glow = reducedMotion ? .12 : .12 + .06 * (Math.sin(now / 420) + 1);
  drawIsoBox(o.x+.25,o.y+.18,.7,o.w-.5,.13,1.4,p.screen,'#1d2532','#252d3b',false);
  const screen = project(o.x + o.w / 2, o.y + .175, 1.4);
  ctx.save();
  ctx.globalAlpha = glow;
  ctx.fillStyle = '#7ed7ff';
  ctx.beginPath(); ctx.arc(screen.x, screen.y, 9 * view.scale, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  drawIsoBox(o.x+1.02,o.y+.31,.58,.42,.22,.18,p.metal,colorMix(p.metal,-.12),colorMix(p.metal,-.07),false);
}
function drawCoffee(o,p) {
  drawIsoBox(o.x,o.y,.48,o.w,o.d,.14,colorMix(p.woodTop,.1),p.woodLeft,p.woodRight);
  drawIsoBox(o.x+.15,o.y+.16,.05,.18,.18,.47,p.woodTop,p.woodLeft,p.woodRight,false);
  drawIsoBox(o.x+o.w-.33,o.y+.16,.05,.18,.18,.47,p.woodTop,p.woodLeft,p.woodRight,false);
  drawIsoBox(o.x+.15,o.y+o.d-.34,.05,.18,.18,.47,p.woodTop,p.woodLeft,p.woodRight,false);
  drawIsoBox(o.x+o.w-.33,o.y+o.d-.34,.05,.18,.18,.47,p.woodTop,p.woodLeft,p.woodRight,false);
}
function drawShelf(o,p) {
  drawIsoBox(o.x,o.y,0,o.w,o.d,1.45,colorMix(p.woodTop,.12),p.woodLeft,p.woodRight);
  for (let i=1;i<4;i++) {
    const z=.28*i;
    line(project(o.x,o.y+o.d,z), project(o.x+o.w,o.y+o.d,z), 'rgba(80,55,34,.22)', 1.3*view.scale);
  }
}
function drawPlant(o,p) {
  drawIsoBox(o.x+.12,o.y+.12,0,o.w-.24,o.d-.24,.35,p.pot,colorMix(p.pot,-.12),colorMix(p.pot,-.07));
  const c = project(o.x+o.w/2,o.y+o.d/2,.55);
  ctx.save();
  ctx.translate(c.x,c.y);
  for (let i=0;i<7;i++) {
    const a=(-1.25+i*.42);
    ctx.beginPath();
    ctx.ellipse(Math.cos(a)*12*view.scale,Math.sin(a)*9*view.scale,8*view.scale,17*view.scale,a,0,Math.PI*2);
    ctx.fillStyle = i%2 ? p.green : colorMix(p.green,.12);
    ctx.fill();
  }
  ctx.restore();
}

function getInteractiveObject() {
  if (!agent.interaction) return null;
  return objects.find(o => o.id === agent.interaction.objectId) || null;
}

function drawScene(now) {
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,view.width,view.height);
  drawFloorAndWalls(now);

  const interactive = getInteractiveObject();
  const entities = [];
  for (const object of objects) {
    const o = renderedObject(object);
    if (interactive?.id === object.id) {
      const depth = agentDepth();
      entities.push({ type: 'object', phase: 'base', depth: depth - .001, o });
      entities.push({ type: 'object', phase: 'foreground', depth: depth + .001, o });
    } else {
      entities.push({ type: 'object', phase: 'full', depth: objectDepth(o), o });
    }
  }
  entities.push({ type: 'agent', depth: agentDepth(), o: interactive });
  entities.sort((a,b)=>a.depth-b.depth);
  for (const e of entities) {
    if (e.type === 'object') drawObject(e.o,'full' === e.phase ? 'full' : e.phase,now);
    else drawAgent(now,e.o);
  }
  drawDestinationRing(now);
  drawParticles();
}

function drawableSize(source) {
  const width = source?.naturalWidth || source?.width || 0;
  const height = source?.naturalHeight || source?.height || 0;
  return { width, height };
}

function drawAgentSprite(source, { width, pivot = [.5, .93], z = .03, flip = false, alpha = 1, bob = 0, worldScale = 1 } = {}) {
  const size = drawableSize(source);
  if (!size.width || !size.height || alpha <= .01) return false;
  const w = width * view.scale;
  const h = w * size.height / size.width;
  const pos = project(agent.x, agent.y, z);
  ctx.save();
  ctx.translate(pos.x, pos.y + bob);
  if ((agent.facing < 0) !== Boolean(flip)) ctx.scale(-1, 1);
  ctx.scale(worldScale, worldScale);
  ctx.globalAlpha = alpha;
  ctx.drawImage(source, -w * Number(pivot[0] ?? .5), -h * Number(pivot[1] ?? .93), w, h);
  ctx.restore();
  return true;
}

function drawAgentShadow(now, width = 33) {
  const pos = project(agent.x, agent.y, .02);
  ctx.save();
  ctx.translate(pos.x, pos.y + 2 * view.scale);
  ctx.scale(1, .35);
  ctx.beginPath();
  ctx.ellipse(0, 0, width * view.scale, 14 * view.scale, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(31,37,53,.16)';
  ctx.fill();
  ctx.restore();
}

function drawAgent(now, interactingObject = null) {
  const pose = agent.gesture || 'idle';
  const idleImage = assets[agent.skin]?.[pose] || assets.classic.idle;
  const bob = agent.mode === 'moving' ? Math.sin(now / 95) * 4 * view.scale : Math.sin(now / 480) * 1.8 * view.scale;
  const interactionMode = interactingObject?.interaction?.action;
  const dedicatedImage = interactionMode ? interactionPose(interactionMode, agent.skin) : null;
  const visual = interactingObject?.interaction?.visual || {};
  const transition = agent.interaction?.phase === 'approach' && interactingObject?.id === agent.interaction?.objectId;
  const progress = dedicatedImage ? (transition ? interactionProgressFor(interactingObject.id) : 1) : 0;

  drawAgentShadow(now, dedicatedImage && interactionMode === 'lying' ? 50 : 33);
  if (!dedicatedImage) {
    drawAgentSprite(idleImage, { width: 108, pivot: [.5, .93], bob, worldScale: agent.mode === 'moving' ? .96 + Math.sin(now / 110) * .025 : 1 });
    return;
  }

  if (progress < 1) drawAgentSprite(idleImage, { width: 108, pivot: [.5, .93], bob, alpha: 1 - progress, worldScale: agent.mode === 'moving' ? .96 + Math.sin(now / 110) * .025 : 1 });
  drawAgentSprite(dedicatedImage, {
    width: Number.isFinite(Number(visual.width)) ? Number(visual.width) : 108,
    pivot: Array.isArray(visual.pivot) ? visual.pivot : [.5, .8],
    z: Number.isFinite(Number(visual.z)) ? Number(visual.z) : .03,
    flip: Boolean(visual.flip),
    alpha: progress,
    bob: transition ? bob * (1 - progress) : 0,
  });
}

let modalReturnFocus = null;
const wiredRoomModals = new WeakSet();

function makeRoomElement(tag, text = '', className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function createFallbackRoomModal() {
  const modal = makeRoomElement('dialog');
  modal.id = 'roomModal';
  modal.setAttribute('aria-label', '방 정보');
  const shell = makeRoomElement('div', '', 'room-modal-shell');
  const header = makeRoomElement('header', '', 'room-modal-header');
  const title = makeRoomElement('h2', '방 기록');
  const close = makeRoomElement('button', '닫기');
  close.type = 'button'; close.id = 'roomModalClose'; close.dataset.roomClose = 'true';
  header.append(title, close);
  const calendar = makeRoomElement('section', '', 'room-panel');
  calendar.id = 'calendarPanel';
  const calendarTitle = makeRoomElement('h3', '달력'); calendarTitle.id = 'calendarMonth';
  const calendarNav = makeRoomElement('div', '', 'calendar-nav');
  const previous = makeRoomElement('button', '이전 달'); previous.type = 'button'; previous.id = 'calendarPrev';
  const next = makeRoomElement('button', '다음 달'); next.type = 'button'; next.id = 'calendarNext';
  calendarNav.append(previous, next);
  const grid = makeRoomElement('div', '', 'calendar-grid'); grid.id = 'calendarGrid';
  const selected = makeRoomElement('p', ''); selected.id = 'calendarSelectedDate';
  const memo = document.createElement('textarea'); memo.id = 'calendarMemo'; memo.maxLength = 1000; memo.rows = 4; memo.placeholder = '오늘의 메모';
  const save = makeRoomElement('button', '메모 저장'); save.type = 'button'; save.id = 'calendarSave';
  calendar.append(calendarTitle, calendarNav, grid, selected, memo, save);
  const budget = makeRoomElement('section', '', 'room-panel'); budget.id = 'budgetPanel'; budget.hidden = true;
  const budgetTitle = makeRoomElement('h3', '카테고리별 예산');
  const list = makeRoomElement('div', '', 'budget-list'); list.id = 'budgetList';
  budget.append(budgetTitle, list);
  shell.append(header, calendar, budget); modal.append(shell); document.body.append(modal);
  return modal;
}

function ensureRoomModal() {
  let modal = document.querySelector('#roomModal');
  if (!modal) modal = createFallbackRoomModal();
  if (!wiredRoomModals.has(modal)) {
    wiredRoomModals.add(modal);
    modal.addEventListener('cancel', event => { event.preventDefault(); closeRoomModal(); });
    modal.addEventListener('close', restoreModalFocus);
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest?.('[data-room-close], #roomModalClose, #closeRoomModal')) closeRoomModal();
    });
  }
  return modal;
}

function ensurePanel(modal, id) {
  let panel = document.querySelector(`#${id}`);
  if (panel) return panel;
  panel = makeRoomElement('section', '', 'room-panel'); panel.id = id;
  if (id === 'calendarPanel') {
    const title = makeRoomElement('h3'); title.id = 'calendarMonth';
    const nav = makeRoomElement('div');
    const prev = makeRoomElement('button', '이전 달'); prev.type = 'button'; prev.id = 'calendarPrev';
    const next = makeRoomElement('button', '다음 달'); next.type = 'button'; next.id = 'calendarNext';
    nav.append(prev, next);
    const grid = makeRoomElement('div'); grid.id = 'calendarGrid';
    const selected = makeRoomElement('p'); selected.id = 'calendarSelectedDate';
    const memo = document.createElement('textarea'); memo.id = 'calendarMemo'; memo.maxLength = 1000;
    const save = makeRoomElement('button', '메모 저장'); save.type = 'button'; save.id = 'calendarSave';
    panel.append(title, nav, grid, selected, memo, save);
  } else {
    const title = makeRoomElement('h3', '카테고리별 예산');
    const list = makeRoomElement('div'); list.id = 'budgetList'; panel.append(title, list);
  }
  const shell = modal.querySelector('.room-modal-shell');
  if (shell) shell.append(panel); else modal.append(panel);
  return panel;
}

function restoreModalFocus() {
  const focus = modalReturnFocus;
  modalReturnFocus = null;
  if (focus && document.contains(focus) && typeof focus.focus === 'function') focus.focus();
}

function closeRoomModal() {
  const modal = document.querySelector('#roomModal');
  if (!modal) return false;
  try {
    if (typeof modal.close === 'function' && modal.open) modal.close();
    else { modal.removeAttribute('open'); modal.hidden = true; restoreModalFocus(); }
  } catch { modal.hidden = true; restoreModalFocus(); }
  return true;
}

function calendarControl(panel, selectors) {
  for (const selector of selectors) {
    const element = panel.querySelector(selector);
    if (element) return element;
  }
  return null;
}

function renderCalendar(panel) {
  const title = calendarControl(panel, ['#calendarMonth', '#calendarMonthLabel', '[data-calendar-month]', '.calendar-month-title']);
  if (title) title.textContent = `${calendarState.month.getFullYear()}년 ${calendarState.month.getMonth() + 1}월`;
  const selected = calendarControl(panel, ['#calendarSelectedDate', '[data-calendar-selected]']);
  if (selected) selected.textContent = `${calendarState.selected} 메모`;
  const memo = calendarControl(panel, ['#calendarMemo', '[data-calendar-memo]', 'textarea']);
  if (memo && document.activeElement !== memo) memo.value = calendarState.memos[calendarState.selected] || '';
  const grid = calendarControl(panel, ['#calendarGrid', '[data-calendar-grid]', '.calendar-grid']);
  if (!grid) return;
  grid.replaceChildren();
  for (const weekday of ['일', '월', '화', '수', '목', '금', '토']) {
    const header = makeRoomElement('span', weekday, 'calendar-weekday');
    header.setAttribute('role', 'columnheader');
    grid.append(header);
  }
  const year = calendarState.month.getFullYear(), month = calendarState.month.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let index = 0; index < 42; index += 1) {
    const day = index - firstDay + 1;
    if (day < 1 || day > daysInMonth) {
      const empty = makeRoomElement('span', '', 'calendar-empty');
      empty.setAttribute('role', 'gridcell');
      empty.setAttribute('aria-hidden', 'true');
      grid.append(empty);
      continue;
    }
    const keyValue = dateKey(new Date(year, month, day));
    const button = makeRoomElement('button', String(day), 'calendar-date');
    button.type = 'button'; button.dataset.calendarDate = keyValue;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', `${keyValue} 선택`);
    button.setAttribute('aria-pressed', String(keyValue === calendarState.selected));
    button.setAttribute('aria-selected', String(keyValue === calendarState.selected));
    if (keyValue === calendarState.selected) button.classList.add('is-selected');
    if (calendarState.memos[keyValue]) button.classList.add('has-memo');
    grid.append(button);
  }
}

function selectCalendarDate(value) {
  if (!validDateKey(value)) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const selected = new Date(year, month - 1, day);
  if (dateKey(selected) !== value) return false;
  calendarState.selected = value;
  calendarState.month = new Date(year, month - 1, 1);
  const panel = document.querySelector('#calendarPanel');
  if (panel) renderCalendar(panel);
  return true;
}

function saveCalendarMemo(panel) {
  const memo = calendarControl(panel, ['#calendarMemo', '[data-calendar-memo]', 'textarea']);
  if (!memo) return false;
  const value = String(memo.value || '').slice(0, 1000);
  if (value) calendarState.memos[calendarState.selected] = value;
  else delete calendarState.memos[calendarState.selected];
  persistCalendarMemos();
  const status = calendarControl(panel, ['#calendarSaveStatus', '[data-calendar-save-status]']);
  if (status) status.textContent = '저장했어요';
  renderCalendar(panel);
  return true;
}

function renderBudget(panel) {
  const totals = budgetTotals();
  const overall = clamp(Math.round((totals.used / Math.max(1, totals.budget)) * 100));
  const title = calendarControl(panel, ['#budgetOverall', '[data-budget-overall]', '.budget-overall']);
  if (title) title.textContent = `전체 사용률 ${overall}% · ${totals.used.toLocaleString('ko-KR')}원 / ${totals.budget.toLocaleString('ko-KR')}원`;
  const summary = calendarControl(panel, ['#budgetSummary', '#budgetOverall', '[data-budget-overall]', '.budget-overall']);
  if (summary) {
    summary.replaceChildren(
      makeRoomElement('span', '전체 예산'),
      makeRoomElement('strong', `${totals.budget.toLocaleString('ko-KR')}원`),
      makeRoomElement('small', `현재 사용률 ${overall}% · ${totals.used.toLocaleString('ko-KR')}원 사용`),
    );
  }
  let list = calendarControl(panel, ['#budgetList', '#budgetCategoryList', '[data-budget-list]', '.budget-list', '.budget-category-list']);
  if (!list) { list = makeRoomElement('div', '', 'budget-list'); list.id = 'budgetList'; panel.append(list); }
  list.replaceChildren();
  const formatter = new Intl.NumberFormat('ko-KR');
  for (const item of BUDGET_DATA) {
    const percent = clamp(Math.round((item.used / Math.max(1, item.budget)) * 100));
    const row = makeRoomElement('article', '', 'budget-row'); row.dataset.budgetCategory = item.id;
    const heading = makeRoomElement('div', '', 'budget-row-heading');
    heading.append(makeRoomElement('strong', item.label), makeRoomElement('span', `${percent}%`));
    const detail = makeRoomElement('p', `${formatter.format(item.used)}원 사용 · ${formatter.format(item.budget)}원 예산`);
    const track = makeRoomElement('div', '', 'budget-progress'); track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', String(percent));
    track.setAttribute('aria-label', `${item.label} 사용률 ${percent}%`);
    const fill = makeRoomElement('span'); fill.style.width = `${percent}%`; fill.style.backgroundColor = item.color; track.append(fill);
    row.append(heading, detail, track); list.append(row);
  }
}

function openPanel(id) {
  const panelId = id === 'calendar' ? 'calendarPanel' : id === 'budget' ? 'budgetPanel' : String(id || '');
  if (!['calendarPanel', 'budgetPanel'].includes(panelId)) return false;
  const modal = ensureRoomModal();
  const panel = ensurePanel(modal, panelId);
  for (const candidate of ['#calendarPanel', '#budgetPanel']) {
    const element = document.querySelector(candidate);
    if (element) element.hidden = element !== panel;
  }
  if (panelId === 'calendarPanel') renderCalendar(panel); else renderBudget(panel);
  if (!modalReturnFocus && document.activeElement instanceof HTMLElement) modalReturnFocus = document.activeElement;
  modal.hidden = false;
  try {
    if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    else modal.setAttribute('open', '');
  } catch { modal.setAttribute('open', ''); }
  const focusable = panel.querySelector('button, textarea, input, select, [tabindex]:not([tabindex="-1"])');
  queueMicrotask(() => focusable?.focus?.());
  return true;
}

function handleRoomInteractionClick(event) {
  const target = event.target?.closest?.('#calendarHotspot, #budgetHotspot, [data-calendar-nav], #calendarPrev, #calendarNext, #prevMonth, #nextMonth, [data-calendar-date], #calendarSave, #saveCalendarMemo, [data-calendar-save]');
  if (!target) return;
  if (target.id === 'calendarHotspot') { openPanel('calendarPanel'); return; }
  if (target.id === 'budgetHotspot') { openPanel('budgetPanel'); return; }
  if (target.matches('[data-calendar-nav], #calendarPrev, #calendarNext, #prevMonth, #nextMonth')) {
    const direction = target.dataset.calendarNav || (target.id === 'calendarPrev' || target.id === 'prevMonth' ? 'prev' : 'next');
    calendarState.month = new Date(calendarState.month.getFullYear(), calendarState.month.getMonth() + (direction === 'prev' || direction === 'previous' ? -1 : 1), 1);
    const panel = document.querySelector('#calendarPanel'); if (panel) renderCalendar(panel);
    return;
  }
  if (target.matches('[data-calendar-date]')) { selectCalendarDate(target.dataset.calendarDate); return; }
  if (target.matches('#calendarSave, #saveCalendarMemo, [data-calendar-save]')) { const panel = document.querySelector('#calendarPanel'); if (panel) saveCalendarMemo(panel); }
}

document.addEventListener('click', handleRoomInteractionClick);
document.addEventListener('input', event => {
  const target = event.target;
  if (!target?.matches?.('#calendarMemo, [data-calendar-memo]')) return;
  const value = String(target.value || '').slice(0, 1000);
  if (value) calendarState.memos[calendarState.selected] = value;
  else delete calendarState.memos[calendarState.selected];
  persistCalendarMemos();
});

function footprintContains(o,x,y,margin=0) {
  return x >= o.x-margin && x <= o.x+o.w+margin && y >= o.y-margin && y <= o.y+o.d+margin;
}
function isBlocked(x,y,ignoreId=null) {
  if (x < .25 || x > WORLD_W-.25 || y < .25 || y > WORLD_H-.25) return true;
  return objects.some(o => o.id !== ignoreId && footprintContains(o,x,y,.12));
}
function roundGrid(v) { return Math.round(v/GRID)*GRID; }
function key(x,y) { return `${Math.round(x/GRID)},${Math.round(y/GRID)}`; }
function parseKey(k) { const [ix,iy]=k.split(',').map(Number); return {x:ix*GRID,y:iy*GRID}; }

function findPath(sx,sy,tx,ty,ignoreId = null) {
  const start={x:roundGrid(sx),y:roundGrid(sy)}, target={x:roundGrid(tx),y:roundGrid(ty)};
  if (isBlocked(target.x,target.y,ignoreId)) return [];
  const startKey=key(start.x,start.y), targetKey=key(target.x,target.y);
  const open=new Set([startKey]);
  const came=new Map();
  const g=new Map([[startKey,0]]);
  const f=new Map([[startKey,Math.abs(start.x-target.x)+Math.abs(start.y-target.y)]]);
  const dirs=[[GRID,0],[-GRID,0],[0,GRID],[0,-GRID]];
  let guard=0;
  while(open.size && guard++<2500){
    let current=null,best=Infinity;
    for(const k of open){const score=f.get(k)??Infinity;if(score<best){best=score;current=k;}}
    if(current===targetKey){
      const path=[];let c=current;while(c!==startKey){const p=parseKey(c);path.unshift(p);c=came.get(c);if(!c)break;}return path;
    }
    open.delete(current);
    const cp=parseKey(current);
    for(const [dx,dy] of dirs){
      const nx=roundGrid(cp.x+dx),ny=roundGrid(cp.y+dy),nk=key(nx,ny);
      if(isBlocked(nx,ny,ignoreId) && nk!==targetKey)continue;
      const tentative=(g.get(current)??Infinity)+1;
      if(tentative<(g.get(nk)??Infinity)){
        came.set(nk,current);g.set(nk,tentative);
        f.set(nk,tentative+Math.abs(nx-target.x)/GRID+Math.abs(ny-target.y)/GRID);
        open.add(nk);
      }
    }
  }
  return [];
}

function interactionAnchor(o,kind) {
  const rel=o.interaction?.[kind];
  return rel ? {x:o.x+rel[0],y:o.y+rel[1]} : null;
}

function validInteractionPlacement(o, x = o.x, y = o.y) {
  if (!o.interaction) return true;
  const candidate = { ...o, x, y };
  for (const kind of ['approach', 'use']) {
    const anchor = interactionAnchor(candidate, kind);
    if (!anchor || anchor.x < .25 || anchor.x > WORLD_W - .25 || anchor.y < .25 || anchor.y > WORLD_H - .25) return false;
    if (kind === 'approach' && footprintContains(candidate, anchor.x, anchor.y, .08)) return false;
    if (objects.some(other => other.id !== o.id && footprintContains(other, anchor.x, anchor.y, .14))) return false;
  }
  return true;
}

function replanAfterFurnitureMove() {
  const pending = agent.afterPath?.type === 'interaction' ? objects.find(o => o.id === agent.afterPath.objectId) : null;
  const target = pending ? interactionAnchor(pending, 'approach') : agent.destination;
  if (!target) return;
  const path = findPath(agent.x, agent.y, target.x, target.y);
  if (!path.length && Math.hypot(agent.x - target.x, agent.y - target.y) > .25) {
    agent.path = []; agent.afterPath = null; agent.destination = null; agent.mode = 'idle';
    setState('이동 경로를 다시 계산할 수 없습니다.');
    showHint('가구 이동으로 경로가 막혔습니다.', true);
    return;
  }
  agent.path = path;
  agent.mode = path.length ? 'moving' : 'idle';
  if (!path.length && pending) {
    agent.afterPath = null;
    enterInteraction(pending, agent.interaction?.manual ?? false);
  }
}

function commandMove(x,y,{manual=true}={}) {
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return false;
  const tx=roundGrid(Number(x)),ty=roundGrid(Number(y));
  if(isBlocked(tx,ty)){ showHint('그 위치는 가구가 차지하고 있습니다.',true); return false; }
  exitInteraction();
  const path=findPath(agent.x,agent.y,tx,ty);
  if(!path.length && Math.hypot(agent.x-tx,agent.y-ty)>.2){showHint('이동 가능한 경로가 없습니다.',true);return false;}
  pendingUseId = null;
  agent.path=path;agent.afterPath=null;agent.destination={x:tx,y:ty};agent.approachTransition=null;agent.mode=path.length?'moving':'idle';agent.manualHold=manual;
  if (!path.length) agent.destination = null;
  setState(agent.mode==='moving'?'이동 중':'대기 중');
  return true;
}

function commandUse(id,{manual=true}={}) {
  const o=objects.find(x=>x.id===id);
  if(!o?.interaction)return false;
  if (!validInteractionPlacement(o)) { showHint(`${o.name}의 접근 위치가 막혀 사용할 수 없습니다.`, true); return false; }
  exitInteraction();
  const a=interactionAnchor(o,'approach');
  if (!a) return false;
  const path=findPath(agent.x,agent.y,a.x,a.y);
  if(!path.length && Math.hypot(agent.x-a.x,agent.y-a.y)>.25){showHint(`${o.name}까지 갈 수 없습니다. 가구 배치를 확인하세요.`,true);return false;}
  agent.path=path;
  agent.afterPath={type:'interaction',objectId:o.id,manual};
  agent.destination={x:a.x,y:a.y};
  agent.mode=path.length?'moving':'idle';
  pendingUseId = o.id;
  needCooldowns[o.id] = Math.max(needCooldowns[o.id], performance.now() + (manual ? 5000 : 8500));
  if(!path.length) enterInteraction(o,manual);
  else setState(`${o.name}로 이동 중`);
  return true;
}

function enterInteraction(o,manual,now = performance.now()) {
  const use=interactionAnchor(o,'use');
  const approach=interactionAnchor(o,'approach');
  if (!use || !approach) return false;
  agent.x=approach.x;agent.y=approach.y;agent.path=[];agent.afterPath=null;agent.destination={x:use.x,y:use.y};
  agent.approachTransition={from:{x:approach.x,y:approach.y},to:{x:use.x,y:use.y},started:now,duration:reducedMotion?0:(Number(o.interaction.visual?.enter)||360)};
  agent.interaction={objectId:o.id,manual,phase:'approach',until:manual?Infinity:now+4700};
  pendingUseId = o.id;
  agent.mode='approach';
  agent.facing=o.id==='desk'?-1:1;
  setState(o.interaction.label);
  showHint(`${o.name} 사용 상태입니다. 다른 곳을 누르면 자연스럽게 일어나 이동합니다.`);
  return true;
}

function exitInteraction() {
  pendingUseId = null;
  if(!agent.interaction){ agent.approachTransition=null; return; }
  const o=objects.find(x=>x.id===agent.interaction.objectId);
  if(o){const a=interactionAnchor(o,'approach');if(a){agent.x=a.x;agent.y=a.y;}}
  agent.interaction=null;agent.approachTransition=null;agent.destination=null;agent.mode='idle';
  updateUseControls();
}

function commandGesture(name) {
  if(!poseNames.includes(name)||name==='idle')return;
  exitInteraction();
  agent.path=[];agent.afterPath=null;agent.gesture=name;agent.gestureUntil=performance.now()+1900;agent.mode='gesture';
  setState({wave:'인사하는 중',celebrate:'축하하는 중',scan:'주변을 스캔하는 중'}[name]);
}

function updateNeeds(dt) {
  const rates = { energy: -.78, focus: -.38, comfort: -.22 };
  if (agent.mode === 'lying') rates.energy = 4.4, rates.focus = .25, rates.comfort = 3.1;
  if (agent.mode === 'sitting') rates.energy = .35, rates.focus = .7, rates.comfort = 2.8;
  if (agent.mode === 'studying') rates.energy = -.9, rates.focus = 4.6, rates.comfort = .25;
  for (const key of Object.keys(rates)) needs[key] = clamp(needs[key] + rates[key] * dt);
  updateNeedMeters();
}

function update(dt,now) {
  updateNeeds(dt);
  updateParticles(dt, now);
  persistClock += dt;
  if (persistClock >= 1) { persistClock = 0; schedulePersist(); }
  if(agent.gesture){
    if(now>=agent.gestureUntil){agent.gesture=null;agent.mode='idle';setState(autonomous?'자율 이동':'수동 조작');agent.nextDecisionAt=now+700;}
    return;
  }
  if(agent.interaction){
    if (agent.interaction.phase === 'approach') {
      const transition = agent.approachTransition;
      const progress = transition ? clamp((now - transition.started) / Math.max(1, transition.duration), 0, 1) : 1;
      const eased = easeOutCubic(progress);
      if (transition) {
        agent.x = transition.from.x + (transition.to.x - transition.from.x) * eased;
        agent.y = transition.from.y + (transition.to.y - transition.from.y) * eased;
      }
      if (progress >= 1) {
        const target = getInteractiveObject();
        agent.approachTransition = null;
        agent.destination = null;
        agent.interaction.phase = 'active';
        agent.mode = target?.interaction?.action || 'idle';
        setState(target?.interaction?.label || '사용 중');
        if (target) showHint(`${target.name}을(를) 사용 중입니다.`);
      } else return;
    }
    if(!agent.interaction.manual && now>=agent.interaction.until){exitInteraction();agent.nextDecisionAt=now+600;setState(autonomous?'자율 이동':'수동 조작');}
    return;
  }
  if(agent.path.length){
    agent.mode='moving';
    const t=agent.path[0];const dx=t.x-agent.x,dy=t.y-agent.y;const dist=Math.hypot(dx,dy);
    if(dist<.035){agent.x=t.x;agent.y=t.y;agent.path.shift();}
    else{const step=Math.min(agent.speed*dt,dist);agent.x+=dx/dist*step;agent.y+=dy/dist*step;if(Math.abs(dx)>0.01)agent.facing=dx>=0?1:-1;}
    if(!agent.path.length){
      agent.mode='idle';
      const next=agent.afterPath;agent.afterPath=null;
      if (!next?.type) agent.destination = null;
      if(next?.type==='interaction'){const o=objects.find(x=>x.id===next.objectId);if(o)enterInteraction(o,next.manual);}
      else {setState(autonomous?'자율 이동':'수동 조작');agent.nextDecisionAt=now+900;}
    }
    return;
  }
  agent.mode='idle';
  if(autonomous && now>=agent.nextDecisionAt){ autonomousDecision(now); }
}

function autonomousDecision(now) {
  const candidates = objects
    .filter(o => o.interaction && now >= (needCooldowns[o.id] || 0))
    .map(o => ({ object: o, utility: (100 - needs[needForObject[o.id]]) + Math.random() * 6 }))
    .sort((a, b) => b.utility - a.utility);
  // A little wandering keeps the room alive without letting randomness override unmet needs.
  if (candidates.length && Math.random() > .18) {
    const target = candidates[0].object;
    if (commandUse(target.id, { manual: false })) needCooldowns[target.id] = now + 8500;
    else needCooldowns[target.id] = now + 1200;
  } else {
    for (let i = 0; i < 36; i++) {
      const x = .7 + Math.random() * (WORLD_W - 1.4), y = .7 + Math.random() * (WORLD_H - 1.4);
      if (!isBlocked(roundGrid(x), roundGrid(y))) { commandMove(x, y, { manual: false }); break; }
    }
  }
  agent.nextDecisionAt = now + 2800 + Math.random() * 1700;
}

function setState(text){if(stateLabel)stateLabel.textContent=text;updateUseControls();}
function showHint(text,error=false){
  if(!hintEl)return;hintEl.textContent=text;hintEl.classList.toggle('is-error',error);clearTimeout(hintTimer);
  hintTimer=setTimeout(()=>{hintEl.textContent=editMode?'가구를 드래그해 배치하세요. 겹치는 위치는 거부됩니다.':'가구를 누르면 사용합니다. 빈 바닥을 누르면 이동합니다.';hintEl.classList.remove('is-error');},2800);
}

function pointerWorld(event) {
  const rect=canvas.getBoundingClientRect();
  return inverseProject(event.clientX-rect.left,event.clientY-rect.top);
}
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i += 1) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function wallBoardAt(event) {
  const rect = canvas.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  return Object.entries(WALL_BOARDS).find(([, board]) => pointInPolygon(point, wallBoardPoints(board)))?.[0] || null;
}
function objectAt(x,y){
  return [...objects].sort((a,b)=>objectDepth(b)-objectDepth(a)).find(o=>footprintContains(o,x,y,.12))||null;
}

function overlap(a,b,margin=.12){return !(a.x+a.w+margin<=b.x || b.x+b.w+margin<=a.x || a.y+a.d+margin<=b.y || b.y+b.d+margin<=a.y);}
function canPlace(o,x,y){
  if(x<.2||y<.2||x+o.w>WORLD_W-.2||y+o.d>WORLD_H-.2)return false;
  const probe={...o,x,y};
  if(footprintContains(probe,agent.x,agent.y,.18))return false;
  return !objects.some(other=>other.id!==o.id&&overlap(probe,other,.1)) && validInteractionPlacement(o,x,y);
}

function commitFurniturePosition(o, x, y) {
  if (!o || agent.interaction?.objectId === o.id || !canPlace(o, x, y)) return false;
  if (o.x === x && o.y === y) return true;
  o.x = x; o.y = y; selectedObjectId = o.id;
  updateUseControls();
  replanAfterFurnitureMove();
  persistState();
  return true;
}

function nudgeFurniture(id, direction, amount = GRID) {
  const vectors = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1], '-x': [-1, 0], '+x': [1, 0], '-y': [0, -1], '+y': [0, 1] };
  const o = objects.find(candidate => candidate.id === id);
  const vector = vectors[String(direction || '').toLowerCase()];
  if (!o || !vector) return false;
  if (agent.interaction?.objectId === o.id) { showHint('현재 사용 중인 가구는 이동할 수 없습니다.', true); return false; }
  const step = Number.isFinite(Number(amount)) ? Math.max(GRID, Number(amount)) : GRID;
  const x = roundGrid(o.x + vector[0] * step), y = roundGrid(o.y + vector[1] * step);
  if (!canPlace(o, x, y)) { showHint('접근 위치가 막히거나 다른 가구와 겹칩니다.', true); return false; }
  commitFurniturePosition(o, x, y);
  showHint(`${o.name} 위치를 조정했습니다.`);
  return true;
}

function finishDrag(event, cancelled = false) {
  const current = drag;
  if (!current) { canvas.releasePointerCapture?.(event?.pointerId); return; }
  if (event?.pointerId != null && current.pointerId !== event.pointerId) return;
  drag = null;
  const target = objects.find(o => o.id === current.id);
  const preview = current.preview;
  if (!cancelled && target && preview?.valid && commitFurniturePosition(target, preview.x, preview.y)) showHint('가구 배치를 적용했습니다. 상호작용 앵커도 함께 이동했습니다.');
  else if (cancelled || !preview?.valid) showHint('유효하지 않은 위치라 원래 배치를 유지했습니다.', true);
  canvas.releasePointerCapture?.(event?.pointerId);
}

function handleNudgeControl(control) {
  const raw = String(control.dataset.nudge || '').toLowerCase();
  const parts = raw.split(':');
  let id = control.dataset.object || control.dataset.nudgeObject || selectedObjectId;
  let direction = raw;
  if (parts.length > 1) { if (objects.some(o => o.id === parts[0])) id = parts[0]; direction = parts[parts.length - 1]; }
  return nudgeFurniture(id, direction, Number(control.dataset.step) || GRID);
}

canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  const board = wallBoardAt(event);
  if (board) { openPanel(board === 'calendar' ? 'calendarPanel' : 'budgetPanel'); return; }
  const w=pointerWorld(event);const o=objectAt(w.x,w.y);
  if(editMode){
    if(!o)return;
    selectedObjectId=o.id;updateUseControls();
    if(agent.interaction?.objectId===o.id){showHint('현재 사용 중인 가구는 이동할 수 없습니다.',true);return;}
    drag={id:o.id,pointerId:event.pointerId,dx:w.x-o.x,dy:w.y-o.y,lastX:o.x,lastY:o.y,preview:{x:o.x,y:o.y,valid:true}};
    canvas.setPointerCapture?.(event.pointerId);hoverObjectId=o.id;return;}
  if(o?.interaction){commandUse(o.id,{manual:true});return;}
  if(!o)commandMove(w.x,w.y,{manual:true});
});
canvas.addEventListener('pointerup',event=>{finishDrag(event);event.stopImmediatePropagation();},true);
canvas.addEventListener('pointercancel',event=>{finishDrag(event,true);event.stopImmediatePropagation();},true);
canvas.addEventListener('pointermove',event=>{
  const w=pointerWorld(event);const o=objectAt(w.x,w.y);hoverObjectId=drag?.id||o?.id||null;
  if(!drag)return;
  if(drag.pointerId!==event.pointerId)return;
  const target=objects.find(x=>x.id===drag.id);if(!target)return;
  const nx=Math.round((w.x-drag.dx)*4)/4,ny=Math.round((w.y-drag.dy)*4)/4;
  drag.preview={x:nx,y:ny,valid:canPlace(target,nx,ny)};
  if(drag.preview.valid)showHint(`${target.name} 배치 중`);else showHint('유효하지 않은 배치입니다.',true);
});
canvas.addEventListener('pointerleave',()=>{if(!drag)hoverObjectId=null;});

roomSkinEl?.addEventListener('change',e=>{if(paletteMap[e.target.value]){roomSkin=e.target.value;schedulePersist();}});
characterSkinEl?.addEventListener('change',e=>{if(assets[e.target.value]){agent.skin=e.target.value;schedulePersist();}});
autoModeEl?.addEventListener('change',e=>{autonomous=e.target.checked;agent.manualHold=false;if(autonomous)agent.nextDecisionAt=performance.now()+500;setState(autonomous?'자율 이동':'수동 조작');});
editModeEl?.addEventListener('change',e=>{editMode=e.target.checked;if(!editMode){drag=null;selectedObjectId=null;}updateUseControls();showHint(editMode?'가구를 선택한 뒤 드래그하거나 방향 버튼으로 배치하세요.':'가구를 누르면 사용합니다. 빈 바닥을 누르면 이동합니다.');});
document.querySelectorAll('[data-gesture]').forEach(b=>b.addEventListener('click',()=>commandGesture(b.dataset.gesture)));
document.querySelectorAll('[data-use]').forEach(b=>b.addEventListener('click',()=>commandUse(b.dataset.use,{manual:true})));
document.querySelectorAll('[data-nudge]').forEach(control=>control.addEventListener('click',()=>handleNudgeControl(control)));
resetRoomEl?.addEventListener('click',resetRoom);
document.addEventListener('keydown',event=>{
  if(!editMode||!selectedObjectId||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  if(event.target?.closest?.('input, select, button, textarea, a, [contenteditable="true"]'))return;
  event.preventDefault();
  nudgeFurniture(selectedObjectId,{ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[event.key]);
});

function frame(now){
  const dt=Math.min((now-lastTime)/1000,.05);lastTime=now;update(dt,now);drawScene(now);raf=requestAnimationFrame(frame);
}

window.addEventListener('resize',resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
reducedMotionQuery?.addEventListener?.('change', event=>{reducedMotion=event.matches;});
loadState();
updateNeedMeters();
updateUseControls();
resize();
raf=requestAnimationFrame(frame);

window.PhysicalDiorama = {
  use: id => commandUse(id,{manual:true}),
  gesture: commandGesture,
  moveTo: (x,y)=>commandMove(x,y,{manual:true}),
  setRoomSkin: skin => {if(paletteMap[skin]){roomSkin=skin;if(roomSkinEl)roomSkinEl.value=skin;schedulePersist();}},
  setCharacterSkin: skin => {if(assets[skin]){agent.skin=skin;if(characterSkinEl)characterSkinEl.value=skin;schedulePersist();}},
  setAutonomous: enabled => {autonomous=Boolean(enabled);if(autoModeEl)autoModeEl.checked=autonomous;agent.nextDecisionAt=performance.now()+300;setState(autonomous?'자율 이동':'수동 조작');},
  setEditMode: enabled => {editMode=Boolean(enabled);if(editModeEl)editModeEl.checked=editMode;if(!editMode){drag=null;selectedObjectId=null;}updateUseControls();},
  setSpeed: speed => {const value=Number(speed);agent.speed=Number.isFinite(value)?Math.max(.4,Math.min(value,6)):1.6;},
  project: (x,y,z=0)=>project(x,y,z),
  nudge: (id,direction,amount=GRID)=>nudgeFurniture(id,direction,amount),
  openPanel,
  getInteractionAssetsReady: () => Object.values(interactionSheets).every(state => state.ready),
  reset: resetRoom,
  getState: ()=>({agent:{...agent,path:[...agent.path]},objects:objects.map(o=>JSON.parse(JSON.stringify(o))),roomSkin,autonomous,editMode,selectedObjectId,needs:{...needs}}),
};
