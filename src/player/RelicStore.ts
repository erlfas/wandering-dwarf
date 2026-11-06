export type RelicId =
  | 'strider_boots'
  | 'spring_greaves'
  | 'slide_shield'
  | 'lodestone_amulet';

export interface RelicDefinition {
  id: RelicId;
  keyHint: string;
  name: string;
  icon: string;
  cost: number;
  shortDesc: string;
}

export const RELIC_CATALOG: readonly RelicDefinition[] = [
  {
    id: 'strider_boots',
    keyHint: '1',
    name: 'Boots of the Strider',
    icon: '🥾',
    cost: 100,
    shortDesc: '+25% Sprint & +45% Trailblazer Footpath Speed',
  },
  {
    id: 'spring_greaves',
    keyHint: '2',
    name: 'Skyforge Greaves & Glider',
    icon: '🪂',
    cost: 150,
    shortDesc: 'Double-Jump & hold Space in mid-air to Glide across valleys',
  },
  {
    id: 'slide_shield',
    keyHint: '3',
    name: 'Ironbelly Surf-Shield',
    icon: '🛡️',
    cost: 200,
    shortDesc: 'Hold C / Ctrl for Turbo Downhill Slope Surfing & Dodge-Dash',
  },
  {
    id: 'lodestone_amulet',
    keyHint: '4',
    name: 'Lodestone Runes',
    icon: '🧭',
    cost: 250,
    shortDesc: '3x Chest Magnet Radius, +50% Gold Bonus & Compass Chest Pointer',
  },
];

type RelicCardState = 'owned' | 'affordable' | 'locked';

interface CachedRelicRow {
  def: RelicDefinition;
  button: HTMLButtonElement;
  costSpan: HTMLSpanElement;
  lastState: RelicCardState | '';
}

let sharedAudioCtx: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioContext();
    }
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Manages Dwarven Relic upgrades, HUD shop interactions, and synthesized Web Audio feedback
 * for movement (jump, double-jump, glide, slide/dash) and relic unlocking.
 */
export class RelicStore {
  private unlocked = new Set<RelicId>();
  private isOpen = false;
  private cachedRows: CachedRelicRow[] = [];

  private shopContainer: HTMLElement | null;
  private shopListEl: HTMLElement | null;
  private toggleBtnEl: HTMLElement | null;
  private toastContainer: HTMLElement | null;

  public onRelicUnlocked?: () => void;

  constructor(
    private getGold: () => number,
    private spendGold: (amount: number) => boolean
  ) {
    this.shopContainer = document.getElementById('relic-shop');
    this.shopListEl = document.getElementById('relic-list');
    this.toggleBtnEl = document.getElementById('relic-shop-toggle');
    this.toastContainer = document.getElementById('pickup-toasts');

    this.toggleBtnEl?.addEventListener('click', () => {
      this.toggleDrawer();
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyB') {
        this.toggleDrawer();
      } else if (e.code === 'Digit1') {
        this.tryBuy('strider_boots');
      } else if (e.code === 'Digit2') {
        this.tryBuy('spring_greaves');
      } else if (e.code === 'Digit3') {
        this.tryBuy('slide_shield');
      } else if (e.code === 'Digit4') {
        this.tryBuy('lodestone_amulet');
      }
    });

    this.buildShopDOM();
    this.renderShop();
  }

  public has(id: RelicId): boolean {
    return this.unlocked.has(id);
  }

  public getUnlockedCount(): number {
    return this.unlocked.size;
  }

  public getUnlockedIds(): string[] {
    return Array.from(this.unlocked);
  }

  public restoreUnlocked(ids: string[] | undefined): void {
    this.unlocked.clear();
    if (ids) {
      for (const id of ids) {
        if (RELIC_CATALOG.some((r) => r.id === id)) {
          this.unlocked.add(id as RelicId);
        }
      }
    }
    this.renderShop();
  }

  public reset(): void {
    this.unlocked.clear();
    this.renderShop();
  }

  public toggleDrawer(): void {
    this.isOpen = !this.isOpen;
    if (this.shopContainer) {
      this.shopContainer.classList.toggle('collapsed', !this.isOpen);
    }
  }

  public tryBuy(id: RelicId): boolean {
    if (this.unlocked.has(id)) return false;
    const def = RELIC_CATALOG.find((r) => r.id === id);
    if (!def) return false;

    if (!this.spendGold(def.cost)) {
      this.playDeniedSound();
      this.showToast(`Need ${def.cost} Gold for ${def.name}!`, false);
      return false;
    }

    this.unlocked.add(id);
    this.playUnlockFanfare();
    this.showToast(`${def.icon} Unlocked ${def.name}!`, true);
    this.renderShop();
    this.onRelicUnlocked?.();
    return true;
  }

  private buildShopDOM(): void {
    if (!this.shopListEl) return;
    this.shopListEl.innerHTML = '';
    this.cachedRows = [];

    for (const def of RELIC_CATALOG) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'relic-card locked';
      button.title = `${def.name}: ${def.shortDesc} (Press ${def.keyHint})`;

      const iconSpan = document.createElement('span');
      iconSpan.className = 'relic-icon';
      iconSpan.textContent = def.icon;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'relic-name';
      const kbd = document.createElement('kbd');
      kbd.className = 'relic-key';
      kbd.textContent = def.keyHint;
      nameSpan.appendChild(kbd);
      nameSpan.appendChild(document.createTextNode(` ${def.name}`));

      const costSpan = document.createElement('span');
      costSpan.className = 'relic-cost';
      costSpan.textContent = `${def.cost}g`;

      button.appendChild(iconSpan);
      button.appendChild(nameSpan);
      button.appendChild(costSpan);

      button.addEventListener('click', () => {
        if (!this.unlocked.has(def.id)) {
          this.tryBuy(def.id);
        }
      });

      this.shopListEl.appendChild(button);
      this.cachedRows.push({
        def,
        button,
        costSpan,
        lastState: '',
      });
    }
  }

  public renderShop(): void {
    if (!this.shopListEl) return;
    const gold = this.getGold();

    for (let i = 0; i < this.cachedRows.length; i++) {
      const row = this.cachedRows[i];
      const owned = this.unlocked.has(row.def.id);
      const canAfford = !owned && gold >= row.def.cost;
      const nextState: RelicCardState = owned ? 'owned' : canAfford ? 'affordable' : 'locked';

      if (row.lastState !== nextState) {
        row.lastState = nextState;
        row.button.className = `relic-card ${nextState}`;
        row.costSpan.className = owned ? 'relic-cost owned-badge' : 'relic-cost';
        row.costSpan.textContent = owned ? '✓' : `${row.def.cost}g`;
      }
    }
  }

  private showToast(message: string, isHighlight: boolean): void {
    if (!this.toastContainer) return;
    while (this.toastContainer.children.length >= 3) {
      this.toastContainer.firstElementChild?.remove();
    }
    const toast = document.createElement('div');
    toast.className = `pickup-toast ${isHighlight ? 'rare' : ''}`;
    toast.textContent = message;
    this.toastContainer.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 2300);
  }

  private ensureAudio(): AudioContext | null {
    return getSharedAudioContext();
  }

  public playJumpSound(isDoubleJump: boolean): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isDoubleJump ? 'triangle' : 'sine';
    const startFreq = isDoubleJump ? 290 : 185;
    const endFreq = isDoubleJump ? 580 : 340;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.16);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.13, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playDashSlideSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.22);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.25);
  }

  private playDeniedSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.setValueAtTime(120, now + 0.08);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.2);
  }

  private lastThermalSfxTime = 0;

  public playThermalUpdraftSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastThermalSfxTime < 0.55) return;
    this.lastThermalSfxTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(460, now + 0.42);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.5);
  }

  public playGroundSlamImpactSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Deep sub-bass boom
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(140, now);
    subOsc.frequency.exponentialRampToValueAtTime(32, now + 0.35);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.exponentialRampToValueAtTime(0.24, now + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.onended = () => {
      subOsc.disconnect();
      subGain.disconnect();
    };
    subOsc.start(now);
    subOsc.stop(now + 0.44);

    // Punch crack / transient
    const crackOsc = ctx.createOscillator();
    const crackGain = ctx.createGain();
    crackOsc.type = 'sawtooth';
    crackOsc.frequency.setValueAtTime(260, now);
    crackOsc.frequency.exponentialRampToValueAtTime(65, now + 0.14);

    crackGain.gain.setValueAtTime(0.001, now);
    crackGain.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    crackOsc.connect(crackGain);
    crackGain.connect(ctx.destination);
    crackOsc.onended = () => {
      crackOsc.disconnect();
      crackGain.disconnect();
    };
    crackOsc.start(now);
    crackOsc.stop(now + 0.18);
  }

  public playSurfRamSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Heavy bronze shield collision clang
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.22);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.26);
  }

  public playShieldBashSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Deep heavy metallic gong + bone-crushing transient
    const gong = ctx.createOscillator();
    const gongGain = ctx.createGain();
    gong.type = 'triangle';
    gong.frequency.setValueAtTime(220, now);
    gong.frequency.exponentialRampToValueAtTime(55, now + 0.45);

    gongGain.gain.setValueAtTime(0.001, now);
    gongGain.gain.exponentialRampToValueAtTime(0.28, now + 0.01);
    gongGain.gain.exponentialRampToValueAtTime(0.001, now + 0.52);

    gong.connect(gongGain);
    gongGain.connect(ctx.destination);
    gong.onended = () => {
      gong.disconnect();
      gongGain.disconnect();
    };
    gong.start(now);
    gong.stop(now + 0.55);

    const punch = ctx.createOscillator();
    const punchGain = ctx.createGain();
    punch.type = 'sawtooth';
    punch.frequency.setValueAtTime(540, now);
    punch.frequency.exponentialRampToValueAtTime(90, now + 0.18);

    punchGain.gain.setValueAtTime(0.001, now);
    punchGain.gain.exponentialRampToValueAtTime(0.24, now + 0.008);
    punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    punch.connect(punchGain);
    punchGain.connect(ctx.destination);
    punch.onended = () => {
      punch.disconnect();
      punchGain.disconnect();
    };
    punch.start(now);
    punch.stop(now + 0.25);
  }

  public playBombExplosionSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Sub-bass detonation thump
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(160, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.48);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.onended = () => {
      sub.disconnect();
      subGain.disconnect();
    };
    sub.start(now);
    sub.stop(now + 0.58);

    // Blast crackle
    const blast = ctx.createOscillator();
    const blastGain = ctx.createGain();
    blast.type = 'sawtooth';
    blast.frequency.setValueAtTime(380, now);
    blast.frequency.exponentialRampToValueAtTime(45, now + 0.28);

    blastGain.gain.setValueAtTime(0.001, now);
    blastGain.gain.exponentialRampToValueAtTime(0.28, now + 0.015);
    blastGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    blast.connect(blastGain);
    blastGain.connect(ctx.destination);
    blast.onended = () => {
      blast.disconnect();
      blastGain.disconnect();
    };
    blast.start(now);
    blast.stop(now + 0.35);
  }

  public playBulletTimeEnterSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(580, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.32);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.4);
  }

  public playBulletTimeExitSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.2);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.26);
  }

  public playGrappleShootSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(840, now + 0.14);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playGrappleLatchSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1250, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.12);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.24);
  }

  public playGrappleFlingSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.22);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public playSpeedGateChimeSound(combo = 1): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const baseFrequencies = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
    const pitchShift = Math.min(combo - 1, 5);
    const f1 = baseFrequencies[pitchShift];
    const f2 = f1 * 1.5;

    [f1, f2].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.04);

      gain.gain.setValueAtTime(0.001, now + idx * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.04 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + 0.38);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.04);
      osc.stop(now + idx * 0.04 + 0.4);
    });
  }

  public playZiplineWhirSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.linearRampToValueAtTime(560, now + 0.25);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public playMeteorStreakSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(850, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 1.8);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.95);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 2.0);
  }

  public playMeteorImpactSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(95, now);
    sub.frequency.exponentialRampToValueAtTime(22, now + 0.85);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.exponentialRampToValueAtTime(0.48, now + 0.03);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);

    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.onended = () => {
      sub.disconnect();
      subGain.disconnect();
    };
    sub.start(now);
    sub.stop(now + 1.0);
  }

  public playTitanStompSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.45);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.42, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.52);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.55);
  }

  public playTitanRoarSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(75, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.35);
    osc.frequency.exponentialRampToValueAtTime(45, now + 1.1);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.15);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 1.2);
  }

  public playTitanDefeatedFanfare(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [293.66, 369.99, 440.0, 587.33, 739.99, 880.0];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);

      gain.gain.setValueAtTime(0.001, now + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.25, now + idx * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.55);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.6);
    });
  }

  public playMirrorRotateSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const gear = ctx.createOscillator();
    const gearGain = ctx.createGain();
    gear.type = 'sawtooth';
    gear.frequency.setValueAtTime(450, now);
    gear.frequency.exponentialRampToValueAtTime(880, now + 0.08);

    gearGain.gain.setValueAtTime(0.001, now);
    gearGain.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
    gearGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    gear.connect(gearGain);
    gearGain.connect(ctx.destination);
    gear.onended = () => {
      gear.disconnect();
      gearGain.disconnect();
    };
    gear.start(now);
    gear.stop(now + 0.12);

    const chime = ctx.createOscillator();
    const chimeGain = ctx.createGain();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(1760, now + 0.04);
    chime.frequency.exponentialRampToValueAtTime(2200, now + 0.28);

    chimeGain.gain.setValueAtTime(0.001, now + 0.04);
    chimeGain.gain.exponentialRampToValueAtTime(0.12, now + 0.05);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    chime.connect(chimeGain);
    chimeGain.connect(ctx.destination);
    chime.onended = () => {
      chime.disconnect();
      chimeGain.disconnect();
    };
    chime.start(now + 0.04);
    chime.stop(now + 0.34);
  }

  public playVaultGateOpenSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(65, now);
    sub.frequency.linearRampToValueAtTime(48, now + 1.2);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.exponentialRampToValueAtTime(0.28, now + 0.05);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);

    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.onended = () => {
      sub.disconnect();
      subGain.disconnect();
    };
    sub.start(now);
    sub.stop(now + 1.3);
  }

  public playCavernCrystalChime(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes = [659.25, 880.0, 1174.66, 1760.0];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.001, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.65);
    });
  }

  public playOreMinedSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;

    const clink = ctx.createOscillator();
    const clinkGain = ctx.createGain();
    clink.type = 'triangle';
    clink.frequency.setValueAtTime(980, now);
    clink.frequency.exponentialRampToValueAtTime(420, now + 0.14);

    clinkGain.gain.setValueAtTime(0.001, now);
    clinkGain.gain.exponentialRampToValueAtTime(0.22, now + 0.015);
    clinkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    clink.connect(clinkGain);
    clinkGain.connect(ctx.destination);
    clink.onended = () => {
      clink.disconnect();
      clinkGain.disconnect();
    };
    clink.start(now);
    clink.stop(now + 0.18);
  }

  private playUnlockFanfare(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);

      gain.gain.setValueAtTime(0.001, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.07 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.42);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.44);
    });
  }
}
