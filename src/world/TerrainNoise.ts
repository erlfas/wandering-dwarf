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
const tempColorA = new THREE.Color();
const tempColorB = new THREE.Color();
const INV_MESO_NORM = 1.0 / 1.7104;

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
  private config: WorldConfig;

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
  }

  /**
   * Evaluates the continuous world elevation (Y in meters) at any world (X, Z) coordinate.
   * Combines domain warping, multi-octave fBm, meandering river valley carving, and natural pond basins.
   */
  public getHeight(x: number, z: number): number {
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

    // 5. Meandering Rivers & Natural Pond Basins
    if (cfg.riverCarveStrength > 0 || cfg.pondFrequency > 0) {
      const waterY = cfg.waterLevel;

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
              valleyT * cfg.riverCarveStrength
            );

            // Carve the wet river channel below waterLevel
            if (rVal < channelHalfWidth) {
              const channelT = 1.0 - THREE.MathUtils.smoothstep(rVal, 0, channelHalfWidth);
              const bedDepth = 2.2 * widthMod;
              height -= channelT * bedDepth * cfg.riverCarveStrength;
            }
          }
        }
      }

      // B) Natural Pond Basins in low-to-mid valleys (early-out on high terrain before evaluating pondNoise)
      if (cfg.pondFrequency > 0 && height < waterY + 11.0) {
        const pondN = this.pondNoise(wx * 0.0065 + 110, wz * 0.0065 - 75);
        const threshold = 0.68 - cfg.pondFrequency * 0.32; // Higher pondFrequency -> lower threshold
        if (pondN > threshold) {
          const pondFactor = THREE.MathUtils.smoothstep(pondN, threshold, threshold + 0.22);
          // Only form ponds where terrain isn't a high mountain peak
          const elevWeight = 1.0 - THREE.MathUtils.smoothstep(height, waterY + 1.0, waterY + 11.0);
          const basinTarget = waterY - 1.85;
          height = THREE.MathUtils.lerp(height, basinTarget, pondFactor * elevWeight * 0.92);
        }
      }
    }

    return height;
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
   * Returns [0, 1] forest grove intensity at world (x, z).
   * Returns 0 in open meadows/clearings (~50-60% of the world) and 0..1 inside wooded groves,
   * ensuring distinct open areas and non-crowded tree clusters.
   */
  public getForestDensity(x: number, z: number): number {
    // Keep a small natural clearing right at player spawn (0, 0) for an unobstructed initial vista
    const spawnDistSq = x * x + z * z;
    if (spawnDistSq <= 100) return 0;
    const spawnClearing = THREE.MathUtils.smoothstep(spawnDistSq, 100, 550);

    const n1 = this.forestNoise(x * 0.0055, z * 0.0055);
    const n2 = 0.45 * this.forestNoise(x * 0.014 - 41.2, z * 0.014 + 27.8);
    const raw = (n1 + n2) / 1.45; // [-1, 1] normalized to [0, 1] below
    const normalized = raw * 0.5 + 0.5;

    const cutoff = 1.0 - this.config.forestCoverage;
    if (normalized <= cutoff) return 0;

    const grove = THREE.MathUtils.smoothstep(normalized, cutoff, Math.min(1.0, cutoff + 0.28));
    return grove * spawnClearing;
  }

  /**
   * Computes the natural meadow/terrain color at (x, y, z) including sandy pond/river banks.
   */
  public getSurfaceColor(
    x: number,
    y: number,
    z: number,
    normal: THREE.Vector3,
    target = new THREE.Color()
  ): THREE.Color {
    const patch = this.getMeadowPatch(x, z);
    const grove = this.getForestDensity(x, z);

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

    target.copy(tempColorB);
    return target;
  }
}
