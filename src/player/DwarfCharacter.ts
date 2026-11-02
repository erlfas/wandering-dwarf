import * as THREE from 'three';

/**
 * Stylized 3D Dwarf character proxy matching the proportions and silhouette of `swarf-t-pose.jpg`:
 * - Stocky ~1.35m total height
 * - Wide-brimmed pointed green traveler hat with brown hatband
 * - Braided reddish-brown beard with silver ring + rosy nose
 * - Rust-orange tunic with belt & silver buckle
 * - Leather backpack with rolled bedroll strapped on top
 * - Sturdy leather boots and a wooden walking staff
 * - Supports both hiking/waddling on land and swimming/treading in ponds & rivers!
 */
export class DwarfCharacter {
  public readonly root = new THREE.Group();
  private bodyGroup = new THREE.Group();
  private leftLeg = new THREE.Group();
  private rightLeg = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private headGroup = new THREE.Group();
  private handStaff!: THREE.Mesh;
  private stowedStaff!: THREE.Mesh;
  private swimRippleRing!: THREE.Mesh;
  private swimOuterRing!: THREE.Mesh;

  private walkPhase = 0;
  private swimTime = 0;
  private swimBlend = 0; // Smooth 0..1 transition between land stance and swimming posture
  public heading = 0;    // Radians around Y axis

  constructor() {
    this.buildMesh();
  }

  private buildMesh(): void {
    const mat = (color: number, roughness = 0.8) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });

    const matTunic = mat(0xa8522b, 0.85);    // Rust-orange tunic
    const matBelt = mat(0x4a2f1d, 0.75);     // Dark leather belt
    const matBuckle = new THREE.MeshStandardMaterial({
      color: 0xbec5cb,
      roughness: 0.35,
      metalness: 0.75,
    });
    const matBeard = mat(0x8c3f19, 0.85);    // Reddish-brown beard
    const matSkin = mat(0xe5a985, 0.7);      // Warm skin tone
    const matHat = mat(0x566c36, 0.85);      // Moss/olive green hat
    const matPack = mat(0x6e472b, 0.8);      // Leather backpack
    const matBedroll = mat(0xbda078, 0.88);  // Tan rolled blanket
    const matBoot = mat(0x4b3322, 0.8);      // Sturdy brown boots
    const matStaff = mat(0x5c3a21, 0.85);    // Wooden walking stick

    this.root.add(this.bodyGroup);

    // --- LEGS & BOOTS ---
    const buildBoot = () => {
      const leg = new THREE.Group();
      const bootShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.28, 12), matBoot);
      bootShaft.position.y = -0.12;
      const bootFoot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.32), matBoot);
      bootFoot.position.set(0, -0.22, 0.05);
      leg.add(bootShaft, bootFoot);
      return leg;
    };

    this.leftLeg = buildBoot();
    this.leftLeg.position.set(-0.16, 0.29, 0);
    this.rightLeg = buildBoot();
    this.rightLeg.position.set(0.16, 0.29, 0);
    this.bodyGroup.add(this.leftLeg, this.rightLeg);

    // --- TORSO / TUNIC ---
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.56, 16), matTunic);
    torso.position.y = 0.54;
    this.bodyGroup.add(torso);

    // Belt & Buckle
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.355, 0.11, 16), matBelt);
    belt.position.y = 0.44;
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.06), matBuckle);
    buckle.position.set(0, 0.44, 0.34);
    this.bodyGroup.add(belt, buckle);

    // --- BACKPACK & BEDROLL (matching back view in swarf-t-pose.jpg) ---
    const packGroup = new THREE.Group();
    packGroup.position.set(0, 0.58, -0.32);

    const mainBag = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.28), matPack);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 0.30), matBelt);
    flap.position.set(0, 0.14, -0.01);
    const packBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.04), matBuckle);
    packBuckle.position.set(0, 0.04, -0.16);

    // Bedroll cylinder on top of backpack
    const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.52, 14), matBedroll);
    bedroll.rotation.z = Math.PI / 2;
    bedroll.position.set(0, 0.29, 0.02);

    // Stowed walking staff on backpack (shown while swimming so hands are free!)
    this.stowedStaff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.022, 1.25, 8),
      matStaff
    );
    this.stowedStaff.position.set(0.05, 0.12, -0.16);
    this.stowedStaff.rotation.z = 0.52;
    this.stowedStaff.visible = false;

    packGroup.add(mainBag, flap, packBuckle, bedroll, this.stowedStaff);
    this.bodyGroup.add(packGroup);

    // --- HEAD, BEARD & POINTED GREEN HAT ---
    this.headGroup.position.set(0, 0.86, 0);
    this.bodyGroup.add(this.headGroup);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 14), matSkin);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), matSkin);
    nose.position.set(0, 0.0, 0.22);

    // Bushy beard + braided tip with silver ring
    const beardMain = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.42, 12), matBeard);
    beardMain.rotation.x = Math.PI;
    beardMain.position.set(0, -0.14, 0.11);
    const beardRing = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.045, 10), matBuckle);
    beardRing.position.set(0, -0.29, 0.13);

    // Wide hat brim
    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.55, 0.045, 20), matHat);
    hatBrim.position.set(0, 0.15, 0);
    hatBrim.rotation.x = -0.06;

    // Hat band
    const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.07, 16), matBelt);
    hatBand.position.set(0, 0.19, 0);

    // Pointed hat cone (tilted slightly back for character)
    const hatCone = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.46, 16), matHat);
    hatCone.position.set(0, 0.41, -0.03);
    hatCone.rotation.x = -0.18;

    this.headGroup.add(head, nose, beardMain, beardRing, hatBrim, hatBand, hatCone);

    // --- ARMS & WALKING STAFF ---
    const buildArm = (isRight: boolean) => {
      const arm = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.32, 10), matTunic);
      sleeve.position.y = -0.14;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), matSkin);
      hand.position.y = -0.31;
      arm.add(sleeve, hand);

      if (isRight) {
        this.handStaff = new THREE.Mesh(
          new THREE.CylinderGeometry(0.026, 0.022, 1.32, 8),
          matStaff
        );
        this.handStaff.position.set(0, -0.12, 0.12);
        this.handStaff.rotation.x = 0.18;
        arm.add(this.handStaff);
      }
      return arm;
    };

    this.leftArm = buildArm(false);
    this.leftArm.position.set(-0.36, 0.74, 0);
    this.leftArm.rotation.z = 0.18;

    this.rightArm = buildArm(true);
    this.rightArm.position.set(0.36, 0.74, 0);
    this.rightArm.rotation.z = -0.18;

    this.bodyGroup.add(this.leftArm, this.rightArm);

    // --- SWIMMING WATER WAKE / FOAM RINGS ---
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
    this.root.add(this.swimOuterRing);

    // Enable shadow casting & receiving across all dwarf parts
    this.root.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh &&
        obj !== this.swimRippleRing &&
        obj !== this.swimOuterRing
      ) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }

  /**
   * Updates position, ground/water alignment, and either walking or swimming animation.
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

    // Stow walking stick on backpack while swimming so hands can paddle
    this.handStaff.visible = !isSwimming;
    this.stowedStaff.visible = isSwimming;

    const isMoving = moveSpeed > 0.15;

    if (isSwimming) {
      this.swimTime += dt * (isMoving ? 5.5 : 2.6);
      const stroke = Math.sin(this.swimTime);
      const sweep = Math.cos(this.swimTime);
      const kick = Math.sin(this.swimTime * 2.0);

      // Tilt body forward horizontally when swimming forward, or semi-upright when treading water
      const targetPitch = isMoving ? 0.92 : 0.34;
      this.bodyGroup.rotation.x = THREE.MathUtils.lerp(
        this.bodyGroup.rotation.x,
        targetPitch,
        Math.min(1, dt * 8)
      );
      this.bodyGroup.rotation.z = stroke * (isMoving ? 0.09 : 0.04);

      // Keep head tilted up so face, beard, and hat stay clearly above water looking ahead!
      this.headGroup.rotation.x = THREE.MathUtils.lerp(
        this.headGroup.rotation.x,
        isMoving ? -0.68 : -0.22,
        Math.min(1, dt * 8)
      );

      // Buoyant bobbing on the water waves
      this.bodyGroup.position.y = Math.sin(this.swimTime * 0.85) * 0.055;

      // Breaststroke / dog-paddle arm sweep
      this.leftArm.rotation.x = -1.15 + stroke * 0.68;
      this.rightArm.rotation.x = -1.15 - stroke * 0.68;
      this.leftArm.rotation.z = 0.48 + Math.max(0, sweep) * 0.52;
      this.rightArm.rotation.z = -0.48 - Math.max(0, -sweep) * 0.52;

      // Flutter kick legs behind
      this.leftLeg.rotation.x = kick * 0.48;
      this.rightLeg.rotation.x = -kick * 0.48;

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
      // Fade out water ripple rings on land
      (this.swimRippleRing.material as THREE.MeshBasicMaterial).opacity = 0;
      (this.swimOuterRing.material as THREE.MeshBasicMaterial).opacity = 0;

      const damp = Math.min(1, dt * 10);
      this.headGroup.rotation.x = THREE.MathUtils.lerp(this.headGroup.rotation.x, 0, damp);
      this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, 0.18, damp);
      this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, -0.18, damp);

      if (isMoving) {
        const cadence = THREE.MathUtils.clamp(moveSpeed * 1.45, 4.0, 14.0);
        this.walkPhase += dt * cadence;

        const stride = Math.sin(this.walkPhase);
        const bounce = Math.abs(Math.cos(this.walkPhase));

        this.leftLeg.rotation.x = stride * 0.55;
        this.rightLeg.rotation.x = -stride * 0.55;
        this.leftArm.rotation.x = -stride * 0.42;
        this.rightArm.rotation.x = stride * 0.35;

        this.bodyGroup.position.y = bounce * 0.065;
        this.bodyGroup.rotation.z = stride * 0.055;
        this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0.06, damp);
      } else {
        this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, damp);
        this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, damp);
        this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, damp);
        this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0, damp);
        this.bodyGroup.position.y = THREE.MathUtils.lerp(this.bodyGroup.position.y, 0, damp);
        this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, 0, damp);
        this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0, damp);
      }
    }
  }
}
