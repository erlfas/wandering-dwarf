import * as THREE from 'three';
import { WorldConfig } from './Config';
import { TerrainNoise } from './TerrainNoise';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { RelicStore } from '../player/RelicStore';
import { ChunkManager } from './ChunkManager';

export interface MineEntrance {
  id: string;
  name: string;
  x: number;
  z: number;
  y: number;
  heading: number;
  group: THREE.Group;
}

export interface RotatableMirror {
  id: string;
  pos: THREE.Vector3;
  angleIndex: number; // 0..7 (45 deg steps)
  group: THREE.Group;
  pedestalMesh: THREE.Mesh;
  mirrorDisc: THREE.Mesh;
}

export interface OreVein {
  pos: THREE.Vector3;
  type: 'gold' | 'star_iron';
  mined: boolean;
  mesh: THREE.Mesh;
}

export class DwarvenUndergroundManager {
  public readonly group = new THREE.Group();

  // Entrance Portals in the exterior world
  private entrances: MineEntrance[] = [];
  private nearestEntrance: MineEntrance | null = null;
  private nearestEntranceDist = Infinity;

  // Interior Cavern State
  private isInsideCavern = false;
  private activeEntrance: MineEntrance | null = null;
  private savedOutdoorPose = { x: 0, y: 0, z: 0, heading: 0 };
  private cavernGroup = new THREE.Group();
  private cavernLight!: THREE.PointLight; // Keeps NUM_POINT_LIGHTS = 1

  // Light-Beam Puzzle
  private mirrors: RotatableMirror[] = [];
  private beamLine!: THREE.Line;
  private beamGeo!: THREE.BufferGeometry;
  private beamMat!: THREE.LineBasicMaterial;
  private beamPositions = new Float32Array(18); // up to 6 vertices x 3
  private puzzleSolved = false;
  private sensorGemMesh!: THREE.Mesh;
  private vaultGateMesh!: THREE.Mesh;
  private vaultGateY = 0;

  // Ore Veins & Ancestral Vault
  private oreVeins: OreVein[] = [];
  private vaultPlinthMesh!: THREE.Mesh;
  private vaultClaimed = false;
  private elevatorRingMesh!: THREE.Mesh;

  // DOM Prompt
  private promptEl: HTMLElement | null = null;

  // Callbacks
  public onCameraShake?: (intensity: number, duration: number) => void;
  public onGrantBonusGold?: (amount: number, message: string) => void;
  public onStateChanged?: () => void;

  public getActiveEntrance(): MineEntrance | null {
    return this.activeEntrance;
  }

  constructor(
    _config: WorldConfig,
    _noise: TerrainNoise,
    private chunkManager: ChunkManager,
    private dwarf: DwarfCharacter,
    private relicStore: RelicStore,
    private exteriorSceneGroups: THREE.Object3D[],
    private setPlayerPose: (
      x: number,
      z: number,
      heading: number,
      yaw: number,
      pitch: number,
      distance: number
    ) => void
  ) {
    this.group.matrixAutoUpdate = false;
    this.initMineEntrances();
    this.buildCavernInteriorStage();
    this.initDOM();
    this.bindKeyListeners();
  }

  private initMineEntrances(): void {
    const entranceDefs = [
      { id: 'mine_iron_vein', name: 'Iron-Vein Mineshaft', x: -180, z: 80, heading: 0.8 },
      { id: 'mine_deep_chasm', name: 'Deep-Chasm Delve', x: 90, z: -160, heading: -1.2 },
      { id: 'mine_royal_vault', name: 'Ancestral Vault Entrance', x: 260, z: -90, heading: 2.4 },
    ];

    const timberMat = new THREE.MeshStandardMaterial({
      color: 0x5c3d2e,
      roughness: 0.85,
    });
    const stoneArchMat = new THREE.MeshStandardMaterial({
      color: 0x474a51,
      roughness: 0.9,
    });

    for (const def of entranceDefs) {
      const y = this.chunkManager.getSurfaceHeight(def.x, def.z);
      const portalGroup = new THREE.Group();
      portalGroup.position.set(def.x, y, def.z);
      portalGroup.rotation.y = def.heading;

      // Heavy Timber Lintel Frame
      const postL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 3.8, 0.55), timberMat);
      postL.position.set(-1.8, 1.9, 0);
      postL.castShadow = true;
      portalGroup.add(postL);

      const postR = new THREE.Mesh(new THREE.BoxGeometry(0.55, 3.8, 0.55), timberMat);
      postR.position.set(1.8, 1.9, 0);
      postR.castShadow = true;
      portalGroup.add(postR);

      const header = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.65, 0.65), timberMat);
      header.position.set(0, 3.8, 0);
      header.castShadow = true;
      portalGroup.add(header);

      // Stone Arch lintel
      const arch = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.75, 1.2), stoneArchMat);
      arch.position.set(0, 4.4, -0.2);
      portalGroup.add(arch);

      // Minecart Tracks leading inside
      const railMat = new THREE.MeshStandardMaterial({
        color: 0x2b2d42,
        roughness: 0.4,
        metalness: 0.8,
      });
      const railL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 4.0), railMat);
      railL.position.set(-0.6, 0.05, -1.0);
      portalGroup.add(railL);

      const railR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 4.0), railMat);
      railR.position.set(0.6, 0.05, -1.0);
      portalGroup.add(railR);

      // Runic Doorstep Portal Ring
      const ringGeo = new THREE.RingGeometry(1.2, 1.6, 20);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x48cae4,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.set(0, 0.04, 0);
      portalGroup.add(ringMesh);

      this.group.add(portalGroup);
      this.entrances.push({
        id: def.id,
        name: def.name,
        x: def.x,
        z: def.z,
        y,
        heading: def.heading,
        group: portalGroup,
      });
    }
  }

  private buildCavernInteriorStage(): void {
    // Isolated subterranean position at Y = -420
    const stageY = -420;
    this.cavernGroup.position.set(0, stageY, 0);
    this.cavernGroup.visible = false;
    this.cavernGroup.matrixAutoUpdate = false;

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x343a40,
      roughness: 0.92,
      metalness: 0.1,
    });
    const timberMat = new THREE.MeshStandardMaterial({
      color: 0x4a3525,
      roughness: 0.85,
    });

    // 1. Great Cavern Chamber Floor (28m x 36m)
    const floorGeo = new THREE.BoxGeometry(28, 0.6, 36);
    floorGeo.translate(0, -0.3, 0);
    const floorMesh = new THREE.Mesh(floorGeo, rockMat);
    floorMesh.receiveShadow = true;
    this.cavernGroup.add(floorMesh);

    // 2. High Arched Cavern Walls & Ceiling
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.8, 12, 36), rockMat);
    wallL.position.set(-14, 6, 0);
    this.cavernGroup.add(wallL);

    const wallR = new THREE.Mesh(new THREE.BoxGeometry(0.8, 12, 36), rockMat);
    wallR.position.set(14, 6, 0);
    this.cavernGroup.add(wallR);

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(28, 12, 0.8), rockMat);
    backWall.position.set(0, 6, -18);
    this.cavernGroup.add(backWall);

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(28, 0.8, 36), rockMat);
    ceiling.position.set(0, 12, 0);
    this.cavernGroup.add(ceiling);

    // Timber Arch Supports across the cavern
    for (let z = -12; z <= 12; z += 6) {
      const archGroup = new THREE.Group();
      archGroup.position.set(0, 0, z);

      const colL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 9.5, 0.45), timberMat);
      colL.position.set(-11.5, 4.75, 0);
      archGroup.add(colL);

      const colR = new THREE.Mesh(new THREE.BoxGeometry(0.45, 9.5, 0.45), timberMat);
      colR.position.set(11.5, 4.75, 0);
      archGroup.add(colR);

      const beam = new THREE.Mesh(new THREE.BoxGeometry(23.5, 0.55, 0.55), timberMat);
      beam.position.set(0, 9.5, 0);
      archGroup.add(beam);

      this.cavernGroup.add(archGroup);
    }

    // 3. Constant NUM_POINT_LIGHTS = 1 Interior Cavern Light
    // Beautiful bioluminescent amethyst/aquamarine crystal radiance
    this.cavernLight = new THREE.PointLight(0x72efdd, 3.8, 32.0, 1.2);
    this.cavernLight.position.set(0, 7.5, 0);
    this.cavernLight.updateMatrix();
    this.cavernLight.matrixAutoUpdate = false;
    this.cavernGroup.add(this.cavernLight);

    // Glowing Crystal Clusters on walls
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0x72efdd,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0x48cae4,
      emissiveIntensity: 0.95,
    });
    for (let i = 0; i < 8; i++) {
      const x = (i % 2 === 0 ? -13.2 : 13.2);
      const z = -14 + i * 4.0;
      const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.8, 5), crystalMat);
      crystal.position.set(x, 2.5, z);
      crystal.rotation.z = (i % 2 === 0 ? -0.4 : 0.4);
      this.cavernGroup.add(crystal);
    }

    // 4. Ore Veins on Walls (Mineable)
    const oreLocations = [
      { x: -13.4, y: 1.6, z: -6.0, type: 'gold' as const },
      { x: -13.4, y: 1.8, z: 4.0, type: 'star_iron' as const },
      { x: 13.4, y: 1.6, z: -8.0, type: 'gold' as const },
      { x: 13.4, y: 1.9, z: 6.0, type: 'star_iron' as const },
    ];

    for (const ore of oreLocations) {
      const mat = new THREE.MeshStandardMaterial({
        color: ore.type === 'gold' ? 0xffd166 : 0x00f5d4,
        roughness: 0.25,
        metalness: 0.9,
        emissive: ore.type === 'gold' ? 0xff9f1c : 0x00bbf9,
        emissiveIntensity: 0.75,
      });
      const oreMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.72, 1), mat);
      oreMesh.position.set(ore.x, ore.y, ore.z);
      this.cavernGroup.add(oreMesh);
      this.oreVeins.push({
        pos: new THREE.Vector3(ore.x, ore.y, ore.z),
        type: ore.type,
        mined: false,
        mesh: oreMesh,
      });
    }

    // 5. Light-Beam Refraction Puzzle: 3 Rotatable Brass Mirrors
    this.buildLightBeamPuzzle();

    // 6. Ancestral Vault Gate & Vault Chamber
    this.buildAncestralVaultChamber();

    this.group.add(this.cavernGroup);
  }

  private buildLightBeamPuzzle(): void {
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xe0a938,
      roughness: 0.25,
      metalness: 0.9,
    });
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x495057,
      roughness: 0.85,
    });

    const mirrorPositions = [
      { id: 'mirror_a', pos: new THREE.Vector3(0, 0, -8.0) },
      { id: 'mirror_b', pos: new THREE.Vector3(7.5, 0, -8.0) },
      { id: 'mirror_c', pos: new THREE.Vector3(7.5, 0, 4.0) },
    ];

    for (const mDef of mirrorPositions) {
      const group = new THREE.Group();
      group.position.copy(mDef.pos);

      // Stone Pedestal
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 1.2, 8), stoneMat);
      pedestal.position.y = 0.6;
      group.add(pedestal);

      // Rotatable Mirror Disc on Brass Fork
      const fork = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 0.12), brassMat);
      fork.position.y = 1.45;
      group.add(fork);

      const mirrorDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.65, 0.08, 16),
        brassMat
      );
      mirrorDisc.rotateX(Math.PI / 2);
      mirrorDisc.position.y = 1.7;
      group.add(mirrorDisc);

      this.cavernGroup.add(group);
      this.mirrors.push({
        id: mDef.id,
        pos: mDef.pos,
        angleIndex: 0,
        group,
        pedestalMesh: pedestal,
        mirrorDisc,
      });
    }

    // Light Beam Line
    this.beamGeo = new THREE.BufferGeometry();
    this.beamGeo.setAttribute('position', new THREE.BufferAttribute(this.beamPositions, 3));
    this.beamMat = new THREE.LineBasicMaterial({
      color: 0xffea00,
      linewidth: 3,
      transparent: true,
      opacity: 0.95,
    });
    this.beamLine = new THREE.Line(this.beamGeo, this.beamMat);
    this.beamLine.frustumCulled = false;
    this.cavernGroup.add(this.beamLine);

    this.recalculateLightBeam();
  }

  private buildAncestralVaultChamber(): void {
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x3d3a45,
      roughness: 0.9,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      roughness: 0.2,
      metalness: 0.9,
      emissive: 0xff9f1c,
      emissiveIntensity: 0.85,
    });

    // Vault Sensor Crystal (Target for Light Beam)
    const gemGeo = new THREE.OctahedronGeometry(0.45, 0);
    const gemMat = new THREE.MeshStandardMaterial({
      color: 0xff0054,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0xff0054,
      emissiveIntensity: 0.45,
    });
    this.sensorGemMesh = new THREE.Mesh(gemGeo, gemMat);
    this.sensorGemMesh.position.set(-7.5, 1.7, 4.0);
    this.cavernGroup.add(this.sensorGemMesh);

    // Vault Stone Gate (slides down when puzzle solved)
    const gateGeo = new THREE.BoxGeometry(6.5, 7.5, 0.8);
    this.vaultGateMesh = new THREE.Mesh(gateGeo, stoneMat);
    this.vaultGateMesh.position.set(-7.5, 3.75, 4.5);
    this.cavernGroup.add(this.vaultGateMesh);

    // Ancestral Relic Plinth inside the vault chamber
    const plinthGeo = new THREE.CylinderGeometry(0.85, 1.1, 1.1, 8);
    this.vaultPlinthMesh = new THREE.Mesh(plinthGeo, goldMat);
    this.vaultPlinthMesh.position.set(-7.5, 0.55, 10.5);
    this.cavernGroup.add(this.vaultPlinthMesh);

    // King's Throne behind plinth
    const throne = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.6, 1.6), stoneMat);
    throne.position.set(-7.5, 1.8, 14.5);
    this.cavernGroup.add(throne);

    // Surface Shortcut Elevator Ring in center of chamber
    const elevGeo = new THREE.RingGeometry(1.4, 1.9, 24);
    elevGeo.rotateX(-Math.PI / 2);
    const elevMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.elevatorRingMesh = new THREE.Mesh(elevGeo, elevMat);
    this.elevatorRingMesh.position.set(0, 0.05, 12.0);
    this.cavernGroup.add(this.elevatorRingMesh);
  }

  private initDOM(): void {
    this.promptEl = document.createElement('div');
    this.promptEl.id = 'underground-prompt';
    this.promptEl.style.position = 'fixed';
    this.promptEl.style.bottom = '125px';
    this.promptEl.style.left = '50%';
    this.promptEl.style.transform = 'translateX(-50%)';
    this.promptEl.style.background = 'rgba(15, 23, 42, 0.88)';
    this.promptEl.style.border = '1px solid #38bdf8';
    this.promptEl.style.borderRadius = '8px';
    this.promptEl.style.padding = '8px 18px';
    this.promptEl.style.color = '#e0f2fe';
    this.promptEl.style.fontFamily = 'system-ui, sans-serif';
    this.promptEl.style.fontWeight = 'bold';
    this.promptEl.style.fontSize = '14px';
    this.promptEl.style.display = 'none';
    this.promptEl.style.zIndex = '45';
    this.promptEl.style.pointerEvents = 'none';
    document.body.appendChild(this.promptEl);
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

      if (e.code === 'KeyE') {
        if (!this.isInsideCavern) {
          if (this.nearestEntrance && this.nearestEntranceDist <= 3.4) {
            e.stopImmediatePropagation();
            this.enterMineshaft(this.nearestEntrance);
          }
        } else {
          // Inside Cavern: Check Mirror Rotation, Vault Plinth Claim, or Elevator Exit
          const dwarfPos = this.dwarf.root.position;

          // 1. Check Mirror Interaction
          for (const m of this.mirrors) {
            if (dwarfPos.distanceTo(m.pos) <= 2.6) {
              e.stopImmediatePropagation();
              this.rotateMirror(m);
              return;
            }
          }

          // 2. Check Ancestral Vault Plinth Claim
          if (this.puzzleSolved && !this.vaultClaimed) {
            const plinthPos = new THREE.Vector3(-7.5, 0, 10.5);
            if (dwarfPos.distanceTo(plinthPos) <= 3.0) {
              e.stopImmediatePropagation();
              this.claimVaultHoard();
              return;
            }
          }

          // 3. Check Surface Shortcut Elevator Exit
          const elevPos = new THREE.Vector3(0, 0, 12.0);
          if (dwarfPos.distanceTo(elevPos) <= 2.8) {
            e.stopImmediatePropagation();
            this.exitCavernToSurface();
            return;
          }
        }
      }
    });
  }

  public isUnderground(): boolean {
    return this.isInsideCavern;
  }

  public enterMineshaft(entrance: MineEntrance): void {
    this.isInsideCavern = true;
    this.activeEntrance = entrance;

    // Save outdoor pose
    const p = this.dwarf.root.position;
    this.savedOutdoorPose = {
      x: p.x,
      y: p.y,
      z: p.z,
      heading: this.dwarf.heading,
    };

    // Hide exterior world groups
    for (const g of this.exteriorSceneGroups) {
      g.visible = false;
    }

    this.cavernGroup.visible = true;
    this.cavernLight.visible = true;

    // Teleport dwarf inside cavern entrance: (0, 0, -14.0)
    this.setPlayerPose(0, -14.0, 0, 0, 0.42, 9.5);

    this.relicStore.playCavernCrystalChime();
    this.onGrantBonusGold?.(
      0,
      `⛏️ Entered ${entrance.name}! Solve the Light-Beam Refraction Puzzle (E) to unlock the Ancestral Vault!`
    );
    this.onStateChanged?.();
  }

  public exitCavernToSurface(): void {
    if (!this.isInsideCavern) return;
    this.isInsideCavern = false;

    // Restore exterior groups
    for (const g of this.exteriorSceneGroups) {
      g.visible = true;
    }

    this.cavernGroup.visible = false;
    this.cavernLight.visible = false;

    // Restore dwarf to outdoor entrance
    const out = this.savedOutdoorPose;
    this.setPlayerPose(out.x, out.z, out.heading, out.heading + Math.PI, 0.46, 11.5);

    this.relicStore.playCavernCrystalChime();
    this.onGrantBonusGold?.(0, '☀️ Ascended from the Mineshaft back to the Mountain surface!');
    this.onStateChanged?.();
  }

  public rotateMirror(mirror: RotatableMirror): void {
    mirror.angleIndex = (mirror.angleIndex + 1) % 8;
    mirror.group.rotation.y = mirror.angleIndex * (Math.PI / 4);

    this.relicStore.playMirrorRotateSound();
    this.dwarf.spawnBurst(mirror.pos.x, mirror.pos.y + 1.6, mirror.pos.z, 10);
    this.recalculateLightBeam();
  }

  private recalculateLightBeam(): void {
    // Light Beam Path:
    // Starts from Ceiling Skylight at (0, 10, -8) -> Mirror A (0, 1.7, -8)
    // -> Bounces depending on mirror angles!
    this.beamPositions[0] = 0;
    this.beamPositions[1] = 10;
    this.beamPositions[2] = -8;

    this.beamPositions[3] = 0;
    this.beamPositions[4] = 1.7;
    this.beamPositions[5] = -8;

    // When Mirror A is at 45 deg (angleIndex 1 or 5), beam reflects towards Mirror B at (7.5, 1.7, -8)
    const mA = this.mirrors[0];
    const mB = this.mirrors[1];
    const mC = this.mirrors[2];

    const mirrorAAligned = mA.angleIndex === 1 || mA.angleIndex === 5;
    const mirrorBAligned = mB.angleIndex === 2 || mB.angleIndex === 6;
    const mirrorCAligned = mC.angleIndex === 3 || mC.angleIndex === 7;

    if (mirrorAAligned) {
      this.beamPositions[6] = 7.5;
      this.beamPositions[7] = 1.7;
      this.beamPositions[8] = -8.0;

      if (mirrorBAligned) {
        this.beamPositions[9] = 7.5;
        this.beamPositions[10] = 1.7;
        this.beamPositions[11] = 4.0;

        if (mirrorCAligned) {
          // Hits Sensor Gem at (-7.5, 1.7, 4.0)!
          this.beamPositions[12] = -7.5;
          this.beamPositions[13] = 1.7;
          this.beamPositions[14] = 4.0;

          if (!this.puzzleSolved) {
            this.solveLightBeamPuzzle();
          }
        } else {
          this.beamPositions[12] = 13.0;
          this.beamPositions[13] = 1.7;
          this.beamPositions[14] = 4.0;
        }
      } else {
        this.beamPositions[9] = 7.5;
        this.beamPositions[10] = 1.7;
        this.beamPositions[11] = -14.0;
        this.beamPositions[12] = 7.5;
        this.beamPositions[13] = 1.7;
        this.beamPositions[14] = -14.0;
      }
    } else {
      this.beamPositions[6] = -7.0;
      this.beamPositions[7] = 1.7;
      this.beamPositions[8] = -8.0;
      this.beamPositions[9] = -7.0;
      this.beamPositions[10] = 1.7;
      this.beamPositions[11] = -8.0;
      this.beamPositions[12] = -7.0;
      this.beamPositions[13] = 1.7;
      this.beamPositions[14] = -8.0;
    }

    this.beamGeo.attributes.position.needsUpdate = true;
  }

  private solveLightBeamPuzzle(): void {
    this.puzzleSolved = true;
    (this.sensorGemMesh.material as THREE.MeshStandardMaterial).color.setHex(0x00f5d4);
    (this.sensorGemMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x00f5d4);
    (this.sensorGemMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.8;

    this.relicStore.playVaultGateOpenSound();
    this.onCameraShake?.(0.48, 0.4);
    this.dwarf.spawnBurst(-7.5, 2.0, 4.0, 35);

    this.onGrantBonusGold?.(
      0,
      '🔓 LIGHT-BEAM PUZZLE SOLVED! Ancestral Vault of the Mountain Kings has opened!'
    );
  }

  public tryMineOre(playerPos: THREE.Vector3): boolean {
    if (!this.isInsideCavern) return false;

    for (const ore of this.oreVeins) {
      if (!ore.mined && playerPos.distanceTo(ore.pos) <= 3.2) {
        ore.mined = true;
        ore.mesh.scale.setScalar(0.35);

        this.relicStore.playOreMinedSound();
        this.dwarf.spawnBurst(ore.pos.x, ore.pos.y, ore.pos.z, 14);

        const goldReward = ore.type === 'star_iron' ? 150 : 100;
        this.onGrantBonusGold?.(
          goldReward,
          `⛏️ Mined Cavern ${ore.type === 'star_iron' ? 'Celestial Star-Iron' : 'Gold'} Vein! +${goldReward} Gold`
        );
        return true;
      }
    }
    return false;
  }

  private claimVaultHoard(): void {
    this.vaultClaimed = true;
    this.vaultPlinthMesh.scale.setScalar(0.45);

    this.relicStore.playSpeedGateChimeSound(6);
    this.onCameraShake?.(0.45, 0.35);
    this.dwarf.spawnBurst(-7.5, 1.2, 10.5, 50);

    this.onGrantBonusGold?.(
      800,
      '👑 CLAIMED ANCESTRAL VAULT HOARD! +800 Gold & Aegis of the Under-King (+15 Max ❤️ & +15% Parry Damage)!'
    );
  }

  public update(dt: number, _elapsedTime: number, playerPos: THREE.Vector3): void {
    if (!this.isInsideCavern) {
      // Find nearest outdoor entrance
      let nearest: MineEntrance | null = null;
      let minDist = Infinity;
      for (const ent of this.entrances) {
        const d = playerPos.distanceTo(new THREE.Vector3(ent.x, ent.y, ent.z));
        if (d < minDist) {
          minDist = d;
          nearest = ent;
        }
      }
      this.nearestEntrance = nearest;
      this.nearestEntranceDist = minDist;

      if (this.promptEl) {
        if (nearest && minDist <= 3.4) {
          this.promptEl.style.display = 'block';
          this.promptEl.textContent = `[E] Enter ${nearest.name}`;
        } else {
          this.promptEl.style.display = 'none';
        }
      }
    } else {
      // Inside Cavern
      if (this.puzzleSolved && this.vaultGateY > -6.5) {
        this.vaultGateY -= dt * 2.8;
        this.vaultGateMesh.position.y = 3.75 + this.vaultGateY;
      }

      // Cavern Prompts
      if (this.promptEl) {
        let promptText = '';
        for (const m of this.mirrors) {
          if (playerPos.distanceTo(m.pos) <= 2.6) {
            promptText = `[E] Rotate Mirror (${m.angleIndex * 45}°)`;
            break;
          }
        }
        if (!promptText && this.puzzleSolved && !this.vaultClaimed) {
          const plinthPos = new THREE.Vector3(-7.5, 0, 10.5);
          if (playerPos.distanceTo(plinthPos) <= 3.0) {
            promptText = '[E] Claim Ancestral Vault Hoard';
          }
        }
        if (!promptText) {
          const elevPos = new THREE.Vector3(0, 0, 12.0);
          if (playerPos.distanceTo(elevPos) <= 2.8) {
            promptText = '[E] Take Elevator to Surface';
          }
        }

        if (promptText) {
          this.promptEl.style.display = 'block';
          this.promptEl.textContent = promptText;
        } else {
          this.promptEl.style.display = 'none';
        }
      }
    }
  }

  public dispose(): void {
    this.promptEl?.remove();
    this.beamGeo.dispose();
    this.beamMat.dispose();
  }
}
