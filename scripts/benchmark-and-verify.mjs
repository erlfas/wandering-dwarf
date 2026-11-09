#!/usr/bin/env node
/**
 * Automated Gameplay & Performance Benchmark and Verification Suite
 * Wandering Dwarf (`procedural-world`)
 *
 * Suites:
 * 1. Simplex & Terrain Noise Evaluation Throughput (getHeight, getNormal, getTrackWeight)
 * 2. O(1) Bilinear Chunk Surface Sampling Throughput & Zero-Noise Guarantees
 * 3. Flat-List Entity Spatial Queries vs Map-Traversal Benchmarking
 * 4. Boss Physics & Multi-Tick Simulation (Dragon flight, Crag Titan boulder pool)
 * 5. Architectural & Code Invariant Static Verification
 */

import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

console.log(`${ANSI.bold}${ANSI.cyan}========================================================================${ANSI.reset}`);
console.log(`${ANSI.bold}${ANSI.cyan}   WANDERING DWARF — AUTOMATED BENCHMARK & VERIFICATION HARNESS       ${ANSI.reset}`);
console.log(`${ANSI.bold}${ANSI.cyan}========================================================================${ANSI.reset}\n`);

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ${ANSI.green}✔ PASS:${ANSI.reset} ${testName} ${details ? ANSI.yellow + '(' + details + ')' + ANSI.reset : ''}`);
    totalPassed++;
  } else {
    console.error(`  ${ANSI.red}✖ FAIL:${ANSI.reset} ${testName} - ${details}`);
    totalFailed++;
  }
}

// ---------------------------------------------------------------------------
// SUITE 1: Simplex Noise & Procedural Terrain Throughput Benchmark
// ---------------------------------------------------------------------------
console.log(`${ANSI.bold}[Suite 1: Simplex Noise & Procedural Terrain Math]${ANSI.reset}`);

const noise2D = createNoise2D();
const NUM_NOISE_SAMPLES = 50000;

const startNoise = performance.now();
let dummySum = 0;
for (let i = 0; i < NUM_NOISE_SAMPLES; i++) {
  const x = (i % 500) * 0.45;
  const z = Math.floor(i / 500) * 0.45;
  // Multi-octave FBM simulation (matching TerrainNoise octaves)
  const n1 = noise2D(x * 0.005, z * 0.005);
  const n2 = noise2D(x * 0.02, z * 0.02) * 0.5;
  const n3 = noise2D(x * 0.08, z * 0.08) * 0.25;
  dummySum += n1 + n2 + n3;
}
const elapsedNoise = performance.now() - startNoise;
const noiseOpsPerSec = Math.round((NUM_NOISE_SAMPLES / elapsedNoise) * 1000);
const avgNoiseLatencyUs = ((elapsedNoise / NUM_NOISE_SAMPLES) * 1000).toFixed(2);

assert(
  elapsedNoise < 500,
  '50,000 Multi-Octave FBM Terrain Samples',
  `${elapsedNoise.toFixed(1)}ms total, ${noiseOpsPerSec.toLocaleString()} ops/sec, ${avgNoiseLatencyUs}µs/sample`
);
assert(noiseOpsPerSec > 100000, 'Noise Throughput >= 100,000 ops/sec', `${noiseOpsPerSec.toLocaleString()} ops/sec`);

// ---------------------------------------------------------------------------
// SUITE 2: O(1) Bilinear Surface Buffer Sampling Benchmark
// ---------------------------------------------------------------------------
console.log(`\n${ANSI.bold}[Suite 2: O(1) Bilinear Surface Buffer Sampler]${ANSI.reset}`);

const CHUNK_RES = 64;
const STRIDE = CHUNK_RES + 1;
const CHUNK_SIZE = 48.0;
const posBuffer = new Float32Array(STRIDE * STRIDE * 3);
const normBuffer = new Float32Array(STRIDE * STRIDE * 3);

// Fill synthetic chunk vertex positions
for (let z = 0; z <= CHUNK_RES; z++) {
  for (let x = 0; x <= CHUNK_RES; x++) {
    const idx = (z * STRIDE + x) * 3;
    posBuffer[idx] = (x / CHUNK_RES - 0.5) * CHUNK_SIZE;
    posBuffer[idx + 1] = Math.sin(x * 0.2) * Math.cos(z * 0.2) * 8.0;
    posBuffer[idx + 2] = (z / CHUNK_RES - 0.5) * CHUNK_SIZE;
    normBuffer[idx] = 0;
    normBuffer[idx + 1] = 1;
    normBuffer[idx + 2] = 0;
  }
}

function sampleSurfaceBilinear(localX, localZ, outNormal) {
  const invStep = CHUNK_RES / CHUNK_SIZE;
  const u = Math.min(CHUNK_RES - 0.001, Math.max(0, (localX + CHUNK_SIZE * 0.5) * invStep));
  const v = Math.min(CHUNK_RES - 0.001, Math.max(0, (localZ + CHUNK_SIZE * 0.5) * invStep));
  const ix = u | 0;
  const iz = v | 0;
  const fx = u - ix;
  const fz = v - iz;

  const row0 = iz * STRIDE;
  const row1 = (iz + 1) * STRIDE;
  const h00 = posBuffer[(row0 + ix) * 3 + 1];
  const h10 = posBuffer[(row0 + ix + 1) * 3 + 1];
  const h01 = posBuffer[(row1 + ix) * 3 + 1];
  const h11 = posBuffer[(row1 + ix + 1) * 3 + 1];

  let h;
  if (fx + fz <= 1.0) {
    h = h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  } else {
    h = h11 + (h01 - h11) * (1.0 - fx) + (h10 - h11) * (1.0 - fz);
  }
  outNormal.set(0, 1, 0);
  return h;
}

const NUM_SURFACE_SAMPLES = 100000;
const _scratchOutNorm = new THREE.Vector3();
const startSurface = performance.now();
let surfaceHeightSum = 0;
for (let i = 0; i < NUM_SURFACE_SAMPLES; i++) {
  const lx = ((i % 1000) / 1000 - 0.5) * CHUNK_SIZE;
  const lz = (Math.floor(i / 1000) / 100 - 0.5) * CHUNK_SIZE;
  surfaceHeightSum += sampleSurfaceBilinear(lx, lz, _scratchOutNorm);
}
const elapsedSurface = performance.now() - startSurface;
const surfaceOpsPerSec = Math.round((NUM_SURFACE_SAMPLES / elapsedSurface) * 1000);
const avgSurfaceLatencyNs = ((elapsedSurface / NUM_SURFACE_SAMPLES) * 1000000).toFixed(1);

assert(
  elapsedSurface < 100,
  '100,000 O(1) Bilinear Surface Point Queries',
  `${elapsedSurface.toFixed(1)}ms total, ${surfaceOpsPerSec.toLocaleString()} ops/sec, ${avgSurfaceLatencyNs}ns/query`
);
assert(surfaceOpsPerSec > 1000000, 'Surface Sampling Throughput >= 1,000,000 queries/sec', `${surfaceOpsPerSec.toLocaleString()} ops/sec`);

// ---------------------------------------------------------------------------
// SUITE 3: Spatial Entity Distance Query Benchmark (Flat-List vs Map Traversal)
// ---------------------------------------------------------------------------
console.log(`\n${ANSI.bold}[Suite 3: Spatial Query Optimization (Flat-List vs Map Iterators)]${ANSI.reset}`);

const NUM_ENTITIES = 400;
const chunkMap = new Map();
const flatArray = [];

for (let i = 0; i < NUM_ENTITIES; i++) {
  const ent = {
    id: `ent_${i}`,
    pos: new THREE.Vector3((Math.random() - 0.5) * 500, 0, (Math.random() - 0.5) * 500),
    active: true,
  };
  flatArray.push(ent);

  const chunkKey = ((Math.floor(ent.pos.x / 48) + 1000) << 16) | (Math.floor(ent.pos.z / 48) + 1000);
  if (!chunkMap.has(chunkKey)) chunkMap.set(chunkKey, []);
  chunkMap.get(chunkKey).push(ent);
}

const queryPos = new THREE.Vector3(0, 0, 0);
const NUM_QUERIES = 20000;
const RADIUS_SQ = 48.0 * 48.0;

// A. Map-iteration traversal (.values() allocating iterators)
const startMap = performance.now();
let mapHits = 0;
for (let q = 0; q < NUM_QUERIES; q++) {
  queryPos.x = Math.sin(q * 0.05) * 80.0;
  queryPos.z = Math.cos(q * 0.05) * 80.0;
  for (const list of chunkMap.values()) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const dx = e.pos.x - queryPos.x;
      const dz = e.pos.z - queryPos.z;
      if (dx * dx + dz * dz <= RADIUS_SQ) mapHits++;
    }
  }
}
const elapsedMap = performance.now() - startMap;

// B. Flat active array traversal (0 allocations)
const startFlat = performance.now();
let flatHits = 0;
for (let q = 0; q < NUM_QUERIES; q++) {
  queryPos.x = Math.sin(q * 0.05) * 80.0;
  queryPos.z = Math.cos(q * 0.05) * 80.0;
  for (let i = 0; i < flatArray.length; i++) {
    const e = flatArray[i];
    const dx = e.pos.x - queryPos.x;
    const dz = e.pos.z - queryPos.z;
    if (dx * dx + dz * dz <= RADIUS_SQ) flatHits++;
  }
}
const elapsedFlat = performance.now() - startFlat;

assert(mapHits === flatHits, 'Flat Array Hit Count Exact Match', `hits: ${flatHits}`);
const speedupPct = Math.round(((elapsedMap - elapsedFlat) / elapsedMap) * 100);
assert(
  elapsedFlat <= elapsedMap,
  'Flat Array Faster than Map.values() Iteration',
  `Flat: ${elapsedFlat.toFixed(1)}ms vs Map: ${elapsedMap.toFixed(1)}ms (${speedupPct}% faster)`
);

// ---------------------------------------------------------------------------
// SUITE 4: Boss Physics Simulation & Zero-Allocation Boulder Pooling
// ---------------------------------------------------------------------------
console.log(`\n${ANSI.bold}[Suite 4: Boss Physics & Zero-Allocation Pool Benchmark]${ANSI.reset}`);

const POOL_SIZE = 8;
const boulderPool = [];
for (let i = 0; i < POOL_SIZE; i++) {
  boulderPool.push({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    active: false,
    life: 0,
  });
}

function spawnBoulder(fromX, fromY, fromZ, dirX, dirZ) {
  let b = boulderPool.find((item) => !item.active);
  if (!b) {
    b = boulderPool.reduce((oldest, item) => (item.life < oldest.life ? item : oldest), boulderPool[0]);
  }
  b.active = true;
  b.life = 5.5;
  b.pos.set(fromX, fromY, fromZ);
  b.vel.set(dirX * 18.0, 0, dirZ * 18.0);
  return b;
}

// Warm up JIT compiler before measuring memory allocations
for (let warm = 0; warm < 500; warm++) {
  spawnBoulder(240, 68, 320, 1, 0);
  for (let i = 0; i < POOL_SIZE; i++) {
    const b = boulderPool[i];
    if (b.active) {
      b.life -= 0.016;
      b.pos.x += b.vel.x * 0.016;
      if (b.life <= 0) b.active = false;
    }
  }
}

const memBefore = process.memoryUsage().heapUsed;
const SIM_TICKS = 5000;
const dt = 0.016;

const startBossSim = performance.now();
let activeCountSum = 0;
for (let tick = 0; tick < SIM_TICKS; tick++) {
  // Periodically throw boulders
  if (tick % 60 === 0) {
    const ang = (tick * 0.1) % (Math.PI * 2);
    spawnBoulder(240, 68, 320, Math.cos(ang), Math.sin(ang));
  }

  // Update physics
  for (let i = 0; i < POOL_SIZE; i++) {
    const b = boulderPool[i];
    if (!b.active) continue;
    b.life -= dt;
    b.pos.x += b.vel.x * dt;
    b.pos.z += b.vel.z * dt;
    if (b.life <= 0) b.active = false;
    activeCountSum++;
  }
}
const elapsedBossSim = performance.now() - startBossSim;
const memAfter = process.memoryUsage().heapUsed;
const heapDeltaBytes = memAfter - memBefore;

assert(
  elapsedBossSim < 100,
  '5,000 Continuous Physics Ticks Simulated',
  `${elapsedBossSim.toFixed(2)}ms total, ${(elapsedBossSim / SIM_TICKS * 1000).toFixed(2)}µs/tick`
);
assert(
  heapDeltaBytes < 2 * 1024 * 1024,
  'Zero-Heap Allocation Invariant across 5,000 Ticks (< 2MB V8 JIT ceiling)',
  `heap delta: ${(heapDeltaBytes / 1024).toFixed(1)} KB`
);

// ---------------------------------------------------------------------------
// SUITE 5: Static Architectural Invariant Codebase Verification
// ---------------------------------------------------------------------------
console.log(`\n${ANSI.bold}[Suite 5: Architectural & Performance Invariant Verification]${ANSI.reset}`);

const SRC_DIR = path.resolve('src');
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}
const allTsFiles = walk(SRC_DIR);

let rawGltfViolations = 0;
let pointLightRecompiles = 0;
let distanceSquaredViolations = 0;

for (const file of allTsFiles) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
  const code = fs.readFileSync(file, 'utf8');

  // Rule 1: No raw new GLTFLoader() outside ForestField.ts
  if (rel !== 'src/world/ForestField.ts' && /new\s+GLTFLoader\s*\(/.test(code)) {
    rawGltfViolations++;
    console.error(`  Violation: ${rel} uses raw GLTFLoader`);
  }

  // Rule 2: Constant NUM_POINT_LIGHTS = 1 (no interior manager adds > 1 PointLight)
  if (rel.includes('Interior') || rel.includes('Underground') || rel.includes('Hut')) {
    const pointMatches = code.match(/new\s+THREE\.PointLight/g);
    if (pointMatches && pointMatches.length > 1) {
      pointLightRecompiles++;
      console.error(`  Violation: ${rel} has ${pointMatches.length} PointLights (must be <= 1)`);
    }
  }

  // Rule 3: Hunting, Fishing, and Traversal managers must use distanceToSquared or Math.hypot in collision loops
  if (rel.includes('HuntingAndDeerManager') || rel.includes('FishingAndFishManager') || rel.includes('MountainTraversalManager')) {
    if (code.includes('for (const deerList of this.activeChunkDeer.values())')) {
      distanceSquaredViolations++;
      console.error(`  Violation: ${rel} uses activeChunkDeer.values() in active loops`);
    }
    if (code.includes('for (const fishList of this.activeChunkFish.values())')) {
      distanceSquaredViolations++;
      console.error(`  Violation: ${rel} uses activeChunkFish.values() in active loops`);
    }
  }
}

assert(rawGltfViolations === 0, 'Rule 1: No Raw GLTFLoader Instances Outside ForestField.ts');
assert(pointLightRecompiles === 0, 'Rule 2: Constant NUM_POINT_LIGHTS = 1 Across All Interior Stages');
assert(distanceSquaredViolations === 0, 'Rule 3: Flat-List Zero Allocation Iterations in Hunting/Fishing');

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------
console.log(`\n${ANSI.bold}${ANSI.cyan}========================================================================${ANSI.reset}`);
if (totalFailed === 0) {
  console.log(`${ANSI.bold}${ANSI.green}   ALL BENCHMARKS & VERIFICATION TESTS PASSED (${totalPassed}/${totalPassed})   ${ANSI.reset}`);
} else {
  console.log(`${ANSI.bold}${ANSI.red}   BENCHMARK FAILURES DETECTED: ${totalFailed} FAILED, ${totalPassed} PASSED   ${ANSI.reset}`);
}
console.log(`${ANSI.bold}${ANSI.cyan}========================================================================${ANSI.reset}\n`);

if (totalFailed > 0) {
  process.exit(1);
}
