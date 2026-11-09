import * as THREE from 'three';
import { WorldConfig } from './Config';
import { TerrainNoise, createSeededRandom } from './TerrainNoise';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { RelicStore } from '../player/RelicStore';
import { ChunkManager } from './ChunkManager';

export interface GrappleAnchor {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  type: 'cliff' | 'tree' | 'rampart';
  dist: number;
}

export interface SpeedGateInstance {
  id: string;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  group: THREE.Group;
  archMesh: THREE.Mesh;
  passed: boolean;
  pulsePhase: number;
}

export interface ZiplineStation {
  id: string;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  length: number;
  direction: THREE.Vector3;
  group: THREE.Group;
  cableMesh: THREE.Line;
}

const _scratchCamDir = new THREE.Vector3();
const _scratchNorm = new THREE.Vector3();
const _scratchDwarfHand = new THREE.Vector3();
const _scratchToAnchor = new THREE.Vector3();

export class MountainTraversalManager {
  public readonly group = new THREE.Group();

  // Active Grapple Hook State
  private isGrappling = false;
  private grapplePhase: 'none' | 'firing' | 'pulling' = 'none';
  private grappleAnchorPos = new THREE.Vector3();
  private grappleAnchor: THREE.Vector3 | null = null;
  private grappleFlightProgress = 0;
  private grappleCurrentTip = new THREE.Vector3();
  private tetherLine!: THREE.Line;
  private tetherGeo!: THREE.BufferGeometry;
  private tetherMat!: THREE.LineBasicMaterial;
  private tetherPositions = new Float32Array(6); // 2 vertices x 3 (start -> end)
  private hookMesh!: THREE.Mesh;

  // Best Locked Anchor & Targeting Cache
  private lockedAnchor: GrappleAnchor | null = null;
  private cachedAnchorPos = new THREE.Vector3();
  private cachedAnchorNorm = new THREE.Vector3();
  private cachedAnchor: GrappleAnchor = {
    pos: this.cachedAnchorPos,
    normal: this.cachedAnchorNorm,
    type: 'cliff',
    dist: 0,
  };
  private reticleEl: HTMLElement | null = null;
  private grappleLabelEl: HTMLElement | null = null;
  private lastGrappleLabelText = '';
  private lastReticleVisible = false;
  private targetingAccum = 0;
  private slalomHudEl: HTMLElement | null = null;
  private lastSlalomHudText = '';

  // Slalom Speed-Gates
  private speedGates: SpeedGateInstance[] = [];
  private activeSlalomCombo = 0;
  private slalomComboTimer = 0;
  private speedBoostTimer = 0;
  private speedBoostMultiplier = 1.0;

  // High-Peak Ziplines
  private ziplines: ZiplineStation[] = [];
  private isRidingZipline = false;
  private activeZipline: ZiplineStation | null = null;
  private ziplineProgress = 0;
  private ziplineSpeed = 22.0;

  // Callbacks
  public onCameraShake?: (intensity: number, duration: number) => void;
  public onGrantBonusGold?: (amount: number, message: string) => void;
  public onGrappleBoost?: (impulseX: number, impulseY: number, impulseZ: number) => void;

  private sharedGateGeo?: THREE.BufferGeometry;
  private sharedGateMat?: THREE.MeshStandardMaterial;
  private sharedPostGeo?: THREE.BufferGeometry;
  private sharedPostMat?: THREE.MeshStandardMaterial;

  constructor(
    private config: WorldConfig,
    private noise: TerrainNoise,
    private chunkManager: ChunkManager,
    private dwarf: DwarfCharacter,
    private relicStore: RelicStore
  ) {
    this.group.matrixAutoUpdate = false;
    this.initGrappleVisuals();
    this.initSlalomAssets();
    this.initDOM();
    this.buildProceduralSpeedGatesAndZiplines();
    this.bindKeyListeners();
  }

  private initGrappleVisuals(): void {
    // 1. Runic Tether Cable Line
    this.tetherGeo = new THREE.BufferGeometry();
    this.tetherGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.tetherPositions, 3)
    );
    this.tetherMat = new THREE.LineBasicMaterial({
      color: 0xffd166,
      linewidth: 3,
      transparent: true,
      opacity: 0.95,
    });
    this.tetherLine = new THREE.Line(this.tetherGeo, this.tetherMat);
    this.tetherLine.frustumCulled = false;
    this.tetherLine.visible = false;
    this.group.add(this.tetherLine);

    // 2. Grappling Pick Tip Mesh
    const hookGeo = new THREE.ConeGeometry(0.12, 0.42, 5);
    hookGeo.rotateX(Math.PI / 2);
    const hookMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      roughness: 0.25,
      metalness: 0.9,
      emissive: 0x996515,
      emissiveIntensity: 0.4,
    });
    this.hookMesh = new THREE.Mesh(hookGeo, hookMat);
    this.hookMesh.visible = false;
    this.group.add(this.hookMesh);
  }

  private initSlalomAssets(): void {
    // Shared Runic Gate Geometry: Ring / Torus archway
    this.sharedGateGeo = new THREE.TorusGeometry(3.2, 0.18, 8, 24, Math.PI);
    this.sharedGateMat = new THREE.MeshStandardMaterial({
      color: 0x00f5d4,
      roughness: 0.22,
      metalness: 0.88,
      emissive: 0x00bbf9,
      emissiveIntensity: 0.85,
    });
    this.sharedPostGeo = new THREE.CylinderGeometry(0.16, 0.22, 2.8, 6);
    this.sharedPostMat = new THREE.MeshStandardMaterial({
      color: 0x4a5568,
      roughness: 0.8,
      metalness: 0.2,
    });
  }

  private initDOM(): void {
    // Create Grapple Rune Reticle HUD
    this.reticleEl = document.createElement('div');
    this.reticleEl.id = 'grapple-reticle';
    this.reticleEl.style.position = 'fixed';
    this.reticleEl.style.top = '50%';
    this.reticleEl.style.left = '50%';
    this.reticleEl.style.transform = 'translate(-50%, -50%)';
    this.reticleEl.style.pointerEvents = 'none';
    this.reticleEl.style.display = 'none';
    this.reticleEl.style.zIndex = '35';
    this.reticleEl.style.textAlign = 'center';
    this.reticleEl.style.fontFamily = 'monospace';
    this.reticleEl.style.color = '#ffd166';
    this.reticleEl.style.textShadow = '0 0 8px rgba(255, 209, 102, 0.8), 0 2px 4px #000';
    this.reticleEl.innerHTML = `
      <div style="width:48px;height:48px;border:2px dashed #ffd166;border-radius:50%;margin:0 auto 4px auto;animation:spin 8s linear infinite;"></div>
      <div style="font-size:12px;font-weight:bold;letter-spacing:1px;background:rgba(0,0,0,0.65);padding:2px 8px;border-radius:4px;border:1px solid #ffd166;" id="grapple-label">[G] GRAPPLE</div>
    `;
    document.body.appendChild(this.reticleEl);
    this.grappleLabelEl = this.reticleEl.querySelector('#grapple-label');

    // Create Slalom Combo Status Banner
    this.slalomHudEl = document.createElement('div');
    this.slalomHudEl.id = 'slalom-combo-hud';
    this.slalomHudEl.style.position = 'fixed';
    this.slalomHudEl.style.top = '140px';
    this.slalomHudEl.style.left = '50%';
    this.slalomHudEl.style.transform = 'translateX(-50%)';
    this.slalomHudEl.style.pointerEvents = 'none';
    this.slalomHudEl.style.display = 'none';
    this.slalomHudEl.style.zIndex = '40';
    this.slalomHudEl.style.textAlign = 'center';
    this.slalomHudEl.style.fontFamily = 'system-ui, sans-serif';
    this.slalomHudEl.style.color = '#00f5d4';
    this.slalomHudEl.style.textShadow = '0 0 12px rgba(0,245,212,0.9), 0 2px 6px #000';
    this.slalomHudEl.style.fontWeight = 'bold';
    this.slalomHudEl.style.fontSize = '18px';
    this.slalomHudEl.style.background = 'rgba(10, 25, 35, 0.78)';
    this.slalomHudEl.style.padding = '6px 18px';
    this.slalomHudEl.style.borderRadius = '20px';
    this.slalomHudEl.style.border = '1px solid #00f5d4';
    document.body.appendChild(this.slalomHudEl);
  }

  private buildProceduralSpeedGatesAndZiplines(): void {
    const rng = createSeededRandom(this.config.seed + 8841);

    // 1. Procedural Mountain Slalom Speed-Gates placed on prominent steep ridges
    const gateCoords = [
      { x: 55, z: 75 },
      { x: 80, z: 110 },
      { x: 105, z: 145 },
      { x: -75, z: 85 },
      { x: -110, z: 125 },
      { x: -145, z: 165 },
      { x: 140, z: -85 },
      { x: 180, z: -125 },
      { x: 220, z: -165 },
      { x: -160, z: -95 },
      { x: -205, z: -140 },
    ];

    for (let i = 0; i < gateCoords.length; i++) {
      const gc = gateCoords[i];
      const groundY = this.chunkManager.getSurfaceHeight(gc.x, gc.z);
      if (this.noise.isInsideVolcanoBarrenZone(gc.x, gc.z) || groundY < this.config.waterLevel + 2.0) {
        continue;
      }

      const gateGroup = new THREE.Group();
      gateGroup.position.set(gc.x, groundY, gc.z);

      // Orient gate perpendicular to downhill slope
      this.chunkManager.getSurfaceNormal(gc.x, gc.z, _scratchNorm);
      const downhillAng = Math.atan2(_scratchNorm.x, _scratchNorm.z);
      gateGroup.rotation.y = downhillAng;

      const archMesh = new THREE.Mesh(this.sharedGateGeo, this.sharedGateMat);
      archMesh.position.y = 0;
      archMesh.castShadow = true;
      gateGroup.add(archMesh);

      // Support Posts (shared geometry & material)
      const postL = new THREE.Mesh(this.sharedPostGeo, this.sharedPostMat);
      postL.position.set(-3.2, 1.4, 0);
      gateGroup.add(postL);

      const postR = new THREE.Mesh(this.sharedPostGeo, this.sharedPostMat);
      postR.position.set(3.2, 1.4, 0);
      gateGroup.add(postR);

      this.group.add(gateGroup);
      this.speedGates.push({
        id: `gate_${i}`,
        pos: new THREE.Vector3(gc.x, groundY, gc.z),
        normal: _scratchNorm.clone(),
        group: gateGroup,
        archMesh,
        passed: false,
        pulsePhase: rng() * Math.PI * 2,
      });
    }

    // 2. Procedural High-Peak Ziplines connecting ridges to valleys
    const ziplineRoutes = [
      { start: new THREE.Vector3(68, 0, 72), end: new THREE.Vector3(12, 0, 18) },
      { start: new THREE.Vector3(-92, 0, 95), end: new THREE.Vector3(-22, 0, 24) },
      { start: new THREE.Vector3(155, 0, -110), end: new THREE.Vector3(75, 0, -35) },
    ];

    for (let i = 0; i < ziplineRoutes.length; i++) {
      const r = ziplineRoutes[i];
      r.start.y = this.chunkManager.getSurfaceHeight(r.start.x, r.start.z) + 3.8;
      r.end.y = this.chunkManager.getSurfaceHeight(r.end.x, r.end.z) + 1.8;

      if (r.start.y <= r.end.y + 4.0) continue; // Ensure downhill slant

      const cableVec = new THREE.Vector3().subVectors(r.end, r.start);
      const len = cableVec.length();
      const dir = cableVec.clone().normalize();

      const cableGeo = new THREE.BufferGeometry().setFromPoints([r.start, r.end]);
      const cableMat = new THREE.LineBasicMaterial({
        color: 0xd4a373,
        linewidth: 2,
      });
      const cableLine = new THREE.Line(cableGeo, cableMat);

      const stationGroup = new THREE.Group();
      stationGroup.add(cableLine);

      // Station wooden towers at start and end
      const towerMat = new THREE.MeshStandardMaterial({
        color: 0x5c4033,
        roughness: 0.85,
      });
      const startTower = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 4.2, 6), towerMat);
      startTower.position.set(r.start.x, r.start.y - 2.1, r.start.z);
      stationGroup.add(startTower);

      const endTower = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 2.8, 6), towerMat);
      endTower.position.set(r.end.x, r.end.y - 1.4, r.end.z);
      stationGroup.add(endTower);

      this.group.add(stationGroup);
      this.ziplines.push({
        id: `zipline_${i}`,
        startPos: r.start,
        endPos: r.end,
        length: len,
        direction: dir,
        group: stationGroup,
        cableMesh: cableLine,
      });
    }
  }

  private bindKeyListeners(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      if (e.repeat) return;

      if (e.code === 'KeyG') {
        // If an anchor is in range, handle Grapple!
        if (this.lockedAnchor || this.isGrappling) {
          e.stopImmediatePropagation();
          this.triggerGrappleAction();
        }
      } else if (e.code === 'KeyE') {
        // Check Zipline Mount
        if (!this.isRidingZipline) {
          this.tryMountNearestZipline();
        }
      } else if (e.code === 'Space') {
        if (this.isGrappling) {
          // Jump releases grapple into a Mach-Fling boost!
          this.releaseGrappleWithBoost();
        } else if (this.isRidingZipline) {
          // Jump dismounts from zipline into glider flight!
          this.dismountZiplineWithGlider();
        }
      }
    });
  }

  public hasLockedAnchor(): boolean {
    return this.lockedAnchor !== null;
  }

  public getSpeedMultiplier(): number {
    return this.speedBoostTimer > 0 ? this.speedBoostMultiplier : 1.0;
  }

  public isGrappleActive(): boolean {
    return this.isGrappling;
  }

  public isZiplineRiding(): boolean {
    return this.isRidingZipline;
  }

  public triggerGrappleAction(): boolean {
    if (this.isGrappling) {
      this.releaseGrappleWithBoost();
      return true;
    }

    if (!this.lockedAnchor) return false;

    // Fire Grappling Hook towards locked anchor (zero heap allocations)
    this.isGrappling = true;
    this.grapplePhase = 'firing';
    this.grappleAnchorPos.copy(this.lockedAnchor.pos);
    this.grappleAnchor = this.grappleAnchorPos;
    this.grappleFlightProgress = 0;
    this.grappleCurrentTip.copy(this.dwarf.root.position);
    this.grappleCurrentTip.y += 0.85;

    this.tetherLine.visible = true;
    this.hookMesh.visible = true;
    this.hookMesh.position.copy(this.grappleCurrentTip);

    this.relicStore.playGrappleShootSound();
    return true;
  }

  private releaseGrappleWithBoost(): void {
    if (!this.isGrappling || !this.grappleAnchor) {
      this.isGrappling = false;
      this.grapplePhase = 'none';
      this.tetherLine.visible = false;
      this.hookMesh.visible = false;
      return;
    }

    const playerPos = this.dwarf.root.position;
    _scratchToAnchor.subVectors(this.grappleAnchor, playerPos);
    const horizDist = Math.hypot(_scratchToAnchor.x, _scratchToAnchor.z) || 1;
    const boostDirX = _scratchToAnchor.x / horizDist;
    const boostDirZ = _scratchToAnchor.z / horizDist;

    // Apply "Mach-Fling!" impulse: +17 m/s horizontal, +14.5 m/s upward
    this.onGrappleBoost?.(boostDirX * 17.0, 14.5, boostDirZ * 17.0);

    this.relicStore.playGrappleFlingSound();
    this.onCameraShake?.(0.38, 0.28);
    this.dwarf.spawnBurst(playerPos.x, playerPos.y + 0.8, playerPos.z, 24);

    this.onGrantBonusGold?.(
      0,
      '⚡ Grapple-Fling Boost! Slingshotted into mid-air glide momentum!'
    );

    this.isGrappling = false;
    this.grapplePhase = 'none';
    this.grappleAnchor = null;
    this.tetherLine.visible = false;
    this.hookMesh.visible = false;
  }

  private tryMountNearestZipline(): boolean {
    const p = this.dwarf.root.position;
    for (const zip of this.ziplines) {
      const d = p.distanceTo(zip.startPos);
      if (d <= 3.8) {
        this.isRidingZipline = true;
        this.activeZipline = zip;
        this.ziplineProgress = 0;
        this.ziplineSpeed = 20.0;
        this.relicStore.playZiplineWhirSound();
        this.onGrantBonusGold?.(0, '🚠 Mounted Dwarven Mountain Zipline! Press [Space] to eject into Glider!');
        return true;
      }
    }
    return false;
  }

  private dismountZiplineWithGlider(): void {
    if (!this.isRidingZipline || !this.activeZipline) return;
    const dir = this.activeZipline.direction;
    this.onGrappleBoost?.(dir.x * 18.0, 8.5, dir.z * 18.0);
    this.isRidingZipline = false;
    this.activeZipline = null;
    this.relicStore.playGrappleFlingSound();
    this.onCameraShake?.(0.25, 0.2);
  }

  public update(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    isInsideInterior: boolean
  ): void {
    if (isInsideInterior) {
      if (this.reticleEl) this.reticleEl.style.display = 'none';
      if (this.slalomHudEl) this.slalomHudEl.style.display = 'none';
      if (this.isGrappling) this.releaseGrappleWithBoost();
      return;
    }

    // 1. Scan for valid Grapple Anchors ahead of dwarf / camera (throttled to 20 Hz)
    this.targetingAccum += dt;
    if (this.targetingAccum >= 0.05 || !this.lockedAnchor) {
      this.targetingAccum = 0;
      this.updateGrappleTargeting(playerPos, camera);
    }

    // 2. Update Active Grapple Tether & Physics
    if (this.isGrappling && this.grappleAnchor) {
      this.updateGrapplePhysics(dt, playerPos);
    }

    // 3. Update Slalom Speed-Gates
    this.updateSlalomGates(dt, elapsedTime, playerPos);

    // 4. Update Ziplines
    if (this.isRidingZipline && this.activeZipline) {
      this.updateZiplinePhysics(dt, playerPos);
    }
  }

  private updateGrappleTargeting(playerPos: THREE.Vector3, camera: THREE.PerspectiveCamera): void {
    camera.getWorldDirection(_scratchCamDir);

    let foundAnchor = false;
    let bestScore = -Infinity;

    // Raycast / step forward along view cone up to 28m
    for (let dist = 5.0; dist <= 28.0; dist += 2.2) {
      const testX = playerPos.x + _scratchCamDir.x * dist;
      const testZ = playerPos.z + _scratchCamDir.z * dist;
      const groundY = this.chunkManager.getSurfaceHeight(testX, testZ);

      // Check for steep cliff face (terrain elevation at least 2.2m above dwarf)
      if (groundY >= playerPos.y + 2.2) {
        this.chunkManager.getSurfaceNormal(testX, testZ, _scratchNorm);
        // Valid cliff if surface slope normal.y <= 0.78 (steep cliff)
        if (_scratchNorm.y <= 0.78) {
          const score = 100 - dist;
          if (score > bestScore) {
            bestScore = score;
            this.cachedAnchorPos.set(testX, groundY + 0.5, testZ);
            this.cachedAnchorNorm.copy(_scratchNorm);
            this.cachedAnchor.dist = dist;
            foundAnchor = true;
          }
          break;
        }
      }
    }

    this.lockedAnchor = foundAnchor ? this.cachedAnchor : null;

    // Update HUD Reticle with cached DOM reference and string check
    if (this.reticleEl) {
      if (foundAnchor && !this.isGrappling) {
        if (!this.lastReticleVisible) {
          this.lastReticleVisible = true;
          this.reticleEl.style.display = 'block';
        }
        const text = `[G] GRAPPLE (${Math.round(this.cachedAnchor.dist)}m)`;
        if (text !== this.lastGrappleLabelText) {
          this.lastGrappleLabelText = text;
          if (this.grappleLabelEl) {
            this.grappleLabelEl.textContent = text;
          }
        }
      } else if (this.lastReticleVisible) {
        this.lastReticleVisible = false;
        this.reticleEl.style.display = 'none';
      }
    }
  }

  private updateGrapplePhysics(dt: number, playerPos: THREE.Vector3): void {
    if (!this.grappleAnchor) return;

    _scratchDwarfHand.copy(playerPos);
    _scratchDwarfHand.y += 0.85;

    if (this.grapplePhase === 'firing') {
      this.grappleFlightProgress += dt * 7.5; // Fast projectile to anchor
      if (this.grappleFlightProgress >= 1.0) {
        this.grappleFlightProgress = 1.0;
        this.grapplePhase = 'pulling';
        this.relicStore.playGrappleLatchSound();
        this.onCameraShake?.(0.24, 0.16);
        this.dwarf.spawnBurst(this.grappleAnchor.x, this.grappleAnchor.y, this.grappleAnchor.z, 14);
      }
      this.grappleCurrentTip.lerpVectors(_scratchDwarfHand, this.grappleAnchor, this.grappleFlightProgress);
    } else if (this.grapplePhase === 'pulling') {
      this.grappleCurrentTip.copy(this.grappleAnchor);

      // Pull physics: Accelerate dwarf toward anchor (zero heap allocations)
      _scratchToAnchor.subVectors(this.grappleAnchor, playerPos);
      const dist = _scratchToAnchor.length();

      if (dist <= 2.8) {
        // Reached anchor -> Mach-Fling boost!
        this.releaseGrappleWithBoost();
        return;
      }

      const invDist = 1 / (dist || 1);
      const pullDirX = _scratchToAnchor.x * invDist;
      const pullDirY = _scratchToAnchor.y * invDist;
      const pullDirZ = _scratchToAnchor.z * invDist;
      const pullSpeed = Math.min(26.0, 16.0 + (28.0 - dist) * 0.5);
      const step = pullSpeed * dt;

      playerPos.x += pullDirX * step;
      playerPos.y += pullDirY * step;
      playerPos.z += pullDirZ * step;

      // Reel gear tick sound
      if (Math.random() < 0.28) {
        this.dwarf.spawnBurst(_scratchDwarfHand.x, _scratchDwarfHand.y, _scratchDwarfHand.z, 2);
      }
    }

    // Update 3D tether line positions
    this.tetherPositions[0] = _scratchDwarfHand.x;
    this.tetherPositions[1] = _scratchDwarfHand.y;
    this.tetherPositions[2] = _scratchDwarfHand.z;
    this.tetherPositions[3] = this.grappleCurrentTip.x;
    this.tetherPositions[4] = this.grappleCurrentTip.y;
    this.tetherPositions[5] = this.grappleCurrentTip.z;
    this.tetherGeo.attributes.position.needsUpdate = true;

    this.hookMesh.position.copy(this.grappleCurrentTip);
  }

  private updateSlalomGates(dt: number, _elapsedTime: number, playerPos: THREE.Vector3): void {
    if (this.slalomComboTimer > 0) {
      this.slalomComboTimer -= dt;
      if (this.slalomComboTimer <= 0) {
        this.activeSlalomCombo = 0;
        if (this.slalomHudEl) this.slalomHudEl.style.display = 'none';
      }
    }

    if (this.speedBoostTimer > 0) {
      this.speedBoostTimer -= dt;
      if (this.speedBoostTimer <= 0) {
        this.speedBoostMultiplier = 1.0;
      }
    }

    // Pulse animation once on shared runic gate material
    if (this.sharedGateMat) {
      this.sharedGateMat.emissiveIntensity = 0.55 + Math.sin(_elapsedTime * 3.5) * 0.35;
    }

    for (const g of this.speedGates) {
      if (!g.passed) {
        const dx = playerPos.x - g.pos.x;
        const dz = playerPos.z - g.pos.z;
        const distSq = dx * dx + dz * dz;

        if (distSq <= 3.2 * 3.2 && Math.abs(playerPos.y - g.pos.y) <= 3.2) {
          // Gate Cleared!
          g.passed = true;
          this.activeSlalomCombo++;
          this.slalomComboTimer = 7.0;

          // Speed boost stacking up to +75% (Mach-Dwarf!)
          this.speedBoostMultiplier = Math.min(1.75, 1.15 + this.activeSlalomCombo * 0.12);
          this.speedBoostTimer = 6.0;

          const bonusGold = 25 * this.activeSlalomCombo;
          this.relicStore.playSpeedGateChimeSound(this.activeSlalomCombo);
          this.onCameraShake?.(0.26, 0.18);
          this.dwarf.spawnBurst(playerPos.x, playerPos.y + 1.2, playerPos.z, 20);

          this.onGrantBonusGold?.(
            bonusGold,
            `⚡ SLALOM SPEED-GATE x${this.activeSlalomCombo}! +${bonusGold} Gold (+${Math.round(
              (this.speedBoostMultiplier - 1.0) * 100
            )}% Speed)!`
          );

          if (this.slalomHudEl) {
            this.slalomHudEl.style.display = 'block';
            const hudText = `⚡ SLALOM COMBO x${this.activeSlalomCombo} (+${Math.round(
              (this.speedBoostMultiplier - 1.0) * 100
            )}% MACH SPEED)`;
            if (hudText !== this.lastSlalomHudText) {
              this.lastSlalomHudText = hudText;
              this.slalomHudEl.textContent = hudText;
            }
          }

          // Reset gate after 18 seconds
          setTimeout(() => {
            g.passed = false;
          }, 18000);
        }
      }
    }
  }

  private updateZiplinePhysics(dt: number, playerPos: THREE.Vector3): void {
    if (!this.activeZipline) return;

    this.ziplineSpeed = Math.min(32.0, this.ziplineSpeed + 8.5 * dt);
    const step = (this.ziplineSpeed * dt) / this.activeZipline.length;
    this.ziplineProgress += step;

    if (this.ziplineProgress >= 1.0) {
      // Reached bottom station
      this.dismountZiplineWithGlider();
      return;
    }

    playerPos.lerpVectors(
      this.activeZipline.startPos,
      this.activeZipline.endPos,
      this.ziplineProgress
    );

    if (Math.random() < 0.35) {
      this.dwarf.spawnBurst(playerPos.x, playerPos.y + 0.4, playerPos.z, 2);
    }
  }

  public dispose(): void {
    this.reticleEl?.remove();
    this.slalomHudEl?.remove();
    this.tetherGeo.dispose();
    this.tetherMat.dispose();
    this.sharedGateGeo?.dispose();
    this.sharedGateMat?.dispose();
  }
}
