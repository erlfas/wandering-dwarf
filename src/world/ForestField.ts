import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WorldConfig } from './Config';
import { GrassUniforms } from './GrassField';
import { createSeededRandom, TerrainNoise } from './TerrainNoise';

/**
 * Helper to bake vertex colors and optional vertical gradient onto a BufferGeometry part.
 */
function colorizeGeometry(
  geo: THREE.BufferGeometry,
  bottomColor: THREE.Color,
  topColor: THREE.Color,
  swayWeight: number
): THREE.BufferGeometry {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo.clone();
  nonIndexed.computeBoundingBox();
  const minY = nonIndexed.boundingBox!.min.y;
  const maxY = nonIndexed.boundingBox!.max.y;
  const spanY = Math.max(0.01, maxY - minY);

  const posAttr = nonIndexed.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const uvs = new Float32Array(posAttr.count * 2);
  const c = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const t = THREE.MathUtils.clamp((y - minY) / spanY, 0, 1);
    c.copy(bottomColor).lerp(topColor, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    // uv.y encodes how much this vertex sways in the wind (0 for lower trunk, higher for upper canopy)
    uvs[i * 2] = 0;
    uvs[i * 2 + 1] = swayWeight * (0.25 + 0.75 * t);
  }

  nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  nonIndexed.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return nonIndexed;
}

/**
 * Builds a stylized layered Pine / Spruce tree geometry (trunk + 5 tiered conifer skirts)
 * matching the tall evergreen conifers in the reference images.
 */
function createPineTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Sturdy tapered trunk
  const trunk = new THREE.CylinderGeometry(0.16, 0.34, 2.6, 8);
  trunk.translate(0, 1.2, 0);
  parts.push(
    colorizeGeometry(
      trunk,
      new THREE.Color(0x4a3221),
      new THREE.Color(0x63442d),
      0.02
    )
  );

  // 5 overlapping conifer foliage tiers from bottom to pointed top
  const tiers = [
    { radius: 2.05, height: 2.2, y: 2.5, bottom: 0x1f3d20, top: 0x38612b, sway: 0.25 },
    { radius: 1.75, height: 2.1, y: 3.8, bottom: 0x234423, top: 0x416d30, sway: 0.45 },
    { radius: 1.42, height: 1.95, y: 5.0, bottom: 0x284c26, top: 0x4b7a35, sway: 0.65 },
    { radius: 1.08, height: 1.8, y: 6.1, bottom: 0x2e552a, top: 0x56873b, sway: 0.85 },
    { radius: 0.72, height: 1.65, y: 7.1, bottom: 0x355f2e, top: 0x649642, sway: 1.0 },
  ];

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const cone = new THREE.ConeGeometry(t.radius, t.height, 9);
    cone.rotateY(i * 0.4);
    cone.translate(0, t.y, 0);
    parts.push(
      colorizeGeometry(
        cone,
        new THREE.Color(t.bottom),
        new THREE.Color(t.top),
        t.sway
      )
    );
  }

  const merged = mergeGeometries(parts, false);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds a stylized Broadleaf / Oak tree geometry (trunk + main branches + puffy multi-lobe canopy)
 * matching the rounded deciduous trees in the reference images.
 */
function createBroadleafTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const trunkColorBot = new THREE.Color(0x4d3624);
  const trunkColorTop = new THREE.Color(0x684b34);

  // Main trunk
  const trunk = new THREE.CylinderGeometry(0.24, 0.42, 2.9, 8);
  trunk.translate(0, 1.35, 0);
  parts.push(colorizeGeometry(trunk, trunkColorBot, trunkColorTop, 0.02));

  // Two angled boughs supporting the side canopy lobes
  const boughL = new THREE.CylinderGeometry(0.12, 0.2, 1.6, 6);
  boughL.rotateZ(0.55);
  boughL.translate(-0.55, 2.6, 0.1);
  parts.push(colorizeGeometry(boughL, trunkColorBot, trunkColorTop, 0.1));

  const boughR = new THREE.CylinderGeometry(0.12, 0.2, 1.5, 6);
  boughR.rotateZ(-0.5);
  boughR.rotateY(0.6);
  boughR.translate(0.5, 2.7, -0.2);
  parts.push(colorizeGeometry(boughR, trunkColorBot, trunkColorTop, 0.1));

  // Clustered puffy foliage lobes (icosahedrons with soft normals & sunlit top gradient)
  const lobes = [
    { x: 0.0, y: 4.5, z: 0.0, rx: 1.95, ry: 1.65, rz: 1.9, bot: 0x345925, top: 0x6d993b },
    { x: -1.15, y: 3.7, z: 0.4, rx: 1.45, ry: 1.25, rz: 1.4, bot: 0x2d4f21, top: 0x608b35 },
    { x: 1.1, y: 3.8, z: -0.35, rx: 1.4, ry: 1.25, rz: 1.45, bot: 0x2f5222, top: 0x648f37 },
    { x: 0.2, y: 3.6, z: 1.05, rx: 1.35, ry: 1.15, rz: 1.3, bot: 0x2d4e20, top: 0x5e8834 },
    { x: -0.3, y: 3.65, z: -1.0, rx: 1.35, ry: 1.2, rz: 1.35, bot: 0x2b4b1e, top: 0x5b8432 },
    { x: 0.0, y: 5.45, z: 0.05, rx: 1.35, ry: 1.15, rz: 1.35, bot: 0x416b2c, top: 0x7da942 },
  ];

  for (const l of lobes) {
    const sphere = new THREE.IcosahedronGeometry(1.0, 2);
    sphere.scale(l.rx, l.ry, l.rz);
    sphere.translate(l.x, l.y, l.z);
    parts.push(
      colorizeGeometry(
        sphere,
        new THREE.Color(l.bot),
        new THREE.Color(l.top),
        0.55
      )
    );
  }

  const merged = mergeGeometries(parts, false);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds a small shoreline boulder + cattail reed cluster geometry for pond/river banks.
 */
function createShorelineRockGeometry(): THREE.BufferGeometry {
  const rock = new THREE.DodecahedronGeometry(0.65, 1);
  rock.scale(1.25, 0.72, 1.05);
  return colorizeGeometry(
    rock,
    new THREE.Color(0x59564f),
    new THREE.Color(0x7c7d6e), // Slightly mossy top
    0.0
  );
}

/**
 * Shared tree material with gentle canopy wind sway.
 */
export function createTreeMaterial(uniforms: GrassUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.02,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;

    shader.vertexShader =
      `
      uniform float uTime;
      uniform float uWindSpeed;
      uniform float uWindStrength;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vec4 instWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float swayWeight = uv.y;
      float treePhase = instWorld.x * 0.08 + instWorld.z * 0.07 + uTime * uWindSpeed * 0.65;
      transformed.x += sin(treePhase) * uWindStrength * 0.45 * swayWeight;
      transformed.z += cos(treePhase * 0.85) * uWindStrength * 0.35 * swayWeight;
      `
    );
  };

  return mat;
}

let sharedPineGeo: THREE.BufferGeometry | null = null;
let sharedBroadleafGeo: THREE.BufferGeometry | null = null;
let sharedRockGeo: THREE.BufferGeometry | null = null;

export class ChunkForest {
  public readonly group = new THREE.Group();
  private pineInstanced?: THREE.InstancedMesh;
  private broadleafInstanced?: THREE.InstancedMesh;
  private rockInstanced?: THREE.InstancedMesh;

  constructor(
    cx: number,
    cz: number,
    size: number,
    config: WorldConfig,
    noise: TerrainNoise,
    treeMaterial: THREE.Material
  ) {
    if (!sharedPineGeo) sharedPineGeo = createPineTreeGeometry();
    if (!sharedBroadleafGeo) sharedBroadleafGeo = createBroadleafTreeGeometry();
    if (!sharedRockGeo) sharedRockGeo = createShorelineRockGeometry();

    // Use a 9.6m jittered grid (5x5 = 25 candidate cells per 48m chunk) so trees NEVER overlap
    // and always maintain airy spacing with open clearings.
    const gridSteps = 5;
    const cellSize = size / gridSteps;
    const maxCandidates = gridSteps * gridSteps;

    const chunkSeed = ((cx * 92837111) ^ (cz * 689287499) ^ (config.seed + 71)) >>> 0;
    const rng = createSeededRandom(chunkSeed);

    const pineTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const broadleafTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const rockTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];

    const dummy = new THREE.Object3D();
    const normal = new THREE.Vector3();
    const worldOffsetX = cx * size;
    const worldOffsetZ = cz * size;

    for (let gz = 0; gz < gridSteps; gz++) {
      for (let gx = 0; gx < gridSteps; gx++) {
        // Jitter position inside the 9.6m cell while keeping buffer from cell edges
        const lx = -size / 2 + (gx + 0.18 + rng() * 0.64) * cellSize;
        const lz = -size / 2 + (gz + 0.18 + rng() * 0.64) * cellSize;
        const wx = worldOffsetX + lx;
        const wz = worldOffsetZ + lz;

        const wy = noise.getHeight(wx, wz);
        noise.getNormal(wx, wz, normal);

        // Check if right on a pond or river shoreline -> occasionally place a mossy shoreline boulder!
        const distAboveWater = wy - config.waterLevel;
        if (
          config.enableWater &&
          distAboveWater > -0.25 &&
          distAboveWater < 0.75 &&
          rng() < 0.28
        ) {
          dummy.position.set(lx, wy - 0.12, lz);
          dummy.rotation.set(
            (rng() - 0.5) * 0.3,
            rng() * Math.PI * 2,
            (rng() - 0.5) * 0.3
          );
          const rScale = 0.6 + rng() * 0.95;
          dummy.scale.set(rScale, rScale * (0.75 + rng() * 0.4), rScale);
          dummy.updateMatrix();
          const rockTint = new THREE.Color(0xffffff).offsetHSL(0, 0, (rng() - 0.5) * 0.12);
          rockTransforms.push({ matrix: dummy.matrix.clone(), tint: rockTint });
          continue;
        }

        // Do not place trees in water, on wet shorelines, or on steep cliffs
        if (config.enableWater && distAboveWater < 1.25) continue;
        if (normal.y < 0.78) continue;

        // Evaluate grove mask: 0 in open meadows, >0 in wooded groves
        const groveDensity = noise.getForestDensity(wx, wz);
        if (groveDensity <= 0.02) continue;

        // Keep groves airy and non-crowded using config.treeDensity
        const spawnChance = groveDensity * config.treeDensity * 0.75;
        if (rng() > spawnChance) continue;

        // Trees near the edge of a grove are slightly smaller saplings; deeper grove trees are taller
        const groveScale = 0.68 + groveDensity * 0.42;
        const randomScale = (0.82 + rng() * 0.42) * groveScale * config.treeScale;

        dummy.position.set(lx, wy - 0.08, lz);
        dummy.rotation.set(
          (rng() - 0.5) * 0.06,
          rng() * Math.PI * 2,
          (rng() - 0.5) * 0.06
        );
        dummy.scale.setScalar(randomScale);
        dummy.updateMatrix();

        const tint = new THREE.Color(0xffffff).offsetHSL(
          (rng() - 0.5) * 0.035,
          (rng() - 0.5) * 0.08,
          (rng() - 0.5) * 0.08
        );

        // Mix conifers and broadleaf trees (more pines on higher slopes, more oaks in warm valleys)
        const pineBias = THREE.MathUtils.clamp(0.48 + (wy - config.waterLevel) * 0.008, 0.3, 0.75);
        if (rng() < pineBias) {
          pineTransforms.push({ matrix: dummy.matrix.clone(), tint });
        } else {
          broadleafTransforms.push({ matrix: dummy.matrix.clone(), tint });
        }
      }
    }

    if (pineTransforms.length > 0 && pineTransforms.length <= maxCandidates) {
      this.pineInstanced = new THREE.InstancedMesh(
        sharedPineGeo,
        treeMaterial,
        pineTransforms.length
      );
      this.pineInstanced.castShadow = true;
      this.pineInstanced.receiveShadow = true;
      pineTransforms.forEach((item, idx) => {
        this.pineInstanced!.setMatrixAt(idx, item.matrix);
        this.pineInstanced!.setColorAt(idx, item.tint);
      });
      this.pineInstanced.instanceMatrix.needsUpdate = true;
      if (this.pineInstanced.instanceColor) this.pineInstanced.instanceColor.needsUpdate = true;
      this.group.add(this.pineInstanced);
    }

    if (broadleafTransforms.length > 0 && broadleafTransforms.length <= maxCandidates) {
      this.broadleafInstanced = new THREE.InstancedMesh(
        sharedBroadleafGeo,
        treeMaterial,
        broadleafTransforms.length
      );
      this.broadleafInstanced.castShadow = true;
      this.broadleafInstanced.receiveShadow = true;
      broadleafTransforms.forEach((item, idx) => {
        this.broadleafInstanced!.setMatrixAt(idx, item.matrix);
        this.broadleafInstanced!.setColorAt(idx, item.tint);
      });
      this.broadleafInstanced.instanceMatrix.needsUpdate = true;
      if (this.broadleafInstanced.instanceColor)
        this.broadleafInstanced.instanceColor.needsUpdate = true;
      this.group.add(this.broadleafInstanced);
    }

    if (rockTransforms.length > 0) {
      this.rockInstanced = new THREE.InstancedMesh(
        sharedRockGeo,
        treeMaterial,
        rockTransforms.length
      );
      this.rockInstanced.castShadow = true;
      this.rockInstanced.receiveShadow = true;
      rockTransforms.forEach((item, idx) => {
        this.rockInstanced!.setMatrixAt(idx, item.matrix);
        this.rockInstanced!.setColorAt(idx, item.tint);
      });
      this.rockInstanced.instanceMatrix.needsUpdate = true;
      if (this.rockInstanced.instanceColor) this.rockInstanced.instanceColor.needsUpdate = true;
      this.group.add(this.rockInstanced);
    }
  }

  public dispose(): void {
    this.pineInstanced?.dispose();
    this.broadleafInstanced?.dispose();
    this.rockInstanced?.dispose();
  }
}
