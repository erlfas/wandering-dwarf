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
