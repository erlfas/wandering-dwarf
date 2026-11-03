# 3D Model Integration Code Patterns (`procedural-world`)

Use these exact reference patterns when integrating a new `.glb` model into the world so that all optimizations in `docs/algorithmic-improvements.md` are strictly preserved.

---

## Pattern A: Instanced Foliage / Environmental Assets (Trees, Bushes, Grass Patches, Rocks)

Use this pattern when a 3D model is scattered across terrain chunks via `THREE.InstancedMesh` (e.g., in `ForestField.ts` or `GrassField.ts`).

### Mandatory Rules
1. **Close-Range GLB LOD Only (`dist <= 1.5`):**
   - High-poly `.glb` models (> 1,500 triangles) MUST only be active on chunks within `dist <= 1.5` of the player.
   - Always maintain a low-poly procedural fallback geometry (< 250 triangles) for mid/far chunks (`dist > 1.5`), and swap `instancedMesh.geometry` and `instancedMesh.material` in-place inside `setLOD(isNearLOD, castShadow)` without rebuilding the chunk.
2. **Strip Unused Skinning Attributes & Guard `computeVertexNormals()`:**
   - Static GLBs exported from 3D tools often include unused `skinIndex`/`skinWeight` attributes (like `pine tree 3d model.glb`). Always strip them.
   - Only call `geo.computeVertexNormals()` if `!geo.attributes.normal`.
3. **$O(1)$ Bilinear Surface Lookup (`ChunkSurfaceSampler`):**
   - Never call `noise.getHeight()`, `noise.getNormal()`, or `noise.getSurfaceColor()` per instance when `sampler?: ChunkSurfaceSampler` is passed from `TerrainChunk`. Use `sampler.sampleHeightAndNormal(lx, lz, normal)` and `sampler.sampleColor(lx, lz, color)`.
4. **Explicit Chunk `boundingSphere`:**
   - Always set `instancedMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, halfHeight, 0), size * 0.85);` so Three.js frustum culling works accurately across the chunk.
5. **Shadow & Dispose Discipline:**
   - Ground clutter (`height < 1.5m`, e.g., grass clumps/patches/flowers) MUST set `castShadow = false` and `receiveShadow = false` (or `receiveShadow = true` only on low-poly procedural tufts).
   - Tall blockers (trees/large boulders) MUST only enable `castShadow = true` when `dist <= 2.2`.
   - If an `InstancedMesh` is pre-allocated before a placement loop and `placedCount === 0`, you MUST call `mesh.dispose()` immediately to prevent GPU buffer leaks.

### Code Template
```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import modelUrl from '../../3dmodels/my-new-model.glb?url';

let fallbackGeo: THREE.BufferGeometry | null = null;
let sharedModelGeo: THREE.BufferGeometry | null = null;
let sharedModelMat: THREE.MeshStandardMaterial | null = null;
let modelLoadStarted = false;
const activeNearMeshes = new Set<THREE.InstancedMesh>();

export function loadMyNewModel(uniforms: GrassUniforms): void {
  if (modelLoadStarted) return;
  modelLoadStarted = true;

  const loader = new GLTFLoader();
  loader.load(modelUrl, (gltf) => {
    gltf.scene.updateMatrixWorld(true);
    let foundMesh: THREE.Mesh | null = null;
    gltf.scene.traverse((obj) => {
      if (!foundMesh && obj instanceof THREE.Mesh) foundMesh = obj;
    });
    if (!foundMesh) return;
    const mesh = foundMesh as THREE.Mesh;

    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);

    // 1. Strip unused skinning attributes if instanced statically
    geo.deleteAttribute('skinIndex');
    geo.deleteAttribute('skinWeight');

    // 2. Normalize pivot (center X/Z at 0, base at Y=0) and scale to target height
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const centerX = (box.min.x + box.max.x) * 0.5;
    const centerZ = (box.min.z + box.max.z) * 0.5;
    const height = Math.max(0.01, box.max.y - box.min.y);
    const scaleFactor = TARGET_HEIGHT / height;

    geo.translate(-centerX, -box.min.y, -centerZ);
    geo.scale(scaleFactor, scaleFactor, scaleFactor);

    // 3. Guard computeVertexNormals() — never recompute on 20k+ vert meshes if normals exist
    if (!geo.attributes.normal) {
      geo.computeVertexNormals();
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const mat = (origMat as THREE.MeshStandardMaterial).clone();
    mat.color.setHex(0xffffff);
    mat.roughness = 0.85;
    mat.metalness = 0.02;

    sharedModelGeo = geo;
    sharedModelMat = mat;

    // 4. Hot-swap only active close-range LOD meshes
    for (const inst of activeNearMeshes) {
      inst.geometry = sharedModelGeo;
      inst.material = sharedModelMat;
    }
  });
}
```

---

## Pattern B: Interactive World Props & Landmarks (Chests, Shrines, Bridges, Campfires)

Use this pattern when placing discrete interactive objects across chunks (like `TreasureManager.ts`).

### Mandatory Rules
1. **Module-Level Shared Geometries & Materials:**
   - Never call `new THREE.MeshStandardMaterial(...)` or `new THREE.BoxGeometry(...)` inside a per-instance builder unless cached in a module-level singleton.
2. **Merge Static Sub-Meshes by Material:**
   - If a model or procedural prop consists of multiple static parts sharing a material, merge them once at startup (`mergeBufferGeometries`) to minimize draw calls per prop.
   - Clone a material ONLY when an individual instance transitions into an animated state that mutates material properties (e.g., fading `opacity`), and `.dispose()` that cloned material when the animation ends.
3. **Chunk-Boundary Spawn Caching (`lastCenterCx`, `lastCenterCz`):**
   - Never scan the $(2r+1)^2$ chunk grid every frame in `update()`. Only recompute `desiredKeys` and spawn/unload chunk props when `centerCx !== this.lastCenterCx || centerCz !== this.lastCenterCz`.
4. **Distance-Gated Per-Frame Animations & Zero Heap Allocations:**
   - Compute squared distance `dSq = dx * dx + dz * dz` first in `update()`, and only animate scales/rotations when `dSq < 45 * 45` so distant props do not dirty their world matrices every frame.
   - Reuse pre-allocated result objects and `THREE.Vector3` fields instead of allocating inside `update()` or query methods.

---

## Pattern C: Skinned & Animated Characters / NPCs / Creatures

Use this pattern when loading rigged `.glb` models with `THREE.SkinnedMesh` and `THREE.AnimationMixer` (like `DwarfCharacter.ts`).

### Mandatory Rules
1. **Keyframe Track Pruning (`setupAnimations`):**
   - 3D exporters bake `.position`, `.quaternion`, and `.scale` tracks for every bone in the skeleton (e.g., 65 bones × 3 = 195 tracks per clip), even though non-root bone positions and all bone scales are constant.
   - Always filter `clip.tracks` on load:
     ```ts
     clip.tracks = clip.tracks.filter((track) => {
       if (track.name.endsWith('.scale')) return false;
       if (track.name.endsWith('.position') && !track.name.includes('Hips')) {
         return false;
       }
       return true;
     });
     ```
2. **Self-Shadow Guard on Skinned Meshes:**
   - Set `obj.castShadow = true` and `obj.receiveShadow = false` on high-poly `SkinnedMesh` objects to avoid shadow acne and expensive per-fragment shadow filtering on the character.
3. **Toggle `visible = false` on Conditional VFX Meshes:**
   - Any auxiliary transparent meshes (water ripples, auras, dust rings) MUST set `mesh.visible = false` when inactive (`opacity === 0`) so Three.js excludes them from transparency sorting and draw calls.
