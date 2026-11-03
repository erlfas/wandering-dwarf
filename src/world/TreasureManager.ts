import * as THREE from 'three';
import { WorldConfig } from './Config';
import { createSeededRandom, TerrainNoise } from './TerrainNoise';

interface ChestInstance {
  id: string;
  cx: number;
  cz: number;
  worldPos: THREE.Vector3;
  points: number;
  isRare: boolean;
  root: THREE.Group;
  lidPivot: THREE.Group;
  goldMound: THREE.Mesh;
  glowRing: THREE.Mesh;
  state: 'idle' | 'opening' | 'collected';
  animTime: number;
  sparkles?: THREE.Points;
}

interface SharedChestAssets {
  matWoodStandard: THREE.MeshStandardMaterial;
  matWoodRare: THREE.MeshStandardMaterial;
  matTrimStandard: THREE.MeshStandardMaterial;
  matTrimRare: THREE.MeshStandardMaterial;
  matGoldInside: THREE.MeshStandardMaterial;
  ringMatStandard: THREE.MeshBasicMaterial;
  ringMatRare: THREE.MeshBasicMaterial;
  baseWoodGeo: THREE.BufferGeometry;
  baseTrimGeo: THREE.BufferGeometry;
  lidWoodGeo: THREE.BufferGeometry;
  lidTrimGeo: THREE.BufferGeometry;
  goldGeo: THREE.BufferGeometry;
  ringGeo: THREE.BufferGeometry;
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
    matTrimStandard,
    matTrimRare,
    matGoldInside,
    ringMatStandard,
    ringMatRare,
    baseWoodGeo,
    baseTrimGeo,
    lidWoodGeo,
    lidTrimGeo,
    goldGeo,
    ringGeo,
    sparklesGeo,
    sparklesMat,
  };
  return sharedAssets;
}

export class TreasureManager {
  public readonly group = new THREE.Group();
  public score = 0;
  public chestsCollected = 0;
  public onChestCollected?: () => void;

  private activeChests = new Map<number, ChestInstance[]>();
  private desiredKeys = new Set<number>();
  private collectedIds = new Set<string>();
  private cachedCollectedIds: string[] = [];
  private collectedIdsDirty = true;
  private openingChests: ChestInstance[] = [];
  private audioCtx: AudioContext | null = null;

  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;
  private nearestResult = { dist: 0, pos: new THREE.Vector3() };

  private scoreEl: HTMLElement | null;
  private countEl: HTMLElement | null;
  private badgeEl: HTMLElement | null;
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
    this.toastContainer = document.getElementById('pickup-toasts');
  }

  private getKey(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  /**
   * Builds a 3D stylized dwarven treasure chest (wooden base, iron/gold straps, hinged curved lid,
   * gold lock plate, and a subtle glowing ground ring so it reads clearly in the grass).
   */
  private buildChestMesh(isRare: boolean): {
    root: THREE.Group;
    lidPivot: THREE.Group;
    goldMound: THREE.Mesh;
    glowRing: THREE.Mesh;
  } {
    const assets = getSharedChestAssets();
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;

    const matWood = isRare ? assets.matWoodRare : assets.matWoodStandard;
    const matTrim = isRare ? assets.matTrimRare : assets.matTrimStandard;
    const ringMat = isRare ? assets.ringMatRare : assets.ringMatStandard;

    // Chest base box (casts and receives shadow)
    const base = new THREE.Mesh(assets.baseWoodGeo, matWood);
    base.castShadow = true;
    base.receiveShadow = true;
    base.matrixAutoUpdate = false;
    root.add(base);

    // Merged gold/brass vertical corner straps on base
    const baseTrim = new THREE.Mesh(assets.baseTrimGeo, matTrim);
    baseTrim.castShadow = false;
    baseTrim.receiveShadow = false;
    baseTrim.matrixAutoUpdate = false;
    root.add(baseTrim);

    // Gold coins mound inside the base (hidden while closed, revealed when lid opens!)
    const goldMound = new THREE.Mesh(assets.goldGeo, assets.matGoldInside);
    goldMound.castShadow = false;
    goldMound.receiveShadow = false;
    goldMound.visible = false;
    goldMound.matrixAutoUpdate = false;
    root.add(goldMound);

    // Hinged Lid Pivot at back top edge of base
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.48, -0.31);
    lidPivot.updateMatrix();
    lidPivot.matrixAutoUpdate = false;
    root.add(lidPivot);

    // Merged rounded chest lid wood (casts and receives shadow)
    const lidWood = new THREE.Mesh(assets.lidWoodGeo, matWood);
    lidWood.castShadow = true;
    lidWood.receiveShadow = true;
    lidWood.matrixAutoUpdate = false;
    lidPivot.add(lidWood);

    // Merged lid gold straps + front golden lock clasp
    const lidTrim = new THREE.Mesh(assets.lidTrimGeo, matTrim);
    lidTrim.castShadow = false;
    lidTrim.receiveShadow = false;
    lidTrim.matrixAutoUpdate = false;
    lidPivot.add(lidTrim);

    // Subtle ground glow ring so chests stand out amidst tall grass
    const glowRing = new THREE.Mesh(assets.ringGeo, ringMat);
    glowRing.position.y = 0.08;
    glowRing.updateMatrix();
    glowRing.matrixAutoUpdate = false;
    root.add(glowRing);

    return { root, lidPivot, goldMound, glowRing };
  }

  /**
   * Synchronizes treasure chests with currently loaded chunk coordinates around the player.
   */
  public update(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    hasLodestone = false
  ): void {
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

      // Unload distant uncollected chests outside chunk radius
      for (const [key, list] of this.activeChests.entries()) {
        if (!desiredKeys.has(key)) {
          for (const c of list) {
            if (c.state === 'idle') {
              this.group.remove(c.root);
            }
          }
          this.activeChests.delete(key);
        }
      }
    }

    // Check proximity & animate idle glow / collection
    const pickupRadius = hasLodestone ? 2.6 : 1.95;
    const pickupRadiusSq = pickupRadius * pickupRadius;
    const magnetRadiusSq = hasLodestone ? 8.5 * 8.5 : 0;
    const glowAnimRadiusSq = 45 * 45;
    const maxVisibleRadiusSq = 120 * 120;

    for (const list of this.activeChests.values()) {
      for (const chest of list) {
        if (chest.state !== 'idle') continue;

        const dx = playerPos.x - chest.worldPos.x;
        const dz = playerPos.z - chest.worldPos.z;
        const dSq = dx * dx + dz * dz;

        const isVisible = dSq < maxVisibleRadiusSq;
        if (chest.root.visible !== isVisible) {
          chest.root.visible = isVisible;
        }
        if (!isVisible) continue;

        if (hasLodestone && dSq < magnetRadiusSq && dSq > pickupRadiusSq) {
          // Magnetically pull nearby chest toward the dwarf when Lodestone Runes are equipped
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
          // Pulse ground aura gently only for nearby chests
          const pulse = 1.0 + Math.sin(elapsedTime * 3.5 + chest.worldPos.x) * 0.08;
          chest.glowRing.scale.setScalar(pulse);
          chest.glowRing.updateMatrix();
          chest.glowRing.matrixWorld.multiplyMatrices(
            chest.root.matrixWorld,
            chest.glowRing.matrix
          );
        }

        if (dSq <= pickupRadiusSq) {
          this.collectChest(chest, hasLodestone);
        }
      }
    }

    // Animate opening chests (lid swing, gold sparkle burst, and scale-out)
    for (let i = this.openingChests.length - 1; i >= 0; i--) {
      const chest = this.openingChests[i];
      chest.animTime += dt;
      const t = chest.animTime;

      // Swing lid open in first 0.35s
      const lidAngle = -Math.min(1, t / 0.32) * (Math.PI * 0.62);
      chest.lidPivot.rotation.x = lidAngle;

      // Expand & fade ground ring
      chest.glowRing.scale.setScalar(1.0 + t * 2.5);
      (chest.glowRing.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        0.5 * (1 - t * 1.2)
      );

      // Float sparkles upward
      if (chest.sparkles) {
        chest.sparkles.position.y = 0.5 + t * 2.2;
        chest.sparkles.rotation.y = t * 3.0;
      }

      // Shrink chest out after 1.1s
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
        chest.state = 'collected';
        this.openingChests.splice(i, 1);
      }
    }
  }

  private disposeOpeningChestResources(chest: ChestInstance): void {
    const assets = getSharedChestAssets();
    const ringMat = chest.glowRing.material as THREE.Material;
    if (ringMat !== assets.ringMatStandard && ringMat !== assets.ringMatRare) {
      ringMat.dispose();
    }
  }

  private spawnChestsForChunk(cx: number, cz: number, chunkKey: number): void {
    const size = this.config.chunkSize;
    const chunkSeed = ((cx * 492876847) ^ (cz * 715225739) ^ (this.config.seed + 991)) >>> 0;
    const rng = createSeededRandom(chunkSeed);

    const list: ChestInstance[] = [];

    // Guaranteed welcoming chest in the starting chunk (0,0), otherwise ~55% chance per chunk
    const isStartChunk = cx === 0 && cz === 0;
    const shouldSpawn = isStartChunk || rng() < 0.55;
    if (!shouldSpawn) {
      this.activeChests.set(chunkKey, list);
      return;
    }

    const count = isStartChunk ? 1 : rng() < 0.18 ? 2 : 1;

    for (let i = 0; i < count; i++) {
      const id = `${cx},${cz},${i}`;
      if (this.collectedIds.has(id)) continue;

      // Try up to 8 candidate spots inside the chunk to find dry, gentle ground
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

        // Avoid blocking the center of a walking track; place chests beside the trail or in meadows
        if (
          !isStartChunk &&
          this.config.enableTracks &&
          this.noise.getTrackWeight(wx, wz, wy) > 0.44
        ) {
          continue;
        }

        this.noise.getNormal(wx, wz, tempChestNormal);
        if (tempChestNormal.y < 0.82) continue;

        const isRare = !isStartChunk && rng() < 0.22;
        const points = isRare ? 250 : 100;
        const { root, lidPivot, goldMound, glowRing } = this.buildChestMesh(isRare);

        root.position.set(wx, wy, wz);
        root.rotation.y = rng() * Math.PI * 2;
        root.updateMatrix();
        this.group.add(root);
        root.updateMatrixWorld(true);

        list.push({
          id,
          cx,
          cz,
          worldPos: new THREE.Vector3(wx, wy, wz),
          points,
          isRare,
          root,
          lidPivot,
          goldMound,
          glowRing,
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
    const earnedPoints = hasLodestone ? Math.round(chest.points * 1.5) : chest.points;
    this.score += earnedPoints;
    this.chestsCollected += 1;

    // Clone glowRing material so fading opacity doesn't affect idle chests
    chest.glowRing.material = (chest.glowRing.material as THREE.MeshBasicMaterial).clone();

    // Reuse shared golden coin/sparkle burst geometry & material
    const assets = getSharedChestAssets();
    const sparkles = new THREE.Points(assets.sparklesGeo, assets.sparklesMat);
    sparkles.position.y = 0.5;
    chest.root.add(sparkles);
    chest.sparkles = sparkles;

    this.openingChests.push(chest);
    this.updateHUD(earnedPoints, chest.isRare);
    this.playPickupChime(chest.isRare);
    this.onChestCollected?.();
  }

  public spendGold(amount: number): boolean {
    if (this.score < amount) return false;
    this.score -= amount;
    this.syncHUDTotals();
    return true;
  }

  private syncHUDTotals(): void {
    if (this.scoreEl) {
      this.scoreEl.textContent = this.score.toLocaleString();
    }
    if (this.countEl) {
      this.countEl.textContent = `${this.chestsCollected} Chest${this.chestsCollected === 1 ? '' : 's'}`;
    }
  }

  private updateHUD(addedPoints: number, isRare: boolean): void {
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

    if (this.toastContainer) {
      const toast = document.createElement('div');
      toast.className = `pickup-toast ${isRare ? 'rare' : ''}`;
      toast.textContent = isRare
        ? `★ Rare Dwarven Chest! +${addedPoints} Gold`
        : `+${addedPoints} Gold`;
      this.toastContainer.appendChild(toast);
      setTimeout(() => {
        toast.remove();
      }, 2200);
    }
  }

  /**
   * Plays a cheerful synthesized treasure chime using Web Audio API.
   */
  private playPickupChime(isRare: boolean): void {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      const now = this.audioCtx.currentTime;
      const notes = isRare ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];

      notes.forEach((freq, idx) => {
        const osc = this.audioCtx!.createOscillator();
        const gain = this.audioCtx!.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.001, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.38);

        osc.connect(gain);
        gain.connect(this.audioCtx!.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.4);
      });
    } catch {
      // Ignore if AudioContext is blocked
    }
  }

  /**
   * Finds the world position of the nearest uncollected chest so we can show a subtle distance/hint.
   */
  public getNearestChest(playerPos: THREE.Vector3): { dist: number; pos: THREE.Vector3 } | null {
    let bestDistSq = Infinity;
    let bestPos: THREE.Vector3 | null = null;

    for (const list of this.activeChests.values()) {
      for (const c of list) {
        if (c.state !== 'idle') continue;
        const dx = c.worldPos.x - playerPos.x;
        const dz = c.worldPos.z - playerPos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestPos = c.worldPos;
        }
      }
    }

    if (!bestPos) return null;
    this.nearestResult.dist = Math.sqrt(bestDistSq);
    this.nearestResult.pos.copy(bestPos);
    return this.nearestResult;
  }

  public rebuildAll(): void {
    for (const chest of this.openingChests) {
      this.disposeOpeningChestResources(chest);
      this.group.remove(chest.root);
    }
    this.openingChests.length = 0;

    for (const list of this.activeChests.values()) {
      for (const c of list) {
        this.group.remove(c.root);
      }
    }
    this.activeChests.clear();
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
    this.collectedIds.clear();
    this.collectedIdsDirty = true;
    this.syncHUDTotals();
    this.rebuildAll();
  }
}
