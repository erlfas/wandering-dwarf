import * as THREE from 'three';
import { defaultWorldConfig } from './world/Config';
import { TerrainNoise } from './world/TerrainNoise';
import { ChunkManager } from './world/ChunkManager';
import { DwarfCharacter } from './player/DwarfCharacter';
import { RelicStore } from './player/RelicStore';
import { ExplorerCamera } from './controls/ExplorerCamera';
import { DebugOverlay } from './ui/DebugOverlay';
import { BackgroundMusic } from './audio/BackgroundMusic';
import { TreasureManager } from './world/TreasureManager';
import { clearProgress, loadProgress, SavedProgress, saveProgress } from './world/ProgressStorage';

const appContainer = document.getElementById('app')!;
const coordsReadout = document.getElementById('coords-readout')!;
const compassNeedle = document.getElementById('compass-needle')!;
const compassChestPointer = document.getElementById('compass-chest-pointer')!;
const nearestChestHint = document.getElementById('nearest-chest-hint')!;
const movementStatusPill = document.getElementById('movement-status-pill')!;

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
dirLight.shadow.camera.far = 220;
const shadowExtent = 48;
dirLight.shadow.camera.left = -shadowExtent;
dirLight.shadow.camera.right = shadowExtent;
dirLight.shadow.camera.top = shadowExtent;
dirLight.shadow.camera.bottom = -shadowExtent;
dirLight.shadow.bias = -0.0003;
dirLight.matrixAutoUpdate = false;
dirLight.target.matrixAutoUpdate = false;
dirLight.updateMatrix();
dirLight.updateMatrixWorld();
dirLight.target.updateMatrix();
dirLight.target.updateMatrixWorld();
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
scene.add(dwarf.trailPoints);

const relicStore = new RelicStore(
  () => treasureManager.score,
  (amt) => treasureManager.spendGold(amt)
);

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
explorer.setRelicStore(relicStore);

if (savedProgress) {
  treasureManager.restoreProgress(
    savedProgress.score,
    savedProgress.chestsCollected,
    savedProgress.collectedIds
  );
  relicStore.restoreUnlocked(savedProgress.unlockedRelics);
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
let saveIdleHandle: number | null = null;

const reusableSaveState: SavedProgress = {
  version: 1,
  seed: config.seed,
  playerPos: { x: 0, y: 0, z: 0 },
  heading: 0,
  yaw: 0,
  pitch: 0,
  distance: 11.5,
  score: 0,
  chestsCollected: 0,
  collectedIds: [],
  unlockedRelics: [],
};

function populateSaveState(): SavedProgress {
  reusableSaveState.seed = config.seed;
  reusableSaveState.playerPos.x = Math.round(explorer.playerPos.x * 100) / 100;
  reusableSaveState.playerPos.y = Math.round(explorer.playerPos.y * 100) / 100;
  reusableSaveState.playerPos.z = Math.round(explorer.playerPos.z * 100) / 100;
  reusableSaveState.heading = Math.round(explorer.getHeading() * 1000) / 1000;
  reusableSaveState.yaw = Math.round(explorer.yaw * 1000) / 1000;
  reusableSaveState.pitch = Math.round(explorer.pitch * 1000) / 1000;
  reusableSaveState.distance = Math.round(explorer.distance * 100) / 100;
  reusableSaveState.score = treasureManager.score;
  reusableSaveState.chestsCollected = treasureManager.chestsCollected;
  reusableSaveState.collectedIds = treasureManager.getCollectedIds();
  reusableSaveState.unlockedRelics = relicStore.getUnlockedIds();
  return reusableSaveState;
}

function persistCurrentProgress(sync = false): void {
  lastSavedX = explorer.playerPos.x;
  lastSavedZ = explorer.playerPos.z;
  lastSavedYaw = explorer.yaw;
  if (sync) {
    saveProgress(populateSaveState());
    return;
  }
  if (saveIdleHandle !== null) return;
  const schedule =
    window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 0));
  saveIdleHandle = schedule(() => {
    saveIdleHandle = null;
    saveProgress(populateSaveState());
  });
}

treasureManager.onChestCollected = () => {
  relicStore.renderShop();
  persistCurrentProgress(false);
};
relicStore.onRelicUnlocked = () => {
  persistCurrentProgress(false);
};
window.addEventListener('beforeunload', () => persistCurrentProgress(true));

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
    relicStore.reset();
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
let lastMoveStatusText = '';

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
  const hasLodestone = relicStore.has('lodestone_amulet');
  chunkManager.update(px, py, pz, elapsedTime, false);
  treasureManager.update(dt, elapsedTime, explorer.playerPos, hasLodestone);

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
    dirLight.updateMatrix();
    dirLight.updateMatrixWorld();
    dirLight.target.updateMatrix();
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

    // Update compass chest pointer arrow (always visible with Lodestone Runes or when within 42m)
    const pointerRange = hasLodestone ? 240 : 42;
    if (nearest && nearest.dist <= pointerRange) {
      const worldAngle = Math.atan2(nearest.pos.x - px, -(nearest.pos.z - pz));
      const relDeg = ((worldAngle + explorer.yaw) * 180) / Math.PI;
      compassChestPointer.style.opacity = '1';
      compassChestPointer.style.transform = `rotate(${relDeg.toFixed(1)}deg)`;
    } else {
      compassChestPointer.style.opacity = '0';
    }

    const moveStatus = explorer.getMovementStatus();
    if (moveStatus !== lastMoveStatusText) {
      lastMoveStatusText = moveStatus;
      if (moveStatus) {
        movementStatusPill.textContent = moveStatus;
        movementStatusPill.classList.remove('hidden');
      } else {
        movementStatusPill.classList.add('hidden');
      }
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

  // Only update compass needle transform when camera yaw changes by >= 0.1 deg
  const compassDeg = Math.round((explorer.yaw * 1800) / Math.PI) * 0.1;
  if (compassDeg !== lastCompassYaw) {
    lastCompassYaw = compassDeg;
    compassNeedle.style.transform = `rotate(${compassDeg.toFixed(1)}deg)`;
  }

  renderer.render(scene, camera);
}

animate();
