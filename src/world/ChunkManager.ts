import * as THREE from 'three';
import { WorldConfig } from './Config';
import {
  createTreeMaterial,
  loadDwarvenHutModel,
  loadOakTreeModel,
  loadPineTreeModel,
} from './ForestField';
import { createGrassMaterial, GrassUniforms, loadGrassClumpModel } from './GrassField';
import { TerrainChunk } from './TerrainChunk';
import { TerrainNoise } from './TerrainNoise';
import { createWaterMaterial } from './WaterMesh';

interface PendingChunkRequest {
  cx: number;
  cz: number;
  segments: number;
  grassDensityMult: number;
  distSq: number;
}

export class ChunkManager {
  public readonly group = new THREE.Group();
  public readonly material: THREE.MeshStandardMaterial;
  public readonly grassUniforms: GrassUniforms;
  private readonly grassMaterial: THREE.MeshStandardMaterial;
  private readonly flowerMaterial: THREE.MeshStandardMaterial;
  private readonly treeMaterial: THREE.MeshStandardMaterial;
  private readonly waterMaterial: THREE.MeshStandardMaterial;

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
    this.waterMaterial = createWaterMaterial(this.grassUniforms);
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
    return 20;
  }

  private getGrassDensityForDistance(dist: number): number {
    if (!this.config.enableGrassBlades || this.config.blankClayMode) return 0;
    if (dist > this.config.grassRadiusChunks) return 0;
    if (dist <= 1.5) return 1.0;
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
      if (!immediate && built > 0 && performance.now() - frameStart > 4.5) {
        break;
      }

      const req = this.buildQueue.pop()!;
      const key = this.getKey(req.cx, req.cz);
      const existing = this.chunks.get(key);
      const dist = Math.sqrt(req.distSq);

      const effectiveGrassMult =
        this.config.enableGrassBlades && !this.config.blankClayMode
          ? req.grassDensityMult
          : 0;

      if (existing) {
        if (existing.segments !== req.segments) {
          existing.updateSegments(req.segments, this.config, this.noise);
          built++;
        }
        existing.updateForestLOD(dist);
        if (Math.abs(existing.grassDensityMult - effectiveGrassMult) > 0.01) {
          const hadGrassObj = existing.hasGrass;
          existing.updateGrass(
            effectiveGrassMult,
            this.config,
            this.noise,
            this.grassMaterial,
            this.flowerMaterial
          );
          if (!hadGrassObj && existing.hasGrass) {
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
    const requests: PendingChunkRequest[] = [];

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
            existing.hasGrass
          ) {
            // Instant O(1) grass count scaling without queueing
            existing.updateGrass(
              grassDensityMult,
              this.config,
              this.noise,
              this.grassMaterial,
              this.flowerMaterial
            );
            continue;
          }
        }

        if (
          !existing ||
          existing.segments !== segments ||
          Math.abs(existing.grassDensityMult - grassDensityMult) > 0.01
        ) {
          requests.push({ cx, cz, segments, grassDensityMult, distSq });
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
    this.buildQueue = requests;
  }

  public rebuildAll(worldX: number, worldY: number, worldZ: number): void {
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.mesh);
      chunk.dispose();
    }
    this.chunks.clear();
    this.buildQueue = [];
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
    this.update(worldX, worldY, worldZ, this.grassUniforms.uTime.value, false);
  }

  public setBordersVisible(visible: boolean): void {
    for (const chunk of this.chunks.values()) {
      chunk.setBorderVisible(visible);
    }
  }

  public getActiveChunkCount(): number {
    return this.chunks.size;
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
    const step = size / segments;
    const half = size * 0.5;
    const localX = worldX - cx * size + half;
    const localZ = worldZ - cz * size + half;

    const gx = THREE.MathUtils.clamp(Math.floor(localX / step), 0, segments - 1);
    const gz = THREE.MathUtils.clamp(Math.floor(localZ / step), 0, segments - 1);
    const fx = THREE.MathUtils.clamp((localX - gx * step) / step, 0, 1);
    const fz = THREE.MathUtils.clamp((localZ - gz * step) / step, 0, 1);

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
}
