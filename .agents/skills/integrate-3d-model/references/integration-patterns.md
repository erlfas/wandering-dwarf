# 3D Model Integration Code Patterns (`procedural-world`)

Use these exact reference patterns when integrating a new `.glb` model into the world so that all optimizations in `docs/algorithmic-improvements.md` and `verify-3d-integrations.mjs` are strictly preserved.

---

## Pattern A: Instanced Foliage / Environmental Assets (Trees, Bushes, Grass Patches, Rocks)

Use this pattern when a 3D model is scattered across terrain chunks via `THREE.InstancedMesh` (e.g., in `ForestField.ts` or `GrassField.ts`).

### Mandatory Rules
1. **Close-Range GLB LOD Only (`dist <= 1.5`) & Primary/Secondary Instance Partitioning:**
   - High-poly `.glb` models (> 1,500 triangles) MUST only be active on chunks within `dist <= 1.5` of the player.
   - Always maintain a low-poly procedural fallback geometry (< 250 triangles, e.g., 33-tri tall grass tuft or 160-tri pine) for mid/far chunks (`dist > 1.5`), and swap `instancedMesh.geometry` and `instancedMesh.material` in-place inside `setLOD(isNearLOD, castShadow)` without rebuilding the chunk.
   - For density-scaled foliage (`ChunkGrass`), partition `instanceMatrix` into a **primary prefix** (`0 .. primaryCount - 1`, 55% mid-LOD density) and a **secondary suffix** (`primaryCount .. totalCount - 1`, 45% near-LOD boost) so `setLOD()` toggles `instancedMesh.count = isNear ? totalCount : primaryCount` in $O(1)$ without reallocating buffers.
2. **Always Load via `createOptimizedGlbLoader()` (`1024×1024` Downscale & Pre-Parse PBR Stripping):**
   - Never instantiate `new GLTFLoader()` directly. Import `createOptimizedGlbLoader()` from `src/world/ForestField.ts`, which strips `KHR_materials_specular`, `metallicRoughnessTexture`, `normalTexture`, and `occlusionTexture` in `beforeRoot` AND configures `ImageBitmapLoader` with `resizeWidth: 1024, resizeHeight: 1024` (saving ~146 MB RAM/VRAM per 4K model).
3. **Strip Unused Skinning Attributes, Guard `mergeVertices()` & Guard `computeVertexNormals()`:**
   - Always delete `skinIndex`/`skinWeight` on static meshes.
   - Only call `geo.computeVertexNormals()` if `!geo.attributes.normal`.
   - Only call `mergeVertices(geo, 1e-4)` if `!geo.index` (or on instanced foliage where UV-seam welding is specifically measured to reduce vertex count).
4. **$O(1)$ Bilinear Surface Lookup (`ChunkSurfaceSampler`):**
   - Never call `noise.getHeight()`, `noise.getNormal()`, or `noise.getSurfaceColor()` per instance when `sampler?: ChunkSurfaceSampler` is passed from `TerrainChunk`. Use `sampler.sampleHeightAndNormal(lx, lz, normal)` and `sampler.sampleColor(lx, lz, color)`.
5. **Explicit Chunk `boundingSphere` & Shadow Proxy Discipline:**
   - Always set `instancedMesh.boundingSphere` and `matrixAutoUpdate = false`.
   - Ground clutter (`height < 1.5m`) must disable `castShadow` or use a shadow-proxy `drawRange` inside `onBeforeShadow` / `onAfterShadow`.
   - Tall blockers (trees/huts/large boulders) MUST only enable `castShadow = true` when `dist <= 2.2`.
   - If `placedCount === 0`, call `mesh.dispose()` immediately to prevent GPU buffer leaks.

---

## Pattern B: Interactive World Props, Landmarks & Sub-Attachments (Castles, Turrets, Quarry Cranes, Stone Circles)

Use this pattern when placing discrete interactive objects or rooftop/sub-attachments across chunks (like `CastleAndQuarryManager.ts` and `LandmarkManager.ts`).

### Mandatory Rules
1. **Module-Level Shared Geometries & Materials + `if (!geo.index)` Guard:**
   - Load via `createOptimizedGlbLoader()`, cache `{ geo, mat }` in a module-level singleton, and ALWAYS guard `if (!geo.index)` before `mergeVertices(geo, 1e-4)` so 25k-vertex indexed GLBs do not stall the main thread.
2. **Tighter LOD (`dist <= 0.9` chunks) & `castShadow = false` on Rooftop / Secondary Sub-Attachments:**
   - Small high-poly sub-attachments (such as 19,970-triangle roof ballista turrets) MUST use a tighter close-range GLB LOD (`dist <= 0.9` chunks / `~43m`) than the parent building (`dist <= 2.2` chunks) and MUST set `castShadow = false` (saving ~80,000 shadow triangles per Tier III castle).
3. **Distance-Gated Per-Frame Animations & Group Visibility Culling:**
   - Compute squared distance `dSq = dx * dx + dz * dz` in `update()`, and only run idle rotations/sweeps (`turret.headGroup.updateMatrix()`) when `dSq <= nearBallistaDistSq` (`~43m`).
   - Group multi-slot construction meshes (e.g., 30 castle `slotMeshes`) under a parent `slotsGroup` and set `slotsGroup.visible = false` when covered by a completed `.glb` so Three.js skips traversing all child meshes in $O(1)$.

### Code Template (Prop / Sub-Attachment Singleton Loader)
```ts
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import propModelUrl from '../../3dmodels/my-prop.glb?url';
import { createOptimizedGlbLoader } from './ForestField';

let sharedPropGeo: THREE.BufferGeometry | null = null;
let sharedPropMat: THREE.MeshStandardMaterial | null = null;
let propLoadStarted = false;
const onPropLoadedCallbacks: Array<() => void> = [];

export function ensurePropModelLoaded(onLoaded?: () => void): void {
  if (sharedPropGeo && sharedPropMat) {
    onLoaded?.();
    return;
  }
  if (onLoaded) onPropLoadedCallbacks.push(onLoaded);
  if (propLoadStarted) return;
  propLoadStarted = true;

  const loader = createOptimizedGlbLoader();
  loader.load(propModelUrl, (gltf) => {
    gltf.scene.updateMatrixWorld(true);
    let foundMesh: THREE.Mesh | null = null;
    gltf.scene.traverse((obj) => {
      if (!foundMesh && obj instanceof THREE.Mesh) foundMesh = obj;
    });
    if (!foundMesh) return;
    const mesh = foundMesh as THREE.Mesh;

    let geo = mesh.geometry;
    geo.applyMatrix4(mesh.matrixWorld);
    geo.deleteAttribute('skinIndex');
    geo.deleteAttribute('skinWeight');

    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const centerX = (box.min.x + box.max.x) * 0.5;
    const centerZ = (box.min.z + box.max.z) * 0.5;
    const spanX = Math.max(0.01, box.max.x - box.min.x);
    const scaleFactor = TARGET_WIDTH / spanX;

    geo.translate(-centerX, -box.min.y, -centerZ);
    geo.scale(scaleFactor, scaleFactor, scaleFactor);

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
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    const origMat = (
      Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    ) as THREE.MeshStandardMaterial;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: origMat.map ?? null,
      roughness: 0.68,
      metalness: 0.22,
    });
    if (origMat.normalMap && origMat.normalMap !== origMat.map) origMat.normalMap.dispose();
    if (origMat.roughnessMap && origMat.roughnessMap !== origMat.map) origMat.roughnessMap.dispose();
    if (origMat.metalnessMap && origMat.metalnessMap !== origMat.map) origMat.metalnessMap.dispose();
    if (origMat.aoMap && origMat.aoMap !== origMat.map) origMat.aoMap.dispose();
    origMat.dispose();

    sharedPropGeo = geo;
    sharedPropMat = mat;
    for (const cb of onPropLoadedCallbacks) cb();
    onPropLoadedCallbacks.length = 0;
  });
}
```

---

## Pattern C: Skinned & Animated Characters / NPCs / Creatures

Use this pattern when loading rigged `.glb` models with `THREE.SkinnedMesh` and `THREE.AnimationMixer` (like `DwarfCharacter.ts` and `TrollCombatManager.ts`).

### Mandatory Rules
1. **Load via `createOptimizedGlbLoader()` & Prune Keyframe Tracks:**
   - Filter `clip.tracks` on load to remove `.scale` tracks, non-`Hips` `.position` tracks, and 30 finger phalange tracks (`/(Index|Middle|Ring|Pinky|Thumb)[1-4]/i`), and throttle steady-state `'idle'` mixer updates (~30 Hz).
2. **Self-Shadow Guard, Water Reflection Exclusion & Sanctuary Culling:**
   - Set `obj.castShadow = true` (gated to `<= 42m`) and `obj.receiveShadow = false` on high-poly `SkinnedMesh` objects.
   - Add the manager's `group` to `waterReflection.excludeFromReflection` in `src/main.ts` so the 512×512 planar water reflection pass skips 50k+ skinned triangles.
   - When `insideSanctuary` is `true` (player is inside a Castle or Hut and exterior groups are hidden), skip per-frame visual-only updates (`hpBarGroup.lookAt`, `hpFillMat.color`, `targetRingMesh.scale`).

---

## Pattern D: Cutaway Interior Stages & Indoor Station Props (`CastleInteriorManager.ts`, `HutManager.ts`)

Use this pattern when integrating enterable building interiors or indoor interactive stations (anvils, chests, hearths).

### Mandatory Rules
1. **Constant `NUM_POINT_LIGHTS === 1` Across Outdoor / Indoor Transitions:**
   - Never add more than **1 `THREE.PointLight`** inside an interior stage (`hearthLight`), and ensure `LivingWorldManager.setInsideInterior(inside)` sets `dwarfLanternLight.visible = !inside` (keeping `dwarfLanternLight.visible = true` with `intensity = 0` during outdoor daytime).
   - This keeps `NUM_POINT_LIGHTS === 1` on 100% of frames, eliminating synchronous WebGL shader recompilation stalls when entering or exiting buildings.
2. **Disable `castShadow` on Cutaway Room & Indoor Props + Force Shadow Map Refresh on Transition:**
   - Set `interiorMesh.castShadow = false` and `propMesh.castShadow = false` so cutaway ceilings/walls never cast shadows across the indoor floor or add 58k+ triangles to the shadow map.
   - In `src/main.ts`, detect `insideInterior !== wasInsideInterior` *after* interior updates and reset `lastShadowX = Number.NaN` so `dirLight.shadow.needsUpdate = true` immediately clears any frozen exterior castle/turret silhouettes from the shadow depth map.
3. **Proximity Preloading Outside + Clear `matrixWorldNeedsUpdate = false`:**
   - Preload the active interior `.glb` and indoor station `.glb`s when the player approaches within `~43m` outside (`ensureCastleInteriorModelLoaded(completedTier)` + `ensureCastleInteriorPropModelsLoaded()`), and never trigger concurrent `tier + 1` downloads on entry.
   - Whenever manually updating `mesh.matrixWorld.multiplyMatrices(this.interiorGroup.matrixWorld, mesh.matrix)`, immediately set `mesh.matrixWorldNeedsUpdate = false`.
