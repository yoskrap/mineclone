// 모든 텍스처를 코드로 직접 그린다 (원본 Minecraft 리소스 파일은 사용하지 않음 — 저작권 회피)
import * as THREE from 'three';
import { TILES, T, BLOCKS, ITEMS, I, isBlock } from './blocks.js';
import { mulberry32 } from './noise.js';

export const TILE = 16;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = Math.ceil(TILES.length / ATLAS_COLS);

const hex = (h, a = 255) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const shade = (c, f) => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f), c[3]];

class Px {
  constructor() { this.d = new Uint8ClampedArray(TILE * TILE * 4); }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = (y * TILE + x) * 4; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = c[3] ?? 255;
  }
  get(x, y) { const i = (((y + TILE) % TILE) * TILE + ((x + TILE) % TILE)) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  fill(fn) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) this.set(x, y, fn(x, y)); return this; }
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const pal = (...hs) => hs.map((h) => hex(h));

const P_STONE = pal('#7d7d7d', '#767676', '#848484', '#6e6e6e', '#8a8a8a', '#7a7a7a');
const P_DIRT = pal('#866043', '#79553a', '#96704b', '#5d4029', '#8b6a49', '#7e5a3d');
const P_GRASS = pal('#5c9c33', '#67aa3b', '#55902e', '#71b543', '#4c862a', '#62a237');
const P_PLANK = pal('#b8945f', '#af8b57', '#c29d67', '#a7824e');
const P_SAND = pal('#dbd3a0', '#d5cc95', '#e2dbab', '#cfc58b', '#d8cf9b');

function stone(r, p = new Px()) {
  p.fill(() => pick(r, P_STONE));
  for (let k = 0; k < 7; k++) { // 짧은 가로 결
    const x = Math.floor(r() * 16), y = Math.floor(r() * 16), len = 2 + Math.floor(r() * 3), c = r() < 0.5 ? hex('#686868') : hex('#929292');
    for (let i = 0; i < len; i++) p.set((x + i) % 16, y, c);
  }
  return p;
}
function dirt(r, p = new Px()) {
  p.fill(() => pick(r, P_DIRT));
  for (let k = 0; k < 10; k++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), r() < 0.5 ? hex('#5a3e28') : hex('#a07a55'));
  return p;
}
function cells(r, count, wrap = true) {
  const pts = []; for (let i = 0; i < count; i++) pts.push([r() * 16, r() * 16, r()]);
  const owner = new Int16Array(256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let best = 1e9, bi = 0;
    for (let i = 0; i < pts.length; i++) {
      let dx = Math.abs(x + 0.5 - pts[i][0]), dy = Math.abs(y + 0.5 - pts[i][1]);
      if (wrap) { dx = Math.min(dx, 16 - dx); dy = Math.min(dy, 16 - dy); }
      const d = dx * dx + dy * dy * 1.2; if (d < best) { best = d; bi = i; }
    }
    owner[y * 16 + x] = bi;
  }
  return { pts, owner };
}
function cobble(r, light = 1) {
  const p = new Px(); const { pts, owner } = cells(r, 9);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const o = owner[y * 16 + x];
    const right = owner[y * 16 + ((x + 1) % 16)], down = owner[((y + 1) % 16) * 16 + x];
    const up = owner[((y + 15) % 16) * 16 + x], left = owner[y * 16 + ((x + 15) % 16)];
    let c;
    if (o !== right || o !== down) c = hex('#4f4f4f');
    else if (o !== up || o !== left) c = hex('#a3a3a3');
    else c = shade(hex('#7f7f7f'), 0.85 + pts[o][2] * 0.3 + (r() - 0.5) * 0.08);
    p.set(x, y, shade(c, light));
  }
  return p;
}
function ore(r, colors, base = stone) {
  const p = base(r); const n = 3 + Math.floor(r() * 2);
  for (let k = 0; k < n; k++) {
    const cx = 2 + Math.floor(r() * 12), cy = 2 + Math.floor(r() * 12);
    const blob = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [2, 1], [1, 2]].slice(0, 4 + Math.floor(r() * 4));
    for (const [dx, dy] of blob) p.set(cx + dx, cy + dy, pick(r, colors));
    p.set(cx + 1, cy + 1, shade(colors[0], 0.7));
  }
  return p;
}
function planks(r) {
  const p = new Px(); const seams = [Math.floor(r() * 16), Math.floor(r() * 16), Math.floor(r() * 16), Math.floor(r() * 16)];
  for (let y = 0; y < 16; y++) {
    const board = y >> 2;
    for (let x = 0; x < 16; x++) {
      let c = pick(r, P_PLANK);
      if ((y & 3) === 3) c = hex('#7e6237');
      else if (x === seams[board]) c = hex('#8c6c40');
      else if (r() < 0.08) c = hex('#9c7a48');
      p.set(x, y, c);
    }
  }
  return p;
}
function logSide(r) {
  const P = pal('#6b5130', '#5d4628', '#76593a', '#4f3b21');
  const p = new Px(); const col = []; for (let x = 0; x < 16; x++) col.push(pick(r, P));
  return p.fill((x, y) => (r() < 0.12 ? hex('#3d2d18') : (r() < 0.2 ? pick(r, P) : col[x])));
}
function logTop(r) {
  const p = new Px();
  return p.fill((x, y) => {
    const dx = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (dx > 6.6) return pick(r, pal('#6b5130', '#5d4628'));
    const ring = Math.floor(dx) % 2;
    return shade(ring ? hex('#b5915c') : hex('#9e7c4a'), 0.95 + r() * 0.1);
  });
}
function leaves(r) {
  const P = pal('#3d7a1f', '#4a8f28', '#336d19', '#58a032', '#2c6014');
  return new Px().fill(() => (r() < 0.22 ? [0, 0, 0, 0] : pick(r, P)));
}
function glass() {
  return new Px().fill((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return hex('#dbe8ef');
    if ((x === 3 && y === 2) || (x === 2 && y === 3) || (x === 4 && y === 2) || (x === 11 && y === 12) || (x === 12 && y === 11)) return hex('#ffffff', 230);
    return [0, 0, 0, 0];
  });
}
function water(r) {
  return new Px().fill((x, y) => {
    const w = Math.sin((x + y * 0.5) * 0.9) > 0.85;
    return w ? hex('#5c8ae6', 200) : shade(hex('#2f5fd0', 190), 0.92 + r() * 0.16);
  });
}
function craftTop(r) {
  const p = planks(r);
  for (let i = 0; i < 16; i++) { p.set(i, 0, hex('#5e4527')); p.set(i, 15, hex('#5e4527')); p.set(0, i, hex('#5e4527')); p.set(15, i, hex('#5e4527')); }
  for (let i = 2; i < 14; i++) { p.set(i, 5, hex('#6b4f2a')); p.set(i, 10, hex('#6b4f2a')); p.set(5, i, hex('#6b4f2a')); p.set(10, i, hex('#6b4f2a')); }
  return p;
}
function craftSide(r, front) {
  const p = planks(r);
  for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) p.set(x, y, shade(hex('#7e6237'), 0.9 + r() * 0.2));
  if (front) { // 망치 모양
    for (let y = 5; y < 13; y++) p.set(7, y, hex('#4a3519'));
    for (let x = 4; x < 11; x++) { p.set(x, 5, hex('#8a8a8a')); p.set(x, 6, hex('#6e6e6e')); }
  } else { // 톱 모양
    for (let x = 3; x < 12; x++) { p.set(x, 8, hex('#9c9c9c')); if (x % 2) p.set(x, 9, hex('#6e6e6e')); }
    for (let y = 6; y < 10; y++) { p.set(12, y, hex('#4a3519')); p.set(13, y, hex('#4a3519')); }
  }
  return p;
}
function stoneBricks(r) {
  const p = stone(r);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const mortarH = y === 7 || y === 15;
    const mortarV = (y < 8 && x === 15) || (y >= 8 && x === 7);
    if (mortarH || mortarV) p.set(x, y, hex('#5a5a5a'));
    else if (y === 0 || y === 8 || (y < 8 && x === 0) || (y >= 8 && x === 8)) p.set(x, y, hex('#999999'));
  }
  return p;
}
function furnaceSide(r) { return cobble(r, 0.95); }
function furnaceTop(r) {
  const p = stone(r);
  for (let i = 0; i < 16; i++) { p.set(i, 0, hex('#555')); p.set(i, 15, hex('#555')); p.set(0, i, hex('#555')); p.set(15, i, hex('#555')); }
  return p;
}
function furnaceFront(r, on) {
  const p = cobble(r, 0.95);
  for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) {
    let c = hex('#1a1a1a');
    if (on && y >= 10) c = pick(r, pal('#f2a12c', '#f7d23a', '#e2641c'));
    p.set(x, y, c);
  }
  for (let x = 3; x < 13; x++) { p.set(x, 7, hex('#4a4a4a')); p.set(x, 14, hex('#4a4a4a')); }
  for (let x = 4; x < 12; x += 2) p.set(x, 3, hex('#3a3a3a'));
  return p;
}
function bricks(r) {
  const P = pal('#966252', '#8a5545', '#a46a58', '#8f5a4a');
  return new Px().fill((x, y) => {
    if (y % 4 === 3) return hex('#b5aea6');
    const off = (y >> 2) % 2 ? 4 : 0;
    if ((x + off) % 8 === 7) return hex('#b5aea6');
    return pick(r, P);
  });
}
function snow(r) { return new Px().fill(() => pick(r, pal('#f0fbfb', '#e6f2f2', '#ffffff', '#eaf6f6'))); }
function grassSide(r, top) {
  const p = dirt(r); const drip = [];
  for (let x = 0; x < 16; x++) drip.push(3 + (r() < 0.45 ? 1 : 0) + (r() < 0.2 ? 1 : 0));
  for (let x = 0; x < 16; x++) for (let y = 0; y < drip[x]; y++) p.set(x, y, top ? pick(r, pal('#f0fbfb', '#ffffff', '#e6f2f2')) : pick(r, P_GRASS));
  return p;
}
function wool(r) {
  return new Px().fill((x, y) => ((x + y * 3) % 7 === 0 ? hex('#cfd3d3') : pick(r, pal('#e9ecec', '#dfe2e2', '#f2f4f4'))));
}
function bookshelf(r) {
  const p = planks(r); const books = pal('#a33a2b', '#2e5aa3', '#3b8a3b', '#c9a43a', '#7a3a8f', '#d9d9d9');
  for (const [y0, y1] of [[1, 7], [9, 15]]) {
    let x = 1;
    while (x < 15) {
      const w = 1 + (r() < 0.6 ? 1 : 0); const c = pick(r, books); const top = y0 + Math.floor(r() * 2);
      for (let xx = x; xx < Math.min(15, x + w); xx++) for (let y = top; y < y1; y++) p.set(xx, y, shade(c, y === top ? 1.2 : 1));
      x += w;
    }
  }
  return p;
}
function tnt(r, part) {
  if (part === 'side') return new Px().fill((x, y) => (y >= 5 && y <= 10 ? (y === 5 || y === 10 ? hex('#ddd') : hex('#f4f4f4')) : pick(r, pal('#db441a', '#c23c17', '#e65022'))));
  return new Px().fill((x, y) => (Math.hypot(x - 7.5, y - 7.5) < 3 ? hex('#3a3a3a') : pick(r, pal('#db441a', '#c23c17'))));
}

const PAINTERS = {
  grass_top: (r) => new Px().fill(() => pick(r, P_GRASS)),
  grass_side: (r) => grassSide(r, false),
  dirt, stone, cobblestone: (r) => cobble(r), log_side: logSide, log_top: logTop, leaves, planks,
  sand: (r) => new Px().fill(() => pick(r, P_SAND)),
  water, glass, crafting_top: craftTop, crafting_side: (r) => craftSide(r, false), crafting_front: (r) => craftSide(r, true),
  coal_ore: (r) => ore(r, pal('#2b2b2b', '#363636', '#1e1e1e')),
  iron_ore: (r) => ore(r, pal('#d8af93', '#c69a7d', '#e3c0a5')),
  bedrock: (r) => new Px().fill(() => pick(r, pal('#565656', '#3a3a3a', '#2a2a2a', '#6e6e6e', '#1f1f1f', '#474747'))),
  gravel: (r) => { const { pts, owner } = cells(r, 14); return new Px().fill((x, y) => shade(pick(mulberry32(owner[y * 16 + x] * 7 + 1), pal('#837e7e', '#6e6a6a', '#9a9494', '#5a5656', '#a8a0a0')), 0.95 + r() * 0.1)); },
  stone_bricks: stoneBricks, furnace_front: (r) => furnaceFront(r, false), furnace_front_on: (r) => furnaceFront(r, true),
  furnace_side: furnaceSide, furnace_top: furnaceTop, bricks, snow, grass_side_snow: (r) => grassSide(r, true),
  white_wool: wool, bookshelf, tnt_side: (r) => tnt(r, 'side'), tnt_top: (r) => tnt(r, 'top'), tnt_bottom: (r) => tnt(r, 'top'),
};

// ===== 텍스처 아틀라스 =====
export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE; canvas.height = ATLAS_ROWS * TILE;
  const ctx = canvas.getContext('2d');
  TILES.forEach((name, idx) => {
    const r = mulberry32(1000 + idx * 7919);
    const px = PAINTERS[name](r);
    ctx.putImageData(new ImageData(px.d, TILE, TILE), (idx % ATLAS_COLS) * TILE, Math.floor(idx / ATLAS_COLS) * TILE);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture: tex };
}

export function tileUV(idx) {
  const e = 0.002;
  const u0 = (idx % ATLAS_COLS) / ATLAS_COLS + e, u1 = ((idx % ATLAS_COLS) + 1) / ATLAS_COLS - e;
  const row = Math.floor(idx / ATLAS_COLS);
  const v1 = 1 - row / ATLAS_ROWS - e, v0 = 1 - (row + 1) / ATLAS_ROWS + e;
  return [u0, v0, u1, v1];
}

// 블록 파티클용 평균색
export function averageColors(atlasCanvas) {
  const ctx = atlasCanvas.getContext('2d'); const out = {};
  for (const b of BLOCKS) {
    if (!b || !b.id) continue;
    const idx = b.tex.side; const sx = (idx % ATLAS_COLS) * TILE, sy = Math.floor(idx / ATLAS_COLS) * TILE;
    const d = ctx.getImageData(sx, sy, TILE, TILE).data; let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
    out[b.id] = n ? [r / n / 255, g / n / 255, bl / n / 255] : [1, 1, 1];
  }
  return out;
}

// ===== 아이템 스프라이트 (곡괭이/도끼/삽/막대기/석탄/철주괴) =====
const MAT = { wood: [hex('#a8844f'), hex('#6e532c')], stone: [hex('#9a9a9a'), hex('#5f5f5f')], iron: [hex('#e6e6e6'), hex('#a8a8a8')] };
const HANDLE = [hex('#7a5a30'), hex('#4a3519')];
// 16x16 픽셀맵: h=머리(밝음) H=머리(외곽) s=손잡이(밝음) S=손잡이(어두움)
const TOOL_MAPS = {
  pickaxe: [
    '................', '................', '....HHHHHH......', '...HhhhhhhH.....', '....HHHHhhhH....', '........SshH....',
    '.......Ss.HhH...', '......Ss...HhH..', '.....Ss....HhH..', '....Ss......HH..', '...Ss...........', '..Ss............',
    '.Ss.............', '.S..............', '................', '................'],
  axe: [
    '................', '.......HHH......', '......HhhhH.....', '.....HhhhhhH....', '.....HhhhhSs....', '......HhhSs.....',
    '.......HSs......', '.......Ss.......', '......Ss........', '.....Ss.........', '....Ss..........', '...Ss...........',
    '..Ss............', '..S.............', '................', '................'],
  shovel: [
    '................', '...........HHH..', '..........HhhhH.', '..........HhhhH.', '..........HhhH..', '.........SsHH...',
    '........Ss......', '.......Ss.......', '......Ss........', '.....Ss.........', '....Ss..........', '...Ss...........',
    '..Ss............', '..S.............', '................', '................'],
  stick: [
    '................', '................', '............sS..', '...........sS...', '..........sS....', '.........sS.....',
    '........sS......', '.......sS.......', '......sS........', '.....sS.........', '....sS..........', '...sS...........',
    '..sS............', '..S.............', '................', '................'],
};
function toolSprite(kind, mat = 'wood') {
  const p = new Px(); const [hl, hd] = MAT[mat];
  TOOL_MAPS[kind].forEach((row, y) => [...row].forEach((ch, x) => {
    const c = { h: hl, H: hd, s: HANDLE[0], S: HANDLE[1] }[ch];
    if (c) p.set(x, y, c);
  }));
  return p;
}
const SPRITES = {
  [I.STICK]: () => toolSprite('stick'),
  [I.COAL]: () => { const r = mulberry32(5); return new Px().fill((x, y) => { const d = Math.hypot((x - 7.5) / 1.1, y - 8); return d < 4.6 ? (d > 3.8 ? hex('#141414') : pick(r, pal('#2b2b2b', '#3b3b3b', '#232323', '#4a4a4a'))) : [0, 0, 0, 0]; }); },
  [I.IRON_INGOT]: () => new Px().fill((x, y) => {
    if (y < 6 || y > 11) return [0, 0, 0, 0];
    const inset = y <= 7 ? (7 - y) + 3 : 2;
    if (x < inset || x > 15 - inset) return [0, 0, 0, 0];
    if (y === 11 || x === inset || x === 15 - inset) return hex('#8a8a8a');
    return y <= 7 ? hex('#f2f2f2') : hex('#cfcfcf');
  }),
  [I.WOODEN_PICKAXE]: () => toolSprite('pickaxe', 'wood'), [I.STONE_PICKAXE]: () => toolSprite('pickaxe', 'stone'), [I.IRON_PICKAXE]: () => toolSprite('pickaxe', 'iron'),
  [I.WOODEN_AXE]: () => toolSprite('axe', 'wood'), [I.STONE_AXE]: () => toolSprite('axe', 'stone'),
  [I.WOODEN_SHOVEL]: () => toolSprite('shovel', 'wood'), [I.STONE_SHOVEL]: () => toolSprite('shovel', 'stone'),
};

// ===== 인벤토리 아이콘 (블록은 원본처럼 아이소메트릭 3D) =====
const iconCache = {};
export function buildIcons(atlasCanvas) {
  const S = 48;
  const tileCanvas = (idx) => {
    const c = document.createElement('canvas'); c.width = c.height = TILE;
    c.getContext('2d').drawImage(atlasCanvas, (idx % ATLAS_COLS) * TILE, Math.floor(idx / ATLAS_COLS) * TILE, TILE, TILE, 0, 0, TILE, TILE);
    return c;
  };
  for (const b of BLOCKS) {
    if (!b || !b.id || b.liquid) continue;
    const c = document.createElement('canvas'); c.width = c.height = S; const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const face = (t, a, bb, cc, d, e, f, dark) => {
      ctx.save(); ctx.setTransform(a, bb, cc, d, e, f);
      ctx.drawImage(tileCanvas(t), 0, 0);
      if (dark) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, 16, 16); }
      ctx.restore();
    };
    const k = 21 / 16, h = 10.5 / 16, v = 24 / 16;
    face(b.tex.side, k, h, 0, v, 3, 13.5, 0.32);          // 왼쪽 면
    face(b.tex.front ?? b.tex.side, k, -h, 0, v, 24, 24, 0.5); // 오른쪽 면
    face(b.tex.top, k, -h, k, h, 3, 13.5, 0);           // 윗면
    iconCache[b.id] = c.toDataURL();
  }
  for (const id of Object.keys(SPRITES)) {
    const px = SPRITES[id]();
    const src = document.createElement('canvas'); src.width = src.height = TILE;
    src.getContext('2d').putImageData(new ImageData(px.d, TILE, TILE), 0, 0);
    const c = document.createElement('canvas'); c.width = c.height = S; const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false; ctx.drawImage(src, 0, 0, S, S);
    iconCache[id] = c.toDataURL();
  }
}
export function iconFor(id) { return iconCache[id] || ''; }

// ===== 블록 부수기 균열 텍스처 10단계 =====
export function buildCrackTextures() {
  const r = mulberry32(42); const order = [];
  const seen = new Set();
  const walk = (x, y, len) => {
    for (let i = 0; i < len; i++) {
      const key = x + y * 16; if (!seen.has(key)) { seen.add(key); order.push([x, y]); }
      x = Math.max(0, Math.min(15, x + Math.round((r() - 0.5) * 2.4)));
      y = Math.max(0, Math.min(15, y + Math.round((r() - 0.5) * 2.4)));
    }
  };
  for (let k = 0; k < 14; k++) walk(6 + Math.floor(r() * 4), 6 + Math.floor(r() * 4), 6 + Math.floor(r() * 8));
  const textures = [];
  for (let s = 1; s <= 10; s++) {
    const c = document.createElement('canvas'); c.width = c.height = TILE; const ctx = c.getContext('2d');
    const n = Math.ceil(order.length * s / 10);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    for (let i = 0; i < n; i++) ctx.fillRect(order[i][0], order[i][1], 1, 1);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    textures.push(t);
  }
  return textures;
}
