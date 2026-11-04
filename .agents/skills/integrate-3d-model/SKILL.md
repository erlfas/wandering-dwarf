---
name: integrate-3d-model
description: >-
  Integrates new 3D models (.glb/.gltf) into procedural-world while enforcing all
  algorithmic and rendering performance guarantees (createOptimizedGlbLoader 1024x1024
  texture downscaling, close-range GLB LODs, procedural fallbacks, indexed mergeVertices
  guards, constant NUM_POINT_LIGHTS=1 interior lighting, O(1) bilinear surface sampling,
  frustum bounding spheres, animation track pruning, shared geometries/materials, and GPU
  memory disposal). Activate this skill whenever the user asks to add, replace, load, or
  spawn a 3D model, .glb asset, foliage model, world prop, turret, interior stage, or
  animated character.
---

# Integrate 3D Model (`procedural-world`)

## Overview

This skill provides a strict, step-by-step workflow and automated diagnostic/verification scripts for adding or updating 3D models (`3dmodels/*.glb`) in `procedural-world` without introducing 4K texture VRAM crashes (`CONTEXT_LOST_WEBGL`), GPU triangle explosions, draw-call bottlenecks, main-thread `mergeVertices` stalls, or WebGL shader recompilation spikes.

All integrations MUST comply with the architectural invariants documented in [docs/algorithmic-improvements.md](../../../docs/algorithmic-improvements.md) and the code templates in [references/integration-patterns.md](./references/integration-patterns.md).

---

## Quick Start

1. **Inspect the `.glb` asset first** using the bundled analyzer script:
   ```bash
   node .agents/skills/integrate-3d-model/scripts/inspect-glb.mjs "3dmodels/<model-name>.glb"
   ```
2. **Classify the model** based on the script output and how it is used in the world:
   - **Category A — Instanced Foliage / Scatter (`ForestField.ts`, `GrassField.ts`):** Trees, bushes, grass patches/clumps, flowers, rocks.
   - **Category B — Interactive World Props & Sub-Attachments (`CastleAndQuarryManager.ts`, `LandmarkManager.ts`):** Castles, turrets/ballistae, quarry cranes/workbenches, stone circles, collectibles.
   - **Category C — Skinned / Animated Characters (`DwarfCharacter.ts`, `TrollCombatManager.ts`):** Player models, creatures, rigged characters.
   - **Category D — Cutaway Interior Stages & Indoor Station Props (`CastleInteriorManager.ts`, `HutManager.ts`):** Enterable building interiors, anvils, indoor chests, hearths.
3. **Apply the matching implementation template** from [references/integration-patterns.md](./references/integration-patterns.md).
4. **Verify static invariants and build** with `npm run build` (which automatically runs `tsc`, `verify-3d-integrations.mjs`, and `vite build`).

---

## Utility Scripts

### 1. `scripts/inspect-glb.mjs`

Parses binary `.glb` headers, glTF JSON chunks, and embedded PNG/JPEG headers with zero external dependencies and outputs JSON diagnostics including vertex/triangle counts, `isIndexed`, normal/skin attribute flags, bone/animation channel counts, texture dimensions (`4096x4096` vs `2048x2048`), uncompressed GPU VRAM cost (`uncompressedVramMB`), and required optimization rules.

```bash
# Inspect all .glb files in 3dmodels/
node .agents/skills/integrate-3d-model/scripts/inspect-glb.mjs

# Inspect a specific .glb file
node .agents/skills/integrate-3d-model/scripts/inspect-glb.mjs "3dmodels/heavy ballista 3d model.glb"
```

### 2. `scripts/verify-3d-integrations.mjs` (`npm run verify:3d`)

Automated static verifier (wired directly into `npm run build`) that scans all `src/**/*.ts` files and fails the build if any file:
- Instantiates `new GLTFLoader()` directly outside `createOptimizedGlbLoader()` in `src/world/ForestField.ts`.
- Removes `resizeWidth: 1024, resizeHeight: 1024` downscaling from `createOptimizedGlbLoader()`.
- Calls `mergeVertices(geo, ...)` unconditionally without `if (!geo.index)` in non-instanced prop/interior loaders.
- Instantiates more than 1 `THREE.PointLight` in an interior manager (`CastleInteriorManager.ts`, `HutManager.ts`), or sets `interiorMesh.castShadow = true`.

---

## Mandatory Universal Rules (All Categories)

1. **Always Use `createOptimizedGlbLoader()` (`1024×1024` Texture Downscale & PBR Map Stripping):**
   - Never call `new GLTFLoader()` directly. Always import `createOptimizedGlbLoader` from `src/world/ForestField.ts`.
   - Why: `.glb` assets in `3dmodels/` embed `4096×4096` baseColor JPEGs (`~89.4 MB` uncompressed GPU VRAM + `67.1 MB` `ImageBitmap` RAM = `~156.5 MB` per model) plus `6–8 MB` secondary PNG normal/roughness/AO maps. `createOptimizedGlbLoader()` strips secondary PBR maps and `KHR_materials_specular` in `beforeRoot` AND configures `ImageBitmapLoader` with `resizeWidth: 1024, resizeHeight: 1024`, reducing RAM/VRAM by **16× (`93.75%`, to `~9.8 MB` per model)** and preventing WebGL Out-Of-Memory crashes.
2. **Guard `mergeVertices` with `if (!geo.index)` and `computeVertexNormals` with `if (!geo.attributes.normal)`:**
   - Check `isIndexed` and `hasNormals` in `inspect-glb.mjs`.
   - Running `mergeVertices(geo, 1e-4)` unconditionally on an already-indexed 25,000-vertex `.glb` hashes 600,000+ strings on the main thread without reducing triangle count at all!
   - Always write:
     ```ts
     if (!geo.attributes.normal) {
       geo.computeVertexNormals();
     }
     if (!geo.index) {
       const welded = mergeVertices(geo, 1e-4);
       if (welded !== geo) {
         geo.dispose();
         geo = welded;
       }
     }
     ```

---

## Category-Specific Performance Invariants

### Category A (Instanced Foliage / Scatter)
1. **Close-Range GLB LOD Only (`dist <= 1.5`):**
   - Restrict `.glb` geometry (`> 1,500` tris) to close-range chunks (`dist <= 1.5`, ~72 m radius).
   - Use a `< 250`-triangle procedural fallback for mid/far chunks (`dist > 1.5`) via in-place `setLOD(isNearLOD, castShadow)`.
2. **$O(1)$ Bilinear Surface Placement (`ChunkSurfaceSampler`):**
   - Query `sampler.sampleHeightAndNormal(lx, lz, normal)` and `sampler.sampleColor(lx, lz, color)` instead of `noise.getHeight()` / `noise.getNormal()`.
3. **Frustum Culling & Shadow Budget:**
   - Assign an elevation-aware chunk bounding sphere to every `THREE.InstancedMesh` and set `matrixAutoUpdate = false`.
   - Ground clutter (`height < 1.5m`) MUST have `castShadow = false` (or use a low-poly `onBeforeShadow` shadow proxy slice). Tall foliage (trees) MUST only enable `castShadow = true` when `dist <= 2.2`.
4. **Zero-Instance Disposal:**
   - If `placedIdx === 0` after filtering, call `instancedMesh.dispose()` immediately.

### Category B (World Props, Landmarks & Sub-Attachments / Turrets)
1. **Shared Module-Level Assets & Merged Static Parts:**
   - Cache all `BufferGeometry` and `Material` instances at module scope.
2. **Tighter LOD & `castShadow = false` for Rooftop / Secondary Sub-Attachments (e.g. Turrets):**
   - While primary landmark buildings (e.g. Castles) use GLB LOD up to `dist <= 2.2` chunks, small attached sub-props (`1.5m` roof ballista turrets, workbenches) MUST use a tighter GLB LOD radius (`dist <= 0.9` chunks / `~43m` for turrets) and swap to a low-poly procedural fallback beyond that distance.
   - **Never enable `castShadow = true` on high-poly rooftop sub-attachments** (4× 19,970-tri ballista GLBs would add `79,880` triangles to the directional shadow map every frame for an imperceptible shadow on the roof).
3. **Distance-Gated Per-Frame Matrix Updates:**
   - Gate cosmetic/idle animations (e.g. idle turret sentinel sweep, rotating crane wheels, pulsing rings) behind `dSq <= nearLodDistSq` (`~43m–45m`). Never call `.updateMatrix()` every frame on props at `95m` when idle.

### Category C (Skinned / Animated Characters & Creatures)
1. **Keyframe Track Pruning:**
   - Filter every `THREE.AnimationClip`'s `.tracks` array at load time to remove `.scale` tracks, non-`Hips` `.position` tracks, and finger phalange tracks.
2. **Shadow, Reflection & Sanctuary Culling:**
   - Set `castShadow = true` (gated to `<= 42m`) and `receiveShadow = false` on high-poly `SkinnedMesh` children.
   - Add character/creature groups (`trollCombatManager.group`, `huntingManager.group`) to `waterReflection.excludeFromReflection` so the 512×512 planar water reflection pass never rasterizes 50k+ skinned triangles.
   - When the player is inside a building interior (`insideSanctuary === true` and exterior groups are hidden), skip per-frame visual-only work (`hpBarGroup.lookAt`, material color flashes, ring pulses).

### Category D (Cutaway Interior Stages & Indoor Station Props)
1. **Proximity Preloading Outside + No Concurrent Next-Tier Downloads on Entry:**
   - Preload the active interior `.glb` and its indoor station `.glb`s (e.g. Runic Anvil, Vault Chest) when the player approaches within `~43m` of an enterable building outside—never wait until the player presses `E` at the door to start 3–4 simultaneous 12 MB downloads.
   - Never trigger next-tier (`tier + 1`) `.glb` downloads inside `enterCastle()` while the current tier's interior is loading.
2. **Keep `NUM_POINT_LIGHTS === 1` Constant Across Outdoor / Indoor Transitions:**
   - In Three.js, changing the number of visible `THREE.PointLight`s in the scene changes the `NUM_POINT_LIGHTS` shader macro and forces synchronous GLSL recompilation across **every `MeshStandardMaterial`**.
   - Every interior manager (`CastleInteriorManager.ts`, `HutManager.ts`) MUST use **at most 1 `THREE.PointLight`** (a single warm central hearth/hall light), and `LivingWorldManager` must toggle `dwarfLanternLight.visible = !insideInterior` (keeping `dwarfLanternLight.visible = true` with `intensity = 0` during outdoor daytime) so `NUM_POINT_LIGHTS` remains `1` 100% of the time.
3. **Interior Shadow Map Hygiene (`castShadow = false` & Transition Invalidation):**
   - Set `castShadow = false` on cutaway `interiorMesh` and high-poly indoor station props (`anvilPropMesh`, `vaultChestPropMesh`) so cutaway walls/ceilings do not cast shadows across the indoor floor or add 58,000+ triangles to the shadow pass.
   - In `main.ts`, track `wasInsideInterior` after interior updates and reset `lastShadowX = Number.NaN` whenever `insideInterior` changes so the directional shadow map immediately refreshes without projecting frozen exterior building/turret silhouettes onto the interior floor.
4. **Manual `matrixWorld` Updates Must Clear `matrixWorldNeedsUpdate = false`:**
   - When manually computing `mesh.matrixWorld.multiplyMatrices(parent.matrixWorld, mesh.matrix)` on `matrixAutoUpdate = false` interior rings/flames, immediately set `mesh.matrixWorldNeedsUpdate = false` so Three.js does not multiply the matrices a second time during `renderer.render()`.

---

## Common Mistakes to Avoid

- **Using `new GLTFLoader()` instead of `createOptimizedGlbLoader()`:** Decodes full `4096×4096` textures (`156.5 MB` RAM+VRAM per model) and secondary PNG normal maps, crashing WebGL when multiple models load.
- **Calling `mergeVertices(geo, 1e-4)` unconditionally on indexed `.glb`s:** Freezes the main thread hashing 25,000 vertices × 8 attributes into strings without reducing triangle count. Always guard with `if (!geo.index)`.
- **Adding 2–3 `PointLight`s inside an interior stage:** Changes `NUM_POINT_LIGHTS` on entry/exit and causes a severe WebGL shader recompilation freeze.
- **Leaving `dirLight.shadow` frozen when hiding exterior groups on interior entry:** Projects giant ghost shadows of exterior castles and roof turrets across the indoor floor.
- **Enabling `castShadow = true` on 20k-triangle roof turrets or indoor props:** Adds 80,000+ shadow triangles per building for zero visual benefit.
