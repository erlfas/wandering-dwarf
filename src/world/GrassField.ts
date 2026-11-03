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
  sampleHeightAndNormal(localX: number, localZ: number, outNormal: THREE.Vector3): number;
  sampleColor(localX: number, localZ: number, outColor: THREE.Color): void;
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

      // Smoothly taper grass height to 0 near the outer grass radius so chunks never pop
      float distToPlayer = length(instWorldPos.xz - uPlayerPos.xz);
      float distFade = 1.0 - smoothstep(uMaxDistance * 0.72, uMaxDistance, distToPlayer);
      transformed *= distFade;

      // Rolling wind wave displacement (quadratic bend from root to tip)
      float bendFactor = vBladeFrac * vBladeFrac;
      float wavePhase = instWorldPos.x * 0.14 + instWorldPos.z * 0.11 + uTime * uWindSpeed;
      float gust = sin(wavePhase) + 0.45 * cos(instWorldPos.x * 0.06 - instWorldPos.z * 0.08 + uTime * uWindSpeed * 0.7);
      transformed.x += gust * uWindStrength * bendFactor;
      transformed.z += cos(wavePhase * 0.85) * uWindStrength * 0.65 * bendFactor;

      // Subtle dwarf push-away when walking through the grass
      vec2 toBlade = instWorldPos.xz - uPlayerPos.xz;
      float playerDist = length(toBlade);
      if (playerDist < 1.45 && playerDist > 0.001) {
        float push = (1.0 - playerDist / 1.45) * 0.58 * bendFactor;
        vec2 pushDir = toBlade / playerDist;
        transformed.x += pushDir.x * push;
        transformed.z += pushDir.y * push;
        transformed.y -= push * 0.35;
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

export class ChunkGrass {
  public readonly group = new THREE.Group();
  private grassInstanced?: THREE.InstancedMesh;
  private clumpInstanced?: THREE.InstancedMesh;
  private flowerInstanced?: THREE.InstancedMesh;

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
    if (!sharedTuftGeo) sharedTuftGeo = createGrassTuftGeometry();
    if (!sharedFlowerGeo) sharedFlowerGeo = createWildflowerClusterGeometry();

    const maxCount = Math.floor(config.grassDensity * densityMultiplier);
    if (maxCount <= 0) return;

    // Deterministic per-chunk PRNG
    const chunkSeed = ((cx * 73856093) ^ (cz * 19349663) ^ config.seed) >>> 0;
    const rng = createSeededRandom(chunkSeed);

    const chunkBoundSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), size * 0.85);

    const grassMesh = new THREE.InstancedMesh(sharedTuftGeo, grassMaterial, maxCount);
    grassMesh.castShadow = false;
    grassMesh.receiveShadow = true;
    grassMesh.boundingSphere = chunkBoundSphere;

    // 3D modelled tall grass & seed-head clumps (`3dmodels/grass clump 3d model.glb`)
    // Spawn only on close-range LOD chunks (dist <= 1.5, where densityMultiplier === 1.0)
    const maxClumps =
      densityMultiplier >= 0.9
        ? Math.min(16, Math.max(4, Math.floor(maxCount * 0.008)))
        : 0;
    const clumpMesh =
      maxClumps > 0
        ? new THREE.InstancedMesh(
            sharedClumpGeo ?? sharedTuftGeo,
            sharedClumpMat ?? grassMaterial,
            maxClumps
          )
        : undefined;
    if (clumpMesh) {
      clumpMesh.castShadow = false;
      clumpMesh.receiveShadow = false;
      clumpMesh.boundingSphere = chunkBoundSphere;
    }

    const maxFlowers = config.enableFlowers ? Math.floor(maxCount * 0.075) : 0;
    const flowerMesh =
      maxFlowers > 0
        ? new THREE.InstancedMesh(sharedFlowerGeo, flowerMaterial, maxFlowers)
        : undefined;
    if (flowerMesh) {
      flowerMesh.boundingSphere = chunkBoundSphere;
    }

    const worldOffsetX = cx * size;
    const worldOffsetZ = cz * size;

    let grassIdx = 0;
    let clumpIdx = 0;
    let flowerIdx = 0;

    for (let i = 0; i < maxCount; i++) {
      const lx = (rng() - 0.5) * size;
      const lz = (rng() - 0.5) * size;
      const wx = worldOffsetX + lx;
      const wz = worldOffsetZ + lz;

      // Fast O(1) height & normal lookup from chunk vertex buffer when available
      let wy: number;
      if (sampler) {
        wy = sampler.sampleHeightAndNormal(lx, lz, sharedNormal);
      } else {
        wy = noise.getHeight(wx, wz);
        noise.getNormal(wx, wz, sharedNormal);
      }

      // Skip very steep rocky slopes or underwater/shoreline before evaluating meadow patch or colors
      if (sharedNormal.y < 0.72) continue;
      if (config.enableWater && wy < config.waterLevel + 0.52) continue;

      // Evaluate forest track weight: keep the worn dirt footpath clear while framing its verges
      const trackW = config.enableTracks ? noise.getTrackWeight(wx, wz, wy) : 0;
      if (trackW > 0.44) continue;
      const isTrackVerge = trackW >= 0.06 && trackW <= 0.44;

      const patch = noise.getMeadowPatch(wx, wz);
      // Create natural clumping: lush framing along track verges, natural pockets in open meadows
      const keepProb = isTrackVerge ? 0.88 : 0.35 + patch * 0.65;
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

      const scaleXZ = (0.75 + rng() * 0.65) * (0.85 + patch * 0.3);
      const scaleY =
        (0.65 + rng() * 0.75) *
        (0.75 + patch * 0.45) *
        vergeHeightMod *
        config.grassHeight;
      sharedDummy.scale.set(scaleXZ, scaleY, scaleXZ);
      sharedDummy.updateMatrix();

      grassMesh.setMatrixAt(grassIdx, sharedDummy.matrix);

      // Match the exact terrain surface color with slight per-tuft organic variation
      if (sampler) {
        sampler.sampleColor(lx, lz, sharedBaseColor);
      } else {
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
      grassMesh.setColorAt(grassIdx, sharedBaseColor);
      grassIdx++;

      // Spawn the 3D modelled tall grass clump in lush meadow patches & along track shoulders
      const clumpChance = isTrackVerge && trackW < 0.32 ? 0.11 : 0.055 * (0.6 + patch * 0.8);
      if (
        clumpMesh &&
        clumpIdx < maxClumps &&
        (patch > 0.35 || isTrackVerge) &&
        rng() < clumpChance
      ) {
        const clumpScaleXZ = (0.78 + rng() * 0.52) * (0.85 + patch * 0.3);
        const clumpScaleY =
          (0.75 + rng() * 0.55) *
          (0.85 + patch * 0.35) *
          config.grassHeight;
        sharedDummy.position.set(lx, wy - 0.04, lz);
        sharedDummy.scale.set(clumpScaleXZ, clumpScaleY, clumpScaleXZ);
        sharedDummy.updateMatrix();
        clumpMesh.setMatrixAt(clumpIdx, sharedDummy.matrix);

        // Keep bright natural texture colors with subtle organic warm/cool variation per clump
        sharedClumpColor.setHex(0xffffff).offsetHSL(
          (rng() - 0.5) * 0.035,
          (rng() - 0.5) * 0.08,
          (rng() - 0.5) * 0.07
        );
        clumpMesh.setColorAt(clumpIdx, sharedClumpColor);
        clumpIdx++;
      }

      // Place wildflower blossoms in lush patches & abundantly along track borders (matching art/forest_track.jpg)
      const flowerChance = isTrackVerge ? 0.21 : 0.095;
      if (
        flowerMesh &&
        flowerIdx < maxFlowers &&
        (patch > 0.42 || isTrackVerge) &&
        rng() < flowerChance
      ) {
        sharedDummy.position.set(lx, wy - 0.03, lz);
        sharedDummy.scale.setScalar(0.85 + rng() * 0.55);
        sharedDummy.updateMatrix();
        flowerMesh.setMatrixAt(flowerIdx, sharedDummy.matrix);

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
        flowerMesh.setColorAt(flowerIdx, sharedFlowerColor);
        flowerIdx++;
      }
    }

    if (grassIdx > 0) {
      grassMesh.count = grassIdx;
      grassMesh.instanceMatrix.needsUpdate = true;
      if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
      this.grassInstanced = grassMesh;
      this.group.add(grassMesh);
    } else {
      grassMesh.dispose();
    }

    if (clumpMesh) {
      if (clumpIdx > 0) {
        clumpMesh.count = clumpIdx;
        clumpMesh.instanceMatrix.needsUpdate = true;
        if (clumpMesh.instanceColor) clumpMesh.instanceColor.needsUpdate = true;
        this.clumpInstanced = clumpMesh;
        activeClumpMeshes.add(clumpMesh);
        this.group.add(clumpMesh);
      } else {
        clumpMesh.dispose();
      }
    }

    if (flowerMesh) {
      if (flowerIdx > 0) {
        flowerMesh.count = flowerIdx;
        flowerMesh.instanceMatrix.needsUpdate = true;
        if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
        this.flowerInstanced = flowerMesh;
        this.group.add(flowerMesh);
      } else {
        flowerMesh.dispose();
      }
    }
  }

  public dispose(): void {
    this.grassInstanced?.dispose();
    if (this.clumpInstanced) {
      activeClumpMeshes.delete(this.clumpInstanced);
      this.clumpInstanced.dispose();
    }
    this.flowerInstanced?.dispose();
  }
}
