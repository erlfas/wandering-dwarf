import * as THREE from 'three';
import { WorldConfig } from './Config';
import { createSeededRandom, TerrainNoise } from './TerrainNoise';

interface RunestoneNode {
  index: number;
  worldPos: THREE.Vector3;
  activated: boolean;
  mesh: THREE.Group;
  crystalMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
}

interface ChestInstance {
  id: string;
  cx: number;
  cz: number;
  worldPos: THREE.Vector3;
  points: number;
  isRare: boolean;
  isMythic: boolean;
  sealed: boolean;
  runestones: RunestoneNode[];
  root: THREE.Group;
  lidPivot: THREE.Group;
  goldMound: THREE.Mesh;
  glowRing: THREE.Mesh;
  sealDome?: THREE.Mesh;
  state: 'idle' | 'opening' | 'collected';
  animTime: number;
  sparkles?: THREE.Points;
}

interface BuriedDigSite {
  worldPos: THREE.Vector3;
  points: number;
  root: THREE.Group;
  ringMesh: THREE.Mesh;
  beamMesh: THREE.Mesh;
}

interface SharedChestAssets {
  matWoodStandard: THREE.MeshStandardMaterial;
  matWoodRare: THREE.MeshStandardMaterial;
  matWoodMythic: THREE.MeshStandardMaterial;
  matTrimStandard: THREE.MeshStandardMaterial;
  matTrimRare: THREE.MeshStandardMaterial;
  matTrimMythic: THREE.MeshStandardMaterial;
  matGoldInside: THREE.MeshStandardMaterial;
  ringMatStandard: THREE.MeshBasicMaterial;
  ringMatRare: THREE.MeshBasicMaterial;
  ringMatMythic: THREE.MeshBasicMaterial;
  matSealDome: THREE.MeshBasicMaterial;
  matRunestonePillar: THREE.MeshStandardMaterial;
  matCrystalDormant: THREE.MeshStandardMaterial;
  matCrystalActive: THREE.MeshStandardMaterial;
  matDigRing: THREE.MeshBasicMaterial;
  matDigBeam: THREE.MeshBasicMaterial;
  baseWoodGeo: THREE.BufferGeometry;
  baseTrimGeo: THREE.BufferGeometry;
  lidWoodGeo: THREE.BufferGeometry;
  lidTrimGeo: THREE.BufferGeometry;
  goldGeo: THREE.BufferGeometry;
  ringGeo: THREE.BufferGeometry;
  sealDomeGeo: THREE.BufferGeometry;
  runestonePillarGeo: THREE.BufferGeometry;
  runestoneCrystalGeo: THREE.BufferGeometry;
  runestoneRingGeo: THREE.BufferGeometry;
  digBeamGeo: THREE.BufferGeometry;
  sparklesGeo: THREE.BufferGeometry;
  sparklesMat: THREE.PointsMaterial;
}

let sharedAssets: SharedChestAssets | null = null;
const tempChestNormal = new THREE.Vector3();

function mergeBufferGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;

  for (const geo of geometries) {
    const pos = geo.getAttribute('position');
    totalVerts += pos.count;
    const index = geo.getIndex();
    totalIndices += index ? index.count : pos.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalIndices);

  let vertOffset = 0;
  let indexOffset = 0;

  for (const geo of geometries) {
    const pos = geo.getAttribute('position');
    const norm = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    const count = pos.count;

    positions.set(pos.array as Float32Array, vertOffset * 3);
    if (norm) {
      normals.set(norm.array as Float32Array, vertOffset * 3);
    }
    if (uv) {
      uvs.set(uv.array as Float32Array, vertOffset * 2);
    }

    const index = geo.getIndex();
    if (index) {
      const idxArray = index.array;
      for (let i = 0; i < index.count; i++) {
        indices[indexOffset + i] = idxArray[i] + vertOffset;
      }
      indexOffset += index.count;
    } else {
      for (let i = 0; i < count; i++) {
        indices[indexOffset + i] = vertOffset + i;
      }
      indexOffset += count;
    }

    vertOffset += count;
    geo.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

function getSharedChestAssets(): SharedChestAssets {
  if (sharedAssets) return sharedAssets;

  const matWoodStandard = new THREE.MeshStandardMaterial({
    color: 0x6e4223,
    roughness: 0.78,
    metalness: 0.08,
  });
  const matWoodRare = new THREE.MeshStandardMaterial({
    color: 0x6b2d26,
    roughness: 0.78,
    metalness: 0.08,
  });
  const matWoodMythic = new THREE.MeshStandardMaterial({
    color: 0x242038,
    roughness: 0.55,
    metalness: 0.35,
  });

  const matTrimStandard = new THREE.MeshStandardMaterial({
    color: 0xd4a238,
    roughness: 0.3,
    metalness: 0.82,
    emissive: 0x241700,
    emissiveIntensity: 0.4,
  });
  const matTrimRare = new THREE.MeshStandardMaterial({
    color: 0xffd147,
    roughness: 0.3,
    metalness: 0.82,
    emissive: 0x4a3200,
    emissiveIntensity: 0.4,
  });
  const matTrimMythic = new THREE.MeshStandardMaterial({
    color: 0x5ce1e6,
    roughness: 0.22,
    metalness: 0.88,
    emissive: 0x16697a,
    emissiveIntensity: 0.75,
  });

  const matGoldInside = new THREE.MeshStandardMaterial({
    color: 0xffdf4f,
    roughness: 0.25,
    metalness: 0.9,
    emissive: 0x664800,
    emissiveIntensity: 0.6,
  });

  const ringMatStandard = new THREE.MeshBasicMaterial({
    color: 0xffe066,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.45,
  });
  const ringMatRare = new THREE.MeshBasicMaterial({
    color: 0xffae00,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.45,
  });
  const ringMatMythic = new THREE.MeshBasicMaterial({
    color: 0x48cae4,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.62,
  });

  const matSealDome = new THREE.MeshBasicMaterial({
    color: 0x48cae4,
    wireframe: true,
    transparent: true,
    opacity: 0.38,
  });

  const matRunestonePillar = new THREE.MeshStandardMaterial({
    color: 0x5c646d,
    roughness: 0.85,
    metalness: 0.12,
  });

  const matCrystalDormant = new THREE.MeshStandardMaterial({
    color: 0x3b4d5e,
    roughness: 0.4,
    metalness: 0.5,
    emissive: 0x0d1b2a,
    emissiveIntensity: 0.3,
  });

  const matCrystalActive = new THREE.MeshStandardMaterial({
    color: 0x72efdd,
    roughness: 0.18,
    metalness: 0.8,
    emissive: 0x00b4d8,
    emissiveIntensity: 1.1,
  });

  const matDigRing = new THREE.MeshBasicMaterial({
    color: 0xff595e,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.72,
  });

  const matDigBeam = new THREE.MeshBasicMaterial({
    color: 0xffca3a,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });

  // Base wood geometry
  const baseWoodGeo = new THREE.BoxGeometry(0.92, 0.48, 0.62);
  baseWoodGeo.translate(0, 0.24, 0);

  // Base trim straps merged into 1 geometry
  const strapLGeo = new THREE.BoxGeometry(0.1, 0.5, 0.66);
  strapLGeo.translate(-0.34, 0.24, 0);
  const strapRGeo = new THREE.BoxGeometry(0.1, 0.5, 0.66);
  strapRGeo.translate(0.34, 0.24, 0);
  const baseTrimGeo = mergeBufferGeometries([strapLGeo, strapRGeo]);

  // Gold mound inside base
  const goldGeo = new THREE.SphereGeometry(0.36, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  goldGeo.scale(1.15, 0.45, 0.72);
  goldGeo.translate(0, 0.42, 0);

  // Lid wood geometry (lidBox + lidArch merged in lidPivot space)
  const lidBoxGeo = new THREE.BoxGeometry(0.92, 0.16, 0.62);
  lidBoxGeo.translate(0, 0.08, 0.31);

  const lidArchGeo = new THREE.CylinderGeometry(0.31, 0.31, 0.92, 12, 1, false, 0, Math.PI);
  lidArchGeo.scale(1, 0.72, 1);
  lidArchGeo.rotateZ(Math.PI / 2);
  lidArchGeo.translate(0, 0.14, 0.31);
  const lidWoodGeo = mergeBufferGeometries([lidBoxGeo, lidArchGeo]);

  // Lid trim geometry (lidStrapL + lidStrapR + lockPlate merged in lidPivot space)
  const lidStrapLGeo = new THREE.BoxGeometry(0.11, 0.28, 0.66);
  lidStrapLGeo.translate(-0.34, 0.14, 0.31);
  const lidStrapRGeo = new THREE.BoxGeometry(0.11, 0.28, 0.66);
  lidStrapRGeo.translate(0.34, 0.14, 0.31);
  const lockPlateGeo = new THREE.BoxGeometry(0.18, 0.24, 0.06);
  lockPlateGeo.translate(0, 0.02, 0.63);
  const lidTrimGeo = mergeBufferGeometries([lidStrapLGeo, lidStrapRGeo, lockPlateGeo]);

  // Subtle ground glow ring
  const ringGeo = new THREE.RingGeometry(0.58, 0.82, 24);
  ringGeo.rotateX(-Math.PI / 2);

  // Protective Runic Seal Dome around locked Mythic Chests
  const sealDomeGeo = new THREE.SphereGeometry(0.88, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);

  // Standing Dwarven Runestone Pillar & Crystal Obelisk
  const runestonePillarGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.15, 6);
  runestonePillarGeo.translate(0, 0.575, 0);
  const runestoneCrystalGeo = new THREE.OctahedronGeometry(0.24, 0);
  runestoneCrystalGeo.scale(0.85, 1.45, 0.85);
  const runestoneRingGeo = new THREE.RingGeometry(0.45, 0.64, 18);
  runestoneRingGeo.rotateX(-Math.PI / 2);

  // Buried Treasure Dig Site Vertical Sky Beam
  const digBeamGeo = new THREE.CylinderGeometry(0.32, 0.85, 18.0, 12, 1, true);
  digBeamGeo.translate(0, 9.0, 0);

  // Shared sparkle burst geometry & material for chest pickups
  const sparkleCount = 24;
  const sparklePositions = new Float32Array(sparkleCount * 3);
  const sparkleRng = createSeededRandom(1337);
  for (let i = 0; i < sparkleCount; i++) {
    const angle = (i / sparkleCount) * Math.PI * 2;
    const r = 0.15 + sparkleRng() * 0.45;
    sparklePositions[i * 3] = Math.cos(angle) * r;
    sparklePositions[i * 3 + 1] = sparkleRng() * 0.6;
    sparklePositions[i * 3 + 2] = Math.sin(angle) * r;
  }
  const sparklesGeo = new THREE.BufferGeometry();
  sparklesGeo.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
  const sparklesMat = new THREE.PointsMaterial({
    color: 0xffe047,
    size: 0.22,
  });

  sharedAssets = {
    matWoodStandard,
    matWoodRare,
    matWoodMythic,
    matTrimStandard,
    matTrimRare,
    matTrimMythic,
    matGoldInside,
    ringMatStandard,
    ringMatRare,
    ringMatMythic,
    matSealDome,
    matRunestonePillar,
    matCrystalDormant,
    matCrystalActive,
    matDigRing,
    matDigBeam,
    baseWoodGeo,
    baseTrimGeo,
    lidWoodGeo,
    lidTrimGeo,
    goldGeo,
    ringGeo,
    sealDomeGeo,
    runestonePillarGeo,
    runestoneCrystalGeo,
    runestoneRingGeo,
    digBeamGeo,
    sparklesGeo,
    sparklesMat,
  };
  return sharedAssets;
}

function formatCompassDir(dx: number, dz: number): string {
  const angle = Math.atan2(dx, -dz); // 0 = North (-Z), PI/2 = East (+X)
  const octant = Math.round((angle * 4) / Math.PI + 8) % 8;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[octant];
}

export class TreasureManager {
  public readonly group = new THREE.Group();
  public score = 0;
  public chestsCollected = 0;
  public onChestCollected?: () => void;

  // Gold Combo Streak state
  public streakCount = 0;
  public streakTimer = 0;
  private readonly streakDuration = 45.0;

  private activeChests = new Map<number, ChestInstance[]>();
  private desiredKeys = new Set<number>();
  private collectedIds = new Set<string>();
  private cachedCollectedIds: string[] = [];
  private collectedIdsDirty = true;
  private openingChests: ChestInstance[] = [];
  private activeDigSite: BuriedDigSite | null = null;
  private audioCtx: AudioContext | null = null;
  private humCooldown = 0;

  // Diegetic Golden Firefly Guiding Stream (world-space Points)
  private readonly fireflyCount = 26;
  private fireflyPoints!: THREE.Points;
  private fireflyPosAttr!: THREE.BufferAttribute;
  private fireflyPhase = new Float32Array(26);

  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;
  private nearestResult = { dist: 0, pos: new THREE.Vector3(), label: '' };

  private scoreEl: HTMLElement | null;
  private countEl: HTMLElement | null;
  private badgeEl: HTMLElement | null;
  private streakEl: HTMLElement | null;
  private toastContainer: HTMLElement | null;
  private popTimer: number | null = null;

  constructor(
    private config: WorldConfig,
    private noise: TerrainNoise
  ) {
    this.group.matrixAutoUpdate = false;
    this.scoreEl = document.getElementById('score-value');
    this.countEl = document.getElementById('chests-value');
    this.badgeEl = document.getElementById('treasure-hud');
    this.streakEl = document.getElementById('streak-badge');
    this.toastContainer = document.getElementById('pickup-toasts');
    this.buildGuidingFireflies();
  }

  private buildGuidingFireflies(): void {
    const positions = new Float32Array(this.fireflyCount * 3);
    for (let i = 0; i < this.fireflyCount; i++) {
      positions[i * 3 + 1] = -9999;
      this.fireflyPhase[i] = i / this.fireflyCount;
    }
    const geo = new THREE.BufferGeometry();
    this.fireflyPosAttr = new THREE.BufferAttribute(positions, 3);
    this.fireflyPosAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.fireflyPosAttr);

    const mat = new THREE.PointsMaterial({
      color: 0xffe866,
      size: 0.26,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    this.fireflyPoints = new THREE.Points(geo, mat);
    this.fireflyPoints.frustumCulled = false;
    this.group.add(this.fireflyPoints);
  }

  private getKey(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  public getStreakMultiplier(): number {
    if (this.streakCount <= 1 || this.streakTimer <= 0) return 1.0;
    if (this.streakCount === 2) return 1.25;
    if (this.streakCount === 3) return 1.5;
    if (this.streakCount === 4) return 2.0;
    return 2.5;
  }

  /**
   * Builds a 3D stylized dwarven treasure chest (standard, rare, or Rune-Sealed Mythic).
   */
  private buildChestMesh(
    isRare: boolean,
    isMythic: boolean
  ): {
    root: THREE.Group;
    lidPivot: THREE.Group;
    goldMound: THREE.Mesh;
    glowRing: THREE.Mesh;
    sealDome?: THREE.Mesh;
  } {
    const assets = getSharedChestAssets();
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;

    const matWood = isMythic
      ? assets.matWoodMythic
      : isRare
        ? assets.matWoodRare
        : assets.matWoodStandard;
    const matTrim = isMythic
      ? assets.matTrimMythic
      : isRare
        ? assets.matTrimRare
        : assets.matTrimStandard;
    const ringMat = isMythic
      ? assets.ringMatMythic
      : isRare
        ? assets.ringMatRare
        : assets.ringMatStandard;

    const base = new THREE.Mesh(assets.baseWoodGeo, matWood);
    base.castShadow = true;
    base.receiveShadow = true;
    base.matrixAutoUpdate = false;
    root.add(base);

    const baseTrim = new THREE.Mesh(assets.baseTrimGeo, matTrim);
    baseTrim.matrixAutoUpdate = false;
    root.add(baseTrim);

    const goldMound = new THREE.Mesh(assets.goldGeo, assets.matGoldInside);
    goldMound.visible = false;
    goldMound.matrixAutoUpdate = false;
    root.add(goldMound);

    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.48, -0.31);
    lidPivot.updateMatrix();
    lidPivot.matrixAutoUpdate = false;
    root.add(lidPivot);

    const lidWood = new THREE.Mesh(assets.lidWoodGeo, matWood);
    lidWood.castShadow = true;
    lidWood.receiveShadow = true;
    lidWood.matrixAutoUpdate = false;
    lidPivot.add(lidWood);

    const lidTrim = new THREE.Mesh(assets.lidTrimGeo, matTrim);
    lidTrim.matrixAutoUpdate = false;
    lidPivot.add(lidTrim);

    const glowRing = new THREE.Mesh(assets.ringGeo, ringMat);
    glowRing.position.y = 0.08;
    glowRing.updateMatrix();
    glowRing.matrixAutoUpdate = false;
    root.add(glowRing);

    let sealDome: THREE.Mesh | undefined;
    if (isMythic) {
      sealDome = new THREE.Mesh(assets.sealDomeGeo, assets.matSealDome);
      sealDome.position.y = 0.05;
      sealDome.updateMatrix();
      sealDome.matrixAutoUpdate = false;
      root.add(sealDome);
    }

    return { root, lidPivot, goldMound, glowRing, sealDome };
  }

  private buildRunestoneMesh(wx: number, wy: number, wz: number, index: number): RunestoneNode {
    const assets = getSharedChestAssets();
    const group = new THREE.Group();
    group.position.set(wx, wy, wz);
    group.updateMatrix();
    group.matrixAutoUpdate = false;

    const pillar = new THREE.Mesh(assets.runestonePillarGeo, assets.matRunestonePillar);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    pillar.matrixAutoUpdate = false;
    group.add(pillar);

    const crystalMesh = new THREE.Mesh(assets.runestoneCrystalGeo, assets.matCrystalDormant);
    crystalMesh.position.set(0, 1.48, 0);
    crystalMesh.updateMatrix();
    crystalMesh.matrixAutoUpdate = false;
    group.add(crystalMesh);

    const ringMesh = new THREE.Mesh(assets.runestoneRingGeo, assets.ringMatMythic);
    ringMesh.position.set(0, 0.08, 0);
    ringMesh.updateMatrix();
    ringMesh.matrixAutoUpdate = false;
    group.add(ringMesh);

    this.group.add(group);
    group.updateMatrixWorld(true);

    return {
      index,
      worldPos: new THREE.Vector3(wx, wy, wz),
      activated: false,
      mesh: group,
      crystalMesh,
      ringMesh,
    };
  }

  /**
   * Synchronizes treasure chests, runestones, buried map caches, and guiding fireflies.
   */
  public update(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    hasLodestone = false
  ): void {
    // 1. Update Gold Streak Timer
    if (this.streakTimer > 0) {
      this.streakTimer = Math.max(0, this.streakTimer - dt);
      if (this.streakTimer <= 0) {
        this.streakCount = 0;
      }
      this.syncStreakHUD();
    }

    if (this.humCooldown > 0) {
      this.humCooldown = Math.max(0, this.humCooldown - dt);
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

          if (!this.activeChests.has(key)) {
            this.spawnChestsForChunk(cx, cz, key);
          }
        }
      }

      // Unload distant uncollected chests & their runestones outside chunk radius
      for (const [key, list] of this.activeChests.entries()) {
        if (!desiredKeys.has(key)) {
          for (const c of list) {
            if (c.state === 'idle') {
              this.group.remove(c.root);
            }
            for (const rs of c.runestones) {
              this.group.remove(rs.mesh);
            }
          }
          this.activeChests.delete(key);
        }
      }
    }

    // 2. Check Buried Map Dig Site proximity & animation
    if (this.activeDigSite) {
      const dig = this.activeDigSite;
      const dx = playerPos.x - dig.worldPos.x;
      const dz = playerPos.z - dig.worldPos.z;
      const dSq = dx * dx + dz * dz;

      const pulse = 1.0 + Math.sin(elapsedTime * 5.0) * 0.14;
      dig.ringMesh.scale.setScalar(pulse);
      dig.ringMesh.updateMatrix();
      dig.beamMesh.rotation.y = elapsedTime * 1.5;
      dig.beamMesh.updateMatrix();
      dig.root.updateMatrixWorld(true);

      if (dSq <= 2.8 * 2.8) {
        this.unearthBuriedCache(dig, hasLodestone);
      }
    }

    // 3. Check chest & runestone proximity
    const pickupRadius = hasLodestone ? 2.6 : 1.95;
    const pickupRadiusSq = pickupRadius * pickupRadius;
    const magnetRadiusSq = hasLodestone ? 8.5 * 8.5 : 0;
    const glowAnimRadiusSq = 48 * 48;
    const maxVisibleRadiusSq = 125 * 125;

    for (const list of this.activeChests.values()) {
      for (const chest of list) {
        if (chest.state !== 'idle') continue;

        const dx = playerPos.x - chest.worldPos.x;
        const dz = playerPos.z - chest.worldPos.z;
        const dSq = dx * dx + dz * dz;

        const isVisible = dSq < maxVisibleRadiusSq;
        if (chest.root.visible !== isVisible) {
          chest.root.visible = isVisible;
          for (const rs of chest.runestones) {
            rs.mesh.visible = isVisible;
          }
        }
        if (!isVisible) continue;

        // Check Runestone activations for sealed Mythic Chests
        if (chest.sealed) {
          let activeCount = 0;
          for (const rs of chest.runestones) {
            // Rotate floating runestone crystal
            rs.crystalMesh.rotation.y = elapsedTime * 2.2 + rs.index;
            rs.crystalMesh.position.y = 1.48 + Math.sin(elapsedTime * 3.0 + rs.index) * 0.08;
            rs.crystalMesh.updateMatrix();
            rs.crystalMesh.matrixWorld.multiplyMatrices(rs.mesh.matrixWorld, rs.crystalMesh.matrix);

            if (!rs.activated) {
              const rdx = playerPos.x - rs.worldPos.x;
              const rdz = playerPos.z - rs.worldPos.z;
              if (rdx * rdx + rdz * rdz <= 2.5 * 2.5) {
                rs.activated = true;
                rs.crystalMesh.material = getSharedChestAssets().matCrystalActive;
                activeCount += 1;
                const totalNow = chest.runestones.filter((n) => n.activated).length;
                this.playRunestoneChord(totalNow);
                this.showToast(`🪨 Runestone Awakened! (${totalNow}/3)`, false);
              }
            } else {
              activeCount += 1;
            }
          }

          if (activeCount === chest.runestones.length && chest.runestones.length > 0) {
            chest.sealed = false;
            if (chest.sealDome) {
              chest.sealDome.visible = false;
            }
            this.showToast('✨ Mythic Runic Chest Unsealed!', true);
          }
        }

        if (!chest.sealed && hasLodestone && dSq < magnetRadiusSq && dSq > pickupRadiusSq) {
          // Magnetically pull unsealed chest toward the dwarf when Lodestone Runes are equipped
          const dist = Math.sqrt(dSq);
          const pullStep = Math.min(dist, dt * 11.5);
          chest.worldPos.x += (dx / dist) * pullStep;
          chest.worldPos.z += (dz / dist) * pullStep;
          chest.worldPos.y = this.noise.getHeight(chest.worldPos.x, chest.worldPos.z);
          chest.root.position.copy(chest.worldPos);
          chest.root.updateMatrix();
          chest.root.updateMatrixWorld(true);
        }

        const showGlow = dSq < glowAnimRadiusSq;
        if (chest.glowRing.visible !== showGlow) {
          chest.glowRing.visible = showGlow;
        }
        if (showGlow) {
          const pulse = 1.0 + Math.sin(elapsedTime * 3.5 + chest.worldPos.x) * 0.08;
          chest.glowRing.scale.setScalar(pulse);
          chest.glowRing.updateMatrix();
          chest.glowRing.matrixWorld.multiplyMatrices(
            chest.root.matrixWorld,
            chest.glowRing.matrix
          );
        }

        if (dSq <= pickupRadiusSq) {
          if (chest.sealed) {
            if (this.humCooldown <= 0) {
              this.humCooldown = 2.0;
              const lit = chest.runestones.filter((r) => r.activated).length;
              this.showToast(`🔒 Sealed! Awaken nearby Runestones (${lit}/3)`, false);
            }
          } else {
            this.collectChest(chest, hasLodestone);
          }
        }
      }
    }

    // 4. Animate opening chests
    for (let i = this.openingChests.length - 1; i >= 0; i--) {
      const chest = this.openingChests[i];
      chest.animTime += dt;
      const t = chest.animTime;

      const lidAngle = -Math.min(1, t / 0.32) * (Math.PI * 0.62);
      chest.lidPivot.rotation.x = lidAngle;

      chest.glowRing.scale.setScalar(1.0 + t * 2.5);
      (chest.glowRing.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        0.5 * (1 - t * 1.2)
      );

      if (chest.sparkles) {
        chest.sparkles.position.y = 0.5 + t * 2.2;
        chest.sparkles.rotation.y = t * 3.0;
      }

      if (t > 1.1) {
        const shrink = Math.max(0.001, 1.0 - (t - 1.1) * 3.2);
        chest.root.scale.setScalar(shrink);
      }

      chest.root.updateMatrix();
      chest.lidPivot.updateMatrix();
      chest.glowRing.updateMatrix();
      chest.root.updateMatrixWorld(true);

      if (t >= 1.42) {
        this.disposeOpeningChestResources(chest);
        this.group.remove(chest.root);
        for (const rs of chest.runestones) {
          this.group.remove(rs.mesh);
        }
        chest.state = 'collected';
        this.openingChests.splice(i, 1);
      }
    }

    // 5. Update Diegetic Guiding Fireflies & Harmonic Proximity Hum
    this.updateGuidingFireflies(dt, elapsedTime, playerPos, hasLodestone);
  }

  private updateGuidingFireflies(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    hasLodestone: boolean
  ): void {
    const target = this.getNearestChest(playerPos);
    const maxGuideDist = hasLodestone ? 115 : 58;
    const posArr = this.fireflyPosAttr.array as Float32Array;

    if (!target || target.dist > maxGuideDist || target.dist < 2.2) {
      for (let i = 0; i < this.fireflyCount; i++) {
        posArr[i * 3 + 1] = -9999;
      }
      this.fireflyPosAttr.needsUpdate = true;
      return;
    }

    // Play a soft spatial harmonic hum when getting close (< 20m)
    if (target.dist < 20.0 && this.humCooldown <= 0) {
      this.humCooldown = THREE.MathUtils.clamp(target.dist * 0.22, 1.2, 3.8);
      this.playProximityHum(target.dist);
    }

    const dx = target.pos.x - playerPos.x;
    const dz = target.pos.z - playerPos.z;
    const dist = Math.max(0.01, target.dist);
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const perpX = -dirZ;
    const perpZ = dirX;
    const trailSpan = Math.min(dist * 0.85, 16.0);

    for (let i = 0; i < this.fireflyCount; i++) {
      let phase = (this.fireflyPhase[i] + dt * 0.42) % 1.0;
      this.fireflyPhase[i] = phase;

      const along = 1.4 + phase * trailSpan;
      const swirl = Math.sin(elapsedTime * 3.2 + i * 0.9) * (0.45 + phase * 0.65);
      const wx = playerPos.x + dirX * along + perpX * swirl;
      const wz = playerPos.z + dirZ * along + perpZ * swirl;
      const groundY = this.noise.getHeight(wx, wz);
      const wy =
        Math.max(groundY, this.config.waterLevel - 0.2) +
        0.85 +
        Math.sin(elapsedTime * 4.5 + i * 1.3) * 0.32;

      posArr[i * 3] = wx;
      posArr[i * 3 + 1] = wy;
      posArr[i * 3 + 2] = wz;
    }
    this.fireflyPosAttr.needsUpdate = true;
  }

  private disposeOpeningChestResources(chest: ChestInstance): void {
    const assets = getSharedChestAssets();
    const ringMat = chest.glowRing.material as THREE.Material;
    if (
      ringMat !== assets.ringMatStandard &&
      ringMat !== assets.ringMatRare &&
      ringMat !== assets.ringMatMythic
    ) {
      ringMat.dispose();
    }
  }

  private spawnChestsForChunk(cx: number, cz: number, chunkKey: number): void {
    const size = this.config.chunkSize;
    const chunkSeed = ((cx * 492876847) ^ (cz * 715225739) ^ (this.config.seed + 991)) >>> 0;
    const rng = createSeededRandom(chunkSeed);

    const list: ChestInstance[] = [];

    const isStartChunk = cx === 0 && cz === 0;
    const shouldSpawn = isStartChunk || rng() < 0.58;
    if (!shouldSpawn) {
      this.activeChests.set(chunkKey, list);
      return;
    }

    const count = isStartChunk ? 1 : rng() < 0.18 ? 2 : 1;

    for (let i = 0; i < count; i++) {
      const id = `${cx},${cz},${i}`;
      if (this.collectedIds.has(id)) continue;

      let placed = false;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        const lx = isStartChunk && attempt === 0 ? 7.5 : (rng() - 0.5) * (size * 0.78);
        const lz = isStartChunk && attempt === 0 ? -9.5 : (rng() - 0.5) * (size * 0.78);
        const wx = cx * size + lx;
        const wz = cz * size + lz;
        const wy = this.noise.getHeight(wx, wz);

        if (this.config.enableWater && wy < this.config.waterLevel + 0.9) {
          continue;
        }

        if (
          !isStartChunk &&
          this.config.enableTracks &&
          this.noise.getTrackWeight(wx, wz, wy) > 0.44
        ) {
          continue;
        }

        this.noise.getNormal(wx, wz, tempChestNormal);
        if (tempChestNormal.y < 0.82) continue;

        const roll = rng();
        const isMythic = !isStartChunk && i === 0 && roll < 0.2;
        const isRare = !isStartChunk && !isMythic && roll < 0.42;
        const points = isMythic ? 500 : isRare ? 250 : 100;

        const { root, lidPivot, goldMound, glowRing, sealDome } = this.buildChestMesh(
          isRare,
          isMythic
        );

        root.position.set(wx, wy, wz);
        root.rotation.y = rng() * Math.PI * 2;
        root.updateMatrix();
        this.group.add(root);
        root.updateMatrixWorld(true);

        const runestones: RunestoneNode[] = [];
        if (isMythic) {
          const baseAngle = rng() * Math.PI * 2;
          for (let rIdx = 0; rIdx < 3; rIdx++) {
            const rAngle = baseAngle + (rIdx * Math.PI * 2) / 3 + (rng() - 0.5) * 0.35;
            const rDist = 13.5 + rng() * 6.5;
            const rx = wx + Math.cos(rAngle) * rDist;
            const rz = wz + Math.sin(rAngle) * rDist;
            const ry = Math.max(
              this.noise.getHeight(rx, rz),
              this.config.enableWater ? this.config.waterLevel + 0.3 : -999
            );
            runestones.push(this.buildRunestoneMesh(rx, ry, rz, rIdx));
          }
        }

        list.push({
          id,
          cx,
          cz,
          worldPos: new THREE.Vector3(wx, wy, wz),
          points,
          isRare,
          isMythic,
          sealed: isMythic,
          runestones,
          root,
          lidPivot,
          goldMound,
          glowRing,
          sealDome,
          state: 'idle',
          animTime: 0,
        });
        placed = true;
      }
    }

    this.activeChests.set(chunkKey, list);
  }

  private collectChest(chest: ChestInstance, hasLodestone = false): void {
    chest.state = 'opening';
    chest.goldMound.visible = true;
    this.collectedIds.add(chest.id);
    this.collectedIdsDirty = true;

    // Advance Gold Streak Multiplier!
    this.streakCount = Math.min(5, this.streakCount + 1);
    this.streakTimer = this.streakDuration;
    const streakMult = this.getStreakMultiplier();
    const lodestoneMult = hasLodestone ? 1.5 : 1.0;
    const earnedPoints = Math.round(chest.points * lodestoneMult * streakMult);

    this.score += earnedPoints;
    this.chestsCollected += 1;

    chest.glowRing.material = (chest.glowRing.material as THREE.MeshBasicMaterial).clone();

    const assets = getSharedChestAssets();
    const sparkles = new THREE.Points(assets.sparklesGeo, assets.sparklesMat);
    sparkles.position.y = 0.5;
    chest.root.add(sparkles);
    chest.sparkles = sparkles;

    this.openingChests.push(chest);
    const labelPrefix = chest.isMythic
      ? '💎 Mythic Runic Chest!'
      : chest.isRare
        ? '★ Rare Dwarven Chest!'
        : '';
    this.updateHUD(earnedPoints, chest.isRare || chest.isMythic, labelPrefix);
    this.syncStreakHUD();
    this.playPickupChime(chest.isRare || chest.isMythic);

    // Chance to discover an Ancient Map Fragment leading to a Buried Relic Hoard!
    if (!this.activeDigSite && (this.chestsCollected === 1 || Math.random() < 0.38)) {
      this.spawnBuriedDigSite(chest.worldPos);
    }

    this.onChestCollected?.();
  }

  private spawnBuriedDigSite(originPos: THREE.Vector3): void {
    const assets = getSharedChestAssets();
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 52 + Math.random() * 32;
      const wx = originPos.x + Math.cos(angle) * dist;
      const wz = originPos.z + Math.sin(angle) * dist;
      const wy = this.noise.getHeight(wx, wz);

      if (this.config.enableWater && wy < this.config.waterLevel + 1.0) continue;

      const root = new THREE.Group();
      root.position.set(wx, wy, wz);
      root.updateMatrix();
      root.matrixAutoUpdate = false;

      const ringMesh = new THREE.Mesh(assets.runestoneRingGeo, assets.matDigRing);
      ringMesh.position.y = 0.12;
      ringMesh.scale.setScalar(1.8);
      ringMesh.updateMatrix();
      ringMesh.matrixAutoUpdate = false;
      root.add(ringMesh);

      const beamMesh = new THREE.Mesh(assets.digBeamGeo, assets.matDigBeam);
      beamMesh.matrixAutoUpdate = false;
      root.add(beamMesh);

      this.group.add(root);
      root.updateMatrixWorld(true);

      this.activeDigSite = {
        worldPos: new THREE.Vector3(wx, wy, wz),
        points: 400,
        root,
        ringMesh,
        beamMesh,
      };

      const dir = formatCompassDir(wx - originPos.x, wz - originPos.z);
      this.showToast(`🗺️ Map Found! Buried Hoard ${dist.toFixed(0)}m ${dir}!`, true);
      return;
    }
  }

  private unearthBuriedCache(dig: BuriedDigSite, hasLodestone: boolean): void {
    this.group.remove(dig.root);
    this.activeDigSite = null;

    this.streakCount = Math.min(5, this.streakCount + 1);
    this.streakTimer = this.streakDuration;
    const streakMult = this.getStreakMultiplier();
    const lodestoneMult = hasLodestone ? 1.5 : 1.0;
    const earned = Math.round(dig.points * lodestoneMult * streakMult);

    this.score += earned;
    this.chestsCollected += 1;
    this.updateHUD(earned, true, '🗺️ Buried Hoard Unearthed!');
    this.syncStreakHUD();
    this.playPickupChime(true);
    this.onChestCollected?.();
  }

  public spendGold(amount: number): boolean {
    if (this.score < amount) return false;
    this.score -= amount;
    this.syncHUDTotals();
    return true;
  }

  public grantBonusGold(amount: number, toastMessage: string): void {
    this.score = Math.max(0, this.score + amount);
    if (amount > 0 && this.streakCount > 0) {
      this.streakTimer = this.streakDuration;
    }
    this.syncHUDTotals();
    this.syncStreakHUD();
    this.showToast(toastMessage, amount >= 0);
    if (amount !== 0) {
      this.onChestCollected?.();
    }
  }

  private syncHUDTotals(): void {
    if (this.scoreEl) {
      this.scoreEl.textContent = this.score.toLocaleString();
    }
    if (this.countEl) {
      this.countEl.textContent = `${this.chestsCollected} Chest${this.chestsCollected === 1 ? '' : 's'}`;
    }
  }

  private syncStreakHUD(): void {
    if (!this.streakEl) return;
    const mult = this.getStreakMultiplier();
    if (mult > 1.0 && this.streakTimer > 0) {
      this.streakEl.textContent = `🔥 ${mult}x Streak (${Math.ceil(this.streakTimer)}s)`;
      this.streakEl.classList.remove('hidden');
    } else {
      this.streakEl.classList.add('hidden');
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
    }, 2300);
  }

  private updateHUD(addedPoints: number, isRare: boolean, customPrefix = ''): void {
    this.syncHUDTotals();

    if (this.badgeEl) {
      this.badgeEl.classList.add('pop');
      if (this.popTimer !== null) {
        window.clearTimeout(this.popTimer);
      }
      this.popTimer = window.setTimeout(() => {
        this.badgeEl?.classList.remove('pop');
        this.popTimer = null;
      }, 200);
    }

    const mult = this.getStreakMultiplier();
    const multTag = mult > 1.0 ? ` (${mult}x Streak!)` : '';
    const msg = customPrefix
      ? `${customPrefix} +${addedPoints} Gold${multTag}`
      : `+$${addedPoints} Gold${multTag}`.replace('+$', '+');
    this.showToast(msg, isRare);
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

  private playPickupChime(isRare: boolean): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = isRare ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.001, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.38);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.4);
    });
  }

  private playRunestoneChord(stepIndex: number): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const baseFreqs = [329.63, 440.0, 587.33];
    const freq = baseFreqs[(stepIndex - 1) % baseFreqs.length];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.32);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  private playProximityHum(dist: number): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const closeness = 1.0 - THREE.MathUtils.clamp(dist / 20.0, 0, 1);
    const freq = 392.0 + closeness * 260.0;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  /**
   * Finds the world position and diegetic status label of the nearest active treasure objective
   * (either a nearby unactivated Runestone, an active Map Dig Site, or the nearest Chest).
   */
  public getNearestChest(
    playerPos: THREE.Vector3
  ): { dist: number; pos: THREE.Vector3; label: string } | null {
    let bestDistSq = Infinity;
    let bestPos: THREE.Vector3 | null = null;
    let bestChest: ChestInstance | null = null;

    for (const list of this.activeChests.values()) {
      for (const c of list) {
        if (c.state !== 'idle') continue;
        const dx = c.worldPos.x - playerPos.x;
        const dz = c.worldPos.z - playerPos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestPos = c.worldPos;
          bestChest = c;
        }
      }
    }

    // If an active Buried Map Dig Site is closer or within 75m, prioritize guiding to it
    if (this.activeDigSite) {
      const ddx = this.activeDigSite.worldPos.x - playerPos.x;
      const ddz = this.activeDigSite.worldPos.z - playerPos.z;
      const digDistSq = ddx * ddx + ddz * ddz;
      if (digDistSq < bestDistSq || digDistSq < 85 * 85) {
        const dist = Math.sqrt(digDistSq);
        const dir = formatCompassDir(ddx, ddz);
        this.nearestResult.dist = dist;
        this.nearestResult.pos.copy(this.activeDigSite.worldPos);
        this.nearestResult.label = `🗺️ Map Hoard: ${dist.toFixed(0)}m ${dir}`;
        return this.nearestResult;
      }
    }

    if (!bestPos || !bestChest) return null;

    // If the nearest chest is a sealed Mythic Chest within 36m, guide to its nearest unlit Runestone
    if (bestChest.sealed && bestDistSq < 36 * 36) {
      let bestRune: RunestoneNode | null = null;
      let bestRuneDistSq = Infinity;
      let litCount = 0;
      for (const rs of bestChest.runestones) {
        if (rs.activated) {
          litCount += 1;
          continue;
        }
        const rdx = rs.worldPos.x - playerPos.x;
        const rdz = rs.worldPos.z - playerPos.z;
        const rSq = rdx * rdx + rdz * rdz;
        if (rSq < bestRuneDistSq) {
          bestRuneDistSq = rSq;
          bestRune = rs;
        }
      }
      if (bestRune) {
        const rDist = Math.sqrt(bestRuneDistSq);
        const dir = formatCompassDir(
          bestRune.worldPos.x - playerPos.x,
          bestRune.worldPos.z - playerPos.z
        );
        this.nearestResult.dist = rDist;
        this.nearestResult.pos.copy(bestRune.worldPos);
        this.nearestResult.label = `🪨 Runes (${litCount}/3) • ${rDist.toFixed(0)}m ${dir}`;
        return this.nearestResult;
      }
    }

    const dist = Math.sqrt(bestDistSq);
    const dir = formatCompassDir(bestPos.x - playerPos.x, bestPos.z - playerPos.z);
    this.nearestResult.dist = dist;
    this.nearestResult.pos.copy(bestPos);
    this.nearestResult.label = bestChest.isMythic
      ? `💎 Mythic: ${dist.toFixed(0)}m ${dir}`
      : `✨ ${dist.toFixed(0)}m ${dir}`;
    return this.nearestResult;
  }

  public rebuildAll(): void {
    for (const chest of this.openingChests) {
      this.disposeOpeningChestResources(chest);
      this.group.remove(chest.root);
      for (const rs of chest.runestones) {
        this.group.remove(rs.mesh);
      }
    }
    this.openingChests.length = 0;

    for (const list of this.activeChests.values()) {
      for (const c of list) {
        this.group.remove(c.root);
        for (const rs of c.runestones) {
          this.group.remove(rs.mesh);
        }
      }
    }
    this.activeChests.clear();
    if (this.activeDigSite) {
      this.group.remove(this.activeDigSite.root);
      this.activeDigSite = null;
    }
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
  }

  public getCollectedIds(): string[] {
    if (this.collectedIdsDirty) {
      this.cachedCollectedIds = Array.from(this.collectedIds);
      this.collectedIdsDirty = false;
    }
    return this.cachedCollectedIds;
  }

  public restoreProgress(
    score: number,
    chestsCollected: number,
    collectedIds: string[]
  ): void {
    this.score = Math.max(0, Math.floor(score));
    this.chestsCollected = Math.max(0, Math.floor(chestsCollected));
    this.collectedIds = new Set(collectedIds);
    this.collectedIdsDirty = true;
    this.syncHUDTotals();
    this.rebuildAll();
  }

  public resetProgress(): void {
    this.score = 0;
    this.chestsCollected = 0;
    this.streakCount = 0;
    this.streakTimer = 0;
    this.collectedIds.clear();
    this.collectedIdsDirty = true;
    this.syncHUDTotals();
    this.syncStreakHUD();
    this.rebuildAll();
  }
}
