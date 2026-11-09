import * as THREE from 'three';
import { WorldConfig } from './Config';
import { TerrainNoise, VOLCANO_X, VOLCANO_Z } from './TerrainNoise';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { RelicStore } from '../player/RelicStore';
import { ChunkManager } from './ChunkManager';

export interface MeteoriteInstance {
  active: boolean;
  phase: 'falling' | 'landed' | 'harvested';
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  currentPos: THREE.Vector3;
  fallProgress: number;
  coolTimer: number;
  group: THREE.Group;
  coreMesh: THREE.Mesh;
  glowMesh: THREE.Mesh;
  craterMesh: THREE.Mesh;
  harvested: boolean;
}

export interface VolcanicSlagBomb {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mesh: THREE.Mesh;
}

export interface ObsidianShardInstance {
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  collected: boolean;
}

export interface CragTitanBoss {
  active: boolean;
  awakened: boolean;
  hp: number;
  maxHp: number;
  phase: 1 | 2 | 3;
  pos: THREE.Vector3;
  heading: number;
  state: 'idle' | 'walk' | 'stomp' | 'throw' | 'overload' | 'dying';
  stateTimer: number;
  attackCooldown: number;
  staggerTimer: number;
  hitFlashTimer: number;
  group: THREE.Group;
  torsoMesh: THREE.Mesh;
  headMesh: THREE.Mesh;
  leftArmMesh: THREE.Mesh;
  rightArmMesh: THREE.Mesh;
  magmaCoreMesh: THREE.Mesh;
  fissureRingMesh: THREE.Mesh;
}

export interface DragonWeakSpot {
  mesh: THREE.Mesh;
  location: 'crest' | 'wing_left' | 'wing_right';
  localPos: THREE.Vector3;
  radius: number;
}

export interface DragonBoss {
  active: boolean;
  awakened: boolean;
  hp: number;
  maxHp: number;
  phase: 1 | 2 | 3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  heading: number;
  pitch: number;
  roll: number;
  speed: number;
  state:
    | 'sky_patrol'
    | 'dive_bomb'
    | 'caldera_roost'
    | 'tethered_grounded'
    | 'recovering'
    | 'defeated';
  stateTimer: number;
  attackCooldown: number;
  fireBreathTimer: number;
  staggerTimer: number;
  hitFlashTimer: number;
  tethers: Array<{
    line: THREE.Line;
    positions: Float32Array;
    anchorPos: THREE.Vector3;
    dragonAttachPoint: THREE.Vector3;
    active: boolean;
  }>;
  tetherCount: number;
  group: THREE.Group;
  mainBodyMesh: THREE.Mesh;
  headGroup: THREE.Group;
  jawMesh: THREE.Mesh;
  throatFireMesh: THREE.Mesh;
  leftWingGroup: THREE.Group;
  rightWingGroup: THREE.Group;
  tailSegments: THREE.Group[];
  weakSpots: DragonWeakSpot[];
  fireBreathConeMesh: THREE.Mesh;
  targetPos: THREE.Vector3;
  patrolT: number;
}

const _scratchDragonPos = new THREE.Vector3();
const _scratchDragonNext = new THREE.Vector3();
const _scratchDragonDir = new THREE.Vector3();
const _scratchTetherStart = new THREE.Vector3();
const _scratchTetherEnd = new THREE.Vector3();

const DRAGON_PATROL_WAYPOINTS: THREE.Vector3[] = [
  new THREE.Vector3(VOLCANO_X, 64.0, VOLCANO_Z),
  new THREE.Vector3(VOLCANO_X + 130, 54.0, VOLCANO_Z - 70),
  new THREE.Vector3(VOLCANO_X + 70, 48.0, VOLCANO_Z - 170),
  new THREE.Vector3(VOLCANO_X - 110, 52.0, VOLCANO_Z - 120),
  new THREE.Vector3(VOLCANO_X - 130, 60.0, VOLCANO_Z + 80),
  new THREE.Vector3(VOLCANO_X - 20, 58.0, VOLCANO_Z + 160),
  new THREE.Vector3(VOLCANO_X + 100, 52.0, VOLCANO_Z + 120),
];

let sharedShardGeo: THREE.BufferGeometry | null = null;
let sharedShardMat: THREE.MeshStandardMaterial | null = null;
let sharedBoulderGeo: THREE.BufferGeometry | null = null;
let sharedBoulderMat: THREE.MeshStandardMaterial | null = null;
const _scratchBoulderDir = new THREE.Vector3();

function getSharedShardAssets(): { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } {
  if (!sharedShardGeo || !sharedShardMat) {
    sharedShardGeo = new THREE.OctahedronGeometry(0.35, 0);
    sharedShardMat = new THREE.MeshStandardMaterial({
      color: 0x111118,
      roughness: 0.15,
      metalness: 0.9,
      emissive: 0xff3300,
      emissiveIntensity: 0.35,
    });
  }
  return { geo: sharedShardGeo, mat: sharedShardMat };
}

function getSharedBoulderAssets(): { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } {
  if (!sharedBoulderGeo || !sharedBoulderMat) {
    sharedBoulderGeo = new THREE.DodecahedronGeometry(1.6, 1);
    sharedBoulderMat = new THREE.MeshStandardMaterial({
      color: 0x48423f,
      roughness: 0.85,
    });
  }
  return { geo: sharedBoulderGeo, mat: sharedBoulderMat };
}

export class DynamicWorldEventManager {
  public readonly group = new THREE.Group();

  // Celestial Star-Metal Meteorite
  private meteorTimer = 180.0; // Spawns every few minutes
  private activeMeteor: MeteoriteInstance | null = null;
  private meteorStreakLine!: THREE.Line;
  private meteorStreakGeo!: THREE.BufferGeometry;
  private meteorStreakPos = new Float32Array(6);

  // Volcanic Slag Eruptions
  private eruptionTimer = 240.0;
  private slagBombs: VolcanicSlagBomb[] = [];
  private obsidianShards: ObsidianShardInstance[] = [];

  // Multi-Phase Crag-Titan World Boss
  private titan!: CragTitanBoss;
  private titanHudEl: HTMLElement | null = null;
  private titanHpBarFill: HTMLElement | null = null;
  private titanPhaseBadge: HTMLElement | null = null;
  private titanDistLabel: HTMLElement | null = null;
  private titanHudAccum = 0;
  private lastTitanHpText = '';
  private lastTitanPhaseText = '';
  private lastTitanDistText = '';

  // Rolling Boulders Pool from Titan Throw (zero per-frame heap allocations)
  private boulderPool: Array<{
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    mesh: THREE.Mesh;
    life: number;
    active: boolean;
  }> = [];

  // Colossal Ash-Peak Wyrm (Vermithrax the Smoldering)
  private dragon!: DragonBoss;
  private dragonHudEl: HTMLElement | null = null;
  private dragonHpBarFill: HTMLElement | null = null;
  private dragonPhaseBadge: HTMLElement | null = null;
  private dragonDistLabel: HTMLElement | null = null;
  private dragonHudAccum = 0;
  private lastDragonHpText = '';
  private lastDragonPhaseText = '';
  private lastDragonDistText = '';
  private dragonRoarCooldown = 45.0;

  // Callbacks
  public onCameraShake?: (intensity: number, duration: number) => void;
  public onGrantBonusGold?: (amount: number, message: string) => void;
  public onApplyPlayerDamage?: (damage: number, source: string) => void;

  constructor(
    _config: WorldConfig,
    _noise: TerrainNoise,
    private chunkManager: ChunkManager,
    private dwarf: DwarfCharacter,
    private relicStore: RelicStore
  ) {
    this.group.matrixAutoUpdate = false;
    this.initMeteorVisuals();
    this.initVolcanicSlagPool();
    this.initCragTitanBoss();
    this.initBossHUD();
    this.initDragonBoss();
    this.initDragonHUD();
  }

  private initMeteorVisuals(): void {
    // Blazing Meteor Streak Line
    this.meteorStreakGeo = new THREE.BufferGeometry();
    this.meteorStreakGeo.setAttribute('position', new THREE.BufferAttribute(this.meteorStreakPos, 3));
    const streakMat = new THREE.LineBasicMaterial({
      color: 0x00f5d4,
      linewidth: 3,
      transparent: true,
      opacity: 0.9,
    });
    this.meteorStreakLine = new THREE.Line(this.meteorStreakGeo, streakMat);
    this.meteorStreakLine.frustumCulled = false;
    this.meteorStreakLine.visible = false;
    this.group.add(this.meteorStreakLine);
  }

  private initVolcanicSlagPool(): void {
    const bombGeo = new THREE.DodecahedronGeometry(0.75, 1);
    const bombMat = new THREE.MeshStandardMaterial({
      color: 0x241208,
      roughness: 0.85,
      metalness: 0.1,
      emissive: 0xff3c00,
      emissiveIntensity: 0.95,
    });

    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(bombGeo, bombMat);
      mesh.visible = false;
      mesh.castShadow = true;
      this.group.add(mesh);
      this.slagBombs.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        mesh,
      });
    }
  }

  private initCragTitanBoss(): void {
    // Altar Position: Plateau east of volcano (210, 240)
    const altarX = 210;
    const altarZ = 240;
    const altarY = this.chunkManager.getSurfaceHeight(altarX, altarZ);

    const titanGroup = new THREE.Group();
    titanGroup.position.set(altarX, altarY, altarZ);

    // 1. Colossal Crag Torso & Magma Core
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x3d3a45,
      roughness: 0.9,
      metalness: 0.15,
    });
    const magmaMat = new THREE.MeshStandardMaterial({
      color: 0xff2a00,
      roughness: 0.4,
      metalness: 0.6,
      emissive: 0xff4800,
      emissiveIntensity: 0.95,
    });

    const torsoGeo = new THREE.BoxGeometry(4.2, 5.2, 3.4);
    torsoGeo.translate(0, 5.2, 0);
    const torsoMesh = new THREE.Mesh(torsoGeo, rockMat);
    torsoMesh.castShadow = true;
    titanGroup.add(torsoMesh);

    const magmaCoreGeo = new THREE.IcosahedronGeometry(1.6, 2);
    magmaCoreGeo.translate(0, 5.2, 0.4);
    const magmaCoreMesh = new THREE.Mesh(magmaCoreGeo, magmaMat);
    titanGroup.add(magmaCoreMesh);

    // 2. Titan Head with Horns
    const headGeo = new THREE.BoxGeometry(2.4, 2.2, 2.4);
    headGeo.translate(0, 8.8, 0.4);
    const headMesh = new THREE.Mesh(headGeo, rockMat);
    headMesh.castShadow = true;
    titanGroup.add(headMesh);

    // 3. Colossal Arms
    const armGeo = new THREE.CylinderGeometry(0.85, 1.1, 4.8, 6);
    armGeo.translate(0, -2.2, 0);
    const leftArmMesh = new THREE.Mesh(armGeo, rockMat);
    leftArmMesh.position.set(-2.8, 7.2, 0);
    leftArmMesh.castShadow = true;
    titanGroup.add(leftArmMesh);

    const rightArmMesh = new THREE.Mesh(armGeo, rockMat);
    rightArmMesh.position.set(2.8, 7.2, 0);
    rightArmMesh.castShadow = true;
    titanGroup.add(rightArmMesh);

    // 4. Ground Fissure Ring Indicator
    const ringGeo = new THREE.RingGeometry(2.0, 14.0, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const fissureMat = new THREE.MeshBasicMaterial({
      color: 0xff3c00,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fissureRingMesh = new THREE.Mesh(ringGeo, fissureMat);
    fissureRingMesh.position.y = 0.12;
    fissureRingMesh.visible = false;
    titanGroup.add(fissureRingMesh);

    this.group.add(titanGroup);

    this.titan = {
      active: true,
      awakened: false,
      hp: 1200,
      maxHp: 1200,
      phase: 1,
      pos: new THREE.Vector3(altarX, altarY, altarZ),
      heading: 0,
      state: 'idle',
      stateTimer: 0,
      attackCooldown: 2.0,
      staggerTimer: 0,
      hitFlashTimer: 0,
      group: titanGroup,
      torsoMesh,
      headMesh,
      leftArmMesh,
      rightArmMesh,
      magmaCoreMesh,
      fissureRingMesh,
    };

    // Pre-allocate boulder pool to avoid per-throw allocations
    const bAssets = getSharedBoulderAssets();
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(bAssets.geo, bAssets.mat);
      mesh.castShadow = true;
      mesh.visible = false;
      this.group.add(mesh);
      this.boulderPool.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        mesh,
        life: 0,
        active: false,
      });
    }
  }

  private initBossHUD(): void {
    this.titanHudEl = document.createElement('div');
    this.titanHudEl.id = 'crag-titan-hud';
    this.titanHudEl.style.position = 'fixed';
    this.titanHudEl.style.top = '18px';
    this.titanHudEl.style.left = '50%';
    this.titanHudEl.style.transform = 'translateX(-50%)';
    this.titanHudEl.style.width = '420px';
    this.titanHudEl.style.maxWidth = '90vw';
    this.titanHudEl.style.background = 'rgba(12, 10, 16, 0.88)';
    this.titanHudEl.style.border = '2px solid #ff4800';
    this.titanHudEl.style.boxShadow = '0 0 24px rgba(255, 72, 0, 0.45), inset 0 0 12px rgba(0,0,0,0.8)';
    this.titanHudEl.style.borderRadius = '10px';
    this.titanHudEl.style.padding = '8px 14px';
    this.titanHudEl.style.zIndex = '50';
    this.titanHudEl.style.display = 'none';
    this.titanHudEl.style.fontFamily = 'system-ui, sans-serif';
    this.titanHudEl.style.color = '#fff';

    this.titanHudEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:900;letter-spacing:1px;font-size:14px;color:#ffbe0b;">🌋 CRAG-TITAN ANCESTOR</span>
        <span id="titan-phase-badge" style="background:#ff3c00;color:#000;font-size:11px;font-weight:bold;padding:1px 6px;border-radius:4px;">PHASE 1: STONE STOMP</span>
      </div>
      <div style="width:100%;height:14px;background:#2b1810;border-radius:7px;overflow:hidden;border:1px solid #ff4800;">
        <div id="titan-hp-bar" style="width:100%;height:100%;background:linear-gradient(90deg, #ffbe0b, #ff0054);transition:width 0.15s ease;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:#a0aec0;">
        <span id="titan-dist-label">Distance: 45m</span>
        <span>Weakness: Shield Parry & Mid-Air Bow Hits</span>
      </div>
    `;

    document.body.appendChild(this.titanHudEl);
    this.titanHpBarFill = document.getElementById('titan-hp-bar');
    this.titanPhaseBadge = document.getElementById('titan-phase-badge');
    this.titanDistLabel = document.getElementById('titan-dist-label');
  }

  private initDragonBoss(): void {
    const dragonGroup = new THREE.Group();
    dragonGroup.position.copy(DRAGON_PATROL_WAYPOINTS[0]);

    // Materials
    const scaleMat = new THREE.MeshStandardMaterial({
      color: 0x181418,
      roughness: 0.65,
      metalness: 0.35,
      emissive: 0x440800,
      emissiveIntensity: 0.45,
    });
    const bellyMat = new THREE.MeshStandardMaterial({
      color: 0x7c1414,
      roughness: 0.6,
      metalness: 0.2,
      emissive: 0x330000,
      emissiveIntensity: 0.2,
    });
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x481212,
      roughness: 0.85,
      metalness: 0.15,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const magmaMat = new THREE.MeshStandardMaterial({
      color: 0xff3300,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0xff4400,
      emissiveIntensity: 1.1,
    });

    // 1. Aerodynamic Main Torso (Spindle-shaped)
    const bodyGeo = new THREE.ConeGeometry(2.4, 8.5, 8);
    bodyGeo.rotateX(Math.PI / 2);
    const mainBodyMesh = new THREE.Mesh(bodyGeo, scaleMat);
    mainBodyMesh.castShadow = true;
    dragonGroup.add(mainBodyMesh);

    // Spinal dorsal crest ridges
    const ridgeGeo = new THREE.ConeGeometry(0.5, 1.6, 4);
    ridgeGeo.rotateX(Math.PI / 2);
    for (let i = -2; i <= 2; i++) {
      const ridgeMesh = new THREE.Mesh(ridgeGeo, magmaMat);
      ridgeMesh.position.set(0, 1.45, i * 1.5);
      mainBodyMesh.add(ridgeMesh);
    }

    // Belly plate
    const bellyGeo = new THREE.CylinderGeometry(1.6, 1.2, 7.0, 6);
    bellyGeo.rotateX(Math.PI / 2);
    const bellyMesh = new THREE.Mesh(bellyGeo, bellyMat);
    bellyMesh.position.set(0, -0.6, 0);
    mainBodyMesh.add(bellyMesh);

    // 2. Head & Articulated Neck
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.8, 4.4);

    const neckGeo = new THREE.CylinderGeometry(1.1, 1.6, 3.6, 6);
    neckGeo.rotateX(Math.PI / 3);
    const neckMesh = new THREE.Mesh(neckGeo, scaleMat);
    neckMesh.position.set(0, 0.9, 1.4);
    headGroup.add(neckMesh);

    // Dragon Skull
    const skullGeo = new THREE.ConeGeometry(1.4, 3.8, 6);
    skullGeo.rotateX(Math.PI / 2);
    const skullMesh = new THREE.Mesh(skullGeo, scaleMat);
    skullMesh.position.set(0, 2.2, 3.2);
    skullMesh.castShadow = true;
    headGroup.add(skullMesh);

    // Horns
    const hornGeo = new THREE.ConeGeometry(0.35, 2.8, 5);
    hornGeo.rotateX(-Math.PI * 0.35);
    const leftHorn = new THREE.Mesh(hornGeo, magmaMat);
    leftHorn.position.set(-0.85, 3.2, 2.4);
    headGroup.add(leftHorn);

    const rightHorn = new THREE.Mesh(hornGeo, magmaMat);
    rightHorn.position.set(0.85, 3.2, 2.4);
    headGroup.add(rightHorn);

    // Glowing Magma Eyes
    const eyeGeo = new THREE.SphereGeometry(0.32, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.95, 2.4, 3.6);
    headGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.95, 2.4, 3.6);
    headGroup.add(rightEye);

    // Lower Jaw
    const jawGeo = new THREE.BoxGeometry(1.1, 0.5, 2.8);
    jawGeo.translate(0, -0.25, 1.2);
    const jawMesh = new THREE.Mesh(jawGeo, scaleMat);
    jawMesh.position.set(0, 1.6, 3.0);
    headGroup.add(jawMesh);

    // Throat Fire Mesh
    const throatGeo = new THREE.SphereGeometry(0.75, 8, 8);
    const throatMat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0 });
    const throatFireMesh = new THREE.Mesh(throatGeo, throatMat);
    throatFireMesh.position.set(0, 1.9, 3.2);
    headGroup.add(throatFireMesh);

    // Fire Breath Cone
    const fireBreathGeo = new THREE.ConeGeometry(4.5, 24.0, 12, 1, true);
    fireBreathGeo.rotateX(-Math.PI / 2);
    fireBreathGeo.translate(0, 0, 13.0);
    const fireBreathMat = new THREE.MeshBasicMaterial({
      color: 0xff5500,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fireBreathConeMesh = new THREE.Mesh(fireBreathGeo, fireBreathMat);
    fireBreathConeMesh.position.set(0, 1.9, 4.4);
    fireBreathConeMesh.visible = false;
    headGroup.add(fireBreathConeMesh);

    dragonGroup.add(headGroup);

    // 3. Articulated Wings (~24m Wingspan)
    const wingBoneGeo = new THREE.CylinderGeometry(0.4, 0.55, 7.5, 6);
    wingBoneGeo.rotateZ(Math.PI / 2);
    wingBoneGeo.translate(-3.6, 0, 0);

    const wingSailGeo = new THREE.BufferGeometry();
    const wingSailVertices = new Float32Array([
      0, 0, 0,
      -7.2, 0, 0,
      -5.0, 0, -5.5,

      -7.2, 0, 0,
      -12.5, 0, -2.5,
      -5.0, 0, -5.5,
    ]);
    wingSailGeo.setAttribute('position', new THREE.BufferAttribute(wingSailVertices, 3));
    wingSailGeo.computeVertexNormals();

    // Left Wing
    const leftWingGroup = new THREE.Group();
    leftWingGroup.position.set(-1.8, 1.2, 0.8);
    const leftArmBone = new THREE.Mesh(wingBoneGeo, scaleMat);
    leftWingGroup.add(leftArmBone);
    const leftWingSail = new THREE.Mesh(wingSailGeo, wingMat);
    leftWingSail.castShadow = true;
    leftWingGroup.add(leftWingSail);
    dragonGroup.add(leftWingGroup);

    // Right Wing
    const rightWingGroup = new THREE.Group();
    rightWingGroup.position.set(1.8, 1.2, 0.8);
    const rightArmBone = new THREE.Mesh(wingBoneGeo, scaleMat);
    rightArmBone.scale.set(-1, 1, 1);
    rightWingGroup.add(rightArmBone);
    const rightWingSail = new THREE.Mesh(wingSailGeo, wingMat);
    rightWingSail.scale.set(-1, 1, 1);
    rightWingSail.castShadow = true;
    rightWingGroup.add(rightWingSail);
    dragonGroup.add(rightWingGroup);

    // 4. Tail Segments
    const tailSegments: THREE.Group[] = [];
    let prevAttach: THREE.Object3D = dragonGroup;
    for (let t = 0; t < 4; t++) {
      const segGroup = new THREE.Group();
      segGroup.position.set(0, 0, t === 0 ? -4.2 : -2.8);
      const rad = 1.6 * Math.pow(0.72, t + 1);
      const segGeo = new THREE.ConeGeometry(rad, 3.2, 6);
      segGeo.rotateX(-Math.PI / 2);
      segGeo.translate(0, 0, -1.4);
      const segMesh = new THREE.Mesh(segGeo, scaleMat);
      segMesh.castShadow = true;
      segGroup.add(segMesh);

      const spikeGeo = new THREE.ConeGeometry(0.22, 1.1, 4);
      spikeGeo.rotateX(Math.PI / 2);
      const spike = new THREE.Mesh(spikeGeo, magmaMat);
      spike.position.set(0, rad + 0.35, -1.2);
      segGroup.add(spike);

      prevAttach.add(segGroup);
      tailSegments.push(segGroup);
      prevAttach = segGroup;
    }

    // 5. Weak Spots Hitboxes
    const weakSpots: DragonWeakSpot[] = [];
    const weakSpotGeo = new THREE.IcosahedronGeometry(1.3, 1);
    const weakSpotMat = new THREE.MeshBasicMaterial({
      color: 0xff3c00,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });

    const crestMesh = new THREE.Mesh(weakSpotGeo, weakSpotMat);
    crestMesh.position.set(0, 2.2, 0.2);
    dragonGroup.add(crestMesh);
    weakSpots.push({
      mesh: crestMesh,
      location: 'crest',
      localPos: crestMesh.position,
      radius: 2.2,
    });

    const leftWingSpot = new THREE.Mesh(weakSpotGeo, weakSpotMat);
    leftWingSpot.position.set(-6.5, 0.2, -2.5);
    leftWingGroup.add(leftWingSpot);
    weakSpots.push({
      mesh: leftWingSpot,
      location: 'wing_left',
      localPos: leftWingSpot.position,
      radius: 2.4,
    });

    const rightWingSpot = new THREE.Mesh(weakSpotGeo, weakSpotMat);
    rightWingSpot.position.set(-6.5, 0.2, -2.5);
    rightWingGroup.add(rightWingSpot);
    weakSpots.push({
      mesh: rightWingSpot,
      location: 'wing_right',
      localPos: rightWingSpot.position,
      radius: 2.4,
    });

    // 6. Pre-allocated Tether Lines
    const tethers: DragonBoss['tethers'] = [];
    const tetherMat = new THREE.LineBasicMaterial({
      color: 0x00f5d4,
      linewidth: 3,
      transparent: true,
      opacity: 0.95,
    });

    for (let i = 0; i < 4; i++) {
      const posArray = new Float32Array(6);
      const tetherGeo = new THREE.BufferGeometry();
      tetherGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      const line = new THREE.Line(tetherGeo, tetherMat);
      line.frustumCulled = false;
      line.visible = false;
      this.group.add(line);

      tethers.push({
        line,
        positions: posArray,
        anchorPos: new THREE.Vector3(),
        dragonAttachPoint: new THREE.Vector3(i % 2 === 0 ? -1.5 : 1.5, 0.5, i < 2 ? 1.0 : -2.0),
        active: false,
      });
    }

    this.group.add(dragonGroup);

    this.dragon = {
      active: true,
      awakened: true,
      hp: 2500,
      maxHp: 2500,
      phase: 1,
      pos: dragonGroup.position.clone(),
      vel: new THREE.Vector3(),
      heading: 0,
      pitch: 0,
      roll: 0,
      speed: 24.0,
      state: 'sky_patrol',
      stateTimer: 0,
      attackCooldown: 12.0,
      fireBreathTimer: 0,
      staggerTimer: 0,
      hitFlashTimer: 0,
      tethers,
      tetherCount: 0,
      group: dragonGroup,
      mainBodyMesh,
      headGroup,
      jawMesh,
      throatFireMesh,
      leftWingGroup,
      rightWingGroup,
      tailSegments,
      weakSpots,
      fireBreathConeMesh,
      targetPos: new THREE.Vector3().copy(DRAGON_PATROL_WAYPOINTS[1]),
      patrolT: 0,
    };
  }

  private initDragonHUD(): void {
    this.dragonHudEl = document.createElement('div');
    this.dragonHudEl.id = 'dragon-boss-hud';
    this.dragonHudEl.style.position = 'fixed';
    this.dragonHudEl.style.top = '18px';
    this.dragonHudEl.style.left = '50%';
    this.dragonHudEl.style.transform = 'translateX(-50%)';
    this.dragonHudEl.style.width = '440px';
    this.dragonHudEl.style.maxWidth = '92vw';
    this.dragonHudEl.style.background = 'rgba(18, 10, 10, 0.9)';
    this.dragonHudEl.style.border = '2px solid #ff3300';
    this.dragonHudEl.style.boxShadow = '0 0 28px rgba(255, 51, 0, 0.55), inset 0 0 14px rgba(0,0,0,0.85)';
    this.dragonHudEl.style.borderRadius = '10px';
    this.dragonHudEl.style.padding = '8px 14px';
    this.dragonHudEl.style.zIndex = '50';
    this.dragonHudEl.style.display = 'none';
    this.dragonHudEl.style.fontFamily = 'system-ui, sans-serif';
    this.dragonHudEl.style.color = '#fff';

    this.dragonHudEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:900;letter-spacing:1px;font-size:14px;color:#ffbe0b;">🐉 VERMITHRAX THE SMOLDERING</span>
        <span id="dragon-phase-badge" style="background:#ff3300;color:#fff;font-size:11px;font-weight:bold;padding:1px 6px;border-radius:4px;">PHASE 1: SKY SOVEREIGN</span>
      </div>
      <div style="width:100%;height:14px;background:#2b1010;border-radius:7px;overflow:hidden;border:1px solid #ff3300;">
        <div id="dragon-hp-bar" style="width:100%;height:100%;background:linear-gradient(90deg, #ffbe0b, #ff0054);transition:width 0.15s ease;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:#cbd5e1;">
        <span id="dragon-dist-label">Distance: 120m</span>
        <span>Weakness: Aerial Ground Slam & Ballista Harpoons</span>
      </div>
    `;

    document.body.appendChild(this.dragonHudEl);
    this.dragonHpBarFill = document.getElementById('dragon-hp-bar');
    this.dragonPhaseBadge = document.getElementById('dragon-phase-badge');
    this.dragonDistLabel = document.getElementById('dragon-dist-label');
  }

  public triggerMeteorShowerEvent(playerPos: THREE.Vector3): void {
    if (this.activeMeteor) return;

    // Pick impact target 85m–140m ahead
    const angle = Math.random() * Math.PI * 2;
    const dist = 75 + Math.random() * 65;
    const targetX = playerPos.x + Math.cos(angle) * dist;
    const targetZ = playerPos.z + Math.sin(angle) * dist;
    const targetY = this.chunkManager.getSurfaceHeight(targetX, targetZ);

    const startPos = new THREE.Vector3(targetX - 90, 190, targetZ - 90);
    const targetPos = new THREE.Vector3(targetX, targetY, targetZ);

    const group = new THREE.Group();
    group.position.copy(targetPos);
    group.visible = false;

    // Glowing Star-Iron Ore Meteorite Core
    const coreGeo = new THREE.DodecahedronGeometry(1.4, 1);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x00f5d4,
      roughness: 0.18,
      metalness: 0.95,
      emissive: 0x00bbf9,
      emissiveIntensity: 0.95,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.y = 0.95;
    coreMesh.castShadow = true;
    group.add(coreMesh);

    // Glowing Aura Sphere
    const auraGeo = new THREE.SphereGeometry(2.2, 16, 12);
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0x70d6ff,
      transparent: true,
      opacity: 0.35,
      wireframe: true,
    });
    const glowMesh = new THREE.Mesh(auraGeo, auraMat);
    glowMesh.position.y = 0.95;
    group.add(glowMesh);

    // Scorched Impact Crater Ring
    const craterGeo = new THREE.RingGeometry(0.8, 3.8, 24);
    craterGeo.rotateX(-Math.PI / 2);
    const craterMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a24,
      roughness: 0.95,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    const craterMesh = new THREE.Mesh(craterGeo, craterMat);
    craterMesh.position.y = 0.04;
    group.add(craterMesh);

    this.group.add(group);

    this.activeMeteor = {
      active: true,
      phase: 'falling',
      startPos,
      targetPos,
      currentPos: startPos.clone(),
      fallProgress: 0,
      coolTimer: 90.0,
      group,
      coreMesh,
      glowMesh,
      craterMesh,
      harvested: false,
    };

    this.meteorStreakLine.visible = true;
    this.relicStore.playMeteorStreakSound();
    this.onGrantBonusGold?.(0, '☄️ STARFALL EVENT! A burning Celestial Star-Iron Meteorite streaks across the sky!');
  }

  public triggerVolcanicEruption(playerPos: THREE.Vector3): void {
    this.relicStore.playMeteorStreakSound();
    this.onCameraShake?.(0.55, 0.4);
    this.onGrantBonusGold?.(0, '🌋 MOUNT DOOMFORGE ERUPTION! Molten Slag Bombs raining across the valley! Hold Shield (Shift) to Block!');

    for (let i = 0; i < this.slagBombs.length; i++) {
      const bomb = this.slagBombs[i];
      bomb.active = true;
      bomb.pos.set(VOLCANO_X + (Math.random() - 0.5) * 20, 160, VOLCANO_Z + (Math.random() - 0.5) * 20);

      // Target area near player
      const targetX = playerPos.x + (Math.random() - 0.5) * 80;
      const targetZ = playerPos.z + (Math.random() - 0.5) * 80;
      const dx = targetX - bomb.pos.x;
      const dz = targetZ - bomb.pos.z;

      bomb.vel.set(dx * 0.28, 18.0 + Math.random() * 12.0, dz * 0.28);
      bomb.mesh.position.copy(bomb.pos);
      bomb.mesh.visible = true;
    }
  }

  public tryHitTitanWithMelee(playerPos: THREE.Vector3, damage: number): boolean {
    if (!this.titan.active || !this.titan.awakened || this.titan.hp <= 0) return false;
    const dist = playerPos.distanceTo(this.titan.pos);
    if (dist <= 6.8) {
      this.damageTitan(damage * 1.5, playerPos);
      return true;
    }
    return false;
  }

  public tryHitTitanWithArrow(arrowPos: THREE.Vector3, damage: number): boolean {
    if (!this.titan.active || !this.titan.awakened || this.titan.hp <= 0) return false;
    const dx = arrowPos.x - this.titan.pos.x;
    const dz = arrowPos.z - this.titan.pos.z;
    const dy = arrowPos.y - (this.titan.pos.y + 6.0);
    if (dx * dx + dz * dz <= 4.5 * 4.5 && Math.abs(dy) <= 4.0) {
      const isHeadshot = arrowPos.y >= this.titan.pos.y + 7.5;
      const finalDmg = isHeadshot ? damage * 2.2 : damage;
      this.damageTitan(finalDmg, arrowPos);
      return true;
    }
    return false;
  }

  public tryHitDragonWithArrow(arrowPos: THREE.Vector3, damage = 55): boolean {
    if (!this.dragon.active || this.dragon.hp <= 0) return false;

    // Fast bounding sphere check before weak spot probes (zero-allocation)
    const distSq = arrowPos.distanceToSquared(this.dragon.pos);
    if (distSq > 18.0 * 18.0) return false;

    // Check weak spots (crest, wing_left, wing_right)
    for (const ws of this.dragon.weakSpots) {
      ws.mesh.getWorldPosition(_scratchDragonPos);
      if (arrowPos.distanceToSquared(_scratchDragonPos) <= ws.radius * ws.radius) {
        this.damageDragon(damage, ws.location);
        return true;
      }
    }

    // Check main body
    if (distSq <= 6.8 * 6.8) {
      this.damageDragon(damage, 'body');
      return true;
    }
    return false;
  }

  public tryMineMeteorCore(playerPos: THREE.Vector3): boolean {
    if (!this.activeMeteor || this.activeMeteor.phase !== 'landed' || this.activeMeteor.harvested) {
      return false;
    }

    const dist = playerPos.distanceTo(this.activeMeteor.targetPos);
    if (dist <= 4.2) {
      this.activeMeteor.harvested = true;
      this.activeMeteor.phase = 'harvested';
      this.activeMeteor.coreMesh.scale.setScalar(0.4);
      this.activeMeteor.glowMesh.visible = false;

      this.relicStore.playSpeedGateChimeSound(5);
      this.dwarf.spawnBurst(playerPos.x, playerPos.y + 1.0, playerPos.z, 32);

      this.onGrantBonusGold?.(
        500,
        '🌟 HARVESTED CELESTIAL STAR-IRON! +500 Gold & Rare Celestial Core for Legendary Armor!'
      );
      return true;
    }
    return false;
  }

  private damageTitan(amount: number, hitPos: THREE.Vector3): void {
    this.titan.hp = Math.max(0, this.titan.hp - amount);
    this.titan.hitFlashTimer = 0.22;
    this.dwarf.spawnBurst(hitPos.x, hitPos.y, hitPos.z, 16);

    // Update Phases
    const hpRatio = this.titan.hp / this.titan.maxHp;
    if (hpRatio <= 0.35 && this.titan.phase !== 3) {
      this.titan.phase = 3;
      this.relicStore.playTitanRoarSound();
      this.onCameraShake?.(0.65, 0.45);
      this.onGrantBonusGold?.(0, '🌋 CRAG-TITAN ENRAGED! Phase 3: Molten Overload Barrage!');
      (this.titan.magmaCoreMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.8;
    } else if (hpRatio <= 0.7 && this.titan.phase === 1) {
      this.titan.phase = 2;
      this.relicStore.playTitanRoarSound();
      this.onCameraShake?.(0.48, 0.35);
      this.onGrantBonusGold?.(0, '🌋 CRAG-TITAN ENTERED PHASE 2: Magma Fissures & Ground Quake!');
    }

    if (this.titan.hp <= 0) {
      this.defeatTitan();
    }
  }

  private defeatTitan(): void {
    this.titan.state = 'dying';
    this.titan.stateTimer = 3.5;
    this.relicStore.playTitanDefeatedFanfare();
    this.onCameraShake?.(0.75, 0.6);
    this.dwarf.spawnBurst(this.titan.pos.x, this.titan.pos.y + 4.0, this.titan.pos.z, 60);

    if (this.titanHudEl) this.titanHudEl.style.display = 'none';

    this.onGrantBonusGold?.(
      1000,
      '🏆 DEFEATED CRAG-TITAN ANCESTOR! +1,000 Gold, Titan\'s Molten Heart & Titan Slayer Trophy (+20 Max ❤️)!'
    );
  }

  public update(dt: number, elapsedTime: number, playerPos: THREE.Vector3, isInsideInterior: boolean): void {
    if (isInsideInterior) {
      if (this.titanHudEl) this.titanHudEl.style.display = 'none';
      if (this.dragonHudEl) this.dragonHudEl.style.display = 'none';
      return;
    }

    // 1. Celestial Meteor Shower Timer
    this.meteorTimer -= dt;
    if (this.meteorTimer <= 0) {
      this.meteorTimer = 420.0 + Math.random() * 180.0;
      this.triggerMeteorShowerEvent(playerPos);
    }
    this.updateMeteorPhysics(dt);

    // 2. Volcanic Slag Eruption Timer
    this.eruptionTimer -= dt;
    if (this.eruptionTimer <= 0) {
      this.eruptionTimer = 320.0 + Math.random() * 140.0;
      this.triggerVolcanicEruption(playerPos);
    }
    this.updateVolcanicSlagBombs(dt, playerPos);

    // 3. Crag-Titan World Boss
    this.updateCragTitan(dt, elapsedTime, playerPos);

    // 4. Rolling Boulders
    this.updateRollingBoulders(dt, playerPos);

    // 5. Colossal Ash-Peak Wyrm (Vermithrax the Smoldering)
    this.updateDragon(dt, elapsedTime, playerPos);
  }

  private updateMeteorPhysics(dt: number): void {
    if (!this.activeMeteor) return;

    if (this.activeMeteor.phase === 'falling') {
      this.activeMeteor.fallProgress += dt * 0.42; // ~2.4 seconds flight
      this.activeMeteor.currentPos.lerpVectors(
        this.activeMeteor.startPos,
        this.activeMeteor.targetPos,
        this.activeMeteor.fallProgress
      );

      // Update streak line
      this.meteorStreakPos[0] = this.activeMeteor.currentPos.x - 12;
      this.meteorStreakPos[1] = this.activeMeteor.currentPos.y + 18;
      this.meteorStreakPos[2] = this.activeMeteor.currentPos.z - 12;
      this.meteorStreakPos[3] = this.activeMeteor.currentPos.x;
      this.meteorStreakPos[4] = this.activeMeteor.currentPos.y;
      this.meteorStreakPos[5] = this.activeMeteor.currentPos.z;
      this.meteorStreakGeo.attributes.position.needsUpdate = true;

      if (this.activeMeteor.fallProgress >= 1.0) {
        // Ground Impact!
        this.activeMeteor.phase = 'landed';
        this.activeMeteor.group.visible = true;
        this.meteorStreakLine.visible = false;

        this.relicStore.playMeteorImpactSound();
        this.onCameraShake?.(0.68, 0.42);
        this.dwarf.spawnBurst(
          this.activeMeteor.targetPos.x,
          this.activeMeteor.targetPos.y + 0.8,
          this.activeMeteor.targetPos.z,
          45
        );
      }
    } else if (this.activeMeteor.phase === 'landed') {
      this.activeMeteor.coolTimer -= dt;
      this.activeMeteor.glowMesh.rotation.y += dt * 0.6;
      this.activeMeteor.glowMesh.rotation.x += dt * 0.4;

      if (this.activeMeteor.coolTimer <= 0) {
        // Cooled to basalt
        this.activeMeteor.phase = 'harvested';
        (this.activeMeteor.coreMesh.material as THREE.MeshStandardMaterial).color.setHex(0x333333);
        (this.activeMeteor.coreMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
        this.activeMeteor.glowMesh.visible = false;
      }
    }
  }

  private updateVolcanicSlagBombs(dt: number, playerPos: THREE.Vector3): void {
    for (const bomb of this.slagBombs) {
      if (!bomb.active) continue;

      bomb.vel.y -= 24.0 * dt; // Gravity
      bomb.pos.x += bomb.vel.x * dt;
      bomb.pos.y += bomb.vel.y * dt;
      bomb.pos.z += bomb.vel.z * dt;
      bomb.mesh.position.copy(bomb.pos);

      const groundY = this.chunkManager.getSurfaceHeight(bomb.pos.x, bomb.pos.z);
      if (bomb.pos.y <= groundY + 0.4) {
        // Impact!
        bomb.active = false;
        bomb.mesh.visible = false;

        this.relicStore.playBombExplosionSound();
        this.onCameraShake?.(0.35, 0.22);
        this.dwarf.spawnBurst(bomb.pos.x, groundY + 0.5, bomb.pos.z, 22);

        // Spawn harvestable Obsidian Shard (+75 Gold) using shared static assets
        const shardAssets = getSharedShardAssets();
        const shardMesh = new THREE.Mesh(shardAssets.geo, shardAssets.mat);
        shardMesh.position.set(bomb.pos.x, groundY + 0.35, bomb.pos.z);
        this.group.add(shardMesh);
        this.obsidianShards.push({
          pos: shardMesh.position.clone(),
          mesh: shardMesh,
          collected: false,
        });

        // Player hit check (distance squared <= 4.8^2 = 23.04)
        if (playerPos.distanceToSquared(bomb.pos) <= 23.04) {
          if (this.dwarf.isShieldBlocking()) {
            this.dwarf.triggerBlockImpact();
            this.relicStore.playShieldBashSound();
            this.onGrantBonusGold?.(0, '🛡️ Shield Blocked Volcanic Slag Bomb! (0 Damage)');
          } else {
            this.onApplyPlayerDamage?.(24, 'Volcanic Slag Bomb');
          }
        }
      }
    }

    // Collect Obsidian Shards (distance squared <= 2.2^2 = 4.84)
    for (let i = this.obsidianShards.length - 1; i >= 0; i--) {
      const s = this.obsidianShards[i];
      s.mesh.rotation.y += dt * 2.2;
      if (!s.collected && playerPos.distanceToSquared(s.pos) <= 4.84) {
        s.collected = true;
        this.group.remove(s.mesh);
        this.obsidianShards.splice(i, 1);
        this.relicStore.playSpeedGateChimeSound(3);
        this.dwarf.spawnBurst(s.pos.x, s.pos.y, s.pos.z, 12);
        this.onGrantBonusGold?.(75, '💎 Collected Volcanic Obsidian Shard! +75 Gold');
      }
    }
  }

  private updateCragTitan(dt: number, elapsedTime: number, playerPos: THREE.Vector3): void {
    if (!this.titan.active) return;

    const tdx = playerPos.x - this.titan.pos.x;
    const tdz = playerPos.z - this.titan.pos.z;
    const distSq = tdx * tdx + tdz * tdz;

    // Awakening check (within 45m of altar => 45^2 = 2025)
    if (!this.titan.awakened && distSq <= 2025.0) {
      this.titan.awakened = true;
      this.relicStore.playTitanRoarSound();
      this.onCameraShake?.(0.58, 0.45);
      this.onGrantBonusGold?.(0, '🌋 CRAG-TITAN AWAKENED! Defeat the ancient colossus to claim the Titan\'s Heart!');
    }

    if (this.titan.awakened && this.titan.hp > 0) {
      // Show & Update Boss Bar (throttled to 10 Hz)
      this.titanHudAccum += dt;
      if (this.titanHudEl && this.titanHudAccum >= 0.1) {
        this.titanHudAccum = 0;
        this.titanHudEl.style.display = 'block';
        if (this.titanHpBarFill) {
          const hpRatioStr = `${Math.max(0, Math.round((this.titan.hp / this.titan.maxHp) * 100))}%`;
          if (hpRatioStr !== this.lastTitanHpText) {
            this.lastTitanHpText = hpRatioStr;
            this.titanHpBarFill.style.width = hpRatioStr;
          }
        }
        if (this.titanPhaseBadge) {
          const phaseStr =
            this.titan.phase === 3
              ? 'PHASE 3: MOLTEN OVERLOAD'
              : this.titan.phase === 2
              ? 'PHASE 2: MAGMA QUAKE'
              : 'PHASE 1: STONE STOMP';
          if (phaseStr !== this.lastTitanPhaseText) {
            this.lastTitanPhaseText = phaseStr;
            this.titanPhaseBadge.textContent = phaseStr;
          }
        }
        if (this.titanDistLabel) {
          const distStr = `Distance: ${Math.round(Math.sqrt(distSq))}m • HP: ${this.titan.hp}/${this.titan.maxHp}`;
          if (distStr !== this.lastTitanDistText) {
            this.lastTitanDistText = distStr;
            this.titanDistLabel.textContent = distStr;
          }
        }
      }

      // Rotate Titan towards player
      const targetHeading = Math.atan2(tdx, tdz);
      this.titan.heading = targetHeading;
      this.titan.group.rotation.y = targetHeading;

      // Pulse Magma Core
      const pulse = 0.85 + Math.sin(elapsedTime * (this.titan.phase === 3 ? 9.0 : 4.5)) * 0.35;
      (this.titan.magmaCoreMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;

      // Boss Attacks
      this.titan.attackCooldown -= dt;
      if (this.titan.attackCooldown <= 0) {
        this.titan.attackCooldown = this.titan.phase === 3 ? 2.8 : 4.5;
        this.performTitanAttack(playerPos, Math.sqrt(distSq));
      }
    } else if (this.titan.state === 'dying') {
      this.titan.stateTimer -= dt;
      this.titan.group.position.y -= dt * 1.8;
      if (this.titan.stateTimer <= 0) {
        this.titan.active = false;
        this.titan.group.visible = false;
      }
    }
  }

  private performTitanAttack(playerPos: THREE.Vector3, dist: number): void {
    if (this.titan.phase === 1) {
      // Boulder Throw
      this.relicStore.playTitanRoarSound();
      this.spawnRollingBoulder(playerPos);
    } else if (this.titan.phase === 2) {
      // Ground Quake Stomp
      this.relicStore.playTitanStompSound();
      this.onCameraShake?.(0.55, 0.35);
      this.dwarf.spawnBurst(this.titan.pos.x, this.titan.pos.y + 0.2, this.titan.pos.z, 35);
      if (dist <= 16.0 && this.dwarf.root.position.y <= this.titan.pos.y + 0.8) {
        this.onApplyPlayerDamage?.(28, 'Titan Ground-Quake');
      }
    } else {
      // Phase 3: Boulder + Stomp Shockwave
      this.relicStore.playTitanRoarSound();
      this.spawnRollingBoulder(playerPos);
      this.onCameraShake?.(0.65, 0.4);
      if (dist <= 14.0) {
        this.onApplyPlayerDamage?.(32, 'Molten Overload Shockwave');
      }
    }
  }

  private spawnRollingBoulder(playerPos: THREE.Vector3): void {
    let boulder = this.boulderPool.find((b) => !b.active);
    if (!boulder) {
      boulder = this.boulderPool.reduce((oldest, b) => (b.life < oldest.life ? b : oldest), this.boulderPool[0]);
    }
    boulder.active = true;
    boulder.life = 5.5;
    boulder.pos.set(this.titan.pos.x, this.titan.pos.y + 6.2, this.titan.pos.z);
    boulder.mesh.position.copy(boulder.pos);
    boulder.mesh.visible = true;

    _scratchBoulderDir.subVectors(playerPos, this.titan.pos).normalize();
    boulder.vel.copy(_scratchBoulderDir).multiplyScalar(18.0);
  }

  private updateRollingBoulders(dt: number, playerPos: THREE.Vector3): void {
    for (let i = 0; i < this.boulderPool.length; i++) {
      const b = this.boulderPool[i];
      if (!b.active) continue;
      b.life -= dt;
      b.pos.x += b.vel.x * dt;
      b.pos.z += b.vel.z * dt;
      b.pos.y = this.chunkManager.getSurfaceHeight(b.pos.x, b.pos.z) + 1.6;
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += dt * 6.0;

      // Hit player check (distance squared <= 2.8^2 = 7.84)
      if (playerPos.distanceToSquared(b.pos) <= 7.84) {
        if (this.dwarf.isShieldBlocking()) {
          this.dwarf.triggerBlockImpact();
          this.relicStore.playShieldBashSound();
          this.onGrantBonusGold?.(0, '🛡️ Shield Deflected Titan Boulder!');
        } else {
          this.onApplyPlayerDamage?.(30, 'Crag-Titan Boulder');
        }
        b.life = 0;
      }

      if (b.life <= 0) {
        b.active = false;
        b.mesh.visible = false;
      }
    }
  }

  private updateDragon(dt: number, elapsedTime: number, playerPos: THREE.Vector3): void {
    if (!this.dragon.active) return;

    // 1. Flight State Evaluation
    if (this.dragon.state === 'sky_patrol') {
      const numPts = DRAGON_PATROL_WAYPOINTS.length;
      this.dragon.patrolT += (dt * this.dragon.speed) / 520.0;
      const tNorm = ((this.dragon.patrolT % 1.0) + 1.0) % 1.0;
      const totalT = tNorm * numPts;
      const curIdx = Math.floor(totalT);
      const nextIdx = (curIdx + 1) % numPts;
      const segT = totalT - curIdx;

      _scratchDragonPos.lerpVectors(
        DRAGON_PATROL_WAYPOINTS[curIdx],
        DRAGON_PATROL_WAYPOINTS[nextIdx],
        segT
      );
      _scratchDragonNext.lerpVectors(
        DRAGON_PATROL_WAYPOINTS[curIdx],
        DRAGON_PATROL_WAYPOINTS[nextIdx],
        Math.min(1.0, segT + 0.04)
      );

      _scratchDragonDir.subVectors(_scratchDragonNext, _scratchDragonPos).normalize();
      this.dragon.pos.copy(_scratchDragonPos);
      this.dragon.group.position.copy(this.dragon.pos);

      // Smooth heading, pitch, and roll
      const targetYaw = Math.atan2(_scratchDragonDir.x, _scratchDragonDir.z);
      const diffYaw =
        THREE.MathUtils.euclideanModulo(targetYaw - this.dragon.heading + Math.PI, Math.PI * 2) -
        Math.PI;
      this.dragon.heading += diffYaw * Math.min(1.0, dt * 2.8);
      this.dragon.pitch = THREE.MathUtils.clamp(-_scratchDragonDir.y * 1.2, -0.6, 0.6);
      this.dragon.roll = THREE.MathUtils.clamp(-diffYaw * 3.5, -0.75, 0.75);

      this.dragon.group.rotation.set(
        this.dragon.pitch,
        this.dragon.heading,
        this.dragon.roll,
        'YXZ'
      );

      // Periodic Roar & Aerial Presence
      this.dragonRoarCooldown -= dt;
      if (this.dragonRoarCooldown <= 0) {
        this.dragonRoarCooldown = 45.0 + Math.random() * 30.0;
        const d = playerPos.distanceTo(this.dragon.pos);
        if (d <= 180.0) {
          this.relicStore.playDragonRoarSound();
          this.onCameraShake?.(0.45, 0.35);
        }
      }

      // If in Phase 2/3 and player gets close, occasional swoop dive
      this.dragon.attackCooldown -= dt;
      if (this.dragon.phase >= 2 && this.dragon.attackCooldown <= 0) {
        const dPlayer = playerPos.distanceTo(this.dragon.pos);
        if (dPlayer <= 110.0) {
          this.dragon.state = 'dive_bomb';
          this.dragon.stateTimer = 5.5;
          this.dragon.targetPos.set(playerPos.x, playerPos.y + 4.0, playerPos.z);
          this.dragon.attackCooldown = 22.0;
          this.relicStore.playDragonRoarSound();
          this.onCameraShake?.(0.6, 0.4);
        }
      }
    } else if (this.dragon.state === 'dive_bomb') {
      this.dragon.stateTimer -= dt;
      _scratchDragonDir.subVectors(this.dragon.targetPos, this.dragon.pos).normalize();
      this.dragon.pos.addScaledVector(_scratchDragonDir, this.dragon.speed * 1.6 * dt);
      this.dragon.group.position.copy(this.dragon.pos);

      const targetYaw = Math.atan2(_scratchDragonDir.x, _scratchDragonDir.z);
      this.dragon.heading = targetYaw;
      this.dragon.pitch = THREE.MathUtils.clamp(-_scratchDragonDir.y * 1.4, -0.8, 0.8);
      this.dragon.group.rotation.set(this.dragon.pitch, this.dragon.heading, 0, 'YXZ');

      // Fire breath activation during dive
      this.dragon.fireBreathTimer += dt;
      const wantBreath = this.dragon.stateTimer < 3.8 && this.dragon.stateTimer > 1.2;
      this.dragon.fireBreathConeMesh.visible = wantBreath;
      if (wantBreath) {
        (this.dragon.fireBreathConeMesh.material as THREE.MeshBasicMaterial).opacity = 0.75;
        this.dragon.jawMesh.rotation.x = 0.45;
        if (this.dragon.fireBreathTimer >= 0.7) {
          this.dragon.fireBreathTimer = 0;
          this.relicStore.playDragonFireBreathSound();
          if (playerPos.distanceTo(this.dragon.pos) <= 28.0) {
            if (this.dwarf.isShieldBlocking()) {
              this.dwarf.triggerBlockImpact();
              this.relicStore.playShieldBashSound();
              this.onGrantBonusGold?.(0, '🛡️ Shield Deflected Dragon Fire Breath!');
            } else {
              this.onApplyPlayerDamage?.(35, 'Dragon Fire Breath');
            }
          }
        }
      } else {
        this.dragon.jawMesh.rotation.x = 0;
      }

      if (this.dragon.stateTimer <= 0 || this.dragon.pos.y <= playerPos.y + 3.0) {
        this.dragon.state = 'sky_patrol';
        this.dragon.fireBreathConeMesh.visible = false;
        this.dragon.jawMesh.rotation.x = 0;
      }
    } else if (this.dragon.state === 'tethered_grounded') {
      this.dragon.stateTimer -= dt;
      const groundY = this.chunkManager.getSurfaceHeight(this.dragon.pos.x, this.dragon.pos.z);
      this.dragon.pos.y = THREE.MathUtils.lerp(this.dragon.pos.y, groundY + 1.2, dt * 3.5);
      this.dragon.group.position.copy(this.dragon.pos);
      this.dragon.pitch = THREE.MathUtils.lerp(this.dragon.pitch, 0, dt * 4.0);
      this.dragon.roll = THREE.MathUtils.lerp(this.dragon.roll, 0, dt * 4.0);
      this.dragon.group.rotation.set(
        this.dragon.pitch,
        this.dragon.heading,
        this.dragon.roll,
        'YXZ'
      );

      // Break free from tethers after duration
      if (this.dragon.stateTimer <= 0) {
        this.breakDragonTethers();
        this.dragon.state = 'recovering';
        this.dragon.stateTimer = 4.0;
        this.relicStore.playDragonRoarSound();
      }
    } else if (this.dragon.state === 'recovering') {
      this.dragon.stateTimer -= dt;
      this.dragon.pos.y += dt * 14.0;
      this.dragon.group.position.copy(this.dragon.pos);
      this.dragon.pitch = -0.55;
      this.dragon.group.rotation.set(this.dragon.pitch, this.dragon.heading, 0, 'YXZ');

      if (this.dragon.pos.y >= 52.0 || this.dragon.stateTimer <= 0) {
        this.dragon.state = 'sky_patrol';
        this.dragon.pitch = 0;
      }
    }

    // 2. Flapping Animation
    const flapFreq =
      this.dragon.state === 'dive_bomb' ? 1.6 : this.dragon.state === 'tethered_grounded' ? 1.2 : 3.6;
    const flap = Math.sin(elapsedTime * flapFreq);
    this.dragon.leftWingGroup.rotation.z = flap * 0.42;
    this.dragon.rightWingGroup.rotation.z = -flap * 0.42;

    // 3. Tail whipping
    for (let i = 0; i < this.dragon.tailSegments.length; i++) {
      this.dragon.tailSegments[i].rotation.y = Math.sin(elapsedTime * 2.8 - i * 0.6) * 0.16;
    }

    // 4. Hit Flash recovery
    if (this.dragon.hitFlashTimer > 0) {
      this.dragon.hitFlashTimer -= dt;
      if (this.dragon.hitFlashTimer <= 0) {
        (this.dragon.mainBodyMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x440800);
      }
    }

    // 5. Update Harpoon Tether Lines
    for (const t of this.dragon.tethers) {
      if (!t.active) {
        t.line.visible = false;
        continue;
      }
      t.line.visible = true;
      _scratchTetherStart.copy(t.anchorPos);
      _scratchTetherEnd.copy(this.dragon.pos).add(t.dragonAttachPoint);

      t.positions[0] = _scratchTetherStart.x;
      t.positions[1] = _scratchTetherStart.y;
      t.positions[2] = _scratchTetherStart.z;
      t.positions[3] = _scratchTetherEnd.x;
      t.positions[4] = _scratchTetherEnd.y;
      t.positions[5] = _scratchTetherEnd.z;
      t.line.geometry.attributes.position.needsUpdate = true;
    }

    // 6. HUD update
    this.updateDragonHUD(dt, playerPos);
  }

  private updateDragonHUD(dt: number, playerPos: THREE.Vector3): void {
    if (!this.dragonHudEl || !this.dragonHpBarFill) return;

    const dist = playerPos.distanceTo(this.dragon.pos);
    const inRange =
      dist <= 190.0 ||
      this.dragon.state === 'tethered_grounded' ||
      this.dragon.state === 'dive_bomb';

    if (!inRange || !this.dragon.active || this.dragon.hp <= 0) {
      if (this.dragonHudEl.style.display !== 'none') {
        this.dragonHudEl.style.display = 'none';
      }
      return;
    }

    if (this.dragonHudEl.style.display !== 'block') {
      this.dragonHudEl.style.display = 'block';
    }

    this.dragonHudAccum += dt;
    if (this.dragonHudAccum < 0.1) return;
    this.dragonHudAccum = 0;

    // HP Bar Fill
    const pct = Math.max(0, Math.min(100, (this.dragon.hp / this.dragon.maxHp) * 100));
    const hpStr = `${pct.toFixed(1)}%`;
    if (hpStr !== this.lastDragonHpText) {
      this.lastDragonHpText = hpStr;
      this.dragonHpBarFill.style.width = hpStr;
    }

    // Phase Badge
    const phaseStr =
      this.dragon.state === 'tethered_grounded'
        ? `⛓️ GROUNDED WYRM (${this.dragon.tetherCount} TETHERS)`
        : this.dragon.phase === 3
        ? 'PHASE 3: DESPERATE FURY'
        : this.dragon.phase === 2
        ? 'PHASE 2: VOLCANIC INFERNO'
        : 'PHASE 1: SKY SOVEREIGN';
    if (phaseStr !== this.lastDragonPhaseText && this.dragonPhaseBadge) {
      this.lastDragonPhaseText = phaseStr;
      this.dragonPhaseBadge.textContent = phaseStr;
    }

    // Distance Label
    const distStr = `Distance: ${Math.round(dist)}m • ${this.dragon.state.toUpperCase().replace('_', ' ')}`;
    if (distStr !== this.lastDragonDistText && this.dragonDistLabel) {
      this.lastDragonDistText = distStr;
      this.dragonDistLabel.textContent = distStr;
    }
  }

  public getDragon(): DragonBoss {
    return this.dragon;
  }

  public getDragonInfo(): {
    active: boolean;
    pos: THREE.Vector3;
    hp: number;
    maxHp: number;
    state: string;
  } {
    return {
      active: this.dragon.active,
      pos: this.dragon.pos,
      hp: this.dragon.hp,
      maxHp: this.dragon.maxHp,
      state: this.dragon.state,
    };
  }

  public damageDragon(
    damage: number,
    hitLocation?: 'crest' | 'wing_left' | 'wing_right' | 'body'
  ): { defeated: boolean; damageDealt: number } {
    if (!this.dragon.active || this.dragon.hp <= 0) {
      return { defeated: false, damageDealt: 0 };
    }

    let multiplier = 1.0;
    let locationMsg = '';
    if (hitLocation === 'crest') {
      multiplier = 2.5;
      locationMsg = '💥 CRITICAL WEAK SPOT HIT! (Spinal Crest)';
    } else if (hitLocation === 'wing_left' || hitLocation === 'wing_right') {
      multiplier = 1.8;
      locationMsg = '🎯 WING CRIPPLE HIT!';
    }

    const actualDmg = Math.round(damage * multiplier);
    this.dragon.hp = Math.max(0, this.dragon.hp - actualDmg);

    // Hit Flash
    this.dragon.hitFlashTimer = 0.18;
    (this.dragon.mainBodyMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xffffff);

    this.dwarf.spawnBurst(this.dragon.pos.x, this.dragon.pos.y, this.dragon.pos.z, 28);
    this.relicStore.playShieldBashSound();

    if (locationMsg) {
      this.onGrantBonusGold?.(0, `${locationMsg} -${actualDmg} HP`);
    }

    // Phase checks
    if (this.dragon.phase === 1 && this.dragon.hp <= 1650) {
      this.dragon.phase = 2;
      this.relicStore.playDragonRoarSound();
      this.onCameraShake?.(0.65, 0.4);
    } else if (this.dragon.phase === 2 && this.dragon.hp <= 800) {
      this.dragon.phase = 3;
      this.dragon.speed = 30.0;
      this.relicStore.playDragonRoarSound();
      this.onCameraShake?.(0.8, 0.5);
    }

    if (this.dragon.hp <= 0) {
      this.dragon.active = false;
      this.dragon.state = 'defeated';
      this.dragon.group.visible = false;
      this.breakDragonTethers();
      if (this.dragonHudEl) this.dragonHudEl.style.display = 'none';

      this.relicStore.playDragonDefeatedSound();
      this.onCameraShake?.(0.9, 0.8);
      this.onGrantBonusGold?.(
        2500,
        '👑 SLAIN VERMITHRAX THE SMOLDERING! +2,500 Gold, 5 Dragon Scales & Dragon Heart! Title: DRAGON-SLAYER REGENT'
      );
      return { defeated: true, damageDealt: actualDmg };
    }

    return { defeated: false, damageDealt: actualDmg };
  }

  public tetherDragonWithHarpoon(
    anchorPos: THREE.Vector3
  ): { success: boolean; totalTethers: number } {
    if (!this.dragon.active || this.dragon.hp <= 0) {
      return { success: false, totalTethers: this.dragon.tetherCount };
    }

    const slot = this.dragon.tethers.find((t) => !t.active);
    if (!slot) {
      return { success: false, totalTethers: this.dragon.tetherCount };
    }

    slot.active = true;
    slot.anchorPos.copy(anchorPos);
    this.dragon.tetherCount++;

    this.relicStore.playDragonHarpoonImpaleSound();
    this.dwarf.spawnBurst(this.dragon.pos.x, this.dragon.pos.y, this.dragon.pos.z, 20);

    if (this.dragon.tetherCount >= 3 && this.dragon.state !== 'tethered_grounded') {
      this.dragon.state = 'tethered_grounded';
      this.dragon.stateTimer = 18.0;
      this.relicStore.playDragonRoarSound();
      this.onCameraShake?.(0.85, 0.55);
      this.onGrantBonusGold?.(
        0,
        '⛓️ DRAGON GROUNDED! Castle Roof Ballistae tethered Vermithrax to the courtyard! Strike now!'
      );
    }

    return { success: true, totalTethers: this.dragon.tetherCount };
  }

  public breakDragonTethers(): void {
    for (const t of this.dragon.tethers) {
      t.active = false;
      t.line.visible = false;
    }
    this.dragon.tetherCount = 0;
  }

  public applyGroundSlamOnDragon(
    playerPos: THREE.Vector3,
    radius: number,
    damage: number
  ): boolean {
    if (!this.dragon.active || this.dragon.hp <= 0) return false;

    const distToDragon = playerPos.distanceTo(this.dragon.pos);
    if (distToDragon <= radius + 3.8) {
      this.damageDragon(damage * 2.2, 'crest');
      this.relicStore.playGroundSlamImpactSound();
      this.relicStore.playDragonRoarSound();
      this.onCameraShake?.(0.85, 0.5);

      if (this.dragon.state === 'sky_patrol' || this.dragon.state === 'dive_bomb') {
        this.dragon.state = 'tethered_grounded';
        this.dragon.stateTimer = 12.0;
        this.onGrantBonusGold?.(
          0,
          '💥 HEROIC DRAGON MOUNT SLAM! Vermithrax crashed onto the mountain slope! Staggered for 12s!'
        );
      }
      return true;
    }
    return false;
  }

  public dispose(): void {
    this.titanHudEl?.remove();
    this.dragonHudEl?.remove();
    for (const t of this.dragon.tethers) {
      t.line.geometry.dispose();
      (t.line.material as THREE.Material).dispose();
    }
    this.meteorStreakGeo.dispose();
    sharedShardGeo?.dispose();
    sharedShardMat?.dispose();
    sharedBoulderGeo?.dispose();
    sharedBoulderMat?.dispose();
    sharedShardGeo = null;
    sharedShardMat = null;
    sharedBoulderGeo = null;
    sharedBoulderMat = null;
  }
}
