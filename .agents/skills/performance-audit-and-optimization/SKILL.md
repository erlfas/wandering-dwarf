---
name: performance-audit-and-optimization
description: >-
  Audit, diagnose, and solve common WebGL, Three.js, game engine, and real-time simulation
  performance bottlenecks including GC stutter, unbounded GPU pooling, shadow/reflection overdraw,
  unthrottled AI ticks, and redundant spatial sampling.
---

# Real-Time & WebGL Performance Audit and Optimization Guide

This skill provides systematic methodology, heuristics, and drop-in code patterns for auditing, detecting, and resolving performance bottlenecks in real-time WebGL, Three.js, and browser simulation codebases.

---

## 1. Multi-Dimensional Performance Audit Workflow

When auditing a codebase for performance, partition the investigation into distinct specialized roles (e.g., via subagents or structured passes):

1. **Rendering & GPU Resource Pipeline**:
   - Depth/Shadow pass overhead: Are directional or point light shadow maps rendering when culled or indoors?
   - Secondary render passes: Do planar reflections, water cameras, or minimaps re-render micro-geometry (e.g., grass clumps, small rocks, particles)?
   - Draw calls and batching: Are static or repetitive meshes converted to `THREE.InstancedMesh`?
   - Skinned meshes & animations: Are distant models still executing bone updates and casting dynamic shadows?
2. **Memory Leaks & VRAM Buffer Retention**:
   - Buffer pools: Are object or geometry pools capped, or do they grow unbounded with player movement?
   - Disposal integrity: Are geometries, materials, and textures disposed of recursively when chunks or entities despawn?
   - Event listeners and audio nodes: Are Web Audio oscillators and nodes disconnected properly on stop?
3. **CPU Stutter & Garbage Collection (GC) Pressure**:
   - Per-frame heap allocations: Look for `new THREE.Vector3()`, `new THREE.Matrix4()`, `new THREE.Color()`, or array literals (`[]`, `.slice()`, `.map()`) inside `update()`, `animate()`, or physics loops.
   - String concatenation and DOM thrashing: Are HUD text, styles, or classes mutated every frame even when unchanged?
4. **Simulation & Spatial Math Efficiency**:
   - Terrain sampling: Are height, normal, and track weight queries hitting the noise/heightmap multiple times for the same coordinates?
   - Entity lookups: Are queries iterating through nested chunk maps or allocating arrays to find nearby mobs instead of maintaining a flat active entity list?
   - AI and raymarch frequency: Are high-cost pathfinding, raymarching, or distance probes running at 60 Hz when 5–10 Hz is imperceptible?

---

## 2. Common Anti-Patterns & Proven Solutions

### A. Zero-Allocation Scratch Vectors in Per-Frame Loops

**Problem:** Instantiating temporary math vectors inside `update()` or per-frame methods causes frequent V8 Garbage Collector pauses, causing frame stutters:
```ts
// ❌ ANTI-PATTERN: Generates 60+ objects/sec per entity
public update(dt: number) {
  const diff = new THREE.Vector3().subVectors(target, this.pos);
  const dir = diff.clone().normalize();
}
```

**Solution:** Use file-scoped module scratch vectors with in-place mutation:
```ts
// ✅ OPTIMIZED: 0 heap allocations
const _scratchDiff = new THREE.Vector3();
const _scratchDir = new THREE.Vector3();

export class Entity {
  public update(dt: number) {
    _scratchDiff.subVectors(target, this.pos);
    _scratchDir.copy(_scratchDiff).normalize();
  }
}
```

---

### B. Geometry & Material Pooling with Pool Caps

**Problem:** Geometry pools without an upper limit retain millions of vertex buffer bytes in GPU memory as the player traverses endless terrain chunks:
```ts
// ❌ ANTI-PATTERN: Unbounded GPU memory growth
const pool: THREE.BufferGeometry[] = [];
export function recycleGeometry(geo: THREE.BufferGeometry) {
  pool.push(geo); // Keeps growing forever
}
```

**Solution:** Cap the pool to the maximum needed for active chunk recycling, and explicitly dispose of excess buffers:
```ts
// ✅ OPTIMIZED: Strict VRAM pool cap
const MAX_POOL_SIZE = 12;
const pool: THREE.BufferGeometry[] = [];

export function recycleGeometry(geo: THREE.BufferGeometry) {
  if (pool.length < MAX_POOL_SIZE) {
    pool.push(geo);
  } else {
    geo.dispose();
  }
}
```

---

### C. Layer-Based Culling for Secondary Cameras (Water Reflections & Shadows)

**Problem:** Planar water reflection cameras and shadow cameras re-render tens of thousands of tiny instanced foliage tufts, stones, and micro-particles whose details are completely invisible in low-resolution reflection or depth buffers:
```ts
// ❌ ANTI-PATTERN: Reflection camera renders entire scene layer 0
waterCamera.layers.mask = 1; // renders all layer 0 meshes (including 50,000 grass blades)
```

**Solution:** Designate a dedicated Three.js layer for micro-foliage (e.g. `LAYER_MICRO_FOLIAGE = 1`). Enable it on the main camera and shadow light, but omit it from the planar reflection camera:
```ts
// ✅ OPTIMIZED: Zero foliage vertex work in planar reflection pass
export const LAYER_MICRO_FOLIAGE = 1;

// In Foliage/Grass builder:
instancedMesh.layers.set(LAYER_MICRO_FOLIAGE);

// In Main Camera setup:
camera.layers.enable(LAYER_MICRO_FOLIAGE);
dirLight.shadow.camera.layers.enable(LAYER_MICRO_FOLIAGE);

// In Planar Water Camera setup:
waterReflectionCamera.layers.disable(LAYER_MICRO_FOLIAGE);
```

---

### D. Skipping Directional Shadow Rasterization Indoors

**Problem:** When the player enters interior scenes (dwarven caverns, castle interiors, dungeons), the 2048x2048 outdoor directional light shadow map continues re-rasterizing every frame.

**Solution:** Guard the shadow camera update when the player is inside an enclosed interior:
```ts
// ✅ OPTIMIZED: Skip 2048x2048 shadow re-render when indoors
if (!insideInterior && dirLight.castShadow) {
  dirLight.shadow.map?.dispose(); // or pause update
  dirLight.shadow.autoUpdate = true;
} else {
  dirLight.shadow.autoUpdate = false;
}
```

---

### E. Single-Pass Surface Point Sampling

**Problem:** Chunk foliage and decoration placement often samples height, normal, and biome color with separate calls, each calculating bilinear coordinates and float conversions repeatedly:
```ts
// ❌ ANTI-PATTERN: 3 separate bilinear lookups per point
const y = sampler.getHeight(x, z);
const normal = sampler.getNormal(x, z);
const trackWeight = sampler.getTrackWeight(x, z);
```

**Solution:** Consolidate surface sampling into a unified single-pass method that shares floor indices and bilinear weight calculations:
```ts
// ✅ OPTIMIZED: Single-pass surface sampling with fast bitwise floor
public sampleSurfacePoint(
  localX: number,
  localZ: number,
  outNormal: THREE.Vector3,
  outColor?: THREE.Color,
  computeTrackWeight?: boolean
): { height: number; trackWeight: number } {
  const u = (localX * invStep) | 0;
  const v = (localZ * invStep) | 0;
  // Compute height, normal, color, and track weight using shared bilinear coordinates
  return { height, trackWeight };
}
```

---

### F. Flat Active Entity Lists vs. Chunk-Map Traversal

**Problem:** Querying nearby entities for projectiles, explosions, or melee strikes by iterating over all active chunks and building temporary arrays `ent.goblins ?? (ent.goblin ? [ent.goblin] : [])` causes dozens of array allocations every frame.

**Solution:** Maintain a flat array of active entities (`activeEntities: Entity[] = []`). Push on chunk spawn, splice on chunk despawn, and iterate directly:
```ts
// ✅ OPTIMIZED: Direct flat iteration with zero allocations
for (let i = 0; i < this.activeEntities.length; i++) {
  const e = this.activeEntities[i];
  if (e.defeated || !e.visible) continue;
  const dx = e.pos.x - queryPos.x;
  const dz = e.pos.z - queryPos.z;
  if (dx * dx + dz * dz <= rSq) {
    // Process hit
  }
}
```

---

### G. Multi-Tiered AI and Raymarch Throttling

**Problem:** Complex raymarching (e.g. grapple latch targeting), entity sensory probes (e.g. 8-direction fish obstacle probes), and nearest-target scans (e.g. turret target search) do not need to run at 60 Hz. Running them every frame wastes 80-90% of CPU time.

**Solution:** Accumulate delta time and update sensory/pathing state at 5–10 Hz while keeping transform interpolation at 60 Hz:
```ts
// ✅ OPTIMIZED: Throttled sensory tick at 10 Hz with smoothed transform
this.scanTimer += dt;
if (this.scanTimer >= 0.1 || this.cachedTarget === undefined) {
  this.scanTimer = 0;
  this.cachedTarget = this.findNearestTarget(36.0);
}
// Smoothly aim toward cachedTarget every frame
if (this.cachedTarget) {
  this.aimToward(this.cachedTarget, dt);
}
```

---

### H. Preventing DOM Layout Thrashing in HUD Updates

**Problem:** Assigning `element.textContent`, `element.style.display`, or `element.innerText` every frame forces browser layout/reflow recalculation even when the string or value has not changed.

**Solution:** Cache the previous string and value, and write to the DOM only when the value changes:
```ts
// ✅ OPTIMIZED: Zero DOM writes when state is stable
if (newText !== this.lastPromptText) {
  this.lastPromptText = newText;
  this.promptEl.textContent = newText;
}
if (shouldShow !== this.lastPromptVisible) {
  this.lastPromptVisible = shouldShow;
  this.promptEl.style.display = shouldShow ? 'block' : 'none';
}
```

---

## 3. Performance Verification Checklist

Before completing an optimization pass, verify:
- [ ] **Clean build:** `npm run build` or `tsc --noEmit` exits with 0 errors.
- [ ] **Zero allocations in active loops:** Search for `new THREE.` inside `update(`, `animate(`, `tick(`, or high-frequency loops.
- [ ] **Cap all cache/pools:** Check all arrays used as object/geometry pools to ensure `MAX_POOL_SIZE` is enforced.
- [ ] **Full disposal on destroy:** Verify all `dispose()` methods traverse scene graphs and call `.dispose()` on geometries, materials, and textures.
- [ ] **Secondary pass efficiency:** Verify reflection/shadow cameras do not process micro-details or hidden scenes.
