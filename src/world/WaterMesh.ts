import * as THREE from 'three';
import { WorldConfig } from './Config';
import { GrassUniforms } from './GrassField';

export interface WaterUniforms extends GrassUniforms {
  uReflectionMap: { value: THREE.Texture | null };
  uReflectionMatrix: { value: THREE.Matrix4 };
  uCameraPos: { value: THREE.Vector3 };
  uWaterLevel: { value: number };
  uReflectionActive: { value: number };
}

// Create a 1x1 fallback texture before the first reflection pass renders
function createFallbackReflectionTexture(): THREE.DataTexture {
  const data = new Uint8Array([180, 215, 235, 0]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Creates a shared stylized water material for ponds and meandering rivers.
 * Features gentle animated surface ripples, semi-transparent clarity so fish and riverbed pebbles
 * are visible beneath the surface, sunlit caustics, and real-time planar reflection so the dwarf
 * can see his own reflection in the water.
 */
export function createWaterMaterial(
  grassUniforms: GrassUniforms,
  waterLevel = -3.5
): { material: THREE.MeshStandardMaterial; waterUniforms: WaterUniforms } {
  const fallbackTex = createFallbackReflectionTexture();

  const waterUniforms: WaterUniforms = {
    ...grassUniforms,
    uReflectionMap: { value: fallbackTex },
    uReflectionMatrix: { value: new THREE.Matrix4() },
    uCameraPos: { value: new THREE.Vector3() },
    uWaterLevel: { value: waterLevel },
    uReflectionActive: { value: 0.0 },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x3a8ca8),
    roughness: 0.1,
    metalness: 0.08,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
  });

  mat.customProgramCacheKey = () => 'water_ripple_refl_v2';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.uniforms.uReflectionMap = waterUniforms.uReflectionMap;
    shader.uniforms.uReflectionMatrix = waterUniforms.uReflectionMatrix;
    shader.uniforms.uCameraPos = waterUniforms.uCameraPos;
    shader.uniforms.uWaterLevel = waterUniforms.uWaterLevel;
    shader.uniforms.uReflectionActive = waterUniforms.uReflectionActive;

    shader.vertexShader =
      `
      uniform float uTime;
      uniform mat4 uReflectionMatrix;
      uniform float uWaterLevel;
      varying vec3 vWaterWorldPos;
      varying vec4 vReflectCoord;
      varying vec2 vWaveSlope;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vec4 wp = modelMatrix * vec4(transformed, 1.0);
      vWaterWorldPos = wp.xyz;
      vReflectCoord = uReflectionMatrix * vec4(wp.x, uWaterLevel, wp.z, 1.0);

      // Multi-layered animated water ripples + analytical normal perturbation
      float phase1 = wp.x * 0.72 + wp.z * 0.52 + uTime * 1.65;
      float phase2 = wp.x * 0.48 - wp.z * 0.82 + uTime * 1.25;
      float phase3 = (wp.x - wp.z) * 1.35 - uTime * 2.1;
      float wave1 = sin(phase1) * 0.032;
      float wave2 = cos(phase2) * 0.024;
      float wave3 = sin(phase3) * 0.012;
      transformed.y += wave1 + wave2 + wave3;

      float dWaveDx = cos(phase1) * (0.032 * 0.72) - sin(phase2) * (0.024 * 0.48) + cos(phase3) * (0.012 * 1.35);
      float dWaveDz = cos(phase1) * (0.032 * 0.52) + sin(phase2) * (0.024 * 0.82) - cos(phase3) * (0.012 * 1.35);
      vWaveSlope = vec2(dWaveDx, dWaveDz);
      vNormal = normalize(mat3(viewMatrix) * vec3(-dWaveDx * 1.35, 1.0, -dWaveDz * 1.35));
      `
    );

    shader.fragmentShader =
      `
      uniform float uTime;
      uniform sampler2D uReflectionMap;
      uniform vec3 uCameraPos;
      uniform float uReflectionActive;
      varying vec3 vWaterWorldPos;
      varying vec4 vReflectCoord;
      varying vec2 vWaveSlope;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      // Animated dual-frequency caustic shimmer on water surface
      float r1 = sin(vWaterWorldPos.x * 1.55 + uTime * 1.85) * cos(vWaterWorldPos.z * 1.45 - uTime * 1.45);
      float r2 = sin((vWaterWorldPos.x * 0.9 - vWaterWorldPos.z * 1.1) * 2.4 - uTime * 2.6);
      float caustic = clamp((r1 * 0.5 + r2 * 0.5) * 0.5 + 0.5, 0.0, 1.0);
      float sparkle = smoothstep(0.76, 0.98, caustic);

      vec3 crystalTeal = vec3(0.18, 0.52, 0.66);
      vec3 shallowAqua = vec3(0.34, 0.72, 0.82);
      vec3 baseWater = mix(crystalTeal, shallowAqua, caustic * 0.55) + vec3(0.22, 0.28, 0.30) * sparkle;

      // View-dependent Fresnel factor (more transparent looking down so fish are crystal-clear,
      // stronger sky/object reflection at grazing angles)
      vec3 viewDir = normalize(uCameraPos - vWaterWorldPos);
      float NdotV = clamp(abs(viewDir.y), 0.0, 1.0);
      float fresnel = pow(1.0 - NdotV, 2.4);

      float finalAlpha = mix(0.46, 0.74, fresnel) + sparkle * 0.08;

      if (uReflectionActive > 0.5 && vReflectCoord.w > 0.05) {
        vec2 projUv = vReflectCoord.xy / vReflectCoord.w;
        // Organic wave ripple distortion on the reflection
        vec2 rippleDistort = vWaveSlope * 0.32 + vec2(
          sin(vWaterWorldPos.z * 3.2 + uTime * 3.0),
          cos(vWaterWorldPos.x * 3.2 - uTime * 2.7)
        ) * 0.0035;
        vec2 reflUv = projUv + rippleDistort;

        if (reflUv.x > 0.005 && reflUv.x < 0.995 && reflUv.y > 0.005 && reflUv.y < 0.995) {
          vec4 reflSample = texture2D(uReflectionMap, reflUv);
          // reflSample.a is 1.0 where 3D objects (the Dwarf, trees, hills) are reflected, 0.0 on open sky
          float objMask = reflSample.a;
          float reflStrength = mix(0.26 + fresnel * 0.42, 0.72, objMask);
          baseWater = mix(baseWater, reflSample.rgb, reflStrength);
          // Make reflected dwarf/objects clearly visible while keeping water translucent enough to see fish
          finalAlpha = max(finalAlpha, objMask * 0.68);
        }
      }

      diffuseColor.rgb = baseWater;
      diffuseColor.a = clamp(finalAlpha, 0.42, 0.80);
      `
    );
  };

  return { material: mat, waterUniforms };
}

const BIAS_MATRIX = new THREE.Matrix4().set(
  0.5, 0.0, 0.0, 0.5,
  0.0, 0.5, 0.0, 0.5,
  0.0, 0.0, 0.5, 0.5,
  0.0, 0.0, 0.0, 1.0
);

/**
 * Renders a real-time planar reflection pass across the horizontal water plane `y = config.waterLevel`
 * so the dwarf (including his backpack and fishing rod), shoreline trees, and hills reflect in the water.
 */
export class WaterReflectionController {
  private readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly virtualCamera = new THREE.PerspectiveCamera();
  private readonly reflectorPlane = new THREE.Plane();
  private readonly clipPlane = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly normal = new THREE.Vector3(0, 1, 0);
  private readonly planePoint = new THREE.Vector3(0, 0, 0);
  private readonly cameraWorldPos = new THREE.Vector3();
  private readonly lookAtPos = new THREE.Vector3();
  private readonly rotationMatrix = new THREE.Matrix4();
  private readonly view = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly savedDwarfPos = new THREE.Vector3();
  private readonly smoothedWaterAnchor = new THREE.Vector3();
  private hasSmoothedAnchor = false;
  private savedClearColor = new THREE.Color();
  private frameCounter = 0;
  private hasRenderedOnce = false;

  constructor(private readonly waterUniforms: WaterUniforms) {
    this.renderTarget = new THREE.WebGLRenderTarget(512, 512, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
    this.waterUniforms.uReflectionMap.value = this.renderTarget.texture;
  }

  public update(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    config: WorldConfig,
    waterMaterial: THREE.Material,
    dwarfRoot: THREE.Object3D,
    dwarfHeading: number,
    sampleGroundHeight: (wx: number, wz: number) => number
  ): void {
    const waterY = config.waterLevel;
    this.waterUniforms.uWaterLevel.value = waterY;
    this.cameraWorldPos.setFromMatrixPosition(camera.matrixWorld);
    this.waterUniforms.uCameraPos.value.copy(this.cameraWorldPos);

    if (!config.enableWater || config.blankClayMode || this.cameraWorldPos.y <= waterY + 0.15) {
      this.waterUniforms.uReflectionActive.value = 0.0;
      this.hasRenderedOnce = false;
      return;
    }

    // Check if there is any water near the player before running the reflection pass
    const px = dwarfRoot.position.x;
    const pz = dwarfRoot.position.z;
    const groundAtPlayer = sampleGroundHeight(px, pz);

    // Find whether water is right under/around the player so the dwarf's reflection lands on water
    let hasNearbyWater = groundAtPlayer < waterY + 0.25;
    let bestWaterX = px;
    let bestWaterZ = pz;

    const camToDwarfX = px - this.cameraWorldPos.x;
    const camToDwarfZ = pz - this.cameraWorldPos.z;
    const camHorizDist = Math.hypot(camToDwarfX, camToDwarfZ) || 1.0;
    const dirX = camToDwarfX / camHorizDist;
    const dirZ = camToDwarfZ / camHorizDist;

    // In a standard planar mirror from behind the dwarf, the unshifted ray hits between camera and dwarf
    const naturalHitDist = -1.6;
    const naturalHitX = px + dirX * naturalHitDist;
    const naturalHitZ = pz + dirZ * naturalHitDist;
    const naturalHitGround = sampleGroundHeight(naturalHitX, naturalHitZ);

    let needForwardProjection = false;
    if (naturalHitGround < waterY - 0.05) {
      // Camera is looking across water at the dwarf (or dwarf is swimming in water)
      hasNearbyWater = true;
      bestWaterX = naturalHitX;
      bestWaterZ = naturalHitZ;
    } else {
      // Check in front of the dwarf (along camera view direction and dwarf facing direction) for shoreline water
      const faceX = Math.sin(dwarfHeading);
      const faceZ = Math.cos(dwarfHeading);
      for (let d = 1.2; d <= 12.0; d += 1.4) {
        const testX1 = px + dirX * d;
        const testZ1 = pz + dirZ * d;
        if (sampleGroundHeight(testX1, testZ1) < waterY - 0.08) {
          hasNearbyWater = true;
          bestWaterX = testX1;
          bestWaterZ = testZ1;
          needForwardProjection = d <= 7.5;
          break;
        }
        const testX2 = px + faceX * d;
        const testZ2 = pz + faceZ * d;
        if (sampleGroundHeight(testX2, testZ2) < waterY - 0.08) {
          hasNearbyWater = true;
          bestWaterX = testX2;
          bestWaterZ = testZ2;
          needForwardProjection = d <= 7.5;
          break;
        }
      }
      // Also check radial directions within 18m so ponds in view still get environment reflections
      if (!hasNearbyWater) {
        for (let a = 0; a < 8; a++) {
          const ang = (a * Math.PI) / 4;
          const tx = px + Math.cos(ang) * 14.0;
          const tz = pz + Math.sin(ang) * 14.0;
          if (sampleGroundHeight(tx, tz) < waterY - 0.1) {
            hasNearbyWater = true;
            break;
          }
        }
      }
    }

    if (!hasNearbyWater) {
      this.waterUniforms.uReflectionActive.value = 0.0;
      this.hasRenderedOnce = false;
      return;
    }

    this.waterUniforms.uReflectionActive.value = 1.0;

    // 1. Setup virtual mirror camera across horizontal plane y = waterY
    this.planePoint.set(this.cameraWorldPos.x, waterY, this.cameraWorldPos.z);
    this.view.subVectors(this.planePoint, this.cameraWorldPos);
    this.view.reflect(this.normal).negate();
    this.view.add(this.planePoint);

    this.rotationMatrix.extractRotation(camera.matrixWorld);
    this.lookAtPos.set(0, 0, -1).applyMatrix4(this.rotationMatrix).add(this.cameraWorldPos);

    this.target.subVectors(this.planePoint, this.lookAtPos);
    this.target.reflect(this.normal).negate();
    this.target.add(this.planePoint);

    const vCam = this.virtualCamera;
    vCam.position.copy(this.view);
    vCam.up.set(0, 1, 0).applyMatrix4(this.rotationMatrix).reflect(this.normal);
    vCam.lookAt(this.target);
    vCam.far = Math.min(camera.far, 140.0);
    vCam.near = camera.near;
    vCam.fov = camera.fov;
    vCam.aspect = camera.aspect;
    vCam.updateMatrixWorld();
    vCam.updateProjectionMatrix();

    // 2. Compute world-to-reflection-UV matrix before oblique near-plane modification
    this.waterUniforms.uReflectionMatrix.value
      .copy(BIAS_MATRIX)
      .multiply(vCam.projectionMatrix)
      .multiply(vCam.matrixWorldInverse);

    // Throttle the 512x512 reflection render pass to 30 Hz (every 2nd frame) while keeping
    // uReflectionMatrix and uReflectionActive updated every frame for smooth camera motion
    this.frameCounter = (this.frameCounter + 1) & 1;
    if (this.hasRenderedOnce && this.frameCounter !== 0) {
      return;
    }
    this.hasRenderedOnce = true;

    // 3. Apply Lengyel oblique near-plane clipping so geometry below y = waterY is hardware-clipped
    this.reflectorPlane.setFromNormalAndCoplanarPoint(this.normal, this.planePoint);
    this.reflectorPlane.applyMatrix4(vCam.matrixWorldInverse);
    this.clipPlane.set(
      this.reflectorPlane.normal.x,
      this.reflectorPlane.normal.y,
      this.reflectorPlane.normal.z,
      this.reflectorPlane.constant
    );

    const proj = vCam.projectionMatrix;
    const elements = proj.elements;
    this.q.x = (Math.sign(this.clipPlane.x) + elements[8]) / elements[0];
    this.q.y = (Math.sign(this.clipPlane.y) + elements[9]) / elements[5];
    this.q.z = -1.0;
    this.q.w = (1.0 + elements[10]) / elements[14];

    this.clipPlane.multiplyScalar(2.0 / this.clipPlane.dot(this.q));
    elements[2] = this.clipPlane.x;
    elements[6] = this.clipPlane.y;
    elements[10] = this.clipPlane.z + 1.0 - 0.0005;
    elements[14] = this.clipPlane.w;

    // 4. If the dwarf is standing on a shoreline bank with the camera behind him looking at the water
    // in front of him, project his reflection proxy position onto the water in front of him so the
    // dwarf sees his own reflection in the water!
    this.savedDwarfPos.copy(dwarfRoot.position);
    let shiftedDwarf = false;
    if (needForwardProjection && dwarfRoot.visible) {
      if (!this.hasSmoothedAnchor) {
        this.smoothedWaterAnchor.set(bestWaterX, waterY, bestWaterZ);
        this.hasSmoothedAnchor = true;
      } else {
        this.smoothedWaterAnchor.x = THREE.MathUtils.lerp(this.smoothedWaterAnchor.x, bestWaterX, 0.18);
        this.smoothedWaterAnchor.z = THREE.MathUtils.lerp(this.smoothedWaterAnchor.z, bestWaterZ, 0.18);
      }
      const camElevAboveWater = Math.max(1.2, this.cameraWorldPos.y - waterY);
      const midBodyHeight = 0.65;
      const rayScale = (camElevAboveWater + midBodyHeight) / camElevAboveWater;
      const projX =
        this.cameraWorldPos.x + (this.smoothedWaterAnchor.x - this.cameraWorldPos.x) * rayScale;
      const projZ =
        this.cameraWorldPos.z + (this.smoothedWaterAnchor.z - this.cameraWorldPos.z) * rayScale;
      dwarfRoot.position.set(projX, waterY - 0.02, projZ);
      dwarfRoot.updateMatrixWorld(true);
      shiftedDwarf = true;
    } else {
      this.hasSmoothedAnchor = false;
    }

    // 5. Render reflected scene with transparent sky alpha so water shader knows which pixels are 3D objects
    const prevWaterVis = waterMaterial.visible;
    const prevBg = scene.background;
    const prevRenderTarget = renderer.getRenderTarget();
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.savedClearColor);

    waterMaterial.visible = false;
    scene.background = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.renderTarget);
    if (prevBg instanceof THREE.Color) {
      renderer.setClearColor(prevBg, 0.0);
    } else {
      renderer.setClearColor(0xd7e3ec, 0.0);
    }
    renderer.clear(true, true, false);
    renderer.render(scene, vCam);

    // 6. Restore scene and dwarf state
    waterMaterial.visible = prevWaterVis;
    scene.background = prevBg;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.setClearColor(this.savedClearColor, prevClearAlpha);
    renderer.setRenderTarget(prevRenderTarget);

    if (shiftedDwarf) {
      dwarfRoot.position.copy(this.savedDwarfPos);
      dwarfRoot.updateMatrixWorld(true);
    }
  }
}
