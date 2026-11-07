import * as THREE from 'three';
import { WorldConfig } from './Config';
import {
  createTreeMaterial,
  HutPlacement,
  loadDwarvenHutModel,
  loadOakTreeModel,
  loadPineTreeModel,
} from './ForestField';
import { createGrassMaterial, GrassUniforms, loadGrassClumpModel } from './GrassField';
import { TerrainChunk } from './TerrainChunk';
import { TerrainNoise } from './TerrainNoise';
import { createWaterMaterial, WaterUniforms } from './WaterMesh';

interface PendingChunkRequest {
  cx: number;
  cz: number;
  segments: number;
  grassDensityMult: number;
  distSq: number;
  dist: number;
}

export class ChunkManager {
  public readonly group = new THREE.Group();
  public readonly material: THREE.MeshStandardMaterial;
  public readonly grassUniforms: GrassUniforms;
  public readonly waterUniforms: WaterUniforms;
  public readonly waterMaterial: THREE.MeshStandardMaterial;
  private readonly grassMaterial: THREE.MeshStandardMaterial;
  private readonly flowerMaterial: THREE.MeshStandardMaterial;
  private readonly treeMaterial: THREE.MeshStandardMaterial;

  private chunks = new Map<number, TerrainChunk>();
  private desiredKeys = new Set<number>();
  private buildQueue: PendingChunkRequest[] = [];
  private config: WorldConfig;
  private noise: TerrainNoise;
  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;

  constructor(config: WorldConfig, noise: TerrainNoise) {
    this.config = config;
    this.noise = noise;
    this.group.matrixAutoUpdate = false;

    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: config.clayRoughness,
      metalness: 0.02,
      wireframe: config.wireframe,
      flatShading: false,
    });

    this.grassUniforms = {
      uTime: { value: 0 },
      uWindSpeed: { value: config.windSpeed },
      uWindStrength: { value: config.windStrength },
      uPlayerPos: { value: new THREE.Vector3() },
      uMaxDistance: { value: config.grassRadiusChunks * config.chunkSize },
    };

    this.grassMaterial = createGrassMaterial(this.grassUniforms, false);
    this.flowerMaterial = createGrassMaterial(this.grassUniforms, true);
    this.treeMaterial = createTreeMaterial(this.grassUniforms);
    const waterSetup = createWaterMaterial(this.grassUniforms, config.waterLevel);
    this.waterMaterial = waterSetup.material;
    this.waterUniforms = waterSetup.waterUniforms;
    loadPineTreeModel(this.grassUniforms);
    loadOakTreeModel(this.grassUniforms);
    loadDwarvenHutModel();
    loadGrassClumpModel(this.grassUniforms);
  }

  private getKey(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  private getSegmentsForDistance(dist: number): number {
    if (dist <= 2.2) return 64;
    if (dist <= 4.2) return 32;
    return 16;
  }

  private getGrassDensityForDistance(dist: number): number {
    if (!this.config.enableGrassBlades || this.config.blankClayMode) return 0;
    if (dist > this.config.grassRadiusChunks) return 0;
    const wantCloseClumps = dist <= 1.05;
    if (wantCloseClumps) return 1.0;
    return 0.55;
  }

  public update(
    worldX: number,
    worldY: number,
    worldZ: number,
    elapsedTime: number,
    immediate = false
  ): void {
    this.grassUniforms.uTime.value = elapsedTime;
    this.grassUniforms.uWindSpeed.value = this.config.windSpeed;
    this.grassUniforms.uWindStrength.value = this.config.windStrength;
    this.grassUniforms.uPlayerPos.value.set(worldX, worldY, worldZ);
    this.grassUniforms.uMaxDistance.value =
      this.config.grassRadiusChunks * this.config.chunkSize;

    const size = this.config.chunkSize;
    const centerCx = Math.round(worldX / size);
    const centerCz = Math.round(worldZ / size);

    if (centerCx !== this.lastCenterCx || centerCz !== this.lastCenterCz || immediate) {
      this.lastCenterCx = centerCx;
      this.lastCenterCz = centerCz;
      this.refreshQueue(centerCx, centerCz);
    }

    const budget = immediate ? this.buildQueue.length : this.config.maxChunksPerFrame;
    const frameStart = performance.now();
    let built = 0;

    while (this.buildQueue.length > 0 && built < budget) {
      if (immediate) {
        const nextReq = this.buildQueue[this.buildQueue.length - 1];
        // On immediate startup/rebuild, synchronously build the inner ring (dist <= 2.2)
        // so the player's surroundings are ready immediately, and stream outer rings smoothly
        if (nextReq.distSq > 2.25 * 2.25 && built > 0) {
          break;
        }
      } else if (built > 0 && performance.now() - frameStart > 4.5) {
        break;
      }

      const req = this.buildQueue.pop()!;
      const key = this.getKey(req.cx, req.cz);
      const existing = this.chunks.get(key);
      const dist = req.dist;

      const effectiveGrassMult =
        this.config.enableGrassBlades && !this.config.blankClayMode
          ? req.grassDensityMult
          : 0;

      if (existing) {
        if (existing.segments !== req.segments) {
          existing.updateSegments(
            req.segments,
            this.config,
            this.noise,
            this.waterMaterial
          );
          built++;
          if (
            !immediate &&
            Math.abs(existing.grassDensityMult - effectiveGrassMult) > 0.01 &&
            !existing.hasGrassInstance() &&
            effectiveGrassMult > 0 &&
            performance.now() - frameStart > 3.0
          ) {
            existing.updateForestLOD(dist);
            this.buildQueue.push(req);
            break;
          }
        }
        existing.updateForestLOD(dist);
        if (Math.abs(existing.grassDensityMult - effectiveGrassMult) > 0.01) {
          const hadGrassObj = existing.hasGrassInstance();
          existing.updateGrass(
            effectiveGrassMult,
            this.config,
            this.noise,
            this.grassMaterial,
            this.flowerMaterial
          );
          if (!hadGrassObj && existing.hasGrassInstance()) {
            built++;
          }
        }
        continue;
      }

      const chunk = new TerrainChunk(
        req.cx,
        req.cz,
        size,
        req.segments,
        effectiveGrassMult,
        this.config,
        this.noise,
        this.material,
        this.grassMaterial,
        this.flowerMaterial,
        this.treeMaterial,
        this.waterMaterial,
        dist
      );
      this.chunks.set(key, chunk);
      this.group.add(chunk.mesh);
      built++;
    }
  }

  private refreshQueue(centerCx: number, centerCz: number): void {
    const r = this.config.renderRadius;
    const desiredKeys = this.desiredKeys;
    desiredKeys.clear();
    const requests = this.buildQueue;
    requests.length = 0;

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const distSq = dx * dx + dz * dz;
        if (distSq > (r + 0.5) * (r + 0.5)) continue;

        const cx = centerCx + dx;
        const cz = centerCz + dz;
        const key = this.getKey(cx, cz);
        desiredKeys.add(key);

        const dist = Math.sqrt(distSq);
        const segments = this.getSegmentsForDistance(dist);
        const grassDensityMult = this.getGrassDensityForDistance(dist);
        const existing = this.chunks.get(key);

        if (existing) {
          existing.updateForestLOD(dist);
          if (
            existing.segments === segments &&
            Math.abs(existing.grassDensityMult - grassDensityMult) > 0.01 &&
            existing.hasGrassInstance()
          ) {
            // Instant O(1) grass count scaling without queueing
            existing.updateGrass(
              grassDensityMult,
              this.config,
              this.noise,
              this.grassMaterial,
              this.flowerMaterial
            );
            existing.releaseGrassIfFar(dist, this.config.grassRadiusChunks);
            continue;
          }
          existing.releaseGrassIfFar(dist, this.config.grassRadiusChunks);
        }

        if (
          !existing ||
          existing.segments !== segments ||
          Math.abs(existing.grassDensityMult - grassDensityMult) > 0.01
        ) {
          requests.push({ cx, cz, segments, grassDensityMult, distSq, dist });
        }
      }
    }

    for (const [key, chunk] of this.chunks.entries()) {
      if (!desiredKeys.has(key)) {
        this.group.remove(chunk.mesh);
        chunk.dispose();
        this.chunks.delete(key);
      }
    }

    // Sort descending so buildQueue.pop() processes closest chunks first in O(1)
    requests.sort((a, b) => b.distSq - a.distSq);
  }

  public rebuildAll(worldX: number, worldY: number, worldZ: number): void {
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.mesh);
      chunk.dispose();
    }
    this.chunks.clear();
    this.buildQueue.length = 0;
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
    this.update(worldX, worldY, worldZ, this.grassUniforms.uTime.value, true);
  }

  public rebuildGrassOnly(worldX: number, worldZ: number): void {
    const size = this.config.chunkSize;
    const centerCx = Math.round(worldX / size);
    const centerCz = Math.round(worldZ / size);
    for (const chunk of this.chunks.values()) {
      const dx = chunk.cx - centerCx;
      const dz = chunk.cz - centerCz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const mult = this.getGrassDensityForDistance(dist);
      chunk.rebuildGrass(
        mult,
        this.config,
        this.noise,
        this.grassMaterial,
        this.flowerMaterial
      );
    }
  }

  public rebuildForestOnly(worldX: number, worldZ: number): void {
    const size = this.config.chunkSize;
    const centerCx = Math.round(worldX / size);
    const centerCz = Math.round(worldZ / size);
    for (const chunk of this.chunks.values()) {
      const dx = chunk.cx - centerCx;
      const dz = chunk.cz - centerCz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      chunk.rebuildForest(this.config, this.noise, this.treeMaterial, dist);
    }
  }

  public setBordersVisible(visible: boolean): void {
    for (const chunk of this.chunks.values()) {
      chunk.setBorderVisible(visible);
    }
  }

  public getActiveChunkCount(): number {
    return this.chunks.size;
  }

  public getHutsInChunk(cx: number, cz: number): readonly HutPlacement[] {
    const chunk = this.chunks.get(this.getKey(cx, cz));
    return chunk ? chunk.getHuts() : [];
  }

  public forEachLoadedHut(cb: (hut: HutPlacement) => void): void {
    for (const chunk of this.chunks.values()) {
      const huts = chunk.getHuts();
      for (let i = 0; i < huts.length; i++) {
        cb(huts[i]);
      }
    }
  }

  /**
   * Computes the exact triangle-interpolated height of the rendered chunk mesh at (worldX, worldZ)
   * so the dwarf's boots never clip or sink underneath terrain triangles on concave slopes.
   */
  public getSurfaceHeight(worldX: number, worldZ: number): number {
    const size = this.config.chunkSize;
    const cx = Math.round(worldX / size);
    const cz = Math.round(worldZ / size);
    const chunk = this.chunks.get(this.getKey(cx, cz));

    if (!chunk) {
      return this.noise.getHeight(worldX, worldZ);
    }

    const segments = chunk.segments;
    const invStep = segments / size;
    const half = size * 0.5;
    const localX = worldX - cx * size + half;
    const localZ = worldZ - cz * size + half;

    const u = THREE.MathUtils.clamp(localX * invStep, 0, segments - 0.0001);
    const v = THREE.MathUtils.clamp(localZ * invStep, 0, segments - 0.0001);
    const gx = u | 0;
    const gz = v | 0;
    const fx = u - gx;
    const fz = v - gz;

    const stride = segments + 1;
    const posArr = (chunk.mesh.geometry.attributes.position as THREE.BufferAttribute)
      .array as Float32Array;
    const row0 = gz * stride + gx;
    const row1 = row0 + stride;

    const h00 = posArr[row0 * 3 + 1];
    const h10 = posArr[(row0 + 1) * 3 + 1];
    const h01 = posArr[row1 * 3 + 1];
    const h11 = posArr[(row1 + 1) * 3 + 1];

    // PlaneGeometry splits each quad from top-right (1,0) to bottom-left (0,1)
    if (fx + fz <= 1.0) {
      return h00 + fx * (h10 - h00) + fz * (h01 - h00);
    } else {
      return h11 + (1.0 - fx) * (h01 - h11) + (1.0 - fz) * (h10 - h11);
    }
  }

  /**
   * Samples the continuous surface normal from the loaded chunk mesh (or falls back to analytical noise).
   */
  public getSurfaceNormal(
    worldX: number,
    worldZ: number,
    target = new THREE.Vector3()
  ): THREE.Vector3 {
    const size = this.config.chunkSize;
    const cx = Math.round(worldX / size);
    const cz = Math.round(worldZ / size);
    const chunk = this.chunks.get(this.getKey(cx, cz));

    if (!chunk) {
      return this.noise.getNormal(worldX, worldZ, target);
    }

    const localX = worldX - cx * size;
    const localZ = worldZ - cz * size;
    chunk.sampleHeightAndNormal(localX, localZ, target);
    return target;
  }

  /**
   * Resolves 2D circle-circle collisions between the player (radius `playerRadius`) and nearby
   * trees, dwarven huts, and shoreline boulders in O(1) time with zero heap allocations.
   */
  public resolveObstacleCollision(pos: THREE.Vector3, playerRadius = 0.38): void {
    if (this.config.blankClayMode || !this.config.enableTrees) return;

    const size = this.config.chunkSize;
    const centerCx = Math.round(pos.x / size);
    const centerCz = Math.round(pos.z / size);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = this.chunks.get(this.getKey(centerCx + dx, centerCz + dz));
        if (!chunk) continue;
        const colliders = chunk.getColliders();
        if (!colliders || colliders.length === 0) continue;

        for (let i = 0; i < colliders.length; i += 3) {
          const ox = colliders[i];
          const oz = colliders[i + 1];
          const minDist = colliders[i + 2] + playerRadius;

          const diffX = pos.x - ox;
          const diffZ = pos.z - oz;
          const distSq = diffX * diffX + diffZ * diffZ;

          if (distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq);
            if (dist > 0.0001) {
              const push = (minDist - dist) / dist;
              pos.x += diffX * push;
              pos.z += diffZ * push;
            } else {
              pos.x += minDist;
            }
          }
        }
      }
    }
  }

  /**
   * Pushes a world position `(pos.x, pos.z)` clear of any Dwarven Hut (both its body and front
   * doorway ring) and any tree/boulder colliders in the 3x3 chunk neighborhood.
   * Returns `true` if `pos` was moved.
   */
  public resolveStructureClearance(
    pos: THREE.Vector3,
    minHutClearance = 9.5,
    minTreeClearance = 2.6
  ): boolean {
    const size = this.config.chunkSize;
    const centerCx = Math.round(pos.x / size);
    const centerCz = Math.round(pos.z / size);
    let moved = false;

    for (let pass = 0; pass < 2; pass++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const chunk = this.chunks.get(this.getKey(centerCx + dx, centerCz + dz));
          if (!chunk) continue;

          // 1. Keep well clear of Dwarven Huts and their front doorway rings
          const huts = chunk.getHuts();
          for (let i = 0; i < huts.length; i++) {
            const h = huts[i];
            const diffX = pos.x - h.worldX;
            const diffZ = pos.z - h.worldZ;
            const distSq = diffX * diffX + diffZ * diffZ;
            if (distSq < minHutClearance * minHutClearance) {
              const dist = Math.sqrt(distSq);
              if (dist > 0.001) {
                const push = (minHutClearance - dist) / dist;
                pos.x += diffX * push;
                pos.z += diffZ * push;
              } else {
                // Push perpendicular to the hut doorway so we don't block the entrance
                pos.x += Math.cos(h.rotationY) * minHutClearance;
                pos.z -= Math.sin(h.rotationY) * minHutClearance;
              }
              moved = true;
            }

            const doorClearance = Math.max(5.5, minHutClearance * 0.75);
            const dDiffX = pos.x - h.doorWorldX;
            const dDiffZ = pos.z - h.doorWorldZ;
            const dDistSq = dDiffX * dDiffX + dDiffZ * dDiffZ;
            if (dDistSq < doorClearance * doorClearance) {
              const dDist = Math.sqrt(dDistSq);
              if (dDist > 0.001) {
                const push = (doorClearance - dDist) / dDist;
                pos.x += dDiffX * push;
                pos.z += dDiffZ * push;
              } else {
                pos.x += Math.cos(h.rotationY) * doorClearance;
                pos.z -= Math.sin(h.rotationY) * doorClearance;
              }
              moved = true;
            }
          }

          // 2. Keep clear of tree trunks and boulders
          if (minTreeClearance > 0) {
            const colliders = chunk.getColliders();
            if (!colliders || colliders.length === 0) continue;
            for (let i = 0; i < colliders.length; i += 3) {
              const ox = colliders[i];
              const oz = colliders[i + 1];
              const minDist = colliders[i + 2] + minTreeClearance;
              const diffX = pos.x - ox;
              const diffZ = pos.z - oz;
              const distSq = diffX * diffX + diffZ * diffZ;
              if (distSq < minDist * minDist) {
                const dist = Math.sqrt(distSq);
                if (dist > 0.0001) {
                  const push = (minDist - dist) / dist;
                  pos.x += diffX * push;
                  pos.z += diffZ * push;
                } else {
                  pos.x += minDist;
                }
                moved = true;
              }
            }
          }
        }
      }
    }

    return moved;
  }
}
