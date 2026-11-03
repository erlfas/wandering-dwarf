import * as THREE from 'three';
import { WorldConfig } from './Config';
import { createTreeMaterial, loadPineTreeModel } from './ForestField';
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

  private chunks = new Map<string, TerrainChunk>();
  private buildQueue: PendingChunkRequest[] = [];
  private config: WorldConfig;
  private noise: TerrainNoise;
  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;

  constructor(config: WorldConfig, noise: TerrainNoise) {
    this.config = config;
    this.noise = noise;

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
    loadGrassClumpModel(this.grassUniforms);
  }

  private getKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
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
    let built = 0;

    while (this.buildQueue.length > 0 && built < budget) {
      const req = this.buildQueue.shift()!;
      const key = this.getKey(req.cx, req.cz);
      const existing = this.chunks.get(key);

      const wantGrass =
        req.grassDensityMult > 0 &&
        this.config.enableGrassBlades &&
        !this.config.blankClayMode;
      if (existing) {
        if (existing.segments === req.segments && existing.hasGrass === wantGrass) {
          continue;
        }
        this.group.remove(existing.mesh);
        existing.dispose();
        this.chunks.delete(key);
      }

      const chunk = new TerrainChunk(
        req.cx,
        req.cz,
        size,
        req.segments,
        req.grassDensityMult,
        this.config,
        this.noise,
        this.material,
        this.grassMaterial,
        this.flowerMaterial,
        this.treeMaterial,
        this.waterMaterial
      );
      this.chunks.set(key, chunk);
      this.group.add(chunk.mesh);
      built++;
    }
  }

  private refreshQueue(centerCx: number, centerCz: number): void {
    const r = this.config.renderRadius;
    const desiredKeys = new Set<string>();
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
        const wantGrass = grassDensityMult > 0;
        const existing = this.chunks.get(key);

        if (
          !existing ||
          existing.segments !== segments ||
          existing.hasGrass !== wantGrass
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

    requests.sort((a, b) => a.distSq - b.distSq);
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
    this.update(worldX, worldY, worldZ, this.grassUniforms.uTime.value, true);
  }

  public setBordersVisible(visible: boolean): void {
    for (const chunk of this.chunks.values()) {
      chunk.setBorderVisible(visible, this.noise);
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
    const exactNoiseY = this.noise.getHeight(worldX, worldZ);
    const size = this.config.chunkSize;
    const cx = Math.round(worldX / size);
    const cz = Math.round(worldZ / size);
    const chunk = this.chunks.get(this.getKey(cx, cz));
    const segments = chunk ? chunk.segments : 64;

    const step = size / segments;
    const half = size * 0.5;
    const localX = worldX - cx * size + half;
    const localZ = worldZ - cz * size + half;

    const gx = Math.floor(localX / step);
    const gz = Math.floor(localZ / step);
    const fx = THREE.MathUtils.clamp((localX - gx * step) / step, 0, 1);
    const fz = THREE.MathUtils.clamp((localZ - gz * step) / step, 0, 1);

    const x0 = cx * size - half + gx * step;
    const z0 = cz * size - half + gz * step;
    const x1 = x0 + step;
    const z1 = z0 + step;

    const h00 = this.noise.getHeight(x0, z0);
    const h10 = this.noise.getHeight(x1, z0);
    const h01 = this.noise.getHeight(x0, z1);
    const h11 = this.noise.getHeight(x1, z1);

    // PlaneGeometry splits each quad from top-right (1,0) to bottom-left (0,1)
    let triY: number;
    if (fx + fz <= 1.0) {
      triY = h00 + fx * (h10 - h00) + fz * (h01 - h00);
    } else {
      triY = h11 + (1.0 - fx) * (h01 - h11) + (1.0 - fz) * (h10 - h11);
    }

    return Math.max(exactNoiseY, triY);
  }
}
