import GUI, { Controller } from 'lil-gui';
import * as THREE from 'three';
import { WorldConfig } from '../world/Config';
import { ChunkManager } from '../world/ChunkManager';
import { TerrainNoise } from '../world/TerrainNoise';
import { TreasureManager } from '../world/TreasureManager';

export class DebugOverlay {
  public readonly gui: GUI;
  private rebuildRafId: number | null = null;
  private quickSyncControllers: Controller[] = [];

  constructor(
    config: WorldConfig,
    noise: TerrainNoise,
    chunkManager: ChunkManager,
    treasureManager: TreasureManager,
    fog: THREE.FogExp2,
    getPlayerPos: () => THREE.Vector3,
    onSaveProgress?: () => void,
    onResetProgress?: () => void,
    onRebuildTerrain?: () => void
  ) {
    this.gui = new GUI({ title: 'World Planner (Phase 3)' });

    const rebuild = () => {
      if (this.rebuildRafId !== null) {
        cancelAnimationFrame(this.rebuildRafId);
      }
      this.rebuildRafId = requestAnimationFrame(() => {
        this.rebuildRafId = null;
        const p = getPlayerPos();
        chunkManager.rebuildAll(p.x, p.y, p.z);
        treasureManager.rebuildAll();
        onRebuildTerrain?.();
      });
    };

    const rebuildGrass = () => {
      if (this.rebuildRafId !== null) {
        cancelAnimationFrame(this.rebuildRafId);
      }
      this.rebuildRafId = requestAnimationFrame(() => {
        this.rebuildRafId = null;
        const p = getPlayerPos();
        chunkManager.rebuildGrassOnly(p.x, p.z);
      });
    };

    const rebuildForest = () => {
      if (this.rebuildRafId !== null) {
        cancelAnimationFrame(this.rebuildRafId);
      }
      this.rebuildRafId = requestAnimationFrame(() => {
        this.rebuildRafId = null;
        const p = getPlayerPos();
        chunkManager.rebuildForestOnly(p.x, p.z);
      });
    };

    // 1. Trees & Open Groves Folder
    const forestFolder = this.gui.addFolder('Trees & Open Groves');
    forestFolder
      .add(config, 'enableTrees')
      .name('Enable 3D Trees')
      .onChange(rebuildForest);

    forestFolder
      .add(config, 'forestCoverage', 0.0, 0.85, 0.05)
      .name('Grove vs Open Area')
      .onFinishChange(rebuild);

    forestFolder
      .add(config, 'treeDensity', 0.1, 0.85, 0.05)
      .name('Grove Sparseness')
      .onFinishChange(rebuildForest);

    forestFolder
      .add(config, 'treeScale', 0.5, 1.8, 0.05)
      .name('Tree Size')
      .onFinishChange(rebuildForest);

    forestFolder
      .add(config, 'windSpeed', 0, 5, 0.1)
      .name('Wind Speed');

    forestFolder
      .add(config, 'windStrength', 0, 0.8, 0.02)
      .name('Wind Gust Strength');

    // 1b. Forest Tracks & Trails Folder
    const trackFolder = this.gui.addFolder('Forest Tracks & Trails');
    trackFolder
      .add(config, 'enableTracks')
      .name('Enable Forest Tracks')
      .onChange(rebuild);

    trackFolder
      .add(config, 'trackWidth', 1.8, 5.5, 0.2)
      .name('Track Width (m)')
      .onFinishChange(rebuild);

    trackFolder
      .add(config, 'trackDensity', 0.0, 1.0, 0.05)
      .name('Trail Network Density')
      .onFinishChange(rebuild);

    // 2. Rivers & Ponds Folder
    const waterFolder = this.gui.addFolder('Rivers & Ponds');
    waterFolder
      .add(config, 'enableWater')
      .name('Enable Water')
      .onChange(rebuild);

    waterFolder
      .add(config, 'waterLevel', -12, 6, 0.5)
      .name('Water Level (m)')
      .onFinishChange(rebuild);

    waterFolder
      .add(config, 'riverCarveStrength', 0, 1, 0.05)
      .name('River Valley Carve')
      .onFinishChange(rebuild);

    waterFolder
      .add(config, 'riverWidth', 6, 28, 1)
      .name('River Width (m)')
      .onFinishChange(rebuild);

    waterFolder
      .add(config, 'pondFrequency', 0, 1, 0.05)
      .name('Pond Basin Frequency')
      .onFinishChange(rebuild);

    // 3. Meadow & 3D Grass Folder
    const grassFolder = this.gui.addFolder('Meadow & 3D Grass');
    grassFolder
      .add(config, 'enableGrassBlades')
      .name('3D Grass Blades')
      .onChange(rebuildGrass);

    grassFolder
      .add(config, 'enableFlowers')
      .name('Wildflowers')
      .onChange(rebuildGrass);

    grassFolder
      .add(config, 'grassDensity', 400, 6000, 200)
      .name('Tufts per Chunk')
      .onFinishChange(rebuildGrass);

    grassFolder
      .add(config, 'grassHeight', 0.4, 2.2, 0.05)
      .name('Grass Height')
      .onFinishChange(rebuildGrass);

    grassFolder
      .add(config, 'tallGrassCoverage', 0.0, 1.0, 0.05)
      .name('Waist-High Grass Areas')
      .onFinishChange(rebuildGrass);

    grassFolder
      .add(config, 'blankClayMode')
      .name('Blank Clay Mode (Phase 1)')
      .onChange(rebuild);
    grassFolder.close();

    // 4. Terrain Noise & Hill Shape Folder
    const terrainFolder = this.gui.addFolder('Hills & Valleys (Noise)');
    terrainFolder
      .add(config, 'seed', 1, 99999, 1)
      .name('World Seed')
      .onFinishChange((v: number) => {
        noise.reseed(v);
        onSaveProgress?.();
        rebuild();
      });

    terrainFolder
      .add(config, 'macroAmplitude', 0, 80, 1)
      .name('Broad Hill Height (m)')
      .onFinishChange(rebuild);

    terrainFolder
      .add(config, 'mesoAmplitude', 0, 35, 0.5)
      .name('Ridge / Knoll Height (m)')
      .onFinishChange(rebuild);

    terrainFolder
      .add(config, 'domainWarpStrength', 0, 100, 1)
      .name('Organic Hill Flow')
      .onFinishChange(rebuild);
    terrainFolder.close();

    // 5. Atmosphere, Camera & Debug
    const debugFolder = this.gui.addFolder('Atmosphere, Camera & Debug');
    debugFolder
      .add(config, 'enableDayNightCycle')
      .name('Auto Day/Night Cycle');

    const timeCtrl = debugFolder
      .add(config, 'timeOfDay', 0, 24, 0.1)
      .name('Time of Day (h) [N]');

    const camCtrl = debugFolder
      .add(config, 'cameraMode', ['dwarf', 'free'])
      .name('Camera Mode (V)');

    debugFolder
      .add(config, 'showDwarfProxy')
      .name('Show Dwarf Proxy');

    const wireCtrl = debugFolder
      .add(config, 'wireframe')
      .name('Wireframe Mesh (Shift+M)')
      .onChange((v: boolean) => {
        chunkManager.material.wireframe = v;
      });

    this.quickSyncControllers = [timeCtrl, camCtrl, wireCtrl];

    debugFolder
      .add(config, 'showChunkBorders')
      .name('Show Chunk Borders')
      .onChange((v: boolean) => {
        chunkManager.setBordersVisible(v);
      });

    debugFolder
      .add(config, 'fogDensity', 0, 0.008, 0.0002)
      .name('Horizon Mist Density')
      .onChange((v: number) => {
        fog.density = v;
      });
    debugFolder.close();

    if (onResetProgress) {
      const actions = {
        resetProgress: () => {
          onResetProgress();
        },
      };
      this.gui.add(actions, 'resetProgress').name('↺ Reset Saved Progress');
    }

    // World Planner is closed by default so the 3D viewport is clean on startup
    forestFolder.close();
    trackFolder.close();
    waterFolder.close();
    this.gui.close();
  }

  public syncDisplay(full = false): void {
    if (full) {
      this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
      return;
    }
    for (let i = 0; i < this.quickSyncControllers.length; i++) {
      this.quickSyncControllers[i].updateDisplay();
    }
  }
}
