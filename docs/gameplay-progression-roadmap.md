# Gameplay Review & Progression Roadmap (Ideas 1–7)

A comprehensive gameplay evaluation and progression roadmap across all core world and player systems ([`AssignmentManager.ts`](../src/world/AssignmentManager.ts), [`CastleAndQuarryManager.ts`](../src/world/CastleAndQuarryManager.ts), [`CastleInteriorManager.ts`](../src/world/CastleInteriorManager.ts), [`TrollCombatManager.ts`](../src/world/TrollCombatManager.ts), [`HutManager.ts`](../src/world/HutManager.ts), [`TreasureManager.ts`](../src/world/TreasureManager.ts), [`ChallengeManager.ts`](../src/world/ChallengeManager.ts), [`LivingWorldManager.ts`](../src/world/LivingWorldManager.ts), [`LandmarkManager.ts`](../src/world/LandmarkManager.ts), and [`RelicStore.ts`](../src/player/RelicStore.ts)).

---

## 1. Holistic Gameplay Review: What Works Great & Where the Ceiling Is

### What Already Makes the Game Shine
- **Expressive Traversal & Momentum**: Combining Trailblazer footpath boosts, double-jumping, valley wind-gliding (`Space`), and downhill shield-surfing (`C` / `Ctrl`) makes moving across procedural hills genuinely tactile and rewarding.
- **Tight Multi-Loop Economy**: Exploration (Chests, Runestones, Buried Maps), Hunting/Fishing (Stags, Fish), Masonry (Boulders → Quarries → Castles), and Night Combat (Trolls, Rations/Energy, Sanctuaries) all feed cleanly into Gold, Food, and Renown XP.
- **Strong Diegetic Guidance**: Firefly streams, harmonic audio chimes, compass markers, and rising sky beams allow players to navigate without staring at a cluttered UI.

### Current Bottlenecks & Opportunities for Fun
1. **Late-Game Progression Ceiling**: Once the player reaches **Rank V (High King, 1,500 Renown)**, completes **Chapter 12**, builds a **Tier III Grand Citadel (30 Blocks)**, and buys the **Runic Greatsword**, Gold and Stone Blocks lose their urgency.
2. **Static Castles at Night**: Castles act as passive safe rooms (`CastleInteriorManager.ts`). Trolls prowl around the player, but never threaten the fortifications you worked hard to build. *(Addressed in Package 1)*
3. **Single-Resource Masonry**: Every building tier uses only standard Stone Blocks (`natural rock 3d model.glb`). Introducing rare veins or specialized materials for upper tiers would make prospecting across distant chunks exciting.
4. **One-Time Interior Pedestals**: Dwarven Huts (`HutManager.ts`) become less relevant after collecting all 6 Sacred Artefacts and the 4 House Tools.

---

## 2. Progression & Levels (Ranks VI–VIII & Biome Frontier Tiers)

Extend [`DWARVEN_RANKS`](../src/world/AssignmentManager.ts) both **vertically** (Ranks VI–VIII) and **spatially** (Distance-Ringed Frontier Zones based on distance from `(0, 0)`):

### New Dwarven Ranks
- **Rank VI — Lord of the Deep / Lord of the Iron Citadel (`2,400 Renown`)**: *(Implemented in Package 1)*
  - **Perks**: `+110❤️ / +90⚡ Max`, `+80% Damage`, unlocks **Mithril Vein Prospecting** (glowing blue ore nodes in high-altitude crags) and **Master Runeforging**.
- **Rank VII — Dragon-Slayer Regent (`3,600 Renown`)**:
  - **Perks**: `+145❤️ / +120⚡ Max`, `+105% Damage`, **2nd Warhorn Charge**, and **Heroic Leap Slam** (pressing `C` in mid-air slams the ground with a shockwave).
- **Rank VIII — Immortal Ancestor of Khazad (`5,200 Renown`)**:
  - **Perks**: `+190❤️ / +150⚡ Max`, `+135% Damage`, **Ancestral Aura** (automated turret defense around your Castles and permanent `2x` base Gold Streak floor).

### Distance-Scaled Frontier Rings (World Leveling)
Using chunk distance $R = \sqrt{cx^2 + cz^2}$ from Spawn Valley `(0, 0)`:
- **Ring 1: Hearthlands ($R \le 3$ chunks)** — Standard stags, standard chests, single Night Trolls (`320 HP`).
- **Ring 2: Ironwood Highlands ($4 \le R \le 7$ chunks)** — Higher terrain amplitude, **Armored Frost-Trolls (`520 HP`)**, **Mithril Ore Boulders**, and **2x Gold Chests**.
- **Ring 3: The Shattered Peaks ($R \ge 8$ chunks)** — Dramatic crags, **Ancient Elder Trolls / Siege Bosses (`850 HP`)**, **Star-Metal Meteorites**, and **3x Mythic Hoards**.

---

## 3. New Missions (Chapters 13–18, Dynamic Events & Siege Defense)

In [`AssignmentManager.ts`](../src/world/AssignmentManager.ts), add **Act II: The High King's Realm (Chapters 13–18)** plus dynamic world events:

### New Royal Decrees (Chapters 13–18)
- **Ch. 13 — *The Mithril Vein* / *The Runesmith's Anvil***: Temper a weapon on the **Runic Anvil** inside a Castle interior or harvest 3 glowing **Mithril Ore Boulders** from high mountain crags ($y > 16\text{m}$) and smelt them at an upgraded Quarry. *(Runic Anvil version implemented in Package 1)*
- **Ch. 14 — *Hold the Ramparts (Castle Siege)***: Defend a completed Castle against a **Blood-Moon Troll Siege** wave at night. *(Implemented in Package 1)*
- **Ch. 15 — *Master of the Wind & Slope***: Complete a **Shield-Surf Slalom Trial** down a mountain peak and a **Long-Range Bow Marksman Trial**.
- **Ch. 16 — *The Automated Realm***: Upgrade 2 Quarries with **Runic Golem Conveyors** and link 3 Watchtower Beacons into a **Sky-Bridge / Zipline Network**.
- **Ch. 17 — *Slayer of the Elder Crag-King***: Summon and defeat the **Ancient Troll Chieftain Boss** at an awakened Stone Circle at midnight.
- **Ch. 18 — *Wonder of the Mountain Realm (Tier IV)***: Raise a Castle to **45 Blocks** to crown the **Tier IV Sky-Forge Wonder**.

### New Dynamic Guild Contracts & World Events
- **Blood-Moon Siege Event**: *(Implemented in Package 1)* Triggered on demand at night via the Castle Armory / Siege Defense command (`⚔️ Summon Blood-Moon Siege`), spawning 2–3 Trolls marching toward your Castle gate. Defending the gate grants massive Gold (`+450🪙`), Renown (`+350🎖️`), and `+4` Chiseled Stone Blocks.
- **Falling Star Event**: At night, a visible shooting star streaks across the skydome and impacts a nearby hill, starting a 90-second timer to reach and mine the **Hot Star-Metal Core** before it cools.
- **Lost Supply Caravan**: Recover 3 scattered Dwarven supply crates guarded by Goblin Cutpurse squads and return them to a Castle or Hut.

---

## 4. New Gear (Weapons, Ranged, Utility & Armor Upgrades)

Expanding [`CASTLE_ARMORY_CATALOG`](../src/world/CastleAndQuarryManager.ts), [`HOUSE_EQUIPMENT_CATALOG`](../src/world/CastleAndQuarryManager.ts), and [`DwarfCharacter.ts`](../src/player/DwarfCharacter.ts):

- **New Tier III / IV Melee & Thrown Weapons**:
  - **Mjolnir-Style Throwing War-Hammer (`70 DMG`)**: Press `X` / `Left-Click` in melee for lightning chain damage, or hold `Right-Click + Left-Click` to hurl the hammer at distant Trolls and recall it to your hand.
  - **Twin Dragon-Slayer Greataxe (`85 DMG`)**: Slow, devastating cleave with a **Whirlwind Spin Attack** when holding `Left-Click` (`20⚡` cost).
- **Ranged & Hunting Upgrades**:
  - **Dwarven Heavy Arbalest / Crossbow**: Flatter trajectory, armor-piercing bolts that stagger Trolls from afar and break Runic Seals from a distance.
  - **Runic Fire-Arrows**: Ignites Troll hides for damage-over-time and can light hilltop Watchtower Beacons from `25m` away with a skilled bow shot!
- **Traversal & Utility Gear**:
  - **Grappling Hook-Pick (`E` on cliffs/trees)**: Pulls the dwarf up steep cliff faces or launches into an instant high-altitude Wind-Glide.
  - **Runic Mining Charges (Throwing Bombs)**: Shatters 3 nearby boulders into ready-to-haul stones at once and blasts Troll armor.

---

## 5. New Treasures & Collectibles (Multi-Stage & Biome-Specific)

Expanding [`TreasureManager.ts`](../src/world/TreasureManager.ts) and [`HutManager.ts`](../src/world/HutManager.ts):

- **Sunken Fjord Hoards & Magnet-Fishing Chests**: Using the Fishing Rod (`F`) over shimmering golden whirlpools in rivers/ponds lets you hook and reel up **Sunken Dwarven Lockboxes** (`+350 Gold` + rare pearls/runes).
- **Echoing Runestone Puzzles (Ordered Chords)**: High-tier Mythic Chests where the 3 Runestones hum at different musical pitches (low, mid, high) and must be awakened in ascending harmonic order for a **Perfect Attunement Bonus (`2x` chest payout)**.
- **6 New Sacred Artefact Pedestals (Set II — *Relics of the Deep*)**:
  - **Anvil of the First Age**: Unlocks Weapon Enchanting (+1/+2/+3 tiers).
  - **Compass of the Star-Navigator**: Reveals all uncollected Artefacts, Mythic Chests, and Mithril Veins on the `WorldMap` (`M`).
  - **Horn of the Winter Stag**: Summons a rideable **Golden-Horn Royal Stag Mount** or grants instant ultra-sprint speed on open meadows.
- **Trophy Hall Displays**: Inside your Castle Interior ([`CastleInteriorManager.ts`](../src/world/CastleInteriorManager.ts)), physically display collected Sacred Artefacts, mounted Golden Stag Antlers, Mythic Beard-Carp plaques, and Troll War-Clubs on the walls and tables.

---

## 6. New Strengths, Combat Moves & Buff Synergies

Expanding [`TrollCombatManager.ts`](../src/world/TrollCombatManager.ts) and [`ExplorerCamera.ts`](../src/controls/ExplorerCamera.ts):

- **Active Combat Mastery Moves**:
  - **Ground-Slam Plunge (`C` / `Ctrl` while airborne)**: Plummets downward with the Surf-Shield/Warhammer, dealing AoE stagger damage to Trolls and Goblins on landing.
  - **Shield Bash Counter (`Left-Click` immediately after a Perfect Parry)**: Consumes `0⚡` and launches a guaranteed critical counter-strike (`2.5x DMG`) that knocks the Troll backward.
  - **Surf-Ram Strike**: Colliding into a Goblin or Troll at high speed (`> 20 m/s`) while downhill surfing on the *Ironbelly Surf-Shield* sends Goblins flying and deals heavy impact damage to Trolls.
- **Dwarven Brewmaster Buffs (Crafted inside Huts/Castles using Fish + Venison + Gold)**:
  - **Thunder-Stout Brew**: `+40%` movement & attack speed, lightning sparks on every step for 90s.
  - **Stone-Skin Ale**: Reduces all incoming damage by `50%` and prevents knockback for 90s.
  - **Night-Sight Mead**: Illuminates nighttime fog like midday and highlights Trolls, Deer, and Chests through trees.

---

## 7. New Advancements in Buildings (Castles, Quarries, Huts & Beacons)

Expanding [`CastleAndQuarryManager.ts`](../src/world/CastleAndQuarryManager.ts), [`CastleInteriorManager.ts`](../src/world/CastleInteriorManager.ts), and [`LandmarkManager.ts`](../src/world/LandmarkManager.ts):

### A. Castle Advancements *(Implemented in Package 1)*
1. **Tier IV: High King's Sky-Citadel (45 Blocks) & Modular Upgrades**:
   - **Roof-Mounted Runic Ballistae / Flame Braziers**: Automatically fire glowing bolts at any Night Troll that wanders within `28m–34m` of your Castle, turning completed Castles into true safe zones on the exterior as well.
   - **Royal Treasury Vault**: Completed Castles generate passive **Kingdom Tribute Gold** (`+25 Gold / min` per Castle Tier) stored in a chest inside the Throne Room.
   - **Castle Fast-Travel Gate**: Completed Castles automatically register on the Fast-Travel Waypoint bar (`T` / `WorldMap`) alongside Watchtower Beacons!
2. **Interactive Castle Interiors**:
   - **The Runic Anvil Station**: Walk up to an anvil inside Castles to temper your owned weapons (`+1` → `+3` star upgrades with `+18% / +36% / +55%` bonus weapon damage and glowing blade runes).
   - **NPC Dwarven Guards / Masons**: Summonable clan companions at Tier II/III Castles who patrol the drawbridge or help haul stone blocks from the nearest Quarry.

### B. Quarry Advancements (Tier I → Tier II Steam/Runic Quarry)
- **Quarry Overclock & Cart Rails**: Spend `8 Chiseled Blocks + 300 Gold` at any Quarry to upgrade it to a **Tier II Runic Automaton Quarry**:
  - Doubles stockpile capacity (`8` → `16` blocks).
  - Automatically transfers cut blocks directly into the nearest staked Castle site within `80m` every 12 seconds via a glowing runic tether or minecart pulse!

### C. Watchtower Beacon & Stone Circle Advancements
- **Upwind Thermal Drafts on Lit Beacons**: Jumping and opening your Wind-Glider (`Space`) inside the golden sky-beam of any lit Watchtower Beacon launches the dwarf `35m` straight up into the sky—turning every lit beacon into a **Glider Launchpad** across the valley!
- **Stone Circle Moon-Rituals**: Interacting with an Ancient Stone Circle at Night (`E`) lets you spend `100 Gold` to call down a **Star-Fragment Shower** or summon an **Elder Troll Boss** for high-tier loot.

---

## Implementation Packages & 3D Asset Specifications

### Package 1: Castle Advancements & Siege Defense (✅ Implemented)
- **Completed Features**:
  - Completed Castles registered as Fast-Travel Waypoints on the HUD Waypoint Bar and clickable on the World Map (`M`).
  - 4 Roof-Mounted Dwarven Ballista Turrets per completed Castle that automatically track and fire glowing 3D Runic Siege Bolts at Night Trolls within `34m`.
  - Passive **Royal Kingdom Tribute** (`+25🪙/min` per Castle Tier) claimable inside the Castle or via the Castle Armory UI.
  - Interactive **Runic Anvil Station** inside the Castle Great Hall (`+1` / `+2` / `+3` Weapon Mastery tempering).
  - **Blood-Moon Castle Siege** waves (`2–3` Night Trolls marching on your Castle with `+450🪙`, `+350🎖️`, and `+4🪨` rewards).
  - **Rank VI — Lord of the Iron Citadel (`2,400 Renown`)** and **Chapters 13 & 14**.
- **Integrated 3D Models (with low-poly procedural fallbacks)**:
  1. `3dmodels/heavy ballista 3d model.glb` (`19,970` tris) — Roof-mounted Dwarven siege crossbow/ballista with bronze gears and glowing cyan rune accents (close-range GLB LOD `dist <= 1.5` chunks).
  2. `3dmodels/runic anvil 3d model.glb` (`18,510` tris) — Heavy dark-iron Dwarven forging anvil on a carved granite pedestal inside the Castle Great Hall.
  3. `3dmodels/treasure chest 3d model.glb` (`18,763` tris) — Ornate iron-and-gold Dwarven royal treasury vault chest positioned beside the Runic Anvil.

### Package 2: Ranks VII–VIII, Chapters 15–18, Mithril Prospecting & Automated Quarries (✅ Implemented)
- Extended [`AssignmentManager.ts`](../src/world/AssignmentManager.ts) with Ranks VII–VIII and Act II Chapters.
- Added glowing blue **Mithril Ore Veins** in high mountain crags and deep underground caverns.
- Added **Tier II Automated Automaton Quarries** (`U` key, 300g) doubling capacity and dispatching automated block haulers.

### Package 3: Glider Thermal Launchpads, Slalom Trials & Advanced Combat (✅ Implemented)
- Lit Watchtower Beacon sky-beams and volcano fumaroles launch the Wind-Glider `+24m/s` into the air via thermal updrafts.
- Added **Mid-Air Ground-Slam (`C` in air)**, **Shield-Bash Counter**, **Downhill Surf-Ramming**, and **Mountain Slalom Trials**.

### Package 4: Zero-Allocation Simulation Engine & CI Benchmark Suite (✅ Implemented)
- **Contiguous Flat Arrays**: Replaced `MapIterator` allocations in 60 Hz loops with `flatActiveDeer`, `flatActiveFish`, and `flatActiveChests` (+36.1% faster entity traversal).
- **Distance-Squared Collision Caching**: All spatial proximity queries across trolls, projectiles, and hazards use pre-squared constants.
- **Pre-Allocated Projectile Pools**: Titan boulders and traversal anchors use fixed ring pools (`BOULDER_POOL_SIZE = 8`).
- **Automated CI Benchmarking**: `scripts/benchmark-and-verify.mjs` verifies simplex noise (>4.2M ops/s), surface sampling (>16M ops/s), boss physics (>1.3M ticks/s), and enforces `NUM_POINT_LIGHTS = 1` and raw `GLTFLoader` prohibitions.

### Package 5: Five Next-Gen Gameplay Expansions (Roadmap)
Detailed design specifications are documented in [`docs/gameplay-improvements-and-benchmarks.md`](gameplay-improvements-and-benchmarks.md):
1. **Ancestral Runic Gem-Socketing & Weapon Enchantment**: Deepening weapon customization with elemental gems (Ember Pyrite, Glacial Quartz, Star-Metal, Lodestone Amber).
2. **Aerial Glider Dogfighting vs Vermithrax**: Mid-air hand-crossbow bullet time and harpoon grappling onto the dragon's back.
3. **Biome Frontier Rings & Raider Ambush Caravans**: Radial difficulty scaling ($R \ge 8$ chunks) with procedural merchant caravan escort events.
4. **Subterranean Minecart Delves & Dynamic Cave Collapses**: Rail-riding mechanics, acoustic pickaxe mining, and seismic cave-in evasion.
5. **Castle Siege Defense & Golem Automation**: Rampart ballistae, boiling oil defense, and factory-like automaton transport networks.
