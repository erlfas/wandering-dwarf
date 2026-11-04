# Algorithmic & Rendering Performance Improvements

This document details the algorithmic, mathematical, and rendering-pipeline optimizations implemented in **Wandering Dwarf (`procedural-world`)** to eliminate both continuous GPU bottlenecks (low frame rates) and main-thread CPU frame spikes (stutters when crossing chunk boundaries).

---

## Overview of Complexity Reductions

| Subsystem | Previous Algorithm | New Algorithm | Complexity / Cost Reduction |
| :--- | :--- | :--- | :--- |
| **Terrain Vertex Normals & Colors** | 4 finite-difference `getHeight()` calls + per-vertex `getSurfaceColor()` (`(N+1)²` evaluations) | 1-cell padded height grid `(N+3)²`, coarse `17×17` biome color grid with bilinear interpolation, and chunk-center Lipschitz track bound | **~78.7% fewer** height calls + **~93% fewer** biome color Simplex calls on $N=64$ chunks |
| **Foliage Surface Queries (`ChunkGrass` & `ChunkForest`)** | Re-evaluated `getHeight()`, `getNormal()` (4× `getHeight`), and `getSurfaceColor()` per instance | `O(1)` bilinear interpolation (`ChunkSurfaceSampler`) over the chunk's vertex buffers | **100% elimination** of redundant height/normal/color noise calls (~160,000 Simplex evaluations saved per chunk) |
| **Per-Frame & Prop Surface Queries (`getSurfaceHeight` / `getSurfaceNormal`)** | 5× `noise.getHeight()` evaluations (60 Simplex noise calls) per query in camera, chests, landmarks, and challenges | `O(1)` direct array indexing into `chunk.mesh.geometry.attributes.position` & `normal` wired across all world managers | **60 → 0** Simplex noise evaluations per query across camera, `TreasureManager`, `LandmarkManager`, and `ChallengeManager` |
| **Chunk LOD Transitions** | Full `TerrainChunk` disposal + terrain & forest rebuild when grass density changes | Decoupled in-place `updateGrass()` and `updateForestLOD()` with primary/secondary `instanceMatrix` partitioning & 4.5 ms frame budget | **0 terrain/forest/grass buffer rebuilds** on LOD transitions (`dist = 1.5` & `2.6`) |
| **Chunk Geometry & Water Lifecycle** | Allocate new `PlaneGeometry`, `rotateX`, full-chunk water plane, `computeBoundingBox/Sphere`, and `dispose()` on unload | Segment-bucketed `BufferGeometry` pool + analytical `O(1)` bounds + tight sub-chunk water AABB fitting | **0 WebGL buffer reallocations** during movement; dry chunks skip water meshes and partially wet chunks shrink water overdraw |
| **Foliage 3D Asset Instancing & GLB Parsing** | Full PBR texture decoding + `MeshPhysicalMaterial`, unwelded 39,784-vert Pine GLB, 75-tri tall grass, and unthrottled clump shadows | Pre-parse GLB texture/specular stripping, `mergeVertices()` pine welding (~61.7% fewer verts), 33-tri tall grass, and `onBeforeShadow` `drawRange` proxy | **~30M–45M fewer triangles** and **>150 MB less GPU texture memory** across main + shadow passes |
| **Treasure Chest Rendering & Sync** | 9 meshes, 7 geometries, 4 materials allocated per chest; 169-cell grid scan every frame | Pre-merged static base/lid geometries, shared materials, chunk-boundary cache, 45 m ring-pulse culling | **~65% fewer chest draw calls**, **0 per-frame Set/string allocations**, and **0 GPU memory leaks** |
| **Skeletal Animation & VFX (`DwarfCharacter`)** | 195 keyframe tracks (65 bones × pos/quat/scale) + 48-slot particle loop & container matrix updates every frame | Pruning of `.scale`, non-root `.position`, and 30 finger phalange tracks; 30 Hz idle mixer throttling; `activeParticleCount` & tilt epsilon guards | **~80% fewer** `THREE.AnimationMixer` bindings evaluated, **0 idle particle loops**, and **0 redundant 65-bone matrix dirtying** |

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

### Coarse $17 \times 17$ Biome Color Grid & Sub-Chunk Water AABB (`TerrainChunk.ts`)
- **Coarse Biome Color Interpolation:** Low-frequency biome and forest-canopy Simplex noise varies smoothly across space. Instead of evaluating `noise.getSurfaceColor()` at all $65 \times 65 = 4,225$ vertices of a high-resolution chunk, `TerrainChunk` samples low-frequency biome colors on a coarse grid capped at $17 \times 17$ ($289$ samples) and bilinearly interpolates them across the dense vertex grid while still applying exact per-vertex elevation, slope, river-bank, and footpath blending (**~93% reduction** in biome color Simplex calls on $N=64$ chunks).
- **Tight Sub-Chunk Water AABB Fitting:** While populating the height grid, `TerrainChunk` tracks the exact bounding rectangle $[minWetX, maxWetX] \times [minWetZ, maxWetZ]$ of vertices below `waterLevel`. Dry chunks skip water mesh creation entirely (`waterMesh = null`), and partially wet chunks scale and position their water plane strictly over the wet sub-rectangle, reducing transparent water pixel overdraw.

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

## 3. $O(1)$ Exact Triangle Barycentric Height & Normal Lookup (`ChunkManager`)

### The Problem
`ExplorerCamera`, `TreasureManager`, `LandmarkManager`, and `ChallengeManager` query ground heights and normals across loaded chunks. Previously, `getSurfaceHeight()` called `this.noise.getHeight()` **5 times per invocation** (`exactNoiseY`, `h00`, `h10`, `h01`, `h11`), costing **60 Simplex noise calls per query**, and world managers called `noise.getHeight()` / `noise.getNormal()` directly even when the chunk was already loaded in memory.

### The Algorithmic Fix
1. In `ChunkManager.getSurfaceHeight(worldX, worldZ)` and `ChunkManager.getSurfaceNormal(worldX, worldZ, target)`, when the target chunk is loaded in `this.chunks`, the 4 quad corner attributes are read directly from `chunk.mesh.geometry.attributes.position` and `normal`:
   ```ts
   const row0 = iz0 * stride;
   const row1 = (iz0 + 1) * stride;
   const h00 = posAttr.getY(row0 + ix0);
   const h10 = posAttr.getY(row0 + ix0 + 1);
   const h01 = posAttr.getY(row1 + ix0);
   const h11 = posAttr.getY(row1 + ix0 + 1);
   ```
2. Using the exact diagonal split of `THREE.PlaneGeometry` ($f_x + f_z \le 1$ for upper-left triangle, $f_x + f_z > 1$ for lower-right triangle), the exact rendered triangle height and bilinear surface normal are interpolated in **$O(1)$ time with 0 noise evaluations**.
3. `ChunkManager`'s `getSurfaceHeight` and `getSurfaceNormal` callbacks are wired into `TreasureManager`, `LandmarkManager`, and `ChallengeManager` so chest placement, stone circles, campfires, and ring challenge gates all reuse the $O(1)$ vertex-buffer lookup.
4. In `ExplorerCamera.update(dt)`, when horizontal movement `moveLen <= 0.001` (player is stationary), `groundY` reuses `preGroundY` instead of querying `getSurfaceHeight()` a second time for identical coordinates.

---

## 4. Noise Function Early-Outs, Loop Unrolling & Lipschitz Track Bound (`TerrainNoise.ts`)

Inside `TerrainNoise.getHeight(x, z)`, `getForestDensity(x, z)`, and `getTrackInfluence(x, z)`:
1. **Unrolled 3-Octave Meso Noise:** Replaced the 3-iteration `for` loop and runtime normalization division (`/ norm`) with an unrolled expression multiplied by the compile-time reciprocal constant `INV_MESO_NORM = 1.0 / 1.7104`.
2. **Conditional Pond Evaluation:** Previously, `this.pondNoise(...)` was evaluated for every $(x, z)$ coordinate even on high mountain peaks where ponds cannot form (`height >= waterY + 11.0`) or far away from river channels (`rVal >= cfg.riverWidth * 0.013832`). Guarding `this.pondNoise` behind those spatial/elevation bounds skips 2 Simplex evaluations on the vast majority of terrain vertices.
3. **Spawn Clearing Early-Out:** In `getForestDensity(x, z)`, checking `if (spawnDistSq <= 100) return 0;` *before* evaluating the two `forestNoise` octaves avoids 2 Simplex calls inside the spawn clearing.
4. **Chunk-Center Lipschitz Bound for Forest Tracks:** Because the domain-warped track noise fields have a bounded spatial gradient (Lipschitz constant), `TerrainChunk` evaluates the raw track field distance at the chunk center $(cx, cz)$ once before the vertex loop. If the center distance exceeds the Lipschitz safety bound for the chunk's half-diagonal, the entire chunk is guaranteed to contain no footpath and skips per-vertex `getTrackInfluence(wx, wz)` calls across all $4,225$ vertices.

---

## 5. Decoupled Chunk LOD State Machine, Primary/Secondary Instance Partitioning & Geometry Pooling

### Decoupled Grass & Forest LOD Transitions with $O(1)$ `instanceMatrix` Slicing
Previously, `ChunkManager` checked:
```ts
if (!existing || existing.segments !== segments || existing.hasGrass !== wantGrass)
```
This caused two problems:
1. Crossing `dist = 2.6` (where `wantGrass` toggles between `true` and `false`, while terrain `segments` stays at `32`) **destroyed and rebuilt the entire `TerrainChunk`**—regenerating the $32 \times 32$ terrain mesh, water plane, and `ChunkForest` trees just to attach or detach grass.
2. Crossing `dist = 1.5` (where grass density changes between `1.0` and `0.55`) either failed to update or rebuilt the entire `ChunkGrass` instance buffers.

**Solution:**
- `TerrainChunk` provides `updateGrass(grassDensityMult, ...)` and `updateForestLOD(dist)`.
- **Primary/Secondary Buffer Partitioning (`GrassField.ts`):** During initial `ChunkGrass` construction, deterministic PRNG sampling partitions instances into a **primary 55% prefix** (`0 .. primaryCount - 1`) and a **secondary 45% suffix** (`primaryCount .. totalCount - 1`) inside each `InstancedMesh` (`grassInstanced`, `tallGrassInstanced`, `flowerHeads`). When transitioning between `dist <= 1.5` (`densityMultiplier = 1.0`) and `1.5 < dist <= 2.6` (`densityMultiplier = 0.55`), `ChunkGrass.setLOD()` simply updates `instancedMesh.count = isNear ? totalCount : primaryCount` and toggles `clumpInstanced.visible = isNear` in **$O(1)$ time with zero buffer rebuilds or heap allocations**.
- `ChunkManager.update()` enforces a **4.5 ms per-frame time budget** (`performance.now() - frameStart > 4.5`) so heavy chunk builds automatically spread across consecutive frames rather than stalling `requestAnimationFrame`.

### Segment-Bucketed `BufferGeometry` Pooling & Analytical Bounds
- When a `TerrainChunk` is unloaded or changes segment resolution (`64`, `32`, `20`), `dispose()` returns `this.mesh.geometry` to `geometryPool.get(this.segments)` instead of destroying the WebGL vertex buffers.
- Newly allocated pool geometries store pre-rotated local $(X, Z)$ coordinates and allocate the `color` attribute once. Subsequent chunk builds pop a pooled geometry and overwrite $Y$, normals, and vertex colors in-place.
- Instead of calling `geometry.computeBoundingBox()` and `geometry.computeBoundingSphere()` (which iterate over all $4,225$ vertices two additional times), `minH` and `maxH` are tracked during the primary vertex loop and used to set the axis-aligned `Box3` and `Sphere` in **$O(1)$ time**.

---

## 6. Close-Range 3D Asset LODs, Pre-Parse GLB Stripping, Vertex Welding & Shadow Proxies (`ForestField.ts`, `GrassField.ts`, `LandmarkManager.ts` & `HuntingAndDeerManager.ts`)

### Pre-Parse GLB Texture & Specular Extension Stripping (`GLTFLoader` Plugin)
All `.glb` assets (`pine tree`, `oak tree`, `simple dwarven hut`, `ancient stone circle`, `grass clump`, `deer`, and `dwarf front t-pose`) were exported with `KHR_materials_specular` (forcing Three.js to compile expensive `THREE.MeshPhysicalMaterial` shaders) plus unused `metallicRoughnessTexture`, `normalTexture`, and `occlusionTexture` maps.
- Registering a `GLTFLoader` `beforeRoot` plugin strips `matDef.extensions.KHR_materials_specular`, `metallicRoughnessTexture`, `normalTexture`, and `occlusionTexture` from `parser.json.materials` *before* `GLTFLoader` instantiates `ImageBitmap` decoders or materials—saving **>150 MB of GPU texture memory** and ensuring lightweight `MeshStandardMaterial` compilation across all models.

### Close-Range GLB LOD Architecture & Geometry Optimizations
1. **Pine Trees, Oak Trees & Dwarven Huts (`ChunkForest.setLOD`):**
   - **Vertex Welding (`mergeVertices`):** `pine tree 3d model.glb` contained 39,784 unwelded vertices for 18,926 triangles. Welding shared vertices via `BufferGeometryUtils.mergeVertices(geo, 1e-4)` reduces vertex shader invocations by **~61.7%** (~15,248 vertices) without altering silhouette or UVs.
   - **Close-Range LOD (`dist <= 1.5` chunks, ~72 m):** Renders the welded `pine tree 3d model.glb` (`sharedPineGeo` + `sharedPineMat`), `oak tree 3d model.glb` (`sharedOakGeo` + `sharedOakMat`), and `simple dwarven hut 3d model.glb` (`sharedHutGeo` + `sharedHutMat`).
   - **Mid/Far-Range LOD (`dist > 1.5` chunks):** Dynamically swaps `pineInstanced`, `broadleafInstanced`, and `hutInstanced` geometry and materials in-place to lightweight procedural geometries (`createPineTreeGeometry()`, `createBroadleafTreeGeometry()`, and 112-triangle `createDwarvenHutGeometry()`), reducing distant triangle counts by **>98.5%**.
   - **Shadow Culling:** Tree, hut, and boulder shadow casting (`castShadow`) is enabled only within `dist <= 2.2` chunks.
2. **Ancient Stone Circles (`LandmarkManager.update`):**
   - **Close-Range LOD (`dist <= 1.5` chunks, ~72 m):** Swaps `stoneCircleMesh` in-place to the 19,418-triangle `ancient stone circle asset.glb` (`sharedStoneCircleGeo` + `sharedStoneCircleMat`), with the inner floor aligned to terrain `Y = 0` and the outer foundation skirt embedded into sloped terrain.
   - **Mid/Far-Range LOD (`dist > 1.5` chunks):** Swaps back to the pre-merged 60-triangle procedural mossy megalith ring (`stoneCircleSimpleGeo` + `matMossStone`) and log benches (`logBenchesGeo`). Shadow casting is gated behind `dist <= 2.2` chunks.
3. **Grass Clumps, 33-Tri Tall Grass & Shadow-Proxy `drawRange` (`ChunkGrass`):**
   - **33-Triangle Tall Grass Tuft:** Reduced procedural waist-high tall grass tuft geometry from 9 blades (75 triangles) to 5 blades (33 triangles, **56% triangle reduction**) with slightly wider blade bases to preserve meadow volume.
   - **Shadow-Proxy `drawRange` (`onBeforeShadow` / `onAfterShadow`):** `grass clump 3d model.glb` contains 18,955 triangles. When rendering directional shadow maps on close-range clumps, `onBeforeShadow` temporarily restricts `geometry.drawRange.count` to a coarse ~1,800-triangle subset (`shadowIndexCount`) and `onAfterShadow` restores the full index range—cutting grass clump shadow-map vertex load by **~90%**.
   - **Backface Normal Preservation (`DoubleSide` Foliage):** Custom wind shaders preserve smooth upward-biased canopy/blade normals on backfaces rather than flipping `vNormal` via `gl_FrontFacing`, eliminating harsh dark bands on double-sided grass blades and tree foliage.
4. **Broadleaf Geometry Reduction & Explicit Bounding Spheres:**
   - Reduced `THREE.IcosahedronGeometry(1.0, detail)` canopy lobes from `detail = 2` to `detail = 1` (**75% vertex reduction**) and assigned an explicit chunk-enclosing `THREE.Sphere` (`radius = size * 0.85`) to all `InstancedMesh` objects for accurate frustum culling.
5. **Wild Deer 3D Model LOD & Pooled Arrow Projectiles (`HuntingAndDeerManager`):**
   - **Close-Range LOD (`dist <= 1.5` chunks, ~72 m):** Renders the welded 18,574-triangle `deer 3d model.glb` (`sharedDeerGlbGeo` + `sharedDeerGlbMats`) with unused PBR maps stripped pre-parse and `receiveShadow = false`.
   - **Mid/Far-Range LOD (`dist > 1.5` chunks):** Swaps `deer.bodyMesh` in-place to a pre-merged ~112-triangle procedural deer geometry (`deerFallbackGeo` + `deerFallbackMats`), gating `castShadow` behind `dist <= 2.2` chunks (`48 m`) and reusing a fixed 6-slot pool of merged 3D arrow projectiles (`sharedArrowGeo`).
6. **Dwarven Hut Cutaway Interior & Collectible Artefacts (`HutManager.ts`):**
   - **Pre-Parse Specular & PBR Stripping + Normal Guard:** Loads `3dmodels/dwarven hut interior 3d model.glb` (19,625 triangles, 22,939 vertices) via `createOptimizedGlbLoader()`, strips unused `skinIndex`/`skinWeight` attributes, aligns the wooden plank floor (`9.2%` of height) to `Y = 0` at `5.2 m` height, guards `computeVertexNormals()`, and hot-swaps from a `< 90`-triangle procedural cutaway fallback.
   - **On-Demand Interior Stage & Exterior Culling:** The interior mesh and 6 pre-merged 3D Dwarven Artefact geometries (`ARTEFACT_CATALOG`) are only visible while the dwarf is inside a hut (`interiorGroup.visible = true`), while exterior chunk/foliage/water groups and planar water reflections are hidden/skipped—eliminating exterior draw calls and preventing grass or terrain from clipping through the interior floorboards.
   - **$O(1)$ Furniture Collision & Chunk-Cached Doorway Markers:** Interior wall clamping and 18 precomputed furniture collision circles (`HUT_INTERIOR_COLLIDERS`) run in $O(1)$ time with zero heap allocations, and exterior doorway threshold markers synchronize only when `centerCx`, `centerCz`, or `activeChunkCount` changes.
7. **Natural Stones (`natural rock 3d model.glb`), Stone Quarries & Progressive Castle Construction (`CastleAndQuarryManager.ts`):**
   - **Pre-Parse Specular & PBR Stripping + Vertex Welding:** Loads `3dmodels/natural rock 3d model.glb` (18,114 triangles, 14,375 vertices) via `createOptimizedGlbLoader()`, strips unused `skinIndex`/`skinWeight` attributes, normalizes pivot (`centerX = 0`, `centerZ = 0`, `baseY = 0`) at `0.78 m` carryable height, guards `computeVertexNormals()`, and welds split vertices via `mergeVertices(geo, 1e-4)`.
   - **Close-Range GLB LOD (`dist <= 1.5` chunks, ~72 m):** Only close-range natural rock instances (`activeNearRocks`) and the dwarf's carried stone mesh use `sharedNaturalRockGeo` + `sharedNaturalRockMat`. Mid/far chunks (`dist > 1.5`) swap in-place to a `< 50`-triangle procedural dodecahedron boulder fallback, and `castShadow` is gated behind `dist <= 2.2` chunks (`48 m`).
   - **Pre-Merged Quarry, 30-Slot Castle Geometries, Quarry Workbench/Jib-Crane `.glb` Props & 3 Complete Castle `.glb` Milestone Models:** Quarry minecarts/rails, low-poly procedural fallbacks (`fallbackWorkbenchGeo`, `fallbackJibCraneGeo`), and all 30 progressive Castle architectural block slots (`buildCastleSlotsAndGeometries()`) are pre-merged by material bucket at module initialization. The Quarry's `dwarven workbench 3d model.glb` (`18,242` tris) and `wooden jib crane 3d model.glb` (`19,812` tris) are loaded via `createOptimizedGlbLoader()` (stripping `KHR_materials_specular` and `> 12 MB` of secondary PBR textures in `beforeRoot`), welded via `mergeVertices`, and restricted to close-range GLB LOD (`dist <= 1.8` chunks / `~86.4 m`, `receiveShadow = false`), swapping to low-poly procedural fallbacks beyond `dist > 1.8` chunks. Similarly, the three complete milestone castle `.glb` models (`dwarven border keep 3d model.glb` at `21,377` tris, `stone fortress 3d model.glb` at `22,491` tris, and `medieval castle 3d model.glb` at `23,025` tris) are loaded on demand via `createOptimizedGlbLoader()`, welded via `mergeVertices`, and restricted to close-range GLB LOD (`dist <= 2.2` chunks / `~105.6 m`, `receiveShadow = false`), automatically swapping to the pre-merged procedural castle meshes beyond `dist > 2.2` chunks. Walkable surface elevation (`getWalkableSurfaceHeight`) and local-space 2D oriented box/circle collision (`resolveObstacleCollision`) run in $O(1)$ per active Quarry/Castle with zero heap allocations.
8. **Three Castle Cutaway Interiors (`CastleInteriorManager.ts`) & Nighttime Troll-Beast Combat Pool (`TrollCombatManager.ts`):**
   - **On-Demand Castle Interior GLBs & Exterior Scene Culling:** The three cutaway interior models (`border keep interior.glb` at `21,028` tris, `stonewall_stronghold_interior.glb` at `18,863` tris, and `grand citadel interior 3d model.glb` at `19,772` tris) load on demand via `createOptimizedGlbLoader()` (stripping `KHR_materials_specular` and `~6 MB` of secondary PBR PNGs per interior in `beforeRoot`), strip unused skinning attributes, align floorboards to `Y = 0`, weld split vertices via `mergeVertices(geo, 1e-4)`, and hot-swap from a `< 90`-triangle procedural cutaway fallback. While inside a castle (`interiorGroup.visible = true`), all exterior scene groups and planar water reflections are hidden/skipped, and interior wall + furniture collision runs in $O(1)$ time with zero heap allocations.
   - **Pooled Skinned Troll-Beasts, Keyframe Track Pruning & Close-Range GLB LOD:** `troll-beast 3d model.glb` (`18,555` tris, 65 bones, 3 skeletal clips) loads once via `createOptimizedGlbLoader()` (stripping the `4.55 MB` secondary PBR texture in `beforeRoot`), prunes `.scale`, non-`Hips` `.position`, and finger phalange tracks (~66% reduction in mixer evaluation), and populates a fixed 3-instance pool via `SkeletonUtils.clone()`. Only trolls within `dist <= 1.5` chunks (`~72 m`) evaluate their `AnimationMixer` and render the skinned GLB mesh (`receiveShadow = false`), swapping to a `< 110`-triangle pre-merged procedural troll fallback beyond `1.5` chunks.

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

## 8. Render Loop, Throttled Shadow Maps, Skeletal Animation & UI/Audio Optimizations

1. **Texel-Grid Shadow Snapping & Throttled Shadow Map Updates (`main.ts`):**
   - Switched from 9-tap `THREE.PCFSoftShadowMap` to 4-tap `THREE.PCFShadowMap`, tightened `shadowExtent` from `95` to `65`, and capped `devicePixelRatio` at `1.5`.
   - Set `renderer.shadowMap.autoUpdate = false` and snapped directional light and target positions to a `2.0 m` step grid (`Math.round(p / 2) * 2`), triggering `renderer.shadowMap.needsUpdate = true` only when the snapped sun cell moves or at a throttled interval for near-camera animation.
2. **Keyframe Track Pruning, Idle Throttling & Particle/Tilt Guards (`DwarfCharacter.ts`):**
   - The 65-bone humanoid rig in `dwarf front t-pose 3d model.glb` exported 195 tracks per clip (`position`, `quaternion`, and `scale` on every bone), including 30 individual finger phalange bones (`Index1..4`, `Middle1..4`, `Ring1..4`, `Pinky1..4`, `Thumb1..4`).
   - `setupAnimations()` and `createIdleClip()` strip all `.scale` tracks, all non-`Hips` `.position` tracks, and all finger phalange tracks at load time (~80% reduction in evaluated tracks), and `createIdleClip()` uses 2-keyframe endpoints on static rest bones.
   - Once the 0.25 s crossfade into `'idle'` completes, `this.mixer.update()` is throttled to ~30 Hz (`0.033 s` accumulator).
   - `trailPoints` sets `matrixAutoUpdate = false` and `visible = false` when `activeParticleCount === 0`, skipping the 48-slot particle simulation loop and draw call entirely when no particles are live.
   - `modelContainer.rotation.set(this.slideTiltX, 0, this.slideTiltZ)` is guarded behind an epsilon check (`0.0005 rad`) so the 65-bone `SkinnedMesh` hierarchy does not dirty its world matrices every frame when upright on land.
3. **HUD DOM Caching, Quick-Sync Debug UI & Deferred Audio (`RelicStore.ts`, `DebugOverlay.ts`, `BackgroundMusic.ts`):**
   - `RelicStore` builds the 4 relic `<button>` DOM nodes once in `buildShopDOM()` and caches `{ button, costSpan, lastState }`, updating classes and text in-place in $O(1)$ only when a card's state (`owned` / `affordable` / `locked`) actually changes.
   - Web Audio API sound effects share a singleton `AudioContext` (`getSharedAudioContext()`) and attach `osc.onended = () => { osc.disconnect(); gain.disconnect(); }` to prevent audio-graph node accumulation.
   - `DebugOverlay.syncDisplay(full = false)` updates only the 3 hotkey-driven `quickSyncControllers` (`timeOfDay`, `cameraMode`, `wireframe`) instead of traversing the entire `lil-gui` controller tree.
   - `BackgroundMusic` initializes `challengeAudio.preload = 'none'` at startup and warms the secondary challenge track lazily via `requestIdleCallback` so initial network and audio-decode bandwidth is dedicated to primary world startup.
