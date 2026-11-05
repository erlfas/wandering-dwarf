# Mount Doomforge (Volcano) Audit: Key Findings, Performance Issues & Implemented Solutions

This document captures the complete multi-agent architectural, gameplay, audio, UI, and GPU/CPU performance audit of the **Mount Doomforge (`VolcanoManager`)** feature and its integration across **Wandering Dwarf (`procedural-world`)**, along with the implemented solutions verified across the codebase (`npm run build` — 0 TypeScript errors, 0 3D integration violations).

Use this reference both as documentation of the volcano architecture and as a set of **reusable engineering invariants** when adding future colossal landmarks, hazard zones, or ambient audio/VFX systems.

---

## Executive Summary & Resolution Matrix

| ID | Category | Severity | Status | Subsystem / Files | Summary of Issue & Implemented Fix |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **B1** | Gameplay / Map | **Critical** | **Resolved** | `WorldMap.ts`, `VolcanoManager.ts` | Clicking `🌋 Mount Doomforge` on the World Map teleported the player to `(211, 282)` (`47.8m` from crater center) inside the lethal `< 78m` health-burn zone instead of the safe Overlook `(149, 198)` (`152.2m`), and rendered a duplicate `🔥` watchtower pin. **Fixed:** Added `teleportX`/`teleportZ` (`149, 198`), seeded `seenWatchtowers` with `'wt_volcano_rim'`, and expanded `fitToDiscoveredArea()` to include `(VOLCANO_X + 48, VOLCANO_Z + 48)`. |
| **B2** | Main Loop / State | **Critical** | **Resolved** | `main.ts` | `px, py, pz` and `insideInterior` were cached before `trollCombatManager.update()` and `volcanoManager.update()`. Upon death/respawn, the rest of `animate()` streamed chunks, revealed map fog, snapped shadows, and triggered auto-save using stale pre-death coordinates. **Fixed:** Refreshed `px, py, pz` and `insideInterior` immediately after `volcanoManager.update()`. |
| **B3** | Save / Hazard State | **Critical** | **Resolved** | `main.ts`, `VolcanoManager.ts` | The 2-second movement auto-save ran inside the volcano heat zone and during the `1.15s` `defeatRestorePending` window, overwriting the player's safe checkpoint with depleted/zero HP. **Fixed:** Skipped auto-save when `isDefeatPending() || isPlayerInHeatZone(px, pz) || cameraMode === 'free'`, added `MIN_SAFE_VOLCANO_SAVE_DIST = 146.0m` (`sanitizeSafePlayerPos`), recorded `pendingDefeatReason` at death time, and wired `resetHazardState()` / `restoreState()` into Fast-Travel and save loads. |
| **B4** | Terrain Math | **High** | **Resolved** | `TerrainNoise.ts` | $C^0/C^1$ height step discontinuity (up to `1.22m` vertical cliff) at `vDist = VOLCANO_RIM_RADIUS` (`44.0m`) because `- channelCarve` was subtracted outside `44m` but omitted inside `< 44m`, plus missing volcano track fade in `getTrackWeight()`. **Fixed:** Subtracted `channelCarve` from `rimPeakY` inside `< 44m` and moved the `125m..168m` track fade into `getTrackWeight()`. |
| **B5** | Visual / 3D Math | **High** | **Resolved** | `VolcanoManager.ts`, `TerrainNoise.ts` | 1) Coarse `distantConeMesh` chords bridged across `1.65m`-deep carved lava channels (`+0.88m`). 2) `approxMeander` used `baseAngle * 2.0` instead of `angle * 2.0`, shifting lava rivers `7m–13m` off-channel. **Fixed:** Solved implicit meander angle via 2 fixed-point iterations (`solveLavaChannelAngle`), used 3 cross-section vertices per river step, and increased `distantConeMesh` resolution (`96×40`) + channel depression (`-lavaCh * 1.25`). |
| **B6** | Visual / Sorting | **High** | **Resolved** | `VolcanoManager.ts` | 1) Double non-uniform scaling `(1.15, 0.78, 1.15)²` + `FrontSide` backface culling caused `craterGlowOuterMesh` to pop out within `74m`. 2) `smokeInstancedMesh` at `(0,0,0)` vs `craterGlow*Mesh` at `(240,130,320)` flipped transparent sort order at `dist = 200m`. **Fixed:** Used `.scale.setScalar(glowScale)` + `THREE.DoubleSide`, uniform smoke ascent speed (`0.038`), and deterministic `renderOrder` (`10..14`). |
| **B7** | World Exclusions | **High** | **Resolved** | `ForestField.ts`, `TreasureManager.ts`, `LandmarkManager.ts`, `CastleAndQuarryManager.ts`, `LivingWorldManager.ts`, `ChallengeManager.ts`, `TrollCombatManager.ts`, `HuntingAndDeerManager.ts` | Missing or inconsistent volcano exclusion radii allowed Runestones, Dig Sites, Birds, Rabbits, Star-Fragments, Goblins, Trial Archways, Coins, and Night Trolls to spawn inside the caldera/heat zone, and desynced bridge PRNG between `WorldMap.ts` and `LandmarkManager.ts`. **Fixed:** Enforced `isInsideVolcanoBarrenZone(wx, wz)` (`158m`) across all spawners and synced `WorldMap.computeChunkDeterministicPOIs()`. |
| **B8** | Audio Lifecycle | **High** | **Resolved** | `BackgroundMusic.ts`, `VolcanoManager.ts`, `style.css` | 1) Startup `tryPlay()` promise was aborted (`AbortError`) if frame 1 switched tracks. 2) `setVolume(vol > 0)` unmuted flags without resuming playback. 3) `VolcanoManager.reset()` did not pause SFX. **Fixed:** Guarded pending `isPlayPending` promises in `BackgroundMusic.ts`, resumed active track on `setVolume(vol > 0)`, paused SFX in `reset()`/`restoreState()`, and reused a single toast DOM node. |
| **P1** | GPU / Reflection | **High** | **Resolved** | `main.ts`, `WaterMesh.ts`, `VolcanoManager.ts` | `volcanoManager.group` was omitted from `waterReflection.excludeFromReflection`, submitting 7 draw calls and `~38,600` triangles into every 512×512 planar water reflection pass beyond `vCam.far = 78m`. **Fixed:** Added `volcanoManager.group` to `waterReflection.excludeFromReflection`. |
| **P2** | GPU / Frustum & Vertex | **High** | **Resolved** | `VolcanoManager.ts` | 1) `frustumCulled = false` on all 7 meshes rendered the volcano behind the camera. 2) Unwelded `IcosahedronGeometry(1, 1)` smoke puffs processed `91,200` non-indexed vertices/frame. **Fixed:** Enabled `frustumCulled = true` with explicit world-space `boundingSphere`s and welded smoke lobes via `mergeVertices(rawIco, 1e-3)` (**82.5% reduction**: `91,200 → 15,960` vertices/frame). |
| **P3** | CPU / Per-Frame Update | **Medium** | **Resolved** | `VolcanoManager.ts`, `CastleAndQuarryManager.ts`, `WorldMap.ts` | 1) `VolcanoManager.update()` ran 236 particle matrix/color updates and 4 WebGL buffer uploads even when `insideInterior === true`. 2) `rumbleAudio` properties were written at 60 Hz without epsilon guards. 3) `applyVolcanicHazard` allocated objects per frame. **Fixed:** Skipped visual updates indoors, distance-culled embers at `340m`, replaced `Math.pow` with `sqrt`, added `0.004` audio epsilon guards, and reused `hazardEvalResult`. |
| **P4** | CPU / Startup & Hot Path | **Medium** | **Resolved** | `VolcanoManager.ts`, `TerrainNoise.ts` | 1) `buildDistantVolcanoCone()` called `noise.getNormal()` (4× `getHeight`) per vertex at startup. 2) `TerrainNoise.getHeight()` called `Math.sqrt(vDistSq)` 3× and `Math.atan2` 2× per vertex. **Fixed:** Computed polar grid finite-difference normals on `distantConeMesh` (0 `getNormal()` calls) and computed `vDist` and `angle` once per `getHeight()` call. |

---

## 1. Critical Gameplay, Respawn & World Map Bugs

### B1. World Map Fast-Travel Pin Teleports Player Into Lethal Crater Heat (`dist = 47.8m`) & Spawns Duplicate Watchtower Pin
- **Locations:**
  - `src/ui/WorldMap.ts` (lines 1435, 1564–1582, 1677–1700, 1973–1981)
  - `src/world/VolcanoManager.ts` (lines 975–987)
- **Root Cause:**
  1. When the player approaches within `168m` of the volcano, `VolcanoManager.ts:977–986` unlocks beacon `'wt_volcano_rim'` (`"🌋 Mount Doomforge Overlook"`) at safe coordinates `overlookX = VOLCANO_X - 91.0` (`149`), `overlookZ = VOLCANO_Z - 122.0` (`198`), which is at **`dist = 152.2m`** (safely outside `VOLCANO_HEAT_HAZARD_RADIUS = 132.0m`).
  2. However, in `WorldMap.ts:1682–1699`, the `mount_doomforge_volcano` interactive pin computes:
     ```ts
     const rimTargetX = Math.round(VOLCANO_X - (VOLCANO_RIM_RADIUS + 4.0) * 0.6); // 211
     const rimTargetZ = Math.round(VOLCANO_Z - (VOLCANO_RIM_RADIUS + 4.0) * 0.8); // 282
     ```
     Coordinate `(211, 282)` is only **`47.8m` from the crater center**—inside the `< 78m` severe immediate health-burn zone (`VolcanoManager.ts:888`), immediately draining ~45+ HP/s and killing the player upon teleporting!
  3. Because `'wt_volcano_rim'` is stored in `landmarkManager.getLitBeacons()` and is not a chunk watchtower, `seenWatchtowers.has('wt_volcano_rim')` in `WorldMap.ts:1565` is `false`, causing the map to draw **both** a generic `🔥` Watchtower pin at `(149, 198)` and the `🌋` Volcano pin at `(240, 320)`.
  4. Additionally, `WorldMap.fitToDiscoveredArea()` (`lines 480–485`) expands bounds around `'wt_volcano_rim'` at `(149 ± 48, 198 ± 48)` = `(197, 246)`, clipping off the `🌋` icon at `(240, 320)`.
- **Solution:**
  - Add optional `teleportX?: number; teleportZ?: number` to `InteractiveMapMarker` (`WorldMap.ts:88–114`) and use `hit.teleportX ?? hit.worldX, hit.teleportZ ?? hit.worldZ` in `handleCanvasClick` (`line 1979`).
  - Keep `mount_doomforge_volcano`'s display coordinates at `worldX: VOLCANO_X, worldY: VOLCANO_PEAK_HEIGHT, worldZ: VOLCANO_Z` (so hover tooltips report accurate distance to the volcano peak) while setting `teleportX: Math.round(VOLCANO_X - 91.0), teleportZ: Math.round(VOLCANO_Z - 122.0)`.
  - Seed `const seenWatchtowers = new Set<string>(['wt_volcano_rim']);` at `WorldMap.ts:1435` to suppress the duplicate watchtower pin, and include `(VOLCANO_X + 48, VOLCANO_Z + 48)` in `fitToDiscoveredArea()` when `'wt_volcano_rim'` is unlocked.

### B2. Stale `px, py, pz` Used After Troll or Volcano Respawn in `animate()`
- **Location:** `src/main.ts` (lines 1328–1371, 1379–1400, 1461–1502)
- **Root Cause:**
  `const px = explorer.playerPos.x, py = explorer.playerPos.y, pz = explorer.playerPos.z` are captured at lines 1328–1330 **before** `trollCombatManager.update(...)` (line 1340) and `volcanoManager.update(...)` (line 1345). When either manager triggers player defeat and calls `applyLoadedGameState(saved)` or `restartNewGame()`, `explorer.playerPos` is moved to the respawn point and `chunkManager.rebuildAll(...)` rebuilds chunks there. However, the remainder of the current frame in `animate()` continues using the stale pre-respawn `px, py, pz` (inside the volcano crater):
  - `chunkManager.update(px, py, pz, ...)` (line 1349) immediately streams volcano chunks back in.
  - `worldMap.updateDiscovery(px, pz, false)` (line 1350) appends a breadcrumb trail line from the respawn point back into the crater.
  - Directional shadow frustum (`sx, sy, sz` at lines 1379–1400) snaps to the crater instead of the respawn location.
  - The 2-second movement auto-save (`movedSq` at line 1498) compares stale `px, pz` against the newly restored `lastSavedX, lastSavedZ` and immediately overwrites the save.
- **Solution:**
  Declare `let px = explorer.playerPos.x; let py = explorer.playerPos.y; let pz = explorer.playerPos.z;` and refresh them from `explorer.playerPos` immediately after `volcanoManager.update(...)` at line 1346.

### B3. Auto-Save Overwrites Safe Checkpoint Inside Heat Zone, Unprotected `1.15s` Death Window & Missing Reset on Fast-Travel / Load
- **Locations:**
  - `src/main.ts` (lines 168–186, 312–341, 369–382, 681–738, 776–812, 946–1036, 1496–1502)
  - `src/world/VolcanoManager.ts` (lines 697–703, 837–866, 918–927, 975–987)
  - `src/controls/ExplorerCamera.ts` (lines 540–546)
- **Root Causes:**
  1. **2-Second Auto-Save Overwrites Safe Checkpoint & Saves Depleted HP:** While walking inside `VOLCANO_HEAT_HAZARD_RADIUS` (`132m`) or during the `1.15s` `defeatRestorePending` countdown, `animate()` (`main.ts:1496`) calls `persistCurrentProgress()` every 2 seconds. `populateSaveState()` clamps `playerPos` to `156m` and saves the player's drained `health` (even `health = 0` during `defeatRestorePending`!) and `energy = 0`, erasing the player's actual pre-volcano checkpoint.
  2. **Overlook (`152.2m`) vs. `minSafeSaveDist` (`156.0m`) Contradiction:** `wt_volcano_rim` is at `dist = 152.2m`, but `populateSaveState()` and `onPlayerDiedInVolcano` push positions inside `< 156.0m` out to `156.0m`. Thus, saving at the Overlook warps the saved position away from the Overlook, and respawning at `156.0m` after `volcanoManager.reset()` immediately re-triggers the `"🌋 Approaching Mount Doomforge!"` toast (`<= 235m`) and re-fires `onDiscoverCalderaRim` (`<= 168m`) on the very next frame!
  3. **Wrong Death Reason (`'bottom'` vs `'heat'`):** `VolcanoManager.ts:842` evaluates `dist <= VOLCANO_RIM_RADIUS ? 'bottom' : 'heat'` *when the 1.15s timer expires* rather than recording the cause at the moment of death. Dying of heat on the rim crest (`35.5m < dist <= 44m`) wrongly reports `'bottom'`.
  4. **Fast-Travel, Startup Load, and Troll Respawn Miss Volcano Sanitization:**
     - Fast-traveling (`main.ts:168–186`) does not call `volcanoManager.resetHazardState()`. Teleporting away during the `1.15s` death countdown yanks the player back 1 second after arriving at Spawn Valley.
     - Initial startup load (`main.ts:692, 730`) and `applyLoadedGameState` (`main.ts:966`) do not sync `hasDiscoveredRimWaypoint` from `landmarkManager.isBeaconLit('wt_volcano_rim')` or clamp `playerPos` outside the heat zone.
     - Free-fly camera mode (`ExplorerCamera.ts:540`, `Shift+V`) moves `playerPos` with the camera while `volcanoManager.update()` still runs hazard drain, killing the player while flying the camera over the crater.
- **Solutions:**
  - Record `private pendingDefeatReason: 'bottom' | 'heat' = 'heat'` when `defeatRestorePending = true` is set.
  - Skip the periodic 2-second auto-save in `main.ts:1496` whenever `volcanoManager.isDefeatPending() || volcanoManager.isPlayerInHeatZone(px, pz)`.
  - Change `minSafeSaveDist` to `VOLCANO_HEAT_HAZARD_RADIUS + 14.0` (`146.0m`, so the `152.2m` Overlook is outside the clamp radius), extract a shared `sanitizeSafePlayerPos(pos)` helper used in startup load, `applyLoadedGameState`, Troll defeat, and Volcano defeat, and add `volcanoManager.restoreState(isRimLit, playerPos)` so respawning/loading does not re-fire the approach toast or BGM restart.
  - Call `volcanoManager.resetHazardState()` inside the `landmarkManager` teleport callback (`main.ts:173`) and pass `insideInterior || explorer.config.cameraMode === 'free'` to `volcanoManager.update()`.

---

## 2. Terrain Math, 3D Geometry & Visual Bugs

### B4. $C^0/C^1$ Height & Normal Discontinuity at `vDist = VOLCANO_RIM_RADIUS` (`44.0m`)
- **Location:** `src/world/TerrainNoise.ts` (lines 492–519, 534–545)
- **Root Cause:**
  - In the outer cone branch (`vDist >= VOLCANO_RIM_RADIUS`, lines 492–507), at `vDist = 44.0m` (`u = 1.0`), `lavaChannel = this.getVolcanoLavaChannelWeight(vdx, vdz, 44.0)` is up to `0.7407` (since `smoothstep(44, 36, 48) = 0.7407`), so `channelCarve = lavaChannel * 1.65` carves up to **`1.22m`** out of `volcanoElev` right at `vDist = 44.0m`.
  - Immediately inside the rim (`vDist < VOLCANO_RIM_RADIUS`, lines 508–519), `rimPeakY` is computed as `VOLCANO_PEAK_HEIGHT + ribWave * 1.8 + micro * 1.15`—**omitting `- channelCarve` entirely**!
  - This creates an abrupt `1.22m` vertical cliff step at `r = 44.0m` across all 4 lava channels and corrupts finite-difference surface normals along the caldera rim.
  - Additionally, `TerrainNoise.getTrackWeight()` (`lines 252–301`) lacks the volcano radial fade (`125m..168m`) used in `getHeight()` (`lines 460–469`), causing `WorldMap.ts:930` to draw brown footpaths up the outer volcano cone (`140m..196m`) where no 3D footpath exists.
- **Solution:**
  - Include `- channelCarve` in `rimPeakY` inside the `< VOLCANO_RIM_RADIUS` branch (fading it out with `1.0 - innerT`):
    ```ts
    const lavaChannel = this.getVolcanoLavaChannelWeight(vdx, vdz, vDist, angle);
    const channelCarve = lavaChannel * 1.65 * (1.0 - innerT);
    const rimPeakY = VOLCANO_PEAK_HEIGHT + ribWave * 1.8 - channelCarve + micro * 1.15;
    ```
  - Move the `125m..168m` volcano track fade directly into `TerrainNoise.getTrackWeight()` so 3D terrain height, surface color, prop exclusions, and 2D WorldMap tiles share the exact same track termination.

### B5. `distantConeMesh` Buries Flank Lava Rivers (`+0.88m`) & Meander Angle Formula Shifts Rivers `7m–13m` Off-Channel
- **Locations:** `src/world/VolcanoManager.ts` (lines 267–307, 409–436, 567–569) & `src/world/TerrainNoise.ts` (lines 540–542)
- **Root Cause:**
  1. **Chord Bridging Over Lava Channels:** `TerrainNoise.getHeight()` carves `1.65m`-deep, `4m`-wide lava trenches, and `lavaSurfaceMesh` sits on the trench bed (`trenchFloor + 0.22m`, or `~1.49m` below the uncarved banks). However, `distantConeMesh` has `angularSegs = 60` (`10.5m` step at `r = 100m`) and depresses vertices by only `chunkOverlapOffset = -0.45 - 0.35 * rFrac` (`~ -0.6m`). Its coarse triangle chords bridge bank-to-bank across the `1.65m` trench at `bankHeight - 0.6m`—burying `lavaSurfaceMesh` and poking **`+0.88m` above** loaded `TerrainChunk` lava channels (and up to `+0.98m` on the convex inner crater wall where `chunkOverlapOffset` is only `-0.15m`).
  2. **Meander Angle Math Mismatch:** `TerrainNoise.getVolcanoLavaChannelWeight()` defines the channel centerline where `angle + Math.sin(r * 0.055 + angle * 2.0) * 0.24 = baseAngle`. In `VolcanoManager.ts:413` and `568`, `approxMeander` substitutes `baseAngle * 2.0` instead of `angle * 2.0`, shifting the 3D lava river ribbons and Tier-2 vent flames **`7m–13m` laterally** off the carved terrain channels!
- **Solution:**
  - Solve the implicit meander angle with 2 fixed-point iterations in `buildMoltenLavaAndGlow()` and `buildRoaringFlames()`:
    ```ts
    let centerAngle = baseAngle - Math.sin(r * 0.055 + baseAngle * 2.0) * 0.24;
    centerAngle = baseAngle - Math.sin(r * 0.055 + centerAngle * 2.0) * 0.24;
    centerAngle = baseAngle - Math.sin(r * 0.055 + centerAngle * 2.0) * 0.24;
    ```
  - Use 3 cross-sectional vertices (`-halfWidth`, `0`, `+halfWidth`) per length step on the lava river ribbons, and deepen `chunkOverlapOffset` on `distantConeMesh`:
    ```ts
    const lavaCh = this.noise.getVolcanoLavaChannelWeight(lx, lz, r);
    const chunkOverlapOffset =
      r >= VOLCANO_RIM_RADIUS - 3.0 ? -1.15 - 0.45 * rFrac - lavaCh * 1.25 : -0.95;
    ```

### B6. Sky-Glow Double Scaling, Backface-Culling Pop & Transparent Draw-Order Flip
- **Location:** `src/world/VolcanoManager.ts` (lines 469–498, 518–525, 607–614, 672–674, 718–722)
- **Root Cause:**
  1. `outerGlowGeo.scale(1.15, 0.78, 1.15)` (line 470) scales the geometry in-place, and `update()` (line 719) scales `craterGlowOuterMesh.scale` by `(1.15, 0.78, 1.15)` a second time (`74.06m` radius). Because `craterGlowOuterMat` uses default `side: THREE.FrontSide`, when the camera moves within `74m` of the crater, it crosses inside the sphere and the entire sky-glow dome **pops out of existence** in a single frame.
  2. `craterGlowOuterMesh` and `craterGlowInnerMesh` are positioned at `(240, 130, 320)`, whereas `smokeInstancedMesh`, `flameInstancedMesh`, and `emberPoints` leave `.position` at `(0, 0, 0)` with world offsets baked into their instance matrices. When the player crosses `dist = 200m` (equidistant between `(0,0,0)` and `(240,320)`), Three.js's back-to-front transparent sort flips `craterGlow*Mesh` from behind `smokeInstancedMesh` to in front of it!
- **Solution:**
  - Apply the `(1.15, 0.78, 1.15)` aspect ratio once on `outerGlowGeo` and use `this.craterGlowOuterMesh.scale.setScalar(glowScale)` in `update()`, with `side: THREE.DoubleSide` (or smooth camera-proximity opacity fade).
  - Assign explicit deterministic `renderOrder` values (`craterGlowOuterMesh = 10`, `craterGlowInnerMesh = 11`, `smokeInstancedMesh = 12`, `flameInstancedMesh = 13`, `emberPoints = 14`).

---

## 3. Missing or Mismatched Volcano Exclusion Zones Across World Systems (B7)

Mount Doomforge defines five concentric radii in `TerrainNoise.ts` and `VolcanoManager.ts`:
- `VOLCANO_CRATER_RADIUS = 32.0m` (molten magma lake at `y = 89.5m`, terrain floor at `y = 85.0m`)
- `VOLCANO_RIM_RADIUS = 44.0m` (caldera peak rim at `y = 118.0m`)
- `VOLCANO_HEAT_HAZARD_RADIUS = 132.0m` (scorching heat drains Strength & Health)
- `VOLCANO_BARREN_RADIUS = 158.0m` (barren basalt/ash boundary; grass, trees, and water suppressed)
- `VOLCANO_OUTER_RADIUS = 196.0m` (outermost mountain foot)

Several world managers either omit volcano exclusion checks or only exclude `VOLCANO_RIM_RADIUS` (`44m–50m`), causing entities and structures to spawn inside the lethal heat zone (`44m..132m`) or on the floor of the molten caldera (`y = 85m > waterLevel`):

| File | Lines | Current Check | Issue & Required Fix |
| :--- | :--- | :--- | :--- |
| `src/world/ForestField.ts` | `1150–1171`, `1495–1590` | Trees: `158m`. Track props: `125m`. | Woodland Ferns, Exposed Tree Roots, and Cobbles spawn inside the barren ash & lethal heat zone (`125m..158m`). **Fix:** Skip track props and mossy shoreline boulders when `noise.isInsideVolcanoBarrenZone(wx, wz)` is true. |
| `src/world/TreasureManager.ts` & `src/ui/WorldMap.ts` | `954`, `993–1000`, `1075–1085`; `WorldMap.ts:1166` | Chests: `48m`. Runestones & Dig Sites: **None (`0m`)**. | Chests spawn on lethal lava channels (`48m..158m`); Mythic Runestones (`±20m`) and Buried Dig Sites (`±84m`) spawn inside the molten lava lake (`< 44m`). **Fix:** Exclude `isInsideVolcanoBarrenZone(wx, wz)` (`158m`) for chests (in both `TreasureManager` and `WorldMap`), runestones, and buried dig sites. |
| `src/world/LandmarkManager.ts` & `src/ui/WorldMap.ts` | `951–1027`; `WorldMap.ts:1070–1143` | Chunk center `< 158m` | 1) **PRNG Desync:** `LandmarkManager.ts:955` returns *before* bridge evaluation when `inVolcanoBarren` is true, whereas `WorldMap.ts:1070` evaluates bridges *before* checking `!inVolcanoBarren`. 2) Campfires/watchtowers in border chunks (`158m..175m`) jitter by `±23m` inside `< 158m`. **Fix:** Guard bridges with `!inVolcanoBarren` in `WorldMap.ts` and reject candidate `(wx, wz)` inside `isInsideVolcanoBarrenZone(wx, wz)`. |
| `src/world/CastleAndQuarryManager.ts` | `3295`, `4524` | Castles/Quarries: `50m`. Natural rocks: `47m`. | Players can build Castles/Quarries and gather stones inside the lethal heat zone (`50m..132m`). **Fix:** Increase placement and rock exclusion to `VOLCANO_BARREN_RADIUS` (`158m`). |
| `src/world/LivingWorldManager.ts` | `634–785`, `933` | **None (`0m`)** | Birds, Forest Spirit Rabbits, Star-Fragments, and Goblin Cutpurses spawn on the volcano cone and on the terrain floor underneath the molten lava lake (`y = 85m`). **Fix:** Reject chunk/entity spawns and rabbit/goblin patrol targets where `this.noise.isInsideVolcanoBarrenZone(x, z)` is true. |
| `src/world/ChallengeManager.ts` | `749–950` | **None (`0m`)** | Attempt 13 fallback forces `foundTrack = true` anywhere in a trackless chunk, spawning footpath coins inside the molten caldera; Ring Sprint Trial Archways and downhill rings also lack volcano checks. **Fix:** Reject coin, archway, and ring coordinates inside `isInsideVolcanoBarrenZone(x, z)`. |
| `src/world/TrollCombatManager.ts` | `740–784`, `1120–1208` | **None (`0m`)** | Night Trolls spawn on the volcano slopes/caldera (`sy > waterLevel + 0.45`) and chase the player into lava. **Fix:** Reject spawn candidates and turn trolls back at `VOLCANO_BARREN_RADIUS` (`158m`). |
| `src/world/HuntingAndDeerManager.ts` | `983`, `1052` | `250m` (`285m` turn-back) | When turning back at `285m`, `d.homePos.set(nextX, d.pos.y, nextZ)` runs *before* checking `if (nextY > minLandY)`, which can place `homePos` in a river/pond. **Fix:** Move `d.homePos.set(...)` inside `if (nextY > minLandY)`. |

---

## 4. Audio Lifecycle & UI Issues (B8)

### B8.1 `BackgroundMusic.tryPlay()` Promise Aborted by Frame-1 Track Switch (`AbortError`)
- **Location:** `src/audio/BackgroundMusic.ts` (lines 94, 261–283, 333–339, 378–388)
- **Root Cause:**
  In `BackgroundMusic` constructor (line 94), `this.tryPlay()` calls `this.audio.play()` and sets `this.isPlayPending = true` while `this.isStarted` is still `false`. Before that promise settles, the first `animate()` frame calls `bgm.setNightDangerMode(...)` and `volcanoManager.update() -> bgm.setVolcanoProximity(...)`. If the player spawned/loaded near the volcano (`<= 235m`) or at night, `setVolcanoProximity(true)` (line 333) or `setNightDangerMode(true)` (line 378) immediately calls `this.audio.pause()` while `this.audio.play()` is still pending! Calling `.pause()` on a pending `.play()` rejects the promise with `AbortError`, setting `this.isPlayPending = false` and leaving `this.isStarted = false` so neither track plays.
- **Solution:**
  In `setVolcanoProximity` and `setNightDangerMode`, if `this.isPlayPending` is `true`, do not call `.pause()` on the pending element—`tryPlay().then(...)` (lines 271–275) already re-evaluates `const currentDesired = this.getActiveTrack(); this.pauseInactiveTracks(currentDesired);` and starts `currentDesired` seamlessly once the promise resolves.

### B8.2 `BackgroundMusic.setVolume()` Unmutes Flags Without Resuming Paused Track
- **Location:** `src/audio/BackgroundMusic.ts` (lines 453–473) & `src/style.css` (lines 634–650)
- **Root Cause:**
  `toggleMute()` pauses all 4 `HTMLAudioElement`s. Adjusting volume later via `setVolume(vol > 0)` sets `this.isMuted = false` and updates the UI badge to playing, but never calls `active.play()`. Also, `#music-toggle.volcano-omen` sets an orange `box-shadow` in `src/style.css:638` that `#music-toggle.paused` (`line 646`) does not clear (`box-shadow: none`).
- **Solution:**
  When `setVolume(vol > 0)` transitions `this.isMuted` from `true` to `false`, resume `this.getActiveTrack().play()` (or call `this.tryPlay()`). In `BackgroundMusic.ts:499–500`, only toggle `.volcano-omen` / `.night-danger` when audio is actively playing, and add `box-shadow: none;` to `#music-toggle.paused` in `src/style.css`.

### B8.3 Unpaused Volcano SFX on `reset()`, Late Blob URL Swap & Toast DOM Stacking
- **Location:** `src/world/VolcanoManager.ts` (lines 222–245, 697–703, 994–1051)
- **Root Cause:**
  1. `VolcanoManager.reset()` does not pause `this.rumbleAudio` or `this.lavaVentsAudio`.
  2. If `fetch(volcanoRumbleSfxUrl)` resolves while `rumbleAudio` is already playing (`!this.rumbleAudio.paused`), `this.rumbleBlobUrl` is never assigned to `this.rumbleAudio.src` even when `rumbleAudio` later pauses.
  3. `showToast()` appends a new `.pickup-toast` DOM element every 3.2s with untracked `setTimeout` timers.
- **Solution:**
  Pause both SFX elements in `reset()`, swap in `rumbleBlobUrl` / `ventsBlobUrl` whenever the audio element is paused and `src !== blobUrl`, and reuse a single tracked toast element/timer in `VolcanoManager`.

---

## 5. GPU, Shader & Main-Thread Performance Optimizations (P1–P4)

### P1. Exclude `volcanoManager.group` From the 512×512 Planar Water Reflection Pass
- **Locations:** `src/main.ts` (lines 540–549) & `src/world/WaterMesh.ts` (line 347)
- **Impact:** Eliminates **7 draw calls and ~38,600 triangles** (`91,200` vertices) from every 30 Hz water reflection render pass.
- **Root Cause:**
  The planar water reflection virtual camera clamps `vCam.far = 78.0m` (`WaterMesh.ts:347`), and all rivers/ponds are suppressed inside `VOLCANO_BARREN_RADIUS = 158.0m`. Thus, whenever any water is near the player, Mount Doomforge is `> 158m` away—completely beyond `vCam.far = 78.0m`. Because `volcanoManager.group` is not in `waterReflection.excludeFromReflection` and all 7 volcano meshes have `frustumCulled = false`, WebGL transforms all ~38,600 volcano triangles in every reflection pass only for 100% of them to be clipped by the far plane.
- **Solution:**
  Add `volcanoManager.group` to `waterReflection.excludeFromReflection` in `src/main.ts:540`.

### P2. Enable Frustum Culling (`boundingSphere`) & Weld `IcosahedronGeometry` Smoke Puffs (`91,200 → 15,960` Vertices)
- **Location:** `src/world/VolcanoManager.ts` (lines 61–95, 101–142, 353, 449, 464, 481, 496, 523, 612, 673)
- **Impact:** **82.5% vertex reduction** on the smoke plume (`75,240` fewer vertex shader executions per frame) and **0 volcano draw calls** when the camera faces away from `(240, 320)`.
- **Root Cause:**
  1. All 7 volcano meshes set `frustumCulled = false`, violating the project rule in `.agents/skills/integrate-3d-model/SKILL.md`.
  2. `new THREE.IcosahedronGeometry(1.0, 1)` returns a non-indexed buffer of `240` vertices (`80` triangles) per lobe. Merging 5 lobes without welding produces `1,200` vertices per puff $\times 76$ instances = **`91,200` vertices** submitted every frame.
  3. `createOminousSmokePuffGeometry()`, `createFlameTongueGeometry()`, and `ribGeo` call `.computeVertexNormals()` even though they use `THREE.MeshBasicMaterial` (which does not use normals), and `distantConeMesh` sets `receiveShadow = true` without a `customProgramCacheKey` even though the 48m player shadow frustum never reaches the distant cone when unloaded.
- **Solution:**
  - In `createOminousSmokePuffGeometry()`, delete `normal` and `uv` attributes and weld each lobe with `mergeVertices(ico, 1e-3)` (`240 → 42` vertices per lobe; `1,200 → 210` vertices per puff).
  - Remove unused `normal`/`uv` attributes on all `MeshBasicMaterial` geometries, set `distantConeMesh.receiveShadow = false`, and add `mat.customProgramCacheKey = () => 'volcano_distant_cone_v1'`.
  - Set `frustumCulled = true` on all 7 meshes and assign explicit world-space `boundingSphere`s to `flameInstancedMesh`, `smokeInstancedMesh`, and `emberPoints.geometry`.

### P3. Skip Per-Frame Buffer Uploads Indoors, Distance-Cull Embers & Throttle 60 Hz Audio Property Writes
- **Locations:** `src/world/VolcanoManager.ts` (lines 705–822, 896–910, 1013–1038) & `src/world/CastleAndQuarryManager.ts` (lines 3060–3085)
- **Root Cause:**
  1. When `insideInterior === true`, `volcanoManager.group.visible` is `false`, yet `VolcanoManager.update()` still computes all 40 flame matrices, 76 smoke matrices + colors (`228` `Math.pow` calls), and 120 ember positions and flags 4 WebGL buffer uploads (`needsUpdate = true`) every frame.
  2. `emberPoints` (`size: 2.6`) updates and uploads `120` points every frame even when the player is `> 350m` away where crater embers are sub-pixel.
  3. Within `395m` of the volcano (which includes nearly the entire starting area around `(0,0)` at `400m`!), `updateVolcanoAudioAndTune()` assigns `rumbleAudio.volume` and `rumbleAudio.playbackRate` at 60 Hz even when the player is standing still, forcing continuous browser audio resampler recalculations.
  4. `CastleAndQuarryManager.applyVolcanicHazard()` allocates a new `{ defeated, remainingEnergy, remainingHealth }` heap object every frame inside `< 132m` and is called twice per frame when `remainingEnergy <= 0.01`.
- **Solution:**
  - Guard visual animation and GPU buffer uploads in `VolcanoManager.update()` behind `if (!insideInterior && this.group.visible)`.
  - Set `this.emberPoints.visible = dist <= 340.0` and skip ember CPU/GPU updates beyond `340m`. Replace `Math.pow(p, ...)` in the smoke loop with fast polynomial/sqrt approximations.
  - Cache `lastRumbleVol`, `lastRumbleRate`, `lastVentsVol`, `lastVentsRate` and only write to `HTMLAudioElement.volume` / `.playbackRate` when the value changes by `> 0.004`.
  - Reuse a pre-allocated `hazardResult` member object in `CastleAndQuarryManager`.

### P4. Eliminate Redundant `getHeight` / `Math.sqrt` / `Math.atan2` Evaluations in Startup & Terrain Hot Paths
- **Locations:** `src/world/VolcanoManager.ts` (lines 283–307) & `src/world/TerrainNoise.ts` (lines 369, 379, 467, 485–486, 540)
- **Root Cause:**
  1. `buildDistantVolcanoCone()` iterates over `31 × 61 = 1,891` vertices and calls `this.noise.getHeight(wx, wz, true)` plus `this.noise.getNormal(wx, wz, tempNormal)` (4 more `getHeight` calls with `skipTracks = false`) at each vertex = **`9,455` full noise evaluations** synchronously at startup. It also passes `wy` (including `chunkOverlapOffset`) instead of the true surface height `wy - chunkOverlapOffset` to `getSurfaceColor()`.
  2. Inside `VOLCANO_OUTER_RADIUS_SQ`, `TerrainNoise.getHeight(x, z)` calls `Math.sqrt(vDistSq)` up to **3 times** (lines 379, 467, 485) and `Math.atan2(vdz, vdx)` **twice** (lines 486, 540) per vertex.
- **Solution:**
  - In `TerrainNoise.getHeight()`, compute `const vDist = insideVolcano ? Math.sqrt(vDistSq) : 0;` once after line 369 and pass the precomputed `angle` into `getVolcanoLavaChannelWeight(vdx, vdz, vDist, angle)`.
  - In `buildDistantVolcanoCone()`, pass the true un-offset height `trueWy` into `getSurfaceColor()`, and add a `rebuildGeometry()` method so `DebugOverlay` seed/noise changes also keep `distantConeMesh` and `lavaSurfaceMesh` in sync.

---

## 6. Reusable Checklist for Future Colossal Landmarks & Hazard Zones

When adding any new large-scale world landmark or environmental hazard in future work:
1. **Single Source of Truth for Exclusion Radii:** Use `TerrainNoise.isInside...Zone(wx, wz)` across *all* chunk spawners (`GrassField`, `ForestField`, `TreasureManager` [chests + runestones + dig sites], `LandmarkManager`, `WorldMap`, `CastleAndQuarryManager`, `LivingWorldManager`, `ChallengeManager`, `TrollCombatManager`, `HuntingAndDeerManager`). Check both chunk centers and jittered candidate coordinates.
2. **Keep `WorldMap.ts` Deterministic PRNG in Lockstep with 3D Managers:** Any early-return added to `LandmarkManager` or `TreasureManager` must be mirrored at the exact same point in `WorldMap.computeChunkDeterministicPOIs()`.
3. **Separate Map Pin Display Coordinates from Safe Teleport Coordinates:** Dangerous landmarks (`🌋 Mount Doomforge`) should display their pin at the landmark center `(VOLCANO_X, VOLCANO_Z)` while routing fast-travel clicks (`teleportX, teleportZ`) to a safe overlook outside the hazard radius.
4. **Protect Save State & Main Loop Order Around Respawn Callbacks:**
   - Never auto-save while the player is inside an active environmental hazard zone or while a defeat countdown timer is pending.
   - Always refresh local `px, py, pz` coordinates in `animate()` after running hazard/combat managers that can respawn the player.
   - Reset hazard timers on Fast-Travel, save load, and free-fly camera mode (`cameraMode === 'free'`).
5. **Enforce Three.js Rendering Invariants (`.agents/skills/integrate-3d-model/SKILL.md`):**
   - Always assign world-space `boundingSphere`s to `InstancedMesh` / `Points` and keep `frustumCulled = true`.
   - Exclude distant or high-triangle landmark groups from `waterReflection.excludeFromReflection`.
   - Skip per-frame instance matrix/attribute animations and `needsUpdate = true` uploads when `insideInterior === true`.
   - Weld procedural multi-lobe geometries with `mergeVertices` and strip unused `normal`/`uv` attributes on `MeshBasicMaterial` meshes.
