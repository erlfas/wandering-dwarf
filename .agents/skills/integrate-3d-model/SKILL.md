---
name: integrate-3d-model
description: >-
  Integrates new 3D models (.glb/.gltf) into procedural-world while enforcing all
  algorithmic and rendering performance guarantees (close-range GLB LODs, procedural
  fallbacks, O(1) bilinear surface sampling, frustum bounding spheres, animation track
  pruning, shared geometries/materials, and GPU memory disposal). Activate this skill
  whenever the user asks to add, replace, load, or spawn a 3D model, .glb asset,
  foliage model, world prop, or animated character.
---

# Integrate 3D Model (`procedural-world`)

## Overview

This skill provides a strict, step-by-step workflow and diagnostic script for adding or updating 3D models (`3dmodels/*.glb`) in `procedural-world` without introducing GPU triangle explosions, draw-call bottlenecks, main-thread chunk-build stutters, or WebGL memory leaks.

All integrations MUST comply with the architectural invariants documented in [docs/algorithmic-improvements.md](../../../docs/algorithmic-improvements.md) and the code templates in [references/integration-patterns.md](./references/integration-patterns.md).

---

## Quick Start

1. **Inspect the `.glb` asset first** using the bundled analyzer script:
   ```bash
   node .agents/skills/integrate-3d-model/scripts/inspect-glb.mjs "3dmodels/<model-name>.glb"
   ```
2. **Classify the model** based on the script output and how it is used in the world:
   - **Category A — Instanced Foliage / Scatter (`ForestField.ts`, `GrassField.ts`):** Trees, bushes, grass patches/clumps, flowers, rocks.
   - **Category B — Interactive World Props (`TreasureManager.ts` or similar):** Chests, landmarks, shrines, campfires, collectibles.
   - **Category C — Skinned / Animated Characters (`DwarfCharacter.ts` or NPCs):** Player models, creatures, rigged characters.
3. **Apply the matching implementation template** from [references/integration-patterns.md](./references/integration-patterns.md).
4. **Verify compilation and asset stats** with `npm run build`.

---

## Utility Scripts

### `scripts/inspect-glb.mjs`

Parses binary `.glb` headers and glTF JSON chunks with zero external dependencies and outputs JSON diagnostics including vertex/triangle counts, normal/skin attribute flags, bone/animation channel counts, texture sizes in MB, and required optimization rules.

```bash
# Inspect all .glb files in 3dmodels/
node .agents/skills/integrate-3d-model/scripts/inspect-glb.mjs

# Inspect a specific .glb file
node .agents/skills/integrate-3d-model/scripts/inspect-glb.mjs "3dmodels/grass patch 3d model.glb"
```

---

## Mandatory Workflow

### Step 1: Audit the 3D Asset
Run [inspect-glb.mjs](./scripts/inspect-glb.mjs) on the target `.glb` file and check `triangles`, `hasNormals`, `hasSkinAttributes`, `animations`, and `requiredOptimizations`.

### Step 2: Enforce Category-Specific Performance Invariants

Read [references/integration-patterns.md](./references/integration-patterns.md) and enforce all rules for the asset's category:

#### If Category A (Instanced Foliage / Scatter)
1. **Close-Range GLB LOD Only (`dist <= 1.5`):**
   - If the `.glb` has `> 1,500` triangles, NEVER instance it across all chunks.
   - Restrict the `.glb` geometry and material to close-range chunks (`dist <= 1.5`, ~72 m radius).
   - For mid/far chunks (`dist > 1.5`), use a lightweight procedural fallback geometry (`< 250` triangles) or skip spawning if it is small ground clutter (like grass clumps/patches where `densityMultiplier < 0.9`).
   - Support in-place LOD switching (`setLOD(isNearLOD, castShadow)`) and decoupled grass updates (`TerrainChunk.updateGrass`) so crossing LOD boundaries never rebuilds the terrain mesh.
2. **Geometry Normalization & Attribute Hygiene:**
   - Bake `mesh.matrixWorld`, center X/Z at `0`, align base to `Y = 0`, and scale to target height in meters.
   - If used in `THREE.InstancedMesh`, strip unused skinning attributes: `geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight');`.
   - Guard normal computation: `if (!geo.attributes.normal) geo.computeVertexNormals();` (never recompute normals unconditionally on 20k+ vertex meshes on the main thread).
3. **$O(1)$ Bilinear Surface Placement (`ChunkSurfaceSampler`):**
   - Always accept `sampler?: ChunkSurfaceSampler` from `TerrainChunk` and query `sampler.sampleHeightAndNormal(lx, lz, normal)` and `sampler.sampleColor(lx, lz, color)` instead of calling `noise.getHeight()`, `noise.getNormal()`, or `noise.getSurfaceColor()`.
   - Check cheap early-outs (`normal.y` slope threshold and `wy < config.waterLevel` check) before computing instance matrices or colors.
4. **Frustum Culling & Shadow Budget:**
   - Assign an elevation-aware chunk bounding sphere computed from `sampler?.getElevationBounds?.()` (`centerY = (minH + maxH) * 0.5`, `radius = Math.sqrt(2 * halfSize * halfSize + halfY * halfY) + pad`) to every `THREE.InstancedMesh`, and set `matrixAutoUpdate = false`.
   - Ground clutter (`height < 1.5m`, e.g., grass clumps, grass patches, flowers) MUST have `castShadow = false` and `receiveShadow = false` (or `receiveShadow = true` only on low-poly procedural tufts).
   - Tall foliage (trees) MUST only enable `castShadow = true` when `dist <= 2.2`.
5. **Zero-Instance Disposal:**
   - If an `InstancedMesh` is allocated for `maxCount` before placement and `placedIdx === 0` after filtering, call `instancedMesh.dispose()` immediately. On chunk `dispose()`, remove the mesh from any active tracking `Set` and call `.dispose()`.

#### If Category B (World Props / Landmarks)
1. **Shared Module-Level Assets & Merged Static Parts:**
   - Cache all `BufferGeometry` and `Material` instances at module scope. Merge static sub-parts sharing a material into a single `BufferGeometry`.
   - Clone a material only when an individual prop instance enters a transient state that modifies material uniforms/opacity, and `.dispose()` that clone when finished.
2. **Chunk-Boundary Caching & Distance-Gated Updates:**
   - Cache `lastCenterCx` and `lastCenterCz` so prop spawning/unloading only runs when the player crosses a chunk boundary.
   - Gate per-frame cosmetic animations (e.g., pulsing rings, floating icons) behind `dSq < 45 * 45`.
   - Reuse pre-allocated vectors/result objects in `update()` and spatial queries.

#### If Category C (Skinned / Animated Characters)
1. **Keyframe Track Pruning:**
   - Filter every `THREE.AnimationClip`'s `.tracks` array at load time to remove `.scale` tracks and non-`Hips` `.position` tracks.
2. **Shadow & VFX Hygiene:**
   - Set `castShadow = true` and `receiveShadow = false` on high-poly `SkinnedMesh` children.
   - Toggle `visible = false` on any transparent VFX meshes (e.g., swim rings, dust effects) whenever their opacity is `0`.

### Step 3: Validate Build & Performance Invariants
1. Run `npm run build` (`tsc && vite build`) and confirm zero TypeScript or bundler errors.
2. Verify that `docs/algorithmic-improvements.md` remains accurate (update it if a new subsystem or LOD rule was added).

---

## Common Mistakes to Avoid

- **Spawning a 15k–40k triangle `.glb` across all 137 chunks (`renderRadius: 6`):** Always restrict high-poly `.glb` models to `dist <= 1.5` and cap per-chunk instance counts for ground clutter (`<= 16` per chunk).
- **Calling `noise.getNormal(wx, wz)` inside an instance placement loop:** `getNormal` runs 4× `getHeight()` calls (48 Simplex noise evaluations). Always use `sampler.sampleHeightAndNormal(lx, lz, normal)` from `TerrainChunk`.
- **Forgetting `instancedMesh.boundingSphere`:** `THREE.InstancedMesh` defaults its bounding sphere to a single instance at `[0, 0, 0]`, breaking frustum culling across a `48m × 48m` chunk.
- **Leaking unused `InstancedMesh` buffers:** If a chunk happens to be entirely underwater or on steep cliffs (`placedIdx === 0`), failing to call `mesh.dispose()` leaks GPU memory on every chunk load.
