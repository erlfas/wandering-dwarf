import bgmUrl from '../../music/Wandering_Through_the_Pines.mp3?url';
import challengeBgmUrl from '../../music/Dwarven_Ring_Sprint.mp3?url';
import nightBgmUrl from '../../music/Night_of_the_Trolls.wav?url';

export class BackgroundMusic {
  private audio: HTMLAudioElement;
  private nightAudio: HTMLAudioElement;
  private challengeAudio: HTMLAudioElement;
  private challengeBlobUrl: string | null = null;
  private nightBlobUrl: string | null = null;
  private isChallengeActive = false;
  private isNightDangerActive = false;
  private isCombatIntense = false;
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

    this.nightAudio = new Audio(nightBgmUrl);
    this.nightAudio.preload = 'auto';
    this.nightAudio.loop = true;
    this.nightAudio.volume = Math.min(1, this.targetVolume * 1.15);

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

    // Pre-buffer the Night of the Trolls danger track into an in-memory Blob URL for instant, gapless night transitions
    fetch(nightBgmUrl)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob) return;
        this.nightBlobUrl = URL.createObjectURL(blob);
        if (!this.isNightDangerActive && this.nightAudio.paused) {
          this.nightAudio.src = this.nightBlobUrl;
          this.nightAudio.load();
        }
      })
      .catch(() => {});

    this.statusEl = document.getElementById(statusElementId);

    this.bindEvents();
    this.tryPlay();
  }

  private getActiveTrack(): HTMLAudioElement {
    if (this.isChallengeActive) return this.challengeAudio;
    if (this.isNightDangerActive) return this.nightAudio;
    return this.audio;
  }

  private pauseInactiveTracks(active: HTMLAudioElement): void {
    if (active !== this.audio && !this.audio.paused) {
      this.audio.pause();
    }
    if (active !== this.nightAudio && !this.nightAudio.paused) {
      this.nightAudio.pause();
    }
    if (active !== this.challengeAudio && !this.challengeAudio.paused) {
      this.challengeAudio.pause();
    }
  }

  private removeUnlockListeners(): void {
    window.removeEventListener('keydown', this.unlockHandler);
    window.removeEventListener('pointerdown', this.unlockHandler);
  }

  private bindEvents(): void {
    // Unlock and start audio on first user interaction if browser blocked initial autoplay
    window.addEventListener('keydown', this.unlockHandler, { passive: true });
    window.addEventListener('pointerdown', this.unlockHandler, { passive: true });

    // Prevent regular daytime music from ever playing on top of an active Ring Sprint or Night Troll danger period
    this.audio.addEventListener('play', () => {
      if (this.isChallengeActive || this.isNightDangerActive) {
        this.audio.pause();
      }
    });

    // Prevent night soundtrack from playing on top of an active Ring Sprint or during daytime
    this.nightAudio.addEventListener('play', () => {
      if (this.isChallengeActive || !this.isNightDangerActive) {
        this.nightAudio.pause();
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

    // Self-healing watchdog: keep Night Troll danger soundtrack playing continuously throughout the night
    const ensureNightPlaying = () => {
      if (
        this.isNightDangerActive &&
        !this.isChallengeActive &&
        this.isStarted &&
        !this.isMuted &&
        this.targetVolume > 0
      ) {
        if (this.nightAudio.paused) {
          void this.nightAudio.play().catch(() => {});
        }
      }
    };
    this.nightAudio.addEventListener('pause', ensureNightPlaying);
    this.nightAudio.addEventListener('stalled', ensureNightPlaying);
    this.nightAudio.addEventListener('waiting', ensureNightPlaying);
    this.nightAudio.addEventListener('suspend', ensureNightPlaying);
    this.nightAudio.addEventListener('ended', () => {
      if (this.isNightDangerActive && !this.isChallengeActive && !this.isMuted) {
        this.nightAudio.currentTime = 0;
        void this.nightAudio.play().catch(() => {});
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
    const activeTrack = this.getActiveTrack();
    activeTrack
      .play()
      .then(() => {
        this.isPlayPending = false;
        this.isStarted = true;
        this.removeUnlockListeners();
        const currentDesired = this.getActiveTrack();
        this.pauseInactiveTracks(currentDesired);
        if (currentDesired !== activeTrack && !this.isMuted) {
          void currentDesired.play().catch(() => {});
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
    this.nightAudio.muted = this.isMuted;
    this.challengeAudio.muted = this.isMuted;
    if (this.isMuted) {
      this.audio.pause();
      this.nightAudio.pause();
      this.challengeAudio.pause();
    } else if (!this.isStarted && !this.isChallengeActive) {
      this.tryPlay();
    } else {
      const active = this.getActiveTrack();
      this.pauseInactiveTracks(active);
      void active.play().catch(() => {});
    }
    this.updateUI();
    return !this.isMuted;
  }

  /**
   * Switches between the peaceful daytime soundtrack ("Wandering Through the Pines")
   * and the ominous night danger soundtrack ("Night of the Trolls") when Night Trolls prowl,
   * or restores peaceful sanctuary music when safe inside a Castle or Dwarven Hut.
   */
  public setNightDangerMode(isNightDanger: boolean, isTrollAggro = false): void {
    if (this.isCombatIntense !== isTrollAggro) {
      this.isCombatIntense = isTrollAggro;
      const mult = isTrollAggro ? 1.28 : 1.15;
      this.nightAudio.volume = Math.min(1, this.targetVolume * mult);
      this.nightAudio.playbackRate = isTrollAggro ? 1.06 : 1.0;
    }

    if (this.isNightDangerActive === isNightDanger) return;
    this.isNightDangerActive = isNightDanger;
    this.nightAudio.muted = this.isMuted;

    if (this.isChallengeActive) {
      this.updateUI();
      return;
    }

    if (isNightDanger) {
      this.audio.pause();
      if (this.nightAudio.readyState >= 1) {
        try {
          this.nightAudio.currentTime = 0;
        } catch {
          // Ignore seek errors
        }
      }
      if (this.isStarted && !this.isMuted) {
        void this.nightAudio.play().catch(() => {});
      }
    } else {
      this.nightAudio.pause();
      if (this.nightBlobUrl && this.nightAudio.src !== this.nightBlobUrl) {
        this.nightAudio.src = this.nightBlobUrl;
        this.nightAudio.load();
      }
      if (this.isStarted && !this.isMuted) {
        void this.audio.play().catch(() => {});
      }
    }
    this.updateUI();
  }

  public startChallengeTune(): void {
    if (this.isChallengeActive) return;
    this.isChallengeActive = true;
    this.audio.pause();
    this.nightAudio.pause();
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
      const nextTrack = this.getActiveTrack();
      this.pauseInactiveTracks(nextTrack);
      void nextTrack.play().catch(() => {});
    }
    this.updateUI();
  }

  public setVolume(vol: number): void {
    this.targetVolume = Math.max(0, Math.min(1, vol));
    this.audio.volume = this.targetVolume;
    this.nightAudio.volume = Math.min(
      1,
      this.targetVolume * (this.isCombatIntense ? 1.28 : 1.15)
    );
    this.challengeAudio.volume = Math.min(1, this.targetVolume * 1.25);
    if (this.targetVolume > 0 && this.isMuted) {
      this.isMuted = false;
      this.audio.muted = false;
      this.nightAudio.muted = false;
      this.challengeAudio.muted = false;
    }
    this.updateUI();
  }

  public getVolume(): number {
    return this.targetVolume;
  }

  private updateUI(): void {
    if (!this.statusEl) return;
    const isNightTrack = !this.isChallengeActive && this.isNightDangerActive;
    const trackLabel = this.isChallengeActive
      ? 'Dwarven Ring Sprint'
      : isNightTrack
        ? 'Night of the Trolls (Danger)'
        : 'Wandering Through the Pines';
    const shortLabel = this.isChallengeActive
      ? 'Sprint'
      : isNightTrack
        ? '👹 Night'
        : 'Music';
    this.statusEl.title = `${trackLabel} — Toggle Music (P)`;
    this.statusEl.classList.toggle('night-danger', isNightTrack && !this.isMuted);
    if (!this.isStarted && !this.isChallengeActive) {
      this.statusEl.textContent = `♪ ${shortLabel} (P)`;
      this.statusEl.classList.add('paused');
    } else if (this.isMuted || this.targetVolume === 0) {
      this.statusEl.textContent = `♪ Muted (P)`;
      this.statusEl.classList.add('paused');
    } else {
      this.statusEl.textContent = `♪ ${shortLabel} (P)`;
      this.statusEl.classList.remove('paused');
    }
  }
}
