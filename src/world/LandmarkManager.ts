import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import stoneCircleModelUrl from '../../3dmodels/ancient stone circle asset.glb?url';
import { WorldConfig } from './Config';
import { SavedBeaconWaypoint } from './ProgressStorage';
import { createSeededRandom, TerrainNoise } from './TerrainNoise';

interface WatchtowerInstance {
  id: string;
  name: string;
  worldPos: THREE.Vector3;
  lit: boolean;
  root: THREE.Group;
  structureMesh: THREE.Mesh;
  brazierMesh: THREE.Mesh;
  flameMesh: THREE.Mesh;
  skyBeamMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
  isNearLOD: boolean;
}

interface CampfireInstance {
  id: string;
  worldPos: THREE.Vector3;
  root: THREE.Group;
  stoneCircleMesh: THREE.Mesh;
  benchesMesh: THREE.Mesh;
  flameMesh: THREE.Mesh;
  glowRing: THREE.Mesh;
  isNearLOD: boolean;
  lastBuffTime: number;
}

interface BridgeInstance {
  worldX: number;
  worldZ: number;
  deckY: number;
  cosH: number;
  sinH: number;
  halfLen: number;
  halfWidth: number;
  root: THREE.Group;
}

interface ChunkLandmarks {
  watchtower?: WatchtowerInstance;
  campfire?: CampfireInstance;
  bridges: BridgeInstance[];
}

interface SharedLandmarkAssets {
  matStone: THREE.MeshStandardMaterial;
  matMossStone: THREE.MeshStandardMaterial;
  matTimber: THREE.MeshStandardMaterial;
  matBrazier: THREE.MeshStandardMaterial;
  matFlame: THREE.MeshBasicMaterial;
  matSkyBeam: THREE.MeshBasicMaterial;
  matRingUnlit: THREE.MeshBasicMaterial;
  matRingLit: THREE.MeshBasicMaterial;
  matCampfireRing: THREE.MeshBasicMaterial;
  watchtowerSimpleGeo: THREE.BufferGeometry;
  brazierGeo: THREE.BufferGeometry;
  flameGeo: THREE.BufferGeometry;
  skyBeamGeo: THREE.BufferGeometry;
  ringGeo: THREE.BufferGeometry;
  stoneCircleSimpleGeo: THREE.BufferGeometry;
  logBenchesGeo: THREE.BufferGeometry;
  bridgeDeckGeo: THREE.BufferGeometry;
  bridgeRailGeo: THREE.BufferGeometry;
}

let sharedLandmarkAssets: SharedLandmarkAssets | null = null;
let sharedStoneCircleGeo: THREE.BufferGeometry | null = null;
let sharedStoneCircleMat: THREE.MeshStandardMaterial | null = null;
let stoneCircleLoadStarted = false;
const activeNearWatchtowers = new Set<WatchtowerInstance>();
const activeNearStoneCircles = new Set<CampfireInstance>();

/**
 * Asynchronously loads `3dmodels/ancient stone circle asset.glb`, normalizes its transform
 * and scale (~12.5m outer diameter matching `art/stone_circle_with_dwarf.jpg`, with central floor
 * at Y=0 and outer foundation skirt embedded), optimizes its PBR material, and hot-swaps all
 * active close-range (dist <= 1.5 chunks) Hilltop Beacons and Stone Circles.
 */
export function loadStoneCircleModel(): void {
  if (stoneCircleLoadStarted) return;
  stoneCircleLoadStarted = true;

  const loader = new GLTFLoader();
  loader.load(
    stoneCircleModelUrl,
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

      // 1. Strip unused skinning attributes if present
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');

      // 2. Normalize bounding box: center X/Z at 0, align inner stone circle floor to Y=0
      // (so the outer foundation skirt embeds into sloped terrain), and scale to ~12.5m diameter
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const spanX = box.max.x - box.min.x;
      const spanZ = box.max.z - box.min.z;
      const spanY = Math.max(0.01, box.max.y - box.min.y);
      const diameter = Math.max(0.01, Math.max(spanX, spanZ));
      const targetDiameter = 12.5;
      const scaleFactor = targetDiameter / diameter;
      const innerFloorY = box.min.y + spanY * 0.285;

      geo.translate(-centerX, -innerFloorY, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);

      // 3. Guard computeVertexNormals() — never recompute on 22k+ vert mesh when normals exist
      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const mat = (origMat as THREE.MeshStandardMaterial).clone();
      mat.color.setHex(0xffffff);
      mat.roughness = 0.88;
      mat.metalness = 0.05;
      if (mat.normalMap) {
        mat.normalMap.dispose();
        mat.normalMap = null;
      }
      if (mat.roughnessMap) {
        mat.roughnessMap.dispose();
        mat.roughnessMap = null;
      }
      if (mat.metalnessMap) {
        mat.metalnessMap.dispose();
        mat.metalnessMap = null;
      }
      if (mat.aoMap) {
        mat.aoMap.dispose();
        mat.aoMap = null;
      }
      origMat.dispose();

      sharedStoneCircleGeo = geo;
      sharedStoneCircleMat = mat;

      // 4. Hot-swap all currently active close-range LOD watchtowers and stone circles
      for (const wt of activeNearWatchtowers) {
        wt.structureMesh.geometry = sharedStoneCircleGeo;
        wt.structureMesh.material = sharedStoneCircleMat;
        wt.ringMesh.position.y = 0.14;
        wt.ringMesh.updateMatrix();
        wt.ringMesh.matrixWorld.multiplyMatrices(wt.root.matrixWorld, wt.ringMesh.matrix);
      }
      for (const cf of activeNearStoneCircles) {
        cf.stoneCircleMesh.geometry = sharedStoneCircleGeo;
        cf.stoneCircleMesh.material = sharedStoneCircleMat;
        cf.benchesMesh.visible = false;
      }
    },
    undefined,
    (err) => {
      console.error('Failed to load ancient stone circle 3D model:', err);
    }
  );
}

const WATCHTOWER_NAMES = [
  'Highpeak Beacon',
  'Cloudwatch Ruin',
  'Ironcrest Tower',
  'Windspire Lookout',
  'Sunstone Bastion',
  'Mistvale Watch',
  'Thunderridge Spire',
  'Glimmerhorn Beacon',
  'Oakenshield Watch',
  'Starfall Lookout',
];

function getSharedLandmarkAssets(): SharedLandmarkAssets {
  if (sharedLandmarkAssets) return sharedLandmarkAssets;

  const matStone = new THREE.MeshStandardMaterial({
    color: 0x737a82,
    roughness: 0.88,
    metalness: 0.08,
  });

  const matMossStone = new THREE.MeshStandardMaterial({
    color: 0x62735c,
    roughness: 0.9,
    metalness: 0.05,
  });

  const matTimber = new THREE.MeshStandardMaterial({
    color: 0x6e4b2b,
    roughness: 0.82,
    metalness: 0.05,
  });

  const matBrazier = new THREE.MeshStandardMaterial({
    color: 0x3b3530,
    roughness: 0.45,
    metalness: 0.75,
  });

  const matFlame = new THREE.MeshBasicMaterial({
    color: 0xff9f1c,
    transparent: true,
    opacity: 0.92,
  });

  const matSkyBeam = new THREE.MeshBasicMaterial({
    color: 0xffbf69,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });

  const matRingUnlit = new THREE.MeshBasicMaterial({
    color: 0x90e0ef,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
  });

  const matRingLit = new THREE.MeshBasicMaterial({
    color: 0xffb703,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.65,
  });

  const matCampfireRing = new THREE.MeshBasicMaterial({
    color: 0xff9f1c,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.4,
  });

  const dummy = new THREE.Object3D();

  // Merge the Watchtower plinth + 4 ruined stone pillars into a single low-poly fallback geometry
  const towerBaseGeo = new THREE.CylinderGeometry(3.2, 3.6, 0.75, 8);
  towerBaseGeo.translate(0, 0.375, 0);
  const towerPillarGeo = new THREE.BoxGeometry(0.62, 3.6, 0.62);
  towerPillarGeo.translate(0, 1.8, 0);
  const towerParts: THREE.BufferGeometry[] = [towerBaseGeo];
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const part = towerPillarGeo.clone();
    dummy.position.set(Math.cos(angle) * 2.25, 0.5, Math.sin(angle) * 2.25);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, i % 2 === 0 ? 1.0 : 0.72, 1);
    dummy.updateMatrix();
    part.applyMatrix4(dummy.matrix);
    towerParts.push(part);
  }
  towerPillarGeo.dispose();
  const watchtowerSimpleGeo = mergeGeometries(towerParts, false);
  for (const p of towerParts) p.dispose();
  watchtowerSimpleGeo.computeBoundingBox();
  watchtowerSimpleGeo.computeBoundingSphere();

  const brazierGeo = new THREE.CylinderGeometry(0.75, 0.45, 0.95, 8);
  brazierGeo.translate(0, 0.48, 0);

  const flameGeo = new THREE.ConeGeometry(0.65, 1.65, 7);
  flameGeo.translate(0, 1.48, 0);

  const skyBeamGeo = new THREE.CylinderGeometry(0.45, 1.1, 28.0, 10, 1, true);
  skyBeamGeo.translate(0, 14.0, 0);

  const ringGeo = new THREE.RingGeometry(2.8, 3.3, 24);
  ringGeo.rotateX(-Math.PI / 2);

  // Merge the 5 standing mossy megaliths into a single low-poly fallback geometry (< 60 tris)
  const megalithBase = new THREE.BoxGeometry(0.75, 2.35, 0.48);
  megalithBase.translate(0, 1.15, 0);
  const megalithParts: THREE.BufferGeometry[] = [];
  const stoneCount = 5;
  for (let i = 0; i < stoneCount; i++) {
    const angle = (i / stoneCount) * Math.PI * 2;
    const part = megalithBase.clone();
    dummy.position.set(Math.cos(angle) * 3.1, -0.1, Math.sin(angle) * 3.1);
    dummy.rotation.set(0, -angle + 0.15, (i % 2 === 0 ? 1 : -1) * 0.08);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    part.applyMatrix4(dummy.matrix);
    megalithParts.push(part);
  }
  megalithBase.dispose();
  const stoneCircleSimpleGeo = mergeGeometries(megalithParts, false);
  for (const p of megalithParts) p.dispose();
  stoneCircleSimpleGeo.computeBoundingBox();
  stoneCircleSimpleGeo.computeBoundingSphere();

  // Merge the 2 wooden log benches beside the fire into a single geometry
  const logBenchBase = new THREE.CylinderGeometry(0.18, 0.18, 1.6, 7);
  logBenchBase.rotateZ(Math.PI / 2);
  logBenchBase.translate(0, 0.2, 0);
  const benchParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 2; i++) {
    const part = logBenchBase.clone();
    dummy.position.set(i === 0 ? -1.45 : 1.45, 0, 0);
    dummy.rotation.set(0, Math.PI / 2, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    part.applyMatrix4(dummy.matrix);
    benchParts.push(part);
  }
  logBenchBase.dispose();
  const logBenchesGeo = mergeGeometries(benchParts, false);
  for (const p of benchParts) p.dispose();
  logBenchesGeo.computeBoundingBox();
  logBenchesGeo.computeBoundingSphere();

  const bridgeDeckGeo = new THREE.BoxGeometry(3.6, 0.28, 14.0);
  const bridgeRailGeo = new THREE.BoxGeometry(0.16, 0.85, 14.0);
  bridgeRailGeo.translate(0, 0.52, 0);

  sharedLandmarkAssets = {
    matStone,
    matMossStone,
    matTimber,
    matBrazier,
    matFlame,
    matSkyBeam,
    matRingUnlit,
    matRingLit,
    matCampfireRing,
    watchtowerSimpleGeo,
    brazierGeo,
    flameGeo,
    skyBeamGeo,
    ringGeo,
    stoneCircleSimpleGeo,
    logBenchesGeo,
    bridgeDeckGeo,
    bridgeRailGeo,
  };
  return sharedLandmarkAssets;
}

/**
 * Manages Procedural Points of Interest (POIs) & Landmarks across chunks:
 * 1. Dwarven Watchtowers / Hilltop Beacons (ignitable for gold, fog clearing & Fast-Travel Waypoints)
 * 2. Wooden River Bridges where forest footpaths cross water (with walkable deck collision height)
 * 3. Ancient Stone Circles & Wayside Campfires (granting a 60s speed/jump blessing & streak refresh)
 */
export class LandmarkManager {
  public readonly group = new THREE.Group();
  public campfireBuffTimer = 0;
  public onBeaconLit?: (waypoint: SavedBeaconWaypoint) => void;

  private activeLandmarks = new Map<number, ChunkLandmarks>();
  private desiredKeys = new Set<number>();
  private litBeaconMap = new Map<string, SavedBeaconWaypoint>();
  private audioCtx: AudioContext | null = null;
  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;
  private nextWaypointIndex = 0;

  private toastContainer: HTMLElement | null;
  private waypointBarEl: HTMLElement | null;
  private waypointListEl: HTMLElement | null;

  constructor(
    private config: WorldConfig,
    private noise: TerrainNoise,
    private onTeleportTo: (x: number, z: number, label: string) => void,
    private onGrantGoldAndRefreshStreak: (gold: number, message: string) => void
  ) {
    this.group.matrixAutoUpdate = false;
    this.toastContainer = document.getElementById('pickup-toasts');
    this.waypointBarEl = document.getElementById('waypoint-bar');
    this.waypointListEl = document.getElementById('waypoint-list');
    loadStoneCircleModel();

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyT') {
        this.cycleFastTravel();
      }
    });

    this.renderWaypointBar();
  }

  private getKey(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  public hasCampfireBuff(): boolean {
    return this.campfireBuffTimer > 0;
  }

  public getLitBeaconCount(): number {
    return this.litBeaconMap.size;
  }

  public getLitBeacons(): SavedBeaconWaypoint[] {
    return Array.from(this.litBeaconMap.values());
  }

  public restoreLitBeacons(beacons: SavedBeaconWaypoint[] | undefined): void {
    this.litBeaconMap.clear();
    if (beacons) {
      for (const b of beacons) {
        this.litBeaconMap.set(b.id, b);
      }
    }
    this.renderWaypointBar();
    this.rebuildAll();
  }

  public reset(): void {
    this.litBeaconMap.clear();
    this.campfireBuffTimer = 0;
    this.renderWaypointBar();
    this.rebuildAll();
  }

  public cycleFastTravel(): void {
    const waypoints: SavedBeaconWaypoint[] = [
      { id: 'spawn', name: '🏕️ Spawn Valley', x: 0, y: 0, z: 0 },
      ...Array.from(this.litBeaconMap.values()),
    ];
    if (waypoints.length <= 1) {
      this.showToast('🔥 Light a Hilltop Watchtower Beacon to unlock Fast-Travel!', false);
      return;
    }
    this.nextWaypointIndex = (this.nextWaypointIndex + 1) % waypoints.length;
    const target = waypoints[this.nextWaypointIndex];
    this.playBeaconFanfare();
    this.onTeleportTo(target.x, target.z, target.name);
  }

  private renderWaypointBar(): void {
    if (!this.waypointBarEl || !this.waypointListEl) return;
    const beacons = Array.from(this.litBeaconMap.values());
    if (beacons.length === 0) {
      this.waypointBarEl.classList.add('hidden');
      return;
    }
    this.waypointBarEl.classList.remove('hidden');
    this.waypointListEl.innerHTML = '';

    const allPoints: SavedBeaconWaypoint[] = [
      { id: 'spawn', name: '🏕️ Spawn (0,0)', x: 0, y: 0, z: 0 },
      ...beacons,
    ];

    for (const wp of allPoints) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'waypoint-chip';
      btn.textContent = wp.name;
      btn.title = `Fast-Travel to ${wp.name} (${wp.x.toFixed(0)}, ${wp.z.toFixed(0)})`;
      btn.addEventListener('click', () => {
        this.playBeaconFanfare();
        this.onTeleportTo(wp.x, wp.z, wp.name);
      });
      this.waypointListEl.appendChild(btn);
    }
  }

  /**
   * Returns elevated walkable timber deck height if the player is standing on a Wooden River Bridge.
   */
  public getBridgeDeckHeight(worldX: number, worldZ: number, groundY: number): number {
    const size = this.config.chunkSize;
    const centerCx = Math.round(worldX / size);
    const centerCz = Math.round(worldZ / size);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const lm = this.activeLandmarks.get(this.getKey(centerCx + dx, centerCz + dz));
        if (!lm || lm.bridges.length === 0) continue;

        for (const b of lm.bridges) {
          const rx = worldX - b.worldX;
          const rz = worldZ - b.worldZ;
          // Project into bridge local space (along = Z, across = X)
          const localAcross = rx * b.cosH - rz * b.sinH;
          const localAlong = rx * b.sinH + rz * b.cosH;

          if (
            Math.abs(localAcross) <= b.halfWidth &&
            Math.abs(localAlong) <= b.halfLen
          ) {
            // Gentle arch profile along the bridge span
            const normAlong = localAlong / b.halfLen;
            const archOffset = (1.0 - normAlong * normAlong) * 0.45;
            return Math.max(groundY, b.deckY + archOffset);
          }
        }
      }
    }
    return groundY;
  }

  /**
   * Finds the nearest unlit Watchtower Beacon so the HUD can guide players to landmarks too.
   */
  public getNearestUnlitWatchtower(
    playerPos: THREE.Vector3
  ): { dist: number; pos: THREE.Vector3; name: string } | null {
    let bestDistSq = Infinity;
    let bestTower: WatchtowerInstance | null = null;

    for (const lm of this.activeLandmarks.values()) {
      const wt = lm.watchtower;
      if (!wt || wt.lit) continue;
      const dx = wt.worldPos.x - playerPos.x;
      const dz = wt.worldPos.z - playerPos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestTower = wt;
      }
    }

    if (!bestTower) return null;
    return {
      dist: Math.sqrt(bestDistSq),
      pos: bestTower.worldPos,
      name: bestTower.name,
    };
  }

  public update(dt: number, elapsedTime: number, playerPos: THREE.Vector3): void {
    if (this.campfireBuffTimer > 0) {
      this.campfireBuffTimer = Math.max(0, this.campfireBuffTimer - dt);
    }

    const size = this.config.chunkSize;
    const r = this.config.renderRadius;
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

          if (!this.activeLandmarks.has(key)) {
            this.spawnLandmarksForChunk(cx, cz, key);
          }
        }
      }

      for (const [key, lm] of this.activeLandmarks.entries()) {
        if (!desiredKeys.has(key)) {
          if (lm.watchtower) {
            activeNearWatchtowers.delete(lm.watchtower);
            this.group.remove(lm.watchtower.root);
          }
          if (lm.campfire) {
            activeNearStoneCircles.delete(lm.campfire);
            this.group.remove(lm.campfire.root);
          }
          for (const b of lm.bridges) this.group.remove(b.root);
          this.activeLandmarks.delete(key);
        }
      }
    }

    const nearLodDist = 1.5 * size;
    const nearLodDistSq = nearLodDist * nearLodDist;
    const shadowDist = 2.2 * size;
    const shadowDistSq = shadowDist * shadowDist;

    // Animate & check proximity to Watchtowers and Wayside Campfires
    for (const lm of this.activeLandmarks.values()) {
      if (lm.watchtower) {
        const wt = lm.watchtower;
        const dx = playerPos.x - wt.worldPos.x;
        const dz = playerPos.z - wt.worldPos.z;
        const dSq = dx * dx + dz * dz;

        // Swap in-place between high-poly Ancient Stone Circle GLB (dist <= 1.5 chunks)
        // and simple low-poly procedural stone pillars when at a distance (dist > 1.5 chunks)
        const wantNearLOD = dSq <= nearLodDistSq;
        const castShadow = dSq <= shadowDistSq;
        if (wt.structureMesh.castShadow !== castShadow) {
          wt.structureMesh.castShadow = castShadow;
          wt.brazierMesh.castShadow = castShadow;
        }
        if (wt.isNearLOD !== wantNearLOD) {
          wt.isNearLOD = wantNearLOD;
          if (wantNearLOD) {
            activeNearWatchtowers.add(wt);
            if (sharedStoneCircleGeo && sharedStoneCircleMat) {
              wt.structureMesh.geometry = sharedStoneCircleGeo;
              wt.structureMesh.material = sharedStoneCircleMat;
              wt.ringMesh.position.y = 0.14;
              wt.ringMesh.updateMatrix();
              wt.ringMesh.matrixWorld.multiplyMatrices(wt.root.matrixWorld, wt.ringMesh.matrix);
            }
          } else {
            activeNearWatchtowers.delete(wt);
            const assets = getSharedLandmarkAssets();
            wt.structureMesh.geometry = assets.watchtowerSimpleGeo;
            wt.structureMesh.material = assets.matStone;
            wt.ringMesh.position.y = 0.78;
            wt.ringMesh.updateMatrix();
            wt.ringMesh.matrixWorld.multiplyMatrices(wt.root.matrixWorld, wt.ringMesh.matrix);
          }
        }

        if (wt.lit) {
          const flicker = 1.0 + Math.sin(elapsedTime * 7.5 + wt.worldPos.x) * 0.14;
          wt.flameMesh.scale.set(1, flicker, 1);
          wt.flameMesh.rotation.y = elapsedTime * 2.0;
          wt.flameMesh.updateMatrix();
          wt.flameMesh.matrixWorld.multiplyMatrices(wt.root.matrixWorld, wt.flameMesh.matrix);
        } else if (dSq < 55 * 55) {
          const pulse = 1.0 + Math.sin(elapsedTime * 3.8) * 0.08;
          wt.ringMesh.scale.setScalar(pulse);
          wt.ringMesh.updateMatrix();
          wt.ringMesh.matrixWorld.multiplyMatrices(wt.root.matrixWorld, wt.ringMesh.matrix);
        }

        if (!wt.lit && dSq <= 3.6 * 3.6) {
          this.igniteWatchtower(wt);
        }
      }

      if (lm.campfire) {
        const cf = lm.campfire;
        const dx = playerPos.x - cf.worldPos.x;
        const dz = playerPos.z - cf.worldPos.z;
        const dSq = dx * dx + dz * dz;

        // Swap in-place between high-poly Ancient Stone Circle GLB (dist <= 1.5 chunks)
        // and simple low-poly procedural stone circle when at a distance (dist > 1.5 chunks)
        const wantNearLOD = dSq <= nearLodDistSq;
        const castShadow = dSq <= shadowDistSq;
        if (cf.stoneCircleMesh.castShadow !== castShadow) {
          cf.stoneCircleMesh.castShadow = castShadow;
          cf.benchesMesh.castShadow = castShadow;
        }
        if (cf.isNearLOD !== wantNearLOD) {
          cf.isNearLOD = wantNearLOD;
          if (wantNearLOD) {
            activeNearStoneCircles.add(cf);
            if (sharedStoneCircleGeo && sharedStoneCircleMat) {
              cf.stoneCircleMesh.geometry = sharedStoneCircleGeo;
              cf.stoneCircleMesh.material = sharedStoneCircleMat;
              cf.benchesMesh.visible = false;
            }
          } else {
            activeNearStoneCircles.delete(cf);
            const assets = getSharedLandmarkAssets();
            cf.stoneCircleMesh.geometry = assets.stoneCircleSimpleGeo;
            cf.stoneCircleMesh.material = assets.matMossStone;
            cf.benchesMesh.visible = true;
          }
        }

        if (dSq < 50 * 50) {
          const flicker = 0.9 + Math.sin(elapsedTime * 9.0 + cf.worldPos.z) * 0.16;
          cf.flameMesh.scale.set(0.55, 0.55 * flicker, 0.55);
          cf.flameMesh.updateMatrix();
          cf.flameMesh.matrixWorld.multiplyMatrices(cf.root.matrixWorld, cf.flameMesh.matrix);
        }

        if (dSq <= 4.0 * 4.0 && elapsedTime - cf.lastBuffTime > 12.0) {
          cf.lastBuffTime = elapsedTime;
          const wasActive = this.campfireBuffTimer > 50.0;
          this.campfireBuffTimer = 60.0;
          if (!wasActive) {
            this.playCampfireChime();
            this.onGrantGoldAndRefreshStreak(
              50,
              '🔥 Stone Circle Blessing! +20% Speed & Jump (60s) +50 Gold'
            );
          }
        }
      }
    }
  }

  private igniteWatchtower(wt: WatchtowerInstance): void {
    const assets = getSharedLandmarkAssets();
    wt.lit = true;
    wt.flameMesh.visible = true;
    wt.skyBeamMesh.visible = true;
    wt.ringMesh.material = assets.matRingLit;

    const waypoint: SavedBeaconWaypoint = {
      id: wt.id,
      name: `🔥 ${wt.name}`,
      x: Math.round(wt.worldPos.x),
      y: Math.round(wt.worldPos.y),
      z: Math.round(wt.worldPos.z),
    };
    this.litBeaconMap.set(wt.id, waypoint);
    this.renderWaypointBar();
    this.playBeaconFanfare();
    this.onGrantGoldAndRefreshStreak(
      150,
      `🔥 ${wt.name} Lit! Waypoint Unlocked (+150 Gold)`
    );
    this.onBeaconLit?.(waypoint);
  }

  private spawnLandmarksForChunk(cx: number, cz: number, chunkKey: number): void {
    const size = this.config.chunkSize;
    const chunkSeed = ((cx * 92837111) ^ (cz * 51293847) ^ (this.config.seed + 313)) >>> 0;
    const rng = createSeededRandom(chunkSeed);

    const landmarks: ChunkLandmarks = { bridges: [] };

    // 1. Check for Wooden River Bridges where footpaths cross water
    if (this.config.enableTracks && this.config.enableWater) {
      for (let s = -1; s <= 1; s += 2) {
        const sampleX = cx * size + s * (size * 0.24);
        const sampleZ = cz * size + (rng() - 0.5) * (size * 0.45);
        const distToTrack = this.noise.getTrackDistance(sampleX, sampleZ);
        if (distToTrack < 4.5) {
          const wy = this.noise.getHeight(sampleX, sampleZ);
          if (wy < this.config.waterLevel - 0.15 && wy > this.config.waterLevel - 2.6) {
            const heading = this.noise.getTrackHeading(sampleX, sampleZ);
            const deckY = this.config.waterLevel + 0.55;
            landmarks.bridges.push(this.buildBridge(sampleX, deckY, sampleZ, heading));
            break;
          }
        }
      }
    }

    // 2. Spawn a starter Stone Circle Campfire in chunk (0, 0) or ~18% of outer chunks
    const isStarterCampChunk = cx === 0 && cz === 0;
    const isStarterTowerChunk = cx === 1 && cz === -1;

    if (isStarterCampChunk || (!isStarterTowerChunk && rng() < 0.16)) {
      const lx = isStarterCampChunk ? -11.5 : (rng() - 0.5) * (size * 0.65);
      const lz = isStarterCampChunk ? -14.0 : (rng() - 0.5) * (size * 0.65);
      const wx = cx * size + lx;
      const wz = cz * size + lz;
      const wy = this.noise.getHeight(wx, wz);

      if (!this.config.enableWater || wy > this.config.waterLevel + 1.2) {
        landmarks.campfire = this.buildStoneCircleCampfire(`${cx},${cz}`, wx, wy, wz);
      }
    }

    // 3. Spawn Hilltop Dwarven Watchtowers on high ridges (or guaranteed in chunk (1, -1))
    if (isStarterTowerChunk || ((Math.abs(cx) + Math.abs(cz) >= 2) && rng() < 0.22)) {
      let bestX = cx * size;
      let bestZ = cz * size;
      let bestY = -Infinity;

      // Sample 6 candidate points in chunk to pick the highest ridge peak
      for (let i = 0; i < 6; i++) {
        const tx = cx * size + (rng() - 0.5) * (size * 0.72);
        const tz = cz * size + (rng() - 0.5) * (size * 0.72);
        const ty = this.noise.getHeight(tx, tz);
        if (ty > bestY) {
          bestY = ty;
          bestX = tx;
          bestZ = tz;
        }
      }

      const minElev = isStarterTowerChunk ? this.config.waterLevel + 2.5 : 8.5;
      if (bestY >= minElev) {
        const id = `wt_${cx}_${cz}`;
        const nameIdx = Math.abs(cx * 7 + cz * 13) % WATCHTOWER_NAMES.length;
        const name = WATCHTOWER_NAMES[nameIdx];
        const isAlreadyLit = this.litBeaconMap.has(id);
        landmarks.watchtower = this.buildWatchtower(id, name, bestX, bestY, bestZ, isAlreadyLit);
      }
    }

    this.activeLandmarks.set(chunkKey, landmarks);
  }

  private buildWatchtower(
    id: string,
    name: string,
    wx: number,
    wy: number,
    wz: number,
    isLit: boolean
  ): WatchtowerInstance {
    const assets = getSharedLandmarkAssets();
    const root = new THREE.Group();
    root.position.set(wx, wy, wz);
    root.updateMatrix();
    root.matrixAutoUpdate = false;

    const structureMesh = new THREE.Mesh(assets.watchtowerSimpleGeo, assets.matStone);
    structureMesh.castShadow = false;
    structureMesh.receiveShadow = true;
    structureMesh.matrixAutoUpdate = false;
    root.add(structureMesh);

    const brazierMesh = new THREE.Mesh(assets.brazierGeo, assets.matBrazier);
    brazierMesh.castShadow = false;
    brazierMesh.matrixAutoUpdate = false;
    root.add(brazierMesh);

    const flameMesh = new THREE.Mesh(assets.flameGeo, assets.matFlame);
    flameMesh.visible = isLit;
    flameMesh.matrixAutoUpdate = false;
    root.add(flameMesh);

    const skyBeamMesh = new THREE.Mesh(assets.skyBeamGeo, assets.matSkyBeam);
    skyBeamMesh.visible = isLit;
    skyBeamMesh.matrixAutoUpdate = false;
    root.add(skyBeamMesh);

    const ringMesh = new THREE.Mesh(
      assets.ringGeo,
      isLit ? assets.matRingLit : assets.matRingUnlit
    );
    ringMesh.position.y = 0.78;
    ringMesh.updateMatrix();
    ringMesh.matrixAutoUpdate = false;
    root.add(ringMesh);

    this.group.add(root);
    root.updateMatrixWorld(true);

    return {
      id,
      name,
      worldPos: new THREE.Vector3(wx, wy, wz),
      lit: isLit,
      root,
      structureMesh,
      brazierMesh,
      flameMesh,
      skyBeamMesh,
      ringMesh,
      isNearLOD: false,
    };
  }

  private buildStoneCircleCampfire(
    id: string,
    wx: number,
    wy: number,
    wz: number
  ): CampfireInstance {
    const assets = getSharedLandmarkAssets();
    const root = new THREE.Group();
    root.position.set(wx, wy, wz);
    root.updateMatrix();
    root.matrixAutoUpdate = false;

    const stoneCircleMesh = new THREE.Mesh(assets.stoneCircleSimpleGeo, assets.matMossStone);
    stoneCircleMesh.castShadow = false;
    stoneCircleMesh.receiveShadow = true;
    stoneCircleMesh.matrixAutoUpdate = false;
    root.add(stoneCircleMesh);

    const benchesMesh = new THREE.Mesh(assets.logBenchesGeo, assets.matTimber);
    benchesMesh.castShadow = false;
    benchesMesh.receiveShadow = true;
    benchesMesh.matrixAutoUpdate = false;
    root.add(benchesMesh);

    const flameMesh = new THREE.Mesh(assets.flameGeo, assets.matFlame);
    flameMesh.position.set(0, -0.35, 0);
    flameMesh.scale.setScalar(0.55);
    flameMesh.updateMatrix();
    flameMesh.matrixAutoUpdate = false;
    root.add(flameMesh);

    const glowRing = new THREE.Mesh(assets.ringGeo, assets.matCampfireRing);
    glowRing.position.y = 0.08;
    glowRing.scale.setScalar(0.85);
    glowRing.updateMatrix();
    glowRing.matrixAutoUpdate = false;
    root.add(glowRing);

    this.group.add(root);
    root.updateMatrixWorld(true);

    return {
      id,
      worldPos: new THREE.Vector3(wx, wy, wz),
      root,
      stoneCircleMesh,
      benchesMesh,
      flameMesh,
      glowRing,
      isNearLOD: false,
      lastBuffTime: -999,
    };
  }

  private buildBridge(wx: number, deckY: number, wz: number, heading: number): BridgeInstance {
    const assets = getSharedLandmarkAssets();
    const root = new THREE.Group();
    root.position.set(wx, deckY, wz);
    root.rotation.y = heading;
    root.updateMatrix();
    root.matrixAutoUpdate = false;

    const deck = new THREE.Mesh(assets.bridgeDeckGeo, assets.matTimber);
    deck.castShadow = true;
    deck.receiveShadow = true;
    deck.matrixAutoUpdate = false;
    root.add(deck);

    const railL = new THREE.Mesh(assets.bridgeRailGeo, assets.matTimber);
    railL.position.set(-1.68, 0, 0);
    railL.castShadow = true;
    railL.updateMatrix();
    railL.matrixAutoUpdate = false;
    root.add(railL);

    const railR = new THREE.Mesh(assets.bridgeRailGeo, assets.matTimber);
    railR.position.set(1.68, 0, 0);
    railR.castShadow = true;
    railR.updateMatrix();
    railR.matrixAutoUpdate = false;
    root.add(railR);

    this.group.add(root);
    root.updateMatrixWorld(true);

    return {
      worldX: wx,
      worldZ: wz,
      deckY,
      cosH: Math.cos(heading),
      sinH: Math.sin(heading),
      halfLen: 7.2,
      halfWidth: 1.95,
      root,
    };
  }

  public rebuildAll(): void {
    activeNearWatchtowers.clear();
    activeNearStoneCircles.clear();
    for (const lm of this.activeLandmarks.values()) {
      if (lm.watchtower) this.group.remove(lm.watchtower.root);
      if (lm.campfire) this.group.remove(lm.campfire.root);
      for (const b of lm.bridges) this.group.remove(b.root);
    }
    this.activeLandmarks.clear();
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
  }

  private showToast(text: string, isHighlight: boolean): void {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `pickup-toast ${isHighlight ? 'rare' : ''}`;
    toast.textContent = text;
    this.toastContainer.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 2400);
  }

  private ensureAudio(): AudioContext | null {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  private playBeaconFanfare(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [293.66, 440.0, 587.33, 880.0];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);

      gain.gain.setValueAtTime(0.001, now + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.16, now + idx * 0.09 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.48);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.5);
    });
  }

  private playCampfireChime(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [392.0, 493.88, 587.33];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.001, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.38);
    });
  }
}
