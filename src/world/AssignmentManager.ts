import { getSharedAudioContext } from '../player/RelicStore'

function playSuccessChime(): void {
  const ctx = getSharedAudioContext()
  if (!ctx) return
  const now = ctx.currentTime
  const notes = [440, 554.37, 659.25, 880]
  notes.forEach((freq, idx) => {
    const t = now + idx * 0.075
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq, t)
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
    osc.start(t)
    osc.stop(t + 0.4)
  })
}

export function playWarhornBlastSound(): void {
  const ctx = getSharedAudioContext()
  if (!ctx) return
  const now = ctx.currentTime
  const chord = [146.83, 220.0, 293.66] // Deep D3-A3-D4 Dwarven Warhorn fifth chord
  chord.forEach((freq, idx) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = idx === 0 ? 'sawtooth' : 'triangle'
    osc.frequency.setValueAtTime(freq * 0.96, now)
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.18)
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.exponentialRampToValueAtTime(idx === 0 ? 0.14 : 0.11, now + 0.16)
    gain.gain.setValueAtTime(idx === 0 ? 0.14 : 0.11, now + 0.72)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.28)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
    osc.start(now)
    osc.stop(now + 1.32)
  })
}

export interface DwarvenRankDef {
  rank: number
  title: string
  badge: string
  minRenown: number
  maxHpBonus: number
  maxEnergyBonus: number
  damageMult: number
  carrySpeedBonus: number
  perkSummary: string
}

export const DWARVEN_RANKS: DwarvenRankDef[] = [
  {
    rank: 1,
    title: 'Outcast Prospector',
    badge: '⛏️ Rank I',
    minRenown: 0,
    maxHpBonus: 0,
    maxEnergyBonus: 0,
    damageMult: 1.0,
    carrySpeedBonus: 0,
    perkSummary: 'Base Dwarven vitality & prospecting tools',
  },
  {
    rank: 2,
    title: 'Master Stonemason',
    badge: '🪖 Rank II',
    minRenown: 200,
    maxHpBonus: 15,
    maxEnergyBonus: 15,
    damageMult: 1.12,
    carrySpeedBonus: 0.08,
    perkSummary: '+15❤️/+15⚡ Max, +12% Damage, Horned Helmet & Warhorn (V)',
  },
  {
    rank: 3,
    title: 'Stronghold Warden',
    badge: '🛡️ Rank III',
    minRenown: 500,
    maxHpBonus: 35,
    maxEnergyBonus: 30,
    damageMult: 1.25,
    carrySpeedBonus: 0.15,
    perkSummary: '+35❤️/+30⚡ Max, +25% Damage, Mithril Pauldrons & Bow vs Trolls',
  },
  {
    rank: 4,
    title: 'Runesmith & Thane',
    badge: '⚡ Rank IV',
    minRenown: 950,
    maxHpBonus: 55,
    maxEnergyBonus: 45,
    damageMult: 1.4,
    carrySpeedBonus: 0.22,
    perkSummary: '+55❤️/+45⚡ Max, +40% Damage, +22% Heavy Haul Speed',
  },
  {
    rank: 5,
    title: 'High King of the Mountain',
    badge: '👑 Rank V',
    minRenown: 1500,
    maxHpBonus: 80,
    maxEnergyBonus: 65,
    damageMult: 1.6,
    carrySpeedBonus: 0.3,
    perkSummary: '+80❤️/+65⚡ Max, +60% Damage, Golden Crown & Royal Regen',
  },
]

export interface AssignmentSnapshot {
  chestsOpened: number
  beaconsLit: number
  foodCollectedTotal: number
  relicsUnlocked: number
  houseToolsOwned: number
  artefactsCollected: number
  collectedArtefactIds: string[]
  quarriesBuilt: number
  blocksChiseledTotal: number
  bestCastleBlocks: number
  totalBlocksPlaced: number
  weaponsOwned: number
  shieldsOwned: number
  trollsSlain: number
  challengesCompleted: number
  fishCaughtTotal: number
  deerHuntedTotal: number
}

export interface ChronicleAssignmentDef {
  id: string
  chapter: number
  title: string
  icon: string
  description: string
  hint: string
  rewardGold: number
  rewardRenown: number
  rewardFood?: number
  getProgress: (snap: AssignmentSnapshot) => { current: number; target: number }
}

export const CHRONICLE_ASSIGNMENTS: ChronicleAssignmentDef[] = [
  {
    id: 'scout_frontier',
    chapter: 1,
    title: 'Awakening on the Frontier',
    icon: '🔥',
    description: 'Open 2 Treasure Chests OR light 1 Watchtower Beacon to survey the realm.',
    hint: 'Follow gold beams to Chests or climb a stone Watchtower and press E.',
    rewardGold: 45,
    rewardRenown: 80,
    rewardFood: 2,
    getProgress: (s) => ({
      current: Math.min(2, s.chestsOpened + s.beaconsLit * 2),
      target: 2,
    }),
  },
  {
    id: 'first_forage_or_relic',
    chapter: 2,
    title: 'Tools of the Ancestors',
    icon: '⚒️',
    description: 'Unlock 1 Ancient Relic (1-4) OR purchase 1 Dwarven House Tool (E to enter Hut, Keys 5-8).',
    hint: 'Spend Gold on Relic 1 (Runic Boots) or enter any Dwarven Hut (E) and buy a House Tool (5-8).',
    rewardGold: 60,
    rewardRenown: 90,
    getProgress: (s) => ({
      current: Math.min(1, s.relicsUnlocked + s.houseToolsOwned),
      target: 1,
    }),
  },
  {
    id: 'delve_dwarven_hut',
    chapter: 3,
    title: 'Sacred Hearth Delve',
    icon: '🏠',
    description: 'Enter a Dwarven Hut (E) and attune your first Sacred Dwarven Artefact.',
    hint: 'Find a warm cottage with a smoking chimney, enter with E, and claim the pedestal artefact.',
    rewardGold: 80,
    rewardRenown: 110,
    rewardFood: 2,
    getProgress: (s) => ({
      current: Math.min(1, s.artefactsCollected),
      target: 1,
    }),
  },
  {
    id: 'establish_quarry',
    chapter: 4,
    title: 'Strike the Living Rock',
    icon: '⛏️',
    description: 'Set up a Stone Quarry (Q near boulders) and chisel 2 Castle Blocks (E).',
    hint: 'Gather raw boulders with E, carry them to your Quarry, and press E to chisel blocks.',
    rewardGold: 95,
    rewardRenown: 120,
    getProgress: (s) => ({
      current: Math.min(3, (s.quarriesBuilt > 0 ? 1 : 0) + Math.min(2, s.blocksChiseledTotal)),
      target: 3,
    }),
  },
  {
    id: 'raise_border_keep',
    chapter: 5,
    title: 'Raise the Border Keep (Tier I)',
    icon: '🏰',
    description: 'Stake a Castle Site (K) and deliver 8 Chiseled Blocks to complete a Tier I Keep.',
    hint: 'Press K on level ground to stake a Castle, then carry Chiseled Blocks there and press E.',
    rewardGold: 130,
    rewardRenown: 150,
    rewardFood: 3,
    getProgress: (s) => ({
      current: Math.min(8, s.bestCastleBlocks),
      target: 8,
    }),
  },
  {
    id: 'arm_for_battle',
    chapter: 6,
    title: 'Steel & Oak of the Armory',
    icon: '🛡️',
    description: 'Forge or equip 1 Melee Weapon AND 1 Shield at your Keep Armory (E to enter Castle, Keys 5-9).',
    hint: 'Walk to your completed Keep drawbridge, press E to enter the Hall, and buy a Weapon (5-8) & Shield (9).',
    rewardGold: 110,
    rewardRenown: 130,
    getProgress: (s) => ({
      current: (s.weaponsOwned > 0 ? 1 : 0) + (s.shieldsOwned > 0 ? 1 : 0),
      target: 2,
    }),
  },
  {
    id: 'prove_valor',
    chapter: 7,
    title: 'Trial of Dwarven Valor',
    icon: '👹',
    description: 'Slay 1 Night Troll (Left-Click / Right-Click Parry) OR complete 1 Golden Ring Trial.',
    hint: 'Hunt a Troll at night (or use N to toggle Nightfall), or sprint through a Golden Ring Arch.',
    rewardGold: 150,
    rewardRenown: 160,
    rewardFood: 3,
    getProgress: (s) => ({
      current: Math.min(1, s.trollsSlain + s.challengesCompleted),
      target: 1,
    }),
  },
  {
    id: 'wilderness_hunter_angler',
    chapter: 8,
    title: 'Bounty of Forest & Fjord',
    icon: '🏹',
    description: 'Harvest 3 wild game or fish using your Hunting Bow (H) or Fishing Rod (F).',
    hint: 'Press H to draw your Bow and hunt stags (Click/Space to shoot), or press F near water to cast a line.',
    rewardGold: 140,
    rewardRenown: 150,
    getProgress: (s) => ({
      current: Math.min(3, s.fishCaughtTotal + s.deerHuntedTotal),
      target: 3,
    }),
  },
  {
    id: 'raise_stonewall_stronghold',
    chapter: 9,
    title: 'Stonewall Stronghold (Tier II)',
    icon: '🧱',
    description: 'Expand a Castle to 18 Blocks to raise the Tier II Stonewall Stronghold & Twin Towers.',
    hint: 'Upgrade your Chisel & Stone Hauler inside a Hut (E, Keys 5-6) to haul and chisel stone twice as fast!',
    rewardGold: 190,
    rewardRenown: 200,
    rewardFood: 4,
    getProgress: (s) => ({
      current: Math.min(18, s.bestCastleBlocks),
      target: 18,
    }),
  },
  {
    id: 'attune_three_artefacts',
    chapter: 10,
    title: 'Keeper of the Sacred Relics',
    icon: '👑',
    description: 'Explore Dwarven Huts across the biomes and attune 3 Sacred Dwarven Artefacts.',
    hint: 'Each Sacred Artefact grants a permanent passive Dwarf Blessing (Gold, Bonus Blocks, Regen, Armor).',
    rewardGold: 210,
    rewardRenown: 220,
    getProgress: (s) => ({
      current: Math.min(3, s.artefactsCollected),
      target: 3,
    }),
  },
  {
    id: 'raise_grand_citadel',
    chapter: 11,
    title: "Mountain King's Grand Citadel (Tier III)",
    icon: '🏛️',
    description: 'Deliver 30 Blocks to crown your fortress with the Golden Spire & Great Throne Hall.',
    hint: 'Step inside your Citadel gate (E) to feast at the High King table and admire your trophies!',
    rewardGold: 300,
    rewardRenown: 300,
    rewardFood: 5,
    getProgress: (s) => ({
      current: Math.min(30, s.bestCastleBlocks),
      target: 30,
    }),
  },
  {
    id: 'high_kings_triumph',
    chapter: 12,
    title: 'Legend of Khazad-dûm',
    icon: '🌟',
    description: 'Attune 5 Sacred Artefacts AND slay 3 Night Trolls to secure eternal Dwarven glory.',
    hint: 'Blow your Warhorn of Khazad (V) in battle to stun Trolls and rally your strength!',
    rewardGold: 450,
    rewardRenown: 400,
    rewardFood: 6,
    getProgress: (s) => ({
      current: Math.min(5, s.artefactsCollected) + Math.min(3, s.trollsSlain),
      target: 8,
    }),
  },
]

export type GuildContractType =
  | 'masonry_blocks'
  | 'chisel_stones'
  | 'hunt_deer'
  | 'catch_fish'
  | 'slay_troll'
  | 'open_chests'

export interface ActiveGuildContract {
  type: GuildContractType
  title: string
  icon: string
  description: string
  baselineValue: number
  targetDelta: number
  rewardGold: number
  rewardRenown: number
  rewardFood: number
}

interface ContractTemplate {
  type: GuildContractType
  title: string
  icon: string
  targetDelta: number
  rewardGold: number
  rewardRenown: number
  rewardFood: number
  formatDesc: (target: number) => string
  extractMetric: (snap: AssignmentSnapshot) => number
}

const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    type: 'chisel_stones',
    title: "Guild Stonemason's Quota",
    icon: '🪨',
    targetDelta: 3,
    rewardGold: 75,
    rewardRenown: 75,
    rewardFood: 1,
    formatDesc: (n) => `Chisel ${n} new stone blocks at any Quarry (E).`,
    extractMetric: (s) => s.blocksChiseledTotal,
  },
  {
    type: 'masonry_blocks',
    title: 'Royal Rampart Reinforcement',
    icon: '🧱',
    targetDelta: 4,
    rewardGold: 95,
    rewardRenown: 85,
    rewardFood: 2,
    formatDesc: (n) => `Deliver ${n} Chiseled Blocks to any Castle site (E).`,
    extractMetric: (s) => s.totalBlocksPlaced,
  },
  {
    type: 'open_chests',
    title: "Prospector's Gold Charter",
    icon: '🪙',
    targetDelta: 3,
    rewardGold: 80,
    rewardRenown: 70,
    rewardFood: 1,
    formatDesc: (n) => `Discover and open ${n} Treasure Chests across the frontier.`,
    extractMetric: (s) => s.chestsOpened,
  },
  {
    type: 'catch_fish',
    title: "Royal Angler's Provision",
    icon: '🎣',
    targetDelta: 2,
    rewardGold: 85,
    rewardRenown: 75,
    rewardFood: 2,
    formatDesc: (n) => `Catch ${n} fresh fish with your Dwarven Fishing Rod (F).`,
    extractMetric: (s) => s.fishCaughtTotal,
  },
  {
    type: 'hunt_deer',
    title: "Highland Stag Hunter's Order",
    icon: '🦌',
    targetDelta: 2,
    rewardGold: 90,
    rewardRenown: 80,
    rewardFood: 2,
    formatDesc: (n) => `Hunt ${n} wild stags with your Dwarven Bow (H & Click/Space).`,
    extractMetric: (s) => s.deerHuntedTotal,
  },
  {
    type: 'slay_troll',
    title: 'Night Watch Troll Bounty',
    icon: '👹',
    targetDelta: 1,
    rewardGold: 135,
    rewardRenown: 110,
    rewardFood: 2,
    formatDesc: (n) => `Slay ${n} Night Troll in melee or ranged combat.`,
    extractMetric: (s) => s.trollsSlain,
  },
]

export const ARTEFACT_BLESSING_INFO: Record<
  string,
  { name: string; icon: string; shortPerk: string; fullPerk: string }
> = {
  durin_crown: {
    name: "Durin's Lost Crown",
    icon: '👑',
    shortPerk: '+25% Gold from all sources',
    fullPerk: 'Royal Greed: +25% bonus Gold from Chests, Contracts, and Bounties & unlocks Golden Crown.',
  },
  astral_hammer: {
    name: 'Astral Forge Hammer',
    icon: '🔨',
    shortPerk: '35% chance for +1 free Block',
    fullPerk: 'Masterwork Strike: 35% chance to chisel an extra bonus Castle Block from a single stone.',
  },
  mountain_chalice: {
    name: 'Chalice of the Mountain',
    icon: '🏆',
    shortPerk: '+35% Food healing & energy',
    fullPerk: 'Overflowing Feast: Eating rations or feasts restores +35% more Health and Energy.',
  },
  heartstone_gem: {
    name: 'Heartstone of Erebor',
    icon: '💎',
    shortPerk: 'Passive +1❤️ & +2.5⚡/sec',
    fullPerk: 'Living Mountain Pulse: Passively regenerates +1.0❤️ Health and +2.5⚡ Energy every second.',
  },
  runic_tablet: {
    name: 'Ancient Runic Tablet',
    icon: '📜',
    shortPerk: '+35% Lore & Renown XP gain',
    fullPerk: 'Runic Wisdom: +35% bonus Renown XP from all Decrees, Contracts, and discoveries.',
  },
  iron_aegis: {
    name: 'Shield of the First King',
    icon: '🛡️',
    shortPerk: '-20% Troll damage taken',
    fullPerk: 'Unyielding Bulwark: Reduces incoming Troll smash damage by 20% and widens Perfect Parry.',
  },
}

export interface AssignmentManagerCallbacks {
  getSnapshot: () => AssignmentSnapshot
  onGrantReward: (gold: number, food: number, message: string) => void
  onRankChanged: (rankDef: DwarvenRankDef) => void
  onTriggerWarhorn: () => void
}

export class AssignmentManager {
  private readonly callbacks: AssignmentManagerCallbacks
  private completedChronicleIds = new Set<string>()
  private renownXp = 0
  private currentRank = 1
  private activeContract: ActiveGuildContract | null = null
  private contractCycleIndex = 0
  private isPanelExpanded = false

  // Warhorn of Khazad (V key) state
  private warhornCooldown = 0
  private warhornBuffTimer = 0
  private readonly WARHORN_COOLDOWN_SEC = 28
  private readonly WARHORN_BUFF_DURATION_SEC = 14

  // DOM Elements
  private hudRoot: HTMLElement | null = null
  private rankBadgeEl: HTMLElement | null = null
  private rankTitleEl: HTMLElement | null = null
  private compactSummaryEl: HTMLElement | null = null
  private renownFillEl: HTMLElement | null = null
  private renownTextEl: HTMLElement | null = null
  private chronicleTitleEl: HTMLElement | null = null
  private chronicleDescEl: HTMLElement | null = null
  private chronicleHintEl: HTMLElement | null = null
  private chronicleFillEl: HTMLElement | null = null
  private chronicleProgressTextEl: HTMLElement | null = null
  private chronicleRewardEl: HTMLElement | null = null
  private contractTitleEl: HTMLElement | null = null
  private contractDescEl: HTMLElement | null = null
  private contractFillEl: HTMLElement | null = null
  private contractProgressTextEl: HTMLElement | null = null
  private contractRewardEl: HTMLElement | null = null
  private blessingsBoxEl: HTMLElement | null = null
  private blessingsListEl: HTMLElement | null = null
  private warhornBtnEl: HTMLButtonElement | null = null
  private bodySectionEl: HTMLElement | null = null
  private toggleBtnEl: HTMLButtonElement | null = null

  private lastHudSignature = ''
  private checkAccum = 0

  constructor(callbacks: AssignmentManagerCallbacks) {
    this.callbacks = callbacks
    this.bindDom()
  }

  private bindDom(): void {
    this.hudRoot = document.getElementById('assignment-hud')
    this.rankBadgeEl = document.getElementById('assignment-rank-badge')
    this.rankTitleEl = document.getElementById('assignment-rank-title')
    this.compactSummaryEl = document.getElementById('assignment-compact-summary')
    this.renownFillEl = document.getElementById('assignment-renown-fill')
    this.renownTextEl = document.getElementById('assignment-renown-text')
    this.chronicleTitleEl = document.getElementById('assignment-chronicle-title')
    this.chronicleDescEl = document.getElementById('assignment-chronicle-desc')
    this.chronicleHintEl = document.getElementById('assignment-chronicle-hint')
    this.chronicleFillEl = document.getElementById('assignment-chronicle-fill')
    this.chronicleProgressTextEl = document.getElementById('assignment-chronicle-progress')
    this.chronicleRewardEl = document.getElementById('assignment-chronicle-reward')
    this.contractTitleEl = document.getElementById('assignment-contract-title')
    this.contractDescEl = document.getElementById('assignment-contract-desc')
    this.contractFillEl = document.getElementById('assignment-contract-fill')
    this.contractProgressTextEl = document.getElementById('assignment-contract-progress')
    this.contractRewardEl = document.getElementById('assignment-contract-reward')
    this.blessingsBoxEl = document.getElementById('assignment-blessings-box')
    this.blessingsListEl = document.getElementById('assignment-blessings-list')
    this.warhornBtnEl = document.getElementById('assignment-warhorn-btn') as HTMLButtonElement | null
    this.bodySectionEl = document.getElementById('assignment-hud-body')
    this.toggleBtnEl = document.getElementById('assignment-hud-toggle') as HTMLButtonElement | null

    const headerEl = document.getElementById('assignment-hud-header')
    headerEl?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement | null)?.closest('#assignment-hud-toggle')) return
      this.togglePanelExpanded()
    })

    this.compactSummaryEl?.addEventListener('click', () => {
      this.togglePanelExpanded()
    })

    this.toggleBtnEl?.addEventListener('click', () => {
      this.togglePanelExpanded()
    })

    const rerollBtn = document.getElementById('assignment-contract-reroll')
    rerollBtn?.addEventListener('click', () => {
      this.cycleGuildContract(true)
    })

    this.warhornBtnEl?.addEventListener('click', () => {
      this.tryBlowWarhorn()
    })

    const topBtn = document.getElementById('decrees-toggle-button')
    topBtn?.addEventListener('click', () => {
      this.togglePanelExpanded()
    })
  }

  public togglePanelExpanded(): void {
    this.isPanelExpanded = !this.isPanelExpanded
    this.hudRoot?.classList.toggle('collapsed', !this.isPanelExpanded)
    if (this.bodySectionEl) {
      this.bodySectionEl.style.display = this.isPanelExpanded ? 'flex' : 'none'
    }
    if (this.compactSummaryEl) {
      this.compactSummaryEl.style.display = this.isPanelExpanded ? 'none' : 'block'
    }
    if (this.toggleBtnEl) {
      this.toggleBtnEl.textContent = this.isPanelExpanded ? '▾' : '▸'
    }
  }

  public getRankDef(): DwarvenRankDef {
    return DWARVEN_RANKS[Math.min(DWARVEN_RANKS.length - 1, Math.max(0, this.currentRank - 1))]
  }

  public getCurrentRank(): number {
    return this.currentRank
  }

  public getRenownXp(): number {
    return this.renownXp
  }

  public getCompletedChronicleIds(): string[] {
    return Array.from(this.completedChronicleIds)
  }

  public getActiveContract(): ActiveGuildContract | null {
    return this.activeContract ? { ...this.activeContract } : null
  }

  public isWarhornBuffActive(): boolean {
    return this.warhornBuffTimer > 0
  }

  public getWarhornBuffRemaining(): number {
    return Math.max(0, this.warhornBuffTimer)
  }

  public getWarhornCooldownRemaining(): number {
    return Math.max(0, this.warhornCooldown)
  }

  public canUseWarhorn(): boolean {
    const snap = this.callbacks.getSnapshot()
    return this.currentRank >= 2 || snap.weaponsOwned > 0 || snap.shieldsOwned > 0 || snap.artefactsCollected > 0
  }

  public tryBlowWarhorn(): boolean {
    if (!this.canUseWarhorn()) {
      this.callbacks.onGrantReward(
        0,
        0,
        '📯 Reach Rank II (Master Stonemason) or forge a Weapon/Shield to unlock the Warhorn of Khazad!',
      )
      return false
    }
    if (this.warhornCooldown > 0) {
      return false
    }
    this.warhornCooldown = this.WARHORN_COOLDOWN_SEC
    this.warhornBuffTimer = this.WARHORN_BUFF_DURATION_SEC
    this.callbacks.onTriggerWarhorn()
    this.lastHudSignature = ''
    this.renderHud(this.callbacks.getSnapshot())
    return true
  }

  public addRenown(amount: number): void {
    if (amount <= 0) return
    const snap = this.callbacks.getSnapshot()
    const hasRunicTablet = snap.collectedArtefactIds.includes('runic_tablet')
    const finalAmount = hasRunicTablet ? Math.round(amount * 1.35) : amount
    this.renownXp += finalAmount
    this.recalculateRank(true)
  }

  private recalculateRank(notifyOnPromotion: boolean): void {
    let newRank = 1
    for (const def of DWARVEN_RANKS) {
      if (this.renownXp >= def.minRenown) {
        newRank = def.rank
      }
    }
    if (newRank !== this.currentRank) {
      const promoted = newRank > this.currentRank
      this.currentRank = newRank
      const rankDef = this.getRankDef()
      this.callbacks.onRankChanged(rankDef)
      if (notifyOnPromotion && promoted) {
        playSuccessChime()
        this.callbacks.onGrantReward(
          50 * newRank,
          2,
          `👑 PROMOTED TO ${rankDef.badge}: ${rankDef.title.toUpperCase()}! (${rankDef.perkSummary})`,
        )
      }
    }
  }

  public cycleGuildContract(notify = false): void {
    const snap = this.callbacks.getSnapshot()
    const template = CONTRACT_TEMPLATES[this.contractCycleIndex % CONTRACT_TEMPLATES.length]
    this.contractCycleIndex = (this.contractCycleIndex + 1) % CONTRACT_TEMPLATES.length
    const baseline = template.extractMetric(snap)
    this.activeContract = {
      type: template.type,
      title: template.title,
      icon: template.icon,
      description: template.formatDesc(template.targetDelta),
      baselineValue: baseline,
      targetDelta: template.targetDelta,
      rewardGold: template.rewardGold,
      rewardRenown: template.rewardRenown,
      rewardFood: template.rewardFood,
    }
    if (notify) {
      this.callbacks.onGrantReward(
        0,
        0,
        `📜 New Guild Contract posted: ${this.activeContract.icon} ${this.activeContract.title}!`,
      )
    }
    this.lastHudSignature = ''
    this.renderHud(snap)
  }

  public update(dt: number): void {
    if (this.warhornCooldown > 0) {
      this.warhornCooldown = Math.max(0, this.warhornCooldown - dt)
    }
    if (this.warhornBuffTimer > 0) {
      this.warhornBuffTimer = Math.max(0, this.warhornBuffTimer - dt)
    }

    this.checkAccum += dt
    if (this.checkAccum < 0.25) return
    this.checkAccum = 0

    const snap = this.callbacks.getSnapshot()
    if (!this.activeContract) {
      this.cycleGuildContract(false)
    }

    // 1. Check active Chronicle Assignment completion
    const activeChronicle = this.getActiveChronicle()
    if (activeChronicle) {
      const prog = activeChronicle.getProgress(snap)
      if (prog.current >= prog.target) {
        this.completedChronicleIds.add(activeChronicle.id)
        playSuccessChime()
        const foodBonus = activeChronicle.rewardFood ?? 1
        this.addRenown(activeChronicle.rewardRenown)
        this.callbacks.onGrantReward(
          activeChronicle.rewardGold,
          foodBonus,
          `📜 Royal Decree Complete: "${activeChronicle.title}"! (+${activeChronicle.rewardGold}🪙, +${activeChronicle.rewardRenown}🎖️ Renown, +${foodBonus}🍖)`,
        )
        this.lastHudSignature = ''
      }
    }

    // 2. Check active Guild Contract completion
    if (this.activeContract) {
      const currentMetric = this.getContractCurrentValue(this.activeContract.type, snap)
      const delta = Math.max(0, currentMetric - this.activeContract.baselineValue)
      if (delta >= this.activeContract.targetDelta) {
        const completed = this.activeContract
        playSuccessChime()
        this.addRenown(completed.rewardRenown)
        this.callbacks.onGrantReward(
          completed.rewardGold,
          completed.rewardFood,
          `⚒️ Guild Contract Fulfilled: "${completed.title}"! (+${completed.rewardGold}🪙, +${completed.rewardRenown}🎖️ Renown, +${completed.rewardFood}🍖)`,
        )
        this.cycleGuildContract(false)
        this.lastHudSignature = ''
      }
    }

    this.renderHud(snap)
  }

  private getActiveChronicle(): ChronicleAssignmentDef | null {
    for (const def of CHRONICLE_ASSIGNMENTS) {
      if (!this.completedChronicleIds.has(def.id)) {
        return def
      }
    }
    return null
  }

  private getContractCurrentValue(type: GuildContractType, snap: AssignmentSnapshot): number {
    const tpl = CONTRACT_TEMPLATES.find((t) => t.type === type)
    return tpl ? tpl.extractMetric(snap) : 0
  }

  private renderHud(snap: AssignmentSnapshot): void {
    if (!this.hudRoot) return
    const rankDef = this.getRankDef()
    const nextRankDef = DWARVEN_RANKS[Math.min(DWARVEN_RANKS.length - 1, this.currentRank)]
    const activeChronicle = this.getActiveChronicle()
    const chronProg = activeChronicle ? activeChronicle.getProgress(snap) : { current: 1, target: 1 }

    const contractMetric = this.activeContract
      ? this.getContractCurrentValue(this.activeContract.type, snap)
      : 0
    const contractDelta = this.activeContract
      ? Math.min(this.activeContract.targetDelta, Math.max(0, contractMetric - this.activeContract.baselineValue))
      : 0

    const warhornUnlocked = this.canUseWarhorn()
    const warhornCdInt = Math.ceil(this.warhornCooldown)
    const warhornBuffInt = Math.ceil(this.warhornBuffTimer)

    const sig = `${this.currentRank}|${this.renownXp}|${activeChronicle?.id ?? 'done'}:${chronProg.current}/${chronProg.target}|${this.activeContract?.type ?? 'none'}:${contractDelta}|${snap.collectedArtefactIds.join(',')}|${warhornUnlocked}:${warhornCdInt}:${warhornBuffInt}`
    if (sig === this.lastHudSignature) return
    this.lastHudSignature = sig

    if (this.rankBadgeEl) {
      this.rankBadgeEl.textContent = rankDef.badge
    }
    if (this.rankTitleEl) {
      this.rankTitleEl.textContent = rankDef.title
      this.rankTitleEl.title = rankDef.perkSummary
    }

    if (this.renownFillEl && this.renownTextEl) {
      if (this.currentRank >= DWARVEN_RANKS.length) {
        this.renownFillEl.style.width = '100%'
        this.renownTextEl.textContent = `${this.renownXp} 🎖️ Renown (MAX RANK)`
      } else {
        const span = Math.max(1, nextRankDef.minRenown - rankDef.minRenown)
        const into = Math.max(0, this.renownXp - rankDef.minRenown)
        const pct = Math.min(100, Math.round((into / span) * 100))
        this.renownFillEl.style.width = `${pct}%`
        this.renownTextEl.textContent = `${this.renownXp} / ${nextRankDef.minRenown} 🎖️ → ${nextRankDef.badge}`
      }
    }

    // Chronicle Section
    if (activeChronicle) {
      const pct = Math.min(100, Math.round((chronProg.current / Math.max(1, chronProg.target)) * 100))
      if (this.chronicleTitleEl) {
        this.chronicleTitleEl.textContent = `${activeChronicle.icon} Ch.${activeChronicle.chapter}/${CHRONICLE_ASSIGNMENTS.length}: ${activeChronicle.title}`
      }
      if (this.chronicleDescEl) {
        this.chronicleDescEl.textContent = activeChronicle.description
      }
      if (this.chronicleHintEl) {
        this.chronicleHintEl.textContent = `💡 ${activeChronicle.hint}`
      }
      if (this.chronicleFillEl) {
        this.chronicleFillEl.style.width = `${pct}%`
      }
      if (this.chronicleProgressTextEl) {
        this.chronicleProgressTextEl.textContent = `${chronProg.current} / ${chronProg.target}`
      }
      if (this.chronicleRewardEl) {
        this.chronicleRewardEl.textContent = `+${activeChronicle.rewardGold}🪙 +${activeChronicle.rewardRenown}🎖️`
      }
    } else {
      if (this.chronicleTitleEl) {
        this.chronicleTitleEl.textContent = '👑 All 12 Royal Chronicles Completed!'
      }
      if (this.chronicleDescEl) {
        this.chronicleDescEl.textContent = 'You have restored the ancient Dwarven Kingdom to its highest glory.'
      }
      if (this.chronicleHintEl) {
        this.chronicleHintEl.textContent = '💡 Continue fulfilling Royal Guild Contracts below for endless rewards!'
      }
      if (this.chronicleFillEl) {
        this.chronicleFillEl.style.width = '100%'
      }
      if (this.chronicleProgressTextEl) {
        this.chronicleProgressTextEl.textContent = '12 / 12'
      }
      if (this.chronicleRewardEl) {
        this.chronicleRewardEl.textContent = '🌟 Legend'
      }
    }

    // Guild Contract Section
    if (this.activeContract) {
      const pct = Math.min(
        100,
        Math.round((contractDelta / Math.max(1, this.activeContract.targetDelta)) * 100),
      )
      if (this.contractTitleEl) {
        this.contractTitleEl.textContent = `${this.activeContract.icon} ${this.activeContract.title}`
      }
      if (this.contractDescEl) {
        this.contractDescEl.textContent = this.activeContract.description
      }
      if (this.contractFillEl) {
        this.contractFillEl.style.width = `${pct}%`
      }
      if (this.contractProgressTextEl) {
        this.contractProgressTextEl.textContent = `${contractDelta} / ${this.activeContract.targetDelta}`
      }
      if (this.contractRewardEl) {
        this.contractRewardEl.textContent = `+${this.activeContract.rewardGold}🪙 +${this.activeContract.rewardRenown}🎖️`
      }
    }

    // Compact Summary (shown when collapsed)
    if (this.compactSummaryEl) {
      const chronPart = activeChronicle
        ? `${activeChronicle.icon} Ch.${activeChronicle.chapter}: ${chronProg.current}/${chronProg.target}`
        : '👑 Ch.12/12'
      const contractPart = this.activeContract
        ? ` • ${this.activeContract.icon} ${contractDelta}/${this.activeContract.targetDelta}`
        : ''
      const warhornPart =
        warhornBuffInt > 0
          ? ` • 📯 ${warhornBuffInt}s`
          : warhornUnlocked && warhornCdInt === 0
            ? ' • 📯 Ready (V)'
            : ''
      this.compactSummaryEl.textContent = `${chronPart}${contractPart}${warhornPart}`
    }

    // Blessings & Rank Perks pills (auto-hide box when empty)
    if (this.blessingsListEl) {
      const pills: string[] = []
      if (this.currentRank > 1) {
        pills.push(
          `<span class="blessing-pill rank-perk-pill" title="${rankDef.perkSummary}">${rankDef.badge}: +${rankDef.maxHpBonus}❤️ +${Math.round((rankDef.damageMult - 1) * 100)}%⚔️</span>`,
        )
      }
      for (const id of snap.collectedArtefactIds) {
        const info = ARTEFACT_BLESSING_INFO[id]
        if (info) {
          pills.push(
            `<span class="blessing-pill" title="${info.fullPerk}">${info.icon} ${info.shortPerk}</span>`,
          )
        }
      }
      this.blessingsBoxEl?.classList.toggle('hidden', pills.length === 0)
      this.blessingsListEl.innerHTML = pills.join('')
    }

    // Warhorn Button
    if (this.warhornBtnEl) {
      this.warhornBtnEl.style.display = warhornUnlocked ? 'block' : 'none'
      if (!warhornUnlocked) {
        this.warhornBtnEl.disabled = true
        this.warhornBtnEl.textContent = '🔒 Warhorn of Khazad (Rank II / Armory)'
        this.warhornBtnEl.classList.remove('is-active', 'is-ready')
      } else if (warhornBuffInt > 0) {
        this.warhornBtnEl.disabled = true
        this.warhornBtnEl.textContent = `📯 Warhorn Rally Active! (${warhornBuffInt}s) +25%⚔️⚡`
        this.warhornBtnEl.classList.add('is-active')
        this.warhornBtnEl.classList.remove('is-ready')
      } else if (warhornCdInt > 0) {
        this.warhornBtnEl.disabled = true
        this.warhornBtnEl.textContent = `📯 Warhorn Cooldown (${warhornCdInt}s)`
        this.warhornBtnEl.classList.remove('is-active', 'is-ready')
      } else {
        this.warhornBtnEl.disabled = false
        this.warhornBtnEl.textContent = '📯 Blow Warhorn of Khazad (V)'
        this.warhornBtnEl.classList.add('is-ready')
        this.warhornBtnEl.classList.remove('is-active')
      }
    }
  }

  public loadState(saved: {
    completedChronicleIds?: string[]
    renownXp?: number
    activeContract?: ActiveGuildContract | null
  }): void {
    this.completedChronicleIds.clear()
    if (Array.isArray(saved.completedChronicleIds)) {
      for (const id of saved.completedChronicleIds) {
        if (typeof id === 'string') {
          this.completedChronicleIds.add(id)
        }
      }
    }
    this.renownXp =
      typeof saved.renownXp === 'number' && Number.isFinite(saved.renownXp)
        ? Math.max(0, Math.floor(saved.renownXp))
        : this.completedChronicleIds.size * 110

    this.warhornCooldown = 0
    this.warhornBuffTimer = 0
    if (saved.activeContract && typeof saved.activeContract.type === 'string') {
      this.activeContract = { ...saved.activeContract }
    } else {
      this.activeContract = null
      this.contractCycleIndex = 0
    }
    this.recalculateRank(false)
    this.lastHudSignature = ''
  }
}
