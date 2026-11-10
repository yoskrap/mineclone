// 월드: 청크 데이터, 지형 생성, 메싱(면 컬링 + Ambient Occlusion), 청크 로딩/언로딩, 저장용 변경 기록
import * as THREE from 'three';
import { B, BLOCKS, isOpaque, isSolid } from './blocks.js';
import { Noise, hash3 } from './noise.js';
import { tileUV } from './textures.js';

export const CS = 16;      // 청크 가로/세로
export const CH = 96;      // 월드 높이
export const SEA = 32;     // 해수면

const key = (cx, cz) => cx * 1000003 + cz;
const strKey = (cx, cz) => cx + ',' + cz;

// 면 정의: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z  (꼭짓점은 바깥에서 본 반시계 방향: BL, BR, TR, TL)
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.6 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8 },
];
// 각 면/꼭짓점의 AO 샘플 오프셋 미리 계산
for (const f of FACES) {
  const na = f.n.findIndex((v) => v !== 0);
  const axes = [0, 1, 2].filter((a) => a !== na);
  f.ao = f.c.map((corner) => {
    const s1 = [0, 0, 0], s2 = [0, 0, 0];
    s1[axes[0]] = corner[axes[0]] ? 1 : -1;
    s2[axes[1]] = corner[axes[1]] ? 1 : -1;
    const cc = [s1[0] + s2[0], s1[1] + s2[1], s1[2] + s2[2]];
    return [s1, s2, cc].map((o) => [o[0] + f.n[0], o[1] + f.n[1], o[2] + f.n[2]]);
  });
}
const AO_CURVE = [0.5, 0.66, 0.82, 1];
export const FACE_DIRS = FACES.map((f) => f.n);

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.data = new Uint8Array(CS * CS * CH);
    this.height = new Int16Array(CS * CS).fill(-1);
    this.maxY = 0;
    this.mesh = null; this.waterMesh = null;
    this.dirty = true;
  }
  recalcColumn(x, z) {
    let y = CH - 1;
    while (y >= 0 && !isOpaque(this.data[x + (z << 4) + (y << 8)])) y--;
    this.height[x + (z << 4)] = y;
  }
}

export class World {
  constructor({ seed, scene, materials, diffs = {}, meta = {}, furnaces = {} }) {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.materials = materials;
    this.noise = new Noise(this.seed);
    this.noise2 = new Noise((this.seed + 7777) >>> 0);
    this.cave1 = new Noise((this.seed + 123) >>> 0);
    this.cave2 = new Noise((this.seed + 456) >>> 0);
    this.chunks = new Map();
    this.diffs = diffs;            // { "cx,cz": { localIndex: blockId } }
    this.meta = new Map(Object.entries(meta));       // "x,y,z" -> { facing, lit }
    this.furnaces = new Map(Object.entries(furnaces)); // "x,y,z" -> 화로 상태
    this._last = null;
    this.stats = { generated: 0, meshed: 0 };
  }

  // ---------- 지형 ----------
  heightAt(x, z) {
    const n = this.noise;
    const cont = n.fbm2(x / 256, z / 256, 3);
    const hills = n.fbm2(x / 64 + 100, z / 64 - 50, 4);
    let mount = Math.max(0, this.noise2.noise2D(x / 170, z / 170) - 0.2) / 0.8;
    mount = mount * mount;
    const h = SEA + 3 + cont * 11 + hills * 6 + mount * 42;
    return Math.max(4, Math.min(CH - 14, Math.floor(h)));
  }
  isCave(x, y, z) {
    const a = this.cave1.noise3D(x / 30, y / 20, z / 30);
    const b = this.cave2.noise3D(x / 30, y / 20, z / 30);
    return a * a + b * b < 0.011;
  }
  treeAt(wx, wz) {
    const cell = 5;
    const gx = Math.floor(wx / cell), gz = Math.floor(wz / cell);
    const ox = Math.floor(hash3(this.seed, gx, 11, gz) * cell), oz = Math.floor(hash3(this.seed, gx, 22, gz) * cell);
    if (gx * cell + ox !== wx || gz * cell + oz !== wz) return 0;
    const forest = this.noise2.noise2D(wx / 90 + 40, wz / 90);
    const p = 0.12 + Math.max(0, forest) * 0.75;
    if (hash3(this.seed, gx, 33, gz) > p) return 0;
    return 4 + Math.floor(hash3(this.seed, wx, 44, wz) * 3); // 줄기 높이 4~6
  }

  generate(ch) {
    const d = ch.data, ox = ch.cx * CS, oz = ch.cz * CS, seed = this.seed;
    let maxY = SEA;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const wx = ox + x, wz = oz + z;
      const h = this.heightAt(wx, wz);
      const beach = h <= SEA + 1;
      const under = h < SEA;
      const gravelBed = under && this.noise2.noise2D(wx / 20, wz / 20) > 0.3;
      const snowy = h > SEA + 30;
      const dirtDepth = 3 + Math.floor(hash3(seed, wx, 1, wz) * 2);
      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let id = 0;
        if (y === 0 || (y <= 2 && hash3(seed, wx, y, wz) < 0.5 - y * 0.15)) id = B.BEDROCK;
        else if (y < h - dirtDepth) id = B.STONE;
        else if (y < h) id = beach ? (gravelBed ? B.GRAVEL : B.SAND) : (snowy ? B.STONE : B.DIRT);
        else if (y === h) id = beach ? (gravelBed ? B.GRAVEL : B.SAND) : (snowy ? B.SNOW : B.GRASS);
        else if (y <= SEA) id = B.WATER;
        // 동굴 (바다 밑은 뚫지 않음)
        if (id && id !== B.BEDROCK && id !== B.WATER && y > 4 && y <= h && !(h <= SEA + 2 && y > h - 4) && this.isCave(wx, y, wz)) id = 0;
        // 광석
        if (id === B.STONE) {
          const r = hash3(seed, wx * 3 + 1, y, wz * 3 + 2);
          if (r < 0.006 && y < 70) id = B.COAL_ORE;
          else if (r < 0.0095 && y < 42) id = B.IRON_ORE;
        }
        if (id) d[x + (z << 4) + (y << 8)] = id;
      }
      if (h > maxY) maxY = h;
    }
    // 광석 덩어리 키우기 (주변 1칸)
    const seeds = [];
    for (let i = 0; i < d.length; i++) if (d[i] === B.COAL_ORE || d[i] === B.IRON_ORE) seeds.push(i);
    for (const i of seeds) {
      const id = d[i];
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
      const r = hash3(seed, ox + x, y + 500, oz + z);
      const n = Math.floor(r * 4);
      for (let k = 0; k < n; k++) {
        const dx = [1, 0, 0, 1][k], dy = [0, 1, 0, 1][k], dz = [0, 0, 1, 0][k];
        const xx = x + dx, yy = y + dy, zz = z + dz;
        if (xx < 16 && zz < 16 && d[xx + (zz << 4) + (yy << 8)] === B.STONE) d[xx + (zz << 4) + (yy << 8)] = id;
      }
    }
    // 나무 (청크 경계를 넘는 나무도 이웃 청크 기준으로 일관되게 생성)
    for (let wz = oz - 3; wz < oz + CS + 3; wz++) for (let wx = ox - 3; wx < ox + CS + 3; wx++) {
      const th = this.treeAt(wx, wz); if (!th) continue;
      const h = this.heightAt(wx, wz);
      if (h <= SEA + 1 || h > SEA + 28) continue;
      const lx = wx - ox, lz = wz - oz;
      const inC = (x, z) => x >= 0 && x < CS && z >= 0 && z < CS;
      if (inC(lx, lz)) {
        if (this.isCave(wx, h, wz)) continue; // 땅이 꺼진 곳엔 나무 안 심음 (경계 밖 판정과 동일)
        d[lx + (lz << 4) + (h << 8)] = B.DIRT;
        for (let y = h + 1; y <= h + th; y++) d[lx + (lz << 4) + (y << 8)] = B.LOG;
      } else if (this.isCave(wx, h, wz)) continue;
      const top = h + th;
      for (let y = top - 2; y <= top + 1; y++) {
        const r = y <= top - 1 ? 2 : 1;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (y === top + 1 || hash3(seed, wx + dx, y, wz + dz) < 0.5)) continue;
          if (y === top + 1 && (dx !== 0 && dz !== 0)) continue;
          const x = lx + dx, z = lz + dz;
          if (!inC(x, z) || y >= CH) continue;
          const i = x + (z << 4) + (y << 8);
          if (d[i] === 0) d[i] = B.LEAVES;
        }
      }
      if (top + 2 > maxY) maxY = top + 2;
    }
    // 저장된 변경 사항 적용
    const diff = this.diffs[strKey(ch.cx, ch.cz)];
    if (diff) for (const k in diff) { d[+k] = diff[k]; const y = (+k) >> 8; if (y > maxY) maxY = y; }
    ch.maxY = Math.min(CH - 1, maxY + 1);
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) ch.recalcColumn(x, z);
    this.stats.generated++;
  }

  // ---------- 블록 접근 ----------
  chunkAt(cx, cz) {
    const l = this._last;
    if (l && l.cx === cx && l.cz === cz) return l;
    const c = this.chunks.get(key(cx, cz));
    if (c) this._last = c;
    return c;
  }
  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= CH) return 0;
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c) return 0;
    return c.data[(x & 15) + ((z & 15) << 4) + (y << 8)];
  }
  isLoaded(x, z) { return !!this.chunkAt(x >> 4, z >> 4); }
  topAt(x, z) {
    const c = this.chunkAt(x >> 4, z >> 4);
    return c ? c.height[(x & 15) + ((z & 15) << 4)] : -1;
  }
  setBlock(x, y, z, id) {
    if (y < 0 || y >= CH) return false;
    const cx = x >> 4, cz = z >> 4; const c = this.chunkAt(cx, cz);
    if (!c) return false;
    const lx = x & 15, lz = z & 15, i = lx + (lz << 4) + (y << 8);
    if (c.data[i] === id) return false;
    c.data[i] = id;
    if (y + 1 > c.maxY) c.maxY = Math.min(CH - 1, y + 1);
    c.recalcColumn(lx, lz);
    const sk = strKey(cx, cz);
    (this.diffs[sk] ||= {})[i] = id;
    const mk = x + ',' + y + ',' + z;
    this.meta.delete(mk);
    if (id !== B.FURNACE) this.furnaces.delete(mk);
    c.dirty = true;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      if ((dx === -1 && lx !== 0) || (dx === 1 && lx !== 15) || (dz === -1 && lz !== 0) || (dz === 1 && lz !== 15)) continue;
      const n = this.chunkAt(cx + dx, cz + dz); if (n) n.dirty = true;
    }
    return true;
  }
  markDirtyAt(x, z) { const c = this.chunkAt(x >> 4, z >> 4); if (c) c.dirty = true; }

  // ---------- 메싱 ----------
  buildMesh(ch) {
    const P = [], U = [], C = [], IDX = [];
    const WP = [], WU = [], WC = [], WI = [];
    const ox = ch.cx * CS, oz = ch.cz * CS, data = ch.data;
    const get = (x, y, z) => {
      if (y < 0) return B.BEDROCK;
      if (y >= CH) return 0;
      if (x >= 0 && x < CS && z >= 0 && z < CS) return data[x + (z << 4) + (y << 8)];
      return this.getBlock(ox + x, y, oz + z);
    };
    const top = (x, z) => (x >= 0 && x < CS && z >= 0 && z < CS) ? ch.height[x + (z << 4)] : this.topAt(ox + x, oz + z);
    const opq = (x, y, z) => (isOpaque(get(x, y, z)) ? 1 : 0);

    for (let y = 0; y <= ch.maxY; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const id = data[x + (z << 4) + (y << 8)];
      if (!id) continue;
      const b = BLOCKS[id];
      const isWater = b.liquid;
      let lowerTop = false;
      if (isWater && get(x, y + 1, z) !== B.WATER) lowerTop = true;
      let facing = -1, lit = false;
      if (b.tex.front !== undefined) {
        const m = this.meta.get((ox + x) + ',' + y + ',' + (oz + z));
        facing = m ? m.facing : 4; lit = !!(m && m.lit);
      }
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
        const nid = get(nx, ny, nz);
        if (isWater) { if (nid === B.WATER || isOpaque(nid)) continue; }
        else { if (isOpaque(nid)) continue; if (nid === id && id !== B.LEAVES) continue; }
        let tile = f === 2 ? b.tex.top : f === 3 ? b.tex.bottom : b.tex.side;
        if (f === facing) tile = (id === B.FURNACE && lit) ? b.tex.front + 1 : b.tex.front;
        const [u0, v0, u1, v1] = tileUV(tile);
        const t = ny >= CH ? -1 : top(nx, nz);
        const sky = ny > t ? 1 : Math.max(0.3, 1 - (t - ny) * 0.14);
        const uvs = [u0, v0, u1, v0, u1, v1, u0, v1];
        const tP = isWater ? WP : P, tU = isWater ? WU : U, tC = isWater ? WC : C, tI = isWater ? WI : IDX;
        const base = tP.length / 3;
        const ao = [3, 3, 3, 3];
        if (!isWater && !b.cutout) {
          for (let k = 0; k < 4; k++) {
            const [s1, s2, cc] = F.ao[k];
            const a = opq(x + s1[0], y + s1[1], z + s1[2]), bb = opq(x + s2[0], y + s2[1], z + s2[2]), c = opq(x + cc[0], y + cc[1], z + cc[2]);
            ao[k] = a && bb ? 0 : 3 - (a + bb + c);
          }
        }
        for (let k = 0; k < 4; k++) {
          const cr = F.c[k];
          const vy = (lowerTop && cr[1] === 1) ? 0.875 : cr[1];
          tP.push(x + cr[0], y + vy, z + cr[2]);
          tU.push(uvs[k * 2], uvs[k * 2 + 1]);
          const l = F.shade * AO_CURVE[ao[k]] * sky;
          tC.push(l, l, l);
        }
        if (ao[0] + ao[2] >= ao[1] + ao[3]) tI.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else tI.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      }
    }
    const mk = (p, u, c, idx, mat, order) => {
      if (!p.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.position.set(ox, 0, oz); m.renderOrder = order; m.matrixAutoUpdate = false; m.updateMatrix();
      return m;
    };
    this.disposeMesh(ch);
    ch.mesh = mk(P, U, C, IDX, this.materials.opaque, 0);
    ch.waterMesh = mk(WP, WU, WC, WI, this.materials.water, 1);
    if (ch.mesh) this.scene.add(ch.mesh);
    if (ch.waterMesh) this.scene.add(ch.waterMesh);
    ch.dirty = false;
    this.stats.meshed++;
  }
  disposeMesh(ch) {
    for (const k of ['mesh', 'waterMesh']) {
      if (ch[k]) { this.scene.remove(ch[k]); ch[k].geometry.dispose(); ch[k] = null; }
    }
  }

  // ---------- 청크 로딩 ----------
  // 반경 radius 안의 청크를 생성하고 메시를 만든다. budgetMs 안에서만 작업(프레임 드랍 방지)
  update(px, pz, radius, budgetMs = 8) {
    const t0 = performance.now();
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    // 수정된 청크는 즉시 다시 그림
    for (const c of this.chunks.values()) if (c.dirty && c.mesh !== undefined && c._ready) this.buildMesh(c);

    const need = [];
    for (let dz = -radius - 1; dz <= radius + 1; dz++) for (let dx = -radius - 1; dx <= radius + 1; dx++) {
      need.push([dx * dx + dz * dz, pcx + dx, pcz + dz, Math.max(Math.abs(dx), Math.abs(dz)) <= radius]);
    }
    need.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz] of need) {
      if (this.chunks.has(key(cx, cz))) continue;
      if (performance.now() - t0 > budgetMs) break;
      const c = new Chunk(cx, cz); this.generate(c); this.chunks.set(key(cx, cz), c);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const n = this.chunks.get(key(cx + dx, cz + dz)); if (n) n.dirty = true;
      }
    }
    for (const [, cx, cz, inside] of need) {
      if (!inside) continue;
      const c = this.chunks.get(key(cx, cz));
      if (!c || (c._ready && !c.dirty)) continue;
      let ok = true;
      for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(key(cx + dx, cz + dz))) { ok = false; break; }
      if (!ok) continue;
      if (performance.now() - t0 > budgetMs * 1.5) break;
      this.buildMesh(c); c._ready = true;
    }
    // 멀리 있는 청크 해제 (변경사항은 diffs에 남아 있어 다시 오면 복원됨)
    for (const [k, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) > radius + 3 || Math.abs(c.cz - pcz) > radius + 3) {
        this.disposeMesh(c); this.chunks.delete(k); if (this._last === c) this._last = null;
      }
    }
  }
  readyAround(px, pz, r) {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const c = this.chunks.get(key(pcx + dx, pcz + dz)); if (!c || !c._ready) return false;
    }
    return true;
  }
  meshCount() { let n = 0; for (const c of this.chunks.values()) if (c._ready) n++; return n; }
  dispose() { for (const c of this.chunks.values()) this.disposeMesh(c); this.chunks.clear(); this._last = null; }

  findSpawn() {
    for (let r = 0; r < 400; r += 4) for (let a = 0; a < 8; a++) {
      const x = Math.round(Math.cos(a * Math.PI / 4) * r), z = Math.round(Math.sin(a * Math.PI / 4) * r);
      const h = this.heightAt(x, z);
      if (h > SEA + 1 && h < SEA + 20 && !this.treeAt(x, z)) return { x: x + 0.5, z: z + 0.5 };
    }
    return { x: 0.5, z: 0.5 };
  }
  surfaceY(x, z) {
    for (let y = CH - 1; y > 0; y--) { const id = this.getBlock(x, y, z); if (isSolid(id) || id === B.WATER) return y + 1; }
    return CH;
  }

  // ---------- 레이캐스트 (복셀 DDA) ----------
  raycast(o, d, maxDist) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const tdx = Math.abs(1 / d.x), tdy = Math.abs(1 / d.y), tdz = Math.abs(1 / d.z);
    let tmx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
    let n = [0, 0, 0], t = 0;
    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (id && id !== B.WATER) return { x, y, z, id, n, dist: t };
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; n = [-sx, 0, 0]; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; n = [0, -sy, 0]; }
      else { z += sz; t = tmz; tmz += tdz; n = [0, 0, -sz]; }
    }
    return null;
  }

  serialize() {
    return { diffs: this.diffs, meta: Object.fromEntries(this.meta), furnaces: Object.fromEntries(this.furnaces) };
  }
}
