import { SavedCastleSite, SavedQuarrySite } from './CastleAndQuarryManager';

const STORAGE_KEY = 'procedural_world_progress_v1';
const SLOT_KEY_PREFIX = 'procedural_world_save_slot_v1_';

export interface SavedBeaconWaypoint {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface SavedDiscoveredHut {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface SavedProgress {
  version: 1;
  savedAt?: number;
  seed: number;
  playerPos: { x: number; y: number; z: number };
  heading: number;
  yaw: number;
  pitch: number;
  distance: number;
  score: number;
  chestsCollected: number;
  artefactsCollected?: number;
  collectedIds: string[];
  unlockedRelics?: string[];
  litBeacons?: SavedBeaconWaypoint[];
  discoveredCells?: number[];
  discoveredHuts?: SavedDiscoveredHut[];
  exploredTrail?: number[];
  quarries?: SavedQuarrySite[];
  castles?: SavedCastleSite[];
  unlockedHouseEquipment?: string[];
  energy?: number;
  foodCount?: number;
  carriedRawStones?: number;
  carriedChiseledBlocks?: number;
  health?: number;
  unlockedArmory?: string[];
  equippedWeapon?: string;
  equippedShield?: string;
  trollsSlain?: number;
}

function parseSavedProgress(raw: string | null): SavedProgress | null {
  try {
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SavedProgress>;
    if (
      data.version !== 1 ||
      typeof data.seed !== 'number' ||
      !data.playerPos ||
      typeof data.playerPos.x !== 'number' ||
      typeof data.playerPos.z !== 'number' ||
      typeof data.score !== 'number' ||
      typeof data.chestsCollected !== 'number' ||
      !Array.isArray(data.collectedIds)
    ) {
      return null;
    }
    return {
      version: 1,
      savedAt: typeof data.savedAt === 'number' ? data.savedAt : Date.now(),
      seed: data.seed,
      playerPos: {
        x: data.playerPos.x,
        y: typeof data.playerPos.y === 'number' ? data.playerPos.y : 0,
        z: data.playerPos.z,
      },
      heading: typeof data.heading === 'number' ? data.heading : 0,
      yaw: typeof data.yaw === 'number' ? data.yaw : 0.35,
      pitch: typeof data.pitch === 'number' ? data.pitch : 0.46,
      distance: typeof data.distance === 'number' ? data.distance : 11.5,
      score: data.score,
      chestsCollected: data.chestsCollected,
      artefactsCollected:
        typeof data.artefactsCollected === 'number' ? data.artefactsCollected : 0,
      collectedIds: data.collectedIds.filter((id): id is string => typeof id === 'string'),
      unlockedRelics: Array.isArray(data.unlockedRelics)
        ? data.unlockedRelics.filter((id): id is string => typeof id === 'string')
        : [],
      litBeacons: Array.isArray(data.litBeacons)
        ? data.litBeacons.filter(
            (b): b is SavedBeaconWaypoint =>
              Boolean(b) &&
              typeof b.id === 'string' &&
              typeof b.name === 'string' &&
              typeof b.x === 'number' &&
              typeof b.y === 'number' &&
              typeof b.z === 'number'
          )
        : [],
      discoveredCells: Array.isArray(data.discoveredCells)
        ? data.discoveredCells.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        : [],
      discoveredHuts: Array.isArray(data.discoveredHuts)
        ? data.discoveredHuts.filter(
            (h): h is SavedDiscoveredHut =>
              Boolean(h) &&
              typeof h.id === 'string' &&
              typeof h.x === 'number' &&
              typeof h.y === 'number' &&
              typeof h.z === 'number'
          )
        : [],
      exploredTrail: Array.isArray(data.exploredTrail)
        ? data.exploredTrail.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        : [],
      quarries: Array.isArray(data.quarries) ? data.quarries : [],
      castles: Array.isArray(data.castles) ? data.castles : [],
      unlockedHouseEquipment: Array.isArray(data.unlockedHouseEquipment)
        ? data.unlockedHouseEquipment.filter((s): s is string => typeof s === 'string')
        : [],
      energy: typeof data.energy === 'number' ? data.energy : 100,
      foodCount: typeof data.foodCount === 'number' ? data.foodCount : 2,
      carriedRawStones: typeof data.carriedRawStones === 'number' ? data.carriedRawStones : 0,
      carriedChiseledBlocks:
        typeof data.carriedChiseledBlocks === 'number' ? data.carriedChiseledBlocks : 0,
      health: typeof data.health === 'number' ? data.health : 100,
      unlockedArmory: Array.isArray(data.unlockedArmory)
        ? data.unlockedArmory.filter((s): s is string => typeof s === 'string')
        : [],
      equippedWeapon: typeof data.equippedWeapon === 'string' ? data.equippedWeapon : 'mallet',
      equippedShield: typeof data.equippedShield === 'string' ? data.equippedShield : 'none',
      trollsSlain: typeof data.trollsSlain === 'number' ? data.trollsSlain : 0,
    };
  } catch {
    return null;
  }
}

export function loadProgress(): SavedProgress | null {
  try {
    return parseSavedProgress(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveProgress(state: SavedProgress): void {
  try {
    state.savedAt = Date.now();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function clearProgress(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}

export function saveProgressToSlot(slot: 1 | 2 | 3, state: SavedProgress): void {
  try {
    state.savedAt = Date.now();
    const serialized = JSON.stringify(state);
    window.localStorage.setItem(`${SLOT_KEY_PREFIX}${slot}`, serialized);
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Ignore storage quota errors
  }
}

export function loadProgressFromSlot(slot: 1 | 2 | 3): SavedProgress | null {
  try {
    return parseSavedProgress(window.localStorage.getItem(`${SLOT_KEY_PREFIX}${slot}`));
  } catch {
    return null;
  }
}
