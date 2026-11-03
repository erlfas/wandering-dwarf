import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import dwarfModelUrl from '../../3dmodels/dwarf front t-pose 3d model.glb?url';

type AnimState = 'idle' | 'walk' | 'run' | 'swim';

/**
 * 3D Dwarf character loaded from `3dmodels/dwarf front t-pose 3d model.glb`.
 * Supports idle breathing, walking, sprinting, and swimming animations via AnimationMixer,
 * plus water surface wake ripples when swimming in rivers and ponds.
 */
export class DwarfCharacter {
  public readonly root = new THREE.Group();
  private modelContainer = new THREE.Group();
  private swimRippleRing!: THREE.Mesh;
  private swimOuterRing!: THREE.Mesh;

  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimState, THREE.AnimationAction>> = {};
  private currentState: AnimState = 'idle';

  private swimTime = 0;
  private swimBlend = 0; // Smooth 0..1 transition between land stance and swimming posture
  public heading = 0;    // Radians around Y axis

  // Scale factor so the ~0.85m native GLB mesh stands ~1.40m tall in the world
  private readonly modelScale = 1.65;
  private readonly landYOffset = 0.05;
  private readonly swimYOffset = 0.25;

  constructor() {
    this.root.add(this.modelContainer);
    this.buildSwimRings();
    this.loadModel();
  }

  private buildSwimRings(): void {
    const ringGeo1 = new THREE.RingGeometry(0.42, 0.56, 24);
    ringGeo1.rotateX(-Math.PI / 2);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0xe8f7ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
    });
    this.swimRippleRing = new THREE.Mesh(ringGeo1, ringMat1);
    this.swimRippleRing.position.y = 0.56;
    this.swimRippleRing.visible = false;
    this.root.add(this.swimRippleRing);

    const ringGeo2 = new THREE.RingGeometry(0.62, 0.72, 24);
    ringGeo2.rotateX(-Math.PI / 2);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0xd0efff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
    });
    this.swimOuterRing = new THREE.Mesh(ringGeo2, ringMat2);
    this.swimOuterRing.position.y = 0.55;
    this.swimOuterRing.visible = false;
    this.root.add(this.swimOuterRing);
  }

  private loadModel(): void {
    const loader = new GLTFLoader();
    loader.load(
      dwarfModelUrl,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(this.modelScale);
        this.modelContainer.position.y = this.landYOffset;

        model.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = true;
            obj.receiveShadow = false;
            obj.frustumCulled = false;
          }
        });

        this.modelContainer.add(model);
        this.setupAnimations(model, gltf.animations);
      },
      undefined,
      (err) => {
        console.error('Failed to load dwarf 3D model:', err);
      }
    );
  }

  private setupAnimations(model: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    this.mixer = new THREE.AnimationMixer(model);

    // Prune redundant scale/position tracks and strip horizontal (X/Z) root motion on Hips
    for (const clip of clips) {
      clip.tracks = clip.tracks.filter((track) => {
        if (track.name.endsWith('.scale')) return false;
        if (track.name.endsWith('.position') && !track.name.includes('Hips')) return false;
        return true;
      });
      for (const track of clip.tracks) {
        if (track.name.includes('Hips') && track.name.endsWith('.position')) {
          const values = track.values;
          const initX = values[0];
          const initZ = values[2];
          for (let i = 0; i < values.length; i += 3) {
            values[i] = initX;
            values[i + 2] = initZ;
          }
        }
      }
    }

    const walkClip = clips.find((c) => c.name.toLowerCase().includes('walk'));
    const runClip = clips.find((c) => c.name.toLowerCase().includes('run'));
    const swimClip = clips.find((c) => c.name.toLowerCase().includes('swim'));

    if (walkClip) {
      this.actions.walk = this.mixer.clipAction(walkClip);
      const idleClip = this.createIdleClip(model, walkClip);
      this.actions.idle = this.mixer.clipAction(idleClip);
    }
    if (runClip) {
      this.actions.run = this.mixer.clipAction(runClip);
    }
    if (swimClip) {
      this.actions.swim = this.mixer.clipAction(swimClip);
    }

    if (this.actions.idle) {
      this.actions.idle.play();
      this.currentState = 'idle';
    } else if (this.actions.walk) {
      this.actions.walk.play();
      this.currentState = 'walk';
    }
  }

  /**
   * Builds a natural standing idle clip using grounded rest-pose legs and relaxed arms
   * sampled from the neutral midpoint of the walk cycle, with a subtle breathing motion.
   */
  private createIdleClip(
    model: THREE.Object3D,
    walkClip: THREE.AnimationClip
  ): THREE.AnimationClip {
    const duration = 2.4;
    const times = new Float32Array([0, duration * 0.5, duration]);
    const idleTracks: THREE.KeyframeTrack[] = [];

    // Map bone rest transforms before any animations mutate them
    const restMap = new Map<string, THREE.Object3D>();
    model.traverse((obj) => {
      if (obj.name) {
        restMap.set(obj.name, obj);
        restMap.set(obj.name.replace(/:/g, ''), obj);
      }
    });

    const qA = new THREE.Quaternion();
    const qB = new THREE.Quaternion();
    const qMid = new THREE.Quaternion();
    const qBreath = new THREE.Quaternion();
    const euler = new THREE.Euler();

    for (const track of walkClip.tracks) {
      const dotIdx = track.name.lastIndexOf('.');
      const nodeName = track.name.slice(0, dotIdx);
      const prop = track.name.slice(dotIdx + 1);
      const node = restMap.get(nodeName);

      const isArmChain =
        nodeName.includes('Shoulder') ||
        nodeName.includes('Arm') ||
        nodeName.includes('Hand');

      if (prop === 'quaternion') {
        if (isArmChain) {
          const vals = track.values;
          const numFrames = vals.length / 4;
          const f1 = Math.min(13, numFrames - 1);
          const f2 = Math.min(27, numFrames - 1);

          qA.fromArray(vals, f1 * 4);
          qB.fromArray(vals, f2 * 4);
          qA.slerp(qB, 0.5);

          const isLeftArm = nodeName.includes('LeftArm') && !nodeName.includes('ForeArm');
          const isRightArm = nodeName.includes('RightArm') && !nodeName.includes('ForeArm');
          qMid.copy(qA);
          if (isLeftArm || isRightArm) {
            euler.set(0.025, 0, isLeftArm ? 0.02 : -0.02);
            qBreath.setFromEuler(euler);
            qMid.multiply(qBreath);
          }
        } else {
          if (node) {
            qA.copy(node.quaternion);
          } else {
            qA.fromArray(track.values, 0);
          }
          qMid.copy(qA);
          if (nodeName.includes('Spine1') || nodeName.includes('Head')) {
            euler.set(nodeName.includes('Spine1') ? -0.025 : 0.02, 0, 0);
            qBreath.setFromEuler(euler);
            qMid.multiply(qBreath);
          }
        }

        const outVals = new Float32Array(12);
        qA.toArray(outVals, 0);
        qMid.toArray(outVals, 4);
        qA.toArray(outVals, 8);
        idleTracks.push(new THREE.QuaternionKeyframeTrack(track.name, times, outVals));
      } else if (prop === 'position' && nodeName.includes('Hips')) {
        const px = node ? node.position.x : track.values[0];
        const py = node ? node.position.y : track.values[1];
        const pz = node ? node.position.z : track.values[2];
        const midY = py - 0.004;
        const outVals = new Float32Array([px, py, pz, px, midY, pz, px, py, pz]);
        idleTracks.push(new THREE.VectorKeyframeTrack(track.name, times, outVals));
      }
    }

    return new THREE.AnimationClip('idle', duration, idleTracks);
  }

  private transitionTo(nextState: AnimState, fadeDuration = 0.25): void {
    if (this.currentState === nextState) return;
    const prevAction = this.actions[this.currentState];
    const nextAction = this.actions[nextState];
    if (!nextAction) return;

    nextAction.reset();
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);
    if (prevAction) {
      nextAction.crossFadeFrom(prevAction, fadeDuration, true);
    }
    nextAction.play();
    this.currentState = nextState;
  }

  /**
   * Updates position, ground/water alignment, and animation state/speed.
   */
  public update(
    dt: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    moveSpeed: number,
    targetHeading: number | null,
    isSwimming = false
  ): void {
    this.root.position.set(worldX, worldY, worldZ);

    if (targetHeading !== null) {
      let diff = targetHeading - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * Math.min(1, dt * (isSwimming ? 7 : 12));
    }

    this.root.rotation.y = this.heading;

    // Smoothly blend in/out of swimming state
    const targetBlend = isSwimming ? 1 : 0;
    this.swimBlend = THREE.MathUtils.lerp(this.swimBlend, targetBlend, Math.min(1, dt * 8));

    const isMoving = moveSpeed > 0.15;
    const isRunning = moveSpeed > 8.8;

    // Select and update skeletal animation state
    if (this.mixer) {
      if (isSwimming) {
        this.transitionTo('swim', 0.3);
        if (this.actions.swim) {
          this.actions.swim.timeScale = isMoving
            ? THREE.MathUtils.clamp(moveSpeed * 0.26, 0.85, 1.8)
            : 0.45;
        }
      } else if (!isMoving) {
        this.transitionTo('idle', 0.22);
        if (this.actions.idle) {
          this.actions.idle.timeScale = 1.0;
        }
      } else if (isRunning && this.actions.run) {
        this.transitionTo('run', 0.2);
        this.actions.run.timeScale = THREE.MathUtils.clamp(moveSpeed / 12.5, 0.85, 1.6);
      } else {
        this.transitionTo('walk', 0.2);
        if (this.actions.walk) {
          this.actions.walk.timeScale = THREE.MathUtils.clamp(moveSpeed / 5.2, 0.75, 1.6);
        }
      }

      this.mixer.update(dt);
    }

    if (isSwimming) {
      this.swimRippleRing.visible = true;
      this.swimOuterRing.visible = true;
      this.swimTime += dt * (isMoving ? 5.5 : 2.6);
      const bob = Math.sin(this.swimTime * 0.85) * 0.035;
      const targetY = THREE.MathUtils.lerp(this.landYOffset, this.swimYOffset, this.swimBlend) + bob;
      this.modelContainer.position.y = THREE.MathUtils.lerp(
        this.modelContainer.position.y,
        targetY,
        Math.min(1, dt * 10)
      );

      // Animate foam wake rings on the water surface around the dwarf
      const ring1Phase = (this.swimTime * 0.45) % 1;
      const ring2Phase = (this.swimTime * 0.45 + 0.5) % 1;
      this.swimRippleRing.scale.setScalar(0.85 + ring1Phase * (isMoving ? 1.1 : 0.65));
      (this.swimRippleRing.material as THREE.MeshBasicMaterial).opacity =
        (1.0 - ring1Phase) * 0.55 * this.swimBlend;

      this.swimOuterRing.scale.setScalar(0.85 + ring2Phase * (isMoving ? 1.25 : 0.75));
      (this.swimOuterRing.material as THREE.MeshBasicMaterial).opacity =
        (1.0 - ring2Phase) * 0.4 * this.swimBlend;
    } else {
      // Hide water ripple rings on land and restore land ground clearance
      this.swimRippleRing.visible = false;
      this.swimOuterRing.visible = false;
      if (Math.abs(this.modelContainer.position.y - this.landYOffset) > 0.001) {
        this.modelContainer.position.y = THREE.MathUtils.lerp(
          this.modelContainer.position.y,
          this.landYOffset,
          Math.min(1, dt * 10)
        );
      }
    }
  }
}

