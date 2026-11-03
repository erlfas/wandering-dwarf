import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { WorldConfig } from './Config';
import { createSeededRandom, TerrainNoise } from './TerrainNoise';

export type FishingState = 'inactive' | 'aiming' | 'casting' | 'floating' | 'landed_dry' | 'bite' | 'reeling';

interface FishSpecies {
  name: string;
  gold: number;
  bodyColor: number;
  bellyColor: number;
  finColor: number;
  scale: number;
}

const FISH_SPECIES: FishSpecies[] = [
  {
    name: 'Golden Sunscale Trout',
    gold: 110,
    bodyColor: 0xff7b29,
    bellyColor: 0xffe599,
    finColor: 0xffbe0b,
    scale: 1.05,
  },
  {
    name: 'Silverbrook Salmon',
    gold: 125,
    bodyColor: 0x48cae4,
    bellyColor: 0xe0fbfc,
    finColor: 0xff8fa3,
    scale: 1.15,
  },
  {
    name: 'Emerald River Perch',
    gold: 95,
    bodyColor: 0x52b788,
    bellyColor: 0xd8f3dc,
    finColor: 0xffd166,
    scale: 0.95,
  },
  {
    name: 'Mythic Beard-Carp',
    gold: 220,
    bodyColor: 0xffb703,
    bellyColor: 0xfff3b0,
    finColor: 0xfb5607,
    scale: 1.38,
  },
];

interface FishInstance {
  species: FishSpecies;
  homePos: THREE.Vector3;
  pos: THREE.Vector3;
  heading: number;
  speed: number;
  swimPhase: number;
  turnTimer: number;
  targetYawOffset: number;
  mesh: THREE.Group;
  bodyMesh: THREE.Mesh;
  tailMesh: THREE.Mesh;
  attractedToBobber: boolean;
  nibbleCount: number;
  nibbleTimer: number;
  fleeTimer: number;
}

/**
 * Builds a sleek 3D fish body geometry (fusiform body + dorsal fin + pectoral fins)
 * and a separate hinged forked tail fin geometry so fish wag their tails fluidly as they swim.
 */
function buildFishGeometries(): {
  bodyGeo: THREE.BufferGeometry;
  tailGeo: THREE.BufferGeometry;
} {
  // Fusiform fish torso oriented along +Z (nose at +Z, tail hinge at -Z)
  const torso = new THREE.SphereGeometry(0.22, 12, 8);
  torso.scale(0.52, 0.72, 1.85);

  // Dorsal fin on top
  const dorsal = new THREE.ConeGeometry(0.08, 0.24, 4);
  dorsal.scale(0.25, 1.0, 1.6);
  dorsal.rotateX(-0.38);
  dorsal.translate(0, 0.17, -0.04);

  // Left & Right pectoral fins
  const pecL = new THREE.ConeGeometry(0.06, 0.18, 3);
  pecL.scale(0.25, 1.0, 1.2);
  pecL.rotateZ(1.15);
  pecL.rotateY(-0.35);
  pecL.translate(0.11, -0.05, 0.12);

  const pecR = new THREE.ConeGeometry(0.06, 0.18, 3);
  pecR.scale(0.25, 1.0, 1.2);
  pecR.rotateZ(-1.15);
  pecR.rotateY(0.35);
  pecR.translate(-0.11, -0.05, 0.12);

  const bodyGeo = mergeGeometries([torso, dorsal, pecL, pecR], false);
  torso.dispose();
  dorsal.dispose();
  pecL.dispose();
  pecR.dispose();
  bodyGeo.computeBoundingBox();
  bodyGeo.computeBoundingSphere();

  // Forked caudal (tail) fin hinged at (0, 0, 0) extending toward -Z
  const tailUpper = new THREE.ConeGeometry(0.11, 0.28, 4);
  tailUpper.scale(0.22, 1.0, 1.15);
  tailUpper.rotateX(-Math.PI * 0.36);
  tailUpper.translate(0, 0.06, -0.13);

  const tailLower = new THREE.ConeGeometry(0.09, 0.24, 4);
  tailLower.scale(0.22, 1.0, 1.1);
  tailLower.rotateX(-Math.PI * 0.64);
  tailLower.translate(0, -0.05, -0.12);

  const tailGeo = mergeGeometries([tailUpper, tailLower], false);
  tailUpper.dispose();
  tailLower.dispose();
  tailGeo.computeBoundingBox();
  tailGeo.computeBoundingSphere();

  return { bodyGeo, tailGeo };
}

/**
 * Manages:
 * 1. Schools of 3D Fish swimming in ponds and rivers (visible through the semi-transparent water).
 * 2. The Dwarf's Fishing Mode: drawing the fishing rod from his backpack, aiming the cast up to
 *    a maximum distance (`maxCastDistance = 18.0m`), casting the bobber & fishing line, attracting
 *    and hooking fish, drawing/reeling the line back, and easily exiting fishing mode.
 */
export class FishingAndFishManager {
  public readonly group = new THREE.Group();
  public readonly maxCastDistance = 18.0;
  public readonly minCastDistance = 2.5;

  public state: FishingState = 'inactive';
  public aimDistance = 9.5;
  public aimYaw = 0;
  public fishCaughtCount = 0;

  private activeChunkFish = new Map<number, FishInstance[]>();
  private desiredKeys = new Set<number>();
  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;
  private lastWaterLevel = Number.NaN;
  private getSurfaceHeightFn?: (wx: number, wz: number) => number;

  // Shared fish geometries & materials
  private fishBodyGeo!: THREE.BufferGeometry;
  private fishTailGeo!: THREE.BufferGeometry;
  private speciesBodyMats: THREE.MeshStandardMaterial[] = [];
  private speciesFinMats: THREE.MeshStandardMaterial[] = [];

  // 3D Fishing visuals (Aiming arc, Target reticle ring, Bobber float, Fishing line, Water splash rings)
  private aimArcLine!: THREE.Line;
  private aimArcPositions = new Float32Array(28 * 3);
  private aimReticleGroup = new THREE.Group();
  private aimOuterRing!: THREE.Mesh;
  private aimInnerRing!: THREE.Mesh;
  private aimRingMatValid!: THREE.MeshBasicMaterial;
  private aimRingMatDry!: THREE.MeshBasicMaterial;

  private bobberGroup = new THREE.Group();
  private fishingLine!: THREE.Line;
  private fishingLinePositions = new Float32Array(24 * 3);
  private splashRing1!: THREE.Mesh;
  private splashRing2!: THREE.Mesh;
  private splashTimer = 0;
  private splashOrigin = new THREE.Vector3();

  // Casting & Reeling physics state
  private castStartPos = new THREE.Vector3();
  private castTargetPos = new THREE.Vector3();
  private bobberPos = new THREE.Vector3();
  private castFlightTimer = 0;
  private castFlightDuration = 0.55;
  private floatTime = 0;
  private biteWindowTimer = 0;
  private hookedFish: FishInstance | null = null;
  private attractingFish: FishInstance | null = null;
  private isTargetWater = false;
  private isHoldingDrawBack = false;

  // Mouse raycasting for intuitive cursor aiming
  private raycaster = new THREE.Raycaster();
  private mouseNdc = new THREE.Vector2();
  private waterAimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 3.5);
  private rayHitPoint = new THREE.Vector3();
  private rodTipWorld = new THREE.Vector3();

  // DOM HUD elements for Fishing Mode
  private fishingBannerEl: HTMLElement | null;
  private fishingToggleBtn: HTMLElement | null;
  private audioCtx: AudioContext | null = null;
  private onEnterFishingCallback?: () => void;

  constructor(
    private config: WorldConfig,
    private noise: TerrainNoise,
    private camera: THREE.PerspectiveCamera,
    private domElement: HTMLElement,
    private dwarf: DwarfCharacter,
    private onGrantGold: (gold: number, message: string) => void
  ) {
    this.group.matrixAutoUpdate = false;
    this.fishingBannerEl = document.getElementById('fishing-banner');
    this.fishingToggleBtn = document.getElementById('fishing-mode-toggle');

    this.initFishAssets();
    this.initFishingVisuals();
    this.bindEvents();
  }

  public setOnEnterFishingCallback(cb: () => void): void {
    this.onEnterFishingCallback = cb;
  }

  public setSurfaceHeightSampler(fn: (wx: number, wz: number) => number): void {
    this.getSurfaceHeightFn = fn;
  }

  private sampleGroundHeight(wx: number, wz: number): number {
    return this.getSurfaceHeightFn ? this.getSurfaceHeightFn(wx, wz) : this.noise.getHeight(wx, wz);
  }

  public isFishingActive(): boolean {
    return this.state !== 'inactive';
  }

  private initFishAssets(): void {
    const geos = buildFishGeometries();
    this.fishBodyGeo = geos.bodyGeo;
    this.fishTailGeo = geos.tailGeo;

    for (const sp of FISH_SPECIES) {
      this.speciesBodyMats.push(
        new THREE.MeshStandardMaterial({
          color: sp.bodyColor,
          roughness: 0.25,
          metalness: 0.18,
          emissive: sp.bodyColor,
          emissiveIntensity: 0.22,
        })
      );
      this.speciesFinMats.push(
        new THREE.MeshStandardMaterial({
          color: sp.finColor,
          roughness: 0.35,
          metalness: 0.1,
          emissive: sp.bellyColor,
          emissiveIntensity: 0.18,
        })
      );
    }
  }

  private initFishingVisuals(): void {
    // 1. Aiming Cast Preview Arc
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(this.aimArcPositions, 3));
    const arcMat = new THREE.LineBasicMaterial({
      color: 0x80ffdb,
      transparent: true,
      opacity: 0.78,
    });
    this.aimArcLine = new THREE.Line(arcGeo, arcMat);
    this.aimArcLine.frustumCulled = false;
    this.aimArcLine.visible = false;
    this.group.add(this.aimArcLine);

    // 2. Aiming Target Reticle Ring on Water/Ground
    this.aimRingMatValid = new THREE.MeshBasicMaterial({
      color: 0x48cae4,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.aimRingMatDry = new THREE.MeshBasicMaterial({
      color: 0xffb703,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });

    const outerRingGeo = new THREE.RingGeometry(0.55, 0.72, 28);
    outerRingGeo.rotateX(-Math.PI / 2);
    this.aimOuterRing = new THREE.Mesh(outerRingGeo, this.aimRingMatValid);

    const innerRingGeo = new THREE.RingGeometry(0.16, 0.26, 20);
    innerRingGeo.rotateX(-Math.PI / 2);
    this.aimInnerRing = new THREE.Mesh(innerRingGeo, this.aimRingMatValid);

    this.aimReticleGroup.add(this.aimOuterRing);
    this.aimReticleGroup.add(this.aimInnerRing);
    this.aimReticleGroup.visible = false;
    this.group.add(this.aimReticleGroup);

    // 3. 3D Red & White Fishing Bobber Float
    const topHalfGeo = new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const botHalfGeo = new THREE.SphereGeometry(
      0.13,
      12,
      8,
      0,
      Math.PI * 2,
      Math.PI * 0.5,
      Math.PI * 0.5
    );
    const stemGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.22, 6);
    stemGeo.translate(0, 0.14, 0);

    const redMat = new THREE.MeshStandardMaterial({
      color: 0xef233c,
      roughness: 0.25,
      emissive: 0x6a040f,
      emissiveIntensity: 0.3,
    });
    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8f9fa,
      roughness: 0.3,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      roughness: 0.3,
      metalness: 0.8,
    });

    this.bobberGroup.add(new THREE.Mesh(topHalfGeo, redMat));
    this.bobberGroup.add(new THREE.Mesh(botHalfGeo, whiteMat));
    this.bobberGroup.add(new THREE.Mesh(stemGeo, goldMat));
    this.bobberGroup.visible = false;
    this.group.add(this.bobberGroup);

    // 4. Curved 3D Fishing Line from Rod Tip to Bobber
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(this.fishingLinePositions, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xe2f1ff,
      transparent: true,
      opacity: 0.88,
    });
    this.fishingLine = new THREE.Line(lineGeo, lineMat);
    this.fishingLine.frustumCulled = false;
    this.fishingLine.visible = false;
    this.group.add(this.fishingLine);

    // 5. Expanding Water Splash / Bite Rings
    const splashGeo1 = new THREE.RingGeometry(0.22, 0.34, 24);
    splashGeo1.rotateX(-Math.PI / 2);
    const splashMat1 = new THREE.MeshBasicMaterial({
      color: 0xe0fbfc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.splashRing1 = new THREE.Mesh(splashGeo1, splashMat1);
    this.splashRing1.visible = false;
    this.group.add(this.splashRing1);

    const splashGeo2 = new THREE.RingGeometry(0.36, 0.48, 24);
    splashGeo2.rotateX(-Math.PI / 2);
    const splashMat2 = new THREE.MeshBasicMaterial({
      color: 0x90e0ef,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.splashRing2 = new THREE.Mesh(splashGeo2, splashMat2);
    this.splashRing2.visible = false;
    this.group.add(this.splashRing2);
  }

  private bindEvents(): void {
    this.fishingToggleBtn?.addEventListener('click', () => {
      this.toggleFishingMode();
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyF') {
        this.toggleFishingMode();
      } else if (e.code === 'Escape' && this.state !== 'inactive') {
        this.exitFishingMode();
      } else if (this.state !== 'inactive') {
        if (e.code === 'Space' || e.code === 'KeyE') {
          if (this.state === 'aiming') {
            this.castLine();
          } else {
            this.isHoldingDrawBack = true;
            this.triggerDrawBackAction();
          }
        } else if (e.code === 'KeyR') {
          this.isHoldingDrawBack = true;
          this.triggerDrawBackAction(true);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'KeyR') {
        this.isHoldingDrawBack = false;
      }
    });

    // Mouse movement updates aiming reticle within maxCastDistance when in 'aiming' state
    this.domElement.addEventListener(
      'mousemove',
      (e) => {
        if (this.state !== 'aiming') return;
        // Ignore if user is holding mouse buttons to orbit camera
        if (e.buttons !== 0) return;

        const rect = this.domElement.getBoundingClientRect();
        this.mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.waterAimPlane.constant = -this.config.waterLevel;
        this.raycaster.setFromCamera(this.mouseNdc, this.camera);
        if (this.raycaster.ray.intersectPlane(this.waterAimPlane, this.rayHitPoint)) {
          const dx = this.rayHitPoint.x - this.dwarf.root.position.x;
          const dz = this.rayHitPoint.z - this.dwarf.root.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.2) {
            this.aimYaw = Math.atan2(dx, dz);
            this.aimDistance = THREE.MathUtils.clamp(
              dist,
              this.minCastDistance,
              this.maxCastDistance
            );
          }
        }
      },
      { passive: true }
    );

    // Left-click casts when aiming, or draws the line back when line is out
    let downX = 0;
    let downY = 0;
    this.domElement.addEventListener(
      'mousedown',
      (e) => {
        if (e.button === 0) {
          downX = e.clientX;
          downY = e.clientY;
          if (this.state === 'floating' || this.state === 'bite' || this.state === 'landed_dry') {
            this.isHoldingDrawBack = true;
            this.triggerDrawBackAction();
          }
        }
      },
      { passive: true }
    );

    window.addEventListener(
      'mouseup',
      (e) => {
        if (e.button === 0) {
          this.isHoldingDrawBack = false;
          if (this.state === 'aiming') {
            const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
            if (moved < 6) {
              this.castLine();
            }
          }
        }
      },
      { passive: true }
    );
  }

  public toggleFishingMode(): void {
    if (this.state === 'inactive') {
      this.enterFishingMode();
    } else {
      this.exitFishingMode();
    }
  }

  public enterFishingMode(): void {
    const px = this.dwarf.root.position.x;
    const pz = this.dwarf.root.position.z;
    const groundY = this.sampleGroundHeight(px, pz);
    if (this.config.enableWater && groundY < this.config.waterLevel - 0.38) {
      this.onGrantGold(0, '🌊 Wade onto the shoreline bank to equip your Fishing Rod!');
      return;
    }

    this.onEnterFishingCallback?.();
    this.state = 'aiming';
    this.aimYaw = this.dwarf.heading;
    this.aimDistance = 9.5;

    // Automatically orient initial aim toward nearest water within maxCastDistance if nearby
    let bestWaterDist = Infinity;
    let bestAngle = this.aimYaw;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      for (let d = 4.0; d <= this.maxCastDistance; d += 3.0) {
        const tx = px + Math.sin(ang) * d;
        const tz = pz + Math.cos(ang) * d;
        if (this.sampleGroundHeight(tx, tz) < this.config.waterLevel - 0.12) {
          if (d < bestWaterDist) {
            bestWaterDist = d;
            bestAngle = ang;
          }
          break;
        }
      }
    }
    if (bestWaterDist <= this.maxCastDistance) {
      this.aimYaw = bestAngle;
      this.aimDistance = THREE.MathUtils.clamp(
        bestWaterDist + 1.5,
        this.minCastDistance,
        this.maxCastDistance
      );
    }

    this.dwarf.setFishingMode(true);
    this.dwarf.setRodBend(0);
    this.playEquipRodSound();
    this.fishingToggleBtn?.classList.add('active');
    this.updateBannerUI();
  }

  public exitFishingMode(): void {
    if (this.state === 'inactive') return;
    this.releaseAttractedFish();
    this.state = 'inactive';
    this.isHoldingDrawBack = false;
    this.aimArcLine.visible = false;
    this.aimReticleGroup.visible = false;
    this.bobberGroup.visible = false;
    this.fishingLine.visible = false;
    this.splashRing1.visible = false;
    this.splashRing2.visible = false;
    this.dwarf.setFishingMode(false);
    this.dwarf.setRodBend(0);
    this.fishingToggleBtn?.classList.remove('active');
    this.updateBannerUI();
  }

  private releaseAttractedFish(): void {
    if (this.attractingFish) {
      this.attractingFish.attractedToBobber = false;
      this.attractingFish.nibbleCount = 0;
      this.attractingFish = null;
    }
    if (this.hookedFish) {
      this.hookedFish.attractedToBobber = false;
      this.hookedFish = null;
    }
  }

  private castLine(): void {
    if (this.state !== 'aiming') return;

    this.state = 'casting';
    this.castFlightTimer = 0;
    this.castFlightDuration = 0.38 + (this.aimDistance / this.maxCastDistance) * 0.28;
    this.dwarf.triggerCastAnimation();
    this.dwarf.getRodTipWorldPosition(this.castStartPos);

    const tx = this.dwarf.root.position.x + Math.sin(this.aimYaw) * this.aimDistance;
    const tz = this.dwarf.root.position.z + Math.cos(this.aimYaw) * this.aimDistance;
    const groundY = this.sampleGroundHeight(tx, tz);
    this.isTargetWater =
      this.config.enableWater && !this.config.blankClayMode && groundY < this.config.waterLevel - 0.08;
    const ty = this.isTargetWater ? this.config.waterLevel : groundY + 0.08;

    this.castTargetPos.set(tx, ty, tz);
    this.bobberPos.copy(this.castStartPos);

    this.aimArcLine.visible = false;
    this.aimReticleGroup.visible = false;
    this.bobberGroup.visible = true;
    this.fishingLine.visible = true;
    this.playCastWhooshSound();
    this.updateBannerUI();
  }

  private triggerDrawBackAction(fullRetrieve = false): void {
    if (this.state === 'bite' && this.hookedFish) {
      // Hooked a fish! Reel it in!
      this.state = 'reeling';
      this.dwarf.setRodBend(1.1);
      this.playReelCatchSound();
      this.updateBannerUI();
    } else if (this.state === 'landed_dry' || this.state === 'casting' || fullRetrieve) {
      this.releaseAttractedFish();
      this.state = 'reeling';
      this.dwarf.setRodBend(0.35);
      this.playCastWhooshSound();
      this.updateBannerUI();
    }
  }

  private triggerWaterSplash(x: number, z: number): void {
    this.splashOrigin.set(x, this.config.waterLevel + 0.05, z);
    this.splashTimer = 0.85;
    this.splashRing1.position.copy(this.splashOrigin);
    this.splashRing2.position.copy(this.splashOrigin);
    this.splashRing1.visible = true;
    this.splashRing2.visible = true;
  }

  private updateBannerUI(): void {
    if (!this.fishingBannerEl) return;
    if (this.state === 'inactive') {
      this.fishingBannerEl.classList.add('hidden');
      return;
    }

    this.fishingBannerEl.classList.remove('hidden');
    let statusHtml = '';
    if (this.state === 'aiming') {
      const targetBadge = this.isTargetWater
        ? `<span class="fish-tag water">🌊 Water (${this.aimDistance.toFixed(1)}m / ${this.maxCastDistance.toFixed(0)}m Max)</span>`
        : `<span class="fish-tag dry">⚠️ Dry Ground (${this.aimDistance.toFixed(1)}m / ${this.maxCastDistance.toFixed(0)}m Max)</span>`;
      statusHtml = `🎣 <strong>FISHING MODE</strong> ${targetBadge} • <kbd>W</kbd><kbd>S</kbd><kbd>A</kbd><kbd>D</kbd> / Mouse Aim • <kbd>Click</kbd>/<kbd>Space</kbd> Cast`;
    } else if (this.state === 'casting') {
      statusHtml = `🎣 <strong>CASTING LINE...</strong> (${this.aimDistance.toFixed(1)}m) • <kbd>R</kbd>/<kbd>Click</kbd> Draw Back`;
    } else if (this.state === 'landed_dry') {
      statusHtml = `⚠️ <strong>BOBBER ON DRY LAND</strong> • Press <kbd>Click</kbd>/<kbd>Space</kbd>/<kbd>R</kbd> to Draw Line Back`;
    } else if (this.state === 'floating') {
      const fishStatus = this.attractingFish
        ? `🐟 <em>A ${this.attractingFish.species.name} is approaching your lure...</em>`
        : `🌊 <em>Waiting for fish...</em>`;
      statusHtml = `🎣 ${fishStatus} • Hold <kbd>Click</kbd>/<kbd>Space</kbd>/<kbd>R</kbd> Draw Back`;
    } else if (this.state === 'bite') {
      statusHtml = `🚨 <strong>🐟 FISH BITE!</strong> Press <kbd>Click</kbd> / <kbd>Space</kbd> / <kbd>R</kbd> NOW to Reel In!`;
    } else if (this.state === 'reeling') {
      statusHtml = this.hookedFish
        ? `🎣 <strong>REELING IN ${this.hookedFish.species.name.toUpperCase()}!</strong>`
        : `🎣 <strong>DRAWING LINE BACK...</strong>`;
    }

    this.fishingBannerEl.innerHTML = `
      <span class="fishing-banner-text">${statusHtml}</span>
      <button id="fishing-exit-btn" type="button" class="fishing-exit-pill" title="Stow Rod in Backpack & Exit (F or Esc)">
        ✕ Exit (F / Esc)
      </button>
    `;
    const exitBtn = document.getElementById('fishing-exit-btn');
    exitBtn?.addEventListener('click', () => this.exitFishingMode());
  }

  private getKey(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  public update(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    aimForwardInput: number,
    aimRightInput: number
  ): void {
    // 1. Stream 3D Fish schools in water chunks around the player
    this.updateFishChunks(playerPos);

    // 2. Simulate swimming fish & attraction to bobber
    this.updateSwimmingFish(dt, elapsedTime, playerPos);

    // 3. Update active Fishing Mode state machine & 3D visuals
    if (this.state !== 'inactive') {
      const playerGroundY = this.sampleGroundHeight(playerPos.x, playerPos.z);
      if (this.config.enableWater && playerGroundY < this.config.waterLevel - 0.38) {
        this.exitFishingMode();
      } else {
        this.updateFishingState(dt, elapsedTime, playerPos, aimForwardInput, aimRightInput);
      }
    }

    // 4. Animate water splash rings
    if (this.splashTimer > 0) {
      this.splashTimer = Math.max(0, this.splashTimer - dt);
      const p = 1.0 - this.splashTimer / 0.85;
      this.splashRing1.scale.setScalar(0.6 + p * 2.8);
      (this.splashRing1.material as THREE.MeshBasicMaterial).opacity = (1.0 - p) * 0.75;
      const p2 = Math.max(0, p - 0.15) / 0.85;
      this.splashRing2.scale.setScalar(0.5 + p2 * 3.4);
      (this.splashRing2.material as THREE.MeshBasicMaterial).opacity = (1.0 - p2) * 0.55;
      if (this.splashTimer <= 0) {
        this.splashRing1.visible = false;
        this.splashRing2.visible = false;
      }
    }
  }

  private updateFishChunks(playerPos: THREE.Vector3): void {
    if (!this.config.enableWater || this.config.blankClayMode) {
      if (this.activeChunkFish.size > 0) {
        this.rebuildAll();
      }
      return;
    }

    if (this.lastWaterLevel !== this.config.waterLevel) {
      this.lastWaterLevel = this.config.waterLevel;
      this.rebuildAll();
    }

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

          if (!this.activeChunkFish.has(key)) {
            this.spawnFishForChunk(cx, cz, key);
          }
        }
      }

      for (const [key, fishList] of this.activeChunkFish.entries()) {
        if (!desiredKeys.has(key)) {
          for (const f of fishList) {
            if (f === this.attractingFish) this.attractingFish = null;
            if (f === this.hookedFish) this.hookedFish = null;
            this.group.remove(f.mesh);
          }
          this.activeChunkFish.delete(key);
        }
      }
    }
  }

  private spawnFishForChunk(cx: number, cz: number, chunkKey: number): void {
    const size = this.config.chunkSize;
    const chunkSeed = ((cx * 73856093) ^ (cz * 19349663) ^ (this.config.seed + 911)) >>> 0;
    const rng = createSeededRandom(chunkSeed);
    const fishList: FishInstance[] = [];
    const waterY = this.config.waterLevel;

    // Guaranteed lively school of fish in the starter pond around (18, -14) in chunk (0, 0)
    if (cx === 0 && cz === 0) {
      const starterCenters = [
        { x: 18.0, z: -14.0 },
        { x: 15.5, z: -12.0 },
        { x: 20.5, z: -15.5 },
        { x: 17.0, z: -16.8 },
        { x: 19.8, z: -12.2 },
        { x: 14.8, z: -15.2 },
        { x: 18.2, z: -13.2 },
        { x: 16.5, z: -14.2 },
      ];
      for (let i = 0; i < starterCenters.length; i++) {
        const pt = starterCenters[i];
        const gy = this.noise.getHeight(pt.x, pt.z);
        if (gy < waterY - 0.35) {
          fishList.push(this.createFishInstance(pt.x, pt.z, i % FISH_SPECIES.length, rng));
        }
      }
    }

    // Probe candidate points across the chunk for rivers and valley ponds
    const probes = 18;
    for (let i = 0; i < probes && fishList.length < 10; i++) {
      const wx = cx * size + (rng() - 0.5) * (size * 0.86);
      const wz = cz * size + (rng() - 0.5) * (size * 0.86);
      const wy = this.noise.getHeight(wx, wz);
      if (wy < waterY - 0.42) {
        const speciesIdx =
          rng() < 0.12 ? 3 : Math.floor(rng() * 3); // 12% chance of Mythic Beard-Carp
        fishList.push(this.createFishInstance(wx, wz, speciesIdx, rng));
      }
    }

    this.activeChunkFish.set(chunkKey, fishList);
  }

  private createFishInstance(
    wx: number,
    wz: number,
    speciesIdx: number,
    rng: () => number
  ): FishInstance {
    const species = FISH_SPECIES[speciesIdx];
    const depth = this.config.waterLevel - (0.24 + rng() * 0.28);

    const mesh = new THREE.Group();
    mesh.position.set(wx, depth, wz);
    mesh.scale.setScalar(species.scale);

    const bodyMesh = new THREE.Mesh(this.fishBodyGeo, this.speciesBodyMats[speciesIdx]);
    mesh.add(bodyMesh);

    const tailMesh = new THREE.Mesh(this.fishTailGeo, this.speciesFinMats[speciesIdx]);
    tailMesh.position.set(0, 0, -0.36);
    mesh.add(tailMesh);

    this.group.add(mesh);

    const heading = rng() * Math.PI * 2;
    mesh.rotation.y = heading;

    return {
      species,
      homePos: new THREE.Vector3(wx, depth, wz),
      pos: new THREE.Vector3(wx, depth, wz),
      heading,
      speed: 1.15 + rng() * 0.65,
      swimPhase: rng() * Math.PI * 2,
      turnTimer: 1.0 + rng() * 2.5,
      targetYawOffset: 0,
      mesh,
      bodyMesh,
      tailMesh,
      attractedToBobber: false,
      nibbleCount: 0,
      nibbleTimer: 0,
      fleeTimer: 0,
    };
  }

  private updateSwimmingFish(dt: number, elapsedTime: number, playerPos: THREE.Vector3): void {
    const waterY = this.config.waterLevel;
    const maxSimDistSq = 68 * 68;
    const playerGroundY = this.sampleGroundHeight(playerPos.x, playerPos.z);
    const isPlayerInWater =
      this.config.enableWater && !this.config.blankClayMode && playerGroundY < waterY - 0.08;
    const scareRadius = 8.2;
    const scareRadiusSq = scareRadius * scareRadius;

    for (const fishList of this.activeChunkFish.values()) {
      for (const f of fishList) {
        // If this fish is currently hooked and being reeled in, its position follows the bobber
        if (f === this.hookedFish && this.state === 'reeling') {
          f.pos.copy(this.bobberPos);
          f.pos.y -= 0.15;
          f.mesh.position.copy(f.pos);
          f.tailMesh.rotation.y = Math.sin(elapsedTime * 28.0) * 0.55;
          continue;
        }

        const dxP = playerPos.x - f.pos.x;
        const dzP = playerPos.z - f.pos.z;
        const distSqToPlayer = dxP * dxP + dzP * dzP;
        if (distSqToPlayer > maxSimDistSq) continue;

        if (f.fleeTimer > 0) {
          f.fleeTimer = Math.max(0, f.fleeTimer - dt);
        }

        // Dart away if the dwarf wades or swims near the fish!
        if (isPlayerInWater && distSqToPlayer < scareRadiusSq) {
          if (f.fleeTimer <= 0.1 && distSqToPlayer < 5.5 * 5.5 && this.splashTimer <= 0.2) {
            this.triggerWaterSplash(f.pos.x, f.pos.z);
          }
          f.fleeTimer = 1.1;
          if (f.attractedToBobber) {
            f.attractedToBobber = false;
            f.nibbleCount = 0;
            if (this.attractingFish === f) {
              this.attractingFish = null;
            }
          }
        }

        if (f.fleeTimer > 0) {
          // Swim rapidly away from the dwarf, steering around shallow banks so fish stay in deep water
          const awayAngle = Math.atan2(-dxP, -dzP);
          let bestAngle = awayAngle;
          let deepestGround = Infinity;
          const candidateOffsets = [0, 0.45, -0.45, 0.95, -0.95, 1.5, -1.5, 2.2, -2.2];
          for (let i = 0; i < candidateOffsets.length; i++) {
            const testAng = awayAngle + candidateOffsets[i];
            const probeX = f.pos.x + Math.sin(testAng) * 1.35;
            const probeZ = f.pos.z + Math.cos(testAng) * 1.35;
            const gY = this.sampleGroundHeight(probeX, probeZ);
            if (gY < waterY - 0.28) {
              bestAngle = testAng;
              deepestGround = gY;
              break;
            }
            if (gY < deepestGround) {
              deepestGround = gY;
              bestAngle = testAng;
            }
          }

          let diff = bestAngle - f.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          f.heading += diff * Math.min(1, dt * 11.0);

          const distToPlayer = Math.sqrt(distSqToPlayer);
          const urgency = THREE.MathUtils.clamp(1.0 - distToPlayer / (scareRadius + 2.0), 0.25, 1.0);
          const fleeSpeed = f.speed * (2.4 + urgency * 1.9);
          const nextX = f.pos.x + Math.sin(f.heading) * fleeSpeed * dt;
          const nextZ = f.pos.z + Math.cos(f.heading) * fleeSpeed * dt;
          if (this.sampleGroundHeight(nextX, nextZ) < waterY - 0.22) {
            f.pos.x = nextX;
            f.pos.z = nextZ;
          }
          f.swimPhase += dt * (18.0 + urgency * 10.0);
          f.pos.y = THREE.MathUtils.lerp(f.pos.y, waterY - 0.36, Math.min(1, dt * 6));
        } else if (f.attractedToBobber && this.state === 'floating') {
          const toBobX = this.bobberPos.x - f.pos.x;
          const toBobZ = this.bobberPos.z - f.pos.z;
          const distToBob = Math.hypot(toBobX, toBobZ);
          const desiredHeading = Math.atan2(toBobX, toBobZ);

          let diff = desiredHeading - f.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          f.heading += diff * Math.min(1, dt * 6.5);

          if (distToBob > 0.42) {
            const approachSpeed = 2.15;
            f.pos.x += Math.sin(f.heading) * approachSpeed * dt;
            f.pos.z += Math.cos(f.heading) * approachSpeed * dt;
            f.pos.y = THREE.MathUtils.lerp(f.pos.y, waterY - 0.2, Math.min(1, dt * 5));
            f.swimPhase += dt * 14.0;
          } else {
            // Fish is right at the bobber -> nibble then bite!
            f.swimPhase += dt * 10.0;
            f.nibbleTimer -= dt;
            if (f.nibbleTimer <= 0) {
              f.nibbleCount++;
              if (f.nibbleCount <= 2) {
                f.nibbleTimer = 0.85 + Math.random() * 0.45;
                this.bobberPos.y = waterY - 0.14;
                this.triggerWaterSplash(this.bobberPos.x, this.bobberPos.z);
                this.playNibblePlinkSound();
              } else {
                // BITE!
                this.state = 'bite';
                this.hookedFish = f;
                this.biteWindowTimer = 3.2;
                this.bobberPos.y = waterY - 0.32;
                this.dwarf.setRodBend(0.85);
                this.triggerWaterSplash(this.bobberPos.x, this.bobberPos.z);
                this.playBiteAlertSound();
                this.updateBannerUI();
              }
            }
          }
        } else {
          // Normal peaceful underwater schooling / figure-8 cruising
          f.turnTimer -= dt;
          if (f.turnTimer <= 0) {
            f.turnTimer = 1.4 + Math.random() * 2.4;
            f.targetYawOffset = (Math.random() - 0.5) * 1.8;
          }

          // Gently steer back toward home basin if wandering > 5.5m from homePos
          // (unless the dwarf is currently swimming near homePos!)
          const hx = f.homePos.x - f.pos.x;
          const hz = f.homePos.z - f.pos.z;
          const homeDist = Math.hypot(hx, hz);
          const playerNearHome =
            isPlayerInWater &&
            (playerPos.x - f.homePos.x) * (playerPos.x - f.homePos.x) +
              (playerPos.z - f.homePos.z) * (playerPos.z - f.homePos.z) <
              scareRadiusSq;
          if (homeDist > 5.2 && !playerNearHome) {
            const homeHeading = Math.atan2(hx, hz);
            let diff = homeHeading - f.heading;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            f.heading += diff * Math.min(1, dt * 3.5);
          } else {
            f.heading += f.targetYawOffset * dt;
          }

          // Look ahead 0.9m to ensure the fish stays in water deeper than 0.28m
          const nextX = f.pos.x + Math.sin(f.heading) * f.speed * dt;
          const nextZ = f.pos.z + Math.cos(f.heading) * f.speed * dt;
          const aheadX = f.pos.x + Math.sin(f.heading) * 0.95;
          const aheadZ = f.pos.z + Math.cos(f.heading) * 0.95;
          const aheadGround = this.sampleGroundHeight(aheadX, aheadZ);

          if (aheadGround < waterY - 0.26) {
            f.pos.x = nextX;
            f.pos.z = nextZ;
          } else {
            // Smoothly turn back toward deep water
            f.heading += Math.PI * 0.75;
            f.turnTimer = 1.2;
          }

          f.swimPhase += dt * (7.5 + f.speed * 2.5);
          f.pos.y = f.homePos.y + Math.sin(f.swimPhase * 0.35) * 0.05;
        }

        // Apply position, body yaw wobble, and hinged tail-fin wag
        const wag = Math.sin(f.swimPhase);
        f.mesh.position.copy(f.pos);
        f.mesh.rotation.y = f.heading + wag * 0.07;
        f.tailMesh.rotation.y = -wag * 0.42;
      }
    }
  }

  private updateFishingState(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    aimForwardInput: number,
    aimRightInput: number
  ): void {
    // Keep rod tip world position updated every frame
    this.dwarf.getRodTipWorldPosition(this.rodTipWorld);

    if (this.state === 'aiming') {
      // Allow keyboard W/S to adjust cast distance (clamped to [minCastDistance, maxCastDistance])
      // and A/D to rotate aim direction
      let aimChanged = false;
      if (aimRightInput !== 0) {
        this.aimYaw -= aimRightInput * 1.85 * dt;
        aimChanged = true;
      }
      if (aimForwardInput !== 0) {
        this.aimDistance = THREE.MathUtils.clamp(
          this.aimDistance + aimForwardInput * 9.5 * dt,
          this.minCastDistance,
          this.maxCastDistance
        );
        aimChanged = true;
      }

      // Turn dwarf to face the aimed cast direction
      this.dwarf.heading = this.aimYaw;
      this.dwarf.root.rotation.y = this.aimYaw;

      // Compute landing point clamped to maxCastDistance
      const tx = playerPos.x + Math.sin(this.aimYaw) * this.aimDistance;
      const tz = playerPos.z + Math.cos(this.aimYaw) * this.aimDistance;
      const groundY = this.sampleGroundHeight(tx, tz);
      const wasWater = this.isTargetWater;
      this.isTargetWater =
        this.config.enableWater &&
        !this.config.blankClayMode &&
        groundY < this.config.waterLevel - 0.08;
      const ty = this.isTargetWater ? this.config.waterLevel + 0.04 : groundY + 0.06;

      if (aimChanged || wasWater !== this.isTargetWater) {
        this.updateBannerUI();
      }

      // Update 3D parabolic cast preview arc from rodTipWorld to (tx, ty, tz)
      const segments = 27;
      const arcHeight = 1.6 + this.aimDistance * 0.16;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = THREE.MathUtils.lerp(this.rodTipWorld.x, tx, t);
        const z = THREE.MathUtils.lerp(this.rodTipWorld.z, tz, t);
        const baseY = THREE.MathUtils.lerp(this.rodTipWorld.y, ty, t);
        const parabola = 4.0 * t * (1.0 - t) * arcHeight;
        this.aimArcPositions[i * 3] = x;
        this.aimArcPositions[i * 3 + 1] = baseY + parabola;
        this.aimArcPositions[i * 3 + 2] = z;
      }
      (this.aimArcLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.aimArcLine.material as THREE.LineBasicMaterial).color.setHex(
        this.isTargetWater ? 0x64dfdf : 0xffb703
      );
      this.aimArcLine.visible = true;

      // Update pulsing target reticle ring on water/ground
      this.aimReticleGroup.position.set(tx, ty, tz);
      const pulse = 0.92 + Math.sin(elapsedTime * 5.0) * 0.1;
      this.aimOuterRing.scale.setScalar(pulse);
      const ringMat = this.isTargetWater ? this.aimRingMatValid : this.aimRingMatDry;
      this.aimOuterRing.material = ringMat;
      this.aimInnerRing.material = ringMat;
      this.aimReticleGroup.visible = true;
      this.bobberGroup.visible = false;
      this.fishingLine.visible = false;
      return;
    }

    if (this.state === 'casting') {
      this.castFlightTimer += dt;
      const t = Math.min(1.0, this.castFlightTimer / this.castFlightDuration);
      const arcHeight = 1.8 + this.aimDistance * 0.16;
      this.bobberPos.x = THREE.MathUtils.lerp(this.castStartPos.x, this.castTargetPos.x, t);
      this.bobberPos.z = THREE.MathUtils.lerp(this.castStartPos.z, this.castTargetPos.z, t);
      this.bobberPos.y =
        THREE.MathUtils.lerp(this.castStartPos.y, this.castTargetPos.y, t) +
        4.0 * t * (1.0 - t) * arcHeight;

      this.bobberGroup.position.copy(this.bobberPos);
      this.updateFishingLineGeometry(0.15);

      if (t >= 1.0) {
        if (this.isTargetWater) {
          this.state = 'floating';
          this.floatTime = 0;
          this.triggerWaterSplash(this.bobberPos.x, this.bobberPos.z);
          this.playWaterPlopSound();
          this.assignNearestFishToBobber();
        } else {
          this.state = 'landed_dry';
        }
        this.updateBannerUI();
      }
      return;
    }

    if (this.state === 'landed_dry') {
      this.bobberGroup.position.copy(this.bobberPos);
      this.updateFishingLineGeometry(0.35);
      return;
    }

    if (this.state === 'floating') {
      this.floatTime += dt;
      const waterY = this.config.waterLevel;

      // If the player holds Draw Back (Left-Click / Space / R / E), smoothly draw the bobber back across the water!
      if (this.isHoldingDrawBack) {
        this.dwarf.setRodBend(0.45);
        const toDwarfX = playerPos.x - this.bobberPos.x;
        const toDwarfZ = playerPos.z - this.bobberPos.z;
        const distToDwarf = Math.hypot(toDwarfX, toDwarfZ);
        if (distToDwarf <= 2.6) {
          this.triggerDrawBackAction(true);
          return;
        }
        const pullStep = Math.min(distToDwarf, 6.2 * dt);
        this.bobberPos.x += (toDwarfX / distToDwarf) * pullStep;
        this.bobberPos.z += (toDwarfZ / distToDwarf) * pullStep;

        // If pulled onto dry shore bank, reel all the way in
        if (this.sampleGroundHeight(this.bobberPos.x, this.bobberPos.z) >= waterY - 0.06) {
          this.triggerDrawBackAction(true);
          return;
        }
        if (Math.floor(this.floatTime * 6) !== Math.floor((this.floatTime - dt) * 6)) {
          this.triggerWaterSplash(this.bobberPos.x, this.bobberPos.z);
        }
      } else {
        this.dwarf.setRodBend(0.08);
      }

      // Gentle wave bobbing
      const waveBob = Math.sin(elapsedTime * 3.2 + this.bobberPos.x) * 0.035;
      this.bobberPos.y = THREE.MathUtils.lerp(
        this.bobberPos.y,
        waterY + waveBob,
        Math.min(1, dt * 8)
      );
      this.bobberGroup.position.copy(this.bobberPos);
      this.updateFishingLineGeometry(this.isHoldingDrawBack ? 0.05 : 0.32);

      // Ensure a fish is attracted (or spawn a curious river fish if none was nearby)
      if (!this.attractingFish && this.floatTime > 1.5) {
        this.assignNearestFishToBobber(true);
      }
      return;
    }

    if (this.state === 'bite') {
      this.biteWindowTimer -= dt;
      const waterY = this.config.waterLevel;
      // Energetic underwater tug on the bobber and bent rod
      this.bobberPos.y = waterY - 0.22 + Math.sin(elapsedTime * 22.0) * 0.08;
      this.bobberGroup.position.copy(this.bobberPos);
      this.dwarf.setRodBend(0.85 + Math.sin(elapsedTime * 18.0) * 0.2);
      this.updateFishingLineGeometry(0.02);

      if (this.biteWindowTimer <= 0) {
        // Fish got away if not reeled in within 3.2s; bobber pops back up
        this.releaseAttractedFish();
        this.state = 'floating';
        this.floatTime = 0;
        this.dwarf.setRodBend(0.08);
        this.onGrantGold(0, '🐟 The fish slipped off the hook! Keep watching the bobber...');
        this.updateBannerUI();
      }
      return;
    }

    if (this.state === 'reeling') {
      const dx = this.rodTipWorld.x - this.bobberPos.x;
      const dy = this.rodTipWorld.y - this.bobberPos.y;
      const dz = this.rodTipWorld.z - this.bobberPos.z;
      const dist = Math.hypot(dx, dy, dz);
      const reelSpeed = 22.0;

      if (dist <= 0.65) {
        // Finished drawing the line back!
        if (this.hookedFish) {
          const caught = this.hookedFish;
          this.hookedFish = null;
          this.attractingFish = null;
          this.fishCaughtCount++;

          // Respawn the fish at its home pos after a short moment so the pond stays lively
          caught.attractedToBobber = false;
          caught.nibbleCount = 0;
          caught.pos.copy(caught.homePos);
          caught.mesh.position.copy(caught.homePos);

          this.dwarf.spawnBurst(playerPos.x, playerPos.y + 0.8, playerPos.z, 14);
          this.playCatchFanfare();
          this.onGrantGold(
            caught.species.gold,
            `🐟 Caught ${caught.species.name}! +${caught.species.gold} Gold`
          );
        }
        this.dwarf.setRodBend(0);
        this.state = 'aiming';
        this.updateBannerUI();
        return;
      }

      const step = Math.min(dist, reelSpeed * dt);
      this.bobberPos.x += (dx / dist) * step;
      this.bobberPos.y += (dy / dist) * step + Math.sin((1.0 - dist / 18.0) * Math.PI) * 2.5 * dt;
      this.bobberPos.z += (dz / dist) * step;
      this.bobberGroup.position.copy(this.bobberPos);
      this.updateFishingLineGeometry(0.04);
    }
  }

  private assignNearestFishToBobber(spawnIfNone = false): void {
    this.releaseAttractedFish();
    let bestFish: FishInstance | null = null;
    let bestDistSq = 16.0 * 16.0;

    for (const fishList of this.activeChunkFish.values()) {
      for (const f of fishList) {
        const dx = f.pos.x - this.bobberPos.x;
        const dz = f.pos.z - this.bobberPos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestFish = f;
        }
      }
    }

    if (!bestFish && spawnIfNone) {
      // Spawn a fish a few meters away in the water so every pond/river spot can catch fish
      const rng = Math.random;
      const ang = rng() * Math.PI * 2;
      const fx = this.bobberPos.x + Math.cos(ang) * 2.5;
      const fz = this.bobberPos.z + Math.sin(ang) * 2.5;
      const speciesIdx = rng() < 0.15 ? 3 : Math.floor(rng() * 3);
      const size = this.config.chunkSize;
      const cx = Math.round(fx / size);
      const cz = Math.round(fz / size);
      const key = this.getKey(cx, cz);
      let list = this.activeChunkFish.get(key);
      if (!list) {
        list = [];
        this.activeChunkFish.set(key, list);
      }
      bestFish = this.createFishInstance(fx, fz, speciesIdx, rng);
      list.push(bestFish);
    }

    if (bestFish) {
      bestFish.attractedToBobber = true;
      bestFish.nibbleCount = 0;
      bestFish.nibbleTimer = 0.75;
      this.attractingFish = bestFish;
      this.updateBannerUI();
    }
  }

  private updateFishingLineGeometry(slack: number): void {
    const segments = 23;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = THREE.MathUtils.lerp(this.rodTipWorld.x, this.bobberPos.x, t);
      const z = THREE.MathUtils.lerp(this.rodTipWorld.z, this.bobberPos.z, t);
      const sag = 4.0 * t * (1.0 - t) * slack;
      const y = THREE.MathUtils.lerp(this.rodTipWorld.y, this.bobberPos.y + 0.14, t) - sag;
      this.fishingLinePositions[i * 3] = x;
      this.fishingLinePositions[i * 3 + 1] = y;
      this.fishingLinePositions[i * 3 + 2] = z;
    }
    (this.fishingLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  public rebuildAll(): void {
    this.releaseAttractedFish();
    for (const fishList of this.activeChunkFish.values()) {
      for (const f of fishList) {
        this.group.remove(f.mesh);
      }
    }
    this.activeChunkFish.clear();
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
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

  private playEquipRodSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(580, now + 0.12);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  private playCastWhooshSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.22);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  private playWaterPlopSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.09);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  private playNibblePlinkSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.07);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  private playBiteAlertSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      gain.gain.setValueAtTime(0.001, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.07 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.24);
    });
  }

  private playReelCatchSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.25);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.29);
  }

  private playCatchFanfare(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.001, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.16, now + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.36);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.38);
    });
  }
}
