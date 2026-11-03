import bgmUrl from '../../music/Wandering_Through_the_Pines.mp3?url';

export class BackgroundMusic {
  private audio: HTMLAudioElement;
  private isStarted = false;
  private isPlayPending = false;
  private isMuted = false;
  private targetVolume = 0.45;
  private statusEl: HTMLElement | null;
  private unlockHandler = () => {
    if (!this.isStarted) {
      this.tryPlay();
    }
  };

  constructor(statusElementId = 'music-toggle') {
    this.audio = new Audio(bgmUrl);
    this.audio.loop = true;
    this.audio.volume = this.targetVolume;
    this.statusEl = document.getElementById(statusElementId);

    this.bindEvents();
    this.tryPlay();
  }

  private bindEvents(): void {
    // Unlock and start audio on first user interaction if browser blocked initial autoplay
    window.addEventListener('keydown', this.unlockHandler, { passive: true });
    window.addEventListener('pointerdown', this.unlockHandler, { passive: true });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !e.repeat) {
        this.toggleMute();
      }
    });

    if (this.statusEl) {
      this.statusEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.isStarted) {
          this.tryPlay();
        } else {
          this.toggleMute();
        }
      });
    }
  }

  private tryPlay(): void {
    if (this.isStarted || this.isPlayPending) return;
    this.isPlayPending = true;
    this.audio
      .play()
      .then(() => {
        this.isPlayPending = false;
        this.isStarted = true;
        window.removeEventListener('keydown', this.unlockHandler);
        window.removeEventListener('pointerdown', this.unlockHandler);
        this.updateUI();
      })
      .catch(() => {
        this.isPlayPending = false;
        // Waiting for first user key press or click to satisfy browser autoplay policy
        this.updateUI();
      });
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    this.audio.muted = this.isMuted;
    if (this.isMuted) {
      if (this.isStarted) {
        this.audio.pause();
      }
    } else if (!this.isStarted) {
      this.tryPlay();
    } else {
      void this.audio.play();
    }
    this.updateUI();
    return !this.isMuted;
  }

  public setVolume(vol: number): void {
    this.targetVolume = Math.max(0, Math.min(1, vol));
    this.audio.volume = this.targetVolume;
    if (this.targetVolume > 0 && this.isMuted) {
      this.isMuted = false;
      this.audio.muted = false;
    }
    this.updateUI();
  }

  public getVolume(): number {
    return this.targetVolume;
  }

  private updateUI(): void {
    if (!this.statusEl) return;
    if (!this.isStarted) {
      this.statusEl.textContent = '♪ Wandering Through the Pines (Click or Move to Play)';
      this.statusEl.classList.add('paused');
    } else if (this.isMuted || this.targetVolume === 0) {
      this.statusEl.textContent = '♪ Wandering Through the Pines (Muted - P)';
      this.statusEl.classList.add('paused');
    } else {
      this.statusEl.textContent = '♪ Wandering Through the Pines (Playing - P)';
      this.statusEl.classList.remove('paused');
    }
  }
}
