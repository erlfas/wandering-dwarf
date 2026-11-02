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
  glowRing: THREE.Mesh;
  state: 'idle' | 'opening' | 'collected';
  animTime: number;
  sparkles?: THREE.Points;
}

export class TreasureManager {
  public readonly group = new THREE.Group();
  public score = 0;
  public chestsCollected = 0;

  private activeChests = new Map<string, ChestInstance[]>();
  private collectedIds = new Set<string>();
  private openingChests: ChestInstance[] = [];
  private audioCtx: AudioContext | null = null;

  private scoreEl: HTMLElement | null;
  private countEl: HTMLElement | null;
  private toastContainer: HTMLElement | null;

  constructor(
    private config: WorldConfig,
    private noise: TerrainNoise
  ) {
    this.scoreEl = document.getElementById('score-value');
    this.countEl = document.getElementById('chests-value');
    this.toastContainer = document.getElementById('pickup-toasts');
  }

  /**
   * Builds a 3D stylized dwarven treasure chest (wooden base, iron/gold straps, hinged curved lid,
   * gold lock plate, and a subtle glowing ground ring so it reads clearly in the grass).
   */
  private buildChestMesh(isRare: boolean): {
    root: THREE.Group;
    lidPivot: THREE.Group;
    glowRing: THREE.Mesh;
  } {
    const root = new THREE.Group();

    const woodColor = isRare ? 0x6b2d26 : 0x6e4223; // Crimson-mahogany for rare chests, oak for standard
    const trimColor = isRare ? 0xffd147 : 0xd4a238; // Bright gold vs brass-gold trim

    const matWood = new THREE.MeshStandardMaterial({
      color: woodColor,
      roughness: 0.78,
      metalness: 0.08,
    });
    const matTrim = new THREE.MeshStandardMaterial({
      color: trimColor,
      roughness: 0.3,
      metalness: 0.82,
      emissive: isRare ? 0x4a3200 : 0x241700,
      emissiveIntensity: 0.4,
    });
    const matGoldInside = new THREE.MeshStandardMaterial({
      color: 0xffdf4f,
      roughness: 0.25,
      metalness: 0.9,
      emissive: 0x664800,
      emissiveIntensity: 0.6,
    });

    // Chest base box
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.48, 0.62), matWood);
    base.position.y = 0.24;
    root.add(base);

    // Gold/brass vertical corner straps on base
    const strapGeo = new THREE.BoxGeometry(0.1, 0.5, 0.66);
    const strapL = new THREE.Mesh(strapGeo, matTrim);
    strapL.position.set(-0.34, 0.24, 0);
    const strapR = new THREE.Mesh(strapGeo, matTrim);
    strapR.position.set(0.34, 0.24, 0);
    root.add(strapL, strapR);

    // Gold coins mound inside the base (visible when lid opens!)
    const goldMound = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      matGoldInside
    );
    goldMound.scale.set(1.15, 0.45, 0.72);
    goldMound.position.set(0, 0.42, 0);
    root.add(goldMound);

    // Hinged Lid Pivot at back top edge of base
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.48, -0.31);
    root.add(lidPivot);

    // Rounded chest lid
    const lidBox = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.16, 0.62), matWood);
    lidBox.position.set(0, 0.08, 0.31);
    lidPivot.add(lidBox);

    const lidArch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.31, 0.31, 0.92, 12, 1, false, 0, Math.PI),
      matWood
    );
    lidArch.rotation.z = Math.PI / 2;
    lidArch.scale.set(1, 0.72, 1);
    lidArch.position.set(0, 0.14, 0.31);
    lidPivot.add(lidArch);

    // Lid gold straps
    const lidStrapGeo = new THREE.BoxGeometry(0.11, 0.28, 0.66);
    const lidStrapL = new THREE.Mesh(lidStrapGeo, matTrim);
    lidStrapL.position.set(-0.34, 0.14, 0.31);
    const lidStrapR = new THREE.Mesh(lidStrapGeo, matTrim);
    lidStrapR.position.set(0.34, 0.14, 0.31);
    lidPivot.add(lidStrapL, lidStrapR);

    // Front golden lock clasp
    const lockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.06), matTrim);
    lockPlate.position.set(0, 0.02, 0.63);
    lidPivot.add(lockPlate);

    // Subtle ground glow ring so chests stand out amidst tall grass
    const ringGeo = new THREE.RingGeometry(0.58, 0.82, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: isRare ? 0xffae00 : 0xffe066,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
    });
    const glowRing = new THREE.Mesh(ringGeo, ringMat);
    glowRing.position.y = 0.08;
    root.add(glowRing);

    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj !== glowRing) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    return { root, lidPivot, glowRing };
  }

  /**
   * Synchronizes treasure chests with currently loaded chunk coordinates around the player.
   */
  public update(
    dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3
  ): void {
    const size = this.config.chunkSize;
    const r = this.config.renderRadius;
    const centerCx = Math.round(playerPos.x / size);
    const centerCz = Math.round(playerPos.z / size);

    const desiredKeys = new Set<string>();

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > (r + 0.5) * (r + 0.5)) continue;
        const cx = centerCx + dx;
        const cz = centerCz + dz;
        const key = `${cx},${cz}`;
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

    // Check proximity & animate idle glow / collection
    const pickupRadiusSq = 1.95 * 1.95;

    for (const list of this.activeChests.values()) {
      for (const chest of list) {
        if (chest.state !== 'idle') continue;

        // Pulse ground aura gently
        const pulse = 1.0 + Math.sin(elapsedTime * 3.5 + chest.worldPos.x) * 0.08;
        chest.glowRing.scale.setScalar(pulse);

        const dx = playerPos.x - chest.worldPos.x;
        const dz = playerPos.z - chest.worldPos.z;
        if (dx * dx + dz * dz <= pickupRadiusSq) {
          this.collectChest(chest);
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

      if (t >= 1.42) {
        this.group.remove(chest.root);
        chest.state = 'collected';
        this.openingChests.splice(i, 1);
      }
    }
  }

  private spawnChestsForChunk(cx: number, cz: number, chunkKey: string): void {
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
    const normal = new THREE.Vector3();

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

        this.noise.getNormal(wx, wz, normal);
        if (normal.y < 0.82) continue;

        const isRare = !isStartChunk && rng() < 0.22;
        const points = isRare ? 250 : 100;
        const { root, lidPivot, glowRing } = this.buildChestMesh(isRare);

        root.position.set(wx, wy, wz);
        root.rotation.y = rng() * Math.PI * 2;
        this.group.add(root);

        list.push({
          id,
          cx,
          cz,
          worldPos: new THREE.Vector3(wx, wy, wz),
          points,
          isRare,
          root,
          lidPivot,
          glowRing,
          state: 'idle',
          animTime: 0,
        });
        placed = true;
      }
    }

    this.activeChests.set(chunkKey, list);
  }

  private collectChest(chest: ChestInstance): void {
    chest.state = 'opening';
    this.collectedIds.add(chest.id);
    this.score += chest.points;
    this.chestsCollected += 1;

    // Create golden coin/sparkle burst particles
    const count = 24;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = 0.15 + Math.random() * 0.45;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = Math.random() * 0.6;
      positions[i * 3 + 2] = Math.sin(angle) * r;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0xffe047,
      size: 0.22,
    });
    const sparkles = new THREE.Points(pGeo, pMat);
    sparkles.position.y = 0.5;
    chest.root.add(sparkles);
    chest.sparkles = sparkles;

    this.openingChests.push(chest);
    this.updateHUD(chest.points, chest.isRare);
    this.playPickupChime(chest.isRare);
  }

  private updateHUD(addedPoints: number, isRare: boolean): void {
    if (this.scoreEl) {
      this.scoreEl.textContent = this.score.toLocaleString();
    }
    if (this.countEl) {
      this.countEl.textContent = `${this.chestsCollected} Chest${this.chestsCollected === 1 ? '' : 's'}`;
    }

    const badge = document.getElementById('treasure-hud');
    if (badge) {
      badge.classList.remove('pop');
      void badge.offsetWidth;
      badge.classList.add('pop');
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

    return bestPos ? { dist: Math.sqrt(bestDistSq), pos: bestPos } : null;
  }

  public rebuildAll(): void {
    for (const list of this.activeChests.values()) {
      for (const c of list) {
        this.group.remove(c.root);
      }
    }
    this.activeChests.clear();
  }
}
