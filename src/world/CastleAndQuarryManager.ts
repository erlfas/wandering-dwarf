import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import borderKeepModelUrl from '../../3dmodels/dwarven border keep 3d model.glb?url';
import dwarvenWorkbenchModelUrl from '../../3dmodels/dwarven workbench 3d model.glb?url';
import medievalCastleModelUrl from '../../3dmodels/medieval castle 3d model.glb?url';
import naturalRockModelUrl from '../../3dmodels/natural rock 3d model.glb?url';
import stoneFortressModelUrl from '../../3dmodels/stone fortress 3d model.glb?url';
import woodenJibCraneModelUrl from '../../3dmodels/wooden jib crane 3d model.glb?url';
import {
  DwarfCharacter,
  EquippedShieldId,
  EquippedWeaponId,
} from '../player/DwarfCharacter';
import { getSharedAudioContext } from '../player/RelicStore';
import { ActiveCastleVisit, CastleInteriorTier } from './CastleInteriorManager';
import { ChunkManager } from './ChunkManager';
import { WorldConfig } from './Config';
import { createOptimizedGlbLoader } from './ForestField';
import { createSeededRandom, TerrainNoise } from './TerrainNoise';

export type HouseEquipmentId =
  | 'chisel_upgrade'
  | 'stone_hauler'
  | 'ration_kettle'
  | 'architect_pulley';

export interface HouseEquipmentDef {
  id: HouseEquipmentId;
  keyHint: string;
  name: string;
  icon: string;
  cost: number;
  shortDesc: string;
}

export const HOUSE_EQUIPMENT_CATALOG: readonly HouseEquipmentDef[] = [
  {
    id: 'chisel_upgrade',
    keyHint: '5',
    name: "Tungsten Mason's Chisel",
    icon: '⛏️',
    cost: 150,
    shortDesc: 'Chisels 2 Castle Blocks per Stone, 2x faster & -40% Energy cost',
  },
  {
    id: 'stone_hauler',
    keyHint: '6',
    name: 'Dwarven Stone-Hauler Cart',
    icon: '🛒',
    cost: 200,
    shortDesc: 'Carry up to 3 Stones or 4 Blocks at once & no heavy slowdown',
  },
  {
    id: 'ration_kettle',
    keyHint: '7',
    name: 'Ironbelly Ration Kettle',
    icon: '🍲',
    cost: 175,
    shortDesc: 'Max Energy 100 → 160, +50% Food Energy & +1 Food per Fish/Deer',
  },
  {
    id: 'architect_pulley',
    keyHint: '8',
    name: "Royal Architect's Pulley Rig",
    icon: '🏗️',
    cost: 275,
    shortDesc: 'Lay 2 Castle Blocks at once & Quarries auto-cut 1 block / 18s',
  },
];

export type CastleArmoryItemId =
  | 'oak_club'
  | 'battle_axe'
  | 'broadsword'
  | 'runic_greatsword'
  | 'round_shield'
  | 'mithril_aegis'
  | 'keep_stew'
  | 'roast_boar'
  | 'kings_feast';

export interface CastleArmoryItemDef {
  id: CastleArmoryItemId;
  category: 'weapon' | 'shield' | 'provision';
  minTier: 1 | 2 | 3;
  keyHint: string;
  name: string;
  icon: string;
  cost: number;
  shortDesc: string;
  weaponId?: EquippedWeaponId;
  shieldId?: EquippedShieldId;
}

export const CASTLE_ARMORY_CATALOG: readonly CastleArmoryItemDef[] = [
  {
    id: 'oak_club',
    category: 'weapon',
    minTier: 1,
    keyHint: '5',
    name: 'Iron-Studded Oak Club',
    icon: '🪵',
    cost: 120,
    shortDesc: '22 DMG • Heavy stun blow (15 hits to slay Troll)',
    weaponId: 'oak_club',
  },
  {
    id: 'battle_axe',
    category: 'weapon',
    minTier: 1,
    keyHint: '6',
    name: 'Dwarven Bearded Battle-Axe',
    icon: '🪓',
    cost: 220,
    shortDesc: '30 DMG • Cleaving Dwarven steel (11 hits to slay Troll)',
    weaponId: 'battle_axe',
  },
  {
    id: 'broadsword',
    category: 'weapon',
    minTier: 2,
    keyHint: '7',
    name: 'Stonewall Broadsword',
    icon: '⚔️',
    cost: 360,
    shortDesc: '40 DMG • Balanced Stronghold blade (8 hits to slay Troll)',
    weaponId: 'broadsword',
  },
  {
    id: 'runic_greatsword',
    category: 'weapon',
    minTier: 3,
    keyHint: '8',
    name: "Mountain King's Runic Greatsword",
    icon: '🗡️',
    cost: 550,
    shortDesc: '55 DMG • Golden Runic Shockwave (6 hits to slay Troll)',
    weaponId: 'runic_greatsword',
  },
  {
    id: 'round_shield',
    category: 'shield',
    minTier: 1,
    keyHint: '9',
    name: 'Iron-Boss Round Shield',
    icon: '🛡️',
    cost: 160,
    shortDesc: '+25 Max HP • Right-Click blocks 70% Troll damage',
    shieldId: 'round_shield',
  },
  {
    id: 'mithril_aegis',
    category: 'shield',
    minTier: 2,
    keyHint: '9',
    name: 'Runic Mithril Aegis Shield',
    icon: '🔰',
    cost: 340,
    shortDesc: '+50 Max HP • Right-Click blocks 85% Troll damage & staggers',
    shieldId: 'mithril_aegis',
  },
  {
    id: 'keep_stew',
    category: 'provision',
    minTier: 1,
    keyHint: '0',
    name: 'Border Keep Hearth Stew (+2 🍖)',
    icon: '🍲',
    cost: 60,
    shortDesc: 'Repeatable: +2 Food Rations & restores +40⚡ / +25❤️ now',
  },
  {
    id: 'roast_boar',
    category: 'provision',
    minTier: 2,
    keyHint: '-',
    name: 'Stronghold Roast Boar Platter (+5 🍖)',
    icon: '🍖',
    cost: 125,
    shortDesc: 'Repeatable: +5 Food Rations & restores 100% Health & Strength',
  },
  {
    id: 'kings_feast',
    category: 'provision',
    minTier: 3,
    keyHint: '=',
    name: "Mountain King's Golden Feast (+4 🍖)",
    icon: '👑',
    cost: 150,
    shortDesc: "Repeatable: +4 Rations, Full Restore & +25% King's Valor DMG (2m)",
  },
];

export const WEAPON_COMBAT_SPECS: Record<
  EquippedWeaponId,
  {
    name: string;
    icon: string;
    damage: number;
    energyCost: number;
    cooldown: number;
    hasRunicShockwave: boolean;
  }
> = {
  mallet: {
    name: "Mason's Mallet",
    icon: '🔨',
    damage: 14,
    energyCost: 8,
    cooldown: 0.55,
    hasRunicShockwave: false,
  },
  oak_club: {
    name: 'Iron-Studded Oak Club',
    icon: '🪵',
    damage: 22,
    energyCost: 9,
    cooldown: 0.58,
    hasRunicShockwave: false,
  },
  battle_axe: {
    name: 'Bearded Battle-Axe',
    icon: '🪓',
    damage: 30,
    energyCost: 10,
    cooldown: 0.52,
    hasRunicShockwave: false,
  },
  broadsword: {
    name: 'Stonewall Broadsword',
    icon: '⚔️',
    damage: 40,
    energyCost: 8,
    cooldown: 0.44,
    hasRunicShockwave: false,
  },
  runic_greatsword: {
    name: "King's Runic Greatsword",
    icon: '🗡️',
    damage: 55,
    energyCost: 10,
    cooldown: 0.48,
    hasRunicShockwave: true,
  },
};

export interface SavedQuarrySite {
  id: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  stockpiledBlocks: number;
}

export interface SavedCastleSite {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  blocksPlaced: number;
}

interface NaturalRockInstance {
  id: string;
  wx: number;
  wy: number;
  wz: number;
  scale: number;
  rotY: number;
  respawnTimer: number;
  isNearLOD: boolean;
  root: THREE.Group;
  mesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
}

interface QuarryInstance {
  id: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  stockpiledBlocks: number;
  autoCutTimer: number;
  chiselStoneTimer: number;
  isNearLOD: boolean;
  root: THREE.Group;
  workbenchMesh: THREE.Mesh;
  jibCraneMesh: THREE.Mesh;
  benchRockMesh: THREE.Mesh;
  craneWheelMesh: THREE.Mesh;
  workRingMesh: THREE.Mesh;
  stockpileMeshes: THREE.Mesh[];
}

type CastleMatKey = 'stone' | 'darkStone' | 'wood' | 'iron' | 'roof' | 'gold' | 'flame';

interface CastleSlotSpec {
  index: number;
  tier: 1 | 2 | 3;
  label: string;
  hintLocation: string;
  localPos: THREE.Vector3;
  groundDropLocal: THREE.Vector3;
  geoIndex: number;
  matKeys: CastleMatKey[];
}

interface CastleInstance {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  blocksPlaced: number;
  isNearGlbLOD: boolean;
  root: THREE.Group;
  completedGlbMesh: THREE.Mesh;
  slotMeshes: THREE.Mesh[];
  slotMaterials: Array<THREE.Material | THREE.Material[]>;
  ghostMesh: THREE.Mesh;
  beaconArrowGroup: THREE.Group;
  groundTargetRing: THREE.Mesh;
  doorRingMesh: THREE.Mesh;
}

export const CASTLE_MILESTONES = [
  {
    tier: 1,
    blocksRequired: 8,
    title: 'Tier I: Dwarven Border Keep',
    rewardGold: 300,
    badge: '🏰 Small Keep (8 Blocks)',
  },
  {
    tier: 2,
    blocksRequired: 18,
    title: 'Tier II: Stonewall Stronghold',
    rewardGold: 650,
    badge: '🏯 Medium Stronghold (18 Blocks)',
  },
  {
    tier: 3,
    blocksRequired: 30,
    title: "Tier III: Mountain King's Grand Citadel",
    rewardGold: 1200,
    badge: '👑 Grand Citadel (30 Blocks)',
  },
] as const;

const CASTLE_NAMES = [
  'Ironforge Citadel',
  'Stonehelm Bastion',
  'Hammerfall Keep',
  'Khazad Stronghold',
  'Runerock Fortress',
  'Silverpeak Castle',
];

let sharedNaturalRockGeo: THREE.BufferGeometry | null = null;
let sharedNaturalRockMat: THREE.MeshStandardMaterial | null = null;
let naturalRockLoadStarted = false;
const activeNearRocks = new Set<NaturalRockInstance>();
const onNaturalRockLoadedCallbacks: Array<
  (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial) => void
> = [];

/**
 * Asynchronously loads `3dmodels/natural rock 3d model.glb` (18,114 tris), strips unused PBR maps
 * and `KHR_materials_specular` before decoding, normalizes pivot (center X/Z at 0, base at Y=0,
 * ~0.78m height so it is big yet carryable by the 1.40m dwarf), guards normal computation, welds
 * vertices, and hot-swaps close-range (`dist <= 1.5` chunks) rocks and the dwarf's carried stone.
 */
export function loadNaturalRockModel(
  onLoaded?: (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial) => void
): void {
  if (onLoaded) {
    if (sharedNaturalRockGeo && sharedNaturalRockMat) {
      onLoaded(sharedNaturalRockGeo, sharedNaturalRockMat);
    } else {
      onNaturalRockLoadedCallbacks.push(onLoaded);
    }
  }
  if (naturalRockLoadStarted) return;
  naturalRockLoadStarted = true;

  const loader = createOptimizedGlbLoader();
  loader.load(
    naturalRockModelUrl,
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

      let geo = mesh.geometry;
      geo.applyMatrix4(mesh.matrixWorld);

      // 1. Strip unused skinning attributes
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');

      // 2. Normalize pivot (center X/Z at 0, base at Y=0) and scale to ~0.78m carryable boulder height
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const spanY = Math.max(0.01, box.max.y - box.min.y);
      const targetHeight = 0.78;
      const scaleFactor = targetHeight / spanY;

      geo.translate(-centerX, -box.min.y, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);

      // 3. Guard computeVertexNormals() — normals are already present in natural rock 3d model.glb
      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      const welded = mergeVertices(geo, 1e-4);
      if (welded !== geo) {
        geo.dispose();
        geo = welded;
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const origMat = (
        Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      ) as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: origMat.map ?? null,
        roughness: 0.86,
        metalness: 0.04,
      });
      if (origMat.normalMap && origMat.normalMap !== origMat.map) origMat.normalMap.dispose();
      if (origMat.roughnessMap && origMat.roughnessMap !== origMat.map) origMat.roughnessMap.dispose();
      if (origMat.metalnessMap && origMat.metalnessMap !== origMat.map) origMat.metalnessMap.dispose();
      if (origMat.aoMap && origMat.aoMap !== origMat.map) origMat.aoMap.dispose();
      origMat.dispose();

      sharedNaturalRockGeo = geo;
      sharedNaturalRockMat = mat;

      // 4. Hot-swap only close-range (dist <= 1.5 chunks) natural rocks
      for (const r of activeNearRocks) {
        r.mesh.geometry = sharedNaturalRockGeo;
        r.mesh.material = sharedNaturalRockMat;
        r.mesh.receiveShadow = false;
      }
      for (const cb of onNaturalRockLoadedCallbacks) {
        cb(sharedNaturalRockGeo, sharedNaturalRockMat);
      }
      onNaturalRockLoadedCallbacks.length = 0;
    },
    undefined,
    (err) => {
      console.error('Failed to load natural rock 3D model:', err);
    }
  );
}

interface CastleTierGlbAsset {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
}

const CASTLE_TIER_MODEL_SPECS: Record<
  1 | 2 | 3,
  { url: string; targetWidth: number; offsetZ: number }
> = {
  // Tier I: Dwarven Border Keep (`21,377` tris) — positioned at the South Gatehouse (`z = +3.1m`)
  1: { url: borderKeepModelUrl, targetWidth: 6.0, offsetZ: 3.1 },
  // Tier II: Stonewall Stronghold (`22,491` tris) — centered on the stronghold pad (`z = -0.2m`)
  2: { url: stoneFortressModelUrl, targetWidth: 14.6, offsetZ: -0.2 },
  // Tier III: Mountain King's Grand Citadel (`23,025` tris) — grand citadel footprint (`z = -0.2m`)
  3: { url: medievalCastleModelUrl, targetWidth: 18.5, offsetZ: -0.2 },
};

const sharedCastleTierGlbAssets: Partial<Record<1 | 2 | 3, CastleTierGlbAsset>> = {};
const castleTierLoadStarted: Partial<Record<1 | 2 | 3, boolean>> = {};
const onCastleTierLoadedCallbacks: Record<1 | 2 | 3, Array<() => void>> = {
  1: [],
  2: [],
  3: [],
};

/**
 * Asynchronously loads and optimizes the complete `.glb` castle model for `tier` (`1 | 2 | 3`):
 * - Uses `createOptimizedGlbLoader()` to strip `KHR_materials_specular` and the 5.5–7.4 MB PNG
 *   secondary PBR textures (`normalTexture`, `metallicRoughnessTexture`, `occlusionTexture`)
 *   in `beforeRoot` before `ImageBitmap` decoding.
 * - Normalizes pivot (center X at 0, base at Y=0, aligned Z offset) and scales to target footprint.
 * - Guards `computeVertexNormals()` (`if (!geo.attributes.normal)`) and welds vertices.
 */
export function ensureCastleTierModelLoaded(
  tier: 1 | 2 | 3,
  onLoaded?: () => void
): void {
  if (sharedCastleTierGlbAssets[tier]) {
    onLoaded?.();
    return;
  }
  if (onLoaded) {
    onCastleTierLoadedCallbacks[tier].push(onLoaded);
  }
  if (castleTierLoadStarted[tier]) return;
  castleTierLoadStarted[tier] = true;

  const spec = CASTLE_TIER_MODEL_SPECS[tier];
  const loader = createOptimizedGlbLoader();
  loader.load(
    spec.url,
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

      let geo = mesh.geometry;
      geo.applyMatrix4(mesh.matrixWorld);

      // 1. Strip unused skinning attributes
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');

      // 2. Normalize pivot (center X at 0, base at Y=0, Z centered + spec.offsetZ) and scale to targetWidth
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const spanX = Math.max(0.01, box.max.x - box.min.x);
      const scaleFactor = spec.targetWidth / spanX;

      geo.translate(-centerX, -box.min.y, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);
      if (spec.offsetZ !== 0) {
        geo.translate(0, 0, spec.offsetZ);
      }

      // 3. Guard computeVertexNormals() — normals are already present in all 3 castle .glb models
      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      const welded = mergeVertices(geo, 1e-4);
      if (welded !== geo) {
        geo.dispose();
        geo = welded;
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const origMat = (
        Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      ) as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: origMat.map ?? null,
        roughness: 0.84,
        metalness: 0.06,
      });
      if (origMat.normalMap && origMat.normalMap !== origMat.map) origMat.normalMap.dispose();
      if (origMat.roughnessMap && origMat.roughnessMap !== origMat.map) origMat.roughnessMap.dispose();
      if (origMat.metalnessMap && origMat.metalnessMap !== origMat.map) origMat.metalnessMap.dispose();
      if (origMat.aoMap && origMat.aoMap !== origMat.map) origMat.aoMap.dispose();
      origMat.dispose();

      sharedCastleTierGlbAssets[tier] = { geo, mat };

      for (const cb of onCastleTierLoadedCallbacks[tier]) {
        cb();
      }
      onCastleTierLoadedCallbacks[tier].length = 0;
    },
    undefined,
    (err) => {
      console.error(`Failed to load Castle Tier ${tier} 3D model:`, err);
    }
  );
}

let sharedWorkbenchGeo: THREE.BufferGeometry | null = null;
let sharedWorkbenchMat: THREE.MeshStandardMaterial | null = null;
let sharedJibCraneGeo: THREE.BufferGeometry | null = null;
let sharedJibCraneMat: THREE.MeshStandardMaterial | null = null;
let quarryPropsLoadStarted = false;
const onQuarryPropsLoadedCallbacks: Array<() => void> = [];

/**
 * Asynchronously loads and optimizes the two Quarry `.glb` models:
 * 1. `3dmodels/dwarven workbench 3d model.glb` (`18,242` tris, `6.27 MB` textures)
 *    normalized to `2.15m` width (`~0.76m` height, `~1.72m` depth) with base at `Y = 0`.
 * 2. `3dmodels/wooden jib crane 3d model.glb` (`19,812` tris, `9.59 MB` textures)
 *    normalized to `4.35m` height with base at `Y = 0`.
 * Strips `KHR_materials_specular` and secondary PBR PNG/JPEG textures in `beforeRoot` before
 * `ImageBitmap` decoding, guards `computeVertexNormals()`, welds vertices, and caches module-scope
 * geometry/material singletons for close-range (`dist <= 1.8` chunks) Quarry LOD.
 */
export function loadQuarryPropModels(onLoaded?: () => void): void {
  if (sharedWorkbenchGeo && sharedWorkbenchMat && sharedJibCraneGeo && sharedJibCraneMat) {
    onLoaded?.();
    return;
  }
  if (onLoaded) {
    onQuarryPropsLoadedCallbacks.push(onLoaded);
  }
  if (quarryPropsLoadStarted) return;
  quarryPropsLoadStarted = true;

  const loader = createOptimizedGlbLoader();

  const notifyListeners = () => {
    for (const cb of onQuarryPropsLoadedCallbacks) {
      cb();
    }
    if (sharedWorkbenchGeo && sharedJibCraneGeo) {
      onQuarryPropsLoadedCallbacks.length = 0;
    }
  };

  loader.load(
    dwarvenWorkbenchModelUrl,
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

      let geo = mesh.geometry;
      geo.applyMatrix4(mesh.matrixWorld);
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');

      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const spanX = Math.max(0.01, box.max.x - box.min.x);
      const scaleFactor = 2.15 / spanX;

      geo.translate(-centerX, -box.min.y, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);

      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      const welded = mergeVertices(geo, 1e-4);
      if (welded !== geo) {
        geo.dispose();
        geo = welded;
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const origMat = (
        Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      ) as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: origMat.map ?? null,
        roughness: 0.82,
        metalness: 0.08,
      });
      if (origMat.normalMap && origMat.normalMap !== origMat.map) origMat.normalMap.dispose();
      if (origMat.roughnessMap && origMat.roughnessMap !== origMat.map) origMat.roughnessMap.dispose();
      if (origMat.metalnessMap && origMat.metalnessMap !== origMat.map) origMat.metalnessMap.dispose();
      if (origMat.aoMap && origMat.aoMap !== origMat.map) origMat.aoMap.dispose();
      origMat.dispose();

      sharedWorkbenchGeo = geo;
      sharedWorkbenchMat = mat;
      notifyListeners();
    },
    undefined,
    (err) => {
      console.error('Failed to load dwarven workbench 3D model:', err);
    }
  );

  loader.load(
    woodenJibCraneModelUrl,
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

      let geo = mesh.geometry;
      geo.applyMatrix4(mesh.matrixWorld);
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');

      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const spanY = Math.max(0.01, box.max.y - box.min.y);
      const scaleFactor = 4.35 / spanY;

      geo.translate(-centerX, -box.min.y, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);

      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      const welded = mergeVertices(geo, 1e-4);
      if (welded !== geo) {
        geo.dispose();
        geo = welded;
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const origMat = (
        Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      ) as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: origMat.map ?? null,
        roughness: 0.84,
        metalness: 0.06,
      });
      if (origMat.normalMap && origMat.normalMap !== origMat.map) origMat.normalMap.dispose();
      if (origMat.roughnessMap && origMat.roughnessMap !== origMat.map) origMat.roughnessMap.dispose();
      if (origMat.metalnessMap && origMat.metalnessMap !== origMat.map) origMat.metalnessMap.dispose();
      if (origMat.aoMap && origMat.aoMap !== origMat.map) origMat.aoMap.dispose();
      origMat.dispose();

      sharedJibCraneGeo = geo;
      sharedJibCraneMat = mat;
      notifyListeners();
    },
    undefined,
    (err) => {
      console.error('Failed to load wooden jib crane 3D model:', err);
    }
  );
}

function formatCompassDir(dx: number, dz: number): string {
  const angle = Math.atan2(dx, -dz);
  const octant = Math.round((angle * 4) / Math.PI + 8) % 8;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[octant];
}

interface SharedMasonryAssets {
  fallbackRockGeo: THREE.BufferGeometry;
  fallbackRockMat: THREE.MeshStandardMaterial;
  fallbackWorkbenchGeo: THREE.BufferGeometry;
  fallbackJibCraneGeo: THREE.BufferGeometry;
  rockRingGeo: THREE.BufferGeometry;
  rockRingMat: THREE.MeshBasicMaterial;
  quarryPadGeo: THREE.BufferGeometry;
  quarryPadMat: THREE.MeshStandardMaterial;
  quarryTimberGeo: THREE.BufferGeometry;
  quarryTimberMat: THREE.MeshStandardMaterial;
  quarryIronGeo: THREE.BufferGeometry;
  quarryIronMat: THREE.MeshStandardMaterial;
  craneWheelGeo: THREE.BufferGeometry;
  stockpileBlockGeo: THREE.BufferGeometry;
  ashlarStoneMat: THREE.MeshStandardMaterial;
  darkStoneMat: THREE.MeshStandardMaterial;
  castleWoodMat: THREE.MeshStandardMaterial;
  slateRoofMat: THREE.MeshStandardMaterial;
  bannerGoldMat: THREE.MeshStandardMaterial;
  torchFlameMat: THREE.MeshBasicMaterial;
  ghostSlotMat: THREE.MeshBasicMaterial;
  blueprintSlotMat: THREE.MeshBasicMaterial;
  workRingGeo: THREE.BufferGeometry;
  workRingMat: THREE.MeshBasicMaterial;
  targetRingGeo: THREE.BufferGeometry;
  targetRingMat: THREE.MeshBasicMaterial;
  levelGuideRingGeo: THREE.BufferGeometry;
  levelGuideRingMat: THREE.MeshBasicMaterial;
  beaconArrowGeo: THREE.BufferGeometry;
  beaconBeamGeo: THREE.BufferGeometry;
  beaconBeamMat: THREE.MeshBasicMaterial;
  footCompassGeo: THREE.BufferGeometry;
  footCompassMat: THREE.MeshBasicMaterial;
  castleSlots: CastleSlotSpec[];
  castleSlotGeos: THREE.BufferGeometry[];
}

let sharedMasonryAssets: SharedMasonryAssets | null = null;

function buildCastleSlotsAndGeometries(): {
  slots: CastleSlotSpec[];
  geos: THREE.BufferGeometry[];
} {
  const slots: CastleSlotSpec[] = [];
  const geos: THREE.BufferGeometry[] = [];

  type BucketMap = Partial<Record<CastleMatKey, THREE.BufferGeometry[]>>;

  const pushBucket = (buckets: BucketMap, key: CastleMatKey, g: THREE.BufferGeometry) => {
    let arr = buckets[key];
    if (!arr) {
      arr = [];
      buckets[key] = arr;
    }
    arr.push(g);
  };

  const addMultiSlot = (
    tier: 1 | 2 | 3,
    label: string,
    hintLocation: string,
    buckets: BucketMap,
    localX: number,
    localY: number,
    localZ: number,
    dropX: number,
    dropZ: number
  ) => {
    const order: CastleMatKey[] = ['stone', 'darkStone', 'wood', 'iron', 'roof', 'gold', 'flame'];
    const mergedPerKey: THREE.BufferGeometry[] = [];
    const matKeys: CastleMatKey[] = [];

    for (const k of order) {
      const list = buckets[k];
      if (!list || list.length === 0) continue;
      const m = list.length === 1 ? list[0].clone() : mergeGeometries(list, false);
      for (const item of list) item.dispose();
      mergedPerKey.push(m);
      matKeys.push(k);
    }

    const finalGeo =
      mergedPerKey.length === 1
        ? mergedPerKey[0]
        : mergeGeometries(mergedPerKey, true);
    if (mergedPerKey.length > 1) {
      for (const m of mergedPerKey) m.dispose();
    }

    finalGeo.computeBoundingBox();
    finalGeo.computeBoundingSphere();
    const index = slots.length;
    geos.push(finalGeo);
    slots.push({
      index,
      tier,
      label,
      hintLocation,
      localPos: new THREE.Vector3(localX, localY, localZ),
      groundDropLocal: new THREE.Vector3(dropX, 0.08, dropZ),
      geoIndex: index,
      matKeys,
    });
  };

  // Helper: Wall-mounted Iron Torch Sconce + Glowing Flame (as seen flanking the gatehouse arch in all 3 concept art pieces)
  const addWallTorch = (b: BucketMap, x: number, y: number, z: number) => {
    const bracket = new THREE.BoxGeometry(0.12, 0.24, 0.24);
    bracket.translate(x, y - 0.08, z);
    pushBucket(b, 'iron', bracket);
    const handle = new THREE.CylinderGeometry(0.06, 0.04, 0.42, 6);
    handle.translate(x, y + 0.04, z + 0.08);
    pushBucket(b, 'iron', handle);
    const cup = new THREE.CylinderGeometry(0.11, 0.06, 0.12, 7);
    cup.translate(x, y + 0.24, z + 0.08);
    pushBucket(b, 'iron', cup);
    const flame = new THREE.ConeGeometry(0.11, 0.28, 7);
    flame.translate(x, y + 0.42, z + 0.08);
    pushBucket(b, 'flame', flame);
  };

  // Helper: Stone Pedestal Flaming Brazier (as seen on the Stronghold & Grand Citadel terraces and ramparts)
  const addStoneBrazier = (b: BucketMap, x: number, y: number, z: number) => {
    const base = new THREE.BoxGeometry(0.52, 0.28, 0.52);
    base.translate(x, y + 0.14, z);
    pushBucket(b, 'darkStone', base);
    const bowl = new THREE.CylinderGeometry(0.28, 0.18, 0.2, 8);
    bowl.translate(x, y + 0.36, z);
    pushBucket(b, 'iron', bowl);
    const flame = new THREE.ConeGeometry(0.22, 0.42, 8);
    flame.translate(x, y + 0.62, z);
    pushBucket(b, 'flame', flame);
  };

  // Helper: Diagonal Iron Drawbridge Chain (matching art/dwarven border keep.jpg, Stonewall Stronghold.jpg, Mountain Kings Grand Citadel.jpg)
  const addDiagonalChain = (
    b: BucketMap,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    links = 14
  ) => {
    const port = new THREE.BoxGeometry(0.2, 0.24, 0.18);
    port.translate(x1, y1, z1);
    pushBucket(b, 'iron', port);
    for (let i = 0; i <= links; i++) {
      const t = i / links;
      const lx = x0 + (x1 - x0) * t;
      const ly = y0 + (y1 - y0) * t;
      const lz = z0 + (z1 - z0) * t;
      const link = new THREE.BoxGeometry(i % 2 === 0 ? 0.07 : 0.05, 0.18, i % 2 === 0 ? 0.05 : 0.07);
      link.rotateX(-0.44);
      link.translate(lx, ly, lz);
      pushBucket(b, 'iron', link);
    }
  };

  // Helper: Swallowtail Dwarven Flagpole & Pennant (matching art/Mountain Kings Grand Citadel.jpg)
  const addSwallowtailPennant = (
    b: BucketMap,
    px: number,
    py: number,
    pz: number,
    poleH: number,
    flagW: number,
    flagH: number,
    emblem: 'anvil' | 'hammer'
  ) => {
    const pole = new THREE.CylinderGeometry(0.045, 0.055, poleH, 6);
    pole.translate(px, py + poleH * 0.5, pz);
    pushBucket(b, 'iron', pole);
    const finial = new THREE.SphereGeometry(0.09, 6, 6);
    finial.translate(px, py + poleH + 0.05, pz);
    pushBucket(b, 'iron', finial);

    const fy = py + poleH - flagH * 0.58;
    // Main slate-blue flag body + upper/lower swallowtail tails
    const body = new THREE.BoxGeometry(flagW * 0.68, flagH, 0.045);
    body.translate(px + flagW * 0.34, fy, pz);
    pushBucket(b, 'roof', body);
    const tailTop = new THREE.BoxGeometry(flagW * 0.34, flagH * 0.36, 0.04);
    tailTop.translate(px + flagW * 0.82, fy + flagH * 0.28, pz);
    pushBucket(b, 'roof', tailTop);
    const tailBot = new THREE.BoxGeometry(flagW * 0.34, flagH * 0.36, 0.04);
    tailBot.translate(px + flagW * 0.82, fy - flagH * 0.28, pz);
    pushBucket(b, 'roof', tailBot);

    // Golden border strips + golden Anvil or Hammer emblem
    const trimTop = new THREE.BoxGeometry(flagW * 0.96, 0.055, 0.055);
    trimTop.translate(px + flagW * 0.48, fy + flagH * 0.46, pz);
    pushBucket(b, 'gold', trimTop);
    const trimBot = new THREE.BoxGeometry(flagW * 0.96, 0.055, 0.055);
    trimBot.translate(px + flagW * 0.48, fy - flagH * 0.46, pz);
    pushBucket(b, 'gold', trimBot);

    if (emblem === 'hammer') {
      const shaft = new THREE.BoxGeometry(0.07, flagH * 0.46, 0.06);
      shaft.translate(px + flagW * 0.34, fy - 0.03, pz);
      pushBucket(b, 'gold', shaft);
      const head = new THREE.BoxGeometry(flagW * 0.26, flagH * 0.18, 0.065);
      head.translate(px + flagW * 0.34, fy + flagH * 0.14, pz);
      pushBucket(b, 'gold', head);
    } else {
      const anvilTop = new THREE.BoxGeometry(flagW * 0.3, flagH * 0.18, 0.065);
      anvilTop.translate(px + flagW * 0.34, fy + 0.06, pz);
      pushBucket(b, 'gold', anvilTop);
      const anvilBase = new THREE.BoxGeometry(flagW * 0.22, flagH * 0.14, 0.065);
      anvilBase.translate(px + flagW * 0.34, fy - 0.1, pz);
      pushBucket(b, 'gold', anvilBase);
    }
  };

  // Helper: Vertical Hanging Dwarven Wall Banner (matching the Hammer & Anvil banners on the Citadel Keep in art/Mountain Kings Grand Citadel.jpg)
  const addVerticalWallBanner = (
    b: BucketMap,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    emblem: 'hammer' | 'anvil'
  ) => {
    const bar = new THREE.CylinderGeometry(0.04, 0.04, w + 0.22, 6);
    bar.rotateZ(Math.PI / 2);
    bar.translate(x, y + h * 0.5, z);
    pushBucket(b, 'iron', bar);

    const cloth = new THREE.BoxGeometry(w, h, 0.06);
    cloth.translate(x, y, z);
    pushBucket(b, 'roof', cloth);

    const trimL = new THREE.BoxGeometry(0.06, h, 0.07);
    trimL.translate(x - w * 0.45, y, z);
    pushBucket(b, 'gold', trimL);
    const trimR = new THREE.BoxGeometry(0.06, h, 0.07);
    trimR.translate(x + w * 0.45, y, z);
    pushBucket(b, 'gold', trimR);
    const trimB = new THREE.BoxGeometry(w, 0.07, 0.07);
    trimB.translate(x, y - h * 0.46, z);
    pushBucket(b, 'gold', trimB);

    if (emblem === 'hammer') {
      const handle = new THREE.BoxGeometry(0.09, h * 0.42, 0.08);
      handle.translate(x, y - 0.06, z);
      pushBucket(b, 'gold', handle);
      const head = new THREE.BoxGeometry(w * 0.52, h * 0.16, 0.085);
      head.translate(x, y + h * 0.14, z);
      pushBucket(b, 'gold', head);
    } else {
      const horn = new THREE.BoxGeometry(w * 0.56, h * 0.16, 0.085);
      horn.translate(x, y + 0.08, z);
      pushBucket(b, 'gold', horn);
      const foot = new THREE.BoxGeometry(w * 0.4, h * 0.14, 0.085);
      foot.translate(x, y - 0.12, z);
      pushBucket(b, 'gold', foot);
    }
  };

  // ============================================================================
  // TIER I: DWARVEN BORDER KEEP (Blocks 1..8 — Matches `art/dwarven border keep.jpg`)
  // Compact square fortified gatehouse keep with stepped mossy plinth, rusticated
  // corner courses, arched portal, twin arrow slits, oak doors with iron bands,
  // lowered wooden drawbridge with diagonal chains, 2 wall torches, and corbelled battlements.
  // ============================================================================

  // 0: Stepped Mossy-Limestone Plinth Base (`art/dwarven border keep.jpg` wide stepped foundation)
  {
    const b: BucketMap = {};
    const lowerCourse = new THREE.BoxGeometry(6.6, 0.42, 5.4);
    lowerCourse.translate(0, 0.21, 0);
    pushBucket(b, 'darkStone', lowerCourse);

    const upperLeft = new THREE.BoxGeometry(2.15, 0.38, 5.05);
    upperLeft.translate(-2.05, 0.58, 0);
    pushBucket(b, 'stone', upperLeft);

    const upperRight = new THREE.BoxGeometry(2.15, 0.38, 5.05);
    upperRight.translate(2.05, 0.58, 0);
    pushBucket(b, 'stone', upperRight);

    const centerThreshold = new THREE.BoxGeometry(2.2, 0.28, 4.7);
    centerThreshold.translate(0, 0.52, -0.1);
    pushBucket(b, 'darkStone', centerThreshold);

    addMultiSlot(1, 'Border Keep Stepped Plinth', 'South Gate Center', b, 0, 0, 3.6, 0, 6.2);
  }

  // 1: West Gatehouse Pillar, Rusticated Courses & Left Wall Torch
  {
    const b: BucketMap = {};
    const pillar = new THREE.BoxGeometry(1.85, 2.85, 2.2);
    pillar.translate(0, 0, 0);
    pushBucket(b, 'stone', pillar);

    const plinthButtress = new THREE.BoxGeometry(2.02, 0.72, 2.38);
    plinthButtress.translate(-0.04, -1.06, 0.04);
    pushBucket(b, 'darkStone', plinthButtress);

    // Rusticated corner quoin blocks matching `art/dwarven border keep.jpg`
    for (let i = 0; i < 4; i++) {
      const quoin = new THREE.BoxGeometry(0.88, 0.52, 0.42);
      quoin.translate(-0.56 + (i % 2) * 0.14, -0.62 + i * 0.62, 0.96);
      pushBucket(b, i % 2 === 0 ? 'stone' : 'darkStone', quoin);
    }

    // Left wall-mounted iron torch sconce & flame
    addWallTorch(b, 0.18, -0.15, 1.15);

    addMultiSlot(1, 'West Gatehouse Pillar & Torch', 'South-West Gate', b, -1.9, 2.15, 4.45, -2.1, 6.4);
  }

  // 2: East Gatehouse Pillar, Rusticated Courses & Right Wall Torch
  {
    const b: BucketMap = {};
    const pillar = new THREE.BoxGeometry(1.85, 2.85, 2.2);
    pillar.translate(0, 0, 0);
    pushBucket(b, 'stone', pillar);

    const plinthButtress = new THREE.BoxGeometry(2.02, 0.72, 2.38);
    plinthButtress.translate(0.04, -1.06, 0.04);
    pushBucket(b, 'darkStone', plinthButtress);

    for (let i = 0; i < 4; i++) {
      const quoin = new THREE.BoxGeometry(0.88, 0.52, 0.42);
      quoin.translate(0.56 - (i % 2) * 0.14, -0.62 + i * 0.62, 0.96);
      pushBucket(b, i % 2 === 0 ? 'stone' : 'darkStone', quoin);
    }

    // Right wall-mounted iron torch sconce & flame
    addWallTorch(b, -0.18, -0.15, 1.15);

    addMultiSlot(1, 'East Gatehouse Pillar & Torch', 'South-East Gate', b, 1.9, 2.15, 4.45, 2.1, 6.4);
  }

  // 3: Border Keep Side & Rear Fortified Walls (enclosing the 4-sided Keep)
  {
    const b: BucketMap = {};
    const westSide = new THREE.BoxGeometry(1.55, 2.95, 2.65);
    westSide.translate(-2.02, 0, -1.25);
    pushBucket(b, 'stone', westSide);

    const eastSide = new THREE.BoxGeometry(1.55, 2.95, 2.65);
    eastSide.translate(2.02, 0, -1.25);
    pushBucket(b, 'stone', eastSide);

    const rearWall = new THREE.BoxGeometry(5.55, 2.95, 1.35);
    rearWall.translate(0, 0, -2.15);
    pushBucket(b, 'stone', rearWall);

    const rearPlinth = new THREE.BoxGeometry(5.85, 0.68, 2.95);
    rearPlinth.translate(0, -1.12, -1.35);
    pushBucket(b, 'darkStone', rearPlinth);

    addMultiSlot(1, 'Border Keep Side & Rear Walls', 'South Gate Keep Rear', b, 0, 2.2, 3.6, 0, 6.3);
  }

  // 4: Arched Stone Portal & Twin Arrow Slits (`art/dwarven border keep.jpg` upper archway & slits)
  {
    const b: BucketMap = {};
    const upperWall = new THREE.BoxGeometry(5.6, 1.25, 4.5);
    upperWall.translate(0, 0.35, -0.75);
    pushBucket(b, 'stone', upperWall);

    // Stone voussoir arch segments curving over the doorway
    for (let i = -3; i <= 3; i++) {
      const ang = (i / 3.4) * (Math.PI * 0.44);
      const vx = Math.sin(ang) * 1.12;
      const vy = -0.82 + Math.cos(ang) * 0.72;
      const voussoir = new THREE.BoxGeometry(0.42, 0.46, 0.56);
      voussoir.rotateZ(-ang);
      voussoir.translate(vx, vy, 1.38);
      pushBucket(b, i % 2 === 0 ? 'stone' : 'darkStone', voussoir);
    }

    // Twin vertical arrow slits above the arch (`art/dwarven border keep.jpg`)
    for (const sx of [-0.82, 0.82]) {
      const slitRecess = new THREE.BoxGeometry(0.18, 0.52, 0.24);
      slitRecess.translate(sx, 0.36, 1.46);
      pushBucket(b, 'iron', slitRecess);

      const slitFrameL = new THREE.BoxGeometry(0.12, 0.58, 0.18);
      slitFrameL.translate(sx - 0.14, 0.36, 1.48);
      pushBucket(b, 'darkStone', slitFrameL);
      const slitFrameR = new THREE.BoxGeometry(0.12, 0.58, 0.18);
      slitFrameR.translate(sx + 0.14, 0.36, 1.48);
      pushBucket(b, 'darkStone', slitFrameR);
    }

    addMultiSlot(1, 'Arched Portal & Twin Arrow Slits', 'South Gate Archway', b, 0, 3.65, 3.6, 0, 6.4);
  }

  // 5: Heavy Iron-Strapped Oak Double Doors (`art/dwarven border keep.jpg`)
  {
    const b: BucketMap = {};
    const leftLeaf = new THREE.BoxGeometry(0.96, 2.38, 0.34);
    leftLeaf.translate(-0.5, 0, 0);
    pushBucket(b, 'wood', leftLeaf);

    const rightLeaf = new THREE.BoxGeometry(0.96, 2.38, 0.34);
    rightLeaf.translate(0.5, 0, 0);
    pushBucket(b, 'wood', rightLeaf);

    const archTop = new THREE.CylinderGeometry(0.96, 0.96, 0.34, 12, 1, false, 0, Math.PI);
    archTop.rotateX(Math.PI / 2);
    archTop.rotateY(Math.PI / 2);
    archTop.scale(1.0, 0.58, 1.0);
    archTop.translate(0, 1.05, 0);
    pushBucket(b, 'wood', archTop);

    // Two horizontal iron strap bands with rivets (`art/dwarven border keep.jpg`)
    for (const sy of [-0.42, 0.38]) {
      const strap = new THREE.BoxGeometry(1.94, 0.18, 0.39);
      strap.translate(0, sy, 0.02);
      pushBucket(b, 'iron', strap);
      for (const rx of [-0.74, -0.32, 0.32, 0.74]) {
        const rivet = new THREE.BoxGeometry(0.07, 0.07, 0.43);
        rivet.translate(rx, sy, 0.03);
        pushBucket(b, 'iron', rivet);
      }
    }

    const centerSeam = new THREE.BoxGeometry(0.06, 2.55, 0.38);
    centerSeam.translate(0, 0.08, 0.02);
    pushBucket(b, 'iron', centerSeam);

    addMultiSlot(1, 'Iron-Bound Oak Double Doors', 'South Gate Entrance', b, 0, 1.88, 4.72, 0, 6.4);
  }

  // 6: Lowered Timber Drawbridge & Diagonal Iron Chains (`art/dwarven border keep.jpg`)
  {
    const b: BucketMap = {};
    const ramp = new THREE.BoxGeometry(2.15, 0.2, 2.35);
    ramp.rotateX(0.07);
    ramp.translate(0, 0, 0);
    pushBucket(b, 'wood', ramp);

    // Individual plank ribs & iron binding bars on the drawbridge
    for (const zOff of [-0.95, 0.0, 0.98]) {
      const ironBand = new THREE.BoxGeometry(2.22, 0.08, 0.14);
      ironBand.translate(0, 0.09 - zOff * 0.07, zOff);
      pushBucket(b, 'iron', ironBand);
    }

    // Two diagonal iron chains running from drawbridge front corners up to upper arch ports
    addDiagonalChain(b, -1.04, 0.05, 1.02, -1.16, 2.85, -1.18, 14);
    addDiagonalChain(b, 1.04, 0.05, 1.02, 1.16, 2.85, -1.18, 14);

    addMultiSlot(1, 'Timber Drawbridge & Iron Chains', 'South Gate Drawbridge', b, 0, 0.72, 5.95, 0, 6.8);
  }

  // 7: Corbelled Machicolations & Crenellated Battlements (Completes Tier I Dwarven Border Keep!)
  {
    const b: BucketMap = {};
    // Overhanging parapet deck
    const parapetRim = new THREE.BoxGeometry(6.15, 0.46, 5.05);
    parapetRim.translate(0, 0.18, -0.65);
    pushBucket(b, 'stone', parapetRim);

    // Stone corbel brackets (`machicolations`) underneath the front and side overhangs (`art/dwarven border keep.jpg`)
    for (let x = -2.4; x <= 2.41; x += 0.8) {
      const corbelF = new THREE.BoxGeometry(0.36, 0.38, 0.36);
      corbelF.translate(x, -0.18, 1.72);
      pushBucket(b, 'darkStone', corbelF);
      const corbelB = new THREE.BoxGeometry(0.36, 0.38, 0.36);
      corbelB.translate(x, -0.18, -3.02);
      pushBucket(b, 'darkStone', corbelB);
    }
    for (let z = -2.45; z <= 1.25; z += 0.92) {
      const corbelW = new THREE.BoxGeometry(0.36, 0.38, 0.36);
      corbelW.translate(-2.92, -0.18, z);
      pushBucket(b, 'darkStone', corbelW);
      const corbelE = new THREE.BoxGeometry(0.36, 0.38, 0.36);
      corbelE.translate(2.92, -0.18, z);
      pushBucket(b, 'darkStone', corbelE);
    }

    // Heavy corner merlon blocks (`art/dwarven border keep.jpg` prominent L-shaped corner blocks)
    const corners = [
      [-2.58, 1.42],
      [2.58, 1.42],
      [-2.58, -2.72],
      [2.58, -2.72],
    ];
    for (const [cx, cz] of corners) {
      const cBlock = new THREE.BoxGeometry(1.02, 0.72, 0.96);
      cBlock.translate(cx, 0.68, cz);
      pushBucket(b, 'stone', cBlock);
    }

    // Center merlons between corners (3 front merlons matching `art/dwarven border keep.jpg`!)
    for (const mx of [-1.28, 0, 1.28]) {
      const mf = new THREE.BoxGeometry(0.68, 0.56, 0.54);
      mf.translate(mx, 0.62, 1.56);
      pushBucket(b, mx === 0 ? 'darkStone' : 'stone', mf);
      const mb = new THREE.BoxGeometry(0.68, 0.56, 0.54);
      mb.translate(mx, 0.62, -2.86);
      pushBucket(b, 'stone', mb);
    }
    for (const mz of [-1.45, -0.65, 0.25]) {
      const mw = new THREE.BoxGeometry(0.54, 0.56, 0.64);
      mw.translate(-2.76, 0.62, mz);
      pushBucket(b, 'stone', mw);
      const me = new THREE.BoxGeometry(0.54, 0.56, 0.64);
      me.translate(2.76, 0.62, mz);
      pushBucket(b, 'stone', me);
    }

    addMultiSlot(
      1,
      'Corbelled Overhang & Keep Battlements',
      'South Gate Crown',
      b,
      0,
      4.45,
      3.6,
      0,
      6.6
    );
  }

  // ============================================================================
  // TIER II: DWARVEN STONEWALL STRONGHOLD (Blocks 9..18 — Matches `art/Stonewall Stronghold.jpg`)
  // Expands outward around the Border Keep with 4 Round Crenellated Corner Watchtowers
  // (flared bases + arrow slits + overhanging crowns), Curtain Walls with front vertical
  // buttresses, and the 2nd-story Square Central Keep with upper arched oak door & braziers!
  // ============================================================================

  const buildRoundCornerTower = (hasFrontSlit: boolean, height: number): BucketMap => {
    const b: BucketMap = {};
    // Stepped flared stone base collar (`art/Stonewall Stronghold.jpg`)
    const baseFoot = new THREE.CylinderGeometry(2.12, 2.25, 0.62, 14);
    baseFoot.translate(0, -height * 0.5 + 0.31, 0);
    pushBucket(b, 'darkStone', baseFoot);

    const baseStep = new THREE.CylinderGeometry(1.94, 2.08, 0.72, 14);
    baseStep.translate(0, -height * 0.5 + 0.92, 0);
    pushBucket(b, 'stone', baseStep);

    // Main cylindrical ashlar shaft
    const shaft = new THREE.CylinderGeometry(1.76, 1.86, height - 0.8, 14);
    shaft.translate(0, 0.15, 0);
    pushBucket(b, 'stone', shaft);

    // Framed vertical arrow slit on the front face (`art/Stonewall Stronghold.jpg`)
    if (hasFrontSlit) {
      const slitFrame = new THREE.BoxGeometry(0.52, 1.05, 0.28);
      slitFrame.translate(0, 0.1, 1.72);
      pushBucket(b, 'darkStone', slitFrame);
      const slitHole = new THREE.BoxGeometry(0.16, 0.78, 0.34);
      slitHole.translate(0, 0.1, 1.76);
      pushBucket(b, 'iron', slitHole);
    } else {
      // Side rampart arched doorway on rear towers (`art/Stonewall Stronghold.jpg`)
      const archDoor = new THREE.BoxGeometry(0.65, 1.05, 0.35);
      archDoor.translate(0, 0.85, 1.65);
      pushBucket(b, 'iron', archDoor);
    }

    // Corbelled overhanging parapet collar & ring of thick crenellated merlons
    const corbelCollar = new THREE.CylinderGeometry(2.04, 1.78, 0.44, 14);
    corbelCollar.translate(0, height * 0.5 - 0.25, 0);
    pushBucket(b, 'darkStone', corbelCollar);

    const crownRim = new THREE.CylinderGeometry(2.14, 2.06, 0.48, 14);
    crownRim.translate(0, height * 0.5 + 0.18, 0);
    pushBucket(b, 'stone', crownRim);

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const merlon = new THREE.BoxGeometry(0.58, 0.56, 0.48);
      merlon.rotateY(-a + Math.PI / 2);
      merlon.translate(Math.cos(a) * 1.9, height * 0.5 + 0.68, Math.sin(a) * 1.9);
      pushBucket(b, i % 2 === 0 ? 'stone' : 'darkStone', merlon);
    }
    return b;
  };

  // 8: South-West Round Corner Watchtower (`art/Stonewall Stronghold.jpg` Front-Left Tower)
  {
    const b = buildRoundCornerTower(true, 4.9);
    addMultiSlot(
      2,
      'South-West Corner Watchtower',
      'SW Corner (-6.2m W, +3.6m S)',
      b,
      -6.2,
      2.45,
      3.6,
      -6.4,
      6.2
    );
  }

  // 9: South-East Round Corner Watchtower (`art/Stonewall Stronghold.jpg` Front-Right Tower)
  {
    const b = buildRoundCornerTower(true, 4.9);
    addMultiSlot(
      2,
      'South-East Corner Watchtower',
      'SE Corner (+6.2m E, +3.6m S)',
      b,
      6.2,
      2.45,
      3.6,
      6.4,
      6.2
    );
  }

  // 10: West Front & Side Curtain Wall with Stepped Buttress (`art/Stonewall Stronghold.jpg`)
  {
    const b: BucketMap = {};
    // Front curtain wall linking Border Keep to SW Tower + prominent stepped vertical buttress
    const frontWing = new THREE.BoxGeometry(2.6, 3.65, 1.55);
    frontWing.translate(1.85, 0, 3.25);
    pushBucket(b, 'stone', frontWing);

    const frontButtress = new THREE.BoxGeometry(0.82, 2.55, 0.72);
    frontButtress.translate(1.85, -0.55, 4.15);
    pushBucket(b, 'darkStone', frontButtress);

    // Front curtain merlons
    for (const mx of [1.25, 2.35]) {
      const m = new THREE.BoxGeometry(0.62, 0.55, 0.48);
      m.translate(mx, 2.08, 3.72);
      pushBucket(b, 'stone', m);
    }

    // West side curtain wall running North to NW Tower
    const sideWall = new THREE.BoxGeometry(1.5, 3.85, 7.6);
    sideWall.translate(0, 0.1, -0.4);
    pushBucket(b, 'stone', sideWall);

    for (let z = -3.2; z <= 2.2; z += 1.35) {
      const sm = new THREE.BoxGeometry(0.48, 0.55, 0.62);
      sm.translate(-0.48, 2.28, z);
      pushBucket(b, 'stone', sm);
    }

    addMultiSlot(
      2,
      'West Curtain Wall & Stepped Buttress',
      'West Wall (-6.1m W)',
      b,
      -6.1,
      1.85,
      0.0,
      -6.8,
      2.5
    );
  }

  // 11: East Front & Side Curtain Wall with Stepped Buttress (`art/Stonewall Stronghold.jpg`)
  {
    const b: BucketMap = {};
    const frontWing = new THREE.BoxGeometry(2.6, 3.65, 1.55);
    frontWing.translate(-1.85, 0, 3.25);
    pushBucket(b, 'stone', frontWing);

    const frontButtress = new THREE.BoxGeometry(0.82, 2.55, 0.72);
    frontButtress.translate(-1.85, -0.55, 4.15);
    pushBucket(b, 'darkStone', frontButtress);

    for (const mx of [-2.35, -1.25]) {
      const m = new THREE.BoxGeometry(0.62, 0.55, 0.48);
      m.translate(mx, 2.08, 3.72);
      pushBucket(b, 'stone', m);
    }

    const sideWall = new THREE.BoxGeometry(1.5, 3.85, 7.6);
    sideWall.translate(0, 0.1, -0.4);
    pushBucket(b, 'stone', sideWall);

    for (let z = -3.2; z <= 2.2; z += 1.35) {
      const sm = new THREE.BoxGeometry(0.48, 0.55, 0.62);
      sm.translate(0.48, 2.28, z);
      pushBucket(b, 'stone', sm);
    }

    addMultiSlot(
      2,
      'East Curtain Wall & Stepped Buttress',
      'East Wall (+6.1m E)',
      b,
      6.1,
      1.85,
      0.0,
      6.8,
      2.5
    );
  }

  // 12: North-West Rear Round Watchtower (`art/Stonewall Stronghold.jpg` Elevated Rear-Left Tower)
  {
    const b = buildRoundCornerTower(false, 5.7);
    addMultiSlot(
      2,
      'North-West Rear Watchtower',
      'NW Corner (-6.2m W, -4.4m N)',
      b,
      -6.2,
      2.85,
      -4.4,
      -6.5,
      -5.8
    );
  }

  // 13: North-East Rear Round Watchtower (`art/Stonewall Stronghold.jpg` Elevated Rear-Right Tower)
  {
    const b = buildRoundCornerTower(false, 5.7);
    addMultiSlot(
      2,
      'North-East Rear Watchtower',
      'NE Corner (+6.2m E, -4.4m N)',
      b,
      6.2,
      2.85,
      -4.4,
      6.5,
      -5.8
    );
  }

  // 14: North Rear Curtain Wall & Inner Courtyard Terrace
  {
    const b: BucketMap = {};
    const northWall = new THREE.BoxGeometry(11.6, 4.15, 1.5);
    northWall.translate(0, 2.08, -4.4);
    pushBucket(b, 'stone', northWall);

    for (let x = -4.2; x <= 4.21; x += 1.2) {
      const m = new THREE.BoxGeometry(0.62, 0.55, 0.48);
      m.translate(x, 4.4, -4.85);
      pushBucket(b, 'stone', m);
    }

    const courtyard = new THREE.BoxGeometry(11.2, 0.45, 7.6);
    courtyard.translate(0, 0.22, -0.4);
    pushBucket(b, 'darkStone', courtyard);

    addMultiSlot(
      2,
      'North Curtain Wall & Courtyard',
      'North Wall (-4.4m N)',
      b,
      0,
      0,
      0,
      0,
      -6.2
    );
  }

  // 15: Central Stronghold Upper Keep Bastion (`art/Stonewall Stronghold.jpg` 2nd-story Square Keep)
  {
    const b: BucketMap = {};
    const keepBody = new THREE.BoxGeometry(5.6, 3.8, 4.6);
    keepBody.translate(0, 0, 0);
    pushBucket(b, 'stone', keepBody);

    // Front corner pilasters flanking the upper arched portal (`art/Stonewall Stronghold.jpg`)
    const pilasterL = new THREE.BoxGeometry(1.35, 3.85, 0.45);
    pilasterL.translate(-2.05, 0, 2.25);
    pushBucket(b, 'darkStone', pilasterL);

    const pilasterR = new THREE.BoxGeometry(1.35, 3.85, 0.45);
    pilasterR.translate(2.05, 0, 2.25);
    pushBucket(b, 'darkStone', pilasterR);

    addMultiSlot(
      2,
      'Central Stronghold Keep Bastion',
      'Central Keep (South Gate)',
      b,
      0,
      4.9,
      -0.2,
      0,
      6.4
    );
  }

  // 16: Central Stronghold Upper Arched Oak Door & Crenellated Keep Crown (`art/Stonewall Stronghold.jpg`)
  {
    const b: BucketMap = {};
    // Upper arched wooden door opening onto the Gatehouse roof terrace
    const doorRect = new THREE.BoxGeometry(1.25, 1.55, 0.28);
    doorRect.translate(0, -1.1, 2.28);
    pushBucket(b, 'wood', doorRect);

    const doorStrap1 = new THREE.BoxGeometry(1.28, 0.12, 0.32);
    doorStrap1.translate(0, -0.82, 2.3);
    pushBucket(b, 'iron', doorStrap1);
    const doorStrap2 = new THREE.BoxGeometry(1.28, 0.12, 0.32);
    doorStrap2.translate(0, -1.35, 2.3);
    pushBucket(b, 'iron', doorStrap2);

    // Stone arch frame around the upper keep door
    const archHeader = new THREE.BoxGeometry(1.65, 0.38, 0.36);
    archHeader.translate(0, -0.22, 2.28);
    pushBucket(b, 'darkStone', archHeader);

    // Overhanging crenellated crown of the Central Keep (`art/Stonewall Stronghold.jpg`)
    const crownRim = new THREE.BoxGeometry(6.15, 0.45, 5.15);
    crownRim.translate(0, 0.95, 0);
    pushBucket(b, 'darkStone', crownRim);

    for (let x = -2.6; x <= 2.61; x += 1.3) {
      const mf = new THREE.BoxGeometry(0.72, 0.58, 0.52);
      mf.translate(x, 1.44, 2.28);
      pushBucket(b, 'stone', mf);
      const mb = new THREE.BoxGeometry(0.72, 0.58, 0.52);
      mb.translate(x, 1.44, -2.28);
      pushBucket(b, 'stone', mb);
    }

    addMultiSlot(
      2,
      'Central Keep Arched Door & Crown',
      'Central Keep Terrace',
      b,
      0,
      6.05,
      -0.2,
      0,
      6.4
    );
  }

  // 17: Stronghold Terrace & Rampart Flaming Braziers (Completes Tier II Dwarven Stonewall Stronghold!)
  {
    const b: BucketMap = {};
    // Two flaming braziers flanking the upper Central Keep door on the gatehouse terrace (`art/Stonewall Stronghold.jpg`)
    addStoneBrazier(b, -1.65, 4.65, 2.25);
    addStoneBrazier(b, 1.65, 4.65, 2.25);
    // Two flaming torches/braziers on the left and right courtyard rampart walls (`art/Stonewall Stronghold.jpg`)
    addStoneBrazier(b, -4.15, 3.85, 1.85);
    addStoneBrazier(b, 4.15, 3.85, 1.85);
    // Central Keep roof beacon brazier (`art/Stonewall Stronghold.jpg` top flame)
    addStoneBrazier(b, 0, 7.15, -0.2);

    addMultiSlot(
      2,
      'Stronghold Flaming Terrace Braziers',
      'South Gate Terrace',
      b,
      0,
      0,
      0,
      0,
      6.5
    );
  }

  // ============================================================================
  // TIER III: MOUNTAIN KING'S GRAND CITADEL (Blocks 19..30 — Matches `art/Mountain Kings Grand Citadel.jpg`)
  // Adds the Left Rampart Stone Staircase, the Left Cylindrical Side Watch-Turret + Conical
  // Slate Roof, 4 Conical Slate Roofs & Swallowtail Anvil/Hammer Pennants on the 4 Corner
  // Towers, the Tall Central King's Spire (glowing window slit + corbelled belfry + grand
  // conical slate roof), and the Royal Hanging Dwarven Hammer & Anvil Banners!
  // ============================================================================

  // Helper: Faceted Conical Blue-Grey Slate Roof with Slate Course Ribs (`art/Mountain Kings Grand Citadel.jpg`)
  const addConicalSlateRoof = (
    b: BucketMap,
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    height: number
  ) => {
    const cone = new THREE.ConeGeometry(radius, height, 12);
    cone.translate(cx, cy + height * 0.5, cz);
    pushBucket(b, 'roof', cone);

    const eavesRing = new THREE.CylinderGeometry(radius * 1.03, radius * 1.06, 0.18, 12);
    eavesRing.translate(cx, cy + 0.08, cz);
    pushBucket(b, 'darkStone', eavesRing);
  };

  // 18: Left Rampart Stepped Stone Staircase (`art/Mountain Kings Grand Citadel.jpg` left courtyard stairs)
  {
    const b: BucketMap = {};
    for (let s = 0; s < 6; s++) {
      const step = new THREE.BoxGeometry(1.55, 0.34, 0.56);
      step.translate(0, s * 0.32, 1.4 - s * 0.48);
      pushBucket(b, s % 2 === 0 ? 'stone' : 'darkStone', step);
    }
    addMultiSlot(
      3,
      'Rampart Stone Staircase',
      'West Rampart (-3.5m W)',
      b,
      -3.55,
      3.85,
      0.85,
      -4.5,
      6.2
    );
  }

  // 19: Inner Citadel Keep Rear Royal Hall Bastion
  {
    const b: BucketMap = {};
    const hall = new THREE.BoxGeometry(6.4, 4.6, 2.8);
    hall.translate(0, 0, 0);
    pushBucket(b, 'stone', hall);

    const corbel = new THREE.BoxGeometry(6.7, 0.42, 3.1);
    corbel.translate(0, 2.35, 0);
    pushBucket(b, 'darkStone', corbel);

    addMultiSlot(
      3,
      'Inner Citadel Royal Hall',
      'North-Center Keep',
      b,
      0,
      4.4,
      -2.6,
      0,
      -6.2
    );
  }

  // 20: West Inner Watch-Turret Shaft & Eaves (`art/Mountain Kings Grand Citadel.jpg` left inner round turret)
  {
    const b: BucketMap = {};
    const shaft = new THREE.CylinderGeometry(1.08, 1.16, 3.6, 12);
    shaft.translate(0, 0, 0);
    pushBucket(b, 'stone', shaft);

    const collar = new THREE.CylinderGeometry(1.22, 1.08, 0.36, 12);
    collar.translate(0, 1.75, 0);
    pushBucket(b, 'darkStone', collar);

    const slit = new THREE.BoxGeometry(0.14, 0.48, 0.24);
    slit.translate(0, 0.85, 1.06);
    pushBucket(b, 'iron', slit);

    addMultiSlot(
      3,
      'West Inner Watch-Turret Shaft',
      'Central-West Keep',
      b,
      -2.05,
      7.65,
      -0.65,
      -3.5,
      6.2
    );
  }

  // 21: West Inner Watch-Turret Conical Slate Roof (`art/Mountain Kings Grand Citadel.jpg`)
  {
    const b: BucketMap = {};
    addConicalSlateRoof(b, 0, 0, 0, 1.32, 1.95);
    addMultiSlot(
      3,
      'West Watch-Turret Slate Roof',
      'Central-West Keep',
      b,
      -2.05,
      9.55,
      -0.65,
      -3.5,
      6.2
    );
  }

  // 22: South-West Corner Tower Conical Slate Roof & Dwarven Anvil Banner (`art/Mountain Kings Grand Citadel.jpg`)
  {
    const b: BucketMap = {};
    addConicalSlateRoof(b, 0, 0, 0, 1.85, 2.35);
    addSwallowtailPennant(b, 0, 2.25, 0, 1.65, 1.65, 0.56, 'anvil');
    addMultiSlot(
      3,
      'SW Tower Slate Roof & Anvil Pennant',
      'SW Corner (-6.2m W, +3.6m S)',
      b,
      -6.2,
      5.25,
      3.6,
      -6.4,
      6.2
    );
  }

  // 23: South-East Corner Tower Conical Slate Roof & Dwarven Hammer Banner (`art/Mountain Kings Grand Citadel.jpg`)
  {
    const b: BucketMap = {};
    addConicalSlateRoof(b, 0, 0, 0, 1.85, 2.35);
    addSwallowtailPennant(b, 0, 2.25, 0, 1.65, 1.65, 0.56, 'hammer');
    addMultiSlot(
      3,
      'SE Tower Slate Roof & Hammer Pennant',
      'SE Corner (+6.2m E, +3.6m S)',
      b,
      6.2,
      5.25,
      3.6,
      6.4,
      6.2
    );
  }

  // 24: North-West Corner Tower Conical Slate Roof & Dwarven Hammer Banner (`art/Mountain Kings Grand Citadel.jpg`)
  {
    const b: BucketMap = {};
    addConicalSlateRoof(b, 0, 0, 0, 1.85, 2.35);
    addSwallowtailPennant(b, 0, 2.25, 0, 1.55, 1.45, 0.5, 'hammer');
    addMultiSlot(
      3,
      'NW Tower Slate Roof & Hammer Pennant',
      'NW Corner (-6.2m W, -4.4m N)',
      b,
      -6.2,
      6.05,
      -4.4,
      -6.4,
      -5.8
    );
  }

  // 25: North-East Corner Tower Conical Slate Roof & Dwarven Anvil Banner (`art/Mountain Kings Grand Citadel.jpg`)
  {
    const b: BucketMap = {};
    addConicalSlateRoof(b, 0, 0, 0, 1.85, 2.35);
    addSwallowtailPennant(b, 0, 2.25, 0, 1.55, 1.45, 0.5, 'anvil');
    addMultiSlot(
      3,
      'NE Tower Slate Roof & Anvil Pennant',
      'NE Corner (+6.2m E, -4.4m N)',
      b,
      6.2,
      6.05,
      -4.4,
      6.4,
      -5.8
    );
  }

  // 26: Central King's Spire Stone Shaft & Glowing Window (`art/Mountain Kings Grand Citadel.jpg`)
  {
    const b: BucketMap = {};
    const spireShaft = new THREE.CylinderGeometry(1.62, 1.75, 2.85, 10);
    spireShaft.translate(0, 0, 0);
    pushBucket(b, 'stone', spireShaft);

    // Warm glowing vertical window slit in the front of the King's Spire (`art/Mountain Kings Grand Citadel.jpg`)
    const winFrame = new THREE.BoxGeometry(0.46, 0.78, 0.26);
    winFrame.translate(0, -0.15, 1.62);
    pushBucket(b, 'darkStone', winFrame);
    const winGlow = new THREE.BoxGeometry(0.18, 0.52, 0.32);
    winGlow.translate(0, -0.15, 1.66);
    pushBucket(b, 'flame', winGlow);

    addMultiSlot(
      3,
      "Central King's Spire Stone Shaft",
      'Central Spire (Keep Top)',
      b,
      0.2,
      8.55,
      -0.8,
      0,
      6.4
    );
  }

  // 27: Central King's Spire Corbelled Belfry & Machicolation Crown (`art/Mountain Kings Grand Citadel.jpg`)
  {
    const b: BucketMap = {};
    const corbelBase = new THREE.CylinderGeometry(1.96, 1.64, 0.48, 10);
    corbelBase.translate(0, -0.25, 0);
    pushBucket(b, 'darkStone', corbelBase);

    const belfryDrum = new THREE.CylinderGeometry(2.05, 1.96, 0.72, 10);
    belfryDrum.translate(0, 0.32, 0);
    pushBucket(b, 'stone', belfryDrum);

    // Small arched belfry openings around the upper spire collar (`art/Mountain Kings Grand Citadel.jpg`)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const hole = new THREE.BoxGeometry(0.24, 0.34, 0.24);
      hole.rotateY(-a + Math.PI / 2);
      hole.translate(Math.cos(a) * 1.92, 0.28, Math.sin(a) * 1.92);
      pushBucket(b, 'iron', hole);
    }

    addMultiSlot(
      3,
      "Central King's Spire Belfry Crown",
      'Central Spire (Keep Top)',
      b,
      0.2,
      10.15,
      -0.8,
      0,
      6.4
    );
  }

  // 28: Central King's Spire Grand Conical Slate Roof (`art/Mountain Kings Grand Citadel.jpg`)
  {
    const b: BucketMap = {};
    addConicalSlateRoof(b, 0, 0, 0, 2.38, 2.65);
    addMultiSlot(
      3,
      "Central King's Spire Slate Roof",
      'Central Spire (Keep Top)',
      b,
      0.2,
      10.85,
      -0.8,
      0,
      6.4
    );
  }

  // 29: Royal Dwarven Hammer & Anvil Hanging Banners & High King's Pennant (Completes Tier III Grand Citadel!)
  {
    const b: BucketMap = {};
    // Highest swallowtail Dwarven Hammer & Anvil banner atop the Central King's Spire
    addSwallowtailPennant(b, 0.2, 13.4, -0.8, 1.65, 1.65, 0.56, 'hammer');

    // Left hanging vertical Dwarven Hammer banner on the West Inner Watch-Turret (`art/Mountain Kings Grand Citadel.jpg`)
    addVerticalWallBanner(b, -2.05, 7.15, 0.52, 0.76, 1.38, 'hammer');

    // Right hanging vertical Dwarven Anvil banner on the East Central Keep Pilaster (`art/Mountain Kings Grand Citadel.jpg`)
    addVerticalWallBanner(b, 2.05, 6.25, 2.32, 0.76, 1.38, 'anvil');

    // Secondary rooftop pennants flanking the central keep (`art/Mountain Kings Grand Citadel.jpg`)
    addSwallowtailPennant(b, 2.15, 7.5, -0.4, 1.35, 1.05, 0.36, 'anvil');

    addMultiSlot(
      3,
      'Royal Dwarven Hammer & Anvil Banners',
      'South Gate Front',
      b,
      0,
      0,
      0,
      0,
      6.6
    );
  }

  return { slots, geos };
}

function getSharedMasonryAssets(): SharedMasonryAssets {
  if (sharedMasonryAssets) return sharedMasonryAssets;

  // Low-poly procedural rock fallback (< 50 tris) for chunks beyond dist > 1.5
  const fallbackRockGeo = new THREE.DodecahedronGeometry(0.44, 1);
  fallbackRockGeo.scale(1.18, 0.84, 1.06);
  fallbackRockGeo.translate(0, 0.36, 0);
  fallbackRockGeo.computeBoundingBox();
  fallbackRockGeo.computeBoundingSphere();

  const fallbackRockMat = new THREE.MeshStandardMaterial({
    color: 0x8b9098,
    roughness: 0.88,
    metalness: 0.04,
  });

  const rockRingGeo = new THREE.RingGeometry(0.55, 0.72, 20);
  rockRingGeo.rotateX(-Math.PI / 2);
  const rockRingMat = new THREE.MeshBasicMaterial({
    color: 0xffe066,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
  });

  // Quarry paved foundation & rocks (top surface at Y = +0.24, deep skirt down to Y = -0.40)
  const padCyl = new THREE.CylinderGeometry(4.4, 4.9, 0.64, 24);
  padCyl.translate(0, -0.08, 0);
  const rimBlock1 = new THREE.BoxGeometry(1.1, 0.45, 0.75);
  rimBlock1.translate(-3.1, 0.32, -1.8);
  const rimBlock2 = new THREE.BoxGeometry(0.95, 0.65, 0.85);
  rimBlock2.translate(-2.8, 0.42, -2.5);
  const quarryPadGeo = mergeGeometries([padCyl, rimBlock1, rimBlock2], false);
  padCyl.dispose();
  rimBlock1.dispose();
  rimBlock2.dispose();

  const quarryPadMat = new THREE.MeshStandardMaterial({
    color: 0x6f757e,
    roughness: 0.9,
    metalness: 0.05,
  });

  // Low-poly procedural fallback for Dwarven Workbench (`dist > 1.8` chunks) with base at Y = 0
  const wbParts: THREE.BufferGeometry[] = [];
  const benchTop = new THREE.BoxGeometry(2.05, 0.14, 1.55);
  benchTop.translate(0, 0.69, 0);
  wbParts.push(benchTop);
  const legOffsets = [
    [-0.82, 0.31, -0.58],
    [0.82, 0.31, -0.58],
    [-0.82, 0.31, 0.58],
    [0.82, 0.31, 0.58],
  ];
  for (const [lx, ly, lz] of legOffsets) {
    const leg = new THREE.BoxGeometry(0.14, 0.62, 0.14);
    leg.translate(lx, ly, lz);
    wbParts.push(leg);
  }
  const fallbackWorkbenchGeo = mergeGeometries(wbParts, false);
  for (const p of wbParts) p.dispose();
  fallbackWorkbenchGeo.computeBoundingBox();
  fallbackWorkbenchGeo.computeBoundingSphere();

  // Low-poly procedural fallback for Wooden Jib Crane (`dist > 1.8` chunks) with base at Y = 0
  const craneParts: THREE.BufferGeometry[] = [];
  const craneMast = new THREE.CylinderGeometry(0.14, 0.18, 4.2, 8);
  craneMast.translate(-0.35, 2.1, 0);
  craneParts.push(craneMast);
  const craneBoom = new THREE.CylinderGeometry(0.1, 0.13, 3.5, 8);
  craneBoom.rotateZ(-0.62);
  craneBoom.translate(0.7, 3.1, 0);
  craneParts.push(craneBoom);
  const craneStrut = new THREE.BoxGeometry(1.4, 0.16, 0.18);
  craneStrut.translate(0.3, 1.85, 0);
  craneParts.push(craneStrut);
  const fallbackJibCraneGeo = mergeGeometries(craneParts, false);
  for (const p of craneParts) p.dispose();
  fallbackJibCraneGeo.computeBoundingBox();
  fallbackJibCraneGeo.computeBoundingSphere();

  // Quarry Wooden Minecart Body + Sleepers at (+2.35, 0.56, -1.15)
  const timberParts: THREE.BufferGeometry[] = [];
  const cartBox = new THREE.BoxGeometry(1.15, 0.58, 0.78);
  cartBox.translate(2.35, 0.56, -1.15);
  timberParts.push(cartBox);
  for (let s = -2; s <= 2; s++) {
    const sleeper = new THREE.BoxGeometry(0.18, 0.06, 0.95);
    sleeper.translate(2.35 + s * 0.52, 0.25, -1.15);
    timberParts.push(sleeper);
  }

  const quarryTimberGeo = mergeGeometries(timberParts, false);
  for (const p of timberParts) p.dispose();
  const quarryTimberMat = new THREE.MeshStandardMaterial({
    color: 0x7c5332,
    roughness: 0.82,
    metalness: 0.06,
  });

  // Quarry Iron Rails & Minecart Track
  const ironParts: THREE.BufferGeometry[] = [];
  const rail1 = new THREE.BoxGeometry(2.6, 0.06, 0.06);
  rail1.translate(2.35, 0.29, -1.45);
  ironParts.push(rail1);
  const rail2 = new THREE.BoxGeometry(2.6, 0.06, 0.06);
  rail2.translate(2.35, 0.29, -0.85);
  ironParts.push(rail2);
  const quarryIronGeo = mergeGeometries(ironParts, false);
  for (const p of ironParts) p.dispose();
  const quarryIronMat = new THREE.MeshStandardMaterial({
    color: 0x42474f,
    roughness: 0.45,
    metalness: 0.72,
  });

  const craneWheelGeo = new THREE.TorusGeometry(0.28, 0.05, 7, 14);
  const stockpileBlockGeo = new THREE.BoxGeometry(0.54, 0.3, 0.38);

  const ashlarStoneMat = new THREE.MeshStandardMaterial({
    color: 0xb7b1a1,
    roughness: 0.84,
    metalness: 0.05,
  });
  const darkStoneMat = new THREE.MeshStandardMaterial({
    color: 0x8e8d7a,
    roughness: 0.88,
    metalness: 0.05,
  });
  const castleWoodMat = new THREE.MeshStandardMaterial({
    color: 0x784e2e,
    roughness: 0.8,
    metalness: 0.08,
  });
  const slateRoofMat = new THREE.MeshStandardMaterial({
    color: 0x576779,
    roughness: 0.68,
    metalness: 0.18,
  });
  const bannerGoldMat = new THREE.MeshStandardMaterial({
    color: 0xe6a832,
    roughness: 0.35,
    metalness: 0.65,
    emissive: 0x523400,
    emissiveIntensity: 0.35,
  });
  const torchFlameMat = new THREE.MeshBasicMaterial({
    color: 0xffa62b,
  });

  const ghostSlotMat = new THREE.MeshBasicMaterial({
    color: 0x48cae4,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
  });

  // Subtle golden architectural blueprint wireframe for all remaining unplaced slots of the active Tier
  const blueprintSlotMat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    wireframe: true,
    transparent: true,
    opacity: 0.24,
  });

  const workRingGeo = new THREE.RingGeometry(0.95, 1.25, 24);
  workRingGeo.rotateX(-Math.PI / 2);
  const workRingMat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.72,
  });

  const targetRingGeo = new THREE.RingGeometry(0.85, 1.2, 24);
  targetRingGeo.rotateX(-Math.PI / 2);
  const targetRingMat = new THREE.MeshBasicMaterial({
    color: 0x48cae4,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });

  const levelGuideRingGeo = new THREE.RingGeometry(1.8, 2.25, 28);
  levelGuideRingGeo.rotateX(-Math.PI / 2);
  const levelGuideRingMat = new THREE.MeshBasicMaterial({
    color: 0x52b788,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.82,
  });

  // Bobbing 3D Arrow above the active Castle Block Slot
  const cone = new THREE.ConeGeometry(0.42, 0.75, 8);
  cone.rotateX(Math.PI);
  const shaft = new THREE.CylinderGeometry(0.16, 0.16, 0.7, 8);
  shaft.translate(0, 0.65, 0);
  const beaconArrowGeo = mergeGeometries([cone, shaft], false);
  cone.dispose();
  shaft.dispose();

  const beaconBeamGeo = new THREE.CylinderGeometry(0.18, 0.45, 7.5, 12, 1, true);
  beaconBeamGeo.translate(0, 3.75, 0);
  const beaconBeamMat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });

  // 3D Foot Compass Chevron pointing from the Dwarf toward the active Quarry / Castle Slot / Stone
  const chevL = new THREE.BoxGeometry(0.12, 0.04, 0.42);
  chevL.rotateY(0.55);
  chevL.translate(-0.11, 0, 0.95);
  const chevR = new THREE.BoxGeometry(0.12, 0.04, 0.42);
  chevR.rotateY(-0.55);
  chevR.translate(0.11, 0, 0.95);
  const footRing = new THREE.RingGeometry(0.62, 0.72, 24);
  footRing.rotateX(-Math.PI / 2);
  const footCompassGeo = mergeGeometries([chevL, chevR, footRing], false);
  chevL.dispose();
  chevR.dispose();
  footRing.dispose();

  const footCompassMat = new THREE.MeshBasicMaterial({
    color: 0x72efdd,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.78,
  });

  const builtCastle = buildCastleSlotsAndGeometries();

  sharedMasonryAssets = {
    fallbackRockGeo,
    fallbackRockMat,
    fallbackWorkbenchGeo,
    fallbackJibCraneGeo,
    rockRingGeo,
    rockRingMat,
    quarryPadGeo,
    quarryPadMat,
    quarryTimberGeo,
    quarryTimberMat,
    quarryIronGeo,
    quarryIronMat,
    craneWheelGeo,
    stockpileBlockGeo,
    ashlarStoneMat,
    darkStoneMat,
    castleWoodMat,
    slateRoofMat,
    bannerGoldMat,
    torchFlameMat,
    ghostSlotMat,
    blueprintSlotMat,
    workRingGeo,
    workRingMat,
    targetRingGeo,
    targetRingMat,
    levelGuideRingGeo,
    levelGuideRingMat,
    beaconArrowGeo,
    beaconBeamGeo,
    beaconBeamMat,
    footCompassGeo,
    footCompassMat,
    castleSlots: builtCastle.slots,
    castleSlotGeos: builtCastle.geos,
  };
  return sharedMasonryAssets;
}

const tempNormal = new THREE.Vector3();
const tempSlotWorld = new THREE.Vector3();
const tempDropWorld = new THREE.Vector3();
const LEVEL_EVAL_UNIT_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export class CastleAndQuarryManager {
  public readonly group = new THREE.Group();

  // Health, Strength/Energy & Food Survival State
  public health = 100;
  public energy = 100;
  public foodCount = 2; // Starter rations so the dwarf can test eating right away
  public carriedRawStones = 0;
  public carriedChiseledBlocks = 0;

  // Combat & Castle Armory State
  public equippedWeaponId: EquippedWeaponId = 'mallet';
  public equippedShieldId: EquippedShieldId = 'none';
  public kingsValorTimer = 0;
  public trollsSlainBonusCount = 0;

  private unlockedEquipment = new Set<HouseEquipmentId>();
  private unlockedArmory = new Set<CastleArmoryItemId>();
  private quarries: QuarryInstance[] = [];
  private castles: CastleInstance[] = [];
  private completedCastlesCache: Array<{ x: number; z: number; blocksPlaced: number }> = [];
  private completedCastlesDirty = true;
  private readonly levelEvalResult = { isLevel: true, groundY: 0, normalY: 1, reason: '' };
  private readonly nearestRockResult = { rock: null as NaturalRockInstance | null, dist: Infinity };
  private readonly enterableCastleResult = {
    castle: null as CastleInstance | null,
    doorDist: Infinity,
    doorX: 0,
    doorZ: 0,
  };
  private activeChunkRocks = new Map<number, NaturalRockInstance[]>();
  private quarryBonusRocks: NaturalRockInstance[] = [];
  private desiredKeys = new Set<number>();
  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;

  // 3D Guidance & Level-Ground Preview Meshes
  private footCompassMesh!: THREE.Mesh;
  private levelGuideRingMesh!: THREE.Mesh;
  private levelGuideTimer = 0;

  // DOM Elements
  private healthFillEl: HTMLElement | null;
  private healthTextEl: HTMLElement | null;
  private energyFillEl: HTMLElement | null;
  private energyTextEl: HTMLElement | null;
  private foodCountEl: HTMLElement | null;
  private topFoodHudEl: HTMLElement | null;
  private combatGearBadgeEl: HTMLElement | null;
  private eatFoodBtnEl: HTMLButtonElement | null;
  private masonryBannerEl: HTMLElement | null;
  private milestoneHudEl: HTMLElement | null;
  private houseShopEl: HTMLElement | null;
  private houseShopListEl: HTMLElement | null;
  private castleShopEl: HTMLElement | null;
  private castleShopTitleEl: HTMLElement | null;
  private castleShopListEl: HTMLElement | null;
  private toastContainer: HTMLElement | null;

  private lastHealthPct = -1;
  private lastHealthText = '';
  private lastEnergyPct = -1;
  private lastEnergyText = '';
  private lastFoodText = '';
  private lastGearBadgeText = '';
  private lastBannerHtml = '';
  private lastBannerVisible = false;
  private lastMilestoneText = '';

  public onStateChanged?: () => void;
  public isInsideCastleFn: () => boolean = () => false;
  public getActiveCastleVisitFn: () => ActiveCastleVisit | null = () => null;
  public onRequestEnterCastle?: (visit: ActiveCastleVisit) => void;
  public onRequestExitCastle?: () => void;
  public onRequestRestUntilDawn?: () => void;

  constructor(
    private config: WorldConfig,
    _noise: TerrainNoise,
    private chunkManager: ChunkManager,
    private dwarf: DwarfCharacter,
    private getGold: () => number,
    private spendGold: (amount: number) => boolean,
    private grantGold: (amount: number, message: string) => void,
    private isInsideHutFn: () => boolean
  ) {
    this.group.matrixAutoUpdate = false;

    this.healthFillEl = document.getElementById('health-bar-fill');
    this.healthTextEl = document.getElementById('health-bar-text');
    this.energyFillEl = document.getElementById('energy-bar-fill');
    this.energyTextEl = document.getElementById('energy-bar-text');
    this.foodCountEl = document.getElementById('food-count-value');
    this.topFoodHudEl = document.getElementById('top-food-hud-pill');
    this.combatGearBadgeEl = document.getElementById('combat-gear-badge');
    this.eatFoodBtnEl = document.getElementById('eat-food-btn') as HTMLButtonElement | null;
    this.masonryBannerEl = document.getElementById('masonry-banner');
    this.milestoneHudEl = document.getElementById('castle-milestone-pill');
    this.houseShopEl = document.getElementById('house-equipment-shop');
    this.houseShopListEl = document.getElementById('house-equipment-list');
    this.castleShopEl = document.getElementById('castle-armory-shop');
    this.castleShopTitleEl = document.getElementById('castle-armory-title');
    this.castleShopListEl = document.getElementById('castle-armory-list');
    this.toastContainer = document.getElementById('pickup-toasts');

    const assets = getSharedMasonryAssets();

    this.footCompassMesh = new THREE.Mesh(assets.footCompassGeo, assets.footCompassMat);
    this.footCompassMesh.visible = false;
    this.group.add(this.footCompassMesh);

    this.levelGuideRingMesh = new THREE.Mesh(assets.levelGuideRingGeo, assets.levelGuideRingMat);
    this.levelGuideRingMesh.visible = false;
    this.group.add(this.levelGuideRingMesh);

    loadNaturalRockModel(() => {
      for (const q of this.quarries) {
        this.syncQuarryPropVisuals(q);
      }
    });

    loadQuarryPropModels(() => {
      for (const q of this.quarries) {
        this.syncQuarryPropVisuals(q);
      }
    });

    this.buildHouseShopDOM();
    this.buildCastleArmoryShopDOM();
    this.bindEvents();
    this.syncEnergyAndFoodHUD();
    this.syncMilestoneHUD();
  }

  public getMaxHealth(): number {
    const shieldBonus =
      this.equippedShieldId === 'mithril_aegis'
        ? 50
        : this.equippedShieldId === 'round_shield'
          ? 25
          : 0;
    const slayerBonus = Math.min(60, this.trollsSlainBonusCount * 10);
    return 100 + shieldBonus + slayerBonus;
  }

  public getMaxEnergy(): number {
    return this.unlockedEquipment.has('ration_kettle') ? 160 : 100;
  }

  public getMaxRawStonesCarry(): number {
    return this.unlockedEquipment.has('stone_hauler') ? 3 : 1;
  }

  public getMaxBlocksCarry(): number {
    return this.unlockedEquipment.has('stone_hauler') ? 4 : 1;
  }

  public hasEquipment(id: HouseEquipmentId): boolean {
    return this.unlockedEquipment.has(id);
  }

  public getCarrySpeedMultiplier(): number {
    let mult = 1.0;
    const isCarrying = this.carriedRawStones > 0 || this.carriedChiseledBlocks > 0;
    if (isCarrying) {
      mult *= this.unlockedEquipment.has('stone_hauler') ? 1.08 : 0.86;
    }
    if (this.energy < 12) {
      mult *= 0.85;
    }
    return mult;
  }

  private bindEvents(): void {
    document.getElementById('quarry-place-btn')?.addEventListener('click', () => {
      this.setUpQuarryAtPlayer();
    });
    document.getElementById('castle-place-btn')?.addEventListener('click', () => {
      this.setUpCastleAtPlayer();
    });
    this.eatFoodBtnEl?.addEventListener('click', () => {
      this.eatFood(false);
    });
    this.topFoodHudEl?.addEventListener('click', () => {
      this.eatFood(false);
    });

    this.masonryBannerEl?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.masonry-action-work')) {
        this.tryInteractAtPlayerPos();
      } else if (target.closest('.masonry-action-quarry')) {
        this.setUpQuarryAtPlayer();
      } else if (target.closest('.masonry-action-castle')) {
        this.setUpCastleAtPlayer();
      } else if (target.closest('.masonry-action-eat')) {
        this.eatFood(false);
      } else if (target.closest('.masonry-action-enter-castle')) {
        this.tryEnterNearestCastle();
      } else if (target.closest('.masonry-action-exit-castle')) {
        this.onRequestExitCastle?.();
      } else if (target.closest('.masonry-action-rest-dawn')) {
        this.onRequestRestUntilDawn?.();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyQ') {
        this.setUpQuarryAtPlayer();
      } else if (e.code === 'KeyK') {
        this.setUpCastleAtPlayer();
      } else if (e.code === 'KeyG') {
        this.eatFood(false);
      } else if (e.code === 'KeyE') {
        if (!this.isInsideHutFn()) {
          this.tryInteractAtPlayerPos();
        }
      } else if (e.code === 'Digit5') {
        if (this.isInsideCastleFn()) {
          this.tryBuyCastleArmoryItem('oak_club');
        } else {
          this.tryBuyHouseEquipment('chisel_upgrade');
        }
      } else if (e.code === 'Digit6') {
        if (this.isInsideCastleFn()) {
          this.tryBuyCastleArmoryItem('battle_axe');
        } else {
          this.tryBuyHouseEquipment('stone_hauler');
        }
      } else if (e.code === 'Digit7') {
        if (this.isInsideCastleFn()) {
          this.tryBuyCastleArmoryItem('broadsword');
        } else {
          this.tryBuyHouseEquipment('ration_kettle');
        }
      } else if (e.code === 'Digit8') {
        if (this.isInsideCastleFn()) {
          this.tryBuyCastleArmoryItem('runic_greatsword');
        } else {
          this.tryBuyHouseEquipment('architect_pulley');
        }
      } else if (e.code === 'Digit9' && this.isInsideCastleFn()) {
        // Key 9 buys Round Shield first, or upgrades to Mithril Aegis in Tier II+
        const tier = this.getActiveCastleVisitFn()?.tier ?? 1;
        if (this.unlockedArmory.has('round_shield') && tier >= 2) {
          this.tryBuyCastleArmoryItem('mithril_aegis');
        } else {
          this.tryBuyCastleArmoryItem('round_shield');
        }
      } else if (e.code === 'Digit0' && this.isInsideCastleFn()) {
        this.tryBuyCastleArmoryItem('keep_stew');
      } else if (e.code === 'Minus' && this.isInsideCastleFn()) {
        this.tryBuyCastleArmoryItem('roast_boar');
      } else if (e.code === 'Equal' && this.isInsideCastleFn()) {
        this.tryBuyCastleArmoryItem('kings_feast');
      }
    });
  }

  /**
   * Called when the dwarf catches a fish or hunts a deer to grant Food Rations for Energy.
   */
  public addFoodRations(baseAmount: number, _source: 'fish' | 'deer' | 'troll'): void {
    const bonus = this.unlockedEquipment.has('ration_kettle') ? 1 : 0;
    const gained = Math.max(1, baseAmount + (_source === 'troll' ? 0 : bonus));
    this.foodCount += gained;
    this.syncEnergyAndFoodHUD();
    this.onStateChanged?.();
  }

  public eatFood(isAutoEat = false): boolean {
    const maxE = this.getMaxEnergy();
    const maxH = this.getMaxHealth();
    if (this.foodCount <= 0) {
      if (!isAutoEat) {
        this.playDeniedSound();
        this.showToast(
          '🍖 No Food Rations left! Buy Tavern Provisions inside a Castle, or Catch Fish (F) / Hunt Deer (H)!',
          false
        );
      }
      return false;
    }
    if (this.energy >= maxE - 0.5 && this.health >= maxH - 0.5 && !isAutoEat) {
      this.showToast(
        `⚡ Strength (${Math.round(this.energy)}/${maxE}) & ❤️ Health (${Math.round(this.health)}/${maxH}) are already full!`,
        false
      );
      return false;
    }

    this.foodCount -= 1;
    const restoreE = this.unlockedEquipment.has('ration_kettle') ? 65 : 45;
    const restoreH = this.unlockedEquipment.has('ration_kettle') ? 40 : 30;
    this.energy = Math.min(maxE, this.energy + restoreE);
    this.health = Math.min(maxH, this.health + restoreH);
    this.playEatSound();
    this.dwarf.spawnBurst(
      this.dwarf.root.position.x,
      this.dwarf.root.position.y + 0.9,
      this.dwarf.root.position.z,
      10
    );
    this.showToast(
      isAutoEat
        ? `🍖 Auto-Ate Ration (+${restoreE}⚡ Strength, +${restoreH}❤️ Health)! (${this.foodCount} Food left)`
        : `🍖 Ate Hearty Ration! +${restoreE}⚡ Strength & +${restoreH}❤️ Health (${Math.round(this.energy)}/${maxE}⚡)`,
      true
    );
    this.syncEnergyAndFoodHUD();
    this.onStateChanged?.();
    return true;
  }

  private consumeWorkEnergy(cost: number, actionLabel: string): boolean {
    if (this.energy < cost) {
      // Automatically eat a ration of food if the player has food in their backpack!
      if (this.foodCount > 0) {
        this.eatFood(true);
      }
    }
    if (this.energy < cost) {
      this.playDeniedSound();
      this.showToast(
        `⚡ Too tired to ${actionLabel}! Need ${Math.ceil(cost)}⚡ Strength — Eat Food (G), buy Castle Stew, or Fish (F) / Hunt (H)!`,
        false
      );
      return false;
    }
    this.energy = Math.max(0, this.energy - cost);
    this.syncEnergyAndFoodHUD();
    return true;
  }

  // ============================================================================
  // COMBAT STATS & TROLL SURVIVAL HELPERS
  // ============================================================================
  public getCombatStats(): {
    health: number;
    maxHealth: number;
    energy: number;
    maxEnergy: number;
    foodCount: number;
    weaponName: string;
    weaponIcon: string;
    weaponDamage: number;
    weaponEnergyCost: number;
    weaponCooldown: number;
    hasRunicShockwave: boolean;
    shieldId: EquippedShieldId;
    kingsValorBonus: number;
  } {
    const spec = WEAPON_COMBAT_SPECS[this.equippedWeaponId] ?? WEAPON_COMBAT_SPECS.mallet;
    return {
      health: this.health,
      maxHealth: this.getMaxHealth(),
      energy: this.energy,
      maxEnergy: this.getMaxEnergy(),
      foodCount: this.foodCount,
      weaponName: spec.name,
      weaponIcon: spec.icon,
      weaponDamage: spec.damage,
      weaponEnergyCost: spec.energyCost,
      weaponCooldown: spec.cooldown,
      hasRunicShockwave: spec.hasRunicShockwave,
      shieldId: this.equippedShieldId,
      kingsValorBonus: this.kingsValorTimer > 0 ? 1.25 : 1.0,
    };
  }

  public consumeCombatEnergy(cost: number): { hadEnough: boolean; remainingEnergy: number } {
    if (this.energy < cost && this.foodCount > 0) {
      // Auto-eat a ration in combat if strength drops below weapon swing cost!
      this.eatFood(true);
    }
    const hadEnough = this.energy >= 15;
    this.energy = Math.max(0, this.energy - cost);
    this.syncEnergyAndFoodHUD();
    return { hadEnough, remainingEnergy: this.energy };
  }

  public applyPlayerDamage(damage: number, _sourceTitle: string): { defeated: boolean } {
    this.health = Math.max(0, this.health - damage);
    this.syncEnergyAndFoodHUD();
    if (this.health <= 0) {
      return { defeated: true };
    }
    return { defeated: false };
  }

  public healAndRestoreFull(): void {
    this.health = this.getMaxHealth();
    this.energy = this.getMaxEnergy();
    this.syncEnergyAndFoodHUD();
  }

  public setTrollsSlainBonusCount(count: number): void {
    this.trollsSlainBonusCount = Math.max(0, count);
    this.health = Math.min(this.getMaxHealth(), this.health + 10);
    this.syncEnergyAndFoodHUD();
  }

  public getCompletedCastlePositions(): Array<{ x: number; z: number; blocksPlaced: number }> {
    if (this.completedCastlesDirty) {
      this.completedCastlesCache.length = 0;
      for (const c of this.castles) {
        if (c.blocksPlaced >= 8) {
          this.completedCastlesCache.push({ x: c.x, z: c.z, blocksPlaced: c.blocksPlaced });
        }
      }
      this.completedCastlesDirty = false;
    }
    return this.completedCastlesCache;
  }

  /**
   * Evaluates whether (wx, wz) is a level, dry place suitable for a Quarry or Castle.
   */
  public evaluateLevelPlace(
    wx: number,
    wz: number,
    radius = 3.6,
    minNormalY = 0.85
  ): { isLevel: boolean; groundY: number; normalY: number; reason: string } {
    const groundY = this.chunkManager.getSurfaceHeight(wx, wz);
    const res = this.levelEvalResult;
    res.groundY = groundY;
    if (this.config.enableWater && !this.config.blankClayMode && groundY < this.config.waterLevel + 0.35) {
      res.isLevel = false;
      res.normalY = 1;
      res.reason = 'Too close to water! Move onto dry ground.';
      return res;
    }

    this.chunkManager.getSurfaceNormal(wx, wz, tempNormal);
    let minH = groundY;
    let maxH = groundY;
    for (let i = 0; i < LEVEL_EVAL_UNIT_DIRS.length; i++) {
      const dir = LEVEL_EVAL_UNIT_DIRS[i];
      const h = this.chunkManager.getSurfaceHeight(wx + dir[0] * radius, wz + dir[1] * radius);
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
    const span = maxH - minH;
    const isLevel = tempNormal.y >= minNormalY && span <= radius * 0.58;
    res.isLevel = isLevel;
    res.normalY = tempNormal.y;
    res.reason = isLevel ? 'Level Ground Ready' : 'Slope is too steep! Follow the green ring to level ground.';
    return res;
  }

  /**
   * Searches a spiral within `maxRadius` around (wx, wz) for the nearest level clearing
   * and places a glowing green guide ring there if the player's current spot is too steep.
   */
  private highlightNearestLevelSpot(wx: number, wz: number): { x: number; y: number; z: number } | null {
    for (let r = 4.0; r <= 32.0; r += 3.5) {
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const ang = (i / steps) * Math.PI * 2;
        const tx = wx + Math.cos(ang) * r;
        const tz = wz + Math.sin(ang) * r;
        const check = this.evaluateLevelPlace(tx, tz, 3.5, 0.86);
        if (check.isLevel && !this.isTooCloseToStructures(tx, tz, 13.0)) {
          this.levelGuideRingMesh.position.set(tx, check.groundY + 0.14, tz);
          this.levelGuideRingMesh.visible = true;
          this.levelGuideTimer = 10.0;
          return { x: tx, y: check.groundY, z: tz };
        }
      }
    }
    return null;
  }

  private isTooCloseToStructures(wx: number, wz: number, minDist: number): boolean {
    const minSq = minDist * minDist;
    for (const q of this.quarries) {
      const dx = wx - q.x;
      const dz = wz - q.z;
      if (dx * dx + dz * dz < minSq) return true;
    }
    for (const c of this.castles) {
      const dx = wx - c.x;
      const dz = wz - c.z;
      if (dx * dx + dz * dz < minSq) return true;
    }
    return false;
  }

  /**
   * Sets up a new Dwarven Stone Quarry at the dwarf's current level position (`Q` key).
   */
  public setUpQuarryAtPlayer(): boolean {
    if (this.isInsideHutFn()) {
      this.showToast('🚪 Step outside the Dwarven House first to set up a Quarry!', false);
      return false;
    }

    const px = this.dwarf.root.position.x;
    const pz = this.dwarf.root.position.z;

    if (this.isTooCloseToStructures(px, pz, 13.0)) {
      this.playDeniedSound();
      this.showToast('⛏️ Walk at least 14m away from existing Quarries or Castles to place a new Quarry!', false);
      return false;
    }

    const levelCheck = this.evaluateLevelPlace(px, pz, 3.4, 0.84);
    if (!levelCheck.isLevel) {
      const failReason = levelCheck.reason;
      this.playDeniedSound();
      const nearSpot = this.highlightNearestLevelSpot(px, pz);
      if (nearSpot) {
        const dist = Math.hypot(nearSpot.x - px, nearSpot.z - pz);
        const dir = formatCompassDir(nearSpot.x - px, nearSpot.z - pz);
        this.showToast(
          `⛰️ Ground too steep here! Walk ${dist.toFixed(0)}m ${dir} to the glowing Green Level Clearing!`,
          false
        );
      } else {
        this.showToast(`⛰️ ${failReason}`, false);
      }
      return false;
    }

    this.levelGuideRingMesh.visible = false;
    const id = `quarry_${this.quarries.length + 1}_${Math.round(px)}_${Math.round(pz)}`;
    const rotY = this.dwarf.heading;
    const quarry = this.createQuarryInstance({
      id,
      x: px,
      y: levelCheck.groundY,
      z: pz,
      rotationY: rotY,
      stockpiledBlocks: 0,
    });
    this.quarries.push(quarry);
    this.spawnRocksAroundQuarry(quarry);

    this.dwarf.spawnBurst(px, levelCheck.groundY + 0.5, pz, 18);
    this.playBuildSound();
    this.showToast(
      '⛏️ Quarry Set Up on Level Ground! Carry Natural Stones here and press E to chisel Castle Blocks!',
      true
    );
    this.onStateChanged?.();
    return true;
  }

  /**
   * Sets up a new Castle Construction Site at the dwarf's current level position (`K` key).
   */
  public setUpCastleAtPlayer(): boolean {
    if (this.isInsideHutFn()) {
      this.showToast('🚪 Step outside the Dwarven House first to start a Castle!', false);
      return false;
    }

    const px = this.dwarf.root.position.x;
    const pz = this.dwarf.root.position.z;

    if (this.isTooCloseToStructures(px, pz, 15.0)) {
      this.playDeniedSound();
      this.showToast('🏰 Walk at least 15m away from Quarries or other Castles to found a Castle!', false);
      return false;
    }

    const levelCheck = this.evaluateLevelPlace(px, pz, 4.2, 0.84);
    if (!levelCheck.isLevel) {
      const failReason = levelCheck.reason;
      this.playDeniedSound();
      const nearSpot = this.highlightNearestLevelSpot(px, pz);
      if (nearSpot) {
        const dist = Math.hypot(nearSpot.x - px, nearSpot.z - pz);
        const dir = formatCompassDir(nearSpot.x - px, nearSpot.z - pz);
        this.showToast(
          `⛰️ Ground too steep for a Castle! Walk ${dist.toFixed(0)}m ${dir} to the glowing Green Level Clearing!`,
          false
        );
      } else {
        this.showToast(`⛰️ ${failReason}`, false);
      }
      return false;
    }

    this.levelGuideRingMesh.visible = false;
    const idx = this.castles.length;
    const name = CASTLE_NAMES[idx % CASTLE_NAMES.length];
    const id = `castle_${idx + 1}_${Math.round(px)}_${Math.round(pz)}`;
    const castle = this.createCastleInstance({
      id,
      name,
      x: px,
      y: levelCheck.groundY,
      z: pz,
      rotationY: 0,
      blocksPlaced: 0,
    });
    this.castles.push(castle);
    this.completedCastlesDirty = true;

    this.dwarf.spawnBurst(px, levelCheck.groundY + 0.5, pz, 20);
    this.playMilestoneFanfare();
    this.showToast(
      `🏰 Founded ${name}! Carry Chiseled Stone Blocks to the glowing marker to build Tier I (0/8 Blocks)!`,
      true
    );
    this.syncMilestoneHUD();
    this.onStateChanged?.();
    return true;
  }

  private createQuarryInstance(saved: SavedQuarrySite): QuarryInstance {
    const assets = getSharedMasonryAssets();
    const root = new THREE.Group();
    root.position.set(saved.x, saved.y, saved.z);
    root.rotation.y = saved.rotationY;
    root.updateMatrix();
    root.matrixAutoUpdate = false;

    const padMesh = new THREE.Mesh(assets.quarryPadGeo, assets.quarryPadMat);
    padMesh.receiveShadow = true;
    padMesh.updateMatrix();
    padMesh.matrixAutoUpdate = false;
    root.add(padMesh);

    // 1. Dwarven Workbench (`dwarven workbench 3d model.glb` at close range, procedural fallback at far range)
    const workbenchMesh = new THREE.Mesh(assets.fallbackWorkbenchGeo, assets.quarryTimberMat);
    workbenchMesh.position.set(0, 0.24, -0.05);
    workbenchMesh.castShadow = true;
    workbenchMesh.receiveShadow = true;
    workbenchMesh.updateMatrix();
    workbenchMesh.matrixAutoUpdate = false;
    root.add(workbenchMesh);

    // 2. Wooden Jib Crane (`wooden jib crane 3d model.glb` at close range, procedural fallback at far range)
    const jibCraneMesh = new THREE.Mesh(assets.fallbackJibCraneGeo, assets.quarryTimberMat);
    jibCraneMesh.position.set(-1.85, 0.24, -1.25);
    jibCraneMesh.rotation.y = 0.35;
    jibCraneMesh.castShadow = true;
    jibCraneMesh.receiveShadow = true;
    jibCraneMesh.updateMatrix();
    jibCraneMesh.matrixAutoUpdate = false;
    root.add(jibCraneMesh);

    // 3. Wooden Minecart & Iron Track
    const timberMesh = new THREE.Mesh(assets.quarryTimberGeo, assets.quarryTimberMat);
    timberMesh.castShadow = true;
    timberMesh.receiveShadow = true;
    timberMesh.updateMatrix();
    timberMesh.matrixAutoUpdate = false;
    root.add(timberMesh);

    const ironMesh = new THREE.Mesh(assets.quarryIronGeo, assets.quarryIronMat);
    ironMesh.castShadow = true;
    ironMesh.updateMatrix();
    ironMesh.matrixAutoUpdate = false;
    root.add(ironMesh);

    const craneWheelMesh = new THREE.Mesh(assets.craneWheelGeo, assets.quarryIronMat);
    craneWheelMesh.position.set(-0.65, 4.15, -1.25);
    craneWheelMesh.updateMatrix();
    craneWheelMesh.matrixAutoUpdate = false;
    root.add(craneWheelMesh);

    // Raw boulder resting on top of the chiseling workbench while being chiseled (Y = 0.24 pad + 0.76 bench = 1.00m)
    const useGlbRock = Boolean(sharedNaturalRockGeo && sharedNaturalRockMat);
    const benchRockMesh = new THREE.Mesh(
      useGlbRock ? sharedNaturalRockGeo! : assets.fallbackRockGeo,
      useGlbRock ? sharedNaturalRockMat! : assets.fallbackRockMat
    );
    benchRockMesh.position.set(0, 1.0, -0.05);
    benchRockMesh.scale.setScalar(0.68);
    benchRockMesh.castShadow = true;
    benchRockMesh.receiveShadow = false;
    benchRockMesh.visible = false;
    benchRockMesh.updateMatrix();
    benchRockMesh.matrixAutoUpdate = false;
    root.add(benchRockMesh);

    // Glowing work ring in front of the chiseling bench
    const workRingMesh = new THREE.Mesh(assets.workRingGeo, assets.workRingMat);
    workRingMesh.position.set(0, 0.26, 1.48);
    workRingMesh.updateMatrix();
    workRingMesh.matrixAutoUpdate = false;
    root.add(workRingMesh);

    // Visual stack of chiseled ashlar stone blocks on the left pallet (-2.15..-1.53, 0.39, +0.95..1.39)
    const stockpileMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < 16; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2) % 2;
      const layer = Math.floor(i / 4);
      const bm = new THREE.Mesh(assets.stockpileBlockGeo, assets.ashlarStoneMat);
      bm.position.set(-2.15 + col * 0.62, 0.39 + layer * 0.31, 0.95 + row * 0.44);
      bm.castShadow = true;
      bm.receiveShadow = true;
      bm.visible = i < saved.stockpiledBlocks;
      bm.updateMatrix();
      bm.matrixAutoUpdate = false;
      stockpileMeshes.push(bm);
      root.add(bm);
    }

    this.group.add(root);

    const inst: QuarryInstance = {
      id: saved.id,
      x: saved.x,
      y: saved.y,
      z: saved.z,
      rotationY: saved.rotationY,
      stockpiledBlocks: saved.stockpiledBlocks,
      autoCutTimer: 0,
      chiselStoneTimer: 0,
      isNearLOD: true,
      root,
      workbenchMesh,
      jibCraneMesh,
      benchRockMesh,
      craneWheelMesh,
      workRingMesh,
      stockpileMeshes,
    };
    this.syncQuarryPropVisuals(inst);
    return inst;
  }

  private syncQuarryPropVisuals(q: QuarryInstance): void {
    const assets = getSharedMasonryAssets();
    if (q.isNearLOD && sharedWorkbenchGeo && sharedWorkbenchMat) {
      q.workbenchMesh.geometry = sharedWorkbenchGeo;
      q.workbenchMesh.material = sharedWorkbenchMat;
      q.workbenchMesh.castShadow = true;
      q.workbenchMesh.receiveShadow = false;
    } else {
      q.workbenchMesh.geometry = assets.fallbackWorkbenchGeo;
      q.workbenchMesh.material = assets.quarryTimberMat;
      q.workbenchMesh.castShadow = true;
      q.workbenchMesh.receiveShadow = true;
    }

    if (q.isNearLOD && sharedJibCraneGeo && sharedJibCraneMat) {
      q.jibCraneMesh.geometry = sharedJibCraneGeo;
      q.jibCraneMesh.material = sharedJibCraneMat;
      q.jibCraneMesh.castShadow = true;
      q.jibCraneMesh.receiveShadow = false;
      q.craneWheelMesh.visible = false;
    } else {
      q.jibCraneMesh.geometry = assets.fallbackJibCraneGeo;
      q.jibCraneMesh.material = assets.quarryTimberMat;
      q.jibCraneMesh.castShadow = true;
      q.jibCraneMesh.receiveShadow = true;
      q.craneWheelMesh.visible = true;
    }

    if (q.isNearLOD && sharedNaturalRockGeo && sharedNaturalRockMat) {
      q.benchRockMesh.geometry = sharedNaturalRockGeo;
      q.benchRockMesh.material = sharedNaturalRockMat;
    } else {
      q.benchRockMesh.geometry = assets.fallbackRockGeo;
      q.benchRockMesh.material = assets.fallbackRockMat;
    }
  }

  private syncQuarryStockpileVisuals(q: QuarryInstance): void {
    for (let i = 0; i < q.stockpileMeshes.length; i++) {
      q.stockpileMeshes[i].visible = i < q.stockpiledBlocks;
    }
  }

  private spawnRocksAroundQuarry(q: QuarryInstance): void {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + 0.35;
      const dist = 10.5 + (i % 3) * 4.2;
      const rx = q.x + Math.cos(ang) * dist;
      const rz = q.z + Math.sin(ang) * dist;
      const ry = this.chunkManager.getSurfaceHeight(rx, rz);
      if (this.config.enableWater && ry < this.config.waterLevel + 0.25) continue;
      const rock = this.createNaturalRockInstance(
        `qrock_${q.id}_${i}`,
        rx,
        ry,
        rz,
        0.92 + (i % 3) * 0.14,
        ang * 2.0,
        false
      );
      this.quarryBonusRocks.push(rock);
    }
  }

  private createCastleInstance(saved: SavedCastleSite): CastleInstance {
    const assets = getSharedMasonryAssets();
    const root = new THREE.Group();
    root.position.set(saved.x, saved.y, saved.z);
    root.rotation.y = saved.rotationY;
    root.updateMatrix();
    root.matrixAutoUpdate = false;

    const resolveMat = (key: CastleMatKey): THREE.Material =>
      key === 'darkStone'
        ? assets.darkStoneMat
        : key === 'wood'
          ? assets.castleWoodMat
          : key === 'iron'
            ? assets.quarryIronMat
            : key === 'roof'
              ? assets.slateRoofMat
              : key === 'gold'
                ? assets.bannerGoldMat
                : key === 'flame'
                  ? assets.torchFlameMat
                  : assets.ashlarStoneMat;

    const slotMeshes: THREE.Mesh[] = [];
    const slotMaterials: Array<THREE.Material | THREE.Material[]> = [];
    for (let i = 0; i < assets.castleSlots.length; i++) {
      const slot = assets.castleSlots[i];
      const geo = assets.castleSlotGeos[slot.geoIndex];
      const mat: THREE.Material | THREE.Material[] =
        slot.matKeys.length === 1
          ? resolveMat(slot.matKeys[0])
          : slot.matKeys.map(resolveMat);

      const m = new THREE.Mesh(geo, mat);
      m.position.copy(slot.localPos);
      m.castShadow = true;
      m.receiveShadow = true;
      m.visible = i < saved.blocksPlaced;
      m.updateMatrix();
      m.matrixAutoUpdate = false;
      slotMeshes.push(m);
      slotMaterials.push(mat);
      root.add(m);
    }

    // Complete sculpted `.glb` castle mesh for completed Milestone Tiers (Tier I, II, III)
    // Uses close-range GLB LOD (`dist <= 2.2` chunks / ~105m) with `receiveShadow = false` on 21k-23k tri meshes
    const completedGlbMesh = new THREE.Mesh(assets.castleSlotGeos[0], assets.ashlarStoneMat);
    completedGlbMesh.castShadow = true;
    completedGlbMesh.receiveShadow = false;
    completedGlbMesh.visible = false;
    completedGlbMesh.updateMatrix();
    completedGlbMesh.matrixAutoUpdate = false;
    root.add(completedGlbMesh);

    // Translucent 3D Ghost Block highlighting the exact next block slot on the castle
    const ghostMesh = new THREE.Mesh(assets.castleSlotGeos[0], assets.ghostSlotMat);
    ghostMesh.visible = false;
    ghostMesh.updateMatrix();
    ghostMesh.matrixAutoUpdate = false;
    root.add(ghostMesh);

    // Floating Golden Beacon Arrow & Vertical Light Beam over the next block slot
    const beaconArrowGroup = new THREE.Group();
    beaconArrowGroup.matrixAutoUpdate = false;
    const arrowMesh = new THREE.Mesh(assets.beaconArrowGeo, assets.bannerGoldMat);
    arrowMesh.position.y = 1.6;
    arrowMesh.updateMatrix();
    arrowMesh.matrixAutoUpdate = false;
    beaconArrowGroup.add(arrowMesh);
    const beamMesh = new THREE.Mesh(assets.beaconBeamGeo, assets.beaconBeamMat);
    beamMesh.updateMatrix();
    beamMesh.matrixAutoUpdate = false;
    beaconArrowGroup.add(beamMesh);
    beaconArrowGroup.updateMatrix();
    root.add(beaconArrowGroup);

    // Glowing Ground Target Ring at the base of the active wall/tower slot
    const groundTargetRing = new THREE.Mesh(assets.targetRingGeo, assets.targetRingMat);
    groundTargetRing.updateMatrix();
    groundTargetRing.matrixAutoUpdate = false;
    root.add(groundTargetRing);

    // Glowing Sanctuary Doorway Ring on the lowered timber drawbridge (`z = +6.0m`) when Tier I+ (`blocksPlaced >= 8`)
    const doorRingMesh = new THREE.Mesh(assets.workRingGeo, assets.workRingMat);
    doorRingMesh.position.set(0, 0.48, 6.0);
    doorRingMesh.visible = saved.blocksPlaced >= 8;
    doorRingMesh.updateMatrix();
    doorRingMesh.matrixAutoUpdate = false;
    root.add(doorRingMesh);

    this.group.add(root);

    const inst: CastleInstance = {
      id: saved.id,
      name: saved.name,
      x: saved.x,
      y: saved.y,
      z: saved.z,
      rotationY: saved.rotationY,
      blocksPlaced: THREE.MathUtils.clamp(saved.blocksPlaced, 0, assets.castleSlots.length),
      isNearGlbLOD: true,
      root,
      completedGlbMesh,
      slotMeshes,
      slotMaterials,
      ghostMesh,
      beaconArrowGroup,
      groundTargetRing,
      doorRingMesh,
    };
    this.syncCastleSlotHintVisuals(inst);
    return inst;
  }

  private getCompletedMilestoneTier(blocksPlaced: number): 0 | 1 | 2 | 3 {
    if (blocksPlaced >= 30) return 3;
    if (blocksPlaced >= 18) return 2;
    if (blocksPlaced >= 8) return 1;
    return 0;
  }

  private syncCastleSlotHintVisuals(castle: CastleInstance): void {
    const assets = getSharedMasonryAssets();
    const totalSlots = assets.castleSlots.length;
    const completedTier = this.getCompletedMilestoneTier(castle.blocksPlaced);
    const activeTier: 1 | 2 | 3 = completedTier < 3 ? ((completedTier + 1) as 1 | 2 | 3) : 3;

    castle.doorRingMesh.visible = completedTier >= 1;

    // Pre-warm current and next Castle Tier `.glb` models asynchronously (only attach callback if not yet loaded!)
    if (completedTier !== 0 && !sharedCastleTierGlbAssets[completedTier]) {
      ensureCastleTierModelLoaded(completedTier, () => {
        this.syncCastleSlotHintVisuals(castle);
      });
    }
    if (completedTier < 3 && !sharedCastleTierGlbAssets[activeTier]) {
      ensureCastleTierModelLoaded(activeTier);
    }

    const tierGlbAsset = completedTier !== 0 ? sharedCastleTierGlbAssets[completedTier] : undefined;
    const showGlbModel = Boolean(tierGlbAsset && castle.isNearGlbLOD);

    if (showGlbModel && tierGlbAsset) {
      castle.completedGlbMesh.geometry = tierGlbAsset.geo;
      castle.completedGlbMesh.material = tierGlbAsset.mat;
      castle.completedGlbMesh.visible = true;
    } else {
      castle.completedGlbMesh.visible = false;
    }

    // 1. Placed blocks of `slot.tier > completedTier` (or all placed blocks if GLB is not shown) render solid masonry.
    // 2. Remaining unplaced blocks of `slot.tier === activeTier` (`i > castle.blocksPlaced`) render as a
    //    translucent Golden Architectural Blueprint (`blueprintSlotMat`) so the player always sees the full
    //    remaining silhouette of the castle tier they are currently building!
    for (let i = 0; i < totalSlots; i++) {
      const slot = assets.castleSlots[i];
      const isPlaced = i < castle.blocksPlaced;
      if (isPlaced) {
        if (showGlbModel && slot.tier <= completedTier) {
          castle.slotMeshes[i].visible = false;
        } else {
          castle.slotMeshes[i].material = castle.slotMaterials[i];
          castle.slotMeshes[i].visible = true;
          castle.slotMeshes[i].castShadow = castle.isNearGlbLOD;
          castle.slotMeshes[i].receiveShadow = true;
        }
      } else if (i > castle.blocksPlaced && slot.tier === activeTier && castle.isNearGlbLOD) {
        castle.slotMeshes[i].material = assets.blueprintSlotMat;
        castle.slotMeshes[i].visible = true;
        castle.slotMeshes[i].castShadow = false;
        castle.slotMeshes[i].receiveShadow = false;
      } else {
        castle.slotMeshes[i].visible = false;
      }
    }

    if (castle.blocksPlaced >= totalSlots) {
      castle.ghostMesh.visible = false;
      castle.beaconArrowGroup.visible = false;
      castle.groundTargetRing.visible = false;
      return;
    }

    const nextSlot = assets.castleSlots[castle.blocksPlaced];
    castle.ghostMesh.geometry = assets.castleSlotGeos[nextSlot.geoIndex];
    castle.ghostMesh.position.copy(nextSlot.localPos);
    castle.ghostMesh.updateMatrix();
    castle.ghostMesh.visible = true;

    castle.beaconArrowGroup.position.set(
      nextSlot.localPos.x,
      nextSlot.localPos.y + 1.4,
      nextSlot.localPos.z
    );
    castle.beaconArrowGroup.updateMatrix();
    castle.beaconArrowGroup.visible = true;

    const dropWorldX = castle.x + nextSlot.groundDropLocal.x;
    const dropWorldZ = castle.z + nextSlot.groundDropLocal.z;
    const dropGroundY = this.getWalkableSurfaceHeight(
      dropWorldX,
      dropWorldZ,
      this.chunkManager.getSurfaceHeight(dropWorldX, dropWorldZ)
    );
    castle.groundTargetRing.position.set(
      nextSlot.groundDropLocal.x,
      dropGroundY - castle.y + 0.14,
      nextSlot.groundDropLocal.z
    );
    castle.groundTargetRing.updateMatrix();
    castle.groundTargetRing.visible = true;
  }

  public tryEnterNearestCastle(): boolean {
    if (this.isInsideCastleFn() || this.isInsideHutFn()) return false;
    const px = this.dwarf.root.position.x;
    const pz = this.dwarf.root.position.z;
    const enterable = this.getNearestEnterableCastle(px, pz);
    if (!enterable || enterable.doorDist > 7.5) return false;
    const tier = this.getCompletedMilestoneTier(enterable.castle.blocksPlaced);
    if (tier === 0) return false;

    this.onRequestEnterCastle?.({
      id: enterable.castle.id,
      name: enterable.castle.name,
      tier: tier as CastleInteriorTier,
      worldX: enterable.castle.x,
      worldY: enterable.castle.y,
      worldZ: enterable.castle.z,
      rotationY: enterable.castle.rotationY,
    });
    return true;
  }

  private getNearestEnterableCastle(
    wx: number,
    wz: number
  ): { castle: CastleInstance; doorDist: number; doorX: number; doorZ: number } | null {
    let best: CastleInstance | null = null;
    let bestDoorDist = Infinity;
    let bestDoorX = 0;
    let bestDoorZ = 0;
    for (const c of this.castles) {
      if (c.blocksPlaced < 8) continue;
      const doorX = c.x + Math.sin(c.rotationY) * 6.0;
      const doorZ = c.z + Math.cos(c.rotationY) * 6.0;
      const d = Math.hypot(wx - doorX, wz - doorZ);
      if (d < bestDoorDist) {
        bestDoorDist = d;
        best = c;
        bestDoorX = doorX;
        bestDoorZ = doorZ;
      }
    }
    if (!best) return null;
    this.enterableCastleResult.castle = best;
    this.enterableCastleResult.doorDist = bestDoorDist;
    this.enterableCastleResult.doorX = bestDoorX;
    this.enterableCastleResult.doorZ = bestDoorZ;
    return this.enterableCastleResult as {
      castle: CastleInstance;
      doorDist: number;
      doorX: number;
      doorZ: number;
    };
  }

  /**
   * Context-sensitive `E` interaction for:
   * 0. If inside a Castle: Exit Castle (when near door) or Rest Until Dawn (when near Throne/Hearth)
   * 1. Placing carried Chiseled Block(s) onto the active Castle Slot
   * 2. Entering a completed Tier I / II / III Castle (`blocksPlaced >= 8`) at its lowered drawbridge
   * 3. Chiseling carried Raw Stone(s) at a Quarry Workbench (or picking up stockpiled blocks)
   * 4. Picking up a nearby Natural Stone (`natural rock 3d model.glb`)
   */
  public tryInteractAtPlayerPos(): boolean {
    if (this.isInsideCastleFn()) {
      this.onRequestExitCastle?.();
      return true;
    }

    const px = this.dwarf.root.position.x;
    const pz = this.dwarf.root.position.z;

    // 1. Check if near an unfinished Castle while carrying Chiseled Blocks
    const activeCastle = this.getActiveCastle(px, pz);
    if (activeCastle && this.carriedChiseledBlocks > 0) {
      const assets = getSharedMasonryAssets();
      const nextSlot = assets.castleSlots[activeCastle.blocksPlaced];
      if (nextSlot) {
        tempDropWorld.set(
          activeCastle.x + nextSlot.groundDropLocal.x,
          activeCastle.y,
          activeCastle.z + nextSlot.groundDropLocal.z
        );
        const distToDrop = Math.hypot(px - tempDropWorld.x, pz - tempDropWorld.z);
        const distToCastle = Math.hypot(px - activeCastle.x, pz - activeCastle.z);
        if (distToDrop <= 4.8 || distToCastle <= 8.8) {
          return this.placeBlocksOnCastle(activeCastle);
        }
      }
    }

    // 2. Check if standing at the lowered drawbridge of any Tier I+ Castle (`blocksPlaced >= 8`) to enter its Interior!
    const enterable = this.getNearestEnterableCastle(px, pz);
    if (enterable && enterable.doorDist <= 5.6) {
      return this.tryEnterNearestCastle();
    }

    // 2. Check if near a Quarry Workbench
    const nearestQuarry = this.getNearestQuarry(px, pz);
    if (nearestQuarry) {
      const dQ = Math.hypot(px - nearestQuarry.x, pz - nearestQuarry.z);
      if (dQ <= 4.8) {
        if (this.carriedRawStones > 0) {
          return this.chiselStonesAtQuarry(nearestQuarry);
        }
        if (
          nearestQuarry.stockpiledBlocks > 0 &&
          this.carriedChiseledBlocks < this.getMaxBlocksCarry()
        ) {
          const space = this.getMaxBlocksCarry() - this.carriedChiseledBlocks;
          const take = Math.min(space, nearestQuarry.stockpiledBlocks);
          nearestQuarry.stockpiledBlocks -= take;
          this.carriedChiseledBlocks += take;
          this.syncQuarryStockpileVisuals(nearestQuarry);
          this.dwarf.setCarriedLoad(this.carriedRawStones, this.carriedChiseledBlocks);
          this.playPickupStoneSound();
          this.showToast(
            `🧱 Picked up ${take} Chiseled Stone Block${take > 1 ? 's' : ''} from Quarry! Carry to your Castle Site!`,
            false
          );
          this.onStateChanged?.();
          return true;
        }
      }
    }

    // 3. Check if near a Natural Stone (`natural rock 3d model.glb`)
    const nearestRock = this.getNearestNaturalRock(px, pz);
    if (nearestRock && nearestRock.dist <= 3.6) {
      return this.pickupNaturalRock(nearestRock.rock);
    }

    return false;
  }

  private pickupNaturalRock(rock: NaturalRockInstance): boolean {
    if (this.carriedChiseledBlocks > 0) {
      this.showToast(
        '🧱 Place your carried Castle Blocks at the Castle Site first before lifting Raw Stones!',
        false
      );
      return false;
    }
    const maxStones = this.getMaxRawStonesCarry();
    if (this.carriedRawStones >= maxStones) {
      this.showToast(
        `🪨 Already carrying max Raw Stones (${this.carriedRawStones}/${maxStones})! Carry them to a Quarry (or buy the Stone-Hauler Cart in a House)!`,
        false
      );
      return false;
    }

    const energyCost = this.unlockedEquipment.has('stone_hauler') ? 3.2 : 5.0;
    if (!this.consumeWorkEnergy(energyCost, 'lift heavy Natural Stone')) {
      return false;
    }

    rock.respawnTimer = 18.0;
    rock.root.visible = false;
    this.carriedRawStones += 1;
    this.dwarf.setCarriedLoad(this.carriedRawStones, this.carriedChiseledBlocks);
    this.dwarf.spawnBurst(rock.wx, rock.wy + 0.3, rock.wz, 10);
    this.playPickupStoneSound();

    const hint =
      this.quarries.length === 0
        ? 'Walk to a level spot and press Q to set up a Quarry!'
        : 'Carry it to your Quarry Workbench and press E to chisel into Blocks!';
    this.showToast(
      `🪨 Lifted Natural Stone (${this.carriedRawStones}/${maxStones})! (-${energyCost.toFixed(0)}⚡) • ${hint}`,
      false
    );
    this.onStateChanged?.();
    return true;
  }

  private chiselStonesAtQuarry(quarry: QuarryInstance): boolean {
    if (this.carriedRawStones <= 0) return false;

    const baseCost = 9.0 * this.carriedRawStones;
    const energyCost = this.unlockedEquipment.has('chisel_upgrade') ? baseCost * 0.6 : baseCost;
    if (!this.consumeWorkEnergy(energyCost, 'chisel stone into blocks')) {
      return false;
    }

    const stonesUsed = this.carriedRawStones;
    const blocksPerStone = this.unlockedEquipment.has('chisel_upgrade') ? 2 : 1;
    const producedBlocks = stonesUsed * blocksPerStone;
    this.carriedRawStones = 0;

    // Place blocks directly into the dwarf's arms up to carry capacity; store any overflow on the Quarry stockpile!
    const maxCarry = this.getMaxBlocksCarry();
    const canHold = Math.max(0, maxCarry - this.carriedChiseledBlocks);
    const toHands = Math.min(producedBlocks, canHold);
    const toStockpile = producedBlocks - toHands;

    this.carriedChiseledBlocks += toHands;
    quarry.stockpiledBlocks += toStockpile;
    quarry.chiselStoneTimer = this.unlockedEquipment.has('chisel_upgrade') ? 0.65 : 1.1;
    quarry.benchRockMesh.visible = true;

    this.syncQuarryStockpileVisuals(quarry);
    this.dwarf.setCarriedLoad(this.carriedRawStones, this.carriedChiseledBlocks);
    this.dwarf.triggerChiselAnimation(quarry.chiselStoneTimer);
    this.dwarf.spawnBurst(quarry.x, quarry.y + 1.0, quarry.z, 16);
    this.playChiselSound();

    const nextHint =
      this.castles.length === 0
        ? 'Carry to a level place and press K to start building a Castle!'
        : 'Follow the arrow to the highlighted Castle Slot and press E!';
    this.showToast(
      `⛏️ Chiseled ${stonesUsed} Stone${stonesUsed > 1 ? 's' : ''} → +${producedBlocks} Castle Block${producedBlocks > 1 ? 's' : ''}! (-${energyCost.toFixed(0)}⚡) • ${nextHint}`,
      true
    );
    this.onStateChanged?.();
    return true;
  }

  private placeBlocksOnCastle(castle: CastleInstance): boolean {
    const assets = getSharedMasonryAssets();
    const totalSlots = assets.castleSlots.length;
    if (castle.blocksPlaced >= totalSlots || this.carriedChiseledBlocks <= 0) return false;

    const maxPerAction = this.unlockedEquipment.has('architect_pulley') ? 2 : 1;
    const remainingInCastle = totalSlots - castle.blocksPlaced;
    const blocksToPlace = Math.min(this.carriedChiseledBlocks, maxPerAction, remainingInCastle);

    const baseCost = 7.0 * blocksToPlace;
    const energyCost = this.unlockedEquipment.has('stone_hauler') ? baseCost * 0.65 : baseCost;
    if (!this.consumeWorkEnergy(energyCost, 'place Castle Stone Block')) {
      return false;
    }

    const prevBlocks = castle.blocksPlaced;
    const placedSlot = assets.castleSlots[prevBlocks];
    castle.blocksPlaced += blocksToPlace;
    this.completedCastlesDirty = true;
    this.carriedChiseledBlocks -= blocksToPlace;
    this.dwarf.setCarriedLoad(this.carriedRawStones, this.carriedChiseledBlocks);

    this.syncCastleSlotHintVisuals(castle);

    tempSlotWorld.set(
      castle.x + placedSlot.localPos.x,
      castle.y + placedSlot.localPos.y,
      castle.z + placedSlot.localPos.z
    );
    this.dwarf.spawnBurst(tempSlotWorld.x, tempSlotWorld.y, tempSlotWorld.z, 18);
    this.playBuildSound();

    // Check if any Milestone was just reached!
    let reachedMilestone = false;
    for (const m of CASTLE_MILESTONES) {
      if (prevBlocks < m.blocksRequired && castle.blocksPlaced >= m.blocksRequired) {
        reachedMilestone = true;
        this.playMilestoneFanfare();
        this.grantGold(
          m.rewardGold,
          `🏆 MILESTONE ACHIEVED: ${m.title} (${castle.name})! +${m.rewardGold} Gold!`
        );
      }
    }

    if (!reachedMilestone) {
      const currentMilestone =
        CASTLE_MILESTONES.find((m) => castle.blocksPlaced < m.blocksRequired) ??
        CASTLE_MILESTONES[CASTLE_MILESTONES.length - 1];
      this.grantGold(
        25 * blocksToPlace,
        `🧱 Built ${placedSlot.label} (${castle.blocksPlaced}/${currentMilestone.blocksRequired} for ${currentMilestone.title})! +${25 * blocksToPlace}g`
      );
    }

    this.syncMilestoneHUD();
    this.onStateChanged?.();
    return true;
  }

  private getKey(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  public update(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    isMovingSprinting = false
  ): void {
    if (this.kingsValorTimer > 0) {
      this.kingsValorTimer = Math.max(0, this.kingsValorTimer - dt);
      if (this.kingsValorTimer === 0) {
        this.syncEnergyAndFoodHUD();
      }
    }

    const insideHut = this.isInsideHutFn();
    const insideCastle = this.isInsideCastleFn();
    this.syncHouseShopVisibility(insideHut);
    this.syncCastleShopVisibility(insideCastle);

    if (insideHut) {
      this.footCompassMesh.visible = false;
      this.setBanner(false, '');
      return;
    }

    if (insideCastle) {
      this.footCompassMesh.visible = false;
      // Warm castle hearth gently recovers +6 Strength/sec and +4 Health/sec while inside sanctuary!
      const maxE = this.getMaxEnergy();
      const maxH = this.getMaxHealth();
      if (this.energy < maxE || this.health < maxH) {
        this.energy = Math.min(maxE, this.energy + 6.0 * dt);
        this.health = Math.min(maxH, this.health + 4.0 * dt);
        this.syncEnergyAndFoodHUD();
      }

      const visit = this.getActiveCastleVisitFn();
      const tierLabel =
        visit?.tier === 3
          ? "Tier III Mountain King's Grand Citadel"
          : visit?.tier === 2
            ? 'Tier II Stonewall Stronghold'
            : 'Tier I Dwarven Border Keep';
      const bannerHtml =
        `<div class="masonry-main-row">` +
        `<span>🏰 <strong>Inside ${visit?.name ?? 'Castle'} (${tierLabel})</strong> • 🛡️ <span class="masonry-tag level-ok">Sanctuary Safe from Night Trolls</span> • Buy Weapons, Shields &amp; Food (<kbd>5</kbd>–<kbd>=</kbd>)</span>` +
        `<div style="display:flex;gap:6px;flex-wrap:wrap">` +
        `<button type="button" class="hut-action-pill masonry-action-rest-dawn">☀️ Rest Until Dawn (R)</button>` +
        `<button type="button" class="hut-action-pill masonry-action-exit-castle">🚪 Step Outside (E / Esc)</button>` +
        `</div></div>`;
      this.setBanner(true, bannerHtml);
      return;
    }

    // Drain a tiny amount of energy if sprinting while hauling heavy boulders/blocks
    if (isMovingSprinting && (this.carriedRawStones > 0 || this.carriedChiseledBlocks > 0)) {
      const drainRate = this.unlockedEquipment.has('stone_hauler') ? 0.8 : 2.1;
      this.energy = Math.max(0, this.energy - drainRate * dt);
      this.syncEnergyAndFoodHUD();
    }

    if (this.levelGuideTimer > 0) {
      this.levelGuideTimer = Math.max(0, this.levelGuideTimer - dt);
      const pulse = 1.0 + Math.sin(elapsedTime * 5.0) * 0.12;
      this.levelGuideRingMesh.scale.setScalar(pulse);
      if (this.levelGuideTimer <= 0) {
        this.levelGuideRingMesh.visible = false;
      }
    }

    // 1. Stream Natural Stones (`3dmodels/natural rock 3d model.glb`) across terrain chunks
    this.updateNaturalRockChunks(playerPos);

    // 2. Update Natural Rock LODs (dist <= 1.5 chunks -> GLB, dist > 1.5 -> procedural fallback) & respawns
    this.updateNaturalRocks(dt, elapsedTime, playerPos);

    // 3. Animate Quarries (crane pulley wheel, chiseling stone on bench, auto-cutter equipment)
    this.updateQuarries(dt, elapsedTime, playerPos);

    // 4. Animate Active Castle Slot Hints (bobbing golden arrow, pulsing ghost block & ground target ring)
    this.updateCastles(elapsedTime, playerPos);

    // 5. Update 3D Foot Compass Arrow & Contextual Step-by-Step Hint Banner
    this.updateGuidanceAndBanner(elapsedTime, playerPos);
  }

  private updateNaturalRockChunks(playerPos: THREE.Vector3): void {
    const size = this.config.chunkSize;
    const r = Math.min(this.config.renderRadius, 3);
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

          if (!this.activeChunkRocks.has(key)) {
            this.spawnNaturalRocksForChunk(cx, cz, key);
          }
        }
      }

      for (const [key, rockList] of this.activeChunkRocks.entries()) {
        if (!desiredKeys.has(key)) {
          for (const rock of rockList) {
            activeNearRocks.delete(rock);
            this.group.remove(rock.root);
          }
          this.activeChunkRocks.delete(key);
        }
      }
    }
  }

  private spawnNaturalRocksForChunk(cx: number, cz: number, chunkKey: number): void {
    const size = this.config.chunkSize;
    const chunkSeed = ((cx * 61293847) ^ (cz * 84729103) ^ (this.config.seed + 4049)) >>> 0;
    const rng = createSeededRandom(chunkSeed);
    const rocks: NaturalRockInstance[] = [];
    const minLandY = this.config.enableWater ? this.config.waterLevel + 0.5 : -999;

    // Guaranteed cluster of carryable Natural Stones near origin chunk (0, 0) so player sees them immediately
    if (cx === 0 && cz === 0) {
      const starterCoords = [
        [9.5, 8.2],
        [12.8, 5.4],
        [-10.5, 9.2],
        [-13.2, 6.0],
        [7.4, -9.8],
        [-8.6, -11.2],
      ];
      for (let i = 0; i < starterCoords.length; i++) {
        const [sx, sz] = starterCoords[i];
        const sy = this.chunkManager.getSurfaceHeight(sx, sz);
        if (sy > minLandY) {
          rocks.push(
            this.createNaturalRockInstance(
              `rock_0_0_${i}`,
              sx,
              sy,
              sz,
              0.9 + rng() * 0.28,
              rng() * Math.PI * 2,
              true
            )
          );
        }
      }
    }

    const count = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const wx = cx * size + (rng() - 0.5) * (size * 0.84);
      const wz = cz * size + (rng() - 0.5) * (size * 0.84);
      if (wx * wx + wz * wz < 6.5 * 6.5) continue;
      const wy = this.chunkManager.getSurfaceHeight(wx, wz);
      if (wy > minLandY) {
        rocks.push(
          this.createNaturalRockInstance(
            `rock_${cx}_${cz}_${i}`,
            wx,
            wy,
            wz,
            0.88 + rng() * 0.32,
            rng() * Math.PI * 2,
            false
          )
        );
      }
    }

    this.activeChunkRocks.set(chunkKey, rocks);
  }

  private createNaturalRockInstance(
    id: string,
    wx: number,
    wy: number,
    wz: number,
    scale: number,
    rotY: number,
    forceNear: boolean
  ): NaturalRockInstance {
    const assets = getSharedMasonryAssets();
    const root = new THREE.Group();
    root.position.set(wx, wy, wz);
    root.updateMatrix();
    root.matrixAutoUpdate = false;

    const useGlb = forceNear && Boolean(sharedNaturalRockGeo && sharedNaturalRockMat);
    const mesh = new THREE.Mesh(
      useGlb ? sharedNaturalRockGeo! : assets.fallbackRockGeo,
      useGlb ? sharedNaturalRockMat! : assets.fallbackRockMat
    );
    mesh.scale.setScalar(scale);
    mesh.rotation.y = rotY;
    mesh.castShadow = forceNear;
    mesh.receiveShadow = false;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    root.add(mesh);

    const ringMesh = new THREE.Mesh(assets.rockRingGeo, assets.rockRingMat);
    ringMesh.position.y = 0.08;
    ringMesh.updateMatrix();
    ringMesh.matrixAutoUpdate = false;
    root.add(ringMesh);

    this.group.add(root);

    const inst: NaturalRockInstance = {
      id,
      wx,
      wy,
      wz,
      scale,
      rotY,
      respawnTimer: 0,
      isNearLOD: forceNear,
      root,
      mesh,
      ringMesh,
    };
    if (forceNear) {
      activeNearRocks.add(inst);
    }
    return inst;
  }

  private updateNaturalRocks(dt: number, elapsedTime: number, playerPos: THREE.Vector3): void {
    const assets = getSharedMasonryAssets();
    const nearLodDist = this.config.chunkSize * 1.5; // ~72m close-range GLB LOD radius
    const nearLodDistSq = nearLodDist * nearLodDist;
    const shadowDistSq = 48.0 * 48.0;

    const updateList = (list: NaturalRockInstance[]) => {
      for (const r of list) {
        if (r.respawnTimer > 0) {
          r.respawnTimer -= dt;
          if (r.respawnTimer <= 0) {
            r.respawnTimer = 0;
            r.wy = this.chunkManager.getSurfaceHeight(r.wx, r.wz);
            r.root.position.set(r.wx, r.wy, r.wz);
            r.root.updateMatrix();
            r.root.visible = true;
          }
          continue;
        }

        const dx = playerPos.x - r.wx;
        const dz = playerPos.z - r.wz;
        const dSq = dx * dx + dz * dz;

        const wantNear = dSq <= nearLodDistSq;
        if (wantNear !== r.isNearLOD) {
          r.isNearLOD = wantNear;
          if (wantNear) {
            activeNearRocks.add(r);
            if (sharedNaturalRockGeo && sharedNaturalRockMat) {
              r.mesh.geometry = sharedNaturalRockGeo;
              r.mesh.material = sharedNaturalRockMat;
            }
          } else {
            activeNearRocks.delete(r);
            r.mesh.geometry = assets.fallbackRockGeo;
            r.mesh.material = assets.fallbackRockMat;
          }
        }

        const wantShadow = dSq <= shadowDistSq;
        if (r.mesh.castShadow !== wantShadow) {
          r.mesh.castShadow = wantShadow;
        }

        // Only show & pulse subtle golden pickup ring when within 28m
        const showRing = dSq <= 28 * 28;
        r.ringMesh.visible = showRing;
        if (showRing) {
          const pulse = 0.92 + Math.sin(elapsedTime * 3.8 + r.wx) * 0.1;
          r.ringMesh.scale.setScalar(pulse);
          r.ringMesh.updateMatrix();
        }
      }
    };

    for (const list of this.activeChunkRocks.values()) {
      updateList(list);
    }
    updateList(this.quarryBonusRocks);
  }

  private updateQuarries(dt: number, elapsedTime: number, playerPos: THREE.Vector3): void {
    const hasPulley = this.unlockedEquipment.has('architect_pulley');
    const nearGlbDistSq = Math.pow(this.config.chunkSize * 1.8, 2);

    for (const q of this.quarries) {
      // Passive auto-chisel bonus block when owning Royal Architect's Pulley Rig
      if (hasPulley && q.stockpiledBlocks < 16) {
        q.autoCutTimer += dt;
        if (q.autoCutTimer >= 18.0) {
          q.autoCutTimer = 0;
          q.stockpiledBlocks += 1;
          this.syncQuarryStockpileVisuals(q);
        }
      }

      if (q.chiselStoneTimer > 0) {
        q.chiselStoneTimer = Math.max(0, q.chiselStoneTimer - dt);
        q.benchRockMesh.rotation.y += dt * 9.0;
        q.benchRockMesh.scale.setScalar(0.35 + (q.chiselStoneTimer / 1.1) * 0.35);
        q.benchRockMesh.updateMatrix();
        if (q.chiselStoneTimer <= 0) {
          q.benchRockMesh.visible = false;
        }
      }

      const dx = playerPos.x - q.x;
      const dz = playerPos.z - q.z;
      const dSq = dx * dx + dz * dz;

      // Close-range GLB LOD toggle (`dist <= 1.8` chunks / ~86.4m) for Workbench & Jib Crane .glb models
      const wantNearLOD = dSq <= nearGlbDistSq;
      if (wantNearLOD !== q.isNearLOD) {
        q.isNearLOD = wantNearLOD;
        this.syncQuarryPropVisuals(q);
      }

      if (dSq < 45 * 45) {
        q.craneWheelMesh.rotation.z = elapsedTime * 1.4;
        q.craneWheelMesh.updateMatrix();
        const pulse = 1.0 + Math.sin(elapsedTime * 4.0) * 0.08;
        q.workRingMesh.scale.setScalar(pulse);
        q.workRingMesh.updateMatrix();
      }
    }
  }

  private updateCastles(elapsedTime: number, playerPos: THREE.Vector3): void {
    const assets = getSharedMasonryAssets();
    const totalSlots = assets.castleSlots.length;
    const nearGlbDistSq = Math.pow(this.config.chunkSize * 2.2, 2);

    for (const c of this.castles) {
      const dx = playerPos.x - c.x;
      const dz = playerPos.z - c.z;
      const dSq = dx * dx + dz * dz;

      // Close-range GLB LOD toggle (`dist <= 2.2` chunks / ~105.6m) for the 21k-23k tri castle .glb models
      const wantNearGlb = dSq <= nearGlbDistSq;
      if (wantNearGlb !== c.isNearGlbLOD) {
        c.isNearGlbLOD = wantNearGlb;
        this.syncCastleSlotHintVisuals(c);
      }

      if (c.doorRingMesh.visible && dSq < 60 * 60) {
        const doorPulse = 1.0 + Math.sin(elapsedTime * 4.2) * 0.1;
        c.doorRingMesh.scale.setScalar(doorPulse);
        c.doorRingMesh.updateMatrix();
      }

      if (c.blocksPlaced >= totalSlots || dSq > 120 * 120) continue;

      const bob = Math.sin(elapsedTime * 4.2) * 0.28;
      const nextSlot = assets.castleSlots[c.blocksPlaced];
      c.beaconArrowGroup.position.y = nextSlot.localPos.y + 1.45 + bob;
      c.beaconArrowGroup.rotation.y = elapsedTime * 2.2;
      c.beaconArrowGroup.updateMatrix();

      const ringPulse = 1.0 + Math.sin(elapsedTime * 4.8) * 0.14;
      c.groundTargetRing.scale.setScalar(ringPulse);
      c.groundTargetRing.updateMatrix();
    }
  }

  private buildCastleProgressStripHtml(castle: CastleInstance): string {
    const b = castle.blocksPlaced;
    const tierIdx = CASTLE_MILESTONES.findIndex((m) => b < m.blocksRequired);
    const activeM =
      tierIdx >= 0 ? CASTLE_MILESTONES[tierIdx] : CASTLE_MILESTONES[CASTLE_MILESTONES.length - 1];
    const prevReq = tierIdx > 0 ? CASTLE_MILESTONES[tierIdx - 1].blocksRequired : 0;
    const tierTotal = activeM.blocksRequired - prevReq;
    const tierDone = Math.max(0, Math.min(tierTotal, b - prevReq));
    const blocksLeftInTier = Math.max(0, activeM.blocksRequired - b);
    const blocksLeftTotal = Math.max(0, 30 - b);
    const tierPct = Math.round((tierDone / Math.max(1, tierTotal)) * 100);

    const t1Done = b >= 8;
    const t2Done = b >= 18;
    const t3Done = b >= 30;

    const pill1 = t1Done
      ? `<span class="castle-tier-step done">✅ Tier I Keep (8/8)</span>`
      : `<span class="castle-tier-step active">🔨 Tier I Keep (${b}/8 • ${8 - b} left)</span>`;
    const pill2 = t2Done
      ? `<span class="castle-tier-step done">✅ Tier II Stronghold (18/18)</span>`
      : t1Done
        ? `<span class="castle-tier-step active">🔨 Tier II Stronghold (${b - 8}/10 • ${18 - b} left)</span>`
        : `<span class="castle-tier-step locked">🔒 Tier II Stronghold (+10)</span>`;
    const pill3 = t3Done
      ? `<span class="castle-tier-step done">👑 Tier III Citadel (30/30)</span>`
      : t2Done
        ? `<span class="castle-tier-step active">🔨 Tier III Citadel (${b - 18}/12 • ${30 - b} left)</span>`
        : `<span class="castle-tier-step locked">🔒 Tier III Citadel (+12)</span>`;

    return (
      `<div class="castle-progress-strip">` +
      `<div class="castle-progress-header">` +
      `<span>🏗️ <strong>${activeM.title}:</strong> ${tierDone}/${tierTotal} Tier Blocks (${b}/30 Total)</span>` +
      `<span class="castle-left-highlight">⏳ <strong>${blocksLeftInTier} Block${blocksLeftInTier === 1 ? '' : 's'} Left</strong> for ${activeM.title} (${blocksLeftTotal} left for Grand Citadel)</span>` +
      `</div>` +
      `<div class="castle-progress-track"><div class="castle-progress-fill" style="width:${tierPct}%"></div></div>` +
      `<div class="castle-tier-roadmap">${pill1}<span class="tier-arrow">➔</span>${pill2}<span class="tier-arrow">➔</span>${pill3}</div>` +
      `</div>`
    );
  }

  private updateGuidanceAndBanner(elapsedTime: number, playerPos: THREE.Vector3): void {
    const px = playerPos.x;
    const pz = playerPos.z;
    const assets = getSharedMasonryAssets();

    // Determine primary target for 3D Foot Compass Arrow & Contextual Hint Banner
    let guideTargetX = Number.NaN;
    let guideTargetZ = Number.NaN;
    let guideColor = 0x72efdd;
    let bannerHtml = '';

    const activeCastle = this.getActiveCastle(px, pz);
    const nearestQuarry = this.getNearestQuarry(px, pz);

    // Case 1: Carrying Chiseled Castle Blocks -> Guide directly to the exact Next Castle Block Slot!
    if (this.carriedChiseledBlocks > 0) {
      if (!activeCastle) {
        const levelHere = this.evaluateLevelPlace(px, pz, 3.4, 0.84);
        const levelBadge = levelHere.isLevel
          ? `<span class="masonry-tag level-ok">✅ Level Ground</span>`
          : `<span class="masonry-tag level-steep">⛰️ Sloped Ground</span>`;
        bannerHtml =
          `<div class="masonry-main-row"><span>🧱 <strong>Carrying ${this.carriedChiseledBlocks} Castle Block${this.carriedChiseledBlocks > 1 ? 's' : ''}</strong> • ${levelBadge} Walk to a Level Place &amp; Press <kbd>K</kbd> to Start Building a Castle!</span>` +
          `<button type="button" class="hut-action-pill masonry-action-castle">🏰 Start Castle Here (K)</button></div>`;
      } else {
        const nextSlot = assets.castleSlots[activeCastle.blocksPlaced];
        const dropX = activeCastle.x + nextSlot.groundDropLocal.x;
        const dropZ = activeCastle.z + nextSlot.groundDropLocal.z;
        guideTargetX = dropX;
        guideTargetZ = dropZ;
        guideColor = 0x48cae4;
        const dist = Math.hypot(dropX - px, dropZ - pz);
        const dir = formatCompassDir(dropX - px, dropZ - pz);
        const milestone =
          CASTLE_MILESTONES.find((m) => activeCastle.blocksPlaced < m.blocksRequired) ??
          CASTLE_MILESTONES[CASTLE_MILESTONES.length - 1];

        if (dist <= 4.8 || Math.hypot(activeCastle.x - px, activeCastle.z - pz) <= 8.8) {
          bannerHtml =
            `<div class="masonry-main-row"><span>🏰 <strong>${activeCastle.name}</strong> • <span class="masonry-tag hint">📍 NEXT BLOCK (#${activeCastle.blocksPlaced + 1}/${milestone.blocksRequired}): ${nextSlot.label} (${nextSlot.hintLocation})</span></span>` +
            `<button type="button" class="hut-action-pill masonry-action-work">🧱 Place Block Now (E)</button></div>` +
            this.buildCastleProgressStripHtml(activeCastle);
        } else {
          bannerHtml =
            `<div class="masonry-main-row"><span>🧭 <strong>BLOCK PLACEMENT HINT:</strong> Carry Block <strong>${dist.toFixed(0)}m ${dir}</strong> to <span class="masonry-tag hint">📍 ${nextSlot.label} (${nextSlot.hintLocation})</span> on ${activeCastle.name}</span>` +
            `<button type="button" class="hut-action-pill masonry-action-castle">🏰 New Castle (K)</button></div>` +
            this.buildCastleProgressStripHtml(activeCastle);
        }
      }
    }
    // Case 2: Carrying Raw Natural Stones -> Guide to the Quarry Workbench (or prompt to set up Quarry with Q)!
    else if (this.carriedRawStones > 0) {
      if (!nearestQuarry) {
        const levelHere = this.evaluateLevelPlace(px, pz, 3.4, 0.84);
        const levelBadge = levelHere.isLevel
          ? `<span class="masonry-tag level-ok">✅ Level Ground</span>`
          : `<span class="masonry-tag level-steep">⛰️ Sloped Ground</span>`;
        bannerHtml =
          `<div class="masonry-main-row"><span>🪨 <strong>Carrying ${this.carriedRawStones} Natural Stone${this.carriedRawStones > 1 ? 's' : ''}</strong> • ${levelBadge} Walk to any Level Place &amp; Press <kbd>Q</kbd> to Set Up a Quarry!</span>` +
          `<button type="button" class="hut-action-pill masonry-action-quarry">⛏️ Set Up Quarry (Q)</button></div>`;
      } else {
        guideTargetX = nearestQuarry.x;
        guideTargetZ = nearestQuarry.z;
        guideColor = 0xffd166;
        const dist = Math.hypot(nearestQuarry.x - px, nearestQuarry.z - pz);
        const dir = formatCompassDir(nearestQuarry.x - px, nearestQuarry.z - pz);
        if (dist <= 4.8) {
          bannerHtml =
            `<div class="masonry-main-row"><span>⛏️ <strong>At Stone Quarry Workbench</strong> • Ready to chisel ${this.carriedRawStones} Natural Stone${this.carriedRawStones > 1 ? 's' : ''} into Castle Blocks!</span>` +
            `<button type="button" class="hut-action-pill masonry-action-work">⛏️ Chisel into Blocks (E)</button></div>` +
            (activeCastle ? this.buildCastleProgressStripHtml(activeCastle) : '');
        } else {
          bannerHtml =
            `<div class="masonry-main-row"><span>🧭 <strong>QUARRY HINT:</strong> Carry Stone <strong>${dist.toFixed(0)}m ${dir}</strong> to your <span class="masonry-tag">⛏️ Quarry Workbench</span> and press <kbd>E</kbd> to chisel into Blocks!</span>` +
            `<button type="button" class="hut-action-pill masonry-action-quarry">⛏️ New Quarry Here (Q)</button></div>` +
            (activeCastle ? this.buildCastleProgressStripHtml(activeCastle) : '');
        }
      }
    }
    // Case 3: Empty-handed -> Check if standing at a Castle Drawbridge, Quarry with blocks, a Natural Stone, or show Castle/Quarry hint
    else {
      const enterable = this.getNearestEnterableCastle(px, pz);
      if (enterable && enterable.doorDist <= 6.2) {
        const tier = this.getCompletedMilestoneTier(enterable.castle.blocksPlaced);
        const tierTitle =
          tier === 3
            ? "Mountain King's Grand Citadel"
            : tier === 2
              ? 'Stonewall Stronghold'
              : 'Dwarven Border Keep';
        bannerHtml =
          `<div class="masonry-main-row"><span>🏰 <strong>${enterable.castle.name} (${tierTitle})</strong> • 🛡️ <span class="masonry-tag level-ok">Sanctuary &amp; Armory Ready</span> • Enter to buy Weapons, Shields &amp; Food or shelter from Trolls!</span>` +
          `<button type="button" class="hut-action-pill masonry-action-enter-castle">🏰 Enter Castle &amp; Armory (E)</button></div>` +
          (enterable.castle.blocksPlaced < 30 ? this.buildCastleProgressStripHtml(enterable.castle) : '');
      } else if (nearestQuarry && Math.hypot(nearestQuarry.x - px, nearestQuarry.z - pz) <= 4.8 && nearestQuarry.stockpiledBlocks > 0) {
        bannerHtml =
          `<div class="masonry-main-row"><span>⛏️ <strong>Stone Quarry Stockpile</strong> • <span class="masonry-tag">${nearestQuarry.stockpiledBlocks} Chiseled Block${nearestQuarry.stockpiledBlocks > 1 ? 's' : ''} Ready</span></span>` +
          `<button type="button" class="hut-action-pill masonry-action-work">🧱 Pick Up Blocks (E)</button></div>` +
          (activeCastle ? this.buildCastleProgressStripHtml(activeCastle) : '');
      } else {
        const nearestRock = this.getNearestNaturalRock(px, pz);
        if (nearestRock && nearestRock.dist <= 3.6) {
          bannerHtml =
            `<div class="masonry-main-row"><span>🪨 <strong>Natural Stone Nearby</strong> (${Math.round(nearestRock.dist)}m) • Lift stone to carry to a Quarry &amp; chisel into Castle Blocks!</span>` +
            `<button type="button" class="hut-action-pill masonry-action-work">🪨 Lift Natural Stone (E)</button></div>` +
            (activeCastle ? this.buildCastleProgressStripHtml(activeCastle) : '');
        } else if (activeCastle) {
          const nextSlot = assets.castleSlots[activeCastle.blocksPlaced];
          if (nearestQuarry && nearestQuarry.stockpiledBlocks > 0) {
            guideTargetX = nearestQuarry.x;
            guideTargetZ = nearestQuarry.z;
            guideColor = 0xffd166;
            const qDist = Math.hypot(nearestQuarry.x - px, nearestQuarry.z - pz);
            const qDir = formatCompassDir(nearestQuarry.x - px, nearestQuarry.z - pz);
            bannerHtml =
              `<div class="masonry-main-row"><span>🏰 <strong>Next Castle Block:</strong> <span class="masonry-tag hint">${nextSlot.label}</span> • Pick up stockpiled blocks at Quarry (<strong>${qDist.toFixed(0)}m ${qDir}</strong>)!</span>` +
              `<button type="button" class="hut-action-pill masonry-action-work">🪨 Or Lift Nearest Stone (E)</button></div>` +
              this.buildCastleProgressStripHtml(activeCastle);
          } else if (nearestRock) {
            guideTargetX = nearestRock.rock.wx;
            guideTargetZ = nearestRock.rock.wz;
            guideColor = 0xffe066;
            const rDir = formatCompassDir(nearestRock.rock.wx - px, nearestRock.rock.wz - pz);
            bannerHtml =
              `<div class="masonry-main-row"><span>🏰 <strong>Next Castle Block (#${activeCastle.blocksPlaced + 1}):</strong> <span class="masonry-tag hint">${nextSlot.label} (${nextSlot.hintLocation})</span> • Gather Natural Stone (<strong>${nearestRock.dist.toFixed(0)}m ${rDir}</strong>, press <kbd>E</kbd>)!</span>` +
              (nearestQuarry
                ? ''
                : `<button type="button" class="hut-action-pill masonry-action-quarry">⛏️ Set Up Quarry (Q)</button>`) +
              `</div>` +
              this.buildCastleProgressStripHtml(activeCastle);
          }
        } else if (this.quarries.length > 0 && nearestRock) {
          guideTargetX = nearestRock.rock.wx;
          guideTargetZ = nearestRock.rock.wz;
          guideColor = 0xffe066;
          const rDir = formatCompassDir(nearestRock.rock.wx - px, nearestRock.rock.wz - pz);
          bannerHtml =
            `<div class="masonry-main-row"><span>⛏️ <strong>Quarry Ready!</strong> Gather a Natural Stone (<strong>${nearestRock.dist.toFixed(0)}m ${rDir}</strong>, press <kbd>E</kbd>) or press <kbd>K</kbd> on level ground to start a Castle!</span>` +
            `<button type="button" class="hut-action-pill masonry-action-castle">🏰 Start Castle Here (K)</button></div>`;
        }
      }
    }

    this.setBanner(Boolean(bannerHtml), bannerHtml);

    if (Number.isFinite(guideTargetX) && Number.isFinite(guideTargetZ)) {
      const dx = guideTargetX - px;
      const dz = guideTargetZ - pz;
      if (dx * dx + dz * dz > 2.2 * 2.2) {
        this.footCompassMesh.visible = true;
        this.footCompassMesh.position.set(px, playerPos.y + 0.12, pz);
        this.footCompassMesh.rotation.y = Math.atan2(dx, dz);
        (this.footCompassMesh.material as THREE.MeshBasicMaterial).color.setHex(guideColor);
        const pulse = 0.95 + Math.sin(elapsedTime * 4.5) * 0.06;
        this.footCompassMesh.scale.setScalar(pulse);
      } else {
        this.footCompassMesh.visible = false;
      }
    } else {
      this.footCompassMesh.visible = false;
    }
  }

  private getNearestNaturalRock(
    wx: number,
    wz: number
  ): { rock: NaturalRockInstance; dist: number } | null {
    let best: NaturalRockInstance | null = null;
    let bestDistSq = Infinity;

    const scan = (list: NaturalRockInstance[]) => {
      for (const r of list) {
        if (r.respawnTimer > 0) continue;
        const dx = r.wx - wx;
        const dz = r.wz - wz;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          best = r;
        }
      }
    };

    for (const list of this.activeChunkRocks.values()) {
      scan(list);
    }
    scan(this.quarryBonusRocks);

    if (!best) return null;
    this.nearestRockResult.rock = best;
    this.nearestRockResult.dist = Math.sqrt(bestDistSq);
    return this.nearestRockResult as { rock: NaturalRockInstance; dist: number };
  }

  private getNearestQuarry(wx: number, wz: number): QuarryInstance | null {
    let best: QuarryInstance | null = null;
    let bestDistSq = Infinity;
    for (const q of this.quarries) {
      const dx = q.x - wx;
      const dz = q.z - wz;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = q;
      }
    }
    return best;
  }

  private getActiveCastle(wx: number, wz: number): CastleInstance | null {
    const totalSlots = getSharedMasonryAssets().castleSlots.length;
    let best: CastleInstance | null = null;
    let bestDistSq = Infinity;
    for (const c of this.castles) {
      if (c.blocksPlaced >= totalSlots) continue;
      const dx = c.x - wx;
      const dz = c.z - wz;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = c;
      }
    }
    return best;
  }

  /**
   * Returns the walkable surface elevation at `(wx, wz)`, raising `baseGroundY` onto the top surface
   * of any Quarry paved foundation (`q.y + 0.24`) or Castle stepped plinth / lowered drawbridge / courtyard
   * so the dwarf's feet rest directly upon the ground of the Quarry and Castle rather than sinking in.
   */
  public getWalkableSurfaceHeight(wx: number, wz: number, baseGroundY: number): number {
    let bestY = baseGroundY;

    // 1. Quarry paved stone pad (radius 4.4m flat top at q.y + 0.24, outer bevel 4.4m..4.95m)
    for (const q of this.quarries) {
      const dx = wx - q.x;
      const dz = wz - q.z;
      const distSq = dx * dx + dz * dz;
      if (distSq <= 4.95 * 4.95) {
        const dist = Math.sqrt(distSq);
        const padTopY = q.y + 0.24;
        if (dist <= 4.42) {
          if (padTopY > bestY) bestY = padTopY;
        } else {
          const t = THREE.MathUtils.clamp((4.95 - dist) / (4.95 - 4.42), 0, 1);
          const rampY = THREE.MathUtils.lerp(baseGroundY, Math.max(baseGroundY, padTopY), t);
          if (rampY > bestY) bestY = rampY;
        }
      }
    }

    // 2. Castle stepped foundation plinth, lowered timber drawbridge, and inner courtyard slab
    for (const c of this.castles) {
      if (c.blocksPlaced < 1) continue;
      const dx = wx - c.x;
      const dz = wz - c.z;
      if (dx * dx + dz * dz > 12 * 12) continue;

      const cos = Math.cos(c.rotationY);
      const sin = Math.sin(c.rotationY);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;

      // Slot 0 (`blocksPlaced >= 1`): Border Keep Stepped Plinth (`|lx| <= 3.35, 0.9 <= lz <= 6.35`)
      if (Math.abs(lx) <= 3.35 && lz >= 0.9 && lz <= 6.35) {
        const plinthY = c.y + 0.44;
        if (plinthY > bestY) bestY = plinthY;
      }

      // Slot 6 (`blocksPlaced >= 7`): Lowered Timber Drawbridge ramp (`|lx| <= 1.15, 4.75 <= lz <= 7.20`)
      if (c.blocksPlaced >= 7 && Math.abs(lx) <= 1.15 && lz >= 4.75 && lz <= 7.2) {
        const t = THREE.MathUtils.clamp((7.2 - lz) / (7.2 - 4.75), 0, 1);
        const bridgeY = c.y + THREE.MathUtils.lerp(0.28, 0.76, t);
        if (bridgeY > bestY) bestY = bridgeY;
      }

      // Slot 14 (`blocksPlaced >= 15`): Stronghold Inner Courtyard Terrace (`|lx| <= 5.6, -4.2 <= lz <= 3.4`)
      if (c.blocksPlaced >= 15 && Math.abs(lx) <= 5.6 && lz >= -4.2 && lz <= 3.4) {
        const courtY = c.y + 0.45;
        if (courtY > bestY) bestY = courtY;
      }
    }

    return bestY;
  }

  /**
   * Resolves 2D collisions in local structure space between the player (`pos`, `playerRadius`)
   * and all Quarry structures (Workbench, Wooden Jib Crane, Minecart, Rim Boulders, Block Stockpile)
   * as well as all Castle constructions (every placed block slot `1..blocksPlaced` and completed
   * Tier I / II / III `.glb` castles) so the dwarf can never walk through constructions.
   */
  public resolveObstacleCollision(pos: THREE.Vector3, playerRadius = 0.38): void {
    const pushOutLocalBox = (
      originX: number,
      originZ: number,
      cos: number,
      sin: number,
      minX: number,
      maxX: number,
      minZ: number,
      maxZ: number
    ) => {
      const dx = pos.x - originX;
      const dz = pos.z - originZ;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;

      const exMinX = minX - playerRadius;
      const exMaxX = maxX + playerRadius;
      const exMinZ = minZ - playerRadius;
      const exMaxZ = maxZ + playerRadius;

      if (lx > exMinX && lx < exMaxX && lz > exMinZ && lz < exMaxZ) {
        const penLeft = lx - exMinX;
        const penRight = exMaxX - lx;
        const penBack = lz - exMinZ;
        const penFront = exMaxZ - lz;
        const minPen = Math.min(penLeft, penRight, penBack, penFront);

        let nlx = lx;
        let nlz = lz;
        if (minPen === penLeft) nlx = exMinX;
        else if (minPen === penRight) nlx = exMaxX;
        else if (minPen === penBack) nlz = exMinZ;
        else nlz = exMaxZ;

        pos.x = originX + nlx * cos + nlz * sin;
        pos.z = originZ - nlx * sin + nlz * cos;
      }
    };

    const pushOutLocalCircle = (
      originX: number,
      originZ: number,
      cos: number,
      sin: number,
      cx: number,
      cz: number,
      radius: number
    ) => {
      const wx = originX + cx * cos + cz * sin;
      const wz = originZ - cx * sin + cz * cos;
      const dx = pos.x - wx;
      const dz = pos.z - wz;
      const minDist = radius + playerRadius;
      const dSq = dx * dx + dz * dz;
      if (dSq < minDist * minDist) {
        if (dSq > 0.0001) {
          const d = Math.sqrt(dSq);
          const push = (minDist - d) / d;
          pos.x += dx * push;
          pos.z += dz * push;
        } else {
          pos.z += minDist;
        }
      }
    };

    // 1. Quarry Colliders (Workbench, Wooden Jib Crane, Minecart & Rails, Rim Rocks, Stockpile)
    for (const q of this.quarries) {
      const qdx = pos.x - q.x;
      const qdz = pos.z - q.z;
      if (qdx * qdx + qdz * qdz > 7.5 * 7.5) continue;

      const cos = Math.cos(q.rotationY);
      const sin = Math.sin(q.rotationY);

      // Center Dwarven Workbench (`dwarven workbench 3d model.glb` at (0, 0.24, -0.05))
      pushOutLocalBox(q.x, q.z, cos, sin, -1.08, 1.08, -0.88, 0.78);
      // Wooden Jib Crane (`wooden jib crane 3d model.glb` at (-1.85, 0.24, -1.25))
      pushOutLocalBox(q.x, q.z, cos, sin, -2.65, -1.05, -2.05, -0.45);
      // Wooden Minecart & Iron Track at (+2.35, 0.56, -1.15)
      pushOutLocalBox(q.x, q.z, cos, sin, 1.15, 3.55, -1.62, -0.68);
      // Quarry Rim Boulders at (-3.1, -1.8) & (-2.8, -2.5)
      pushOutLocalBox(q.x, q.z, cos, sin, -3.68, -2.22, -2.95, -1.35);
      // Stockpiled Ashlar Blocks pallet when non-empty
      if (q.stockpiledBlocks > 0) {
        pushOutLocalBox(q.x, q.z, cos, sin, -2.48, -1.2, 0.72, 1.62);
      }
    }

    // 2. Castle Colliders (Every placed architectural block & completed Tier I / II / III .glb models)
    for (const c of this.castles) {
      if (c.blocksPlaced < 2) continue;
      const cdx = pos.x - c.x;
      const cdz = pos.z - c.z;
      if (cdx * cdx + cdz * cdz > 16.0 * 16.0) continue;

      const cos = Math.cos(c.rotationY);
      const sin = Math.sin(c.rotationY);
      const b = c.blocksPlaced;

      // Slot 1 (`b >= 2`): West Gatehouse Pillar & Torch
      if (b >= 2) {
        pushOutLocalBox(c.x, c.z, cos, sin, -2.95, -0.88, 3.25, 5.65);
      }
      // Slot 2 (`b >= 3`): East Gatehouse Pillar & Torch
      if (b >= 3) {
        pushOutLocalBox(c.x, c.z, cos, sin, 0.88, 2.95, 3.25, 5.65);
      }
      // Slot 3 (`b >= 4`): Border Keep Side & Rear Fortified Walls
      if (b >= 4) {
        pushOutLocalBox(c.x, c.z, cos, sin, -2.95, -1.2, 0.85, 3.7);
        pushOutLocalBox(c.x, c.z, cos, sin, 1.2, 2.95, 0.85, 3.7);
        pushOutLocalBox(c.x, c.z, cos, sin, -2.95, 2.95, 0.72, 2.18);
      }
      // Slots 4..7 (`b >= 5`): Arched Portal, Iron-Bound Oak Double Doors & Completed Tier I Border Keep
      if (b >= 5) {
        pushOutLocalBox(c.x, c.z, cos, sin, -3.02, 3.02, 0.72, 5.65);
      }

      // Slot 8 (`b >= 9`): South-West Round Corner Watchtower at (-6.2, 3.6)
      if (b >= 9) {
        pushOutLocalCircle(c.x, c.z, cos, sin, -6.2, 3.6, 2.15);
      }
      // Slot 9 (`b >= 10`): South-East Round Corner Watchtower at (6.2, 3.6)
      if (b >= 10) {
        pushOutLocalCircle(c.x, c.z, cos, sin, 6.2, 3.6, 2.15);
      }
      // Slot 10 (`b >= 11`): West Front & Side Curtain Wall with Stepped Buttress
      if (b >= 11) {
        pushOutLocalBox(c.x, c.z, cos, sin, -5.65, -2.85, 2.45, 4.55);
        pushOutLocalBox(c.x, c.z, cos, sin, -6.9, -5.3, -4.25, 3.65);
      }
      // Slot 11 (`b >= 12`): East Front & Side Curtain Wall with Stepped Buttress
      if (b >= 12) {
        pushOutLocalBox(c.x, c.z, cos, sin, 2.85, 5.65, 2.45, 4.55);
        pushOutLocalBox(c.x, c.z, cos, sin, 5.3, 6.9, -4.25, 3.65);
      }
      // Slot 12 (`b >= 13`): North-West Rear Round Watchtower at (-6.2, -4.4)
      if (b >= 13) {
        pushOutLocalCircle(c.x, c.z, cos, sin, -6.2, -4.4, 2.15);
      }
      // Slot 13 (`b >= 14`): North-East Rear Round Watchtower at (6.2, -4.4)
      if (b >= 14) {
        pushOutLocalCircle(c.x, c.z, cos, sin, 6.2, -4.4, 2.15);
      }
      // Slot 14 (`b >= 15`): North Rear Curtain Wall
      if (b >= 15) {
        pushOutLocalBox(c.x, c.z, cos, sin, -6.0, 6.0, -5.2, -3.6);
      }
      // Slot 15 (`b >= 16`): Central Stronghold Keep Bastion
      if (b >= 16) {
        pushOutLocalBox(c.x, c.z, cos, sin, -2.95, 2.95, -2.55, 2.35);
      }
      // Completed Tier II (`b >= 18`): Stonewall Stronghold full fortified enclosure
      if (b >= 18) {
        pushOutLocalBox(c.x, c.z, cos, sin, -6.85, 6.85, -5.15, 4.55);
      }
      // Slot 18 (`b >= 19`): Left Rampart Stepped Stone Staircase
      if (b >= 19) {
        pushOutLocalBox(c.x, c.z, cos, sin, -4.35, -2.75, -0.35, 2.55);
      }
      // Slot 19 (`b >= 20`): Inner Citadel Royal Hall Bastion
      if (b >= 20) {
        pushOutLocalBox(c.x, c.z, cos, sin, -3.35, 3.35, -4.15, -1.05);
      }
      // Slot 20 (`b >= 21`): West Inner Watch-Turret Shaft
      if (b >= 21) {
        pushOutLocalCircle(c.x, c.z, cos, sin, -2.05, -0.65, 1.28);
      }
      // Completed Tier III (`b >= 30`): Mountain King's Grand Citadel full footprint
      if (b >= 30) {
        pushOutLocalBox(c.x, c.z, cos, sin, -7.65, 7.65, -6.05, 5.25);
        pushOutLocalBox(c.x, c.z, cos, sin, -3.45, 3.45, 3.2, 5.95);
      }
    }
  }

  // ============================================================================
  // HOUSE EQUIPMENT SHOP (Buy More Equipment Inside Houses with Gold)
  // ============================================================================
  private buildHouseShopDOM(): void {
    if (!this.houseShopListEl) return;
    this.houseShopListEl.innerHTML = '';

    for (const def of HOUSE_EQUIPMENT_CATALOG) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'relic-card locked';
      btn.dataset.eqId = def.id;
      btn.title = `${def.name}: ${def.shortDesc} (Press ${def.keyHint} inside House)`;

      const iconSpan = document.createElement('span');
      iconSpan.className = 'relic-icon';
      iconSpan.textContent = def.icon;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'relic-name';
      nameSpan.innerHTML = `<kbd class="relic-key">${def.keyHint}</kbd> ${def.name}<div class="eq-sub-desc">${def.shortDesc}</div>`;

      const costSpan = document.createElement('span');
      costSpan.className = 'relic-cost';
      costSpan.textContent = `${def.cost}g`;

      btn.appendChild(iconSpan);
      btn.appendChild(nameSpan);
      btn.appendChild(costSpan);

      btn.addEventListener('click', () => {
        this.tryBuyHouseEquipment(def.id);
      });

      this.houseShopListEl.appendChild(btn);
    }
    this.renderHouseShop();
  }

  private syncHouseShopVisibility(insideHut: boolean): void {
    if (!this.houseShopEl) return;
    const isHidden = this.houseShopEl.classList.contains('hidden');
    if (insideHut && isHidden) {
      this.houseShopEl.classList.remove('hidden');
      this.renderHouseShop();
    } else if (!insideHut && !isHidden) {
      this.houseShopEl.classList.add('hidden');
    }
  }

  public renderHouseShop(): void {
    if (!this.houseShopListEl) return;
    const gold = this.getGold();
    const buttons = this.houseShopListEl.querySelectorAll<HTMLButtonElement>('button[data-eq-id]');
    buttons.forEach((btn) => {
      const id = btn.dataset.eqId as HouseEquipmentId;
      const def = HOUSE_EQUIPMENT_CATALOG.find((d) => d.id === id);
      if (!def) return;
      const owned = this.unlockedEquipment.has(id);
      const canAfford = !owned && gold >= def.cost;
      const state = owned ? 'owned' : canAfford ? 'affordable' : 'locked';
      btn.className = `relic-card ${state}`;
      const costSpan = btn.querySelector('.relic-cost');
      if (costSpan) {
        costSpan.className = owned ? 'relic-cost owned-badge' : 'relic-cost';
        costSpan.textContent = owned ? '✓' : `${def.cost}g`;
      }
    });
  }

  public tryBuyHouseEquipment(id: HouseEquipmentId): boolean {
    if (!this.isInsideHutFn()) {
      this.showToast(
        '🏠 Enter any Dwarven House (Press E at a House door) to buy Mason & Quarry Equipment!',
        false
      );
      return false;
    }
    if (this.unlockedEquipment.has(id)) {
      this.showToast('✅ You already own this House Equipment!', false);
      return false;
    }
    const def = HOUSE_EQUIPMENT_CATALOG.find((d) => d.id === id);
    if (!def) return false;

    if (!this.spendGold(def.cost)) {
      this.playDeniedSound();
      this.showToast(`🪙 Need ${def.cost} Gold to buy ${def.name} in this House!`, false);
      return false;
    }

    this.unlockedEquipment.add(id);
    if (id === 'ration_kettle') {
      this.energy = this.getMaxEnergy();
      this.foodCount += 2;
    }
    this.playMilestoneFanfare();
    this.showToast(`${def.icon} Purchased ${def.name} in Dwarven House! (${def.shortDesc})`, true);
    this.renderHouseShop();
    this.syncEnergyAndFoodHUD();
    this.onStateChanged?.();
    return true;
  }

  // ============================================================================
  // CASTLE ARMORY & TAVERN PROVISION SHOP (Inside Tier I / II / III Castles)
  // ============================================================================
  private buildCastleArmoryShopDOM(): void {
    if (!this.castleShopListEl) return;
    this.castleShopListEl.innerHTML = '';

    for (const def of CASTLE_ARMORY_CATALOG) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'relic-card locked';
      btn.dataset.armoryId = def.id;
      btn.title = `${def.name}: ${def.shortDesc} (Press ${def.keyHint} inside Castle)`;

      const iconSpan = document.createElement('span');
      iconSpan.className = 'relic-icon';
      iconSpan.textContent = def.icon;

      const tierTag =
        def.minTier === 3 ? 'Tier III' : def.minTier === 2 ? 'Tier II+' : 'Tier I+';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'relic-name';
      nameSpan.innerHTML = `<kbd class="relic-key">${def.keyHint}</kbd> ${def.name} <span class="armory-tier-badge">${tierTag}</span><div class="eq-sub-desc">${def.shortDesc}</div>`;

      const costSpan = document.createElement('span');
      costSpan.className = 'relic-cost';
      costSpan.textContent = `${def.cost}g`;

      btn.appendChild(iconSpan);
      btn.appendChild(nameSpan);
      btn.appendChild(costSpan);

      btn.addEventListener('click', () => {
        this.tryBuyCastleArmoryItem(def.id);
      });

      this.castleShopListEl.appendChild(btn);
    }
    this.renderCastleArmoryShop();
  }

  private syncCastleShopVisibility(insideCastle: boolean): void {
    if (!this.castleShopEl) return;
    const isHidden = this.castleShopEl.classList.contains('hidden');
    if (insideCastle && isHidden) {
      this.castleShopEl.classList.remove('hidden');
      this.renderCastleArmoryShop();
    } else if (!insideCastle && !isHidden) {
      this.castleShopEl.classList.add('hidden');
    }
  }

  public renderCastleArmoryShop(): void {
    if (!this.castleShopListEl) return;
    const gold = this.getGold();
    const visit = this.getActiveCastleVisitFn();
    const currentTier = visit?.tier ?? 1;

    if (this.castleShopTitleEl) {
      const tierTitle =
        currentTier === 3
          ? "👑 Grand Citadel Royal Armory & Feast Hall"
          : currentTier === 2
            ? '🏯 Stonewall Stronghold Armory & Banquet'
            : '🏰 Border Keep Armory & Hearth Provisions';
      this.castleShopTitleEl.textContent = tierTitle;
    }

    const buttons = this.castleShopListEl.querySelectorAll<HTMLButtonElement>(
      'button[data-armory-id]'
    );
    buttons.forEach((btn) => {
      const id = btn.dataset.armoryId as CastleArmoryItemId;
      const def = CASTLE_ARMORY_CATALOG.find((d) => d.id === id);
      if (!def) return;

      const isProvision = def.category === 'provision';
      const owned = !isProvision && this.unlockedArmory.has(id);
      const isEquipped =
        (def.weaponId && this.equippedWeaponId === def.weaponId) ||
        (def.shieldId && this.equippedShieldId === def.shieldId);
      const tierLocked = currentTier < def.minTier;
      const canAfford = !owned && !tierLocked && gold >= def.cost;

      const state = owned
        ? 'owned'
        : tierLocked
          ? 'locked'
          : canAfford
            ? 'affordable'
            : 'locked';
      btn.className = `relic-card ${state}`;

      const costSpan = btn.querySelector('.relic-cost');
      if (costSpan) {
        if (owned) {
          costSpan.className = 'relic-cost owned-badge';
          costSpan.textContent = isEquipped ? 'EQUIPPED' : 'EQUIP';
        } else if (tierLocked) {
          costSpan.className = 'relic-cost';
          costSpan.textContent = `🔒 T${def.minTier}`;
        } else {
          costSpan.className = 'relic-cost';
          costSpan.textContent = `${def.cost}g`;
        }
      }
    });
  }

  public tryBuyCastleArmoryItem(id: CastleArmoryItemId): boolean {
    if (!this.isInsideCastleFn()) {
      this.showToast(
        '🏰 Enter a completed Castle (Press E at a Castle Drawbridge) to buy Weapons, Shields & Tavern Food!',
        false
      );
      return false;
    }

    const def = CASTLE_ARMORY_CATALOG.find((d) => d.id === id);
    if (!def) return false;

    const visit = this.getActiveCastleVisitFn();
    const currentTier = visit?.tier ?? 1;

    // Allow equipping an already-owned weapon or shield for free!
    if (def.category !== 'provision' && this.unlockedArmory.has(id)) {
      if (def.weaponId) {
        this.equippedWeaponId = def.weaponId;
      }
      if (def.shieldId) {
        this.equippedShieldId = def.shieldId;
        this.health = Math.min(this.getMaxHealth(), this.health);
      }
      this.dwarf.setEquippedCombatGear(this.equippedWeaponId, this.equippedShieldId);
      this.renderCastleArmoryShop();
      this.syncEnergyAndFoodHUD();
      this.showToast(`${def.icon} Equipped ${def.name}!`, true);
      this.onStateChanged?.();
      return true;
    }

    if (currentTier < def.minTier) {
      this.playDeniedSound();
      const neededBlocks = def.minTier === 3 ? 30 : 18;
      this.showToast(
        `🔒 ${def.name} requires a Tier ${def.minTier === 3 ? 'III Grand Citadel' : 'II Stronghold'} (${neededBlocks} Castle Blocks)!`,
        false
      );
      return false;
    }

    if (!this.spendGold(def.cost)) {
      this.playDeniedSound();
      this.showToast(`🪙 Need ${def.cost} Gold to buy ${def.name} in this Castle!`, false);
      return false;
    }

    if (def.category === 'provision') {
      // Repeatable Tavern Food & Feast purchase!
      if (id === 'keep_stew') {
        this.foodCount += 2;
        this.energy = Math.min(this.getMaxEnergy(), this.energy + 40);
        this.health = Math.min(this.getMaxHealth(), this.health + 25);
        this.playEatSound();
        this.showToast(
          `🍲 Bought Border Keep Hearth Stew! +2 🍖 Rations, +40⚡ Strength & +25❤️ Health!`,
          true
        );
      } else if (id === 'roast_boar') {
        this.foodCount += 5;
        this.energy = this.getMaxEnergy();
        this.health = this.getMaxHealth();
        this.playEatSound();
        this.showToast(
          `🍖 Bought Stronghold Roast Boar Platter! +5 🍖 Rations & 100% Full Health/Strength!`,
          true
        );
      } else if (id === 'kings_feast') {
        this.foodCount += 4;
        this.energy = this.getMaxEnergy();
        this.health = this.getMaxHealth();
        this.kingsValorTimer = 120.0;
        this.playMilestoneFanfare();
        this.showToast(
          `👑 Mountain King's Golden Feast! +4 🍖 Rations, Full Restore & +25% King's Valor Damage for 2m!`,
          true
        );
      }
    } else {
      this.unlockedArmory.add(id);
      if (def.weaponId) {
        this.equippedWeaponId = def.weaponId;
      }
      if (def.shieldId) {
        this.equippedShieldId = def.shieldId;
        this.health = this.getMaxHealth();
      }
      this.dwarf.setEquippedCombatGear(this.equippedWeaponId, this.equippedShieldId);
      this.playMilestoneFanfare();
      this.showToast(
        `${def.icon} Forged & Equipped ${def.name}! (${def.shortDesc})`,
        true
      );
    }

    this.dwarf.spawnBurst(
      this.dwarf.root.position.x,
      this.dwarf.root.position.y + 0.9,
      this.dwarf.root.position.z,
      16
    );
    this.renderCastleArmoryShop();
    this.syncEnergyAndFoodHUD();
    this.onStateChanged?.();
    return true;
  }

  // ============================================================================
  // HUD & PERSISTENCE HELPERS
  // ============================================================================
  public syncEnergyAndFoodHUD(): void {
    // 1. Health Bar (`❤️`)
    const maxH = this.getMaxHealth();
    this.health = Math.min(maxH, this.health);
    const hPct = THREE.MathUtils.clamp(Math.round((this.health / maxH) * 100), 0, 100);
    if (hPct !== this.lastHealthPct && this.healthFillEl) {
      this.lastHealthPct = hPct;
      this.healthFillEl.style.width = `${hPct}%`;
      this.healthFillEl.style.background =
        hPct <= 25
          ? 'linear-gradient(90deg, #ef233c, #ff4d6d)'
          : 'linear-gradient(90deg, #38b000, #70e000)';
    }
    const hText = `❤️ ${Math.round(this.health)}/${maxH}`;
    if (hText !== this.lastHealthText && this.healthTextEl) {
      this.lastHealthText = hText;
      this.healthTextEl.textContent = hText;
    }

    // 2. Strength / Energy Bar (`⚡`)
    const maxE = this.getMaxEnergy();
    const pct = THREE.MathUtils.clamp(Math.round((this.energy / maxE) * 100), 0, 100);
    if (pct !== this.lastEnergyPct && this.energyFillEl) {
      this.lastEnergyPct = pct;
      this.energyFillEl.style.width = `${pct}%`;
      this.energyFillEl.style.background =
        pct <= 20
          ? 'linear-gradient(90deg, #ef233c, #ff7b00)'
          : 'linear-gradient(90deg, #f4a261, #ffd166)';
    }

    const eText = `⚡ ${Math.round(this.energy)}/${maxE}`;
    if (eText !== this.lastEnergyText && this.energyTextEl) {
      this.lastEnergyText = eText;
      this.energyTextEl.textContent = eText;
    }

    // 3. Food Rations (`🍖`)
    const fText = `🍖 ${this.foodCount} Food`;
    if (fText !== this.lastFoodText) {
      this.lastFoodText = fText;
      if (this.foodCountEl) {
        this.foodCountEl.textContent = fText;
      }
      if (this.topFoodHudEl) {
        this.topFoodHudEl.innerHTML = `🍖 ${this.foodCount} Food (<kbd>G</kbd>)`;
      }
    }

    // 4. Equipped Weapon & Shield Badge (`#combat-gear-badge`)
    if (this.combatGearBadgeEl) {
      const wSpec = WEAPON_COMBAT_SPECS[this.equippedWeaponId] ?? WEAPON_COMBAT_SPECS.mallet;
      const shieldIcon =
        this.equippedShieldId === 'mithril_aegis'
          ? ' • 🔰 Aegis'
          : this.equippedShieldId === 'round_shield'
            ? ' • 🛡️ Shield'
            : '';
      const valorTag = this.kingsValorTimer > 0 ? ' • 👑 +25%' : '';
      const gearText = `${wSpec.icon} ${wSpec.name} (${wSpec.damage} DMG)${shieldIcon}${valorTag}`;
      if (gearText !== this.lastGearBadgeText) {
        this.lastGearBadgeText = gearText;
        this.combatGearBadgeEl.textContent = gearText;
      }
    }
  }

  private syncMilestoneHUD(): void {
    if (!this.milestoneHudEl) return;
    let totalMilestones = 0;
    let bestBlocks = 0;
    for (const c of this.castles) {
      if (c.blocksPlaced > bestBlocks) bestBlocks = c.blocksPlaced;
      for (const m of CASTLE_MILESTONES) {
        if (c.blocksPlaced >= m.blocksRequired) totalMilestones++;
      }
    }

    const nextM =
      CASTLE_MILESTONES.find((m) => bestBlocks < m.blocksRequired) ??
      CASTLE_MILESTONES[CASTLE_MILESTONES.length - 1];
    const blocksLeft = Math.max(0, nextM.blocksRequired - bestBlocks);
    const text =
      this.castles.length === 0
        ? `🏰 Castles: 0 • Milestones: 0`
        : bestBlocks >= 30
          ? `🏰 30/30 Blocks (Complete!) • 🏆 ${totalMilestones} Milestones`
          : `🏰 ${bestBlocks}/${nextM.blocksRequired} Blocks (${blocksLeft} left) • 🏆 ${totalMilestones} Milestone${totalMilestones === 1 ? '' : 's'}`;

    if (text !== this.lastMilestoneText) {
      this.lastMilestoneText = text;
      this.milestoneHudEl.textContent = text;
    }
  }

  private setBanner(visible: boolean, html: string): void {
    if (!this.masonryBannerEl) return;
    if (visible !== this.lastBannerVisible) {
      this.lastBannerVisible = visible;
      this.masonryBannerEl.classList.toggle('hidden', !visible);
    }
    if (visible && html !== this.lastBannerHtml) {
      this.lastBannerHtml = html;
      this.masonryBannerEl.innerHTML = html;
    }
  }

  private showToast(text: string, isHighlight: boolean): void {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `pickup-toast ${isHighlight ? 'rare' : ''}`;
    toast.textContent = text;
    this.toastContainer.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 2800);
  }

  public getSerializedQuarries(): SavedQuarrySite[] {
    return this.quarries.map((q) => ({
      id: q.id,
      x: Math.round(q.x * 10) / 10,
      y: Math.round(q.y * 10) / 10,
      z: Math.round(q.z * 10) / 10,
      rotationY: Math.round(q.rotationY * 100) / 100,
      stockpiledBlocks: q.stockpiledBlocks,
    }));
  }

  public getSerializedCastles(): SavedCastleSite[] {
    return this.castles.map((c) => ({
      id: c.id,
      name: c.name,
      x: Math.round(c.x * 10) / 10,
      y: Math.round(c.y * 10) / 10,
      z: Math.round(c.z * 10) / 10,
      rotationY: Math.round(c.rotationY * 100) / 100,
      blocksPlaced: c.blocksPlaced,
    }));
  }

  public getUnlockedEquipmentIds(): string[] {
    return Array.from(this.unlockedEquipment);
  }

  public getUnlockedArmoryIds(): string[] {
    return Array.from(this.unlockedArmory);
  }

  public restoreProgress(
    quarries?: SavedQuarrySite[],
    castles?: SavedCastleSite[],
    equipment?: string[],
    energy?: number,
    foodCount?: number,
    carriedRawStones?: number,
    carriedChiseledBlocks?: number,
    health?: number,
    unlockedArmory?: string[],
    equippedWeapon?: string,
    equippedShield?: string,
    trollsSlain?: number
  ): void {
    this.clearPlacedInstances();

    if (equipment) {
      for (const id of equipment) {
        if (HOUSE_EQUIPMENT_CATALOG.some((e) => e.id === id)) {
          this.unlockedEquipment.add(id as HouseEquipmentId);
        }
      }
    }

    if (unlockedArmory) {
      for (const id of unlockedArmory) {
        if (CASTLE_ARMORY_CATALOG.some((a) => a.id === id)) {
          this.unlockedArmory.add(id as CastleArmoryItemId);
        }
      }
    }

    const validWeapons: EquippedWeaponId[] = [
      'mallet',
      'oak_club',
      'battle_axe',
      'broadsword',
      'runic_greatsword',
    ];
    this.equippedWeaponId = validWeapons.includes(equippedWeapon as EquippedWeaponId)
      ? (equippedWeapon as EquippedWeaponId)
      : 'mallet';

    const validShields: EquippedShieldId[] = ['none', 'round_shield', 'mithril_aegis'];
    this.equippedShieldId = validShields.includes(equippedShield as EquippedShieldId)
      ? (equippedShield as EquippedShieldId)
      : 'none';

    this.trollsSlainBonusCount = typeof trollsSlain === 'number' ? Math.max(0, trollsSlain) : 0;
    this.dwarf.setEquippedCombatGear(this.equippedWeaponId, this.equippedShieldId);

    const maxH = this.getMaxHealth();
    this.health = typeof health === 'number' ? THREE.MathUtils.clamp(health, 20, maxH) : maxH;

    const maxE = this.getMaxEnergy();
    this.energy = typeof energy === 'number' ? THREE.MathUtils.clamp(energy, 15, maxE) : maxE;
    this.foodCount = typeof foodCount === 'number' ? Math.max(0, Math.floor(foodCount)) : 2;
    this.carriedRawStones =
      typeof carriedRawStones === 'number' ? Math.max(0, Math.floor(carriedRawStones)) : 0;
    this.carriedChiseledBlocks =
      typeof carriedChiseledBlocks === 'number'
        ? Math.max(0, Math.floor(carriedChiseledBlocks))
        : 0;
    this.dwarf.setCarriedLoad(this.carriedRawStones, this.carriedChiseledBlocks);

    if (quarries) {
      for (const sq of quarries) {
        const q = this.createQuarryInstance(sq);
        this.quarries.push(q);
        this.spawnRocksAroundQuarry(q);
      }
    }
    if (castles) {
      for (const sc of castles) {
        this.castles.push(this.createCastleInstance(sc));
      }
    }
    this.completedCastlesDirty = true;

    this.renderHouseShop();
    this.renderCastleArmoryShop();
    this.syncEnergyAndFoodHUD();
    this.syncMilestoneHUD();
  }

  private clearPlacedInstances(): void {
    for (const q of this.quarries) {
      this.group.remove(q.root);
    }
    this.quarries.length = 0;

    for (const c of this.castles) {
      this.group.remove(c.root);
    }
    this.castles.length = 0;
    this.completedCastlesDirty = true;

    for (const r of this.quarryBonusRocks) {
      activeNearRocks.delete(r);
      this.group.remove(r.root);
    }
    this.quarryBonusRocks.length = 0;
    this.unlockedEquipment.clear();
    this.unlockedArmory.clear();
  }

  public reset(): void {
    this.clearPlacedInstances();
    for (const rockList of this.activeChunkRocks.values()) {
      for (const r of rockList) {
        activeNearRocks.delete(r);
        this.group.remove(r.root);
      }
    }
    this.activeChunkRocks.clear();
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
    this.equippedWeaponId = 'mallet';
    this.equippedShieldId = 'none';
    this.kingsValorTimer = 0;
    this.trollsSlainBonusCount = 0;
    this.dwarf.setEquippedCombatGear('mallet', 'none');
    this.health = 100;
    this.energy = 100;
    this.foodCount = 2;
    this.carriedRawStones = 0;
    this.carriedChiseledBlocks = 0;
    this.dwarf.setCarriedLoad(0, 0);
    this.renderHouseShop();
    this.renderCastleArmoryShop();
    this.syncEnergyAndFoodHUD();
    this.syncMilestoneHUD();
  }

  // ============================================================================
  // SYNTHESIZED WEB AUDIO FEEDBACK
  // ============================================================================
  private playPickupStoneSound(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.14);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.17);
  }

  private playChiselSound(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const clinks = [980, 1240, 1120, 1480];
    clinks.forEach((freq, idx) => {
      const t = now + idx * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.65, t + 0.08);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.11, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(t);
      osc.stop(t + 0.1);
    });
  }

  private playBuildSound(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [180, 270, 360];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(t);
      osc.stop(t + 0.24);
    });
  }

  private playEatSound(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [330, 440, 587.33];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.065;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.14, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }

  private playDeniedSound(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.setValueAtTime(115, now + 0.08);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.2);
  }

  private playMilestoneFanfare(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880, 1108.73];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(t);
      osc.stop(t + 0.48);
    });
  }
}
