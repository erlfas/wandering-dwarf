import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import hutInteriorModelUrl from '../../3dmodels/dwarven hut interior 3d model.glb?url';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { getSharedAudioContext } from '../player/RelicStore';
import { ChunkManager } from './ChunkManager';
import { WorldConfig } from './Config';
import { createOptimizedGlbLoader, HutPlacement } from './ForestField';

export interface ArtefactDefinition {
  id: string;
  name: string;
  icon: string;
  gold: number;
  accentColor: number;
  blessingSummary: string;
}

export const ARTEFACT_CATALOG: readonly ArtefactDefinition[] = [
  {
    id: 'durin_crown',
    name: "Crown of Durin's Peak",
    icon: '👑',
    gold: 150,
    accentColor: 0xffd166,
    blessingSummary: '+25% Gold from all sources & unlocks Royal Crown',
  },
  {
    id: 'astral_hammer',
    name: "Runesmith's Astral Hammer",
    icon: '🔨',
    gold: 150,
    accentColor: 0x48cae4,
    blessingSummary: '35% chance to chisel +1 free bonus Castle Block',
  },
  {
    id: 'mountain_chalice',
    name: 'Chalice of the Mountain King',
    icon: '🏆',
    gold: 150,
    accentColor: 0xffb703,
    blessingSummary: '+35% Health & Energy restored from all Food & Feasts',
  },
  {
    id: 'heartstone_gem',
    name: 'Heartstone of the Deep',
    icon: '💎',
    gold: 175,
    accentColor: 0x72efdd,
    blessingSummary: 'Passively regenerates +1.0❤️ & +2.5⚡ every second',
  },
  {
    id: 'runic_tablet',
    name: 'Ancient Runic Tablet',
    icon: '📜',
    gold: 150,
    accentColor: 0x90e0ef,
    blessingSummary: '+35% bonus Renown XP from Decrees & Contracts',
  },
  {
    id: 'iron_aegis',
    name: 'Aegis of the Iron Hills',
    icon: '🛡️',
    gold: 150,
    accentColor: 0xf4a261,
    blessingSummary: '-20% incoming Troll smash damage & wider Shield Parry',
  },
];

interface DoorwayMarker {
  hut: HutPlacement;
  root: THREE.Group;
  ringMesh: THREE.Mesh;
  beaconMesh: THREE.Mesh;
}

interface SharedHutAssets {
  fallbackInteriorGeo: THREE.BufferGeometry;
  fallbackInteriorMat: THREE.MeshStandardMaterial;
  plinthGeo: THREE.BufferGeometry;
  plinthMat: THREE.MeshStandardMaterial;
  doorRingGeo: THREE.BufferGeometry;
  doorRingMat: THREE.MeshBasicMaterial;
  exitRingGeo: THREE.BufferGeometry;
  exitRingMat: THREE.MeshBasicMaterial;
  beaconGeo: THREE.BufferGeometry;
  beaconMat: THREE.MeshStandardMaterial;
  hearthFlameGeo: THREE.BufferGeometry;
  hearthFlameMat: THREE.MeshBasicMaterial;
  pedestalGeo: THREE.BufferGeometry;
  pedestalMat: THREE.MeshStandardMaterial;
  artefactRingGeo: THREE.BufferGeometry;
  artefactRingMat: THREE.MeshBasicMaterial;
  artefactGoldMat: THREE.MeshStandardMaterial;
  artefactGemMats: THREE.MeshStandardMaterial[];
  artefactGoldGeos: THREE.BufferGeometry[];
  artefactGemGeos: THREE.BufferGeometry[];
}

let sharedHutAssets: SharedHutAssets | null = null;
let sharedHutInteriorGeo: THREE.BufferGeometry | null = null;
let sharedHutInteriorMat: THREE.MeshStandardMaterial | null = null;
let hutInteriorLoadStarted = false;
const activeInteriorMeshes = new Set<THREE.Mesh>();

/**
 * Precomputed local XZ furniture collision circles `[localX, localZ, radius, ...]` inside
 * `3dmodels/dwarven hut interior 3d model.glb` (normalized to 5.2m height, ~7.0m footprint):
 * - Bed in the back-left corner (`z ~ -2.0m, x ~ -1.8..+0.2m`)
 * - Barrel between bed and fireplace (`x ~ -1.85m, z ~ -0.75m`)
 * - Stone fireplace & hearth along the left wall (`x ~ -1.75m, z ~ +0.1..+1.75m`)
 * - Firewood pile in the front-left corner (`x ~ -1.85m, z ~ +2.25m`)
 * - Treasure chests & barrels along the right wall (`x ~ +2.55m, z ~ -2.0..-0.6m`)
 * - Dining table, bench & round wooden stool in the front-right area (`x ~ +0.85..+2.2m, z ~ +0.3..+2.4m`)
 */
const HUT_INTERIOR_COLLIDERS = new Float32Array([
  // Back-left Bed (3 overlapping circles along the bed frame)
  -1.85, -1.95, 0.62,
  -1.10, -1.95, 0.62,
  -0.32, -1.95, 0.58,
  // Barrel between bed and fireplace
  -1.85, -0.75, 0.45,
  // Stone Fireplace & Hearth on left wall
  -1.72, 0.35, 0.68,
  -1.72, 1.05, 0.68,
  -1.72, 1.68, 0.65,
  // Firewood stack at front-left
  -1.88, 2.28, 0.48,
  // Treasure chests & barrels along right (+X) wall
  2.52, -1.95, 0.56,
  2.55, -1.25, 0.56,
  2.55, -0.62, 0.52,
  2.52, 0.15, 0.52,
  // Dining Table & Bench in front-right area
  1.52, 0.62, 0.62,
  1.52, 1.25, 0.62,
  1.52, 1.82, 0.58,
  2.18, 1.05, 0.52,
  2.18, 1.72, 0.52,
  // Wooden Stool at front of table
  0.88, 2.28, 0.36,
]);

/**
 * Asynchronously loads `3dmodels/dwarven hut interior 3d model.glb`, strips unused PBR maps
 * and `KHR_materials_specular` pre-parse, aligns the wooden plank floor to Y=0 at 5.2m height,
 * guards normal computation, and hot-swaps any active interior mesh.
 */
export function loadDwarvenHutInteriorModel(): void {
  if (hutInteriorLoadStarted) return;
  hutInteriorLoadStarted = true;

  const loader = createOptimizedGlbLoader();
  loader.load(
    hutInteriorModelUrl,
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

      // 2. Normalize bounding box: center X/Z at 0, align wooden plank floor (9.2% of spanY) to Y=0,
      // and scale to 5.2m total height (~7.0m cutaway room width/depth calibrated to the 1.4m dwarf)
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const spanY = Math.max(0.01, box.max.y - box.min.y);
      const targetHeight = 5.2;
      const scaleFactor = targetHeight / spanY;
      const innerFloorY = box.min.y + spanY * 0.092;

      geo.translate(-centerX, -innerFloorY, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);

      // 3. Guard computeVertexNormals() — never recompute on 22,939-vert mesh when normals exist
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
        metalness: 0.04,
      });
      if (origMat.normalMap && origMat.normalMap !== origMat.map) origMat.normalMap.dispose();
      if (origMat.roughnessMap && origMat.roughnessMap !== origMat.map) origMat.roughnessMap.dispose();
      if (origMat.metalnessMap && origMat.metalnessMap !== origMat.map) origMat.metalnessMap.dispose();
      if (origMat.aoMap && origMat.aoMap !== origMat.map) origMat.aoMap.dispose();
      origMat.dispose();

      sharedHutInteriorGeo = geo;
      sharedHutInteriorMat = mat;

      for (const interiorMesh of activeInteriorMeshes) {
        interiorMesh.geometry = sharedHutInteriorGeo;
        interiorMesh.material = sharedHutInteriorMat;
        interiorMesh.receiveShadow = true;
      }
    },
    undefined,
    (err) => {
      console.error('Failed to load dwarven hut interior 3D model:', err);
    }
  );
}

function getSharedHutAssets(): SharedHutAssets {
  if (sharedHutAssets) return sharedHutAssets;

  // 1. Low-poly procedural cutaway interior fallback (< 90 tris) while GLB streams in
  const floorGeo = new THREE.BoxGeometry(5.6, 0.32, 5.6);
  floorGeo.translate(0, -0.16, 0);
  const backWallGeo = new THREE.BoxGeometry(5.6, 3.2, 0.35);
  backWallGeo.translate(0, 1.6, -2.65);
  const leftWallGeo = new THREE.BoxGeometry(0.35, 3.2, 5.6);
  leftWallGeo.translate(-2.65, 1.6, 0);
  const hearthGeo = new THREE.BoxGeometry(1.2, 4.4, 1.6);
  hearthGeo.translate(-1.85, 2.2, 0.95);
  const tableGeo = new THREE.BoxGeometry(1.1, 0.75, 1.6);
  tableGeo.translate(1.5, 0.38, 1.15);
  const bedGeo = new THREE.BoxGeometry(2.1, 0.65, 1.25);
  bedGeo.translate(-1.1, 0.32, -1.95);
  const fallbackInteriorGeo = mergeGeometries(
    [floorGeo, backWallGeo, leftWallGeo, hearthGeo, tableGeo, bedGeo],
    false
  );
  floorGeo.dispose();
  backWallGeo.dispose();
  leftWallGeo.dispose();
  hearthGeo.dispose();
  tableGeo.dispose();
  bedGeo.dispose();
  fallbackInteriorGeo.computeBoundingBox();
  fallbackInteriorGeo.computeBoundingSphere();

  const fallbackInteriorMat = new THREE.MeshStandardMaterial({
    color: 0x6e4b2b,
    roughness: 0.85,
    metalness: 0.05,
  });

  // Grounding dark stone plinth beneath the cutaway diorama
  const plinthGeo = new THREE.CylinderGeometry(5.6, 6.2, 0.55, 24);
  plinthGeo.translate(0, -0.72, 0);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x2b2d33,
    roughness: 0.92,
    metalness: 0.04,
  });

  // Exterior Doorway Threshold Ring & Floating Beacon
  const doorRingGeo = new THREE.RingGeometry(0.72, 1.02, 24);
  doorRingGeo.rotateX(-Math.PI / 2);
  const doorRingMat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.68,
  });

  const exitRingGeo = new THREE.RingGeometry(0.55, 0.78, 24);
  exitRingGeo.rotateX(-Math.PI / 2);
  const exitRingMat = new THREE.MeshBasicMaterial({
    color: 0x80ffdb,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.62,
  });

  const beaconGeo = new THREE.OctahedronGeometry(0.22, 0);
  beaconGeo.scale(0.85, 1.35, 0.85);
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xffe066,
    roughness: 0.2,
    metalness: 0.85,
    emissive: 0xff9f1c,
    emissiveIntensity: 0.75,
  });

  // Hearth Fire Flame Cone
  const hearthFlameGeo = new THREE.ConeGeometry(0.32, 0.68, 7);
  hearthFlameGeo.translate(0, 0.34, 0);
  const hearthFlameMat = new THREE.MeshBasicMaterial({
    color: 0xff9f1c,
    transparent: true,
    opacity: 0.9,
  });

  // Ornate Stone & Brass Pedestal for the Interior Collectible Artefact
  const pedBase = new THREE.CylinderGeometry(0.42, 0.52, 0.16, 12);
  pedBase.translate(0, 0.08, 0);
  const pedCol = new THREE.CylinderGeometry(0.28, 0.34, 0.42, 10);
  pedCol.translate(0, 0.37, 0);
  const pedTop = new THREE.CylinderGeometry(0.46, 0.36, 0.12, 12);
  pedTop.translate(0, 0.64, 0);
  const pedestalGeo = mergeGeometries([pedBase, pedCol, pedTop], false);
  pedBase.dispose();
  pedCol.dispose();
  pedTop.dispose();
  const pedestalMat = new THREE.MeshStandardMaterial({
    color: 0x4a4e54,
    roughness: 0.65,
    metalness: 0.35,
  });

  const artefactRingGeo = new THREE.RingGeometry(0.62, 0.86, 24);
  artefactRingGeo.rotateX(-Math.PI / 2);
  const artefactRingMat = new THREE.MeshBasicMaterial({
    color: 0xffdf4f,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.72,
  });

  const artefactGoldMat = new THREE.MeshStandardMaterial({
    color: 0xffd147,
    roughness: 0.22,
    metalness: 0.9,
    emissive: 0x5c3d00,
    emissiveIntensity: 0.55,
  });

  const artefactGemMats = ARTEFACT_CATALOG.map(
    (def) =>
      new THREE.MeshStandardMaterial({
        color: def.accentColor,
        roughness: 0.15,
        metalness: 0.75,
        emissive: def.accentColor,
        emissiveIntensity: 0.85,
      })
  );

  // Build 6 distinct 3D Dwarven Artefact geometries (each split into Gold body + Glowing Gem/Rune core)
  const artefactGoldGeos: THREE.BufferGeometry[] = [];
  const artefactGemGeos: THREE.BufferGeometry[] = [];

  // 0. Crown of Durin's Peak
  {
    const band = new THREE.CylinderGeometry(0.28, 0.25, 0.18, 12, 1, true);
    const rim = new THREE.TorusGeometry(0.26, 0.04, 8, 16);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, -0.08, 0);
    const spikes: THREE.BufferGeometry[] = [band, rim];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sp = new THREE.ConeGeometry(0.065, 0.2, 4);
      sp.translate(Math.cos(a) * 0.26, 0.16, Math.sin(a) * 0.26);
      spikes.push(sp);
    }
    artefactGoldGeos.push(mergeGeometries(spikes, false));
    for (const g of spikes) g.dispose();

    const centralGem = new THREE.OctahedronGeometry(0.14, 0);
    centralGem.translate(0, 0.08, 0);
    artefactGemGeos.push(centralGem);
  }

  // 1. Runesmith's Astral Hammer
  {
    const handle = new THREE.CylinderGeometry(0.038, 0.045, 0.62, 8);
    const pommel = new THREE.SphereGeometry(0.07, 8, 8);
    pommel.translate(0, -0.31, 0);
    const collar = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8);
    collar.translate(0, 0.22, 0);
    artefactGoldGeos.push(mergeGeometries([handle, pommel, collar], false));
    handle.dispose();
    pommel.dispose();
    collar.dispose();

    const head = new THREE.BoxGeometry(0.46, 0.22, 0.22);
    head.translate(0, 0.24, 0);
    artefactGemGeos.push(head);
  }

  // 2. Chalice of the Mountain King
  {
    const foot = new THREE.CylinderGeometry(0.18, 0.22, 0.06, 12);
    foot.translate(0, -0.24, 0);
    const stem = new THREE.CylinderGeometry(0.05, 0.07, 0.24, 10);
    stem.translate(0, -0.1, 0);
    const cup = new THREE.CylinderGeometry(0.24, 0.12, 0.28, 12);
    cup.translate(0, 0.14, 0);
    artefactGoldGeos.push(mergeGeometries([foot, stem, cup], false));
    foot.dispose();
    stem.dispose();
    cup.dispose();

    const liquid = new THREE.SphereGeometry(0.19, 12, 8);
    liquid.scale(1, 0.45, 1);
    liquid.translate(0, 0.26, 0);
    artefactGemGeos.push(liquid);
  }

  // 3. Heartstone of the Deep
  {
    const ring1 = new THREE.TorusGeometry(0.3, 0.028, 8, 20);
    const ring2 = new THREE.TorusGeometry(0.3, 0.028, 8, 20);
    ring2.rotateY(Math.PI / 2);
    artefactGoldGeos.push(mergeGeometries([ring1, ring2], false));
    ring1.dispose();
    ring2.dispose();

    const crystal = new THREE.OctahedronGeometry(0.22, 1);
    crystal.scale(0.85, 1.25, 0.85);
    artefactGemGeos.push(crystal);
  }

  // 4. Ancient Runic Tablet
  {
    const frame = new THREE.BoxGeometry(0.44, 0.56, 0.09);
    artefactGoldGeos.push(frame);

    const slab = new THREE.BoxGeometry(0.34, 0.46, 0.12);
    artefactGemGeos.push(slab);
  }

  // 5. Aegis of the Iron Hills
  {
    const shieldRim = new THREE.CylinderGeometry(0.32, 0.32, 0.06, 12);
    shieldRim.rotateX(Math.PI / 2);
    artefactGoldGeos.push(shieldRim);

    const boss = new THREE.OctahedronGeometry(0.16, 0);
    boss.scale(1.1, 1.1, 0.65);
    artefactGemGeos.push(boss);
  }

  sharedHutAssets = {
    fallbackInteriorGeo,
    fallbackInteriorMat,
    plinthGeo,
    plinthMat,
    doorRingGeo,
    doorRingMat,
    exitRingGeo,
    exitRingMat,
    beaconGeo,
    beaconMat,
    hearthFlameGeo,
    hearthFlameMat,
    pedestalGeo,
    pedestalMat,
    artefactRingGeo,
    artefactRingMat,
    artefactGoldMat,
    artefactGemMats,
    artefactGoldGeos,
    artefactGemGeos,
  };
  return sharedHutAssets;
}

function formatCompassDir(dx: number, dz: number): string {
  const angle = Math.atan2(dx, -dz);
  const octant = Math.round((angle * 4) / Math.PI + 8) % 8;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[octant];
}

export class HutManager {
  public readonly group = new THREE.Group();
  public artefactsCollected = 0;
  public onArtefactCollected?: () => void;

  private doorwayMarkers = new Map<string, DoorwayMarker>();
  private activeHut: HutPlacement | null = null;
  private nearestHut: HutPlacement | null = null;
  private nearestHutDist = Infinity;
  private nearestDoorDist = Infinity;
  private exitCooldown = 0;
  private steppedInsideRoom = false;

  // Interior Stage & Collectible Artefact State
  private interiorGroup = new THREE.Group();
  private interiorMesh!: THREE.Mesh;
  private hearthLight!: THREE.PointLight;
  private candleLight!: THREE.PointLight;
  private hearthFlameMesh!: THREE.Mesh;
  private exitRingMesh!: THREE.Mesh;
  private artefactGroup = new THREE.Group();
  private artefactFloatingGroup = new THREE.Group();
  private artefactGoldMesh!: THREE.Mesh;
  private artefactGemMesh!: THREE.Mesh;
  private artefactRingMesh!: THREE.Mesh;
  private currentArtefactDef: ArtefactDefinition = ARTEFACT_CATALOG[0];
  private artefactCollectedInVisit = false;
  private interiorFloorY = 0;
  private lastHearthWarmthTime = -999;
  private nextArtefactCursor = 0;
  private collectedArtefactIds = new Set<string>();
  private cachedCollectedArtefactIds: string[] = [];
  private collectedArtefactIdsDirty = true;

  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;
  private lastActiveChunkCount = -1;

  private bannerEl: HTMLElement | null;
  private artefactsCountEl: HTMLElement | null;
  private toastContainer: HTMLElement | null;
  private lastBannerHtml = '';
  private lastBannerVisible = false;
  private onEnterHutCallback?: () => void;
  private onExitHutCallback?: () => void;
  private onWarmHearthCallback?: () => void;
  private isChallengeActiveFn: () => boolean = () => false;

  private readonly interiorBgColor = new THREE.Color(0x23262e);
  private savedBgColor: THREE.Color | THREE.Texture | null = null;
  private savedFogDensity = 0.0025;

  constructor(
    private config: WorldConfig,
    private scene: THREE.Scene,
    private fog: THREE.FogExp2,
    private chunkManager: ChunkManager,
    private dwarf: DwarfCharacter,
    private exteriorGroups: THREE.Object3D[],
    private onSetPlayerPose: (
      x: number,
      z: number,
      heading: number,
      yaw: number,
      pitch: number,
      distance: number
    ) => void,
    private onGrantArtefactReward: (gold: number, message: string) => void
  ) {
    this.group.matrixAutoUpdate = false;
    this.bannerEl = document.getElementById('hut-banner');
    this.artefactsCountEl = document.getElementById('artefacts-value');
    this.toastContainer = document.getElementById('pickup-toasts');

    this.buildInteriorStage();
    this.syncArtefactHUD();

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyE') {
        this.handleInteractKey();
      } else if (e.code === 'Escape' && this.activeHut) {
        this.exitCurrentHut();
      }
    });

    this.bannerEl?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.hut-action-pill')) {
        if (this.activeHut) {
          this.exitCurrentHut();
        } else if (this.nearestHut && (this.nearestHutDist <= 7.0 || this.nearestDoorDist <= 4.5)) {
          this.enterHut(this.nearestHut);
        }
      }
    });

    document.getElementById('house-shop-exit-btn')?.addEventListener('click', () => {
      if (this.activeHut) {
        this.exitCurrentHut();
      }
    });
  }

  public setOnEnterHutCallback(cb: () => void): void {
    this.onEnterHutCallback = cb;
  }

  public setOnExitHutCallback(cb: () => void): void {
    this.onExitHutCallback = cb;
  }

  public setOnWarmHearthCallback(cb: () => void): void {
    this.onWarmHearthCallback = cb;
  }

  public setIsChallengeActiveFn(fn: () => boolean): void {
    this.isChallengeActiveFn = fn;
  }

  public isInsideHut(): boolean {
    return this.activeHut !== null;
  }

  public getActiveHut(): HutPlacement | null {
    return this.activeHut;
  }

  public getOutdoorSavePose(): {
    x: number;
    y: number;
    z: number;
    heading: number;
    yaw: number;
    pitch: number;
    distance: number;
  } | null {
    const hut = this.activeHut;
    if (!hut) return null;
    const outDist = 2.85 * hut.scale;
    return {
      x: hut.worldX + Math.sin(hut.rotationY) * outDist,
      y: hut.worldY,
      z: hut.worldZ + Math.cos(hut.rotationY) * outDist,
      heading: hut.rotationY,
      yaw: hut.rotationY + Math.PI,
      pitch: 0.46,
      distance: 11.5,
    };
  }

  public getCollectedArtefactCount(): number {
    return this.collectedArtefactIds.size;
  }

  public getInteriorFloorHeight(fallbackY: number): number {
    return this.activeHut ? this.interiorFloorY : fallbackY;
  }

  public hasArtefact(id: string): boolean {
    return this.collectedArtefactIds.has(id);
  }

  public getCollectedArtefactIds(): string[] {
    if (this.collectedArtefactIdsDirty) {
      this.cachedCollectedArtefactIds = Array.from(this.collectedArtefactIds);
      this.collectedArtefactIdsDirty = false;
    }
    return this.cachedCollectedArtefactIds;
  }

  public restoreProgress(
    artefactsCollected: number | undefined,
    collectedArtefactIds?: string[]
  ): void {
    this.artefactsCollected =
      typeof artefactsCollected === 'number' && artefactsCollected >= 0
        ? Math.floor(artefactsCollected)
        : 0;
    this.collectedArtefactIds.clear();
    this.collectedArtefactIdsDirty = true;
    if (Array.isArray(collectedArtefactIds) && collectedArtefactIds.length > 0) {
      for (const id of collectedArtefactIds) {
        if (typeof id === 'string') {
          this.collectedArtefactIds.add(id);
        }
      }
    } else if (this.artefactsCollected > 0) {
      // Backfill unique artefact IDs for saves from before individual ID tracking
      for (let i = 0; i < Math.min(ARTEFACT_CATALOG.length, this.artefactsCollected); i++) {
        this.collectedArtefactIds.add(ARTEFACT_CATALOG[i].id);
      }
    }
    this.nextArtefactCursor = this.artefactsCollected;
    this.syncArtefactHUD();
  }

  public reset(): void {
    if (this.activeHut) {
      this.exitCurrentHut(true);
    }
    this.artefactsCollected = 0;
    this.collectedArtefactIds.clear();
    this.collectedArtefactIdsDirty = true;
    this.nextArtefactCursor = 0;
    this.syncArtefactHUD();
    this.rebuildAll();
  }

  public rebuildAll(): void {
    for (const marker of this.doorwayMarkers.values()) {
      this.group.remove(marker.root);
    }
    this.doorwayMarkers.clear();
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
    this.lastActiveChunkCount = -1;
  }

  private buildInteriorStage(): void {
    const assets = getSharedHutAssets();
    this.interiorGroup.visible = false;
    this.interiorGroup.matrixAutoUpdate = false;

    const useHighPoly = Boolean(sharedHutInteriorGeo && sharedHutInteriorMat);
    this.interiorMesh = new THREE.Mesh(
      useHighPoly ? sharedHutInteriorGeo! : assets.fallbackInteriorGeo,
      useHighPoly ? sharedHutInteriorMat! : assets.fallbackInteriorMat
    );
    this.interiorMesh.castShadow = true;
    this.interiorMesh.receiveShadow = true;
    this.interiorMesh.matrixAutoUpdate = false;
    activeInteriorMeshes.add(this.interiorMesh);
    this.interiorGroup.add(this.interiorMesh);

    const plinthMesh = new THREE.Mesh(assets.plinthGeo, assets.plinthMat);
    plinthMesh.receiveShadow = true;
    plinthMesh.matrixAutoUpdate = false;
    this.interiorGroup.add(plinthMesh);

    // Warm flickering Hearth Light & Flame inside the stone fireplace (-1.55, 0.55, +0.85)
    this.hearthLight = new THREE.PointLight(0xff8c2b, 3.8, 12.0, 1.5);
    this.hearthLight.position.set(-1.35, 0.95, 0.85);
    this.hearthLight.updateMatrix();
    this.hearthLight.matrixAutoUpdate = false;
    this.interiorGroup.add(this.hearthLight);

    this.hearthFlameMesh = new THREE.Mesh(assets.hearthFlameGeo, assets.hearthFlameMat);
    this.hearthFlameMesh.position.set(-1.55, 0.22, 0.85);
    this.hearthFlameMesh.updateMatrix();
    this.hearthFlameMesh.matrixAutoUpdate = false;
    this.interiorGroup.add(this.hearthFlameMesh);

    // Soft Table Candle Light (+1.55, 1.25, +0.75)
    this.candleLight = new THREE.PointLight(0xffd166, 1.6, 8.5, 1.6);
    this.candleLight.position.set(1.45, 1.35, 0.75);
    this.candleLight.updateMatrix();
    this.candleLight.matrixAutoUpdate = false;
    this.interiorGroup.add(this.candleLight);

    // Front Wooden Doorstep Exit Ring (-0.35, 0.04, +2.42)
    this.exitRingMesh = new THREE.Mesh(assets.exitRingGeo, assets.exitRingMat);
    this.exitRingMesh.position.set(-0.35, 0.04, 2.42);
    this.exitRingMesh.updateMatrix();
    this.exitRingMesh.matrixAutoUpdate = false;
    this.interiorGroup.add(this.exitRingMesh);

    // Collectible Dwarven Artefact Pedestal in the back-right alcove (+0.95, 0.0, -0.85)
    this.artefactGroup.position.set(0.95, 0.0, -0.85);
    this.artefactGroup.updateMatrix();
    this.artefactGroup.matrixAutoUpdate = false;

    const pedestalMesh = new THREE.Mesh(assets.pedestalGeo, assets.pedestalMat);
    pedestalMesh.castShadow = true;
    pedestalMesh.receiveShadow = true;
    pedestalMesh.matrixAutoUpdate = false;
    this.artefactGroup.add(pedestalMesh);

    this.artefactRingMesh = new THREE.Mesh(assets.artefactRingGeo, assets.artefactRingMat);
    this.artefactRingMesh.position.set(0, 0.05, 0);
    this.artefactRingMesh.updateMatrix();
    this.artefactRingMesh.matrixAutoUpdate = false;
    this.artefactGroup.add(this.artefactRingMesh);

    this.artefactFloatingGroup.position.set(0, 1.12, 0);
    this.artefactFloatingGroup.updateMatrix();
    this.artefactFloatingGroup.matrixAutoUpdate = false;

    this.artefactGoldMesh = new THREE.Mesh(assets.artefactGoldGeos[0], assets.artefactGoldMat);
    this.artefactGoldMesh.castShadow = true;
    this.artefactGoldMesh.matrixAutoUpdate = false;
    this.artefactFloatingGroup.add(this.artefactGoldMesh);

    this.artefactGemMesh = new THREE.Mesh(assets.artefactGemGeos[0], assets.artefactGemMats[0]);
    this.artefactGemMesh.castShadow = true;
    this.artefactGemMesh.matrixAutoUpdate = false;
    this.artefactFloatingGroup.add(this.artefactGemMesh);

    this.artefactGroup.add(this.artefactFloatingGroup);
    this.interiorGroup.add(this.artefactGroup);

    this.group.add(this.interiorGroup);
  }

  private handleInteractKey(): void {
    if (this.activeHut) {
      // If standing right beside the uncollected artefact inside the hut, collect it first; otherwise exit
      if (!this.artefactCollectedInVisit) {
        const ax = this.activeHut.worldX + 0.95;
        const az = this.activeHut.worldZ - 0.85;
        const dx = this.dwarf.root.position.x - ax;
        const dz = this.dwarf.root.position.z - az;
        if (dx * dx + dz * dz <= 2.2 * 2.2) {
          this.collectCurrentArtefact();
          return;
        }
      }
      this.exitCurrentHut();
      return;
    }

    if (this.nearestHut && (this.nearestHutDist <= 7.0 || this.nearestDoorDist <= 4.5)) {
      this.enterHut(this.nearestHut);
    } else if (this.nearestHut && this.nearestHutDist <= 14.0) {
      const dx = this.nearestHut.worldX - this.dwarf.root.position.x;
      const dz = this.nearestHut.worldZ - this.dwarf.root.position.z;
      const dir = formatCompassDir(dx, dz);
      this.showToast(
        `🏠 Nearest Dwarven Hut: ${this.nearestHutDist.toFixed(0)}m ${dir} — Walk to its door to enter & buy Equipment!`,
        false
      );
    }
  }

  public enterHut(hut: HutPlacement): void {
    if (this.activeHut) return;
    loadDwarvenHutInteriorModel();
    this.onEnterHutCallback?.();

    this.activeHut = hut;
    this.steppedInsideRoom = false;
    this.artefactCollectedInVisit = false;
    this.interiorFloorY = hut.worldY + 0.25;

    // Select the next Dwarven Artefact to spawn inside the hut (prioritize uncollected sacred artefacts first!)
    const assets = getSharedHutAssets();
    let artIdx =
      Math.abs(hut.cx * 5 + hut.cz * 11 + this.nextArtefactCursor) % ARTEFACT_CATALOG.length;
    for (let step = 0; step < ARTEFACT_CATALOG.length; step++) {
      const candidateIdx = (artIdx + step) % ARTEFACT_CATALOG.length;
      if (!this.collectedArtefactIds.has(ARTEFACT_CATALOG[candidateIdx].id)) {
        artIdx = candidateIdx;
        break;
      }
    }
    this.nextArtefactCursor++;
    this.currentArtefactDef = ARTEFACT_CATALOG[artIdx];
    this.artefactGoldMesh.geometry = assets.artefactGoldGeos[artIdx];
    this.artefactGemMesh.geometry = assets.artefactGemGeos[artIdx];
    this.artefactGemMesh.material = assets.artefactGemMats[artIdx];
    this.artefactFloatingGroup.visible = true;
    this.artefactRingMesh.visible = true;

    // Position the interior stage at the hut's coordinates
    this.interiorGroup.position.set(hut.worldX, this.interiorFloorY, hut.worldZ);
    this.interiorGroup.rotation.set(0, 0, 0);
    this.interiorGroup.visible = true;
    this.interiorGroup.updateMatrix();
    this.interiorGroup.updateMatrixWorld(true);

    // Hide exterior world groups and doorway markers so zero grass blades or trees clip through the hut floor
    for (const grp of this.exteriorGroups) {
      grp.visible = false;
    }
    for (const marker of this.doorwayMarkers.values()) {
      marker.root.visible = false;
    }

    this.savedBgColor = this.scene.background;
    this.savedFogDensity = this.fog.density;
    this.scene.background = this.interiorBgColor;
    this.fog.density = 0.0004;

    // Place the dwarf just inside the front doorway looking into the cozy room, with isometric cutaway camera
    const entryWorldX = hut.worldX - 0.35;
    const entryWorldZ = hut.worldZ + 1.82;
    this.onSetPlayerPose(entryWorldX, entryWorldZ, Math.PI, 0.68, 0.48, 9.2);
    this.dwarf.spawnBurst(entryWorldX, this.interiorFloorY, entryWorldZ, 10);
    this.playDoorSound(true);
    this.showToast(
      `🏠 Entered Dwarven Hut! Collect the ${this.currentArtefactDef.icon} ${this.currentArtefactDef.name}!`,
      false
    );
  }

  public exitCurrentHut(silent = false): void {
    const hut = this.activeHut;
    if (!hut) return;
    this.activeHut = null;
    this.exitCooldown = 1.65;
    this.interiorGroup.visible = false;

    for (const grp of this.exteriorGroups) {
      grp.visible = true;
    }
    for (const marker of this.doorwayMarkers.values()) {
      marker.root.visible = true;
    }
    if (this.savedBgColor !== null) {
      this.scene.background = this.savedBgColor;
    }
    this.fog.density = this.savedFogDensity;

    if (!silent) {
      const outDist = 2.85 * hut.scale;
      const outX = hut.worldX + Math.sin(hut.rotationY) * outDist;
      const outZ = hut.worldZ + Math.cos(hut.rotationY) * outDist;
      const outYaw = hut.rotationY + Math.PI;
      this.onSetPlayerPose(outX, outZ, hut.rotationY, outYaw, 0.46, 11.5);
      this.dwarf.spawnBurst(outX, hut.worldY, outZ, 10);
      this.playDoorSound(false);
    }
    this.onExitHutCallback?.();
  }

  private collectCurrentArtefact(): void {
    if (!this.activeHut || this.artefactCollectedInVisit) return;
    this.artefactCollectedInVisit = true;
    this.artefactsCollected += 1;
    const def = this.currentArtefactDef;
    this.collectedArtefactIds.add(def.id);
    this.collectedArtefactIdsDirty = true;
    this.artefactFloatingGroup.visible = false;
    this.artefactRingMesh.visible = false;
    this.syncArtefactHUD();

    const ax = this.activeHut.worldX + 0.95;
    const ay = this.interiorFloorY + 0.85;
    const az = this.activeHut.worldZ - 0.85;
    this.dwarf.spawnBurst(ax, ay, az, 18);
    this.playArtefactFanfare();

    this.onGrantArtefactReward(
      def.gold,
      `${def.icon} Attuned ${def.name}! (+${def.gold}🪙 | Blessing: ${def.blessingSummary})`
    );
    this.onArtefactCollected?.();
  }

  /**
   * Resolves 2D collisions between the dwarf and the interior walls & furniture of the hut
   * in O(1) time with zero heap allocations.
   */
  public resolveInteriorCollision(pos: THREE.Vector3, playerRadius = 0.35): void {
    const hut = this.activeHut;
    if (!hut) return;

    let lx = pos.x - hut.worldX;
    let lz = pos.z - hut.worldZ;

    // 1. Clamp to interior room floor bounds (allowing front doorstep at z up to +2.55)
    const minX = -2.18 + playerRadius;
    const maxX = 2.45 - playerRadius;
    const minZ = -2.28 + playerRadius;
    const maxZ = 2.52;
    if (lx < minX) lx = minX;
    if (lx > maxX) lx = maxX;
    if (lz < minZ) lz = minZ;
    if (lz > maxZ) lz = maxZ;

    // 2. Circle-circle collisions with interior furniture (bed, fireplace, table, chests, barrels)
    for (let i = 0; i < HUT_INTERIOR_COLLIDERS.length; i += 3) {
      const ox = HUT_INTERIOR_COLLIDERS[i];
      const oz = HUT_INTERIOR_COLLIDERS[i + 1];
      const minDist = HUT_INTERIOR_COLLIDERS[i + 2] + playerRadius;

      const dx = lx - ox;
      const dz = lz - oz;
      const dSq = dx * dx + dz * dz;
      if (dSq < minDist * minDist) {
        const dist = Math.sqrt(dSq);
        if (dist > 0.0001) {
          const push = (minDist - dist) / dist;
          lx += dx * push;
          lz += dz * push;
        } else {
          lx += minDist;
        }
      }
    }

    // Re-clamp outer room walls after furniture pushout
    if (lx < minX) lx = minX;
    if (lx > maxX) lx = maxX;
    if (lz < minZ) lz = minZ;
    if (lz > maxZ) lz = maxZ;

    pos.x = hut.worldX + lx;
    pos.z = hut.worldZ + lz;
  }

  private syncDoorwayMarkers(centerCx: number, centerCz: number): void {
    const activeCount = this.chunkManager.getActiveChunkCount();
    if (
      centerCx === this.lastCenterCx &&
      centerCz === this.lastCenterCz &&
      activeCount === this.lastActiveChunkCount
    ) {
      return;
    }
    this.lastCenterCx = centerCx;
    this.lastCenterCz = centerCz;
    this.lastActiveChunkCount = activeCount;

    const seenIds = new Set<string>();
    const assets = getSharedHutAssets();

    this.chunkManager.forEachLoadedHut((hut) => {
      seenIds.add(hut.id);
      if (this.doorwayMarkers.has(hut.id)) return;

      const doorY = this.chunkManager.getSurfaceHeight(hut.doorWorldX, hut.doorWorldZ);
      const root = new THREE.Group();
      root.position.set(hut.doorWorldX, doorY, hut.doorWorldZ);
      root.visible = !this.activeHut;
      root.updateMatrix();
      root.matrixAutoUpdate = false;

      const ringMesh = new THREE.Mesh(assets.doorRingGeo, assets.doorRingMat);
      ringMesh.position.y = 0.1;
      ringMesh.updateMatrix();
      ringMesh.matrixAutoUpdate = false;
      root.add(ringMesh);

      const beaconMesh = new THREE.Mesh(assets.beaconGeo, assets.beaconMat);
      beaconMesh.position.y = 1.25;
      beaconMesh.updateMatrix();
      beaconMesh.matrixAutoUpdate = false;
      root.add(beaconMesh);

      this.group.add(root);
      root.updateMatrixWorld(true);

      this.doorwayMarkers.set(hut.id, {
        hut,
        root,
        ringMesh,
        beaconMesh,
      });
    });

    for (const [id, marker] of this.doorwayMarkers.entries()) {
      if (!seenIds.has(id)) {
        this.group.remove(marker.root);
        this.doorwayMarkers.delete(id);
      }
    }
  }

  public update(dt: number, elapsedTime: number, playerPos: THREE.Vector3): void {
    if (this.exitCooldown > 0) {
      this.exitCooldown = Math.max(0, this.exitCooldown - dt);
    }

    if (this.activeHut) {
      this.updateInterior(elapsedTime, playerPos);
      return;
    }

    const size = this.config.chunkSize;
    const centerCx = Math.round(playerPos.x / size);
    const centerCz = Math.round(playerPos.z / size);
    this.syncDoorwayMarkers(centerCx, centerCz);

    let bestHut: HutPlacement | null = null;
    let bestHutDistSq = Infinity;
    let bestDoorDistSq = Infinity;

    for (const marker of this.doorwayMarkers.values()) {
      const h = marker.hut;
      const hdx = playerPos.x - h.worldX;
      const hdz = playerPos.z - h.worldZ;
      const hdSq = hdx * hdx + hdz * hdz;

      const ddx = playerPos.x - h.doorWorldX;
      const ddz = playerPos.z - h.doorWorldZ;
      const ddSq = ddx * ddx + ddz * ddz;

      if (hdSq < bestHutDistSq) {
        bestHutDistSq = hdSq;
        bestDoorDistSq = ddSq;
        bestHut = h;
      }

      // Distance-gate doorway marker animation to 45m
      if (ddSq < 45 * 45) {
        const pulse = 1.0 + Math.sin(elapsedTime * 3.8 + h.worldX) * 0.1;
        marker.ringMesh.scale.setScalar(pulse);
        marker.ringMesh.updateMatrix();
        marker.ringMesh.matrixWorld.multiplyMatrices(
          marker.root.matrixWorld,
          marker.ringMesh.matrix
        );

        marker.beaconMesh.rotation.y = elapsedTime * 2.2 + h.worldZ;
        marker.beaconMesh.position.y = 1.25 + Math.sin(elapsedTime * 3.2 + h.worldX) * 0.12;
        marker.beaconMesh.updateMatrix();
        marker.beaconMesh.matrixWorld.multiplyMatrices(
          marker.root.matrixWorld,
          marker.beaconMesh.matrix
        );
      }
    }

    this.nearestHut = bestHut;
    this.nearestHutDist = bestHut ? Math.sqrt(bestHutDistSq) : Infinity;
    this.nearestDoorDist = bestHut ? Math.sqrt(bestDoorDistSq) : Infinity;

    if (this.nearestHutDist <= 28.0) {
      loadDwarvenHutInteriorModel();
    }

    // Automatically enter the hut if the dwarf walks onto the glowing front doorway ring
    // (unless a timed Hillside Ring Sprint Challenge is actively running!)
    if (
      bestHut &&
      this.exitCooldown <= 0 &&
      this.nearestDoorDist <= 1.48 &&
      !this.isChallengeActiveFn()
    ) {
      this.enterHut(bestHut);
      return;
    }

    // Show exterior proximity banner when near a Dwarven Hut
    if (bestHut && (this.nearestHutDist <= 6.8 || this.nearestDoorDist <= 4.2)) {
      this.setBanner(
        true,
        `<span>🏠 <strong>Dwarven Hut</strong> • <span class="hut-tag">✨ Artefact Inside</span> Walk to the Doorstep or Press <kbd>E</kbd></span>` +
          `<button type="button" class="hut-action-pill">🚪 Enter Hut (E)</button>`
      );
    } else {
      this.setBanner(false, '');
    }
  }

  private updateInterior(elapsedTime: number, playerPos: THREE.Vector3): void {
    const hut = this.activeHut;
    if (!hut) return;

    // 1. Animate warm fireplace flicker & hearth flame
    const flicker = 1.0 + Math.sin(elapsedTime * 9.5) * 0.14 + Math.cos(elapsedTime * 15.0) * 0.08;
    this.hearthLight.intensity = 3.6 * flicker;
    this.hearthFlameMesh.scale.set(1.0, flicker, 1.0);
    this.hearthFlameMesh.rotation.y = elapsedTime * 2.4;
    this.hearthFlameMesh.updateMatrix();
    this.hearthFlameMesh.matrixWorld.multiplyMatrices(
      this.interiorGroup.matrixWorld,
      this.hearthFlameMesh.matrix
    );

    // 2. Pulse exit doorstep ring
    const exitPulse = 1.0 + Math.sin(elapsedTime * 4.2) * 0.09;
    this.exitRingMesh.scale.setScalar(exitPulse);
    this.exitRingMesh.updateMatrix();
    this.exitRingMesh.matrixWorld.multiplyMatrices(
      this.interiorGroup.matrixWorld,
      this.exitRingMesh.matrix
    );

    // 3. Animate floating 3D Dwarven Artefact if not yet collected in this visit
    const lx = playerPos.x - hut.worldX;
    const lz = playerPos.z - hut.worldZ;

    if (!this.artefactCollectedInVisit) {
      this.artefactFloatingGroup.rotation.y = elapsedTime * 1.85;
      this.artefactFloatingGroup.position.y = 1.12 + Math.sin(elapsedTime * 3.2) * 0.09;
      this.artefactFloatingGroup.updateMatrix();
      this.artefactFloatingGroup.updateMatrixWorld(true);

      const artPulse = 1.0 + Math.sin(elapsedTime * 4.5) * 0.12;
      this.artefactRingMesh.scale.setScalar(artPulse);
      this.artefactRingMesh.updateMatrix();
      this.artefactRingMesh.matrixWorld.multiplyMatrices(
        this.artefactGroup.matrixWorld,
        this.artefactRingMesh.matrix
      );

      // Check proximity to pedestal at local (+0.95, -0.85)
      const adx = lx - 0.95;
      const adz = lz - -0.85;
      if (adx * adx + adz * adz <= 1.45 * 1.45) {
        this.collectCurrentArtefact();
      }
    }

    // 4. Warmth blessing when standing beside the roaring fireplace (-1.35, +0.85)
    const fdx = lx - -1.25;
    const fdz = lz - 0.85;
    if (fdx * fdx + fdz * fdz <= 1.65 * 1.65 && elapsedTime - this.lastHearthWarmthTime > 15.0) {
      this.lastHearthWarmthTime = elapsedTime;
      this.onWarmHearthCallback?.();
    }

    // 5. Track when the dwarf steps deeper into the room so walking back onto the doorstep exits cleanly
    if (lz < 1.35) {
      this.steppedInsideRoom = true;
    }
    if (
      (this.steppedInsideRoom || this.artefactCollectedInVisit) &&
      lz >= 2.28 &&
      lx >= -1.15 &&
      lx <= 0.45
    ) {
      this.exitCurrentHut();
      return;
    }

    // 6. Update HUD banner while inside the hut (only show when artefact is still on pedestal; shop on right handles exit)
    const def = this.currentArtefactDef;
    if (!this.artefactCollectedInVisit) {
      this.setBanner(
        true,
        `<span>🏠 <strong>Dwarven House</strong> • Walk to pedestal to attune <span class="hut-tag">${def.icon} ${def.name} (+${def.gold}g)</span></span>`
      );
    } else {
      this.setBanner(false, '');
    }
  }

  public getNearestHutHint(playerPos: THREE.Vector3): string | null {
    if (this.activeHut) {
      return this.artefactCollectedInVisit
        ? '🏠 Inside Dwarven House'
        : `✨ Collect ${this.currentArtefactDef.name}!`;
    }
    if (!this.nearestHut || !Number.isFinite(this.nearestHutDist)) return null;
    const dx = this.nearestHut.worldX - playerPos.x;
    const dz = this.nearestHut.worldZ - playerPos.z;
    const dir = formatCompassDir(dx, dz);
    return `🏠 Hut: ${this.nearestHutDist.toFixed(0)}m ${dir}`;
  }

  private syncArtefactHUD(): void {
    if (this.artefactsCountEl) {
      this.artefactsCountEl.classList.toggle('hidden', this.artefactsCollected === 0);
      this.artefactsCountEl.textContent = `• ✨ ${this.artefactsCollected} ${
        this.artefactsCollected === 1 ? 'Artefact' : 'Artefacts'
      }`;
    }
  }

  private setBanner(visible: boolean, html: string): void {
    if (!this.bannerEl) return;
    if (visible !== this.lastBannerVisible) {
      this.lastBannerVisible = visible;
      this.bannerEl.classList.toggle('hidden', !visible);
    }
    if (visible && html !== this.lastBannerHtml) {
      this.lastBannerHtml = html;
      this.bannerEl.innerHTML = html;
    }
  }

  private showToast(text: string, isRare: boolean): void {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `pickup-toast ${isRare ? 'rare' : ''}`;
    toast.textContent = text;
    this.toastContainer.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 2500);
  }

  private playDoorSound(entering: boolean): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = entering ? [220, 330] : [330, 220];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.001, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.24);
    });
  }

  private playArtefactFanfare(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [392.0, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.075);
      gain.gain.setValueAtTime(0.001, now + idx * 0.075);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.075 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.075 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.075);
      osc.stop(now + idx * 0.075 + 0.48);
    });
  }
}
