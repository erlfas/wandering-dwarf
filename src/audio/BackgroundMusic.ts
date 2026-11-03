import bgmUrl from '../../music/Wandering_Through_the_Pines.mp3?url';
import challengeBgmUrl from '../../music/Dwarven_Ring_Sprint.mp3?url';

export class BackgroundMusic {
  private audio: HTMLAudioElement;
  private challengeAudio: HTMLAudioElement;
  private challengeBlobUrl: string | null = null;
  private isChallengeActive = false;
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
    this.audio.preload = 'auto';
    this.audio.loop = true;
    this.audio.volume = this.targetVolume;

    this.challengeAudio = new Audio(challengeBgmUrl);
    this.challengeAudio.preload = 'auto';
    this.challengeAudio.loop = true;
    this.challengeAudio.volume = Math.min(1, this.targetVolume * 1.25);

    // Pre-buffer the 400KB challenge track into an in-memory Blob URL so it never stalls
    // at the ~64KB (4s / 1-2 ring) HTTP range boundary during a Ring Sprint
    fetch(challengeBgmUrl)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob) return;
        this.challengeBlobUrl = URL.createObjectURL(blob);
        if (!this.isChallengeActive && this.challengeAudio.paused) {
          this.challengeAudio.src = this.challengeBlobUrl;
          this.challengeAudio.load();
        }
      })
      .catch(() => {});

    this.statusEl = document.getElementById(statusElementId);

    this.bindEvents();
    this.tryPlay();
  }

  private removeUnlockListeners(): void {
    window.removeEventListener('keydown', this.unlockHandler);
    window.removeEventListener('pointerdown', this.unlockHandler);
  }

  private bindEvents(): void {
    // Unlock and start audio on first user interaction if browser blocked initial autoplay
    window.addEventListener('keydown', this.unlockHandler, { passive: true });
    window.addEventListener('pointerdown', this.unlockHandler, { passive: true });

    // Prevent regular background music from ever playing on top of an active Ring Sprint
    this.audio.addEventListener('play', () => {
      if (this.isChallengeActive) {
        this.audio.pause();
      }
    });

    // Self-healing watchdog: keep Ring Sprint music playing continuously while challenge is active
    const ensureChallengePlaying = () => {
      if (this.isChallengeActive && !this.isMuted && this.targetVolume > 0) {
        if (this.challengeAudio.paused) {
          void this.challengeAudio.play().catch(() => {});
        }
      }
    };
    this.challengeAudio.addEventListener('pause', ensureChallengePlaying);
    this.challengeAudio.addEventListener('stalled', ensureChallengePlaying);
    this.challengeAudio.addEventListener('waiting', ensureChallengePlaying);
    this.challengeAudio.addEventListener('suspend', ensureChallengePlaying);
    this.challengeAudio.addEventListener('ended', () => {
      if (this.isChallengeActive && !this.isMuted) {
        this.challengeAudio.currentTime = 0;
        void this.challengeAudio.play().catch(() => {});
      }
    });
    this.challengeAudio.addEventListener('timeupdate', () => {
      if (
        this.isChallengeActive &&
        !this.isMuted &&
        Number.isFinite(this.challengeAudio.duration) &&
        this.challengeAudio.duration > 1 &&
        this.challengeAudio.currentTime >= this.challengeAudio.duration - 0.15
      ) {
        this.challengeAudio.currentTime = 0;
        if (this.challengeAudio.paused) {
          void this.challengeAudio.play().catch(() => {});
        }
      }
    });

    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'KeyP' && !e.repeat) {
          this.toggleMute();
        }
      },
      { passive: true }
    );

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
    const activeTrack = this.isChallengeActive ? this.challengeAudio : this.audio;
    activeTrack
      .play()
      .then(() => {
        this.isPlayPending = false;
        this.isStarted = true;
        this.removeUnlockListeners();
        if (this.isChallengeActive && activeTrack !== this.challengeAudio) {
          this.audio.pause();
          void this.challengeAudio.play().catch(() => {});
        }
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
    this.challengeAudio.muted = this.isMuted;
    if (this.isMuted) {
      if (this.isStarted || this.isChallengeActive) {
        this.audio.pause();
        this.challengeAudio.pause();
      }
    } else if (!this.isStarted && !this.isChallengeActive) {
      this.tryPlay();
    } else if (this.isChallengeActive) {
      void this.challengeAudio.play().catch(() => {});
    } else {
      void this.audio.play().catch(() => {});
    }
    this.updateUI();
    return !this.isMuted;
  }

  public startChallengeTune(): void {
    if (this.isChallengeActive) return;
    this.isChallengeActive = true;
    this.audio.pause();
    this.challengeAudio.preload = 'auto';
    this.challengeAudio.loop = true;
    if (this.challengeAudio.readyState >= 1) {
      try {
        this.challengeAudio.currentTime = 0;
      } catch {
        // Ignore seek errors if buffer is still initializing
      }
    }
    this.challengeAudio.muted = this.isMuted;
    if (!this.isMuted) {
      this.challengeAudio
        .play()
        .then(() => {
          this.isStarted = true;
          this.removeUnlockListeners();
          this.updateUI();
        })
        .catch(() => {});
    }
    this.updateUI();
  }

  public stopChallengeTune(): void {
    if (!this.isChallengeActive) return;
    this.isChallengeActive = false;
    this.challengeAudio.pause();
    if (this.challengeBlobUrl && this.challengeAudio.src !== this.challengeBlobUrl) {
      this.challengeAudio.src = this.challengeBlobUrl;
      this.challengeAudio.load();
    } else if (this.challengeAudio.readyState >= 1) {
      try {
        this.challengeAudio.currentTime = 0;
      } catch {
        // Ignore seek errors
      }
    }
    if (this.isStarted && !this.isMuted) {
      void this.audio.play().catch(() => {});
    }
    this.updateUI();
  }

  public setVolume(vol: number): void {
    this.targetVolume = Math.max(0, Math.min(1, vol));
    this.audio.volume = this.targetVolume;
    this.challengeAudio.volume = Math.min(1, this.targetVolume * 1.25);
    if (this.targetVolume > 0 && this.isMuted) {
      this.isMuted = false;
      this.audio.muted = false;
      this.challengeAudio.muted = false;
    }
    this.updateUI();
  }

  public getVolume(): number {
    return this.targetVolume;
  }

  private updateUI(): void {
    if (!this.statusEl) return;
    const trackLabel = this.isChallengeActive
      ? 'Dwarven Ring Sprint'
      : 'Wandering Through the Pines';
    if (!this.isStarted && !this.isChallengeActive) {
      this.statusEl.textContent = `♪ ${trackLabel} (Click or Move to Play)`;
      this.statusEl.classList.add('paused');
    } else if (this.isMuted || this.targetVolume === 0) {
      this.statusEl.textContent = `♪ ${trackLabel} (Muted - P)`;
      this.statusEl.classList.add('paused');
    } else {
      this.statusEl.textContent = `♪ ${trackLabel} (Playing - P)`;
      this.statusEl.classList.remove('paused');
    }
  }
}
