const STORAGE_KEY = 'procedural_world_progress_v1';

export interface SavedProgress {
  version: 1;
  seed: number;
  playerPos: { x: number; y: number; z: number };
  heading: number;
  yaw: number;
  pitch: number;
  distance: number;
  score: number;
  chestsCollected: number;
  collectedIds: string[];
}

export function loadProgress(): SavedProgress | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
      collectedIds: data.collectedIds.filter((id): id is string => typeof id === 'string'),
    };
  } catch {
    return null;
  }
}

export function saveProgress(state: SavedProgress): void {
  try {
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
