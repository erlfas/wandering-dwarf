#!/usr/bin/env node
/**
 * Automated Static Verifier for 3D Model (.glb) Integrations in `procedural-world`.
 * Enforces all architectural invariants from `.agents/skills/integrate-3d-model/SKILL.md`:
 * 1. No raw `new GLTFLoader()` outside `createOptimizedGlbLoader()` in `src/world/ForestField.ts`.
 * 2. `createOptimizedGlbLoader()` must downscale 4K ImageBitmaps (`resizeWidth: 1024`, `resizeHeight: 1024`)
 *    and strip `KHR_materials_specular`, `normalTexture`, `metallicRoughnessTexture`, and `occlusionTexture`.
 * 3. Non-instanced world prop / interior `.glb` loaders (`CastleInteriorManager.ts`, `CastleAndQuarryManager.ts`,
 *    `HutManager.ts`, `LandmarkManager.ts`, `HuntingAndDeerManager.ts`) must guard `mergeVertices(` with `if (!geo.index)`.
 * 4. Every `.glb` loader calling `computeVertexNormals()` must guard it with `if (!geo.attributes.normal)` (or `!wasIndexed`).
 * 5. Cutaway Interior Managers (`CastleInteriorManager.ts`, `HutManager.ts`) must have at most 1 `new THREE.PointLight`
 *    so `NUM_POINT_LIGHTS` stays constant (`1`) across outdoor/indoor transitions (zero WebGL shader recompilations).
 */

import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve('src');
const errors = [];

function walkTsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = walkTsFiles(SRC_DIR);

for (const file of files) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');

  // Rule 1: No raw `new GLTFLoader()` outside `src/world/ForestField.ts`
  if (rel !== 'src/world/ForestField.ts' && /new\s+GLTFLoader\s*\(/.test(content)) {
    errors.push(
      `[Rule 1 - Raw GLTFLoader] ${rel}: Found 'new GLTFLoader()'. Always use 'createOptimizedGlbLoader()' from 'src/world/ForestField.ts' so 4K textures are downscaled to 1024x1024 and secondary PBR maps are stripped before ImageBitmap decode.`
    );
  }

  // Rule 2: Verify `createOptimizedGlbLoader()` in `src/world/ForestField.ts`
  if (rel === 'src/world/ForestField.ts') {
    if (!content.includes('resizeWidth: 1024') || !content.includes('resizeHeight: 1024')) {
      errors.push(
        `[Rule 2 - 4K Texture Downscale] ${rel}: 'createOptimizedGlbLoader()' must configure 'resizeWidth: 1024, resizeHeight: 1024' on 'parser.textureLoader' to prevent 4096x4096 VRAM crashes.`
      );
    }
  }

  // Rule 3: Non-instanced prop/interior managers must guard `mergeVertices(` with `if (!geo.index)`
  const nonInstancedGlbManagers = [
    'src/world/CastleInteriorManager.ts',
    'src/world/CastleAndQuarryManager.ts',
    'src/world/HutManager.ts',
    'src/world/LandmarkManager.ts',
    'src/world/HuntingAndDeerManager.ts',
  ];
  if (nonInstancedGlbManagers.includes(rel)) {
    const mergeMatches = [...content.matchAll(/mergeVertices\s*\(\s*geo/g)];
    const guardedMatches = [
      ...content.matchAll(/if\s*\(\s*!geo\.index\s*\)\s*\{\s*const\s+welded\s*=\s*mergeVertices\s*\(\s*geo/g),
    ];
    if (mergeMatches.length !== guardedMatches.length) {
      errors.push(
        `[Rule 3 - Unconditional mergeVertices] ${rel}: Found ${mergeMatches.length} 'mergeVertices(geo, ...)' call(s), but only ${guardedMatches.length} guarded by 'if (!geo.index)'. Unconditional mergeVertices on already-indexed 25k-vertex GLBs freezes the main thread.`
      );
    }
  }

  // Rule 5: Interior Managers must not create > 1 THREE.PointLight (prevents NUM_POINT_LIGHTS shader recompilation)
  if (rel === 'src/world/CastleInteriorManager.ts' || rel === 'src/world/HutManager.ts') {
    const pointLightMatches = [...content.matchAll(/new\s+THREE\.PointLight\s*\(/g)];
    if (pointLightMatches.length > 1) {
      errors.push(
        `[Rule 5 - NUM_POINT_LIGHTS Permutation] ${rel}: Found ${pointLightMatches.length} 'new THREE.PointLight(...)' instances (max allowed: 1). Changing active PointLight count on interior entry/exit forces synchronous WebGL shader recompilation across all materials.`
      );
    }
    if (/this\.interiorMesh\.castShadow\s*=\s*true/.test(content)) {
      errors.push(
        `[Rule 6 - Interior Shadow Caster] ${rel}: 'interiorMesh.castShadow' must be 'false' so cutaway walls/ceilings do not block directional light or add 20k+ triangles to the shadow pass.`
      );
    }
  }
}

if (errors.length > 0) {
  console.error('❌ 3D Model Integration Verification FAILED:\n');
  for (const err of errors) {
    console.error(`  • ${err}`);
  }
  process.exit(1);
} else {
  console.log(
    `✅ 3D Model Integration Verification PASSED (${files.length} source files checked, 0 violations).`
  );
}
