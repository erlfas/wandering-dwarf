import * as THREE from 'three';
import { defaultWorldConfig } from './world/Config';
import { TerrainNoise } from './world/TerrainNoise';
import { ChunkManager } from './world/ChunkManager';
import { DwarfCharacter } from './player/DwarfCharacter';
import { ExplorerCamera } from './controls/ExplorerCamera';
import { DebugOverlay } from './ui/DebugOverlay';
import { BackgroundMusic } from './audio/BackgroundMusic';
import { TreasureManager } from './world/TreasureManager';
import { clearProgress, loadProgress, saveProgress } from './world/ProgressStorage';

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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
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
hemiLight.updateMatrix();
hemiLight.matrixAutoUpdate = false;
scene.add(hemiLight);

const sunOffset = new THREE.Vector3(85, 110, 65);
const dirLight = new THREE.DirectionalLight(0xfff5e4, 1.85);
dirLight.position.copy(sunOffset);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 40;
dirLight.shadow.camera.far = 230;
const shadowExtent = 65;
dirLight.shadow.camera.left = -shadowExtent;
dirLight.shadow.camera.right = shadowExtent;
dirLight.shadow.camera.top = shadowExtent;
dirLight.shadow.camera.bottom = -shadowExtent;
dirLight.shadow.bias = -0.0003;
scene.add(dirLight);
scene.add(dirLight.target);

// 5. Procedural Terrain, Chunk Streaming & Treasure Chests
const savedProgress = loadProgress();
if (savedProgress) {
  config.seed = savedProgress.seed;
}

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
    debugOverlay.syncDisplay();
  },
  () => {
    debugOverlay.syncDisplay();
  }
);

if (savedProgress) {
  treasureManager.restoreProgress(
    savedProgress.score,
    savedProgress.chestsCollected,
    savedProgress.collectedIds
  );
  explorer.setPose(
    savedProgress.playerPos.x,
    savedProgress.playerPos.z,
    savedProgress.heading,
    savedProgress.yaw,
    savedProgress.pitch,
    savedProgress.distance
  );
}

let lastSavedX = explorer.playerPos.x;
let lastSavedZ = explorer.playerPos.z;
let lastSavedYaw = explorer.yaw;
let lastSaveTime = 0;

function persistCurrentProgress(): void {
  lastSavedX = explorer.playerPos.x;
  lastSavedZ = explorer.playerPos.z;
  lastSavedYaw = explorer.yaw;
  saveProgress({
    version: 1,
    seed: config.seed,
    playerPos: {
      x: explorer.playerPos.x,
      y: explorer.playerPos.y,
      z: explorer.playerPos.z,
    },
    heading: explorer.getHeading(),
    yaw: explorer.yaw,
    pitch: explorer.pitch,
    distance: explorer.distance,
    score: treasureManager.score,
    chestsCollected: treasureManager.chestsCollected,
    collectedIds: treasureManager.getCollectedIds(),
  });
}

treasureManager.onChestCollected = persistCurrentProgress;
window.addEventListener('beforeunload', persistCurrentProgress);

// Build initial chunks around player position immediately so first frame has full terrain + grass
chunkManager.update(
  explorer.playerPos.x,
  explorer.playerPos.y,
  explorer.playerPos.z,
  0,
  true
);

// 7. Live Terrain & Grass Planner GUI + Background Music
const debugOverlay = new DebugOverlay(
  config,
  noise,
  chunkManager,
  treasureManager,
  fog,
  () => explorer.playerPos,
  persistCurrentProgress,
  () => {
    clearProgress();
    config.seed = defaultWorldConfig.seed;
    noise.reseed(config.seed);
    treasureManager.resetProgress();
    explorer.resetToOrigin();
    chunkManager.rebuildAll(
      explorer.playerPos.x,
      explorer.playerPos.y,
      explorer.playerPos.z
    );
    debugOverlay.syncDisplay();
    lastSavedX = explorer.playerPos.x;
    lastSavedZ = explorer.playerPos.z;
    lastSavedYaw = explorer.yaw;
  }
);
new BackgroundMusic();

// 8. Resize Handler (coalesced into animation loop to avoid mid-frame framebuffer reallocations)
let resizePending = false;
window.addEventListener('resize', () => {
  resizePending = true;
});

// 9. Main Loop
const clock = new THREE.Clock();
let lastShadowX = NaN;
let lastShadowY = NaN;
let lastShadowZ = NaN;
let lastHudUpdate = -1;
let lastCompassYaw = NaN;
let lastChestHintText = '';
let lastCoordsText = '';

function animate(): void {
  requestAnimationFrame(animate);

  if (resizePending) {
    resizePending = false;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

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

  // Keep directional sun shadow frustum centered on player in discrete grid steps
  const snap = 2.0;
  const sx = Math.round(px / snap) * snap;
  const sy = Math.round(py / snap) * snap;
  const sz = Math.round(pz / snap) * snap;
  if (sx !== lastShadowX || sy !== lastShadowY || sz !== lastShadowZ) {
    lastShadowX = sx;
    lastShadowY = sy;
    lastShadowZ = sz;
    dirLight.position.set(sx + sunOffset.x, sy + sunOffset.y, sz + sunOffset.z);
    dirLight.target.position.set(sx, sy, sz);
    dirLight.updateMatrixWorld();
    dirLight.target.updateMatrixWorld();
  }

  // Throttle HUD DOM text mutations to 5 Hz and skip DOM writes when text is unchanged
  if (elapsedTime - lastHudUpdate >= 0.2) {
    lastHudUpdate = elapsedTime;
    const nearest = treasureManager.getNearestChest(explorer.playerPos);
    const nextHint = nearest ? `Nearest: ${nearest.dist.toFixed(0)}m` : 'Explore further!';
    if (nextHint !== lastChestHintText) {
      lastChestHintText = nextHint;
      nearestChestHint.textContent = nextHint;
    }
    const nextCoords = `Pos: (${px.toFixed(1)}, ${pz.toFixed(1)}) | Elev: ${py.toFixed(1)}m | Chunks: ${chunkManager.getActiveChunkCount()}`;
    if (nextCoords !== lastCoordsText) {
      lastCoordsText = nextCoords;
      coordsReadout.textContent = nextCoords;
    }
  }

  // Auto-save player coordinates & camera pose every 2s when changed
  if (elapsedTime - lastSaveTime >= 2.0) {
    lastSaveTime = elapsedTime;
    const movedSq = (px - lastSavedX) * (px - lastSavedX) + (pz - lastSavedZ) * (pz - lastSavedZ);
    if (movedSq > 0.05 || Math.abs(explorer.yaw - lastSavedYaw) > 0.02) {
      persistCurrentProgress();
    }
  }

  // Only update compass needle transform when camera yaw changes
  if (Math.abs(explorer.yaw - lastCompassYaw) > 0.001) {
    lastCompassYaw = explorer.yaw;
    compassNeedle.style.transform = `rotate(${(explorer.yaw * 180) / Math.PI}deg)`;
  }

  renderer.render(scene, camera);
}

animate();
