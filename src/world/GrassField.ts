import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import grassClumpUrl from '../../3dmodels/grass clump 3d model.glb?url';
import { WorldConfig } from './Config';
import { createSeededRandom, TerrainNoise } from './TerrainNoise';

export interface GrassUniforms {
  uTime: { value: number };
  uWindSpeed: { value: number };
  uWindStrength: { value: number };
  uPlayerPos: { value: THREE.Vector3 };
  uMaxDistance: { value: number };
}

export interface ChunkSurfaceSampler {
  sampleHeightAndNormal(
    localX: number,
    localZ: number,
    outNormal: THREE.Vector3,
    outColor?: THREE.Color
  ): number;
  sampleColor(localX: number, localZ: number, outColor: THREE.Color): void;
  sampleTrackWeight?(localX: number, localZ: number): number;
  getElevationBounds?(): { minH: number; maxH: number };
  hasTrack?(): boolean;
}

/**
 * Builds a shared 5-blade stylized grass tuft BufferGeometry.
 * Each blade is a 3-segment curved, tapered ribbon arranged in a natural clump.
 * uv.y goes from 0.0 at the ground root to 1.0 at the blade tip.
 */
function createGrassTuftGeometry(): THREE.BufferGeometry {
  const bladesPerTuft = 5;
  const segments = 3; // 3 vertical quads + 1 tip triangle = 7 vertices per blade

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let b = 0; b < bladesPerTuft; b++) {
    const baseVertex = b * 7;
    const angle = (b / bladesPerTuft) * Math.PI * 2 + (b % 2 === 0 ? 0.22 : -0.18);
    const radiusOffset = b === 0 ? 0.0 : 0.14 + (b % 2) * 0.06;
    const offsetX = Math.cos(angle) * radiusOffset;
    const offsetZ = Math.sin(angle) * radiusOffset;

    // Blade orientation and natural outward lean
    const bladeYaw = angle + 0.35 * ((b % 3) - 1);
    const cosY = Math.cos(bladeYaw);
    const sinY = Math.sin(bladeYaw);
    const lean = 0.14 + (b % 3) * 0.06;
    const heightScale = 0.82 + ((b * 37) % 10) * 0.035;
    const baseHalfWidth = 0.065;

    for (let s = 0; s < segments; s++) {
      const t = s / segments; // 0, 0.33, 0.66
      const y = t * 0.58 * heightScale;
      const curveForward = t * t * lean;
      const halfW = baseHalfWidth * (1.0 - t * 0.55);

      // Left & right points of the ribbon segment in local blade space
      const lx = -halfW;
      const rx = halfW;
      const lz = curveForward;

      // Rotate by bladeYaw and translate by clump offset
      const wLx = offsetX + lx * cosY - lz * sinY;
      const wLz = offsetZ + lx * sinY + lz * cosY;
      const wRx = offsetX + rx * cosY - lz * sinY;
      const wRz = offsetZ + rx * sinY + lz * cosY;

      positions.push(wLx, y, wLz, wRx, y, wRz);
      // Upward-biased normals so grass catches soft sunlight from all angles without harsh backfaces
      normals.push(
        -sinY * 0.25, 0.96, cosY * 0.25,
        -sinY * 0.25, 0.96, cosY * 0.25
      );
      uvs.push(0, t, 1, t);
    }

    // Tip vertex (index + 6)
    const tipY = 0.58 * heightScale;
    const tipForward = lean;
    const tipX = offsetX - tipForward * sinY;
    const tipZ = offsetZ + tipForward * cosY;
    positions.push(tipX, tipY, tipZ);
    normals.push(0, 1, 0);
    uvs.push(0.5, 1.0);

    // Segment quads
    for (let s = 0; s < segments - 1; s++) {
      const row0 = baseVertex + s * 2;
      const row1 = row0 + 2;
      indices.push(row0, row0 + 1, row1);
      indices.push(row0 + 1, row1 + 1, row1);
    }

    // Top triangle to tip
    const lastRow = baseVertex + (segments - 1) * 2;
    const tipIdx = baseVertex + 6;
    indices.push(lastRow, lastRow + 1, tipIdx);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a dense 17-strand tall grass & seed-stalk cluster geometry calibrated to reach
 * the waist (~0.75m - 0.92m) of the ~1.40m tall dwarf.
 * Combines 13 broad, arching waist-high grass ribbons with 4 taller seed-head stalks
 * arranged in concentric rings so adjacent clusters form a thick, continuous sea of grass.
 */
function createTallGrassClusterGeometry(): THREE.BufferGeometry {
  const bladesPerCluster = 17;
  const segments = 3; // 3 vertical quads + 1 tip triangle = 7 vertices per blade

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let b = 0; b < bladesPerCluster; b++) {
    const baseVertex = b * 7;
    const isSeedStalk = b >= 13;

    // Golden-angle spiral distribution for natural, gap-free volume from every viewing angle
    const goldenAngle = b * 2.399963229728653;
    const ringFrac = b === 0 ? 0.0 : Math.sqrt(b / bladesPerCluster);
    const radiusOffset = isSeedStalk
      ? 0.08 + (b - 13) * 0.055
      : ringFrac * 0.31;
    const offsetX = Math.cos(goldenAngle) * radiusOffset;
    const offsetZ = Math.sin(goldenAngle) * radiusOffset;

    // Outward splay + slight organic yaw twist
    const bladeYaw = goldenAngle + ((b % 5) - 2) * 0.24;
    const cosY = Math.cos(bladeYaw);
    const sinY = Math.sin(bladeYaw);

    // Waist-high blade height (~0.74m - 0.88m for main blades, ~0.90m - 0.98m for seed stalks)
    const bladeHeight = isSeedStalk
      ? 0.88 + ((b * 19) % 5) * 0.025
      : 0.72 + ((b * 31) % 9) * 0.02;
    const lean = isSeedStalk
      ? 0.14 + (b % 3) * 0.045
      : 0.17 + (b % 4) * 0.045;
    const baseHalfWidth = isSeedStalk ? 0.046 : 0.058;

    for (let s = 0; s < segments; s++) {
      const t = s / segments; // 0, 0.33, 0.66
      const y = t * bladeHeight;
      const curveForward = t * t * lean;
      // Seed stalks swell slightly near the upper plume before tapering to the tip
      const widthProfile = isSeedStalk && s === 2 ? 0.78 : 1.0 - t * 0.52;
      const halfW = baseHalfWidth * widthProfile;

      const lx = -halfW;
      const rx = halfW;
      const lz = curveForward;

      const wLx = offsetX + lx * cosY - lz * sinY;
      const wLz = offsetZ + lx * sinY + lz * cosY;
      const wRx = offsetX + rx * cosY - lz * sinY;
      const wRz = offsetZ + rx * sinY + lz * cosY;

      positions.push(wLx, y, wLz, wRx, y, wRz);
      normals.push(
        -sinY * 0.28, 0.95, cosY * 0.28,
        -sinY * 0.28, 0.95, cosY * 0.28
      );
      uvs.push(0, t, 1, t);
    }

    // Tip vertex (index + 6)
    const tipY = bladeHeight;
    const tipForward = lean;
    const tipX = offsetX - tipForward * sinY;
    const tipZ = offsetZ + tipForward * cosY;
    positions.push(tipX, tipY, tipZ);
    normals.push(0, 1, 0);
    uvs.push(0.5, 1.0);

    for (let s = 0; s < segments - 1; s++) {
      const row0 = baseVertex + s * 2;
      const row1 = row0 + 2;
      indices.push(row0, row0 + 1, row1);
      indices.push(row0 + 1, row1 + 1, row1);
    }

    const lastRow = baseVertex + (segments - 1) * 2;
    const tipIdx = baseVertex + 6;
    indices.push(lastRow, lastRow + 1, tipIdx);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a tiny 3-blossom wildflower cluster geometry that sits among the grass tufts.
 */
function createWildflowerClusterGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.085, 0.06, 5);
  geo.rotateX(Math.PI); // Open petals upward
  geo.translate(0, 0.42, 0);
  // Set uv.y = 0.85 so flowers sway with the upper part of the grass blades
  const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setY(i, 0.85);
  }
  // Point normals upward for bright, cheerful petal lighting
  const normAttr = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < normAttr.count; i++) {
    normAttr.setXYZ(i, 0, 1, 0);
  }
  return geo;
}

/**
 * Enhances a MeshStandardMaterial with vertex wind waves, dwarf push-away interaction,
 * smooth distance scale fade, and optional root-to-tip AO/sunlit gradient.
 */
export function applyGrassWindShader(
  mat: THREE.MeshStandardMaterial,
  uniforms: GrassUniforms,
  options: { isFlower?: boolean; isModelClump?: boolean } = {}
): void {
  const { isFlower = false, isModelClump = false } = options;

  mat.customProgramCacheKey = () =>
    `grass_wind_${isFlower ? 1 : 0}_${isModelClump ? 1 : 0}`;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uPlayerPos = uniforms.uPlayerPos;
    shader.uniforms.uMaxDistance = uniforms.uMaxDistance;

    shader.vertexShader =
      `
      uniform float uTime;
      uniform float uWindSpeed;
      uniform float uWindStrength;
      uniform vec3 uPlayerPos;
      uniform float uMaxDistance;
      varying float vBladeFrac;
      ` + shader.vertexShader;

    const fracExpr = isModelClump
      ? 'clamp(transformed.y / 0.85, 0.0, 1.0)'
      : 'uv.y';

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vBladeFrac = ${fracExpr};

      // World position of this grass instance's root
      vec4 instWorldPos = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 toBlade = instWorldPos.xz - uPlayerPos.xz;
      float distToPlayer = length(toBlade);

      // Smoothly taper grass height to 0 near the outer grass radius so chunks never pop
      float distFade = 1.0 - smoothstep(uMaxDistance * 0.72, uMaxDistance, distToPlayer);
      transformed *= distFade;

      // Rolling wind wave displacement (quadratic bend from root to tip)
      float bendFactor = vBladeFrac * vBladeFrac;
      float wavePhase = instWorldPos.x * 0.14 + instWorldPos.z * 0.11 + uTime * uWindSpeed;
      float gust = sin(wavePhase) + 0.45 * cos(instWorldPos.x * 0.06 - instWorldPos.z * 0.08 + uTime * uWindSpeed * 0.7);
      transformed.x += gust * uWindStrength * bendFactor;
      transformed.z += cos(wavePhase * 0.85) * uWindStrength * 0.65 * bendFactor;

      // Dwarf push-away when wading through short & waist-high grass
      if (distToPlayer < 1.65 && distToPlayer > 0.001) {
        float push = (1.0 - distToPlayer / 1.65) * 0.68 * bendFactor;
        vec2 pushDir = toBlade / distToPlayer;
        transformed.x += pushDir.x * push;
        transformed.z += pushDir.y * push;
        transformed.y -= push * 0.34;
      }
      `
    );

    if (!isFlower && !isModelClump) {
      shader.fragmentShader =
        `
        varying float vBladeFrac;
        ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        // Root-to-tip gradient: darker mossy root AO blending into warm sunlit tips
        vec3 rootTint = diffuseColor.rgb * 0.58;
        vec3 tipTint = diffuseColor.rgb * vec3(1.22, 1.26, 0.92);
        diffuseColor.rgb = mix(rootTint, tipTint, smoothstep(0.0, 1.0, vBladeFrac));
        `
      );
    } else if (isModelClump) {
      shader.fragmentShader =
        `
        varying float vBladeFrac;
        ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        // Subtle root grounding & sunlit tip highlight on the textured 3D grass clump
        diffuseColor.rgb *= mix(vec3(0.76, 0.78, 0.72), vec3(1.14, 1.16, 1.02), smoothstep(0.0, 1.0, vBladeFrac));
        `
      );
    }
  };
  mat.needsUpdate = true;
}

/**
 * Creates a MeshStandardMaterial enhanced with vertex wind waves, dwarf push interaction,
 * root-to-tip ambient occlusion/sunlit gradient, and smooth distance scale fade.
 */
export function createGrassMaterial(
  uniforms: GrassUniforms,
  isFlower = false
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: isFlower ? 0.55 : 0.78,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  applyGrassWindShader(mat, uniforms, { isFlower, isModelClump: false });
  return mat;
}

// Shared geometries so all chunks reuse the same GPU vertex buffers
let sharedTuftGeo: THREE.BufferGeometry | null = null;
let sharedTallGrassGeo: THREE.BufferGeometry | null = null;
let sharedFlowerGeo: THREE.BufferGeometry | null = null;
let sharedClumpGeo: THREE.BufferGeometry | null = null;
let sharedClumpMat: THREE.MeshStandardMaterial | null = null;
let clumpLoadStarted = false;
const activeClumpMeshes = new Set<THREE.InstancedMesh>();

/**
 * Asynchronously loads `3dmodels/grass clump 3d model.glb`, normalizes its root base at Y=0,
 * preserves its PBR textures, injects the rolling wind & dwarf push shader, and hot-swaps
 * all active 3D grass clump InstancedMeshes across the world.
 */
export function loadGrassClumpModel(uniforms: GrassUniforms): void {
  if (clumpLoadStarted) return;
  clumpLoadStarted = true;

  const loader = new GLTFLoader();
  loader.load(
    grassClumpUrl,
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

      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);

      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const height = Math.max(0.01, box.max.y - box.min.y);
      const targetHeight = 0.85; // ~0.85m tall natural grass & seed-head clump
      const scaleFactor = targetHeight / height;

      geo.translate(-centerX, -box.min.y, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);
      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const clumpMat = (origMat as THREE.MeshStandardMaterial).clone();
      clumpMat.color.setHex(0xffffff);
      clumpMat.roughness = 0.82;
      clumpMat.metalness = 0.02;
      clumpMat.side = THREE.DoubleSide;
      if (clumpMat.normalMap) {
        clumpMat.normalMap.dispose();
        clumpMat.normalMap = null;
      }
      if (clumpMat.roughnessMap) {
        clumpMat.roughnessMap.dispose();
        clumpMat.roughnessMap = null;
      }
      if (clumpMat.metalnessMap) {
        clumpMat.metalnessMap.dispose();
        clumpMat.metalnessMap = null;
      }
      if (clumpMat.aoMap) {
        clumpMat.aoMap.dispose();
        clumpMat.aoMap = null;
      }
      origMat.dispose();
      applyGrassWindShader(clumpMat, uniforms, { isFlower: false, isModelClump: true });

      sharedClumpGeo = geo;
      sharedClumpMat = clumpMat;

      for (const inst of activeClumpMeshes) {
        inst.geometry = sharedClumpGeo;
        inst.material = sharedClumpMat;
      }
    },
    undefined,
    (err) => {
      console.error('Failed to load grass clump 3D model:', err);
    }
  );
}

const FLOWER_PALETTE = [
  new THREE.Color(0xfff9e6), // Crisp meadow daisy white
  new THREE.Color(0xffd633), // Golden buttercup yellow
  new THREE.Color(0x74b9ff), // Sky-blue forget-me-not
  new THREE.Color(0xff9ff3), // Soft pink clover accent
];

const sharedDummy = new THREE.Object3D();
const sharedNormal = new THREE.Vector3();
const sharedBaseColor = new THREE.Color();
const sharedClumpColor = new THREE.Color();
const sharedFlowerColor = new THREE.Color();

// Reusable module-level scratch buffers so ChunkGrass only allocates GPU buffers for actual placed instances
let grassMatBuf = new Float32Array(2600 * 16);
let grassColBuf = new Float32Array(2600 * 3);
let tallMatBuf = new Float32Array(2470 * 16);
let tallColBuf = new Float32Array(2470 * 3);
let clumpMatBuf = new Float32Array(16 * 16);
let clumpColBuf = new Float32Array(16 * 3);
let flowerMatBuf = new Float32Array(450 * 16);
let flowerColBuf = new Float32Array(450 * 3);

function ensureGrassScratchBuffers(
  maxGrass: number,
  maxTall: number,
  maxClumps: number,
  maxFlowers: number
): void {
  if (grassMatBuf.length < maxGrass * 16) {
    grassMatBuf = new Float32Array(maxGrass * 16);
    grassColBuf = new Float32Array(maxGrass * 3);
  }
  if (tallMatBuf.length < maxTall * 16) {
    tallMatBuf = new Float32Array(maxTall * 16);
    tallColBuf = new Float32Array(maxTall * 3);
  }
  if (clumpMatBuf.length < maxClumps * 16) {
    clumpMatBuf = new Float32Array(maxClumps * 16);
    clumpColBuf = new Float32Array(maxClumps * 3);
  }
  if (flowerMatBuf.length < maxFlowers * 16) {
    flowerMatBuf = new Float32Array(maxFlowers * 16);
    flowerColBuf = new Float32Array(maxFlowers * 3);
  }
}

function recordGrassInstance(
  matBuf: Float32Array,
  colBuf: Float32Array,
  idx: number,
  matrix: THREE.Matrix4,
  color: THREE.Color
): void {
  matrix.toArray(matBuf, idx * 16);
  const cIdx = idx * 3;
  colBuf[cIdx] = color.r;
  colBuf[cIdx + 1] = color.g;
  colBuf[cIdx + 2] = color.b;
}

function buildPopulatedGrassInstancedMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  count: number,
  matBuf: Float32Array,
  colBuf: Float32Array,
  boundSphere: THREE.Sphere,
  receiveShadow: boolean
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = false;
  mesh.receiveShadow = receiveShadow;
  mesh.boundingSphere = boundSphere;
  mesh.matrixAutoUpdate = false;
  (mesh.instanceMatrix.array as Float32Array).set(matBuf.subarray(0, count * 16));
  mesh.instanceMatrix.needsUpdate = true;
  const colArray = new Float32Array(count * 3);
  colArray.set(colBuf.subarray(0, count * 3));
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colArray, 3);
  return mesh;
}

export class ChunkGrass {
  public readonly group = new THREE.Group();
  private grassInstanced?: THREE.InstancedMesh;
  private tallGrassInstanced?: THREE.InstancedMesh;
  private clumpInstanced?: THREE.InstancedMesh;
  private flowerInstanced?: THREE.InstancedMesh;
  private fullGrassCount = 0;
  private fullTallGrassCount = 0;
  private fullFlowerCount = 0;

  constructor(
    cx: number,
    cz: number,
    size: number,
    densityMultiplier: number,
    config: WorldConfig,
    noise: TerrainNoise,
    grassMaterial: THREE.Material,
    flowerMaterial: THREE.Material,
    sampler?: ChunkSurfaceSampler
  ) {
    this.group.matrixAutoUpdate = false;
    if (!sharedTuftGeo) sharedTuftGeo = createGrassTuftGeometry();
    if (!sharedTallGrassGeo) sharedTallGrassGeo = createTallGrassClusterGeometry();
    if (!sharedFlowerGeo) sharedFlowerGeo = createWildflowerClusterGeometry();

    // Always build at full capacity (1.0) so LOD transitions (1.0 <-> 0.55 <-> 0.0) only scale .count/.visible in O(1)
    const maxCount = Math.floor(config.grassDensity);
    if (maxCount <= 0) return;

    // Deterministic per-chunk PRNG
    const chunkSeed = ((cx * 73856093) ^ (cz * 19349663) ^ config.seed) >>> 0;
    const rng = createSeededRandom(chunkSeed);

    const bounds = sampler?.getElevationBounds?.();
    const minH = bounds ? bounds.minH : -15;
    const maxH = bounds ? bounds.maxH + 1.5 : 35;
    const centerY = (minH + maxH) * 0.5;
    const halfY = (maxH - minH) * 0.5;
    const halfSize = size * 0.5;
    const radius = Math.sqrt(2 * halfSize * halfSize + halfY * halfY) + 1.2;
    const chunkBoundSphere = new THREE.Sphere(new THREE.Vector3(0, centerY, 0), radius);

    // Dedicated dense waist-high grass strand clusters (~0.75m - 0.92m tall, matching dwarf waist height)
    const maxTallGrass =
      config.tallGrassCoverage > 0.001 ? Math.floor(maxCount * 0.95) : 0;

    // 3D modelled tall grass & seed-head clumps (`3dmodels/grass clump 3d model.glb`)
    // Visible only on close-range LOD chunks (dist <= 1.5, where densityMultiplier >= 0.9)
    const maxClumps = Math.min(6, Math.max(2, Math.floor(maxCount * 0.0025)));

    const maxFlowers = config.enableFlowers ? Math.floor(maxCount * 0.075) : 0;

    ensureGrassScratchBuffers(maxCount, maxTallGrass, maxClumps, maxFlowers);

    const worldOffsetX = cx * size;
    const worldOffsetZ = cz * size;
    const chunkNearTrack =
      config.enableTracks &&
      (sampler?.hasTrack
        ? sampler.hasTrack()
        : noise.getTrackDistance(worldOffsetX, worldOffsetZ) < size * 0.85);

    let grassIdx = 0;
    let tallGrassIdx = 0;
    let clumpIdx = 0;
    let flowerIdx = 0;
    const margin = halfSize - 0.15;

    for (let i = 0; i < maxCount; i++) {
      const lx = (rng() - 0.5) * size;
      const lz = (rng() - 0.5) * size;
      const wx = worldOffsetX + lx;
      const wz = worldOffsetZ + lz;

      // Fast O(1) height, normal & color lookup from chunk vertex buffer when available
      let wy: number;
      if (sampler) {
        wy = sampler.sampleHeightAndNormal(lx, lz, sharedNormal, sharedBaseColor);
      } else {
        wy = noise.getHeight(wx, wz);
        noise.getNormal(wx, wz, sharedNormal);
      }

      // Skip very steep rocky slopes or underwater/shoreline before evaluating meadow patch or colors
      if (sharedNormal.y < 0.72) continue;
      if (config.enableWater && wy < config.waterLevel + 0.52) continue;

      // Evaluate forest track weight: keep the worn dirt footpath clear while framing its verges
      const trackW = chunkNearTrack
        ? sampler?.sampleTrackWeight
          ? sampler.sampleTrackWeight(lx, lz)
          : noise.getTrackWeight(wx, wz, wy)
        : 0;
      if (trackW > 0.44) continue;
      const isTrackVerge = trackW >= 0.06 && trackW <= 0.44;

      const patch = noise.getMeadowPatch(wx, wz);

      // Evaluate dense waist-high grass zone factor, tapering smoothly off footpaths and steep slopes
      let tallGrass = noise.getTallGrassFactor(wx, wz);
      if (tallGrass > 0) {
        if (trackW > 0.16) {
          tallGrass *= 1.0 - THREE.MathUtils.clamp((trackW - 0.16) / 0.22, 0, 1);
        }
        if (sharedNormal.y < 0.84) {
          tallGrass *= THREE.MathUtils.clamp((sharedNormal.y - 0.72) / 0.12, 0, 1);
        }
      }

      // Create natural clumping: high retention in tall-grass areas & track verges
      const keepProb = isTrackVerge
        ? 0.88
        : Math.max(0.35 + patch * 0.65, tallGrass > 0.05 ? 0.55 + tallGrass * 0.43 : 0);
      if (rng() > keepProb) continue;

      sharedDummy.position.set(lx, wy - 0.03, lz);
      sharedDummy.rotation.set(
        (rng() - 0.5) * 0.15,
        rng() * Math.PI * 2,
        (rng() - 0.5) * 0.15
      );

      // Taper grass height down smoothly at the inner dirt edge; boost lushness on the outer shoulder
      const vergeHeightMod = isTrackVerge
        ? trackW > 0.3
          ? THREE.MathUtils.lerp(1.05, 0.45, (trackW - 0.3) / 0.14)
          : 1.18
        : 1.0;

      // Smoothly ramp understory grass height into tall-grass zones so patch borders blend organically
      const tallUnderstoryBoost = 1.0 + tallGrass * 0.42;
      const scaleXZ = (0.75 + rng() * 0.65) * (0.85 + patch * 0.3) * (1.0 + tallGrass * 0.25);
      const scaleY =
        (0.65 + rng() * 0.75) *
        (0.75 + patch * 0.45) *
        vergeHeightMod *
        tallUnderstoryBoost *
        config.grassHeight;
      sharedDummy.scale.set(scaleXZ, scaleY, scaleXZ);
      sharedDummy.updateMatrix();

      // Match the exact terrain surface color with slight per-tuft organic variation
      if (!sampler) {
        noise.getSurfaceColor(wx, wy, wz, sharedNormal, sharedBaseColor);
      }
      // Ensure grass on the inner track verge stays vibrant meadow green rather than dirt brown
      if (trackW > 0.22) {
        sharedBaseColor.lerp(sharedClumpColor.setHex(0x5c8234), 0.65);
      }
      sharedBaseColor.offsetHSL(
        (rng() - 0.5) * 0.03,
        (rng() - 0.5) * 0.08,
        (rng() - 0.5) * 0.06
      );
      recordGrassInstance(grassMatBuf, grassColBuf, grassIdx++, sharedDummy.matrix, sharedBaseColor);

      // Spawn dense, overlapping waist-high grass strand clusters (~0.75m - 0.92m) inside tall-grass areas
      if (maxTallGrass > 0 && tallGrassIdx < maxTallGrass && tallGrass > 0.08) {
        // Place 1 to 3 closely packed 17-blade clusters per sample to form a thick, continuous waist-high bed
        const subCount = tallGrass > 0.52 ? 3 : tallGrass > 0.25 ? 2 : 1;
        for (let sc = 0; sc < subCount && tallGrassIdx < maxTallGrass; sc++) {
          const jx = sc === 0 ? lx : THREE.MathUtils.clamp(lx + (rng() - 0.5) * 0.82, -margin, margin);
          const jz = sc === 0 ? lz : THREE.MathUtils.clamp(lz + (rng() - 0.5) * 0.82, -margin, margin);

          let jy = wy;
          if (sc > 0 && sampler) {
            jy = sampler.sampleHeightAndNormal(jx, jz, sharedNormal);
            if (sharedNormal.y < 0.75) continue;
            if (config.enableWater && jy < config.waterLevel + 0.55) continue;
          }

          // Calibrated so full tall-grass zones reach ~0.75m - 0.92m (right at the 1.40m dwarf's waist)
          const heightRamp = THREE.MathUtils.lerp(0.62, 1.04, tallGrass);
          const tallScaleXZ = (0.92 + rng() * 0.38) * (0.88 + tallGrass * 0.24);
          const tallScaleY = (0.88 + rng() * 0.24) * heightRamp * config.grassHeight;

          sharedDummy.position.set(jx, jy - 0.035, jz);
          sharedDummy.rotation.set(
            (rng() - 0.5) * 0.14,
            rng() * Math.PI * 2,
            (rng() - 0.5) * 0.14
          );
          sharedDummy.scale.set(tallScaleXZ, tallScaleY, tallScaleXZ);
          sharedDummy.updateMatrix();

          // Rich sunlit golden-green meadow tint for waist-high grass strands
          sharedClumpColor.copy(sharedBaseColor).offsetHSL(
            (rng() - 0.45) * 0.035,
            0.03 + (rng() - 0.5) * 0.06,
            0.02 + (rng() - 0.5) * 0.05
          );
          recordGrassInstance(
            tallMatBuf,
            tallColBuf,
            tallGrassIdx++,
            sharedDummy.matrix,
            sharedClumpColor
          );
        }
      }

      // Spawn the 3D modelled tall grass clump in tall-grass areas, lush meadow patches & along track shoulders
      const clumpChance =
        tallGrass > 0.2
          ? 0.095 * (0.5 + tallGrass * 0.8)
          : isTrackVerge && trackW < 0.32
          ? 0.11
          : 0.055 * (0.6 + patch * 0.8);
      if (
        maxClumps > 0 &&
        clumpIdx < maxClumps &&
        (tallGrass > 0.2 || patch > 0.35 || isTrackVerge) &&
        rng() < clumpChance
      ) {
        const clumpScaleXZ =
          (0.78 + rng() * 0.52) * (0.85 + Math.max(patch, tallGrass) * 0.32);
        const clumpScaleY =
          (0.82 + rng() * 0.45) *
          (0.85 + Math.max(patch, tallGrass) * 0.32) *
          config.grassHeight;
        sharedDummy.position.set(lx, wy - 0.04, lz);
        sharedDummy.scale.set(clumpScaleXZ, clumpScaleY, clumpScaleXZ);
        sharedDummy.updateMatrix();

        // Keep bright natural texture colors with subtle organic warm/cool variation per clump
        sharedClumpColor.setHex(0xffffff).offsetHSL(
          (rng() - 0.5) * 0.035,
          (rng() - 0.5) * 0.08,
          (rng() - 0.5) * 0.07
        );
        recordGrassInstance(
          clumpMatBuf,
          clumpColBuf,
          clumpIdx++,
          sharedDummy.matrix,
          sharedClumpColor
        );
      }

      // Place wildflower blossoms in lush patches & abundantly along track borders (matching art/forest_track.jpg)
      const flowerChance = isTrackVerge ? 0.21 : 0.095;
      if (
        maxFlowers > 0 &&
        flowerIdx < maxFlowers &&
        (patch > 0.42 || isTrackVerge) &&
        rng() < flowerChance
      ) {
        sharedDummy.position.set(lx, wy - 0.03, lz);
        sharedDummy.scale.setScalar(0.85 + rng() * 0.55);
        sharedDummy.updateMatrix();

        // Along track verges, emphasize golden buttercups, white daisies, and sky-blue forget-me-nots
        const rPick = rng();
        const palettePick = isTrackVerge
          ? rPick < 0.44
            ? FLOWER_PALETTE[1] // Golden buttercup yellow (prominent in art/forest_track.jpg)
            : rPick < 0.78
            ? FLOWER_PALETTE[0] // Crisp daisy white
            : rPick < 0.96
            ? FLOWER_PALETTE[2] // Sky-blue forget-me-not
            : FLOWER_PALETTE[3]
          : rPick < 0.48
          ? FLOWER_PALETTE[0]
          : rPick < 0.82
          ? FLOWER_PALETTE[1]
          : rPick < 0.94
          ? FLOWER_PALETTE[2]
          : FLOWER_PALETTE[3];
        sharedFlowerColor.copy(palettePick);
        recordGrassInstance(
          flowerMatBuf,
          flowerColBuf,
          flowerIdx++,
          sharedDummy.matrix,
          sharedFlowerColor
        );
      }
    }

    this.fullGrassCount = grassIdx;
    this.fullTallGrassCount = tallGrassIdx;
    this.fullFlowerCount = flowerIdx;

    if (grassIdx > 0) {
      this.grassInstanced = buildPopulatedGrassInstancedMesh(
        sharedTuftGeo,
        grassMaterial,
        grassIdx,
        grassMatBuf,
        grassColBuf,
        chunkBoundSphere,
        true
      );
      this.group.add(this.grassInstanced);
    }

    if (tallGrassIdx > 0) {
      this.tallGrassInstanced = buildPopulatedGrassInstancedMesh(
        sharedTallGrassGeo,
        grassMaterial,
        tallGrassIdx,
        tallMatBuf,
        tallColBuf,
        chunkBoundSphere,
        true
      );
      this.group.add(this.tallGrassInstanced);
    }

    if (clumpIdx > 0) {
      this.clumpInstanced = buildPopulatedGrassInstancedMesh(
        sharedClumpGeo ?? sharedTuftGeo,
        sharedClumpMat ?? grassMaterial,
        clumpIdx,
        clumpMatBuf,
        clumpColBuf,
        chunkBoundSphere,
        false
      );
      activeClumpMeshes.add(this.clumpInstanced);
      this.group.add(this.clumpInstanced);
    }

    if (flowerIdx > 0) {
      this.flowerInstanced = buildPopulatedGrassInstancedMesh(
        sharedFlowerGeo,
        flowerMaterial,
        flowerIdx,
        flowerMatBuf,
        flowerColBuf,
        chunkBoundSphere,
        false
      );
      this.group.add(this.flowerInstanced);
    }

    this.setDensityMultiplier(densityMultiplier);
  }

  public setDensityMultiplier(densityMultiplier: number): void {
    if (densityMultiplier <= 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const ratio = THREE.MathUtils.clamp(densityMultiplier, 0, 1);
    if (this.grassInstanced) {
      this.grassInstanced.count = Math.floor(this.fullGrassCount * ratio);
    }
    if (this.tallGrassInstanced) {
      this.tallGrassInstanced.count = Math.floor(this.fullTallGrassCount * ratio);
    }
    if (this.flowerInstanced) {
      this.flowerInstanced.count = Math.floor(this.fullFlowerCount * ratio);
    }
    if (this.clumpInstanced) {
      this.clumpInstanced.visible = densityMultiplier >= 0.9;
    }
  }

  public dispose(): void {
    this.grassInstanced?.dispose();
    this.tallGrassInstanced?.dispose();
    if (this.clumpInstanced) {
      activeClumpMeshes.delete(this.clumpInstanced);
      this.clumpInstanced.dispose();
    }
    this.flowerInstanced?.dispose();
  }
}
