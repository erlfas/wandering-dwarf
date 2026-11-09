import * as THREE from 'three';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { RelicStore } from '../player/RelicStore';

export interface SavedTombstone {
  x: number;
  y: number;
  z: number;
  gold: number;
  active: boolean;
}

export class TombstoneManager {
  public readonly group = new THREE.Group();

  private state: SavedTombstone | null = null;
  private plinthMesh: THREE.Mesh;
  private crystalMesh: THREE.Mesh;
  private beamMesh: THREE.Mesh;
  private ringMesh: THREE.Mesh;

  private matPlinth: THREE.MeshStandardMaterial;
  private matCrystal: THREE.MeshStandardMaterial;
  private matBeam: THREE.MeshBasicMaterial;
  private matRing: THREE.MeshBasicMaterial;

  public onTombstoneClaimed?: (gold: number) => void;

  constructor(
    private dwarf: DwarfCharacter,
    private relicStore: RelicStore
  ) {
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;

    // 1. Plinth geometry & material
    const plinthGeo = new THREE.CylinderGeometry(0.85, 1.1, 0.45, 8);
    this.matPlinth = new THREE.MeshStandardMaterial({
      color: 0x2b2d42,
      roughness: 0.85,
      metalness: 0.25,
    });
    this.plinthMesh = new THREE.Mesh(plinthGeo, this.matPlinth);
    this.plinthMesh.position.y = 0.22;
    this.plinthMesh.castShadow = true;
    this.plinthMesh.receiveShadow = true;
    this.group.add(this.plinthMesh);

    // 2. Ancestral Spirit Crystal
    const crystalGeo = new THREE.OctahedronGeometry(0.48, 0);
    crystalGeo.scale(0.8, 1.6, 0.8);
    this.matCrystal = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.95,
      roughness: 0.15,
      metalness: 0.8,
    });
    this.crystalMesh = new THREE.Mesh(crystalGeo, this.matCrystal);
    this.crystalMesh.position.y = 1.35;
    this.group.add(this.crystalMesh);

    // 3. Ethereal Sky-Beam (visible from hundreds of meters)
    const beamGeo = new THREE.CylinderGeometry(0.24, 0.45, 64.0, 12, 1, true);
    this.matBeam = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.beamMesh = new THREE.Mesh(beamGeo, this.matBeam);
    this.beamMesh.position.y = 32.0;
    this.group.add(this.beamMesh);

    // 4. Ground Spirit Aura Ring
    const ringGeo = new THREE.RingGeometry(0.8, 1.85, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.matRing = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
    });
    this.ringMesh = new THREE.Mesh(ringGeo, this.matRing);
    this.ringMesh.position.y = 0.05;
    this.group.add(this.ringMesh);
  }

  public placeTombstone(x: number, y: number, z: number, gold: number): void {
    if (this.state && this.state.active) {
      this.state.gold += gold;
      this.state.x = x;
      this.state.y = y;
      this.state.z = z;
    } else {
      this.state = {
        x,
        y,
        z,
        gold,
        active: true,
      };
    }

    this.group.position.set(x, y, z);
    this.group.updateMatrix();
    this.group.updateMatrixWorld(true);
    this.group.visible = true;
  }

  public getActiveTombstone(): SavedTombstone | null {
    if (this.state && this.state.active) {
      return this.state;
    }
    return null;
  }

  public clearTombstone(): void {
    if (this.state) {
      this.state.active = false;
      this.state.gold = 0;
    }
    this.group.visible = false;
  }

  public loadFromSaved(saved?: SavedTombstone): void {
    if (saved && saved.active && saved.gold > 0) {
      this.placeTombstone(saved.x, saved.y, saved.z, saved.gold);
    } else {
      this.clearTombstone();
    }
  }

  public getSavedState(): SavedTombstone | undefined {
    if (this.state && this.state.active && this.state.gold > 0) {
      return { ...this.state };
    }
    return undefined;
  }

  public update(
    _dt: number,
    elapsedTime: number,
    playerPos: THREE.Vector3
  ): { canClaim: boolean; dist: number; gold: number } {
    if (!this.state || !this.state.active) {
      return { canClaim: false, dist: Infinity, gold: 0 };
    }

    // Animate crystal rotation and floating bob
    this.crystalMesh.rotation.y = elapsedTime * 1.8;
    this.crystalMesh.rotation.z = Math.sin(elapsedTime * 2.2) * 0.12;
    this.crystalMesh.position.y = 1.35 + Math.sin(elapsedTime * 3.0) * 0.12;

    // Pulse beam and aura ring
    this.matBeam.opacity = 0.35 + Math.sin(elapsedTime * 4.0) * 0.15;
    this.matRing.opacity = 0.45 + Math.sin(elapsedTime * 3.5) * 0.2;
    const ringScale = 1.0 + Math.sin(elapsedTime * 2.5) * 0.08;
    this.ringMesh.scale.set(ringScale, ringScale, ringScale);

    const dx = playerPos.x - this.state.x;
    const dz = playerPos.z - this.state.z;
    const distSq = dx * dx + dz * dz;

    // Check interaction range (within 2.6m)
    if (distSq <= 2.6 * 2.6) {
      return { canClaim: true, dist: Math.sqrt(distSq), gold: this.state.gold };
    }

    return { canClaim: false, dist: Math.sqrt(distSq), gold: this.state.gold };
  }

  public claim(): number {
    if (!this.state || !this.state.active) return 0;
    const gold = this.state.gold;
    const x = this.state.x;
    const y = this.state.y;
    const z = this.state.z;

    this.clearTombstone();
    this.dwarf.spawnBurst(x, y + 1.2, z, 36);
    this.relicStore.playSpeedGateChimeSound(3);
    this.onTombstoneClaimed?.(gold);
    return gold;
  }

  public dispose(): void {
    this.plinthMesh.geometry.dispose();
    this.crystalMesh.geometry.dispose();
    this.beamMesh.geometry.dispose();
    this.ringMesh.geometry.dispose();
    this.matPlinth.dispose();
    this.matCrystal.dispose();
    this.matBeam.dispose();
    this.matRing.dispose();
  }
}
