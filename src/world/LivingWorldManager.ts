import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { getSharedAudioContext } from '../player/RelicStore';
import { WorldConfig } from './Config';
import { createSeededRandom, TerrainNoise } from './TerrainNoise';

interface StarFragmentInstance {
  worldPos: THREE.Vector3;
  collected: boolean;
  mesh: THREE.Group;
  crystal: THREE.Mesh;
  ring: THREE.Mesh;
}

interface BirdFlockInstance {
  origin: THREE.Vector3;
  scared: boolean;
  flightTime: number;
  birds: THREE.Mesh[];
  group: THREE.Group;
}

interface SpiritRabbitInstance {
  pos: THREE.Vector3;
  targetPos: THREE.Vector3;
  rewarded: boolean;
  hopPhase: number;
  mesh: THREE.Mesh;
}

interface GoblinHazardInstance {
  centerPos: THREE.Vector3;
  pos: THREE.Vector3;
  orbitAngle: number;
  orbitRadius: number;
  defeated: boolean;
  flyTime: number;
  mesh: THREE.Group;
  bodyMesh: THREE.Mesh;
  headMesh: THREE.Mesh;
}

interface ChunkLivingEntities {
  starFragment?: StarFragmentInstance;
  birdFlock?: BirdFlockInstance;
  spiritRabbit?: SpiritRabbitInstance;
  goblin?: GoblinHazardInstance;
}

interface SharedLivingAssets {
  matStarCrystal: THREE.MeshStandardMaterial;
  matStarRing: THREE.MeshBasicMaterial;
  matBird: THREE.MeshStandardMaterial;
  matSpirit: THREE.MeshStandardMaterial;
  matGoblinSkin: THREE.MeshStandardMaterial;
  matGoblinTunic: THREE.MeshStandardMaterial;
  matGoldSack: THREE.MeshStandardMaterial;
  starCrystalGeo: THREE.BufferGeometry;
  starRingGeo: THREE.BufferGeometry;
  birdGeo: THREE.BufferGeometry;
  spiritBodyGeo: THREE.BufferGeometry;
  spiritRabbitGeo: THREE.BufferGeometry;
  goblinBodyGeo: THREE.BufferGeometry;
  goblinHeadGeo: THREE.BufferGeometry;
}

let sharedLivingAssets: SharedLivingAssets | null = null;

// Sky & Lighting keyframe colors
const SKY_DAWN = new THREE.Color(0xf2b89b);
const SKY_DAY = new THREE.Color(0xd7e3ec);
const SKY_SUNSET = new THREE.Color(0xd98a6c);
const SKY_NIGHT = new THREE.Color(0x0d1626);

const SUN_DAWN = new THREE.Color(0xffb570);
const SUN_DAY = new THREE.Color(0xfff5e4);
const SUN_SUNSET = new THREE.Color(0xff7b47);
const MOON_NIGHT = new THREE.Color(0x7da8e6);

const HEMI_SKY_DAY = new THREE.Color(0xeaf4ff);
const HEMI_SKY_NIGHT = new THREE.Color(0x1b2b4a);
const HEMI_GND_DAY = new THREE.Color(0x6b7f4e);
const HEMI_GND_NIGHT = new THREE.Color(0x16211c);

function getSharedLivingAssets(): SharedLivingAssets {
  if (sharedLivingAssets) return sharedLivingAssets;

  const matStarCrystal = new THREE.MeshStandardMaterial({
    color: 0x9bf6ff,
    roughness: 0.15,
    metalness: 0.85,
    emissive: 0x48cae4,
    emissiveIntensity: 1.25,
  });

  const matStarRing = new THREE.MeshBasicMaterial({
    color: 0x90e0ef,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.65,
  });

  const matBird = new THREE.MeshStandardMaterial({
    color: 0xf4f1de,
    roughness: 0.7,
    metalness: 0.05,
  });

  const matSpirit = new THREE.MeshStandardMaterial({
    color: 0xd8f3dc,
    roughness: 0.3,
    metalness: 0.1,
    emissive: 0x52b788,
    emissiveIntensity: 0.75,
  });

  const matGoblinSkin = new THREE.MeshStandardMaterial({
    color: 0x6a994e,
    roughness: 0.75,
    metalness: 0.05,
  });

  const matGoblinTunic = new THREE.MeshStandardMaterial({
    color: 0x78290f,
    roughness: 0.85,
    metalness: 0.08,
  });

  const matGoldSack = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    roughness: 0.35,
    metalness: 0.7,
    emissive: 0x5c4300,
    emissiveIntensity: 0.35,
  });

  const starCrystalGeo = new THREE.OctahedronGeometry(0.42, 0);
  starCrystalGeo.scale(0.8, 1.45, 0.8);

  const starRingGeo = new THREE.RingGeometry(0.65, 0.92, 20);
  starRingGeo.rotateX(-Math.PI / 2);

  const birdGeo = new THREE.ConeGeometry(0.18, 0.42, 4);
  birdGeo.rotateX(Math.PI / 2);
  birdGeo.scale(1.6, 0.45, 1.0);

  const spiritBodyGeo = new THREE.SphereGeometry(0.28, 10, 8);
  spiritBodyGeo.scale(0.85, 0.85, 1.2);
  spiritBodyGeo.translate(0, 0.25, 0);

  const spiritEarGeo = new THREE.BoxGeometry(0.08, 0.32, 0.08);
  spiritEarGeo.translate(0, 0.52, 0.08);

  const spiritBodyClone = spiritBodyGeo.clone();
  const spiritRabbitGeo = mergeGeometries([spiritBodyClone, spiritEarGeo], false);
  spiritBodyClone.dispose();
  spiritEarGeo.dispose();
  spiritRabbitGeo.computeBoundingBox();
  spiritRabbitGeo.computeBoundingSphere();

  const goblinBodyGeo = new THREE.ConeGeometry(0.36, 0.72, 7);
  goblinBodyGeo.translate(0, 0.36, 0);

  const goblinHeadGeo = new THREE.SphereGeometry(0.24, 8, 8);
  goblinHeadGeo.translate(0, 0.82, 0);

  sharedLivingAssets = {
    matStarCrystal,
    matStarRing,
    matBird,
    matSpirit,
    matGoblinSkin,
    matGoblinTunic,
    matGoldSack,
    starCrystalGeo,
    starRingGeo,
    birdGeo,
    spiritBodyGeo,
    spiritRabbitGeo,
    goblinBodyGeo,
    goblinHeadGeo,
  };
  return sharedLivingAssets;
}

/**
 * Manages the Living World, Dynamic Day/Night Cycle, Dwarven Lantern, Starfield Dome,
 * Nightfall Star-Fragments, Ambient Wildlife (Bird Flocks & Guiding Forest Spirits),
 * and Interactive Hazards (Rolling Hillside Boulders & Goblin Cutpurses).
 */
export class LivingWorldManager {
  public readonly group = new THREE.Group();
  private activeChunks = new Map<number, ChunkLivingEntities>();
  private desiredKeys = new Set<number>();
  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;

  // Starfield dome & Dwarven Belt Lantern
  private starDome!: THREE.Points;
  private starMat!: THREE.PointsMaterial;
  private dwarfLanternLight!: THREE.PointLight;
  private dwarfLanternMesh!: THREE.Mesh;
  private isNight = false;
  private hazardHitCooldown = 0;
  private getSurfaceHeightFn?: (wx: number, wz: number) => number;
  private readonly skyHorizonColor: THREE.Color;

  constructor(
    private config: WorldConfig,
    private noise: TerrainNoise,
    private scene: THREE.Scene,
    private dirLight: THREE.DirectionalLight,
    private hemiLight: THREE.HemisphereLight,
    private fog: THREE.FogExp2,
    private dwarf: DwarfCharacter,
    private onGrantOrDeductGold: (deltaGold: number, message: string, isPositive: boolean) => void,
    private onSyncGui?: () => void
  ) {
    this.group.matrixAutoUpdate = false;
    this.skyHorizonColor =
      this.scene.background instanceof THREE.Color
        ? this.scene.background
        : new THREE.Color(0xd7e3ec);
    this.buildStarfieldDome();
    this.attachDwarfLantern();

    // Press N to jump between Morning -> Sunset -> Starry Night -> Dawn
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyN') {
        this.cycleTimeOfDayPreset();
      }
    });
  }

  public setSurfaceHeightSampler(fn: (wx: number, wz: number) => number): void {
    this.getSurfaceHeightFn = fn;
  }

  private sampleGroundHeight(wx: number, wz: number): number {
    return this.getSurfaceHeightFn ? this.getSurfaceHeightFn(wx, wz) : this.noise.getHeight(wx, wz);
  }

  private getKey(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  public cycleTimeOfDayPreset(): void {
    const t = this.config.timeOfDay;
    let label = '';
    if (t >= 7 && t < 16.5) {
      this.config.timeOfDay = 18.2;
      label = '🌅 Golden Hour Sunset (18:12)';
    } else if (t >= 16.5 && t < 20.5) {
      this.config.timeOfDay = 23.5;
      label = '🌌 Starry Night & Lantern Lit (23:30)';
    } else if (t >= 20.5 || t < 5.5) {
      this.config.timeOfDay = 6.25;
      label = '🌄 Misty Dawn (06:15)';
    } else {
      this.config.timeOfDay = 10.5;
      label = '☀️ Sunlit Morning (10:30)';
    }
    this.onSyncGui?.();
    this.onGrantOrDeductGold(0, `${label} — Press N to cycle`, true);
  }

  private buildStarfieldDome(): void {
    const starCount = 300;
    const positions = new Float32Array(starCount * 3);
    const rng = createSeededRandom(7777);

    for (let i = 0; i < starCount; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = rng() * Math.PI * 0.44; // Upper hemisphere
      const r = 380;
      positions[i * 3] = Math.cos(theta) * Math.sin(phi) * r;
      positions[i * 3 + 1] = Math.cos(phi) * r + 25;
      positions[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * r;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xe0f2fe,
      size: 2.2,
      transparent: true,
      opacity: 0.0,
      fog: false,
      depthWrite: false,
    });
    this.starDome = new THREE.Points(geo, this.starMat);
    this.starDome.frustumCulled = false;
    this.starDome.visible = false;
    this.scene.add(this.starDome);
  }

  private attachDwarfLantern(): void {
    // Keep dwarfLanternLight visible outdoors (intensity = 0 by day) so NUM_POINT_LIGHTS stays 1 everywhere
    this.dwarfLanternLight = new THREE.PointLight(0xffaa33, 0, 26, 1.4);
    this.dwarfLanternLight.position.set(0.42, 1.15, 0.35);
    this.dwarfLanternLight.visible = true;
    this.dwarf.root.add(this.dwarfLanternLight);

    const lanternGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.24, 6);
    const lanternMat = new THREE.MeshBasicMaterial({
      color: 0xffd166,
    });
    this.dwarfLanternMesh = new THREE.Mesh(lanternGeo, lanternMat);
    this.dwarfLanternMesh.position.set(0.38, 0.82, 0.25);
    this.dwarfLanternMesh.visible = false;
    this.dwarf.root.add(this.dwarfLanternMesh);
  }

  private insideInterior = false;

  public setInsideInterior(inside: boolean): void {
    if (this.insideInterior === inside) return;
    this.insideInterior = inside;
    this.dwarfLanternLight.visible = !inside;
    if (inside) {
      this.dwarfLanternMesh.visible = false;
      this.starDome.visible = false;
    }
  }

  public getSkyHorizonColor(): THREE.Color {
    return this.skyHorizonColor;
  }

  public update(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    isPlayerAttackingOrAirborne: boolean,
    sunOffsetOut: THREE.Vector3
  ): void {
    if (this.hazardHitCooldown > 0) {
      this.hazardHitCooldown = Math.max(0, this.hazardHitCooldown - dt);
    }

    // 1. Advance Time-of-Day & Atmospheric Lighting
    if (this.config.enableDayNightCycle) {
      // Full 24h cycle in ~240 seconds (0.1 hours per second)
      this.config.timeOfDay = (this.config.timeOfDay + dt * 0.1) % 24.0;
    }
    this.updateAtmosphereAndLantern(elapsedTime, playerPos, sunOffsetOut);

    // 2. Stream Living World entities per chunk
    const size = this.config.chunkSize;
    const r = Math.min(this.config.renderRadius, 4); // Keep wildlife/hazards within 4 chunks for O(1) speed
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

          if (!this.activeChunks.has(key)) {
            this.spawnEntitiesForChunk(cx, cz, key);
          }
        }
      }

      for (const [key, ent] of this.activeChunks.entries()) {
        if (!desiredKeys.has(key)) {
          this.removeChunkEntities(ent);
          this.activeChunks.delete(key);
        }
      }
    }

    // 3. Simulate Wildlife, Nightfall Star-Fragments & Hazards
    for (const ent of this.activeChunks.values()) {
      // A) Nightfall Star-Fragments (visible & collectible during twilight/night)
      if (ent.starFragment) {
        const sf = ent.starFragment;
        const shouldShow = this.isNight && !sf.collected;
        if (sf.mesh.visible !== shouldShow) {
          sf.mesh.visible = shouldShow;
        }
        if (shouldShow) {
          sf.crystal.rotation.y = elapsedTime * 2.5;
          sf.crystal.position.y = 0.75 + Math.sin(elapsedTime * 3.5) * 0.14;
          sf.crystal.updateMatrix();
          sf.crystal.matrixWorld.multiplyMatrices(sf.mesh.matrixWorld, sf.crystal.matrix);

          const dx = playerPos.x - sf.worldPos.x;
          const dz = playerPos.z - sf.worldPos.z;
          if (dx * dx + dz * dz <= 2.3 * 2.3) {
            sf.collected = true;
            sf.mesh.visible = false;
            this.playStarChime();
            this.onGrantOrDeductGold(250, '🌠 Nightfall Star-Fragment! +250 Gold', true);
          }
        }
      }

      // B) Meadow Bird Flocks (scatter into the sky when approached)
      if (ent.birdFlock && ent.birdFlock.group.visible) {
        const flock = ent.birdFlock;
        if (!flock.scared) {
          const dx = playerPos.x - flock.origin.x;
          const dz = playerPos.z - flock.origin.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < 8.5 * 8.5) {
            flock.scared = true;
            this.playBirdChirp();
          } else if (dSq < 45 * 45) {
            // Subtle pecking hop on the ground (distance-gated to 45m)
            for (let i = 0; i < flock.birds.length; i++) {
              const b = flock.birds[i];
              b.position.y = Math.abs(Math.sin(elapsedTime * 4.5 + i * 1.7)) * 0.12;
              b.updateMatrix();
              b.matrixWorld.multiplyMatrices(flock.group.matrixWorld, b.matrix);
            }
          }
        } else {
          flock.flightTime += dt;
          const t = flock.flightTime;
          for (let i = 0; i < flock.birds.length; i++) {
            const b = flock.birds[i];
            const angle = i * 1.25 + t * 2.4;
            const radius = 1.2 + t * 3.5;
            b.position.set(
              Math.cos(angle) * radius,
              t * (5.5 + i * 0.4),
              Math.sin(angle) * radius
            );
            b.rotation.y = -angle;
            b.rotation.z = Math.sin(elapsedTime * 18.0 + i) * 0.35;
            b.updateMatrix();
            b.matrixWorld.multiplyMatrices(flock.group.matrixWorld, b.matrix);
          }
          if (t > 5.0) {
            flock.group.visible = false;
          }
        }
      }

      // C) Guiding Forest Spirit Rabbits (hop toward a hidden meadow blessing when followed)
      if (ent.spiritRabbit && !ent.spiritRabbit.rewarded) {
        const sr = ent.spiritRabbit;
        const dx = playerPos.x - sr.pos.x;
        const dz = playerPos.z - sr.pos.z;
        const dSq = dx * dx + dz * dz;

        const castShadow = dSq < 48 * 48;
        if (sr.mesh.castShadow !== castShadow) {
          sr.mesh.castShadow = castShadow;
        }

        if (dSq < 15.0 * 15.0) {
          // Hop toward targetPos
          const tx = sr.targetPos.x - sr.pos.x;
          const tz = sr.targetPos.z - sr.pos.z;
          const tDist = Math.hypot(tx, tz);
          if (tDist > 1.2) {
            const step = Math.min(tDist, dt * 6.8);
            sr.pos.x += (tx / tDist) * step;
            sr.pos.z += (tz / tDist) * step;
            sr.pos.y = this.sampleGroundHeight(sr.pos.x, sr.pos.z);
            sr.hopPhase += dt * 11.0;
            sr.mesh.position.set(
              sr.pos.x,
              sr.pos.y + Math.abs(Math.sin(sr.hopPhase)) * 0.42,
              sr.pos.z
            );
            sr.mesh.rotation.y = Math.atan2(tx, tz);
            sr.mesh.updateMatrix();
            sr.mesh.matrixWorld.multiplyMatrices(this.group.matrixWorld, sr.mesh.matrix);
          } else if (dSq < 3.2 * 3.2) {
            sr.rewarded = true;
            sr.mesh.visible = false;
            this.playStarChime();
            this.onGrantOrDeductGold(125, '🐇 Forest Spirit Gift! +125 Gold', true);
          }
        } else if (dSq < 45 * 45) {
          // Gentle idle hop (distance-gated to 45m)
          sr.hopPhase += dt * 3.5;
          sr.mesh.position.y = sr.pos.y + Math.abs(Math.sin(sr.hopPhase)) * 0.14;
          sr.mesh.updateMatrix();
          sr.mesh.matrixWorld.multiplyMatrices(this.group.matrixWorld, sr.mesh.matrix);
        }
      }

      // D) Mischievous Goblin Cutpurses (Smash with C-Dash or Jump for +125 Gold!)
      if (ent.goblin && ent.goblin.mesh.visible) {
        const g = ent.goblin;
        if (!g.defeated) {
          const cdx = playerPos.x - g.centerPos.x;
          const cdz = playerPos.z - g.centerPos.z;
          const centerDistSq = cdx * cdx + cdz * cdz;
          const maxSimRadius = 60 + g.orbitRadius;
          if (centerDistSq <= maxSimRadius * maxSimRadius) {
            g.orbitAngle += dt * 1.65;
            g.pos.x = g.centerPos.x + Math.cos(g.orbitAngle) * g.orbitRadius;
            g.pos.z = g.centerPos.z + Math.sin(g.orbitAngle) * g.orbitRadius;
            g.pos.y = this.sampleGroundHeight(g.pos.x, g.pos.z);

            const hop = Math.abs(Math.sin(elapsedTime * 8.5)) * 0.18;
            g.mesh.position.set(g.pos.x, g.pos.y + hop, g.pos.z);
            g.mesh.rotation.y = -g.orbitAngle;
            g.mesh.updateMatrix();
            g.mesh.updateMatrixWorld(true);

            const dx = playerPos.x - g.pos.x;
            const dz = playerPos.z - g.pos.z;
            const dSq = dx * dx + dz * dz;
            const castShadow = dSq < 48 * 48;
            if (g.bodyMesh.castShadow !== castShadow) {
              g.bodyMesh.castShadow = castShadow;
              g.headMesh.castShadow = castShadow;
            }
            if (dSq < 1.65 * 1.65) {
              if (isPlayerAttackingOrAirborne) {
                g.defeated = true;
                this.playStarChime();
                this.onGrantOrDeductGold(
                  125,
                  '🛡️ Smashed Goblin Cutpurse! +125 Gold!',
                  true
                );
              } else if (this.hazardHitCooldown <= 0) {
                this.hazardHitCooldown = 2.4;
                this.playHazardBumpSound();
                this.onGrantOrDeductGold(
                  -25,
                  '👺 Goblin Cutpurse! -25 Gold (Press C/Ctrl or Space to Smash!)',
                  false
                );
              }
            }
          } else if (g.bodyMesh.castShadow) {
            g.bodyMesh.castShadow = false;
            g.headMesh.castShadow = false;
          }
        } else {
          g.flyTime += dt;
          g.mesh.position.y += dt * 14.0;
          g.mesh.rotation.x += dt * 12.0;
          g.mesh.scale.setScalar(Math.max(0.01, 1.0 - g.flyTime * 1.4));
          g.mesh.updateMatrix();
          g.mesh.updateMatrixWorld(true);
          if (g.flyTime >= 0.7) {
            g.mesh.visible = false;
          }
        }
      }
    }
  }

  /**
   * Smashes all active Goblins within a ground-slam radius.
   */
  public defeatGoblinsInRadius(playerPos: THREE.Vector3, radius = 6.5): number {
    let count = 0;
    const rSq = radius * radius;
    for (const ent of this.activeChunks.values()) {
      if (ent.goblin && ent.goblin.mesh.visible && !ent.goblin.defeated) {
        const dx = playerPos.x - ent.goblin.pos.x;
        const dz = playerPos.z - ent.goblin.pos.z;
        if (dx * dx + dz * dz <= rSq) {
          ent.goblin.defeated = true;
          ent.goblin.flyTime = 0;
          count++;
          this.playStarChime();
          this.onGrantOrDeductGold(125, '💥 Ground-Slam Smashed Goblin Cutpurse! +125 Gold!', true);
        }
      }
    }
    return count;
  }

  /**
   * Smashes any Goblin colliding during high-speed downhill surf-ramming.
   */
  public checkSurfRamGoblin(playerPos: THREE.Vector3, radius = 2.4): boolean {
    const rSq = radius * radius;
    for (const ent of this.activeChunks.values()) {
      if (ent.goblin && ent.goblin.mesh.visible && !ent.goblin.defeated) {
        const dx = playerPos.x - ent.goblin.pos.x;
        const dz = playerPos.z - ent.goblin.pos.z;
        if (dx * dx + dz * dz <= rSq) {
          ent.goblin.defeated = true;
          ent.goblin.flyTime = 0;
          this.playStarChime();
          this.onGrantOrDeductGold(125, '🛡️ Surf-Ram Smashed Goblin Cutpurse! +125 Gold!', true);
          return true;
        }
      }
    }
    return false;
  }

  public updateAtmosphereAndLantern(
    elapsedTime: number,
    playerPos: THREE.Vector3,
    sunOffsetOut: THREE.Vector3
  ): void {
    const hour = ((this.config.timeOfDay % 24) + 24) % 24;

    // Map 0..24h to sun elevation angle: 6h = sunrise (0), 12h = zenith (+1), 18h = sunset (0), 0h = midnight (-1)
    const sunAngle = ((hour - 6.0) / 24.0) * Math.PI * 2;
    const sinElev = Math.sin(sunAngle);
    const cosElev = Math.cos(sunAngle);

    // Compute night factor [0 = bright day, 1 = deep night]
    const nightFactor = THREE.MathUtils.smoothstep(-sinElev, -0.15, 0.38);
    const twilightFactor =
      1.0 - Math.min(1.0, Math.abs(sinElev) / 0.36); // Peaks near sunrise (6h) & sunset (18h)
    const isDawn = hour < 12;

    this.isNight = nightFactor > 0.45;

    // 1. Sky & Fog Color
    const skyCol = this.skyHorizonColor;
    skyCol.copy(SKY_DAY).lerp(SKY_NIGHT, nightFactor);
    if (twilightFactor > 0.01) {
      skyCol.lerp(isDawn ? SKY_DAWN : SKY_SUNSET, twilightFactor * 0.78);
    }
    if (!this.insideInterior) {
      this.fog.color.copy(skyCol);
    }

    // 2. Directional Sun / Moon Light
    const lightRadius = 125;
    // Keep shadow caster above horizon by switching between sun (day) and high moon (night)
    const elevY = Math.max(38, Math.abs(sinElev) * 110 + 28);
    const horizX = cosElev * lightRadius;
    sunOffsetOut.set(horizX, elevY, 65);

    this.dirLight.color.copy(SUN_DAY).lerp(MOON_NIGHT, nightFactor);
    if (twilightFactor > 0.01) {
      this.dirLight.color.lerp(isDawn ? SUN_DAWN : SUN_SUNSET, twilightFactor * 0.85);
    }
    this.dirLight.intensity = THREE.MathUtils.lerp(1.85, 0.52, nightFactor);

    // 3. Hemisphere Sky/Ground Bounce
    this.hemiLight.color.copy(HEMI_SKY_DAY).lerp(HEMI_SKY_NIGHT, nightFactor);
    this.hemiLight.groundColor.copy(HEMI_GND_DAY).lerp(HEMI_GND_NIGHT, nightFactor);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.82, 0.34, nightFactor);

    // 4. Twinkling Starfield Dome at Twilight / Night
    this.starDome.visible = !this.insideInterior && nightFactor > 0.15;
    if (this.starDome.visible) {
      this.starDome.position.set(playerPos.x, 0, playerPos.z);
      this.starDome.rotation.y = elapsedTime * 0.008;
      this.starMat.opacity = (nightFactor - 0.15) / 0.85;
    }

    // 5. Automatic Dwarven Belt Lantern at Dusk / Night
    // Keep dwarfLanternLight.visible = !insideInterior (intensity = 0 by day) so NUM_POINT_LIGHTS stays 1
    const showLantern = !this.insideInterior && nightFactor > 0.25;
    this.dwarfLanternMesh.visible = showLantern;
    this.dwarfLanternLight.visible = !this.insideInterior;
    if (showLantern) {
      const flicker = 1.0 + Math.sin(elapsedTime * 11.0) * 0.08;
      this.dwarfLanternLight.intensity = ((nightFactor - 0.25) / 0.75) * 3.6 * flicker;
    } else if (this.dwarfLanternLight.intensity !== 0) {
      this.dwarfLanternLight.intensity = 0;
    }
  }

  private spawnEntitiesForChunk(cx: number, cz: number, chunkKey: number): void {
    const size = this.config.chunkSize;
    const chunkWx = cx * size;
    const chunkWz = cz * size;
    if (this.noise.isInsideVolcanoBarrenZone(chunkWx, chunkWz)) {
      this.activeChunks.set(chunkKey, {});
      return;
    }

    const chunkSeed = ((cx * 314159265) ^ (cz * 271828183) ^ (this.config.seed + 577)) >>> 0;
    const rng = createSeededRandom(chunkSeed);
    const assets = getSharedLivingAssets();

    const ent: ChunkLivingEntities = {};
    const isStartChunk = cx === 0 && cz === 0;

    // 1. Nightfall Star-Fragment (~35% of chunks)
    if (!isStartChunk && rng() < 0.35) {
      const wx = cx * size + (rng() - 0.5) * (size * 0.7);
      const wz = cz * size + (rng() - 0.5) * (size * 0.7);
      const wy = this.sampleGroundHeight(wx, wz);
      if (
        !this.noise.isInsideVolcanoBarrenZone(wx, wz) &&
        (!this.config.enableWater || wy > this.config.waterLevel + 0.8)
      ) {
        const mesh = new THREE.Group();
        mesh.position.set(wx, wy, wz);
        mesh.visible = this.isNight;
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;

        const crystal = new THREE.Mesh(assets.starCrystalGeo, assets.matStarCrystal);
        crystal.position.y = 0.75;
        crystal.updateMatrix();
        crystal.matrixAutoUpdate = false;
        mesh.add(crystal);

        const ring = new THREE.Mesh(assets.starRingGeo, assets.matStarRing);
        ring.position.y = 0.08;
        ring.updateMatrix();
        ring.matrixAutoUpdate = false;
        mesh.add(ring);

        this.group.add(mesh);
        mesh.updateMatrixWorld(true);
        ent.starFragment = {
          worldPos: new THREE.Vector3(wx, wy, wz),
          collected: false,
          mesh,
          crystal,
          ring,
        };
      }
    }

    // 2. Meadow Bird Flock (in start chunk or ~35% of chunks)
    if (isStartChunk || rng() < 0.35) {
      const wx = isStartChunk ? 5.5 : cx * size + (rng() - 0.5) * (size * 0.65);
      const wz = isStartChunk ? 8.5 : cz * size + (rng() - 0.5) * (size * 0.65);
      const wy = this.sampleGroundHeight(wx, wz);
      if (
        !this.noise.isInsideVolcanoBarrenZone(wx, wz) &&
        (!this.config.enableWater || wy > this.config.waterLevel + 0.9)
      ) {
        const group = new THREE.Group();
        group.position.set(wx, wy, wz);
        group.updateMatrix();
        group.matrixAutoUpdate = false;

        const birds: THREE.Mesh[] = [];
        for (let i = 0; i < 5; i++) {
          const b = new THREE.Mesh(assets.birdGeo, assets.matBird);
          const a = (i / 5) * Math.PI * 2;
          b.position.set(Math.cos(a) * 0.9, 0.08, Math.sin(a) * 0.9);
          b.rotation.y = rng() * Math.PI * 2;
          b.updateMatrix();
          b.matrixAutoUpdate = false;
          group.add(b);
          birds.push(b);
        }

        this.group.add(group);
        group.updateMatrixWorld(true);
        ent.birdFlock = {
          origin: new THREE.Vector3(wx, wy, wz),
          scared: false,
          flightTime: 0,
          birds,
          group,
        };
      }
    }

    // 3. Guiding Forest Spirit Rabbit (in start chunk or ~28% of chunks)
    if (isStartChunk || rng() < 0.28) {
      const wx = isStartChunk ? -6.5 : cx * size + (rng() - 0.5) * (size * 0.6);
      const wz = isStartChunk ? 9.5 : cz * size + (rng() - 0.5) * (size * 0.6);
      const wy = this.sampleGroundHeight(wx, wz);
      if (
        !this.noise.isInsideVolcanoBarrenZone(wx, wz) &&
        (!this.config.enableWater || wy > this.config.waterLevel + 1.0)
      ) {
        const mesh = new THREE.Mesh(assets.spiritRabbitGeo, assets.matSpirit);
        mesh.position.set(wx, wy, wz);
        mesh.castShadow = false;
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;

        this.group.add(mesh);
        mesh.updateMatrixWorld(true);

        const tAngle = rng() * Math.PI * 2;
        const tx = wx + Math.cos(tAngle) * 18.0;
        const tz = wz + Math.sin(tAngle) * 18.0;
        ent.spiritRabbit = {
          pos: new THREE.Vector3(wx, wy, wz),
          targetPos: new THREE.Vector3(tx, this.sampleGroundHeight(tx, tz), tz),
          rewarded: false,
          hopPhase: rng() * 6.0,
          mesh,
        };
      }
    }

    // 4. Mischievous Goblin Cutpurse in outer chunks
    if (!isStartChunk && rng() < 0.22) {
      const wx = cx * size + (rng() - 0.5) * (size * 0.6);
      const wz = cz * size + (rng() - 0.5) * (size * 0.6);
      const wy = this.sampleGroundHeight(wx, wz);

      if (
        !this.noise.isInsideVolcanoBarrenZone(wx, wz) &&
        (!this.config.enableWater || wy > this.config.waterLevel + 1.2)
      ) {
        const mesh = new THREE.Group();
        mesh.position.set(wx, wy, wz);
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;

        const body = new THREE.Mesh(assets.goblinBodyGeo, assets.matGoblinTunic);
        body.castShadow = false;
        body.matrixAutoUpdate = false;
        mesh.add(body);

        const head = new THREE.Mesh(assets.goblinHeadGeo, assets.matGoblinSkin);
        head.castShadow = false;
        head.matrixAutoUpdate = false;
        mesh.add(head);

        const sack = new THREE.Mesh(assets.spiritBodyGeo, assets.matGoldSack);
        sack.position.set(0, 0.22, -0.28);
        sack.updateMatrix();
        sack.matrixAutoUpdate = false;
        mesh.add(sack);

        this.group.add(mesh);
        mesh.updateMatrixWorld(true);

        ent.goblin = {
          centerPos: new THREE.Vector3(wx, wy, wz),
          pos: new THREE.Vector3(wx, wy, wz),
          orbitAngle: rng() * Math.PI * 2,
          orbitRadius: 3.8 + rng() * 2.5,
          defeated: false,
          flyTime: 0,
          mesh,
          bodyMesh: body,
          headMesh: head,
        };
      }
    }

    this.activeChunks.set(chunkKey, ent);
  }

  private removeChunkEntities(ent: ChunkLivingEntities): void {
    if (ent.starFragment) this.group.remove(ent.starFragment.mesh);
    if (ent.birdFlock) this.group.remove(ent.birdFlock.group);
    if (ent.spiritRabbit) this.group.remove(ent.spiritRabbit.mesh);
    if (ent.goblin) this.group.remove(ent.goblin.mesh);
  }

  public rebuildAll(): void {
    for (const ent of this.activeChunks.values()) {
      this.removeChunkEntities(ent);
    }
    this.activeChunks.clear();
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
  }

  private ensureAudio(): AudioContext | null {
    return getSharedAudioContext();
  }

  private playBirdChirp(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const freqs = [1150, 1480, 1320];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.06);
      osc.frequency.exponentialRampToValueAtTime(f * 1.18, now + idx * 0.06 + 0.05);

      gain.gain.setValueAtTime(0.001, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.05, now + idx * 0.06 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.06);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.07);
    });
  }

  private playStarChime(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [587.33, 880.0, 1174.66];
    notes.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + idx * 0.07);

      gain.gain.setValueAtTime(0.001, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.07 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.38);
    });
  }

  private playHazardBumpSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.24);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
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
}
