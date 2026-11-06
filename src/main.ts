import * as THREE from 'three';
import { defaultWorldConfig } from './world/Config';
import { TerrainNoise, VOLCANO_X, VOLCANO_Z } from './world/TerrainNoise';
import { ChunkManager } from './world/ChunkManager';
import { DwarfCharacter } from './player/DwarfCharacter';
import { RelicStore } from './player/RelicStore';
import { ExplorerCamera } from './controls/ExplorerCamera';
import { DebugOverlay } from './ui/DebugOverlay';
import { WorldMap } from './ui/WorldMap';
import { BackgroundMusic } from './audio/BackgroundMusic';
import { TreasureManager } from './world/TreasureManager';
import { LandmarkManager } from './world/LandmarkManager';
import { LivingWorldManager } from './world/LivingWorldManager';
import { ChallengeManager } from './world/ChallengeManager';
import { FishingAndFishManager } from './world/FishingAndFishManager';
import { HuntingAndDeerManager } from './world/HuntingAndDeerManager';
import { HutManager } from './world/HutManager';
import { CastleAndQuarryManager } from './world/CastleAndQuarryManager';
import { CastleInteriorManager } from './world/CastleInteriorManager';
import { TrollCombatManager } from './world/TrollCombatManager';
import { VOLCANO_HEAT_HAZARD_RADIUS, VolcanoManager } from './world/VolcanoManager';
import {
  AssignmentManager,
  AssignmentSnapshot,
  playWarhornBlastSound,
} from './world/AssignmentManager';
import { WaterReflectionController } from './world/WaterMesh';
import {
  clearProgress,
  loadProgress,
  loadProgressFromSlot,
  SavedProgress,
  saveProgress,
  saveProgressToSlot,
} from './world/ProgressStorage';

const appContainer = document.getElementById('app')!;
const coordsReadout = document.getElementById('coords-readout')!;
const timeReadout = document.getElementById('time-readout');
const controlsHelpToggleBtn = document.getElementById('controls-help-toggle');
const topHotkeysToggleBtn = document.getElementById('top-hotkeys-toggle');
const controlsHelpPopoverEl = document.getElementById('controls-help-popover');
const controlsPopoverCloseBtn = document.getElementById('controls-popover-close');
const compassNeedle = document.getElementById('compass-needle')!;
const compassChestPointer = document.getElementById('compass-chest-pointer')!;
const nearestChestHint = document.getElementById('nearest-chest-hint')!;
const movementStatusPill = document.getElementById('movement-status-pill')!;

function toggleControlsHelpPopover(forceState?: boolean): void {
  if (!controlsHelpPopoverEl) return;
  const isHidden = controlsHelpPopoverEl.classList.contains('hidden');
  const nextOpen = forceState !== undefined ? forceState : isHidden;
  controlsHelpPopoverEl.classList.toggle('hidden', !nextOpen);
  controlsHelpToggleBtn?.classList.toggle('active', nextOpen);
  topHotkeysToggleBtn?.classList.toggle('active', nextOpen);
}
controlsHelpToggleBtn?.addEventListener('click', () => {
  toggleControlsHelpPopover();
});
topHotkeysToggleBtn?.addEventListener('click', () => {
  toggleControlsHelpPopover();
});
controlsPopoverCloseBtn?.addEventListener('click', () => {
  toggleControlsHelpPopover(false);
});

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

// 3. Camera (far plane extended to 3500m so the colossal volcano, flames & 560m smoke plume are visible from across the world)
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.5,
  3500
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
    hutManager.exitCurrentHut(true);
    castleInteriorManager.exitCurrentCastle(true);
    fishingManager.exitFishingMode();
    huntingManager.exitHuntingMode();
    volcanoManager?.resetHazardState();
    syncBeaconFog();
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
    worldMap?.updateDiscovery(explorer.playerPos.x, explorer.playerPos.z, true);
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
explorer.setLivingWorldManager(livingWorldManager);

const challengeManager = new ChallengeManager(config, noise, treasureManager);
challengeManager.setChunkManager(chunkManager);
scene.add(challengeManager.group);

const bgm = new BackgroundMusic();
challengeManager.onChallengeStateChange = (active) => {
  if (active) {
    bgm.startChallengeTune();
  } else {
    bgm.stopChallengeTune();
  }
};

const volcanoManager = new VolcanoManager(config, noise, bgm, (wp) => {
  landmarkManager.unlockCustomWaypoint(wp, 250);
  worldMap?.revealCircle(wp.x, wp.z, 128);
  persistCurrentProgress(false);
});
scene.add(volcanoManager.group);
explorer.setVolcanoManager(volcanoManager);

const fishingManager = new FishingAndFishManager(
  config,
  noise,
  camera,
  renderer.domElement,
  dwarf,
  (gold, msg) => {
    treasureManager.grantBonusGold(gold, msg);
    if (gold > 0) {
      castleAndQuarryManager.addFoodRations(gold >= 200 ? 2 : 1, 'fish');
      castleAndQuarryManager.renderHouseShop();
      persistCurrentProgress(false);
    }
  }
);
scene.add(fishingManager.group);
explorer.setFishingManager(fishingManager);

const huntingManager = new HuntingAndDeerManager(
  config,
  noise,
  camera,
  renderer.domElement,
  dwarf,
  (gold, msg) => {
    treasureManager.grantBonusGold(gold, msg);
    if (gold > 0) {
      castleAndQuarryManager.addFoodRations(gold >= 250 ? 3 : 2, 'deer');
      castleAndQuarryManager.renderHouseShop();
      persistCurrentProgress(false);
    }
  }
);
scene.add(huntingManager.group);
explorer.setHuntingManager(huntingManager);

// Ensure equipping the Bow stows the Fishing Rod, and equipping the Fishing Rod stows the Bow
fishingManager.setOnEnterFishingCallback(() => huntingManager.exitHuntingMode());
huntingManager.setOnEnterHuntingCallback(() => fishingManager.exitFishingMode());

let hutManager!: HutManager;
let castleInteriorManager!: CastleInteriorManager;

const castleAndQuarryManager = new CastleAndQuarryManager(
  config,
  noise,
  chunkManager,
  dwarf,
  () => treasureManager.score,
  (amt) => {
    const ok = treasureManager.spendGold(amt);
    if (ok) {
      relicStore.renderShop();
    }
    return ok;
  },
  (gold, msg) => {
    treasureManager.grantBonusGold(gold, msg);
    relicStore.renderShop();
    castleAndQuarryManager.renderHouseShop();
    castleAndQuarryManager.renderCastleArmoryShop();
  },
  () => hutManager?.isInsideHut() ?? false
);
scene.add(castleAndQuarryManager.group);
explorer.setCastleAndQuarryManager(castleAndQuarryManager);
castleAndQuarryManager.onStateChanged = () => {
  landmarkManager.refreshWaypointBar();
  persistCurrentProgress(false);
};

// Safe distance outside the 132m lethal heat zone (146m < 152.2m Overlook so Overlook saves are preserved)
const MIN_SAFE_VOLCANO_SAVE_DIST = VOLCANO_HEAT_HAZARD_RADIUS + 14.0;

function sanitizeSafePlayerPos(pos: { x: number; y: number; z: number }): void {
  const vdx = pos.x - VOLCANO_X;
  const vdz = pos.z - VOLCANO_Z;
  const vDist = Math.hypot(vdx, vdz);
  if (vDist < MIN_SAFE_VOLCANO_SAVE_DIST) {
    const ang = vDist > 0.1 ? Math.atan2(vdx, vdz) : Math.atan2(-VOLCANO_X, -VOLCANO_Z);
    pos.x = Math.round((VOLCANO_X + Math.sin(ang) * MIN_SAFE_VOLCANO_SAVE_DIST) * 100) / 100;
    pos.z = Math.round((VOLCANO_Z + Math.cos(ang) * MIN_SAFE_VOLCANO_SAVE_DIST) * 100) / 100;
    pos.y = Math.round(noise.getHeight(pos.x, pos.z) * 100) / 100;
  }
}

// Wire Mount Doomforge Volcanic Heat Strength Drain, Rapid Heat Death & Immediate Crater Bottom Death
volcanoManager.onApplyVolcanicHazard = (strengthDrain, healthDrain, instantDeath) =>
  castleAndQuarryManager.applyVolcanicHazard(strengthDrain, healthDrain, instantDeath);
volcanoManager.onSpawnScorchBurst = (x, y, z, count) => {
  dwarf.spawnBurst(x, y, z, count);
};
volcanoManager.onPlayerDiedInVolcano = (reason) => {
  fishingManager.exitFishingMode();
  huntingManager.exitHuntingMode();
  volcanoManager.resetHazardState();
  const saved = loadProgress() ?? loadProgressFromSlot(1);
  if (saved) {
    sanitizeSafePlayerPos(saved.playerPos);
    applyLoadedGameState(saved);
    castleAndQuarryManager.healAndRestoreFull();
    persistCurrentProgress(true);
    treasureManager.grantBonusGold(
      0,
      reason === 'bottom'
        ? '🛡️ Rescued from the Volcano Crater! Restored to safe ground with full ❤️ Health & ⚡ Strength!'
        : '🛡️ Rescued from Mount Doomforge’s Heat! Restored to safe ground with full ❤️ Health & ⚡ Strength!'
    );
  } else {
    restartNewGame();
  }
};

// Wire O(1) loaded-chunk surface height lookup into managers to eliminate per-frame Simplex calls
const sampleSurfaceHeight = (wx: number, wz: number): number =>
  chunkManager.getSurfaceHeight(wx, wz);

const trollCombatManager = new TrollCombatManager(
  config,
  renderer.domElement,
  dwarf,
  sampleSurfaceHeight,
  () => (hutManager?.isInsideHut() ?? false) || (castleInteriorManager?.isInsideCastle() ?? false),
  () => castleAndQuarryManager.getCompletedCastlePositions(),
  () => castleAndQuarryManager.getCombatStats(),
  (cost) => castleAndQuarryManager.consumeCombatEnergy(cost),
  (damage, sourceTitle) => castleAndQuarryManager.applyPlayerDamage(damage, sourceTitle),
  () => {
    castleAndQuarryManager.eatFood(false);
  },
  (gold, rations, trophiesTotal, title, source = 'player') => {
    castleAndQuarryManager.addFoodRations(rations, 'troll');
    castleAndQuarryManager.setTrollsSlainBonusCount(trophiesTotal);
    if (source === 'turret') {
      treasureManager.grantBonusGold(gold, '', false);
    } else {
      treasureManager.grantBonusGold(
        gold,
        `👹 DEFEATED ${title.toUpperCase()}! +${gold}g, +${rations}🍖 Rations & Troll Slayer Trophy #${trophiesTotal} (+10 Max ❤️ & +5% DMG)!`
      );
    }
    persistCurrentProgress(true);
  },
  () => {
    // Dwarf defeated by Troll -> Restore to Last Saved Location with full Health & Strength!
    volcanoManager.resetHazardState();
    const saved = loadProgress() ?? loadProgressFromSlot(1);
    if (saved) {
      sanitizeSafePlayerPos(saved.playerPos);
      applyLoadedGameState(saved);
      castleAndQuarryManager.healAndRestoreFull();
      persistCurrentProgress(true);
      treasureManager.grantBonusGold(
        0,
        '🛡️ Restored to your Last Saved Location with full Health & Strength!'
      );
    } else {
      restartNewGame();
    }
  },
  () => {
    fishingManager.interruptFishingFromTroll();
  },
  noise
);
scene.add(trollCombatManager.group);
explorer.setTrollCombatManager(trollCombatManager);

const exteriorSceneGroups: THREE.Object3D[] = [
  chunkManager.group,
  treasureManager.group,
  landmarkManager.group,
  livingWorldManager.group,
  challengeManager.group,
  volcanoManager.group,
  fishingManager.group,
  huntingManager.group,
  castleAndQuarryManager.group,
  trollCombatManager.group,
];

hutManager = new HutManager(
  config,
  scene,
  fog,
  chunkManager,
  dwarf,
  exteriorSceneGroups,
  (x, z, heading, yaw, pitch, distance) => {
    explorer.setPose(x, z, heading, yaw, pitch, distance);
  },
  (gold, msg) => {
    treasureManager.grantBonusGold(gold, msg);
    relicStore.renderShop();
    castleAndQuarryManager.renderHouseShop();
    castleAndQuarryManager.renderCastleArmoryShop();
    persistCurrentProgress(false);
  }
);
scene.add(hutManager.group);
explorer.setHutManager(hutManager);
hutManager.setOnEnterHutCallback(() => {
  fishingManager.exitFishingMode();
  huntingManager.exitHuntingMode();
  livingWorldManager.setInsideInterior(true);
});
hutManager.setOnExitHutCallback(() => {
  livingWorldManager.setInsideInterior(castleInteriorManager.isInsideCastle());
  syncBeaconFog();
});
hutManager.setIsChallengeActiveFn(() => challengeManager.isChallengeActive());
hutManager.setOnWarmHearthCallback(() => {
  const wasActive = landmarkManager.campfireBuffTimer > 50.0;
  landmarkManager.campfireBuffTimer = 60.0;
  if (!wasActive) {
    treasureManager.grantBonusGold(25, '🔥 Hut Hearth Warmth! +20% Speed & Jump (60s) +25 Gold');
  }
});

castleInteriorManager = new CastleInteriorManager(
  config,
  scene,
  fog,
  dwarf,
  [...exteriorSceneGroups, hutManager.group],
  (x, z, heading, yaw, pitch, distance) => {
    explorer.setPose(x, z, heading, yaw, pitch, distance);
  }
);
scene.add(castleInteriorManager.group);
explorer.setCastleInteriorManager(castleInteriorManager);

castleInteriorManager.setCallbacks(
  (visit) => {
    fishingManager.exitFishingMode();
    huntingManager.exitHuntingMode();
    livingWorldManager.setInsideInterior(true);
    castleAndQuarryManager.claimKingdomTribute(true);
    castleAndQuarryManager.renderCastleArmoryShop();
    treasureManager.grantBonusGold(
      0,
      `🏰 Entered ${visit.name} (Tier ${visit.tier})! Safe from Night Trolls — Visit the Runic Anvil (T), Armory (Keys 5–0) or Rest Until Dawn (R)!`
    );
    persistCurrentProgress(true);
  },
  () => {
    livingWorldManager.setInsideInterior(hutManager.isInsideHut());
    syncBeaconFog();
    castleAndQuarryManager.renderCastleArmoryShop();
    persistCurrentProgress(true);
  },
  (visit) => {
    config.timeOfDay = 6.5;
    livingWorldManager.updateAtmosphereAndLantern(clock.elapsedTime, explorer.playerPos, sunOffset);
    castleInteriorManager.syncOutdoorAtmosphereAfterRest(livingWorldManager.getSkyHorizonColor());
    castleAndQuarryManager.healAndRestoreFull();
    castleAndQuarryManager.grantKingsValorBlessing(90.0);
    landmarkManager.campfireBuffTimer = Math.max(landmarkManager.campfireBuffTimer, 60.0);
    trollCombatManager.despawnAllTrolls(false);
    debugOverlay?.syncDisplay();
    treasureManager.grantBonusGold(
      0,
      `☀️ Rested Until Dawn inside ${visit.name}! Full Health & Strength restored, +25% Valor & +20% Speed, and Night Trolls have fled!`
    );
    persistCurrentProgress(true);
  },
  (visit) => {
    castleAndQuarryManager.healAndRestoreFull();
    castleAndQuarryManager.grantKingsValorBlessing(90.0);
    landmarkManager.campfireBuffTimer = 60.0;
    const bonusGold = visit.tier === 3 ? 100 : visit.tier === 2 ? 60 : 35;
    treasureManager.grantBonusGold(
      bonusGold,
      `🔥 ${visit.name} Hearth Blessing! Full HP/⚡ + 20% Speed (60s) + 25% Valor DMG (90s) +${bonusGold}g!`
    );
    relicStore.renderShop();
    castleAndQuarryManager.renderCastleArmoryShop();
    persistCurrentProgress(false);
  }
);

castleAndQuarryManager.isInsideCastleFn = () => castleInteriorManager.isInsideCastle();
castleAndQuarryManager.getInteriorRingProximityFn = (pos) =>
  castleInteriorManager.getInteriorRingProximity(pos);
castleAndQuarryManager.isActionBlockedFn = () =>
  isGameMenuOpen() ||
  (worldMap?.isMapOpen() ?? false) ||
  fishingManager.isFishingActive() ||
  huntingManager.isHuntingActive();
castleAndQuarryManager.getActiveCastleVisitFn = () => castleInteriorManager.getActiveCastleVisit();
castleAndQuarryManager.onRequestEnterCastle = (visit) => {
  if (!castleInteriorManager.canEnterNow()) return;
  hutManager.exitCurrentHut(true);
  fishingManager.exitFishingMode();
  huntingManager.exitHuntingMode();
  castleInteriorManager.enterCastle(visit);
};
castleAndQuarryManager.onRequestExitCastle = () => {
  castleInteriorManager.exitCurrentCastle();
};
castleAndQuarryManager.onRequestRestUntilDawn = () => {
  castleInteriorManager.tryRestUntilDawn();
};
castleAndQuarryManager.onWeaponTempered = () => {
  castleInteriorManager.triggerAnvilBurst();
};
castleAndQuarryManager.findNearestActiveTrollFn = (wx, wz, maxRange) =>
  trollCombatManager.findNearestActiveTrollPosition(wx, wz, maxRange);
castleAndQuarryManager.tryHitTrollWithSiegeBoltFn = (boltPos, damage) =>
  trollCombatManager.tryHitTrollWithSiegeBolt(boltPos, damage);
castleAndQuarryManager.onRequestStartCastleSiege = (cx, cz, name) =>
  trollCombatManager.startCastleSiegeWave(cx, cz, name);
castleAndQuarryManager.isCastleSiegeActiveFn = () => trollCombatManager.isCastleSiegeActive();

landmarkManager.getCompletedCastleWaypointsFn = () =>
  castleAndQuarryManager.getCompletedCastleWaypoints();
landmarkManager.isInsideCastleFn = () => castleInteriorManager.isInsideCastle();

const waterReflection = new WaterReflectionController(chunkManager.waterUniforms);
waterReflection.excludeFromReflection.push(
  dwarf.trailPoints,
  treasureManager.group,
  challengeManager.group,
  volcanoManager.group,
  fishingManager.group,
  huntingManager.group,
  livingWorldManager.group,
  trollCombatManager.group,
  hutManager.group,
  castleInteriorManager.group
);

treasureManager.setSurfaceHeightSampler(sampleSurfaceHeight);
landmarkManager.setSurfaceHeightSampler(sampleSurfaceHeight);
livingWorldManager.setSurfaceHeightSampler(sampleSurfaceHeight);
challengeManager.setSurfaceHeightSampler(sampleSurfaceHeight);
fishingManager.setSurfaceHeightSampler(sampleSurfaceHeight);
huntingManager.setSurfaceHeightSampler(sampleSurfaceHeight);

// Wire Sacred Artefact Blessings, Perfect Shield Parry & Ranged Bow vs Night Trolls
treasureManager.hasDurinCrownFn = () => hutManager?.hasArtefact('durin_crown') ?? false;
castleAndQuarryManager.hasArtefactFn = (id) => hutManager?.hasArtefact(id) ?? false;
trollCombatManager.hasIronAegisFn = () => hutManager?.hasArtefact('iron_aegis') ?? false;
trollCombatManager.isFishingOrHuntingActiveFn = () =>
  fishingManager.isFishingActive() || huntingManager.isHuntingActive();
trollCombatManager.onBeforeMeleeSwing = () => {
  fishingManager.exitFishingMode();
  huntingManager.exitHuntingMode();
};
trollCombatManager.onPerfectParryReward = () => {
  castleAndQuarryManager.restoreEnergyAndHealth(15, 5);
};
huntingManager.onTryHitTrollWithArrow = (arrowPos) =>
  trollCombatManager.tryHitTrollWithArrow(arrowPos, 38);

let windAndSlopeFeats = savedProgress?.windAndSlopeFeats ?? 0;
explorer.onCatchThermalUpdraft = () => {
  windAndSlopeFeats += 1;
};
explorer.onSurfRamCollision = () => {
  windAndSlopeFeats += 1;
};

const reusableAssignmentSnapshot: AssignmentSnapshot = {
  chestsOpened: 0,
  beaconsLit: 0,
  foodCollectedTotal: 0,
  relicsUnlocked: 0,
  houseToolsOwned: 0,
  artefactsCollected: 0,
  collectedArtefactIds: [],
  quarriesBuilt: 0,
  blocksChiseledTotal: 0,
  bestCastleBlocks: 0,
  totalBlocksPlaced: 0,
  weaponsOwned: 0,
  shieldsOwned: 0,
  trollsSlain: 0,
  challengesCompleted: 0,
  fishCaughtTotal: 0,
  deerHuntedTotal: 0,
  weaponTemperLevel: 0,
  castleSiegesWon: 0,
  mithrilVeinsMined: 0,
  automatonQuarriesCount: 0,
  windAndSlopeFeats: 0,
};

const assignmentManager = new AssignmentManager({
  getSnapshot: () => {
    reusableAssignmentSnapshot.chestsOpened = treasureManager.chestsCollected;
    reusableAssignmentSnapshot.beaconsLit = landmarkManager.getLitBeaconCount();
    reusableAssignmentSnapshot.foodCollectedTotal = castleAndQuarryManager.foodCount;
    reusableAssignmentSnapshot.relicsUnlocked = relicStore.getUnlockedCount();
    reusableAssignmentSnapshot.houseToolsOwned =
      castleAndQuarryManager.getUnlockedEquipmentCount();
    reusableAssignmentSnapshot.artefactsCollected = hutManager.artefactsCollected;
    reusableAssignmentSnapshot.collectedArtefactIds = hutManager.getCollectedArtefactIds();
    reusableAssignmentSnapshot.quarriesBuilt = castleAndQuarryManager.getQuarryCount();
    reusableAssignmentSnapshot.blocksChiseledTotal = castleAndQuarryManager.blocksChiseledTotal;
    reusableAssignmentSnapshot.bestCastleBlocks = castleAndQuarryManager.getBestCastleBlocks();
    reusableAssignmentSnapshot.totalBlocksPlaced = castleAndQuarryManager.getTotalBlocksPlaced();
    reusableAssignmentSnapshot.weaponsOwned = castleAndQuarryManager.getWeaponsOwnedCount();
    reusableAssignmentSnapshot.shieldsOwned = castleAndQuarryManager.getShieldsOwnedCount();
    reusableAssignmentSnapshot.trollsSlain = trollCombatManager.trollsSlain;
    reusableAssignmentSnapshot.challengesCompleted = challengeManager.getCompletedCount();
    reusableAssignmentSnapshot.fishCaughtTotal = fishingManager.fishCaughtCount;
    reusableAssignmentSnapshot.deerHuntedTotal = huntingManager.getDeerHuntedCount();
    reusableAssignmentSnapshot.weaponTemperLevel = castleAndQuarryManager.weaponTemperLevel;
    reusableAssignmentSnapshot.castleSiegesWon = castleAndQuarryManager.castleSiegesWon;
    reusableAssignmentSnapshot.mithrilVeinsMined =
      castleAndQuarryManager.getMithrilVeinsMinedCount();
    reusableAssignmentSnapshot.automatonQuarriesCount =
      castleAndQuarryManager.getAutomatonQuarriesCount();
    reusableAssignmentSnapshot.windAndSlopeFeats = windAndSlopeFeats;
    return reusableAssignmentSnapshot;
  },
  onGrantReward: (gold, food, message) => {
    treasureManager.grantBonusGold(gold, message);
    if (food > 0) {
      castleAndQuarryManager.addFoodRations(food, 'deer');
    }
    relicStore.renderShop();
    castleAndQuarryManager.renderHouseShop();
    castleAndQuarryManager.renderCastleArmoryShop();
    persistCurrentProgress(false);
  },
  onRankChanged: (rankDef) => {
    castleAndQuarryManager.setRankBonuses(
      rankDef.maxHpBonus,
      rankDef.maxEnergyBonus,
      rankDef.damageMult,
      rankDef.carrySpeedBonus
    );
    dwarf.setProgressionVisuals(rankDef.rank, hutManager.hasArtefact('durin_crown'));
  },
  onTriggerWarhorn: () => {
    playWarhornBlastSound();
    dwarf.triggerWarhornAnimation();
    castleAndQuarryManager.triggerWarhornRally(14);
    const stunned = trollCombatManager.stunNearbyTrollsWithWarhorn(explorer.playerPos, 15.0);
    const stunNote =
      stunned > 0 ? ` & Stunned ${stunned} Night Troll${stunned > 1 ? 's' : ''}!` : '!';
    treasureManager.grantBonusGold(
      0,
      `📯 Warhorn of Khazad! +25⚡ Strength, +15❤️ Health, +25% Speed & Melee Damage (14s)${stunNote}`
    );
  },
});

trollCombatManager.onSiegeVictoryReward = (castleName, goldReward, foodReward) => {
  castleAndQuarryManager.castleSiegesWon += 1;
  castleAndQuarryManager.addFoodRations(foodReward, 'troll');
  assignmentManager.addRenown(250);
  treasureManager.grantBonusGold(
    goldReward,
    `🏆 CASTLE SIEGE REPELLED AT ${castleName.toUpperCase()}! +${goldReward}g, +${foodReward}🍖 Rations & +250 🎖️ Renown!`
  );
  relicStore.renderShop();
  castleAndQuarryManager.renderCastleArmoryShop();
  persistCurrentProgress(true);
};

hutManager.onArtefactCollected = () => {
  dwarf.setProgressionVisuals(
    assignmentManager.getCurrentRank(),
    hutManager.hasArtefact('durin_crown')
  );
  persistCurrentProgress(false);
};

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
  hutManager.restoreProgress(
    savedProgress.artefactsCollected,
    savedProgress.collectedArtefactIds
  );
  relicStore.restoreUnlocked(savedProgress.unlockedRelics);
  landmarkManager.restoreLitBeacons(savedProgress.litBeacons);
  trollCombatManager.restoreProgress(savedProgress.trollsSlain);
  fishingManager.fishCaughtCount = savedProgress.fishCaughtTotal ?? 0;
  huntingManager.setDeerHuntedCount(savedProgress.deerHuntedTotal ?? 0);
  assignmentManager.loadState({
    completedChronicleIds: savedProgress.completedChronicleIds,
    renownXp: savedProgress.renownXp,
    activeContract: savedProgress.activeContract,
  });
  const rankDef = assignmentManager.getRankDef();
  castleAndQuarryManager.setRankBonuses(
    rankDef.maxHpBonus,
    rankDef.maxEnergyBonus,
    rankDef.damageMult,
    rankDef.carrySpeedBonus,
    false
  );
  castleAndQuarryManager.restoreProgress(
    savedProgress.quarries,
    savedProgress.castles,
    savedProgress.unlockedHouseEquipment,
    savedProgress.energy,
    savedProgress.foodCount,
    savedProgress.carriedRawStones,
    savedProgress.carriedChiseledBlocks,
    savedProgress.health,
    savedProgress.unlockedArmory,
    savedProgress.equippedWeapon,
    savedProgress.equippedShield,
    savedProgress.trollsSlain,
    savedProgress.blocksChiseledTotal,
    savedProgress.weaponTemperLevel,
    savedProgress.castleSiegesWon,
    savedProgress.unclaimedTributeGold,
    savedProgress.mithrilVeinsMined
  );
  landmarkManager.refreshWaypointBar();
  dwarf.setProgressionVisuals(rankDef.rank, hutManager.hasArtefact('durin_crown'));
  syncBeaconFog();
  sanitizeSafePlayerPos(savedProgress.playerPos);
  explorer.setPose(
    savedProgress.playerPos.x,
    savedProgress.playerPos.z,
    savedProgress.heading,
    savedProgress.yaw,
    savedProgress.pitch,
    savedProgress.distance
  );
  volcanoManager.restoreState(
    landmarkManager.isBeaconLit('wt_volcano_rim'),
    explorer.playerPos
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
  artefactsCollected: 0,
  collectedIds: [],
  unlockedRelics: [],
  litBeacons: [],
  discoveredCells: [],
  discoveredHuts: [],
  exploredTrail: [],
};

function populateSaveState(): SavedProgress {
  const outdoorPose =
    castleInteriorManager.getOutdoorSavePose() ?? hutManager.getOutdoorSavePose();
  let saveX = outdoorPose ? outdoorPose.x : explorer.playerPos.x;
  let saveY = outdoorPose ? outdoorPose.y : explorer.playerPos.y;
  let saveZ = outdoorPose ? outdoorPose.z : explorer.playerPos.z;
  const saveHeading = outdoorPose ? outdoorPose.heading : explorer.getHeading();
  const saveYaw = outdoorPose ? outdoorPose.yaw : explorer.yaw;
  const savePitch = outdoorPose ? outdoorPose.pitch : explorer.pitch;
  const saveDistance = outdoorPose ? outdoorPose.distance : explorer.distance;

  // Never save a checkpoint inside Mount Doomforge's lethal heat zone (`dist < 146m`)
  const vdx = saveX - VOLCANO_X;
  const vdz = saveZ - VOLCANO_Z;
  const vDist = Math.hypot(vdx, vdz);
  if (vDist < MIN_SAFE_VOLCANO_SAVE_DIST) {
    const ang = vDist > 0.1 ? Math.atan2(vdx, vdz) : Math.atan2(-VOLCANO_X, -VOLCANO_Z);
    saveX = VOLCANO_X + Math.sin(ang) * MIN_SAFE_VOLCANO_SAVE_DIST;
    saveZ = VOLCANO_Z + Math.cos(ang) * MIN_SAFE_VOLCANO_SAVE_DIST;
    saveY = noise.getHeight(saveX, saveZ);
  }

  const rawEnergy = Math.round(castleAndQuarryManager.energy);
  const rawHealth = Math.round(castleAndQuarryManager.health);
  const isDying = rawHealth <= 0 || volcanoManager.isDefeatPending();

  reusableSaveState.seed = config.seed;
  reusableSaveState.playerPos.x = Math.round(saveX * 100) / 100;
  reusableSaveState.playerPos.y = Math.round(saveY * 100) / 100;
  reusableSaveState.playerPos.z = Math.round(saveZ * 100) / 100;
  reusableSaveState.heading = Math.round(saveHeading * 1000) / 1000;
  reusableSaveState.yaw = Math.round(saveYaw * 1000) / 1000;
  reusableSaveState.pitch = Math.round(savePitch * 1000) / 1000;
  reusableSaveState.distance = Math.round(saveDistance * 100) / 100;
  reusableSaveState.score = treasureManager.score;
  reusableSaveState.chestsCollected = treasureManager.chestsCollected;
  reusableSaveState.artefactsCollected = hutManager.artefactsCollected;
  reusableSaveState.collectedIds = treasureManager.getCollectedIds();
  reusableSaveState.unlockedRelics = relicStore.getUnlockedIds();
  reusableSaveState.litBeacons = landmarkManager.getLitBeacons();
  reusableSaveState.discoveredCells = worldMap.getSerializedDiscoveredCells();
  reusableSaveState.discoveredHuts = worldMap.getSerializedDiscoveredHuts();
  reusableSaveState.exploredTrail = worldMap.getSerializedTrail();
  reusableSaveState.quarries = castleAndQuarryManager.getSerializedQuarries();
  reusableSaveState.castles = castleAndQuarryManager.getSerializedCastles();
  reusableSaveState.unlockedHouseEquipment = castleAndQuarryManager.getUnlockedEquipmentIds();
  reusableSaveState.energy = isDying ? Math.max(20, rawEnergy) : rawEnergy;
  reusableSaveState.foodCount = castleAndQuarryManager.foodCount;
  reusableSaveState.carriedRawStones = castleAndQuarryManager.carriedRawStones;
  reusableSaveState.carriedChiseledBlocks = castleAndQuarryManager.carriedChiseledBlocks;
  reusableSaveState.health = isDying ? Math.max(25, rawHealth) : rawHealth;
  reusableSaveState.unlockedArmory = castleAndQuarryManager.getUnlockedArmoryIds();
  reusableSaveState.equippedWeapon = castleAndQuarryManager.equippedWeaponId;
  reusableSaveState.equippedShield = castleAndQuarryManager.equippedShieldId;
  reusableSaveState.trollsSlain = trollCombatManager.trollsSlain;
  reusableSaveState.collectedArtefactIds = hutManager.getCollectedArtefactIds();
  reusableSaveState.completedChronicleIds = assignmentManager.getCompletedChronicleIds();
  reusableSaveState.renownXp = assignmentManager.getRenownXp();
  reusableSaveState.activeContract = assignmentManager.getActiveContract();
  reusableSaveState.blocksChiseledTotal = castleAndQuarryManager.blocksChiseledTotal;
  reusableSaveState.fishCaughtTotal = fishingManager.fishCaughtCount;
  reusableSaveState.deerHuntedTotal = huntingManager.getDeerHuntedCount();
  reusableSaveState.weaponTemperLevel = castleAndQuarryManager.weaponTemperLevel;
  reusableSaveState.castleSiegesWon = castleAndQuarryManager.castleSiegesWon;
  reusableSaveState.unclaimedTributeGold =
    Math.round(castleAndQuarryManager.unclaimedTributeGold * 10) / 10;
  reusableSaveState.mithrilVeinsMined = castleAndQuarryManager.mithrilVeinsMined;
  reusableSaveState.windAndSlopeFeats = windAndSlopeFeats;
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
  castleAndQuarryManager.renderHouseShop();
  persistCurrentProgress(false);
};
relicStore.onRelicUnlocked = () => {
  persistCurrentProgress(false);
};
landmarkManager.onBeaconLit = (waypoint) => {
  syncBeaconFog();
  worldMap.revealCircle(waypoint.x, waypoint.z, 96);
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

// Interactive Cartographic Map of the Entire Area Discovered by Our Dwarf
const worldMap = new WorldMap(
  config,
  noise,
  chunkManager,
  treasureManager,
  landmarkManager,
  () => explorer.playerPos,
  () => explorer.getHeading(),
  () => relicStore.has('lodestone_amulet'),
  () => {
    chunkManager.material.wireframe = config.wireframe;
    volcanoManager.setWireframe(config.wireframe);
    debugOverlay.syncDisplay();
  },
  () => {
    persistCurrentProgress(false);
  }
);
worldMap.setCastleAndQuarryManager(castleAndQuarryManager);
worldMap.restoreProgress(
  savedProgress?.discoveredCells,
  savedProgress?.discoveredHuts,
  savedProgress?.exploredTrail
);

function restartNewGame(): void {
  clearProgress();
  config.seed = defaultWorldConfig.seed;
  noise.reseed(config.seed);
  treasureManager.resetProgress();
  relicStore.reset();
  landmarkManager.reset();
  volcanoManager.reset();
  volcanoManager.rebuildGeometry();
  livingWorldManager.rebuildAll();
  challengeManager.reset();
  fishingManager.exitFishingMode();
  fishingManager.rebuildAll();
  huntingManager.exitHuntingMode();
  huntingManager.rebuildAll();
  hutManager.reset();
  castleInteriorManager.exitCurrentCastle(true);
  trollCombatManager.reset();
  castleAndQuarryManager.reset();
  fishingManager.fishCaughtCount = 0;
  huntingManager.setDeerHuntedCount(0);
  windAndSlopeFeats = 0;
  assignmentManager.loadState({
    completedChronicleIds: [],
    renownXp: 0,
    activeContract: null,
  });
  castleAndQuarryManager.setRankBonuses(0, 0, 1.0, 0);
  dwarf.setProgressionVisuals(1, false);
  syncBeaconFog();
  explorer.resetToOrigin();
  chunkManager.rebuildAll(
    explorer.playerPos.x,
    explorer.playerPos.y,
    explorer.playerPos.z
  );
  worldMap.reset();
  debugOverlay.syncDisplay(true);
  lastSavedX = explorer.playerPos.x;
  lastSavedZ = explorer.playerPos.z;
  lastSavedYaw = explorer.yaw;
}

function applyLoadedGameState(loaded: SavedProgress): void {
  hutManager.exitCurrentHut(true);
  castleInteriorManager.exitCurrentCastle(true);
  fishingManager.exitFishingMode();
  huntingManager.exitHuntingMode();
  if (config.seed !== loaded.seed) {
    config.seed = loaded.seed;
    noise.reseed(config.seed);
    volcanoManager.rebuildGeometry();
  }
  treasureManager.resetProgress();
  treasureManager.restoreProgress(
    loaded.score,
    loaded.chestsCollected,
    loaded.collectedIds
  );
  hutManager.reset();
  hutManager.restoreProgress(loaded.artefactsCollected, loaded.collectedArtefactIds);
  relicStore.reset();
  relicStore.restoreUnlocked(loaded.unlockedRelics);
  landmarkManager.reset();
  landmarkManager.restoreLitBeacons(loaded.litBeacons);
  challengeManager.reset();
  trollCombatManager.despawnAllTrolls(false);
  trollCombatManager.restoreProgress(loaded.trollsSlain);
  fishingManager.fishCaughtCount = loaded.fishCaughtTotal ?? 0;
  huntingManager.setDeerHuntedCount(loaded.deerHuntedTotal ?? 0);
  windAndSlopeFeats = loaded.windAndSlopeFeats ?? 0;

  sanitizeSafePlayerPos(loaded.playerPos);
  explorer.setPose(
    loaded.playerPos.x,
    loaded.playerPos.z,
    loaded.heading,
    loaded.yaw,
    loaded.pitch,
    loaded.distance
  );
  volcanoManager.restoreState(
    landmarkManager.isBeaconLit('wt_volcano_rim'),
    explorer.playerPos
  );
  chunkManager.rebuildAll(
    explorer.playerPos.x,
    explorer.playerPos.y,
    explorer.playerPos.z
  );
  treasureManager.rebuildAll();
  livingWorldManager.rebuildAll();
  fishingManager.rebuildAll();
  huntingManager.rebuildAll();
  assignmentManager.loadState({
    completedChronicleIds: loaded.completedChronicleIds,
    renownXp: loaded.renownXp,
    activeContract: loaded.activeContract,
  });
  const rankDef = assignmentManager.getRankDef();
  castleAndQuarryManager.setRankBonuses(
    rankDef.maxHpBonus,
    rankDef.maxEnergyBonus,
    rankDef.damageMult,
    rankDef.carrySpeedBonus,
    false
  );
  castleAndQuarryManager.restoreProgress(
    loaded.quarries,
    loaded.castles,
    loaded.unlockedHouseEquipment,
    loaded.energy,
    loaded.foodCount,
    loaded.carriedRawStones,
    loaded.carriedChiseledBlocks,
    loaded.health,
    loaded.unlockedArmory,
    loaded.equippedWeapon,
    loaded.equippedShield,
    loaded.trollsSlain,
    loaded.blocksChiseledTotal,
    loaded.weaponTemperLevel,
    loaded.castleSiegesWon,
    loaded.unclaimedTributeGold,
    loaded.mithrilVeinsMined
  );
  landmarkManager.refreshWaypointBar();
  dwarf.setProgressionVisuals(rankDef.rank, hutManager.hasArtefact('durin_crown'));
  worldMap.reset();
  worldMap.restoreProgress(
    loaded.discoveredCells,
    loaded.discoveredHuts,
    loaded.exploredTrail
  );
  syncBeaconFog();
  debugOverlay.syncDisplay(true);
  saveProgress(loaded);
  lastSavedX = explorer.playerPos.x;
  lastSavedZ = explorer.playerPos.z;
  lastSavedYaw = explorer.yaw;
}

// 7. Live Terrain & Grass Planner GUI + Background Music + Game Menu (Save / Load / Restart)
const debugOverlay = new DebugOverlay(
  config,
  noise,
  chunkManager,
  treasureManager,
  fog,
  () => explorer.playerPos,
  persistCurrentProgress,
  restartNewGame,
  () => {
    volcanoManager.rebuildGeometry();
    worldMap.invalidateTerrainTiles();
  }
);

const gameMenuModalEl = document.getElementById('game-menu-modal');
const gameMenuToggleBtn = document.getElementById('game-menu-toggle');
const gameMenuCloseBtn = document.getElementById('game-menu-close');
const gameMenuTitleEl = document.querySelector('#game-menu-modal .game-menu-title');
const gameMenuPauseBtn = document.getElementById('game-menu-pause-btn');
const gameMenuPauseIconEl = document.getElementById('game-menu-pause-icon');
const gameMenuPauseLabelEl = document.getElementById('game-menu-pause-label');
const gameMenuPauseSubEl = document.getElementById('game-menu-pause-sub');
const gameMenuMusicBtn = document.getElementById('game-menu-music-btn');
const gameMenuMusicIconEl = document.getElementById('game-menu-music-icon');
const gameMenuMusicLabelEl = document.getElementById('game-menu-music-label');
const gameMenuMusicSubEl = document.getElementById('game-menu-music-sub');
const gameMenuSaveBtn = document.getElementById('game-menu-save-btn');
const gameMenuLoadBtn = document.getElementById('game-menu-load-btn');
const gameMenuRestartBtn = document.getElementById('game-menu-restart-btn');
const gameMenuSummaryEl = document.getElementById('game-menu-current-summary');
const gameMenuSlotsListEl = document.getElementById('game-menu-slots-list');
const gameMenuStatusEl = document.getElementById('game-menu-status');

let isGamePaused = false;

function syncPauseMenuButtons(): void {
  if (gameMenuTitleEl) {
    gameMenuTitleEl.textContent = isGamePaused
      ? '⏸️ DWARVEN CHRONICLE — GAME PAUSED'
      : '⚙️ DWARVEN CHRONICLE — GAME MENU';
  }
  if (gameMenuPauseBtn) {
    gameMenuPauseBtn.classList.toggle('is-paused', isGamePaused);
    gameMenuPauseBtn.classList.toggle('is-playing', !isGamePaused);
  }
  if (gameMenuPauseIconEl) {
    gameMenuPauseIconEl.textContent = isGamePaused ? '⏸️' : '▶️';
  }
  if (gameMenuPauseLabelEl) {
    gameMenuPauseLabelEl.textContent = isGamePaused ? 'Game Paused' : 'Game Running';
  }
  if (gameMenuPauseSubEl) {
    gameMenuPauseSubEl.textContent = isGamePaused
      ? 'Click to unpause world (or press Esc to resume)'
      : 'Click to pause the 3D world simulation';
  }

  const musicPlaying = bgm.isPlayingNow();
  if (gameMenuMusicBtn) {
    gameMenuMusicBtn.classList.toggle('is-paused', !musicPlaying);
    gameMenuMusicBtn.classList.toggle('is-playing', musicPlaying);
  }
  if (gameMenuMusicIconEl) {
    gameMenuMusicIconEl.textContent = musicPlaying ? '🔊' : '🔇';
  }
  if (gameMenuMusicLabelEl) {
    gameMenuMusicLabelEl.textContent = musicPlaying
      ? 'Music Playing'
      : bgm.isMutedNow()
        ? 'Music Muted'
        : 'Music Paused';
  }
  if (gameMenuMusicSubEl) {
    gameMenuMusicSubEl.textContent = musicPlaying
      ? 'Click or press P to pause/mute music'
      : 'Paused with Esc • Click or press P to play';
  }
}

bgm.setOnStateChange(() => {
  if (isGameMenuOpen()) {
    syncPauseMenuButtons();
  }
});

function formatSaveSummary(state: SavedProgress): string {
  const castles = state.castles ?? [];
  const quarries = state.quarries ?? [];
  const totalBlocks = castles.reduce((acc, c) => acc + (c.blocksPlaced || 0), 0);
  const trolls = state.trollsSlain ?? 0;
  const timeStr = state.savedAt
    ? new Date(state.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Saved';
  return `🕒 ${timeStr} • 🪙 ${state.score} Gold • 🏰 ${castles.length} Castle (${totalBlocks} Blocks) • 👹 ${trolls} Trolls • ⛏️ ${quarries.length} Quarry`;
}

function renderGameMenu(): void {
  if (!gameMenuSummaryEl || !gameMenuSlotsListEl) return;
  const current = populateSaveState();
  const castles = current.castles ?? [];
  const quarries = current.quarries ?? [];
  const totalBlocks = castles.reduce((acc, c) => acc + (c.blocksPlaced || 0), 0);
  gameMenuSummaryEl.innerHTML =
    `<span><strong>Current Session:</strong></span>` +
    `<span>🪙 <strong>${current.score}</strong> Gold</span>` +
    `<span>🏰 <strong>${castles.length}</strong> Castle (${totalBlocks}/30 Blocks) • ⛏️ <strong>${quarries.length}</strong> Quarry</span>` +
    `<span>👹 <strong>${current.trollsSlain ?? 0}</strong> Trolls Slain</span>` +
    `<span>❤️ <strong>${current.health ?? 100}</strong> HP • ⚡ <strong>${current.energy}</strong> Strength • 🍖 <strong>${current.foodCount}</strong> Food</span>` +
    `<span>📍 Pos (${Math.round(current.playerPos.x)}, ${Math.round(current.playerPos.z)})</span>`;

  gameMenuSlotsListEl.innerHTML = '';
  for (const slot of [1, 2, 3] as const) {
    const slotData = loadProgressFromSlot(slot);
    const row = document.createElement('div');
    row.className = 'game-save-slot-row';

    const info = document.createElement('div');
    info.className = 'game-save-slot-info';
    info.innerHTML =
      `<div class="game-save-slot-title">📜 Save Slot ${slot}</div>` +
      `<div class="game-save-slot-meta">${slotData ? formatSaveSummary(slotData) : 'Empty Slot — Click Save to store a checkpoint here'}</div>`;

    const actions = document.createElement('div');
    actions.className = 'game-save-slot-actions';

    const saveSlotBtn = document.createElement('button');
    saveSlotBtn.type = 'button';
    saveSlotBtn.className = 'slot-action-btn save';
    saveSlotBtn.textContent = `💾 Save Slot ${slot}`;
    saveSlotBtn.addEventListener('click', () => {
      saveProgressToSlot(slot, populateSaveState());
      if (gameMenuStatusEl) {
        gameMenuStatusEl.textContent = `✅ Saved game to Slot ${slot}!`;
      }
      treasureManager.grantBonusGold(0, `💾 Game Saved to Slot ${slot}!`);
      renderGameMenu();
    });

    const loadSlotBtn = document.createElement('button');
    loadSlotBtn.type = 'button';
    loadSlotBtn.className = 'slot-action-btn load';
    loadSlotBtn.textContent = `📂 Load Slot ${slot}`;
    loadSlotBtn.disabled = !slotData;
    loadSlotBtn.addEventListener('click', () => {
      const fresh = loadProgressFromSlot(slot);
      if (!fresh) return;
      applyLoadedGameState(fresh);
      if (gameMenuStatusEl) {
        gameMenuStatusEl.textContent = `📂 Loaded game from Slot ${slot}!`;
      }
      treasureManager.grantBonusGold(0, `📂 Loaded Game from Slot ${slot}!`);
      setGameMenuOpen(false);
    });

    actions.appendChild(saveSlotBtn);
    actions.appendChild(loadSlotBtn);
    row.appendChild(info);
    row.appendChild(actions);
    gameMenuSlotsListEl.appendChild(row);
  }
}

function isGameMenuOpen(): boolean {
  return Boolean(gameMenuModalEl && !gameMenuModalEl.classList.contains('hidden'));
}

function setGameMenuOpen(open: boolean): void {
  if (!gameMenuModalEl) return;
  gameMenuModalEl.classList.toggle('hidden', !open);
  gameMenuToggleBtn?.classList.toggle('active', open);
  if (open) {
    isGamePaused = true;
    explorer.clearInputState();
    bgm.setPausedByMenu(true);
    volcanoManager.pauseVolcanoSfx();
    if (gameMenuStatusEl) {
      gameMenuStatusEl.textContent = '⏸️ Game & music paused • Press Esc or O anytime to resume';
    }
    syncPauseMenuButtons();
    renderGameMenu();
  } else {
    isGamePaused = false;
    bgm.setPausedByMenu(false);
    syncPauseMenuButtons();
  }
}

gameMenuPauseBtn?.addEventListener('click', () => {
  isGamePaused = !isGamePaused;
  if (isGamePaused) {
    explorer.clearInputState();
    volcanoManager.pauseVolcanoSfx();
  }
  if (gameMenuStatusEl) {
    gameMenuStatusEl.textContent = isGamePaused
      ? '⏸️ World simulation paused • Click Game Paused or press Esc to resume'
      : '▶️ World simulation running in background • Click to pause again';
  }
  syncPauseMenuButtons();
});

gameMenuMusicBtn?.addEventListener('click', () => {
  const nowPlaying = bgm.toggleMute();
  if (gameMenuStatusEl) {
    gameMenuStatusEl.textContent = nowPlaying
      ? '🔊 Background music resumed!'
      : '🔇 Background music paused/muted!';
  }
  syncPauseMenuButtons();
});

gameMenuToggleBtn?.addEventListener('click', () => {
  setGameMenuOpen(!isGameMenuOpen());
});
gameMenuCloseBtn?.addEventListener('click', () => {
  setGameMenuOpen(false);
});
gameMenuModalEl?.addEventListener('click', (e) => {
  if (e.target === gameMenuModalEl) {
    setGameMenuOpen(false);
  }
});

gameMenuSaveBtn?.addEventListener('click', () => {
  persistCurrentProgress(true);
  saveProgressToSlot(1, populateSaveState());
  if (gameMenuStatusEl) {
    gameMenuStatusEl.textContent = '💾 Game Saved! (Saved to Quick-Save & Slot 1)';
  }
  treasureManager.grantBonusGold(0, '💾 Game Saved!');
  renderGameMenu();
});

gameMenuLoadBtn?.addEventListener('click', () => {
  const loaded = loadProgress() ?? loadProgressFromSlot(1);
  if (!loaded) {
    if (gameMenuStatusEl) {
      gameMenuStatusEl.textContent = '⚠️ No saved game found yet — click Save Game first!';
    }
    return;
  }
  applyLoadedGameState(loaded);
  if (gameMenuStatusEl) {
    gameMenuStatusEl.textContent = '📂 Saved Game Loaded!';
  }
  treasureManager.grantBonusGold(0, '📂 Saved Game Loaded!');
  setGameMenuOpen(false);
});

gameMenuRestartBtn?.addEventListener('click', () => {
  restartNewGame();
  if (gameMenuStatusEl) {
    gameMenuStatusEl.textContent = '🔄 Game Restarted! Fresh world & progress ready.';
  }
  treasureManager.grantBonusGold(0, '🔄 Game Restarted!');
  setGameMenuOpen(false);
});

window.addEventListener(
  'keydown',
  (e) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }

    // 1. When Game Menu modal is open, allow Escape/KeyO to close it and KeyP to toggle music; block background 3D actions
    if (isGameMenuOpen()) {
      if (e.code === 'Escape' || e.code === 'KeyO') {
        if (!e.repeat) {
          setGameMenuOpen(false);
        }
      } else if (e.code === 'KeyP' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const nowPlaying = bgm.toggleMute();
        if (gameMenuStatusEl) {
          gameMenuStatusEl.textContent = nowPlaying
            ? '🔊 Background music resumed!'
            : '🔇 Background music paused/muted!';
        }
        syncPauseMenuButtons();
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        e.stopImmediatePropagation();
      }
      return;
    }

    // 2. Prevent equipping Fishing Rod (F) or Hunting Bow (H) while inside a Hut or Castle Interior
    if (
      (e.code === 'KeyF' || e.code === 'KeyH') &&
      (hutManager.isInsideHut() || castleInteriorManager.isInsideCastle())
    ) {
      e.stopImmediatePropagation();
      return;
    }

    // 3. Prevent KeyE from triggering Hut/Castle entry or Quarry work while actively Fishing or Hunting
    if (
      e.code === 'KeyE' &&
      (fishingManager.isFishingActive() || huntingManager.isHuntingActive())
    ) {
      e.stopImmediatePropagation();
      return;
    }
  },
  true
);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyO') {
    setGameMenuOpen(!isGameMenuOpen());
  } else if (e.code === 'KeyJ') {
    assignmentManager.togglePanelExpanded();
  } else if (e.key === '?' || e.code === 'Slash' || e.code === 'F1') {
    if (e.code === 'F1') e.preventDefault();
    toggleControlsHelpPopover();
  } else if (e.code === 'KeyV' && !e.shiftKey) {
    assignmentManager.tryBlowWarhorn();
  } else if (e.code === 'Escape') {
    if (isGameMenuOpen()) {
      setGameMenuOpen(false);
    } else if (
      !worldMap.isMapOpen() &&
      !hutManager.isInsideHut() &&
      !castleInteriorManager.isInsideCastle()
    ) {
      setGameMenuOpen(true);
    }
  }
});

// 8. Resize Handler (coalesced into animation loop to avoid mid-frame framebuffer reallocations)
let resizePending = false;
window.addEventListener('resize', () => {
  resizePending = true;
});

// 9. Main Loop
const clock = new THREE.Clock();
let simElapsedTime = 0;
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
let wasInsideInterior = false;

function animate(): void {
  requestAnimationFrame(animate);

  if (resizePending) {
    resizePending = false;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (worldMap.isMapOpen()) {
      worldMap.render();
    }
  }

  const rawDt = Math.min(clock.getDelta(), 0.1);
  if (isGamePaused) {
    renderer.render(scene, camera);
    return;
  }

  const dt = rawDt;
  simElapsedTime += dt;
  const elapsedTime = simElapsedTime;

  // Update player movement, dwarf animation, and camera orbit
  explorer.update(dt);

  hutManager.update(dt, elapsedTime, explorer.playerPos);
  castleInteriorManager.update(dt, elapsedTime, explorer.playerPos);
  castleAndQuarryManager.update(
    dt,
    elapsedTime,
    explorer.playerPos,
    explorer.isSprintingNow()
  );

  // Read player coordinates & interior state after interior enter/exit updates
  let px = explorer.playerPos.x;
  let py = explorer.playerPos.y;
  let pz = explorer.playerPos.z;
  const hasLodestone = relicStore.has('lodestone_amulet');
  let insideInterior = hutManager.isInsideHut() || castleInteriorManager.isInsideCastle();
  if (insideInterior !== wasInsideInterior) {
    wasInsideInterior = insideInterior;
    livingWorldManager.setInsideInterior(insideInterior);
    // Force immediate shadow map refresh so hidden exterior castles/turrets never project ghost shadows indoors
    lastShadowX = Number.NaN;
  }

  trollCombatManager.update(dt, elapsedTime, explorer.playerPos, camera.position);
  bgm.setNightDangerMode(
    !insideInterior && (trollCombatManager.isNightNow() || trollCombatManager.hasActiveTrolls()),
    !insideInterior && trollCombatManager.isTrollAggroOnPlayer(explorer.playerPos)
  );
  volcanoManager.update(
    dt,
    elapsedTime,
    explorer.playerPos,
    insideInterior,
    config.cameraMode === 'free'
  );
  assignmentManager.update(dt);

  // Refresh player coordinates & interior state in case trollCombatManager or volcanoManager triggered a respawn
  px = explorer.playerPos.x;
  py = explorer.playerPos.y;
  pz = explorer.playerPos.z;
  insideInterior = hutManager.isInsideHut() || castleInteriorManager.isInsideCastle();

  if (!insideInterior) {
    chunkManager.update(px, py, pz, elapsedTime, false);
    worldMap.updateDiscovery(px, pz, false);
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
    huntingManager.update(dt, elapsedTime, explorer.playerPos);
  } else {
    if (challengeManager.isChallengeActive()) {
      challengeManager.abandonChallenge(false);
    }
    if (landmarkManager.campfireBuffTimer > 0) {
      landmarkManager.campfireBuffTimer = Math.max(0, landmarkManager.campfireBuffTimer - dt);
    }
  }

  // Keep directional sun shadow frustum centered on player in discrete grid steps
  if (
    dirLight.castShadow &&
    (config as { enableShadows?: boolean }).enableShadows !== false
  ) {
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
  }

  // Throttle HUD DOM text mutations to 5 Hz and skip DOM writes when text is unchanged
  if (elapsedTime - lastHudUpdate >= 0.2) {
    lastHudUpdate = elapsedTime;
    const nearest = treasureManager.getNearestChest(explorer.playerPos);
    const hutHint = hutManager.getNearestHutHint(explorer.playerPos);
    const activeCastleVisit = castleInteriorManager.getActiveCastleVisit();
    const nextHint = activeCastleVisit
      ? `🏰 ${activeCastleVisit.name} (Tier ${activeCastleVisit.tier})`
      : hutManager.isInsideHut()
        ? (hutHint ?? '🏠 Inside Dwarven House')
        : nearest
          ? hutHint
            ? `${nearest.label} • ${hutHint}`
            : nearest.label
          : (hutHint ?? 'Explore further!');
    if (nextHint !== lastChestHintText) {
      lastChestHintText = nextHint;
      nearestChestHint.textContent = nextHint;
    }

    // Update compass chest pointer visibility & world bearing at 5 Hz
    const pointerRange = hasLodestone ? 240 : 65;
    const showPointer = Boolean(!insideInterior && nearest && nearest.dist <= pointerRange);
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
      const isTrollNight = trollCombatManager.isNightNow();
      const timeIcon = isTrollNight ? '👹🌙' : hrs >= 6 && hrs < 19 ? '☀️' : '🌙';
      const timeStr = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${timeIcon}`;
      if (timeReadout) {
        timeReadout.textContent = timeStr;
        timeReadout.classList.toggle('night-danger', isTrollNight);
      }
      const nextCoords = `${timeStr} | Pos: (${(qPx * 0.1).toFixed(1)}, ${(qPz * 0.1).toFixed(1)}) | Elev: ${(qPy * 0.1).toFixed(1)}m | Chunks: ${activeChunks}`;
      if (nextCoords !== lastCoordsText) {
        lastCoordsText = nextCoords;
        coordsReadout.textContent = nextCoords;
      }
    }
  }

  // Auto-save player coordinates & camera pose every 2s when changed (skip inside volcano heat zone or while dying)
  if (elapsedTime - lastSaveTime >= 2.0) {
    lastSaveTime = elapsedTime;
    const inHazardOrFreeCam =
      volcanoManager.isDefeatPending() ||
      volcanoManager.isPlayerInHeatZone(px, pz) ||
      config.cameraMode === 'free';
    if (!inHazardOrFreeCam) {
      const movedSq = (px - lastSavedX) * (px - lastSavedX) + (pz - lastSavedZ) * (pz - lastSavedZ);
      if (movedSq > 0.05 || Math.abs(explorer.yaw - lastSavedYaw) > 0.02) {
        persistCurrentProgress();
      }
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

  // Render planar water reflection pass when outdoors
  if (!insideInterior) {
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
  }

  renderer.render(scene, camera);
}

animate();
