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

  // Rolling Boulders from Titan Throw
  private activeBoulders: Array<{
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    mesh: THREE.Mesh;
    life: number;
  }> = [];

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

        // Player hit check
        const d = playerPos.distanceTo(bomb.pos);
        if (d <= 4.8) {
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

    // Collect Obsidian Shards
    for (let i = this.obsidianShards.length - 1; i >= 0; i--) {
      const s = this.obsidianShards[i];
      s.mesh.rotation.y += dt * 2.2;
      if (!s.collected && playerPos.distanceTo(s.pos) <= 2.2) {
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

    const dist = playerPos.distanceTo(this.titan.pos);

    // Awakening check (within 45m of altar)
    if (!this.titan.awakened && dist <= 45.0) {
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
          const distStr = `Distance: ${Math.round(dist)}m • HP: ${this.titan.hp}/${this.titan.maxHp}`;
          if (distStr !== this.lastTitanDistText) {
            this.lastTitanDistText = distStr;
            this.titanDistLabel.textContent = distStr;
          }
        }
      }

      // Rotate Titan towards player
      const dx = playerPos.x - this.titan.pos.x;
      const dz = playerPos.z - this.titan.pos.z;
      const targetHeading = Math.atan2(dx, dz);
      this.titan.heading = targetHeading;
      this.titan.group.rotation.y = targetHeading;

      // Pulse Magma Core
      const pulse = 0.85 + Math.sin(elapsedTime * (this.titan.phase === 3 ? 9.0 : 4.5)) * 0.35;
      (this.titan.magmaCoreMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;

      // Boss Attacks
      this.titan.attackCooldown -= dt;
      if (this.titan.attackCooldown <= 0) {
        this.titan.attackCooldown = this.titan.phase === 3 ? 2.8 : 4.5;
        this.performTitanAttack(playerPos, dist);
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
    const bAssets = getSharedBoulderAssets();
    const mesh = new THREE.Mesh(bAssets.geo, bAssets.mat);
    mesh.position.set(this.titan.pos.x, this.titan.pos.y + 6.2, this.titan.pos.z);
    mesh.castShadow = true;
    this.group.add(mesh);

    _scratchBoulderDir.subVectors(playerPos, this.titan.pos).normalize();
    this.activeBoulders.push({
      pos: mesh.position.clone(),
      vel: _scratchBoulderDir.clone().multiplyScalar(18.0),
      mesh,
      life: 5.5,
    });
  }

  private updateRollingBoulders(dt: number, playerPos: THREE.Vector3): void {
    for (let i = this.activeBoulders.length - 1; i >= 0; i--) {
      const b = this.activeBoulders[i];
      b.life -= dt;
      b.pos.x += b.vel.x * dt;
      b.pos.z += b.vel.z * dt;
      b.pos.y = this.chunkManager.getSurfaceHeight(b.pos.x, b.pos.z) + 1.6;
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += dt * 6.0;

      // Hit player check
      if (playerPos.distanceTo(b.pos) <= 2.8) {
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
        this.group.remove(b.mesh);
        this.activeBoulders.splice(i, 1);
      }
    }
  }

  public dispose(): void {
    this.titanHudEl?.remove();
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
