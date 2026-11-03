import * as THREE from 'three';
import { WorldConfig } from '../world/Config';
import { ChunkManager } from '../world/ChunkManager';
import { TerrainNoise } from '../world/TerrainNoise';
import { DwarfCharacter } from '../player/DwarfCharacter';

/**
 * Handles player input, third-person elevated follow camera (matching the concept art angle),
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
  private smoothedTarget = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();

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
    this.playerPos.y = this.noise.getHeight(0, 0);
    this.smoothedTarget.copy(this.playerPos);

    this.bindEvents(domElement);
  }

  private bindEvents(domElement: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      this.keys.add(code);

      // Use V (instead of C, which is easy to hit accidentally next to D/S) to toggle camera mode
      if (code === 'KeyV' && !e.repeat) {
        this.config.cameraMode = this.config.cameraMode === 'dwarf' ? 'free' : 'dwarf';
        this.onToggleMode?.();
      } else if (code === 'KeyM' && !e.repeat) {
        this.config.wireframe = !this.config.wireframe;
        this.onToggleWireframe?.();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    // Clear held keys if window loses focus so character doesn't keep running off screen
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.isDragging = false;
    });

    domElement.addEventListener('mousedown', (e) => {
      if (e.button === 0 || e.button === 2) {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      const sensitivity = 0.0045;
      this.yaw -= dx * sensitivity;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + dy * sensitivity,
        0.08,
        Math.PI * 0.44
      );
    });

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

  public update(dt: number): void {
    // Gather movement input
    let forward = 0;
    let right = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;

    const isSprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const baseSpeed = this.config.walkSpeed * (isSprinting ? this.config.sprintMultiplier : 1.0);

    // Compute camera-relative horizontal basis vectors
    const camForwardX = -Math.sin(this.yaw);
    const camForwardZ = -Math.cos(this.yaw);
    const camRightX = Math.cos(this.yaw);
    const camRightZ = -Math.sin(this.yaw);

    let moveX = camForwardX * forward + camRightX * right;
    let moveZ = camForwardZ * forward + camRightZ * right;
    const moveLen = Math.hypot(moveX, moveZ);

    let actualSpeed = 0;
    let targetHeading: number | null = null;

    // Check terrain depth vs water level to determine if the dwarf is swimming
    const preGroundY = this.chunkManager.getSurfaceHeight(this.playerPos.x, this.playerPos.z);
    const isSwimming =
      this.config.enableWater &&
      !this.config.blankClayMode &&
      preGroundY < this.config.waterLevel - 0.38;

    if (moveLen > 0.001) {
      moveX /= moveLen;
      moveZ /= moveLen;

      const modeSpeedMultiplier =
        this.config.cameraMode === 'free' ? 2.5 : isSwimming ? 0.78 : 1.0;
      actualSpeed = baseSpeed * modeSpeedMultiplier;

      this.playerPos.x += moveX * actualSpeed * dt;
      this.playerPos.z += moveZ * actualSpeed * dt;
      targetHeading = Math.atan2(moveX, moveZ);
    }

    // Clamp player height to the rendered triangle surface (or buoyant swimming elevation in rivers/ponds)
    const groundY =
      moveLen > 0.001
        ? this.chunkManager.getSurfaceHeight(this.playerPos.x, this.playerPos.z)
        : preGroundY;
    const swimSurfaceY = this.config.waterLevel - 0.54;
    this.playerPos.y =
      this.config.enableWater && !this.config.blankClayMode
        ? Math.max(groundY, swimSurfaceY)
        : groundY;

    // Always keep the dwarf visible unless explicitly unchecked in the debug panel
    this.dwarf.root.visible = this.config.showDwarfProxy;
    this.dwarf.update(
      dt,
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      actualSpeed,
      targetHeading,
      isSwimming
    );

    // Smooth camera target follow
    const lookHeightOffset = this.config.cameraMode === 'dwarf' ? 1.55 : 4.0;
    this.desiredTarget.set(
      this.playerPos.x,
      this.playerPos.y + lookHeightOffset,
      this.playerPos.z
    );
    this.smoothedTarget.lerp(this.desiredTarget, Math.min(1, dt * 12));

    // Position camera on spherical orbit behind target
    const effDist = this.config.cameraMode === 'dwarf' ? this.distance : this.distance * 1.8;
    const horizDist = effDist * Math.cos(this.pitch);
    const vertDist = effDist * Math.sin(this.pitch);

    const desiredCamX = this.smoothedTarget.x + Math.sin(this.yaw) * horizDist;
    const desiredCamZ = this.smoothedTarget.z + Math.cos(this.yaw) * horizDist;
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
