// 플레이어 물리: AABB 충돌, 중력, 점프, 수영, 웅크리기(모서리 멈춤), 비행, 낙하 데미지, 익사
import * as THREE from 'three';
import { B, isSolid } from './blocks.js';

const HALF = 0.3, HEIGHT = 1.8, EYE = 1.62, SNEAK_EYE = 1.27;
const GRAVITY = 32, JUMP_V = 9.0;
const WALK = 4.317, SPRINT = 5.612, SNEAK = 1.31, FLY = 10.9, FLY_SPRINT = 21.6;

export class Player {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false; this.flying = false; this.inWater = false; this.headInWater = false;
    this.health = 20; this.air = 300; // 원본: 공기 300틱(15초)
    this.fallPeak = null; this.regenTimer = 0; this.drownTimer = 0; this.voidTimer = 0;
    this.sneaking = false; this.sprinting = false;
    this.lastJumpTap = 0; this.bob = 0;
  }
  eyeHeight() { return this.sneaking && !this.flying ? SNEAK_EYE : EYE; }
  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.eyeHeight(), this.pos.z); }

  hits(world, px, py, pz) {
    const x0 = Math.floor(px - HALF), x1 = Math.floor(px + HALF - 1e-7);
    const y0 = Math.floor(py), y1 = Math.floor(py + HEIGHT - 1e-7);
    const z0 = Math.floor(pz - HALF), z1 = Math.floor(pz + HALF - 1e-7);
    let res = null;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (isSolid(world.getBlock(x, y, z))) {
        if (!res) res = { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z };
        else { res.minX = Math.min(res.minX, x); res.maxX = Math.max(res.maxX, x); res.minY = Math.min(res.minY, y); res.maxY = Math.max(res.maxY, y); res.minZ = Math.min(res.minZ, z); res.maxZ = Math.max(res.maxZ, z); }
      }
    }
    return res;
  }
  // 플레이어 몸이 특정 블록 칸과 겹치는지 (블록 설치 금지 판정용)
  intersectsBlock(x, y, z) {
    const p = this.pos;
    return p.x + HALF > x && p.x - HALF < x + 1 && p.y + HEIGHT > y && p.y < y + 1 && p.z + HALF > z && p.z - HALF < z + 1;
  }

  moveAxis(world, axis, delta) {
    if (!delta) return false;
    const steps = Math.ceil(Math.abs(delta) / 0.35); const d = delta / steps; const p = this.pos;
    for (let s = 0; s < steps; s++) {
      p[axis] += d;
      const h = this.hits(world, p.x, p.y, p.z);
      if (h) {
        if (axis === 'y') p.y = d > 0 ? h.minY - HEIGHT - 1e-4 : h.maxY + 1 + 1e-4;
        else if (axis === 'x') p.x = d > 0 ? h.minX - HALF - 1e-4 : h.maxX + 1 + HALF + 1e-4;
        else p.z = d > 0 ? h.minZ - HALF - 1e-4 : h.maxZ + 1 + HALF + 1e-4;
        return true;
      }
    }
    return false;
  }

  update(dt, input, world, mode, now) {
    const events = { damage: 0, landed: false, splash: false };
    const creative = mode === 'creative';
    const feet = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.3), Math.floor(this.pos.z));
    const wasInWater = this.inWater;
    this.inWater = feet === B.WATER;
    if (this.inWater && !wasInWater && this.vel.y < -6) events.splash = true;
    const eyeId = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + this.eyeHeight()), Math.floor(this.pos.z));
    this.headInWater = eyeId === B.WATER;

    // 크리에이티브: 스페이스 두 번 → 비행 토글
    if (input.jumpPressed && creative) {
      if (now - this.lastJumpTap < 300) { this.flying = !this.flying; this.vel.y = 0; this.lastJumpTap = 0; }
      else this.lastJumpTap = now;
    }
    if (!creative) this.flying = false;

    this.sneaking = !!input.sneak && !this.flying;
    const moving = input.f || input.b || input.l || input.r;
    if (input.sprint && input.f && !this.sneaking) this.sprinting = true;
    if (!input.f || this.sneaking) this.sprinting = false;

    // 원하는 수평 이동 방향
    let fx = 0, fz = 0;
    if (input.f) fz -= 1; if (input.b) fz += 1; if (input.l) fx -= 1; if (input.r) fx += 1;
    const len = Math.hypot(fx, fz) || 1; fx /= len; fz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin, wz = -fx * sin + fz * cos;
    let speed = this.flying ? (this.sprinting ? FLY_SPRINT : FLY) : this.sneaking ? SNEAK : this.sprinting ? SPRINT : WALK;
    if (this.inWater && !this.flying) speed *= 0.45;
    const accel = this.flying ? 10 : this.onGround ? 18 : this.inWater ? 6 : 3.2;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;

    // 수직 이동
    if (this.flying) {
      let vy = 0; if (input.jump) vy += 7.5; if (input.sneak) vy -= 7.5;
      this.vel.y += (vy - this.vel.y) * (1 - Math.exp(-12 * dt));
    } else if (this.inWater) {
      this.vel.y -= 9 * dt;
      if (input.jump) this.vel.y = Math.min(this.vel.y + 26 * dt, 3.2);
      this.vel.y = Math.max(this.vel.y, -3.5);
      this.vel.y *= Math.exp(-1.5 * dt);
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.vel.y < -78) this.vel.y = -78;
      if (input.jump && this.onGround) {
        this.vel.y = JUMP_V; this.onGround = false;
        if (this.sprinting) { this.vel.x += -sin * 2; this.vel.z += -cos * 2; } // 달리며 점프 가속
      }
    }

    // 웅크리기: 모서리에서 떨어지지 않음
    let dx = this.vel.x * dt, dz = this.vel.z * dt;
    if (this.sneaking && this.onGround) {
      const p = this.pos;
      if (dx && !this.hits(world, p.x + dx, p.y - 0.6, p.z)) dx = 0;
      if (dz && !this.hits(world, p.x + dx, p.y - 0.6, p.z + dz)) dz = 0;
    }
    if (this.moveAxis(world, 'x', dx)) this.vel.x = 0;
    if (this.moveAxis(world, 'z', dz)) this.vel.z = 0;
    const vyBefore = this.vel.y;
    const hitY = this.moveAxis(world, 'y', this.vel.y * dt);
    const wasOnGround = this.onGround;
    this.onGround = hitY && vyBefore < 0;
    if (hitY) this.vel.y = 0;
    if (this.onGround && this.flying && creative) this.flying = false;

    // 낙하 데미지 (원본: 3블록 초과 낙하 시 1칸당 1데미지)
    if (this.onGround || this.inWater || this.flying) {
      if (this.onGround && !wasOnGround && this.fallPeak !== null) {
        const dist = this.fallPeak - this.pos.y;
        events.landed = dist > 0.5;
        if (!creative && !this.inWater && feet !== B.WATER) {
          const dmg = Math.floor(dist - 3);
          if (dmg > 0) events.damage += dmg;
        }
      }
      this.fallPeak = null;
    } else {
      this.fallPeak = this.fallPeak === null ? this.pos.y : Math.max(this.fallPeak, this.pos.y);
    }

    if (!creative) {
      // 익사
      if (this.headInWater) {
        this.air = Math.max(-20, this.air - 20 * dt);
        if (this.air <= 0) { this.drownTimer += dt; if (this.drownTimer >= 1) { this.drownTimer = 0; events.damage += 2; } }
      } else { this.air = Math.min(300, this.air + 100 * dt); this.drownTimer = 0; }
      // 자연 회복 (원본은 배고픔 수치 필요 — 배고픔 미구현이라 항상 회복)
      if (this.health < 20 && this.health > 0) { this.regenTimer += dt; if (this.regenTimer >= 4) { this.regenTimer = 0; this.health = Math.min(20, this.health + 1); } }
    } else { this.air = 300; }
    // 공허
    if (this.pos.y < -30) { this.voidTimer += dt; if (this.voidTimer > 0.5) { this.voidTimer = 0; events.damage += 4; } }

    if (moving && this.onGround) this.bob += dt * (this.sprinting ? 13 : 10); else this.bob *= 0.9;
    return events;
  }
}
