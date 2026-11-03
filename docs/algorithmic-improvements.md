# Algorithmic & Rendering Performance Improvements

This document details the algorithmic, mathematical, and rendering-pipeline optimizations implemented in **Wandering Dwarf (`procedural-world`)** to eliminate both continuous GPU bottlenecks (low frame rates) and main-thread CPU frame spikes (stutters when crossing chunk boundaries).

---

## Overview of Complexity Reductions

| Subsystem | Previous Algorithm | New Algorithm | Complexity / Cost Reduction |
| :--- | :--- | :--- | :--- |
| **Terrain Vertex Normals** | 4 finite-difference `getHeight()` calls per vertex (`5 × (N+1)²` height samples) | 1-cell padded height grid `(N+3)²` with central differences | **~78.7% fewer** Simplex noise calls per terrain chunk (`270,400` → `53,868` calls for $N=64$) |
| **Foliage Surface Queries (`ChunkGrass` & `ChunkForest`)** | Re-evaluated `getHeight()`, `getNormal()` (4× `getHeight`), and `getSurfaceColor()` per instance | `O(1)` bilinear interpolation (`ChunkSurfaceSampler`) over the chunk's vertex buffers | **100% elimination** of redundant height/normal/color noise calls (~160,000 Simplex evaluations saved per chunk) |
| **Per-Frame Ground Height (`getSurfaceHeight`)** | 5× `noise.getHeight()` evaluations (60 Simplex noise calls) per query | `O(1)` direct array indexing into `chunk.mesh.geometry.attributes.position` | **60 → 0** Simplex noise evaluations per query (180 noise calls/frame eliminated) |
| **Chunk LOD Transitions** | Full `TerrainChunk` disposal + terrain & forest rebuild when grass density changes | Decoupled in-place `updateGrass()` and `updateForestLOD()` with 4.5 ms frame time budget | **0 terrain/forest rebuilds** on grass LOD transitions (`dist = 1.5` & `2.6`) |
| **Chunk Geometry Lifecycle** | Allocate new `PlaneGeometry`, `rotateX`, `computeBoundingBox/Sphere`, and `dispose()` on unload | Segment-bucketed `BufferGeometry` pool + analytical `O(1)` bounding box/sphere from `[minH, maxH]` | **0 WebGL buffer reallocations** during normal movement; `O(V)` → `O(1)` bounds calculation |
| **Foliage 3D Asset Instancing** | 18,926-tri Pine GLB across all 137 chunks + up to 104× 18,955-tri Grass Clump GLBs per chunk with shadows | Close-range GLB LOD (`dist <= 1.5`) + 160-tri procedural pine for `dist > 1.5` + capped shadowless clumps | **~30M–45M fewer triangles** processed per frame across main + shadow passes |
| **Treasure Chest Rendering & Sync** | 9 meshes, 7 geometries, 4 materials allocated per chest; 169-cell grid scan every frame | Pre-merged static base/lid geometries, shared materials, chunk-boundary cache, 45 m ring-pulse culling | **~65% fewer chest draw calls**, **0 per-frame Set/string allocations**, and **0 GPU memory leaks** |
| **Skeletal Animation (`DwarfCharacter`)** | 195 keyframe tracks (65 bones × pos/quat/scale) interpolated every frame | Track pruning of constant `.scale` and non-root `.position` tracks | **~66% fewer** `THREE.AnimationMixer` property bindings evaluated per frame (195 → 66 tracks) |

---

## 1. Padded Grid Central-Difference Normals (`TerrainChunk.ts`)

### The Problem
Previously, building a terrain chunk of resolution $N \times N$ segments ($(N+1)^2$ vertices) computed the height and surface normal at each vertex independently:
1. `wy = noise.getHeight(wx, wz)` (1 height evaluation)
2. `noise.getNormal(wx, wz, tempNormal)`, which computed central differences at $\pm \epsilon$ ($\epsilon = 0.35\text{ m}$):
   $$\mathbf{n} = \text{normalize}\big(h(x-\epsilon, z) - h(x+\epsilon, z),\; 2\epsilon,\; h(x, z-\epsilon) - h(x, z+\epsilon)\big)$$
   requiring **4 additional `getHeight()` calls per vertex**.

Because each `getHeight()` call evaluates up to **12 2D Simplex noise octaves** (domain warp, macro ridges, 3-octave meso hills, micro detail, river meandering, and pond basins), a single $64 \times 64$ chunk ($4,225$ vertices) executed:
$$4,225 \times 5 = 21,125 \text{ height evaluations} \approx 253,500 \text{ Simplex noise evaluations}$$

### The Algorithmic Fix
Because a terrain chunk is already a uniform Cartesian grid with spacing $\Delta = \frac{\text{size}}{N}$, the heights of adjacent vertices $(i \pm 1, j)$ and $(i, j \pm 1)$ are already neighbors on the same grid!

Instead of evaluating 4 extra off-grid points per vertex, `TerrainChunk.buildGeometry()` now:
1. Evaluates `noise.getHeight(wx, wz)` once per grid point on a **1-cell padded grid** of dimensions $(N + 3) \times (N + 3)$ covering indices $gx, gz \in [-1, N+1]$ into a reusable `Float32Array` buffer (`paddedHeights`).
2. For each interior chunk vertex $(gx, gz) \in [0, N]^2$ (corresponding to padded indices $px = gx + 1, pz = gz + 1$), computes the surface normal directly from its 4 grid neighbors using central differences over step $2\Delta$:
   $$n_x = H[pz, px - 1] - H[pz, px + 1], \quad n_y = 2\Delta, \quad n_z = H[pz - 1, px] - H[pz + 1, px]$$
   $$\hat{\mathbf{n}} = \frac{(n_x, n_y, n_z)}{\sqrt{n_x^2 + n_y^2 + n_z^2}}$$

Because the 1-cell border padding uses exact world coordinates $(wx, wz)$, vertices along chunk edges compute the exact same central-difference normal on both sides of a chunk boundary, preventing lighting seams.

**Result:** For $N = 64$, height evaluations drop from $5 \times 65^2 = 21,125$ down to $(64 + 3)^2 = 4,489$ — a **78.7% reduction** in terrain noise evaluations.

---

## 2. $O(1)$ Bilinear Surface Interpolation for Foliage (`ChunkSurfaceSampler`)

### The Problem
After `TerrainChunk.buildGeometry()` finished computing the height, normal, and surface biome color for all $(N+1)^2$ vertices of a chunk, `ChunkGrass` and `ChunkForest` placed up to $2,600$ grass tufts, wildflowers, and trees in that same chunk by calling:
- `noise.getHeight(wx, wz)`
- `noise.getNormal(wx, wz, normal)` (4× `getHeight()`)
- `noise.getSurfaceColor(wx, wy, wz, normal, color)` (4× Simplex biome calls)

for every single candidate instance—adding another **~160,000 Simplex noise calls** per chunk.

### The Algorithmic Fix
`TerrainChunk` now implements the `ChunkSurfaceSampler` interface (`sampleHeightAndNormal` and `sampleColor`), which performs **$O(1)$ bilinear interpolation** directly over the chunk's already-populated `position`, `normal`, and `color` `Float32Array` vertex buffers:

Given a local coordinate $(x, z) \in [-\frac{\text{size}}{2}, \frac{\text{size}}{2}]$:
1. Map to continuous grid coordinates $(u, v) \in [0, N]$:
   $$u = \text{clamp}\!\left(\left(x + \frac{\text{size}}{2}\right) \frac{N}{\text{size}}, 0, N - \epsilon\right), \quad v = \text{clamp}\!\left(\left(z + \frac{\text{size}}{2}\right) \frac{N}{\text{size}}, 0, N - \epsilon\right)$$
2. Extract integer cell indices $i_x = \lfloor u \rfloor, i_z = \lfloor v \rfloor$ and fractional weights $f_x = u - i_x, f_z = v - i_z$:
   $$w_{00} = (1 - f_x)(1 - f_z), \quad w_{10} = f_x(1 - f_z), \quad w_{01} = (1 - f_x)f_z, \quad w_{11} = f_x f_z$$
3. Read the 4 corner attributes at stride $S = N + 1$ directly from `posArr`, `normArr`, and `colorArr` in $O(1)$ time with **zero Simplex noise calls**.

---

## 3. $O(1)$ Exact Triangle Barycentric Height Lookup (`ChunkManager.getSurfaceHeight`)

### The Problem
`ExplorerCamera` queries `chunkManager.getSurfaceHeight(x, z)` up to 3 times every frame (for player pre-movement slope checks, post-movement ground snapping, and camera terrain-collision prevention). Previously, `getSurfaceHeight()` called `this.noise.getHeight()` **5 times per invocation** (`exactNoiseY`, `h00`, `h10`, `h01`, `h11`), costing **60 Simplex noise calls per query** (180 calls per frame), even when the player was standing inside an already-loaded chunk.

### The Algorithmic Fix
1. In `ChunkManager.getSurfaceHeight(worldX, worldZ)`, when the target chunk is loaded in `this.chunks`, the 4 quad corner heights $(h_{00}, h_{10}, h_{01}, h_{11})$ are read directly from `chunk.mesh.geometry.attributes.position` via `posAttr.getY(...)`:
   ```ts
   const row0 = iz0 * stride;
   const row1 = (iz0 + 1) * stride;
   const h00 = posAttr.getY(row0 + ix0);
   const h10 = posAttr.getY(row0 + ix0 + 1);
   const h01 = posAttr.getY(row1 + ix0);
   const h11 = posAttr.getY(row1 + ix0 + 1);
   ```
2. Using the exact diagonal split of `THREE.PlaneGeometry` ($f_x + f_z \le 1$ for upper-left triangle, $f_x + f_z > 1$ for lower-right triangle), the exact rendered triangle height is interpolated in **$O(1)$ time with 0 noise evaluations**.
3. In `ExplorerCamera.update(dt)`, when horizontal movement `moveLen <= 0.001` (player is stationary), `groundY` reuses `preGroundY` instead of querying `getSurfaceHeight()` a second time for identical coordinates.

---

## 4. Noise Function Early-Outs & Loop Unrolling (`TerrainNoise.ts`)

Inside `TerrainNoise.getHeight(x, z)` and `getForestDensity(x, z)`:
1. **Unrolled 3-Octave Meso Noise:** Replaced the 3-iteration `for` loop and runtime normalization division (`/ norm`) with an unrolled expression multiplied by the compile-time reciprocal constant `INV_MESO_NORM = 1.0 / 1.7104`.
2. **Conditional Pond Evaluation:** Previously, `this.pondNoise(...)` was evaluated for every $(x, z)$ coordinate even on high mountain peaks where ponds cannot form (`height >= waterY + 11.0`) or far away from river channels (`rVal >= cfg.riverWidth * 0.013832`). Guarding `this.pondNoise` behind those spatial/elevation bounds skips 2 Simplex evaluations on the vast majority of terrain vertices.
3. **Spawn Clearing Early-Out:** In `getForestDensity(x, z)`, checking `if (spawnDistSq <= 100) return 0;` *before* evaluating the two `forestNoise` octaves avoids 2 Simplex calls inside the spawn clearing.

---

## 5. Decoupled Chunk LOD State Machine, Geometry Pooling & Time-Budgeted Streaming

### Decoupled Grass & Forest LOD Transitions
Previously, `ChunkManager` checked:
```ts
if (!existing || existing.segments !== segments || existing.hasGrass !== wantGrass)
```
This caused two problems:
1. Crossing `dist = 2.6` (where `wantGrass` toggles between `true` and `false`, while terrain `segments` stays at `32`) **destroyed and rebuilt the entire `TerrainChunk`**—regenerating the $32 \times 32$ terrain mesh, water plane, and `ChunkForest` trees just to attach or detach grass.
2. Crossing `dist = 1.5` (where grass density changes between `1.0` and `0.55`) never triggered an update because `hasGrass` remained `true`.

**Solution:**
- `TerrainChunk` now provides `updateGrass(grassDensityMult, ...)` and `updateForestLOD(dist)`.
- When `existing.segments === req.segments`, `ChunkManager` preserves the terrain mesh and forest instances, updating only the grass layer or swapping the pine tree LOD in-place.
- `ChunkManager.update()` enforces a **4.5 ms per-frame time budget** (`performance.now() - frameStart > 4.5`) so heavy chunk builds automatically spread across consecutive frames rather than stalling `requestAnimationFrame`.

### Segment-Bucketed `BufferGeometry` Pooling & Analytical Bounds
- When a `TerrainChunk` is unloaded or changes segment resolution (`64`, `32`, `20`), `dispose()` returns `this.mesh.geometry` to `geometryPool.get(this.segments)` instead of destroying the WebGL vertex buffers.
- Newly allocated pool geometries store pre-rotated local $(X, Z)$ coordinates and allocate the `color` attribute once. Subsequent chunk builds pop a pooled geometry and overwrite $Y$, normals, and vertex colors in-place.
- Instead of calling `geometry.computeBoundingBox()` and `geometry.computeBoundingSphere()` (which iterate over all $4,225$ vertices two additional times), `minH` and `maxH` are tracked during the primary vertex loop and used to set the axis-aligned `Box3` and `Sphere` in **$O(1)$ time**.

---

## 6. Close-Range 3D Asset LODs & Frustum Culling (`ForestField.ts` & `GrassField.ts`)

### Close-Range GLB LOD Architecture
Inspecting the binary `.glb` assets revealed that `pine tree 3d model.glb` contains **39,784 vertices / 18,926 triangles** and `grass clump 3d model.glb` contains **22,709 vertices / 18,955 triangles**. Instancing these across all 137 chunks produced 30M–45M triangles per frame.

To preserve the visual fidelity of the 3D models close to the player while eliminating distant GPU overload:
1. **Pine Trees (`ChunkForest.setLOD`):**
   - **Close-Range LOD (`dist <= 1.5` chunks, ~72 m):** Renders the full 18,926-triangle `pine tree 3d model.glb` (`sharedPineGeo` + `sharedPineMat`).
   - **Mid/Far-Range LOD (`dist > 1.5` chunks):** Dynamically swaps `pineInstanced.geometry` and `pineInstanced.material` in-place to the 160-triangle procedural pine geometry (`createPineTreeGeometry()`), reducing distant pine triangle counts by **99.1%**.
   - **Shadow Culling:** Tree and boulder shadow casting (`castShadow`) is enabled only within `dist <= 2.2` chunks.
2. **Grass Clumps (`ChunkGrass`):**
   - **Close-Range LOD (`dist <= 1.5`, `densityMultiplier = 1.0`):** Spawns up to 16 instances per chunk of `grass clump 3d model.glb` with `castShadow = false` alongside full-density procedural grass tufts and wildflowers.
   - **Mid-Range LOD (`1.5 < dist <= 2.6`, `densityMultiplier = 0.55`):** Spawns only the 35-vertex procedural grass tufts (`maxClumps = 0`).
3. **Broadleaf Geometry Reduction:** Reduced `THREE.IcosahedronGeometry(1.0, detail)` canopy lobes from `detail = 2` to `detail = 1`, cutting broadleaf vertex count by **75%**.
4. **Explicit `InstancedMesh` Bounding Spheres:** Assigned a chunk-enclosing `THREE.Sphere` (`radius = size * 0.85`) to all foliage `InstancedMesh` objects so Three.js frustum culling accurately culls off-screen chunks.

---

## 7. Static Geometry Merging & Spatial Caching in `TreasureManager.ts`

1. **Static Sub-Mesh Merging by Material (`mergeBufferGeometries`):**
   Previously, each treasure chest instantiated 9 separate `THREE.Mesh` objects, 7 new `BufferGeometry`s, and 4 new materials (~1,530 draw calls across main + shadow passes for ~90 active chests).
   Now, `getSharedChestAssets()` pre-merges static parts sharing a material once at startup:
   - `baseWoodGeo` (chest box)
   - `baseTrimGeo` (merged left & right iron base straps)
   - `lidWoodGeo` (merged lid box & cylindrical arch in lid pivot space)
   - `lidTrimGeo` (merged left/right lid straps & lock plate in lid pivot space)
   - `goldGeo` & `ringGeo`
   All chests share these 6 static `BufferGeometry` buffers and shared `MeshStandardMaterial`s, and shadow casting is restricted to the 2 primary wood meshes (`base` and `lidWood`).
2. **Chunk-Boundary Caching & Distance-Gated Animation:**
   - `TreasureManager.update()` caches `lastCenterCx` and `lastCenterCz`, running the `(2r+1)^2` chunk-key synchronization loop only when the player crosses a chunk boundary instead of every frame.
   - `glowRing` scale pulsing (`chest.glowRing.scale.setScalar(pulse)`) is gated behind `dSq < 45 * 45`, avoiding per-frame world-matrix recalculations on distant chests.
3. **GPU Resource Disposal:** Added `disposeOpeningChestResources()` to dispose particle `sparkles` geometries/materials and cloned opening ring materials when chest collection finishes.

---

## 8. Render Loop, Shadow Frustum Snapping & Animation Track Pruning

1. **Texel-Grid Shadow Snapping (`main.ts`):**
   - Switched from 9-tap `THREE.PCFSoftShadowMap` to 4-tap `THREE.PCFShadowMap`, tightened `shadowExtent` from `95` to `65`, and capped `devicePixelRatio` at `1.5`.
   - Snapped directional light and target positions to a `2.0 m` step grid (`Math.round(p / 2) * 2`) and updated light matrices only when the snapped grid cell changes, eliminating sub-texel shadow swimming and unnecessary per-frame matrix updates.
2. **Keyframe Track Pruning (`DwarfCharacter.ts`):**
   - The 65-bone humanoid rig in `dwarf front t-pose 3d model.glb` exported 195 tracks per clip (`position`, `quaternion`, and `scale` on every bone), even though non-root bone positions and all bone scales are constant.
   - `setupAnimations()` and `createIdleClip()` now strip all `.scale` tracks and all non-`Hips` `.position` tracks at load time, reducing `THREE.AnimationMixer` evaluations from **195 tracks to 66 tracks per frame** (~66% reduction).
   - `swimRippleRing` and `swimOuterRing` now toggle `visible = false` when on land so transparent water-ring meshes are excluded from the renderer's transparency sort list.
3. **HUD DOM Throttling & Event-Driven Debug UI (`main.ts` & `DebugOverlay.ts`):**
   - Throttled HUD text mutations (`nearestChestHint.textContent` and `coordsReadout.textContent`) from 60–144 Hz down to 5 Hz (`200 ms`), and guarded `compassNeedle.style.transform` behind yaw change detection (`> 0.001 rad`).
   - Removed all `.listen()` polling controllers in `DebugOverlay.ts`, replacing them with an event-driven `syncDisplay()` call when camera or wireframe hotkeys are pressed.
