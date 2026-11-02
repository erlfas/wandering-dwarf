import * as THREE from 'three';

/**
 * Stylized 3D Dwarf character proxy matching the proportions and silhouette of `swarf-t-pose.jpg`:
 * - Stocky ~1.35m total height
 * - Wide-brimmed pointed green traveler hat with brown hatband
 * - Braided reddish-brown beard with silver ring + rosy nose
 * - Rust-orange tunic with belt & silver buckle
 * - Leather backpack with rolled bedroll strapped on top
 * - Sturdy leather boots and a wooden walking staff
 */
export class DwarfCharacter {
  public readonly root = new THREE.Group();
  private bodyGroup = new THREE.Group();
  private leftLeg = new THREE.Group();
  private rightLeg = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private headGroup = new THREE.Group();

  private walkPhase = 0;
  public heading = 0; // Radians around Y axis (0 = facing -Z / North)

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

    packGroup.add(mainBag, flap, packBuckle, bedroll);
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
        // Wooden walking stick held in right hand
        const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 1.32, 8), matStaff);
        staff.position.set(0, -0.12, 0.12);
        staff.rotation.x = 0.18;
        arm.add(staff);
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

    // Enable shadow casting & receiving across all dwarf parts
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }

  /**
   * Updates position, ground alignment, and procedural waddle walk animation.
   */
  public update(
    dt: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    moveSpeed: number,
    targetHeading: number | null
  ): void {
    this.root.position.set(worldX, worldY, worldZ);

    if (targetHeading !== null) {
      // Smooth shortest-angle rotation toward movement direction
      let diff = targetHeading - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * Math.min(1, dt * 12);
    }

    // Our dwarf's front (+Z in local mesh) faces the movement vector
    this.root.rotation.y = this.heading;

    const isMoving = moveSpeed > 0.15;
    if (isMoving) {
      const cadence = THREE.MathUtils.clamp(moveSpeed * 1.45, 4.0, 14.0);
      this.walkPhase += dt * cadence;

      const stride = Math.sin(this.walkPhase);
      const bounce = Math.abs(Math.cos(this.walkPhase));

      this.leftLeg.rotation.x = stride * 0.55;
      this.rightLeg.rotation.x = -stride * 0.55;
      this.leftArm.rotation.x = -stride * 0.42;
      this.rightArm.rotation.x = stride * 0.35;

      // Cheerful dwarf waddle sway & vertical step bob
      this.bodyGroup.position.y = bounce * 0.065;
      this.bodyGroup.rotation.z = stride * 0.055;
      this.bodyGroup.rotation.x = 0.06; // Slight forward lean while hiking
    } else {
      // Smoothly settle back to idle stance
      const damp = Math.min(1, dt * 10);
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
