import { createNoise2D, NoiseFunction2D } from 'simplex-noise';
import * as THREE from 'three';
import { WorldConfig } from './Config';

/**
 * Mulberry32 deterministic PRNG so any integer seed produces a repeatable world.
 */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reusable palette colors matching the painterly greens, sandy pond banks, and warm dirt in the concept art
const COL_DEEP_VALLEY = new THREE.Color(0x3f632d);   // Rich mossy valley green
const COL_LUSH_GRASS = new THREE.Color(0x567d34);    // Mid-tone meadow green
const COL_SUNLIT_GRASS = new THREE.Color(0x7ca142);  // Warm yellow-green sunlit patches
const COL_FOREST_FLOOR = new THREE.Color(0x415f29);  // Slightly deeper shaded green under tree groves
const COL_HIGH_RIDGE = new THREE.Color(0x6c8c3c);    // Breezy ridge green
const COL_STEEP_EARTH = new THREE.Color(0x7d6549);   // Warm earthy dirt/rock on steep slopes
const COL_SHORE_BANK = new THREE.Color(0x8c7355);    // Warm sandy/muddy pond & river bank
const COL_RIVERBED = new THREE.Color(0x4c4639);      // Wet pebbles/silt below water level
// Painterly forest track palette inspired by art/forest_track.jpg
const COL_TRACK_DIRT_LIGHT = new THREE.Color(0xc49f6c); // Sunlit golden-tan packed sandy loam
const COL_TRACK_DIRT_MID = new THREE.Color(0xa88354);   // Warm ochre footpath earth
const COL_TRACK_RUT_DARK = new THREE.Color(0x7d603c);   // Deeper compacted earth in ruts & root shadows
const COL_TRACK_GRAVEL = new THREE.Color(0x94897b);     // Weathered grey-taupe stony patches in center
const COL_TRACK_VERGE_MOSS = new THREE.Color(0x668236); // Mossy yellow-green grass encroaching track edges
// Colossal Active Volcano (Mount Doomforge) palette
const COL_VOLCANO_ASH = new THREE.Color(0x2d282b);      // Scorched dark ash-grey lower slopes
const COL_VOLCANO_BASALT = new THREE.Color(0x181417);   // Jagged dark obsidian/basalt cone
const COL_VOLCANO_SCORIA = new THREE.Color(0x592519);   // Heated rust-red volcanic scoria near rim
const COL_VOLCANO_LAVA_CRUST = new THREE.Color(0xb82909); // Deep crimson magma crust
const COL_VOLCANO_LAVA_HOT = new THREE.Color(0xff6a00);   // Incandescent orange molten lava
const COL_VOLCANO_LAVA_CORE = new THREE.Color(0xffd03b);  // Bright yellow-white magma core
const tempColorA = new THREE.Color();
const tempColorB = new THREE.Color();
const tempColorC = new THREE.Color();
const INV_MESO_NORM = 1.0 / 1.7104;

// Coordinates and dimensions of the single giant active volcano (Mount Doomforge)
export const VOLCANO_X = 240.0;
export const VOLCANO_Z = 320.0;
export const VOLCANO_OUTER_RADIUS = 196.0;
export const VOLCANO_OUTER_RADIUS_SQ = VOLCANO_OUTER_RADIUS * VOLCANO_OUTER_RADIUS;
export const VOLCANO_BARREN_RADIUS = 158.0;
export const VOLCANO_BARREN_RADIUS_SQ = VOLCANO_BARREN_RADIUS * VOLCANO_BARREN_RADIUS;
export const VOLCANO_RIM_RADIUS = 44.0;
export const VOLCANO_CRATER_RADIUS = 32.0;
export const VOLCANO_PEAK_HEIGHT = 118.0;
export const VOLCANO_LAVA_LAKE_Y = 89.5;

export class TerrainNoise {
  private macroNoise!: NoiseFunction2D;
  private mesoNoise!: NoiseFunction2D;
  private microNoise!: NoiseFunction2D;
  private warpNoiseX!: NoiseFunction2D;
  private warpNoiseZ!: NoiseFunction2D;
  private meadowNoise!: NoiseFunction2D;
  private riverNoise!: NoiseFunction2D;
  private pondNoise!: NoiseFunction2D;
  private forestNoise!: NoiseFunction2D;
  private trackNoiseA!: NoiseFunction2D;
  private trackNoiseB!: NoiseFunction2D;
  private trackOriginOffsetA = 0;
  private trackOriginOffsetB = 0;
  private lastTrackMicro = 0;
  private config: WorldConfig;
  public lastTrackWeight = 0;

  constructor(config: WorldConfig) {
    this.config = config;
    this.reseed(config.seed);
  }

  public reseed(seed: number): void {
    const rng = createSeededRandom(seed);
    this.macroNoise = createNoise2D(rng);
    this.mesoNoise = createNoise2D(rng);
    this.microNoise = createNoise2D(rng);
    this.warpNoiseX = createNoise2D(rng);
    this.warpNoiseZ = createNoise2D(rng);
    this.meadowNoise = createNoise2D(rng);
    this.riverNoise = createNoise2D(rng);
    this.pondNoise = createNoise2D(rng);
    this.forestNoise = createNoise2D(rng);
    this.trackNoiseA = createNoise2D(rng);
    this.trackNoiseB = createNoise2D(rng);

    // Anchor the primary infinite track so it passes directly through player spawn (0, 0)
    this.trackOriginOffsetA = 0;
    this.trackOriginOffsetA = this.evalTrackPhaseA(0, 0);
    // Place a scenic secondary trail junction ~38m ahead of spawn
    this.trackOriginOffsetB = 0;
    this.trackOriginOffsetB = this.evalTrackPhaseB(0, 0) + 38.0;
  }

  private evalTrackPhaseA(x: number, z: number, precomputedMacro?: number): number {
    const cfg = this.config;
    const steerA =
      (precomputedMacro !== undefined
        ? precomputedMacro
        : this.macroNoise(x * cfg.macroScale, z * cfg.macroScale)) * 36.0;
    const coarseA =
      x * 0.82 -
      z * 0.57 +
      steerA +
      this.trackNoiseA(x * 0.0038, z * 0.0038) * 68.0 -
      this.trackOriginOffsetA;
    const fineA =
      this.trackNoiseB(x * 0.011 + 17.3, z * 0.011 - 29.1) * 18.0 +
      this.microNoise(x * 0.034, z * 0.034) * 3.2;
    return coarseA + fineA;
  }

  private evalTrackPhaseB(x: number, z: number): number {
    const cfg = this.config;
    const steerB = this.macroNoise(x * cfg.macroScale + 13.5, z * cfg.macroScale - 9.2) * 32.0;
    const coarseB =
      x * 0.46 +
      z * 0.888 +
      steerB +
      this.trackNoiseB(x * 0.0036 - 53.1, z * 0.0036 + 41.7) * 64.0 -
      this.trackOriginOffsetB;
    const fineB =
      this.trackNoiseA(x * 0.0105 - 19.8, z * 0.0105 + 63.4) * 17.5 +
      this.microNoise(x * 0.032 + 11.4, z * 0.032 - 8.7) * 3.0;
    return coarseB + fineB;
  }

  /**
   * Fast conservative chunk-level check using the Lipschitz coarse track bound
   * so off-track chunks can skip per-vertex getTrackWeight evaluation.
   */
  public isChunkNearTrack(centerX: number, centerZ: number, halfDiag: number): boolean {
    const cfg = this.config;
    if (!cfg.enableTracks) return false;

    const bound = halfDiag * 1.75 + 21.2 + cfg.trackWidth * 0.5 + 2.1;

    const periodA = 210.0;
    const steerA =
      this.macroNoise(centerX * cfg.macroScale, centerZ * cfg.macroScale) * 36.0;
    const coarseA =
      centerX * 0.82 -
      centerZ * 0.57 +
      steerA +
      this.trackNoiseA(centerX * 0.0038, centerZ * 0.0038) * 68.0 -
      this.trackOriginOffsetA;
    const dA = Math.abs(coarseA - Math.round(coarseA / periodA) * periodA);
    if (dA <= bound) return true;

    if (cfg.trackDensity > 0.05) {
      const periodB = 300.0 - cfg.trackDensity * 105.0;
      const steerB =
        this.macroNoise(centerX * cfg.macroScale + 13.5, centerZ * cfg.macroScale - 9.2) *
        32.0;
      const coarseB =
        centerX * 0.46 +
        centerZ * 0.888 +
        steerB +
        this.trackNoiseB(centerX * 0.0036 - 53.1, centerZ * 0.0036 + 41.7) * 64.0 -
        this.trackOriginOffsetB;
      const dB = Math.abs(coarseB - Math.round(coarseB / periodB) * periodB);
      if (dB <= bound) return true;
    }

    return false;
  }

  /**
   * Computes the distance (in meters) to the nearest infinite winding footpath centerline,
   * using coarse-bound early-outs so off-track points skip fine octave evaluations.
   */
  public getTrackDistance(x: number, z: number, precomputedMacro?: number): number {
    const cfg = this.config;
    if (!cfg.enableTracks) return 999.0;

    const periodA = 210.0;
    const steerA =
      (precomputedMacro !== undefined
        ? precomputedMacro
        : this.macroNoise(x * cfg.macroScale, z * cfg.macroScale)) * 36.0;
    const coarseA =
      x * 0.82 -
      z * 0.57 +
      steerA +
      this.trackNoiseA(x * 0.0038, z * 0.0038) * 68.0 -
      this.trackOriginOffsetA;
    let dA = Math.abs(coarseA - Math.round(coarseA / periodA) * periodA);

    let microSample = 0;
    if (dA < 28.0) {
      microSample = this.microNoise(x * 0.034, z * 0.034);
      const fineA =
        coarseA +
        this.trackNoiseB(x * 0.011 + 17.3, z * 0.011 - 29.1) * 18.0 +
        microSample * 3.2;
      dA = Math.abs(fineA - Math.round(fineA / periodA) * periodA);
    }

    let d = dA;

    if (cfg.trackDensity > 0.05) {
      const periodB = 300.0 - cfg.trackDensity * 105.0;
      const steerB = this.macroNoise(x * cfg.macroScale + 13.5, z * cfg.macroScale - 9.2) * 32.0;
      const coarseB =
        x * 0.46 +
        z * 0.888 +
        steerB +
        this.trackNoiseB(x * 0.0036 - 53.1, z * 0.0036 + 41.7) * 64.0 -
        this.trackOriginOffsetB;
      let dB = Math.abs(coarseB - Math.round(coarseB / periodB) * periodB);

      // Only evaluate fineB if it can possibly beat dA or enter the k=3.2 junction smooth-min window
      if (dB < 27.0 && dB - 20.5 < dA + 3.2) {
        const microB = this.microNoise(x * 0.032 + 11.4, z * 0.032 - 8.7);
        if (dB < dA || microSample === 0) {
          microSample = microB;
        }
        const fineB =
          coarseB +
          this.trackNoiseA(x * 0.0105 - 19.8, z * 0.0105 + 63.4) * 17.5 +
          microB * 3.0;
        dB = Math.abs(fineB - Math.round(fineB / periodB) * periodB);
      }

      // Smooth-min at trail junctions so forks & crossroads flare naturally
      if (dA < 12.0 && dB < 12.0) {
        const k = 3.2;
        const h = Math.max(0.0, k - Math.abs(dA - dB)) / k;
        d = Math.min(dA, dB) - h * h * k * 0.25;
      } else {
        d = Math.min(dA, dB);
      }
    }

    this.lastTrackMicro = microSample;
    return Math.max(0.0, d);
  }

  /**
   * Returns a continuous [0, 1] track weight at world (x, z):
   * - 0.0: off-track meadow / forest
   * - 0.05 .. 0.45: raised grassy verge, root bank & fern border
   * - 0.45 .. 1.0: worn sandy-ochre dirt footpath bed (1.0 at centerline)
   */
  public getTrackWeight(
    x: number,
    z: number,
    wy?: number,
    precomputedMacro?: number
  ): number {
    const cfg = this.config;
    if (!cfg.enableTracks) return 0;

    if (wy !== undefined && cfg.enableWater && wy < cfg.waterLevel + 0.15) {
      return 0;
    }

    const vdx = x - VOLCANO_X;
    const vdz = z - VOLCANO_Z;
    const vDistSq = vdx * vdx + vdz * vdz;
    if (vDistSq <= 125.0 * 125.0) {
      return 0;
    }

    const d = this.getTrackDistance(x, z, precomputedMacro);
    const halfDirt = cfg.trackWidth * 0.5;
    const maxRadius = halfDirt + 2.1;
    if (d >= maxRadius) return 0;

    // Organic edge undulation so the track width breathes and grass encroaches irregularly
    // Reuses lastTrackMicro evaluated inside getTrackDistance to avoid a second microNoise call
    const edgeNoise =
      this.meadowNoise(x * 0.085 + 7.1, z * 0.085 - 13.4) * 0.34 +
      this.lastTrackMicro * 0.18;
    const effHalfDirt = Math.max(0.85, halfDirt + edgeNoise);
    const effOuter = effHalfDirt + 1.45;

    if (d >= effOuter) return 0;

    let weight: number;
    if (d <= effHalfDirt) {
      // Map [0, effHalfDirt] -> [1.0, 0.45]
      const t = d / effHalfDirt;
      weight = 1.0 - t * t * 0.55;
    } else {
      // Map [effHalfDirt, effOuter] -> [0.45, 0.0]
      const t = THREE.MathUtils.smoothstep(d, effHalfDirt, effOuter);
      weight = 0.45 * (1.0 - t);
    }

    if (wy !== undefined && cfg.enableWater) {
      const waterFade = THREE.MathUtils.smoothstep(
        wy,
        cfg.waterLevel + 0.15,
        cfg.waterLevel + 1.05
      );
      weight *= waterFade;
    }

    if (vDistSq < 168.0 * 168.0) {
      weight *= THREE.MathUtils.smoothstep(Math.sqrt(vDistSq), 125.0, 168.0);
    }

    return weight;
  }

  /**
   * Computes the unit 2D tangent direction (tx, tz) along the active track (Track A or Track B) at (x, z).
   */
  public getTrackHeading(x: number, z: number): number {
    const eps = 1.0;
    const cfg = this.config;
    let useTrackB = false;

    if ((x !== 0 || z !== 0) && cfg.trackDensity > 0.05) {
      const periodA = 210.0;
      const phaseA = this.evalTrackPhaseA(x, z);
      const dA = Math.abs(phaseA - Math.round(phaseA / periodA) * periodA);

      const periodB = 300.0 - cfg.trackDensity * 105.0;
      const phaseB = this.evalTrackPhaseB(x, z);
      const dB = Math.abs(phaseB - Math.round(phaseB / periodB) * periodB);
      if (dB < dA) {
        useTrackB = true;
      }
    }

    const gx = useTrackB
      ? this.evalTrackPhaseB(x + eps, z) - this.evalTrackPhaseB(x - eps, z)
      : this.evalTrackPhaseA(x + eps, z) - this.evalTrackPhaseA(x - eps, z);
    const gz = useTrackB
      ? this.evalTrackPhaseB(x, z + eps) - this.evalTrackPhaseB(x, z - eps)
      : this.evalTrackPhaseA(x, z + eps) - this.evalTrackPhaseA(x, z - eps);
    // Tangent is perpendicular to phase gradient (gx, gz)
    const tx = -gz;
    const tz = gx;
    return Math.atan2(tx, tz);
  }

  /**
   * Validates and computes a bank-to-bank Wooden River Bridge placement near (sampleX, sampleZ).
   * Ensures:
   * 1. Starts on a submerged footpath segment (never far from a trail).
   * 2. Searches candidate angles within +-55 deg of the footpath heading to find the shortest
   *    shore-to-shore crossing line where BOTH ends reach solid dry riverbanks (5m .. 34m span).
   * 3. Verifies that both shores remain on dry land 3.0m and 5.5m inland (and at +-1.85m lateral corners),
   *    rejecting all beaches, sandbars, and wide lakes/bays.
   * 4. Centers the bridge at the exact midpoint between the two shorelines and scales its length
   *    (+5.6m total overlap) so both sloped approach ramps embed firmly into dry ground.
   */
  public findValidatedBridgePlacement(
    sampleX: number,
    sampleZ: number,
    chunkCenterX: number,
    chunkCenterZ: number,
    chunkSize: number
  ): { x: number; y: number; z: number; heading: number; length: number } | null {
    const cfg = this.config;
    if (!cfg.enableTracks || !cfg.enableWater) return null;

    const dist0 = this.getTrackDistance(sampleX, sampleZ);
    if (dist0 > 5.0) return null;

    const waterY = cfg.waterLevel;
    const wy0 = this.getHeight(sampleX, sampleZ, true);
    if (wy0 >= waterY - 0.2 || wy0 <= waterY - 3.2) return null;

    const baseHeading = this.getTrackHeading(sampleX, sampleZ);
    const baseDirX = Math.sin(baseHeading);
    const baseDirZ = Math.cos(baseHeading);
    const basePerpX = baseDirZ;
    const basePerpZ = -baseDirX;

    // 1. Snap laterally onto the footpath centerline
    let startX = sampleX;
    let startZ = sampleZ;
    let bestTrackDist = dist0;
    for (let offset = -4.0; offset <= 4.0; offset += 1.0) {
      if (offset === 0) continue;
      const tx = sampleX + basePerpX * offset;
      const tz = sampleZ + basePerpZ * offset;
      const td = this.getTrackDistance(tx, tz);
      if (td < bestTrackDist) {
        bestTrackDist = td;
        startX = tx;
        startZ = tz;
      }
    }
    if (bestTrackDist > 3.0) return null;
    if (this.getHeight(startX, startZ, true) >= waterY - 0.2) return null;

    const trackHeading = this.getTrackHeading(startX, startZ);

    // 2. Search angles within +-55 deg of the footpath heading to find the shortest bank-to-bank crossing
    let bestSpan = 999.0;
    let bestHeading = trackHeading;
    let bestMidX = startX;
    let bestMidZ = startZ;

    for (let deg = -55; deg <= 55; deg += 11) {
      const candHeading = trackHeading + (deg * Math.PI) / 180.0;
      const dx = Math.sin(candHeading);
      const dz = Math.cos(candHeading);

      let dPos = -1;
      for (let d = 1.0; d <= 21.0; d += 1.0) {
        if (this.getHeight(startX + dx * d, startZ + dz * d, true) >= waterY + 0.2) {
          dPos = d;
          break;
        }
      }
      if (dPos < 0) continue;

      let dNeg = -1;
      for (let d = 1.0; d <= 21.0; d += 1.0) {
        if (this.getHeight(startX - dx * d, startZ - dz * d, true) >= waterY + 0.2) {
          dNeg = d;
          break;
        }
      }
      if (dNeg < 0) continue;

      const span = dPos + dNeg;
      if (span < 5.0 || span > 34.0 || span >= bestSpan) continue;

      const midOffset = 0.5 * (dPos - dNeg);
      const midX = startX + dx * midOffset;
      const midZ = startZ + dz * midOffset;

      // Channel midpoint must be genuinely underwater (not an island) and still near the footpath
      const midBedY = this.getHeight(midX, midZ, true);
      if (midBedY > waterY - 0.35 || midBedY < waterY - 3.5) continue;
      if (this.getTrackDistance(midX, midZ) > 5.5) continue;

      const halfWater = span * 0.5;
      const perpX = dz;
      const perpZ = -dx;
      let banksValid = true;

      for (const sign of [-1, 1] as const) {
        const bankDist = halfWater + 2.6;
        const inlandDist = halfWater + 5.2;
        const bx = midX + dx * sign * bankDist;
        const bz = midZ + dz * sign * bankDist;
        const ix = midX + dx * sign * inlandDist;
        const iz = midZ + dz * sign * inlandDist;

        const bankY = this.getHeight(bx, bz, true);
        const inlandY = this.getHeight(ix, iz, true);
        if (bankY < waterY + 0.25 || inlandY < waterY + 0.35) {
          banksValid = false;
          break;
        }

        // Both left and right corners of each abutment must rest on dry land (rejects oblique beaches)
        const leftCornerY = this.getHeight(bx - perpX * 1.85, bz - perpZ * 1.85, true);
        const rightCornerY = this.getHeight(bx + perpX * 1.85, bz + perpZ * 1.85, true);
        if (leftCornerY < waterY + 0.12 || rightCornerY < waterY + 0.12) {
          banksValid = false;
          break;
        }
      }

      if (!banksValid) continue;

      bestSpan = span;
      bestHeading = candHeading;
      bestMidX = midX;
      bestMidZ = midZ;
    }

    if (bestSpan > 34.0) return null;

    // Strictly assign the bridge to the chunk that contains (bestMidX, bestMidZ) so adjacent chunks never duplicate it
    const halfChunk = chunkSize * 0.5;
    if (
      bestMidX < chunkCenterX - halfChunk ||
      bestMidX >= chunkCenterX + halfChunk ||
      bestMidZ < chunkCenterZ - halfChunk ||
      bestMidZ >= chunkCenterZ + halfChunk
    ) {
      return null;
    }

    if (this.isInsideVolcanoBarrenZone(bestMidX, bestMidZ)) return null;

    // Add 2.8m of dry-bank overlap on each shore (+5.6m total) so both approach ramps embed firmly into dry ground
    const totalLength = THREE.MathUtils.clamp(bestSpan + 5.6, 11.0, 39.6);

    return {
      x: bestMidX,
      y: waterY + 0.55,
      z: bestMidZ,
      heading: bestHeading,
      length: totalLength,
    };
  }

  /**
   * Deterministic chunk-level bridge finder shared by LandmarkManager and WorldMap.
   * Uses the Lipschitz coarse track bound to skip off-track chunks in O(1), then tests
   * the two seeded candidate points followed by a 5x5 chunk grid so genuine river crossings
   * along footpaths reliably receive a bank-to-bank bridge.
   */
  public findChunkBridgePlacement(
    cx: number,
    cz: number,
    zRand0: number,
    zRand1: number
  ): { x: number; y: number; z: number; heading: number; length: number } | null {
    const cfg = this.config;
    if (!cfg.enableTracks || !cfg.enableWater) return null;

    const size = cfg.chunkSize;
    const chunkWx = cx * size;
    const chunkWz = cz * size;
    if (!this.isChunkNearTrack(chunkWx, chunkWz, size * 0.71)) {
      return null;
    }

    const s0x = chunkWx - size * 0.24;
    const s0z = chunkWz + (zRand0 - 0.5) * (size * 0.45);
    const hit0 = this.findValidatedBridgePlacement(s0x, s0z, chunkWx, chunkWz, size);
    if (hit0) return hit0;

    const s1x = chunkWx + size * 0.24;
    const s1z = chunkWz + (zRand1 - 0.5) * (size * 0.45);
    const hit1 = this.findValidatedBridgePlacement(s1x, s1z, chunkWx, chunkWz, size);
    if (hit1) return hit1;

    for (let gz = -2; gz <= 2; gz++) {
      for (let gx = -2; gx <= 2; gx++) {
        const px = chunkWx + gx * (size * 0.2);
        const pz = chunkWz + gz * (size * 0.2);
        const hit = this.findValidatedBridgePlacement(px, pz, chunkWx, chunkWz, size);
        if (hit) return hit;
      }
    }

    return null;
  }

  /**
   * Evaluates the continuous world elevation (Y in meters) at any world (X, Z) coordinate.
   * Combines domain warping, multi-octave fBm, meandering river valley carving, and natural pond basins.
   */
  public getHeight(x: number, z: number, skipTracks = false): number {
    const cfg = this.config;

    // 1. Domain Warping: gently bend coordinates so hills and rivers curve organically
    const warpFreq = cfg.macroScale * 1.35;
    const wx = x + this.warpNoiseX(x * warpFreq, z * warpFreq) * cfg.domainWarpStrength;
    const wz = z + this.warpNoiseZ(x * warpFreq, z * warpFreq) * cfg.domainWarpStrength;

    // 2. Macro Layer: sweeping hills and broad valleys (2 octaves)
    const macro1 = this.macroNoise(wx * cfg.macroScale, wz * cfg.macroScale);
    const macro2 = 0.5 * this.macroNoise(wx * cfg.macroScale * 2.05, wz * cfg.macroScale * 2.05);
    let macro = (macro1 + macro2) / 1.5; // [-1, 1]

    // Soften valley bottoms so ponds/paths have natural basins while keeping hilltops rounded
    if (macro < 0 && cfg.valleyFlatten > 0) {
      const t = 1.0 - cfg.valleyFlatten * 0.55;
      macro = -Math.pow(-macro, t) * (1.0 - cfg.valleyFlatten * 0.25);
    }

    // 3. Meso Layer: rolling ridges, knolls, and local slopes (3 octaves, unrolled)
    const f0 = cfg.mesoScale;
    const n0 = this.mesoNoise(wx * f0, wz * f0);
    const b0 = n0 * 0.72 + (1.0 - 2.0 * Math.abs(n0)) * 0.28;

    const f1 = f0 * 2.2;
    const n1 = this.mesoNoise(wx * f1 + 31.7, wz * f1 - 19.3);
    const b1 = n1 * 0.72 + (1.0 - 2.0 * Math.abs(n1)) * 0.28;

    const f2 = f0 * 4.84;
    const n2 = this.mesoNoise(wx * f2 + 63.4, wz * f2 - 38.6);
    const b2 = n2 * 0.72 + (1.0 - 2.0 * Math.abs(n2)) * 0.28;

    const meso = (b0 + b1 * 0.48 + b2 * 0.2304) * INV_MESO_NORM;

    const valleyMask = THREE.MathUtils.clamp((macro + 0.65) * 0.85, 0.35, 1.0);

    // 4. Micro Layer: subtle ground undulation (2 octaves)
    const micro =
      0.67 * this.microNoise(x * cfg.microScale, z * cfg.microScale) +
      0.33 * this.microNoise(x * cfg.microScale * 2.3, z * cfg.microScale * 2.3);

    let height =
      macro * cfg.macroAmplitude +
      meso * cfg.mesoAmplitude * valleyMask +
      micro * cfg.microAmplitude;

    const vdx = x - VOLCANO_X;
    const vdz = z - VOLCANO_Z;
    const vDistSq = vdx * vdx + vdz * vdz;
    const insideVolcano = vDistSq < VOLCANO_OUTER_RADIUS_SQ;
    const vDist = insideVolcano ? Math.sqrt(vDistSq) : 0;

    // 5. Meandering Rivers & Natural Pond Basins (suppressed inside the volcano cone)
    if (
      (cfg.riverCarveStrength > 0 || cfg.pondFrequency > 0) &&
      (!insideVolcano || vDistSq > VOLCANO_BARREN_RADIUS_SQ)
    ) {
      const waterY = cfg.waterLevel;
      const outerFade = insideVolcano
        ? THREE.MathUtils.smoothstep(
            vDist,
            VOLCANO_BARREN_RADIUS,
            VOLCANO_OUTER_RADIUS
          )
        : 1.0;

      // A) Meandering River Network using zero-crossing of domain-warped simplex noise
      if (cfg.riverCarveStrength > 0) {
        const riverFreq = 0.0017;
        // Offset coordinates slightly so a scenic river passes near (but not directly under) spawn (0,0)
        const rx = wx + 55.0;
        const rz = wz - 35.0;
        const rVal = Math.abs(this.riverNoise(rx * riverFreq, rz * riverFreq));

        // Max possible valleyHalfWidth occurs when widthMod = 1.4 (1.4 * 0.0019 * 5.2 = 0.013832)
        if (rVal < cfg.riverWidth * 0.013832) {
          // Vary river width along its length so it naturally widens into river-ponds
          const widthMod = 0.75 + 0.65 * (this.pondNoise(x * 0.008, z * 0.008) * 0.5 + 0.5);
          const channelHalfWidth = cfg.riverWidth * widthMod * 0.0019;
          const valleyHalfWidth = channelHalfWidth * 5.2;

          if (rVal < valleyHalfWidth) {
            // Smoothly grade surrounding hills down into a gentle river valley corridor
            const valleyT = 1.0 - THREE.MathUtils.smoothstep(rVal, channelHalfWidth, valleyHalfWidth);
            const bankElevation = waterY + 1.35 + micro * 0.45;
            height = THREE.MathUtils.lerp(
              height,
              Math.min(height, bankElevation + (height - bankElevation) * 0.18),
              valleyT * cfg.riverCarveStrength * outerFade
            );

            // Carve the wet river channel below waterLevel
            if (rVal < channelHalfWidth) {
              const channelT = 1.0 - THREE.MathUtils.smoothstep(rVal, 0, channelHalfWidth);
              const bedDepth = 2.2 * widthMod;
              height -= channelT * bedDepth * cfg.riverCarveStrength * outerFade;
            }
          }
        }
      }

      // B) Scenic starter fishing pond near spawn around (18, -14)
      if (cfg.pondFrequency > 0) {
        const spDx = x - 18.0;
        const spDz = z + 14.0;
        const spDistSq = spDx * spDx + spDz * spDz;
        if (spDistSq < 324.0) {
          const spDist = Math.sqrt(spDistSq);
          const rimNoise = micro * 0.75;
          const innerBasinR = 8.8 + rimNoise;
          const outerBankR = 17.2 + rimNoise;
          if (spDist < outerBankR) {
            const bankT = 1.0 - THREE.MathUtils.smoothstep(spDist, innerBasinR, outerBankR);
            const shoreTarget = waterY + 0.65 + micro * 0.25;
            height = THREE.MathUtils.lerp(height, shoreTarget, bankT);
            if (spDist < innerBasinR + 1.5) {
              const deepT = 1.0 - THREE.MathUtils.smoothstep(spDist, 2.5, innerBasinR + 1.2);
              const bedTarget = waterY - 1.75;
              height = THREE.MathUtils.lerp(height, bedTarget, deepT);
            }
          }
        }
      }

      // C) Natural Pond Basins in low-to-mid valleys (early-out on high terrain before evaluating pondNoise)
      if (cfg.pondFrequency > 0 && height < waterY + 11.0) {
        const pondN = this.pondNoise(wx * 0.0065 + 110, wz * 0.0065 - 75);
        const threshold = 0.68 - cfg.pondFrequency * 0.32; // Higher pondFrequency -> lower threshold
        if (pondN > threshold) {
          const pondFactor = THREE.MathUtils.smoothstep(pondN, threshold, threshold + 0.22);
          // Only form ponds where terrain isn't a high mountain peak
          const elevWeight = 1.0 - THREE.MathUtils.smoothstep(height, waterY + 1.0, waterY + 11.0);
          const basinTarget = waterY - 1.85;
          height = THREE.MathUtils.lerp(height, basinTarget, pondFactor * elevWeight * 0.92 * outerFade);
        }
      }
    }

    // 6. Infinite Winding Forest Tracks (graded footpath trough + subtle shoulder banks)
    this.lastTrackWeight = 0;
    if (
      !skipTracks &&
      cfg.enableTracks &&
      (!insideVolcano || vDistSq > 125.0 * 125.0) &&
      (!cfg.enableWater || height > cfg.waterLevel + 0.15)
    ) {
      const trackW = this.getTrackWeight(x, z, height);
      this.lastTrackWeight = trackW;
      if (trackW > 0.001) {
        // Level out sharp micro bumps along the walking bed
        height -= micro * cfg.microAmplitude * 0.42 * trackW;

        // Worn center trough (-0.15m) + subtle raised earthen root bank (+0.045m) at shoulders
        const centerTrough = THREE.MathUtils.smoothstep(trackW, 0.36, 1.0);
        const shoulderBank =
          Math.sin(THREE.MathUtils.clamp(trackW / 0.46, 0, 1) * Math.PI) *
          (1.0 - centerTrough);
        height += shoulderBank * 0.048 - centerTrough * 0.15;
      }
    }

    // 7. Single Colossal Active Volcano (Mount Doomforge at VOLCANO_X, VOLCANO_Z)
    if (insideVolcano) {
      const angle = Math.atan2(vdz, vdx);
      // Jagged radial basalt ribs & crags along the volcanic cone
      const ribWave =
        Math.sin(angle * 7.0 + micro * 0.85) * 0.55 +
        Math.cos(angle * 13.0 - vDist * 0.045) * 0.45;
      const lavaChannel = this.getVolcanoLavaChannelWeight(vdx, vdz, vDist, angle);
      const channelCarve = lavaChannel * 1.65;

      if (vDist >= VOLCANO_RIM_RADIUS) {
        const u = THREE.MathUtils.clamp(
          (VOLCANO_OUTER_RADIUS - vDist) / (VOLCANO_OUTER_RADIUS - VOLCANO_RIM_RADIUS),
          0,
          1
        );
        // Smooth concave-upward stratovolcano cone profile that rounds at the caldera rim
        const skirtBlend = THREE.MathUtils.smoothstep(u, 0.0, 0.22);
        const coneProfile = Math.pow(u, 1.48) * (1.0 - 0.12 * Math.pow(u, 5.0)) / 0.88;
        const rimCrags =
          ribWave * (2.6 * Math.sin(u * Math.PI) + 1.8 * THREE.MathUtils.smoothstep(u, 0.78, 1.0));
        const volcanoElev =
          VOLCANO_PEAK_HEIGHT * coneProfile + rimCrags - channelCarve + micro * 1.15;
        height = THREE.MathUtils.lerp(height, Math.max(height, volcanoElev), skirtBlend);
      } else {
        // Inside the Caldera Rim: steep rocky inner crater walls plunging into the molten magma cauldron
        const rimPeakY =
          VOLCANO_PEAK_HEIGHT + ribWave * 1.8 - channelCarve + micro * 1.15;
        const craterT = THREE.MathUtils.smoothstep(
          vDist,
          VOLCANO_CRATER_RADIUS * 0.65,
          VOLCANO_RIM_RADIUS
        );
        const craterFloorY = VOLCANO_LAVA_LAKE_Y - 4.5 + micro * 0.6;
        height = THREE.MathUtils.lerp(craterFloorY, rimPeakY, craterT * craterT);
      }
    }

    return height;
  }

  /**
   * Returns true if world (x, z) lies on the barren basalt/lava slopes of Mount Doomforge
   * where meadow grass and trees should not grow.
   */
  public isInsideVolcanoBarrenZone(x: number, z: number): boolean {
    const dx = x - VOLCANO_X;
    const dz = z - VOLCANO_Z;
    return dx * dx + dz * dz < VOLCANO_BARREN_RADIUS_SQ;
  }

  /**
   * Returns [0, 1] weight for the 4 glowing radial magma rivers flowing down Mount Doomforge's flanks.
   */
  public getVolcanoLavaChannelWeight(
    vdx: number,
    vdz: number,
    vDist: number,
    precomputedAngle?: number
  ): number {
    if (vDist < 36.0 || vDist > 152.0) return 0;
    const angle = precomputedAngle !== undefined ? precomputedAngle : Math.atan2(vdz, vdx);
    const meander = Math.sin(vDist * 0.055 + angle * 2.0) * 0.24;
    const wave = Math.cos((angle + meander) * 4.0);
    if (wave <= 0.76) return 0;
    const channelCross = THREE.MathUtils.smoothstep(wave, 0.76, 0.96);
    const radialFade =
      THREE.MathUtils.smoothstep(vDist, 36.0, 48.0) *
      (1.0 - THREE.MathUtils.smoothstep(vDist, 118.0, 152.0));
    return channelCross * radialFade;
  }

  /**
   * Computes the continuous surface normal at world (x, z) via central finite differences.
   * Using this across chunk boundaries guarantees zero lighting seams between chunks.
   */
  public getNormal(x: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
    const eps = 0.35;
    const hL = this.getHeight(x - eps, z);
    const hR = this.getHeight(x + eps, z);
    const hD = this.getHeight(x, z - eps);
    const hU = this.getHeight(x, z + eps);

    target.set(hL - hR, 2.0 * eps, hD - hU).normalize();
    return target;
  }

  /**
   * Returns a smooth [0, 1] meadow patch value used to vary grass clumping, height, and color tones.
   */
  public getMeadowPatch(x: number, z: number): number {
    const n1 = this.meadowNoise(x * 0.025, z * 0.025);
    const n2 = 0.5 * this.meadowNoise(x * 0.075 + 19.4, z * 0.075 - 11.2);
    return THREE.MathUtils.clamp((n1 + n2) * 0.45 + 0.5, 0, 1);
  }

  /**
   * Returns a smooth [0, 1] intensity for dense, waist-high grass areas (~0.75m - 0.95m tall).
   * Forms contiguous, natural tall-grass swales in open meadows and along sunny clearings,
   * including scenic starter patches just off the footpath near player spawn.
   */
  public getTallGrassFactor(x: number, z: number): number {
    const coverage = this.config.tallGrassCoverage;
    if (coverage <= 0.001) return 0;
    const vdx = x - VOLCANO_X;
    const vdz = z - VOLCANO_Z;
    if (vdx * vdx + vdz * vdz < VOLCANO_OUTER_RADIUS_SQ) return 0;

    // Scenic starter tall-grass meadows right beside the initial footpath near (0, 0)
    let starterBoost = 0;
    const dx1 = x - 9.5;
    const dz1 = z - 10.5;
    const dSq1 = dx1 * dx1 + dz1 * dz1;
    if (dSq1 < 132.0) {
      starterBoost = 1.0 - THREE.MathUtils.smoothstep(dSq1, 28.0, 132.0);
    }
    const dx2 = x + 11.5;
    const dz2 = z - 6.0;
    const dSq2 = dx2 * dx2 + dz2 * dz2;
    if (dSq2 < 110.0) {
      starterBoost = Math.max(
        starterBoost,
        1.0 - THREE.MathUtils.smoothstep(dSq2, 22.0, 110.0)
      );
    }

    // Broad organic tall-grass zones (~30-45m across) with irregular feathered borders
    const n1 = this.meadowNoise(x * 0.017 - 31.4, z * 0.017 + 47.8);
    const n2 = 0.45 * this.pondNoise(x * 0.043 + 18.2, z * 0.043 - 24.6);
    const raw = (n1 + n2) / 1.45; // [-1, 1]
    const normalized = raw * 0.5 + 0.5;

    const cutoff = 0.72 - coverage * 0.42;
    let zone = 0;
    if (normalized > cutoff) {
      zone = THREE.MathUtils.smoothstep(
        normalized,
        cutoff,
        Math.min(0.98, cutoff + 0.22)
      );
    }

    return Math.max(zone, starterBoost * THREE.MathUtils.clamp(coverage * 1.4, 0, 1));
  }

  /**
   * Returns [0, 1] forest grove intensity at world (x, z).
   * Returns 0 in open meadows/clearings (~50-60% of the world) and 0..1 inside wooded groves,
   * ensuring distinct open areas and non-crowded tree clusters.
   */
  public getForestDensity(x: number, z: number): number {
    // Keep a small natural clearing right at player spawn (0, 0) for an unobstructed initial vista
    const spawnDistSq = x * x + z * z;
    if (spawnDistSq <= 100) return 0;

    // Keep the slopes and caldera of Mount Doomforge barren of trees
    const vdx = x - VOLCANO_X;
    const vdz = z - VOLCANO_Z;
    const vDistSq = vdx * vdx + vdz * vdz;
    if (vDistSq <= VOLCANO_BARREN_RADIUS_SQ) return 0;

    const spawnClearing = THREE.MathUtils.smoothstep(spawnDistSq, 100, 550);
    const volcanoClearing =
      vDistSq < VOLCANO_OUTER_RADIUS_SQ
        ? THREE.MathUtils.smoothstep(vDistSq, VOLCANO_BARREN_RADIUS_SQ, VOLCANO_OUTER_RADIUS_SQ)
        : 1.0;

    const n1 = this.forestNoise(x * 0.0055, z * 0.0055);
    const n2 = 0.45 * this.forestNoise(x * 0.014 - 41.2, z * 0.014 + 27.8);
    const raw = (n1 + n2) / 1.45; // [-1, 1] normalized to [0, 1] below
    const normalized = raw * 0.5 + 0.5;

    const cutoff = 1.0 - this.config.forestCoverage;
    if (normalized <= cutoff) return 0;

    const grove = THREE.MathUtils.smoothstep(normalized, cutoff, Math.min(1.0, cutoff + 0.28));
    return grove * spawnClearing * volcanoClearing;
  }

  /**
   * Computes the natural meadow/terrain color at (x, y, z) including sandy pond/river banks.
   */
  public getSurfaceColor(
    x: number,
    y: number,
    z: number,
    normal: THREE.Vector3,
    target = new THREE.Color(),
    precomputedTrackW?: number,
    precomputedPatch?: number,
    precomputedGrove?: number
  ): THREE.Color {
    const patch =
      precomputedPatch !== undefined ? precomputedPatch : this.getMeadowPatch(x, z);
    const isUnderwater =
      this.config.enableWater && y < this.config.waterLevel - 0.5;
    const grove =
      this.config.forestCoverage > 0.001 &&
      !isUnderwater &&
      (precomputedTrackW === undefined || precomputedTrackW < 0.65)
        ? precomputedGrove !== undefined
          ? precomputedGrove
          : this.getForestDensity(x, z)
        : 0;

    // Blend between lush green and warm sunlit yellow-green based on meadow patch noise
    tempColorA.copy(COL_LUSH_GRASS).lerp(COL_SUNLIT_GRASS, patch);

    // Slightly richer mossy shade underneath tree groves
    if (grove > 0.01) {
      tempColorA.lerp(COL_FOREST_FLOOR, grove * 0.35);
    }

    // Subtle elevation tinting: deeper mossy green in low valleys, breezy green on high hills
    const elevFactor = THREE.MathUtils.clamp((y + 20) / 50, 0, 1);
    if (elevFactor < 0.45) {
      const t = 1.0 - elevFactor / 0.45;
      tempColorA.lerp(COL_DEEP_VALLEY, t * 0.4);
    } else {
      const t = (elevFactor - 0.45) / 0.55;
      tempColorA.lerp(COL_HIGH_RIDGE, t * 0.25);
    }

    // Blend in warm earthy dirt on steeper slopes
    const slope = 1.0 - THREE.MathUtils.clamp(normal.y, 0, 1);
    const earthBlend = THREE.MathUtils.smoothstep(slope, 0.22, 0.48);
    tempColorB.copy(tempColorA).lerp(COL_STEEP_EARTH, earthBlend * 0.78);

    // Painterly Forest Track Coloring (matching art/forest_track.jpg)
    if (this.config.enableTracks) {
      const trackW =
        precomputedTrackW !== undefined ? precomputedTrackW : this.getTrackWeight(x, z, y);
      if (trackW > 0.01) {
        // 1. Verge moss & root bank transition on the shoulders (0.01 .. 0.48)
        const vergeFactor = THREE.MathUtils.smoothstep(trackW, 0.02, 0.38);
        tempColorB.lerp(COL_TRACK_VERGE_MOSS, vergeFactor * 0.55);

        // 2. Worn sandy-ochre dirt bed in the track interior (0.24 .. 1.0)
        if (trackW > 0.22) {
          // High-frequency soil & pebble mottling along the path
          const soilDetail = this.microNoise(x * 0.19 + 41.2, z * 0.19 - 23.8); // [-1, 1]
          const sunSoilT = THREE.MathUtils.clamp(0.5 + soilDetail * 0.45 + (patch - 0.5) * 0.35, 0, 1);
          tempColorC.copy(COL_TRACK_DIRT_MID).lerp(COL_TRACK_DIRT_LIGHT, sunSoilT);

          // Darker compacted earth in wheel/boot ruts & embankment edges
          const rutMask = THREE.MathUtils.smoothstep(trackW, 0.42, 0.72) * (1.0 - THREE.MathUtils.smoothstep(trackW, 0.82, 1.0));
          const rutDarken = THREE.MathUtils.clamp(rutMask * 0.65 + (soilDetail < -0.15 ? (-soilDetail - 0.15) * 0.55 : 0), 0, 0.75);
          tempColorC.lerp(COL_TRACK_RUT_DARK, rutDarken);

          // Weathered grey-taupe gravel/cobble tint in stony pockets along the center
          if (trackW > 0.52) {
            const stonyPatch = this.meadowNoise(x * 0.095 - 14.5, z * 0.095 + 31.1); // [-1, 1]
            if (stonyPatch > 0.08) {
              const gravelT = THREE.MathUtils.smoothstep(stonyPatch, 0.08, 0.65) * THREE.MathUtils.smoothstep(trackW, 0.52, 0.85);
              tempColorC.lerp(COL_TRACK_GRAVEL, gravelT * 0.52);
            }
          }

          // Irregular mossy edge breakup so dirt & grass interpenetrate naturally
          const edgeBreakup = soilDetail * 0.08;
          const dirtBlend = THREE.MathUtils.smoothstep(trackW + edgeBreakup, 0.25, 0.56);
          tempColorB.lerp(tempColorC, dirtBlend * 0.96);
        }
      }
    }

    // Shoreline & Riverbed coloring near/below waterLevel (matching sandy/earthy pond rims in art)
    if (this.config.enableWater) {
      const waterY = this.config.waterLevel;
      const distAboveWater = y - waterY;
      if (distAboveWater < 0.95) {
        // Warm sandy/earthy bank rim just above and at water edge
        const shoreFactor = 1.0 - THREE.MathUtils.smoothstep(distAboveWater, -0.15, 0.95);
        tempColorB.lerp(COL_SHORE_BANK, shoreFactor * 0.88);

        // Darker wet silt/pebbles deeper underwater
        if (distAboveWater < -0.1) {
          const deepFactor = THREE.MathUtils.smoothstep(-distAboveWater, 0.1, 1.8);
          tempColorB.lerp(COL_RIVERBED, deepFactor * 0.85);
        }
      }
    }

    // Colossal Active Volcano (Mount Doomforge) Basalt, Scoria & Molten Magma Coloring
    const vdx = x - VOLCANO_X;
    const vdz = z - VOLCANO_Z;
    const vDistSq = vdx * vdx + vdz * vdz;
    if (vDistSq < VOLCANO_OUTER_RADIUS_SQ) {
      const vDist = Math.sqrt(vDistSq);
      const volcanoBlend = 1.0 - THREE.MathUtils.smoothstep(vDist, 142.0, VOLCANO_OUTER_RADIUS - 4.0);
      if (volcanoBlend > 0.001) {
        const elevT = THREE.MathUtils.clamp((y - 12.0) / (VOLCANO_PEAK_HEIGHT - 12.0), 0, 1);
        tempColorC.copy(COL_VOLCANO_ASH).lerp(COL_VOLCANO_BASALT, Math.min(1, elevT * 1.15 + slope * 0.35));

        // Heated rust-red scoria & sulfur tint near the caldera rim and steep upper crags
        if (vDist < 78.0) {
          const rimHeat = 1.0 - THREE.MathUtils.smoothstep(vDist, VOLCANO_RIM_RADIUS - 4.0, 78.0);
          tempColorC.lerp(COL_VOLCANO_SCORIA, rimHeat * 0.65);
        }

        // Glowing radial lava channels down the volcano flanks
        const lavaChannel = this.getVolcanoLavaChannelWeight(vdx, vdz, vDist);
        if (lavaChannel > 0.02) {
          tempColorC.lerp(COL_VOLCANO_LAVA_CRUST, THREE.MathUtils.smoothstep(lavaChannel, 0.02, 0.45));
          tempColorC.lerp(COL_VOLCANO_LAVA_HOT, THREE.MathUtils.smoothstep(lavaChannel, 0.35, 0.82));
          tempColorC.lerp(COL_VOLCANO_LAVA_CORE, THREE.MathUtils.smoothstep(lavaChannel, 0.75, 0.98) * 0.85);
        }

        // Molten inner caldera crater walls & magma cauldron floor
        if (vDist < VOLCANO_RIM_RADIUS + 1.5) {
          const innerDepthT = 1.0 - THREE.MathUtils.smoothstep(vDist, VOLCANO_CRATER_RADIUS * 0.7, VOLCANO_RIM_RADIUS + 1.5);
          tempColorC.lerp(COL_VOLCANO_LAVA_CRUST, Math.min(1, innerDepthT * 1.35));
          if (vDist < VOLCANO_CRATER_RADIUS + 4.0) {
            const coreT = 1.0 - THREE.MathUtils.smoothstep(vDist, 10.0, VOLCANO_CRATER_RADIUS + 4.0);
            tempColorC.lerp(COL_VOLCANO_LAVA_HOT, coreT);
            tempColorC.lerp(COL_VOLCANO_LAVA_CORE, coreT * coreT * 0.9);
          }
        }

        tempColorB.lerp(tempColorC, volcanoBlend);
      }
    }

    target.copy(tempColorB);
    return target;
  }
}
