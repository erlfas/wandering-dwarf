import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import borderKeepInteriorUrl from '../../3dmodels/border keep interior.glb?url';
import grandCitadelInteriorUrl from '../../3dmodels/grand citadel interior 3d model.glb?url';
import strongholdInteriorUrl from '../../3dmodels/stonewall_stronghold_interior.glb?url';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { getSharedAudioContext } from '../player/RelicStore';
import { WorldConfig } from './Config';
import { createOptimizedGlbLoader } from './ForestField';

export type CastleInteriorTier = 1 | 2 | 3;

export interface ActiveCastleVisit {
  id: string;
  name: string;
  tier: CastleInteriorTier;
  worldX: number;
  worldY: number;
  worldZ: number;
  rotationY: number;
}

interface TierInteriorAsset {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
}

interface SharedCastleInteriorAssets {
  fallbackGeo: THREE.BufferGeometry;
  fallbackMat: THREE.MeshStandardMaterial;
  plinthGeo: THREE.BufferGeometry;
  plinthMat: THREE.MeshStandardMaterial;
  exitRingGeo: THREE.BufferGeometry;
  exitRingMat: THREE.MeshBasicMaterial;
  throneRingGeo: THREE.BufferGeometry;
  throneRingMat: THREE.MeshBasicMaterial;
  hearthFlameGeo: THREE.BufferGeometry;
  hearthFlameMat: THREE.MeshBasicMaterial;
}

let sharedInteriorAssets: SharedCastleInteriorAssets | null = null;
const tierGlbAssets: Partial<Record<CastleInteriorTier, TierInteriorAsset>> = {};
const tierLoadStarted: Partial<Record<CastleInteriorTier, boolean>> = {};
const tierLoadCallbacks: Record<CastleInteriorTier, Array<() => void>> = {
  1: [],
  2: [],
  3: [],
};

const TIER_INTERIOR_SPECS: Record<
  CastleInteriorTier,
  {
    url: string;
    targetHeight: number;
    floorRatioY: number;
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    exitLocal: { x: number; z: number };
    hearthLocal: { x: number; y: number; z: number };
    chandelierLocal: { x: number; y: number; z: number };
    daisLightLocal: { x: number; y: number; z: number };
    colliders: Float32Array;
  }
> = {
  // Tier I: Dwarven Border Keep Interior (`border keep interior.glb`, 21,028 tris)
  // Matches `art/border_keep_interior.jpg`: Drawbridge door on left (-X), hearth & spiral stair in back,
  // map table & stool in center-front, straw bed in front-right (+X, +Z).
  1: {
    url: borderKeepInteriorUrl,
    targetHeight: 5.6,
    floorRatioY: 0.085,
    bounds: { minX: -2.65, maxX: 2.75, minZ: -2.65, maxZ: 2.75 },
    exitLocal: { x: -1.35, z: 1.55 },
    hearthLocal: { x: 0.35, y: 0.85, z: -1.75 },
    chandelierLocal: { x: -0.4, y: 2.8, z: 0.2 },
    daisLightLocal: { x: 1.4, y: 2.2, z: -1.1 },
    colliders: new Float32Array([
      // Stone Hearth & Cauldron in back-center/right
      0.35, -1.95, 0.78,
      -0.45, -2.05, 0.55,
      // Spiral Stone Staircase in back-right corner
      1.85, -1.85, 0.88,
      2.15, -0.95, 0.68,
      // Wooden Map Table & Stool in front-center
      0.35, 0.85, 0.68,
      0.95, 1.35, 0.42,
      // Straw Bunk & Crate along right (+X) wall
      1.95, 0.45, 0.65,
      1.85, 1.25, 0.65,
      1.45, 1.85, 0.52,
      // Drawbridge Winch Drums & Supply Chest near left (-X) wall
      -2.05, 1.85, 0.55,
      -1.95, 0.95, 0.48,
      -1.85, -0.85, 0.48,
    ]),
  },
  // Tier II: Stonewall Stronghold Interior (`stonewall_stronghold_interior.glb`, 18,863 tris)
  // Matches `art/stonewall_stronghold_interior.jpg`: Grand hearth on left, two long banquet tables in center,
  // raised armory dais with Hammer & Anvil banners at back-right.
  2: {
    url: strongholdInteriorUrl,
    targetHeight: 6.6,
    floorRatioY: 0.082,
    bounds: { minX: -3.55, maxX: 3.65, minZ: -3.15, maxZ: 3.25 },
    exitLocal: { x: -1.35, z: 2.55 },
    hearthLocal: { x: -1.25, y: 0.95, z: -0.85 },
    chandelierLocal: { x: 0.0, y: 3.8, z: 0.0 },
    daisLightLocal: { x: 1.75, y: 2.6, z: -1.45 },
    colliders: new Float32Array([
      // Grand Stone Hearth & Cauldron along left-back wall
      -1.35, -1.25, 0.85,
      -2.25, -0.55, 0.65,
      // Left Banquet Table & Benches
      -0.85, 0.45, 0.68,
      -0.25, -0.15, 0.68,
      // Right Banquet Table & Benches
      1.05, 1.15, 0.68,
      1.65, 0.55, 0.68,
      // Raised Armory Rack & Pillars at back-right
      1.45, -1.95, 0.72,
      2.35, -1.35, 0.72,
      // Barrels & Chests in right corner
      2.95, 0.45, 0.58,
      2.65, 1.35, 0.58,
    ]),
  },
  // Tier III: Mountain King's Grand Citadel Interior (`grand citadel interior 3d model.glb`, 19,772 tris)
  // Matches `art/Mountain Kings Grand Citadel interior.jpg`: Vaulted royal throne room with the Mountain King's
  // Stone Throne on the raised dais at back-right, banquet tables, and grand hearth.
  3: {
    url: grandCitadelInteriorUrl,
    targetHeight: 6.9,
    floorRatioY: 0.082,
    bounds: { minX: -3.75, maxX: 3.85, minZ: -3.25, maxZ: 3.35 },
    exitLocal: { x: -1.4, z: 2.65 },
    hearthLocal: { x: -1.3, y: 1.0, z: -0.9 },
    chandelierLocal: { x: 0.0, y: 4.1, z: 0.0 },
    daisLightLocal: { x: 1.85, y: 2.8, z: -1.55 },
    colliders: new Float32Array([
      // Grand Citadel Hearth
      -1.35, -1.25, 0.88,
      -2.35, -0.55, 0.68,
      // Left Royal Banquet Table
      -0.9, 0.45, 0.68,
      -0.3, -0.15, 0.68,
      // Right Royal Banquet Table
      1.1, 1.15, 0.68,
      1.7, 0.55, 0.68,
      // Mountain King's Carved Stone Throne & Pillars on back-right dais
      1.65, -1.85, 0.78,
      2.45, -1.25, 0.72,
      // Royal Chests & Barrels in right corner
      3.05, 0.45, 0.6,
      2.75, 1.4, 0.6,
    ]),
  },
};

/**
 * Asynchronously loads and optimizes the `.glb` interior cutaway model for `tier` (`1 | 2 | 3`):
 * - Uses `createOptimizedGlbLoader()` to strip `KHR_materials_specular` and the 5.6–7.5 MB PNG
 *   secondary PBR maps (`normalTexture`, `metallicRoughnessTexture`, `occlusionTexture`) in `beforeRoot`
 *   before `ImageBitmap` decoding.
 * - Normalizes bounding box (center X/Z at 0, inner stone floor at Y=0) and scales to `targetHeight`.
 * - Guards `if (!geo.attributes.normal) geo.computeVertexNormals()` and welds split vertices.
 */
export function ensureCastleInteriorModelLoaded(
  tier: CastleInteriorTier,
  onLoaded?: () => void
): void {
  if (tierGlbAssets[tier]) {
    onLoaded?.();
    return;
  }
  if (onLoaded) {
    tierLoadCallbacks[tier].push(onLoaded);
  }
  if (tierLoadStarted[tier]) return;
  tierLoadStarted[tier] = true;

  const spec = TIER_INTERIOR_SPECS[tier];
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

      // 2. Normalize bounding box: center X/Z at 0, align stone floor to Y=0, scale to targetHeight
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const spanY = Math.max(0.01, box.max.y - box.min.y);
      const scaleFactor = spec.targetHeight / spanY;
      const innerFloorY = box.min.y + spanY * spec.floorRatioY;

      geo.translate(-centerX, -innerFloorY, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);

      // 3. Guard computeVertexNormals() — normals are already present in all 3 interior .glb models
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
        metalness: 0.05,
      });
      if (origMat.normalMap && origMat.normalMap !== origMat.map) origMat.normalMap.dispose();
      if (origMat.roughnessMap && origMat.roughnessMap !== origMat.map) origMat.roughnessMap.dispose();
      if (origMat.metalnessMap && origMat.metalnessMap !== origMat.map) origMat.metalnessMap.dispose();
      if (origMat.aoMap && origMat.aoMap !== origMat.map) origMat.aoMap.dispose();
      origMat.dispose();

      tierGlbAssets[tier] = { geo, mat };
      for (const cb of tierLoadCallbacks[tier]) {
        cb();
      }
      tierLoadCallbacks[tier].length = 0;
    },
    undefined,
    (err) => {
      console.error(`Failed to load Castle Tier ${tier} interior 3D model:`, err);
    }
  );
}

function getSharedCastleInteriorAssets(): SharedCastleInteriorAssets {
  if (sharedInteriorAssets) return sharedInteriorAssets;

  // Low-poly procedural cutaway stone hall fallback (< 100 tris) while GLB streams in
  const floorGeo = new THREE.BoxGeometry(7.2, 0.35, 7.2);
  floorGeo.translate(0, -0.18, 0);
  const backWallGeo = new THREE.BoxGeometry(7.2, 4.2, 0.4);
  backWallGeo.translate(0, 2.1, -3.4);
  const leftWallGeo = new THREE.BoxGeometry(0.4, 4.2, 7.2);
  leftWallGeo.translate(-3.4, 2.1, 0);
  const hearthGeo = new THREE.BoxGeometry(1.4, 4.8, 1.6);
  hearthGeo.translate(-1.2, 2.4, -1.2);
  const tableGeo = new THREE.BoxGeometry(1.2, 0.78, 2.4);
  tableGeo.translate(0.6, 0.39, 0.6);
  const fallbackGeo = mergeGeometries(
    [floorGeo, backWallGeo, leftWallGeo, hearthGeo, tableGeo],
    false
  );
  floorGeo.dispose();
  backWallGeo.dispose();
  leftWallGeo.dispose();
  hearthGeo.dispose();
  tableGeo.dispose();
  fallbackGeo.computeBoundingBox();
  fallbackGeo.computeBoundingSphere();

  const fallbackMat = new THREE.MeshStandardMaterial({
    color: 0x6c7078,
    roughness: 0.86,
    metalness: 0.06,
  });

  const plinthGeo = new THREE.CylinderGeometry(7.2, 7.8, 0.65, 24);
  plinthGeo.translate(0, -0.82, 0);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x23262d,
    roughness: 0.92,
    metalness: 0.04,
  });

  const exitRingGeo = new THREE.RingGeometry(0.65, 0.92, 24);
  exitRingGeo.rotateX(-Math.PI / 2);
  const exitRingMat = new THREE.MeshBasicMaterial({
    color: 0x80ffdb,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.72,
  });

  const throneRingGeo = new THREE.RingGeometry(0.75, 1.05, 24);
  throneRingGeo.rotateX(-Math.PI / 2);
  const throneRingMat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.78,
  });

  const hearthFlameGeo = new THREE.ConeGeometry(0.36, 0.74, 7);
  hearthFlameGeo.translate(0, 0.37, 0);
  const hearthFlameMat = new THREE.MeshBasicMaterial({
    color: 0xff9f1c,
    transparent: true,
    opacity: 0.92,
  });

  sharedInteriorAssets = {
    fallbackGeo,
    fallbackMat,
    plinthGeo,
    plinthMat,
    exitRingGeo,
    exitRingMat,
    throneRingGeo,
    throneRingMat,
    hearthFlameGeo,
    hearthFlameMat,
  };
  return sharedInteriorAssets;
}

/**
 * Manages the Three Castle Interiors:
 * - Tier I: Dwarven Border Keep (`3dmodels/border keep interior.glb`)
 * - Tier II: Stonewall Stronghold (`3dmodels/stonewall_stronghold_interior.glb`)
 * - Tier III: Mountain King's Grand Citadel (`3dmodels/grand citadel interior 3d model.glb`)
 * Provides sanctuary from nighttime Troll-Beasts, interior lighting, O(1) collision,
 * Hearth recovery, and Throne rest-until-dawn.
 */
export class CastleInteriorManager {
  public readonly group = new THREE.Group();
  private activeVisit: ActiveCastleVisit | null = null;
  private interiorFloorY = 0;
  private exitCooldown = 0;
  private steppedInside = false;

  private interiorGroup = new THREE.Group();
  private interiorMesh!: THREE.Mesh;
  private hearthLight!: THREE.PointLight;
  private chandelierLight!: THREE.PointLight;
  private daisLight!: THREE.PointLight;
  private hearthFlameMesh!: THREE.Mesh;
  private exitRingMesh!: THREE.Mesh;
  private daisRingMesh!: THREE.Mesh;

  private readonly interiorBgColor = new THREE.Color(0x1b1e26);
  private savedBgColor: THREE.Color | THREE.Texture | null = null;
  private savedFogDensity = 0.0025;

  private onEnterCallback?: (visit: ActiveCastleVisit) => void;
  private onExitCallback?: () => void;
  private onRestUntilDawnCallback?: (visit: ActiveCastleVisit) => void;
  private onHearthBlessingCallback?: (visit: ActiveCastleVisit) => void;
  private lastHearthBlessingTime = -999;

  constructor(
    _config: WorldConfig,
    private scene: THREE.Scene,
    private fog: THREE.FogExp2,
    private dwarf: DwarfCharacter,
    private exteriorGroups: THREE.Object3D[],
    private onSetPlayerPose: (
      x: number,
      z: number,
      heading: number,
      yaw: number,
      pitch: number,
      distance: number
    ) => void
  ) {
    this.group.matrixAutoUpdate = false;
    this.buildStage();

    window.addEventListener('keydown', (e) => {
      if (e.repeat || !this.activeVisit) return;
      if (e.code === 'Escape') {
        this.exitCurrentCastle();
      } else if (e.code === 'KeyR') {
        this.tryRestUntilDawn();
      }
    });
  }

  public setCallbacks(
    onEnter: (visit: ActiveCastleVisit) => void,
    onExit: () => void,
    onRestUntilDawn: (visit: ActiveCastleVisit) => void,
    onHearthBlessing?: (visit: ActiveCastleVisit) => void
  ): void {
    this.onEnterCallback = onEnter;
    this.onExitCallback = onExit;
    this.onRestUntilDawnCallback = onRestUntilDawn;
    if (onHearthBlessing) {
      this.onHearthBlessingCallback = onHearthBlessing;
    }
  }

  public getInteriorRingProximity(playerPos: THREE.Vector3): 'dais' | 'exit' | 'none' {
    const visit = this.activeVisit;
    if (!visit) return 'none';
    const spec = TIER_INTERIOR_SPECS[visit.tier];
    const daisWorldX = visit.worldX + spec.daisLightLocal.x - 0.55;
    const daisWorldZ = visit.worldZ + spec.daisLightLocal.z + 0.55;
    const distToDais = Math.hypot(playerPos.x - daisWorldX, playerPos.z - daisWorldZ);
    if (distToDais <= 1.35) return 'dais';

    const exitWorldX = visit.worldX + spec.exitLocal.x;
    const exitWorldZ = visit.worldZ + spec.exitLocal.z;
    const distToExit = Math.hypot(playerPos.x - exitWorldX, playerPos.z - exitWorldZ);
    if (distToExit <= 1.35) return 'exit';

    return 'none';
  }

  public isInsideCastle(): boolean {
    return this.activeVisit !== null;
  }

  public getActiveCastleVisit(): ActiveCastleVisit | null {
    return this.activeVisit;
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
    const visit = this.activeVisit;
    if (!visit) return null;
    const outDist = 6.6;
    return {
      x: visit.worldX + Math.sin(visit.rotationY) * outDist,
      y: visit.worldY + 0.45,
      z: visit.worldZ + Math.cos(visit.rotationY) * outDist,
      heading: visit.rotationY,
      yaw: visit.rotationY + Math.PI,
      pitch: 0.46,
      distance: 11.5,
    };
  }

  public getInteriorFloorHeight(fallbackY: number): number {
    return this.activeVisit ? this.interiorFloorY : fallbackY;
  }

  public canEnterNow(): boolean {
    return !this.activeVisit && this.exitCooldown <= 0;
  }

  private buildStage(): void {
    const assets = getSharedCastleInteriorAssets();
    this.interiorGroup.visible = false;
    this.interiorGroup.matrixAutoUpdate = false;

    this.interiorMesh = new THREE.Mesh(assets.fallbackGeo, assets.fallbackMat);
    this.interiorMesh.castShadow = true;
    this.interiorMesh.receiveShadow = true;
    this.interiorMesh.updateMatrix();
    this.interiorMesh.matrixAutoUpdate = false;
    this.interiorGroup.add(this.interiorMesh);

    const plinthMesh = new THREE.Mesh(assets.plinthGeo, assets.plinthMat);
    plinthMesh.receiveShadow = true;
    plinthMesh.updateMatrix();
    plinthMesh.matrixAutoUpdate = false;
    this.interiorGroup.add(plinthMesh);

    this.hearthLight = new THREE.PointLight(0xff8c2b, 4.4, 15.0, 1.4);
    this.hearthLight.matrixAutoUpdate = false;
    this.interiorGroup.add(this.hearthLight);

    this.chandelierLight = new THREE.PointLight(0xffd166, 2.8, 16.0, 1.4);
    this.chandelierLight.matrixAutoUpdate = false;
    this.interiorGroup.add(this.chandelierLight);

    this.daisLight = new THREE.PointLight(0xffe6a3, 2.2, 12.0, 1.5);
    this.daisLight.matrixAutoUpdate = false;
    this.interiorGroup.add(this.daisLight);

    this.hearthFlameMesh = new THREE.Mesh(assets.hearthFlameGeo, assets.hearthFlameMat);
    this.hearthFlameMesh.matrixAutoUpdate = false;
    this.interiorGroup.add(this.hearthFlameMesh);

    this.exitRingMesh = new THREE.Mesh(assets.exitRingGeo, assets.exitRingMat);
    this.exitRingMesh.matrixAutoUpdate = false;
    this.interiorGroup.add(this.exitRingMesh);

    this.daisRingMesh = new THREE.Mesh(assets.throneRingGeo, assets.throneRingMat);
    this.daisRingMesh.matrixAutoUpdate = false;
    this.interiorGroup.add(this.daisRingMesh);

    this.group.add(this.interiorGroup);
  }

  private syncTierMesh(tier: CastleInteriorTier): void {
    const assets = getSharedCastleInteriorAssets();
    const loaded = tierGlbAssets[tier];
    if (loaded) {
      this.interiorMesh.geometry = loaded.geo;
      this.interiorMesh.material = loaded.mat;
    } else {
      this.interiorMesh.geometry = assets.fallbackGeo;
      this.interiorMesh.material = assets.fallbackMat;
      ensureCastleInteriorModelLoaded(tier, () => {
        if (this.activeVisit && this.activeVisit.tier === tier) {
          this.syncTierMesh(tier);
        }
      });
    }
  }

  public enterCastle(visit: ActiveCastleVisit): void {
    if (this.activeVisit) return;
    this.activeVisit = visit;
    this.steppedInside = false;
    this.interiorFloorY = visit.worldY + 0.45;

    const spec = TIER_INTERIOR_SPECS[visit.tier];
    this.syncTierMesh(visit.tier);

    // Pre-warm next tier interior if below Tier III
    if (visit.tier < 3) {
      ensureCastleInteriorModelLoaded((visit.tier + 1) as CastleInteriorTier);
    }

    this.hearthLight.position.set(spec.hearthLocal.x, spec.hearthLocal.y, spec.hearthLocal.z);
    this.hearthLight.updateMatrix();

    this.chandelierLight.position.set(
      spec.chandelierLocal.x,
      spec.chandelierLocal.y,
      spec.chandelierLocal.z
    );
    this.chandelierLight.updateMatrix();

    this.daisLight.position.set(
      spec.daisLightLocal.x,
      spec.daisLightLocal.y,
      spec.daisLightLocal.z
    );
    this.daisLight.updateMatrix();

    this.hearthFlameMesh.position.set(spec.hearthLocal.x, 0.18, spec.hearthLocal.z);
    this.hearthFlameMesh.updateMatrix();

    this.exitRingMesh.position.set(spec.exitLocal.x, 0.05, spec.exitLocal.z);
    this.exitRingMesh.updateMatrix();

    this.daisRingMesh.position.set(spec.daisLightLocal.x - 0.55, 0.06, spec.daisLightLocal.z + 0.55);
    this.daisRingMesh.updateMatrix();

    this.interiorGroup.position.set(visit.worldX, this.interiorFloorY, visit.worldZ);
    this.interiorGroup.rotation.set(0, 0, 0);
    this.interiorGroup.visible = true;
    this.interiorGroup.updateMatrix();
    this.interiorGroup.updateMatrixWorld(true);

    for (const grp of this.exteriorGroups) {
      grp.visible = false;
    }

    this.savedBgColor = this.scene.background;
    this.savedFogDensity = this.fog.density;
    this.scene.background = this.interiorBgColor;
    this.fog.density = 0.00035;

    // Position the dwarf inside the threshold looking toward the armory/banquet hall
    const entryX = visit.worldX + spec.exitLocal.x + 0.45;
    const entryZ = visit.worldZ + spec.exitLocal.z - 0.55;
    const camDist = visit.tier === 1 ? 10.4 : 12.6;
    this.onSetPlayerPose(entryX, entryZ, Math.PI * 0.78, 0.65, 0.48, camDist);
    this.dwarf.spawnBurst(entryX, this.interiorFloorY, entryZ, 14);
    this.playGateDoorSound(true);
    this.onEnterCallback?.(visit);
  }

  public exitCurrentCastle(silent = false): void {
    const visit = this.activeVisit;
    if (!visit) return;
    this.activeVisit = null;
    this.exitCooldown = 1.6;
    this.interiorGroup.visible = false;

    for (const grp of this.exteriorGroups) {
      grp.visible = true;
    }
    if (this.savedBgColor !== null) {
      this.scene.background = this.savedBgColor;
    }
    this.fog.density = this.savedFogDensity;

    if (!silent) {
      // Place the dwarf outside on the lowered timber drawbridge (local z = +6.5m)
      const outDist = 6.6;
      const outX = visit.worldX + Math.sin(visit.rotationY) * outDist;
      const outZ = visit.worldZ + Math.cos(visit.rotationY) * outDist;
      const outYaw = visit.rotationY + Math.PI;
      this.onSetPlayerPose(outX, outZ, visit.rotationY, outYaw, 0.46, 11.5);
      this.dwarf.spawnBurst(outX, visit.worldY + 0.45, outZ, 12);
      this.playGateDoorSound(false);
    }
    this.onExitCallback?.();
  }

  public tryRestUntilDawn(): boolean {
    if (!this.activeVisit) return false;
    this.dwarf.spawnBurst(
      this.dwarf.root.position.x,
      this.interiorFloorY + 0.55,
      this.dwarf.root.position.z,
      20
    );
    this.playHearthBlessingSound();
    this.onRestUntilDawnCallback?.(this.activeVisit);
    return true;
  }

  /**
   * Resolves 2D collisions between the dwarf and the interior walls, tables, hearth & dais
   * of the active Tier I / II / III Castle Interior in O(1) time with zero heap allocations.
   */
  public resolveInteriorCollision(pos: THREE.Vector3, playerRadius = 0.36): void {
    const visit = this.activeVisit;
    if (!visit) return;

    const spec = TIER_INTERIOR_SPECS[visit.tier];
    let lx = pos.x - visit.worldX;
    let lz = pos.z - visit.worldZ;

    const minX = spec.bounds.minX + playerRadius;
    const maxX = spec.bounds.maxX - playerRadius;
    const minZ = spec.bounds.minZ + playerRadius;
    const maxZ = spec.bounds.maxZ - playerRadius;

    if (lx < minX) lx = minX;
    if (lx > maxX) lx = maxX;
    if (lz < minZ) lz = minZ;
    if (lz > maxZ) lz = maxZ;

    const colliders = spec.colliders;
    for (let i = 0; i < colliders.length; i += 3) {
      const ox = colliders[i];
      const oz = colliders[i + 1];
      const minDist = colliders[i + 2] + playerRadius;

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

    if (lx < minX) lx = minX;
    if (lx > maxX) lx = maxX;
    if (lz < minZ) lz = minZ;
    if (lz > maxZ) lz = maxZ;

    pos.x = visit.worldX + lx;
    pos.z = visit.worldZ + lz;
  }

  public update(dt: number, elapsedTime: number, playerPos: THREE.Vector3): void {
    if (this.exitCooldown > 0) {
      this.exitCooldown = Math.max(0, this.exitCooldown - dt);
    }

    const visit = this.activeVisit;
    if (!visit) return;

    const spec = TIER_INTERIOR_SPECS[visit.tier];

    // Animate warm flickering Hearth Flame & PointLight
    const flicker = 1.0 + Math.sin(elapsedTime * 10.5) * 0.14 + Math.cos(elapsedTime * 17.0) * 0.08;
    this.hearthLight.intensity = 4.4 * flicker;
    this.hearthFlameMesh.scale.set(
      0.92 + Math.sin(elapsedTime * 13.0) * 0.1,
      0.88 + Math.cos(elapsedTime * 15.0) * 0.16,
      0.92 + Math.sin(elapsedTime * 11.0) * 0.1
    );
    this.hearthFlameMesh.updateMatrix();
    this.hearthFlameMesh.matrixWorld.multiplyMatrices(
      this.interiorGroup.matrixWorld,
      this.hearthFlameMesh.matrix
    );

    const ringPulse = 0.94 + Math.sin(elapsedTime * 4.2) * 0.08;
    this.exitRingMesh.scale.setScalar(ringPulse);
    this.exitRingMesh.updateMatrix();
    this.exitRingMesh.matrixWorld.multiplyMatrices(
      this.interiorGroup.matrixWorld,
      this.exitRingMesh.matrix
    );

    this.daisRingMesh.scale.setScalar(ringPulse);
    this.daisRingMesh.updateMatrix();
    this.daisRingMesh.matrixWorld.multiplyMatrices(
      this.interiorGroup.matrixWorld,
      this.daisRingMesh.matrix
    );

    // Walk-out detection at the glowing cyan exit ring
    const exitWorldX = visit.worldX + spec.exitLocal.x;
    const exitWorldZ = visit.worldZ + spec.exitLocal.z;
    const distToExit = Math.hypot(playerPos.x - exitWorldX, playerPos.z - exitWorldZ);
    if (!this.steppedInside && distToExit > 1.25) {
      this.steppedInside = true;
    } else if (this.steppedInside && distToExit <= 0.72) {
      this.exitCurrentCastle();
      return;
    }

    // Golden Hearth & Sanctuary Circle (`daisRingMesh`) step-in blessing!
    const daisWorldX = visit.worldX + spec.daisLightLocal.x - 0.55;
    const daisWorldZ = visit.worldZ + spec.daisLightLocal.z + 0.55;
    const distToDais = Math.hypot(playerPos.x - daisWorldX, playerPos.z - daisWorldZ);
    if (distToDais <= 1.05 && elapsedTime - this.lastHearthBlessingTime > 45.0) {
      this.lastHearthBlessingTime = elapsedTime;
      this.dwarf.spawnBurst(playerPos.x, this.interiorFloorY + 0.55, playerPos.z, 18);
      this.playHearthBlessingSound();
      this.onHearthBlessingCallback?.(visit);
    }
  }

  private playHearthBlessingSound(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [329.63, 440, 554.37, 659.25];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.065;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.14, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(t);
      osc.stop(t + 0.34);
    });
  }

  private playGateDoorSound(entering: boolean): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = entering ? [220, 293.66, 440] : [392, 293.66, 196];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.075;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }
}
