import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import oakModelUrl from '../../3dmodels/oak tree 3d model.glb?url';
import pineModelUrl from '../../3dmodels/pine tree 3d model.glb?url';
import hutModelUrl from '../../3dmodels/simple dwarven hut 3d model.glb?url';
import { WorldConfig } from './Config';
import { ChunkSurfaceSampler, GrassUniforms } from './GrassField';
import { createSeededRandom, TerrainNoise } from './TerrainNoise';

/**
 * Helper to bake vertex colors and optional vertical gradient onto a BufferGeometry part.
 */
function colorizeGeometry(
  geo: THREE.BufferGeometry,
  bottomColor: THREE.Color,
  topColor: THREE.Color,
  swayWeight: number
): THREE.BufferGeometry {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo.clone();
  nonIndexed.computeBoundingBox();
  const minY = nonIndexed.boundingBox!.min.y;
  const maxY = nonIndexed.boundingBox!.max.y;
  const spanY = Math.max(0.01, maxY - minY);

  const posAttr = nonIndexed.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const uvs = new Float32Array(posAttr.count * 2);
  const c = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const t = THREE.MathUtils.clamp((y - minY) / spanY, 0, 1);
    c.copy(bottomColor).lerp(topColor, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    // uv.y encodes how much this vertex sways in the wind (0 for lower trunk, higher for upper canopy)
    uvs[i * 2] = 0;
    uvs[i * 2 + 1] = swayWeight * (0.25 + 0.75 * t);
  }

  nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  nonIndexed.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return nonIndexed;
}

/**
 * Builds a stylized layered Pine / Spruce tree geometry (trunk + 5 tiered conifer skirts)
 * matching the tall evergreen conifers in the reference images.
 */
function createPineTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Sturdy tapered trunk
  const trunk = new THREE.CylinderGeometry(0.16, 0.34, 2.6, 8);
  trunk.translate(0, 1.2, 0);
  parts.push(
    colorizeGeometry(
      trunk,
      new THREE.Color(0x4a3221),
      new THREE.Color(0x63442d),
      0.02
    )
  );

  // 5 overlapping conifer foliage tiers from bottom to pointed top
  const tiers = [
    { radius: 2.05, height: 2.2, y: 2.5, bottom: 0x1f3d20, top: 0x38612b, sway: 0.25 },
    { radius: 1.75, height: 2.1, y: 3.8, bottom: 0x234423, top: 0x416d30, sway: 0.45 },
    { radius: 1.42, height: 1.95, y: 5.0, bottom: 0x284c26, top: 0x4b7a35, sway: 0.65 },
    { radius: 1.08, height: 1.8, y: 6.1, bottom: 0x2e552a, top: 0x56873b, sway: 0.85 },
    { radius: 0.72, height: 1.65, y: 7.1, bottom: 0x355f2e, top: 0x649642, sway: 1.0 },
  ];

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const cone = new THREE.ConeGeometry(t.radius, t.height, 9);
    cone.rotateY(i * 0.4);
    cone.translate(0, t.y, 0);
    parts.push(
      colorizeGeometry(
        cone,
        new THREE.Color(t.bottom),
        new THREE.Color(t.top),
        t.sway
      )
    );
  }

  const merged = mergeGeometries(parts, false);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds a stylized Broadleaf / Oak tree geometry (trunk + main branches + puffy multi-lobe canopy)
 * matching the rounded deciduous trees in the reference images.
 */
function createBroadleafTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const trunkColorBot = new THREE.Color(0x4d3624);
  const trunkColorTop = new THREE.Color(0x684b34);

  // Main trunk
  const trunk = new THREE.CylinderGeometry(0.24, 0.42, 2.9, 8);
  trunk.translate(0, 1.35, 0);
  parts.push(colorizeGeometry(trunk, trunkColorBot, trunkColorTop, 0.02));

  // Two angled boughs supporting the side canopy lobes
  const boughL = new THREE.CylinderGeometry(0.12, 0.2, 1.6, 6);
  boughL.rotateZ(0.55);
  boughL.translate(-0.55, 2.6, 0.1);
  parts.push(colorizeGeometry(boughL, trunkColorBot, trunkColorTop, 0.1));

  const boughR = new THREE.CylinderGeometry(0.12, 0.2, 1.5, 6);
  boughR.rotateZ(-0.5);
  boughR.rotateY(0.6);
  boughR.translate(0.5, 2.7, -0.2);
  parts.push(colorizeGeometry(boughR, trunkColorBot, trunkColorTop, 0.1));

  // Clustered puffy foliage lobes (icosahedrons with soft normals & sunlit top gradient)
  const lobes = [
    { x: 0.0, y: 4.5, z: 0.0, rx: 1.95, ry: 1.65, rz: 1.9, bot: 0x345925, top: 0x6d993b },
    { x: -1.15, y: 3.7, z: 0.4, rx: 1.45, ry: 1.25, rz: 1.4, bot: 0x2d4f21, top: 0x608b35 },
    { x: 1.1, y: 3.8, z: -0.35, rx: 1.4, ry: 1.25, rz: 1.45, bot: 0x2f5222, top: 0x648f37 },
    { x: 0.2, y: 3.6, z: 1.05, rx: 1.35, ry: 1.15, rz: 1.3, bot: 0x2d4e20, top: 0x5e8834 },
    { x: -0.3, y: 3.65, z: -1.0, rx: 1.35, ry: 1.2, rz: 1.35, bot: 0x2b4b1e, top: 0x5b8432 },
    { x: 0.0, y: 5.45, z: 0.05, rx: 1.35, ry: 1.15, rz: 1.35, bot: 0x416b2c, top: 0x7da942 },
  ];

  for (const l of lobes) {
    const sphere = new THREE.IcosahedronGeometry(1.0, 1);
    sphere.scale(l.rx, l.ry, l.rz);
    sphere.translate(l.x, l.y, l.z);
    parts.push(
      colorizeGeometry(
        sphere,
        new THREE.Color(l.bot),
        new THREE.Color(l.top),
        0.55
      )
    );
  }

  const merged = mergeGeometries(parts, false);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds a low-poly procedural fallback geometry (< 120 tris) for the Dwarven Wooden Hut
 * used in mid/far chunks (dist > 1.5), matching the silhouette and warm timber/stone colors
 * of `3dmodels/simple dwarven hut 3d model.glb`.
 */
function createDwarvenHutGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Stone foundation plinth
  const base = new THREE.CylinderGeometry(2.15, 2.28, 0.48, 8);
  base.translate(0, 0.24, 0);
  parts.push(
    colorizeGeometry(base, new THREE.Color(0x524d46), new THREE.Color(0x736c62), 0.0)
  );

  // 2. Sturdy octagonal timber walls
  const walls = new THREE.CylinderGeometry(1.92, 1.98, 1.82, 8);
  walls.translate(0, 1.35, 0);
  parts.push(
    colorizeGeometry(walls, new THREE.Color(0x593a22), new THREE.Color(0x7d5332), 0.0)
  );

  // 3. Pitched wooden shingle / mossy roof cone
  const roof = new THREE.ConeGeometry(2.48, 1.75, 8);
  roof.translate(0, 3.02, 0);
  parts.push(
    colorizeGeometry(roof, new THREE.Color(0x3d2818), new THREE.Color(0x63452b), 0.0)
  );

  // 4. Front timber doorway porch projection
  const porch = new THREE.BoxGeometry(0.96, 1.38, 0.68);
  porch.translate(0, 0.95, 1.82);
  parts.push(
    colorizeGeometry(porch, new THREE.Color(0x452c19), new THREE.Color(0x694528), 0.0)
  );

  // 5. Small stone chimney stack on the side of the roof
  const chimney = new THREE.BoxGeometry(0.44, 1.05, 0.44);
  chimney.translate(1.05, 3.15, -0.45);
  parts.push(
    colorizeGeometry(chimney, new THREE.Color(0x59534b), new THREE.Color(0x7a7368), 0.0)
  );

  const merged = mergeGeometries(parts, false);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds a small shoreline boulder + cattail reed cluster geometry for pond/river banks.
 */
function createShorelineRockGeometry(): THREE.BufferGeometry {
  const rock = new THREE.DodecahedronGeometry(0.65, 1);
  rock.scale(1.25, 0.72, 1.05);
  return colorizeGeometry(
    rock,
    new THREE.Color(0x59564f),
    new THREE.Color(0x7c7d6e), // Slightly mossy top
    0.0
  );
}

/**
 * Builds an embedded cluster of flat, weathered stepping stones and pebbles for the dirt track bed,
 * directly inspired by the rocky cobble patches in `art/forest_track.jpg` and `art/scene_3.jpg`.
 */
function createTrackCobbleClusterGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stones = [
    { x: 0.0, z: 0.0, rx: 0.28, ry: 0.075, rz: 0.22, rotY: 0.3, bot: 0x78654b, top: 0x9c968b },
    { x: 0.26, z: 0.14, rx: 0.18, ry: 0.06, rz: 0.15, rotY: 1.1, bot: 0x736047, top: 0x8e887e },
    { x: -0.22, z: 0.18, rx: 0.16, ry: 0.055, rz: 0.19, rotY: -0.7, bot: 0x756249, top: 0x969085 },
    { x: 0.12, z: -0.22, rx: 0.11, ry: 0.045, rz: 0.09, rotY: 0.5, bot: 0x705d44, top: 0x868178 },
    { x: -0.18, z: -0.14, rx: 0.09, ry: 0.04, rz: 0.08, rotY: 2.1, bot: 0x705d44, top: 0xa39d92 },
  ];

  for (const s of stones) {
    const stone = new THREE.DodecahedronGeometry(1.0, 0);
    stone.scale(s.rx, s.ry, s.rz);
    stone.rotateY(s.rotY);
    stone.translate(s.x, s.ry * 0.35, s.z);
    parts.push(
      colorizeGeometry(
        stone,
        new THREE.Color(s.bot),
        new THREE.Color(s.top),
        0.0
      )
    );
  }

  const merged = mergeGeometries(parts, false);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds a gnarled exposed tree root & fallen leaf cluster that creeps across the earthen banks
 * of the forest track, matching the twisted roots in `art/forest_track.jpg` and `art/scene_3.jpg`.
 */
function createTrackRootsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const barkDark = new THREE.Color(0x4a311d);
  const barkLight = new THREE.Color(0x7c593a);

  // Main gnarled root emerging from the grassy shoulder bank
  const mainRoot = new THREE.CylinderGeometry(0.048, 0.085, 0.62, 6);
  mainRoot.rotateX(Math.PI * 0.47);
  mainRoot.rotateY(0.12);
  mainRoot.translate(0, 0.05, -0.22);
  parts.push(colorizeGeometry(mainRoot, barkDark, barkLight, 0.0));

  // Center crooked tendril reaching onto the track edge
  const midTendril = new THREE.CylinderGeometry(0.018, 0.048, 0.58, 5);
  midTendril.rotateX(Math.PI * 0.52);
  midTendril.rotateY(-0.18);
  midTendril.translate(0.03, 0.025, 0.28);
  parts.push(colorizeGeometry(midTendril, barkDark, barkLight, 0.0));

  // Left forked root tendril
  const leftTendril = new THREE.CylinderGeometry(0.015, 0.042, 0.52, 5);
  leftTendril.rotateX(Math.PI * 0.51);
  leftTendril.rotateY(0.48);
  leftTendril.translate(-0.16, 0.028, 0.16);
  parts.push(colorizeGeometry(leftTendril, barkDark, barkLight, 0.0));

  // Right forked root tendril
  const rightTendril = new THREE.CylinderGeometry(0.014, 0.038, 0.46, 5);
  rightTendril.rotateX(Math.PI * 0.52);
  rightTendril.rotateY(-0.55);
  rightTendril.translate(0.18, 0.024, 0.12);
  parts.push(colorizeGeometry(rightTendril, barkDark, barkLight, 0.0));

  // Two small fallen dry autumn leaves nestled against the roots (as seen in art/forest_track.jpg)
  const leafColorBot = new THREE.Color(0x6e4726);
  const leafColorTop = new THREE.Color(0x9e6f3e);
  const leaf1 = new THREE.ConeGeometry(0.065, 0.02, 4);
  leaf1.scale(1.4, 0.4, 0.85);
  leaf1.rotateY(0.8);
  leaf1.translate(-0.12, 0.02, -0.05);
  parts.push(colorizeGeometry(leaf1, leafColorBot, leafColorTop, 0.0));

  const leaf2 = new THREE.ConeGeometry(0.055, 0.02, 4);
  leaf2.scale(1.3, 0.4, 0.8);
  leaf2.rotateY(-0.5);
  leaf2.translate(0.14, 0.02, -0.08);
  parts.push(colorizeGeometry(leaf2, leafColorBot, leafColorTop, 0.0));

  const merged = mergeGeometries(parts, false);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds a stylized 3D woodland fern rosette with 8 arching, diamond-tapered fronds
 * matching the lush green ferns framing the track in `art/forest_track.jpg`.
 */
function createWoodlandFernGeometry(): THREE.BufferGeometry {
  const frondCount = 8;
  const segs = 4;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];

  const colBase = new THREE.Color(0x294a1c);
  const colMid = new THREE.Color(0x4f802d);
  const colTip = new THREE.Color(0x74a842);
  const c = new THREE.Color();

  for (let f = 0; f < frondCount; f++) {
    const isInner = f % 2 === 1;
    const angle = (f / frondCount) * Math.PI * 2 + (isInner ? 0.18 : -0.1);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const frondLen = isInner ? 0.48 : 0.62;
    const archHeight = isInner ? 0.36 : 0.28;
    const maxHalfW = isInner ? 0.11 : 0.145;

    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;

      const r0 = 0.03 + t0 * frondLen;
      const r1 = 0.03 + t1 * frondLen;

      // Arch upward then curve gracefully outward toward the frond tip
      const y0 = Math.sin(t0 * Math.PI * 0.78) * archHeight * (1.0 - t0 * 0.22);
      const y1 = Math.sin(t1 * Math.PI * 0.78) * archHeight * (1.0 - t1 * 0.22);

      // Serrated fern-pinnae silhouette profile (widest at t ~ 0.45, tapering to a point at t = 1)
      const w0 = Math.sin(Math.pow(t0, 0.7) * Math.PI) * maxHalfW;
      const w1 = s === segs - 1 ? 0.005 : Math.sin(Math.pow(t1, 0.7) * Math.PI) * maxHalfW;

      const lx0 = r0 * cosA - w0 * sinA;
      const lz0 = r0 * sinA + w0 * cosA;
      const rx0 = r0 * cosA + w0 * sinA;
      const rz0 = r0 * sinA - w0 * cosA;

      const lx1 = r1 * cosA - w1 * sinA;
      const lz1 = r1 * sinA + w1 * cosA;
      const rx1 = r1 * cosA + w1 * sinA;
      const rz1 = r1 * sinA - w1 * cosA;

      // Two triangles per frond segment
      positions.push(
        lx0, y0, lz0,
        rx0, y0, rz0,
        lx1, y1, lz1,
        rx0, y0, rz0,
        rx1, y1, rz1,
        lx1, y1, lz1
      );

      for (let v = 0; v < 6; v++) {
        normals.push(cosA * 0.25, 0.94, sinA * 0.25);
      }

      const ts = [t0, t0, t1, t0, t1, t1];
      for (const tv of ts) {
        if (tv < 0.5) {
          c.copy(colBase).lerp(colMid, tv * 2.0);
        } else {
          c.copy(colMid).lerp(colTip, (tv - 0.5) * 2.0);
        }
        colors.push(c.r, c.g, c.b);
        uvs.push(0, tv * 0.55); // Gentle wind rustle on fern frond tips
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Enhances any MeshStandardMaterial (either textured GLB pine material or vertex-colored tree material)
 * with realistic multi-layered wind sway & branch flutter shaders, plus depth shadow support.
 */
export function applyWindShaderToMaterial(
  mat: THREE.MeshStandardMaterial,
  uniforms: GrassUniforms,
  useHeightAndRadiusWeights = false
): void {
  const injectWind = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;

    shader.vertexShader =
      `
      uniform float uTime;
      uniform float uWindSpeed;
      uniform float uWindStrength;
      ` + shader.vertexShader;

    if (useHeightAndRadiusWeights) {
      // 3D Modelled Pine Tree: organic trunk bending + sweeping wind gusts + branch-tip needle flutter
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vec4 instWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

        // Normalized height (0 at roots -> 1 at 8m treetop) and radial distance from trunk center
        float hNorm = clamp(transformed.y / 8.0, 0.0, 1.0);
        float radialDist = length(transformed.xz);
        float branchFactor = smoothstep(0.18, 1.6, radialDist) * smoothstep(0.08, 0.35, hNorm);

        // Primary rolling wind wave across the forest + secondary gust harmonic
        float windTime = uTime * uWindSpeed;
        float treePhase = instWorld.x * 0.07 + instWorld.z * 0.06 + windTime * 0.75;
        float primaryGust = sin(treePhase) + 0.45 * cos(treePhase * 0.65 - 0.8);

        // Smooth non-linear trunk & canopy bend (anchored solidly at the base)
        float trunkBend = pow(hNorm, 1.65);
        float swayX = primaryGust * uWindStrength * 0.85 * trunkBend;
        float swayZ = cos(treePhase * 0.82) * uWindStrength * 0.6 * trunkBend;

        // High-frequency branch bough & pine needle flutter on outer foliage
        float branchPhase = windTime * 2.3 + transformed.y * 2.1 + (transformed.x + transformed.z) * 2.4 + instWorld.x * 0.25;
        float flutterX = sin(branchPhase) * uWindStrength * 0.26 * branchFactor;
        float flutterY = cos(branchPhase * 1.15) * uWindStrength * 0.16 * branchFactor;
        float flutterZ = sin(branchPhase * 0.9 + 1.2) * uWindStrength * 0.26 * branchFactor;

        transformed.x += swayX + flutterX;
        transformed.y += flutterY - (abs(swayX) + abs(swayZ)) * 0.08 * trunkBend;
        transformed.z += swayZ + flutterZ;
        `
      );
    } else {
      // Procedural broadleaf / rock geometry using uv.y sway weight
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vec4 instWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float swayWeight = uv.y;
        float treePhase = instWorld.x * 0.08 + instWorld.z * 0.07 + uTime * uWindSpeed * 0.65;
        transformed.x += sin(treePhase) * uWindStrength * 0.45 * swayWeight;
        transformed.z += cos(treePhase * 0.85) * uWindStrength * 0.35 * swayWeight;
        `
      );
    }
  };

  const injectDepthWind = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;

    shader.vertexShader =
      `
      uniform float uTime;
      uniform float uWindSpeed;
      uniform float uWindStrength;
      ` + shader.vertexShader;

    if (useHeightAndRadiusWeights) {
      // Lightweight trunk-only bend for the shadow depth pass (skips per-needle trig flutter)
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vec4 instWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float hNorm = clamp(transformed.y / 8.0, 0.0, 1.0);
        float trunkBend = hNorm * hNorm;
        float treePhase = instWorld.x * 0.07 + instWorld.z * 0.06 + uTime * uWindSpeed * 0.75;
        transformed.x += sin(treePhase) * uWindStrength * 0.85 * trunkBend;
        transformed.z += cos(treePhase * 0.82) * uWindStrength * 0.6 * trunkBend;
        `
      );
    } else {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vec4 instWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float swayWeight = uv.y;
        float treePhase = instWorld.x * 0.08 + instWorld.z * 0.07 + uTime * uWindSpeed * 0.65;
        transformed.x += sin(treePhase) * uWindStrength * 0.45 * swayWeight;
        transformed.z += cos(treePhase * 0.85) * uWindStrength * 0.35 * swayWeight;
        `
      );
    }
  };

  const cacheKey = `tree_wind_${useHeightAndRadiusWeights ? 'glb' : 'proc'}`;
  mat.customProgramCacheKey = () => cacheKey;
  mat.onBeforeCompile = injectWind;

  // Custom depth material so dynamic shadows cast on the ground sway in the wind too
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  depthMat.customProgramCacheKey = () => `${cacheKey}_depth`;
  depthMat.onBeforeCompile = injectDepthWind;
  (mat as THREE.MeshStandardMaterial & { customDepthMaterial?: THREE.MeshDepthMaterial }).customDepthMaterial =
    depthMat;
  mat.needsUpdate = true;
}

/**
 * Shared tree material with gentle canopy wind sway (used for broadleaf trees & shoreline boulders).
 */
export function createTreeMaterial(uniforms: GrassUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.02,
  });

  applyWindShaderToMaterial(mat, uniforms, false);
  return mat;
}

let fallbackPineGeo: THREE.BufferGeometry | null = null;
let sharedPineGeo: THREE.BufferGeometry | null = null;
let sharedPineMat: THREE.MeshStandardMaterial | null = null;
let pineLoadStarted = false;
const activePineMeshes = new Set<THREE.InstancedMesh>();

/**
 * Asynchronously loads `3dmodels/pine tree 3d model.glb`, normalizes its transform and scale
 * to ~8.0m tall with roots at Y=0, applies the wind shader to its PBR material, and upgrades
 * all active near-LOD pine InstancedMeshes across the world.
 */
export function loadPineTreeModel(uniforms: GrassUniforms): void {
  if (pineLoadStarted) return;
  pineLoadStarted = true;

  const loader = new GLTFLoader();
  loader.load(
    pineModelUrl,
    (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      let foundMesh: THREE.Mesh | null = null;
      gltf.scene.traverse((obj) => {
        if (!foundMesh && obj instanceof THREE.Mesh) {
          foundMesh = obj;
        }
      });

      if (!foundMesh) return;
      const mesh = foundMesh as THREE.Mesh;

      // Clone geometry and bake the GLTF node hierarchy transform so it stands upright (Y-up)
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);

      // Strip skinning attributes from the static instanced mesh so Three.js renders it directly
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');

      // Normalize bounding box: center X/Z at 0, place root base at Y=0, and scale to 8.0m height
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const height = Math.max(0.01, box.max.y - box.min.y);
      const targetHeight = 8.2;
      const scaleFactor = targetHeight / height;

      geo.translate(-centerX, -box.min.y, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);
      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      // Extract the GLB's textured MeshStandardMaterial and enhance it with wind sway & shadow sway
      const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const pineMat = (origMat as THREE.MeshStandardMaterial).clone();
      pineMat.color.setHex(0xffffff); // Full brightness so baseColorTexture & instanceColor shine
      pineMat.roughness = 0.85;
      pineMat.metalness = 0.02;
      applyWindShaderToMaterial(pineMat, uniforms, true);

      sharedPineGeo = geo;
      sharedPineMat = pineMat;

      const customDepth = (
        pineMat as THREE.MeshStandardMaterial & { customDepthMaterial?: THREE.MeshDepthMaterial }
      ).customDepthMaterial;

      // Hot-swap all currently active near-LOD pine InstancedMeshes to the loaded 3D GLB model & material
      for (const inst of activePineMeshes) {
        inst.geometry = sharedPineGeo;
        inst.material = sharedPineMat;
        if (customDepth) {
          inst.customDepthMaterial = customDepth;
        }
      }
    },
    undefined,
    (err) => {
      console.error('Failed to load pine tree 3D model:', err);
    }
  );
}

let fallbackBroadleafGeo: THREE.BufferGeometry | null = null;
let sharedOakGeo: THREE.BufferGeometry | null = null;
let sharedOakMat: THREE.MeshStandardMaterial | null = null;
let oakLoadStarted = false;
const activeBroadleafMeshes = new Set<THREE.InstancedMesh>();

/**
 * Asynchronously loads `3dmodels/oak tree 3d model.glb`, normalizes its transform and scale
 * to ~6.6m tall with roots at Y=0, applies the wind shader to its PBR material, and upgrades
 * all active near-LOD broadleaf/oak InstancedMeshes across the world.
 */
export function loadOakTreeModel(uniforms: GrassUniforms): void {
  if (oakLoadStarted) return;
  oakLoadStarted = true;

  const loader = new GLTFLoader();
  loader.load(
    oakModelUrl,
    (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      let foundMesh: THREE.Mesh | null = null;
      gltf.scene.traverse((obj) => {
        if (!foundMesh && obj instanceof THREE.Mesh) {
          foundMesh = obj;
        }
      });

      if (!foundMesh) return;
      const mesh = foundMesh as THREE.Mesh;

      // Clone geometry and bake the GLTF node hierarchy transform so it stands upright (Y-up)
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);

      // Strip skinning attributes from the static instanced mesh if present
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');

      // Normalize bounding box: center X/Z at 0, place root base at Y=0, and scale to 6.6m height
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const height = Math.max(0.01, box.max.y - box.min.y);
      const targetHeight = 6.6;
      const scaleFactor = targetHeight / height;

      geo.translate(-centerX, -box.min.y, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);
      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      // Extract the GLB's textured MeshStandardMaterial and enhance it with wind sway & shadow sway
      const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const oakMat = (origMat as THREE.MeshStandardMaterial).clone();
      oakMat.color.setHex(0xffffff); // Full brightness so baseColorTexture & instanceColor shine
      oakMat.roughness = 0.85;
      oakMat.metalness = 0.02;
      applyWindShaderToMaterial(oakMat, uniforms, true);

      sharedOakGeo = geo;
      sharedOakMat = oakMat;

      const customDepth = (
        oakMat as THREE.MeshStandardMaterial & { customDepthMaterial?: THREE.MeshDepthMaterial }
      ).customDepthMaterial;

      // Hot-swap all currently active near-LOD oak InstancedMeshes to the loaded 3D GLB model & material
      for (const inst of activeBroadleafMeshes) {
        inst.geometry = sharedOakGeo;
        inst.material = sharedOakMat;
        if (customDepth) {
          inst.customDepthMaterial = customDepth;
        }
      }
    },
    undefined,
    (err) => {
      console.error('Failed to load oak tree 3D model:', err);
    }
  );
}

let fallbackHutGeo: THREE.BufferGeometry | null = null;
let sharedHutGeo: THREE.BufferGeometry | null = null;
let sharedHutMat: THREE.MeshStandardMaterial | null = null;
let hutLoadStarted = false;
const activeHutMeshes = new Set<THREE.InstancedMesh>();

/**
 * Asynchronously loads `3dmodels/simple dwarven hut 3d model.glb`, normalizes its transform and scale
 * to ~3.85m tall with base at Y=0, and upgrades all active near-LOD dwarven hut InstancedMeshes.
 */
export function loadDwarvenHutModel(): void {
  if (hutLoadStarted) return;
  hutLoadStarted = true;

  const loader = new GLTFLoader();
  loader.load(
    hutModelUrl,
    (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      let foundMesh: THREE.Mesh | null = null;
      gltf.scene.traverse((obj) => {
        if (!foundMesh && obj instanceof THREE.Mesh) {
          foundMesh = obj;
        }
      });

      if (!foundMesh) return;
      const mesh = foundMesh as THREE.Mesh;

      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);

      // Strip unused skinning attributes if present
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');

      // Normalize bounding box: center X/Z at 0, place foundation base at Y=0, and scale to ~3.85m height
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;
      const height = Math.max(0.01, box.max.y - box.min.y);
      const targetHeight = 3.85;
      const scaleFactor = targetHeight / height;

      geo.translate(-centerX, -box.min.y, -centerZ);
      geo.scale(scaleFactor, scaleFactor, scaleFactor);
      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const hutMat = (origMat as THREE.MeshStandardMaterial).clone();
      hutMat.color.setHex(0xffffff);
      hutMat.roughness = 0.85;
      hutMat.metalness = 0.04;

      sharedHutGeo = geo;
      sharedHutMat = hutMat;

      // Hot-swap all currently active near-LOD dwarven hut InstancedMeshes
      for (const inst of activeHutMeshes) {
        inst.geometry = sharedHutGeo;
        inst.material = sharedHutMat;
      }
    },
    undefined,
    (err) => {
      console.error('Failed to load simple dwarven hut 3D model:', err);
    }
  );
}

let sharedRockGeo: THREE.BufferGeometry | null = null;
let sharedTrackCobbleGeo: THREE.BufferGeometry | null = null;
let sharedTrackRootsGeo: THREE.BufferGeometry | null = null;
let sharedFernGeo: THREE.BufferGeometry | null = null;
let sharedFernMat: THREE.MeshStandardMaterial | null = null;
let sharedStaticPropMat: THREE.MeshStandardMaterial | null = null;

const forestDummy = new THREE.Object3D();
const forestNormal = new THREE.Vector3();
const upVec = new THREE.Vector3(0, 1, 0);
const alignQuat = new THREE.Quaternion();
const yawQuat = new THREE.Quaternion();
const sharedTint = new THREE.Color();

// Pre-allocated scratch buffers for zero-allocation ChunkForest builds
const MAX_GRID_INST = 25;
const MAX_HUT_INST = 2;
const MAX_TRACK_INST = 96;
const pineMatBuf = new Float32Array(MAX_GRID_INST * 16);
const pineColBuf = new Float32Array(MAX_GRID_INST * 3);
const oakMatBuf = new Float32Array(MAX_GRID_INST * 16);
const oakColBuf = new Float32Array(MAX_GRID_INST * 3);
const hutMatBuf = new Float32Array(MAX_HUT_INST * 16);
const hutColBuf = new Float32Array(MAX_HUT_INST * 3);
const rockMatBuf = new Float32Array(MAX_GRID_INST * 16);
const rockColBuf = new Float32Array(MAX_GRID_INST * 3);
const cobbleMatBuf = new Float32Array(MAX_TRACK_INST * 16);
const cobbleColBuf = new Float32Array(MAX_TRACK_INST * 3);
const rootsMatBuf = new Float32Array(MAX_TRACK_INST * 16);
const rootsColBuf = new Float32Array(MAX_TRACK_INST * 3);
const fernMatBuf = new Float32Array(MAX_TRACK_INST * 16);
const fernColBuf = new Float32Array(MAX_TRACK_INST * 3);

function recordInstance(
  matBuf: Float32Array,
  colBuf: Float32Array,
  idx: number,
  matrix: THREE.Matrix4,
  color: THREE.Color
): void {
  matrix.toArray(matBuf, idx * 16);
  const cIdx = idx * 3;
  colBuf[cIdx] = color.r;
  colBuf[cIdx + 1] = color.g;
  colBuf[cIdx + 2] = color.b;
}

function populateInstancedMesh(
  mesh: THREE.InstancedMesh,
  matBuf: Float32Array,
  colBuf: Float32Array,
  count: number
): void {
  (mesh.instanceMatrix.array as Float32Array).set(matBuf.subarray(0, count * 16));
  mesh.instanceMatrix.needsUpdate = true;
  const colArray = new Float32Array(count * 3);
  colArray.set(colBuf.subarray(0, count * 3));
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colArray, 3);
}

export class ChunkForest {
  public readonly group = new THREE.Group();
  private pineInstanced?: THREE.InstancedMesh;
  private broadleafInstanced?: THREE.InstancedMesh;
  private hutInstanced?: THREE.InstancedMesh;
  private rockInstanced?: THREE.InstancedMesh;
  private cobbleInstanced?: THREE.InstancedMesh;
  private rootsInstanced?: THREE.InstancedMesh;
  private fernInstanced?: THREE.InstancedMesh;
  private treeMaterial: THREE.Material;
  private isNearLOD = false;

  constructor(
    cx: number,
    cz: number,
    size: number,
    config: WorldConfig,
    noise: TerrainNoise,
    treeMaterial: THREE.Material,
    isNearLOD = false,
    castShadow = false,
    sampler?: ChunkSurfaceSampler
  ) {
    this.group.matrixAutoUpdate = false;
    this.treeMaterial = treeMaterial;
    this.isNearLOD = isNearLOD;
    if (!fallbackPineGeo) fallbackPineGeo = createPineTreeGeometry();
    if (!fallbackBroadleafGeo) fallbackBroadleafGeo = createBroadleafTreeGeometry();
    if (!fallbackHutGeo) fallbackHutGeo = createDwarvenHutGeometry();
    if (!sharedRockGeo) sharedRockGeo = createShorelineRockGeometry();
    if (!sharedTrackCobbleGeo) sharedTrackCobbleGeo = createTrackCobbleClusterGeometry();
    if (!sharedTrackRootsGeo) sharedTrackRootsGeo = createTrackRootsGeometry();
    if (!sharedFernGeo) sharedFernGeo = createWoodlandFernGeometry();
    if (!sharedFernMat) {
      sharedFernMat = (treeMaterial as THREE.MeshStandardMaterial).clone();
      sharedFernMat.side = THREE.DoubleSide;
      sharedFernMat.roughness = 0.78;
      sharedFernMat.onBeforeCompile = (treeMaterial as THREE.MeshStandardMaterial).onBeforeCompile;
      sharedFernMat.customProgramCacheKey = () => 'tree_wind_proc_fern';
    }
    if (!sharedStaticPropMat) {
      sharedStaticPropMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.86,
        metalness: 0.02,
      });
    }

    // Use a 9.6m jittered grid (5x5 = 25 candidate cells per 48m chunk) so trees NEVER overlap
    // and always maintain airy spacing with open clearings.
    const gridSteps = 5;
    const cellSize = size / gridSteps;
    const maxCandidates = gridSteps * gridSteps;

    const chunkSeed = ((cx * 92837111) ^ (cz * 689287499) ^ (config.seed + 71)) >>> 0;
    const rng = createSeededRandom(chunkSeed);

    let pineCount = 0;
    let broadleafCount = 0;
    let hutCount = 0;
    let rockCount = 0;
    let cobbleCount = 0;
    let rootsCount = 0;
    let fernCount = 0;

    const worldOffsetX = cx * size;
    const worldOffsetZ = cz * size;
    const chunkHasTrack =
      config.enableTracks &&
      (sampler?.hasTrack
        ? sampler.hasTrack()
        : noise.getTrackDistance(worldOffsetX, worldOffsetZ) < size * 0.85);

    if (config.enableTrees) {
      for (let gz = 0; gz < gridSteps; gz++) {
        for (let gx = 0; gx < gridSteps; gx++) {
          // Jitter position inside the 9.6m cell while keeping buffer from cell edges
          const lx = -size / 2 + (gx + 0.18 + rng() * 0.64) * cellSize;
          const lz = -size / 2 + (gz + 0.18 + rng() * 0.64) * cellSize;
          const wx = worldOffsetX + lx;
          const wz = worldOffsetZ + lz;

          let wy: number;
          if (sampler) {
            wy = sampler.sampleHeightAndNormal(lx, lz, forestNormal);
          } else {
            wy = noise.getHeight(wx, wz);
            noise.getNormal(wx, wz, forestNormal);
          }

          // Check if right on a pond or river shoreline -> occasionally place a mossy shoreline boulder!
          const distAboveWater = wy - config.waterLevel;
          if (
            config.enableWater &&
            distAboveWater > -0.25 &&
            distAboveWater < 0.75 &&
            rng() < 0.28
          ) {
            forestDummy.position.set(lx, wy - 0.12, lz);
            forestDummy.rotation.set(
              (rng() - 0.5) * 0.3,
              rng() * Math.PI * 2,
              (rng() - 0.5) * 0.3
            );
            const rScale = 0.6 + rng() * 0.95;
            forestDummy.scale.set(rScale, rScale * (0.75 + rng() * 0.4), rScale);
            forestDummy.updateMatrix();
            sharedTint.setHex(0xffffff).offsetHSL(0, 0, (rng() - 0.5) * 0.12);
            recordInstance(rockMatBuf, rockColBuf, rockCount++, forestDummy.matrix, sharedTint);
            continue;
          }

          // Do not place trees in water, on wet shorelines, or on steep cliffs
          if (config.enableWater && distAboveWater < 1.25) continue;
          if (forestNormal.y < 0.78) continue;

          // Keep walking tracks completely clear of trees so dwarfs have an open path
          if (chunkHasTrack && noise.getTrackWeight(wx, wz, wy) > 0.16) continue;

          // Evaluate grove mask: 0 in open meadows, >0 in wooded groves
          const groveDensity = noise.getForestDensity(wx, wz);
          if (groveDensity <= 0.02) continue;

          // Keep groves airy and non-crowded using config.treeDensity
          const spawnChance = groveDensity * config.treeDensity * 0.75;
          if (rng() > spawnChance) continue;

          // Rare Dwarven Wooden Huts: only spawn inside dense wooded groves (where tree density is
          // much higher than typical elsewhere), on level dry ground, and capped at 1 hut per chunk.
          if (
            hutCount === 0 &&
            groveDensity >= 0.68 &&
            forestNormal.y >= 0.88 &&
            (!config.enableWater || distAboveWater >= 1.8) &&
            (!chunkHasTrack || noise.getTrackWeight(wx, wz, wy) <= 0.08) &&
            rng() < 0.055
          ) {
            const hutScale = (0.92 + rng() * 0.16) * config.treeScale;
            forestDummy.position.set(lx, wy - 0.16, lz);
            forestDummy.rotation.set(
              (rng() - 0.5) * 0.03,
              rng() * Math.PI * 2,
              (rng() - 0.5) * 0.03
            );
            forestDummy.scale.setScalar(hutScale);
            forestDummy.updateMatrix();

            sharedTint.setHex(0xffffff).offsetHSL(
              (rng() - 0.5) * 0.02,
              (rng() - 0.5) * 0.05,
              (rng() - 0.5) * 0.06
            );
            recordInstance(hutMatBuf, hutColBuf, hutCount++, forestDummy.matrix, sharedTint);
            continue;
          }

          // Trees near the edge of a grove are slightly smaller saplings; deeper grove trees are taller
          const groveScale = 0.68 + groveDensity * 0.42;
          const randomScale = (0.82 + rng() * 0.42) * groveScale * config.treeScale;

          forestDummy.position.set(lx, wy - 0.08, lz);
          forestDummy.rotation.set(
            (rng() - 0.5) * 0.06,
            rng() * Math.PI * 2,
            (rng() - 0.5) * 0.06
          );
          forestDummy.scale.setScalar(randomScale);
          forestDummy.updateMatrix();

          sharedTint.setHex(0xffffff).offsetHSL(
            (rng() - 0.5) * 0.035,
            (rng() - 0.5) * 0.08,
            (rng() - 0.5) * 0.08
          );

          // Mix conifers and broadleaf trees (more pines on higher slopes, more oaks in warm valleys)
          const pineBias = THREE.MathUtils.clamp(0.48 + (wy - config.waterLevel) * 0.008, 0.3, 0.75);
          if (rng() < pineBias) {
            recordInstance(pineMatBuf, pineColBuf, pineCount++, forestDummy.matrix, sharedTint);
          } else {
            recordInstance(oakMatBuf, oakColBuf, broadleafCount++, forestDummy.matrix, sharedTint);
          }
        }
      }
    }

    // Populate 3D Forest Track details (embedded cobble clusters, gnarled bank roots & woodland ferns)
    // Only evaluate on chunks that actually contain a track corridor
    if (chunkHasTrack) {
      const trackCandidates = 96;
      for (let i = 0; i < trackCandidates; i++) {
        const lx = (rng() - 0.5) * size;
        const lz = (rng() - 0.5) * size;
        const wx = worldOffsetX + lx;
        const wz = worldOffsetZ + lz;

        // Check track weight BEFORE computing surface normal & quaternion (~86% reject rate)
        const trackW = noise.getTrackWeight(wx, wz);
        if (trackW <= 0.03) continue;

        let wy: number;
        if (sampler) {
          wy = sampler.sampleHeightAndNormal(lx, lz, forestNormal);
        } else {
          wy = noise.getHeight(wx, wz);
          noise.getNormal(wx, wz, forestNormal);
        }

        if (config.enableWater && wy < config.waterLevel + 0.45) continue;
        if (forestNormal.y < 0.72) continue;

        alignQuat.setFromUnitVectors(upVec, forestNormal);

        // 1. Center & Rut Bed (trackW >= 0.48): Embedded flat cobbles & pebbles (matching art/forest_track.jpg)
        if (trackW >= 0.48) {
          const patch = noise.getMeadowPatch(wx * 2.1, wz * 2.1);
          // Cluster cobbles into natural stony sections along the path
          if (rng() < 0.25 + patch * 0.55) {
            forestDummy.position.set(lx, wy - 0.012, lz);
            yawQuat.setFromAxisAngle(upVec, rng() * Math.PI * 2);
            forestDummy.quaternion.copy(alignQuat).multiply(yawQuat);
            const cScale = 0.72 + rng() * 0.65;
            forestDummy.scale.set(cScale, cScale * (0.75 + rng() * 0.35), cScale);
            forestDummy.updateMatrix();
            sharedTint.setHex(0xffffff).offsetHSL(
              (rng() - 0.5) * 0.03,
              (rng() - 0.5) * 0.06,
              (rng() - 0.5) * 0.14
            );
            recordInstance(cobbleMatBuf, cobbleColBuf, cobbleCount++, forestDummy.matrix, sharedTint);
          }
        }
        // 2. Earthen Embankment / Verge Edge (0.20 <= trackW < 0.48): Gnarled exposed roots & woodland ferns
        else if (trackW >= 0.2) {
          const roll = rng();
          if (roll < 0.38) {
            // Orient gnarled root tendrils down the embankment slope toward the track bed (0 extra noise calls)
            const inwardAngle =
              Math.atan2(forestNormal.x, forestNormal.z) + (rng() - 0.5) * 0.55;

            forestDummy.position.set(lx, wy - 0.015, lz);
            yawQuat.setFromAxisAngle(upVec, inwardAngle);
            forestDummy.quaternion.copy(alignQuat).multiply(yawQuat);
            const rScale = 0.82 + rng() * 0.62;
            forestDummy.scale.setScalar(rScale);
            forestDummy.updateMatrix();
            sharedTint.setHex(0xffffff).offsetHSL(
              (rng() - 0.5) * 0.03,
              (rng() - 0.5) * 0.08,
              (rng() - 0.5) * 0.12
            );
            recordInstance(rootsMatBuf, rootsColBuf, rootsCount++, forestDummy.matrix, sharedTint);
          } else if (roll < 0.78) {
            // Lush woodland fern rosette framing the track shoulder
            forestDummy.position.set(lx, wy - 0.02, lz);
            yawQuat.setFromAxisAngle(upVec, rng() * Math.PI * 2);
            forestDummy.quaternion.copy(alignQuat).multiply(yawQuat);
            const fScale = 0.78 + rng() * 0.58;
            forestDummy.scale.setScalar(fScale);
            forestDummy.updateMatrix();
            sharedTint.setHex(0xffffff).offsetHSL(
              (rng() - 0.5) * 0.04,
              (rng() - 0.5) * 0.1,
              (rng() - 0.5) * 0.1
            );
            recordInstance(fernMatBuf, fernColBuf, fernCount++, forestDummy.matrix, sharedTint);
          }
        }
        // 3. Outer Grassy Shoulder (0.03 < trackW < 0.20): Additional border ferns
        else if (rng() < 0.42) {
          forestDummy.position.set(lx, wy - 0.02, lz);
          yawQuat.setFromAxisAngle(upVec, rng() * Math.PI * 2);
          forestDummy.quaternion.copy(alignQuat).multiply(yawQuat);
          const fScale = 0.72 + rng() * 0.62;
          forestDummy.scale.setScalar(fScale);
          forestDummy.updateMatrix();
          sharedTint.setHex(0xffffff).offsetHSL(
            (rng() - 0.5) * 0.04,
            (rng() - 0.5) * 0.1,
            (rng() - 0.5) * 0.1
          );
          recordInstance(fernMatBuf, fernColBuf, fernCount++, forestDummy.matrix, sharedTint);
        }
      }
    }

    const bounds = sampler?.getElevationBounds?.();
    const minH = bounds ? bounds.minH : -15;
    const maxH = bounds ? bounds.maxH + 9.5 : 45;
    const centerY = (minH + maxH) * 0.5;
    const halfY = (maxH - minH) * 0.5;
    const halfSize = size * 0.5;
    const radius = Math.sqrt(2 * halfSize * halfSize + halfY * halfY) + 3.5;
    const chunkBoundSphere = new THREE.Sphere(new THREE.Vector3(0, centerY, 0), radius);

    if (pineCount > 0 && pineCount <= maxCandidates) {
      const useHighPoly = isNearLOD && sharedPineGeo && sharedPineMat;
      const activeGeo = useHighPoly ? sharedPineGeo! : fallbackPineGeo;
      const activeMat = useHighPoly ? sharedPineMat! : treeMaterial;
      this.pineInstanced = new THREE.InstancedMesh(activeGeo, activeMat, pineCount);
      this.pineInstanced.castShadow = castShadow;
      this.pineInstanced.receiveShadow = true;
      this.pineInstanced.boundingSphere = chunkBoundSphere;
      this.pineInstanced.matrixAutoUpdate = false;
      const customDepth = (
        activeMat as THREE.MeshStandardMaterial & { customDepthMaterial?: THREE.MeshDepthMaterial }
      ).customDepthMaterial;
      if (customDepth) {
        this.pineInstanced.customDepthMaterial = customDepth;
      }
      populateInstancedMesh(this.pineInstanced, pineMatBuf, pineColBuf, pineCount);
      if (isNearLOD) {
        activePineMeshes.add(this.pineInstanced);
      }
      this.group.add(this.pineInstanced);
    }

    if (broadleafCount > 0 && broadleafCount <= maxCandidates) {
      const useHighPoly = isNearLOD && sharedOakGeo && sharedOakMat;
      const activeGeo = useHighPoly ? sharedOakGeo! : fallbackBroadleafGeo;
      const activeMat = useHighPoly ? sharedOakMat! : treeMaterial;
      this.broadleafInstanced = new THREE.InstancedMesh(activeGeo, activeMat, broadleafCount);
      this.broadleafInstanced.castShadow = castShadow;
      this.broadleafInstanced.receiveShadow = true;
      this.broadleafInstanced.boundingSphere = chunkBoundSphere;
      this.broadleafInstanced.matrixAutoUpdate = false;
      const customDepth = (
        activeMat as THREE.MeshStandardMaterial & { customDepthMaterial?: THREE.MeshDepthMaterial }
      ).customDepthMaterial;
      if (customDepth) {
        this.broadleafInstanced.customDepthMaterial = customDepth;
      }
      populateInstancedMesh(this.broadleafInstanced, oakMatBuf, oakColBuf, broadleafCount);
      if (isNearLOD) {
        activeBroadleafMeshes.add(this.broadleafInstanced);
      }
      this.group.add(this.broadleafInstanced);
    }

    if (hutCount > 0 && hutCount <= MAX_HUT_INST) {
      const useHighPoly = isNearLOD && sharedHutGeo && sharedHutMat;
      const activeGeo = useHighPoly ? sharedHutGeo! : fallbackHutGeo;
      const activeMat = useHighPoly ? sharedHutMat! : sharedStaticPropMat;
      this.hutInstanced = new THREE.InstancedMesh(activeGeo, activeMat, hutCount);
      this.hutInstanced.castShadow = castShadow;
      this.hutInstanced.receiveShadow = true;
      this.hutInstanced.boundingSphere = chunkBoundSphere;
      this.hutInstanced.matrixAutoUpdate = false;
      populateInstancedMesh(this.hutInstanced, hutMatBuf, hutColBuf, hutCount);
      if (isNearLOD) {
        activeHutMeshes.add(this.hutInstanced);
      }
      this.group.add(this.hutInstanced);
    }

    if (rockCount > 0) {
      this.rockInstanced = new THREE.InstancedMesh(
        sharedRockGeo,
        sharedStaticPropMat,
        rockCount
      );
      this.rockInstanced.castShadow = castShadow;
      this.rockInstanced.receiveShadow = true;
      this.rockInstanced.boundingSphere = chunkBoundSphere;
      this.rockInstanced.matrixAutoUpdate = false;
      populateInstancedMesh(this.rockInstanced, rockMatBuf, rockColBuf, rockCount);
      this.group.add(this.rockInstanced);
    }

    if (cobbleCount > 0) {
      this.cobbleInstanced = new THREE.InstancedMesh(
        sharedTrackCobbleGeo,
        sharedStaticPropMat,
        cobbleCount
      );
      this.cobbleInstanced.castShadow = false;
      this.cobbleInstanced.receiveShadow = true;
      this.cobbleInstanced.boundingSphere = chunkBoundSphere;
      this.cobbleInstanced.matrixAutoUpdate = false;
      populateInstancedMesh(this.cobbleInstanced, cobbleMatBuf, cobbleColBuf, cobbleCount);
      this.group.add(this.cobbleInstanced);
    }

    if (rootsCount > 0) {
      this.rootsInstanced = new THREE.InstancedMesh(
        sharedTrackRootsGeo,
        sharedStaticPropMat,
        rootsCount
      );
      this.rootsInstanced.castShadow = false;
      this.rootsInstanced.receiveShadow = true;
      this.rootsInstanced.boundingSphere = chunkBoundSphere;
      this.rootsInstanced.matrixAutoUpdate = false;
      populateInstancedMesh(this.rootsInstanced, rootsMatBuf, rootsColBuf, rootsCount);
      this.group.add(this.rootsInstanced);
    }

    if (fernCount > 0) {
      this.fernInstanced = new THREE.InstancedMesh(
        sharedFernGeo,
        sharedFernMat ?? treeMaterial,
        fernCount
      );
      this.fernInstanced.castShadow = false;
      this.fernInstanced.receiveShadow = true;
      this.fernInstanced.boundingSphere = chunkBoundSphere;
      this.fernInstanced.matrixAutoUpdate = false;
      populateInstancedMesh(this.fernInstanced, fernMatBuf, fernColBuf, fernCount);
      this.group.add(this.fernInstanced);
    }
  }

  public setLOD(isNearLOD: boolean, castShadow: boolean): void {
    const lodChanged = this.isNearLOD !== isNearLOD;
    this.isNearLOD = isNearLOD;

    if (this.pineInstanced) {
      this.pineInstanced.castShadow = castShadow;
      if (lodChanged) {
        if (isNearLOD) {
          activePineMeshes.add(this.pineInstanced);
          if (sharedPineGeo && sharedPineMat) {
            this.pineInstanced.geometry = sharedPineGeo;
            this.pineInstanced.material = sharedPineMat;
            const customDepth = (
              sharedPineMat as THREE.MeshStandardMaterial & {
                customDepthMaterial?: THREE.MeshDepthMaterial;
              }
            ).customDepthMaterial;
            if (customDepth) this.pineInstanced.customDepthMaterial = customDepth;
          }
        } else {
          activePineMeshes.delete(this.pineInstanced);
          if (fallbackPineGeo) {
            this.pineInstanced.geometry = fallbackPineGeo;
            this.pineInstanced.material = this.treeMaterial;
            const customDepth = (
              this.treeMaterial as THREE.MeshStandardMaterial & {
                customDepthMaterial?: THREE.MeshDepthMaterial;
              }
            ).customDepthMaterial;
            if (customDepth) this.pineInstanced.customDepthMaterial = customDepth;
          }
        }
      }
    }
    if (this.broadleafInstanced) {
      this.broadleafInstanced.castShadow = castShadow;
      if (lodChanged) {
        if (isNearLOD) {
          activeBroadleafMeshes.add(this.broadleafInstanced);
          if (sharedOakGeo && sharedOakMat) {
            this.broadleafInstanced.geometry = sharedOakGeo;
            this.broadleafInstanced.material = sharedOakMat;
            const customDepth = (
              sharedOakMat as THREE.MeshStandardMaterial & {
                customDepthMaterial?: THREE.MeshDepthMaterial;
              }
            ).customDepthMaterial;
            if (customDepth) this.broadleafInstanced.customDepthMaterial = customDepth;
          }
        } else {
          activeBroadleafMeshes.delete(this.broadleafInstanced);
          if (fallbackBroadleafGeo) {
            this.broadleafInstanced.geometry = fallbackBroadleafGeo;
            this.broadleafInstanced.material = this.treeMaterial;
            const customDepth = (
              this.treeMaterial as THREE.MeshStandardMaterial & {
                customDepthMaterial?: THREE.MeshDepthMaterial;
              }
            ).customDepthMaterial;
            if (customDepth) this.broadleafInstanced.customDepthMaterial = customDepth;
          }
        }
      }
    }
    if (this.hutInstanced) {
      this.hutInstanced.castShadow = castShadow;
      if (lodChanged) {
        if (isNearLOD) {
          activeHutMeshes.add(this.hutInstanced);
          if (sharedHutGeo && sharedHutMat) {
            this.hutInstanced.geometry = sharedHutGeo;
            this.hutInstanced.material = sharedHutMat;
          }
        } else {
          activeHutMeshes.delete(this.hutInstanced);
          if (fallbackHutGeo && sharedStaticPropMat) {
            this.hutInstanced.geometry = fallbackHutGeo;
            this.hutInstanced.material = sharedStaticPropMat;
          }
        }
      }
    }
    if (this.rockInstanced) {
      this.rockInstanced.castShadow = castShadow;
    }
  }

  public dispose(): void {
    if (this.pineInstanced) {
      activePineMeshes.delete(this.pineInstanced);
      this.pineInstanced.dispose();
    }
    if (this.broadleafInstanced) {
      activeBroadleafMeshes.delete(this.broadleafInstanced);
      this.broadleafInstanced.dispose();
    }
    if (this.hutInstanced) {
      activeHutMeshes.delete(this.hutInstanced);
      this.hutInstanced.dispose();
    }
    this.rockInstanced?.dispose();
    this.cobbleInstanced?.dispose();
    this.rootsInstanced?.dispose();
    this.fernInstanced?.dispose();
  }
}
