// 인벤토리 / 제작 / 화로 / 크리에이티브 인벤토리 화면 + 핫바 HUD
import { maxStack, itemName, matchRecipe, SMELT, FUEL, SMELT_TIME, CREATIVE_LIST, B } from './blocks.js';
import { iconFor } from './textures.js';

export class Inventory {
  constructor(saved) {
    this.slots = new Array(36).fill(null); // 0~8 핫바, 9~35 가방
    this.selected = 0;
    if (saved) { this.slots = saved.slots.map((s) => (s ? { ...s } : null)); this.selected = saved.selected || 0; }
  }
  held() { return this.slots[this.selected]; }
  add(id, count = 1) {
    const ms = maxStack(id);
    const order = [...Array(36).keys()];
    for (const i of order) { const s = this.slots[i]; if (s && s.id === id && s.count < ms) { const n = Math.min(ms - s.count, count); s.count += n; count -= n; if (!count) return 0; } }
    for (const i of order) { if (!this.slots[i]) { const n = Math.min(ms, count); this.slots[i] = { id, count: n }; count -= n; if (!count) return 0; } }
    return count;
  }
  consumeHeld(n = 1) {
    const s = this.slots[this.selected]; if (!s) return;
    s.count -= n; if (s.count <= 0) this.slots[this.selected] = null;
  }
  serialize() { return { slots: this.slots, selected: this.selected }; }
}

// ===== 화로 처리 (월드에 있는 모든 화로를 매 프레임 진행) =====
export function newFurnace() { return { input: null, fuel: null, output: null, burn: 0, burnMax: 0, progress: 0 }; }
export function tickFurnaces(world, dt) {
  for (const [k, f] of world.furnaces) {
    const out = f.input ? SMELT[f.input.id] : undefined;
    const can = out !== undefined && (!f.output || (f.output.id === out && f.output.count < maxStack(out)));
    if (f.burn <= 0 && can && f.fuel && FUEL[f.fuel.id]) {
      f.burn = f.burnMax = FUEL[f.fuel.id];
      f.fuel.count--; if (f.fuel.count <= 0) f.fuel = null;
    }
    if (f.burn > 0) {
      f.burn -= dt;
      if (can) {
        f.progress += dt;
        if (f.progress >= SMELT_TIME) {
          f.progress = 0;
          f.input.count--; if (f.input.count <= 0) f.input = null;
          if (f.output) f.output.count++; else f.output = { id: out, count: 1 };
        }
      } else f.progress = 0;
    } else f.progress = Math.max(0, f.progress - dt * 2);
    const lit = f.burn > 0;
    const m = world.meta.get(k) || { facing: 4 };
    if (!!m.lit !== lit) {
      m.lit = lit; world.meta.set(k, m);
      const [x, , z] = k.split(',').map(Number); world.markDirtyAt(x, z);
    }
  }
}

// ===== 화면 UI =====
const $ = (s) => document.querySelector(s);

export class InventoryUI {
  constructor(game) {
    this.game = game;
    this.root = $('#container-screen');
    this.cursorEl = $('#cursor-item');
    this.tooltip = $('#tooltip');
    this.open = false; this.kind = null; this.cursor = null; this.grid = []; this.gridN = 2; this.furnaceKey = null;
    document.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = e.clientX + 'px'; this.cursorEl.style.top = e.clientY + 'px';
      this.tooltip.style.left = e.clientX + 14 + 'px'; this.tooltip.style.top = e.clientY - 28 + 'px';
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('mousedown', (e) => this.onClick(e));
    this.root.addEventListener('mouseover', (e) => {
      const el = e.target.closest('.slot');
      const st = el ? this.refStack(this.refOf(el)) : null;
      if (st && !this.cursor) { this.tooltip.textContent = itemName(st.id); this.tooltip.style.display = 'block'; }
      else this.tooltip.style.display = 'none';
    });
  }

  show(kind, furnaceKey) {
    this.kind = kind; this.open = true; this.furnaceKey = furnaceKey || null;
    this.gridN = kind === 'crafting' ? 3 : 2;
    this.grid = new Array(this.gridN * this.gridN).fill(null);
    this.build(); this.root.classList.add('show');
  }
  close() {
    if (!this.open) return;
    const inv = this.game.inventory;
    for (const s of this.grid) if (s) inv.add(s.id, s.count);
    if (this.cursor && this.kind !== 'creative') inv.add(this.cursor.id, this.cursor.count);
    this.grid = []; this.cursor = null; this.open = false; this.kind = null;
    this.root.classList.remove('show'); this.root.innerHTML = '';
    this.cursorEl.innerHTML = ''; this.tooltip.style.display = 'none';
  }

  slotHTML(ref, extra = '') { return `<div class="slot ${extra}" data-ref='${JSON.stringify(ref)}'></div>`; }
  build() {
    const k = this.kind;
    let top = '';
    if (k === 'inventory') {
      top = `<div class="inv-top">
        <div class="armor">${[0, 1, 2, 3].map((i) => this.slotHTML({ a: 'armor', i }, 'armor-slot a' + i)).join('')}</div>
        <div class="player-preview"><canvas id="preview-canvas" width="52" height="104"></canvas></div>
        <div class="craft-area"><div class="mc-label">제작</div>
          <div class="craft-row"><div class="grid g2">${[0, 1, 2, 3].map((i) => this.slotHTML({ a: 'craft', i })).join('')}</div>
          <div class="arrow"></div>${this.slotHTML({ a: 'result' }, 'big')}</div></div></div>`;
    } else if (k === 'crafting') {
      top = `<div class="mc-label">제작</div><div class="craft-row center"><div class="grid g3">${[...Array(9).keys()].map((i) => this.slotHTML({ a: 'craft', i })).join('')}</div>
        <div class="arrow"></div>${this.slotHTML({ a: 'result' }, 'big')}</div>`;
    } else if (k === 'furnace') {
      top = `<div class="mc-label">화로</div><div class="furnace-area">
        <div class="f-col">${this.slotHTML({ a: 'fur', s: 'input' })}<div class="flame"><div class="flame-fill"></div></div>${this.slotHTML({ a: 'fur', s: 'fuel' })}</div>
        <div class="arrow progress"><div class="arrow-fill"></div></div>${this.slotHTML({ a: 'fur', s: 'output' }, 'big')}</div>`;
    } else if (k === 'creative') {
      top = `<div class="creative-tabs"><div class="ctab active">건축 블록</div><div class="ctab dis" title="미구현">검색</div></div>
        <div class="grid g9 creative-grid">${CREATIVE_LIST.map((id) => this.slotHTML({ a: 'cre', id })).join('')}${Array((45 - CREATIVE_LIST.length % 45) % 9).fill('<div class="slot empty"></div>').join('')}</div>`;
    }
    const bag = k === 'creative' ? '' : `<div class="mc-label">인벤토리</div><div class="grid g9">${[...Array(27).keys()].map((i) => this.slotHTML({ a: 'inv', i: i + 9 })).join('')}</div>`;
    const bar = `<div class="grid g9 hot">${[...Array(9).keys()].map((i) => this.slotHTML({ a: 'inv', i })).join('')}</div>`;
    const trash = k === 'creative' ? `<div class="trash-row">${this.slotHTML({ a: 'trash' }, 'trash')}</div>` : '';
    this.root.innerHTML = `<div class="mc-window ${k}">${top}${bag}${bar}${trash}</div>`;
    this.render();
    if (k === 'inventory') this.game.drawPlayerPreview?.($('#preview-canvas'));
  }
  refOf(el) { return JSON.parse(el.dataset.ref || 'null'); }
  furnace() { return this.furnaceKey ? this.game.world.furnaces.get(this.furnaceKey) : null; }
  refStack(ref) {
    if (!ref) return null;
    switch (ref.a) {
      case 'inv': return this.game.inventory.slots[ref.i];
      case 'craft': return this.grid[ref.i];
      case 'result': return this.result();
      case 'fur': return this.furnace()?.[ref.s] || null;
      case 'cre': return { id: ref.id, count: 1 };
      default: return null;
    }
  }
  setStack(ref, st) {
    if (st && st.count <= 0) st = null;
    if (ref.a === 'inv') this.game.inventory.slots[ref.i] = st;
    else if (ref.a === 'craft') this.grid[ref.i] = st;
    else if (ref.a === 'fur') { const f = this.furnace(); if (f) f[ref.s] = st; }
  }
  result() { return matchRecipe(this.grid.map((s) => (s ? s.id : 0)), this.gridN); }

  onClick(e) {
    const el = e.target.closest('.slot'); if (!el || el.classList.contains('empty')) return;
    e.preventDefault();
    const ref = this.refOf(el); const right = e.button === 2; const shift = e.shiftKey;
    const inv = this.game.inventory;

    if (ref.a === 'armor') return; // 갑옷 미구현
    if (ref.a === 'trash') { this.cursor = null; this.render(); return; }
    if (ref.a === 'cre') {
      const ms = maxStack(ref.id);
      if (shift) { inv.add(ref.id, ms); }
      else if (this.cursor) { this.cursor = null; }
      else { this.cursor = { id: ref.id, count: right ? 1 : ms }; }
      this.render(); return;
    }
    if (ref.a === 'result') {
      const r = this.result(); if (!r) return;
      if (shift) {
        let guard = 64;
        while (guard-- > 0) { const rr = this.result(); if (!rr || rr.id !== r.id) break; if (inv.add(rr.id, rr.count)) break; this.consumeGrid(); }
      } else {
        if (this.cursor && (this.cursor.id !== r.id || this.cursor.count + r.count > maxStack(r.id))) return;
        this.cursor = this.cursor ? { id: r.id, count: this.cursor.count + r.count } : { ...r };
        this.consumeGrid();
      }
      this.game.sound?.('pop'); this.render(); return;
    }
    if (ref.a === 'fur' && ref.s === 'output') {
      const st = this.refStack(ref); if (!st) return;
      if (shift) { const left = inv.add(st.id, st.count); this.setStack(ref, left ? { id: st.id, count: left } : null); }
      else if (!this.cursor) { this.cursor = { ...st }; this.setStack(ref, null); }
      else if (this.cursor.id === st.id) { const n = Math.min(st.count, maxStack(st.id) - this.cursor.count); this.cursor.count += n; this.setStack(ref, { id: st.id, count: st.count - n }); }
      this.render(); return;
    }
    const st = this.refStack(ref);
    if (shift && st) { // 빠른 이동
      if (ref.a === 'inv' && this.kind === 'furnace') {
        const f = this.furnace(); const target = SMELT[st.id] !== undefined ? 'input' : FUEL[st.id] ? 'fuel' : null;
        if (target && f) {
          const t = f[target];
          if (!t) { f[target] = { ...st }; this.setStack(ref, null); }
          else if (t.id === st.id) { const n = Math.min(st.count, maxStack(st.id) - t.count); t.count += n; this.setStack(ref, { id: st.id, count: st.count - n }); }
          this.render(); return;
        }
      }
      if (ref.a === 'inv') {
        const toHot = ref.i >= 9; const range = toHot ? [0, 9] : [9, 36];
        let count = st.count; const ms = maxStack(st.id);
        for (let i = range[0]; i < range[1] && count; i++) { const s = inv.slots[i]; if (s && s.id === st.id && s.count < ms) { const n = Math.min(ms - s.count, count); s.count += n; count -= n; } }
        for (let i = range[0]; i < range[1] && count; i++) { if (!inv.slots[i]) { inv.slots[i] = { id: st.id, count }; count = 0; } }
        this.setStack(ref, count ? { id: st.id, count } : null);
      } else { const left = inv.add(st.id, st.count); this.setStack(ref, left ? { id: st.id, count: left } : null); }
      this.render(); return;
    }
    const c = this.cursor;
    if (!right) {
      if (!c && st) { this.cursor = { ...st }; this.setStack(ref, null); }
      else if (c && !st) { this.setStack(ref, { ...c }); this.cursor = null; }
      else if (c && st) {
        if (c.id === st.id) { const n = Math.min(c.count, maxStack(st.id) - st.count); st.count += n; c.count -= n; if (!c.count) this.cursor = null; }
        else { this.setStack(ref, { ...c }); this.cursor = { ...st }; }
      }
    } else {
      if (!c && st) { const half = Math.ceil(st.count / 2); this.cursor = { id: st.id, count: half }; this.setStack(ref, { id: st.id, count: st.count - half }); }
      else if (c && (!st || (st.id === c.id && st.count < maxStack(c.id)))) {
        this.setStack(ref, { id: c.id, count: (st ? st.count : 0) + 1 }); c.count--; if (!c.count) this.cursor = null;
      }
    }
    this.render();
  }
  consumeGrid() { for (let i = 0; i < this.grid.length; i++) if (this.grid[i]) { this.grid[i].count--; if (this.grid[i].count <= 0) this.grid[i] = null; } }

  stackHTML(st) {
    if (!st) return '';
    return `<img src="${iconFor(st.id)}" draggable="false">${st.count > 1 ? `<span class="count">${st.count}</span>` : ''}`;
  }
  render() {
    if (!this.open) return;
    for (const el of this.root.querySelectorAll('.slot')) {
      if (el.classList.contains('empty')) continue;
      const ref = this.refOf(el);
      if (ref.a === 'armor' || ref.a === 'trash') continue;
      const st = this.refStack(ref);
      const html = ref.a === 'cre' ? this.stackHTML({ id: ref.id, count: 1 }) : this.stackHTML(st);
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
    }
    this.cursorEl.innerHTML = this.stackHTML(this.cursor);
    if (this.cursor) this.tooltip.style.display = 'none';
    if (this.kind === 'furnace') {
      const f = this.furnace(); if (!f) return;
      const fl = this.root.querySelector('.flame-fill'), ar = this.root.querySelector('.arrow-fill');
      if (fl) fl.style.height = (f.burn > 0 ? (f.burn / f.burnMax) * 100 : 0) + '%';
      if (ar) ar.style.width = (f.progress / SMELT_TIME) * 100 + '%';
    }
  }
}

// ===== 핫바 HUD =====
export function renderHotbar(inv) {
  const bar = document.querySelector('#hotbar');
  if (!bar.children.length) bar.innerHTML = [...Array(9)].map(() => '<div class="hslot"></div>').join('') + '<div id="hotbar-sel"></div>';
  [...bar.querySelectorAll('.hslot')].forEach((el, i) => {
    const st = inv.slots[i];
    const html = st ? `<img src="${iconFor(st.id)}" draggable="false">${st.count > 1 ? `<span class="count">${st.count}</span>` : ''}` : '';
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  });
  document.querySelector('#hotbar-sel').style.transform = `translateX(${inv.selected * 40}px)`;
}
export { B };
