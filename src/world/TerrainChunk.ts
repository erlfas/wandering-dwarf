import * as THREE from 'three';
import { WorldConfig } from './Config';
import { ChunkForest, HutPlacement } from './ForestField';
import { ChunkGrass, ChunkSurfaceSampler } from './GrassField';
import { TerrainNoise } from './TerrainNoise';

declare module './GrassField' {
  interface ChunkSurfaceSampler {
    sampleBiome?(
      localX: number,
      localZ: number,
      out: { forest: number; meadow: number; tallGrass: number }
    ): void;
  }
}

let sharedWaterGeoNear: THREE.BufferGeometry | null = null;
let sharedWaterGeoFar: THREE.BufferGeometry | null = null;

function getSharedWaterGeometry(segments: number): THREE.BufferGeometry {
  if (segments === 64) {
    if (!sharedWaterGeoNear) {
      sharedWaterGeoNear = new THREE.PlaneGeometry(1, 1, 24, 24);
      sharedWaterGeoNear.rotateX(-Math.PI / 2);
      sharedWaterGeoNear.computeBoundingBox();
      sharedWaterGeoNear.computeBoundingSphere();
    }
    return sharedWaterGeoNear;
  }
  if (!sharedWaterGeoFar) {
    sharedWaterGeoFar = new THREE.PlaneGeometry(1, 1, 4, 4);
    sharedWaterGeoFar.rotateX(-Math.PI / 2);
    sharedWaterGeoFar.computeBoundingBox();
    sharedWaterGeoFar.computeBoundingSphere();
  }
  return sharedWaterGeoFar;
}

function getForestTier(dist: number): number {
  if (dist <= 1.5) return 0;
  if (dist <= 2.2) return 1;
  if (dist <= 2.6) return 2;
  if (dist <= 4.2) return 3;
  return 4;
}

const BIOME_SEGMENTS = 16;
const BIOME_STRIDE = BIOME_SEGMENTS + 1; // 17x17 coarse biome grid per chunk

const sharedBorderMaterial = new THREE.LineBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.45,
});

const geometryPool = new Map<number, THREE.BufferGeometry[]>();

// Reusable module-level buffers & temporaries for zero-allocation chunk building
let paddedHeights = new Float32Array(67 * 67);
let paddedTrackWeights = new Float32Array(67 * 67);
const tempNormal = new THREE.Vector3();
const tempColor = new THREE.Color();
const clayColor = new THREE.Color(0xdcd6cc);
const tempBiome = { forest: 0, meadow: 0, tallGrass: 0 };

export class TerrainChunk implements ChunkSurfaceSampler {
  public readonly cx: number;
  public readonly cz: number;
  public readonly size: number;
  public segments: number;
  public hasGrass: boolean;
  public grassDensityMult: number;
  public readonly mesh: THREE.Mesh;
  private minElevation = Infinity;
  private maxElevation = -Infinity;
  private maxTrackWeight = 0;
  private waterMinX = Infinity;
  private waterMaxX = -Infinity;
  private waterMinZ = Infinity;
  private waterMaxZ = -Infinity;
  private lastForestTier = -1;
  private biomeGridPopulated = false;
  private tallGrassPopulated = false;
  private readonly biomeGrid = new Float32Array(BIOME_STRIDE * BIOME_STRIDE * 3);
  private borderLine?: THREE.LineSegments;
  private chunkGrass?: ChunkGrass;
  private chunkForest?: ChunkForest;
  private waterMesh?: THREE.Mesh;

  constructor(
    cx: number,
    cz: number,
    size: number,
    segments: number,
    grassDensityMult: number,
    config: WorldConfig,
    noise: TerrainNoise,
    terrainMaterial: THREE.Material,
    grassMaterial: THREE.Material,
    flowerMaterial: THREE.Material,
    treeMaterial: THREE.Material,
    waterMaterial: THREE.Material,
    dist = 0
  ) {
    this.cx = cx;
    this.cz = cz;
    this.size = size;
    this.segments = segments;
    this.grassDensityMult =
      config.enableGrassBlades && !config.blankClayMode ? grassDensityMult : 0;
    this.hasGrass = this.grassDensityMult > 0;

    this.populateBiomeGrid(noise, this.hasGrass);
    const geometry = this.buildGeometry(noise, config.blankClayMode, config.waterLevel);
    this.mesh = new THREE.Mesh(geometry, terrainMaterial);
    this.mesh.position.set(cx * size, 0, cz * size);
    this.mesh.updateMatrix();
    this.mesh.matrixAutoUpdate = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;

    // 1. Add Water Surface Plane fitted to tight sub-chunk wet bounding box
    this.updateWaterMesh(config, waterMaterial);

    // 2. Add 3D Grass & Wildflowers on near/mid chunks
    if (this.hasGrass) {
      this.chunkGrass = new ChunkGrass(
        cx,
        cz,
        size,
        this.grassDensityMult,
        config,
        noise,
        grassMaterial,
        flowerMaterial,
        this
      );
      this.mesh.add(this.chunkGrass.group);
    }

    // 3. Add Forest Groves, Track Details & Shoreline Boulders across visible chunks
    if ((config.enableTrees || config.enableTracks) && !config.blankClayMode) {
      const isNearLOD = dist <= 1.5;
      const castShadow = dist <= 2.2;
      this.lastForestTier = getForestTier(dist);
      this.chunkForest = new ChunkForest(
        cx,
        cz,
        size,
        config,
        noise,
        treeMaterial,
        isNearLOD,
        castShadow,
        this,
        dist
      );
      this.mesh.add(this.chunkForest.group);
    }

    if (config.showChunkBorders) {
      this.setBorderVisible(true);
    }
    this.mesh.updateMatrixWorld(true);
  }

  private populateBiomeGrid(noise: TerrainNoise, needTallGrass = this.hasGrass): void {
    const needBase = !this.biomeGridPopulated;
    const needTall = needTallGrass && !this.tallGrassPopulated;
    if (!needBase && !needTall) return;

    const half = this.size * 0.5;
    const step = this.size / BIOME_SEGMENTS;
    const worldOffsetX = this.cx * this.size;
    const worldOffsetZ = this.cz * this.size;
    const grid = this.biomeGrid;

    for (let bz = 0; bz < BIOME_STRIDE; bz++) {
      const wz = worldOffsetZ - half + bz * step;
      const rowOffset = bz * BIOME_STRIDE;
      for (let bx = 0; bx < BIOME_STRIDE; bx++) {
        const wx = worldOffsetX - half + bx * step;
        const idx = (rowOffset + bx) * 3;
        if (needBase) {
          grid[idx] = noise.getForestDensity(wx, wz);
          grid[idx + 1] = noise.getMeadowPatch(wx, wz);
        }
        if (needTall) {
          grid[idx + 2] = noise.getTallGrassFactor(wx, wz);
        } else if (needBase) {
          grid[idx + 2] = 0;
        }
      }
    }

    this.biomeGridPopulated = true;
    if (needTallGrass) {
      this.tallGrassPopulated = true;
    }
  }

  public sampleBiome(
    localX: number,
    localZ: number,
    out: { forest: number; meadow: number; tallGrass: number }
  ): void {
    const half = this.size * 0.5;
    const invStep = BIOME_SEGMENTS / this.size;

    const u = THREE.MathUtils.clamp((localX + half) * invStep, 0, BIOME_SEGMENTS - 0.0001);
    const v = THREE.MathUtils.clamp((localZ + half) * invStep, 0, BIOME_SEGMENTS - 0.0001);
    const ix = Math.floor(u);
    const iz = Math.floor(v);
    const fx = u - ix;
    const fz = v - iz;

    const i00 = (iz * BIOME_STRIDE + ix) * 3;
    const i10 = i00 + 3;
    const i01 = i00 + BIOME_STRIDE * 3;
    const i11 = i01 + 3;

    const w00 = (1 - fx) * (1 - fz);
    const w10 = fx * (1 - fz);
    const w01 = (1 - fx) * fz;
    const w11 = fx * fz;

    const g = this.biomeGrid;
    out.forest = g[i00] * w00 + g[i10] * w10 + g[i01] * w01 + g[i11] * w11;
    out.meadow = g[i00 + 1] * w00 + g[i10 + 1] * w10 + g[i01 + 1] * w01 + g[i11 + 1] * w11;
    out.tallGrass =
      g[i00 + 2] * w00 + g[i10 + 2] * w10 + g[i01 + 2] * w01 + g[i11 + 2] * w11;
  }

  private updateWaterMesh(config: WorldConfig, waterMaterial?: THREE.Material): void {
    const shouldHaveWater =
      config.enableWater &&
      !config.blankClayMode &&
      this.minElevation < config.waterLevel - 0.10 &&
      this.waterMinX <= this.waterMaxX;

    if (shouldHaveWater) {
      const waterGeo = getSharedWaterGeometry(this.segments);
      if (!this.waterMesh && waterMaterial) {
        this.waterMesh = new THREE.Mesh(waterGeo, waterMaterial);
        this.waterMesh.matrixAutoUpdate = false;
        this.mesh.add(this.waterMesh);
      }
      if (this.waterMesh) {
        this.waterMesh.geometry = waterGeo;
        this.waterMesh.visible = true;
        this.waterMesh.receiveShadow = this.segments === 64;
        const centerX = (this.waterMinX + this.waterMaxX) * 0.5;
        const centerZ = (this.waterMinZ + this.waterMaxZ) * 0.5;
        const spanX = Math.max(0.5, this.waterMaxX - this.waterMinX);
        const spanZ = Math.max(0.5, this.waterMaxZ - this.waterMinZ);
        this.waterMesh.position.set(centerX, config.waterLevel, centerZ);
        this.waterMesh.scale.set(spanX, 1, spanZ);
        this.waterMesh.updateMatrix();
        this.waterMesh.updateMatrixWorld(true);
      }
    } else if (this.waterMesh) {
      this.waterMesh.visible = false;
    }
  }

  public getElevationBounds(): { minH: number; maxH: number } {
    return { minH: this.minElevation, maxH: this.maxElevation };
  }

  public hasTrack(): boolean {
    return this.maxTrackWeight > 0.001;
  }

  public hasGrassInstance(): boolean {
    return this.chunkGrass !== undefined;
  }

  public releaseGrassIfFar(dist: number, maxGrassRadius: number): void {
    if (this.chunkGrass && this.grassDensityMult === 0 && dist > maxGrassRadius + 1.0) {
      this.mesh.remove(this.chunkGrass.group);
      this.chunkGrass.dispose();
      this.chunkGrass = undefined;
    }
  }

  public updateSegments(
    newSegments: number,
    config: WorldConfig,
    noise: TerrainNoise,
    waterMaterial?: THREE.Material
  ): void {
    if (this.segments === newSegments) return;
    let pool = geometryPool.get(this.segments);
    if (!pool) {
      pool = [];
      geometryPool.set(this.segments, pool);
    }
    pool.push(this.mesh.geometry);

    this.segments = newSegments;
    this.mesh.geometry = this.buildGeometry(noise, config.blankClayMode, config.waterLevel);
    this.updateWaterMesh(config, waterMaterial);
    if (this.borderLine) {
      this.setBorderVisible(false);
      this.setBorderVisible(true);
    }
  }

  public rebuildGrass(
    grassDensityMult: number,
    config: WorldConfig,
    noise: TerrainNoise,
    grassMaterial: THREE.Material,
    flowerMaterial: THREE.Material
  ): void {
    const effectiveMult =
      config.enableGrassBlades && !config.blankClayMode ? grassDensityMult : 0;
    this.tallGrassPopulated = false;
    this.populateBiomeGrid(noise, effectiveMult > 0);
    if (this.chunkGrass) {
      this.mesh.remove(this.chunkGrass.group);
      this.chunkGrass.dispose();
      this.chunkGrass = undefined;
    }
    this.updateGrass(grassDensityMult, config, noise, grassMaterial, flowerMaterial);
  }

  public rebuildForest(
    config: WorldConfig,
    noise: TerrainNoise,
    treeMaterial: THREE.Material,
    dist: number
  ): void {
    this.biomeGridPopulated = false;
    this.populateBiomeGrid(noise, false);
    if (this.chunkForest) {
      this.mesh.remove(this.chunkForest.group);
      this.chunkForest.dispose();
      this.chunkForest = undefined;
    }
    this.lastForestTier = -1;
    if ((config.enableTrees || config.enableTracks) && !config.blankClayMode) {
      this.lastForestTier = getForestTier(dist);
      this.chunkForest = new ChunkForest(
        this.cx,
        this.cz,
        this.size,
        config,
        noise,
        treeMaterial,
        dist <= 1.5,
        dist <= 2.2,
        this,
        dist
      );
      this.mesh.add(this.chunkForest.group);
      this.chunkForest.group.updateMatrixWorld(true);
    }
  }

  public updateGrass(
    grassDensityMult: number,
    config: WorldConfig,
    noise: TerrainNoise,
    grassMaterial: THREE.Material,
    flowerMaterial: THREE.Material
  ): void {
    const effectiveMult =
      config.enableGrassBlades && !config.blankClayMode ? grassDensityMult : 0;
    this.grassDensityMult = effectiveMult;
    this.hasGrass = effectiveMult > 0;

    if (this.chunkGrass) {
      this.chunkGrass.setDensityMultiplier(effectiveMult);
      return;
    }

    if (this.hasGrass) {
      this.populateBiomeGrid(noise, true);
      this.chunkGrass = new ChunkGrass(
        this.cx,
        this.cz,
        this.size,
        effectiveMult,
        config,
        noise,
        grassMaterial,
        flowerMaterial,
        this
      );
      this.mesh.add(this.chunkGrass.group);
      this.chunkGrass.group.updateMatrixWorld(true);
    }
  }

  public updateForestLOD(dist: number): void {
    const tier = getForestTier(dist);
    if (tier === this.lastForestTier) return;
    this.lastForestTier = tier;
    this.chunkForest?.setLOD(dist <= 1.5, dist <= 2.2, dist);
  }

  public getColliders(): Float32Array | undefined {
    return this.chunkForest?.colliders;
  }

  public getHuts(): readonly HutPlacement[] {
    return this.chunkForest ? this.chunkForest.huts : [];
  }

  public sampleHeightAndNormal(
    localX: number,
    localZ: number,
    outNormal: THREE.Vector3,
    outColor?: THREE.Color
  ): number {
    const segments = this.segments;
    const stride = segments + 1;
    const half = this.size * 0.5;
    const invStep = segments / this.size;

    const u = THREE.MathUtils.clamp((localX + half) * invStep, 0, segments - 0.0001);
    const v = THREE.MathUtils.clamp((localZ + half) * invStep, 0, segments - 0.0001);
    const ix = Math.floor(u);
    const iz = Math.floor(v);
    const fx = u - ix;
    const fz = v - iz;

    const i00 = (iz * stride + ix) * 3;
    const i10 = i00 + 3;
    const i01 = i00 + stride * 3;
    const i11 = i01 + 3;

    const w00 = (1 - fx) * (1 - fz);
    const w10 = fx * (1 - fz);
    const w01 = (1 - fx) * fz;
    const w11 = fx * fz;

    const geo = this.mesh.geometry;
    const posArr = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const normArr = (geo.attributes.normal as THREE.BufferAttribute).array as Float32Array;

    const h00 = posArr[i00 + 1];
    const h10 = posArr[i10 + 1];
    const h01 = posArr[i01 + 1];
    const h11 = posArr[i11 + 1];

    // Exact triangle barycentric interpolation matching THREE.PlaneGeometry and ChunkManager.getSurfaceHeight()
    const wy =
      fx + fz <= 1.0
        ? h00 + fx * (h10 - h00) + fz * (h01 - h00)
        : h11 + (1.0 - fx) * (h01 - h11) + (1.0 - fz) * (h10 - h11);

    const nx =
      normArr[i00] * w00 + normArr[i10] * w10 + normArr[i01] * w01 + normArr[i11] * w11;
    const ny =
      normArr[i00 + 1] * w00 +
      normArr[i10 + 1] * w10 +
      normArr[i01 + 1] * w01 +
      normArr[i11 + 1] * w11;
    const nz =
      normArr[i00 + 2] * w00 +
      normArr[i10 + 2] * w10 +
      normArr[i01 + 2] * w01 +
      normArr[i11 + 2] * w11;
    outNormal.set(nx, ny, nz).normalize();

    if (outColor) {
      const colArr = (geo.attributes.color as THREE.BufferAttribute).array as Float32Array;
      const r =
        colArr[i00] * w00 + colArr[i10] * w10 + colArr[i01] * w01 + colArr[i11] * w11;
      const g =
        colArr[i00 + 1] * w00 +
        colArr[i10 + 1] * w10 +
        colArr[i01 + 1] * w01 +
        colArr[i11 + 1] * w11;
      const b =
        colArr[i00 + 2] * w00 +
        colArr[i10 + 2] * w10 +
        colArr[i01 + 2] * w01 +
        colArr[i11 + 2] * w11;
      outColor.setRGB(r, g, b);
    }

    return wy;
  }

  public sampleTrackWeight(localX: number, localZ: number): number {
    if (this.maxTrackWeight <= 0.001) return 0;
    const trackWeights = this.mesh.geometry.userData.trackWeights as
      | Float32Array
      | undefined;
    if (!trackWeights) return 0;

    const segments = this.segments;
    const stride = segments + 1;
    const half = this.size * 0.5;
    const invStep = segments / this.size;

    const u = THREE.MathUtils.clamp((localX + half) * invStep, 0, segments - 0.0001);
    const v = THREE.MathUtils.clamp((localZ + half) * invStep, 0, segments - 0.0001);
    const ix = Math.floor(u);
    const iz = Math.floor(v);
    const fx = u - ix;
    const fz = v - iz;

    const i00 = iz * stride + ix;
    const i10 = i00 + 1;
    const i01 = i00 + stride;
    const i11 = i01 + 1;

    return (
      trackWeights[i00] * (1 - fx) * (1 - fz) +
      trackWeights[i10] * fx * (1 - fz) +
      trackWeights[i01] * (1 - fx) * fz +
      trackWeights[i11] * fx * fz
    );
  }

  public sampleColor(localX: number, localZ: number, outColor: THREE.Color): void {
    const segments = this.segments;
    const stride = segments + 1;
    const half = this.size * 0.5;
    const invStep = segments / this.size;

    const u = THREE.MathUtils.clamp((localX + half) * invStep, 0, segments - 0.0001);
    const v = THREE.MathUtils.clamp((localZ + half) * invStep, 0, segments - 0.0001);
    const ix = Math.floor(u);
    const iz = Math.floor(v);
    const fx = u - ix;
    const fz = v - iz;

    const i00 = (iz * stride + ix) * 3;
    const i10 = i00 + 3;
    const i01 = i00 + stride * 3;
    const i11 = i01 + 3;

    const w00 = (1 - fx) * (1 - fz);
    const w10 = fx * (1 - fz);
    const w01 = (1 - fx) * fz;
    const w11 = fx * fz;

    const colArr = (this.mesh.geometry.attributes.color as THREE.BufferAttribute)
      .array as Float32Array;

    const r =
      colArr[i00] * w00 + colArr[i10] * w10 + colArr[i01] * w01 + colArr[i11] * w11;
    const g =
      colArr[i00 + 1] * w00 +
      colArr[i10 + 1] * w10 +
      colArr[i01 + 1] * w01 +
      colArr[i11 + 1] * w11;
    const b =
      colArr[i00 + 2] * w00 +
      colArr[i10 + 2] * w10 +
      colArr[i01 + 2] * w01 +
      colArr[i11 + 2] * w11;
    outColor.setRGB(r, g, b);
  }

  private buildGeometry(
    noise: TerrainNoise,
    blankClayMode: boolean,
    waterLevel = 0
  ): THREE.BufferGeometry {
    const segments = this.segments;
    const size = this.size;
    const half = size * 0.5;
    const step = size / segments;

    const count = (segments + 1) * (segments + 1);
    const pool = geometryPool.get(segments);
    let geometry: THREE.BufferGeometry;
    let isReusedSameSize = false;
    if (pool && pool.length > 0) {
      geometry = pool.pop()!;
      isReusedSameSize = geometry.userData.gridSize === size;
    } else {
      geometry = new THREE.PlaneGeometry(size, size, segments, segments);
      geometry.rotateX(-Math.PI / 2);
      geometry.deleteAttribute('uv');
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(count * 3), 3)
      );
      geometry.userData.trackWeights = new Float32Array(count);
      geometry.userData.gridSize = size;
    }
    if (!geometry.userData.trackWeights || geometry.userData.trackWeights.length < count) {
      geometry.userData.trackWeights = new Float32Array(count);
    }
    geometry.userData.gridSize = size;
    const trackWeights = geometry.userData.trackWeights as Float32Array;

    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const normAttr = geometry.attributes.normal as THREE.BufferAttribute;
    const colAttr = geometry.attributes.color as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;
    const normArr = normAttr.array as Float32Array;
    const colors = colAttr.array as Float32Array;

    const worldOffsetX = this.cx * size;
    const worldOffsetZ = this.cz * size;

    // 1. Sample heights & track weights on a 1-cell padded grid (segments + 3) x (segments + 3)
    const padStride = segments + 3;
    const requiredLen = padStride * padStride;
    if (paddedHeights.length < requiredLen) {
      paddedHeights = new Float32Array(requiredLen);
      paddedTrackWeights = new Float32Array(requiredLen);
    }

    const skipTracks = !noise.isChunkNearTrack(
      worldOffsetX,
      worldOffsetZ,
      (half + step) * 1.4143
    );

    let maxTrackW = 0;
    for (let pz = 0; pz < padStride; pz++) {
      const wz = worldOffsetZ - half + (pz - 1) * step;
      const rowOffset = pz * padStride;
      for (let px = 0; px < padStride; px++) {
        const wx = worldOffsetX - half + (px - 1) * step;
        const idx = rowOffset + px;
        paddedHeights[idx] = noise.getHeight(wx, wz, skipTracks);
        if (!skipTracks) {
          const tw = noise.lastTrackWeight;
          paddedTrackWeights[idx] = tw;
          if (tw > maxTrackW) maxTrackW = tw;
        }
      }
    }
    this.maxTrackWeight = maxTrackW;

    // 2. Populate vertex positions, central-difference normals from padded grid, and surface colors
    let minH = Infinity;
    let maxH = -Infinity;
    let waterMinX = Infinity;
    let waterMaxX = -Infinity;
    let waterMinZ = Infinity;
    let waterMaxZ = -Infinity;
    const waterThreshold = waterLevel + 0.25;
    const vertStride = segments + 1;
    const twoStep = 2.0 * step;

    for (let iz = 0; iz < vertStride; iz++) {
      const localZ = -half + iz * step;
      const wz = worldOffsetZ + localZ;
      const padRow = (iz + 1) * padStride;
      const vertRow = iz * vertStride;

      for (let ix = 0; ix < vertStride; ix++) {
        const i = vertRow + ix;
        const cIdx = i * 3;
        const localX = -half + ix * step;
        const wx = worldOffsetX + localX;

        const pIdx = padRow + (ix + 1);
        const wy = paddedHeights[pIdx];
        const tw = skipTracks ? 0 : paddedTrackWeights[pIdx];
        if (!skipTracks) {
          trackWeights[i] = tw;
        }
        if (wy < minH) minH = wy;
        if (wy > maxH) maxH = wy;
        if (wy < waterThreshold) {
          if (localX < waterMinX) waterMinX = localX;
          if (localX > waterMaxX) waterMaxX = localX;
          if (localZ < waterMinZ) waterMinZ = localZ;
          if (localZ > waterMaxZ) waterMaxZ = localZ;
        }

        if (!isReusedSameSize) {
          posArr[cIdx] = localX;
          posArr[cIdx + 2] = localZ;
        }
        posArr[cIdx + 1] = wy;

        // Compute central-difference normal directly from the 4 neighbor heights in paddedHeights
        const hL = paddedHeights[pIdx - 1];
        const hR = paddedHeights[pIdx + 1];
        const hD = paddedHeights[pIdx - padStride];
        const hU = paddedHeights[pIdx + padStride];
        const nx = hL - hR;
        const ny = twoStep;
        const nz = hD - hU;
        const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        tempNormal.set(nx * invLen, ny * invLen, nz * invLen);
        normArr[cIdx] = tempNormal.x;
        normArr[cIdx + 1] = tempNormal.y;
        normArr[cIdx + 2] = tempNormal.z;

        if (blankClayMode) {
          colors[cIdx] = clayColor.r;
          colors[cIdx + 1] = clayColor.g;
          colors[cIdx + 2] = clayColor.b;
        } else {
          if (segments === BIOME_SEGMENTS) {
            const bIdx = (iz * BIOME_STRIDE + ix) * 3;
            tempBiome.forest = this.biomeGrid[bIdx];
            tempBiome.meadow = this.biomeGrid[bIdx + 1];
          } else {
            this.sampleBiome(localX, localZ, tempBiome);
          }
          noise.getSurfaceColor(
            wx,
            wy,
            wz,
            tempNormal,
            tempColor,
            tw,
            tempBiome.meadow,
            tempBiome.forest
          );
          colors[cIdx] = tempColor.r;
          colors[cIdx + 1] = tempColor.g;
          colors[cIdx + 2] = tempColor.b;
        }
      }
    }

    this.minElevation = minH;
    this.maxElevation = maxH;
    if (waterMinX <= waterMaxX) {
      this.waterMinX = Math.max(-half, waterMinX - step);
      this.waterMaxX = Math.min(half, waterMaxX + step);
      this.waterMinZ = Math.max(-half, waterMinZ - step);
      this.waterMaxZ = Math.min(half, waterMaxZ + step);
    } else {
      this.waterMinX = Infinity;
      this.waterMaxX = -Infinity;
      this.waterMinZ = Infinity;
      this.waterMaxZ = -Infinity;
    }
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // 3. Analytical boundingBox and boundingSphere
    if (!geometry.boundingBox) geometry.boundingBox = new THREE.Box3();
    geometry.boundingBox.min.set(-half, minH, -half);
    geometry.boundingBox.max.set(half, maxH, half);

    const centerY = (minH + maxH) * 0.5;
    const halfY = (maxH - minH) * 0.5;
    const radius = Math.sqrt(2 * half * half + halfY * halfY);
    if (!geometry.boundingSphere) geometry.boundingSphere = new THREE.Sphere();
    geometry.boundingSphere.center.set(0, centerY, 0);
    geometry.boundingSphere.radius = radius;

    return geometry;
  }

  public setBorderVisible(visible: boolean): void {
    if (visible && !this.borderLine) {
      const seg = this.segments;
      const stride = seg + 1;
      const posArr = (this.mesh.geometry.attributes.position as THREE.BufferAttribute)
        .array as Float32Array;
      const count = seg * 4;
      const borderPos = new Float32Array(count * 2 * 3);
      let out = 0;

      const pushSeg = (i0: number, i1: number) => {
        const a = i0 * 3;
        const b = i1 * 3;
        borderPos[out++] = posArr[a];
        borderPos[out++] = posArr[a + 1] + 0.08;
        borderPos[out++] = posArr[a + 2];
        borderPos[out++] = posArr[b];
        borderPos[out++] = posArr[b + 1] + 0.08;
        borderPos[out++] = posArr[b + 2];
      };

      for (let i = 0; i < seg; i++) pushSeg(i, i + 1);
      for (let i = 0; i < seg; i++) pushSeg(i * stride + seg, (i + 1) * stride + seg);
      for (let i = seg; i > 0; i--) pushSeg(seg * stride + i, seg * stride + i - 1);
      for (let i = seg; i > 0; i--) pushSeg(i * stride, (i - 1) * stride);

      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(borderPos, 3));
      this.borderLine = new THREE.LineSegments(lineGeo, sharedBorderMaterial);
      this.borderLine.matrixAutoUpdate = false;
      this.mesh.add(this.borderLine);
      this.borderLine.updateMatrixWorld(true);
    } else if (!visible && this.borderLine) {
      this.mesh.remove(this.borderLine);
      this.borderLine.geometry.dispose();
      this.borderLine = undefined;
    }
  }

  public dispose(): void {
    this.biomeGridPopulated = false;
    this.tallGrassPopulated = false;
    this.chunkGrass?.dispose();
    this.chunkForest?.dispose();
    if (this.borderLine) {
      this.borderLine.geometry.dispose();
    }
    let pool = geometryPool.get(this.segments);
    if (!pool) {
      pool = [];
      geometryPool.set(this.segments, pool);
    }
    pool.push(this.mesh.geometry);
  }
}
