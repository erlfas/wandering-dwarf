import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getSharedAudioContext } from '../player/RelicStore';
import { WorldConfig } from './Config';
import { ChunkManager } from './ChunkManager';
import { TerrainNoise, createSeededRandom } from './TerrainNoise';
import { TreasureManager } from './TreasureManager';
import { getFrontierTier } from './TrollCombatManager';

interface TrailCoinInstance {
  id: string;
  worldPos: THREE.Vector3;
  baseY: number;
  phase: number;
  collected: boolean;
  collectAnim: number;
  root: THREE.Group;
  coinMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
}

interface CheckpointRingSpec {
  worldPos: THREE.Vector3;
  yaw: number;
}

interface ActiveCheckpointRing {
  index: number;
  worldPos: THREE.Vector3;
  passed: boolean;
  root: THREE.Group;
  torusMesh: THREE.Mesh;
  innerRingMesh: THREE.Mesh;
}

interface TrialArchInstance {
  id: string;
  cx: number;
  cz: number;
  worldPos: THREE.Vector3;
  yaw: number;
  completed: boolean;
  cooldown: number;
  ringSpecs: CheckpointRingSpec[];
  root: THREE.Group;
  portalRingMesh: THREE.Mesh;
  crestMesh: THREE.Mesh;
}

interface SharedChallengeAssets {
  coinGeo: THREE.CylinderGeometry;
  coinRingGeo: THREE.RingGeometry;
  matCoinGold: THREE.MeshStandardMaterial;
  matCoinRing: THREE.MeshBasicMaterial;
  archStoneMergedGeo: THREE.BufferGeometry;
  archCapGeo: THREE.BoxGeometry;
  archCrestGeo: THREE.OctahedronGeometry;
  archPortalGeo: THREE.TorusGeometry;
  checkpointTorusGeo: THREE.TorusGeometry;
  checkpointInnerGeo: THREE.RingGeometry;
  matArchStone: THREE.MeshStandardMaterial;
  matArchRuneTrim: THREE.MeshStandardMaterial;
  matPortalReady: THREE.MeshBasicMaterial;
  matPortalActive: THREE.MeshBasicMaterial;
  matPortalCompleted: THREE.MeshBasicMaterial;
  matRingNext: THREE.MeshBasicMaterial;
  matRingUpcoming: THREE.MeshBasicMaterial;
  matRingInnerNext: THREE.MeshBasicMaterial;
}

let sharedChallengeAssets: SharedChallengeAssets | null = null;

function getSharedChallengeAssets(): SharedChallengeAssets {
  if (sharedChallengeAssets) return sharedChallengeAssets;

  // 1. Glowing Footpath Coin geometries & materials
  const coinGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 14);
  coinGeo.rotateX(Math.PI / 2);

  const coinRingGeo = new THREE.RingGeometry(0.28, 0.44, 16);
  coinRingGeo.rotateX(-Math.PI / 2);

  const matCoinGold = new THREE.MeshStandardMaterial({
    color: 0xffd633,
    roughness: 0.22,
    metalness: 0.85,
    emissive: 0xd98a00,
    emissiveIntensity: 0.65,
  });

  const matCoinRing = new THREE.MeshBasicMaterial({
    color: 0xffe169,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.48,
  });

  // 2. Glowing Runic Stone Trial Archway geometries & materials
  const leftPillarGeo = new THREE.BoxGeometry(0.58, 3.4, 0.58);
  leftPillarGeo.translate(-1.45, 1.7, 0);

  const rightPillarGeo = new THREE.BoxGeometry(0.58, 3.4, 0.58);
  rightPillarGeo.translate(1.45, 1.7, 0);

  const archLintelGeo = new THREE.BoxGeometry(3.8, 0.52, 0.72);
  archLintelGeo.translate(0, 3.55, 0);

  const archStoneMergedGeo = mergeGeometries([leftPillarGeo, rightPillarGeo, archLintelGeo], false);
  leftPillarGeo.dispose();
  rightPillarGeo.dispose();
  archLintelGeo.dispose();
  archStoneMergedGeo.computeBoundingBox();
  archStoneMergedGeo.computeBoundingSphere();

  const archCapGeo = new THREE.BoxGeometry(3.2, 0.3, 0.55);
  archCapGeo.translate(0, 3.92, 0);

  const archCrestGeo = new THREE.OctahedronGeometry(0.36, 0);
  archCrestGeo.scale(0.85, 1.35, 0.85);

  const archPortalGeo = new THREE.TorusGeometry(1.42, 0.07, 10, 28);

  // 3. Hillside Checkpoint Ring geometries & materials
  const checkpointTorusGeo = new THREE.TorusGeometry(1.75, 0.11, 10, 28);
  const checkpointInnerGeo = new THREE.RingGeometry(1.38, 1.62, 24);

  const matArchStone = new THREE.MeshStandardMaterial({
    color: 0x5c6470,
    roughness: 0.82,
    metalness: 0.15,
  });

  const matArchRuneTrim = new THREE.MeshStandardMaterial({
    color: 0x38e2ff,
    roughness: 0.25,
    metalness: 0.7,
    emissive: 0x00b4d8,
    emissiveIntensity: 0.9,
  });

  const matPortalReady = new THREE.MeshBasicMaterial({
    color: 0x38e2ff,
    transparent: true,
    opacity: 0.78,
  });

  const matPortalActive = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.9,
  });

  const matPortalCompleted = new THREE.MeshBasicMaterial({
    color: 0x52b788,
    transparent: true,
    opacity: 0.55,
  });

  const matRingNext = new THREE.MeshBasicMaterial({
    color: 0x38ff9c,
    transparent: true,
    opacity: 0.92,
  });

  const matRingUpcoming = new THREE.MeshBasicMaterial({
    color: 0x38e2ff,
    transparent: true,
    opacity: 0.42,
  });

  const matRingInnerNext = new THREE.MeshBasicMaterial({
    color: 0xffe66d,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });

  sharedChallengeAssets = {
    coinGeo,
    coinRingGeo,
    matCoinGold,
    matCoinRing,
    archStoneMergedGeo,
    archCapGeo,
    archCrestGeo,
    archPortalGeo,
    checkpointTorusGeo,
    checkpointInnerGeo,
    matArchStone,
    matArchRuneTrim,
    matPortalReady,
    matPortalActive,
    matPortalCompleted,
    matRingNext,
    matRingUpcoming,
    matRingInnerNext,
  };

  return sharedChallengeAssets;
}

/**
 * Manages:
 * 1. Glowing Footpath Coin Trails along dirt tracks that build & sustain the 2x / 3x / 5x Gold Streak.
 * 2. Timed Waypoint Ring Sprint Challenges triggered by stepping through Glowing Stone Trial Arches.
 */
export class ChallengeManager {
  public readonly group = new THREE.Group();
  public onChallengeStateChange?: (active: boolean) => void;

  private activeCoins = new Map<number, TrailCoinInstance[]>();
  private openingCoins: TrailCoinInstance[] = [];
  private collectedCoinIds = new Set<string>();

  private activeArches = new Map<number, TrialArchInstance[]>();
  private completedArchIds = new Set<string>();
  private desiredKeys = new Set<number>();

  // Active Timed Ring Sprint Challenge state
  private currentTrialArch: TrialArchInstance | null = null;
  private activeRings: ActiveCheckpointRing[] = [];
  private currentRingIndex = 0;
  private trialTimer = 0;
  private readonly initialTrialSeconds = 20.0;
  private readonly maxAbandonDistance = 30.0;

  // Guiding particle stream toward the active Checkpoint Ring during a Trial
  private readonly guideCount = 20;
  private guidePoints!: THREE.Points;
  private guidePosAttr!: THREE.BufferAttribute;
  private guidePhase = new Float32Array(20);
  private guideParticlesVisible = false;

  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;
  private lastActiveChunkCount = -1;
  private coinPitchStep = 0;
  private coinPitchResetTimer = 0;
  private getSurfaceHeightFn?: (wx: number, wz: number) => number;
  private chunkManager?: ChunkManager;

  private challengeBannerEl: HTMLElement | null;
  private toastContainer: HTMLElement | null;
  private lastBannerDone = -1;
  private lastBannerTenths = -1;
  private bannerVisible = false;

  constructor(
    private config: WorldConfig,
    private noise: TerrainNoise,
    private treasureManager: TreasureManager
  ) {
    this.group.matrixAutoUpdate = false;
    this.challengeBannerEl = document.getElementById('challenge-banner');
    this.toastContainer = document.getElementById('pickup-toasts');
    this.buildTrialGuideParticles();
  }

  private buildTrialGuideParticles(): void {
    const positions = new Float32Array(this.guideCount * 3);
    for (let i = 0; i < this.guideCount; i++) {
      positions[i * 3 + 1] = -9999;
      this.guidePhase[i] = i / this.guideCount;
    }
    const geo = new THREE.BufferGeometry();
    this.guidePosAttr = new THREE.BufferAttribute(positions, 3);
    this.guidePosAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.guidePosAttr);

    const mat = new THREE.PointsMaterial({
      color: 0x38ff9c,
      size: 0.3,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.guidePoints = new THREE.Points(geo, mat);
    this.guidePoints.frustumCulled = false;
    this.group.add(this.guidePoints);
  }

  public setSurfaceHeightSampler(fn: (wx: number, wz: number) => number): void {
    this.getSurfaceHeightFn = fn;
  }

  public setChunkManager(chunkManager: ChunkManager): void {
    this.chunkManager = chunkManager;
  }

  public isChallengeActive(): boolean {
    return this.currentTrialArch !== null;
  }

  public getCompletedCount(): number {
    return this.completedArchIds.size;
  }

  private sampleGroundHeight(wx: number, wz: number): number {
    return this.getSurfaceHeightFn ? this.getSurfaceHeightFn(wx, wz) : this.noise.getHeight(wx, wz);
  }

  private getKey(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  public update(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    hasLodestone = false
  ): void {
    if (this.coinPitchResetTimer > 0) {
      this.coinPitchResetTimer = Math.max(0, this.coinPitchResetTimer - dt);
      if (this.coinPitchResetTimer <= 0) {
        this.coinPitchStep = 0;
      }
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

          if (!this.activeCoins.has(key)) {
            this.spawnChunkChallenges(cx, cz, key);
          }
        }
      }

      for (const [key, coins] of this.activeCoins.entries()) {
        if (!desiredKeys.has(key)) {
          for (const c of coins) {
            if (!c.collected) {
              this.group.remove(c.root);
            }
          }
          this.activeCoins.delete(key);
        }
      }

      for (const [key, arches] of this.activeArches.entries()) {
        if (!desiredKeys.has(key)) {
          for (const arch of arches) {
            this.group.remove(arch.root);
          }
          this.activeArches.delete(key);
        }
      }
    }

    // Reconcile archways, checkpoint rings, and coins whenever ChunkManager finishes building a queued chunk
    // so no Trial Archway or Ring ever overlaps a newly streamed Dwarven Hut or tree collider!
    if (this.chunkManager) {
      const activeChunks = this.chunkManager.getActiveChunkCount();
      if (activeChunks !== this.lastActiveChunkCount) {
        this.lastActiveChunkCount = activeChunks;
        this.reconcileChallengesWithLoadedChunks();
      }
    }

    // 1. Update Glowing Footpath Coin Trails
    const pickupRadius = hasLodestone ? 2.4 : 1.75;
    const pickupSq = pickupRadius * pickupRadius;
    const magnetSq = hasLodestone ? 7.8 * 7.8 : 0;
    const maxVisibleSq = 115 * 115;

    for (const coins of this.activeCoins.values()) {
      for (const coin of coins) {
        if (coin.collected) continue;

        const dx = playerPos.x - coin.worldPos.x;
        const dz = playerPos.z - coin.worldPos.z;
        const dSq = dx * dx + dz * dz;

        const isVisible = dSq < maxVisibleSq;
        if (coin.root.visible !== isVisible) {
          coin.root.visible = isVisible;
        }
        if (!isVisible) continue;

        // Magnetic pull toward dwarf when Lodestone Runes are unlocked
        if (hasLodestone && dSq < magnetSq && dSq > pickupSq) {
          const dist = Math.sqrt(dSq);
          const step = Math.min(dist, dt * 13.5);
          coin.worldPos.x += (dx / dist) * step;
          coin.worldPos.z += (dz / dist) * step;
          coin.baseY = this.sampleGroundHeight(coin.worldPos.x, coin.worldPos.z);
          coin.worldPos.y = coin.baseY;
          coin.root.position.set(coin.worldPos.x, coin.baseY, coin.worldPos.z);
          coin.root.updateMatrix();
          coin.root.matrixWorld.multiplyMatrices(this.group.matrixWorld, coin.root.matrix);
          coin.ringMesh.matrixWorld.multiplyMatrices(coin.root.matrixWorld, coin.ringMesh.matrix);
        }

        // Spin & bob animation (distance-gated to 45m)
        if (dSq < 45 * 45) {
          coin.coinMesh.rotation.y = elapsedTime * 3.2 + coin.phase;
          coin.coinMesh.position.y = 0.68 + Math.sin(elapsedTime * 4.0 + coin.phase) * 0.1;
          coin.coinMesh.updateMatrix();
          coin.coinMesh.matrixWorld.multiplyMatrices(coin.root.matrixWorld, coin.coinMesh.matrix);
        }

        if (dSq <= pickupSq) {
          this.collectCoin(coin, hasLodestone);
        }
      }
    }

    // Animate collected coins popping upward
    for (let i = this.openingCoins.length - 1; i >= 0; i--) {
      const c = this.openingCoins[i];
      c.collectAnim += dt;
      const t = c.collectAnim;
      c.coinMesh.position.y = 0.68 + t * 3.8;
      c.coinMesh.rotation.y += dt * 14.0;
      const scale = Math.max(0.001, 1.0 - t * 3.2);
      c.coinMesh.scale.setScalar(scale);
      c.coinMesh.updateMatrix();
      c.coinMesh.matrixWorld.multiplyMatrices(c.root.matrixWorld, c.coinMesh.matrix);

      if (t >= 0.32) {
        this.group.remove(c.root);
        this.openingCoins.splice(i, 1);
      }
    }

    // 2. Update Glowing Stone Trial Arches
    for (const arches of this.activeArches.values()) {
      for (const arch of arches) {
        if (arch.cooldown > 0) {
          arch.cooldown = Math.max(0, arch.cooldown - dt);
        }

        const dx = playerPos.x - arch.worldPos.x;
        const dz = playerPos.z - arch.worldPos.z;
        const dSq = dx * dx + dz * dz;

        const isVisible = dSq < maxVisibleSq;
        if (arch.root.visible !== isVisible) {
          arch.root.visible = isVisible;
        }
        if (!isVisible) continue;

        // Rotate floating crest & pulse portal ring (distance-gated to 60m)
        if (dSq < 60 * 60) {
          arch.crestMesh.rotation.y = elapsedTime * 2.0;
          arch.crestMesh.position.y = 4.55 + Math.sin(elapsedTime * 3.0 + arch.cx) * 0.12;
          arch.crestMesh.updateMatrix();
          arch.crestMesh.matrixWorld.multiplyMatrices(
            arch.root.matrixWorld,
            arch.crestMesh.matrix
          );

          const portalScale = 1.0 + Math.sin(elapsedTime * 3.8) * 0.04;
          arch.portalRingMesh.scale.setScalar(portalScale);
          arch.portalRingMesh.updateMatrix();
          arch.portalRingMesh.matrixWorld.multiplyMatrices(
            arch.root.matrixWorld,
            arch.portalRingMesh.matrix
          );
        }

        // Trigger Timed Waypoint Ring Challenge when stepping through the Stone Archway!
        if (!this.currentTrialArch && arch.cooldown <= 0 && dSq <= 2.35 * 2.35) {
          this.startRingChallenge(arch);
        }
      }
    }

    // 3. Update Active Timed Waypoint Ring Sprint Challenge
    this.updateActiveRingChallenge(dt, elapsedTime, playerPos, hasLodestone);
  }

  private collectCoin(coin: TrailCoinInstance, hasLodestone: boolean): void {
    coin.collected = true;
    coin.ringMesh.visible = false;
    this.collectedCoinIds.add(coin.id);
    this.openingCoins.push(coin);

    const prevMult = this.treasureManager.getStreakMultiplier();
    this.treasureManager.collectTrailCoin(15, hasLodestone);
    const newMult = this.treasureManager.getStreakMultiplier();

    this.playCoinChime();

    if (newMult > prevMult) {
      this.showToast(`🔥 ${newMult}x Gold Streak Activated!`, newMult >= 3.0);
    }
  }

  private startRingChallenge(arch: TrialArchInstance): void {
    this.clearActiveRings();
    this.currentTrialArch = arch;
    this.currentRingIndex = 0;
    this.trialTimer = this.initialTrialSeconds;

    const assets = getSharedChallengeAssets();
    arch.portalRingMesh.material = assets.matPortalActive;

    for (let i = 0; i < arch.ringSpecs.length; i++) {
      const spec = arch.ringSpecs[i];
      const root = new THREE.Group();
      root.position.copy(spec.worldPos);
      root.rotation.y = spec.yaw;
      root.updateMatrix();
      root.matrixAutoUpdate = false;

      const isFirst = i === 0;
      const torusMesh = new THREE.Mesh(
        assets.checkpointTorusGeo,
        isFirst ? assets.matRingNext : assets.matRingUpcoming
      );
      torusMesh.position.y = 1.85;
      torusMesh.updateMatrix();
      torusMesh.matrixAutoUpdate = false;
      root.add(torusMesh);

      const innerRingMesh = new THREE.Mesh(assets.checkpointInnerGeo, assets.matRingInnerNext);
      innerRingMesh.position.y = 1.85;
      innerRingMesh.visible = isFirst;
      innerRingMesh.updateMatrix();
      innerRingMesh.matrixAutoUpdate = false;
      root.add(innerRingMesh);

      this.group.add(root);
      root.updateMatrixWorld(true);

      this.activeRings.push({
        index: i,
        worldPos: spec.worldPos.clone(),
        passed: false,
        root,
        torusMesh,
        innerRingMesh,
      });
    }

    this.playChallengeStartFanfare();
    this.onChallengeStateChange?.(true);

    const frontier = getFrontierTier(arch.worldPos.x, arch.worldPos.z, this.config.chunkSize);
    const trialSeconds = frontier.ring === 3 ? 16.0 : frontier.ring === 2 ? 18.0 : 20.0;
    this.trialTimer = trialSeconds;
    const toastMsg =
      frontier.ring === 3
        ? '🏔️ Shattered Peaks Precision Slalom! Pass 5 Rings in 16s!'
        : frontier.ring === 2
          ? '🌲 Highland Slalom Trial! Pass 5 Steep Rings in 18s!'
          : '⏱️ Hearthlands Ring Sprint! Pass 5 Rings in 20s!';
    this.showToast(toastMsg, true);
    this.syncChallengeBanner();
  }

  private updateActiveRingChallenge(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    hasLodestone: boolean
  ): void {
    if (!this.currentTrialArch || this.activeRings.length === 0) {
      this.hideGuideParticles();
      return;
    }

    // If the dwarf simply walks away from the course or drops far down a cliff, end the run immediately
    const targetRing = this.activeRings[this.currentRingIndex];
    const distToCourse = this.getDistanceToChallenge(playerPos);
    const vertDist = targetRing ? Math.abs(playerPos.y - targetRing.worldPos.y) : 0;
    if (distToCourse >= this.maxAbandonDistance || vertDist > 22.0) {
      this.abandonChallenge(true);
      return;
    }

    this.trialTimer = Math.max(0, this.trialTimer - dt);
    if (this.trialTimer <= 0) {
      const failedArch = this.currentTrialArch;
      failedArch.cooldown = 4.0;
      failedArch.portalRingMesh.material = getSharedChallengeAssets().matPortalReady;
      this.clearActiveRings();
      this.showToast('⏳ Ring Sprint Time Expired! Step through Arch to retry.', false);
      this.syncChallengeBanner();
      return;
    }

    const assets = getSharedChallengeAssets();

    // Animate active rings
    for (let i = this.currentRingIndex; i < this.activeRings.length; i++) {
      const ring = this.activeRings[i];
      const isTarget = i === this.currentRingIndex;
      const pulse = isTarget
        ? 1.0 + Math.sin(elapsedTime * 6.0) * 0.08
        : 1.0 + Math.sin(elapsedTime * 3.0 + i) * 0.03;
      ring.torusMesh.scale.setScalar(pulse);
      ring.torusMesh.updateMatrix();
      if (isTarget) {
        ring.innerRingMesh.rotation.z = elapsedTime * 2.5;
        ring.innerRingMesh.updateMatrix();
      }
      ring.root.updateMatrixWorld(true);
    }

    // Check if dwarf passed through the current target ring
    if (targetRing) {
      const dx = playerPos.x - targetRing.worldPos.x;
      const dz = playerPos.z - targetRing.worldPos.z;
      const dSq = dx * dx + dz * dz;

      this.updateGuideParticles(dt, elapsedTime, playerPos, targetRing.worldPos);

      if (dSq <= 3.35 * 3.35) {
        targetRing.passed = true;
        this.group.remove(targetRing.root);
        this.currentRingIndex += 1;

        const totalRings = this.activeRings.length;
        if (this.currentRingIndex < totalRings) {
          // Highlight next ring
          const nextRing = this.activeRings[this.currentRingIndex];
          nextRing.torusMesh.material = assets.matRingNext;
          nextRing.innerRingMesh.visible = true;

          // Add +3.0s bonus time & +50 base gold
          this.trialTimer = Math.min(25.0, this.trialTimer + 3.0);
          this.playRingPassChord(this.currentRingIndex);
          this.treasureManager.grantChallengeReward(
            50,
            hasLodestone,
            `🌀 Ring ${this.currentRingIndex}/${totalRings} (+3s)!`,
            true,
            false
          );
        } else {
          // Completed all 5 Checkpoint Rings!
          const arch = this.currentTrialArch;
          arch.completed = true;
          arch.cooldown = 8.0;
          this.completedArchIds.add(arch.id);
          arch.portalRingMesh.material = assets.matPortalCompleted;

          this.playChallengeVictoryFanfare();
          const frontier = getFrontierTier(arch.worldPos.x, arch.worldPos.z, this.config.chunkSize);
          const rewardGold = frontier.ring === 3 ? 950 : frontier.ring === 2 ? 650 : 400;
          const rewardTitle =
            frontier.ring === 3
              ? '🏆 Shattered Peaks Champion Chest (+950g)!'
              : frontier.ring === 2
                ? '🏆 Highland Slalom Champion Chest (+650g)!'
                : '🏆 Ring Sprint Champion Chest (+400g)!';
          this.treasureManager.grantChallengeReward(
            rewardGold,
            hasLodestone,
            rewardTitle,
            true,
            true
          );
          this.clearActiveRings();
        }
      }
    }

    this.syncChallengeBanner();
  }

  private updateGuideParticles(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    targetPos: THREE.Vector3
  ): void {
    const posArr = this.guidePosAttr.array as Float32Array;
    const dx = targetPos.x - playerPos.x;
    const dz = targetPos.z - playerPos.z;
    const dist = Math.max(0.01, Math.hypot(dx, dz));
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const perpX = -dirZ;
    const perpZ = dirX;

    for (let i = 0; i < this.guideCount; i++) {
      const phase = (this.guidePhase[i] + dt * 0.75) % 1.0;
      this.guidePhase[i] = phase;
      const along = 1.2 + phase * Math.min(dist * 0.9, 18.0);
      const wave = Math.sin(elapsedTime * 5.0 + i * 0.8) * 0.35;
      const wx = playerPos.x + dirX * along + perpX * wave;
      const wz = playerPos.z + dirZ * along + perpZ * wave;
      const wy =
        Math.max(this.sampleGroundHeight(wx, wz), this.config.waterLevel) +
        1.15 +
        Math.sin(elapsedTime * 4.0 + i) * 0.22;

      posArr[i * 3] = wx;
      posArr[i * 3 + 1] = wy;
      posArr[i * 3 + 2] = wz;
    }
    this.guideParticlesVisible = true;
    this.guidePosAttr.needsUpdate = true;
  }

  private hideGuideParticles(): void {
    if (!this.guideParticlesVisible) return;
    this.guideParticlesVisible = false;
    const posArr = this.guidePosAttr.array as Float32Array;
    for (let i = 0; i < this.guideCount; i++) {
      posArr[i * 3 + 1] = -9999;
    }
    this.guidePosAttr.needsUpdate = true;
  }

  private getHorizontalDistanceToSegment(
    px: number,
    pz: number,
    ax: number,
    az: number,
    bx: number,
    bz: number
  ): number {
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 0.0001) {
      return Math.hypot(px - ax, pz - az);
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
    const projX = ax + t * dx;
    const projZ = az + t * dz;
    return Math.hypot(px - projX, pz - projZ);
  }

  public getDistanceToChallenge(playerPos: THREE.Vector3): number {
    if (!this.currentTrialArch || this.activeRings.length === 0) return 0;

    const targetRing = this.activeRings[this.currentRingIndex];
    if (!targetRing) return 0;

    const legStartPos =
      this.currentRingIndex === 0
        ? this.currentTrialArch.worldPos
        : this.currentTrialArch.ringSpecs[this.currentRingIndex - 1].worldPos;

    // Horizontal distance to the current active course leg segment
    let minDist = this.getHorizontalDistanceToSegment(
      playerPos.x,
      playerPos.z,
      legStartPos.x,
      legStartPos.z,
      targetRing.worldPos.x,
      targetRing.worldPos.z
    );

    // Also compare against all upcoming rings on the sprint path
    for (let i = this.currentRingIndex + 1; i < this.activeRings.length; i++) {
      const ring = this.activeRings[i];
      const d = Math.hypot(playerPos.x - ring.worldPos.x, playerPos.z - ring.worldPos.z);
      if (d < minDist) {
        minDist = d;
      }
    }

    return minDist;
  }

  /**
   * Ends an active challenge (e.g. when the player walks away from the course
   * or enters an interior). Clears rings, resets archway, hides the banner,
   * stops special music, and returns the world to ambient exploration.
   */
  public abandonChallenge(showToastMessage = true): void {
    if (!this.currentTrialArch) return;
    const arch = this.currentTrialArch;
    arch.cooldown = 4.0;
    arch.portalRingMesh.material = getSharedChallengeAssets().matPortalReady;
    this.clearActiveRings();
    this.syncChallengeBanner();
    if (showToastMessage) {
      this.showToast('🏃 Ring Sprint Ended — Walked away from challenge.', false);
    }
  }

  private clearActiveRings(): void {
    const wasActive = this.currentTrialArch !== null;
    for (const r of this.activeRings) {
      this.group.remove(r.root);
    }
    this.activeRings.length = 0;
    this.currentTrialArch = null;
    this.currentRingIndex = 0;
    this.trialTimer = 0;
    this.hideGuideParticles();
    if (wasActive) {
      this.onChallengeStateChange?.(false);
    }
  }

  private syncChallengeBanner(): void {
    if (!this.challengeBannerEl) return;
    if (!this.currentTrialArch || this.activeRings.length === 0) {
      if (this.bannerVisible) {
        this.bannerVisible = false;
        this.lastBannerDone = -1;
        this.lastBannerTenths = -1;
        this.challengeBannerEl.classList.add('hidden');
      }
      return;
    }
    const total = this.activeRings.length;
    const done = this.currentRingIndex;
    const tenths = Math.round(this.trialTimer * 10);
    if (done !== this.lastBannerDone || tenths !== this.lastBannerTenths) {
      this.lastBannerDone = done;
      this.lastBannerTenths = tenths;
      this.challengeBannerEl.textContent = `⏱️ Ring Sprint: ${done} / ${total} Rings • ${(tenths * 0.1).toFixed(1)}s`;
    }
    if (!this.bannerVisible) {
      this.bannerVisible = true;
      this.challengeBannerEl.classList.remove('hidden');
    }
  }

  private spawnChunkChallenges(cx: number, cz: number, chunkKey: number): void {
    const size = this.config.chunkSize;
    const chunkSeed = ((cx * 92837111) ^ (cz * 689287499) ^ (this.config.seed + 4099)) >>> 0;
    const rng = createSeededRandom(chunkSeed);

    const coins: TrailCoinInstance[] = [];
    const arches: TrialArchInstance[] = [];
    const assets = getSharedChallengeAssets();
    if (this.noise.isInsideVolcanoBarrenZone(cx * size, cz * size)) {
      this.activeCoins.set(chunkKey, coins);
      this.activeArches.set(chunkKey, arches);
      return;
    }

    // A. Spawn Glowing Footpath Coin Trails along dirt paths
    const isStartChunk = cx === 0 && cz === 0;
    if (isStartChunk || rng() < 0.65) {
      // Find a point on or near a footpath in this chunk
      let anchorX = 0;
      let anchorZ = 0;
      let foundTrack = false;
      for (let attempt = 0; attempt < 14; attempt++) {
        const lx = isStartChunk && attempt === 0 ? 3.5 : (rng() - 0.5) * (size * 0.72);
        const lz = isStartChunk && attempt === 0 ? -4.5 : (rng() - 0.5) * (size * 0.72);
        const wx = cx * size + lx;
        const wz = cz * size + lz;
        if (this.noise.isInsideVolcanoBarrenZone(wx, wz)) continue;
        const wy = this.sampleGroundHeight(wx, wz);

        if (this.config.enableWater && wy < this.config.waterLevel + 0.5) continue;
        const trackW = this.noise.getTrackWeight(wx, wz, wy);
        if (isStartChunk || trackW > 0.35 || attempt === 13) {
          anchorX = wx;
          anchorZ = wz;
          foundTrack = true;
          break;
        }
      }

      if (foundTrack) {
        // March along the footpath direction to place 5-6 coins in a graceful curve
        let curX = anchorX;
        let curZ = anchorZ;
        let heading = rng() * Math.PI * 2;
        const coinCount = 5;

        for (let i = 0; i < coinCount; i++) {
          const coinId = `coin_${cx}_${cz}_${i}`;
          if (!this.collectedCoinIds.has(coinId) && !this.noise.isInsideVolcanoBarrenZone(curX, curZ)) {
            const coinPos = new THREE.Vector3(curX, 0, curZ);
            this.chunkManager?.resolveStructureClearance(coinPos, 5.2, 1.1);
            const wy = this.sampleGroundHeight(coinPos.x, coinPos.z);
            coinPos.y = wy;
            if (!this.config.enableWater || wy >= this.config.waterLevel + 0.35) {
              const root = new THREE.Group();
              root.position.set(coinPos.x, wy, coinPos.z);
              root.updateMatrix();
              root.matrixAutoUpdate = false;

              const coinMesh = new THREE.Mesh(assets.coinGeo, assets.matCoinGold);
              coinMesh.position.y = 0.68;
              coinMesh.castShadow = false;
              coinMesh.updateMatrix();
              coinMesh.matrixAutoUpdate = false;
              root.add(coinMesh);

              const ringMesh = new THREE.Mesh(assets.coinRingGeo, assets.matCoinRing);
              ringMesh.position.y = 0.06;
              ringMesh.updateMatrix();
              ringMesh.matrixAutoUpdate = false;
              root.add(ringMesh);

              this.group.add(root);
              root.updateMatrixWorld(true);

              coins.push({
                id: coinId,
                worldPos: coinPos,
                baseY: wy,
                phase: i * 0.55,
                collected: false,
                collectAnim: 0,
                root,
                coinMesh,
                ringMesh,
              });
            }
          }

          // Steer next coin step toward highest local footpath weight
          let bestAngle = heading;
          let bestWeight = -1;
          for (let s = -2; s <= 2; s++) {
            const testAngle = heading + s * 0.28;
            const tx = curX + Math.cos(testAngle) * 3.4;
            const tz = curZ + Math.sin(testAngle) * 3.4;
            const ty = this.sampleGroundHeight(tx, tz);
            const w = this.noise.getTrackWeight(tx, tz, ty);
            if (w > bestWeight) {
              bestWeight = w;
              bestAngle = testAngle;
            }
          }
          heading = bestAngle;
          curX += Math.cos(heading) * 3.4;
          curZ += Math.sin(heading) * 3.4;
        }
      }
    }

    // B. Spawn Glowing Stone Trial Archway for Timed Waypoint Ring Sprint Challenges
    const isStarterArchChunk = cx === 0 && cz === -1;
    const shouldSpawnArch = isStarterArchChunk || (((cx + cz) & 1) === 0 && rng() < 0.28);

    if (shouldSpawnArch) {
      const archId = `arch_${cx}_${cz}`;
      const lx = isStarterArchChunk ? -6.0 : (rng() - 0.5) * (size * 0.55);
      const lz = isStarterArchChunk ? 12.0 : (rng() - 0.5) * (size * 0.55);
      const archPos = new THREE.Vector3(cx * size + lx, 0, cz * size + lz);
      this.chunkManager?.resolveStructureClearance(archPos, 10.5, 2.8);
      const wx = archPos.x;
      const wz = archPos.z;
      const wy = this.sampleGroundHeight(wx, wz);
      archPos.y = wy;

      if (
        !this.noise.isInsideVolcanoBarrenZone(wx, wz) &&
        (!this.config.enableWater || wy > this.config.waterLevel + 1.5)
      ) {
        // Orient the archway toward a downhill or scenic trail direction
        let bestYaw = rng() * Math.PI * 2;
        let lowestY = Infinity;
        for (let a = 0; a < 8; a++) {
          const testYaw = (a * Math.PI) / 4;
          const tx = wx + Math.sin(testYaw) * 24;
          const tz = wz + Math.cos(testYaw) * 24;
          const ty = this.sampleGroundHeight(tx, tz);
          if (ty < lowestY && (!this.config.enableWater || ty > this.config.waterLevel + 0.8)) {
            lowestY = ty;
            bestYaw = testYaw;
          }
        }

        // Build 5 Checkpoint Ring specifications leading away from the archway
        const ringSpecs: CheckpointRingSpec[] = [];
        let rx = wx;
        let rz = wz;
        let curYaw = bestYaw;
        for (let rIdx = 0; rIdx < 5; rIdx++) {
          curYaw += (rng() - 0.5) * 0.32;
          const stepDist = 14.5;
          rx += Math.sin(curYaw) * stepDist;
          rz += Math.cos(curYaw) * stepDist;
          const rPos = new THREE.Vector3(rx, 0, rz);
          this.chunkManager?.resolveStructureClearance(rPos, 8.5, 2.2);
          rx = rPos.x;
          rz = rPos.z;
          const ry = Math.max(
            this.sampleGroundHeight(rx, rz),
            this.config.enableWater ? this.config.waterLevel + 0.4 : -999
          );
          rPos.y = ry;
          ringSpecs.push({
            worldPos: rPos,
            yaw: curYaw,
          });
        }

        const isCompleted = this.completedArchIds.has(archId);
        const root = new THREE.Group();
        root.position.set(wx, wy, wz);
        root.rotation.y = bestYaw;
        root.updateMatrix();
        root.matrixAutoUpdate = false;

        const stoneMesh = new THREE.Mesh(assets.archStoneMergedGeo, assets.matArchStone);
        stoneMesh.castShadow = true;
        stoneMesh.receiveShadow = true;
        stoneMesh.matrixAutoUpdate = false;
        root.add(stoneMesh);

        const cap = new THREE.Mesh(assets.archCapGeo, assets.matArchRuneTrim);
        cap.updateMatrix();
        cap.matrixAutoUpdate = false;
        root.add(cap);

        const portalRingMesh = new THREE.Mesh(
          assets.archPortalGeo,
          isCompleted ? assets.matPortalCompleted : assets.matPortalReady
        );
        portalRingMesh.position.y = 1.75;
        portalRingMesh.updateMatrix();
        portalRingMesh.matrixAutoUpdate = false;
        root.add(portalRingMesh);

        const crestMesh = new THREE.Mesh(assets.archCrestGeo, assets.matArchRuneTrim);
        crestMesh.position.y = 4.55;
        crestMesh.updateMatrix();
        crestMesh.matrixAutoUpdate = false;
        root.add(crestMesh);

        this.group.add(root);
        root.updateMatrixWorld(true);

        arches.push({
          id: archId,
          cx,
          cz,
          worldPos: archPos,
          yaw: bestYaw,
          completed: isCompleted,
          cooldown: 0,
          ringSpecs,
          root,
          portalRingMesh,
          crestMesh,
        });
      }
    }

    this.activeCoins.set(chunkKey, coins);
    this.activeArches.set(chunkKey, arches);
  }

  /**
   * Re-checks all active Trial Archways, Checkpoint Rings, and Footpath Coins against newly
   * built terrain chunks so nothing ever overlaps a Dwarven Hut, its front doorway ring, or a tree.
   */
  private reconcileChallengesWithLoadedChunks(): void {
    if (!this.chunkManager) return;

    for (const arches of this.activeArches.values()) {
      for (const arch of arches) {
        if (this.chunkManager.resolveStructureClearance(arch.worldPos, 10.5, 2.8)) {
          arch.worldPos.y = this.sampleGroundHeight(arch.worldPos.x, arch.worldPos.z);
          arch.root.position.copy(arch.worldPos);
          arch.root.updateMatrix();
          arch.root.updateMatrixWorld(true);
        }
        for (const spec of arch.ringSpecs) {
          if (this.chunkManager.resolveStructureClearance(spec.worldPos, 8.5, 2.2)) {
            spec.worldPos.y = Math.max(
              this.sampleGroundHeight(spec.worldPos.x, spec.worldPos.z),
              this.config.enableWater ? this.config.waterLevel + 0.4 : -999
            );
          }
        }
      }
    }

    for (const ring of this.activeRings) {
      if (this.chunkManager.resolveStructureClearance(ring.worldPos, 8.5, 2.2)) {
        ring.worldPos.y = Math.max(
          this.sampleGroundHeight(ring.worldPos.x, ring.worldPos.z),
          this.config.enableWater ? this.config.waterLevel + 0.4 : -999
        );
        ring.root.position.copy(ring.worldPos);
        ring.root.updateMatrix();
        ring.root.updateMatrixWorld(true);
      }
    }

    for (const coins of this.activeCoins.values()) {
      for (const c of coins) {
        if (c.collected) continue;
        if (this.chunkManager.resolveStructureClearance(c.worldPos, 5.2, 1.1)) {
          c.baseY = this.sampleGroundHeight(c.worldPos.x, c.worldPos.z);
          c.worldPos.y = c.baseY;
          c.root.position.set(c.worldPos.x, c.baseY, c.worldPos.z);
          c.root.updateMatrix();
          c.root.updateMatrixWorld(true);
        }
      }
    }
  }

  public rebuildAll(): void {
    this.clearActiveRings();
    this.syncChallengeBanner();

    for (const c of this.openingCoins) {
      this.group.remove(c.root);
    }
    this.openingCoins.length = 0;

    for (const coins of this.activeCoins.values()) {
      for (const c of coins) {
        this.group.remove(c.root);
      }
    }
    this.activeCoins.clear();

    for (const arches of this.activeArches.values()) {
      for (const a of arches) {
        this.group.remove(a.root);
      }
    }
    this.activeArches.clear();

    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
    this.lastActiveChunkCount = -1;
  }

  public reset(): void {
    this.collectedCoinIds.clear();
    this.completedArchIds.clear();
    this.rebuildAll();
  }

  private showToast(text: string, isHighlight: boolean): void {
    if (!this.toastContainer) return;
    while (this.toastContainer.children.length >= 3) {
      this.toastContainer.firstElementChild?.remove();
    }
    const toast = document.createElement('div');
    toast.className = `pickup-toast ${isHighlight ? 'rare' : ''}`;
    toast.textContent = text;
    this.toastContainer.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 2300);
  }

  private ensureAudio(): AudioContext | null {
    return getSharedAudioContext();
  }

  private playCoinChime(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5];
    const freq = scale[this.coinPitchStep % scale.length];
    this.coinPitchStep = Math.min(scale.length - 1, this.coinPitchStep + 1);
    this.coinPitchResetTimer = 4.5;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.25, now + 0.14);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.015);
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

  private playChallengeStartFanfare(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [440.0, 554.37, 659.25];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      gain.gain.setValueAtTime(0.001, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.07 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.32);
    });
  }

  private playRingPassChord(ringNumber: number): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const baseFreq = 440.0 * Math.pow(1.12, ringNumber);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, now + 0.22);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
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

  private playChallengeVictoryFanfare(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.001, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.42);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.45);
    });
  }
}
