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
  public readonly trailPoints: THREE.Points;
  private modelContainer = new THREE.Group();
  private gliderGroup = new THREE.Group();
  private surfShieldMesh!: THREE.Mesh;
  private swimRippleRing!: THREE.Mesh;
  private swimOuterRing!: THREE.Mesh;

  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimState, THREE.AnimationAction>> = {};
  private currentState: AnimState = 'idle';

  private swimTime = 0;
  private swimBlend = 0; // Smooth 0..1 transition between land stance and swimming posture
  private gliderBlend = 0;
  private slideTiltX = 0;
  private slideTiltZ = 0;
  private idleStateTime = 0;
  private idleMixerAccum = 0;
  public heading = 0;    // Radians around Y axis

  // Ring-buffered world-space particle emitter (dust puffs & golden slide/jump sparks)
  private readonly maxParticles = 48;
  private particlePosAttr!: THREE.BufferAttribute;
  private particleVel = new Float32Array(48 * 3);
  private particleAge = new Float32Array(48);
  private particleMaxLife = new Float32Array(48);
  private particleHead = 0;
  private emitAccum = 0;

  // Scale factor so the ~0.85m native GLB mesh stands ~1.40m tall in the world
  private readonly modelScale = 1.65;
  private readonly landYOffset = 0.05;
  private readonly swimYOffset = 0.25;

  constructor() {
    this.root.add(this.modelContainer);
    this.buildSwimRings();
    this.buildMovementProps();
    this.trailPoints = this.buildTrailParticles();
    this.loadModel();
  }

  private buildMovementProps(): void {
    // 1. Dwarven Wind-Glider (wooden spar + warm canvas wings above shoulders)
    this.gliderGroup.position.set(0, 1.52, -0.05);
    this.gliderGroup.scale.setScalar(0.001);
    this.gliderGroup.visible = false;

    const wingMat = new THREE.MeshStandardMaterial({
      color: 0xf4dcb5,
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0xc8963e,
      roughness: 0.35,
      metalness: 0.75,
    });

    const sparGeo = new THREE.CylinderGeometry(0.025, 0.025, 2.2, 8);
    sparGeo.rotateZ(Math.PI / 2);
    const spar = new THREE.Mesh(sparGeo, frameMat);
    spar.castShadow = true;
    this.gliderGroup.add(spar);

    const wingGeo = new THREE.ConeGeometry(1.15, 0.95, 3);
    wingGeo.rotateX(Math.PI / 2);
    wingGeo.scale(1.15, 0.12, 0.85);
    const canopy = new THREE.Mesh(wingGeo, wingMat);
    canopy.position.set(0, 0.04, -0.15);
    canopy.castShadow = true;
    this.gliderGroup.add(canopy);

    this.modelContainer.add(this.gliderGroup);

    // 2. Ironbelly Surf-Shield under boots when slope-surfing or dodge-dashing
    const shieldGeo = new THREE.CylinderGeometry(0.48, 0.42, 0.07, 16);
    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0xd49b35,
      roughness: 0.28,
      metalness: 0.85,
      emissive: 0x3a2400,
      emissiveIntensity: 0.35,
    });
    this.surfShieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    this.surfShieldMesh.position.set(0, 0.04, 0);
    this.surfShieldMesh.visible = false;
    this.surfShieldMesh.castShadow = true;
    this.modelContainer.add(this.surfShieldMesh);
  }

  private buildTrailParticles(): THREE.Points {
    const positions = new Float32Array(this.maxParticles * 3);
    for (let i = 0; i < this.maxParticles; i++) {
      positions[i * 3 + 1] = -9999;
      this.particleAge[i] = 999;
      this.particleMaxLife[i] = 0.5;
    }
    const geo = new THREE.BufferGeometry();
    this.particlePosAttr = new THREE.BufferAttribute(positions, 3);
    this.particlePosAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.particlePosAttr);
    const mat = new THREE.PointsMaterial({
      color: 0xffe484,
      size: 0.24,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return points;
  }

  public spawnBurst(worldX: number, worldY: number, worldZ: number, count = 10): void {
    const arr = this.particlePosAttr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const idx = this.particleHead;
      this.particleHead = (this.particleHead + 1) % this.maxParticles;
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 1.4 + Math.random() * 2.2;
      arr[idx * 3] = worldX + Math.cos(angle) * 0.25;
      arr[idx * 3 + 1] = worldY + 0.18;
      arr[idx * 3 + 2] = worldZ + Math.sin(angle) * 0.25;
      this.particleVel[idx * 3] = Math.cos(angle) * speed;
      this.particleVel[idx * 3 + 1] = 1.2 + Math.random() * 1.8;
      this.particleVel[idx * 3 + 2] = Math.sin(angle) * speed;
      this.particleAge[idx] = 0;
      this.particleMaxLife[idx] = 0.38 + Math.random() * 0.22;
    }
    this.particlePosAttr.needsUpdate = true;
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
    this.swimRippleRing.updateMatrix();
    this.swimRippleRing.matrixAutoUpdate = false;
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
    this.swimOuterRing.updateMatrix();
    this.swimOuterRing.matrixAutoUpdate = false;
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

    // Prune redundant scale, non-root position, and individual finger phalange tracks
    const FINGER_RE = /(Index|Middle|Ring|Pinky|Thumb)[1-4]/i;
    for (const clip of clips) {
      clip.tracks = clip.tracks.filter((track) => {
        if (track.name.endsWith('.scale')) return false;
        if (track.name.endsWith('.position') && !track.name.includes('Hips')) return false;
        if (FINGER_RE.test(track.name)) return false;
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

        const isAnimatedBreathBone =
          nodeName.includes('Spine1') ||
          nodeName.includes('Head') ||
          (nodeName.includes('LeftArm') && !nodeName.includes('ForeArm')) ||
          (nodeName.includes('RightArm') && !nodeName.includes('ForeArm'));

        const outVals = isAnimatedBreathBone
          ? new Float32Array(12)
          : new Float32Array(8);
        if (isAnimatedBreathBone) {
          qA.toArray(outVals, 0);
          qMid.toArray(outVals, 4);
          qA.toArray(outVals, 8);
          idleTracks.push(new THREE.QuaternionKeyframeTrack(track.name, times, outVals));
        } else if (isArmChain) {
          // Relaxed arm chain pose needs only 2 endpoints instead of 3
          const twoTimes = new Float32Array([0, duration]);
          qA.toArray(outVals, 0);
          qA.toArray(outVals, 4);
          idleTracks.push(new THREE.QuaternionKeyframeTrack(track.name, twoTimes, outVals));
        } else if (node) {
          // Apply rest pose directly to bone; only add 2-keyframe track so crossFade from walk resets legs
          node.quaternion.copy(qA);
          const twoTimes = new Float32Array([0, duration]);
          qA.toArray(outVals, 0);
          qA.toArray(outVals, 4);
          idleTracks.push(new THREE.QuaternionKeyframeTrack(track.name, twoTimes, outVals));
        }
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
    if ( prevAction ) {
      nextAction.crossFadeFrom(prevAction, fadeDuration, true);
    }
    nextAction.play();
    this.currentState = nextState;
    this.idleStateTime = 0;
    this.idleMixerAccum = 0;
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
    isSwimming = false,
    isGliding = false,
    isSliding = false,
    isTrailblazing = false,
    slopePitch = 0
  ): void {
    this.root.position.set(worldX, worldY, worldZ);

    if (targetHeading !== null) {
      let diff = targetHeading - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 0.0005) {
        this.heading += diff * Math.min(1, dt * (isSwimming ? 7 : 12));
      } else {
        this.heading = targetHeading;
      }
    }

    this.root.rotation.y = this.heading;

    // Smoothly tilt dwarf model forward/downhill when sliding or gliding
    const desiredTiltX = isSliding ? slopePitch + 0.18 : isGliding ? 0.24 : 0;
    const desiredTiltZ = isGliding ? Math.sin(performance.now() * 0.004) * 0.08 : 0;
    this.slideTiltX = THREE.MathUtils.lerp(this.slideTiltX, desiredTiltX, Math.min(1, dt * 10));
    this.slideTiltZ = THREE.MathUtils.lerp(this.slideTiltZ, desiredTiltZ, Math.min(1, dt * 8));
    this.modelContainer.rotation.set(this.slideTiltX, 0, this.slideTiltZ);

    // Unfold or stow the Dwarven Wind-Glider
    const targetGlider = isGliding ? 1 : 0;
    if (Math.abs(this.gliderBlend - targetGlider) > 0.005) {
      this.gliderBlend = THREE.MathUtils.lerp(this.gliderBlend, targetGlider, Math.min(1, dt * 12));
    } else {
      this.gliderBlend = targetGlider;
    }
    this.gliderGroup.visible = this.gliderBlend > 0.02;
    if (this.gliderGroup.visible) {
      this.gliderGroup.scale.setScalar(this.gliderBlend);
    }

    // Show Ironbelly Surf-Shield underneath boots when slope-sliding or dashing
    this.surfShieldMesh.visible = isSliding && !isSwimming;

    // Emit & simulate world-space trail particles (sparks when sliding, dust when trailblazing)
    const shouldEmitTrail = (isSliding || (isTrailblazing && moveSpeed > 9.0)) && !isSwimming;
    if (shouldEmitTrail) {
      const rate = isSliding ? 28 : 14;
      this.emitAccum += dt * rate;
      const arr = this.particlePosAttr.array as Float32Array;
      while (this.emitAccum >= 1) {
        this.emitAccum -= 1;
        const idx = this.particleHead;
        this.particleHead = (this.particleHead + 1) % this.maxParticles;
        const backX = -Math.sin(this.heading) * 0.35 + (Math.random() - 0.5) * 0.35;
        const backZ = -Math.cos(this.heading) * 0.35 + (Math.random() - 0.5) * 0.35;
        arr[idx * 3] = worldX + backX;
        arr[idx * 3 + 1] = worldY + 0.14;
        arr[idx * 3 + 2] = worldZ + backZ;
        this.particleVel[idx * 3] = (Math.random() - 0.5) * 1.6;
        this.particleVel[idx * 3 + 1] = (isSliding ? 1.5 : 0.75) + Math.random() * 1.1;
        this.particleVel[idx * 3 + 2] = (Math.random() - 0.5) * 1.6;
        this.particleAge[idx] = 0;
        this.particleMaxLife[idx] = isSliding ? 0.42 : 0.34;
      }
    }

    // Advance active particles
    let anyActiveParticles = false;
    const posArr = this.particlePosAttr.array as Float32Array;
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.particleAge[i] < this.particleMaxLife[i]) {
        this.particleAge[i] += dt;
        if (this.particleAge[i] >= this.particleMaxLife[i]) {
          posArr[i * 3 + 1] = -9999;
        } else {
          posArr[i * 3] += this.particleVel[i * 3] * dt;
          posArr[i * 3 + 1] += this.particleVel[i * 3 + 1] * dt;
          posArr[i * 3 + 2] += this.particleVel[i * 3 + 2] * dt;
          this.particleVel[i * 3 + 1] -= 3.8 * dt;
        }
        anyActiveParticles = true;
      }
    }
    if (anyActiveParticles) {
      this.particlePosAttr.needsUpdate = true;
    }

    // Smoothly blend in/out of swimming state (snap at epsilon to avoid IEEE-754 subnormal floats)
    const targetBlend = isSwimming ? 1 : 0;
    if (Math.abs(this.swimBlend - targetBlend) > 0.001) {
      this.swimBlend = THREE.MathUtils.lerp(this.swimBlend, targetBlend, Math.min(1, dt * 8));
    } else {
      this.swimBlend = targetBlend;
    }

    const isMoving = moveSpeed > 0.15;
    const isRunning = moveSpeed > 8.8;

    // Select and update skeletal animation state only when visible
    if (this.mixer && this.root.visible) {
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

      if (this.currentState === 'idle') {
        this.idleStateTime += dt;
        // Once the 0.25s crossfade into idle completes, throttle breathing mixer updates to ~30 Hz
        if (this.idleStateTime > 0.28) {
          this.idleMixerAccum += dt;
          if (this.idleMixerAccum >= 0.033) {
            this.mixer.update(this.idleMixerAccum);
            this.idleMixerAccum = 0;
          }
        } else {
          this.mixer.update(dt);
        }
      } else {
        this.mixer.update(dt);
      }
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
      this.swimRippleRing.updateMatrix();
      (this.swimRippleRing.material as THREE.MeshBasicMaterial).opacity =
        (1.0 - ring1Phase) * 0.55 * this.swimBlend;

      this.swimOuterRing.scale.setScalar(0.85 + ring2Phase * (isMoving ? 1.25 : 0.75));
      this.swimOuterRing.updateMatrix();
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
      } else if (this.modelContainer.position.y !== this.landYOffset) {
        this.modelContainer.position.y = this.landYOffset;
      }
    }
  }
}

