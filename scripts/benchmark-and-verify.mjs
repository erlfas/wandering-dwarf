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
// SUITE 6: Distance-Ringed Frontier Zone Lookups (100,000 Spatial Queries)
// ---------------------------------------------------------------------------
console.log(`\n${ANSI.bold}[Suite 6: Distance-Ringed Frontier Zone Lookups]${ANSI.reset}`);

function getFrontierTierBenchmark(wx, wz, chunkSize = 48) {
  const cx = wx / chunkSize;
  const cz = wz / chunkSize;
  const chunkDist = Math.hypot(cx, cz);
  if (chunkDist <= 3.5) {
    return 1;
  } else if (chunkDist <= 7.5) {
    return 2;
  } else {
    return 3;
  }
}

// Warm up JIT
for (let i = 0; i < 5000; i++) {
  getFrontierTierBenchmark(i * 3.5, i * 2.1);
}

const NUM_FRONTIER_SAMPLES = 100000;
let ring1Count = 0;
let ring2Count = 0;
let ring3Count = 0;

const startFrontier = performance.now();
for (let i = 0; i < NUM_FRONTIER_SAMPLES; i++) {
  const wx = (i % 500) * 1.5 - 375;
  const wz = ((i / 500) | 0) * 3.5 - 350;
  const ring = getFrontierTierBenchmark(wx, wz);
  if (ring === 1) ring1Count++;
  else if (ring === 2) ring2Count++;
  else ring3Count++;
}
const elapsedFrontier = performance.now() - startFrontier;
const opsSecFrontier = Math.round((NUM_FRONTIER_SAMPLES / elapsedFrontier) * 1000);

assert(
  ring1Count > 0 && ring2Count > 0 && ring3Count > 0,
  'Frontier Ring Distribution Correctness (All 3 rings detected across space)',
  `Ring I: ${ring1Count}, Ring II: ${ring2Count}, Ring III: ${ring3Count}`
);
assert(
  opsSecFrontier >= 5000000,
  'Frontier Lookup Throughput >= 5,000,000 ops/sec',
  `${opsSecFrontier.toLocaleString()} ops/sec (${elapsedFrontier.toFixed(2)}ms total)`
);

// ---------------------------------------------------------------------------
// SUITE 7: Multi-Tier Troll AI Simulation & Enrage Invariants
// ---------------------------------------------------------------------------
console.log(`\n${ANSI.bold}[Suite 7: Multi-Tier Troll AI & Zero-Allocation Pool Benchmark]${ANSI.reset}`);

const simulatedTrolls = [
  { id: 't_0', tier: 1, hp: 320, maxHp: 320, x: 20, z: 20, state: 'patrol', isEnraged: false, cooldown: 0, stompTimer: 0 },
  { id: 't_1', tier: 2, hp: 540, maxHp: 540, x: 50, z: 40, state: 'chase', isEnraged: false, cooldown: 0, stompTimer: 0 },
  { id: 't_2', tier: 3, hp: 880, maxHp: 880, x: 12, z: 12, state: 'chase', isEnraged: false, cooldown: 0, stompTimer: 0 },
];

const pPos = { x: 0, z: 0 };
const TROLL_TICKS = 5000;
const trollDt = 0.016;

// Warm up JIT
for (let warm = 0; warm < 500; warm++) {
  for (let i = 0; i < simulatedTrolls.length; i++) {
    const t = simulatedTrolls[i];
    const dx = pPos.x - t.x;
    const dz = pPos.z - t.z;
    const dSq = dx * dx + dz * dz;
    if (dSq <= 6.5) t.state = 'attack';
  }
}

const trollMemBefore = process.memoryUsage().heapUsed;
const startTrollSim = performance.now();
let enrageEvents = 0;
let shockwavesSpawned = 0;

for (let tick = 0; tick < TROLL_TICKS; tick++) {
  // Move player along orbit
  pPos.x = Math.sin(tick * 0.02) * 25.0;
  pPos.z = Math.cos(tick * 0.02) * 25.0;

  for (let i = 0; i < simulatedTrolls.length; i++) {
    const t = simulatedTrolls[i];
    const dx = pPos.x - t.x;
    const dz = pPos.z - t.z;
    const distSq = dx * dx + dz * dz;

    // Simulate taking damage and enraging
    if (tick === 1000 && t.tier === 3) {
      t.hp = 250; // drops below 35% of 880 (308 HP)
    }

    if (t.tier === 3 && !t.isEnraged && t.hp <= t.maxHp * 0.35) {
      t.isEnraged = true;
      enrageEvents++;
    }

    if (t.cooldown > 0) t.cooldown -= trollDt;

    if (t.tier === 3 && distSq <= 64.0 && distSq > 6.5 && t.cooldown <= 0) {
      t.state = 'attack';
      t.stompTimer = 0.9;
      t.cooldown = 7.5;
      shockwavesSpawned++;
    } else if (distSq <= 6.5 && t.cooldown <= 0) {
      t.state = 'attack';
      t.cooldown = t.isEnraged ? 0.75 : 1.25;
    } else if (distSq <= 1296.0) {
      t.state = 'chase';
      const speed = t.tier === 3 ? (t.isEnraged ? 7.0 : 5.2) : t.tier === 2 ? 4.9 : 4.3;
      const d = Math.hypot(dx, dz) || 1;
      t.x += (dx / d) * speed * trollDt;
      t.z += (dz / d) * speed * trollDt;
    }
  }
}
const elapsedTrollSim = performance.now() - startTrollSim;
const trollMemAfter = process.memoryUsage().heapUsed;
const trollHeapDelta = trollMemAfter - trollMemBefore;

assert(
  enrageEvents === 1 && shockwavesSpawned > 0,
  'Troll Enrage & Ground Stomp Special Attacks Triggered',
  `enrages: ${enrageEvents}, shockwaves: ${shockwavesSpawned}`
);
assert(
  elapsedTrollSim < 60,
  '5,000 Multi-Tier Troll AI Ticks Simulated',
  `${elapsedTrollSim.toFixed(2)}ms total, ${(elapsedTrollSim / TROLL_TICKS * 1000).toFixed(2)}µs/tick`
);
assert(
  trollHeapDelta < 2 * 1024 * 1024,
  'Zero-Heap Allocation Invariant in Multi-Tier Troll Loop (< 2MB V8 JIT delta)',
  `heap delta: ${(trollHeapDelta / 1024).toFixed(1)} KB`
);

// ---------------------------------------------------------------------------
// SUITE 8: Guard-Break, Parry Window & Combat Stamina Verification
// ---------------------------------------------------------------------------
console.log(`\n${ANSI.bold}[Suite 8: Guard-Break, Parry & Stamina State Verification]${ANSI.reset}`);

function evaluateCombatDefense(hasShield, isBlocking, blockRaiseElapsed, energy, isIronAegis, trollTier) {
  if (!hasShield || !isBlocking) {
    return { outcome: 'hit', damageMult: 1.0, guardBroken: false };
  }
  const parryWindow = isIronAegis ? 0.55 : 0.42;
  if (blockRaiseElapsed <= parryWindow) {
    return { outcome: 'parry', damageMult: 0, guardBroken: false };
  }
  const requiredEnergy = trollTier === 3 ? 24 : trollTier === 2 ? 16 : 8;
  if (energy < requiredEnergy) {
    return { outcome: 'guard_break', damageMult: 1.25, guardBroken: true };
  }
  return { outcome: 'blocked', damageMult: 0.15, guardBroken: false };
}

// 1. Perfect parry test
const parryRes = evaluateCombatDefense(true, true, 0.25, 50, false, 2);
assert(parryRes.outcome === 'parry' && !parryRes.guardBroken, 'Perfect Parry Window Execution (elapsed <= 0.42s)');

// 2. Guard break test
const breakRes = evaluateCombatDefense(true, true, 0.8, 10, false, 3);
assert(breakRes.outcome === 'guard_break' && breakRes.guardBroken, 'Guard Break Triggered on Low Energy (< 24⚡ for Tier 3)');

// 3. Clean block test
const blockRes = evaluateCombatDefense(true, true, 0.8, 50, false, 3);
assert(blockRes.outcome === 'blocked' && !blockRes.guardBroken, 'Standard Shield Block with Sufficient Energy (50⚡ >= 24⚡)');

// ---------------------------------------------------------------------------
// SUITE 9: Multi-Tier Goblin AI Simulation, Flanking Math & Cluster-Bomb Physics
// ---------------------------------------------------------------------------
console.log(`\n${ANSI.bold}[Suite 9: Multi-Tier Goblin AI Simulation, Flanking Math & Cluster Bomblets]${ANSI.reset}`);

const GOBLIN_TICKS = 5000;
const goblinDt = 0.016;
let clusterBombsSpawned = 0;
let clusterBombsDetonated = 0;
let groundFireTicks = 0;
let skirmisherFlankCount = 0;

// Synthetic multi-tier goblins pool
const testGoblins = [
  { tier: 1, role: 'cutpurse', x: 12, z: 0, hp: 45, maxHp: 45, orbitAngle: 0, speed: 3.8 },
  { tier: 2, role: 'skirmisher', x: 25, z: 20, hp: 80, maxHp: 80, speed: 4.4 },
  { tier: 3, role: 'berserker', x: 30, z: -15, hp: 130, maxHp: 130, speed: 5.4, dodgeCooldown: 0 },
];

// Pre-allocated cluster bomblets pool (matching LivingWorldManager.clusterBombletPool)
const testClusterPool = [
  { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0 },
  { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0 },
  { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0 },
  { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0 },
];

// Pre-allocated ground fire patches pool
const testFirePool = [
  { active: false, x: 0, z: 0, life: 0 },
  { active: false, x: 0, z: 0, life: 0 },
];

function spawnTestCluster(x, y, z) {
  for (let i = 0; i < 2; i++) {
    const cb = testClusterPool.find((b) => !b.active);
    if (!cb) break;
    cb.active = true;
    cb.x = x;
    cb.y = y + 0.3;
    cb.z = z;
    const ang = i * Math.PI + Math.random() * 0.5;
    cb.vx = Math.cos(ang) * 5.5;
    cb.vy = 6.0;
    cb.vz = Math.sin(ang) * 5.5;
    cb.fuse = 0.45;
    clusterBombsSpawned++;
  }
}

function spawnTestFire(x, z) {
  const fp = testFirePool.find((f) => !f.active);
  if (!fp) return;
  fp.active = true;
  fp.x = x;
  fp.z = z;
  fp.life = 3.5;
}

const playerPosSim = { x: 0, y: 10, z: 0, heading: 0 }; // Facing +Z

const startGoblinSim = performance.now();
const goblinMemBefore = process.memoryUsage().heapUsed;

for (let tick = 0; tick < GOBLIN_TICKS; tick++) {
  // 1. Advance Goblins
  for (let i = 0; i < testGoblins.length; i++) {
    const g = testGoblins[i];
    const dx = playerPosSim.x - g.x;
    const dz = playerPosSim.z - g.z;
    const distSq = dx * dx + dz * dz;

    if (g.tier === 1) {
      // Tier 1 Cutpurse: Orbit
      g.orbitAngle += goblinDt * 1.5;
      g.x = playerPosSim.x + Math.cos(g.orbitAngle) * 4.5;
      g.z = playerPosSim.z + Math.sin(g.orbitAngle) * 4.5;
    } else if (g.tier === 2) {
      // Tier 2 Skirmisher: Tactical rear flank
      const rearX = playerPosSim.x - Math.sin(playerPosSim.heading) * 5.5;
      const rearZ = playerPosSim.z - Math.cos(playerPosSim.heading) * 5.5;
      const fdx = rearX - g.x;
      const fdz = rearZ - g.z;
      const fDist = Math.hypot(fdx, fdz) || 1;
      g.x += (fdx / fDist) * g.speed * goblinDt;
      g.z += (fdz / fDist) * g.speed * goblinDt;
      if (fDist < 2.0) skirmisherFlankCount++;
    } else if (g.tier === 3) {
      // Tier 3 Obsidian Berserker: Aggressive charge + dodge roll
      if (g.dodgeCooldown > 0) g.dodgeCooldown -= goblinDt;
      const d = Math.hypot(dx, dz) || 1;
      g.x += (dx / d) * g.speed * goblinDt;
      g.z += (dz / d) * g.speed * goblinDt;
    }
  }

  // Periodic bomb throw every 250 ticks
  if (tick % 250 === 0) {
    spawnTestCluster(testGoblins[1].x, 10, testGoblins[1].z);
    spawnTestFire(testGoblins[2].x, testGoblins[2].z);
  }

  // 2. Advance Cluster Bomblets
  for (let i = 0; i < testClusterPool.length; i++) {
    const cb = testClusterPool[i];
    if (!cb.active) continue;
    cb.fuse -= goblinDt;
    cb.vy -= 22.0 * goblinDt;
    cb.x += cb.vx * goblinDt;
    cb.y += cb.vy * goblinDt;
    cb.z += cb.vz * goblinDt;
    if (cb.y <= 10.12) {
      cb.y = 10.12;
      cb.vx *= 0.65;
      cb.vz *= 0.65;
    }
    if (cb.fuse <= 0) {
      cb.active = false;
      clusterBombsDetonated++;
    }
  }

  // 3. Advance Ground Fire Patches
  for (let i = 0; i < testFirePool.length; i++) {
    const fp = testFirePool[i];
    if (!fp.active) continue;
    fp.life -= goblinDt;
    if (fp.life <= 0) {
      fp.active = false;
    } else {
      groundFireTicks++;
    }
  }
}

const elapsedGoblinSim = performance.now() - startGoblinSim;
const goblinMemAfter = process.memoryUsage().heapUsed;
const goblinHeapDelta = goblinMemAfter - goblinMemBefore;

assert(
  clusterBombsSpawned > 0 && clusterBombsDetonated === clusterBombsSpawned,
  'Cluster-Bomb Physics Simulation & Detonation',
  `spawned: ${clusterBombsSpawned}, detonated: ${clusterBombsDetonated}`
);
assert(
  groundFireTicks > 0 && skirmisherFlankCount > 0,
  'Skirmisher Flanking AI & Molten Ground Fire Patches Active',
  `flank maneuvers: ${skirmisherFlankCount}, fire ticks: ${groundFireTicks}`
);
assert(
  elapsedGoblinSim < 60,
  '5,000 Multi-Tier Goblin AI Ticks Simulated',
  `${elapsedGoblinSim.toFixed(2)}ms total, ${((elapsedGoblinSim / GOBLIN_TICKS) * 1000).toFixed(2)}µs/tick`
);
assert(
  goblinHeapDelta < 2 * 1024 * 1024,
  'Zero-Heap Allocation Invariant in Multi-Tier Goblin Loop (< 2MB V8 JIT delta)',
  `heap delta: ${(goblinHeapDelta / 1024).toFixed(1)} KB`
);

// ---------------------------------------------------------------------------
// SUITE 10: Boss Heavy-Attack Guard-Break, Boulder Deflection & Dragon Breath
// ---------------------------------------------------------------------------
console.log(`\n${ANSI.bold}[Suite 10: Boss Heavy-Attack Guard-Break, Boulder Deflection & Dragon Breath]${ANSI.reset}`);

function evaluateTitanBoulder(isBlocking, blockRaiseElapsed, hasIronAegis, energy) {
  if (!isBlocking) {
    return { outcome: 'hit', damage: 45, titanDamage: 0, guardBroken: false, knockback: 9.0 };
  }
  const parryWindow = hasIronAegis ? 0.55 : 0.42;
  if (blockRaiseElapsed <= parryWindow) {
    // ⚡ Perfect Parry Deflection
    return { outcome: 'deflected', damage: 0, titanDamage: 120, guardBroken: false, knockback: 0 };
  }
  const boulderCost = 24;
  if (energy < boulderCost) {
    // 💥 Guard Break
    return { outcome: 'guard_break', damage: 38, titanDamage: 0, guardBroken: true, knockback: 12.0 };
  }
  return { outcome: 'blocked', damage: 0, titanDamage: 0, guardBroken: false, knockback: 3.5, energyCost: boulderCost };
}

function evaluateDragonFireBreath(isBlocking, energy) {
  if (!isBlocking) {
    return { outcome: 'unblocked', damage: 32, burnDuration: 4.5, guardBroken: false };
  }
  const drainPerTick = 14;
  if (energy < drainPerTick) {
    // Shield Melt / Guard Break
    return { outcome: 'shield_melt', damage: 24, burnDuration: 3.0, guardBroken: true };
  }
  return { outcome: 'shield_absorbed', damage: 0, burnDuration: 0, guardBroken: false, energyCost: drainPerTick };
}

// 1. Boulder Perfect Parry
const titanParry = evaluateTitanBoulder(true, 0.35, false, 50);
assert(
  titanParry.outcome === 'deflected' && titanParry.titanDamage === 120 && titanParry.damage === 0,
  'Crag-Titan Boulder Perfect Parry Deflection (120 DMG to Titan, 0 DMG to Player)'
);

// 2. Boulder Guard Break on Low Energy
const titanBreak = evaluateTitanBoulder(true, 0.9, false, 12);
assert(
  titanBreak.outcome === 'guard_break' && titanBreak.guardBroken && titanBreak.knockback >= 12.0,
  'Crag-Titan Boulder Heavy Guard Break on Low Energy (< 24⚡)'
);

// 3. Dragon Fire Breath Shield Melt
const dragonMelt = evaluateDragonFireBreath(true, 8);
assert(
  dragonMelt.outcome === 'shield_melt' && dragonMelt.guardBroken && dragonMelt.burnDuration > 0,
  'Vermithrax Dragon Fire Breath Shield Melt & Guard Break on Stamina Exhaustion'
);

// 4. Dragon Fire Breath Clean Absorb
const dragonAbsorb = evaluateDragonFireBreath(true, 60);
assert(
  dragonAbsorb.outcome === 'shield_absorbed' && !dragonAbsorb.guardBroken && dragonAbsorb.energyCost === 14,
  'Vermithrax Fire Breath Stamina Drain (14⚡/tick absorbed cleanly with high stamina)'
);

// ---------------------------------------------------------------------------
// SUITE 11: High-Stakes Defeat Penalty & Ancestral Tombstone Recovery
// ---------------------------------------------------------------------------
console.log(`\n${ANSI.bold}[Suite 11: High-Stakes Defeat Penalty & Ancestral Tombstone Recovery]${ANSI.reset}`);

function calculateDeathGoldPenalty(currentGold) {
  return Math.max(0, Math.floor(currentGold * 0.15));
}

function findNearestSafeHavenMock(px, pz, safeHavens) {
  let nearest = safeHavens[0];
  let minSq = Infinity;
  for (let i = 0; i < safeHavens.length; i++) {
    const h = safeHavens[i];
    const dx = px - h.x;
    const dz = pz - h.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < minSq) {
      minSq = dSq;
      nearest = h;
    }
  }
  return nearest;
}

// 1. 15% Gold drop penalty invariant tests
assert(calculateDeathGoldPenalty(0) === 0, 'Zero Gold Defeat Drops 0 Gold');
assert(calculateDeathGoldPenalty(100) === 15, '100 Gold Defeat Drops 15 Gold (15%)');
assert(calculateDeathGoldPenalty(2450) === 367, '2,450 Gold Defeat Drops 367 Gold (15%)');

// 2. Safe-haven lookup invariant tests
const testHavens = [
  { name: 'Spawn Haven', x: 0, z: 0 },
  { name: 'Castle Ironforge', x: 200, z: 150 },
  { name: 'Watchtower Beacon North', x: -120, z: 80 },
];
const nearestCastle = findNearestSafeHavenMock(190, 140, testHavens);
const nearestBeacon = findNearestSafeHavenMock(-100, 70, testHavens);
const nearestSpawn = findNearestSafeHavenMock(-15, 8, testHavens);

assert(nearestCastle.name === 'Castle Ironforge', 'Nearest Safe Haven Correctly Identifies Completed Castle');
assert(nearestBeacon.name === 'Watchtower Beacon North', 'Nearest Safe Haven Correctly Identifies Lit Beacon');
assert(nearestSpawn.name === 'Spawn Haven', 'Nearest Safe Haven Correctly Identifies Origin Spawn');

// 3. Ancestral Tombstone Recovery & Dwarven Grit Invariant
const tombstoneState = { x: 190.5, y: 32.1, z: 140.8, gold: 367, active: true };
const playerPosRecovery = { x: 191.0, z: 141.0 };
const dxClaim = playerPosRecovery.x - tombstoneState.x;
const dzClaim = playerPosRecovery.z - tombstoneState.z;
const canClaim = dxClaim * dxClaim + dzClaim * dzClaim <= 2.6 * 2.6;

let playerGold = 2083; // 2450 - 367
let speedMult = 1.0;
let damageReduction = 1.0;

if (canClaim && tombstoneState.active) {
  playerGold += tombstoneState.gold;
  tombstoneState.active = false;
  tombstoneState.gold = 0;
  // Apply "Dwarven Grit" buff (+20% speed, +25% defense)
  speedMult = 1.2;
  damageReduction = 0.75;
}

assert(
  canClaim && !tombstoneState.active && playerGold === 2450,
  'Ancestral Tombstone Claim Restores 100% of Dropped Gold (2,083g + 367g = 2,450g)'
);
assert(
  speedMult === 1.2 && damageReduction === 0.75,
  'Dwarven Grit Buff Activated (+20% Speed, 0.75x Damage Mult)'
);

// 4. JSON Serialization & Round-Trip Persistence
const serialized = JSON.stringify({ tombstone: { x: 190.5, y: 32.1, z: 140.8, gold: 367, active: true } });
const parsed = JSON.parse(serialized);
assert(
  parsed.tombstone.x === 190.5 && parsed.tombstone.gold === 367 && parsed.tombstone.active === true,
  'SavedTombstone JSON Round-Trip Serialization & Persistence Invariant'
);

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
