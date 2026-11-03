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
import { LandmarkManager } from './world/LandmarkManager';
import { LivingWorldManager } from './world/LivingWorldManager';
import { ChallengeManager } from './world/ChallengeManager';
import { FishingAndFishManager } from './world/FishingAndFishManager';
import { WaterReflectionController } from './world/WaterMesh';
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
dirLight.shadow.autoUpdate = false;
dirLight.shadow.needsUpdate = true;
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

const landmarkManager = new LandmarkManager(
  config,
  noise,
  (tx, tz, label) => {
    explorer.setPose(tx, tz, explorer.getHeading(), explorer.yaw, explorer.pitch, explorer.distance);
    chunkManager.update(
      explorer.playerPos.x,
      explorer.playerPos.y,
      explorer.playerPos.z,
      clock.elapsedTime,
      true
    );
    dwarf.spawnBurst(explorer.playerPos.x, explorer.playerPos.y, explorer.playerPos.z, 14);
    treasureManager.grantBonusGold(0, `⚡ Fast-Traveled to ${label}`);
    persistCurrentProgress(false);
  },
  (gold, msg) => {
    treasureManager.grantBonusGold(gold, msg);
  }
);
scene.add(landmarkManager.group);
explorer.setLandmarkManager(landmarkManager);

const livingWorldManager = new LivingWorldManager(
  config,
  noise,
  scene,
  dirLight,
  hemiLight,
  fog,
  dwarf,
  (deltaGold, msg, isPositive) => {
    if (!isPositive) {
      explorer.applyHazardBump();
    }
    treasureManager.grantBonusGold(deltaGold, msg);
  },
  () => {
    debugOverlay.syncDisplay();
  }
);
scene.add(livingWorldManager.group);

const challengeManager = new ChallengeManager(config, noise, treasureManager);
scene.add(challengeManager.group);

const fishingManager = new FishingAndFishManager(
  config,
  noise,
  camera,
  renderer.domElement,
  dwarf,
  (gold, msg) => {
    treasureManager.grantBonusGold(gold, msg);
    if (gold > 0) {
      persistCurrentProgress(false);
    }
  }
);
scene.add(fishingManager.group);
explorer.setFishingManager(fishingManager);

const waterReflection = new WaterReflectionController(chunkManager.waterUniforms);

// Wire O(1) loaded-chunk surface height lookup into managers to eliminate per-frame Simplex calls
const sampleSurfaceHeight = (wx: number, wz: number): number =>
  chunkManager.getSurfaceHeight(wx, wz);
treasureManager.setSurfaceHeightSampler(sampleSurfaceHeight);
livingWorldManager.setSurfaceHeightSampler(sampleSurfaceHeight);
challengeManager.setSurfaceHeightSampler(sampleSurfaceHeight);
fishingManager.setSurfaceHeightSampler(sampleSurfaceHeight);

function syncBeaconFog(): void {
  const litCount = landmarkManager.getLitBeaconCount();
  // Lighting Watchtower Beacons clears up to 40% of distant horizon mist!
  const clearFactor = Math.max(0.6, 1.0 - litCount * 0.12);
  fog.density = config.fogDensity * clearFactor;
}

if (savedProgress) {
  treasureManager.restoreProgress(
    savedProgress.score,
    savedProgress.chestsCollected,
    savedProgress.collectedIds
  );
  relicStore.restoreUnlocked(savedProgress.unlockedRelics);
  landmarkManager.restoreLitBeacons(savedProgress.litBeacons);
  syncBeaconFog();
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
  litBeacons: [],
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
  reusableSaveState.litBeacons = landmarkManager.getLitBeacons();
  return reusableSaveState;
}

function persistCurrentProgress(sync = false): void {
  lastSavedX = explorer.playerPos.x;
  lastSavedZ = explorer.playerPos.z;
  lastSavedYaw = explorer.yaw;
  if (sync) {
    if (saveIdleHandle !== null) {
      window.clearTimeout(saveIdleHandle);
      saveIdleHandle = null;
    }
    saveProgress(populateSaveState());
    return;
  }
  if (saveIdleHandle !== null) return;
  // Coalesce rapid pickups (e.g. 5-coin trail runs) over a 350ms window before serializing to localStorage
  saveIdleHandle = window.setTimeout(() => {
    saveIdleHandle = null;
    const schedule =
      window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 0));
    schedule(() => {
      saveProgress(populateSaveState());
    });
  }, 350);
}

treasureManager.onChestCollected = () => {
  relicStore.renderShop();
  persistCurrentProgress(false);
};
relicStore.onRelicUnlocked = () => {
  persistCurrentProgress(false);
};
landmarkManager.onBeaconLit = () => {
  syncBeaconFog();
  relicStore.renderShop();
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
    landmarkManager.reset();
    livingWorldManager.rebuildAll();
    challengeManager.reset();
    fishingManager.exitFishingMode();
    fishingManager.rebuildAll();
    syncBeaconFog();
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
const bgm = new BackgroundMusic();
challengeManager.onChallengeStateChange = (active) => {
  if (active) {
    bgm.startChallengeTune();
  } else {
    bgm.stopChallengeTune();
  }
};

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
let lastSunSnapX = NaN;
let lastSunSnapY = NaN;
let lastShadowRenderTime = -1;
let lastHudUpdate = -1;
let lastCompassYaw = NaN;
let lastChestWorldAngle = NaN;
let lastPointerVisible = false;
let lastPointerDeg = NaN;
let lastChestHintText = '';
let lastCoordsText = '';
let lastQPx = NaN;
let lastQPy = NaN;
let lastQPz = NaN;
let lastQTimeMins = -1;
let lastActiveChunks = -1;
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
  landmarkManager.update(dt, elapsedTime, explorer.playerPos);
  challengeManager.update(dt, elapsedTime, explorer.playerPos, hasLodestone);
  livingWorldManager.update(
    dt,
    elapsedTime,
    explorer.playerPos,
    explorer.isAttackingOrAirborne(),
    sunOffset
  );
  fishingManager.update(
    dt,
    elapsedTime,
    explorer.playerPos,
    explorer.lastAimForward,
    explorer.lastAimRight
  );

  // Keep directional sun shadow frustum centered on player in discrete grid steps
  const snap = 2.0;
  const sx = Math.round(px / snap) * snap;
  const sy = Math.round(py / snap) * snap;
  const sz = Math.round(pz / snap) * snap;
  const sunSnapX = Math.round(sunOffset.x / snap) * snap;
  const sunSnapY = Math.round(sunOffset.y / snap) * snap;
  let shadowMoved = false;
  if (
    sx !== lastShadowX ||
    sy !== lastShadowY ||
    sz !== lastShadowZ ||
    sunSnapX !== lastSunSnapX ||
    sunSnapY !== lastSunSnapY
  ) {
    lastShadowX = sx;
    lastShadowY = sy;
    lastShadowZ = sz;
    lastSunSnapX = sunSnapX;
    lastSunSnapY = sunSnapY;
    dirLight.position.set(sx + sunSnapX, sy + sunSnapY, sz + sunOffset.z);
    dirLight.target.position.set(sx, sy, sz);
    dirLight.updateMatrix();
    dirLight.updateMatrixWorld();
    dirLight.target.updateMatrix();
    dirLight.target.updateMatrixWorld();
    shadowMoved = true;
  }

  // Throttle shadow map depth re-rasterization to 30 Hz (or immediate on frustum snap)
  if (shadowMoved || elapsedTime - lastShadowRenderTime >= 0.033) {
    lastShadowRenderTime = elapsedTime;
    dirLight.shadow.needsUpdate = true;
  }

  // Throttle HUD DOM text mutations to 5 Hz and skip DOM writes when text is unchanged
  if (elapsedTime - lastHudUpdate >= 0.2) {
    lastHudUpdate = elapsedTime;
    const nearest = treasureManager.getNearestChest(explorer.playerPos);
    const nextHint = nearest ? nearest.label : 'Explore further!';
    if (nextHint !== lastChestHintText) {
      lastChestHintText = nextHint;
      nearestChestHint.textContent = nextHint;
    }

    // Update compass chest pointer visibility & world bearing at 5 Hz
    const pointerRange = hasLodestone ? 240 : 65;
    const showPointer = Boolean(nearest && nearest.dist <= pointerRange);
    if (showPointer && nearest) {
      lastChestWorldAngle = Math.atan2(nearest.pos.x - px, -(nearest.pos.z - pz));
      if (!lastPointerVisible) {
        lastPointerVisible = true;
        compassChestPointer.style.opacity = '1';
      }
    } else {
      lastChestWorldAngle = NaN;
      if (lastPointerVisible) {
        lastPointerVisible = false;
        compassChestPointer.style.opacity = '0';
      }
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

    const qPx = Math.round(px * 10);
    const qPy = Math.round(py * 10);
    const qPz = Math.round(pz * 10);
    const qTimeMins = Math.floor((config.timeOfDay % 24) * 60);
    const activeChunks = chunkManager.getActiveChunkCount();
    if (
      qPx !== lastQPx ||
      qPy !== lastQPy ||
      qPz !== lastQPz ||
      qTimeMins !== lastQTimeMins ||
      activeChunks !== lastActiveChunks
    ) {
      lastQPx = qPx;
      lastQPy = qPy;
      lastQPz = qPz;
      lastQTimeMins = qTimeMins;
      lastActiveChunks = activeChunks;
      const hrs = Math.floor(qTimeMins / 60) % 24;
      const mins = qTimeMins % 60;
      const timeIcon = hrs >= 6 && hrs < 19 ? '☀️' : '🌙';
      const timeStr = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${timeIcon}`;
      const nextCoords = `${timeStr} | Pos: (${(qPx * 0.1).toFixed(1)}, ${(qPz * 0.1).toFixed(1)}) | Elev: ${(qPy * 0.1).toFixed(1)}m | Chunks: ${activeChunks}`;
      if (nextCoords !== lastCoordsText) {
        lastCoordsText = nextCoords;
        coordsReadout.textContent = nextCoords;
      }
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

  // Smoothly rotate chest pointer arrow at 60 Hz when visible and bearing/yaw changes by >= 0.1 deg
  if (lastPointerVisible && !Number.isNaN(lastChestWorldAngle)) {
    const pointerDeg = Math.round(((lastChestWorldAngle + explorer.yaw) * 1800) / Math.PI) * 0.1;
    if (pointerDeg !== lastPointerDeg) {
      lastPointerDeg = pointerDeg;
      compassChestPointer.style.transform = `rotate(${pointerDeg.toFixed(1)}deg)`;
    }
  }

  // Render planar water reflection pass (reflecting the dwarf, backpack/fishing rod, trees, and sky)
  waterReflection.update(
    renderer,
    scene,
    camera,
    config,
    chunkManager.waterMaterial,
    dwarf.root,
    explorer.getHeading(),
    sampleSurfaceHeight
  );

  renderer.render(scene, camera);
}

animate();
