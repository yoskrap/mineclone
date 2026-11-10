// MineClone — 메인: 렌더링, 화면 전환, 입력, 게임 루프
import * as THREE from 'three';
import { B, I, BLOCKS, T, isBlock, isSolid, itemName, breakTime, canHarvest } from './blocks.js';
import { buildAtlas, buildIcons, iconFor, averageColors, buildCrackTextures, tileUV, TILE, ATLAS_COLS } from './textures.js';
import { World, CH, SEA, CS } from './world.js';
import { Player } from './player.js';
import { Inventory, InventoryUI, renderHotbar, tickFurnaces, newFurnace } from './inventory.js';
import { listWorlds, loadWorld, saveWorld, deleteWorld, loadSettings, saveSettings } from './storage.js';
import { hashSeed } from './noise.js';
import * as SFX from './sound.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ================= 렌더러 / 씬 =================
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1200);
camera.rotation.order = 'YXZ';
scene.fog = new THREE.Fog(0x7ba4ff, 40, 80);
const handScene = new THREE.Scene();
const handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);

const atlas = buildAtlas();
buildIcons(atlas.canvas);
const avgColors = averageColors(atlas.canvas);
const crackTex = buildCrackTextures();
const materials = {
  opaque: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5 }),
  water: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide }),
};

// 메뉴 배경용 흙 타일
{
  const c = document.createElement('canvas'); c.width = c.height = TILE;
  c.getContext('2d').drawImage(atlas.canvas, (T.dirt % ATLAS_COLS) * TILE, Math.floor(T.dirt / ATLAS_COLS) * TILE, TILE, TILE, 0, 0, TILE, TILE);
  document.documentElement.style.setProperty('--dirt', `url(${c.toDataURL()})`);
}

// ================= 하늘: 해, 달, 별, 구름 =================
function pixelTexture(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const sky = new THREE.Group(); scene.add(sky);
const sun = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({
  map: pixelTexture(32, (g) => { g.fillStyle = 'rgba(255,240,150,0.25)'; g.fillRect(4, 4, 24, 24); g.fillStyle = '#fff6b0'; g.fillRect(9, 9, 14, 14); g.fillStyle = '#ffffff'; g.fillRect(11, 11, 10, 10); }),
  transparent: true, fog: false, depthWrite: false,
}));
const moon = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshBasicMaterial({
  map: pixelTexture(16, (g) => { g.fillStyle = '#d9dde6'; g.fillRect(3, 3, 10, 10); g.fillStyle = '#aab0bd'; g.fillRect(5, 5, 3, 3); g.fillRect(9, 9, 2, 2); g.fillRect(9, 5, 2, 1); }),
  transparent: true, fog: false, depthWrite: false,
}));
sun.renderOrder = moon.renderOrder = -5;
sky.add(sun, moon);
const starGeo = new THREE.BufferGeometry(); {
  const p = []; for (let i = 0; i < 900; i++) { const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(500); p.push(v.x, v.y, v.z); }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
stars.renderOrder = -6; sky.add(stars);
const cloudTex = pixelTexture(64, (g) => {
  const r = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  g.fillStyle = '#fff';
  for (let k = 0; k < 22; k++) { const x = Math.floor(r() * 64), y = Math.floor(r() * 64), w = 3 + Math.floor(r() * 9), h = 2 + Math.floor(r() * 6); for (const [ox, oy] of [[0, 0], [-64, 0], [0, -64], [-64, -64]]) g.fillRect(x + ox, y + oy, w, h); }
});
cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping; cloudTex.repeat.set(8, 8);
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(1536, 1536), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
clouds.rotation.x = -Math.PI / 2; clouds.position.y = CH + 14; clouds.renderOrder = 2; scene.add(clouds);

// 블록 선택 테두리 + 균열
const highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
highlight.visible = false; scene.add(highlight);
const crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), new THREE.MeshBasicMaterial({ map: crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
crack.visible = false; scene.add(crack);

// ================= 상태 =================
const G = {
  state: 'title', optionsReturn: 'title', settings: loadSettings(),
  world: null, titleWorld: null, player: null, inventory: null, meta: null,
  mode: 'survival', time: 1000, debug: false, hideHud: false,
  keys: {}, mouseL: false, mouseR: false, jumpPressed: false, lastWTap: 0, sprintToggle: false,
  breaking: { key: '', progress: 0, hitTimer: 0 }, cooldown: 0, placeCooldown: 0,
  particles: [], locked: false, lockFailed: false, expectUnlock: false,
  autosave: 0, fps: 0, frames: 0, fpsTime: 0, lastHealth: -1, lastAir: -1, lastSel: -1,
  swing: 0, hurtTilt: 0, lastCause: '', target: null, stepPhase: 0, daylight: 1,
  selectedWorld: null, newMode: 'survival', titleYaw: 0,
};
const invUI = new InventoryUI({
  get inventory() { return G.inventory; }, get world() { return G.world; },
  sound: (n) => SFX.play(n), drawPlayerPreview,
});
SFX.setVolume(G.settings.sound / 100);

// ================= 화면 전환 =================
function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.remove('show'));
  if (name) $('#screen-' + name)?.classList.add('show');
  const inGame = ['game', 'pause', 'dead'].includes(G.state) || (G.state === 'options' && G.optionsReturn === 'pause');
  $('#hud').classList.toggle('hidden', !inGame || G.hideHud);
  canvas.classList.toggle('blur', G.state === 'title');
}
function setState(s, screen = s) { G.state = s; showScreen(['game'].includes(s) ? null : screen); }

const SPLASHES = ['AI로 역분석!', '텍스처 100% 코드로 그림!', 'Three.js로 제작!', '청크 단위 로딩!', '브라우저에서 바로 실행!', '버그도 기능입니다!', '설치 필요 없음!', 'Simplex 노이즈!', '레드스톤은 다음에!'];
function toTitle() {
  setState('title');
  $('#splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
  if (!G.titleWorld) {
    G.titleWorld = new World({ seed: hashSeed('mineclone-panorama'), scene, materials });
    const sp = G.titleWorld.findSpawn(); G.titleSpawn = sp; G.time = 6000;
  }
}
function disposeTitleWorld() { if (G.titleWorld) { G.titleWorld.dispose(); G.titleWorld = null; } }

// ================= 월드 선택 화면 =================
async function openWorldList() {
  setState('worlds');
  const list = await listWorlds();
  const el = $('#world-list');
  G.selectedWorld = null; updateWorldButtons();
  if (!list.length) { el.innerHTML = '<div class="empty-list">저장된 월드가 없습니다.<br>"새로운 월드 만들기"를 눌러 시작하세요.</div>'; return; }
  const icon = iconFor(B.GRASS);
  el.innerHTML = list.map((w) => `<div class="world-item" data-id="${w.id}">
    <div class="world-icon" style="background-image:url(${icon})"></div>
    <div class="world-meta"><div class="world-name">${escapeHtml(w.name)}</div>
    <div class="world-sub">${escapeHtml(w.name)} (${new Date(w.lastPlayed).toLocaleString('ko-KR')})</div>
    <div class="world-sub">${w.mode === 'creative' ? '크리에이티브' : '서바이벌'} 모드, 시드: ${escapeHtml(String(w.seedText ?? w.seed))}</div></div></div>`).join('');
  $$('.world-item').forEach((it) => {
    it.addEventListener('click', () => { $$('.world-item').forEach((x) => x.classList.remove('sel')); it.classList.add('sel'); G.selectedWorld = it.dataset.id; updateWorldButtons(); SFX.play('click'); });
    it.addEventListener('dblclick', () => playWorld(it.dataset.id));
  });
}
function updateWorldButtons() {
  $('#btn-play-world').disabled = !G.selectedWorld;
  const del = $('#btn-delete-world'); del.disabled = !G.selectedWorld; delete del.dataset.armed; del.textContent = '삭제';
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function playWorld(id) { const data = await loadWorld(id); if (data) startWorld(data); }

function openCreate() {
  setState('create');
  G.newMode = 'survival'; updateModeBtn();
  $('#in-world-name').value = '새로운 월드'; $('#in-seed').value = '';
  $('#world-folder').textContent = '저장될 이름: 새로운 월드';
}
function updateModeBtn() {
  const c = G.newMode === 'creative';
  $('#btn-mode').textContent = '게임 모드: ' + (c ? '크리에이티브' : '서바이벌');
  $('#mode-desc').textContent = c ? '무제한 자원, 자유로운 비행, 블록을 즉시 파괴할 수 있습니다' : '자원을 탐색하고, 제작하고, 체력을 관리하세요';
}
async function createWorld() {
  const name = $('#in-world-name').value.trim() || '새로운 월드';
  let seedText = $('#in-seed').value.trim();
  if (!seedText) seedText = String(Math.floor(Math.random() * 2 ** 31) * (Math.random() < 0.5 ? -1 : 1));
  const now = Date.now();
  const data = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), name, seedText, seed: hashSeed(seedText), mode: G.newMode, created: now, lastPlayed: now, time: 1000, diffs: {}, meta: {}, furnaces: {}, player: null, inventory: null };
  await saveWorld(data);
  startWorld(data);
}

// ================= 월드 시작 / 저장 =================
function startWorld(data) {
  disposeTitleWorld();
  G.meta = data; G.mode = data.mode; G.time = data.time ?? 0;
  G.world = new World({ seed: data.seed, scene, materials, diffs: data.diffs || {}, meta: data.meta || {}, furnaces: data.furnaces || {} });
  G.player = new Player(); G.inventory = new Inventory(data.inventory);
  if (!data.spawn) data.spawn = G.world.findSpawn();
  const p = G.player;
  if (data.player) { p.pos.set(data.player.x, data.player.y, data.player.z); p.yaw = data.player.yaw; p.pitch = data.player.pitch; p.health = data.player.health ?? 20; p.flying = !!data.player.flying; G.placed = true; }
  else { p.pos.set(data.spawn.x, CH, data.spawn.z); G.placed = false; }
  G.lastHealth = -1; G.lastSel = -1; G.autosave = 0;
  setState('loading');
  $('#loading-text').textContent = '지형 생성 중';
}
function updateLoading() {
  const w = G.world, p = G.player, rd = G.settings.renderDistance, r = Math.min(2, rd);
  w.update(p.pos.x, p.pos.z, rd, 30);
  const total = (2 * r + 1) ** 2; let done = 0;
  const pcx = Math.floor(p.pos.x / CS), pcz = Math.floor(p.pos.z / CS);
  for (const c of w.chunks.values()) if (c._ready && Math.abs(c.cx - pcx) <= r && Math.abs(c.cz - pcz) <= r) done++;
  $('#loading-fill').style.width = Math.round(done / total * 100) + '%';
  if (w.readyAround(p.pos.x, p.pos.z, r)) {
    if (!G.placed) { p.pos.y = w.surfaceY(Math.floor(p.pos.x), Math.floor(p.pos.z)); G.placed = true; }
    setState('game'); showScreen(null); renderHotbar(G.inventory);
    $('#lock-hint').classList.remove('hidden');
  }
}
function snapshot() {
  const p = G.player, w = G.world;
  return { ...G.meta, mode: G.mode, lastPlayed: Date.now(), time: G.time,
    player: { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, health: p.health, flying: p.flying },
    inventory: G.inventory.serialize(), ...w.serialize() };
}
async function saveCurrent() { if (!G.world || !G.meta) return; G.meta = snapshot(); await saveWorld(G.meta); }
async function saveAndQuit() {
  invUI.close();
  await saveCurrent();
  G.world.dispose(); G.world = null; G.player = null; G.meta = null;
  highlight.visible = crack.visible = false; clearHand(); clearParticles();
  document.exitPointerLock?.();
  toTitle();
}

// ================= 포인터 락 =================
function requestLock() {
  if (G.locked) return;
  try {
    const r = canvas.requestPointerLock?.();
    if (r && r.catch) r.catch(() => { G.lockFailed = true; });
  } catch { G.lockFailed = true; }
}
document.addEventListener('pointerlockchange', () => {
  G.locked = document.pointerLockElement === canvas;
  if (G.locked) { G.lockFailed = false; $('#lock-hint').classList.add('hidden'); return; }
  if (G.expectUnlock) { G.expectUnlock = false; return; }
  if (G.state === 'game' && !invUI.open) pause();
});
document.addEventListener('pointerlockerror', () => { G.lockFailed = true; $('#lock-hint').classList.add('hidden'); });
function releaseLock() { if (G.locked) { G.expectUnlock = true; document.exitPointerLock(); } }

function pause() { if (G.state !== 'game') return; G.keys = {}; G.mouseL = G.mouseR = false; releaseLock(); setState('pause'); saveCurrent(); }
function resume() { setState('game'); requestLock(); }

function openContainer(kind, key) {
  G.keys = {}; G.mouseL = G.mouseR = false; releaseLock();
  invUI.show(kind, key);
}
function closeContainer() { invUI.close(); renderHotbar(G.inventory); if (G.state === 'game') requestLock(); }

// ================= 입력 =================
const SENS = () => 0.0022 * G.settings.sensitivity / 100;
window.addEventListener('keydown', (e) => {
  const typing = e.target.tagName === 'INPUT';
  if (typing && e.key !== 'Escape') { if (e.key === 'Enter' && G.state === 'create') createWorld(); return; }
  if (['F1', 'F3', 'Tab', 'Space'].includes(e.code) || (e.code.startsWith('Digit') && G.state === 'game')) e.preventDefault();
  if (e.code === 'Escape') {
    if (invUI.open) { closeContainer(); return; }
    if (G.state === 'pause') { resume(); return; }
    if (G.state === 'options') { optionsDone(); return; }
    if (G.state === 'worlds') { toTitle(); return; }
    if (G.state === 'create') { openWorldList(); return; }
    return;
  }
  if (G.state !== 'game') return;
  if (e.code === 'KeyE') { if (invUI.open) closeContainer(); else openContainer(G.mode === 'creative' ? 'creative' : 'inventory'); return; }
  if (invUI.open) return;
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1 && n <= 9) G.inventory.selected = n - 1; }
  if (e.code === 'F3') { G.debug = !G.debug; $('#debug').classList.toggle('hidden', !G.debug); }
  if (e.code === 'F1') { G.hideHud = !G.hideHud; showScreen(null); }
  if (e.code === 'Space' && !e.repeat) G.jumpPressed = true;
  if (e.code === 'KeyW' && !e.repeat) { const now = performance.now(); if (now - G.lastWTap < 280) G.sprintToggle = true; G.lastWTap = now; }
  G.keys[e.code] = true;
});
window.addEventListener('keyup', (e) => { G.keys[e.code] = false; if (e.code === 'KeyW') G.sprintToggle = false; });
window.addEventListener('blur', () => { G.keys = {}; G.mouseL = G.mouseR = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (G.state !== 'game' || invUI.open) return;
  if (!G.locked && !G.lockFailed) { requestLock(); return; }
  if (e.button === 0) { G.mouseL = true; G.cooldown = 0; }
  if (e.button === 2) { G.mouseR = true; G.placeCooldown = 0; }
  if (e.button === 1) { e.preventDefault(); pickBlock(); }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) { G.mouseL = false; G.breaking.progress = 0; } if (e.button === 2) G.mouseR = false; });
document.addEventListener('mousemove', (e) => {
  if (G.state !== 'game' || invUI.open || !G.player) return;
  if (!G.locked && !G.lockFailed) return;
  const p = G.player; const s = SENS();
  p.yaw -= e.movementX * s; p.pitch -= e.movementY * s;
  p.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, p.pitch));
});
window.addEventListener('wheel', (e) => {
  if (G.state !== 'game' || invUI.open || !G.inventory) return;
  G.inventory.selected = (G.inventory.selected + (e.deltaY > 0 ? 1 : 8)) % 9;
}, { passive: true });

// 버튼 클릭
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn || btn.disabled) return;
  SFX.play('click');
  switch (btn.dataset.act) {
    case 'singleplayer': openWorldList(); break;
    case 'options': openOptions(); break;
    case 'quit': $('#splash').textContent = '브라우저 탭을 닫으면 종료됩니다!'; break;
    case 'play-selected': if (G.selectedWorld) playWorld(G.selectedWorld); break;
    case 'delete-selected': // 브라우저 confirm 대신 두 번 눌러 확인 (원본의 확인 화면 대체)
      if (!G.selectedWorld) break;
      if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = '삭제'; deleteWorld(G.selectedWorld).then(openWorldList); }
      else { btn.dataset.armed = '1'; btn.textContent = '한 번 더 누르면 삭제'; }
      break;
    case 'create': openCreate(); break;
    case 'back-title': toTitle(); break;
    case 'back-worlds': openWorldList(); break;
    case 'toggle-mode': G.newMode = G.newMode === 'survival' ? 'creative' : 'survival'; updateModeBtn(); break;
    case 'create-world': createWorld(); break;
    case 'resume': resume(); break;
    case 'save-quit': saveAndQuit(); break;
    case 'respawn': respawn(); break;
    case 'options-done': optionsDone(); break;
    case 'toggle-bob': G.settings.viewBobbing = !G.settings.viewBobbing; renderOptions(); break;
    case 'toggle-clouds': G.settings.clouds = !G.settings.clouds; renderOptions(); break;
  }
});
$('#in-world-name').addEventListener('input', (e) => { $('#world-folder').textContent = '저장될 이름: ' + (e.target.value.trim() || '새로운 월드'); });

// ================= 설정 화면 =================
function openOptions() { G.optionsReturn = G.state === 'pause' ? 'pause' : 'title'; setState('options'); renderOptions(); }
function optionsDone() { saveSettings(G.settings); SFX.setVolume(G.settings.sound / 100); if (G.optionsReturn === 'pause') setState('pause'); else toTitle(); }
const SLIDER_LABEL = {
  fov: (v) => '시야: ' + (v === 70 ? '보통' : v === 110 ? '퀘이크 프로' : v),
  renderDistance: (v) => `렌더 거리: ${v} 청크`,
  sensitivity: (v) => '마우스 감도: ' + (v === 100 ? '보통' : v + '%'),
  sound: (v) => '주 음량: ' + (v === 0 ? '꺼짐' : v + '%'),
};
function renderOptions() {
  for (const el of $$('.mc-slider')) {
    const k = el.dataset.key, min = +el.dataset.min, max = +el.dataset.max, v = G.settings[k];
    const frac = (v - min) / (max - min);
    el.querySelector('.fill').style.left = `calc(${frac * 100}% - ${frac * 16}px)`;
    el.querySelector('span').textContent = SLIDER_LABEL[k](v);
  }
  $('#btn-bob').textContent = '화면 흔들림: ' + (G.settings.viewBobbing ? '켬' : '끔');
  $('#btn-clouds').textContent = '구름: ' + (G.settings.clouds ? '켬' : '끔');
}
for (const el of $$('.mc-slider')) {
  const set = (clientX) => {
    const r = el.getBoundingClientRect(), min = +el.dataset.min, max = +el.dataset.max, step = +el.dataset.step;
    const f = Math.max(0, Math.min(1, (clientX - r.left - 8) / (r.width - 16)));
    G.settings[el.dataset.key] = Math.round((min + f * (max - min)) / step) * step;
    if (el.dataset.key === 'sound') SFX.setVolume(G.settings.sound / 100);
    renderOptions();
  };
  el.addEventListener('mousedown', (e) => {
    set(e.clientX);
    const mv = (ev) => set(ev.clientX); const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); SFX.play('click'); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  });
}

// ================= 블록 상호작용 =================
function heldId() { const h = G.inventory.held(); return h ? h.id : 0; }
function breakBlock(t) {
  const w = G.world, id = t.id, b = BLOCKS[id];
  const k = `${t.x},${t.y},${t.z}`;
  if (G.mode === 'survival') {
    if (id === B.FURNACE) { const f = w.furnaces.get(k); if (f) for (const s of [f.input, f.fuel, f.output]) if (s) G.inventory.add(s.id, s.count); }
    if (canHarvest(id, heldId()) && b.drop) { G.inventory.add(b.drop, 1); setTimeout(() => SFX.play('pop'), 60); }
  }
  w.setBlock(t.x, t.y, t.z, 0);
  // 아주 단순한 물 흐름: 옆이나 위에 물이 있으면 빈 칸을 물로 채움
  for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    if (w.getBlock(t.x + dx, t.y + dy, t.z + dz) === B.WATER) { w.setBlock(t.x, t.y, t.z, B.WATER); break; }
  }
  spawnParticles(t.x, t.y, t.z, id);
  SFX.play('break', b.sound);
}
function useBlock(t) {
  const w = G.world, p = G.player;
  const b = BLOCKS[t.id];
  const tk = `${t.x},${t.y},${t.z}`;
  if (b.interact && !p.sneaking) {
    if (b.interact === 'furnace' && !w.furnaces.has(tk)) w.furnaces.set(tk, newFurnace());
    openContainer(b.interact, b.interact === 'furnace' ? tk : null); return;
  }
  const h = G.inventory.held(); if (!h || !isBlock(h.id)) return;
  const x = t.x + t.n[0], y = t.y + t.n[1], z = t.z + t.n[2];
  if (y < 0 || y >= CH) return;
  const cur = w.getBlock(x, y, z); if (cur && cur !== B.WATER) return;
  if (isSolid(h.id) && p.intersectsBlock(x, y, z)) return;
  w.setBlock(x, y, z, h.id);
  if (BLOCKS[h.id].tex.front !== undefined) {
    const dx = p.pos.x - (x + 0.5), dz = p.pos.z - (z + 0.5);
    const facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 0 : 1) : (dz > 0 ? 4 : 5);
    w.meta.set(`${x},${y},${z}`, { facing });
    if (h.id === B.FURNACE) w.furnaces.set(`${x},${y},${z}`, newFurnace());
  }
  if (G.mode === 'survival') G.inventory.consumeHeld();
  SFX.play('place', BLOCKS[h.id].sound); G.swing = 1;
}
function pickBlock() {
  const t = G.target; if (!t) return;
  const inv = G.inventory;
  for (let i = 0; i < 9; i++) if (inv.slots[i]?.id === t.id) { inv.selected = i; return; }
  if (G.mode === 'creative') inv.slots[inv.selected] = { id: t.id, count: 64 };
}

// ================= 파티클 =================
const partGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1); const partMats = {};
function spawnParticles(x, y, z, id) {
  const c = avgColors[id] || [1, 1, 1];
  const mat = partMats[id] ||= new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]) });
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(partGeo, mat);
    m.position.set(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6);
    m.userData = { v: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3), life: 0.5 + Math.random() * 0.5 };
    m.scale.setScalar(0.6 + Math.random() * 0.8);
    scene.add(m); G.particles.push(m);
  }
}
function updateParticles(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const m = G.particles[i]; const u = m.userData;
    u.life -= dt; u.v.y -= 16 * dt; m.position.addScaledVector(u.v, dt);
    if (G.world && isSolid(G.world.getBlock(Math.floor(m.position.x), Math.floor(m.position.y - 0.05), Math.floor(m.position.z)))) { u.v.set(u.v.x * 0.5, 0, u.v.z * 0.5); }
    if (u.life <= 0) { scene.remove(m); G.particles.splice(i, 1); }
  }
}
function clearParticles() { for (const m of G.particles) scene.remove(m); G.particles = []; }

// ================= 1인칭 손 / 들고 있는 아이템 =================
let handMesh = null, handId = -1;
const handMats = {};
function clearHand() { if (handMesh) { handScene.remove(handMesh); handMesh = null; } handId = -1; }
function buildHand(id) {
  clearHand(); handId = id;
  if (!id) {
    handMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.8), new THREE.MeshBasicMaterial({ color: 0xc69c74 }));
    handMesh.userData = { base: new THREE.Vector3(0.52, -0.42, -0.62), rot: new THREE.Euler(0.15, -0.35, 0.2) };
  } else if (isBlock(id)) {
    const geo = new THREE.BoxGeometry(1, 1, 1); const uv = geo.attributes.uv; const b = BLOCKS[id];
    const tiles = [b.tex.side, b.tex.side, b.tex.top, b.tex.bottom, b.tex.front ?? b.tex.side, b.tex.side];
    for (let f = 0; f < 6; f++) {
      const [u0, v0, u1, v1] = tileUV(tiles[f]);
      for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); }
    }
    const mat = b.liquid ? materials.water.clone() : new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.5 });
    // 면 밝기 차이(원본처럼 옆면이 어둡게)
    const col = []; const shades = [0.6, 0.6, 1, 0.5, 0.8, 0.8];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) col.push(shades[f], shades[f], shades[f]);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); mat.vertexColors = true;
    handMesh = new THREE.Mesh(geo, mat); handMesh.scale.setScalar(0.38);
    handMesh.userData = { base: new THREE.Vector3(0.5, -0.42, -0.78), rot: new THREE.Euler(0, Math.PI / 4 + 0.15, 0) };
  } else {
    const tex = handMats[id] ||= (() => { const t = new THREE.TextureLoader().load(iconFor(id)); t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t; })();
    handMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    handMesh.userData = { base: new THREE.Vector3(0.48, -0.32, -0.75), rot: new THREE.Euler(0, -0.6, 0.15) };
  }
  handScene.add(handMesh);
}
function updateHand(dt) {
  const id = heldId(); if (id !== handId) buildHand(id);
  if (!handMesh) return;
  const p = G.player; const u = handMesh.userData;
  G.swing = Math.max(0, G.swing - dt * 4);
  const s = Math.sin((1 - G.swing) * Math.PI) * (G.swing > 0 ? 1 : 0);
  const bob = G.settings.viewBobbing ? p.bob : 0;
  handMesh.position.copy(u.base).add(new THREE.Vector3(Math.sin(bob) * 0.02 - s * 0.15, -Math.abs(Math.cos(bob)) * 0.02 + s * 0.08, -s * 0.12));
  handMesh.rotation.set(u.rot.x - s * 0.9, u.rot.y + s * 0.3, u.rot.z);
  const l = G.daylight * lightAt(p.pos.x, p.pos.y + 1.2, p.pos.z);
  if (handId) handMesh.material.color.setScalar(l);
  else handMesh.material.color.setRGB(0.78 * l, 0.61 * l, 0.45 * l); // 맨손(피부색)
}
function lightAt(x, y, z) { const t = G.world ? G.world.topAt(Math.floor(x), Math.floor(z)) : -1; return y > t ? 1 : Math.max(0.35, 1 - (t - y) * 0.14); }

// ================= 인벤토리 미리보기 캐릭터 (원본 캐릭터가 아닌 직접 디자인) =================
function drawPlayerPreview(cv) {
  if (!cv) return; const g = cv.getContext('2d');
  const R = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  g.clearRect(0, 0, 52, 104);
  R('#4a2f1b', 14, 0, 24, 8); R('#e0b48c', 14, 8, 24, 16); R('#4a2f1b', 14, 8, 4, 6); R('#4a2f1b', 34, 8, 4, 6);
  R('#fff', 18, 14, 4, 3); R('#fff', 30, 14, 4, 3); R('#2a4a7a', 20, 14, 2, 3); R('#2a4a7a', 30, 14, 2, 3); R('#a86a50', 24, 20, 4, 2);
  R('#b8423a', 14, 24, 24, 36); R('#8e2f29', 14, 24, 24, 3);
  R('#b8423a', 2, 24, 12, 14); R('#b8423a', 38, 24, 12, 14); R('#e0b48c', 2, 38, 12, 22); R('#e0b48c', 38, 38, 12, 22);
  R('#5a5a66', 14, 60, 12, 36); R('#4d4d58', 26, 60, 12, 36); R('#2e2e33', 14, 96, 24, 8);
}

// ================= HUD =================
function heartIcon(type) {
  const c = document.createElement('canvas'); c.width = c.height = 9; const g = c.getContext('2d');
  const shape = ['.##...##.', '#..#.#..#', '#.......#', '#.......#', '.#.....#.', '..#...#..', '...#.#...', '....#....'];
  shape.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') { g.fillStyle = '#000'; g.fillRect(x, y, 1, 1); } }));
  const inside = ['', '.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  inside.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '#') return; const px = x + 1;
    if (type === 'empty') g.fillStyle = '#3a1212';
    else if (type === 'half' && px > 4) g.fillStyle = '#3a1212';
    else g.fillStyle = y === 1 && px <= 3 ? '#ff9a9a' : '#e01b1b';
    g.fillRect(px, y, 1, 1);
  }));
  return c.toDataURL();
}
function bubbleIcon() {
  const c = document.createElement('canvas'); c.width = c.height = 9; const g = c.getContext('2d');
  g.fillStyle = '#2440a0'; g.beginPath(); g.arc(4.5, 4.5, 4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#7fb0ff'; g.beginPath(); g.arc(4.5, 4.5, 3, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.fillRect(2, 2, 2, 2); return c.toDataURL();
}
const HEART = { full: heartIcon('full'), half: heartIcon('half'), empty: heartIcon('empty') }; const BUBBLE = bubbleIcon();
function renderStatus() {
  const p = G.player, surv = G.mode === 'survival';
  $('#status-bar').style.visibility = surv ? 'visible' : 'hidden';
  if (!surv) return;
  const h = Math.max(0, Math.ceil(p.health));
  if (h !== G.lastHealth) {
    let html = ''; for (let i = 0; i < 10; i++) { const v = h - i * 2; html += `<img src="${v >= 2 ? HEART.full : v === 1 ? HEART.half : HEART.empty}">`; }
    $('#hearts').innerHTML = html; $('#hearts').classList.toggle('shake', h <= 4); G.lastHealth = h;
  }
  const air = p.headInWater || p.air < 300 ? Math.max(0, Math.ceil(p.air / 30)) : -1;
  if (air !== G.lastAir) { $('#bubbles').innerHTML = air < 0 ? '' : Array(air).fill(`<img src="${BUBBLE}">`).join(''); G.lastAir = air; }
}
let itemNameTimer = 0;
function renderItemName(dt) {
  const inv = G.inventory;
  if (inv.selected !== G.lastSel) {
    G.lastSel = inv.selected; const h = inv.held();
    $('#item-name').textContent = h ? itemName(h.id) : ''; itemNameTimer = h ? 1.6 : 0;
  }
  itemNameTimer -= dt; $('#item-name').classList.toggle('show', itemNameTimer > 0);
}
const DIRS = ['남쪽 (Towards positive Z)', '서쪽 (Towards negative X)', '북쪽 (Towards negative Z)', '동쪽 (Towards positive X)'];
function renderDebug() {
  if (!G.debug) return;
  const p = G.player, w = G.world;
  const bx = Math.floor(p.pos.x), by = Math.floor(p.pos.y), bz = Math.floor(p.pos.z);
  let yawDeg = ((-p.yaw * 180 / Math.PI) % 360 + 540) % 360 - 180;
  const dir = DIRS[((Math.round(yawDeg / 90) % 4) + 4) % 4];
  const t = G.target;
  const lines = [
    'MineClone 1.0 (웹 클론 / 원본 1.21 참고)',
    `${G.fps} fps   청크: ${w.meshCount()} 렌더 / ${w.chunks.size} 로드`,
    '',
    `XYZ: ${p.pos.x.toFixed(3)} / ${p.pos.y.toFixed(5)} / ${p.pos.z.toFixed(3)}`,
    `Block: ${bx} ${by} ${bz}`,
    `Chunk: ${bx & 15} ${by} ${bz & 15} in ${bx >> 4} ${bz >> 4}`,
    `Facing: ${dir} (${yawDeg.toFixed(1)} / ${(-p.pitch * 180 / Math.PI).toFixed(1)})`,
    `Day ${Math.floor(G.time / 24000)}, time ${Math.floor(G.time % 24000)}`,
    `모드: ${G.mode === 'creative' ? '크리에이티브' : '서바이벌'}${p.flying ? ' (비행)' : ''}`,
    `시드: ${G.meta.seedText ?? G.meta.seed}`,
    t ? `Targeted Block: ${t.x}, ${t.y}, ${t.z}  minecraft:${BLOCKS[t.id].key}` : 'Targeted Block: -',
  ];
  $('#debug').innerHTML = lines.map((l) => (l ? `<span class="ln">${escapeHtml(l)}</span>` : '')).join('\n');
}

// ================= 낮/밤 =================
const C_DAY = new THREE.Color(0x7ba4ff), C_NIGHT = new THREE.Color(0x080a18), C_SET = new THREE.Color(0xd9774a), tmpC = new THREE.Color();
function updateSky(camPos) {
  const t = (G.time % 24000) / 24000; const ang = t * Math.PI * 2;
  const sunY = Math.sin(ang);
  const day = THREE.MathUtils.clamp(sunY * 2.2 + 0.45, 0, 1);
  G.daylight = 0.18 + 0.82 * day;
  tmpC.copy(C_NIGHT).lerp(C_DAY, day);
  const set = Math.max(0, 1 - Math.abs(sunY) * 4) * (Math.cos(ang) > -2 ? 0.55 : 0);
  tmpC.lerp(C_SET, set);
  const under = G.player && G.player.headInWater;
  scene.background = under ? new THREE.Color(0x14307a) : tmpC.clone();
  scene.fog.color.copy(under ? new THREE.Color(0x14307a) : tmpC);
  const rd = (G.state === 'title' || !G.world) ? 3 : G.settings.renderDistance;
  scene.fog.near = under ? 1 : rd * CS * 0.55; scene.fog.far = under ? 14 : rd * CS * 0.98;
  materials.opaque.color.setScalar(G.daylight); materials.water.color.setScalar(G.daylight);
  sky.position.copy(camPos);
  const r = 400;
  sky.updateMatrixWorld();
  sun.position.set(Math.cos(ang) * r, Math.sin(ang) * r, 0); sun.lookAt(camPos);   // sky 그룹(카메라 위치) 기준 좌표
  moon.position.set(-Math.cos(ang) * r, -Math.sin(ang) * r, 0); moon.lookAt(camPos);
  stars.material.opacity = Math.max(0, 1 - day * 1.6); stars.rotation.z = ang;
  clouds.visible = G.settings.clouds;
  clouds.position.x = camPos.x; clouds.position.z = camPos.z;
  const tile = 1536 / 8; cloudTex.offset.set((camPos.x + performance.now() * 0.0015) / tile, -camPos.z / tile);
  clouds.material.color.setScalar(0.35 + 0.65 * day);
}

// ================= 게임 업데이트 =================
function respawn() {
  const p = G.player, w = G.world, sp = G.meta.spawn;
  p.pos.set(sp.x, w.isLoaded(Math.floor(sp.x), Math.floor(sp.z)) ? w.surfaceY(Math.floor(sp.x), Math.floor(sp.z)) : CH, sp.z);
  if (!w.isLoaded(Math.floor(sp.x), Math.floor(sp.z))) G.placed = false;
  p.vel.set(0, 0, 0); p.health = 20; p.air = 300; p.fallPeak = null; G.lastHealth = -1;
  if (!G.placed) { setState('loading'); $('#loading-text').textContent = '리스폰 중'; return; }
  setState('game'); requestLock();
}
function hurt(dmg, cause) {
  const p = G.player; p.health -= dmg; G.lastCause = cause;
  $('#hurt').classList.add('on'); setTimeout(() => $('#hurt').classList.remove('on'), 80);
  G.hurtTilt = 1; SFX.play('hurt');
  if (p.health <= 0) {
    p.health = 0; renderStatus();
    G.inventory.slots.fill(null); renderHotbar(G.inventory); // 원본 기본값처럼 사망 시 아이템을 잃음 (아이템 엔티티는 미구현이라 바닥에 떨어지지 않음)
    invUI.close(); releaseLock();
    $('#dead-reason').textContent = `플레이어이(가) ${cause}`;
    setState('dead');
  }
}
const _eye = new THREE.Vector3(), _dir = new THREE.Vector3();
function updateGame(dt, now) {
  const p = G.player, w = G.world, inv = G.inventory;
  G.time += dt * 20;
  const k = G.keys; const blocked = invUI.open;
  const input = blocked ? {} : {
    f: k.KeyW, b: k.KeyS, l: k.KeyA, r: k.KeyD, jump: k.Space, sneak: k.ShiftLeft || k.ShiftRight,
    sprint: k.ControlLeft || k.ControlRight || G.sprintToggle, jumpPressed: G.jumpPressed,
  };
  G.jumpPressed = false;
  // 청크가 아직 없으면 물리 정지 (구멍으로 떨어지지 않게)
  if (w.isLoaded(Math.floor(p.pos.x), Math.floor(p.pos.z))) {
    const ev = p.update(dt, input, w, G.mode, now);
    if (ev.damage > 0) hurt(ev.damage, p.headInWater ? '익사했습니다' : p.pos.y < -30 ? '세상 밖으로 떨어졌습니다' : '높은 곳에서 떨어졌습니다');
    if (ev.splash) SFX.play('splash');
    if (ev.landed) { const under = w.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.2), Math.floor(p.pos.z)); if (under) SFX.play('step', BLOCKS[under]?.sound); }
  }
  if (G.state !== 'game') return;
  // 발소리
  if (p.onGround && (input.f || input.b || input.l || input.r)) {
    const ph = Math.floor(p.bob / Math.PI);
    if (ph !== G.stepPhase) { G.stepPhase = ph; const under = w.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.2), Math.floor(p.pos.z)); if (under && !p.sneaking) SFX.play('step', BLOCKS[under]?.sound); }
  }
  // 카메라
  p.eye(_eye);
  const bob = G.settings.viewBobbing && p.onGround ? p.bob : 0;
  const bobAmt = G.settings.viewBobbing ? Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 4) : 0;
  camera.position.set(_eye.x + Math.cos(p.yaw) * Math.sin(bob) * 0.04 * bobAmt, _eye.y + Math.abs(Math.cos(bob)) * 0.06 * bobAmt, _eye.z - Math.sin(p.yaw) * Math.sin(bob) * 0.04 * bobAmt);
  G.hurtTilt = Math.max(0, G.hurtTilt - dt * 3);
  camera.rotation.set(p.pitch, p.yaw, Math.sin(G.hurtTilt * Math.PI) * 0.12);
  const fovTarget = G.settings.fov * (p.sprinting ? 1.12 : 1) * (p.flying && p.sprinting ? 1.05 : 1);
  camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 10); camera.updateProjectionMatrix();

  w.update(p.pos.x, p.pos.z, G.settings.renderDistance, 6);

  // 바라보는 블록
  camera.getWorldDirection(_dir);
  const reach = G.mode === 'creative' ? 5 : 4.5;
  const t = blocked ? null : w.raycast(_eye, _dir, reach);
  G.target = t;
  if (t) { highlight.visible = true; highlight.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5); } else highlight.visible = false;

  // 블록 부수기 (꾹 누르기) — 크리에이티브는 즉시
  G.cooldown -= dt; G.placeCooldown -= dt;
  crack.visible = false;
  if (G.mouseL && t && G.cooldown <= 0) {
    const key = `${t.x},${t.y},${t.z}`;
    if (G.mode === 'creative') { breakBlock(t); G.cooldown = 0.25; G.swing = 1; }
    else {
      if (G.breaking.key !== key) { G.breaking.key = key; G.breaking.progress = 0; }
      const bt = breakTime(t.id, heldId());
      if (bt !== Infinity) {
        G.breaking.progress += dt / Math.max(bt, 0.05);
        G.breaking.hitTimer -= dt;
        if (G.breaking.hitTimer <= 0) { G.breaking.hitTimer = 0.25; SFX.play('hit', BLOCKS[t.id].sound); G.swing = 1; }
        crack.visible = true; crack.position.copy(highlight.position);
        crack.material.map = crackTex[Math.min(9, Math.floor(G.breaking.progress * 10))];
        if (G.breaking.progress >= 1) { breakBlock(t); G.breaking.progress = 0; G.breaking.key = ''; G.cooldown = 0.25; }
      } else if (G.swing <= 0) G.swing = 1;
    }
  } else if (!G.mouseL) { G.breaking.progress = 0; G.breaking.key = ''; }
  // 설치 / 사용
  if (G.mouseR && G.placeCooldown <= 0) {
    G.placeCooldown = 0.2;
    if (t) useBlock(t);
    G.mouseR = G.mouseR && !invUI.open;
  }

  tickFurnaces(w, dt);
  if (invUI.open && invUI.kind === 'furnace') invUI.render();
  updateParticles(dt);
  updateHand(dt);

  $('#underwater').style.display = p.headInWater ? 'block' : 'none';
  renderHotbar(inv); renderStatus(); renderItemName(dt); renderDebug();

  G.autosave += dt; if (G.autosave > 30) { G.autosave = 0; saveCurrent(); }
}

function updateTitle(dt) {
  const w = G.titleWorld, sp = G.titleSpawn;
  w.update(sp.x, sp.z, 3, 10);
  G.titleYaw += dt * 0.05;
  const y = w.isLoaded(Math.floor(sp.x), Math.floor(sp.z)) ? Math.max(SEA + 10, w.surfaceY(Math.floor(sp.x), Math.floor(sp.z)) + 6) : SEA + 20;
  camera.position.set(sp.x, y, sp.z);
  camera.rotation.set(-0.12, G.titleYaw, 0);
  camera.fov = 75; camera.updateProjectionMatrix();
}

// ================= 메인 루프 =================
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = handCamera.aspect = w / h;
  camera.updateProjectionMatrix(); handCamera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();
window.addEventListener('beforeunload', () => { if (G.world && G.state !== 'loading') saveCurrent(); });

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  G.frames++; if (now - G.fpsTime > 1000) { G.fps = G.frames; G.frames = 0; G.fpsTime = now; }
  if (G.state === 'loading') updateLoading();
  else if (G.world && G.state === 'game') updateGame(dt, now);
  if (G.titleWorld) { updateTitle(dt); G.time += dt * 20 * 0; }
  updateSky(camera.position);
  renderer.clear();
  renderer.render(scene, camera);
  if (G.world && ['game', 'pause', 'dead'].includes(G.state) && !G.hideHud) { renderer.clearDepth(); renderer.render(handScene, handCamera); }
}
toTitle();
requestAnimationFrame(frame);

// 테스트/디버그용 핸들
window.__mc = { G, startWorld, saveCurrent, openContainer, closeContainer, hashSeed, B, I, pause, resume, invUI, respawn };
