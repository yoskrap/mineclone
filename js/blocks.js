// 블록 / 아이템 / 제작법 / 제련법 정의
// 원본(Minecraft Java Edition 1.21)의 블록 경도·도구 규칙을 관찰해 근사한 값

export const TILES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobblestone', 'log_side', 'log_top', 'leaves',
  'planks', 'sand', 'water', 'glass', 'crafting_top', 'crafting_side', 'crafting_front', 'coal_ore',
  'iron_ore', 'bedrock', 'gravel', 'stone_bricks', 'furnace_front', 'furnace_front_on', 'furnace_side', 'furnace_top',
  'bricks', 'snow', 'grass_side_snow', 'white_wool', 'bookshelf', 'tnt_side', 'tnt_top', 'tnt_bottom',
];
export const T = Object.fromEntries(TILES.map((n, i) => [n, i]));

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLESTONE: 4, LOG: 5, LEAVES: 6, PLANKS: 7,
  SAND: 8, WATER: 9, GLASS: 10, CRAFTING_TABLE: 11, COAL_ORE: 12, IRON_ORE: 13, BEDROCK: 14,
  GRAVEL: 15, STONE_BRICKS: 16, FURNACE: 17, BRICKS: 18, SNOW: 19, WOOL: 20, BOOKSHELF: 21,
};

export const I = {
  STICK: 100, COAL: 101, IRON_INGOT: 102,
  WOODEN_PICKAXE: 110, STONE_PICKAXE: 111, IRON_PICKAXE: 112,
  WOODEN_AXE: 113, STONE_AXE: 114, WOODEN_SHOVEL: 115, STONE_SHOVEL: 116,
};

// hardness: Minecraft 공식 위키에 공개된 블록 경도 값
const blockDefs = [
  { id: B.GRASS, key: 'grass_block', name: '잔디 블록', tex: { top: T.grass_top, side: T.grass_side, bottom: T.dirt }, hardness: 0.6, tool: 'shovel', drop: B.DIRT, sound: 'grass' },
  { id: B.DIRT, key: 'dirt', name: '흙', tex: T.dirt, hardness: 0.5, tool: 'shovel', sound: 'gravel' },
  { id: B.STONE, key: 'stone', name: '돌', tex: T.stone, hardness: 1.5, tool: 'pickaxe', needsTool: true, drop: B.COBBLESTONE, sound: 'stone' },
  { id: B.COBBLESTONE, key: 'cobblestone', name: '조약돌', tex: T.cobblestone, hardness: 2, tool: 'pickaxe', needsTool: true, sound: 'stone' },
  { id: B.LOG, key: 'oak_log', name: '참나무 원목', tex: { top: T.log_top, side: T.log_side, bottom: T.log_top }, hardness: 2, tool: 'axe', sound: 'wood' },
  { id: B.LEAVES, key: 'oak_leaves', name: '참나무 잎', tex: T.leaves, hardness: 0.2, cutout: true, drop: null, sound: 'grass' },
  { id: B.PLANKS, key: 'oak_planks', name: '참나무 판자', tex: T.planks, hardness: 2, tool: 'axe', sound: 'wood' },
  { id: B.SAND, key: 'sand', name: '모래', tex: T.sand, hardness: 0.5, tool: 'shovel', sound: 'sand' },
  { id: B.WATER, key: 'water', name: '물', tex: T.water, hardness: Infinity, liquid: true, solid: false, sound: 'water' },
  { id: B.GLASS, key: 'glass', name: '유리', tex: T.glass, hardness: 0.3, cutout: true, drop: null, sound: 'glass' },
  { id: B.CRAFTING_TABLE, key: 'crafting_table', name: '제작대', tex: { top: T.crafting_top, side: T.crafting_side, front: T.crafting_front, bottom: T.planks }, hardness: 2.5, tool: 'axe', sound: 'wood', interact: 'crafting' },
  { id: B.COAL_ORE, key: 'coal_ore', name: '석탄 광석', tex: T.coal_ore, hardness: 3, tool: 'pickaxe', needsTool: true, drop: I.COAL, sound: 'stone' },
  { id: B.IRON_ORE, key: 'iron_ore', name: '철 광석', tex: T.iron_ore, hardness: 3, tool: 'pickaxe', needsTool: true, minTier: 2, sound: 'stone' },
  { id: B.BEDROCK, key: 'bedrock', name: '기반암', tex: T.bedrock, hardness: Infinity, sound: 'stone' },
  { id: B.GRAVEL, key: 'gravel', name: '자갈', tex: T.gravel, hardness: 0.6, tool: 'shovel', sound: 'gravel' },
  { id: B.STONE_BRICKS, key: 'stone_bricks', name: '석재 벽돌', tex: T.stone_bricks, hardness: 1.5, tool: 'pickaxe', needsTool: true, sound: 'stone' },
  { id: B.FURNACE, key: 'furnace', name: '화로', tex: { top: T.furnace_top, side: T.furnace_side, front: T.furnace_front, bottom: T.furnace_top }, hardness: 3.5, tool: 'pickaxe', needsTool: true, sound: 'stone', interact: 'furnace' },
  { id: B.BRICKS, key: 'bricks', name: '벽돌', tex: T.bricks, hardness: 2, tool: 'pickaxe', needsTool: true, sound: 'stone' },
  { id: B.SNOW, key: 'snow_block', name: '눈 블록', tex: T.snow, hardness: 0.2, tool: 'shovel', sound: 'snow' },
  { id: B.WOOL, key: 'white_wool', name: '흰색 양털', tex: T.white_wool, hardness: 0.8, sound: 'wool' },
  { id: B.BOOKSHELF, key: 'bookshelf', name: '책장', tex: { top: T.planks, side: T.bookshelf, bottom: T.planks }, hardness: 1.5, tool: 'axe', sound: 'wood' },
];

export const BLOCKS = [];
BLOCKS[0] = { id: 0, key: 'air', name: '공기', solid: false, transparent: true };
for (const d of blockDefs) {
  const tex = typeof d.tex === 'number' ? { top: d.tex, side: d.tex, bottom: d.tex } : d.tex;
  BLOCKS[d.id] = {
    solid: true, cutout: false, liquid: false, needsTool: false, minTier: 1,
    drop: d.id, ...d, tex,
    transparent: !!(d.cutout || d.liquid),
  };
}

const itemDefs = [
  { id: I.STICK, key: 'stick', name: '막대기' },
  { id: I.COAL, key: 'coal', name: '석탄', fuel: 80 },
  { id: I.IRON_INGOT, key: 'iron_ingot', name: '철 주괴' },
  { id: I.WOODEN_PICKAXE, key: 'wooden_pickaxe', name: '나무 곡괭이', toolType: 'pickaxe', tier: 1, speed: 2, maxStack: 1 },
  { id: I.STONE_PICKAXE, key: 'stone_pickaxe', name: '돌 곡괭이', toolType: 'pickaxe', tier: 2, speed: 4, maxStack: 1 },
  { id: I.IRON_PICKAXE, key: 'iron_pickaxe', name: '철 곡괭이', toolType: 'pickaxe', tier: 3, speed: 6, maxStack: 1 },
  { id: I.WOODEN_AXE, key: 'wooden_axe', name: '나무 도끼', toolType: 'axe', tier: 1, speed: 2, maxStack: 1 },
  { id: I.STONE_AXE, key: 'stone_axe', name: '돌 도끼', toolType: 'axe', tier: 2, speed: 4, maxStack: 1 },
  { id: I.WOODEN_SHOVEL, key: 'wooden_shovel', name: '나무 삽', toolType: 'shovel', tier: 1, speed: 2, maxStack: 1 },
  { id: I.STONE_SHOVEL, key: 'stone_shovel', name: '돌 삽', toolType: 'shovel', tier: 2, speed: 4, maxStack: 1 },
];
export const ITEMS = {};
for (const d of itemDefs) ITEMS[d.id] = { maxStack: 64, ...d, isItem: true };

export function isBlock(id) { return id > 0 && id < 100 && !!BLOCKS[id]; }
export function itemInfo(id) { return isBlock(id) ? BLOCKS[id] : ITEMS[id]; }
export function itemName(id) { const i = itemInfo(id); return i ? i.name : '?'; }
export function maxStack(id) { return isBlock(id) ? 64 : (ITEMS[id]?.maxStack ?? 64); }
export function isOpaque(id) { const b = BLOCKS[id]; return !!b && b.solid && !b.transparent; }
export function isSolid(id) { const b = BLOCKS[id]; return !!b && b.solid; }

// 연료 지속 시간(초) — 원본: 아이템 1개 굽는 데 10초
export const FUEL = { [B.PLANKS]: 15, [B.LOG]: 15, [I.STICK]: 5, [I.COAL]: 80, [B.CRAFTING_TABLE]: 15, [B.BOOKSHELF]: 15 };
export const SMELT = { [B.COBBLESTONE]: B.STONE, [B.SAND]: B.GLASS, [B.IRON_ORE]: I.IRON_INGOT, [B.LOG]: I.COAL }; // 원본은 원목→숯(charcoal), 여기선 석탄으로 통합
export const SMELT_TIME = 10;

// 블록 파괴 시간(초) — 원본 공식 근사: hardness * (도구 적합 1.5 / 부적합 5) / 도구 속도
export function breakTime(blockId, toolId) {
  const b = BLOCKS[blockId];
  if (!b || b.hardness === Infinity) return Infinity;
  const tool = ITEMS[toolId];
  const rightTool = tool && tool.toolType === b.tool;
  const canHarvest = !b.needsTool || (rightTool && tool.tier >= b.minTier);
  const speed = rightTool ? tool.speed : 1;
  return (b.hardness * (canHarvest ? 1.5 : 5)) / speed;
}
export function canHarvest(blockId, toolId) {
  const b = BLOCKS[blockId];
  if (!b) return false;
  if (!b.needsTool) return true;
  const tool = ITEMS[toolId];
  return !!tool && tool.toolType === b.tool && tool.tier >= b.minTier;
}

// ===== 제작법 (모양 있는 제작, 좌우 반전 허용) =====
const _ = 0, P = B.PLANKS, S = I.STICK, C = B.COBBLESTONE, R = B.STONE, N = I.IRON_INGOT;
export const RECIPES = [
  { shape: [[B.LOG]], out: [B.PLANKS, 4] },
  { shape: [[P], [P]], out: [I.STICK, 4] },
  { shape: [[P, P], [P, P]], out: [B.CRAFTING_TABLE, 1] },
  { shape: [[C, C, C], [C, _, C], [C, C, C]], out: [B.FURNACE, 1] },
  { shape: [[R, R], [R, R]], out: [B.STONE_BRICKS, 4] },
  { shape: [[P, P, P], [_, S, _], [_, S, _]], out: [I.WOODEN_PICKAXE, 1] },
  { shape: [[C, C, C], [_, S, _], [_, S, _]], out: [I.STONE_PICKAXE, 1] },
  { shape: [[N, N, N], [_, S, _], [_, S, _]], out: [I.IRON_PICKAXE, 1] },
  { shape: [[P, P], [P, S], [_, S]], out: [I.WOODEN_AXE, 1] },
  { shape: [[C, C], [C, S], [_, S]], out: [I.STONE_AXE, 1] },
  { shape: [[P], [S], [S]], out: [I.WOODEN_SHOVEL, 1] },
  { shape: [[C], [S], [S]], out: [I.STONE_SHOVEL, 1] },
];

// grid: 길이 n*n 배열(아이템 id 또는 0), n: 2 또는 3
export function matchRecipe(grid, n) {
  let minR = n, maxR = -1, minC = n, maxC = -1;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (grid[r * n + c]) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  }
  if (maxR < 0) return null;
  const h = maxR - minR + 1, w = maxC - minC + 1;
  for (const rec of RECIPES) {
    const rh = rec.shape.length, rw = rec.shape[0].length;
    if (rh !== h || rw !== w) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let r = 0; r < h && ok; r++) for (let c = 0; c < w && ok; c++) {
        const want = rec.shape[r][mirror ? w - 1 - c : c];
        if ((grid[(minR + r) * n + (minC + c)] || 0) !== want) ok = false;
      }
      if (ok) return { id: rec.out[0], count: rec.out[1] };
    }
  }
  return null;
}

// 크리에이티브 인벤토리 목록
export const CREATIVE_LIST = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLESTONE, B.LOG, B.PLANKS, B.LEAVES, B.SAND, B.GRAVEL,
  B.GLASS, B.STONE_BRICKS, B.BRICKS, B.SNOW, B.WOOL, B.BOOKSHELF, B.CRAFTING_TABLE, B.FURNACE,
  B.COAL_ORE, B.IRON_ORE, B.BEDROCK,
  I.STICK, I.COAL, I.IRON_INGOT, I.WOODEN_PICKAXE, I.STONE_PICKAXE, I.IRON_PICKAXE,
  I.WOODEN_AXE, I.STONE_AXE, I.WOODEN_SHOVEL, I.STONE_SHOVEL,
];
