import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import deerModelUrl from '../../3dmodels/deer 3d model.glb?url';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { getSharedAudioContext } from '../player/RelicStore';
import { WorldConfig } from './Config';
import { createOptimizedGlbLoader } from './ForestField';
import {
  createSeededRandom,
  TerrainNoise,
  VOLCANO_OUTER_RADIUS,
  VOLCANO_X,
  VOLCANO_Z,
} from './TerrainNoise';

// Strict exclusion perimeter so no deer ever spawns near or approaches Mount Doomforge
const DEER_VOLCANO_EXCLUSION_RADIUS = VOLCANO_OUTER_RADIUS + 54.0; // 250m from volcano center
const DEER_VOLCANO_EXCLUSION_RADIUS_SQ =
  DEER_VOLCANO_EXCLUSION_RADIUS * DEER_VOLCANO_EXCLUSION_RADIUS;
const DEER_VOLCANO_TURNBACK_RADIUS_SQ =
  (DEER_VOLCANO_EXCLUSION_RADIUS + 35.0) * (DEER_VOLCANO_EXCLUSION_RADIUS + 35.0);

interface DeerSpecies {
  name: string;
  gold: number;
  coatColor: number;
  scale: number;
}

const DEER_SPECIES: DeerSpecies[] = [
  {
    name: 'Woodland Stag',
    gold: 150,
    coatColor: 0xffffff,
    scale: 1.0,
  },
  {
    name: 'Redwood Buck',
    gold: 185,
    coatColor: 0xf4d3b8,
    scale: 1.08,
  },
  {
    name: 'Royal Golden-Horn Stag',
    gold: 280,
    coatColor: 0xffe6a3,
    scale: 1.2,
  },
];

interface DeerInstance {
  species: DeerSpecies;
  speciesIdx: number;
  homePos: THREE.Vector3;
  pos: THREE.Vector3;
  heading: number;
  speed: number;
  stridePhase: number;
  turnTimer: number;
  targetYawOffset: number;
  grazeTimer: number;
  fleeTimer: number;
  hitAnimTimer: number;
  respawnTimer: number;
  isNearLOD: boolean;
  root: THREE.Group;
  bodyMesh: THREE.Mesh;
}

interface ArrowProjectile {
  active: boolean;
  stuck: boolean;
  age: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  targetDeer: DeerInstance | null;
  mesh: THREE.Group;
}

let sharedDeerGlbGeo: THREE.BufferGeometry | null = null;
let sharedDeerGlbMats: THREE.MeshStandardMaterial[] = [];
let deerLoadStarted = false;
const activeNearDeer = new Set<DeerInstance>();

/**
 * Asynchronously loads `3dmodels/deer 3d model.glb` (18,574 tris), strips unused PBR maps
 * and `KHR_materials_specular` before decoding, normalizes orientation (+X -> +Z forward,
 * hooves at Y=0, ~1.58m tall), welds vertices, and hot-swaps only close-range (dist <= 1.5 chunks)
 * deer instances.
 */
export function loadDeerModel(): void {
  if (deerLoadStarted) return;
  deerLoadStarted = true;

  const loader = createOptimizedGlbLoader();

  loader.load(
    deerModelUrl,
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

      // 1. Strip unused skinning attributes if present
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');

      // 2. Rotate -90 deg around Y so the deer's head & antlers (+X in GLB) face +Z forward
      geo.rotateY(-Math.PI / 2);

      // 3. Normalize pivot (center X/Z at 0, hooves at Y=0) and scale to ~1.58m height
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const height = Math.max(0.01, box.max.y - box.min.y);
      const targetHeight = 1.58;
      const scaleFactor = targetHeight / height;

      geo.translate(-centerX, -box.min.y, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);

      // 4. Guard computeVertexNormals() — normals are already present in deer 3d model.glb
      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      if (!geo.index) {
        const welded = mergeVertices(geo, 1e-4);
        if (welded !== geo) {
          geo.dispose();
          geo = welded;
        }
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const origMat = (
        Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      ) as THREE.MeshStandardMaterial;
      if (origMat.normalMap) {
        origMat.normalMap.dispose();
        origMat.normalMap = null;
      }
      if (origMat.roughnessMap) {
        origMat.roughnessMap.dispose();
        origMat.roughnessMap = null;
      }
      if (origMat.metalnessMap) {
        origMat.metalnessMap.dispose();
        origMat.metalnessMap = null;
      }
      if (origMat.aoMap) {
        origMat.aoMap.dispose();
        origMat.aoMap = null;
      }

      sharedDeerGlbMats = DEER_SPECIES.map(
        (sp) =>
          new THREE.MeshStandardMaterial({
            color: sp.coatColor,
            map: origMat.map ?? null,
            roughness: 0.82,
            metalness: 0.04,
          })
      );
      origMat.dispose();
      sharedDeerGlbGeo = geo;

      // 5. Hot-swap all currently active close-range (dist <= 1.5 chunks) deer
      for (const d of activeNearDeer) {
        d.bodyMesh.geometry = sharedDeerGlbGeo;
        d.bodyMesh.material = sharedDeerGlbMats[d.speciesIdx];
        d.bodyMesh.receiveShadow = false;
      }
    },
    undefined,
    (err) => {
      console.error('Failed to load deer 3D model:', err);
    }
  );
}

/**
 * Builds a lightweight low-poly procedural deer fallback geometry (< 140 triangles)
 * used for mid/far-range chunks (dist > 1.5) and before the GLB finishes loading.
 */
function buildProceduralDeerFallbackGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Torso oriented along +Z
  const torso = new THREE.BoxGeometry(0.42, 0.44, 0.96);
  torso.translate(0, 0.78, 0);
  parts.push(torso);

  // Neck & Chest rising at +Z
  const neck = new THREE.CylinderGeometry(0.12, 0.17, 0.48, 6);
  neck.rotateX(0.35);
  neck.translate(0, 1.08, 0.38);
  parts.push(neck);

  // Head & Snout facing +Z
  const head = new THREE.BoxGeometry(0.22, 0.2, 0.36);
  head.translate(0, 1.28, 0.52);
  parts.push(head);

  // Left & Right Antlers
  const antlerL = new THREE.ConeGeometry(0.04, 0.38, 4);
  antlerL.rotateZ(0.32);
  antlerL.rotateX(-0.22);
  antlerL.translate(0.14, 1.48, 0.42);
  parts.push(antlerL);

  const antlerR = new THREE.ConeGeometry(0.04, 0.38, 4);
  antlerR.rotateZ(-0.32);
  antlerR.rotateX(-0.22);
  antlerR.translate(-0.14, 1.48, 0.42);
  parts.push(antlerR);

  // 4 slender legs reaching Y=0
  const legOffsets = [
    [-0.14, 0.38, 0.34],
    [0.14, 0.38, 0.34],
    [-0.14, 0.38, -0.34],
    [0.14, 0.38, -0.34],
  ];
  for (const [lx, ly, lz] of legOffsets) {
    const leg = new THREE.CylinderGeometry(0.055, 0.04, 0.76, 5);
    leg.translate(lx, ly, lz);
    parts.push(leg);
  }

  // Short tail at -Z
  const tail = new THREE.ConeGeometry(0.06, 0.18, 4);
  tail.rotateX(-0.65);
  tail.translate(0, 0.94, -0.5);
  parts.push(tail);

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Manages:
 * 1. Wild 3D Deer roaming and grazing across meadows and forest clearings (using `3dmodels/deer 3d model.glb`
 *    in close-range LOD `dist <= 1.5` chunks and a low-poly procedural fallback beyond `dist > 1.5`).
 * 2. The Dwarf's Bow & Arrow Hunting Mode: drawing the bow & arrow from his backpack (`H` key or HUD button),
 *    aiming with a 3D ballistic trajectory arc & target lock reticle, charging and shooting 3D arrows,
 *    spooking or harvesting deer for gold, and stowing the bow back in the backpack.
 */
export class HuntingAndDeerManager {
  public readonly group = new THREE.Group();
  public readonly maxAimDistance = 36.0;
  public readonly minAimDistance = 4.0;

  public isHuntingMode = false;
  public aimDistance = 16.0;
  public aimYaw = 0;
  public deerHuntedCount = 0;

  private activeChunkDeer = new Map<number, DeerInstance[]>();
  private flatActiveDeer: DeerInstance[] = [];
  private desiredKeys = new Set<number>();
  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;
  private getSurfaceHeightFn?: (wx: number, wz: number) => number;

  // Fallback low-poly deer assets
  private deerFallbackGeo!: THREE.BufferGeometry;
  private deerFallbackMats: THREE.MeshStandardMaterial[] = [];

  // 3D Bow Aiming Visuals (Parabolic Trajectory Arc + Target Lock Reticle)
  private aimArcLine!: THREE.Line;
  private aimArcPositions = new Float32Array(28 * 3);
  private aimReticleGroup = new THREE.Group();
  private aimOuterRing!: THREE.Mesh;
  private aimInnerRing!: THREE.Mesh;
  private aimRingMatNormal!: THREE.MeshBasicMaterial;
  private aimRingMatLocked!: THREE.MeshBasicMaterial;

  // Pooled 3D Flying Arrows
  private arrowPool: ArrowProjectile[] = [];
  private sharedArrowGeo!: THREE.BufferGeometry;
  private sharedArrowMat!: THREE.MeshStandardMaterial;

  // Bow draw & target lock state
  private isDrawingBow = false;
  private bowDrawPower = 0;
  private shotCooldown = 0;
  private lockedDeer: DeerInstance | null = null;
  private lastLockedState = false;
  private aimTargetWorld = new THREE.Vector3();
  private bowLaunchWorld = new THREE.Vector3();

  // Mouse raycasting for intuitive cursor aiming
  private raycaster = new THREE.Raycaster();
  private mouseNdc = new THREE.Vector2();
  private groundAimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private rayHitPoint = new THREE.Vector3();

  // DOM HUD elements for Hunting Mode
  private huntingBannerEl: HTMLElement | null;
  private huntingToggleBtn: HTMLElement | null;
  private onEnterHuntingCallback?: () => void;

  constructor(
    private config: WorldConfig,
    private noise: TerrainNoise,
    private camera: THREE.PerspectiveCamera,
    private domElement: HTMLElement,
    private dwarf: DwarfCharacter,
    private onGrantGold: (gold: number, message: string) => void
  ) {
    this.group.matrixAutoUpdate = false;
    this.huntingBannerEl = document.getElementById('hunting-banner');
    this.huntingToggleBtn = document.getElementById('hunting-mode-toggle');

    this.initDeerAssets();
    this.initHuntingVisuals();
    this.bindEvents();
    loadDeerModel();
  }

  public setOnEnterHuntingCallback(cb: () => void): void {
    this.onEnterHuntingCallback = cb;
  }

  public onTryHitTrollWithArrow?: (arrowPos: THREE.Vector3) => boolean;
  public onTryHitGoblinWithArrow?: (arrowPos: THREE.Vector3) => boolean;
  public onTryHitTitanWithArrow?: (arrowPos: THREE.Vector3) => boolean;
  public onTryHitDragonWithArrow?: (arrowPos: THREE.Vector3) => boolean;
  public isAirborneFn?: () => boolean;
  public onBulletTimeStateChange?: (active: boolean) => void;
  private isBulletTime = false;

  public isBulletTimeActive(): boolean {
    return this.isBulletTime;
  }

  public getDeerHuntedCount(): number {
    return this.deerHuntedCount;
  }

  public setDeerHuntedCount(count: number): void {
    this.deerHuntedCount = Math.max(0, Math.floor(count));
  }

  public setSurfaceHeightSampler(fn: (wx: number, wz: number) => number): void {
    this.getSurfaceHeightFn = fn;
  }

  private sampleGroundHeight(wx: number, wz: number): number {
    return this.getSurfaceHeightFn ? this.getSurfaceHeightFn(wx, wz) : this.noise.getHeight(wx, wz);
  }

  public isHuntingActive(): boolean {
    return this.isHuntingMode;
  }

  private initDeerAssets(): void {
    this.deerFallbackGeo = buildProceduralDeerFallbackGeometry();
    const fallbackBaseColors = [0xb57c4a, 0x9e5834, 0xd49b4b];
    for (let i = 0; i < DEER_SPECIES.length; i++) {
      this.deerFallbackMats.push(
        new THREE.MeshStandardMaterial({
          color: fallbackBaseColors[i],
          roughness: 0.82,
          metalness: 0.05,
        })
      );
    }
  }

  private initHuntingVisuals(): void {
    // 1. 3D Ballistic Arrow Trajectory Preview Arc
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(this.aimArcPositions, 3));
    const arcMat = new THREE.LineBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.82,
    });
    this.aimArcLine = new THREE.Line(arcGeo, arcMat);
    this.aimArcLine.frustumCulled = false;
    this.aimArcLine.visible = false;
    this.group.add(this.aimArcLine);

    // 2. Ground / Deer Target Reticle Ring
    this.aimRingMatNormal = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    this.aimRingMatLocked = new THREE.MeshBasicMaterial({
      color: 0xff4d6d,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });

    const outerRingGeo = new THREE.RingGeometry(0.62, 0.82, 28);
    outerRingGeo.rotateX(-Math.PI / 2);
    this.aimOuterRing = new THREE.Mesh(outerRingGeo, this.aimRingMatNormal);

    const innerRingGeo = new THREE.RingGeometry(0.18, 0.3, 20);
    innerRingGeo.rotateX(-Math.PI / 2);
    this.aimInnerRing = new THREE.Mesh(innerRingGeo, this.aimRingMatNormal);

    this.aimReticleGroup.add(this.aimOuterRing);
    this.aimReticleGroup.add(this.aimInnerRing);
    this.aimReticleGroup.visible = false;
    this.group.add(this.aimReticleGroup);

    // 3. Shared 3D Arrow Projectile Geometry & Pool of 6 Reusable Arrows
    const shaftGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.95, 6);
    shaftGeo.rotateX(Math.PI / 2);
    const tipGeo = new THREE.ConeGeometry(0.038, 0.14, 4);
    tipGeo.rotateX(Math.PI / 2);
    tipGeo.translate(0, 0, 0.52);
    const fletchGeo = new THREE.ConeGeometry(0.042, 0.14, 4);
    fletchGeo.rotateX(-Math.PI / 2);
    fletchGeo.translate(0, 0, -0.42);

    this.sharedArrowGeo = mergeGeometries([shaftGeo, tipGeo, fletchGeo], false);
    shaftGeo.dispose();
    tipGeo.dispose();
    fletchGeo.dispose();
    this.sharedArrowGeo.computeBoundingSphere();

    this.sharedArrowMat = new THREE.MeshStandardMaterial({
      color: 0xffe599,
      roughness: 0.35,
      metalness: 0.3,
      emissive: 0xd97706,
      emissiveIntensity: 0.35,
    });

    for (let i = 0; i < 6; i++) {
      const arrowGroup = new THREE.Group();
      arrowGroup.visible = false;
      const arrowMesh = new THREE.Mesh(this.sharedArrowGeo, this.sharedArrowMat);
      arrowMesh.castShadow = true;
      arrowGroup.add(arrowMesh);
      this.group.add(arrowGroup);

      this.arrowPool.push({
        active: false,
        stuck: false,
        age: 0,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        gravity: 15.0,
        targetDeer: null,
        mesh: arrowGroup,
      });
    }
  }

  private bindEvents(): void {
    this.huntingToggleBtn?.addEventListener('click', () => {
      this.toggleHuntingMode();
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyH') {
        this.toggleHuntingMode();
      } else if (e.code === 'Escape' && this.isHuntingMode) {
        this.exitHuntingMode();
      } else if (this.isHuntingMode) {
        if (e.code === 'KeyE' || e.code === 'KeyR') {
          this.isDrawingBow = true;
          this.bowDrawPower = Math.max(this.bowDrawPower, 0.55);
          this.dwarf.setBowDraw(this.bowDrawPower);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (!this.isHuntingMode) return;
      if (e.code === 'KeyE' || e.code === 'KeyR') {
        if (this.isDrawingBow) {
          this.fireArrow();
        }
      }
    });

    // Mouse movement updates bow aiming reticle & auto-locks onto nearby deer under cursor
    this.domElement.addEventListener(
      'mousemove',
      (e) => {
        if (!this.isHuntingMode) return;
        // Ignore if user is dragging with right-click or middle-click to orbit camera
        if ((e.buttons & 2) !== 0 || (e.buttons & 4) !== 0) return;

        this.mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;

        this.groundAimPlane.constant = -(this.dwarf.root.position.y + 0.5);
        this.raycaster.setFromCamera(this.mouseNdc, this.camera);
        if (this.raycaster.ray.intersectPlane(this.groundAimPlane, this.rayHitPoint)) {
          const dx = this.rayHitPoint.x - this.dwarf.root.position.x;
          const dz = this.rayHitPoint.z - this.dwarf.root.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.3) {
            this.aimYaw = Math.atan2(dx, dz);
            this.aimDistance = THREE.MathUtils.clamp(
              dist,
              this.minAimDistance,
              this.maxAimDistance
            );
          }
        }
      },
      { passive: true }
    );

    let downX = 0;
    let downY = 0;
    this.domElement.addEventListener(
      'mousedown',
      (e) => {
        if (!this.isHuntingMode) return;
        if (e.button === 0) {
          downX = e.clientX;
          downY = e.clientY;
          this.isDrawingBow = true;
          this.bowDrawPower = 0.45;
          this.dwarf.setBowDraw(this.bowDrawPower);
          this.playBowDrawSound();
        }
      },
      { passive: true }
    );

    window.addEventListener(
      'mouseup',
      (e) => {
        if (!this.isHuntingMode) return;
        if (e.button === 0 && this.isDrawingBow) {
          const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
          if (moved < 24 || this.bowDrawPower > 0.65) {
            this.fireArrow();
          } else {
            this.isDrawingBow = false;
            this.bowDrawPower = 0;
            this.dwarf.setBowDraw(0);
          }
        }
      },
      { passive: true }
    );
  }

  public toggleHuntingMode(): void {
    if (this.isHuntingMode) {
      this.exitHuntingMode();
    } else {
      this.enterHuntingMode();
    }
  }

  public enterHuntingMode(): void {
    const px = this.dwarf.root.position.x;
    const pz = this.dwarf.root.position.z;
    const groundY = this.sampleGroundHeight(px, pz);
    if (this.config.enableWater && groundY < this.config.waterLevel - 0.38) {
      this.onGrantGold(0, '🌊 Wade onto dry land to equip your Hunting Bow!');
      return;
    }

    this.onEnterHuntingCallback?.();
    this.isHuntingMode = true;
    this.isDrawingBow = false;
    this.bowDrawPower = 0;
    this.aimYaw = this.dwarf.heading;
    this.aimDistance = 16.0;

    // Automatically orient initial aim toward the nearest visible deer within range if one is nearby
    const nearestDeer = this.findNearestDeer(px, pz, this.maxAimDistance);
    if (nearestDeer) {
      const dx = nearestDeer.pos.x - px;
      const dz = nearestDeer.pos.z - pz;
      this.aimYaw = Math.atan2(dx, dz);
      this.aimDistance = THREE.MathUtils.clamp(
        Math.hypot(dx, dz),
        this.minAimDistance,
        this.maxAimDistance
      );
      this.lockedDeer = nearestDeer;
    }

    this.dwarf.setHuntingMode(true);
    this.dwarf.setBowDraw(0);
    this.playEquipBowSound();
    this.huntingToggleBtn?.classList.add('active');
    this.updateBannerUI();
  }

  public exitHuntingMode(): void {
    if (!this.isHuntingMode) return;
    if (this.isBulletTime) {
      this.isBulletTime = false;
      this.onBulletTimeStateChange?.(false);
      this.playBulletTimeExitSound();
    }
    this.isHuntingMode = false;
    this.isDrawingBow = false;
    this.bowDrawPower = 0;
    this.lockedDeer = null;
    this.aimArcLine.visible = false;
    this.aimReticleGroup.visible = false;
    this.dwarf.setHuntingMode(false);
    this.dwarf.setBowDraw(0);
    this.huntingToggleBtn?.classList.remove('active');
    this.updateBannerUI();
  }

  private findNearestDeer(wx: number, wz: number, maxRadius: number): DeerInstance | null {
    let best: DeerInstance | null = null;
    let bestDistSq = maxRadius * maxRadius;
    for (let i = 0; i < this.flatActiveDeer.length; i++) {
      const d = this.flatActiveDeer[i];
      if (d.respawnTimer > 0 || d.hitAnimTimer > 0) continue;
      const dx = d.pos.x - wx;
      const dz = d.pos.z - wz;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = d;
      }
    }
    return best;
  }

  private fireArrow(): void {
    if (this.isBulletTime) {
      this.isBulletTime = false;
      this.onBulletTimeStateChange?.(false);
      this.playBulletTimeExitSound();
    }
    if (!this.isHuntingMode || this.shotCooldown > 0) {
      this.isDrawingBow = false;
      this.bowDrawPower = 0;
      this.dwarf.setBowDraw(0);
      return;
    }

    // Grab an available arrow from the pool (or reuse the oldest one)
    let arrow = this.arrowPool.find((a) => !a.active);
    if (!arrow) {
      arrow = this.arrowPool[0];
    }

    this.dwarf.getBowLaunchWorldPosition(this.bowLaunchWorld);
    const power = THREE.MathUtils.clamp(this.bowDrawPower, 0.45, 1.0);
    this.isDrawingBow = false;
    this.bowDrawPower = 0;
    this.shotCooldown = 0.28;
    this.dwarf.triggerBowReleaseAnimation();
    this.playArrowReleaseSound();

    // Compute exact ballistic velocity so the arrow lands at aimTargetWorld
    const startX = this.bowLaunchWorld.x;
    const startY = this.bowLaunchWorld.y;
    const startZ = this.bowLaunchWorld.z;

    const targetX = this.lockedDeer ? this.lockedDeer.pos.x : this.aimTargetWorld.x;
    const targetZ = this.lockedDeer ? this.lockedDeer.pos.z : this.aimTargetWorld.z;
    const targetY = this.lockedDeer
      ? this.lockedDeer.pos.y + 0.78
      : this.aimTargetWorld.y + 0.15;

    const dx = targetX - startX;
    const dy = targetY - startY;
    const dz = targetZ - startZ;
    const horizDist = Math.max(1.0, Math.hypot(dx, dz));
    const speed = 28.0 + power * 14.0;
    const flightTime = Math.max(0.12, horizDist / speed);
    const gravity = 15.0;

    arrow.active = true;
    arrow.stuck = false;
    arrow.age = 0;
    arrow.gravity = gravity;
    arrow.targetDeer = this.lockedDeer;
    arrow.pos.set(startX, startY, startZ);
    arrow.vel.set(
      dx / flightTime,
      dy / flightTime + 0.5 * gravity * flightTime,
      dz / flightTime
    );

    arrow.mesh.position.copy(arrow.pos);
    arrow.mesh.lookAt(
      arrow.pos.x + arrow.vel.x,
      arrow.pos.y + arrow.vel.y,
      arrow.pos.z + arrow.vel.z
    );
    arrow.mesh.visible = true;
    this.updateBannerUI();
  }

  private updateBannerUI(): void {
    if (!this.huntingBannerEl) return;
    if (!this.isHuntingMode) {
      this.huntingBannerEl.classList.add('hidden');
      return;
    }

    this.huntingBannerEl.classList.remove('hidden');
    const bulletTimeBadge = this.isBulletTime
      ? `<span class="hunt-tag locked" style="background:rgba(0,212,255,0.28);border-color:#00e5ff;color:#e0f7fa;">⏱️ BULLET-TIME AIM (Hover)</span>`
      : '';
    const targetBadge = this.lockedDeer
      ? `<span class="hunt-tag locked">🎯 Locked: ${this.lockedDeer.species.name} (${this.aimDistance.toFixed(0)}m)</span>`
      : `<span class="hunt-tag aim">🏹 Aiming (${this.aimDistance.toFixed(0)}m / ${this.maxAimDistance.toFixed(0)}m)</span>`;

    const statusHtml = `🦌 <strong>BOW HUNTING</strong> ${bulletTimeBadge} ${targetBadge} • Mouse Aim • <kbd>Click</kbd> / <kbd>E</kbd> / <kbd>R</kbd> Shoot Arrow • <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move`;

    this.huntingBannerEl.innerHTML = `
      <span class="hunting-banner-text">${statusHtml}</span>
      <button id="hunting-exit-btn" type="button" class="fishing-exit-pill" title="Stow Bow in Backpack & Exit (H or Esc)">
        ✕ Exit (H / Esc)
      </button>
    `;
    const exitBtn = document.getElementById('hunting-exit-btn');
    exitBtn?.addEventListener('click', () => this.exitHuntingMode());
  }

  private getKey(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  public update(dt: number, elapsedTime: number, playerPos: THREE.Vector3): void {
    if (this.shotCooldown > 0) {
      this.shotCooldown = Math.max(0, this.shotCooldown - dt);
    }

    // 1. Stream 3D Deer across chunks around the player
    this.updateDeerChunks(playerPos);

    // 2. Simulate wild deer grazing, bounding, LOD switching, and fleeing
    this.updateWildDeer(dt, elapsedTime, playerPos);

    // 3. Simulate active 3D flying arrows & hit detection
    this.updateArrows(dt, playerPos);

    // 4. Update active Hunting Mode aiming arc & bow draw
    if (this.isHuntingMode) {
      const playerGroundY = this.sampleGroundHeight(playerPos.x, playerPos.z);
      if (this.config.enableWater && playerGroundY < this.config.waterLevel - 0.38) {
        this.exitHuntingMode();
      } else {
        this.updateHuntingAimState(dt, elapsedTime, playerPos);
      }
    }
  }

  private updateDeerChunks(playerPos: THREE.Vector3): void {
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

          if (!this.activeChunkDeer.has(key)) {
            this.spawnDeerForChunk(cx, cz, key);
          }
        }
      }

      for (const [key, deerList] of this.activeChunkDeer.entries()) {
        if (!desiredKeys.has(key)) {
          for (const d of deerList) {
            if (d === this.lockedDeer) this.lockedDeer = null;
            activeNearDeer.delete(d);
            this.group.remove(d.root);
            const idx = this.flatActiveDeer.indexOf(d);
            if (idx !== -1) this.flatActiveDeer.splice(idx, 1);
          }
          this.activeChunkDeer.delete(key);
        }
      }
    }
  }

  private spawnDeerForChunk(cx: number, cz: number, chunkKey: number): void {
    const size = this.config.chunkSize;
    const chunkSeed = ((cx * 92837111) ^ (cz * 57293847) ^ (this.config.seed + 1337)) >>> 0;
    const rng = createSeededRandom(chunkSeed);
    const deerList: DeerInstance[] = [];
    const minLandY = this.config.enableWater ? this.config.waterLevel + 0.75 : -999;

    // Guaranteed starter herd of deer on the sunlit meadows around chunk (0, 0)
    if (cx === 0 && cz === 0) {
      const starterSpots = [
        { x: -16.5, z: -14.0, sp: 0 },
        { x: -21.0, z: -9.5, sp: 1 },
        { x: 14.5, z: 16.5, sp: 2 },
      ];
      for (const spot of starterSpots) {
        const gy = this.sampleGroundHeight(spot.x, spot.z);
        if (gy > minLandY) {
          deerList.push(this.createDeerInstance(spot.x, gy, spot.z, spot.sp, rng));
        }
      }
    }

    // Spawn 1 to 2 wild deer in ~75% of surrounding chunks on grassy/woodland terrain
    const targetCount = rng() < 0.75 ? (rng() < 0.35 ? 2 : 1) : 0;
    for (let attempt = 0; attempt < 10 && deerList.length < (cx === 0 && cz === 0 ? 4 : targetCount); attempt++) {
      const wx = cx * size + (rng() - 0.5) * (size * 0.8);
      const wz = cz * size + (rng() - 0.5) * (size * 0.8);
      if (wx * wx + wz * wz < 9.0 * 9.0) continue; // Keep exact spawn point clear
      const vdx = wx - VOLCANO_X;
      const vdz = wz - VOLCANO_Z;
      if (vdx * vdx + vdz * vdz < DEER_VOLCANO_EXCLUSION_RADIUS_SQ) continue; // No deer near the volcano ever
      const wy = this.sampleGroundHeight(wx, wz);
      if (wy > minLandY && wy < this.config.waterLevel + 24.0) {
        const speciesIdx = rng() < 0.16 ? 2 : rng() < 0.5 ? 1 : 0;
        deerList.push(this.createDeerInstance(wx, wy, wz, speciesIdx, rng));
      }
    }

    this.activeChunkDeer.set(chunkKey, deerList);
    for (let i = 0; i < deerList.length; i++) {
      this.flatActiveDeer.push(deerList[i]);
    }
  }

  private createDeerInstance(
    wx: number,
    wy: number,
    wz: number,
    speciesIdx: number,
    rng: () => number
  ): DeerInstance {
    const species = DEER_SPECIES[speciesIdx];
    const root = new THREE.Group();
    root.position.set(wx, wy, wz);
    root.scale.setScalar(species.scale);

    const bodyMesh = new THREE.Mesh(this.deerFallbackGeo, this.deerFallbackMats[speciesIdx]);
    bodyMesh.castShadow = false;
    bodyMesh.receiveShadow = false;
    root.add(bodyMesh);

    this.group.add(root);

    const heading = rng() * Math.PI * 2;
    root.rotation.y = heading;

    return {
      species,
      speciesIdx,
      homePos: new THREE.Vector3(wx, wy, wz),
      pos: new THREE.Vector3(wx, wy, wz),
      heading,
      speed: 1.85 + rng() * 0.65,
      stridePhase: rng() * Math.PI * 2,
      turnTimer: 1.5 + rng() * 3.0,
      targetYawOffset: 0,
      grazeTimer: rng() < 0.4 ? 1.5 + rng() * 2.5 : 0,
      fleeTimer: 0,
      hitAnimTimer: 0,
      respawnTimer: 0,
      isNearLOD: false,
      root,
      bodyMesh,
    };
  }

  private updateWildDeer(dt: number, _elapsedTime: number, playerPos: THREE.Vector3): void {
    const nearLodDist = this.config.chunkSize * 1.5; // ~72m close-range GLB LOD radius
    const nearLodDistSq = nearLodDist * nearLodDist;
    const shadowDistSq = 48.0 * 48.0;
    const maxSimDistSq = 85.0 * 85.0;
    const minLandY = this.config.enableWater ? this.config.waterLevel + 0.35 : -999;
    for (let i = 0; i < this.flatActiveDeer.length; i++) {
      const d = this.flatActiveDeer[i];
        // Handle respawn timer after a deer has been harvested
        if (d.respawnTimer > 0) {
          d.respawnTimer -= dt;
          if (d.respawnTimer <= 0) {
            d.respawnTimer = 0;
            d.hitAnimTimer = 0;
            d.fleeTimer = 0;
            d.pos.copy(d.homePos);
            d.pos.y = this.sampleGroundHeight(d.pos.x, d.pos.z);
            d.root.position.copy(d.pos);
            d.root.rotation.set(0, d.heading, 0);
            d.root.scale.setScalar(d.species.scale);
            d.root.visible = true;
          }
          continue;
        }

        // Handle dramatic leap-and-vanish animation when hit by an arrow
        if (d.hitAnimTimer > 0) {
          d.hitAnimTimer -= dt;
          const p = 1.0 - d.hitAnimTimer / 0.55;
          d.root.position.y = d.pos.y + Math.sin(p * Math.PI) * 1.35;
          d.root.rotation.y += dt * 8.5;
          d.root.scale.setScalar(d.species.scale * Math.max(0.01, 1.0 - p * 0.92));
          if (d.hitAnimTimer <= 0) {
            d.root.visible = false;
            d.respawnTimer = 11.0;
          }
          continue;
        }

        const dxP = playerPos.x - d.pos.x;
        const dzP = playerPos.z - d.pos.z;
        const distSq = dxP * dxP + dzP * dzP;

        // 1. Dynamic Close-Range GLB LOD Swapping (dist <= 1.5 chunks)
        const wantNearLOD = distSq <= nearLodDistSq;
        if (wantNearLOD !== d.isNearLOD) {
          d.isNearLOD = wantNearLOD;
          if (wantNearLOD) {
            activeNearDeer.add(d);
            if (sharedDeerGlbGeo && sharedDeerGlbMats.length > 0) {
              d.bodyMesh.geometry = sharedDeerGlbGeo;
              d.bodyMesh.material = sharedDeerGlbMats[d.speciesIdx];
            }
          } else {
            activeNearDeer.delete(d);
            d.bodyMesh.geometry = this.deerFallbackGeo;
            d.bodyMesh.material = this.deerFallbackMats[d.speciesIdx];
          }
        }

        // 2. Shadow Culling (dist <= 2.2 chunks)
        const wantShadow = distSq <= shadowDistSq;
        if (d.bodyMesh.castShadow !== wantShadow) {
          d.bodyMesh.castShadow = wantShadow;
        }

        if (distSq > maxSimDistSq) {
          if (d.root.visible) d.root.visible = false;
          continue;
        }
        if (!d.root.visible) d.root.visible = true;

        // Spook if the player runs right up next to the deer (< 6.2m by day, or < 12.5m at night when Trolls prowl!)
        const hour = ((this.config.timeOfDay % 24) + 24) % 24;
        const isNight = hour >= 19.5 || hour < 5.5;
        const spookRadius = isNight ? 12.5 : 6.2;
        if (distSq < spookRadius * spookRadius && d.fleeTimer <= 0.2) {
          d.fleeTimer = isNight ? 4.2 : 2.8;
          d.grazeTimer = 0;
        }

        const vdx = d.pos.x - VOLCANO_X;
        const vdz = d.pos.z - VOLCANO_Z;
        const curVDistSq = vdx * vdx + vdz * vdz;

        if (d.fleeTimer > 0) {
          d.fleeTimer = Math.max(0, d.fleeTimer - dt);
          const awayAngle = Math.atan2(-dxP, -dzP);
          let diff = awayAngle - d.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          d.heading += diff * Math.min(1, dt * 8.0);

          const fleeSpeed = d.speed * (isNight ? 4.3 : 3.1);
          let nextX = d.pos.x + Math.sin(d.heading) * fleeSpeed * dt;
          let nextZ = d.pos.z + Math.cos(d.heading) * fleeSpeed * dt;
          const nextVdx = nextX - VOLCANO_X;
          const nextVdz = nextZ - VOLCANO_Z;
          const nextVDistSq = nextVdx * nextVdx + nextVdz * nextVdz;

          // Never allow a fleeing deer to approach the volcano
          if (
            nextVDistSq < DEER_VOLCANO_EXCLUSION_RADIUS_SQ ||
            (curVDistSq < DEER_VOLCANO_TURNBACK_RADIUS_SQ && nextVDistSq < curVDistSq)
          ) {
            d.heading = Math.atan2(vdx, vdz);
            nextX = d.pos.x + Math.sin(d.heading) * fleeSpeed * dt;
            nextZ = d.pos.z + Math.cos(d.heading) * fleeSpeed * dt;
          }

          const nextY = this.sampleGroundHeight(nextX, nextZ);

          if (nextY > minLandY) {
            d.pos.x = nextX;
            d.pos.z = nextZ;
            d.pos.y = nextY;
            if (curVDistSq < DEER_VOLCANO_TURNBACK_RADIUS_SQ) {
              d.homePos.set(nextX, nextY, nextZ);
            }
          } else {
            d.heading += Math.PI * 0.65;
          }

          d.stridePhase += dt * 15.0;
          const boundHop = Math.abs(Math.sin(d.stridePhase)) * 0.34;
          const boundPitch = -Math.cos(d.stridePhase) * 0.14;
          d.root.position.set(d.pos.x, d.pos.y + boundHop, d.pos.z);
          d.root.rotation.set(boundPitch, d.heading, 0);
        } else if (d.grazeTimer > 0) {
          // Peaceful grazing pause in the meadow
          d.grazeTimer -= dt;
          d.stridePhase += dt * 2.5;
          const grazePitch = 0.14 + Math.sin(d.stridePhase) * 0.04;
          d.root.position.set(d.pos.x, d.pos.y, d.pos.z);
          d.root.rotation.set(grazePitch, d.heading, 0);
        } else {
          // Gentle woodland strolling & occasional grazing pause
          d.turnTimer -= dt;
          if (d.turnTimer <= 0) {
            d.turnTimer = 2.0 + Math.random() * 3.2;
            if (Math.random() < 0.38) {
              d.grazeTimer = 1.8 + Math.random() * 2.4;
              d.targetYawOffset = 0;
            } else {
              d.targetYawOffset = (Math.random() - 0.5) * 1.2;
            }
          }

          // Steer back toward home meadow if wandering > 14m away
          const hx = d.homePos.x - d.pos.x;
          const hz = d.homePos.z - d.pos.z;
          const homeDist = Math.hypot(hx, hz);
          if (homeDist > 14.0) {
            const homeHeading = Math.atan2(hx, hz);
            let diff = homeHeading - d.heading;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            d.heading += diff * Math.min(1, dt * 3.0);
          } else {
            d.heading += d.targetYawOffset * dt;
          }

          let nextX = d.pos.x + Math.sin(d.heading) * d.speed * dt;
          let nextZ = d.pos.z + Math.cos(d.heading) * d.speed * dt;
          const nextVdx = nextX - VOLCANO_X;
          const nextVdz = nextZ - VOLCANO_Z;
          const nextVDistSq = nextVdx * nextVdx + nextVdz * nextVdz;

          // Never allow a strolling deer to approach the volcano
          if (
            nextVDistSq < DEER_VOLCANO_EXCLUSION_RADIUS_SQ ||
            (curVDistSq < DEER_VOLCANO_TURNBACK_RADIUS_SQ && nextVDistSq < curVDistSq)
          ) {
            d.heading = Math.atan2(vdx, vdz);
            d.targetYawOffset = 0;
            d.turnTimer = 2.5;
            nextX = d.pos.x + Math.sin(d.heading) * d.speed * dt;
            nextZ = d.pos.z + Math.cos(d.heading) * d.speed * dt;
          }

          const nextY = this.sampleGroundHeight(nextX, nextZ);

          if (nextY > minLandY) {
            d.pos.x = nextX;
            d.pos.z = nextZ;
            d.pos.y = nextY;
            if (curVDistSq < DEER_VOLCANO_TURNBACK_RADIUS_SQ) {
              d.homePos.set(nextX, nextY, nextZ);
            }
          } else {
            d.heading += Math.PI * 0.75;
            d.turnTimer = 1.5;
          }

          d.stridePhase += dt * 7.5;
          const walkBob = Math.abs(Math.sin(d.stridePhase)) * 0.08;
          const walkPitch = -Math.cos(d.stridePhase) * 0.04;
          d.root.position.set(d.pos.x, d.pos.y + walkBob, d.pos.z);
          d.root.rotation.set(walkPitch, d.heading, 0);
        }
      }
    }

  private updateArrows(dt: number, playerPos: THREE.Vector3): void {
    for (const arrow of this.arrowPool) {
      if (!arrow.active) continue;
      arrow.age += dt;

      if (arrow.stuck) {
        if (arrow.age > 2.6) {
          arrow.active = false;
          arrow.mesh.visible = false;
        }
        continue;
      }

      // Subtle homing magnetism if the shot was locked onto a deer
      if (
        arrow.targetDeer &&
        arrow.targetDeer.respawnTimer <= 0 &&
        arrow.targetDeer.hitAnimTimer <= 0
      ) {
        const tx = arrow.targetDeer.pos.x - arrow.pos.x;
        const ty = arrow.targetDeer.pos.y + 0.78 - arrow.pos.y;
        const tz = arrow.targetDeer.pos.z - arrow.pos.z;
        const dist = Math.hypot(tx, ty, tz);
        if (dist > 0.1 && dist < 12.0) {
          const speed = arrow.vel.length();
          arrow.vel.x = THREE.MathUtils.lerp(arrow.vel.x, (tx / dist) * speed, Math.min(1, dt * 6));
          arrow.vel.z = THREE.MathUtils.lerp(arrow.vel.z, (tz / dist) * speed, Math.min(1, dt * 6));
        }
      }

      arrow.vel.y -= arrow.gravity * dt;
      arrow.pos.x += arrow.vel.x * dt;
      arrow.pos.y += arrow.vel.y * dt;
      arrow.pos.z += arrow.vel.z * dt;

      arrow.mesh.position.copy(arrow.pos);
      arrow.mesh.lookAt(
        arrow.pos.x + arrow.vel.x,
        arrow.pos.y + arrow.vel.y,
        arrow.pos.z + arrow.vel.z
      );

      // Check hit against any active Night Troll first!
      if (this.onTryHitTrollWithArrow && this.onTryHitTrollWithArrow(arrow.pos)) {
        arrow.active = false;
        arrow.mesh.visible = false;
        continue;
      }

      // Check hit against any active Goblin!
      if (this.onTryHitGoblinWithArrow && this.onTryHitGoblinWithArrow(arrow.pos)) {
        arrow.active = false;
        arrow.mesh.visible = false;
        continue;
      }

      // Check hit against Colossal Crag-Titan World Boss!
      if (this.onTryHitTitanWithArrow && this.onTryHitTitanWithArrow(arrow.pos)) {
        arrow.active = false;
        arrow.mesh.visible = false;
        continue;
      }

      // Check hit against Colossal Ash-Peak Wyrm (Vermithrax)!
      if (this.onTryHitDragonWithArrow && this.onTryHitDragonWithArrow(arrow.pos)) {
        arrow.active = false;
        arrow.mesh.visible = false;
        continue;
      }

      // Check hit against all active deer (flat array, zero allocations)
      let hitDeer: DeerInstance | null = null;
      for (let i = 0; i < this.flatActiveDeer.length; i++) {
        const d = this.flatActiveDeer[i];
        if (d.respawnTimer > 0 || d.hitAnimTimer > 0) continue;
        const dx = arrow.pos.x - d.pos.x;
        const dz = arrow.pos.z - d.pos.z;
        const dy = arrow.pos.y - (d.pos.y + 0.82);
        if (dx * dx + dz * dz <= 1.25 * 1.25 && Math.abs(dy) <= 1.15) {
          hitDeer = d;
          break;
        }
      }

      if (hitDeer) {
        arrow.active = false;
        arrow.mesh.visible = false;
        hitDeer.hitAnimTimer = 0.55;
        this.deerHuntedCount++;
        if (this.lockedDeer === hitDeer) {
          this.lockedDeer = null;
        }

        // Celebratory golden particle burst at the deer + player
        this.dwarf.spawnBurst(hitDeer.pos.x, hitDeer.pos.y + 0.8, hitDeer.pos.z, 16);
        this.dwarf.spawnBurst(playerPos.x, playerPos.y + 0.8, playerPos.z, 10);
        this.playHuntSuccessFanfare();
        const rations = hitDeer.species.gold >= 250 ? 3 : 2;
        this.onGrantGold(
          hitDeer.species.gold,
          `🏹 Hunted ${hitDeer.species.name}! +${hitDeer.species.gold} Gold & +${rations} Venison Food (+Energy ⚡)`
        );
        this.updateBannerUI();
        continue;
      }

      // Check ground impact
      const groundY = this.sampleGroundHeight(arrow.pos.x, arrow.pos.z);
      if (arrow.pos.y <= groundY + 0.05 || arrow.age > 3.5) {
        arrow.pos.y = groundY + 0.05;
        arrow.mesh.position.copy(arrow.pos);
        arrow.stuck = true;
        arrow.age = 0;

        // Spook any deer within 6.5m of the arrow impact!
        for (let i = 0; i < this.flatActiveDeer.length; i++) {
          const d = this.flatActiveDeer[i];
          if (d.respawnTimer > 0 || d.hitAnimTimer > 0) continue;
          const dx = arrow.pos.x - d.pos.x;
          const dz = arrow.pos.z - d.pos.z;
          if (dx * dx + dz * dz < 6.5 * 6.5) {
            d.fleeTimer = 3.2;
            d.grazeTimer = 0;
          }
        }
      }
    }
  }

  private updateHuntingAimState(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3
  ): void {
    const isAirborne = this.isAirborneFn?.() ?? false;
    const shouldBulletTime = this.isDrawingBow && isAirborne;
    if (shouldBulletTime !== this.isBulletTime) {
      this.isBulletTime = shouldBulletTime;
      this.onBulletTimeStateChange?.(shouldBulletTime);
      if (shouldBulletTime) {
        this.playBulletTimeEnterSound();
      } else {
        this.playBulletTimeExitSound();
      }
      this.updateBannerUI();
    }

    if (this.isDrawingBow) {
      // Draw bow slightly faster in bullet-time so the player gets a clean shot ready
      const drawSpeed = this.isBulletTime ? 2.4 : 1.15;
      this.bowDrawPower = Math.min(1.0, this.bowDrawPower + dt * drawSpeed);
      this.dwarf.setBowDraw(this.bowDrawPower);
    } else {
      this.dwarf.setBowDraw(0.22);
    }

    // Orient dwarf toward the bow aim direction when aiming
    this.dwarf.heading = this.aimYaw;
    this.dwarf.root.rotation.y = this.aimYaw;
    this.dwarf.getBowLaunchWorldPosition(this.bowLaunchWorld);

    // Raw aimed landing point
    let tx = playerPos.x + Math.sin(this.aimYaw) * this.aimDistance;
    let tz = playerPos.z + Math.cos(this.aimYaw) * this.aimDistance;
    let ty = this.sampleGroundHeight(tx, tz) + 0.08;

    // Check if the aimed point is near a live deer (within 3.2m) for smart Target Lock!
    const snapDeer = this.findNearestDeer(tx, tz, 3.2);
    this.lockedDeer = snapDeer;
    if (snapDeer) {
      tx = snapDeer.pos.x;
      tz = snapDeer.pos.z;
      ty = snapDeer.pos.y + 0.12;
    }
    this.aimTargetWorld.set(tx, ty, tz);

    const isLocked = Boolean(this.lockedDeer);
    if (isLocked !== this.lastLockedState) {
      this.lastLockedState = isLocked;
      this.updateBannerUI();
    }

    // Update 3D parabolic arrow trajectory preview arc
    const segments = 27;
    const arcHeight = 1.1 + this.aimDistance * 0.085;
    const endY = snapDeer ? snapDeer.pos.y + 0.78 : ty;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = THREE.MathUtils.lerp(this.bowLaunchWorld.x, tx, t);
      const z = THREE.MathUtils.lerp(this.bowLaunchWorld.z, tz, t);
      const baseY = THREE.MathUtils.lerp(this.bowLaunchWorld.y, endY, t);
      const parabola = 4.0 * t * (1.0 - t) * arcHeight;
      this.aimArcPositions[i * 3] = x;
      this.aimArcPositions[i * 3 + 1] = baseY + parabola;
      this.aimArcPositions[i * 3 + 2] = z;
    }
    (this.aimArcLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.aimArcLine.material as THREE.LineBasicMaterial).color.setHex(
      isLocked ? 0xff4d6d : 0xffd166
    );
    this.aimArcLine.visible = true;

    // Update pulsing target reticle ring on ground / under locked deer
    this.aimReticleGroup.position.set(tx, ty, tz);
    const pulse = 0.9 + Math.sin(elapsedTime * (isLocked ? 9.0 : 5.0)) * 0.12;
    this.aimOuterRing.scale.setScalar(pulse);
    const ringMat = isLocked ? this.aimRingMatLocked : this.aimRingMatNormal;
    this.aimOuterRing.material = ringMat;
    this.aimInnerRing.material = ringMat;
    this.aimReticleGroup.visible = true;
  }

  public rebuildAll(): void {
    this.lockedDeer = null;
    for (let i = 0; i < this.flatActiveDeer.length; i++) {
      const d = this.flatActiveDeer[i];
      activeNearDeer.delete(d);
      this.group.remove(d.root);
    }
    this.activeChunkDeer.clear();
    this.flatActiveDeer.length = 0;
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
  }

  private ensureAudio(): AudioContext | null {
    return getSharedAudioContext();
  }

  private playEquipBowSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.13);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.17);
  }

  private playBowDrawSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(290, now + 0.14);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.17);
  }

  private playArrowReleaseSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.18);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.21);
  }

  private playHuntSuccessFanfare(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [440.0, 554.37, 659.25, 880.0];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.075);
      gain.gain.setValueAtTime(0.001, now + idx * 0.075);
      gain.gain.exponentialRampToValueAtTime(0.16, now + idx * 0.075 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.075 + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.075);
      osc.stop(now + idx * 0.075 + 0.36);
    });
  }

  private playBulletTimeEnterSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(560, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.35);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.42);
  }

  private playBulletTimeExitSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.18);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.24);
  }
}
