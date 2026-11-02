import * as THREE from 'three';
import { WorldConfig } from './Config';
import { ChunkForest } from './ForestField';
import { ChunkGrass } from './GrassField';
import { TerrainNoise } from './TerrainNoise';

let sharedWaterGeo: THREE.BufferGeometry | null = null;

export class TerrainChunk {
  public readonly cx: number;
  public readonly cz: number;
  public readonly size: number;
  public readonly segments: number;
  public readonly hasGrass: boolean;
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
    waterMaterial: THREE.Material
  ) {
    this.cx = cx;
    this.cz = cz;
    this.size = size;
    this.segments = segments;
    this.hasGrass =
      grassDensityMult > 0 && config.enableGrassBlades && !config.blankClayMode;

    const geometry = this.buildGeometry(noise, config.blankClayMode);
    this.mesh = new THREE.Mesh(geometry, terrainMaterial);
    this.mesh.position.set(cx * size, 0, cz * size);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;

    // 1. Add Water Surface Plane if this chunk contains a river channel or pond basin
    if (
      config.enableWater &&
      !config.blankClayMode &&
      this.minElevation < config.waterLevel + 0.08
    ) {
      if (!sharedWaterGeo) {
        sharedWaterGeo = new THREE.PlaneGeometry(size, size, 16, 16);
        sharedWaterGeo.rotateX(-Math.PI / 2);
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
        grassDensityMult,
        config,
        noise,
        grassMaterial,
        flowerMaterial
      );
      this.mesh.add(this.chunkGrass.group);
    }

    // 3. Add Forest Groves & Shoreline Boulders across all visible chunks
    if (config.enableTrees && !config.blankClayMode) {
      this.chunkForest = new ChunkForest(
        cx,
        cz,
        size,
        config,
        noise,
        treeMaterial
      );
      this.mesh.add(this.chunkForest.group);
    }

    if (config.showChunkBorders) {
      this.setBorderVisible(true, noise);
    }
  }

  private buildGeometry(
    noise: TerrainNoise,
    blankClayMode: boolean
  ): THREE.BufferGeometry {
    const geometry = new THREE.PlaneGeometry(
      this.size,
      this.size,
      this.segments,
      this.segments
    );
    geometry.rotateX(-Math.PI / 2);

    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const normAttr = geometry.attributes.normal as THREE.BufferAttribute;
    const colors = new Float32Array(posAttr.count * 3);

    const worldOffsetX = this.cx * this.size;
    const worldOffsetZ = this.cz * this.size;
    const tempNormal = new THREE.Vector3();
    const tempColor = new THREE.Color();
    const clayColor = new THREE.Color(0xdcd6cc);

    let minH = Infinity;

    for (let i = 0; i < posAttr.count; i++) {
      const localX = posAttr.getX(i);
      const localZ = posAttr.getZ(i);
      const wx = worldOffsetX + localX;
      const wz = worldOffsetZ + localZ;

      const wy = noise.getHeight(wx, wz);
      if (wy < minH) minH = wy;
      posAttr.setY(i, wy);

      // Compute continuous analytical/finite-difference normal so adjacent chunks have no seam
      noise.getNormal(wx, wz, tempNormal);
      normAttr.setXYZ(i, tempNormal.x, tempNormal.y, tempNormal.z);

      if (blankClayMode) {
        colors[i * 3] = clayColor.r;
        colors[i * 3 + 1] = clayColor.g;
        colors[i * 3 + 2] = clayColor.b;
      } else {
        noise.getSurfaceColor(wx, wy, wz, tempNormal, tempColor);
        colors[i * 3] = tempColor.r;
        colors[i * 3 + 1] = tempColor.g;
        colors[i * 3 + 2] = tempColor.b;
      }
    }

    this.minElevation = minH;
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

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
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.45,
      });
      this.borderLine = new THREE.LineSegments(lineGeo, lineMat);
      this.mesh.add(this.borderLine);
    } else if (!visible && this.borderLine) {
      this.mesh.remove(this.borderLine);
      this.borderLine.geometry.dispose();
      (this.borderLine.material as THREE.Material).dispose();
      this.borderLine = undefined;
    }
  }

  public dispose(): void {
    this.chunkGrass?.dispose();
    this.chunkForest?.dispose();
    if (this.borderLine) {
      this.borderLine.geometry.dispose();
      (this.borderLine.material as THREE.Material).dispose();
    }
    this.mesh.geometry.dispose();
  }
}
