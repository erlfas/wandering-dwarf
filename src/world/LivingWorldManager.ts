import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import fantasyGoblinModelUrl from '../../3dmodels/fantasy goblin 3d model.glb?url';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { getSharedAudioContext } from '../player/RelicStore';
import { WorldConfig } from './Config';
import { createOptimizedGlbLoader } from './ForestField';
import { createSeededRandom, TerrainNoise } from './TerrainNoise';

interface StarFragmentInstance {
  worldPos: THREE.Vector3;
  collected: boolean;
  mesh: THREE.Group;
  crystal: THREE.Mesh;
  ring: THREE.Mesh;
}

interface BirdFlockInstance {
  origin: THREE.Vector3;
  scared: boolean;
  flightTime: number;
  birds: THREE.Mesh[];
  group: THREE.Group;
}

interface SpiritRabbitInstance {
  pos: THREE.Vector3;
  targetPos: THREE.Vector3;
  rewarded: boolean;
  hopPhase: number;
  mesh: THREE.Mesh;
}

export interface GoblinBones {
  spine: THREE.Bone;
  head: THREE.Bone;
  leftArm: THREE.Bone;
  leftForeArm: THREE.Bone;
  rightArm: THREE.Bone;
  rightForeArm: THREE.Bone;
  baseLeftArmX: number;
  baseRightArmX: number;
  baseLeftForeArmZ: number;
  baseRightForeArmZ: number;
}

export type GoblinRole = 'cutpurse' | 'bombardier';

export interface GoblinHazardInstance {
  role: GoblinRole;
  centerPos: THREE.Vector3;
  pos: THREE.Vector3;
  orbitAngle: number;
  orbitRadius: number;
  bombCooldown: number;
  defeated: boolean;
  flyTime: number;
  mesh: THREE.Group;
  bodyMesh: THREE.Mesh;
  headMesh: THREE.Mesh;
  glbMesh?: THREE.Mesh;
  modelGroup?: THREE.Group;
  bones?: GoblinBones;
  isNearLOD?: boolean;
}

export interface GoblinBomb {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuseTimer: number;
  mesh: THREE.Group;
  bodyMesh: THREE.Mesh;
  sparkMesh: THREE.Mesh;
}

interface ChunkLivingEntities {
  starFragment?: StarFragmentInstance;
  birdFlock?: BirdFlockInstance;
  spiritRabbit?: SpiritRabbitInstance;
  goblin?: GoblinHazardInstance;
  goblins?: GoblinHazardInstance[];
}

interface SharedLivingAssets {
  matStarCrystal: THREE.MeshStandardMaterial;
  matStarRing: THREE.MeshBasicMaterial;
  matBird: THREE.MeshStandardMaterial;
  matSpirit: THREE.MeshStandardMaterial;
  matGoblinSkin: THREE.MeshStandardMaterial;
  matGoblinTunic: THREE.MeshStandardMaterial;
  matGoldSack: THREE.MeshStandardMaterial;
  matBomb: THREE.MeshStandardMaterial;
  matBombFuse: THREE.MeshBasicMaterial;
  starCrystalGeo: THREE.BufferGeometry;
  starRingGeo: THREE.BufferGeometry;
  birdGeo: THREE.BufferGeometry;
  spiritBodyGeo: THREE.BufferGeometry;
  spiritRabbitGeo: THREE.BufferGeometry;
  goblinBodyGeo: THREE.BufferGeometry;
  goblinHeadGeo: THREE.BufferGeometry;
  bombGeo: THREE.BufferGeometry;
}

let sharedGoblinTemplate: THREE.Group | null = null;
let sharedGoblinGeo: THREE.BufferGeometry | null = null;
let sharedGoblinMat: THREE.MeshStandardMaterial | null = null;
let goblinLoadStarted = false;
const onGoblinLoadedCallbacks: Array<() => void> = [];

/**
 * Asynchronously loads and optimizes `3dmodels/fantasy goblin 3d model.glb` (`17,707` tris, `8.44 MB` textures):
 * - Strips `KHR_materials_specular` and secondary PBR textures via `createOptimizedGlbLoader()`.
 * - Downscales baseColor to 1024x1024 ImageBitmap.
 * - Deletes unused `skinIndex` and `skinWeight` attributes for static chunk hazards.
 * - Centers X/Z, aligns base at Y = 0, scales to 1.05m standing height.
 * - Guards `computeVertexNormals()` and welds unindexed vertices.
 * - Caches module-scope geometry/material singletons for close-range (`dist <= 45m`) LOD.
 */
export function loadGoblinModel(onLoaded?: () => void): void {
  if (sharedGoblinGeo && sharedGoblinMat) {
    onLoaded?.();
    return;
  }
  if (onLoaded) {
    onGoblinLoadedCallbacks.push(onLoaded);
  }
  if (goblinLoadStarted) return;
  goblinLoadStarted = true;

  const loader = createOptimizedGlbLoader();
  loader.load(
    fantasyGoblinModelUrl,
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

      let geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');

      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const spanY = Math.max(0.01, box.max.y - box.min.y);
      const scaleFactor = 1.05 / spanY;

      geo.translate(-centerX, -box.min.y, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);

      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      if (!geo.index) {
        const welded = mergeVertices(geo, 1e-4);
        if (welded !== geo) {
          geo.dispose();
          geo = welded;
        }
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const origMat = (
        Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      ) as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: origMat.map ?? null,
        roughness: 0.72,
        metalness: 0.15,
      });
      if (origMat.normalMap && origMat.normalMap !== origMat.map) origMat.normalMap.dispose();
      if (origMat.roughnessMap && origMat.roughnessMap !== origMat.map) origMat.roughnessMap.dispose();
      if (origMat.metalnessMap && origMat.metalnessMap !== origMat.map) origMat.metalnessMap.dispose();
      if (origMat.aoMap && origMat.aoMap !== origMat.map) origMat.aoMap.dispose();
      origMat.dispose();

      sharedGoblinGeo = geo;
      sharedGoblinMat = mat;
      mesh.material = mat;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      sharedGoblinTemplate = gltf.scene;
      for (const cb of onGoblinLoadedCallbacks) {
        cb();
      }
      onGoblinLoadedCallbacks.length = 0;
    },
    undefined,
    (err) => {
      console.error('Failed to load fantasy goblin 3D model:', err);
    }
  );
}

export function createGoblinInstance(): {
  group: THREE.Group;
  bones?: GoblinBones;
} | null {
  if (!sharedGoblinTemplate) return null;
  const group = cloneSkeleton(sharedGoblinTemplate) as THREE.Group;
  // Scale goblin to 1.05m tall (base height 0.61m -> scale 1.72)
  group.scale.setScalar(1.72);
  group.position.y = -0.088; // align feet to ground at Y = 0

  const bones: Partial<GoblinBones> = {};
  group.traverse((obj) => {
    if (obj instanceof THREE.Bone) {
      if (obj.name === 'mixamorigSpine' || obj.name.endsWith('Spine')) bones.spine = obj;
      else if (obj.name === 'mixamorigHead' || obj.name.endsWith('Head')) bones.head = obj;
      else if (obj.name === 'mixamorigLeftArm' || obj.name.endsWith('LeftArm')) bones.leftArm = obj;
      else if (obj.name === 'mixamorigRightArm' || obj.name.endsWith('RightArm')) bones.rightArm = obj;
      else if (obj.name === 'mixamorigLeftForeArm' || obj.name.endsWith('LeftForeArm')) bones.leftForeArm = obj;
      else if (obj.name === 'mixamorigRightForeArm' || obj.name.endsWith('RightForeArm')) bones.rightForeArm = obj;
    }
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });

  if (bones.leftArm && bones.rightArm && bones.leftForeArm && bones.rightForeArm) {
    // Bring arms down from the rigid horizontal T-pose into an active crouching posture
    bones.leftArm.rotateX(-1.05);
    bones.rightArm.rotateX(1.05);
    bones.leftForeArm.rotateZ(0.5);
    bones.rightForeArm.rotateZ(-0.5);
    if (bones.spine) bones.spine.rotateX(0.22); // Sneaky hunchback posture

    const fullBones: GoblinBones = {
      spine: bones.spine!,
      head: bones.head!,
      leftArm: bones.leftArm,
      leftForeArm: bones.leftForeArm,
      rightArm: bones.rightArm,
      rightForeArm: bones.rightForeArm,
      baseLeftArmX: bones.leftArm.rotation.x,
      baseRightArmX: bones.rightArm.rotation.x,
      baseLeftForeArmZ: bones.leftForeArm.rotation.z,
      baseRightForeArmZ: bones.rightForeArm.rotation.z,
    };
    return { group, bones: fullBones };
  }
  return { group };
}

let sharedLivingAssets: SharedLivingAssets | null = null;

// Sky & Lighting keyframe colors
const SKY_DAWN = new THREE.Color(0xf2b89b);
const SKY_DAY = new THREE.Color(0xd7e3ec);
const SKY_SUNSET = new THREE.Color(0xd98a6c);
const SKY_NIGHT = new THREE.Color(0x0d1626);

const SUN_DAWN = new THREE.Color(0xffb570);
const SUN_DAY = new THREE.Color(0xfff5e4);
const SUN_SUNSET = new THREE.Color(0xff7b47);
const MOON_NIGHT = new THREE.Color(0x7da8e6);

const HEMI_SKY_DAY = new THREE.Color(0xeaf4ff);
const HEMI_SKY_NIGHT = new THREE.Color(0x1b2b4a);
const HEMI_GND_DAY = new THREE.Color(0x6b7f4e);
const HEMI_GND_NIGHT = new THREE.Color(0x16211c);

function getSharedLivingAssets(): SharedLivingAssets {
  if (sharedLivingAssets) return sharedLivingAssets;

  const matStarCrystal = new THREE.MeshStandardMaterial({
    color: 0x9bf6ff,
    roughness: 0.15,
    metalness: 0.85,
    emissive: 0x48cae4,
    emissiveIntensity: 1.25,
  });

  const matStarRing = new THREE.MeshBasicMaterial({
    color: 0x90e0ef,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.65,
  });

  const matBird = new THREE.MeshStandardMaterial({
    color: 0xf4f1de,
    roughness: 0.7,
    metalness: 0.05,
  });

  const matSpirit = new THREE.MeshStandardMaterial({
    color: 0xd8f3dc,
    roughness: 0.3,
    metalness: 0.1,
    emissive: 0x52b788,
    emissiveIntensity: 0.75,
  });

  const matGoblinSkin = new THREE.MeshStandardMaterial({
    color: 0x6a994e,
    roughness: 0.75,
    metalness: 0.05,
  });

  const matGoblinTunic = new THREE.MeshStandardMaterial({
    color: 0x78290f,
    roughness: 0.85,
    metalness: 0.08,
  });

  const matGoldSack = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    roughness: 0.35,
    metalness: 0.7,
    emissive: 0x5c4300,
    emissiveIntensity: 0.35,
  });

  const starCrystalGeo = new THREE.OctahedronGeometry(0.42, 0);
  starCrystalGeo.scale(0.8, 1.45, 0.8);

  const starRingGeo = new THREE.RingGeometry(0.65, 0.92, 20);
  starRingGeo.rotateX(-Math.PI / 2);

  const birdGeo = new THREE.ConeGeometry(0.18, 0.42, 4);
  birdGeo.rotateX(Math.PI / 2);
  birdGeo.scale(1.6, 0.45, 1.0);

  const spiritBodyGeo = new THREE.SphereGeometry(0.28, 10, 8);
  spiritBodyGeo.scale(0.85, 0.85, 1.2);
  spiritBodyGeo.translate(0, 0.25, 0);

  const spiritEarGeo = new THREE.BoxGeometry(0.08, 0.32, 0.08);
  spiritEarGeo.translate(0, 0.52, 0.08);

  const spiritBodyClone = spiritBodyGeo.clone();
  const spiritRabbitGeo = mergeGeometries([spiritBodyClone, spiritEarGeo], false);
  spiritBodyClone.dispose();
  spiritEarGeo.dispose();
  spiritRabbitGeo.computeBoundingBox();
  spiritRabbitGeo.computeBoundingSphere();

  const goblinBodyGeo = new THREE.ConeGeometry(0.36, 0.72, 7);
  goblinBodyGeo.translate(0, 0.36, 0);

  const goblinHeadGeo = new THREE.SphereGeometry(0.24, 8, 8);
  goblinHeadGeo.translate(0, 0.82, 0);

  const matBomb = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.65,
    metalness: 0.55,
  });

  const matBombFuse = new THREE.MeshBasicMaterial({
    color: 0xff9900,
  });

  const bombBall = new THREE.SphereGeometry(0.22, 8, 6);
  const fuseCap = new THREE.CylinderGeometry(0.04, 0.05, 0.09, 5);
  fuseCap.translate(0, 0.22, 0);
  const bombGeo = mergeGeometries([bombBall, fuseCap], false);
  bombBall.dispose();
  fuseCap.dispose();
  bombGeo.computeBoundingBox();
  bombGeo.computeBoundingSphere();

  sharedLivingAssets = {
    matStarCrystal,
    matStarRing,
    matBird,
    matSpirit,
    matGoblinSkin,
    matGoblinTunic,
    matGoldSack,
    matBomb,
    matBombFuse,
    starCrystalGeo,
    starRingGeo,
    birdGeo,
    spiritBodyGeo,
    spiritRabbitGeo,
    goblinBodyGeo,
    goblinHeadGeo,
    bombGeo,
  };
  return sharedLivingAssets;
}

/**
 * Manages the Living World, Dynamic Day/Night Cycle, Dwarven Lantern, Starfield Dome,
 * Nightfall Star-Fragments, Ambient Wildlife (Bird Flocks & Guiding Forest Spirits),
 * and Interactive Hazards (Rolling Hillside Boulders & Goblin Cutpurses).
 */
export class LivingWorldManager {
  public readonly group = new THREE.Group();
  private activeChunks = new Map<number, ChunkLivingEntities>();
  private activeGoblins: GoblinHazardInstance[] = [];
  private desiredKeys = new Set<number>();
  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;

  // Starfield dome & Dwarven Belt Lantern
  private starDome!: THREE.Points;
  private starMat!: THREE.PointsMaterial;
  private dwarfLanternLight!: THREE.PointLight;
  private dwarfLanternMesh!: THREE.Mesh;
  private isNight = false;
  private hazardHitCooldown = 0;
  private getSurfaceHeightFn?: (wx: number, wz: number) => number;
  private readonly skyHorizonColor: THREE.Color;

  // Active Goblin Bombs Pool
  private bombPool: GoblinBomb[] = [];

  public cameraShakeFn?: (intensity: number, duration: number) => void;
  public onApplyPlayerDamage?: (damage: number, sourceTitle: string) => void;
  public onShieldBlockSound?: () => void;
  public onGrantFoodRation?: (count: number) => void;

  constructor(
    private config: WorldConfig,
    private noise: TerrainNoise,
    private scene: THREE.Scene,
    private dirLight: THREE.DirectionalLight,
    private hemiLight: THREE.HemisphereLight,
    private fog: THREE.FogExp2,
    private dwarf: DwarfCharacter,
    private onGrantOrDeductGold: (deltaGold: number, message: string, isPositive: boolean) => void,
    private onSyncGui?: () => void
  ) {
    this.group.matrixAutoUpdate = false;
    this.skyHorizonColor =
      this.scene.background instanceof THREE.Color
        ? this.scene.background
        : new THREE.Color(0xd7e3ec);
    this.buildStarfieldDome();
    this.attachDwarfLantern();

    // Initialize 8 reusable Goblin Bombs in pool
    const assets = getSharedLivingAssets();
    for (let i = 0; i < 8; i++) {
      const bombGroup = new THREE.Group();
      bombGroup.visible = false;
      const body = new THREE.Mesh(assets.bombGeo, assets.matBomb.clone());
      body.castShadow = true;
      bombGroup.add(body);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), assets.matBombFuse);
      spark.position.set(0, 0.28, 0);
      bombGroup.add(spark);
      this.group.add(bombGroup);
      this.bombPool.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        fuseTimer: 0,
        mesh: bombGroup,
        bodyMesh: body,
        sparkMesh: spark,
      });
    }

    loadGoblinModel(() => {
      for (const ent of this.activeChunks.values()) {
        const gobs = ent.goblins ?? (ent.goblin ? [ent.goblin] : []);
        for (const g of gobs) {
          if (!g.modelGroup) {
            const inst = createGoblinInstance();
            if (inst) {
              g.modelGroup = inst.group;
              g.bones = inst.bones;
              g.mesh.add(inst.group);
              if (g.glbMesh) g.glbMesh.visible = false;
            }
          }
          if (g.modelGroup) {
            if (g.isNearLOD) {
              g.modelGroup.visible = true;
              g.bodyMesh.visible = false;
              g.headMesh.visible = false;
            } else {
              g.modelGroup.visible = false;
              g.bodyMesh.visible = true;
              g.headMesh.visible = true;
            }
          } else if (g.glbMesh && sharedGoblinGeo && sharedGoblinMat) {
            g.glbMesh.geometry = sharedGoblinGeo;
            g.glbMesh.material = sharedGoblinMat;
            if (g.isNearLOD) {
              g.glbMesh.visible = true;
              g.bodyMesh.visible = false;
              g.headMesh.visible = false;
            }
          }
        }
      }
    });

    // Press N to jump between Morning -> Sunset -> Starry Night -> Dawn
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyN') {
        this.cycleTimeOfDayPreset();
      }
    });
  }

  public setSurfaceHeightSampler(fn: (wx: number, wz: number) => number): void {
    this.getSurfaceHeightFn = fn;
  }

  private sampleGroundHeight(wx: number, wz: number): number {
    return this.getSurfaceHeightFn ? this.getSurfaceHeightFn(wx, wz) : this.noise.getHeight(wx, wz);
  }

  private getKey(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  public cycleTimeOfDayPreset(): void {
    const t = this.config.timeOfDay;
    let label = '';
    if (t >= 7 && t < 16.5) {
      this.config.timeOfDay = 18.2;
      label = '🌅 Golden Hour Sunset (18:12)';
    } else if (t >= 16.5 && t < 20.5) {
      this.config.timeOfDay = 23.5;
      label = '🌌 Starry Night & Lantern Lit (23:30)';
    } else if (t >= 20.5 || t < 5.5) {
      this.config.timeOfDay = 6.25;
      label = '🌄 Misty Dawn (06:15)';
    } else {
      this.config.timeOfDay = 10.5;
      label = '☀️ Sunlit Morning (10:30)';
    }
    this.onSyncGui?.();
    this.onGrantOrDeductGold(0, `${label} — Press N to cycle`, true);
  }

  private buildStarfieldDome(): void {
    const starCount = 300;
    const positions = new Float32Array(starCount * 3);
    const rng = createSeededRandom(7777);

    for (let i = 0; i < starCount; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = rng() * Math.PI * 0.44; // Upper hemisphere
      const r = 380;
      positions[i * 3] = Math.cos(theta) * Math.sin(phi) * r;
      positions[i * 3 + 1] = Math.cos(phi) * r + 25;
      positions[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * r;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xe0f2fe,
      size: 2.2,
      transparent: true,
      opacity: 0.0,
      fog: false,
      depthWrite: false,
    });
    this.starDome = new THREE.Points(geo, this.starMat);
    this.starDome.frustumCulled = false;
    this.starDome.visible = false;
    this.scene.add(this.starDome);
  }

  private attachDwarfLantern(): void {
    // Keep dwarfLanternLight visible outdoors (intensity = 0 by day) so NUM_POINT_LIGHTS stays 1 everywhere
    this.dwarfLanternLight = new THREE.PointLight(0xffaa33, 0, 26, 1.4);
    this.dwarfLanternLight.position.set(0.42, 1.15, 0.35);
    this.dwarfLanternLight.visible = true;
    this.dwarf.root.add(this.dwarfLanternLight);

    const lanternGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.24, 6);
    const lanternMat = new THREE.MeshBasicMaterial({
      color: 0xffd166,
    });
    this.dwarfLanternMesh = new THREE.Mesh(lanternGeo, lanternMat);
    this.dwarfLanternMesh.position.set(0.38, 0.82, 0.25);
    this.dwarfLanternMesh.visible = false;
    this.dwarf.root.add(this.dwarfLanternMesh);
  }

  private insideInterior = false;

  public setInsideInterior(inside: boolean): void {
    if (this.insideInterior === inside) return;
    this.insideInterior = inside;
    this.dwarfLanternLight.visible = !inside;
    if (inside) {
      this.dwarfLanternMesh.visible = false;
      this.starDome.visible = false;
    }
  }

  public getSkyHorizonColor(): THREE.Color {
    return this.skyHorizonColor;
  }

  public update(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    isPlayerAttackingOrAirborne: boolean,
    sunOffsetOut: THREE.Vector3
  ): void {
    if (this.hazardHitCooldown > 0) {
      this.hazardHitCooldown = Math.max(0, this.hazardHitCooldown - dt);
    }

    // 1. Advance Time-of-Day & Atmospheric Lighting
    if (this.config.enableDayNightCycle) {
      // Full 24h cycle in ~240 seconds (0.1 hours per second)
      this.config.timeOfDay = (this.config.timeOfDay + dt * 0.1) % 24.0;
    }
    this.updateAtmosphereAndLantern(elapsedTime, playerPos, sunOffsetOut);

    // 2. Stream Living World entities per chunk
    const size = this.config.chunkSize;
    const r = Math.min(this.config.renderRadius, 4); // Keep wildlife/hazards within 4 chunks for O(1) speed
    const centerCx = Math.round(playerPos.x / size);
    const centerCz = Math.round(playerPos.z / size);

    if (centerCx !== this.lastCenterCx || centerCz !== this.lastCenterCz) {
      this.lastCenterCx = centerCx;
      this.lastCenterCz = centerCz;

      const desiredKeys = this.desiredKeys;
      desiredKeys.clear();

      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > (r + 0.5) * (r + 0.5)) continue;
          const cx = centerCx + dx;
          const cz = centerCz + dz;
          const key = this.getKey(cx, cz);
          desiredKeys.add(key);

          if (!this.activeChunks.has(key)) {
            this.spawnEntitiesForChunk(cx, cz, key);
          }
        }
      }

      for (const [key, ent] of this.activeChunks.entries()) {
        if (!desiredKeys.has(key)) {
          this.removeChunkEntities(ent);
          this.activeChunks.delete(key);
        }
      }
    }

    // 3. Simulate Wildlife, Nightfall Star-Fragments & Hazards
    for (const ent of this.activeChunks.values()) {
      // A) Nightfall Star-Fragments (visible & collectible during twilight/night)
      if (ent.starFragment) {
        const sf = ent.starFragment;
        const shouldShow = this.isNight && !sf.collected;
        if (sf.mesh.visible !== shouldShow) {
          sf.mesh.visible = shouldShow;
        }
        if (shouldShow) {
          sf.crystal.rotation.y = elapsedTime * 2.5;
          sf.crystal.position.y = 0.75 + Math.sin(elapsedTime * 3.5) * 0.14;
          sf.crystal.updateMatrix();
          sf.crystal.matrixWorld.multiplyMatrices(sf.mesh.matrixWorld, sf.crystal.matrix);

          const dx = playerPos.x - sf.worldPos.x;
          const dz = playerPos.z - sf.worldPos.z;
          if (dx * dx + dz * dz <= 2.3 * 2.3) {
            sf.collected = true;
            sf.mesh.visible = false;
            this.playStarChime();
            this.onGrantOrDeductGold(250, '🌠 Nightfall Star-Fragment! +250 Gold', true);
          }
        }
      }

      // B) Meadow Bird Flocks (scatter into the sky when approached)
      if (ent.birdFlock && ent.birdFlock.group.visible) {
        const flock = ent.birdFlock;
        if (!flock.scared) {
          const dx = playerPos.x - flock.origin.x;
          const dz = playerPos.z - flock.origin.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < 8.5 * 8.5) {
            flock.scared = true;
            this.playBirdChirp();
          } else if (dSq < 45 * 45) {
            // Subtle pecking hop on the ground (distance-gated to 45m)
            for (let i = 0; i < flock.birds.length; i++) {
              const b = flock.birds[i];
              b.position.y = Math.abs(Math.sin(elapsedTime * 4.5 + i * 1.7)) * 0.12;
              b.updateMatrix();
              b.matrixWorld.multiplyMatrices(flock.group.matrixWorld, b.matrix);
            }
          }
        } else {
          flock.flightTime += dt;
          const t = flock.flightTime;
          for (let i = 0; i < flock.birds.length; i++) {
            const b = flock.birds[i];
            const angle = i * 1.25 + t * 2.4;
            const radius = 1.2 + t * 3.5;
            b.position.set(
              Math.cos(angle) * radius,
              t * (5.5 + i * 0.4),
              Math.sin(angle) * radius
            );
            b.rotation.y = -angle;
            b.rotation.z = Math.sin(elapsedTime * 18.0 + i) * 0.35;
            b.updateMatrix();
            b.matrixWorld.multiplyMatrices(flock.group.matrixWorld, b.matrix);
          }
          if (t > 5.0) {
            flock.group.visible = false;
          }
        }
      }

      // C) Guiding Forest Spirit Rabbits (hop toward a hidden meadow blessing when followed)
      if (ent.spiritRabbit && !ent.spiritRabbit.rewarded) {
        const sr = ent.spiritRabbit;
        const dx = playerPos.x - sr.pos.x;
        const dz = playerPos.z - sr.pos.z;
        const dSq = dx * dx + dz * dz;

        const castShadow = dSq < 48 * 48;
        if (sr.mesh.castShadow !== castShadow) {
          sr.mesh.castShadow = castShadow;
        }

        if (dSq < 15.0 * 15.0) {
          // Hop toward targetPos
          const tx = sr.targetPos.x - sr.pos.x;
          const tz = sr.targetPos.z - sr.pos.z;
          const tDist = Math.hypot(tx, tz);
          if (tDist > 1.2) {
            const step = Math.min(tDist, dt * 6.8);
            sr.pos.x += (tx / tDist) * step;
            sr.pos.z += (tz / tDist) * step;
            sr.pos.y = this.sampleGroundHeight(sr.pos.x, sr.pos.z);
            sr.hopPhase += dt * 11.0;
            sr.mesh.position.set(
              sr.pos.x,
              sr.pos.y + Math.abs(Math.sin(sr.hopPhase)) * 0.42,
              sr.pos.z
            );
            sr.mesh.rotation.y = Math.atan2(tx, tz);
            sr.mesh.updateMatrix();
            sr.mesh.matrixWorld.multiplyMatrices(this.group.matrixWorld, sr.mesh.matrix);
          } else if (dSq < 3.2 * 3.2) {
            sr.rewarded = true;
            sr.mesh.visible = false;
            this.playStarChime();
            this.onGrantOrDeductGold(125, '🐇 Forest Spirit Gift! +125 Gold', true);
          }
        } else if (dSq < 45 * 45) {
          // Gentle idle hop (distance-gated to 45m)
          sr.hopPhase += dt * 3.5;
          sr.mesh.position.y = sr.pos.y + Math.abs(Math.sin(sr.hopPhase)) * 0.14;
          sr.mesh.updateMatrix();
          sr.mesh.matrixWorld.multiplyMatrices(this.group.matrixWorld, sr.mesh.matrix);
        }
      }
    }

    // 4. Mischievous Goblin Cutpurses & Bombardiers (Direct flat iteration, zero allocations)
    for (const g of this.activeGoblins) {
        if (!g.mesh.visible) continue;
        if (!g.defeated) {
          const cdx = playerPos.x - g.centerPos.x;
          const cdz = playerPos.z - g.centerPos.z;
          const centerDistSq = cdx * cdx + cdz * cdz;
          const maxSimRadius = 65 + g.orbitRadius;
          if (centerDistSq <= maxSimRadius * maxSimRadius) {
            const dx = playerPos.x - g.pos.x;
            const dz = playerPos.z - g.pos.z;
            const dSq = dx * dx + dz * dz;
            const dist = Math.sqrt(dSq);

            if (g.role === 'bombardier') {
              // Bombardier faces player and maintains tactical medium range
              g.mesh.rotation.y = Math.atan2(dx, dz);
              if (dist < 10.0) {
                // Back away from player
                g.pos.x -= (dx / (dist || 1)) * dt * 2.8;
                g.pos.z -= (dz / (dist || 1)) * dt * 2.8;
              } else if (dist > 22.0) {
                // Step closer into throwing range
                g.pos.x += (dx / (dist || 1)) * dt * 2.2;
                g.pos.z += (dz / (dist || 1)) * dt * 2.2;
              }
              g.pos.y = this.sampleGroundHeight(g.pos.x, g.pos.z);
              g.mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
              g.mesh.updateMatrix();
              g.mesh.updateMatrixWorld(true);

              if (g.bombCooldown > 0) {
                g.bombCooldown -= dt;
              } else if (dist >= 7.5 && dist <= 26.0) {
                this.throwGoblinBomb(g, playerPos);
              }
            } else {
              // Cutpurse patrols and darts around
              g.orbitAngle += dt * 1.65;
              g.pos.x = g.centerPos.x + Math.cos(g.orbitAngle) * g.orbitRadius;
              g.pos.z = g.centerPos.z + Math.sin(g.orbitAngle) * g.orbitRadius;
              g.pos.y = this.sampleGroundHeight(g.pos.x, g.pos.z);

              const hop = Math.abs(Math.sin(elapsedTime * 8.5)) * 0.18;
              g.mesh.position.set(g.pos.x, g.pos.y + hop, g.pos.z);
              g.mesh.rotation.y = -g.orbitAngle;
              g.mesh.updateMatrix();
              g.mesh.updateMatrixWorld(true);
            }

            // Close-range GLB LOD toggle (dist <= 45m): animated 3D goblin model, procedural fallback for far range
            const nearLOD = dSq <= 45 * 45;
            if (g.isNearLOD !== nearLOD) {
              g.isNearLOD = nearLOD;
              if (g.modelGroup) {
                if (nearLOD) {
                  g.modelGroup.visible = true;
                  g.bodyMesh.visible = false;
                  g.headMesh.visible = false;
                  if (g.glbMesh) g.glbMesh.visible = false;
                } else {
                  g.modelGroup.visible = false;
                  g.bodyMesh.visible = true;
                  g.headMesh.visible = true;
                  if (g.glbMesh) g.glbMesh.visible = false;
                }
              } else if (g.glbMesh && sharedGoblinGeo && sharedGoblinMat) {
                if (nearLOD) {
                  g.glbMesh.visible = true;
                  g.bodyMesh.visible = false;
                  g.headMesh.visible = false;
                } else {
                  g.glbMesh.visible = false;
                  g.bodyMesh.visible = true;
                  g.headMesh.visible = true;
                }
              }
            }

            // Animate goblin skeletal bones when in close range LOD (distance-gated to 45m)
            if (g.modelGroup && g.modelGroup.visible && g.bones) {
              const runPhase = elapsedTime * 9.0;
              g.bones.leftArm.rotation.x = g.bones.baseLeftArmX + Math.sin(runPhase) * 0.45;
              g.bones.rightArm.rotation.x = g.bones.baseRightArmX - Math.sin(runPhase) * 0.45;
              g.bones.leftForeArm.rotation.z = g.bones.baseLeftForeArmZ + Math.cos(runPhase) * 0.2;
              g.bones.rightForeArm.rotation.z = g.bones.baseRightForeArmZ - Math.cos(runPhase) * 0.2;
              g.bones.head.rotation.y = Math.sin(elapsedTime * 2.8) * 0.25;
            }

            const castShadow = dSq < 42 * 42;
            if (g.modelGroup && g.modelGroup.visible) {
              // Shadows disabled on mob skinned mesh for performance
            } else if (g.glbMesh && g.glbMesh.visible) {
              if (g.glbMesh.castShadow !== castShadow) {
                g.glbMesh.castShadow = castShadow;
              }
            } else {
              if (g.bodyMesh.castShadow !== castShadow) {
                g.bodyMesh.castShadow = castShadow;
                g.headMesh.castShadow = castShadow;
              }
            }

            if (dSq < 1.75 * 1.75) {
              if (isPlayerAttackingOrAirborne) {
                this.defeatGoblin(
                  g,
                  `🛡️ Smashed Goblin ${g.role === 'bombardier' ? 'Bombardier' : 'Cutpurse'}! +125 Gold & +1 Food Ration`
                );
              } else if (this.hazardHitCooldown <= 0) {
                if (this.dwarf.isShieldBlocking()) {
                  this.hazardHitCooldown = 1.0;
                  this.dwarf.triggerBlockImpact();
                  this.onShieldBlockSound?.();
                  this.onGrantOrDeductGold(0, '🛡️ Shield Deflected Goblin Dagger Strike!', true);
                } else {
                  this.hazardHitCooldown = 2.4;
                  this.playHazardBumpSound();
                  this.onApplyPlayerDamage?.(12, 'Goblin Raider');
                  this.onGrantOrDeductGold(
                    -25,
                    '👺 Goblin Raider Stole 25 Gold! (-12 ❤️) Hold Shield (Shift) to Block!',
                    false
                  );
                }
              }
            }
          } else {
            if (g.bodyMesh.castShadow) {
              g.bodyMesh.castShadow = false;
              g.headMesh.castShadow = false;
            }
            if (g.glbMesh && g.glbMesh.castShadow) {
              g.glbMesh.castShadow = false;
            }
          }
        } else {
          g.flyTime += dt;
          g.mesh.position.y += dt * 14.0;
          g.mesh.rotation.x += dt * 12.0;
          g.mesh.scale.setScalar(Math.max(0.01, 1.0 - g.flyTime * 1.4));
          g.mesh.updateMatrix();
          g.mesh.updateMatrixWorld(true);
          if (g.flyTime >= 0.7) {
            g.mesh.visible = false;
          }
        }
      }

    // 5. Update Flying & Bouncing Explosive Goblin Bombs
    for (const bomb of this.bombPool) {
      if (!bomb.active) continue;
      bomb.fuseTimer -= dt;
      bomb.vel.y -= 18.0 * dt;
      bomb.pos.addScaledVector(bomb.vel, dt);

      const gy = this.sampleGroundHeight(bomb.pos.x, bomb.pos.z);
      if (bomb.pos.y <= gy + 0.22) {
        bomb.pos.y = gy + 0.22;
        if (bomb.vel.y < -1.1) {
          bomb.vel.y = -bomb.vel.y * 0.45;
          bomb.vel.x *= 0.65;
          bomb.vel.z *= 0.65;
        } else {
          bomb.vel.y = 0;
          bomb.vel.x *= 0.85;
          bomb.vel.z *= 0.85;
        }
      }

      bomb.mesh.position.copy(bomb.pos);
      bomb.mesh.updateMatrix();
      bomb.mesh.updateMatrixWorld(true);
      bomb.sparkMesh.scale.setScalar(1.0 + Math.sin(elapsedTime * 28.0) * 0.4);

      if (bomb.fuseTimer <= 0.45) {
        (bomb.bodyMesh.material as THREE.MeshStandardMaterial).emissive.setHex(
          Math.sin(elapsedTime * 24.0) > 0 ? 0xff2200 : 0x000000
        );
      } else {
        (bomb.bodyMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
      }

      if (bomb.fuseTimer <= 0) {
        this.detonateBomb(bomb, playerPos);
      }
    }
  }

  private throwGoblinBomb(g: GoblinHazardInstance, playerPos: THREE.Vector3): void {
    const bomb = this.bombPool.find((b) => !b.active);
    if (!bomb) return;
    g.bombCooldown = 4.2 + Math.random() * 1.6;
    bomb.active = true;
    bomb.pos.set(g.pos.x, g.pos.y + 0.88, g.pos.z);
    const dx = playerPos.x - bomb.pos.x;
    const dz = playerPos.z - bomb.pos.z;
    const d = Math.hypot(dx, dz);
    const flightTime = Math.max(0.65, d / 14.5);
    const gravity = 18.0;
    bomb.vel.set(
      dx / flightTime,
      (playerPos.y + 0.3 - bomb.pos.y) / flightTime + 0.5 * gravity * flightTime,
      dz / flightTime
    );
    bomb.fuseTimer = 1.35;
    bomb.mesh.position.copy(bomb.pos);
    bomb.mesh.visible = true;
    this.playBombFuseSizzleSound();
    this.onGrantOrDeductGold(
      0,
      '💣 Goblin Bombardier threw an Explosive Bomb! Move or Block with Shield!',
      false
    );
  }

  private detonateBomb(bomb: GoblinBomb, playerPos: THREE.Vector3): void {
    bomb.active = false;
    bomb.mesh.visible = false;
    (bomb.bodyMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);

    this.playBombExplosionSound();
    this.cameraShakeFn?.(0.48, 0.3);
    this.dwarf.spawnBurst(bomb.pos.x, bomb.pos.y + 0.25, bomb.pos.z, 28);

    const dx = playerPos.x - bomb.pos.x;
    const dz = playerPos.z - bomb.pos.z;
    const dy = playerPos.y - bomb.pos.y;
    const distSq = dx * dx + dz * dz;

    if (distSq <= 4.2 * 4.2 && Math.abs(dy) <= 3.0) {
      if (this.dwarf.isShieldBlocking()) {
        this.dwarf.triggerBlockImpact();
        this.onShieldBlockSound?.();
        this.onGrantOrDeductGold(0, '🛡️ Shield Blocked Goblin Bomb Blast! (0 ❤️ damage)', true);
      } else {
        this.onApplyPlayerDamage?.(22, 'Goblin Bomb Explosion');
        this.onGrantOrDeductGold(
          -15,
          '💥 Goblin Bomb Explosion! (-22 ❤️) Hold Shield (Shift) to Block Bombs!',
          false
        );
      }
    }

    // Damage any other nearby goblins in blast radius
    for (const g of this.activeGoblins) {
      if (!g.defeated && g.mesh.visible) {
        const gdx = g.pos.x - bomb.pos.x;
        const gdz = g.pos.z - bomb.pos.z;
        if (gdx * gdx + gdz * gdz <= 4.2 * 4.2) {
          this.defeatGoblin(g, '💥 Friendly-Fire: Goblin Blown Up by Bomb! +125 Gold');
        }
      }
    }
  }

  private defeatGoblin(g: GoblinHazardInstance, message: string): void {
    g.defeated = true;
    g.flyTime = 0;
    this.playStarChime();
    this.dwarf.spawnBurst(g.pos.x, g.pos.y + 0.8, g.pos.z, 20);
    this.onGrantOrDeductGold(125, message, true);
    this.onGrantFoodRation?.(1);
  }

  public tryHitGoblinWithArrow(arrowPos: THREE.Vector3, _damage = 50): boolean {
    // Check active bombs first! Shooting a bomb detonates it!
    for (const bomb of this.bombPool) {
      if (bomb.active) {
        const dx = arrowPos.x - bomb.pos.x;
        const dz = arrowPos.z - bomb.pos.z;
        const dy = arrowPos.y - bomb.pos.y;
        if (dx * dx + dz * dz <= 1.25 * 1.25 && Math.abs(dy) <= 1.2) {
          this.detonateBomb(bomb, this.dwarf.root.position);
          return true;
        }
      }
    }

    for (const g of this.activeGoblins) {
      if (!g.defeated && g.mesh.visible) {
        const dx = arrowPos.x - g.pos.x;
        const dz = arrowPos.z - g.pos.z;
        const dy = arrowPos.y - (g.pos.y + 0.55);
        if (dx * dx + dz * dz <= 1.35 * 1.35 && Math.abs(dy) <= 1.2) {
          this.defeatGoblin(
            g,
            `🏹 Marksman Bow Shot Defeated Goblin ${g.role === 'bombardier' ? 'Bombardier' : 'Raider'}! +125 Gold & +1 Food Ration`
          );
          return true;
        }
      }
    }
    return false;
  }

  public tryHitGoblinWithMelee(playerPos: THREE.Vector3, heading: number, _damage = 40): boolean {
    for (const g of this.activeGoblins) {
      if (!g.defeated && g.mesh.visible) {
        const dx = g.pos.x - playerPos.x;
        const dz = g.pos.z - playerPos.z;
        const d = Math.hypot(dx, dz);
        if (d <= 3.4) {
          const angleToGoblin = Math.atan2(dx, dz);
          const angleDiff = Math.abs(
            THREE.MathUtils.euclideanModulo(angleToGoblin - heading + Math.PI, Math.PI * 2) - Math.PI
          );
          if (angleDiff <= Math.PI * 0.58) {
            this.defeatGoblin(
              g,
              `⚔️ Melee Strike Crushed Goblin ${g.role === 'bombardier' ? 'Bombardier' : 'Raider'}! +125 Gold & +1 Food Ration`
            );
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Smashes all active Goblins within a ground-slam radius.
   */
  public defeatGoblinsInRadius(playerPos: THREE.Vector3, radius = 6.5): number {
    let count = 0;
    const rSq = radius * radius;
    for (const g of this.activeGoblins) {
      if (g.mesh.visible && !g.defeated) {
        const dx = playerPos.x - g.pos.x;
        const dz = playerPos.z - g.pos.z;
        if (dx * dx + dz * dz <= rSq) {
          this.defeatGoblin(g, '💥 Ground-Slam Smashed Goblin Raider! +125 Gold & +1 Food Ration');
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Smashes any Goblin colliding during high-speed downhill surf-ramming.
   */
  public checkSurfRamGoblin(playerPos: THREE.Vector3, radius = 2.4): boolean {
    const rSq = radius * radius;
    for (const g of this.activeGoblins) {
      if (g.mesh.visible && !g.defeated) {
        const dx = playerPos.x - g.pos.x;
        const dz = playerPos.z - g.pos.z;
        if (dx * dx + dz * dz <= rSq) {
          this.defeatGoblin(g, '🛡️ Surf-Ram Smashed Goblin Raider! +125 Gold & +1 Food Ration');
          return true;
        }
      }
    }
    return false;
  }

  public updateAtmosphereAndLantern(
    elapsedTime: number,
    playerPos: THREE.Vector3,
    sunOffsetOut: THREE.Vector3
  ): void {
    const hour = ((this.config.timeOfDay % 24) + 24) % 24;

    // Map 0..24h to sun elevation angle: 6h = sunrise (0), 12h = zenith (+1), 18h = sunset (0), 0h = midnight (-1)
    const sunAngle = ((hour - 6.0) / 24.0) * Math.PI * 2;
    const sinElev = Math.sin(sunAngle);
    const cosElev = Math.cos(sunAngle);

    // Compute night factor [0 = bright day, 1 = deep night]
    const nightFactor = THREE.MathUtils.smoothstep(-sinElev, -0.15, 0.38);
    const twilightFactor =
      1.0 - Math.min(1.0, Math.abs(sinElev) / 0.36); // Peaks near sunrise (6h) & sunset (18h)
    const isDawn = hour < 12;

    this.isNight = nightFactor > 0.45;

    // 1. Sky & Fog Color
    const skyCol = this.skyHorizonColor;
    skyCol.copy(SKY_DAY).lerp(SKY_NIGHT, nightFactor);
    if (twilightFactor > 0.01) {
      skyCol.lerp(isDawn ? SKY_DAWN : SKY_SUNSET, twilightFactor * 0.78);
    }
    if (!this.insideInterior) {
      this.fog.color.copy(skyCol);
    }

    // 2. Directional Sun / Moon Light
    const lightRadius = 125;
    // Keep shadow caster above horizon by switching between sun (day) and high moon (night)
    const elevY = Math.max(38, Math.abs(sinElev) * 110 + 28);
    const horizX = cosElev * lightRadius;
    sunOffsetOut.set(horizX, elevY, 65);

    this.dirLight.color.copy(SUN_DAY).lerp(MOON_NIGHT, nightFactor);
    if (twilightFactor > 0.01) {
      this.dirLight.color.lerp(isDawn ? SUN_DAWN : SUN_SUNSET, twilightFactor * 0.85);
    }
    this.dirLight.intensity = THREE.MathUtils.lerp(1.85, 0.52, nightFactor);

    // 3. Hemisphere Sky/Ground Bounce
    this.hemiLight.color.copy(HEMI_SKY_DAY).lerp(HEMI_SKY_NIGHT, nightFactor);
    this.hemiLight.groundColor.copy(HEMI_GND_DAY).lerp(HEMI_GND_NIGHT, nightFactor);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.82, 0.34, nightFactor);

    // 4. Twinkling Starfield Dome at Twilight / Night
    this.starDome.visible = !this.insideInterior && nightFactor > 0.15;
    if (this.starDome.visible) {
      this.starDome.position.set(playerPos.x, 0, playerPos.z);
      this.starDome.rotation.y = elapsedTime * 0.008;
      this.starMat.opacity = (nightFactor - 0.15) / 0.85;
    }

    // 5. Automatic Dwarven Belt Lantern at Dusk / Night
    // Keep dwarfLanternLight.visible = !insideInterior (intensity = 0 by day) so NUM_POINT_LIGHTS stays 1
    const showLantern = !this.insideInterior && nightFactor > 0.25;
    this.dwarfLanternMesh.visible = showLantern;
    this.dwarfLanternLight.visible = !this.insideInterior;
    if (showLantern) {
      const flicker = 1.0 + Math.sin(elapsedTime * 11.0) * 0.08;
      this.dwarfLanternLight.intensity = ((nightFactor - 0.25) / 0.75) * 3.6 * flicker;
    } else if (this.dwarfLanternLight.intensity !== 0) {
      this.dwarfLanternLight.intensity = 0;
    }
  }

  private spawnEntitiesForChunk(cx: number, cz: number, chunkKey: number): void {
    const size = this.config.chunkSize;
    const chunkWx = cx * size;
    const chunkWz = cz * size;
    if (this.noise.isInsideVolcanoBarrenZone(chunkWx, chunkWz)) {
      this.activeChunks.set(chunkKey, {});
      return;
    }

    const chunkSeed = ((cx * 314159265) ^ (cz * 271828183) ^ (this.config.seed + 577)) >>> 0;
    const rng = createSeededRandom(chunkSeed);
    const assets = getSharedLivingAssets();

    const ent: ChunkLivingEntities = {};
    const isStartChunk = cx === 0 && cz === 0;

    // 1. Nightfall Star-Fragment (~35% of chunks)
    if (!isStartChunk && rng() < 0.35) {
      const wx = cx * size + (rng() - 0.5) * (size * 0.7);
      const wz = cz * size + (rng() - 0.5) * (size * 0.7);
      const wy = this.sampleGroundHeight(wx, wz);
      if (
        !this.noise.isInsideVolcanoBarrenZone(wx, wz) &&
        (!this.config.enableWater || wy > this.config.waterLevel + 0.8)
      ) {
        const mesh = new THREE.Group();
        mesh.position.set(wx, wy, wz);
        mesh.visible = this.isNight;
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;

        const crystal = new THREE.Mesh(assets.starCrystalGeo, assets.matStarCrystal);
        crystal.position.y = 0.75;
        crystal.updateMatrix();
        crystal.matrixAutoUpdate = false;
        mesh.add(crystal);

        const ring = new THREE.Mesh(assets.starRingGeo, assets.matStarRing);
        ring.position.y = 0.08;
        ring.updateMatrix();
        ring.matrixAutoUpdate = false;
        mesh.add(ring);

        this.group.add(mesh);
        mesh.updateMatrixWorld(true);
        ent.starFragment = {
          worldPos: new THREE.Vector3(wx, wy, wz),
          collected: false,
          mesh,
          crystal,
          ring,
        };
      }
    }

    // 2. Meadow Bird Flock (in start chunk or ~35% of chunks)
    if (isStartChunk || rng() < 0.35) {
      const wx = isStartChunk ? 5.5 : cx * size + (rng() - 0.5) * (size * 0.65);
      const wz = isStartChunk ? 8.5 : cz * size + (rng() - 0.5) * (size * 0.65);
      const wy = this.sampleGroundHeight(wx, wz);
      if (
        !this.noise.isInsideVolcanoBarrenZone(wx, wz) &&
        (!this.config.enableWater || wy > this.config.waterLevel + 0.9)
      ) {
        const group = new THREE.Group();
        group.position.set(wx, wy, wz);
        group.updateMatrix();
        group.matrixAutoUpdate = false;

        const birds: THREE.Mesh[] = [];
        for (let i = 0; i < 5; i++) {
          const b = new THREE.Mesh(assets.birdGeo, assets.matBird);
          const a = (i / 5) * Math.PI * 2;
          b.position.set(Math.cos(a) * 0.9, 0.08, Math.sin(a) * 0.9);
          b.rotation.y = rng() * Math.PI * 2;
          b.updateMatrix();
          b.matrixAutoUpdate = false;
          group.add(b);
          birds.push(b);
        }

        this.group.add(group);
        group.updateMatrixWorld(true);
        ent.birdFlock = {
          origin: new THREE.Vector3(wx, wy, wz),
          scared: false,
          flightTime: 0,
          birds,
          group,
        };
      }
    }

    // 3. Guiding Forest Spirit Rabbit (in start chunk or ~28% of chunks)
    if (isStartChunk || rng() < 0.28) {
      const wx = isStartChunk ? -6.5 : cx * size + (rng() - 0.5) * (size * 0.6);
      const wz = isStartChunk ? 9.5 : cz * size + (rng() - 0.5) * (size * 0.6);
      const wy = this.sampleGroundHeight(wx, wz);
      if (
        !this.noise.isInsideVolcanoBarrenZone(wx, wz) &&
        (!this.config.enableWater || wy > this.config.waterLevel + 1.0)
      ) {
        const mesh = new THREE.Mesh(assets.spiritRabbitGeo, assets.matSpirit);
        mesh.position.set(wx, wy, wz);
        mesh.castShadow = false;
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;

        this.group.add(mesh);
        mesh.updateMatrixWorld(true);

        const tAngle = rng() * Math.PI * 2;
        const tx = wx + Math.cos(tAngle) * 18.0;
        const tz = wz + Math.sin(tAngle) * 18.0;
        ent.spiritRabbit = {
          pos: new THREE.Vector3(wx, wy, wz),
          targetPos: new THREE.Vector3(tx, this.sampleGroundHeight(tx, tz), tz),
          rewarded: false,
          hopPhase: rng() * 6.0,
          mesh,
        };
      }
    }

    // 4. Goblin Squads (Cutpurse & Bombardier) in outer chunks (~28% of chunks)
    if (!isStartChunk && rng() < 0.28) {
      ent.goblins = [];
      const squadCount = rng() < 0.45 ? 2 : 1;
      for (let i = 0; i < squadCount; i++) {
        const role: GoblinRole = i === 1 ? 'bombardier' : rng() < 0.42 ? 'bombardier' : 'cutpurse';
        const offsetAng = (i / squadCount) * Math.PI * 2 + rng() * 0.8;
        const offsetDist = i === 0 ? 0 : 3.6 + rng() * 2.2;
        const wx = cx * size + (rng() - 0.5) * (size * 0.55) + Math.cos(offsetAng) * offsetDist;
        const wz = cz * size + (rng() - 0.5) * (size * 0.55) + Math.sin(offsetAng) * offsetDist;
        const wy = this.sampleGroundHeight(wx, wz);

        if (
          !this.noise.isInsideVolcanoBarrenZone(wx, wz) &&
          (!this.config.enableWater || wy > this.config.waterLevel + 1.2)
        ) {
          const goblinInst = this.createGoblinHazard(wx, wy, wz, role, rng);
          ent.goblins.push(goblinInst);
          this.activeGoblins.push(goblinInst);
          if (i === 0) {
            ent.goblin = goblinInst; // Keep backwards compatibility
          }
        }
      }
    }

    this.activeChunks.set(chunkKey, ent);
  }

  private createGoblinHazard(
    wx: number,
    wy: number,
    wz: number,
    role: GoblinRole,
    rng: () => number
  ): GoblinHazardInstance {
    const assets = getSharedLivingAssets();
    const mesh = new THREE.Group();
    mesh.position.set(wx, wy, wz);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;

    const goblinInst = createGoblinInstance();
    let modelGroup: THREE.Group | undefined;
    let bones: GoblinBones | undefined;
    let hasCustomModel = false;

    if (goblinInst) {
      modelGroup = goblinInst.group;
      bones = goblinInst.bones;
      mesh.add(modelGroup);
      hasCustomModel = true;
    }

    const glbMesh = new THREE.Mesh(
      sharedGoblinGeo ?? assets.goblinBodyGeo,
      sharedGoblinMat ?? assets.matGoblinTunic
    );
    glbMesh.castShadow = false;
    glbMesh.receiveShadow = false;
    glbMesh.matrixAutoUpdate = false;
    glbMesh.visible = !hasCustomModel && Boolean(sharedGoblinGeo && sharedGoblinMat);
    mesh.add(glbMesh);

    const body = new THREE.Mesh(assets.goblinBodyGeo, assets.matGoblinTunic);
    body.castShadow = false;
    body.matrixAutoUpdate = false;
    body.visible = !hasCustomModel && !glbMesh.visible;
    mesh.add(body);

    const head = new THREE.Mesh(assets.goblinHeadGeo, assets.matGoblinSkin);
    head.castShadow = false;
    head.matrixAutoUpdate = false;
    head.visible = !hasCustomModel && !glbMesh.visible;
    mesh.add(head);

    if (role === 'bombardier') {
      const bombKeg = new THREE.Mesh(assets.bombGeo, assets.matBomb);
      bombKeg.position.set(0, 0.35, -0.25);
      bombKeg.scale.setScalar(0.72);
      bombKeg.updateMatrix();
      bombKeg.matrixAutoUpdate = false;
      mesh.add(bombKeg);
    } else {
      const sack = new THREE.Mesh(assets.spiritBodyGeo, assets.matGoldSack);
      sack.position.set(0, 0.22, -0.28);
      sack.updateMatrix();
      sack.matrixAutoUpdate = false;
      mesh.add(sack);
    }

    this.group.add(mesh);
    mesh.updateMatrixWorld(true);

    return {
      role,
      centerPos: new THREE.Vector3(wx, wy, wz),
      pos: new THREE.Vector3(wx, wy, wz),
      orbitAngle: rng() * Math.PI * 2,
      orbitRadius: role === 'bombardier' ? 1.5 + rng() * 1.5 : 3.8 + rng() * 2.5,
      bombCooldown: 2.0 + rng() * 3.0,
      defeated: false,
      flyTime: 0,
      mesh,
      bodyMesh: body,
      headMesh: head,
      glbMesh,
      modelGroup,
      bones,
      isNearLOD: true,
    };
  }

  private removeChunkEntities(ent: ChunkLivingEntities): void {
    if (ent.starFragment) this.group.remove(ent.starFragment.mesh);
    if (ent.birdFlock) this.group.remove(ent.birdFlock.group);
    if (ent.spiritRabbit) this.group.remove(ent.spiritRabbit.mesh);
    if (ent.goblins) {
      for (const g of ent.goblins) {
        this.group.remove(g.mesh);
        const idx = this.activeGoblins.indexOf(g);
        if (idx !== -1) this.activeGoblins.splice(idx, 1);
      }
    } else if (ent.goblin) {
      this.group.remove(ent.goblin.mesh);
      const idx = this.activeGoblins.indexOf(ent.goblin);
      if (idx !== -1) this.activeGoblins.splice(idx, 1);
    }
  }

  private playBombFuseSizzleSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(850, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.12);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.16);
  }

  private playBombExplosionSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(150, now);
    sub.frequency.exponentialRampToValueAtTime(32, now + 0.42);
    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.exponentialRampToValueAtTime(0.32, now + 0.015);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.onended = () => {
      sub.disconnect();
      subGain.disconnect();
    };
    sub.start(now);
    sub.stop(now + 0.5);

    const blast = ctx.createOscillator();
    const blastGain = ctx.createGain();
    blast.type = 'sawtooth';
    blast.frequency.setValueAtTime(360, now);
    blast.frequency.exponentialRampToValueAtTime(50, now + 0.22);
    blastGain.gain.setValueAtTime(0.001, now);
    blastGain.gain.exponentialRampToValueAtTime(0.24, now + 0.01);
    blastGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    blast.connect(blastGain);
    blastGain.connect(ctx.destination);
    blast.onended = () => {
      blast.disconnect();
      blastGain.disconnect();
    };
    blast.start(now);
    blast.stop(now + 0.3);
  }

  public rebuildAll(): void {
    for (const ent of this.activeChunks.values()) {
      this.removeChunkEntities(ent);
    }
    this.activeChunks.clear();
    this.activeGoblins.length = 0;
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
  }

  private ensureAudio(): AudioContext | null {
    return getSharedAudioContext();
  }

  private playBirdChirp(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const freqs = [1150, 1480, 1320];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.06);
      osc.frequency.exponentialRampToValueAtTime(f * 1.18, now + idx * 0.06 + 0.05);

      gain.gain.setValueAtTime(0.001, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.05, now + idx * 0.06 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.06);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.07);
    });
  }

  private playStarChime(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [587.33, 880.0, 1174.66];
    notes.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + idx * 0.07);

      gain.gain.setValueAtTime(0.001, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.07 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.38);
    });
  }

  private playHazardBumpSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.24);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.28);
  }
}
