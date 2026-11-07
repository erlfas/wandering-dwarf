import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import volcanoLavaVentsSfxUrl from '../../music/sfx/volcano_lava_vents.mp3?url';
import volcanoRumbleSfxUrl from '../../music/sfx/volcano_rumble_loop.mp3?url';
import { BackgroundMusic } from '../audio/BackgroundMusic';
import { WorldConfig } from './Config';
import {
  TerrainNoise,
  VOLCANO_CRATER_RADIUS,
  VOLCANO_LAVA_LAKE_Y,
  VOLCANO_OUTER_RADIUS,
  VOLCANO_PEAK_HEIGHT,
  VOLCANO_RIM_RADIUS,
  VOLCANO_X,
  VOLCANO_Z,
} from './TerrainNoise';

const SMOKE_PUFF_COUNT = 76;
const FLAME_TONGUE_COUNT = 40;
const EMBER_COUNT = 120;

// Distance from (VOLCANO_X, VOLCANO_Z) within which scorching volcanic heat drains Strength & Health
export const VOLCANO_HEAT_HAZARD_RADIUS = 132.0;

interface SmokePuffSeed {
  basePhase: number;
  speed: number;
  angleOffset: number;
  radiusJitter: number;
  scaleMult: number;
  rotSpeed: number;
  lobeTint: number;
}

interface FlameTongueSeed {
  tier: 0 | 1 | 2; // 0 = towering summit crown, 1 = inner magma cauldron jets, 2 = rim & flank fissure vents
  baseX: number;
  baseY: number;
  baseZ: number;
  baseRadius: number;
  baseHeight: number;
  phase: number;
  speed: number;
  yaw: number;
}

const tempDummy = new THREE.Object3D();
const tempColor = new THREE.Color();
const tempNormal = new THREE.Vector3();

const COL_SMOKE_FIRE_BASE = new THREE.Color(0xff4d00);
const COL_SMOKE_EMBER_MID = new THREE.Color(0x59180a);
const COL_SMOKE_OMINOUS_CORE = new THREE.Color(0x121015);
const COL_SMOKE_OMINOUS_TOP = new THREE.Color(0x1f1c24);

/**
 * Solves the implicit lava channel centerline equation `angle + sin(r * 0.055 + angle * 2.0) * 0.24 = baseAngle`
 * using 2 fixed-point iterations so 3D lava river ribbons and fissure vents align with TerrainNoise channels.
 */
function solveLavaChannelAngle(baseAngle: number, r: number): number {
  let centerAngle = baseAngle - Math.sin(r * 0.055 + baseAngle * 2.0) * 0.24;
  centerAngle = baseAngle - Math.sin(r * 0.055 + centerAngle * 2.0) * 0.24;
  centerAngle = baseAngle - Math.sin(r * 0.055 + centerAngle * 2.0) * 0.24;
  return centerAngle;
}

/**
 * Builds a multi-lobed volumetric-style billowing smoke cloud geometry (~400 tris, 210 welded vertices)
 * with baked vertical ambient-occlusion vertex colors so the ominous plume has deep,
 * brooding 3D volume from every viewing distance.
 */
function createOminousSmokePuffGeometry(): THREE.BufferGeometry {
  const lobes = [
    { x: 0.0, y: 0.0, z: 0.0, sx: 1.05, sy: 0.82, sz: 1.05, shade: 1.0 },
    { x: 0.52, y: 0.12, z: 0.28, sx: 0.78, sy: 0.68, sz: 0.78, shade: 0.92 },
    { x: -0.48, y: 0.08, z: 0.34, sx: 0.76, sy: 0.65, sz: 0.75, shade: 0.88 },
    { x: 0.12, y: -0.14, z: -0.52, sx: 0.8, sy: 0.64, sz: 0.78, shade: 0.82 },
    { x: -0.18, y: 0.42, z: -0.08, sx: 0.74, sy: 0.66, sz: 0.74, shade: 1.08 },
  ];

  const parts: THREE.BufferGeometry[] = [];
  for (const l of lobes) {
    const rawIco = new THREE.IcosahedronGeometry(1.0, 1);
    rawIco.deleteAttribute('normal');
    rawIco.deleteAttribute('uv');
    const ico = mergeVertices(rawIco, 1e-3);
    rawIco.dispose();

    ico.scale(l.sx, l.sy, l.sz);
    ico.translate(l.x, l.y, l.z);

    const pos = ico.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      // Darker underside, slightly lighter crown for billowing cloud relief
      const vShade = THREE.MathUtils.clamp((0.68 + (py + 1.0) * 0.24) * l.shade, 0.42, 1.15);
      colors[i * 3] = vShade;
      colors[i * 3 + 1] = vShade * 0.97;
      colors[i * 3 + 2] = vShade * 1.02;
    }
    ico.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(ico);
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds a tapered, twisted volcanic flame tongue geometry with vertex colors grading
 * from incandescent white-gold at the core base, to blazing orange, to deep crimson at the tip.
 */
function createFlameTongueGeometry(): THREE.BufferGeometry {
  const radialSegs = 7;
  const heightSegs = 5;
  const geo = new THREE.ConeGeometry(1.0, 1.0, radialSegs, heightSegs, true);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  // Shift base from -0.5 to 0.0 so scaling Y grows the flame upward from its crater anchor
  geo.translate(0, 0.5, 0);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cBase = new THREE.Color(0xfff6b3);
  const cMid = new THREE.Color(0xff7700);
  const cTip = new THREE.Color(0xff1100);
  const cTmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i); // [0, 1]
    const z = pos.getZ(i);

    // Add organic helical twist and S-curve wave toward the flame tip
    const twist = y * 1.35;
    const cosT = Math.cos(twist);
    const sinT = Math.sin(twist);
    const rx = x * cosT - z * sinT + Math.sin(y * Math.PI * 1.5) * 0.14 * y;
    const rz = x * sinT + z * cosT + Math.cos(y * Math.PI * 1.2) * 0.1 * y;
    pos.setXYZ(i, rx, y, rz);

    if (y < 0.42) {
      cTmp.copy(cBase).lerp(cMid, y / 0.42);
    } else {
      cTmp.copy(cMid).lerp(cTip, (y - 0.42) / 0.58);
    }
    colors[i * 3] = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Manages the single Colossal Active Volcano ("Mount Doomforge"):
 * 1. Persistent horizon mountain cone + molten magma crater & glowing flank lava rivers (visible from any distance)
 * 2. Roaring multi-tiered glowing flames & pulsing fiery caldera sky-glow crown (never erupts, eternally active)
 * 3. Towering 560m-high ominous dark smoke plume & rising glowing volcanic embers
 * 4. ElevenLabs proximity-scaled volcanic activity SFX (`volcano_rumble_loop.mp3` & `volcano_lava_vents.mp3`)
 * 5. ElevenLabs Volcano Omen soundtrack transition (`Volcano_Caldera_Omen.mp3`) as one approaches
 */
export class VolcanoManager {
  public readonly group = new THREE.Group();

  private distantConeMesh!: THREE.Mesh;
  private distantConeMat!: THREE.MeshStandardMaterial;
  private lavaSurfaceMesh!: THREE.Mesh;
  private lavaMat!: THREE.MeshBasicMaterial;
  private craterGlowOuterMesh!: THREE.Mesh;
  private craterGlowInnerMesh!: THREE.Mesh;
  private craterGlowOuterMat!: THREE.MeshBasicMaterial;
  private craterGlowInnerMat!: THREE.MeshBasicMaterial;
  private flameInstancedMesh!: THREE.InstancedMesh;
  private smokeInstancedMesh!: THREE.InstancedMesh;
  private emberPoints!: THREE.Points;
  private emberPositions!: Float32Array;
  private emberPhases!: Float32Array;

  private readonly smokeSeeds: SmokePuffSeed[] = [];
  private readonly flameSeeds: FlameTongueSeed[] = [];

  // ElevenLabs Volcanic Activity Audio
  private rumbleAudio: HTMLAudioElement;
  private lavaVentsAudio: HTMLAudioElement;
  private rumbleBlobUrl: string | null = null;
  private ventsBlobUrl: string | null = null;
  private rumblePlayPending = false;
  private ventsPlayPending = false;
  private lastRumbleVol = -1;
  private lastRumbleRate = -1;
  private lastVentsVol = -1;
  private lastVentsRate = -1;
  private audioUnlocked = false;
  private readonly unlockAudioHandler: () => void;

  private isNearVolcanoTuneActive = false;
  private hasShownApproachToast = false;
  private hasDiscoveredRimWaypoint = false;
  private rimWarnCooldown = 0;
  private heatExposureTime = 0;
  private scorchBurstAccum = 0;
  private defeatRestorePending = false;
  private defeatRestoreTimer = 0;
  private pendingDefeatReason: 'bottom' | 'heat' = 'heat';

  private toastContainer: HTMLElement | null;
  private activeToastEl: HTMLDivElement | null = null;
  private activeToastFadeTimer = 0;
  private activeToastRemoveTimer = 0;

  public onApplyVolcanicHazard?: (
    strengthDrain: number,
    healthDrain: number,
    instantDeath: boolean
  ) => { defeated: boolean; remainingEnergy: number; remainingHealth: number };
  public onPlayerDiedInVolcano?: (reason: 'bottom' | 'heat') => void;
  public onSpawnScorchBurst?: (x: number, y: number, z: number, count: number) => void;
  public isHeatImmuneFn?: () => boolean;

  constructor(
    private config: WorldConfig,
    private noise: TerrainNoise,
    private bgm: BackgroundMusic,
    private onDiscoverCalderaRim?: (waypoint: {
      id: string;
      name: string;
      x: number;
      y: number;
      z: number;
    }) => void
  ) {
    this.group.matrixAutoUpdate = false;
    this.toastContainer = document.getElementById('pickup-toasts');

    // Initialize ElevenLabs Volcanic Activity SFX loops
    this.rumbleAudio = new Audio(volcanoRumbleSfxUrl);
    this.rumbleAudio.preload = 'auto';
    this.rumbleAudio.loop = true;
    this.rumbleAudio.volume = 0;

    this.lavaVentsAudio = new Audio(volcanoLavaVentsSfxUrl);
    this.lavaVentsAudio.preload = 'auto';
    this.lavaVentsAudio.loop = true;
    this.lavaVentsAudio.volume = 0;

    // Pre-buffer both ElevenLabs SFX files into Blob URLs for seamless, gapless looping
    fetch(volcanoRumbleSfxUrl)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob) return;
        this.rumbleBlobUrl = URL.createObjectURL(blob);
        if (this.rumbleAudio.paused && !this.rumblePlayPending) {
          this.rumbleAudio.src = this.rumbleBlobUrl;
          this.rumbleAudio.load();
        }
      })
      .catch(() => {});

    fetch(volcanoLavaVentsSfxUrl)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob) return;
        this.ventsBlobUrl = URL.createObjectURL(blob);
        if (this.lavaVentsAudio.paused && !this.ventsPlayPending) {
          this.lavaVentsAudio.src = this.ventsBlobUrl;
          this.lavaVentsAudio.load();
        }
      })
      .catch(() => {});

    this.unlockAudioHandler = () => {
      this.audioUnlocked = true;
      window.removeEventListener('keydown', this.unlockAudioHandler);
      window.removeEventListener('pointerdown', this.unlockAudioHandler);
    };
    window.addEventListener('keydown', this.unlockAudioHandler, { passive: true });
    window.addEventListener('pointerdown', this.unlockAudioHandler, { passive: true });

    this.buildDistantVolcanoCone();
    this.buildMoltenLavaAndGlow();
    this.buildRoaringFlames();
    this.buildOminousSmokePlume();
    this.buildRisingEmbers();
  }

  /**
   * Builds the persistent 3D volcano mountain mesh centered at (VOLCANO_X, 0, VOLCANO_Z)
   * so Mount Doomforge is visible from far, far away even when chunks around it are not loaded.
   * Uses polar grid finite-difference normals to avoid 4x per-vertex getNormal() noise calls at startup,
   * and depresses vertices along the slopes and lava channels so loaded high-res TerrainChunks
   * and glowing flank magma rivers sit cleanly on top without z-fighting.
   */
  private buildDistantVolcanoCone(): void {
    const angularSegs = 96;
    const radialRings = 40;
    const stride = angularSegs + 1;
    const vertCount = (radialRings + 1) * stride;
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const indices: number[] = [];

    for (let ir = 0; ir < radialRings; ir++) {
      for (let ia = 0; ia < angularSegs; ia++) {
        const a = ir * stride + ia;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);

    this.distantConeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.05,
      wireframe: this.config.wireframe,
    });

    // Cap maximum exponential fog attenuation at 0.56 so the giant volcano silhouette
    // remains looming and clearly visible from anywhere in the world (400m to 3000m+ away)
    this.distantConeMat.customProgramCacheKey = () => 'volcano_distant_cone_v1';
    this.distantConeMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
          #else
            float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
          #endif
          fogFactor = min( fogFactor, 0.56 );
          gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
        #endif`
      );
    };

    this.distantConeMesh = new THREE.Mesh(geo, this.distantConeMat);
    this.distantConeMesh.frustumCulled = true;
    this.distantConeMesh.castShadow = false;
    this.distantConeMesh.receiveShadow = false;
    this.distantConeMesh.matrixAutoUpdate = false;
    this.populateDistantConeVertices();
    this.group.add(this.distantConeMesh);
  }

  private populateDistantConeVertices(): void {
    const angularSegs = 96;
    const radialRings = 40;
    const stride = angularSegs + 1;
    const vertCount = (radialRings + 1) * stride;
    const geo = this.distantConeMesh.geometry;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const normAttr = geo.attributes.normal as THREE.BufferAttribute;
    const colAttr = geo.attributes.color as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const normals = normAttr.array as Float32Array;
    const colors = colAttr.array as Float32Array;

    const rawHeights = new Float32Array(vertCount);
    const cosTable = new Float32Array(stride);
    const sinTable = new Float32Array(stride);
    const thetaTable = new Float32Array(stride);

    for (let ia = 0; ia <= angularSegs; ia++) {
      const theta = (ia / angularSegs) * Math.PI * 2;
      thetaTable[ia] = theta;
      cosTable[ia] = Math.cos(theta);
      sinTable[ia] = Math.sin(theta);
    }

    // Pass 1: Evaluate raw heights once per vertex (and wrap seam ia === angularSegs)
    for (let ir = 0; ir <= radialRings; ir++) {
      const rFrac = ir / radialRings;
      const r = rFrac * VOLCANO_OUTER_RADIUS;

      for (let ia = 0; ia <= angularSegs; ia++) {
        const vIdx = ir * stride + ia;
        if (ia === angularSegs) {
          rawHeights[vIdx] = rawHeights[ir * stride];
          positions[vIdx * 3] = positions[ir * stride * 3];
          positions[vIdx * 3 + 1] = positions[ir * stride * 3 + 1];
          positions[vIdx * 3 + 2] = positions[ir * stride * 3 + 2];
          continue;
        }
        const theta = thetaTable[ia];
        const lx = cosTable[ia] * r;
        const lz = sinTable[ia] * r;
        const wx = VOLCANO_X + lx;
        const wz = VOLCANO_Z + lz;

        const rawY = this.noise.getHeight(wx, wz, true);
        rawHeights[vIdx] = rawY;

        const lavaCh = this.noise.getVolcanoLavaChannelWeight(lx, lz, r, theta);
        const chunkOverlapOffset =
          r >= VOLCANO_RIM_RADIUS - 3.0
            ? -1.15 - 0.45 * rFrac - lavaCh * 1.25
            : -0.95;

        const idx = vIdx * 3;
        positions[idx] = wx;
        positions[idx + 1] = rawY + chunkOverlapOffset;
        positions[idx + 2] = wz;
      }
    }

    // Pass 2: Compute analytical normals from grid neighbors (0 extra getHeight calls) + surface colors
    const dr = VOLCANO_OUTER_RADIUS / radialRings;
    const dTheta = (Math.PI * 2) / angularSegs;

    for (let ir = 0; ir <= radialRings; ir++) {
      const r = (ir / radialRings) * VOLCANO_OUTER_RADIUS;
      const irPrev = Math.max(0, ir - 1);
      const irNext = Math.min(radialRings, ir + 1);
      const radialSpan = Math.max(1e-3, (irNext - irPrev) * dr);

      for (let ia = 0; ia <= angularSegs; ia++) {
        const vIdx = ir * stride + ia;
        const idx = vIdx * 3;
        if (ia === angularSegs) {
          const firstIdx = ir * stride * 3;
          normals[idx] = normals[firstIdx];
          normals[idx + 1] = normals[firstIdx + 1];
          normals[idx + 2] = normals[firstIdx + 2];
          colors[idx] = colors[firstIdx];
          colors[idx + 1] = colors[firstIdx + 1];
          colors[idx + 2] = colors[firstIdx + 2];
          continue;
        }

        if (ir === 0) {
          tempNormal.set(0, 1, 0);
        } else {
          const iaPrev = (ia - 1 + angularSegs) % angularSegs;
          const iaNext = (ia + 1) % angularSegs;
          const dhdr =
            (rawHeights[irNext * stride + ia] - rawHeights[irPrev * stride + ia]) / radialSpan;
          const dhdTheta =
            (rawHeights[ir * stride + iaNext] - rawHeights[ir * stride + iaPrev]) /
            (2.0 * dTheta * r);

          const cosA = cosTable[ia];
          const sinA = sinTable[ia];
          const dhdx = dhdr * cosA - dhdTheta * sinA;
          const dhdz = dhdr * sinA + dhdTheta * cosA;
          tempNormal.set(-dhdx, 1.0, -dhdz).normalize();
        }

        const wx = positions[idx];
        const wz = positions[idx + 2];
        const rawY = rawHeights[vIdx];
        this.noise.getSurfaceColor(wx, rawY, wz, tempNormal, tempColor, 0, 0.5, 0);

        normals[idx] = tempNormal.x;
        normals[idx + 1] = tempNormal.y;
        normals[idx + 2] = tempNormal.z;

        colors[idx] = tempColor.r;
        colors[idx + 1] = tempColor.g;
        colors[idx + 2] = tempColor.b;
      }
    }

    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  /**
   * Builds the churning molten magma lake inside the caldera (at Y = VOLCANO_LAVA_LAKE_Y)
   * plus 4 glowing radial magma rivers flowing down the mountain's flanks and the fiery
   * caldera sky-glow dome that illuminates the crater and smoke base from afar.
   */
  private buildMoltenLavaAndGlow(): void {
    const mergedLavaGeo = this.createMoltenLavaGeometry();

    this.lavaMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      fog: false,
    });

    this.lavaSurfaceMesh = new THREE.Mesh(mergedLavaGeo, this.lavaMat);
    this.lavaSurfaceMesh.frustumCulled = true;
    this.lavaSurfaceMesh.matrixAutoUpdate = false;
    this.group.add(this.lavaSurfaceMesh);

    // 3. Fiery Caldera Sky-Glow Crown (double-layered additive glow beacon visible from far away)
    const outerGlowGeo = new THREE.SphereGeometry(56.0, 20, 14);
    outerGlowGeo.deleteAttribute('normal');
    outerGlowGeo.deleteAttribute('uv');
    outerGlowGeo.scale(1.15, 0.78, 1.15);
    outerGlowGeo.computeBoundingSphere();
    this.craterGlowOuterMat = new THREE.MeshBasicMaterial({
      color: 0xff3b00,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    this.craterGlowOuterMesh = new THREE.Mesh(outerGlowGeo, this.craterGlowOuterMat);
    this.craterGlowOuterMesh.position.set(VOLCANO_X, VOLCANO_PEAK_HEIGHT + 12.0, VOLCANO_Z);
    this.craterGlowOuterMesh.frustumCulled = true;
    this.craterGlowOuterMesh.matrixAutoUpdate = false;
    this.craterGlowOuterMesh.updateMatrix();
    this.craterGlowOuterMesh.renderOrder = 10;
    this.group.add(this.craterGlowOuterMesh);

    const innerGlowGeo = new THREE.SphereGeometry(32.0, 18, 12);
    innerGlowGeo.deleteAttribute('normal');
    innerGlowGeo.deleteAttribute('uv');
    innerGlowGeo.scale(1.0, 0.92, 1.0);
    innerGlowGeo.computeBoundingSphere();
    this.craterGlowInnerMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    this.craterGlowInnerMesh = new THREE.Mesh(innerGlowGeo, this.craterGlowInnerMat);
    this.craterGlowInnerMesh.position.set(VOLCANO_X, VOLCANO_PEAK_HEIGHT + 4.0, VOLCANO_Z);
    this.craterGlowInnerMesh.frustumCulled = true;
    this.craterGlowInnerMesh.matrixAutoUpdate = false;
    this.craterGlowInnerMesh.updateMatrix();
    this.craterGlowInnerMesh.renderOrder = 11;
    this.group.add(this.craterGlowInnerMesh);
  }

  private createMoltenLavaGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];

    // 1. Molten Caldera Magma Lake disc (radius = 35m at Y = VOLCANO_LAVA_LAKE_Y)
    const lakeSegs = 36;
    const lakeRings = 10;
    const lakeGeo = new THREE.RingGeometry(0.01, VOLCANO_CRATER_RADIUS + 4.5, lakeSegs, lakeRings);
    lakeGeo.deleteAttribute('normal');
    lakeGeo.deleteAttribute('uv');
    lakeGeo.rotateX(-Math.PI / 2);
    lakeGeo.translate(VOLCANO_X, VOLCANO_LAVA_LAKE_Y, VOLCANO_Z);

    const lPos = lakeGeo.attributes.position as THREE.BufferAttribute;
    const lColors = new Float32Array(lPos.count * 3);
    const cCore = new THREE.Color(0xfff078);
    const cMid = new THREE.Color(0xff6200);
    const cRim = new THREE.Color(0xb81d00);

    for (let i = 0; i < lPos.count; i++) {
      const dx = lPos.getX(i) - VOLCANO_X;
      const dz = lPos.getZ(i) - VOLCANO_Z;
      const r = Math.hypot(dx, dz);
      const t = THREE.MathUtils.clamp(r / (VOLCANO_CRATER_RADIUS + 4.0), 0, 1);
      // Concentric convection rings of white-hot magma and darker cooling crust
      const ringWave = 0.5 + 0.5 * Math.sin(r * 0.55 + Math.atan2(dz, dx) * 3.0);
      tempColor.copy(cCore).lerp(cMid, Math.min(1, t * 1.15));
      tempColor.lerp(cRim, t * t * (0.85 - ringWave * 0.35));
      lColors[i * 3] = tempColor.r;
      lColors[i * 3 + 1] = tempColor.g;
      lColors[i * 3 + 2] = tempColor.b;
    }
    lakeGeo.setAttribute('color', new THREE.BufferAttribute(lColors, 3));
    parts.push(lakeGeo);

    // 2. Four glowing radial magma river ribbons on the upper flanks (3 cross-section vertices per step)
    for (let k = 0; k < 4; k++) {
      const baseAngle = (k * Math.PI) / 2;
      const lenSegs = 26;
      const rStart = VOLCANO_RIM_RADIUS - 1.5;
      const rEnd = 144.0;
      const ribbonVerts = (lenSegs + 1) * 3;
      const rPos = new Float32Array(ribbonVerts * 3);
      const rCol = new Float32Array(ribbonVerts * 3);
      const rIdx: number[] = [];

      for (let s = 0; s <= lenSegs; s++) {
        const u = s / lenSegs;
        const r = THREE.MathUtils.lerp(rStart, rEnd, u);
        const centerAngle = solveLavaChannelAngle(baseAngle, r);
        const halfWidth = (1.0 - u * 0.72) * 2.8;
        const perpX = -Math.sin(centerAngle);
        const perpZ = Math.cos(centerAngle);
        const cx = VOLCANO_X + Math.cos(centerAngle) * r;
        const cz = VOLCANO_Z + Math.sin(centerAngle) * r;

        for (let side = 0; side < 3; side++) {
          const sideT = side - 1; // -1 (left bank), 0 (channel centerline), +1 (right bank)
          const offset = sideT * halfWidth;
          const wx = cx + perpX * offset;
          const wz = cz + perpZ * offset;
          // Sit slightly above terrain channel bed so glowing lava river shines from afar
          const lift = (side === 1 ? 0.34 : 0.18) * (1.0 - u * 0.55);
          const wy = this.noise.getHeight(wx, wz, true) + lift;
          const vIdx = (s * 3 + side) * 3;
          rPos[vIdx] = wx;
          rPos[vIdx + 1] = wy;
          rPos[vIdx + 2] = wz;

          const edgeCool = side === 1 ? 0.0 : 0.22;
          tempColor
            .copy(cCore)
            .lerp(cMid, Math.min(1, u * 0.75 + edgeCool))
            .lerp(cRim, Math.min(1, u * u + edgeCool * 0.5));
          rCol[vIdx] = tempColor.r;
          rCol[vIdx + 1] = tempColor.g;
          rCol[vIdx + 2] = tempColor.b;
        }

        if (s < lenSegs) {
          const i0 = s * 3;
          rIdx.push(i0, i0 + 1, i0 + 3);
          rIdx.push(i0 + 1, i0 + 4, i0 + 3);
          rIdx.push(i0 + 1, i0 + 2, i0 + 4);
          rIdx.push(i0 + 2, i0 + 5, i0 + 4);
        }
      }

      const ribGeo = new THREE.BufferGeometry();
      ribGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
      ribGeo.setAttribute('color', new THREE.BufferAttribute(rCol, 3));
      ribGeo.setIndex(rIdx);
      parts.push(ribGeo);
    }

    const mergedLavaGeo = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    mergedLavaGeo.computeBoundingSphere();
    return mergedLavaGeo;
  }

  /**
   * Builds 40 instanced roaring flame tongues leaping from the caldera mouth, inner lava lake,
   * and caldera rim vents. Uses `fog: false` and `AdditiveBlending` so the roaring flames glow
   * brightly on the horizon from anywhere in the world.
   */
  private buildRoaringFlames(): void {
    const flameGeo = createFlameTongueGeometry();
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });

    this.flameInstancedMesh = new THREE.InstancedMesh(
      flameGeo,
      flameMat,
      FLAME_TONGUE_COUNT
    );
    this.flameInstancedMesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(VOLCANO_X, VOLCANO_PEAK_HEIGHT + 12.0, VOLCANO_Z),
      95.0
    );
    this.flameInstancedMesh.frustumCulled = true;
    this.flameInstancedMesh.matrixAutoUpdate = false;
    this.flameInstancedMesh.renderOrder = 13;

    this.populateFlameSeeds();
    this.group.add(this.flameInstancedMesh);
  }

  private populateFlameSeeds(): void {
    this.flameSeeds.length = 0;
    for (let i = 0; i < FLAME_TONGUE_COUNT; i++) {
      const golden = i * 2.399963229728653;
      if (i < 14) {
        // Tier 0: Colossal Summit Flame Crown soaring 18m-38m above the 118m caldera rim (visible from afar!)
        const r = (i / 14) * 22.0;
        const bx = VOLCANO_X + Math.cos(golden) * r;
        const bz = VOLCANO_Z + Math.sin(golden) * r;
        const by = VOLCANO_PEAK_HEIGHT - 8.0 + (1.0 - r / 24.0) * 6.0;
        this.flameSeeds.push({
          tier: 0,
          baseX: bx,
          baseY: by,
          baseZ: bz,
          baseRadius: 5.2 + (i % 4) * 1.4,
          baseHeight: 28.0 + (i % 5) * 4.8,
          phase: i * 0.77,
          speed: 3.2 + (i % 4) * 0.55,
          yaw: golden,
        });
      } else if (i < 28) {
        // Tier 1: Inner Magma Cauldron Fire Jets dancing across the molten lava lake
        const idx = i - 14;
        const r = 4.0 + Math.sqrt((idx + 0.5) / 14) * (VOLCANO_CRATER_RADIUS - 3.0);
        const bx = VOLCANO_X + Math.cos(golden) * r;
        const bz = VOLCANO_Z + Math.sin(golden) * r;
        this.flameSeeds.push({
          tier: 1,
          baseX: bx,
          baseY: VOLCANO_LAVA_LAKE_Y - 0.5,
          baseZ: bz,
          baseRadius: 3.4 + (idx % 3) * 1.1,
          baseHeight: 16.0 + (idx % 4) * 4.2,
          phase: i * 1.13,
          speed: 4.1 + (idx % 3) * 0.65,
          yaw: golden,
        });
      } else {
        // Tier 2: Caldera Rim & Upper Lava Channel Fissure Flames
        const idx = i - 28;
        const isChannelVent = idx < 4;
        const r = isChannelVent ? 54.0 : VOLCANO_RIM_RADIUS - 2.0 + (idx % 3) * 2.2;
        const ang = isChannelVent
          ? solveLavaChannelAngle((idx * Math.PI) / 2, r)
          : (idx / 12) * Math.PI * 2;
        const bx = VOLCANO_X + Math.cos(ang) * r;
        const bz = VOLCANO_Z + Math.sin(ang) * r;
        const by = this.noise.getHeight(bx, bz, true) - 0.8;
        this.flameSeeds.push({
          tier: 2,
          baseX: bx,
          baseY: by,
          baseZ: bz,
          baseRadius: isChannelVent ? 3.2 : 2.6,
          baseHeight: isChannelVent ? 14.5 : 11.5 + (idx % 3) * 2.5,
          phase: i * 0.91,
          speed: 4.6 + (idx % 3) * 0.7,
          yaw: ang,
        });
      }
    }
  }

  /**
   * Builds the colossal 560m-high Ominous Dark Smoke Plume rising from the caldera mouth
   * and drifting into a brooding storm-ash anvil cloud high in the sky.
   * Uses `fog: false` so the dark, ominous smoke column is visible from far, far away across the map.
   */
  private buildOminousSmokePlume(): void {
    const puffGeo = createOminousSmokePuffGeometry();
    const puffMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      fog: false,
    });

    this.smokeInstancedMesh = new THREE.InstancedMesh(
      puffGeo,
      puffMat,
      SMOKE_PUFF_COUNT
    );
    this.smokeInstancedMesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(VOLCANO_X + 42.0, VOLCANO_PEAK_HEIGHT + 220.0, VOLCANO_Z - 26.0),
      355.0
    );
    this.smokeInstancedMesh.frustumCulled = true;
    this.smokeInstancedMesh.matrixAutoUpdate = false;
    this.smokeInstancedMesh.renderOrder = 12;
    this.smokeInstancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(SMOKE_PUFF_COUNT * 3),
      3
    );

    for (let i = 0; i < SMOKE_PUFF_COUNT; i++) {
      this.smokeSeeds.push({
        basePhase: i / SMOKE_PUFF_COUNT,
        speed: 0.038, // Uniform vertical ascent speed keeps instances ordered from throat to anvil
        angleOffset: i * 2.399963229728653,
        radiusJitter: 0.65 + ((i * 17) % 11) * 0.06,
        scaleMult: 0.88 + ((i * 23) % 9) * 0.04,
        rotSpeed: (i % 2 === 0 ? 1 : -1) * (0.25 + (i % 4) * 0.08),
        lobeTint: ((i * 13) % 7) / 7.0,
      });
    }

    this.group.add(this.smokeInstancedMesh);
  }

  /**
   * Builds 120 glowing orange-gold volcanic embers spiraling upward out of the caldera.
   */
  private buildRisingEmbers(): void {
    this.emberPositions = new Float32Array(EMBER_COUNT * 3);
    this.emberPhases = new Float32Array(EMBER_COUNT * 4); // [basePhase, radius, angle, speed]
    const emberColors = new Float32Array(EMBER_COUNT * 3);

    for (let i = 0; i < EMBER_COUNT; i++) {
      const phase = i / EMBER_COUNT + (i % 7) * 0.013;
      const radius = 3.0 + ((i * 29) % 38);
      const angle = i * 2.399963229728653;
      const speed = 0.09 + (i % 5) * 0.018;
      this.emberPhases[i * 4] = phase % 1.0;
      this.emberPhases[i * 4 + 1] = radius;
      this.emberPhases[i * 4 + 2] = angle;
      this.emberPhases[i * 4 + 3] = speed;

      const hot = (i % 5) / 4.0;
      emberColors[i * 3] = 1.0;
      emberColors[i * 3 + 1] = 0.38 + hot * 0.52;
      emberColors[i * 3 + 2] = 0.05 + hot * 0.25;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.emberPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(emberColors, 3));
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(VOLCANO_X + 9.0, VOLCANO_LAVA_LAKE_Y + 84.0, VOLCANO_Z - 5.0),
      135.0
    );

    const mat = new THREE.PointsMaterial({
      size: 2.6,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    this.emberPoints = new THREE.Points(geo, mat);
    this.emberPoints.frustumCulled = true;
    this.emberPoints.matrixAutoUpdate = false;
    this.emberPoints.renderOrder = 14;
    this.group.add(this.emberPoints);
  }

  /**
   * Rebuilds the distant cone mesh, flank lava river ribbons, and Tier-2 fissure flame heights
   * when world seed or terrain noise parameters change.
   */
  public rebuildGeometry(): void {
    this.distantConeMat.wireframe = this.config.wireframe;
    this.populateDistantConeVertices();
    const oldLavaGeo = this.lavaSurfaceMesh.geometry;
    this.lavaSurfaceMesh.geometry = this.createMoltenLavaGeometry();
    oldLavaGeo.dispose();
    this.populateFlameSeeds();
  }

  public setWireframe(wireframe: boolean): void {
    this.distantConeMat.wireframe = wireframe;
  }

  /**
   * Allows the player to cross the caldera rim into the crater (where going into the bottom
   * of the volcano causes immediate death). Kept as a no-op hook for backwards compatibility.
   */
  public resolveCalderaRimCollision(_pos: THREE.Vector3): void {
    // Intentionally unblocked so entering the bottom of the volcano triggers immediate death
  }

  public getDistanceToVolcano(playerPos: THREE.Vector3): number {
    return Math.hypot(playerPos.x - VOLCANO_X, playerPos.z - VOLCANO_Z);
  }

  public isDefeatPending(): boolean {
    return this.defeatRestorePending;
  }

  public isPlayerInHeatZone(x: number, z: number): boolean {
    const dx = x - VOLCANO_X;
    const dz = z - VOLCANO_Z;
    return dx * dx + dz * dz < VOLCANO_HEAT_HAZARD_RADIUS * VOLCANO_HEAT_HAZARD_RADIUS;
  }

  /**
   * Checks whether the player is in the convective thermal updraft zone around Mount Doomforge's rim/upper slopes.
   */
  public isPlayerInUpdraftZone(x: number, z: number): boolean {
    const dx = x - VOLCANO_X;
    const dz = z - VOLCANO_Z;
    const dSq = dx * dx + dz * dz;
    return dSq >= 40.0 * 40.0 && dSq <= 96.0 * 96.0;
  }

  public pauseVolcanoSfx(): void {
    if (!this.rumbleAudio.paused) {
      this.rumbleAudio.pause();
    }
    if (this.rumbleBlobUrl && !this.rumblePlayPending && this.rumbleAudio.src !== this.rumbleBlobUrl) {
      this.rumbleAudio.src = this.rumbleBlobUrl;
      this.rumbleAudio.load();
    }
    if (!this.lavaVentsAudio.paused) {
      this.lavaVentsAudio.pause();
    }
    if (this.ventsBlobUrl && !this.ventsPlayPending && this.lavaVentsAudio.src !== this.ventsBlobUrl) {
      this.lavaVentsAudio.src = this.ventsBlobUrl;
      this.lavaVentsAudio.load();
    }
    this.lastRumbleVol = -1;
    this.lastRumbleRate = -1;
    this.lastVentsVol = -1;
    this.lastVentsRate = -1;
  }

  private clearActiveToast(): void {
    if (this.activeToastFadeTimer) {
      window.clearTimeout(this.activeToastFadeTimer);
      this.activeToastFadeTimer = 0;
    }
    if (this.activeToastRemoveTimer) {
      window.clearTimeout(this.activeToastRemoveTimer);
      this.activeToastRemoveTimer = 0;
    }
    if (this.activeToastEl) {
      this.activeToastEl.remove();
      this.activeToastEl = null;
    }
  }

  public resetHazardState(): void {
    this.heatExposureTime = 0;
    this.scorchBurstAccum = 0;
    this.defeatRestorePending = false;
    this.defeatRestoreTimer = 0;
    this.rimWarnCooldown = 0;
  }

  /**
   * Synchronizes VolcanoManager state when loading a save or respawning without
   * falsely re-triggering the approach toast, duplicate waypoint unlock, or BGM hiccup.
   */
  public restoreState(rimWaypointUnlocked: boolean, playerPos?: THREE.Vector3): void {
    this.resetHazardState();
    this.hasDiscoveredRimWaypoint = rimWaypointUnlocked;
    if (playerPos) {
      const dist = this.getDistanceToVolcano(playerPos);
      const nearVolcano = dist <= 235.0;
      this.hasShownApproachToast = nearVolcano || rimWaypointUnlocked;
      this.isNearVolcanoTuneActive = nearVolcano;
      const tuneIntensity = nearVolcano
        ? THREE.MathUtils.clamp(1.0 - (dist - 46.0) / (235.0 - 46.0), 0, 1)
        : 0;
      this.bgm.setVolcanoProximity(nearVolcano, tuneIntensity);
      if (!nearVolcano) {
        this.pauseVolcanoSfx();
      }
    } else {
      this.hasShownApproachToast = rimWaypointUnlocked;
      this.isNearVolcanoTuneActive = false;
      this.bgm.setVolcanoProximity(false, 0);
      this.pauseVolcanoSfx();
    }
  }

  public reset(): void {
    this.hasShownApproachToast = false;
    this.hasDiscoveredRimWaypoint = false;
    this.isNearVolcanoTuneActive = false;
    this.resetHazardState();
    this.clearActiveToast();
    this.pauseVolcanoSfx();
    this.bgm.setVolcanoProximity(false, 0);
  }

  public dispose(): void {
    this.clearActiveToast();
    this.pauseVolcanoSfx();
    window.removeEventListener('keydown', this.unlockAudioHandler);
    window.removeEventListener('pointerdown', this.unlockAudioHandler);
    if (this.rumbleBlobUrl) {
      URL.revokeObjectURL(this.rumbleBlobUrl);
      this.rumbleBlobUrl = null;
    }
    if (this.ventsBlobUrl) {
      URL.revokeObjectURL(this.ventsBlobUrl);
      this.ventsBlobUrl = null;
    }
    this.distantConeMesh.geometry.dispose();
    this.distantConeMat.dispose();
    this.lavaSurfaceMesh.geometry.dispose();
    this.lavaMat.dispose();
    this.craterGlowOuterMesh.geometry.dispose();
    this.craterGlowOuterMat.dispose();
    this.craterGlowInnerMesh.geometry.dispose();
    this.craterGlowInnerMat.dispose();
    this.flameInstancedMesh.geometry.dispose();
    (this.flameInstancedMesh.material as THREE.Material).dispose();
    this.smokeInstancedMesh.geometry.dispose();
    (this.smokeInstancedMesh.material as THREE.Material).dispose();
    this.emberPoints.geometry.dispose();
    (this.emberPoints.material as THREE.Material).dispose();
  }

  public update(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    insideInterior: boolean,
    isFreeCamera = false
  ): void {
    if (this.rimWarnCooldown > 0) {
      this.rimWarnCooldown = Math.max(0, this.rimWarnCooldown - dt);
    }

    const dist = this.getDistanceToVolcano(playerPos);

    if (!insideInterior && this.group.visible) {
      // 1. Animate pulsing Caldera Sky-Glow & Molten Magma Lake brightness
      const pulse1 = Math.sin(elapsedTime * 2.6) * 0.5 + 0.5;
      const pulse2 = Math.sin(elapsedTime * 6.1 + 1.3) * 0.5 + 0.5;
      const glowScale = 0.96 + pulse1 * 0.09 + pulse2 * 0.04;
      this.craterGlowOuterMesh.scale.setScalar(glowScale);
      this.craterGlowOuterMesh.updateMatrix();
      this.craterGlowOuterMat.opacity = 0.22 + pulse1 * 0.09 + pulse2 * 0.04;
      this.craterGlowInnerMesh.scale.setScalar(0.95 + pulse2 * 0.1);
      this.craterGlowInnerMesh.updateMatrix();
      this.craterGlowInnerMat.opacity = 0.36 + pulse1 * 0.1 + pulse2 * 0.06;

      const lavaBright = 0.88 + pulse1 * 0.14 + pulse2 * 0.08;
      this.lavaMat.color.setRGB(lavaBright, lavaBright * 0.94, lavaBright * 0.85);

      // 2. Animate the 40 Roaring Flame Tongues
      for (let i = 0; i < FLAME_TONGUE_COUNT; i++) {
        const f = this.flameSeeds[i];
        const t = elapsedTime * f.speed + f.phase;
        const waveA = Math.sin(t);
        const waveB = Math.cos(t * 1.63 + 0.7);
        const heightScale = f.baseHeight * (0.76 + 0.28 * (waveA * 0.5 + 0.5) + 0.12 * waveB);
        const radiusScale = f.baseRadius * (0.85 + 0.18 * waveB);

        const leanX = Math.sin(t * 0.85) * 0.14;
        const leanZ = Math.cos(t * 0.75) * 0.14;

        tempDummy.position.set(f.baseX, f.baseY, f.baseZ);
        tempDummy.rotation.set(leanX, f.yaw + elapsedTime * 0.35 * (i % 2 === 0 ? 1 : -1), leanZ);
        tempDummy.scale.set(radiusScale, heightScale, radiusScale);
        tempDummy.updateMatrix();
        this.flameInstancedMesh.setMatrixAt(i, tempDummy.matrix);
      }
      this.flameInstancedMesh.instanceMatrix.needsUpdate = true;

      // 3. Animate the 76-puff Colossal Ominous Dark Smoke Plume rising to Y = 560m
      const windDirX = 0.62;
      const windDirZ = -0.38;
      for (let i = 0; i < SMOKE_PUFF_COUNT; i++) {
        const s = this.smokeSeeds[i];
        const p = (s.basePhase + elapsedTime * s.speed) % 1.0; // [0 = crater throat, 1 = high sky anvil]
        const sqrtP = Math.sqrt(p);

        // Rise from Y = 104m inside the caldera rim up to Y = 560m in the sky
        const y = VOLCANO_PEAK_HEIGHT - 14.0 + p * 456.0;

        // Billowing spiral radius + high-altitude downwind anvil spread (fast algebraic pow replacements)
        const p082 = p * (0.35 + 0.65 * sqrtP);
        const anvilExcess = Math.max(0, p - 0.65);
        const anvilSpread = anvilExcess * Math.sqrt(anvilExcess) * 110.0;
        const plumeConeRadius = (10.0 + p082 * 52.0 + anvilSpread) * s.radiusJitter;
        const swirlAngle = s.angleOffset + elapsedTime * s.rotSpeed + p * 2.4;
        const windDrift = p * sqrtP * 135.0;

        const wx = VOLCANO_X + Math.cos(swirlAngle) * plumeConeRadius + windDirX * windDrift;
        const wz = VOLCANO_Z + Math.sin(swirlAngle) * plumeConeRadius + windDirZ * windDrift;

        // Puff grows from ~13m at the throat to ~68m billowing storm-ash clouds aloft
        const puffScale = (12.5 + Math.sin(p * Math.PI * 0.88) * 44.0 + p * 18.0) * s.scaleMult;
        const squashY = p > 0.72 ? 0.68 : 0.86;

        tempDummy.position.set(wx, y, wz);
        tempDummy.rotation.set(
          Math.sin(swirlAngle * 0.5) * 0.25,
          swirlAngle,
          Math.cos(swirlAngle * 0.5) * 0.25
        );
        tempDummy.scale.set(puffScale, puffScale * squashY, puffScale);
        tempDummy.updateMatrix();
        this.smokeInstancedMesh.setMatrixAt(i, tempDummy.matrix);

        // Ominous color gradient: fiery magma under-glow at the crater base -> brooding pitch-black ash aloft
        if (p < 0.14) {
          const t = p / 0.14;
          tempColor.copy(COL_SMOKE_FIRE_BASE).lerp(COL_SMOKE_EMBER_MID, t);
        } else if (p < 0.34) {
          const t = (p - 0.14) / 0.2;
          tempColor.copy(COL_SMOKE_EMBER_MID).lerp(COL_SMOKE_OMINOUS_CORE, t);
        } else {
          const t = (p - 0.34) / 0.66;
          tempColor
            .copy(COL_SMOKE_OMINOUS_CORE)
            .lerp(COL_SMOKE_OMINOUS_TOP, t * 0.7 + s.lobeTint * 0.3);
        }
        this.smokeInstancedMesh.setColorAt(i, tempColor);
      }
      this.smokeInstancedMesh.instanceMatrix.needsUpdate = true;
      if (this.smokeInstancedMesh.instanceColor) {
        this.smokeInstancedMesh.instanceColor.needsUpdate = true;
      }

      // 4. Animate the 120 Rising Volcanic Embers (culled beyond 340m where 2.6px embers are sub-pixel)
      const showEmbers = dist <= 340.0;
      this.emberPoints.visible = showEmbers;
      if (showEmbers) {
        for (let i = 0; i < EMBER_COUNT; i++) {
          const basePhase = this.emberPhases[i * 4];
          const baseR = this.emberPhases[i * 4 + 1];
          const baseAng = this.emberPhases[i * 4 + 2];
          const spd = this.emberPhases[i * 4 + 3];

          const p = (basePhase + elapsedTime * spd) % 1.0;
          const ang = baseAng + elapsedTime * 0.85 + p * 4.2;
          const r = baseR * (0.55 + p * 1.35);
          this.emberPositions[i * 3] = VOLCANO_X + Math.cos(ang) * r + windDirX * p * 28.0;
          this.emberPositions[i * 3 + 1] = VOLCANO_LAVA_LAKE_Y + 2.0 + p * 165.0;
          this.emberPositions[i * 3 + 2] = VOLCANO_Z + Math.sin(ang) * r + windDirZ * p * 28.0;
        }
        (this.emberPoints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
    }

    // 5. Update ElevenLabs Volcanic Activity Proximity Audio, Volcano Omen Tune & Lethal Volcanic Heat
    this.updateVolcanoAudioAndTune(dist, playerPos.y, insideInterior);
    this.updateVolcanoHeatAndCraterHazard(dt, playerPos, dist, insideInterior || isFreeCamera);
  }

  /**
   * Enforces Mount Doomforge's lethal volcanic hazards:
   * 1. Going into the bottom of the volcano (`dist <= VOLCANO_CRATER_RADIUS + 3.5` or descending into the crater magma bowl)
   *    kills the character immediately (`energy = 0`, `health = 0`).
   * 2. Getting too close to the volcano (`dist < VOLCANO_HEAT_HAZARD_RADIUS = 132m`) drains the character's Strength (`⚡`).
   *    Staying too close for too long rapidly burns away Health (`❤️`) until the character quickly dies.
   */
  private updateVolcanoHeatAndCraterHazard(
    dt: number,
    playerPos: THREE.Vector3,
    dist: number,
    suppressHazard: boolean
  ): void {
    if (this.defeatRestorePending) {
      // Keep health/energy pinned at 0 while awaiting respawn so passive regen doesn't raise HUD HP
      this.onApplyVolcanicHazard?.(0, 0, true);
      this.defeatRestoreTimer -= dt;
      if (this.defeatRestoreTimer <= 0) {
        this.defeatRestorePending = false;
        this.heatExposureTime = 0;
        this.onPlayerDiedInVolcano?.(this.pendingDefeatReason);
      }
      return;
    }

    if (suppressHazard) {
      this.heatExposureTime = Math.max(0, this.heatExposureTime - dt * 3.0);
      return;
    }

    // A) Check if the character entered the bottom of the volcano (molten caldera crater floor) -> IMMEDIATE DEATH
    const inCraterBottom =
      dist <= VOLCANO_CRATER_RADIUS + 3.5 ||
      (dist < VOLCANO_RIM_RADIUS && playerPos.y <= VOLCANO_LAVA_LAKE_Y + 6.5);

    if (inCraterBottom) {
      this.onApplyVolcanicHazard?.(9999, 9999, true);
      this.onSpawnScorchBurst?.(playerPos.x, playerPos.y + 0.8, playerPos.z, 28);
      this.defeatRestorePending = true;
      this.defeatRestoreTimer = 1.15;
      this.pendingDefeatReason = 'bottom';
      this.showToast(
        '💀 CONSUMED BY MOUNT DOOMFORGE! You plunged into the molten bottom of the volcano and died immediately!',
        true
      );
      return;
    }

    // B) Check if the character is too close to the volcano (`dist < 132m`) -> Lose Strength, and if staying too long, quickly die
    if (dist < VOLCANO_HEAT_HAZARD_RADIUS) {
      if (this.isHeatImmuneFn?.()) {
        this.heatExposureTime = 0;
        return;
      }
      this.heatExposureTime += dt;

      const proximity = THREE.MathUtils.clamp(
        1.0 - (dist - VOLCANO_RIM_RADIUS) / (VOLCANO_HEAT_HAZARD_RADIUS - VOLCANO_RIM_RADIUS),
        0.15,
        1.0
      );
      const dx = playerPos.x - VOLCANO_X;
      const dz = playerPos.z - VOLCANO_Z;
      const lavaChannelW = this.noise.getVolcanoLavaChannelWeight(dx, dz, dist);

      // 1. Drain Strength (`⚡`) immediately upon getting too close, accelerating with proximity & exposure time
      const strengthDrainPerSec =
        11.0 + proximity * 18.0 + this.heatExposureTime * 2.8 + lavaChannelW * 30.0;

      // 2. If staying too close too long (>= 2.8s), or on the upper crater cone (< 78m), or on a lava channel -> rapidly burn Health (`❤️`)
      let healthDrainPerSec = 0;
      if (this.heatExposureTime >= 2.8 || dist < 78.0 || lavaChannelW > 0.35) {
        healthDrainPerSec =
          18.0 +
          proximity * 28.0 +
          Math.max(0, this.heatExposureTime - 2.8) * 7.5 +
          lavaChannelW * 42.0;
      }

      const res = this.onApplyVolcanicHazard?.(
        strengthDrainPerSec * dt,
        healthDrainPerSec * dt,
        false
      );

      // If Strength has been completely drained to 0 by the volcano, apply an extra rapid health burn so the dwarf quickly dies
      if (res && !res.defeated && res.remainingEnergy <= 0.01) {
        const exhaustionBurn = (24.0 + proximity * 20.0) * dt;
        const burnRes = this.onApplyVolcanicHazard?.(0, exhaustionBurn, false);
        if (burnRes) {
          res.defeated = burnRes.defeated;
          res.remainingHealth = burnRes.remainingHealth;
        }
      }

      this.scorchBurstAccum += dt;
      if (this.scorchBurstAccum >= 0.35) {
        this.scorchBurstAccum = 0;
        this.onSpawnScorchBurst?.(playerPos.x, playerPos.y + 0.7, playerPos.z, 6);
      }

      if (res?.defeated) {
        this.defeatRestorePending = true;
        this.defeatRestoreTimer = 1.15;
        this.pendingDefeatReason = 'heat';
        this.onSpawnScorchBurst?.(playerPos.x, playerPos.y + 0.8, playerPos.z, 22);
        this.showToast(
          '💀 OVERCOME BY VOLCANIC HEAT! You stayed too close to Mount Doomforge for too long and perished!',
          true
        );
        return;
      }

      if (this.rimWarnCooldown <= 0 && res) {
        this.rimWarnCooldown = 3.2;
        if (healthDrainPerSec > 0 || res.remainingEnergy <= 0.5) {
          this.showToast(
            `💀 LETHAL VOLCANO HEAT! Staying too close is burning your ❤️ Health (${Math.ceil(res.remainingHealth)} HP, ${Math.ceil(res.remainingEnergy)}⚡) — Retreat immediately!`,
            true
          );
        } else {
          this.showToast(
            `🔥 TOO CLOSE TO MOUNT DOOMFORGE! Losing ⚡ Strength (${Math.ceil(res.remainingEnergy)}⚡ left) — Turn back or you will quickly die!`,
            false
          );
        }
      }
    } else {
      // Cool down exposure timer when retreating to safe distance (>= 132m)
      this.heatExposureTime = Math.max(0, this.heatExposureTime - dt * 2.2);
      this.scorchBurstAccum = 0;
    }
  }

  private updateVolcanoAudioAndTune(
    dist: number,
    _playerY: number,
    insideInterior: boolean
  ): void {
    // A) Switch background music to the ElevenLabs Volcano Omen tune as one approaches Mount Doomforge
    // Enters at dist <= 235m (outer volcano foothills), exits with hysteresis at dist >= 252m
    const wantVolcanoTune =
      !insideInterior && (this.isNearVolcanoTuneActive ? dist < 252.0 : dist <= 235.0);
    const tuneIntensity = wantVolcanoTune
      ? THREE.MathUtils.clamp(1.0 - (dist - 46.0) / (235.0 - 46.0), 0, 1)
      : 0;

    if (wantVolcanoTune && !this.hasShownApproachToast) {
      this.hasShownApproachToast = true;
      this.showToast(
        '🌋 Approaching Mount Doomforge! You hear the volcano’s deep magma roar and the Caldera Omen tune rises...',
        true
      );
    }

    this.isNearVolcanoTuneActive = wantVolcanoTune;
    this.bgm.setVolcanoProximity(wantVolcanoTune, tuneIntensity);

    // Unlock safe Mount Doomforge Overlook Fast-Travel Waypoint when approaching the volcano foothills
    if (!insideInterior && !this.hasDiscoveredRimWaypoint && dist <= 168.0) {
      this.hasDiscoveredRimWaypoint = true;
      const overlookX = VOLCANO_X - 91.0; // dist ≈ 152m (safely outside the 132m lethal heat zone)
      const overlookZ = VOLCANO_Z - 122.0;
      const overlookY = this.noise.getHeight(overlookX, overlookZ);
      this.onDiscoverCalderaRim?.({
        id: 'wt_volcano_rim',
        name: '🌋 Mount Doomforge Overlook',
        x: Math.round(overlookX),
        y: Math.round(overlookY),
        z: Math.round(overlookZ),
      });
    }

    // B) Scale ElevenLabs Volcanic Activity SFX (deep tectonic rumble + roaring flames/lava vents)
    const isMuted = this.bgm.isMutedNow() || this.bgm.getVolume() <= 0.001;
    const maxRumbleDist = 395.0; // Audible from far away as you walk toward the volcano
    const maxVentsDist = 245.0;  // Roaring flames & bubbling lava audible across the volcano slopes

    if (!this.audioUnlocked || isMuted || insideInterior || dist > maxRumbleDist) {
      this.pauseVolcanoSfx();
      return;
    }

    const masterScale = Math.min(1.0, this.bgm.getVolume() / 0.45);

    // Layer 1: Deep Tectonic Rumble & Churning Magma (`volcano_rumble_loop.mp3`)
    const pRumble = THREE.MathUtils.clamp(
      1.0 - (dist - VOLCANO_RIM_RADIUS) / (maxRumbleDist - VOLCANO_RIM_RADIUS),
      0,
      1
    );
    const rumbleVol = THREE.MathUtils.clamp(
      (0.04 + 0.88 * Math.pow(pRumble, 1.45)) * masterScale,
      0,
      0.95
    );
    const rumbleRate = THREE.MathUtils.clamp(0.84 + 0.26 * pRumble, 0.8, 1.15);
    if (Math.abs(rumbleVol - this.lastRumbleVol) > 0.003) {
      this.lastRumbleVol = rumbleVol;
      this.rumbleAudio.volume = rumbleVol;
    }
    if (Math.abs(rumbleRate - this.lastRumbleRate) > 0.006) {
      this.lastRumbleRate = rumbleRate;
      this.rumbleAudio.playbackRate = rumbleRate;
    }
    if (this.rumbleAudio.paused && !this.rumblePlayPending) {
      this.rumblePlayPending = true;
      this.rumbleAudio
        .play()
        .then(() => {
          this.rumblePlayPending = false;
        })
        .catch(() => {
          this.rumblePlayPending = false;
        });
    }

    // Layer 2: Roaring Crater Flames, Bubbling Lava & Steam Vents (`volcano_lava_vents.mp3`)
    if (dist <= maxVentsDist) {
      const pVents = THREE.MathUtils.clamp(
        1.0 - (dist - VOLCANO_RIM_RADIUS) / (maxVentsDist - VOLCANO_RIM_RADIUS),
        0,
        1
      );
      const ventsVol = THREE.MathUtils.clamp(
        (0.05 + 0.85 * Math.pow(pVents, 1.35)) * masterScale,
        0,
        0.92
      );
      const ventsRate = THREE.MathUtils.clamp(0.9 + 0.22 * pVents, 0.85, 1.15);
      if (Math.abs(ventsVol - this.lastVentsVol) > 0.003) {
        this.lastVentsVol = ventsVol;
        this.lavaVentsAudio.volume = ventsVol;
      }
      if (Math.abs(ventsRate - this.lastVentsRate) > 0.006) {
        this.lastVentsRate = ventsRate;
        this.lavaVentsAudio.playbackRate = ventsRate;
      }
      if (this.lavaVentsAudio.paused && !this.ventsPlayPending) {
        this.ventsPlayPending = true;
        this.lavaVentsAudio
          .play()
          .then(() => {
            this.ventsPlayPending = false;
          })
          .catch(() => {
            this.ventsPlayPending = false;
          });
      }
    } else if (!this.lavaVentsAudio.paused) {
      this.lavaVentsAudio.pause();
      if (this.ventsBlobUrl && !this.ventsPlayPending && this.lavaVentsAudio.src !== this.ventsBlobUrl) {
        this.lavaVentsAudio.src = this.ventsBlobUrl;
        this.lavaVentsAudio.load();
      }
      this.lastVentsVol = -1;
      this.lastVentsRate = -1;
    }
  }

  private showToast(message: string, highlight: boolean): void {
    if (!this.toastContainer) return;
    if (this.activeToastFadeTimer) {
      window.clearTimeout(this.activeToastFadeTimer);
      this.activeToastFadeTimer = 0;
    }
    if (this.activeToastRemoveTimer) {
      window.clearTimeout(this.activeToastRemoveTimer);
      this.activeToastRemoveTimer = 0;
    }

    let toast = this.activeToastEl;
    if (!toast || !toast.isConnected) {
      toast = document.createElement('div');
      this.toastContainer.appendChild(toast);
      this.activeToastEl = toast;
    }
    toast.className = `pickup-toast${highlight ? ' rare' : ''}`;
    toast.textContent = message;

    this.activeToastFadeTimer = window.setTimeout(() => {
      this.activeToastFadeTimer = 0;
      if (toast) {
        toast.classList.add('fade-out');
      }
      this.activeToastRemoveTimer = window.setTimeout(() => {
        this.activeToastRemoveTimer = 0;
        if (toast && toast === this.activeToastEl) {
          toast.remove();
          this.activeToastEl = null;
        }
      }, 320);
    }, 3600);
  }
}
