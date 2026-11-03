import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import pineModelUrl from '../../3dmodels/pine tree 3d model.glb?url';
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
 * Enhances any MeshStandardMaterial (either textured GLB pine material or vertex-colored tree material)
 * with realistic multi-layered wind sway & branch flutter shaders, plus depth shadow support.
 */
export function applyWindShaderToMaterial(
  mat: THREE.MeshStandardMaterial,
  uniforms: GrassUniforms,
  useHeightAndRadiusWeights = false
): void {
  const injectWind = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;

    shader.vertexShader =
      `
      uniform float uTime;
      uniform float uWindSpeed;
      uniform float uWindStrength;
      ` + shader.vertexShader;

    if (useHeightAndRadiusWeights) {
      // 3D Modelled Pine Tree: organic trunk bending + sweeping wind gusts + branch-tip needle flutter
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vec4 instWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

        // Normalized height (0 at roots -> 1 at 8m treetop) and radial distance from trunk center
        float hNorm = clamp(transformed.y / 8.0, 0.0, 1.0);
        float radialDist = length(transformed.xz);
        float branchFactor = smoothstep(0.18, 1.6, radialDist) * smoothstep(0.08, 0.35, hNorm);

        // Primary rolling wind wave across the forest + secondary gust harmonic
        float windTime = uTime * uWindSpeed;
        float treePhase = instWorld.x * 0.07 + instWorld.z * 0.06 + windTime * 0.75;
        float primaryGust = sin(treePhase) + 0.45 * cos(treePhase * 0.65 - 0.8);

        // Smooth non-linear trunk & canopy bend (anchored solidly at the base)
        float trunkBend = pow(hNorm, 1.65);
        float swayX = primaryGust * uWindStrength * 0.85 * trunkBend;
        float swayZ = cos(treePhase * 0.82) * uWindStrength * 0.6 * trunkBend;

        // High-frequency branch bough & pine needle flutter on outer foliage
        float branchPhase = windTime * 2.3 + transformed.y * 2.1 + (transformed.x + transformed.z) * 2.4 + instWorld.x * 0.25;
        float flutterX = sin(branchPhase) * uWindStrength * 0.26 * branchFactor;
        float flutterY = cos(branchPhase * 1.15) * uWindStrength * 0.16 * branchFactor;
        float flutterZ = sin(branchPhase * 0.9 + 1.2) * uWindStrength * 0.26 * branchFactor;

        transformed.x += swayX + flutterX;
        transformed.y += flutterY - (abs(swayX) + abs(swayZ)) * 0.08 * trunkBend;
        transformed.z += swayZ + flutterZ;
        `
      );
    } else {
      // Procedural broadleaf / rock geometry using uv.y sway weight
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
    }
  };

  mat.onBeforeCompile = injectWind;

  // Custom depth material so dynamic shadows cast on the ground sway in the wind too
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  depthMat.onBeforeCompile = injectWind;
  (mat as THREE.MeshStandardMaterial & { customDepthMaterial?: THREE.MeshDepthMaterial }).customDepthMaterial =
    depthMat;
  mat.needsUpdate = true;
}

/**
 * Shared tree material with gentle canopy wind sway (used for broadleaf trees & shoreline boulders).
 */
export function createTreeMaterial(uniforms: GrassUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.02,
  });

  applyWindShaderToMaterial(mat, uniforms, false);
  return mat;
}

let sharedPineGeo: THREE.BufferGeometry | null = null;
let sharedPineMat: THREE.MeshStandardMaterial | null = null;
let pineLoadStarted = false;
const activePineMeshes = new Set<THREE.InstancedMesh>();

/**
 * Asynchronously loads `3dmodels/pine tree 3d model.glb`, normalizes its transform and scale
 * to ~8.0m tall with roots at Y=0, applies the wind shader to its PBR material, and upgrades
 * all active pine InstancedMeshes across the world.
 */
export function loadPineTreeModel(uniforms: GrassUniforms): void {
  if (pineLoadStarted) return;
  pineLoadStarted = true;

  const loader = new GLTFLoader();
  loader.load(
    pineModelUrl,
    (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      let foundMesh: THREE.Mesh | null = null;
      gltf.scene.traverse((obj) => {
        if (!foundMesh && obj instanceof THREE.Mesh) {
          foundMesh = obj;
        }
      });

      if (!foundMesh) return;
      const mesh = foundMesh as THREE.Mesh;

      // Clone geometry and bake the GLTF node hierarchy transform so it stands upright (Y-up)
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);

      // Strip skinning attributes from the static instanced mesh so Three.js renders it directly
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');

      // Normalize bounding box: center X/Z at 0, place root base at Y=0, and scale to 8.0m height
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const height = Math.max(0.01, box.max.y - box.min.y);
      const targetHeight = 8.2;
      const scaleFactor = targetHeight / height;

      geo.translate(-centerX, -box.min.y, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      // Extract the GLB's textured MeshStandardMaterial and enhance it with wind sway & shadow sway
      const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const pineMat = (origMat as THREE.MeshStandardMaterial).clone();
      pineMat.color.setHex(0xffffff); // Full brightness so baseColorTexture & instanceColor shine
      pineMat.roughness = 0.85;
      pineMat.metalness = 0.02;
      applyWindShaderToMaterial(pineMat, uniforms, true);

      sharedPineGeo = geo;
      sharedPineMat = pineMat;

      const customDepth = (
        pineMat as THREE.MeshStandardMaterial & { customDepthMaterial?: THREE.MeshDepthMaterial }
      ).customDepthMaterial;

      // Hot-swap all currently active pine InstancedMeshes to the loaded 3D GLB model & material
      for (const inst of activePineMeshes) {
        inst.geometry = sharedPineGeo;
        inst.material = sharedPineMat;
        if (customDepth) {
          inst.customDepthMaterial = customDepth;
        }
      }
    },
    undefined,
    (err) => {
      console.error('Failed to load pine tree 3D model:', err);
    }
  );
}

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
      const activeMat = sharedPineMat ?? treeMaterial;
      this.pineInstanced = new THREE.InstancedMesh(
        sharedPineGeo,
        activeMat,
        pineTransforms.length
      );
      this.pineInstanced.castShadow = true;
      this.pineInstanced.receiveShadow = true;
      const customDepth = (
        activeMat as THREE.MeshStandardMaterial & { customDepthMaterial?: THREE.MeshDepthMaterial }
      ).customDepthMaterial;
      if (customDepth) {
        this.pineInstanced.customDepthMaterial = customDepth;
      }
      pineTransforms.forEach((item, idx) => {
        this.pineInstanced!.setMatrixAt(idx, item.matrix);
        this.pineInstanced!.setColorAt(idx, item.tint);
      });
      this.pineInstanced.instanceMatrix.needsUpdate = true;
      if (this.pineInstanced.instanceColor) this.pineInstanced.instanceColor.needsUpdate = true;
      activePineMeshes.add(this.pineInstanced);
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
      const customDepth = (
        treeMaterial as THREE.MeshStandardMaterial & { customDepthMaterial?: THREE.MeshDepthMaterial }
      ).customDepthMaterial;
      if (customDepth) {
        this.broadleafInstanced.customDepthMaterial = customDepth;
      }
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
    if (this.pineInstanced) {
      activePineMeshes.delete(this.pineInstanced);
      this.pineInstanced.dispose();
    }
    this.broadleafInstanced?.dispose();
    this.rockInstanced?.dispose();
  }
}
