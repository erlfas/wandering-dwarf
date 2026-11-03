import * as THREE from 'three';
import { GrassUniforms } from './GrassField';

/**
 * Creates a shared stylized water material for ponds and meandering rivers.
 * Features gentle animated surface ripples, translucent teal-blue tint, and soft specular sky highlights.
 */
export function createWaterMaterial(uniforms: GrassUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x4c8da8),
    roughness: 0.16,
    metalness: 0.12,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });

  mat.customProgramCacheKey = () => 'water_ripple_v1';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;

    shader.vertexShader =
      `
      uniform float uTime;
      varying vec3 vWaterWorldPos;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vec4 wp = modelMatrix * vec4(transformed, 1.0);
      vWaterWorldPos = wp.xyz;

      // Subtle animated water ripples + analytical normal perturbation
      float phase1 = wp.x * 0.65 + wp.z * 0.45 + uTime * 1.6;
      float phase2 = wp.x * 0.4 - wp.z * 0.75 + uTime * 1.2;
      float wave1 = sin(phase1) * 0.035;
      float wave2 = cos(phase2) * 0.025;
      transformed.y += wave1 + wave2;
      float dWaveDx = cos(phase1) * (0.035 * 0.65) - sin(phase2) * (0.025 * 0.4);
      float dWaveDz = cos(phase1) * (0.035 * 0.45) + sin(phase2) * (0.025 * 0.75);
      vNormal = normalize(mat3(viewMatrix) * vec3(-dWaveDx, 1.0, -dWaveDz));
      `
    );

    shader.fragmentShader =
      `
      uniform float uTime;
      varying vec3 vWaterWorldPos;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      // Subtle animated caustic/ripple shimmer on water surface
      float ripple = sin(vWaterWorldPos.x * 1.4 + uTime * 1.8) * cos(vWaterWorldPos.z * 1.3 - uTime * 1.4);
      vec3 deepWater = vec3(0.24, 0.50, 0.64);
      vec3 skyTint = vec3(0.42, 0.68, 0.80);
      diffuseColor.rgb = mix(deepWater, skyTint, ripple * 0.25 + 0.5);
      `
    );
  };

  return mat;
}
