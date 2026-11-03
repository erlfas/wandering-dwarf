export interface WorldConfig {
  seed: number;

  // Chunk streaming settings
  chunkSize: number;          // Width/length of a single chunk in meters (world units)
  renderRadius: number;       // Number of chunks in each direction from player (e.g. 6 -> 13x13 grid)
  maxChunksPerFrame: number;  // Limit chunk builds per frame for smooth 60fps streaming

  // Multi-scale terrain noise parameters (calibrated to ~1.35m tall dwarf)
  macroScale: number;         // Broad sweeping hill/valley wavelength
  macroAmplitude: number;     // Broad hill height (meters)
  mesoScale: number;          // Rolling ridges and local hills wavelength
  mesoAmplitude: number;      // Local hill height (meters)
  microScale: number;         // Gentle surface undulation wavelength
  microAmplitude: number;     // Subtle contour height (meters)
  domainWarpStrength: number; // Organic flow / non-grid distortion of hills
  valleyFlatten: number;      // Softly shapes low areas into gentle meadow/pond basins (0..1)

  // Rivers & Ponds settings
  enableWater: boolean;       // Render water surface in ponds and rivers
  waterLevel: number;         // Global water elevation (meters)
  riverCarveStrength: number; // How deeply meandering rivers carve into the terrain (0..1)
  riverWidth: number;         // Width of meandering river channels (meters)
  pondFrequency: number;      // How often natural pond basins form in valleys (0..1)

  // Trees & Forest Groves settings
  enableTrees: boolean;       // Spawn 3D pine & broadleaf trees
  forestCoverage: number;     // Balance between open meadows and wooded groves (0 = all open, 1 = many groves)
  treeDensity: number;        // Sparseness inside wooded groves (0.1 = very airy, 1.0 = fuller grove)
  treeScale: number;          // Overall tree size multiplier

  // Forest Tracks & Footpaths settings
  enableTracks: boolean;      // Carve and render infinite winding forest tracks where dwarfs walk
  trackWidth: number;         // Width of the worn dirt footpath (meters)
  trackDensity: number;       // Frequency of intersecting secondary trails (0..1)

  // Grass & Surface settings
  enableGrassBlades: boolean; // 3D instanced grass tufts on nearby chunks
  grassDensity: number;       // Number of grass tufts per chunk (inner ring)
  grassRadiusChunks: number;  // Chunk distance radius that spawns 3D grass blades
  grassHeight: number;        // Blade height multiplier
  tallGrassCoverage: number;  // Coverage of dense waist-high grass areas (0..1)
  windSpeed: number;          // Speed of rolling wind waves
  windStrength: number;       // How far grass bends in the wind
  enableFlowers: boolean;     // Scattered white/yellow/blue meadow wildflowers

  // Terrain surface appearance
  blankClayMode: boolean;     // Toggle back to Phase 1 untextured clay look
  clayColor: string;
  clayRoughness: number;
  wireframe: boolean;
  showChunkBorders: boolean;
  fogDensity: number;

  // Player / Camera settings
  cameraMode: 'dwarf' | 'free';
  showDwarfProxy: boolean;
  walkSpeed: number;
  sprintMultiplier: number;
}

export const defaultWorldConfig: WorldConfig = {
  seed: 1337,

  chunkSize: 48,
  renderRadius: 6,
  maxChunksPerFrame: 3,

  // Tuned to evoke the multi-layered rolling hills and valleys in the reference photos
  macroScale: 0.0022,
  macroAmplitude: 36.0,
  mesoScale: 0.0085,
  mesoAmplitude: 11.5,
  microScale: 0.032,
  microAmplitude: 1.6,
  domainWarpStrength: 38.0,
  valleyFlatten: 0.38,

  // Rivers & Ponds
  enableWater: true,
  waterLevel: -3.5,
  riverCarveStrength: 0.85,
  riverWidth: 14.0,
  pondFrequency: 0.55,

  // Trees & Open Meadows (airy groves + plenty of open areas)
  enableTrees: true,
  forestCoverage: 0.45,
  treeDensity: 0.38,
  treeScale: 1.0,

  // Infinite winding forest tracks & trails
  enableTracks: true,
  trackWidth: 3.2,
  trackDensity: 0.65,

  // Lush procedural grass settings
  enableGrassBlades: true,
  grassDensity: 2600,
  grassRadiusChunks: 2.6,
  grassHeight: 1.0,
  tallGrassCoverage: 0.55,
  windSpeed: 1.8,
  windStrength: 0.32,
  enableFlowers: true,

  // Surface look
  blankClayMode: false,
  clayColor: '#dcd6cc',
  clayRoughness: 0.9,
  wireframe: false,
  showChunkBorders: false,
  fogDensity: 0.0025,

  cameraMode: 'dwarf',
  showDwarfProxy: true,
  walkSpeed: 6.5,
  sprintMultiplier: 2.4,
};
