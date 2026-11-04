import * as THREE from 'three';
import { getSharedAudioContext } from '../player/RelicStore';
import { ChunkManager } from '../world/ChunkManager';
import { WorldConfig } from '../world/Config';
import { LandmarkManager } from '../world/LandmarkManager';
import { CastleAndQuarryManager } from '../world/CastleAndQuarryManager';
import { SavedDiscoveredHut } from '../world/ProgressStorage';
import { createSeededRandom, TerrainNoise } from '../world/TerrainNoise';
import { TreasureManager } from '../world/TreasureManager';

const CELL_SIZE = 16; // 16m x 16m discovery cell (3x3 cells per 48m chunk)
const CELLS_PER_CHUNK = 3;
const TILE_RES = 48; // 1 pixel = 1 meter inside each 48m x 48m chunk tile
const MAX_TRAIL_COORDS = 1200; // Up to 600 (x, z) breadcrumb points

const WATCHTOWER_NAMES = [
  'Highpeak Beacon',
  'Cloudwatch Ruin',
  'Ironcrest Tower',
  'Windspire Lookout',
  'Sunstone Bastion',
  'Mistvale Watch',
  'Thunderridge Spire',
  'Glimmerhorn Beacon',
  'Oakenshield Watch',
  'Starfall Lookout',
];

function packCoord(x: number, z: number): number {
  return ((x & 0xffff) << 16) | (z & 0xffff);
}

function unpackX(key: number): number {
  return (key >> 16) << 16 >> 16;
}

function unpackZ(key: number): number {
  return (key << 16) >> 16;
}

function worldToCell(w: number): number {
  return Math.floor((w + 24) / CELL_SIZE);
}

function cellCenterToWorld(g: number): number {
  return (g - 1) * CELL_SIZE;
}

function cellToChunk(g: number): number {
  return Math.floor(g / CELLS_PER_CHUNK);
}

interface ChunkChestMeta {
  id: string;
  x: number;
  y: number;
  z: number;
  isRare: boolean;
  isMythic: boolean;
  points: number;
}

interface ChunkMapCache {
  cx: number;
  cz: number;
  rgbData: Uint8ClampedArray; // 48 * 48 * 3 precomputed terrain/water/forest/track RGB
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imgData: ImageData;
  dirty: boolean;
  watchtower?: { id: string; name: string; x: number; y: number; z: number };
  campfire?: { id: string; x: number; y: number; z: number };
  bridge?: { x: number; y: number; z: number; heading: number };
  chests: ChunkChestMeta[];
}

interface InteractiveMapMarker {
  id: string;
  kind:
    | 'dwarf'
    | 'spawn'
    | 'beacon_lit'
    | 'beacon_unlit'
    | 'campfire'
    | 'hut'
    | 'bridge'
    | 'chest_mythic'
    | 'chest_rare'
    | 'chest_std'
    | 'chest_opened'
    | 'dig_site'
    | 'quarry'
    | 'castle';
  title: string;
  subtitle: string;
  worldX: number;
  worldY: number;
  worldZ: number;
  screenX: number;
  screenY: number;
  radiusPx: number;
  canTeleport: boolean;
}

const tempMapNormal = new THREE.Vector3();
const scratchHeights = new Float32Array((TILE_RES + 2) * (TILE_RES + 2));
const scratchSubGrid = new Float32Array(25);

/**
 * Interactive Cartographic World Map of the entire area discovered by our dwarf.
 * Tracks fog-of-war discovery on a 16m cell grid, caches 48x48 hillshaded terrain tiles
 * per chunk, records the dwarf's exploration trail and discovered huts/landmarks/chests,
 * and supports framing the entire discovered territory, panning, zooming, and fast-travel.
 */
export class WorldMap {
  private isOpen = false;
  private discoveredCells = new Set<number>();
  private touchedChunks = new Set<number>();
  private chunkCache = new Map<number, ChunkMapCache>();
  private discoveredHuts = new Map<string, SavedDiscoveredHut>();
  private exploredTrail: number[] = [];

  // Bounding box of all world coordinates discovered by the dwarf (in meters)
  private minDiscoveredX = -56;
  private maxDiscoveredX = 56;
  private minDiscoveredZ = -56;
  private maxDiscoveredZ = 56;

  private lastRevealX = Number.NaN;
  private lastRevealZ = Number.NaN;
  private lastTrailX = Number.NaN;
  private lastTrailZ = Number.NaN;

  // Map viewport state (world meters at center of canvas, and zoom in CSS pixels per meter)
  private viewCenterX = 0;
  private viewCenterZ = 0;
  private zoom = 1.65;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panOriginCenterX = 0;
  private panOriginCenterZ = 0;
  private dragMovedSq = 0;

  // Toggleable cartographic layers
  private showTrail = true;
  private showGrid = true;
  private showMarkers = true;

  // Hover & interactive marker state
  private interactiveMarkers: InteractiveMapMarker[] = [];
  private hoveredMarker: InteractiveMapMarker | null = null;
  private pendingBakeRaf = 0;

  // DOM Elements
  private modalEl: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private statsEl: HTMLElement;
  private coordsEl: HTMLElement;
  private tooltipEl: HTMLElement;
  private toggleBtnEl: HTMLElement | null;
  private compassEl: HTMLElement | null;
  private trailToggleBtn: HTMLButtonElement;
  private markersToggleBtn: HTMLButtonElement;
  private gridToggleBtn: HTMLButtonElement;
  private castleManager?: CastleAndQuarryManager;

  public setCastleAndQuarryManager(cm: CastleAndQuarryManager): void {
    this.castleManager = cm;
  }

  constructor(
    private config: WorldConfig,
    private noise: TerrainNoise,
    private chunkManager: ChunkManager,
    private treasureManager: TreasureManager,
    private landmarkManager: LandmarkManager,
    private getPlayerPos: () => THREE.Vector3,
    private getPlayerHeading: () => number,
    private hasLodestoneRelic: () => boolean,
    private onToggleWireframe?: () => void,
    private onDiscoveryChanged?: () => void
  ) {
    this.toggleBtnEl = document.getElementById('world-map-toggle');
    this.compassEl = document.getElementById('compass-container');

    this.modalEl = document.getElementById('world-map-modal')!;
    this.canvas = document.getElementById('world-map-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.statsEl = document.getElementById('world-map-stats')!;
    this.coordsEl = document.getElementById('world-map-cursor-coords')!;
    this.tooltipEl = document.getElementById('world-map-tooltip')!;

    this.trailToggleBtn = document.getElementById('map-toggle-trail') as HTMLButtonElement;
    this.markersToggleBtn = document.getElementById('map-toggle-markers') as HTMLButtonElement;
    this.gridToggleBtn = document.getElementById('map-toggle-grid') as HTMLButtonElement;

    this.bindEvents();
  }

  public isMapOpen(): boolean {
    return this.isOpen;
  }

  private bindEvents(): void {
    this.toggleBtnEl?.addEventListener('click', () => {
      this.toggle();
    });

    if (this.compassEl) {
      this.compassEl.style.pointerEvents = 'auto';
      this.compassEl.style.cursor = 'pointer';
      this.compassEl.title = 'Click to Open Discovered World Map (M)';
      this.compassEl.addEventListener('click', () => {
        this.toggle();
      });
    }

    document.getElementById('map-btn-fit')?.addEventListener('click', () => {
      this.fitToDiscoveredArea();
      this.render();
    });

    document.getElementById('map-btn-center-dwarf')?.addEventListener('click', () => {
      this.centerOnDwarf();
      this.render();
    });

    document.getElementById('map-btn-zoom-in')?.addEventListener('click', () => {
      this.zoomBy(1.35);
      this.render();
    });

    document.getElementById('map-btn-zoom-out')?.addEventListener('click', () => {
      this.zoomBy(1 / 1.35);
      this.render();
    });

    document.getElementById('map-btn-close')?.addEventListener('click', () => {
      this.close();
    });

    this.trailToggleBtn?.addEventListener('click', () => {
      this.showTrail = !this.showTrail;
      this.trailToggleBtn.classList.toggle('active', this.showTrail);
      this.render();
    });

    this.markersToggleBtn?.addEventListener('click', () => {
      this.showMarkers = !this.showMarkers;
      this.markersToggleBtn.classList.toggle('active', this.showMarkers);
      this.render();
    });

    this.gridToggleBtn?.addEventListener('click', () => {
      this.showGrid = !this.showGrid;
      this.gridToggleBtn.classList.toggle('active', this.showGrid);
      this.render();
    });

    // Close modal when clicking the dimmed backdrop outside the map frame
    this.modalEl.addEventListener('mousedown', (e) => {
      if (e.target === this.modalEl) {
        this.close();
      }
    });

    // Capture-phase keydown handler so M toggles the map and map shortcuts don't trigger 3D actions while open
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat) return;

        if (e.code === 'KeyM') {
          if (e.shiftKey) {
            this.config.wireframe = !this.config.wireframe;
            this.onToggleWireframe?.();
          } else {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.toggle();
          }
          return;
        }

        if (!this.isOpen) return;

        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.close();
        } else if (e.code === 'KeyF') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.fitToDiscoveredArea();
          this.render();
        } else if (e.code === 'KeyC') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.centerOnDwarf();
          this.render();
        } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.zoomBy(1.3);
          this.render();
        } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.zoomBy(1 / 1.3);
          this.render();
        } else if (
          e.code === 'KeyW' ||
          e.code === 'KeyA' ||
          e.code === 'KeyS' ||
          e.code === 'KeyD' ||
          e.code === 'ArrowUp' ||
          e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' ||
          e.code === 'ArrowRight'
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const panStep = 65 / this.zoom;
          if (e.code === 'KeyW' || e.code === 'ArrowUp') this.viewCenterZ -= panStep;
          if (e.code === 'KeyS' || e.code === 'ArrowDown') this.viewCenterZ += panStep;
          if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.viewCenterX -= panStep;
          if (e.code === 'KeyD' || e.code === 'ArrowRight') this.viewCenterX += panStep;
          this.render();
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          // Block all other 3D gameplay keys while the World Map modal is open
          e.stopImmediatePropagation();
        }
      },
      true
    );

    // Canvas mouse pan, hover, click, and wheel zoom
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.isPanning = true;
      this.dragMovedSq = 0;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.panOriginCenterX = this.viewCenterX;
      this.panOriginCenterZ = this.viewCenterZ;
      this.canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isOpen) return;

      if (this.isPanning) {
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        this.dragMovedSq = dx * dx + dy * dy;
        this.viewCenterX = this.panOriginCenterX - dx / this.zoom;
        this.viewCenterZ = this.panOriginCenterZ - dy / this.zoom;
        this.hideTooltip();
        this.render();
        return;
      }

      if (e.target === this.canvas) {
        this.handleCanvasHover(e);
      } else {
        this.hideTooltip();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isOpen) return;
      if (this.isPanning) {
        const wasClick = this.dragMovedSq < 36 && e.target === this.canvas;
        this.isPanning = false;
        this.canvas.style.cursor = this.hoveredMarker?.canTeleport ? 'pointer' : 'grab';
        if (wasClick) {
          this.handleCanvasClick(e);
        }
      }
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const w = rect.width;
        const h = rect.height;

        // World coordinate under cursor before zoom
        const worldBeforeX = this.viewCenterX + (mx - w * 0.5) / this.zoom;
        const worldBeforeZ = this.viewCenterZ + (my - h * 0.5) / this.zoom;

        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.04, 4.8);

        // Keep world coordinate locked under cursor after zoom
        this.viewCenterX = worldBeforeX - (mx - w * 0.5) / this.zoom;
        this.viewCenterZ = worldBeforeZ - (my - h * 0.5) / this.zoom;

        this.render();
        this.handleCanvasHover(e);
      },
      { passive: false }
    );
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  public open(): void {
    if (this.isOpen) return;
    this.isOpen = true;

    // Ensure current dwarf surroundings are revealed before opening
    const pos = this.getPlayerPos();
    this.updateDiscovery(pos.x, pos.z, true);

    this.modalEl.classList.remove('hidden');
    this.toggleBtnEl?.classList.add('active');
    this.playMapRustleSound(true);

    this.resizeCanvasToContainer();
    // Automatically frame the entire area discovered by our dwarf!
    this.fitToDiscoveredArea();
    this.render();
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.isPanning = false;
    if (this.pendingBakeRaf) {
      cancelAnimationFrame(this.pendingBakeRaf);
      this.pendingBakeRaf = 0;
    }
    this.hideTooltip();
    this.modalEl.classList.add('hidden');
    this.toggleBtnEl?.classList.remove('active');
    this.playMapRustleSound(false);
  }

  /**
   * Adjusts `viewCenterX`, `viewCenterZ`, and `zoom` so the entire area discovered by our dwarf
   * fits inside the map viewport with comfortable cartographic padding.
   */
  public fitToDiscoveredArea(): void {
    this.resizeCanvasToContainer();
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(240, rect.height);

    const pos = this.getPlayerPos();
    let minX = Math.min(this.minDiscoveredX, pos.x - 36);
    let maxX = Math.max(this.maxDiscoveredX, pos.x + 36);
    let minZ = Math.min(this.minDiscoveredZ, pos.z - 36);
    let maxZ = Math.max(this.maxDiscoveredZ, pos.z + 36);

    for (const b of this.landmarkManager.getLitBeacons()) {
      minX = Math.min(minX, b.x - 48);
      maxX = Math.max(maxX, b.x + 48);
      minZ = Math.min(minZ, b.z - 48);
      maxZ = Math.max(maxZ, b.z + 48);
    }

    const digPos = this.treasureManager.getActiveDigSitePos();
    if (digPos) {
      minX = Math.min(minX, digPos.x - 32);
      maxX = Math.max(maxX, digPos.x + 32);
      minZ = Math.min(minZ, digPos.z - 32);
      maxZ = Math.max(maxZ, digPos.z + 32);
    }

    const marginMeters = 28;
    const spanX = Math.max(96, maxX - minX + marginMeters * 2);
    const spanZ = Math.max(96, maxZ - minZ + marginMeters * 2);

    this.viewCenterX = (minX + maxX) * 0.5;
    this.viewCenterZ = (minZ + maxZ) * 0.5;

    const zoomX = (w * 0.88) / spanX;
    const zoomZ = (h * 0.86) / spanZ;
    this.zoom = THREE.MathUtils.clamp(Math.min(zoomX, zoomZ), 0.04, 3.6);
  }

  public centerOnDwarf(): void {
    const pos = this.getPlayerPos();
    this.viewCenterX = pos.x;
    this.viewCenterZ = pos.z;
    this.zoom = Math.max(this.zoom, 1.75);
  }

  private zoomBy(factor: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.04, 4.8);
  }

  private resizeCanvasToContainer(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(1, Math.round(rect.width * dpr));
    const targetH = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }
  }

  /**
   * Called from the main loop as the dwarf explores the world.
   * Reveals 16m discovery cells within the dwarf's sight radius, records the breadcrumb trail,
   * and captures any Dwarven Huts inside discovered territory.
   */
  public updateDiscovery(worldX: number, worldZ: number, force = false): void {
    const dx = worldX - this.lastRevealX;
    const dz = worldZ - this.lastRevealZ;
    if (!force && dx * dx + dz * dz < 16.0) {
      return;
    }
    this.lastRevealX = worldX;
    this.lastRevealZ = worldZ;

    const radius = this.hasLodestoneRelic() ? 68 : 52;
    const newlyRevealed = this.revealCircle(worldX, worldZ, radius);

    // Record breadcrumb trail point every ~10m of travel
    const tdx = worldX - this.lastTrailX;
    const tdz = worldZ - this.lastTrailZ;
    const tDistSq = tdx * tdx + tdz * tdz;
    if (Number.isNaN(this.lastTrailX) || (tDistSq >= 100 && tDistSq <= 14400)) {
      this.lastTrailX = worldX;
      this.lastTrailZ = worldZ;
      this.exploredTrail.push(Math.round(worldX * 10) / 10, Math.round(worldZ * 10) / 10);
      if (this.exploredTrail.length > MAX_TRAIL_COORDS) {
        this.exploredTrail.splice(0, 2);
      }
    } else if (tDistSq > 14400) {
      // Break line segment across long fast-travel teleports
      this.lastTrailX = worldX;
      this.lastTrailZ = worldZ;
      this.exploredTrail.push(
        Number.NaN,
        Number.NaN,
        Math.round(worldX * 10) / 10,
        Math.round(worldZ * 10) / 10
      );
      if (this.exploredTrail.length > MAX_TRAIL_COORDS) {
        this.exploredTrail.splice(0, 4);
      }
    }

    // Check loaded chunks for any Dwarven Huts inside discovered cells
    let hutFound = false;
    this.chunkManager.forEachLoadedHut((hut) => {
      if (this.discoveredHuts.has(hut.id)) return;
      const gx = worldToCell(hut.worldX);
      const gz = worldToCell(hut.worldZ);
      if (this.discoveredCells.has(packCoord(gx, gz))) {
        this.discoveredHuts.set(hut.id, {
          id: hut.id,
          x: Math.round(hut.worldX * 10) / 10,
          y: Math.round(hut.worldY * 10) / 10,
          z: Math.round(hut.worldZ * 10) / 10,
        });
        hutFound = true;
      }
    });

    if (newlyRevealed > 0 || hutFound) {
      this.onDiscoveryChanged?.();
      if (this.isOpen) {
        this.render();
      }
    }
  }

  /**
   * Reveals a circular vista around a world point (e.g. around the dwarf or a newly lit Watchtower Beacon).
   */
  public revealCircle(worldX: number, worldZ: number, radiusMeters: number): number {
    const minGx = worldToCell(worldX - radiusMeters);
    const maxGx = worldToCell(worldX + radiusMeters);
    const minGz = worldToCell(worldZ - radiusMeters);
    const maxGz = worldToCell(worldZ + radiusMeters);
    const rSq = radiusMeters * radiusMeters;
    let added = 0;

    for (let gz = minGz; gz <= maxGz; gz++) {
      const cellZ = cellCenterToWorld(gz);
      const dz = cellZ - worldZ;
      for (let gx = minGx; gx <= maxGx; gx++) {
        const cellX = cellCenterToWorld(gx);
        const dx = cellX - worldX;
        if (dx * dx + dz * dz > rSq) continue;

        const key = packCoord(gx, gz);
        if (!this.discoveredCells.has(key)) {
          this.discoveredCells.add(key);
          added++;
          this.includeCellInBounds(gx, gz);
          this.markCellAndNeighborChunksDirty(gx, gz);
        }
      }
    }

    return added;
  }

  private includeCellInBounds(gx: number, gz: number): void {
    const cx = cellCenterToWorld(gx);
    const cz = cellCenterToWorld(gz);
    const half = CELL_SIZE * 0.5;
    if (this.discoveredCells.size === 1) {
      this.minDiscoveredX = cx - half;
      this.maxDiscoveredX = cx + half;
      this.minDiscoveredZ = cz - half;
      this.maxDiscoveredZ = cz + half;
    } else {
      if (cx - half < this.minDiscoveredX) this.minDiscoveredX = cx - half;
      if (cx + half > this.maxDiscoveredX) this.maxDiscoveredX = cx + half;
      if (cz - half < this.minDiscoveredZ) this.minDiscoveredZ = cz - half;
      if (cz + half > this.maxDiscoveredZ) this.maxDiscoveredZ = cz + half;
    }
  }

  private markCellAndNeighborChunksDirty(gx: number, gz: number): void {
    const baseCx = cellToChunk(gx);
    const baseCz = cellToChunk(gz);
    this.touchedChunks.add(packCoord(baseCx, baseCz));

    // A cell on the edge of a chunk also contributes to the 1-cell bilinear fog feathering of its neighbor chunk
    const minCx = cellToChunk(gx - 1);
    const maxCx = cellToChunk(gx + 1);
    const minCz = cellToChunk(gz - 1);
    const maxCz = cellToChunk(gz + 1);

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cKey = packCoord(cx, cz);
        const cached = this.chunkCache.get(cKey);
        if (cached) {
          cached.dirty = true;
        }
      }
    }
  }

  public isWorldPosDiscovered(worldX: number, worldZ: number): boolean {
    const gx = worldToCell(worldX);
    const gz = worldToCell(worldZ);
    return this.discoveredCells.has(packCoord(gx, gz));
  }

  /**
   * Serializes discovered cells into a flat `[gx0, gz0, gx1, gz1, ...]` array for localStorage.
   */
  public getSerializedDiscoveredCells(): number[] {
    const out: number[] = [];
    for (const key of this.discoveredCells) {
      out.push(unpackX(key), unpackZ(key));
    }
    return out;
  }

  public getSerializedDiscoveredHuts(): SavedDiscoveredHut[] {
    return Array.from(this.discoveredHuts.values());
  }

  public getSerializedTrail(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.exploredTrail.length; i += 2) {
      const x = this.exploredTrail[i];
      const z = this.exploredTrail[i + 1];
      if (Number.isFinite(x) && Number.isFinite(z)) {
        out.push(x, z);
      } else {
        out.push(-999999, -999999);
      }
    }
    return out;
  }

  public restoreProgress(
    cells: number[] | undefined,
    huts: SavedDiscoveredHut[] | undefined,
    trail: number[] | undefined
  ): void {
    this.discoveredCells.clear();
    this.touchedChunks.clear();
    this.chunkCache.clear();
    this.discoveredHuts.clear();
    this.exploredTrail.length = 0;
    this.lastRevealX = Number.NaN;
    this.lastRevealZ = Number.NaN;
    this.lastTrailX = Number.NaN;
    this.lastTrailZ = Number.NaN;

    if (cells && cells.length >= 2) {
      for (let i = 0; i + 1 < cells.length; i += 2) {
        const gx = Math.round(cells[i]);
        const gz = Math.round(cells[i + 1]);
        const key = packCoord(gx, gz);
        if (!this.discoveredCells.has(key)) {
          this.discoveredCells.add(key);
          this.includeCellInBounds(gx, gz);
          this.touchedChunks.add(packCoord(cellToChunk(gx), cellToChunk(gz)));
        }
      }
    }

    if (huts) {
      for (const h of huts) {
        this.discoveredHuts.set(h.id, h);
      }
    }

    if (trail && trail.length >= 2) {
      for (let i = 0; i + 1 < trail.length; i += 2) {
        const x = trail[i];
        const z = trail[i + 1];
        if (x <= -999990 && z <= -999990) {
          this.exploredTrail.push(Number.NaN, Number.NaN);
        } else {
          this.exploredTrail.push(x, z);
          this.lastTrailX = x;
          this.lastTrailZ = z;
        }
      }
    }

    // Also reveal around any already-lit Watchtower Beacons
    for (const b of this.landmarkManager.getLitBeacons()) {
      this.revealCircle(b.x, b.z, 96);
    }

    // Ensure current player position is revealed
    const pos = this.getPlayerPos();
    this.updateDiscovery(pos.x, pos.z, true);
  }

  public reset(): void {
    this.discoveredCells.clear();
    this.touchedChunks.clear();
    this.chunkCache.clear();
    this.discoveredHuts.clear();
    this.exploredTrail.length = 0;
    this.lastRevealX = Number.NaN;
    this.lastRevealZ = Number.NaN;
    this.lastTrailX = Number.NaN;
    this.lastTrailZ = Number.NaN;
    this.minDiscoveredX = -56;
    this.maxDiscoveredX = 56;
    this.minDiscoveredZ = -56;
    this.maxDiscoveredZ = 56;

    const pos = this.getPlayerPos();
    this.updateDiscovery(pos.x, pos.z, true);
    if (this.isOpen) {
      this.fitToDiscoveredArea();
      this.render();
    }
  }

  public invalidateTerrainTiles(): void {
    this.chunkCache.clear();
    if (this.isOpen) {
      this.render();
    }
  }

  /**
   * Lazily builds (and caches) the 48x48 cartographic tile and deterministic POI metadata for chunk (cx, cz).
   */
  private getOrBuildChunkCache(cx: number, cz: number): ChunkMapCache {
    const key = packCoord(cx, cz);
    let entry = this.chunkCache.get(key);
    if (!entry) {
      const canvas = document.createElement('canvas');
      canvas.width = TILE_RES;
      canvas.height = TILE_RES;
      const ctx = canvas.getContext('2d')!;
      const imgData = ctx.createImageData(TILE_RES, TILE_RES);
      const rgbData = new Uint8ClampedArray(TILE_RES * TILE_RES * 3);

      this.bakeChunkTerrainRGB(cx, cz, rgbData);
      const pois = this.computeChunkDeterministicPOIs(cx, cz);

      entry = {
        cx,
        cz,
        rgbData,
        canvas,
        ctx,
        imgData,
        dirty: true,
        watchtower: pois.watchtower,
        campfire: pois.campfire,
        bridge: pois.bridge,
        chests: pois.chests,
      };
      this.chunkCache.set(key, entry);
    }

    if (entry.dirty) {
      entry.dirty = false;
      this.compositeChunkFogMask(entry);
    }
    return entry;
  }

  /**
   * Renders the top-down painterly terrain, water, shorelines, forest groves, dirt footpaths,
   * hillshading, and 8m contour lines for a 48m x 48m chunk at 1m/px resolution.
   */
  private bakeChunkTerrainRGB(cx: number, cz: number, outRgb: Uint8ClampedArray): void {
    const size = this.config.chunkSize;
    const baseWx = cx * size - size * 0.5;
    const baseWz = cz * size - size * 0.5;
    const waterY = this.config.waterLevel;
    const enableWater = this.config.enableWater;
    const enableTrees = this.config.enableTrees && this.config.forestCoverage > 0.001;
    const enableTracks = this.config.enableTracks;

    // Sample a (TILE_RES + 2) x (TILE_RES + 2) height grid so central-difference hillshade is O(1)
    const stride = TILE_RES + 2;
    const heights = scratchHeights;
    for (let gz = 0; gz < stride; gz++) {
      const wz = baseWz + (gz - 0.5);
      const rowOffset = gz * stride;
      for (let gx = 0; gx < stride; gx++) {
        const wx = baseWx + (gx - 0.5);
        heights[rowOffset + gx] = this.noise.getHeight(wx, wz);
      }
    }

    for (let pz = 0; pz < TILE_RES; pz++) {
      const wz = baseWz + pz + 0.5;
      const hRow = (pz + 1) * stride;
      for (let px = 0; px < TILE_RES; px++) {
        const wx = baseWx + px + 0.5;
        const hIdx = hRow + (px + 1);
        const y = heights[hIdx];
        const outIdx = (pz * TILE_RES + px) * 3;

        // Central difference gradients for northwest cartographic hillshading
        const dhdx = (heights[hIdx + 1] - heights[hIdx - 1]) * 0.5;
        const dhdz = (heights[hIdx + stride] - heights[hIdx - stride]) * 0.5;
        const slope = Math.hypot(dhdx, dhdz);
        // Sun from North-West (-0.707, -0.707)
        const shade = THREE.MathUtils.clamp(1.0 + (-dhdx * 0.65 - dhdz * 0.65) * 0.42, 0.66, 1.28);

        if (enableWater && y < waterY) {
          const depth = waterY - y;
          const depthT = THREE.MathUtils.clamp(depth / 2.2, 0, 1);
          // Painterly shallow turquoise rim -> deep cerulean river/pond basin
          let r = THREE.MathUtils.lerp(94, 42, depthT);
          let g = THREE.MathUtils.lerp(168, 114, depthT);
          let b = THREE.MathUtils.lerp(182, 146, depthT);

          // Subtle water ripple & shoreline foam highlight
          if (depth < 0.28) {
            const foamT = (0.28 - depth) / 0.28;
            r = THREE.MathUtils.lerp(r, 205, foamT * 0.55);
            g = THREE.MathUtils.lerp(g, 224, foamT * 0.55);
            b = THREE.MathUtils.lerp(b, 218, foamT * 0.55);
          }

          outRgb[outIdx] = r;
          outRgb[outIdx + 1] = g;
          outRgb[outIdx + 2] = b;
          continue;
        }

        // Base meadow & elevation palette
        const elevT = THREE.MathUtils.clamp((y - waterY) / 36.0, 0, 1);
        let r = THREE.MathUtils.lerp(116, 162, elevT);
        let g = THREE.MathUtils.lerp(148, 178, elevT);
        let b = THREE.MathUtils.lerp(78, 96, elevT);

        // Warm sandy bank rim right along pond & river shores
        if (enableWater && y < waterY + 1.05) {
          const bankT = 1.0 - THREE.MathUtils.smoothstep(y, waterY, waterY + 1.05);
          r = THREE.MathUtils.lerp(r, 184, bankT * 0.78);
          g = THREE.MathUtils.lerp(g, 158, bankT * 0.78);
          b = THREE.MathUtils.lerp(b, 114, bankT * 0.78);
        }

        // Wooded forest groves (richer mossy woodland green + subtle canopy stipple)
        if (enableTrees && (!enableWater || y > waterY + 0.8)) {
          const grove = this.noise.getForestDensity(wx, wz);
          if (grove > 0.04) {
            const canopyStipple = ((px * 17 + pz * 31) & 7) / 7.0;
            const groveDarken = grove * (0.48 + canopyStipple * 0.24);
            r = THREE.MathUtils.lerp(r, 64, groveDarken);
            g = THREE.MathUtils.lerp(g, 108, groveDarken);
            b = THREE.MathUtils.lerp(b, 52, groveDarken);
          }
        }

        // Steep rocky / earthy cliff slopes
        if (slope > 0.42) {
          const rockT = THREE.MathUtils.clamp((slope - 0.42) / 0.65, 0, 0.75);
          r = THREE.MathUtils.lerp(r, 138, rockT);
          g = THREE.MathUtils.lerp(g, 118, rockT);
          b = THREE.MathUtils.lerp(b, 94, rockT);
        }

        // Winding dwarven dirt footpaths
        if (enableTracks) {
          const trackW = this.noise.getTrackWeight(wx, wz, y);
          if (trackW > 0.22) {
            const pathT = THREE.MathUtils.smoothstep(trackW, 0.22, 0.68);
            r = THREE.MathUtils.lerp(r, 206, pathT * 0.92);
            g = THREE.MathUtils.lerp(g, 169, pathT * 0.92);
            b = THREE.MathUtils.lerp(b, 114, pathT * 0.92);
          }
        }

        // Apply directional sun hillshading
        r *= shade;
        g *= shade;
        b *= shade;

        // Subtle cartographic contour lines every 8m of elevation
        const contourDist = Math.abs(y - Math.round(y / 8.0) * 8.0);
        const contourWidth = Math.max(0.14, slope * 0.28);
        if (contourDist < contourWidth && (!enableWater || y > waterY + 0.5)) {
          const contourStrength = (1.0 - contourDist / contourWidth) * 0.16;
          r *= 1.0 - contourStrength;
          g *= 1.0 - contourStrength;
          b *= 1.0 - contourStrength;
        }

        outRgb[outIdx] = THREE.MathUtils.clamp(Math.round(r), 0, 255);
        outRgb[outIdx + 1] = THREE.MathUtils.clamp(Math.round(g), 0, 255);
        outRgb[outIdx + 2] = THREE.MathUtils.clamp(Math.round(b), 0, 255);
      }
    }
  }

  /**
   * Composites the chunk's pre-baked terrain RGB with a smooth bilinear fog-of-war alpha mask
   * derived from the 5x5 neighborhood of 16m discovery cells around this chunk.
   */
  private compositeChunkFogMask(entry: ChunkMapCache): void {
    const baseGx = entry.cx * CELLS_PER_CHUNK;
    const baseGz = entry.cz * CELLS_PER_CHUNK;

    // 5x5 grid of discovery states (subX in -1..3, subZ in -1..3)
    const mask5x5 = scratchSubGrid;
    for (let sz = -1; sz <= 3; sz++) {
      for (let sx = -1; sx <= 3; sx++) {
        const discovered = this.discoveredCells.has(packCoord(baseGx + sx, baseGz + sz));
        mask5x5[(sz + 1) * 5 + (sx + 1)] = discovered ? 1.0 : 0.0;
      }
    }

    const rgb = entry.rgbData;
    const data = entry.imgData.data;

    for (let pz = 0; pz < TILE_RES; pz++) {
      // Cell centers are at local coordinates -8, +8, +24, +40, +56
      const fz = (pz + 0.5 + 8.0) / CELL_SIZE; // in [0.5 .. 3.5]
      const iz = Math.min(3, Math.max(0, Math.floor(fz)));
      const tz = fz - iz;
      const sz = tz * tz * (3.0 - 2.0 * tz);

      for (let px = 0; px < TILE_RES; px++) {
        const fx = (px + 0.5 + 8.0) / CELL_SIZE;
        const ix = Math.min(3, Math.max(0, Math.floor(fx)));
        const tx = fx - ix;
        const sx = tx * tx * (3.0 - 2.0 * tx);

        const row0 = iz * 5 + ix;
        const row1 = row0 + 5;
        const v0 = mask5x5[row0] + (mask5x5[row0 + 1] - mask5x5[row0]) * sx;
        const v1 = mask5x5[row1] + (mask5x5[row1 + 1] - mask5x5[row1]) * sx;
        const v = v0 + (v1 - v0) * sz;

        const pixIdx = pz * TILE_RES + px;
        const rgbaIdx = pixIdx * 4;
        const rgbIdx = pixIdx * 3;

        if (v <= 0.1) {
          data[rgbaIdx + 3] = 0;
          continue;
        }

        const alphaT = THREE.MathUtils.smoothstep(v, 0.1, 0.58);
        // Darken the ink/sepia frontier border right at the edge of discovered territory
        const borderBand = Math.sin(alphaT * Math.PI);
        const inkFactor = 1.0 - borderBand * 0.26;

        data[rgbaIdx] = Math.round(rgb[rgbIdx] * inkFactor);
        data[rgbaIdx + 1] = Math.round(rgb[rgbIdx + 1] * inkFactor);
        data[rgbaIdx + 2] = Math.round(rgb[rgbIdx + 2] * inkFactor);
        data[rgbaIdx + 3] = Math.round(alphaT * 255);
      }
    }

    entry.ctx.putImageData(entry.imgData, 0, 0);
  }

  /**
   * Deterministically evaluates the landmarks and treasure chests in chunk (cx, cz)
   * using the exact same seeded PRNG sequences as LandmarkManager and TreasureManager.
   */
  private computeChunkDeterministicPOIs(
    cx: number,
    cz: number
  ): {
    watchtower?: { id: string; name: string; x: number; y: number; z: number };
    campfire?: { id: string; x: number; y: number; z: number };
    bridge?: { x: number; y: number; z: number; heading: number };
    chests: ChunkChestMeta[];
  } {
    const size = this.config.chunkSize;
    const lmSeed = ((cx * 92837111) ^ (cz * 51293847) ^ (this.config.seed + 313)) >>> 0;
    const lmRng = createSeededRandom(lmSeed);

    let bridge: { x: number; y: number; z: number; heading: number } | undefined;
    let campfire: { id: string; x: number; y: number; z: number } | undefined;
    let watchtower: { id: string; name: string; x: number; y: number; z: number } | undefined;

    if (this.config.enableTracks && this.config.enableWater) {
      for (let s = -1; s <= 1; s += 2) {
        const sampleX = cx * size + s * (size * 0.24);
        const sampleZ = cz * size + (lmRng() - 0.5) * (size * 0.45);
        const distToTrack = this.noise.getTrackDistance(sampleX, sampleZ);
        if (distToTrack < 4.5) {
          const wy = this.noise.getHeight(sampleX, sampleZ);
          if (wy < this.config.waterLevel - 0.15 && wy > this.config.waterLevel - 2.6) {
            const heading = this.noise.getTrackHeading(sampleX, sampleZ);
            bridge = {
              x: sampleX,
              y: this.config.waterLevel + 0.55,
              z: sampleZ,
              heading,
            };
            break;
          }
        }
      }
    }

    const isStarterCampChunk = cx === 0 && cz === 0;
    const isStarterTowerChunk = cx === 1 && cz === -1;

    if (isStarterCampChunk || (!isStarterTowerChunk && lmRng() < 0.16)) {
      const lx = isStarterCampChunk ? -11.5 : (lmRng() - 0.5) * (size * 0.65);
      const lz = isStarterCampChunk ? -14.0 : (lmRng() - 0.5) * (size * 0.65);
      const wx = cx * size + lx;
      const wz = cz * size + lz;
      const wy = this.noise.getHeight(wx, wz);

      if (!this.config.enableWater || wy > this.config.waterLevel + 1.2) {
        campfire = { id: `${cx},${cz}`, x: wx, y: wy, z: wz };
      }
    }

    if (isStarterTowerChunk || (Math.abs(cx) + Math.abs(cz) >= 2 && lmRng() < 0.22)) {
      let bestX = cx * size;
      let bestZ = cz * size;
      let bestY = -Infinity;

      for (let i = 0; i < 6; i++) {
        const tx = cx * size + (lmRng() - 0.5) * (size * 0.72);
        const tz = cz * size + (lmRng() - 0.5) * (size * 0.72);
        const ty = this.noise.getHeight(tx, tz);
        if (ty > bestY) {
          bestY = ty;
          bestX = tx;
          bestZ = tz;
        }
      }

      const minElev = isStarterTowerChunk ? this.config.waterLevel + 2.5 : 8.5;
      if (bestY >= minElev) {
        const id = `wt_${cx}_${cz}`;
        const nameIdx = Math.abs(cx * 7 + cz * 13) % WATCHTOWER_NAMES.length;
        watchtower = {
          id,
          name: WATCHTOWER_NAMES[nameIdx],
          x: bestX,
          y: bestY,
          z: bestZ,
        };
      }
    }

    // Treasure Chests deterministic check
    const chests: ChunkChestMeta[] = [];
    const chSeed = ((cx * 492876847) ^ (cz * 715225739) ^ (this.config.seed + 991)) >>> 0;
    const chRng = createSeededRandom(chSeed);
    const isStartChunk = cx === 0 && cz === 0;
    const shouldSpawn = isStartChunk || chRng() < 0.58;
    if (shouldSpawn) {
      const count = isStartChunk ? 1 : chRng() < 0.18 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const id = `${cx},${cz},${i}`;
        let placed = false;
        for (let attempt = 0; attempt < 8 && !placed; attempt++) {
          const lx = isStartChunk && attempt === 0 ? 7.5 : (chRng() - 0.5) * (size * 0.78);
          const lz = isStartChunk && attempt === 0 ? -9.5 : (chRng() - 0.5) * (size * 0.78);
          const wx = cx * size + lx;
          const wz = cz * size + lz;
          const wy = this.noise.getHeight(wx, wz);

          if (this.config.enableWater && wy < this.config.waterLevel + 0.9) continue;
          if (
            !isStartChunk &&
            this.config.enableTracks &&
            this.noise.getTrackWeight(wx, wz, wy) > 0.44
          ) {
            continue;
          }
          this.noise.getNormal(wx, wz, tempMapNormal);
          if (tempMapNormal.y < 0.82) continue;

          const roll = chRng();
          const isMythic = !isStartChunk && i === 0 && roll < 0.2;
          const isRare = !isStartChunk && !isMythic && roll < 0.42;
          const points = isMythic ? 500 : isRare ? 250 : 100;
          // Consume chest rotation RNG to stay in lockstep with TreasureManager when count === 2
          chRng();
          if (isMythic) {
            chRng();
            for (let rIdx = 0; rIdx < 3; rIdx++) {
              chRng();
              chRng();
            }
          }

          chests.push({ id, x: wx, y: wy, z: wz, isRare, isMythic, points });
          placed = true;
        }
      }
    }

    return { watchtower, campfire, bridge, chests };
  }

  /**
   * Renders the full Discovered World Map canvas.
   */
  public render(): void {
    if (!this.isOpen) return;
    this.resizeCanvasToContainer();

    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const scaleX = this.canvas.width / width;
    const scaleY = this.canvas.height / height;
    const ctx = this.ctx;

    ctx.save();
    ctx.scale(scaleX, scaleY);

    // 1. Aged Dwarven Parchment Background (Uncharted Lands)
    const bgGrad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      Math.min(width, height) * 0.1,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.75
    );
    bgGrad.addColorStop(0, '#e8dec8');
    bgGrad.addColorStop(0.65, '#d9cbb0');
    bgGrad.addColorStop(1, '#c2b090');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const worldToScreenX = (wx: number) => width * 0.5 + (wx - this.viewCenterX) * this.zoom;
    const worldToScreenY = (wz: number) => height * 0.5 + (wz - this.viewCenterZ) * this.zoom;

    const minVisWx = this.viewCenterX - (width * 0.5) / this.zoom;
    const maxVisWx = this.viewCenterX + (width * 0.5) / this.zoom;
    const minVisWz = this.viewCenterZ - (height * 0.5) / this.zoom;
    const maxVisWz = this.viewCenterZ + (height * 0.5) / this.zoom;

    // 2. Subtle Uncharted Parchment Grid Lines (before terrain tiles)
    if (this.showGrid) {
      this.drawCartographicGrid(ctx, width, height, minVisWx, maxVisWx, minVisWz, maxVisWz, false);
    }

    // 3. Draw Discovered Chunk Terrain Tiles
    const size = this.config.chunkSize;
    const minCx = Math.floor((minVisWx + size * 0.5) / size) - 1;
    const maxCx = Math.ceil((maxVisWx + size * 0.5) / size) + 1;
    const minCz = Math.floor((minVisWz + size * 0.5) / size) - 1;
    const maxCz = Math.ceil((maxVisWz + size * 0.5) / size) + 1;

    ctx.imageSmoothingEnabled = this.zoom < 2.2;
    const visibleCaches: ChunkMapCache[] = [];
    const bakeStart = performance.now();
    let bakedNewThisFrame = 0;
    let hasPendingUncachedTiles = false;

    for (const chunkKey of this.touchedChunks) {
      const cx = unpackX(chunkKey);
      const cz = unpackZ(chunkKey);
      if (cx < minCx || cx > maxCx || cz < minCz || cz > maxCz) continue;

      const chunkLeftWx = cx * size - size * 0.5;
      const chunkTopWz = cz * size - size * 0.5;
      const sx = worldToScreenX(chunkLeftWx);
      const sy = worldToScreenY(chunkTopWz);
      const sw = size * this.zoom;
      const sh = size * this.zoom;

      let cache = this.chunkCache.get(chunkKey);
      if (!cache) {
        if (bakedNewThisFrame === 0 || performance.now() - bakeStart <= 3.0) {
          cache = this.getOrBuildChunkCache(cx, cz);
          bakedNewThisFrame++;
        } else {
          hasPendingUncachedTiles = true;
          ctx.fillStyle = 'rgba(196, 179, 146, 0.38)';
          ctx.fillRect(sx, sy, sw, sh);
          continue;
        }
      } else if (cache.dirty) {
        cache.dirty = false;
        this.compositeChunkFogMask(cache);
      }

      visibleCaches.push(cache);

      // Slight overlap (+0.4px) prevents subpixel hairline seams when zoomed
      ctx.drawImage(cache.canvas, sx - 0.2, sy - 0.2, sw + 0.4, sh + 0.4);
    }

    if (hasPendingUncachedTiles && !this.pendingBakeRaf) {
      this.pendingBakeRaf = requestAnimationFrame(() => {
        this.pendingBakeRaf = 0;
        if (this.isOpen) {
          this.render();
        }
      });
    }

    // 4. Overlay Coordinate Grid Labels on top of terrain
    if (this.showGrid) {
      this.drawCartographicGrid(ctx, width, height, minVisWx, maxVisWx, minVisWz, maxVisWz, true);
    }

    // 5. Draw Dwarf's Breadcrumb Exploration Trail
    if (this.showTrail && this.exploredTrail.length >= 4) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 224, 102, 0.85)';
      ctx.lineWidth = Math.max(1.8, Math.min(3.2, this.zoom * 1.1));
      ctx.setLineDash([5, 4]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      let penDown = false;
      for (let i = 0; i + 1 < this.exploredTrail.length; i += 2) {
        const tx = this.exploredTrail[i];
        const tz = this.exploredTrail[i + 1];
        if (!Number.isFinite(tx) || !Number.isFinite(tz)) {
          penDown = false;
          continue;
        }
        const sx = worldToScreenX(tx);
        const sy = worldToScreenY(tz);
        if (!penDown) {
          ctx.moveTo(sx, sy);
          penDown = true;
        } else {
          ctx.lineTo(sx, sy);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // 6. Collect & Draw Discovered POIs and Dwarf Marker
    this.interactiveMarkers.length = 0;

    if (this.showMarkers) {
      this.collectAndDrawPOIMarkers(ctx, visibleCaches, worldToScreenX, worldToScreenY);
    }

    // Always draw our Dwarf's current position & heading cone on top
    this.drawDwarfMarker(ctx, worldToScreenX, worldToScreenY);

    // 7. Draw Ornate Compass Rose, Scale Bar, and Vignette Frame
    this.drawMapOverlays(ctx, width, height);

    ctx.restore();

    // 8. Update Exploration Summary Header
    this.updateStatsReadout();
  }

  private drawCartographicGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    minWx: number,
    maxWx: number,
    minWz: number,
    maxWz: number,
    labelsOnly: boolean
  ): void {
    // Choose a clean metric grid step based on current zoom
    let step = 50;
    if (this.zoom < 0.12) step = 1000;
    else if (this.zoom < 0.28) step = 500;
    else if (this.zoom < 0.65) step = 200;
    else if (this.zoom < 1.35) step = 100;

    const firstX = Math.ceil(minWx / step) * step;
    const firstZ = Math.ceil(minWz / step) * step;

    ctx.save();
    if (!labelsOnly) {
      ctx.strokeStyle = 'rgba(72, 54, 34, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = firstX; x <= maxWx; x += step) {
        const sx = Math.round(width * 0.5 + (x - this.viewCenterX) * this.zoom) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
      }
      for (let z = firstZ; z <= maxWz; z += step) {
        const sy = Math.round(height * 0.5 + (z - this.viewCenterZ) * this.zoom) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
      }
      ctx.stroke();

      // Highlight origin axes (X = 0, Z = 0)
      ctx.strokeStyle = 'rgba(110, 78, 42, 0.32)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const ox = width * 0.5 - this.viewCenterX * this.zoom;
      const oz = height * 0.5 - this.viewCenterZ * this.zoom;
      if (ox >= 0 && ox <= width) {
        ctx.moveTo(ox, 0);
        ctx.lineTo(ox, height);
      }
      if (oz >= 0 && oz <= height) {
        ctx.moveTo(0, oz);
        ctx.lineTo(width, oz);
      }
      ctx.stroke();
    } else {
      ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(62, 46, 28, 0.72)';
      for (let x = firstX; x <= maxWx; x += step) {
        const sx = width * 0.5 + (x - this.viewCenterX) * this.zoom;
        if (sx > 45 && sx < width - 70) {
          ctx.fillText(`${x}m`, sx + 3, 14);
        }
      }
      for (let z = firstZ; z <= maxWz; z += step) {
        const sy = height * 0.5 + (z - this.viewCenterZ) * this.zoom;
        if (sy > 24 && sy < height - 28) {
          ctx.fillText(`${z}m`, 6, sy - 3);
        }
      }
    }
    ctx.restore();
  }

  private collectAndDrawPOIMarkers(
    ctx: CanvasRenderingContext2D,
    visibleCaches: ChunkMapCache[],
    worldToScreenX: (wx: number) => number,
    worldToScreenY: (wz: number) => number
  ): void {
    const seenWatchtowers = new Set<string>();

    // 1. Bridges, Stone Circles, Chests, and Watchtowers inside visible discovered chunks
    for (const cache of visibleCaches) {
      if (cache.bridge && this.isWorldPosDiscovered(cache.bridge.x, cache.bridge.z)) {
        const sx = worldToScreenX(cache.bridge.x);
        const sy = worldToScreenY(cache.bridge.z);
        this.drawPin(ctx, sx, sy, 6.5, '#8d5b34', '#f4d58d', '🌉', this.zoom >= 0.45);
        this.interactiveMarkers.push({
          id: `bridge_${cache.cx}_${cache.cz}`,
          kind: 'bridge',
          title: '🌉 Wooden River Bridge',
          subtitle: 'Walkable timber crossing over river channel',
          worldX: cache.bridge.x,
          worldY: cache.bridge.y,
          worldZ: cache.bridge.z,
          screenX: sx,
          screenY: sy,
          radiusPx: 9,
          canTeleport: false,
        });
      }

      if (cache.campfire && this.isWorldPosDiscovered(cache.campfire.x, cache.campfire.z)) {
        const sx = worldToScreenX(cache.campfire.x);
        const sy = worldToScreenY(cache.campfire.z);
        this.drawPin(ctx, sx, sy, 8, '#3d5a45', '#ff9f1c', '🔥', true);
        this.interactiveMarkers.push({
          id: `camp_${cache.campfire.id}`,
          kind: 'campfire',
          title: '🪨 Ancient Stone Circle & Campfire',
          subtitle: 'Grants 60s Hearth Blessing (+20% Speed & Jump)',
          worldX: cache.campfire.x,
          worldY: cache.campfire.y,
          worldZ: cache.campfire.z,
          screenX: sx,
          screenY: sy,
          radiusPx: 11,
          canTeleport: false,
        });
      }

      if (this.zoom >= 0.32) {
        for (const ch of cache.chests) {
          if (!this.isWorldPosDiscovered(ch.x, ch.z)) continue;
          const isCollected = this.treasureManager.isChestCollected(ch.id);
          const sx = worldToScreenX(ch.x);
          const sy = worldToScreenY(ch.z);

          if (isCollected) {
            if (this.zoom >= 0.75) {
              this.drawPin(ctx, sx, sy, 5.5, 'rgba(55, 65, 58, 0.72)', '#8ce99a', '✓', false);
              this.interactiveMarkers.push({
                id: `chest_${ch.id}`,
                kind: 'chest_opened',
                title: '✅ Opened Treasure Chest',
                subtitle: `Collected (${ch.points} Base Gold)`,
                worldX: ch.x,
                worldY: ch.y,
                worldZ: ch.z,
                screenX: sx,
                screenY: sy,
                radiusPx: 8,
                canTeleport: false,
              });
            }
          } else {
            const bg = ch.isMythic ? '#1b3a4b' : ch.isRare ? '#6b2d26' : '#5c3d1e';
            const border = ch.isMythic ? '#48cae4' : ch.isRare ? '#ffae00' : '#ffd166';
            const icon = ch.isMythic ? '💎' : ch.isRare ? '★' : '🪙';
            this.drawPin(ctx, sx, sy, ch.isMythic ? 8 : 6.8, bg, border, icon, this.zoom >= 0.6);
            this.interactiveMarkers.push({
              id: `chest_${ch.id}`,
              kind: ch.isMythic ? 'chest_mythic' : ch.isRare ? 'chest_rare' : 'chest_std',
              title: ch.isMythic
                ? '💎 Mythic Runic Chest'
                : ch.isRare
                  ? '★ Rare Dwarven Chest'
                  : '🪙 Dwarven Treasure Chest',
              subtitle: `Unopened (${ch.points} Base Gold)`,
              worldX: ch.x,
              worldY: ch.y,
              worldZ: ch.z,
              screenX: sx,
              screenY: sy,
              radiusPx: 10,
              canTeleport: false,
            });
          }
        }
      }

      if (cache.watchtower) {
        const wt = cache.watchtower;
        const isLit = this.landmarkManager.isBeaconLit(wt.id);
        if (isLit || this.isWorldPosDiscovered(wt.x, wt.z)) {
          seenWatchtowers.add(wt.id);
          const sx = worldToScreenX(wt.x);
          const sy = worldToScreenY(wt.z);
          this.drawPin(
            ctx,
            sx,
            sy,
            isLit ? 10.5 : 8.5,
            isLit ? '#5c2c06' : '#3d454d',
            isLit ? '#ffb703' : '#90e0ef',
            isLit ? '🔥' : '🗼',
            true
          );
          this.interactiveMarkers.push({
            id: wt.id,
            kind: isLit ? 'beacon_lit' : 'beacon_unlit',
            title: isLit ? `🔥 ${wt.name} (Lit Beacon)` : `🗼 ${wt.name} (Unlit Watchtower)`,
            subtitle: isLit
              ? '⚡ Click on Map to Fast-Travel Here!'
              : 'Climb this ridge to ignite the beacon & unlock Fast-Travel',
            worldX: wt.x,
            worldY: wt.y,
            worldZ: wt.z,
            screenX: sx,
            screenY: sy,
            radiusPx: 13,
            canTeleport: isLit,
          });
        }
      }
    }

    // Ensure any lit beacons outside the touched chunk set are also drawn
    for (const b of this.landmarkManager.getLitBeacons()) {
      if (seenWatchtowers.has(b.id)) continue;
      const sx = worldToScreenX(b.x);
      const sy = worldToScreenY(b.z);
      this.drawPin(ctx, sx, sy, 10.5, '#5c2c06', '#ffb703', '🔥', true);
      this.interactiveMarkers.push({
        id: b.id,
        kind: 'beacon_lit',
        title: `${b.name} (Lit Beacon)`,
        subtitle: '⚡ Click on Map to Fast-Travel Here!',
        worldX: b.x,
        worldY: b.y,
        worldZ: b.z,
        screenX: sx,
        screenY: sy,
        radiusPx: 13,
        canTeleport: true,
      });
    }

    // 2. Discovered Dwarven Huts
    for (const hut of this.discoveredHuts.values()) {
      const sx = worldToScreenX(hut.x);
      const sy = worldToScreenY(hut.z);
      this.drawPin(ctx, sx, sy, 9.0, '#4a2c18', '#ffd166', '🏠', true);
      this.interactiveMarkers.push({
        id: hut.id,
        kind: 'hut',
        title: '🏠 Dwarven Wooden House',
        subtitle: 'Enter doorway (E) to buy Mason Equipment, collect Artefacts & warm by the hearth',
        worldX: hut.x,
        worldY: hut.y,
        worldZ: hut.z,
        screenX: sx,
        screenY: sy,
        radiusPx: 12,
        canTeleport: false,
      });
    }

    // 2b. Player-Placed Stone Quarries & Castles
    if (this.castleManager) {
      for (const q of this.castleManager.getSerializedQuarries()) {
        const sx = worldToScreenX(q.x);
        const sy = worldToScreenY(q.z);
        this.drawPin(ctx, sx, sy, 9.5, '#3b424c', '#ffd166', '⛏️', true);
        this.interactiveMarkers.push({
          id: q.id,
          kind: 'quarry',
          title: '⛏️ Dwarven Stone Quarry',
          subtitle: `Chisel Raw Stones into Blocks (${q.stockpiledBlocks} Blocks Stockpiled)`,
          worldX: q.x,
          worldY: q.y,
          worldZ: q.z,
          screenX: sx,
          screenY: sy,
          radiusPx: 12,
          canTeleport: false,
        });
      }
      for (const c of this.castleManager.getSerializedCastles()) {
        const sx = worldToScreenX(c.x);
        const sy = worldToScreenY(c.z);
        this.drawPin(ctx, sx, sy, 11.0, '#1d3557', '#48cae4', '🏰', true);
        this.interactiveMarkers.push({
          id: c.id,
          kind: 'castle',
          title: `🏰 ${c.name}`,
          subtitle: `Castle Construction: ${c.blocksPlaced}/30 Blocks Placed`,
          worldX: c.x,
          worldY: c.y,
          worldZ: c.z,
          screenX: sx,
          screenY: sy,
          radiusPx: 14,
          canTeleport: false,
        });
      }
    }

    // 3. Active Buried Map Hoard Dig Site (X Marks the Spot!)
    const digPos = this.treasureManager.getActiveDigSitePos();
    if (digPos) {
      const sx = worldToScreenX(digPos.x);
      const sy = worldToScreenY(digPos.z);
      this.drawPin(ctx, sx, sy, 10.0, '#6a040f', '#ffca3a', '❌', true);
      this.interactiveMarkers.push({
        id: 'active_dig_site',
        kind: 'dig_site',
        title: '🗺️ Buried Relic Hoard',
        subtitle: 'X Marks the Spot! Walk to the golden beam to unearth +400 Base Gold',
        worldX: digPos.x,
        worldY: digPos.y,
        worldZ: digPos.z,
        screenX: sx,
        screenY: sy,
        radiusPx: 13,
        canTeleport: false,
      });
    }

    // 4. Spawn Valley Origin (0, 0) — Fast-Travel Waypoint
    {
      const sx = worldToScreenX(0);
      const sy = worldToScreenY(0);
      const spawnY = this.noise.getHeight(0, 0);
      const canFastTravel = this.landmarkManager.getLitBeaconCount() > 0;
      this.drawPin(ctx, sx, sy, 9.5, '#264653', '#a8e6cf', '🏕️', true);
      this.interactiveMarkers.push({
        id: 'spawn_origin',
        kind: 'spawn',
        title: '🏕️ Spawn Valley (0, 0)',
        subtitle: canFastTravel
          ? '⚡ Click on Map to Fast-Travel to Spawn Valley!'
          : 'Starting meadow & primary forest trailhead',
        worldX: 0,
        worldY: spawnY,
        worldZ: 0,
        screenX: sx,
        screenY: sy,
        radiusPx: 12,
        canTeleport: canFastTravel,
      });
    }
  }

  private drawPin(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    fillColor: string,
    strokeColor: string,
    emoji: string,
    showEmoji: boolean
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();

    if (showEmoji) {
      ctx.font = `${Math.round(radius * 1.15)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(emoji, x, y + 0.5);
    }
    ctx.restore();
  }

  private drawDwarfMarker(
    ctx: CanvasRenderingContext2D,
    worldToScreenX: (wx: number) => number,
    worldToScreenY: (wz: number) => number
  ): void {
    const pos = this.getPlayerPos();
    const heading = this.getPlayerHeading();
    const sx = worldToScreenX(pos.x);
    const sy = worldToScreenY(pos.z);

    ctx.save();
    ctx.translate(sx, sy);

    // Subtle discovery radius ring around the dwarf
    const discRadiusPx = (this.hasLodestoneRelic() ? 68 : 52) * this.zoom;
    if (discRadiusPx > 18 && discRadiusPx < 600) {
      ctx.beginPath();
      ctx.arc(0, 0, discRadiusPx, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 230, 109, 0.32)';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Directional heading cone (heading = atan2(dx, dz), so screen angle is (sin(h), cos(h)))
    const dirAngle = Math.atan2(Math.cos(heading), Math.sin(heading));
    ctx.save();
    ctx.rotate(dirAngle);
    const coneGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 28);
    coneGrad.addColorStop(0, 'rgba(255, 230, 102, 0.65)');
    coneGrad.addColorStop(1, 'rgba(255, 230, 102, 0.0)');
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 28, -0.45, 0.45);
    ctx.closePath();
    ctx.fillStyle = coneGrad;
    ctx.fill();

    // Crisp gold directional arrow tip
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(7, -5.5);
    ctx.lineTo(9.5, 0);
    ctx.lineTo(7, 5.5);
    ctx.closePath();
    ctx.fillStyle = '#ffdf4f';
    ctx.strokeStyle = '#2b1d0e';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Dwarf emblem badge
    ctx.beginPath();
    ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
    ctx.fillStyle = '#d62828';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffe66d';
    ctx.stroke();

    ctx.font = '12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🧔', 0, 0.5);

    ctx.restore();

    this.interactiveMarkers.push({
      id: 'player_dwarf',
      kind: 'dwarf',
      title: '🧔 Our Dwarf Explorer',
      subtitle: `Elev: ${pos.y.toFixed(1)}m • Heading: ${Math.round(((heading * 180) / Math.PI + 360) % 360)}°`,
      worldX: pos.x,
      worldY: pos.y,
      worldZ: pos.z,
      screenX: sx,
      screenY: sy,
      radiusPx: 14,
      canTeleport: false,
    });
  }

  private drawMapOverlays(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    // 1. Ornate Compass Rose in Top-Right of Canvas
    const cx = width - 48;
    const cy = 48;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(32, 24, 16, 0.78)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.65)';
    ctx.stroke();

    // North pointer
    ctx.beginPath();
    ctx.moveTo(0, -19);
    ctx.lineTo(5, 0);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.fillStyle = '#e0533c';
    ctx.fill();

    // South pointer
    ctx.beginPath();
    ctx.moveTo(0, 19);
    ctx.lineTo(5, 0);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.fillStyle = '#d8ccb8';
    ctx.fill();

    ctx.font = '800 9px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#ffe8a3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -22);
    ctx.restore();

    // 2. Dynamic Metric Scale Bar in Bottom-Right of Canvas
    const targetBarPx = 110;
    const rawMeters = targetBarPx / this.zoom;
    const niceSteps = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
    let scaleMeters = niceSteps[0];
    for (const s of niceSteps) {
      if (rawMeters >= s * 0.65) scaleMeters = s;
    }
    const barPx = scaleMeters * this.zoom;
    const bx = width - 24 - barPx;
    const by = height - 22;

    ctx.save();
    ctx.fillStyle = 'rgba(26, 20, 14, 0.78)';
    ctx.strokeStyle = 'rgba(255, 212, 82, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx - 10, by - 18, barPx + 20, 26, 6);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#ffe8a3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by - 5);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + barPx, by);
    ctx.lineTo(bx + barPx, by - 5);
    ctx.stroke();

    ctx.font = '700 10px "Consolas", "SF Mono", monospace';
    ctx.fillStyle = '#fff6e0';
    ctx.textAlign = 'center';
    ctx.fillText(
      scaleMeters >= 1000 ? `${scaleMeters / 1000} km` : `${scaleMeters} m`,
      bx + barPx * 0.5,
      by - 6
    );
    ctx.restore();
  }

  private handleCanvasHover(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const wx = this.viewCenterX + (mx - rect.width * 0.5) / this.zoom;
    const wz = this.viewCenterZ + (my - rect.height * 0.5) / this.zoom;

    const discovered = this.isWorldPosDiscovered(wx, wz);
    if (discovered) {
      const wy = this.noise.getHeight(wx, wz);
      this.coordsEl.textContent = `Cursor: (${wx.toFixed(0)}m, ${wz.toFixed(0)}m) • Elev: ${wy.toFixed(1)}m`;
    } else {
      this.coordsEl.textContent = `Cursor: (${wx.toFixed(0)}m, ${wz.toFixed(0)}m) • Uncharted Lands`;
    }

    // Hit-test interactive markers (reverse order so top-most markers win)
    let hit: InteractiveMapMarker | null = null;
    for (let i = this.interactiveMarkers.length - 1; i >= 0; i--) {
      const m = this.interactiveMarkers[i];
      const dx = mx - m.screenX;
      const dy = my - m.screenY;
      if (dx * dx + dy * dy <= (m.radiusPx + 4) * (m.radiusPx + 4)) {
        hit = m;
        break;
      }
    }

    this.hoveredMarker = hit;
    this.canvas.style.cursor = hit?.canTeleport ? 'pointer' : 'grab';

    if (hit) {
      const pos = this.getPlayerPos();
      const dist = Math.hypot(hit.worldX - pos.x, hit.worldZ - pos.z);
      const distText =
        hit.kind === 'dwarf'
          ? `Pos: (${hit.worldX.toFixed(0)}m, ${hit.worldZ.toFixed(0)}m)`
          : `Pos: (${hit.worldX.toFixed(0)}m, ${hit.worldZ.toFixed(0)}m) • ${dist.toFixed(0)}m from Dwarf`;

      this.tooltipEl.innerHTML =
        `<div class="map-tt-title">${hit.title}</div>` +
        `<div class="map-tt-sub">${hit.subtitle}</div>` +
        `<div class="map-tt-coords">${distText}</div>`;
      this.tooltipEl.classList.remove('hidden');

      const tx = Math.min(rect.width - 230, Math.max(12, mx + 14));
      const ty = Math.min(rect.height - 85, Math.max(12, my - 18));
      this.tooltipEl.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
    } else {
      this.hideTooltip();
    }
  }

  private handleCanvasClick(e: MouseEvent): void {
    this.handleCanvasHover(e);
    const hit = this.hoveredMarker;
    if (hit && hit.canTeleport) {
      const label = hit.kind === 'spawn' ? '🏕️ Spawn Valley' : hit.title.replace(' (Lit Beacon)', '');
      this.close();
      this.landmarkManager.teleportToWaypoint(hit.worldX, hit.worldZ, label);
    }
  }

  private hideTooltip(): void {
    this.hoveredMarker = null;
    this.tooltipEl.classList.add('hidden');
  }

  private updateStatsReadout(): void {
    const cellsCount = this.discoveredCells.size;
    const areaSqMeters = cellsCount * CELL_SIZE * CELL_SIZE;
    const areaHa = (areaSqMeters / 10000).toFixed(1);
    const spanX = Math.round(this.maxDiscoveredX - this.minDiscoveredX);
    const spanZ = Math.round(this.maxDiscoveredZ - this.minDiscoveredZ);
    const litBeacons = this.landmarkManager.getLitBeaconCount();
    const hutsCount = this.discoveredHuts.size;
    const chestsCount = this.treasureManager.chestsCollected;

    this.statsEl.textContent =
      `Explored: ${areaSqMeters.toLocaleString()} m² (${areaHa} ha) • Span: ${spanX}m × ${spanZ}m • ` +
      `🔥 ${litBeacons} Beacon${litBeacons === 1 ? '' : 's'} • 🏠 ${hutsCount} Hut${hutsCount === 1 ? '' : 's'} • 🪙 ${chestsCount} Chest${chestsCount === 1 ? '' : 's'}`;
  }

  private playMapRustleSound(opening: boolean): void {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const freqs = opening ? [310, 440] : [415, 293.66];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + idx * 0.06);
      gain.gain.setValueAtTime(0.001, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.08, now + idx * 0.06 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.18);
    });
  }
}
