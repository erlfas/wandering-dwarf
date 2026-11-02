import * as THREE from 'three';
import { defaultWorldConfig } from './world/Config';
import { TerrainNoise } from './world/TerrainNoise';
import { ChunkManager } from './world/ChunkManager';
import { DwarfCharacter } from './player/DwarfCharacter';
import { ExplorerCamera } from './controls/ExplorerCamera';
import { DebugOverlay } from './ui/DebugOverlay';
import { BackgroundMusic } from './audio/BackgroundMusic';
import { TreasureManager } from './world/TreasureManager';

const appContainer = document.getElementById('app')!;
const coordsReadout = document.getElementById('coords-readout')!;
const compassNeedle = document.getElementById('compass-needle')!;
const nearestChestHint = document.getElementById('nearest-chest-hint')!;

// 1. Scene & Atmospheric Mist (matching distant misty hills in the concept art)
const scene = new THREE.Scene();
const skyHorizonColor = new THREE.Color(0xd7e3ec);
scene.background = skyHorizonColor;

const config = { ...defaultWorldConfig };
const fog = new THREE.FogExp2(skyHorizonColor, config.fogDensity);
scene.fog = fog;

// 2. Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
appContainer.appendChild(renderer.domElement);

// 3. Camera
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.5,
  900
);

// 4. Lighting (Warm morning/afternoon sunlight + soft sky/ground hemisphere bounce)
const hemiLight = new THREE.HemisphereLight(0xeaf4ff, 0x6b7f4e, 0.82);
hemiLight.position.set(0, 120, 0);
scene.add(hemiLight);

const sunOffset = new THREE.Vector3(85, 110, 65);
const dirLight = new THREE.DirectionalLight(0xfff5e4, 1.85);
dirLight.position.copy(sunOffset);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 10;
dirLight.shadow.camera.far = 320;
const shadowExtent = 95;
dirLight.shadow.camera.left = -shadowExtent;
dirLight.shadow.camera.right = shadowExtent;
dirLight.shadow.camera.top = shadowExtent;
dirLight.shadow.camera.bottom = -shadowExtent;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);
scene.add(dirLight.target);

// 5. Procedural Terrain, Chunk Streaming & Treasure Chests
const noise = new TerrainNoise(config);
const chunkManager = new ChunkManager(config, noise);
scene.add(chunkManager.group);

const treasureManager = new TreasureManager(config, noise);
scene.add(treasureManager.group);

// 6. Dwarf Proxy & Third-Person / Free-Fly Camera Controller
const dwarf = new DwarfCharacter();
scene.add(dwarf.root);

const explorer = new ExplorerCamera(
  camera,
  renderer.domElement,
  config,
  noise,
  chunkManager,
  dwarf,
  () => {
    chunkManager.material.wireframe = config.wireframe;
  }
);

// Build initial chunks around (0, 0) immediately so first frame has full terrain + grass
chunkManager.update(
  explorer.playerPos.x,
  explorer.playerPos.y,
  explorer.playerPos.z,
  0,
  true
);

// 7. Live Terrain & Grass Planner GUI + Background Music
new DebugOverlay(config, noise, chunkManager, fog, () => explorer.playerPos);
new BackgroundMusic();

// 8. Resize Handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 9. Main Loop
const clock = new THREE.Clock();

function animate(): void {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1);
  const elapsedTime = clock.elapsedTime;

  // Update player movement, dwarf animation, and camera orbit
  explorer.update(dt);

  // Stream endless terrain & grass chunks around player and animate wind shader
  const px = explorer.playerPos.x;
  const py = explorer.playerPos.y;
  const pz = explorer.playerPos.z;
  chunkManager.update(px, py, pz, elapsedTime, false);
  treasureManager.update(dt, elapsedTime, explorer.playerPos);

  // Update nearest chest tracker in the HUD
  const nearest = treasureManager.getNearestChest(explorer.playerPos);
  if (nearest) {
    nearestChestHint.textContent = `Nearest: ${nearest.dist.toFixed(0)}m`;
  } else {
    nearestChestHint.textContent = 'Explore further!';
  }

  // Keep directional sun shadow frustum centered on player for crisp shadows everywhere
  dirLight.position.set(px + sunOffset.x, py + sunOffset.y, pz + sunOffset.z);
  dirLight.target.position.set(px, py, pz);
  dirLight.target.updateMatrixWorld();

  // Update HUD readout & top-left compass needle
  coordsReadout.textContent = `Pos: (${px.toFixed(1)}, ${pz.toFixed(1)}) | Elev: ${py.toFixed(1)}m | Chunks: ${chunkManager.getActiveChunkCount()}`;
  compassNeedle.style.transform = `rotate(${(explorer.yaw * 180) / Math.PI}deg)`;

  renderer.render(scene, camera);
}

animate();
