import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import trollModelUrl from '../../3dmodels/troll-beast 3d model.glb?url';
import dwarfPunchHitSfxUrl from '../../music/sfx/dwarf_punch_hit.mp3?url';
import shieldBlockSfxUrl from '../../music/sfx/shield_block.mp3?url';
import trollClubSmashSfxUrl from '../../music/sfx/troll_club_smash.mp3?url';
import trollDefeatedSfxUrl from '../../music/sfx/troll_defeated.mp3?url';
import trollOminousPresenceSfxUrl from '../../music/sfx/troll_ominous_presence.mp3?url';
import trollRoarSfxUrl from '../../music/sfx/troll_roar.mp3?url';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { getSharedAudioContext } from '../player/RelicStore';
import { WorldConfig } from './Config';
import { createOptimizedGlbLoader } from './ForestField';

export const TROLL_MAX_HP = 320;
export const TROLL_WALK_SPEED = 2.6; // Slower than Dwarf walk (6.0 m/s)
export const TROLL_RUN_SPEED = 4.3;  // Slower than Dwarf walk (6.0 m/s) & run (10.5+ m/s) so Dwarf can always escape!

type TrollAnimState = 'walk' | 'run' | 'attack';

interface TrollInstance {
  id: string;
  title: string;
  active: boolean;
  hp: number;
  maxHp: number;
  pos: THREE.Vector3;
  homePos: THREE.Vector3;
  heading: number;
  patrolAngle: number;
  state: 'patrol' | 'chase' | 'attack' | 'stagger' | 'dying';
  attackTimer: number;
  attackCooldown: number;
  damageDealtInSwing: boolean;
  staggerTimer: number;
  hitFlashTimer: number;
  dyingTimer: number;
  roarCooldown: number;
  isNearLOD: boolean;
  castShadowEnabled: boolean;
  mixerAccum: number;
  root: THREE.Group;
  skinnedContainer: THREE.Group;
  skinnedMeshes: THREE.Mesh[];
  fallbackMesh: THREE.Mesh;
  hpBarGroup: THREE.Group;
  hpFillMesh: THREE.Mesh;
  hpFillMat: THREE.MeshBasicMaterial;
  targetRingMesh: THREE.Mesh;
  mixer: THREE.AnimationMixer | null;
  actions: Partial<Record<TrollAnimState, THREE.AnimationAction>>;
  currentAnim: TrollAnimState;
}

const TROLL_TITLES = [
  'Crag-Claw Mountain Troll',
  'Gloom-Fang Night Troll',
  'Iron-Hide Cave Troll',
];

let sharedTrollFallbackGeo: THREE.BufferGeometry | null = null;
let sharedTrollFallbackMat: THREE.MeshStandardMaterial | null = null;
let sharedTrollClubGeo: THREE.BufferGeometry | null = null;
let sharedTrollClubMat: THREE.MeshStandardMaterial | null = null;

function getSharedTrollFallbackAssets(): {
  fallbackGeo: THREE.BufferGeometry;
  fallbackMat: THREE.MeshStandardMaterial;
  clubGeo: THREE.BufferGeometry;
  clubMat: THREE.MeshStandardMaterial;
} {
  if (
    sharedTrollFallbackGeo &&
    sharedTrollFallbackMat &&
    sharedTrollClubGeo &&
    sharedTrollClubMat
  ) {
    return {
      fallbackGeo: sharedTrollFallbackGeo,
      fallbackMat: sharedTrollFallbackMat,
      clubGeo: sharedTrollClubGeo,
      clubMat: sharedTrollClubMat,
    };
  }

  // Low-poly procedural troll silhouette (< 110 tris) for mid/far chunks (dist > 1.5 chunks)
  const parts: THREE.BufferGeometry[] = [];
  const torso = new THREE.BoxGeometry(0.95, 1.05, 0.68);
  torso.translate(0, 1.32, 0);
  parts.push(torso);

  const head = new THREE.BoxGeometry(0.52, 0.48, 0.52);
  head.translate(0, 2.02, 0.12);
  parts.push(head);

  const legL = new THREE.CylinderGeometry(0.18, 0.16, 0.85, 6);
  legL.translate(-0.26, 0.42, 0);
  parts.push(legL);

  const legR = new THREE.CylinderGeometry(0.18, 0.16, 0.85, 6);
  legR.translate(0.26, 0.42, 0);
  parts.push(legR);

  const armL = new THREE.CylinderGeometry(0.16, 0.14, 0.95, 6);
  armL.translate(-0.62, 1.25, 0.15);
  parts.push(armL);

  const armR = new THREE.CylinderGeometry(0.16, 0.14, 0.95, 6);
  armR.translate(0.62, 1.25, 0.15);
  parts.push(armR);

  sharedTrollFallbackGeo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  sharedTrollFallbackGeo.computeBoundingBox();
  sharedTrollFallbackGeo.computeBoundingSphere();

  sharedTrollFallbackMat = new THREE.MeshStandardMaterial({
    color: 0x5c5346,
    roughness: 0.88,
    metalness: 0.06,
  });

  // Heavy Spiked Troll War-Club attached to the Troll-Beast's right hand (matching art/gameplay_protect_against_enemy.jpg)
  const clubParts: THREE.BufferGeometry[] = [];
  const shaft = new THREE.CylinderGeometry(0.055, 0.028, 0.52, 7);
  shaft.translate(0, 0.22, 0);
  clubParts.push(shaft);

  const spike1 = new THREE.ConeGeometry(0.025, 0.1, 4);
  spike1.rotateZ(Math.PI / 2);
  spike1.translate(0.075, 0.38, 0);
  clubParts.push(spike1);

  const spike2 = new THREE.ConeGeometry(0.025, 0.1, 4);
  spike2.rotateZ(-Math.PI / 2);
  spike2.translate(-0.075, 0.42, 0);
  clubParts.push(spike2);

  const spike3 = new THREE.ConeGeometry(0.025, 0.1, 4);
  spike3.rotateX(Math.PI / 2);
  spike3.translate(0, 0.4, 0.075);
  clubParts.push(spike3);

  sharedTrollClubGeo = mergeGeometries(clubParts, false);
  for (const p of clubParts) p.dispose();
  sharedTrollClubGeo.computeBoundingBox();
  sharedTrollClubGeo.computeBoundingSphere();

  sharedTrollClubMat = new THREE.MeshStandardMaterial({
    color: 0x4f3b28,
    roughness: 0.82,
    metalness: 0.18,
  });

  return {
    fallbackGeo: sharedTrollFallbackGeo,
    fallbackMat: sharedTrollFallbackMat,
    clubGeo: sharedTrollClubGeo,
    clubMat: sharedTrollClubMat,
  };
}

/**
 * Manages Nighttime Troll-Beast Spawning, Ominous Proximity-Scaled ElevenLabs Audio,
 * Multi-Hit Melee & Shield Combat, Visible Troll Defeat Tracker HUD, Troll Slayer Trophies,
 * and Dwarf Defeat -> Last-Saved-Location Restoration.
 */
export class TrollCombatManager {
  public readonly group = new THREE.Group();
  public trollsSlain = 0;

  private trollPool: TrollInstance[] = [];
  private readonly maxPooledTrolls = 3;
  private readonly nearestTrollResult = {
    troll: null as unknown as TrollInstance,
    dist: Infinity,
  };
  private isNightActive = false;
  private nightSpawnTimer = 0;
  private playerAttackCooldown = 0;
  private defeatRestorePending = false;
  private defeatRestoreTimer = 0;
  private isBlockingInput = false;
  private lastBlockRaiseTime = -999;
  private lastElapsedTime = 0;
  public hasIronAegisFn: () => boolean = () => false;
  public onPerfectParryReward?: () => void;

  // ElevenLabs Audio Elements
  private ominousLoopAudio: HTMLAudioElement;
  private roarAudioPool: HTMLAudioElement[] = [];
  private smashAudioPool: HTMLAudioElement[] = [];
  private hitAudioPool: HTMLAudioElement[] = [];
  private blockAudioPool: HTMLAudioElement[] = [];
  private defeatedAudio: HTMLAudioElement;
  private audioUnlocked = false;

  // DOM HUD Elements
  private trackerBannerEl: HTMLElement | null;
  private trollsSlainHudEl: HTMLElement | null;
  private toastContainer: HTMLElement | null;
  private lastBannerHtml = '';
  private lastBannerVisible = false;
  private lastTrollsSlainText = '';

  constructor(
    private config: WorldConfig,
    private domElement: HTMLElement,
    private dwarf: DwarfCharacter,
    private sampleGroundHeight: (wx: number, wz: number) => number,
    private isPlayerInsideSanctuary: () => boolean,
    private getCompletedCastlePositions: () => Array<{ x: number; z: number; blocksPlaced: number }>,
    private getCombatStats: () => {
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
      shieldId: 'none' | 'round_shield' | 'mithril_aegis';
      kingsValorBonus: number;
    },
    private onConsumeCombatEnergy: (cost: number) => { hadEnough: boolean; remainingEnergy: number },
    private onApplyPlayerDamage: (damage: number, sourceTitle: string) => { defeated: boolean },
    private onEatFoodRequest: () => void,
    private onTrollDefeatedReward: (gold: number, rations: number, trophiesTotal: number, title: string) => void,
    private onRestoreLastSavedLocation: () => void,
    private onInterruptFishingNight?: () => void
  ) {
    this.group.matrixAutoUpdate = false;
    this.trackerBannerEl = document.getElementById('troll-combat-banner');
    this.trollsSlainHudEl = document.getElementById('trolls-slain-value');
    this.toastContainer = document.getElementById('pickup-toasts');

    // Initialize ElevenLabs Audio assets
    this.ominousLoopAudio = new Audio(trollOminousPresenceSfxUrl);
    this.ominousLoopAudio.preload = 'auto';
    this.ominousLoopAudio.loop = true;
    this.ominousLoopAudio.volume = 0;

    for (let i = 0; i < 2; i++) {
      const r = new Audio(trollRoarSfxUrl);
      r.preload = 'auto';
      this.roarAudioPool.push(r);

      const s = new Audio(trollClubSmashSfxUrl);
      s.preload = 'auto';
      this.smashAudioPool.push(s);

      const h = new Audio(dwarfPunchHitSfxUrl);
      h.preload = 'auto';
      this.hitAudioPool.push(h);

      const b = new Audio(shieldBlockSfxUrl);
      b.preload = 'auto';
      this.blockAudioPool.push(b);
    }

    this.defeatedAudio = new Audio(trollDefeatedSfxUrl);
    this.defeatedAudio.preload = 'auto';

    this.initTrollPool();
    this.bindCombatEvents();
    this.syncTrollsSlainHUD();
  }

  private trollGlbLoadStarted = false;
  private bannerUpdateAccum = 999;
  private activeSiegeCastleName = '';
  private activeSiegeRemaining = 0;
  private readonly nearestPosResult = { x: 0, y: 0, z: 0 };
  public onSiegeVictoryReward?: (
    castleName: string,
    goldReward: number,
    foodReward: number
  ) => void;

  private initTrollPool(): void {
    const assets = getSharedTrollFallbackAssets();
    const ringGeo = new THREE.RingGeometry(0.95, 1.25, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xef233c,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
    });

    const hpBgGeo = new THREE.PlaneGeometry(1.86, 0.24);
    const hpBgMat = new THREE.MeshBasicMaterial({
      color: 0x11151c,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });
    const hpFillGeo = new THREE.PlaneGeometry(1.76, 0.16);
    hpFillGeo.translate(0.88, 0, 0.01); // Left-anchored so scale.x = hpRatio

    for (let i = 0; i < this.maxPooledTrolls; i++) {
      const root = new THREE.Group();
      root.visible = false;

      const skinnedContainer = new THREE.Group();
      root.add(skinnedContainer);

      const fallbackMesh = new THREE.Mesh(assets.fallbackGeo, assets.fallbackMat);
      fallbackMesh.castShadow = true;
      fallbackMesh.receiveShadow = false;
      fallbackMesh.visible = true;
      root.add(fallbackMesh);

      const targetRingMesh = new THREE.Mesh(ringGeo, ringMat);
      targetRingMesh.position.y = 0.08;
      root.add(targetRingMesh);

      // 3D Floating Overhead Troll Health Bar (`y = 2.65m`)
      const hpBarGroup = new THREE.Group();
      hpBarGroup.position.set(0, 2.65, 0);
      const bgMesh = new THREE.Mesh(hpBgGeo, hpBgMat);
      hpBarGroup.add(bgMesh);

      const hpFillMat = new THREE.MeshBasicMaterial({
        color: 0xef233c,
        side: THREE.DoubleSide,
      });
      const hpFillMesh = new THREE.Mesh(hpFillGeo, hpFillMat);
      hpFillMesh.position.x = -0.88;
      hpBarGroup.add(hpFillMesh);
      root.add(hpBarGroup);

      this.group.add(root);

      this.trollPool.push({
        id: `troll_${i}`,
        title: TROLL_TITLES[i % TROLL_TITLES.length],
        active: false,
        hp: TROLL_MAX_HP,
        maxHp: TROLL_MAX_HP,
        pos: new THREE.Vector3(),
        homePos: new THREE.Vector3(),
        heading: 0,
        patrolAngle: i * 2.1,
        state: 'patrol',
        attackTimer: 0,
        attackCooldown: 0,
        damageDealtInSwing: false,
        staggerTimer: 0,
        hitFlashTimer: 0,
        dyingTimer: 0,
        roarCooldown: 0,
        isNearLOD: true,
        castShadowEnabled: true,
        mixerAccum: 0,
        root,
        skinnedContainer,
        skinnedMeshes: [],
        fallbackMesh,
        hpBarGroup,
        hpFillMesh,
        hpFillMat,
        targetRingMesh,
        mixer: null,
        actions: {},
        currentAnim: 'walk',
      });
    }
  }

  private pruneTrollAnimationClips(clips: THREE.AnimationClip[]): void {
    const FINGER_RE = /(Index|Middle|Ring|Pinky|Thumb)[1-4]/i;
    for (const clip of clips) {
      clip.tracks = clip.tracks.filter((track) => {
        if (track.name.endsWith('.scale')) return false;
        if (track.name.endsWith('.position') && !track.name.includes('Hips')) return false;
        if (FINGER_RE.test(track.name)) return false;
        return true;
      });
      for (const track of clip.tracks) {
        if (track.name.includes('Hips') && track.name.endsWith('.position')) {
          const vals = track.values;
          const initX = vals[0];
          const initZ = vals[2];
          for (let i = 0; i < vals.length; i += 3) {
            vals[i] = initX;
            vals[i + 2] = initZ;
          }
        }
      }
    }
  }

  /**
   * Loads `3dmodels/troll-beast 3d model.glb` (18,555 tris, 65 bones, 3 animations):
   * - Strips `KHR_materials_specular` and the 4.55 MB secondary PNG texture in `beforeRoot`
   * - Prunes `.scale`, non-`Hips` `.position`, and finger phalange tracks (~66% mixer reduction)
   * - Locks root X/Z translation on `Hips.position`
   * - Attaches a 3D spiked war-club to the right hand bone
   */
  private loadTrollGlbModel(): void {
    if (this.trollGlbLoadStarted) return;
    this.trollGlbLoadStarted = true;
    const loader = createOptimizedGlbLoader();
    loader.load(
      trollModelUrl,
      (gltf) => {
        const clips = gltf.animations;

        // 1. Prune redundant animation tracks on the shared clips once
        this.pruneTrollAnimationClips(clips);

        const walkClip = clips.find((c) => c.name.toLowerCase().includes('walk'));
        const runClip = clips.find((c) => c.name.toLowerCase().includes('run'));
        const attackClip = clips.find((c) => c.name.toLowerCase().includes('box'));

        const assets = getSharedTrollFallbackAssets();

        // 2. Populate each pooled Troll instance using SkeletonUtils.clone
        for (const troll of this.trollPool) {
          const clonedScene = SkeletonUtils.clone(gltf.scene);
          // Native troll height is ~0.72m -> scale by 3.15 so he towers at ~2.27m tall!
          clonedScene.scale.setScalar(3.15);

          let rightHandBone: THREE.Object3D | null = null;
          clonedScene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = troll.castShadowEnabled;
              obj.receiveShadow = false;
              if (!obj.geometry.boundingSphere) {
                obj.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0), 3.5);
              } else {
                obj.geometry.boundingSphere.set(new THREE.Vector3(0, 1.2, 0), 3.5);
              }
              obj.frustumCulled = true;
              troll.skinnedMeshes.push(obj);
              const origMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
              if (origMat instanceof THREE.MeshStandardMaterial) {
                origMat.roughness = 0.82;
                origMat.metalness = 0.06;
              }
            }
            if (!rightHandBone && obj.name && obj.name.includes('RightHand') && !obj.name.includes('Index') && !obj.name.includes('Thumb')) {
              rightHandBone = obj;
            }
          });

          if (rightHandBone) {
            const clubMesh = new THREE.Mesh(assets.clubGeo, assets.clubMat);
            clubMesh.scale.setScalar(0.35);
            clubMesh.rotation.set(Math.PI * 0.45, 0, 0.15);
            clubMesh.position.set(0, 0.04, 0.04);
            clubMesh.castShadow = troll.castShadowEnabled;
            troll.skinnedMeshes.push(clubMesh);
            (rightHandBone as THREE.Object3D).add(clubMesh);
          }

          troll.skinnedContainer.add(clonedScene);
          troll.fallbackMesh.visible = !troll.isNearLOD;
          troll.skinnedContainer.visible = troll.isNearLOD;

          const mixer = new THREE.AnimationMixer(clonedScene);
          troll.mixer = mixer;
          if (walkClip) {
            troll.actions.walk = mixer.clipAction(walkClip);
          }
          if (runClip) {
            troll.actions.run = mixer.clipAction(runClip);
          }
          if (attackClip) {
            troll.actions.attack = mixer.clipAction(attackClip);
          }

          if (troll.actions.walk) {
            troll.actions.walk.play();
            troll.currentAnim = 'walk';
          }
        }
      },
      undefined,
      (err) => {
        console.error('Failed to load troll-beast 3D model:', err);
      }
    );
  }

  private bindCombatEvents(): void {
    const unlockAudio = () => {
      this.audioUnlocked = true;
    };
    window.addEventListener('keydown', unlockAudio, { passive: true });
    window.addEventListener('pointerdown', unlockAudio, { passive: true });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyX') {
        this.tryPlayerMeleeAttack();
      } else if (e.code === 'ShiftRight' || e.code === 'KeyZ') {
        if (!this.isBlockingInput) {
          this.lastBlockRaiseTime = this.lastElapsedTime;
        }
        this.isBlockingInput = true;
        this.dwarf.setShieldBlocking(true);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'ShiftRight' || e.code === 'KeyZ') {
        this.isBlockingInput = false;
        this.dwarf.setShieldBlocking(false);
      }
    });

    this.domElement.addEventListener('mousedown', (e) => {
      if (this.isPlayerInsideSanctuary()) return;
      if (e.button === 0) {
        // Left-click attacks when a Troll is within 6.5m
        const nearest = this.getNearestActiveTroll(this.dwarf.root.position);
        if (nearest && nearest.dist <= 6.5) {
          this.tryPlayerMeleeAttack();
        }
      } else if (e.button === 2) {
        // Holding Right-Click also raises the Dwarf's Shield when a Troll is nearby!
        const nearest = this.getNearestActiveTroll(this.dwarf.root.position);
        if (nearest && nearest.dist <= 9.0) {
          if (!this.isBlockingInput) {
            this.lastBlockRaiseTime = this.lastElapsedTime;
          }
          this.isBlockingInput = true;
          this.dwarf.setShieldBlocking(true);
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2 && this.isBlockingInput) {
        this.isBlockingInput = false;
        this.dwarf.setShieldBlocking(false);
      }
    });

    this.trackerBannerEl?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.troll-action-attack')) {
        this.tryPlayerMeleeAttack();
      } else if (target.closest('.troll-action-eat')) {
        this.onEatFoodRequest();
      } else if (target.closest('.troll-action-summon')) {
        this.spawnNightTrollsAroundPlayer(this.dwarf.root.position, true);
      }
    });
  }

  private transitionTrollAnim(troll: TrollInstance, next: TrollAnimState): void {
    if (troll.currentAnim === next) return;
    const prevAction = troll.actions[troll.currentAnim];
    const nextAction = troll.actions[next];
    if (!nextAction) return;

    nextAction.reset();
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);
    if (prevAction) {
      nextAction.crossFadeFrom(prevAction, 0.2, true);
    }
    nextAction.play();
    troll.currentAnim = next;
  }

  public getNearestActiveTroll(
    pos: THREE.Vector3
  ): { troll: TrollInstance; dist: number } | null {
    let best: TrollInstance | null = null;
    let bestDistSq = Infinity;
    for (const t of this.trollPool) {
      if (!t.active || t.state === 'dying') continue;
      const dx = t.pos.x - pos.x;
      const dz = t.pos.z - pos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = t;
      }
    }
    if (!best) return null;
    this.nearestTrollResult.troll = best;
    this.nearestTrollResult.dist = Math.sqrt(bestDistSq);
    return this.nearestTrollResult;
  }

  public findNearestActiveTrollPosition(
    wx: number,
    wz: number,
    maxRange: number
  ): { x: number; y: number; z: number } | null {
    let best: TrollInstance | null = null;
    let bestDistSq = maxRange * maxRange;
    for (const t of this.trollPool) {
      if (!t.active || t.state === 'dying') continue;
      const dx = t.pos.x - wx;
      const dz = t.pos.z - wz;
      const dSq = dx * dx + dz * dz;
      if (dSq <= bestDistSq) {
        bestDistSq = dSq;
        best = t;
      }
    }
    if (!best) return null;
    this.nearestPosResult.x = best.pos.x;
    this.nearestPosResult.y = best.pos.y;
    this.nearestPosResult.z = best.pos.z;
    return this.nearestPosResult;
  }

  public isCastleSiegeActive(): boolean {
    return this.activeSiegeRemaining > 0;
  }

  public startCastleSiegeWave(castleX: number, castleZ: number, castleName: string): boolean {
    if (this.activeSiegeRemaining > 0) return false;
    this.loadTrollGlbModel();

    // Ensure Nightfall if summoned during daytime so the Trolls don't petrify in the sun
    const hour = ((this.config.timeOfDay % 24) + 24) % 24;
    if (hour >= 5.5 && hour < 19.5) {
      this.config.timeOfDay = 21.2;
      this.isNightActive = true;
    }

    const minLandY = this.config.enableWater ? this.config.waterLevel + 0.45 : -999;
    const angles = [-0.52, 0.0, 0.52];
    const dists = [22.0, 24.5, 22.0];
    let spawned = 0;

    for (let i = 0; i < this.trollPool.length; i++) {
      const t = this.trollPool[i];
      const ang = angles[i % angles.length];
      const dist = dists[i % dists.length];
      const sx = castleX + Math.sin(ang) * dist;
      const sz = castleZ + 6.5 + Math.cos(ang) * dist;
      const sy = Math.max(minLandY, this.sampleGroundHeight(sx, sz));

      t.active = true;
      t.hp = TROLL_MAX_HP;
      t.maxHp = TROLL_MAX_HP;
      t.pos.set(sx, sy, sz);
      t.homePos.set(castleX, sy, castleZ + 7.5);
      t.heading = Math.atan2(castleX - sx, castleZ + 6.5 - sz);
      t.state = 'chase';
      t.attackTimer = 0;
      t.attackCooldown = 0;
      t.staggerTimer = 0;
      t.hitFlashTimer = 0;
      t.dyingTimer = 0;
      t.roarCooldown = 1.2;
      t.root.position.copy(t.pos);
      t.root.rotation.set(0, t.heading, 0);
      t.root.scale.setScalar(1.0);
      t.root.visible = true;
      t.hpBarGroup.visible = true;
      t.hpFillMesh.scale.x = 1.0;
      t.hpFillMat.color.setHex(0xef233c);
      this.transitionTrollAnim(t, 'walk');
      spawned++;
    }

    this.activeSiegeCastleName = castleName;
    this.activeSiegeRemaining = spawned;
    this.bannerUpdateAccum = 999;
    this.playOneShotPool(this.roarAudioPool, 0.85, () => this.playFallbackRoarSynth());
    this.showToast(
      `📯 BLOOD-MOON CASTLE SIEGE! 3 Troll-Beasts march on ${castleName}! Roof Ballistae are firing — slay the wave for +450g, +5 🍖 & +250 Renown!`,
      true
    );
    return true;
  }

  public isNightNow(): boolean {
    const hour = ((this.config.timeOfDay % 24) + 24) % 24;
    return hour >= 19.5 || hour < 5.5;
  }

  public hasActiveTrolls(): boolean {
    for (let i = 0; i < this.trollPool.length; i++) {
      const t = this.trollPool[i];
      if (t.active && t.state !== 'dying') return true;
    }
    return false;
  }

  public isTrollAggroOnPlayer(playerPos: THREE.Vector3): boolean {
    for (let i = 0; i < this.trollPool.length; i++) {
      const t = this.trollPool[i];
      if (!t.active || t.state === 'dying') continue;
      if (t.state === 'chase' || t.state === 'attack') {
        const dx = playerPos.x - t.pos.x;
        const dz = playerPos.z - t.pos.z;
        if (dx * dx + dz * dz <= 40 * 40) return true;
      }
    }
    return false;
  }

  public spawnNightTrollsAroundPlayer(playerPos: THREE.Vector3, announce = false): void {
    this.loadTrollGlbModel();
    const minLandY = this.config.enableWater ? this.config.waterLevel + 0.45 : -999;
    let spawnedAny = false;

    for (let i = 0; i < this.trollPool.length; i++) {
      const t = this.trollPool[i];
      if (t.active) continue;

      const angle = (i / this.trollPool.length) * Math.PI * 2 + Math.random() * 0.6;
      const dist = i === 0 ? 18.5 : 26.0 + i * 6.5;
      let sx = playerPos.x + Math.cos(angle) * dist;
      let sz = playerPos.z + Math.sin(angle) * dist;
      let sy = this.sampleGroundHeight(sx, sz);

      if (sy <= minLandY) {
        sx = playerPos.x - Math.cos(angle) * dist;
        sz = playerPos.z - Math.sin(angle) * dist;
        sy = this.sampleGroundHeight(sx, sz);
      }

      t.active = true;
      t.hp = TROLL_MAX_HP;
      t.maxHp = TROLL_MAX_HP;
      t.pos.set(sx, Math.max(sy, minLandY), sz);
      t.homePos.copy(t.pos);
      t.heading = Math.atan2(playerPos.x - sx, playerPos.z - sz);
      t.state = 'patrol';
      t.attackTimer = 0;
      t.attackCooldown = 0;
      t.staggerTimer = 0;
      t.hitFlashTimer = 0;
      t.dyingTimer = 0;
      t.roarCooldown = 1.5;
      t.root.position.copy(t.pos);
      t.root.rotation.set(0, t.heading, 0);
      t.root.scale.setScalar(1.0);
      t.root.visible = true;
      t.hpBarGroup.visible = true;
      t.hpFillMesh.scale.x = 1.0;
      t.hpFillMat.color.setHex(0xef233c);
      this.transitionTrollAnim(t, 'walk');
      spawnedAny = true;
    }

    if (spawnedAny && announce) {
      this.playOneShotPool(this.roarAudioPool, 0.72, () => this.playFallbackRoarSynth());
      this.showToast(
        '👹 Nightfall! Towering Troll-Beasts prowl the dark! Eat Food (G) for Strength or seek shelter inside a Castle (E)!',
        true
      );
    }
  }

  public despawnAllTrolls(petrifyToast = false): void {
    let hadActive = false;
    for (const t of this.trollPool) {
      if (t.active) {
        hadActive = true;
        t.active = false;
        t.root.visible = false;
      }
    }
    this.stopOminousProximityAudio();
    this.activeSiegeRemaining = 0;
    if (hadActive && petrifyToast) {
      this.showToast('☀️ Dawn breaks! The Night Trolls retreat from the morning sun!', false);
    }
  }

  /**
   * Player Melee Strike (`Left-Click` or `X` key):
   * - Requires Strength (`⚡`) from eating food to deal full weapon damage.
   * - Without enough Strength (`< 15⚡`), deals only 20% glancing damage!
   */
  public tryPlayerMeleeAttack(): boolean {
    if (this.isPlayerInsideSanctuary() || this.defeatRestorePending) return false;
    if (this.playerAttackCooldown > 0) return false;

    const stats = this.getCombatStats();
    this.playerAttackCooldown = stats.weaponCooldown;
    this.dwarf.triggerMeleeSwing();

    const playerPos = this.dwarf.root.position;
    const nearest = this.getNearestActiveTroll(playerPos);

    if (!nearest || nearest.dist > 3.85) {
      this.playFallbackSwingWhoosh();
      return false;
    }

    const troll = nearest.troll;
    // Face the troll when striking
    this.dwarf.heading = Math.atan2(troll.pos.x - playerPos.x, troll.pos.z - playerPos.z);
    this.dwarf.root.rotation.y = this.dwarf.heading;

    const energyCheck = this.onConsumeCombatEnergy(stats.weaponEnergyCost);
    const isExhausted = !energyCheck.hadEnough || energyCheck.remainingEnergy < 5;

    // Calculate melee damage (Trolls have 320 HP so they take many hits!)
    const trophyBonusMult = 1.0 + Math.min(0.3, this.trollsSlain * 0.05);
    const fullDamage = Math.round(stats.weaponDamage * trophyBonusMult * stats.kingsValorBonus);
    const finalDamage = isExhausted ? Math.max(3, Math.round(fullDamage * 0.2)) : fullDamage;

    this.applyDamageToTroll(troll, finalDamage, playerPos, isExhausted);

    // Runic Greatsword shockwave cleaves any secondary troll within 4.2m
    if (stats.hasRunicShockwave && !isExhausted) {
      for (const other of this.trollPool) {
        if (!other.active || other === troll || other.state === 'dying') continue;
        const d = Math.hypot(other.pos.x - playerPos.x, other.pos.z - playerPos.z);
        if (d <= 4.2) {
          this.applyDamageToTroll(other, Math.round(finalDamage * 0.65), playerPos, false);
        }
      }
    }

    return true;
  }

  private applyDamageToTroll(
    troll: TrollInstance,
    damage: number,
    playerPos: THREE.Vector3,
    isExhaustedStrike: boolean
  ): void {
    troll.hp = Math.max(0, troll.hp - damage);
    troll.hitFlashTimer = 0.22;

    // Knockback & brief stagger when struck with full Strength
    const dx = troll.pos.x - playerPos.x;
    const dz = troll.pos.z - playerPos.z;
    const len = Math.hypot(dx, dz) || 1;
    const knockDist = isExhaustedStrike ? 0.12 : 0.48;
    troll.pos.x += (dx / len) * knockDist;
    troll.pos.z += (dz / len) * knockDist;
    troll.pos.y = this.sampleGroundHeight(troll.pos.x, troll.pos.z);

    if (!isExhaustedStrike && troll.state !== 'attack') {
      troll.staggerTimer = Math.max(troll.staggerTimer, 0.28);
    }
    this.bannerUpdateAccum = 999;

    this.dwarf.spawnBurst(troll.pos.x, troll.pos.y + 1.25, troll.pos.z, isExhaustedStrike ? 6 : 16);
    this.playOneShotPool(this.hitAudioPool, isExhaustedStrike ? 0.45 : 0.85, () =>
      this.playFallbackPunchSynth()
    );

    if (isExhaustedStrike) {
      this.showToast(
        `⚠️ Exhausted Strike (-${damage} HP)! Eat Food (G) for Strength — Without Strength you deal 20% damage & are easily defeated!`,
        false
      );
    }

    if (troll.hp <= 0) {
      troll.state = 'dying';
      troll.dyingTimer = 1.15;
      troll.hpBarGroup.visible = false;
      this.trollsSlain += 1;
      this.syncTrollsSlainHUD();
      this.playOneShotElement(this.defeatedAudio, 0.9, () => this.playFallbackDefeatSynth());
      this.dwarf.spawnBurst(troll.pos.x, troll.pos.y + 1.1, troll.pos.z, 26);

      const bountyGold = 300;
      const droppedRations = 3;
      this.onTrollDefeatedReward(bountyGold, droppedRations, this.trollsSlain, troll.title);

      if (this.activeSiegeRemaining > 0) {
        this.activeSiegeRemaining = Math.max(0, this.activeSiegeRemaining - 1);
        if (this.activeSiegeRemaining === 0) {
          this.onSiegeVictoryReward?.(this.activeSiegeCastleName, 450, 5);
        } else {
          this.showToast(
            `🛡️ Castle Siege Progress: ${3 - this.activeSiegeRemaining}/3 Siege Trolls Slain! (${this.activeSiegeRemaining} remaining)`,
            true
          );
        }
      }
    }
  }

  public tryHitTrollWithArrow(arrowPos: THREE.Vector3, baseDamage = 38): boolean {
    if (this.defeatRestorePending) return false;
    for (const t of this.trollPool) {
      if (!t.active || t.state === 'dying') continue;
      const dx = arrowPos.x - t.pos.x;
      const dz = arrowPos.z - t.pos.z;
      const dy = arrowPos.y - t.pos.y;
      if (dx * dx + dz * dz <= 2.35 * 2.35 && dy >= -0.4 && dy <= 3.1) {
        const stats = this.getCombatStats();
        const trophyMult = 1.0 + Math.min(0.3, this.trollsSlain * 0.05);
        const dmg = Math.max(12, Math.round(baseDamage * trophyMult * stats.kingsValorBonus));
        this.applyDamageToTroll(t, dmg, this.dwarf.root.position, false);
        t.staggerTimer = Math.max(t.staggerTimer, 0.55);
        if (t.hp > 0) {
          this.showToast(
            `🏹 Dwarven War-Arrow pierced ${t.title} for -${dmg} HP! (${t.hp}/${t.maxHp} HP left)`,
            true
          );
        }
        return true;
      }
    }
    return false;
  }

  public stunNearbyTrollsWithWarhorn(playerPos: THREE.Vector3, radius = 15.0): number {
    let stunnedCount = 0;
    const rSq = radius * radius;
    for (const t of this.trollPool) {
      if (!t.active || t.state === 'dying') continue;
      const dx = t.pos.x - playerPos.x;
      const dz = t.pos.z - playerPos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq <= rSq) {
        stunnedCount++;
        const len = Math.sqrt(dSq) || 1;
        t.pos.x += (dx / len) * 2.2;
        t.pos.z += (dz / len) * 2.2;
        t.pos.y = this.sampleGroundHeight(t.pos.x, t.pos.z);
        t.state = 'chase';
        t.attackTimer = 0;
        t.attackCooldown = 2.6;
        t.staggerTimer = 2.4;
        this.applyDamageToTroll(t, 22, playerPos, false);
      }
    }
    return stunnedCount;
  }

  public update(dt: number, elapsedTime: number, playerPos: THREE.Vector3, cameraPos: THREE.Vector3): void {
    this.lastElapsedTime = elapsedTime;
    if (this.playerAttackCooldown > 0) {
      this.playerAttackCooldown = Math.max(0, this.playerAttackCooldown - dt);
    }

    // Handle pending restoration to Last Saved Location when the Dwarf is defeated by a Troll
    if (this.defeatRestorePending) {
      this.defeatRestoreTimer -= dt;
      if (this.defeatRestoreTimer <= 0) {
        this.defeatRestorePending = false;
        this.despawnAllTrolls(false);
        this.onRestoreLastSavedLocation();
      }
      return;
    }

    const insideSanctuary = this.isPlayerInsideSanctuary();
    const hour = ((this.config.timeOfDay % 24) + 24) % 24;
    if (!this.trollGlbLoadStarted && (hour >= 18.0 || hour < 6.0)) {
      this.loadTrollGlbModel();
    }
    const wantNight = hour >= 19.5 || hour < 5.5;

    if (wantNight && !this.isNightActive) {
      this.isNightActive = true;
      this.nightSpawnTimer = 0.5;
      this.spawnNightTrollsAroundPlayer(playerPos, true);
    } else if (!wantNight && this.isNightActive) {
      this.isNightActive = false;
      this.despawnAllTrolls(true);
    }

    if (this.isNightActive && !insideSanctuary) {
      this.nightSpawnTimer += dt;
      if (this.nightSpawnTimer >= 14.0) {
        this.nightSpawnTimer = 0;
        let activeCount = 0;
        for (const t of this.trollPool) {
          if (t.active) activeCount++;
        }
        if (activeCount === 0) {
          this.spawnNightTrollsAroundPlayer(playerPos, false);
        }
      }
    }

    const nearLodDistSq = Math.pow(this.config.chunkSize * 1.5, 2); // 72m close-range GLB LOD
    let hasActiveTroll = false;
    for (let i = 0; i < this.trollPool.length; i++) {
      if (this.trollPool[i].active) {
        hasActiveTroll = true;
        break;
      }
    }
    const castles =
      this.isNightActive || hasActiveTroll ? this.getCompletedCastlePositions() : null;
    let nearestLivingDist = Infinity;
    let nearestTroll: TrollInstance | null = null;

    for (const t of this.trollPool) {
      if (!t.active) continue;

      if (t.state === 'dying') {
        t.dyingTimer -= dt;
        const p = Math.max(0, t.dyingTimer / 1.15);
        t.root.rotation.x = (1.0 - p) * (Math.PI * 0.46);
        t.root.scale.setScalar(0.3 + p * 0.7);
        if (t.dyingTimer <= 0) {
          t.active = false;
          t.root.visible = false;
          t.root.rotation.x = 0;
          t.root.scale.setScalar(1.0);
        }
        continue;
      }

      const dx = playerPos.x - t.pos.x;
      const dz = playerPos.z - t.pos.z;
      const distSq = dx * dx + dz * dz;
      const dist = Math.sqrt(distSq);

      if (dist < nearestLivingDist) {
        nearestLivingDist = dist;
        nearestTroll = t;
      }

      // 1. Close-Range GLB LOD Swapping (dist <= 1.5 chunks / 72m) & Shadow Distance Gating (<= 42m)
      const wantNear = distSq <= nearLodDistSq && !insideSanctuary;
      if (wantNear !== t.isNearLOD) {
        t.isNearLOD = wantNear;
        t.skinnedContainer.visible = wantNear;
        t.fallbackMesh.visible = !wantNear;
      }

      const wantShadow = distSq <= 42 * 42 && !insideSanctuary;
      if (wantShadow !== t.castShadowEnabled) {
        t.castShadowEnabled = wantShadow;
        t.fallbackMesh.castShadow = wantShadow;
        for (let i = 0; i < t.skinnedMeshes.length; i++) {
          t.skinnedMeshes[i].castShadow = wantShadow;
        }
      }

      if (t.roarCooldown > 0) t.roarCooldown = Math.max(0, t.roarCooldown - dt);
      if (t.attackCooldown > 0) t.attackCooldown = Math.max(0, t.attackCooldown - dt);

      if (insideSanctuary) {
        // While the Dwarf is safely inside a Castle or Hut (and troll group is hidden), skip visual lookAt/material work
        if (t.hitFlashTimer > 0) t.hitFlashTimer = Math.max(0, t.hitFlashTimer - dt);
        this.transitionTrollAnim(t, 'walk');
        t.patrolAngle += dt * 0.55;
        t.pos.x = t.homePos.x + Math.cos(t.patrolAngle) * 5.5;
        t.pos.z = t.homePos.z + Math.sin(t.patrolAngle) * 5.5;
        t.pos.y = this.sampleGroundHeight(t.pos.x, t.pos.z);
        t.heading = -t.patrolAngle;
        t.root.position.copy(t.pos);
        t.root.rotation.set(0, t.heading, 0);
        continue;
      }

      if (t.hitFlashTimer > 0) {
        t.hitFlashTimer = Math.max(0, t.hitFlashTimer - dt);
        t.hpFillMat.color.setHex(0xffffff);
      } else {
        const hpRatio = t.hp / t.maxHp;
        t.hpFillMat.color.setHex(hpRatio > 0.5 ? 0xef233c : hpRatio > 0.25 ? 0xff9f1c : 0xffd166);
      }
      t.hpFillMesh.scale.x = THREE.MathUtils.clamp(t.hp / t.maxHp, 0.001, 1.0);

      // Billboard 3D overhead HP bar toward the camera
      t.hpBarGroup.lookAt(cameraPos.x, t.pos.y + 2.65, cameraPos.z);

      // Pulse red danger ring at troll's feet
      const ringPulse = 0.94 + Math.sin(elapsedTime * 5.0) * 0.08;
      t.targetRingMesh.scale.setScalar(ringPulse);

      // Reposition troll if the player walked > 68m away at night so night danger stays engaging
      if (dist > 68.0) {
        const ang = Math.random() * Math.PI * 2;
        t.pos.x = playerPos.x + Math.cos(ang) * 32.0;
        t.pos.z = playerPos.z + Math.sin(ang) * 32.0;
        t.pos.y = this.sampleGroundHeight(t.pos.x, t.pos.z);
        t.homePos.copy(t.pos);
      }

      if (t.staggerTimer > 0) {
        t.staggerTimer = Math.max(0, t.staggerTimer - dt);
      } else if (t.state === 'attack') {
        t.attackTimer -= dt;
        // Deal club smash impact midway through the `box_01.001` swing
        if (!t.damageDealtInSwing && t.attackTimer <= 0.42) {
          t.damageDealtInSwing = true;
          this.playOneShotPool(this.smashAudioPool, 0.82, () => this.playFallbackSmashSynth());
          if (dist <= 3.15) {
            this.resolveTrollStrikeOnDwarf(t);
          }
        }
        if (t.attackTimer <= 0) {
          t.state = 'chase';
          t.attackCooldown = 1.25;
        }
      } else if (dist <= 2.55 && t.attackCooldown <= 0) {
        // Enter Heavy Club Smash (`box_01.001`)
        t.state = 'attack';
        t.attackTimer = 0.82;
        t.damageDealtInSwing = false;
        t.heading = Math.atan2(dx, dz);
        this.transitionTrollAnim(t, 'attack');
      } else if (dist <= 36.0) {
        // Aggro Chase (`run.001` at 4.3 m/s — slower than Dwarf walk 6.0 m/s & run 10.5+ m/s!)
        if (t.state !== 'chase' && t.roarCooldown <= 0) {
          t.roarCooldown = 9.0;
          this.playOneShotPool(this.roarAudioPool, 0.78, () => this.playFallbackRoarSynth());
          // If the dwarf is trying to fish at night when a troll charges within 14m, interrupt fishing!
          if (dist <= 14.0) {
            this.onInterruptFishingNight?.();
          }
        }
        t.state = 'chase';
        this.transitionTrollAnim(t, 'run');

        const targetHeading = Math.atan2(dx, dz);
        let diff = targetHeading - t.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        t.heading += diff * Math.min(1, dt * 6.5);

        const step = TROLL_RUN_SPEED * dt;
        t.pos.x += Math.sin(t.heading) * step;
        t.pos.z += Math.cos(t.heading) * step;
      } else {
        // Patrol Walk (`Make the character walk.001` at 2.6 m/s)
        t.state = 'patrol';
        this.transitionTrollAnim(t, 'walk');
        t.patrolAngle += dt * 0.45;
        const targetX = t.homePos.x + Math.cos(t.patrolAngle) * 7.0;
        const targetZ = t.homePos.z + Math.sin(t.patrolAngle) * 7.0;
        const pdx = targetX - t.pos.x;
        const pdz = targetZ - t.pos.z;
        const pLen = Math.hypot(pdx, pdz);
        if (pLen > 0.2) {
          t.heading = Math.atan2(pdx, pdz);
          t.pos.x += (pdx / pLen) * TROLL_WALK_SPEED * dt;
          t.pos.z += (pdz / pLen) * TROLL_WALK_SPEED * dt;
        }
      }

      // Keep Trolls outside Completed Castle Sanctuary Perimeters (`radius 9.5m`)
      if (castles) {
        for (const c of castles) {
          if (c.blocksPlaced < 8) continue;
          const cdx = t.pos.x - c.x;
          const cdz = t.pos.z - c.z;
          const cDistSq = cdx * cdx + cdz * cdz;
          const minR = c.blocksPlaced >= 18 ? 11.5 : 8.8;
          if (cDistSq < minR * minR) {
            const cDist = Math.sqrt(cDistSq) || 0.01;
            t.pos.x = c.x + (cdx / cDist) * minR;
            t.pos.z = c.z + (cdz / cDist) * minR;
          }
        }
      }

      t.pos.y = this.sampleGroundHeight(t.pos.x, t.pos.z);
      t.root.position.copy(t.pos);
      t.root.rotation.set(0, t.heading, 0);

      if (t.isNearLOD && t.mixer) {
        if (distSq > 28 * 28) {
          t.mixerAccum += dt;
          if (t.mixerAccum >= 0.033) {
            t.mixer.update(t.mixerAccum);
            t.mixerAccum = 0;
          }
        } else {
          t.mixer.update(dt + t.mixerAccum);
          t.mixerAccum = 0;
        }
      }
    }

    // Engage combat stance on the Dwarf when a Troll is within 20m
    this.dwarf.setCombatReady(!insideSanctuary && nearestLivingDist <= 20.0);

    // Update ElevenLabs Ominous Troll Proximity Audio (louder & higher-pitched the nearer the troll gets!)
    this.updateOminousProximityAudio(insideSanctuary ? Infinity : nearestLivingDist);

    // Update Visible Troll Defeat Tracker HUD Banner (throttled to ~10 Hz while active)
    const bannerTroll = insideSanctuary ? null : nearestTroll;
    if (!bannerTroll || nearestLivingDist > 38.0) {
      this.setBanner(false, '');
    } else {
      this.bannerUpdateAccum += dt;
      if (this.bannerUpdateAccum >= 0.1) {
        this.bannerUpdateAccum = 0;
        this.updateTrackerBanner(bannerTroll, nearestLivingDist);
      }
    }
  }

  private resolveTrollStrikeOnDwarf(troll: TrollInstance): void {
    const stats = this.getCombatStats();
    const isShieldEquipped = stats.shieldId !== 'none';
    const isActivelyBlocking = this.dwarf.isShieldBlocking();
    const hasIronAegis = this.hasIronAegisFn();

    // Check if the Dwarf has enough Strength (⚡) from eating food to brace against the Troll's blow!
    const blockEnergyCost = stats.shieldId === 'mithril_aegis' ? 5 : 8;
    const hasStrength = stats.energy >= 15;

    // Check for ⚡ PERFECT SHIELD PARRY (raising shield within 0.42s, or 0.55s with Iron Aegis, of the smash impact!)
    const parryWindow = hasIronAegis ? 0.55 : 0.42;
    if (
      hasStrength &&
      isShieldEquipped &&
      isActivelyBlocking &&
      this.lastElapsedTime - this.lastBlockRaiseTime <= parryWindow
    ) {
      this.dwarf.triggerBlockImpact();
      this.playOneShotPool(this.blockAudioPool, 0.95, () => this.playFallbackShieldSynth());
      this.onPerfectParryReward?.();
      const reflectDmg = stats.shieldId === 'mithril_aegis' ? 36 : 25;
      troll.staggerTimer = 1.65;
      troll.attackCooldown = 2.4;
      this.applyDamageToTroll(troll, reflectDmg, this.dwarf.root.position, false);
      this.showToast(
        `⚡ PERFECT SHIELD PARRY! Deflected ${troll.title} for 0 ❤️ damage, +15⚡ Strength & reflected ${reflectDmg} DMG!`,
        true
      );
      return;
    }

    let incomingDamage = 24; // Base Troll club smash damage

    if (!hasStrength) {
      // WITHOUT ENOUGH STRENGTH (< 15⚡): Dwarf is easily defeated (2.5x crushing damage = 58 HP!)
      incomingDamage = 58;
      if (hasIronAegis) {
        incomingDamage = Math.max(1, Math.round(incomingDamage * 0.8));
      }
      this.showToast(
        `💥 CRUSHING BLOW (-${incomingDamage} ❤️)! You have NO STRENGTH (${Math.round(stats.energy)}⚡) — Eat Food (G) or Escape to a Castle!`,
        false
      );
    } else if (isShieldEquipped) {
      this.onConsumeCombatEnergy(blockEnergyCost);
      this.dwarf.triggerBlockImpact();
      this.playOneShotPool(this.blockAudioPool, 0.85, () => this.playFallbackShieldSynth());

      if (stats.shieldId === 'mithril_aegis') {
        incomingDamage = isActivelyBlocking ? 1 : 3;
        // Mithril Aegis reflects 12 runic damage back onto the attacking Troll!
        this.applyDamageToTroll(troll, 12, this.dwarf.root.position, false);
        this.showToast(
          `🔰 Mithril Aegis Parried ${troll.title}! (Only -${incomingDamage} ❤️ & Reflected 12 DMG!)`,
          true
        );
      } else {
        incomingDamage = isActivelyBlocking ? 3 : 6;
        if (hasIronAegis) {
          incomingDamage = Math.max(1, Math.round(incomingDamage * 0.8));
        }
        this.showToast(
          `🛡️ Iron-Boss Shield Blocked ${troll.title}'s Club! (-${incomingDamage} ❤️, -${blockEnergyCost}⚡ Strength)`,
          false
        );
      }
    } else {
      // Has Strength, but no Shield yet
      this.onConsumeCombatEnergy(5);
      incomingDamage = hasIronAegis ? 17 : 22;
      this.showToast(
        `👹 ${troll.title} smashed you (-${incomingDamage} ❤️)! Buy a Round Shield (Key 9) inside a Castle!`,
        false
      );
    }

    const result = this.onApplyPlayerDamage(incomingDamage, troll.title);
    if (result.defeated && !this.defeatRestorePending) {
      this.defeatRestorePending = true;
      this.defeatRestoreTimer = 1.35;
      this.playOneShotPool(this.roarAudioPool, 0.9, () => this.playFallbackRoarSynth());
      this.showToast(
        `💀 Defeated by ${troll.title}! Restoring to your Last Saved Location...`,
        true
      );
    }
  }

  /**
   * Scales the ElevenLabs Ominous Troll Presence audio (`music/sfx/troll_ominous_presence.mp3`)
   * so that the sound grows both LOUDER and HIGHER-PITCHED (`playbackRate`) the nearer the Troll gets!
   */
  private updateOminousProximityAudio(nearestDist: number): void {
    const maxHearDist = 45.0;
    const minCloseDist = 2.5;

    if (!this.audioUnlocked || !Number.isFinite(nearestDist) || nearestDist > maxHearDist) {
      this.stopOminousProximityAudio();
      return;
    }

    // Proximity factor p in [0, 1]: 0 at 45m -> 1 at 2.5m
    const p = THREE.MathUtils.clamp(
      1.0 - (nearestDist - minCloseDist) / (maxHearDist - minCloseDist),
      0,
      1
    );

    const targetVolume = THREE.MathUtils.clamp(0.05 + 0.9 * Math.pow(p, 1.45), 0, 0.95);
    const targetPitch = THREE.MathUtils.clamp(0.86 + 0.36 * p, 0.85, 1.25);

    this.ominousLoopAudio.volume = targetVolume;
    this.ominousLoopAudio.playbackRate = targetPitch;

    if (this.ominousLoopAudio.paused) {
      void this.ominousLoopAudio.play().catch(() => {});
    }
  }

  private stopOminousProximityAudio(): void {
    if (!this.ominousLoopAudio.paused) {
      this.ominousLoopAudio.pause();
    }
  }

  private updateTrackerBanner(nearestTroll: TrollInstance | null, dist: number): void {
    const isAggro =
      nearestTroll !== null && (nearestTroll.state === 'chase' || nearestTroll.state === 'attack');
    if (!nearestTroll || dist > 28.0 || (!isAggro && dist > 14.0)) {
      this.setBanner(false, '');
      return;
    }

    const stats = this.getCombatStats();
    const trophyMult = 1.0 + Math.min(0.3, this.trollsSlain * 0.05);
    const effDmg = Math.max(1, Math.round(stats.weaponDamage * trophyMult * stats.kingsValorBonus));
    const hitsLeft = Math.ceil(nearestTroll.hp / effDmg);
    const hpPct = Math.max(0, Math.min(100, Math.round((nearestTroll.hp / nearestTroll.maxHp) * 100)));

    const isLowStrength = stats.energy < 15;
    const stateIcon =
      nearestTroll.state === 'attack' ? '💥' : nearestTroll.state === 'chase' ? '🏃' : '👹';

    const html =
      `<div class="troll-tracker-compact">` +
      `<span class="troll-compact-name">${stateIcon} <strong>${nearestTroll.title}</strong> <span class="troll-dist-badge">${Math.round(dist)}m</span></span>` +
      `<div class="troll-hp-bar-track" title="${nearestTroll.hp}/${nearestTroll.maxHp} HP (${hitsLeft} hits left)"><div class="troll-hp-bar-fill" style="width:${hpPct}%"></div></div>` +
      `<span class="troll-hits-left-pill">${hitsLeft} hit${hitsLeft === 1 ? '' : 's'}</span>` +
      `<button type="button" class="hut-action-pill troll-action-attack">⚔️ Strike (X)</button>` +
      (isLowStrength && stats.foodCount > 0
        ? `<button type="button" class="hut-action-pill troll-action-eat">🍖 Eat (G)</button>`
        : '') +
      `</div>`;

    this.setBanner(true, html);
  }

  private setBanner(visible: boolean, html: string): void {
    if (!this.trackerBannerEl) return;
    if (visible !== this.lastBannerVisible) {
      this.lastBannerVisible = visible;
      this.trackerBannerEl.classList.toggle('hidden', !visible);
    }
    if (visible && html !== this.lastBannerHtml) {
      this.lastBannerHtml = html;
      this.trackerBannerEl.innerHTML = html;
    }
  }

  public syncTrollsSlainHUD(): void {
    if (!this.trollsSlainHudEl) return;
    this.trollsSlainHudEl.classList.toggle('hidden', this.trollsSlain === 0);
    const text = `• 👹 ${this.trollsSlain} Troll${this.trollsSlain === 1 ? '' : 's'}`;
    if (text !== this.lastTrollsSlainText) {
      this.lastTrollsSlainText = text;
      this.trollsSlainHudEl.textContent = text;
    }
  }

  public restoreProgress(trollsSlain?: number): void {
    this.trollsSlain =
      typeof trollsSlain === 'number' && trollsSlain >= 0 ? Math.floor(trollsSlain) : 0;
    this.syncTrollsSlainHUD();
  }

  public reset(): void {
    this.trollsSlain = 0;
    this.defeatRestorePending = false;
    this.despawnAllTrolls(false);
    this.syncTrollsSlainHUD();
  }

  private showToast(text: string, isHighlight: boolean): void {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `pickup-toast ${isHighlight ? 'rare' : ''}`;
    toast.textContent = text;
    this.toastContainer.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 3100);
  }

  private playOneShotPool(
    pool: HTMLAudioElement[],
    volume: number,
    fallbackFn: () => void
  ): void {
    if (!this.audioUnlocked || pool.length === 0) {
      fallbackFn();
      return;
    }
    const candidate = pool.find((a) => a.paused || a.ended) ?? pool[0];
    candidate.currentTime = 0;
    candidate.volume = volume;
    void candidate.play().catch(() => {
      fallbackFn();
    });
  }

  private playOneShotElement(
    el: HTMLAudioElement,
    volume: number,
    fallbackFn: () => void
  ): void {
    if (!this.audioUnlocked) {
      fallbackFn();
      return;
    }
    el.currentTime = 0;
    el.volume = volume;
    void el.play().catch(() => {
      fallbackFn();
    });
  }

  private playFallbackSwingWhoosh(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.14);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.02);
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

  private playFallbackPunchSynth(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.14);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
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

  private playFallbackShieldSynth(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.16);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.19);
  }

  private playFallbackRoarSynth(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.linearRampToValueAtTime(62, now + 0.45);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.5);
  }

  private playFallbackSmashSynth(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.24);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.27);
  }

  private playFallbackDefeatSynth(): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [261.63, 329.63, 392.0, 523.25];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }
}
