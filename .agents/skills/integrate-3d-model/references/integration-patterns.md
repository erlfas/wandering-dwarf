# 3D Model Integration Code Patterns (`procedural-world`)

Use these exact reference patterns when integrating a new `.glb` model into the world so that all optimizations in `docs/algorithmic-improvements.md` are strictly preserved.

---

## Pattern A: Instanced Foliage / Environmental Assets (Trees, Bushes, Grass Patches, Rocks)

Use this pattern when a 3D model is scattered across terrain chunks via `THREE.InstancedMesh` (e.g., in `ForestField.ts` or `GrassField.ts`).

### Mandatory Rules
1. **Close-Range GLB LOD Only (`dist <= 1.5`) & Primary/Secondary Instance Partitioning:**
   - High-poly `.glb` models (> 1,500 triangles) MUST only be active on chunks within `dist <= 1.5` of the player.
   - Always maintain a low-poly procedural fallback geometry (< 250 triangles, e.g., 33-tri tall grass tuft or 160-tri pine) for mid/far chunks (`dist > 1.5`), and swap `instancedMesh.geometry` and `instancedMesh.material` in-place inside `setLOD(isNearLOD, castShadow)` without rebuilding the chunk.
   - For density-scaled foliage (`ChunkGrass`), partition `instanceMatrix` into a **primary prefix** (`0 .. primaryCount - 1`, 55% mid-LOD density) and a **secondary suffix** (`primaryCount .. totalCount - 1`, 45% near-LOD boost) so `setLOD()` toggles `instancedMesh.count = isNear ? totalCount : primaryCount` in $O(1)$ without reallocating buffers.
2. **Pre-Parse GLB Specular & Texture Stripping (`GLTFLoader` `beforeRoot` Plugin):**
   - Always register a `beforeRoot` plugin on `GLTFLoader` to strip `matDef.extensions.KHR_materials_specular`, `metallicRoughnessTexture`, `normalTexture`, and `occlusionTexture` before `GLTFLoader` decodes unused 2K PBR maps or instantiates expensive `MeshPhysicalMaterial` shaders.
3. **Strip Unused Skinning Attributes, Weld Unindexed/Split Vertices & Guard `computeVertexNormals()`:**
   - Static GLBs exported from 3D tools often include unused `skinIndex`/`skinWeight` attributes and split per-triangle vertices (like `pine tree 3d model.glb` with 39,784 verts for 18,926 tris). Always delete `skinIndex`/`skinWeight` and run `BufferGeometryUtils.mergeVertices(geo, 1e-4)` when vertex count is disproportionately high relative to triangle count.
   - Only call `geo.computeVertexNormals()` if `!geo.attributes.normal`.
   - In custom `DoubleSide` foliage wind shaders (`onBeforeCompile`), preserve the smooth vertex normal on backfaces (`vec3 vNormal = normal;`) instead of flipping normals via `gl_FrontFacing`, preventing dark backface banding.
4. **$O(1)$ Bilinear Surface Lookup (`ChunkSurfaceSampler`):**
   - Never call `noise.getHeight()`, `noise.getNormal()`, or `noise.getSurfaceColor()` per instance when `sampler?: ChunkSurfaceSampler` is passed from `TerrainChunk`. Use `sampler.sampleHeightAndNormal(lx, lz, normal)` and `sampler.sampleColor(lx, lz, color)`.
5. **Explicit Chunk `boundingSphere`:**
   - Always set `instancedMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, halfHeight, 0), size * 0.85);` so Three.js frustum culling works accurately across the chunk.
6. **Shadow & Dispose Discipline (`onBeforeShadow` / `onAfterShadow`):**
   - Ground clutter (`height < 1.5m`) should either disable `castShadow` or use a shadow-proxy `drawRange` inside `onBeforeShadow` / `onAfterShadow` (limiting `geometry.drawRange.count` to ~10% of triangles during the shadow pass).
   - Tall blockers (trees/huts/large boulders) MUST only enable `castShadow = true` when `dist <= 2.2`.
   - If an `InstancedMesh` is pre-allocated before a placement loop and `placedCount === 0`, you MUST call `mesh.dispose()` immediately to prevent GPU buffer leaks.

### Code Template
```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  // 0. Strip KHR_materials_specular and unused PBR maps before ImageBitmap decoding
  loader.register((parser) => ({
    name: 'strip-unused-pbr-maps',
    beforeRoot: async () => {
      const json = parser.json;
      if (Array.isArray(json.materials)) {
        for (const matDef of json.materials) {
          if (matDef.extensions) delete matDef.extensions.KHR_materials_specular;
          if (matDef.pbrMetallicRoughness) {
            delete matDef.pbrMetallicRoughness.metallicRoughnessTexture;
          }
          delete matDef.normalTexture;
          delete matDef.occlusionTexture;
        }
      }
    },
  }));

  loader.load(modelUrl, (gltf) => {
    gltf.scene.updateMatrixWorld(true);
    let foundMesh: THREE.Mesh | null = null;
    gltf.scene.traverse((obj) => {
      if (!foundMesh && obj instanceof THREE.Mesh) foundMesh = obj;
    });
    if (!foundMesh) return;
    const mesh = foundMesh as THREE.Mesh;

    let geo = mesh.geometry.clone();
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

    // 3. Guard computeVertexNormals() and weld split vertices if needed
    if (!geo.attributes.normal) {
      geo.computeVertexNormals();
    }
    geo = mergeVertices(geo, 1e-4);
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

Use this pattern when placing discrete interactive objects across chunks (like `TreasureManager.ts` and `LandmarkManager.ts`).

### Mandatory Rules
1. **Module-Level Shared Geometries & Materials:**
   - Never call `new THREE.MeshStandardMaterial(...)` or `new THREE.BoxGeometry(...)` inside a per-instance builder unless cached in a module-level singleton.
2. **Merge Static Sub-Meshes by Material:**
   - If a model or procedural prop consists of multiple static parts sharing a material, merge them once at startup (`mergeBufferGeometries`) to minimize draw calls per prop.
   - Clone a material ONLY when an individual instance transitions into an animated state that mutates material properties (e.g., fading `opacity`), and `.dispose()` that cloned material when the animation ends.
3. **$O(1)$ `ChunkManager` Surface Height & Normal Wiring:**
   - Pass `chunkManager.getSurfaceHeight` and `chunkManager.getSurfaceNormal` callbacks into prop/landmark/challenge managers so ground placement queries read directly from loaded chunk vertex buffers in $O(1)$ instead of evaluating `noise.getHeight()` / `noise.getNormal()`.
4. **Chunk-Boundary Spawn Caching (`lastCenterCx`, `lastCenterCz`):**
   - Never scan the $(2r+1)^2$ chunk grid every frame in `update()`. Only recompute `desiredKeys` and spawn/unload chunk props when `centerCx !== this.lastCenterCx || centerCz !== this.lastCenterCz`.
5. **Distance-Gated Per-Frame Animations & Zero Heap Allocations:**
   - Compute squared distance `dSq = dx * dx + dz * dz` first in `update()`, and only animate scales/rotations when `dSq < 45 * 45` so distant props do not dirty their world matrices every frame.
   - Reuse pre-allocated result objects and `THREE.Vector3` fields instead of allocating inside `update()` or query methods.

---

## Pattern C: Skinned & Animated Characters / NPCs / Creatures

Use this pattern when loading rigged `.glb` models with `THREE.SkinnedMesh` and `THREE.AnimationMixer` (like `DwarfCharacter.ts`).

### Mandatory Rules
1. **Pre-Parse Specular/PBR Map Stripping & Keyframe Track Pruning (`setupAnimations`):**
   - Strip `KHR_materials_specular` and unused PBR textures in a `GLTFLoader` `beforeRoot` plugin so character meshes use `MeshStandardMaterial` instead of `MeshPhysicalMaterial`.
   - 3D exporters bake `.position`, `.quaternion`, and `.scale` tracks for every bone in the skeleton (e.g., 65 bones × 3 = 195 tracks per clip), including 30 individual finger phalange bones.
   - Always filter `clip.tracks` on load and throttle steady-state `'idle'` mixer updates (~30 Hz):
     ```ts
     const FINGER_RE = /(Index|Middle|Ring|Pinky|Thumb)[1-4]/i;
     clip.tracks = clip.tracks.filter((track) => {
       if (track.name.endsWith('.scale')) return false;
       if (track.name.endsWith('.position') && !track.name.includes('Hips')) {
         return false;
       }
       if (FINGER_RE.test(track.name)) return false;
       return true;
     });
     ```
2. **Self-Shadow Guard & Matrix-Dirtying Epsilon Guard on Skinned Meshes:**
   - Set `obj.castShadow = true` and `obj.receiveShadow = false` on high-poly `SkinnedMesh` objects to avoid shadow acne and expensive per-fragment shadow filtering on the character.
   - Guard parent container rotations (`modelContainer.rotation.set(...)`) behind an epsilon check so the 65-bone `SkinnedMesh` hierarchy does not recalculate world matrices on frames where tilt is unchanged.
3. **Toggle `visible = false` on Conditional VFX Meshes & Particle Systems:**
   - Any auxiliary transparent meshes (water ripples, auras, dust rings) or `THREE.Points` emitters (`trailPoints`) MUST set `visible = false` and skip per-slot simulation loops when inactive (`activeParticleCount === 0` or `opacity === 0`) so Three.js excludes them from transparency sorting and draw calls.
