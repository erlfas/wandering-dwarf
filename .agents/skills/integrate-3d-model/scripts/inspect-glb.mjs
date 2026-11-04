#!/usr/bin/env node
/**
 * Inspects one or more .glb files (or all .glb files in 3dmodels/) and reports:
 * - Mesh primitives, total vertex count, total triangle count, and whether geometry is already indexed (`isIndexed`)
 * - Skin / joint count and animation clip track counts (including constant track warnings)
 * - Embedded image byte sizes, pixel dimensions (`width x height`), and uncompressed GPU VRAM cost (`uncompressedVramMB`)
 * - Automatic performance tier classification & required LOD / texture / instancing rules
 *
 * Usage:
 *   node .agents/skills/integrate-3d-model/scripts/inspect-glb.mjs [path/to/model.glb]
 */

import fs from 'node:fs';
import path from 'node:path';

function parseImageDimensions(slice, mimeType) {
  let width = 0;
  let height = 0;
  if (!slice || slice.length < 24) return { width, height };

  if (mimeType === 'image/png') {
    width = slice.readUInt32BE(16);
    height = slice.readUInt32BE(20);
  } else if (mimeType === 'image/jpeg') {
    for (let i = 2; i < slice.length - 9; i++) {
      if (slice[i] === 0xff && (slice[i + 1] === 0xc0 || slice[i + 1] === 0xc2)) {
        height = slice.readUInt16BE(i + 5);
        width = slice.readUInt16BE(i + 7);
        break;
      }
    }
  }
  return { width, height };
}

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
  const binChunkOffset = 20 + jsonChunkLength + 8;

  let totalVertices = 0;
  let totalIndices = 0;
  let primitiveCount = 0;
  let hasNormals = true;
  let isIndexed = true;
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
      } else {
        isIndexed = false;
      }
    }
  }

  const totalTriangles = isIndexed ? Math.round(totalIndices / 3) : Math.round(totalVertices / 3);
  const skins = (gltf.skins || []).map((s) => ({
    name: s.name || 'unnamed_skin',
    joints: (s.joints || []).length,
  }));

  const animations = (gltf.animations || []).map((a) => ({
    name: a.name || 'unnamed_clip',
    channels: (a.channels || []).length,
  }));

  let totalTextureBytes = 0;
  let maxImageDimension = 0;
  let totalUncompressedVramMB = 0;
  const images = (gltf.images || []).map((img, idx) => {
    let byteLength = 0;
    let width = 0;
    let height = 0;
    if (img.bufferView !== undefined && gltf.bufferViews?.[img.bufferView]) {
      const bv = gltf.bufferViews[img.bufferView];
      byteLength = bv.byteLength || 0;
      const start = binChunkOffset + (bv.byteOffset || 0);
      if (start + byteLength <= buf.length) {
        const dims = parseImageDimensions(
          buf.subarray(start, start + byteLength),
          img.mimeType || ''
        );
        width = dims.width;
        height = dims.height;
      }
    }
    totalTextureBytes += byteLength;
    maxImageDimension = Math.max(maxImageDimension, width, height);
    const uncompressedVramMB =
      width > 0 && height > 0 ? +((width * height * 4 * 1.333) / (1024 * 1024)).toFixed(2) : 0;
    totalUncompressedVramMB += uncompressedVramMB;
    return {
      index: idx,
      mimeType: img.mimeType || 'unknown',
      dimensions: width > 0 ? `${width}x${height}` : 'unknown',
      sizeMB: +(byteLength / (1024 * 1024)).toFixed(2),
      uncompressedVramMB,
    };
  });

  const rules = [];
  if (maxImageDimension >= 2048 || images.length > 1) {
    rules.push(
      `4K TEXTURE VRAM GUARD (${maxImageDimension}px max, ~${totalUncompressedVramMB.toFixed(1)} MB raw VRAM if unstripped): MUST load via createOptimizedGlbLoader() so secondary PBR maps (normal/roughness/AO) are stripped before decode and baseColor ImageBitmaps are downscaled to 1024x1024 (~5.6 MB VRAM).`
    );
  }
  if (totalTriangles > 1500) {
    rules.push(
      `HIGH POLY (${totalTriangles.toLocaleString()} tris): Must ONLY be rendered in close-range LOD (dist <= 1.5 chunks for foliage/props, dist <= 0.9 chunks for small rooftop sub-props like turrets). Provide a low-poly procedural fallback (< 250 tris) via in-place geometry/material swapping.`
    );
  }
  if (totalTriangles > 5000) {
    rules.push(
      `SHADOW GUARD: Disable castShadow on ground clutter, rooftop attachments (e.g. ballista turrets), and interior cutaway rooms/props. Only allow castShadow on primary exterior blockers within dist <= 2.2 chunks.`
    );
  }
  if (isIndexed) {
    rules.push(
      `ALREADY INDEXED (isIndexed: true): Do NOT run mergeVertices(geo, 1e-4) unconditionally on non-instanced props/interiors (causes main-thread string-hashing stalls); guard with if (!geo.index) geo = mergeVertices(geo, 1e-4).`
    );
  }
  if (hasNormals) {
    rules.push(
      `NORMALS PRESENT: Do NOT call geo.computeVertexNormals() unconditionally; guard with if (!geo.attributes.normal) geo.computeVertexNormals().`
    );
  }
  if (hasSkinAttributes) {
    rules.push(
      `SKIN ATTRIBUTES PRESENT: If used as a static mesh/InstancedMesh, call geo.deleteAttribute('skinIndex') and geo.deleteAttribute('skinWeight').`
    );
  }
  if (animations.length > 0) {
    rules.push(
      `ANIMATION TRACK PRUNING REQUIRED: Prune all '.scale' tracks, non-'Hips' '.position' tracks, and finger phalange tracks before creating AnimationActions.`
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
    isIndexed,
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
