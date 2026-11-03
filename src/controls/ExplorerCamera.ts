import * as THREE from 'three';
import { WorldConfig } from '../world/Config';
import { ChunkManager } from '../world/ChunkManager';
import { TerrainNoise } from '../world/TerrainNoise';
import { DwarfCharacter } from '../player/DwarfCharacter';
import { RelicStore } from '../player/RelicStore';
import { LandmarkManager } from '../world/LandmarkManager';
import { FishingAndFishManager } from '../world/FishingAndFishManager';

const tempSlopeNormal = new THREE.Vector3();

/**
 * Handles player input, third-person elevated follow camera (matching the concept art angle),
 * expressive traversal (jumping, double-jump, wind gliding, downhill slope surfing, footpath boosts),
 * and free-fly inspection mode.
 */
export class ExplorerCamera {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly playerPos = new THREE.Vector3(0, 0, 0);

  // Spherical orbit angles around the dwarf (matched to the high-angle vistas in the reference art)
  public yaw = 0.35;           // Horizontal orbit angle (radians)
  public pitch = 0.46;         // Elevation angle above horizon (~26 deg, looking out across valleys)
  public distance = 11.5;      // Camera distance behind the dwarf

  private keys = new Set<string>();
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private moveBasisYaw = 0.35;
  private prevForward = 0;
  private prevRight = 0;
  private followActive = false;
  private mouseOverrideTimer = 0;
  private smoothedTarget = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private lastGroundY = 0;
  private lastGroundSampleX = NaN;
  private lastGroundSampleZ = NaN;
  private lastTrackSampleX = NaN;
  private lastTrackSampleZ = NaN;
  private cachedTrackW = 0;

  // Vertical jump & glide physics
  private velY = 0;
  private heightAboveGround = 0;
  private jumpsUsed = 0;
  private isGliding = false;

  // Downhill slope surfing & dodge-dash physics
  private slideSpeed = 0;
  private dashTimer = 0;
  private dashCooldown = 0;
  private isSliding = false;
  private isTrailblazing = false;
  private currentSpeed = 0;
  private relicStore?: RelicStore;
  private landmarkManager?: LandmarkManager;
  private fishingManager?: FishingAndFishManager;
  public lastAimForward = 0;
  public lastAimRight = 0;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    private config: WorldConfig,
    private noise: TerrainNoise,
    private chunkManager: ChunkManager,
    private dwarf: DwarfCharacter,
    private onToggleWireframe?: () => void,
    private onToggleMode?: () => void
  ) {
    this.camera = camera;
    this.resetToOrigin();
    this.bindEvents(domElement);
  }

  public setRelicStore(store: RelicStore): void {
    this.relicStore = store;
  }

  public setLandmarkManager(lm: LandmarkManager): void {
    this.landmarkManager = lm;
  }

  public setFishingManager(fm: FishingAndFishManager): void {
    this.fishingManager = fm;
  }

  public isAttackingOrAirborne(): boolean {
    return this.isSliding || this.heightAboveGround > 0.25;
  }

  public applyHazardBump(): void {
    this.velY = 6.2;
    this.heightAboveGround = Math.max(this.heightAboveGround, 0.08);
    this.dwarf.spawnBurst(this.playerPos.x, this.playerPos.y, this.playerPos.z, 10);
  }

  public getMovementStatus(): string {
    if (this.fishingManager?.isFishingActive()) {
      return `🎣 Fishing (${this.fishingManager.fishCaughtCount} Caught)`;
    }
    if (this.isGliding) return '🪂 Wind Gliding';
    if (this.isSliding) return `🛡️ Slope Surfing (${this.currentSpeed.toFixed(0)}m/s)`;
    if (this.heightAboveGround > 0.35) return '⏫ Airborne';
    const hasWarmth = this.landmarkManager?.hasCampfireBuff() ?? false;
    if (this.isTrailblazing && this.currentSpeed > 4.0) {
      const pct = this.relicStore?.has('strider_boots') ? '+45%' : '+25%';
      return hasWarmth ? `⚡ Trailblazer (${pct}) • 🔥 Warmth` : `⚡ Trailblazer Path (${pct})`;
    }
    if (hasWarmth) {
      return `🔥 Campfire Warmth (+20% Speed • ${Math.ceil(this.landmarkManager!.campfireBuffTimer)}s)`;
    }
    if (this.relicStore?.has('strider_boots') && this.currentSpeed > 10.0) {
      return '🥾 Strider Sprint';
    }
    return '';
  }

  public getHeading(): number {
    return this.dwarf.heading;
  }

  public setPose(
    x: number,
    z: number,
    heading: number,
    yaw: number,
    pitch: number,
    distance: number
  ): void {
    const groundY = this.noise.getHeight(x, z);
    this.lastGroundY = groundY;
    this.lastGroundSampleX = x;
    this.lastGroundSampleZ = z;
    this.lastTrackSampleX = NaN;
    this.lastTrackSampleZ = NaN;
    const swimSurfaceY = this.config.waterLevel - 0.54;
    const y =
      this.config.enableWater && !this.config.blankClayMode
        ? Math.max(groundY, swimSurfaceY)
        : groundY;

    this.playerPos.set(x, y, z);
    this.dwarf.heading = heading;
    this.dwarf.root.position.copy(this.playerPos);
    this.dwarf.root.rotation.y = heading;

    this.yaw = yaw;
    this.moveBasisYaw = yaw;
    this.prevForward = 0;
    this.prevRight = 0;
    this.followActive = false;
    this.mouseOverrideTimer = 0;
    this.pitch = THREE.MathUtils.clamp(pitch, 0.08, Math.PI * 0.44);
    this.distance = THREE.MathUtils.clamp(distance, 4.0, 45.0);

    const lookHeightOffset = this.config.cameraMode === 'dwarf' ? 1.55 : 4.0;
    this.smoothedTarget.set(x, y + lookHeightOffset, z);
  }

  public resetToOrigin(): void {
    const trackHeading = this.config.enableTracks ? this.noise.getTrackHeading(0, 0) : 0;
    const defaultYaw = trackHeading + Math.PI;
    this.setPose(0, 0, trackHeading, defaultYaw, 0.46, 11.5);
  }

  private bindEvents(domElement: HTMLElement): void {
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat) return;
        const code = e.code;
        this.keys.add(code);

        // Use V (instead of C, which is easy to hit accidentally next to D/S) to toggle camera mode
        if (code === 'KeyV') {
          this.config.cameraMode = this.config.cameraMode === 'dwarf' ? 'free' : 'dwarf';
          this.onToggleMode?.();
        } else if (code === 'KeyM') {
          this.config.wireframe = !this.config.wireframe;
          this.onToggleWireframe?.();
        } else if (code === 'Space') {
          if (!this.fishingManager?.isFishingActive()) {
            this.tryJump();
          }
        } else if (code === 'KeyC' || code === 'ControlLeft' || code === 'ControlRight') {
          if (!this.fishingManager?.isFishingActive()) {
            this.tryStartSlideOrDash();
          }
        }
      },
      { passive: true }
    );

    window.addEventListener(
      'keyup',
      (e) => {
        this.keys.delete(e.code);
      },
      { passive: true }
    );

    // Clear held keys if window loses focus so character doesn't keep running off screen
    window.addEventListener(
      'blur',
      () => {
        this.keys.clear();
        this.isDragging = false;
      },
      { passive: true }
    );

    domElement.addEventListener(
      'mousedown',
      (e) => {
        if (e.button === 0 || e.button === 2) {
          this.isDragging = true;
          this.lastMouseX = e.clientX;
          this.lastMouseY = e.clientY;
        }
      },
      { passive: true }
    );

    domElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    window.addEventListener(
      'mouseup',
      () => {
        this.isDragging = false;
      },
      { passive: true }
    );

    window.addEventListener(
      'mousemove',
      (e) => {
        if (!this.isDragging) return;
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        if (dx === 0 && dy === 0) return;

        // Manual mouse orbit overrides the behind-the-dwarf auto-follow camera
        this.followActive = false;
        this.mouseOverrideTimer = 1.25;

        const sensitivity = 0.0045;
        this.yaw -= dx * sensitivity;
        this.pitch = THREE.MathUtils.clamp(
          this.pitch + dy * sensitivity,
          0.08,
          Math.PI * 0.44
        );
      },
      { passive: true }
    );

    domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(
          this.distance + e.deltaY * 0.012,
          4.0,
          45.0
        );
      },
      { passive: false }
    );
  }

  private tryJump(): void {
    const hasSpringGreaves = this.relicStore?.has('spring_greaves') ?? false;
    const warmthBoost = this.landmarkManager?.hasCampfireBuff() ? 1.15 : 1.0;
    const maxJumps = hasSpringGreaves ? 2 : 1;

    if (this.heightAboveGround <= 0.15) {
      this.velY = (hasSpringGreaves ? 10.8 : 8.5) * warmthBoost;
      this.jumpsUsed = 1;
      this.dwarf.spawnBurst(this.playerPos.x, this.playerPos.y, this.playerPos.z, 8);
      this.relicStore?.playJumpSound(false);
    } else if (this.jumpsUsed < maxJumps) {
      this.velY = 9.8 * warmthBoost;
      this.jumpsUsed += 1;
      this.dwarf.spawnBurst(this.playerPos.x, this.playerPos.y, this.playerPos.z, 12);
      this.relicStore?.playJumpSound(true);
    }
  }

  private tryStartSlideOrDash(): void {
    if (this.dashCooldown <= 0 && this.heightAboveGround <= 0.25) {
      const hasShield = this.relicStore?.has('slide_shield') ?? false;
      this.dashTimer = hasShield ? 0.36 : 0.24;
      this.dashCooldown = hasShield ? 0.55 : 0.85;
      this.slideSpeed = Math.max(this.slideSpeed, hasShield ? 21.0 : 16.0);
      this.dwarf.spawnBurst(this.playerPos.x, this.playerPos.y, this.playerPos.z, 10);
      this.relicStore?.playDashSlideSound();
    }
  }

  public update(dt: number): void {
    if (this.dashCooldown > 0) this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    if (this.dashTimer > 0) this.dashTimer = Math.max(0, this.dashTimer - dt);

    // Gather movement input
    let forward = 0;
    let right = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;

    this.lastAimForward = forward;
    this.lastAimRight = right;
    const isFishing = this.fishingManager?.isFishingActive() ?? false;
    if (isFishing) {
      // While in Fishing Mode, W/S/A/D aims the fishing cast rather than walking away from the shore
      forward = 0;
      right = 0;
    }

    const isSprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const holdingSlideKey =
      this.keys.has('KeyC') ||
      this.keys.has('ControlLeft') ||
      this.keys.has('ControlRight');

    const hasStriderBoots = this.relicStore?.has('strider_boots') ?? false;
    const hasSpringGreaves = this.relicStore?.has('spring_greaves') ?? false;
    const hasSlideShield = this.relicStore?.has('slide_shield') ?? false;

    const sprintMult = this.config.sprintMultiplier * (hasStriderBoots ? 1.25 : 1.0);
    let baseSpeed = this.config.walkSpeed * (isSprinting ? sprintMult : 1.0);

    // Check terrain depth vs water level using cached ground height
    let isSwimming =
      this.config.enableWater &&
      !this.config.blankClayMode &&
      this.lastGroundY < this.config.waterLevel - 0.38;

    // Evaluate Trailblazer footpath boost when moving on worn dirt trails
    const wantsMove = forward !== 0 || right !== 0 || holdingSlideKey || this.dashTimer > 0;
    if (wantsMove && !isSwimming && this.config.enableTracks) {
      const tdx = this.playerPos.x - this.lastTrackSampleX;
      const tdz = this.playerPos.z - this.lastTrackSampleZ;
      if (tdx * tdx + tdz * tdz > 0.04) {
        this.lastTrackSampleX = this.playerPos.x;
        this.lastTrackSampleZ = this.playerPos.z;
        this.cachedTrackW = this.noise.getTrackWeight(
          this.playerPos.x,
          this.playerPos.z,
          this.lastGroundY
        );
      }
      this.isTrailblazing = this.cachedTrackW > 0.35;
    } else if (!wantsMove || isSwimming || !this.config.enableTracks) {
      this.isTrailblazing = false;
    }
    if (this.isTrailblazing) {
      baseSpeed *= hasStriderBoots ? 1.45 : 1.25;
    }
    if (this.landmarkManager?.hasCampfireBuff()) {
      baseSpeed *= 1.2;
    }

    if (this.mouseOverrideTimer > 0 && !this.isDragging) {
      this.mouseOverrideTimer = Math.max(0, this.mouseOverrideTimer - dt);
    }

    // Update movement reference yaw so the camera can swing behind the dwarf without
    // spinning him in circles when holding A, D, or S, while still allowing mouse override
    const inputChanged = forward !== this.prevForward || right !== this.prevRight;
    const hasMoveInput = forward !== 0 || right !== 0;
    const wasMoving = this.prevForward !== 0 || this.prevRight !== 0;

    if (hasMoveInput) {
      if (inputChanged) {
        if (!this.isDragging) {
          this.mouseOverrideTimer = 0;
          this.followActive = true;
        }
        if (wasMoving && forward > 0 && right === 0 && !this.isDragging && this.followActive) {
          // Smoothly continue along current heading when transitioning back to straight W
          this.moveBasisYaw = this.dwarf.heading + Math.PI;
        } else {
          this.moveBasisYaw = this.yaw;
        }
      } else if (!this.isDragging && this.mouseOverrideTimer <= 0) {
        if (forward > 0 && right !== 0) {
          // Holding W+A or W+D smoothly steers around curves as the camera follows behind
          this.moveBasisYaw = this.yaw;
        } else if (forward > 0 && right === 0 && !this.followActive) {
          this.moveBasisYaw = this.yaw;
        }
      }
    }
    this.prevForward = forward;
    this.prevRight = right;

    // Compute horizontal movement basis vectors from moveBasisYaw
    const sinBasis = Math.sin(this.moveBasisYaw);
    const cosBasis = Math.cos(this.moveBasisYaw);
    const camForwardX = -sinBasis;
    const camForwardZ = -cosBasis;
    const camRightX = cosBasis;
    const camRightZ = -sinBasis;

    let moveX = camForwardX * forward + camRightX * right;
    let moveZ = camForwardZ * forward + camRightZ * right;
    const moveLen = Math.hypot(moveX, moveZ);

    let slopePitch = 0;

    let actualSpeed = 0;
    let targetHeading: number | null = null;
    this.isSliding = false;

    // Downhill Slope Surfing & Dodge-Dash
    if (
      this.config.cameraMode === 'dwarf' &&
      !isSwimming &&
      this.heightAboveGround <= 0.3 &&
      (holdingSlideKey || this.dashTimer > 0)
    ) {
      this.isSliding = true;
      // Lazily sample O(1) chunk surface normal only when sliding/dashing
      this.chunkManager.getSurfaceNormal(this.playerPos.x, this.playerPos.z, tempSlopeNormal);
      const slopeHorizLen = Math.hypot(tempSlopeNormal.x, tempSlopeNormal.z);
      const downhillX = slopeHorizLen > 0.001 ? tempSlopeNormal.x / slopeHorizLen : 0;
      const downhillZ = slopeHorizLen > 0.001 ? tempSlopeNormal.z / slopeHorizLen : 0;

      // Steer direction blends player input and downhill vector
      let dirX = moveLen > 0.001 ? moveX / moveLen : Math.sin(this.dwarf.heading);
      let dirZ = moveLen > 0.001 ? moveZ / moveLen : Math.cos(this.dwarf.heading);

      const downhillAlignment = dirX * downhillX + dirZ * downhillZ;
      const slopeSteepness = 1.0 - tempSlopeNormal.y;

      if (slopeHorizLen > 0.06 && downhillAlignment > -0.25) {
        // Accelerate down the slope!
        const maxSurfSpeed = hasSlideShield ? 28.5 : 21.0;
        const accel = (18.0 + slopeSteepness * 65.0) * (hasSlideShield ? 1.35 : 1.0);
        this.slideSpeed = Math.min(maxSurfSpeed, Math.max(this.slideSpeed, baseSpeed) + accel * dt);
        dirX = dirX * 0.55 + downhillX * 0.45;
        dirZ = dirZ * 0.55 + downhillZ * 0.45;
        const dLen = Math.hypot(dirX, dirZ) || 1;
        dirX /= dLen;
        dirZ /= dLen;
        slopePitch = slopeHorizLen * 0.65;
      } else if (this.dashTimer > 0) {
        this.slideSpeed = Math.max(this.slideSpeed, hasSlideShield ? 20.5 : 15.5);
      } else {
        // Friction on flat/uphill ground when holding slide
        this.slideSpeed = Math.max(baseSpeed * 0.75, this.slideSpeed - 14.0 * dt);
      }

      actualSpeed = this.slideSpeed;
      const prevX = this.playerPos.x;
      const prevZ = this.playerPos.z;
      const stepDist = actualSpeed * dt;
      this.playerPos.x += dirX * stepDist;
      this.playerPos.z += dirZ * stepDist;
      targetHeading = Math.atan2(dirX, dirZ);

      this.chunkManager.resolveObstacleCollision(this.playerPos, 0.38);
      this.landmarkManager?.resolveObstacleCollision(
        this.playerPos,
        0.38,
        this.heightAboveGround
      );
      const movedDist = Math.hypot(this.playerPos.x - prevX, this.playerPos.z - prevZ);
      if (stepDist > 0.0001 && movedDist < stepDist * 0.15) {
        actualSpeed = 0;
        this.slideSpeed = 0;
      }
    } else {
      this.slideSpeed = Math.max(0, this.slideSpeed - 20.0 * dt);

      if (moveLen > 0.001) {
        moveX /= moveLen;
        moveZ /= moveLen;

        const glideBoost = this.isGliding ? (hasSpringGreaves ? 1.35 : 1.15) : 1.0;
        const modeSpeedMultiplier =
          this.config.cameraMode === 'free' ? 2.5 : isSwimming ? 0.78 : glideBoost;
        actualSpeed = baseSpeed * modeSpeedMultiplier;

        const prevX = this.playerPos.x;
        const prevZ = this.playerPos.z;
        const stepDist = actualSpeed * dt;
        this.playerPos.x += moveX * stepDist;
        this.playerPos.z += moveZ * stepDist;
        targetHeading = Math.atan2(moveX, moveZ);

        if (this.config.cameraMode === 'dwarf') {
          this.chunkManager.resolveObstacleCollision(this.playerPos, 0.38);
          this.landmarkManager?.resolveObstacleCollision(
            this.playerPos,
            0.38,
            this.heightAboveGround
          );
          const movedDist = Math.hypot(this.playerPos.x - prevX, this.playerPos.z - prevZ);
          if (stepDist > 0.0001 && movedDist < stepDist * 0.15) {
            actualSpeed = 0;
          }
        }
      }
    }

    this.currentSpeed = actualSpeed;

    // Evaluate surface floor height (reusing cached groundY when stationary)
    let groundY = this.lastGroundY;
    if (
      this.playerPos.x !== this.lastGroundSampleX ||
      this.playerPos.z !== this.lastGroundSampleZ
    ) {
      this.lastGroundSampleX = this.playerPos.x;
      this.lastGroundSampleZ = this.playerPos.z;
      const rawGroundY = this.chunkManager.getSurfaceHeight(this.playerPos.x, this.playerPos.z);
      groundY = this.landmarkManager
        ? this.landmarkManager.getBridgeDeckHeight(this.playerPos.x, this.playerPos.z, rawGroundY)
        : rawGroundY;
      this.lastGroundY = groundY;
    }
    isSwimming =
      this.config.enableWater &&
      !this.config.blankClayMode &&
      groundY < this.config.waterLevel - 0.38;
    const swimSurfaceY = this.config.waterLevel - 0.54;
    const floorY =
      this.config.enableWater && !this.config.blankClayMode
        ? Math.max(groundY, swimSurfaceY)
        : groundY;

    // Vertical Jump & Wind-Glider Physics
    const holdingJump = this.keys.has('Space') && !isFishing;
    this.isGliding =
      !isSwimming &&
      holdingJump &&
      this.velY < 0 &&
      this.heightAboveGround > 0.85;

    if (this.heightAboveGround > 0 || this.velY > 0) {
      const gravity = this.isGliding ? (hasSpringGreaves ? 4.2 : 7.5) : 22.5;
      this.velY -= gravity * dt;
      if (this.isGliding) {
        const terminalGlideVel = hasSpringGreaves ? -1.85 : -3.1;
        if (this.velY < terminalGlideVel) {
          this.velY = terminalGlideVel;
        }
      }
      this.playerPos.y = floorY + this.heightAboveGround + this.velY * dt;
      this.heightAboveGround = this.playerPos.y - floorY;

      if (this.heightAboveGround <= 0) {
        if (this.velY < -7.0 && !isSwimming) {
          this.dwarf.spawnBurst(this.playerPos.x, floorY, this.playerPos.z, 7);
        }
        this.heightAboveGround = 0;
        this.velY = 0;
        this.jumpsUsed = 0;
        this.isGliding = false;
        this.playerPos.y = floorY;
      }
    } else {
      this.heightAboveGround = 0;
      this.velY = 0;
      this.jumpsUsed = 0;
      this.playerPos.y = floorY;
    }

    // Always keep the dwarf visible unless explicitly unchecked in the debug panel
    this.dwarf.root.visible = this.config.showDwarfProxy;
    this.dwarf.update(
      dt,
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      actualSpeed,
      targetHeading,
      isSwimming,
      this.isGliding,
      this.isSliding,
      this.isTrailblazing,
      slopePitch
    );

    // Smooth camera target follow (snap at epsilon to avoid subnormal float decay)
    const lookHeightOffset = this.config.cameraMode === 'dwarf' ? 1.55 : 4.0;
    this.desiredTarget.set(
      this.playerPos.x,
      this.playerPos.y + lookHeightOffset,
      this.playerPos.z
    );
    if (this.smoothedTarget.distanceToSquared(this.desiredTarget) > 1e-6) {
      this.smoothedTarget.lerp(this.desiredTarget, Math.min(1, dt * 12));
    } else {
      this.smoothedTarget.copy(this.desiredTarget);
    }

    // Automatically swing camera behind the dwarf when walking/running unless overridden by mouse
    if (this.config.cameraMode === 'dwarf') {
      if (this.isDragging) {
        this.followActive = false;
      } else if ((targetHeading !== null || (isFishing && this.lastAimRight !== 0)) && this.mouseOverrideTimer <= 0) {
        this.followActive = true;
      }

      if (this.followActive && !this.isDragging && this.mouseOverrideTimer <= 0) {
        const desiredYaw = this.dwarf.heading + Math.PI;
        const yawDiff =
          THREE.MathUtils.euclideanModulo(desiredYaw - this.yaw + Math.PI, Math.PI * 2) - Math.PI;
        if (Math.abs(yawDiff) > 0.001) {
          const followSpeed = isSprinting || this.isSliding ? 4.2 : 3.2;
          this.yaw += yawDiff * Math.min(1, dt * followSpeed);
        } else {
          this.yaw = desiredYaw;
          if (targetHeading === null) {
            this.followActive = false;
          }
        }
      }
    } else {
      this.followActive = false;
    }

    // Position camera on spherical orbit behind target
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    const effDist = this.config.cameraMode === 'dwarf' ? this.distance : this.distance * 1.8;
    const horizDist = effDist * Math.cos(this.pitch);
    const vertDist = effDist * Math.sin(this.pitch);

    const desiredCamX = this.smoothedTarget.x + sinYaw * horizDist;
    const desiredCamZ = this.smoothedTarget.z + cosYaw * horizDist;
    let desiredCamY = this.smoothedTarget.y + vertDist;

    // Prevent camera from clipping below terrain surface
    const camGroundY = this.chunkManager.getSurfaceHeight(desiredCamX, desiredCamZ) + 1.2;
    if (desiredCamY < camGroundY) {
      desiredCamY = camGroundY;
    }

    this.camera.position.set(desiredCamX, desiredCamY, desiredCamZ);
    this.camera.lookAt(this.smoothedTarget);
  }
}
