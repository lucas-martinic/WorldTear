import { createSystem } from '@iwsdk/core';
import {
  BufferGeometry,
  Group,
  Mesh,
  Object3D,
  Vector3,
} from 'three';
import { Cape, ClothState } from './cape.js';

const TICK_HZ = 60;
const FIXED_DT = 1 / TICK_HZ;
const GRAVITY: [number, number, number] = [0.0, -1.4, 0.0];
const DAMPING = 0.985;
const CONSTRAINT_ITERS = 6;
const POKE_RADIUS = 0.06;
const POKE_RADIUS_SQ = POKE_RADIUS * POKE_RADIUS;

type FingertipSource = () => Object3D | undefined;

const tmpWorld = new Vector3();
const tmpLocal = new Vector3();

export class ClothSystem extends createSystem({}) {
  private cape: Cape | null = null;
  private fingertips: FingertipSource[] = [];
  private accumulator = 0;

  attach(cape: Cape, fingertips: FingertipSource[]) {
    this.cape = cape;
    this.fingertips = fingertips;
  }

  update(delta: number) {
    if (!this.cape) return;
    const cloth = this.cape.cloth;

    const cappedDelta = Math.min(delta, 1 / 20);
    this.accumulator += cappedDelta;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 4) {
      this.simulate(cloth, FIXED_DT);
      this.applyFingertips(cloth);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === 0) return;

    this.writeBackToGeometry(cloth, this.cape.geometry);
  }

  private simulate(cloth: ClothState, dt: number) {
    const { positions, prevPositions, constraints, restLengths, pinned, pinnedRest } = cloth;
    const dt2 = dt * dt;
    const len = positions.length;

    for (let i = 0; i < len; i += 3) {
      const px = positions[i];
      const py = positions[i + 1];
      const pz = positions[i + 2];
      const vx = (px - prevPositions[i]) * DAMPING;
      const vy = (py - prevPositions[i + 1]) * DAMPING;
      const vz = (pz - prevPositions[i + 2]) * DAMPING;
      prevPositions[i] = px;
      prevPositions[i + 1] = py;
      prevPositions[i + 2] = pz;
      positions[i] = px + vx + GRAVITY[0] * dt2;
      positions[i + 1] = py + vy + GRAVITY[1] * dt2;
      positions[i + 2] = pz + vz + GRAVITY[2] * dt2;
    }

    for (let p = 0; p < pinned.length; p++) {
      const i = pinned[p] * 3;
      positions[i] = pinnedRest[p * 3];
      positions[i + 1] = pinnedRest[p * 3 + 1];
      positions[i + 2] = pinnedRest[p * 3 + 2];
    }

    const cCount = constraints.length / 2;
    for (let iter = 0; iter < CONSTRAINT_ITERS; iter++) {
      for (let c = 0; c < cCount; c++) {
        const aIdx = constraints[c * 2] * 3;
        const bIdx = constraints[c * 2 + 1] * 3;
        const ax = positions[aIdx];
        const ay = positions[aIdx + 1];
        const az = positions[aIdx + 2];
        const bx = positions[bIdx];
        const by = positions[bIdx + 1];
        const bz = positions[bIdx + 2];
        const dx = bx - ax;
        const dy = by - ay;
        const dz = bz - az;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < 1e-12) continue;
        const dist = Math.sqrt(distSq);
        const rest = restLengths[c];
        const diff = (dist - rest) / dist * 0.5;
        const ox = dx * diff;
        const oy = dy * diff;
        const oz = dz * diff;
        positions[aIdx] = ax + ox;
        positions[aIdx + 1] = ay + oy;
        positions[aIdx + 2] = az + oz;
        positions[bIdx] = bx - ox;
        positions[bIdx + 1] = by - oy;
        positions[bIdx + 2] = bz - oz;
      }

      for (let p = 0; p < pinned.length; p++) {
        const i = pinned[p] * 3;
        positions[i] = pinnedRest[p * 3];
        positions[i + 1] = pinnedRest[p * 3 + 1];
        positions[i + 2] = pinnedRest[p * 3 + 2];
      }
    }
  }

  private applyFingertips(cloth: ClothState) {
    if (this.fingertips.length === 0) return;
    if (!this.cape) return;
    const mesh = this.cape.mesh;
    mesh.updateMatrixWorld();
    const inverse = mesh.matrixWorld.clone().invert();
    const positions = cloth.positions;
    const vertCount = positions.length / 3;

    for (const get of this.fingertips) {
      const tip = get();
      if (!tip) continue;
      tip.getWorldPosition(tmpWorld);
      tmpLocal.copy(tmpWorld).applyMatrix4(inverse);
      const tx = tmpLocal.x;
      const ty = tmpLocal.y;
      const tz = tmpLocal.z;

      for (let v = 0; v < vertCount; v++) {
        const i = v * 3;
        const dx = positions[i] - tx;
        const dy = positions[i + 1] - ty;
        const dz = positions[i + 2] - tz;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > POKE_RADIUS_SQ) continue;
        const d = Math.sqrt(Math.max(dSq, 1e-8));
        const push = (POKE_RADIUS - d) / d;
        positions[i] += dx * push;
        positions[i + 1] += dy * push;
        positions[i + 2] += dz * push;
      }
    }
  }

  private writeBackToGeometry(cloth: ClothState, geometry: BufferGeometry) {
    const attr = geometry.getAttribute('position');
    (attr.array as Float32Array).set(cloth.positions);
    attr.needsUpdate = true;
    this.recomputeNormals(cloth, geometry);
  }

  private recomputeNormals(cloth: ClothState, geometry: BufferGeometry) {
    const { cols, rows, positions } = cloth;
    const normals = geometry.getAttribute('normal').array as Float32Array;
    const idx = (r: number, c: number) => (r * cols + c) * 3;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = idx(r, c);
        const lx = positions[idx(r, Math.max(0, c - 1))];
        const ly = positions[idx(r, Math.max(0, c - 1)) + 1];
        const lz = positions[idx(r, Math.max(0, c - 1)) + 2];
        const rx = positions[idx(r, Math.min(cols - 1, c + 1))];
        const ry = positions[idx(r, Math.min(cols - 1, c + 1)) + 1];
        const rz = positions[idx(r, Math.min(cols - 1, c + 1)) + 2];
        const ux = positions[idx(Math.max(0, r - 1), c)];
        const uy = positions[idx(Math.max(0, r - 1), c) + 1];
        const uz = positions[idx(Math.max(0, r - 1), c) + 2];
        const dx = positions[idx(Math.min(rows - 1, r + 1), c)];
        const dy = positions[idx(Math.min(rows - 1, r + 1), c) + 1];
        const dz = positions[idx(Math.min(rows - 1, r + 1), c) + 2];
        const ax = rx - lx;
        const ay = ry - ly;
        const az = rz - lz;
        const bx = dx - ux;
        const by = dy - uy;
        const bz = dz - uz;
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        normals[i] = nx / nLen;
        normals[i + 1] = ny / nLen;
        normals[i + 2] = nz / nLen;
      }
    }
    (geometry.getAttribute('normal') as { needsUpdate: boolean }).needsUpdate = true;
  }
}

export function makeFingertipSource(group: Group | undefined): FingertipSource {
  return () => group;
}
