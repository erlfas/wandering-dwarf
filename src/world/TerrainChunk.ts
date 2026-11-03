import * as THREE from 'three';
import { WorldConfig } from './Config';
import { ChunkForest } from './ForestField';
import { ChunkGrass, ChunkSurfaceSampler } from './GrassField';
import { TerrainNoise } from './TerrainNoise';

let sharedWaterGeo: THREE.BufferGeometry | null = null;
let sharedWaterGeoSize = 0;

const sharedBorderMaterial = new THREE.LineBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.45,
});

const geometryPool = new Map<number, THREE.BufferGeometry[]>();

// Reusable module-level buffers & temporaries for zero-allocation chunk building
let paddedHeights = new Float32Array(67 * 67);
const tempNormal = new THREE.Vector3();
const tempColor = new THREE.Color();
const clayColor = new THREE.Color(0xdcd6cc);

export class TerrainChunk implements ChunkSurfaceSampler {
  public readonly cx: number;
  public readonly cz: number;
  public readonly size: number;
  public readonly segments: number;
  public hasGrass: boolean;
  public grassDensityMult: number;
  public readonly mesh: THREE.Mesh;
  private minElevation = Infinity;
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

    const geometry = this.buildGeometry(noise, config.blankClayMode);
    this.mesh = new THREE.Mesh(geometry, terrainMaterial);
    this.mesh.position.set(cx * size, 0, cz * size);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;

    // 1. Add Water Surface Plane if this chunk contains a river channel or pond basin
    if (
      config.enableWater &&
      !config.blankClayMode &&
      this.minElevation < config.waterLevel - 0.02
    ) {
      if (!sharedWaterGeo || sharedWaterGeoSize !== size) {
        sharedWaterGeo?.dispose();
        sharedWaterGeo = new THREE.PlaneGeometry(size, size, 8, 8);
        sharedWaterGeo.rotateX(-Math.PI / 2);
        sharedWaterGeoSize = size;
      }
      this.waterMesh = new THREE.Mesh(sharedWaterGeo, waterMaterial);
      this.waterMesh.position.y = config.waterLevel;
      this.waterMesh.receiveShadow = true;
      this.mesh.add(this.waterMesh);
    }

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

    // 3. Add Forest Groves & Shoreline Boulders across all visible chunks
    if (config.enableTrees && !config.blankClayMode) {
      const isNearLOD = dist <= 1.5;
      const castShadow = dist <= 2.2;
      this.chunkForest = new ChunkForest(
        cx,
        cz,
        size,
        config,
        noise,
        treeMaterial,
        isNearLOD,
        castShadow,
        this
      );
      this.mesh.add(this.chunkForest.group);
    }

    if (config.showChunkBorders) {
      this.setBorderVisible(true, noise);
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
    if (this.chunkGrass) {
      this.mesh.remove(this.chunkGrass.group);
      this.chunkGrass.dispose();
      this.chunkGrass = undefined;
    }
    this.grassDensityMult = effectiveMult;
    this.hasGrass = effectiveMult > 0;

    if (this.hasGrass) {
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
    }
  }

  public updateForestLOD(dist: number): void {
    this.chunkForest?.setLOD(dist <= 1.5, dist <= 2.2);
  }

  public sampleHeightAndNormal(
    localX: number,
    localZ: number,
    outNormal: THREE.Vector3
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

    const wy =
      posArr[i00 + 1] * w00 +
      posArr[i10 + 1] * w10 +
      posArr[i01 + 1] * w01 +
      posArr[i11 + 1] * w11;

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

    return wy;
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
    blankClayMode: boolean
  ): THREE.BufferGeometry {
    const segments = this.segments;
    const size = this.size;
    const half = size * 0.5;
    const step = size / segments;

    const pool = geometryPool.get(segments);
    let geometry: THREE.BufferGeometry;
    if (pool && pool.length > 0) {
      geometry = pool.pop()!;
    } else {
      geometry = new THREE.PlaneGeometry(size, size, segments, segments);
      geometry.rotateX(-Math.PI / 2);
      const count = (segments + 1) * (segments + 1);
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(count * 3), 3)
      );
    }

    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const normAttr = geometry.attributes.normal as THREE.BufferAttribute;
    const colAttr = geometry.attributes.color as THREE.BufferAttribute;
    const colors = colAttr.array as Float32Array;

    const worldOffsetX = this.cx * size;
    const worldOffsetZ = this.cz * size;

    // 1. Sample heights on a 1-cell padded grid (segments + 3) x (segments + 3)
    const padStride = segments + 3;
    const requiredLen = padStride * padStride;
    if (paddedHeights.length < requiredLen) {
      paddedHeights = new Float32Array(requiredLen);
    }

    for (let pz = 0; pz < padStride; pz++) {
      const wz = worldOffsetZ - half + (pz - 1) * step;
      const rowOffset = pz * padStride;
      for (let px = 0; px < padStride; px++) {
        const wx = worldOffsetX - half + (px - 1) * step;
        paddedHeights[rowOffset + px] = noise.getHeight(wx, wz);
      }
    }

    // 2. Populate vertex positions, central-difference normals from padded grid, and surface colors
    let minH = Infinity;
    let maxH = -Infinity;
    const vertStride = segments + 1;
    const twoStep = 2.0 * step;

    for (let iz = 0; iz < vertStride; iz++) {
      const localZ = -half + iz * step;
      const wz = worldOffsetZ + localZ;
      const padRow = (iz + 1) * padStride;
      const vertRow = iz * vertStride;

      for (let ix = 0; ix < vertStride; ix++) {
        const i = vertRow + ix;
        const localX = -half + ix * step;
        const wx = worldOffsetX + localX;

        const pIdx = padRow + (ix + 1);
        const wy = paddedHeights[pIdx];
        if (wy < minH) minH = wy;
        if (wy > maxH) maxH = wy;

        posAttr.setXYZ(i, localX, wy, localZ);

        // Compute central-difference normal directly from the 4 neighbor heights in paddedHeights
        const hL = paddedHeights[pIdx - 1];
        const hR = paddedHeights[pIdx + 1];
        const hD = paddedHeights[pIdx - padStride];
        const hU = paddedHeights[pIdx + padStride];
        tempNormal.set(hL - hR, twoStep, hD - hU).normalize();
        normAttr.setXYZ(i, tempNormal.x, tempNormal.y, tempNormal.z);

        const cIdx = i * 3;
        if (blankClayMode) {
          colors[cIdx] = clayColor.r;
          colors[cIdx + 1] = clayColor.g;
          colors[cIdx + 2] = clayColor.b;
        } else {
          noise.getSurfaceColor(wx, wy, wz, tempNormal, tempColor);
          colors[cIdx] = tempColor.r;
          colors[cIdx + 1] = tempColor.g;
          colors[cIdx + 2] = tempColor.b;
        }
      }
    }

    this.minElevation = minH;
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

  public setBorderVisible(visible: boolean, noise: TerrainNoise): void {
    if (visible && !this.borderLine) {
      const pts: THREE.Vector3[] = [];
      const half = this.size / 2;
      const steps = 24;
      const wx0 = this.cx * this.size;
      const wz0 = this.cz * this.size;

      const sampleEdge = (x1: number, z1: number, x2: number, z2: number) => {
        for (let i = 0; i < steps; i++) {
          const t1 = i / steps;
          const t2 = (i + 1) / steps;
          const ax = THREE.MathUtils.lerp(x1, x2, t1);
          const az = THREE.MathUtils.lerp(z1, z2, t1);
          const bx = THREE.MathUtils.lerp(x1, x2, t2);
          const bz = THREE.MathUtils.lerp(z1, z2, t2);
          pts.push(
            new THREE.Vector3(ax, noise.getHeight(wx0 + ax, wz0 + az) + 0.08, az),
            new THREE.Vector3(bx, noise.getHeight(wx0 + bx, wz0 + bz) + 0.08, bz)
          );
        }
      };

      sampleEdge(-half, -half, half, -half);
      sampleEdge(half, -half, half, half);
      sampleEdge(half, half, -half, half);
      sampleEdge(-half, half, -half, -half);

      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      this.borderLine = new THREE.LineSegments(lineGeo, sharedBorderMaterial);
      this.mesh.add(this.borderLine);
    } else if (!visible && this.borderLine) {
      this.mesh.remove(this.borderLine);
      this.borderLine.geometry.dispose();
      this.borderLine = undefined;
    }
  }

  public dispose(): void {
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
