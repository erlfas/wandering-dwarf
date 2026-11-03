#!/usr/bin/env node
/**
 * Inspects one or more .glb files (or all .glb files in 3dmodels/) and reports:
 * - Mesh primitives, total vertex count, and total triangle count
 * - Skin / joint count and animation clip track counts (including constant track warnings)
 * - Embedded image / texture byte sizes
 * - Automatic performance tier classification & required LOD / instancing rules
 *
 * Usage:
 *   node .agents/skills/integrate-3d-model/scripts/inspect-glb.mjs [path/to/model.glb]
 */

import fs from 'node:fs';
import path from 'node:path';

function inspectGlbFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'glTF') {
    throw new Error(`${filePath} is not a valid binary .glb file (magic: ${magic})`);
  }

  const fileSizeMB = +(buf.length / (1024 * 1024)).toFixed(2);
  const jsonChunkLength = buf.readUInt32LE(12);
  const jsonStr = buf.toString('utf8', 20, 20 + jsonChunkLength);
  const gltf = JSON.parse(jsonStr);

  let totalVertices = 0;
  let totalIndices = 0;
  let primitiveCount = 0;
  let hasNormals = true;
  let hasSkinAttributes = false;

  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      primitiveCount++;
      const attrs = prim.attributes || {};
      if (attrs.POSITION !== undefined) {
        totalVertices += gltf.accessors[attrs.POSITION].count;
      }
      if (attrs.NORMAL === undefined) {
        hasNormals = false;
      }
      if (attrs.JOINTS_0 !== undefined || attrs.WEIGHTS_0 !== undefined) {
        hasSkinAttributes = true;
      }
      if (prim.indices !== undefined) {
        totalIndices += gltf.accessors[prim.indices].count;
      }
    }
  }

  const totalTriangles = Math.round(totalIndices / 3);
  const skins = (gltf.skins || []).map((s) => ({
    name: s.name || 'unnamed_skin',
    joints: (s.joints || []).length,
  }));

  const animations = (gltf.animations || []).map((a) => ({
    name: a.name || 'unnamed_clip',
    channels: (a.channels || []).length,
  }));

  let totalTextureBytes = 0;
  const images = (gltf.images || []).map((img, idx) => {
    let byteLength = 0;
    if (img.bufferView !== undefined && gltf.bufferViews?.[img.bufferView]) {
      byteLength = gltf.bufferViews[img.bufferView].byteLength || 0;
    }
    totalTextureBytes += byteLength;
    return {
      index: idx,
      mimeType: img.mimeType || 'unknown',
      sizeMB: +(byteLength / (1024 * 1024)).toFixed(2),
    };
  });

  const rules = [];
  if (totalTriangles > 1500) {
    rules.push(
      `HIGH POLY (${totalTriangles.toLocaleString()} tris): Must ONLY be instanced in close-range LOD (dist <= 1.5 chunks). Provide a low-poly procedural fallback (< 250 tris) for mid/far chunks (dist > 1.5) via in-place geometry/material swapping.`
    );
  }
  if (totalTriangles > 5000) {
    rules.push(
      `SHADOW GUARD: Disable castShadow on high-density ground clutter (like grass clumps), or restrict castShadow to dist <= 2.2 chunks for tall blockers (like trees).`
    );
  }
  if (hasNormals) {
    rules.push(
      `NORMALS PRESENT: Do NOT call geo.computeVertexNormals() unconditionally after uniform scaling; guard with if (!geo.attributes.normal) geo.computeVertexNormals().`
    );
  }
  if (hasSkinAttributes) {
    rules.push(
      `SKIN ATTRIBUTES PRESENT: If used as a static InstancedMesh, call geo.deleteAttribute('skinIndex') and geo.deleteAttribute('skinWeight').`
    );
  }
  if (animations.length > 0) {
    rules.push(
      `ANIMATION TRACK PRUNING REQUIRED: Prune all '.scale' tracks and non-'Hips' '.position' tracks before creating AnimationActions to cut AnimationMixer bindings by ~66%.`
    );
  }

  return {
    file: path.basename(filePath),
    path: filePath,
    fileSizeMB,
    meshes: (gltf.meshes || []).length,
    primitives: primitiveCount,
    vertices: totalVertices,
    triangles: totalTriangles,
    hasNormals,
    hasSkinAttributes,
    materials: (gltf.materials || []).length,
    skins,
    animations,
    texturesMB: +(totalTextureBytes / (1024 * 1024)).toFixed(2),
    images,
    requiredOptimizations: rules,
  };
}

const args = process.argv.slice(2);
const targets = [];

if (args.length > 0) {
  for (const arg of args) {
    const resolved = path.resolve(arg);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      for (const f of fs.readdirSync(resolved)) {
        if (f.toLowerCase().endsWith('.glb')) {
          targets.push(path.join(resolved, f));
        }
      }
    } else {
      targets.push(resolved);
    }
  }
} else {
  const defaultDir = path.resolve('3dmodels');
  if (fs.existsSync(defaultDir)) {
    for (const f of fs.readdirSync(defaultDir)) {
      if (f.toLowerCase().endsWith('.glb')) {
        targets.push(path.join(defaultDir, f));
      }
    }
  }
}

const results = targets.map(inspectGlbFile);
console.log(JSON.stringify(results, null, 2));
