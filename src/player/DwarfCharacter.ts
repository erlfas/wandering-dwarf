import * as THREE from 'three';
import { createOptimizedGlbLoader } from '../world/ForestField';
import dwarfModelUrl from '../../3dmodels/dwarf front t-pose 3d model.glb?url';

type AnimState = 'idle' | 'walk' | 'run' | 'swim';

export type EquippedWeaponId =
  | 'mallet'
  | 'oak_club'
  | 'battle_axe'
  | 'broadsword'
  | 'runic_greatsword'
  | 'dragon_greataxe';

export type EquippedShieldId = 'none' | 'round_shield' | 'mithril_aegis';

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
  private backpackGroup = new THREE.Group();
  private stowedRodGroup = new THREE.Group();
  private equippedRodGroup = new THREE.Group();
  private rodBendPivot = new THREE.Group();
  private rodTipNode = new THREE.Object3D();
  private stowedBowGroup = new THREE.Group();
  private equippedBowGroup = new THREE.Group();
  private upperBowLimb = new THREE.Group();
  private lowerBowLimb = new THREE.Group();
  private bowStringPositions = new Float32Array(3 * 3);
  private bowStringAttr!: THREE.BufferAttribute;
  private nockedArrowGroup = new THREE.Group();
  private bowLaunchNode = new THREE.Object3D();
  private carriedStoneGroup = new THREE.Group();
  private carriedStoneMeshes: THREE.Mesh[] = [];
  private carriedBlockGroup = new THREE.Group();
  private carriedBlockMeshes: THREE.Mesh[] = [];
  private chiselToolGroup = new THREE.Group();
  private hammerPivot = new THREE.Group();
  private chiselPivot = new THREE.Group();
  private equippedWeaponGroup = new THREE.Group();
  private weaponMeshes: Partial<Record<EquippedWeaponId, THREE.Group>> = {};
  private meleeSlashArcMesh!: THREE.Mesh;
  private meleeSlashArcMat!: THREE.MeshBasicMaterial;
  private equippedShieldGroup = new THREE.Group();
  private shieldMeshes: Partial<Record<Exclude<EquippedShieldId, 'none'>, THREE.Group>> = {};
  private stowedShieldGroup = new THREE.Group();
  private helmetGroup = new THREE.Group();
  private pauldronsGroup = new THREE.Group();
  private crownGroup = new THREE.Group();
  private warhornGroup = new THREE.Group();
  private warhornWaveRing!: THREE.Mesh;
  private slamShockwaveRing!: THREE.Mesh;
  private slamShockwaveTimer = 0;
  private surfShieldMesh!: THREE.Mesh;
  private swimRippleRing!: THREE.Mesh;
  private swimOuterRing!: THREE.Mesh;

  private isFishingMode = false;
  private fishingEquipBlend = 0;
  private castAnimTimer = 0;
  private rodBendTarget = 0;
  private rodBendCurrent = 0;

  private isHuntingMode = false;
  private huntingEquipBlend = 0;
  private bowDrawTarget = 0;
  private bowDrawCurrent = 0;
  private bowReleaseTimer = 0;

  private carriedRawStones = 0;
  private carriedChiseledBlocks = 0;
  private chiselAnimTimer = 0;
  private chiselAnimDuration = 1.0;
  private carryBobTime = 0;

  private equippedWeaponId: EquippedWeaponId = 'mallet';
  private equippedShieldId: EquippedShieldId = 'none';
  private combatReady = false;
  private meleeSwingTimer = 0;
  private readonly meleeSwingDuration = 0.38;
  private wasSwingingWeapon = false;
  private shieldBlocking = false;
  private shieldBlockBlend = 0;
  private shieldImpactTimer = 0;
  private progressionRank = 1;
  private hasDurinCrown = false;
  private warhornAnimTimer = 0;
  private warhornWaveTimer = 0;

  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimState, THREE.AnimationAction>> = {};
  private currentState: AnimState = 'idle';
  private spine1Bone: THREE.Object3D | null = null;
  private rightArmBone: THREE.Object3D | null = null;
  private rightForeArmBone: THREE.Object3D | null = null;
  private rightHandBone: THREE.Object3D | null = null;
  private rightHandSocket = new THREE.Group();
  private headBone: THREE.Object3D | null = null;
  private headSocket = new THREE.Group();
  private readonly tempSwingEuler = new THREE.Euler();
  private readonly tempSwingQuat = new THREE.Quaternion();

  private swimTime = 0;
  private swimBlend = 0; // Smooth 0..1 transition between land stance and swimming posture
  private gliderBlend = 0;
  private glideTime = 0;
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
  private activeParticleCount = 0;
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

    // 3. Dwarven Explorer Backpack on back with Stowed Fishing Rod + Equipped Fishing Rod in hand
    this.buildBackpackAndFishingRod();
  }

  private buildBackpackAndFishingRod(): void {
    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0x6b3e26,
      roughness: 0.78,
      metalness: 0.08,
    });
    const flapMat = new THREE.MeshStandardMaterial({
      color: 0x522d1b,
      roughness: 0.82,
      metalness: 0.06,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xe0a938,
      roughness: 0.28,
      metalness: 0.85,
    });
    const bedrollMat = new THREE.MeshStandardMaterial({
      color: 0x3b6e52,
      roughness: 0.85,
      metalness: 0.04,
    });
    const rodWoodMat = new THREE.MeshStandardMaterial({
      color: 0x9c6634,
      roughness: 0.52,
      metalness: 0.12,
    });
    const corkMat = new THREE.MeshStandardMaterial({
      color: 0xd4a373,
      roughness: 0.82,
      metalness: 0.04,
    });

    // Position backpack on the dwarf's upper back (-Z is behind the dwarf since +Z is forward)
    this.backpackGroup.position.set(0, 0.82, -0.24);
    const packBodyGeo = new THREE.BoxGeometry(0.38, 0.42, 0.22);
    const packBody = new THREE.Mesh(packBodyGeo, leatherMat);
    packBody.castShadow = true;
    this.backpackGroup.add(packBody);

    const packFlapGeo = new THREE.BoxGeometry(0.4, 0.14, 0.24);
    const packFlap = new THREE.Mesh(packFlapGeo, flapMat);
    packFlap.position.set(0, 0.16, 0);
    packFlap.castShadow = true;
    this.backpackGroup.add(packFlap);

    const buckleGeo = new THREE.BoxGeometry(0.07, 0.07, 0.03);
    const buckle = new THREE.Mesh(buckleGeo, brassMat);
    buckle.position.set(0, 0.11, -0.12);
    this.backpackGroup.add(buckle);

    const bedrollGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.42, 10);
    bedrollGeo.rotateZ(Math.PI / 2);
    const bedroll = new THREE.Mesh(bedrollGeo, bedrollMat);
    bedroll.position.set(0, 0.26, 0.01);
    bedroll.castShadow = true;
    this.backpackGroup.add(bedroll);

    // Side quiver/holster tube on the backpack for the fishing rod
    const quiverGeo = new THREE.CylinderGeometry(0.045, 0.04, 0.34, 8);
    const quiver = new THREE.Mesh(quiverGeo, flapMat);
    quiver.position.set(0.19, -0.02, -0.02);
    quiver.rotation.z = -0.18;
    this.backpackGroup.add(quiver);

    // Stowed Fishing Rod sticking out of the backpack holster over right shoulder
    this.stowedRodGroup.position.set(0.19, 0.05, -0.02);
    this.stowedRodGroup.rotation.set(-0.12, 0, -0.22);

    const stowedShaftGeo = new THREE.CylinderGeometry(0.008, 0.02, 0.95, 7);
    stowedShaftGeo.translate(0, 0.475, 0);
    const stowedShaft = new THREE.Mesh(stowedShaftGeo, rodWoodMat);
    stowedShaft.castShadow = true;
    this.stowedRodGroup.add(stowedShaft);

    const stowedReelGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.035, 10);
    stowedReelGeo.rotateZ(Math.PI / 2);
    const stowedReel = new THREE.Mesh(stowedReelGeo, brassMat);
    stowedReel.position.set(0.03, 0.16, 0);
    this.stowedRodGroup.add(stowedReel);

    const stowedTipRingGeo = new THREE.TorusGeometry(0.018, 0.004, 6, 12);
    const stowedTipRing = new THREE.Mesh(stowedTipRingGeo, brassMat);
    stowedTipRing.position.set(0, 0.95, 0);
    this.stowedRodGroup.add(stowedTipRing);

    this.backpackGroup.add(this.stowedRodGroup);

    // 4. Stowed Hunting Bow & Feathered Arrow Quiver on the left side (-X) of the backpack
    const arrowFeatherMat = new THREE.MeshStandardMaterial({
      color: 0xd93829,
      roughness: 0.65,
      metalness: 0.05,
    });
    const steelHeadMat = new THREE.MeshStandardMaterial({
      color: 0xd8e2eb,
      roughness: 0.25,
      metalness: 0.88,
    });

    const arrowQuiverGeo = new THREE.CylinderGeometry(0.052, 0.044, 0.36, 8);
    const arrowQuiver = new THREE.Mesh(arrowQuiverGeo, flapMat);
    arrowQuiver.position.set(-0.19, -0.01, -0.02);
    arrowQuiver.rotation.z = 0.22;
    arrowQuiver.castShadow = true;
    this.backpackGroup.add(arrowQuiver);

    // 3 feathered arrows sticking out of the backpack quiver over the left shoulder
    const quiverArrowShaftGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.28, 6);
    const quiverFletchGeo = new THREE.ConeGeometry(0.022, 0.075, 4);
    for (let i = 0; i < 3; i++) {
      const aGroup = new THREE.Group();
      const ox = -0.19 - i * 0.016;
      const oz = -0.03 + (i - 1) * 0.018;
      aGroup.position.set(ox, 0.14, oz);
      aGroup.rotation.set(-0.08 + i * 0.05, 0, 0.22 + (i - 1) * 0.06);

      const shaft = new THREE.Mesh(quiverArrowShaftGeo, corkMat);
      shaft.position.y = 0.12;
      aGroup.add(shaft);

      const fletch = new THREE.Mesh(quiverFletchGeo, arrowFeatherMat);
      fletch.position.y = 0.24;
      aGroup.add(fletch);

      this.backpackGroup.add(aGroup);
    }

    // Stowed Dwarven Recurve Bow strapped diagonally across the backpack
    this.stowedBowGroup.position.set(-0.14, 0.06, -0.13);
    this.stowedBowGroup.rotation.set(0.1, 0.18, 0.52);

    const stowedBowArcGeo = new THREE.TorusGeometry(0.36, 0.018, 7, 16, Math.PI * 0.86);
    stowedBowArcGeo.rotateZ(-Math.PI * 0.43);
    const stowedBowArc = new THREE.Mesh(stowedBowArcGeo, rodWoodMat);
    stowedBowArc.position.x = -0.12;
    stowedBowArc.castShadow = true;
    this.stowedBowGroup.add(stowedBowArc);

    const stowedBowGripGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.16, 8);
    const stowedBowGrip = new THREE.Mesh(stowedBowGripGeo, brassMat);
    stowedBowGrip.position.set(0.23, 0, 0);
    this.stowedBowGroup.add(stowedBowGrip);

    this.backpackGroup.add(this.stowedBowGroup);
    this.modelContainer.add(this.backpackGroup);

    // Equipped 3D Fishing Rod held by the dwarf in Fishing Mode
    this.equippedRodGroup.position.set(0.32, 0.86, 0.28);
    this.equippedRodGroup.visible = false;

    const handleGeo = new THREE.CylinderGeometry(0.024, 0.022, 0.36, 8);
    handleGeo.rotateX(Math.PI * 0.34);
    const handleMesh = new THREE.Mesh(handleGeo, corkMat);
    handleMesh.castShadow = true;
    this.equippedRodGroup.add(handleMesh);

    const reelMountGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.048, 12);
    reelMountGeo.rotateZ(Math.PI / 2);
    const reelMount = new THREE.Mesh(reelMountGeo, brassMat);
    reelMount.position.set(0.038, 0.04, 0.11);
    reelMount.castShadow = true;
    this.equippedRodGroup.add(reelMount);

    const lowerShaftGeo = new THREE.CylinderGeometry(0.014, 0.022, 0.92, 8);
    lowerShaftGeo.translate(0, 0.46, 0);
    lowerShaftGeo.rotateX(Math.PI * 0.34);
    const lowerShaft = new THREE.Mesh(lowerShaftGeo, rodWoodMat);
    lowerShaft.castShadow = true;
    this.equippedRodGroup.add(lowerShaft);

    // Upper flexible rod half attached at the midpoint so it bends when casting/reeling a fish
    const midY = Math.cos(Math.PI * 0.34) * 0.92;
    const midZ = Math.sin(Math.PI * 0.34) * 0.92;
    this.rodBendPivot.position.set(0, midY, midZ);

    const upperShaftGeo = new THREE.CylinderGeometry(0.006, 0.014, 0.96, 8);
    upperShaftGeo.translate(0, 0.48, 0);
    upperShaftGeo.rotateX(Math.PI * 0.34);
    const upperShaft = new THREE.Mesh(upperShaftGeo, rodWoodMat);
    upperShaft.castShadow = true;
    this.rodBendPivot.add(upperShaft);

    const eyeletGeo = new THREE.TorusGeometry(0.018, 0.004, 6, 12);
    const tipY = Math.cos(Math.PI * 0.34) * 0.96;
    const tipZ = Math.sin(Math.PI * 0.34) * 0.96;
    const tipEyelet = new THREE.Mesh(eyeletGeo, brassMat);
    tipEyelet.position.set(0, tipY, tipZ);
    this.rodBendPivot.add(tipEyelet);

    this.rodTipNode.position.set(0, tipY, tipZ);
    this.rodBendPivot.add(this.rodTipNode);

    this.equippedRodGroup.add(this.rodBendPivot);
    this.modelContainer.add(this.equippedRodGroup);

    // 5. Equipped 3D Dwarven Hunting Bow & Nocked Arrow held in Hunting Mode
    this.equippedBowGroup.position.set(-0.22, 0.88, 0.34);
    this.equippedBowGroup.visible = false;

    const bowRiserGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.24, 8);
    const bowRiser = new THREE.Mesh(bowRiserGeo, brassMat);
    bowRiser.castShadow = true;
    this.equippedBowGroup.add(bowRiser);

    // Upper & Lower flexible limbs (hinged at +/-0.10m Y so they flex backward along -Z when drawn)
    this.upperBowLimb.position.set(0, 0.1, 0);
    const upperLimbGeo = new THREE.CylinderGeometry(0.01, 0.022, 0.46, 8);
    upperLimbGeo.translate(0, 0.23, 0);
    upperLimbGeo.rotateX(-0.28);
    const upperLimbMesh = new THREE.Mesh(upperLimbGeo, rodWoodMat);
    upperLimbMesh.castShadow = true;
    this.upperBowLimb.add(upperLimbMesh);

    const limbTipGeo = new THREE.SphereGeometry(0.018, 8, 6);
    const upperTipCap = new THREE.Mesh(limbTipGeo, brassMat);
    upperTipCap.position.set(0, Math.cos(0.28) * 0.46, -Math.sin(0.28) * 0.46);
    this.upperBowLimb.add(upperTipCap);
    this.equippedBowGroup.add(this.upperBowLimb);

    this.lowerBowLimb.position.set(0, -0.1, 0);
    const lowerLimbGeo = new THREE.CylinderGeometry(0.022, 0.01, 0.46, 8);
    lowerLimbGeo.translate(0, -0.23, 0);
    lowerLimbGeo.rotateX(0.28);
    const lowerLimbMesh = new THREE.Mesh(lowerLimbGeo, rodWoodMat);
    lowerLimbMesh.castShadow = true;
    this.lowerBowLimb.add(lowerLimbMesh);

    const lowerTipCap = new THREE.Mesh(limbTipGeo, brassMat);
    lowerTipCap.position.set(0, -Math.cos(0.28) * 0.46, -Math.sin(0.28) * 0.46);
    this.lowerBowLimb.add(lowerTipCap);
    this.equippedBowGroup.add(this.lowerBowLimb);

    // Dynamic 3-vertex Bowstring (upper tip -> nock point -> lower tip)
    const bowStringGeo = new THREE.BufferGeometry();
    this.bowStringAttr = new THREE.BufferAttribute(this.bowStringPositions, 3);
    this.bowStringAttr.setUsage(THREE.DynamicDrawUsage);
    bowStringGeo.setAttribute('position', this.bowStringAttr);
    const bowStringMat = new THREE.LineBasicMaterial({
      color: 0xf4f1de,
      transparent: true,
      opacity: 0.92,
    });
    const bowStringLine = new THREE.Line(bowStringGeo, bowStringMat);
    bowStringLine.frustumCulled = false;
    this.equippedBowGroup.add(bowStringLine);

    // Nocked 3D Arrow resting on the bow (oriented along +Z forward)
    const arrowShaftGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.68, 6);
    arrowShaftGeo.rotateX(Math.PI / 2);
    arrowShaftGeo.translate(0, 0, 0.24);
    const arrowShaftMesh = new THREE.Mesh(arrowShaftGeo, corkMat);
    arrowShaftMesh.castShadow = true;
    this.nockedArrowGroup.add(arrowShaftMesh);

    const arrowTipGeo = new THREE.ConeGeometry(0.024, 0.09, 4);
    arrowTipGeo.rotateX(Math.PI / 2);
    arrowTipGeo.translate(0, 0, 0.61);
    const arrowTipMesh = new THREE.Mesh(arrowTipGeo, steelHeadMat);
    this.nockedArrowGroup.add(arrowTipMesh);

    const arrowFletchGeo = new THREE.ConeGeometry(0.026, 0.09, 4);
    arrowFletchGeo.rotateX(-Math.PI / 2);
    arrowFletchGeo.translate(0, 0, -0.06);
    const arrowFletchMesh = new THREE.Mesh(arrowFletchGeo, arrowFeatherMat);
    this.nockedArrowGroup.add(arrowFletchMesh);

    this.equippedBowGroup.add(this.nockedArrowGroup);

    this.bowLaunchNode.position.set(0, 0.02, 0.42);
    this.equippedBowGroup.add(this.bowLaunchNode);
    this.modelContainer.add(this.equippedBowGroup);

    // 6. Carried Natural Stones & Chiseled Castle Blocks held in front of chest/arms
    this.carriedStoneGroup.position.set(0, 0.72, 0.36);
    this.carriedStoneGroup.visible = false;
    const fallbackRockGeo = new THREE.DodecahedronGeometry(0.28, 1);
    fallbackRockGeo.scale(1.15, 0.85, 1.05);
    fallbackRockGeo.translate(0, 0.24, 0);
    const fallbackRockMat = new THREE.MeshStandardMaterial({
      color: 0x8d9299,
      roughness: 0.88,
      metalness: 0.04,
    });
    const stoneOffsets = [
      [0, 0, 0, 0.62, 0],
      [-0.18, 0.26, -0.05, 0.48, 1.2],
      [0.18, 0.28, -0.04, 0.46, -0.9],
    ];
    for (let i = 0; i < 3; i++) {
      const [sx, sy, sz, sc, ry] = stoneOffsets[i];
      const sm = new THREE.Mesh(fallbackRockGeo, fallbackRockMat);
      sm.position.set(sx, sy, sz);
      sm.scale.setScalar(sc);
      sm.rotation.y = ry;
      sm.castShadow = true;
      sm.visible = i === 0;
      this.carriedStoneMeshes.push(sm);
      this.carriedStoneGroup.add(sm);
    }
    this.modelContainer.add(this.carriedStoneGroup);

    // 7. Carried Chiseled Ashlar Castle Blocks
    this.carriedBlockGroup.position.set(0, 0.76, 0.36);
    this.carriedBlockGroup.visible = false;
    const ashlarBlockGeo = new THREE.BoxGeometry(0.46, 0.26, 0.34);
    const ashlarBlockMat = new THREE.MeshStandardMaterial({
      color: 0xaeb4bc,
      roughness: 0.76,
      metalness: 0.08,
    });
    const blockOffsets = [
      [0, 0.08, 0, 0],
      [0, 0.35, -0.02, 0.06],
      [-0.16, 0.61, -0.04, -0.08],
      [0.16, 0.61, -0.04, 0.08],
    ];
    for (let i = 0; i < 4; i++) {
      const [bx, by, bz, ry] = blockOffsets[i];
      const bm = new THREE.Mesh(ashlarBlockGeo, ashlarBlockMat);
      bm.position.set(bx, by, bz);
      bm.rotation.y = ry;
      bm.castShadow = true;
      bm.visible = i === 0;
      this.carriedBlockMeshes.push(bm);
      this.carriedBlockGroup.add(bm);
    }
    this.modelContainer.add(this.carriedBlockGroup);

    // 8. Mason's Hammer & Chisel held in hands when chiseling at the Quarry Workbench
    this.chiselToolGroup.position.set(0, 0.88, 0.32);
    this.chiselToolGroup.visible = false;

    // Right-hand Mason's Hammer
    this.hammerPivot.position.set(0.24, 0.08, 0.04);
    const hammerShaftGeo = new THREE.CylinderGeometry(0.016, 0.02, 0.38, 7);
    hammerShaftGeo.translate(0, 0.16, 0);
    const hammerShaft = new THREE.Mesh(hammerShaftGeo, rodWoodMat);
    hammerShaft.castShadow = true;
    this.hammerPivot.add(hammerShaft);

    const hammerHeadGeo = new THREE.BoxGeometry(0.11, 0.1, 0.22);
    hammerHeadGeo.translate(0, 0.34, 0);
    const hammerHead = new THREE.Mesh(hammerHeadGeo, steelHeadMat);
    hammerHead.castShadow = true;
    this.hammerPivot.add(hammerHead);
    this.chiselToolGroup.add(this.hammerPivot);

    // Left-hand Stone Chisel
    this.chiselPivot.position.set(-0.18, 0.02, 0.14);
    this.chiselPivot.rotation.set(0.65, -0.25, -0.2);
    const chiselBodyGeo = new THREE.CylinderGeometry(0.012, 0.018, 0.28, 6);
    const chiselMesh = new THREE.Mesh(chiselBodyGeo, steelHeadMat);
    chiselMesh.castShadow = true;
    this.chiselPivot.add(chiselMesh);
    this.chiselToolGroup.add(this.chiselPivot);

    this.modelContainer.add(this.chiselToolGroup);

    // 9. Melee Combat Weapons (Right Hand) & Round Shield / Mithril Aegis (Left Forearm)
    //    matching `art/gameplay_protect_against_enemy.jpg`
    this.buildCombatWeaponsAndShields(rodWoodMat, flapMat, brassMat, steelHeadMat);
  }

  private buildCombatWeaponsAndShields(
    woodMat: THREE.MeshStandardMaterial,
    darkWoodMat: THREE.MeshStandardMaterial,
    brassMat: THREE.MeshStandardMaterial,
    steelMat: THREE.MeshStandardMaterial
  ): void {
    const darkIronMat = new THREE.MeshStandardMaterial({
      color: 0x3b4148,
      roughness: 0.42,
      metalness: 0.78,
    });
    const runicGoldMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      roughness: 0.22,
      metalness: 0.9,
      emissive: 0xff9f1c,
      emissiveIntensity: 0.65,
    });
    const mithrilMat = new THREE.MeshStandardMaterial({
      color: 0xcaf0f8,
      roughness: 0.18,
      metalness: 0.92,
      emissive: 0x0077b6,
      emissiveIntensity: 0.45,
    });

    this.equippedWeaponGroup.position.set(0, 0, 0);
    this.equippedWeaponGroup.visible = false;

    // A) Starter Stone Mason's Mallet ('mallet')
    {
      const g = new THREE.Group();
      const shaftGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.48, 7);
      shaftGeo.translate(0, 0.2, 0);
      const shaft = new THREE.Mesh(shaftGeo, woodMat);
      shaft.castShadow = true;
      g.add(shaft);

      const headGeo = new THREE.BoxGeometry(0.14, 0.13, 0.26);
      headGeo.translate(0, 0.44, 0);
      const head = new THREE.Mesh(headGeo, darkIronMat);
      head.castShadow = true;
      g.add(head);
      this.weaponMeshes.mallet = g;
      this.equippedWeaponGroup.add(g);
    }

    // B) Iron-Spiked Oak Club ('oak_club')
    {
      const g = new THREE.Group();
      g.visible = false;
      const clubBodyGeo = new THREE.CylinderGeometry(0.068, 0.024, 0.68, 8);
      clubBodyGeo.translate(0, 0.3, 0);
      const clubBody = new THREE.Mesh(clubBodyGeo, darkWoodMat);
      clubBody.castShadow = true;
      g.add(clubBody);

      const bandGeo = new THREE.CylinderGeometry(0.066, 0.062, 0.06, 8);
      bandGeo.translate(0, 0.5, 0);
      g.add(new THREE.Mesh(bandGeo, darkIronMat));

      const spikeGeo = new THREE.ConeGeometry(0.022, 0.09, 5);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const sp = new THREE.Mesh(spikeGeo, steelMat);
        sp.position.set(Math.cos(a) * 0.085, 0.48 + (i % 2) * 0.06, Math.sin(a) * 0.085);
        sp.rotation.z = -Math.cos(a) * (Math.PI / 2);
        sp.rotation.x = Math.sin(a) * (Math.PI / 2);
        g.add(sp);
      }
      this.weaponMeshes.oak_club = g;
      this.equippedWeaponGroup.add(g);
    }

    // C) Dwarven Bearded Battle-Axe ('battle_axe' — matching art/gameplay_protect_against_enemy.jpg)
    {
      const g = new THREE.Group();
      g.visible = false;
      const haftGeo = new THREE.CylinderGeometry(0.02, 0.024, 0.68, 8);
      haftGeo.translate(0, 0.28, 0);
      const haft = new THREE.Mesh(haftGeo, woodMat);
      haft.castShadow = true;
      g.add(haft);

      const collarGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.12, 8);
      collarGeo.translate(0, 0.52, 0);
      g.add(new THREE.Mesh(collarGeo, darkIronMat));

      // Broad bearded crescent axe blade facing forward (+Z)
      const bladeGeo = new THREE.ConeGeometry(0.18, 0.26, 4);
      bladeGeo.rotateX(-Math.PI / 2);
      bladeGeo.scale(0.24, 1.15, 0.95);
      bladeGeo.translate(0, 0.5, 0.13);
      const blade = new THREE.Mesh(bladeGeo, steelMat);
      blade.castShadow = true;
      g.add(blade);

      const backSpikeGeo = new THREE.ConeGeometry(0.035, 0.12, 4);
      backSpikeGeo.rotateX(-Math.PI / 2);
      backSpikeGeo.translate(0, 0.53, -0.07);
      g.add(new THREE.Mesh(backSpikeGeo, darkIronMat));

      this.weaponMeshes.battle_axe = g;
      this.equippedWeaponGroup.add(g);
    }

    // D) Stronghold Broadsword ('broadsword')
    {
      const g = new THREE.Group();
      g.visible = false;
      const gripGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.2, 8);
      gripGeo.translate(0, 0.06, 0);
      g.add(new THREE.Mesh(gripGeo, darkWoodMat));

      const pommelGeo = new THREE.SphereGeometry(0.036, 8, 8);
      pommelGeo.translate(0, -0.05, 0);
      g.add(new THREE.Mesh(pommelGeo, brassMat));

      const guardGeo = new THREE.BoxGeometry(0.04, 0.038, 0.26);
      guardGeo.translate(0, 0.17, 0);
      g.add(new THREE.Mesh(guardGeo, brassMat));

      const bladeGeo = new THREE.BoxGeometry(0.022, 0.66, 0.085);
      bladeGeo.translate(0, 0.51, 0);
      const blade = new THREE.Mesh(bladeGeo, steelMat);
      blade.castShadow = true;
      g.add(blade);

      const tipGeo = new THREE.ConeGeometry(0.06, 0.14, 4);
      tipGeo.scale(0.36, 1.0, 1.0);
      tipGeo.translate(0, 0.91, 0);
      g.add(new THREE.Mesh(tipGeo, steelMat));

      this.weaponMeshes.broadsword = g;
      this.equippedWeaponGroup.add(g);
    }

    // E) Mountain King's Runic Greatsword ('runic_greatsword')
    {
      const g = new THREE.Group();
      g.visible = false;
      const gripGeo = new THREE.CylinderGeometry(0.024, 0.026, 0.26, 8);
      gripGeo.translate(0, 0.08, 0);
      g.add(new THREE.Mesh(gripGeo, darkWoodMat));

      const pommelGeo = new THREE.OctahedronGeometry(0.048, 0);
      pommelGeo.translate(0, -0.06, 0);
      g.add(new THREE.Mesh(pommelGeo, runicGoldMat));

      const guardGeo = new THREE.BoxGeometry(0.05, 0.05, 0.34);
      guardGeo.translate(0, 0.21, 0);
      g.add(new THREE.Mesh(guardGeo, runicGoldMat));

      const bladeGeo = new THREE.BoxGeometry(0.028, 0.82, 0.11);
      bladeGeo.translate(0, 0.64, 0);
      const blade = new THREE.Mesh(bladeGeo, mithrilMat);
      blade.castShadow = true;
      g.add(blade);

      const runeStripGeo = new THREE.BoxGeometry(0.034, 0.68, 0.036);
      runeStripGeo.translate(0, 0.62, 0);
      g.add(new THREE.Mesh(runeStripGeo, runicGoldMat));

      const tipGeo = new THREE.ConeGeometry(0.078, 0.18, 4);
      tipGeo.scale(0.36, 1.0, 1.0);
      tipGeo.translate(0, 1.14, 0);
      g.add(new THREE.Mesh(tipGeo, mithrilMat));

      this.weaponMeshes.runic_greatsword = g;
      this.equippedWeaponGroup.add(g);
    }

    // F) Twin Dragon-Slayer Greataxe ('dragon_greataxe')
    {
      const g = new THREE.Group();
      g.visible = false;
      const haftGeo = new THREE.CylinderGeometry(0.028, 0.032, 0.88, 8);
      haftGeo.translate(0, 0.38, 0);
      g.add(new THREE.Mesh(haftGeo, darkWoodMat));

      const dragonMagmaMat = new THREE.MeshStandardMaterial({
        color: 0xff3300,
        roughness: 0.25,
        metalness: 0.8,
        emissive: 0xff4400,
        emissiveIntensity: 1.1,
      });

      const pommelGeo = new THREE.OctahedronGeometry(0.052, 0);
      pommelGeo.translate(0, -0.06, 0);
      g.add(new THREE.Mesh(pommelGeo, dragonMagmaMat));

      // Dual axe blades
      const leftBladeGeo = new THREE.ConeGeometry(0.24, 0.44, 4);
      leftBladeGeo.scale(0.22, 1.0, 1.0);
      leftBladeGeo.rotateZ(Math.PI / 2);
      leftBladeGeo.translate(-0.16, 0.72, 0);
      const leftBlade = new THREE.Mesh(leftBladeGeo, mithrilMat);
      leftBlade.castShadow = true;
      g.add(leftBlade);

      const rightBladeGeo = new THREE.ConeGeometry(0.24, 0.44, 4);
      rightBladeGeo.scale(0.22, 1.0, 1.0);
      rightBladeGeo.rotateZ(-Math.PI / 2);
      rightBladeGeo.translate(0.16, 0.72, 0);
      const rightBlade = new THREE.Mesh(rightBladeGeo, mithrilMat);
      rightBlade.castShadow = true;
      g.add(rightBlade);

      // Central glowing dragon spike
      const spikeGeo = new THREE.ConeGeometry(0.045, 0.22, 4);
      spikeGeo.translate(0, 0.94, 0);
      g.add(new THREE.Mesh(spikeGeo, dragonMagmaMat));

      this.weaponMeshes.dragon_greataxe = g;
      this.equippedWeaponGroup.add(g);
    }

    // Glowing 3D Sword Slash Arc Trail that sweeps in front of the Dwarf during a melee swing
    const slashArcGeo = new THREE.RingGeometry(0.46, 0.96, 18, 1, -Math.PI * 0.42, Math.PI * 0.84);
    slashArcGeo.rotateX(-Math.PI * 0.38);
    slashArcGeo.rotateZ(-0.22);
    this.meleeSlashArcMat = new THREE.MeshBasicMaterial({
      color: 0xe2f1ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.meleeSlashArcMesh = new THREE.Mesh(slashArcGeo, this.meleeSlashArcMat);
    this.meleeSlashArcMesh.position.set(0.08, 0.88, 0.42);
    this.meleeSlashArcMesh.visible = false;
    this.modelContainer.add(this.meleeSlashArcMesh);

    // F) Left-Arm Equipped Round Shield & Mithril Aegis (matching art/gameplay_protect_against_enemy.jpg)
    this.equippedShieldGroup.position.set(-0.34, 0.84, 0.22);
    this.equippedShieldGroup.visible = false;

    const buildShieldMesh = (isMithril: boolean): THREE.Group => {
      const sg = new THREE.Group();
      const discGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.042, 18);
      discGeo.rotateZ(Math.PI / 2);
      const disc = new THREE.Mesh(discGeo, isMithril ? mithrilMat : woodMat);
      disc.castShadow = true;
      sg.add(disc);

      const rimGeo = new THREE.TorusGeometry(0.34, 0.028, 8, 20);
      rimGeo.rotateY(Math.PI / 2);
      const rim = new THREE.Mesh(rimGeo, isMithril ? runicGoldMat : darkIronMat);
      rim.castShadow = true;
      sg.add(rim);

      const bossGeo = new THREE.SphereGeometry(0.095, 10, 8);
      bossGeo.scale(0.65, 1.0, 1.0);
      bossGeo.translate(-0.025, 0, 0);
      const boss = new THREE.Mesh(bossGeo, isMithril ? runicGoldMat : steelMat);
      sg.add(boss);

      return sg;
    };

    const roundShield = buildShieldMesh(false);
    this.shieldMeshes.round_shield = roundShield;
    this.equippedShieldGroup.add(roundShield);

    const mithrilShield = buildShieldMesh(true);
    mithrilShield.visible = false;
    this.shieldMeshes.mithril_aegis = mithrilShield;
    this.equippedShieldGroup.add(mithrilShield);

    this.modelContainer.add(this.equippedShieldGroup);

    // Stowed Shield on Backpack when busy fishing/hunting/carrying stones
    const stowedShieldDisc = new THREE.CylinderGeometry(0.24, 0.24, 0.03, 14);
    stowedShieldDisc.rotateX(Math.PI / 2);
    const stowedShieldMesh = new THREE.Mesh(stowedShieldDisc, woodMat);
    const stowedShieldRim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.02, 6, 16), darkIronMat);
    this.stowedShieldGroup.add(stowedShieldMesh);
    this.stowedShieldGroup.add(stowedShieldRim);
    this.stowedShieldGroup.position.set(0, -0.02, -0.14);
    this.stowedShieldGroup.visible = false;
    this.backpackGroup.add(this.stowedShieldGroup);

    // 7. Build Dwarven Progression Armor (Horned Helmet, Mithril Pauldrons, Golden Crown) & Warhorn of Khazad
    this.buildProgressionArmorAndWarhorn(darkIronMat, brassMat, mithrilMat, runicGoldMat);
  }

  private buildProgressionArmorAndWarhorn(
    darkIronMat: THREE.MeshStandardMaterial,
    goldMat: THREE.MeshStandardMaterial,
    mithrilMat: THREE.MeshStandardMaterial,
    runeGlowMat: THREE.MeshStandardMaterial
  ): void {
    const hornIvoryMat = new THREE.MeshStandardMaterial({
      color: 0xf3ead2,
      roughness: 0.42,
      metalness: 0.1,
    });
    const rubyMat = new THREE.MeshStandardMaterial({
      color: 0xff2a4b,
      emissive: 0xcc1122,
      emissiveIntensity: 0.75,
      roughness: 0.2,
      metalness: 0.4,
    });

    // A. Horned Dwarven Helmet (Rank II+ or Shield Equipped) - anchored to headSocket
    this.helmetGroup.position.set(0, 0.17, 0.02);
    const domeGeo = new THREE.SphereGeometry(0.18, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const dome = new THREE.Mesh(domeGeo, darkIronMat);
    dome.castShadow = true;
    this.helmetGroup.add(dome);

    const browBand = new THREE.Mesh(new THREE.CylinderGeometry(0.186, 0.186, 0.04, 16), goldMat);
    browBand.position.y = 0.02;
    this.helmetGroup.add(browBand);

    const nasalGuard = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.09, 0.03), goldMat);
    nasalGuard.position.set(0, -0.02, 0.18);
    this.helmetGroup.add(nasalGuard);

    for (const side of [-1, 1]) {
      const hornPivot = new THREE.Group();
      hornPivot.position.set(side * 0.16, 0.05, 0.0);
      hornPivot.rotation.z = -side * 0.65;
      hornPivot.rotation.x = 0.25;
      const hornBase = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.18, 8), hornIvoryMat);
      hornBase.position.y = 0.08;
      hornBase.castShadow = true;
      const hornRing = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 8), goldMat);
      hornRing.position.y = 0.01;
      hornPivot.add(hornBase, hornRing);
      this.helmetGroup.add(hornPivot);
    }
    this.helmetGroup.visible = false;

    // B. Mithril Winged Pauldrons (Rank III+ or Mithril Aegis)
    this.pauldronsGroup.position.set(0, 1.0, 0.01);
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.25, 0, 0);
      shoulder.rotation.z = -side * 0.28;
      const plateGeo = new THREE.SphereGeometry(0.115, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const plate = new THREE.Mesh(plateGeo, mithrilMat);
      plate.scale.set(1.15, 0.85, 1.05);
      plate.castShadow = true;
      const trim = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 6, 12), goldMat);
      trim.rotation.x = Math.PI / 2;
      trim.position.y = 0.01;
      const runeGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.028, 0), runeGlowMat);
      runeGem.position.set(side * 0.06, 0.06, 0.06);
      shoulder.add(plate, trim, runeGem);
      this.pauldronsGroup.add(shoulder);
    }
    this.pauldronsGroup.visible = false;
    this.modelContainer.add(this.pauldronsGroup);

    // C. Golden Crown of Khazad-dûm (Rank V High King or Durin's Crown Artefact) - anchored to headSocket
    this.crownGroup.position.set(0, 0.20, 0.02);
    const circlet = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.17, 0.055, 16), goldMat);
    circlet.castShadow = true;
    this.crownGroup.add(circlet);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.085, 4), goldMat);
      spike.position.set(Math.sin(angle) * 0.165, 0.06, Math.cos(angle) * 0.165);
      this.crownGroup.add(spike);
    }
    const frontRuby = new THREE.Mesh(new THREE.OctahedronGeometry(0.036, 0), rubyMat);
    frontRuby.position.set(0, 0.02, 0.178);
    this.crownGroup.add(frontRuby);
    this.crownGroup.visible = false;

    // D. Warhorn of Khazad (stowed at right hip or raised to lips when blown)
    const hornBody = new THREE.Mesh(new THREE.ConeGeometry(0.058, 0.28, 10, 1, true), hornIvoryMat);
    hornBody.rotation.x = Math.PI / 2;
    hornBody.castShadow = true;
    const hornMouthRing = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 6, 12), goldMat);
    hornMouthRing.position.z = 0.14;
    const hornTip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, 0.08, 8), goldMat);
    hornTip.rotation.x = Math.PI / 2;
    hornTip.position.z = -0.14;
    this.warhornGroup.add(hornBody, hornMouthRing, hornTip);
    this.warhornGroup.position.set(0.23, 0.58, 0.06);
    this.warhornGroup.rotation.set(0.4, 0.3, -0.5);
    this.warhornGroup.visible = false;
    this.modelContainer.add(this.warhornGroup);

    // E. Expanding Golden Sonic Shockwave Ring when blowing the Warhorn
    const waveGeo = new THREE.RingGeometry(0.65, 0.92, 32);
    waveGeo.rotateX(-Math.PI / 2);
    const waveMat = new THREE.MeshBasicMaterial({
      color: 0xffd25a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.warhornWaveRing = new THREE.Mesh(waveGeo, waveMat);
    this.warhornWaveRing.position.y = 0.35;
    this.warhornWaveRing.visible = false;
    this.root.add(this.warhornWaveRing);

    const slamGeo = new THREE.RingGeometry(0.42, 0.65, 28);
    slamGeo.rotateX(-Math.PI / 2);
    const slamMat = new THREE.MeshBasicMaterial({
      color: 0xffb74d,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.slamShockwaveRing = new THREE.Mesh(slamGeo, slamMat);
    this.slamShockwaveRing.position.y = 0.12;
    this.slamShockwaveRing.visible = false;
    this.root.add(this.slamShockwaveRing);

    // Freeze static child meshes on equipment/armor groups so updateMatrixWorld skips Euler/Quat recomputation
    const freezeStaticMeshes = (group: THREE.Object3D) => {
      group.traverse((child) => {
        if (child !== group && child instanceof THREE.Mesh) {
          child.updateMatrix();
          child.matrixAutoUpdate = false;
        }
      });
    };
    freezeStaticMeshes(this.helmetGroup);
    freezeStaticMeshes(this.pauldronsGroup);
    freezeStaticMeshes(this.crownGroup);
    freezeStaticMeshes(this.warhornGroup);
    freezeStaticMeshes(this.backpackGroup);
    freezeStaticMeshes(this.equippedWeaponGroup);
    freezeStaticMeshes(this.equippedShieldGroup);
  }

  public setNaturalRockAsset(
    geo: THREE.BufferGeometry,
    mat: THREE.MeshStandardMaterial
  ): void {
    for (const m of this.carriedStoneMeshes) {
      m.geometry = geo;
      m.material = mat;
      m.receiveShadow = false;
    }
  }

  public setCarriedLoad(rawStones: number, chiseledBlocks: number): void {
    this.carriedRawStones = Math.max(0, Math.floor(rawStones));
    this.carriedChiseledBlocks = Math.max(0, Math.floor(chiseledBlocks));
    for (let i = 0; i < this.carriedStoneMeshes.length; i++) {
      this.carriedStoneMeshes[i].visible = i < this.carriedRawStones;
    }
    for (let i = 0; i < this.carriedBlockMeshes.length; i++) {
      this.carriedBlockMeshes[i].visible = i < this.carriedChiseledBlocks;
    }
  }

  public triggerChiselAnimation(duration = 1.0): void {
    this.chiselAnimDuration = Math.max(0.25, duration);
    this.chiselAnimTimer = this.chiselAnimDuration;
  }

  public isChiseling(): boolean {
    return this.chiselAnimTimer > 0;
  }

  public setEquippedCombatGear(weaponId: EquippedWeaponId, shieldId: EquippedShieldId): void {
    this.equippedWeaponId = weaponId;
    this.equippedShieldId = shieldId;
    for (const [id, mesh] of Object.entries(this.weaponMeshes)) {
      if (mesh) mesh.visible = id === weaponId;
    }
    if (this.shieldMeshes.round_shield) {
      this.shieldMeshes.round_shield.visible = shieldId === 'round_shield';
    }
    if (this.shieldMeshes.mithril_aegis) {
      this.shieldMeshes.mithril_aegis.visible = shieldId === 'mithril_aegis';
    }
    this.refreshArmorVisibility();
  }

  public setProgressionVisuals(rank: number, hasCrownArtefact: boolean): void {
    this.progressionRank = Math.max(1, Math.floor(rank));
    this.hasDurinCrown = hasCrownArtefact;
    this.refreshArmorVisibility();
  }

  public triggerWarhornAnimation(): void {
    this.warhornAnimTimer = 1.25;
    this.warhornWaveTimer = 1.1;
    this.warhornGroup.visible = true;
    this.warhornWaveRing.visible = true;
  }

  public triggerGroundSlamShockwave(): void {
    this.slamShockwaveTimer = 0.45;
    this.slamShockwaveRing.visible = true;
    this.spawnBurst(this.root.position.x, this.root.position.y + 0.15, this.root.position.z, 28);
  }

  private refreshArmorVisibility(): void {
    const showCrown = this.progressionRank >= 5 || this.hasDurinCrown;
    const showHelmet =
      !showCrown && (this.progressionRank >= 2 || this.equippedShieldId !== 'none');
    const showPauldrons =
      this.progressionRank >= 3 ||
      this.equippedShieldId === 'mithril_aegis' ||
      this.equippedWeaponId === 'runic_greatsword' ||
      this.equippedWeaponId === 'dragon_greataxe';
    const showWarhorn =
      this.progressionRank >= 2 ||
      this.equippedShieldId !== 'none' ||
      this.equippedWeaponId !== 'mallet' ||
      this.warhornAnimTimer > 0;

    this.crownGroup.visible = showCrown;
    this.helmetGroup.visible = showHelmet;
    this.pauldronsGroup.visible = showPauldrons;
    this.warhornGroup.visible = showWarhorn;
  }

  public setCombatReady(ready: boolean): void {
    this.combatReady = ready;
  }

  public triggerMeleeSwing(): void {
    this.meleeSwingTimer = this.meleeSwingDuration;
    this.isFishingMode = false;
    this.fishingEquipBlend = 0;
    this.isHuntingMode = false;
    this.huntingEquipBlend = 0;
  }

  public isSwingingWeapon(): boolean {
    return this.meleeSwingTimer > 0;
  }

  public setShieldBlocking(blocking: boolean): void {
    this.shieldBlocking = blocking;
  }

  public isShieldBlocking(): boolean {
    return this.shieldBlocking && this.equippedShieldId !== 'none';
  }

  public triggerBlockImpact(): void {
    this.shieldImpactTimer = 0.26;
  }

  public setFishingMode(active: boolean): void {
    if (this.isFishingMode === active) return;
    this.isFishingMode = active;
    if (active) {
      this.isHuntingMode = false;
      this.bowDrawTarget = 0;
    } else {
      this.castAnimTimer = 0;
      this.rodBendTarget = 0;
    }
  }

  public triggerCastAnimation(): void {
    this.castAnimTimer = 0.48;
  }

  public setRodBend(bend: number): void {
    this.rodBendTarget = THREE.MathUtils.clamp(bend, 0, 1.2);
  }

  private static readonly _fallbackRodTip = new THREE.Vector3();
  private static readonly _fallbackBowLaunch = new THREE.Vector3();

  public getRodTipWorldPosition(out: THREE.Vector3 = DwarfCharacter._fallbackRodTip): THREE.Vector3 {
    this.rodTipNode.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.rodTipNode.matrixWorld);
  }

  public setHuntingMode(active: boolean): void {
    if (this.isHuntingMode === active) return;
    this.isHuntingMode = active;
    if (active) {
      this.isFishingMode = false;
      this.rodBendTarget = 0;
    } else {
      this.bowDrawTarget = 0;
      this.bowReleaseTimer = 0;
    }
  }

  public setBowDraw(draw: number): void {
    this.bowDrawTarget = THREE.MathUtils.clamp(draw, 0, 1.0);
  }

  public triggerBowReleaseAnimation(): void {
    this.bowReleaseTimer = 0.28;
    this.bowDrawTarget = 0;
    this.bowDrawCurrent = 0;
  }

  public getBowLaunchWorldPosition(out: THREE.Vector3 = DwarfCharacter._fallbackBowLaunch): THREE.Vector3 {
    this.bowLaunchNode.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.bowLaunchNode.matrixWorld);
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
    points.matrixAutoUpdate = false;
    points.visible = false;
    return points;
  }

  public spawnBurst(worldX: number, worldY: number, worldZ: number, count = 10): void {
    const arr = this.particlePosAttr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const idx = this.particleHead;
      this.particleHead = (this.particleHead + 1) % this.maxParticles;
      if (this.particleAge[idx] >= this.particleMaxLife[idx]) {
        this.activeParticleCount++;
      }
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
    this.trailPoints.visible = true;
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
    const loader = createOptimizedGlbLoader();
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
            if (!obj.geometry.boundingSphere) {
              obj.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 2.5);
            } else {
              obj.geometry.boundingSphere.set(new THREE.Vector3(0, 1.0, 0), 2.5);
            }
            obj.frustumCulled = true;

            const origMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
            if (origMat instanceof THREE.MeshStandardMaterial) {
              const baseMap = origMat.map;
              const secondaryMaps = [
                origMat.normalMap,
                origMat.roughnessMap,
                origMat.metalnessMap,
                origMat.aoMap,
                origMat.emissiveMap,
              ];
              for (const tex of secondaryMaps) {
                if (tex && tex !== baseMap) {
                  tex.dispose();
                }
              }
              obj.material = new THREE.MeshStandardMaterial({
                map: baseMap,
                roughness: 0.78,
                metalness: 0.08,
              });
              origMat.dispose();
            }
          }
        });

        this.modelContainer.add(model);
        this.setupAnimations(model, gltf.animations);
        this.refreshArmorVisibility();
      },
      undefined,
      (err) => {
        console.error('Failed to load dwarf 3D model:', err);
      }
    );
  }

  private setupAnimations(model: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    this.mixer = new THREE.AnimationMixer(model);

    model.traverse((obj) => {
      if (!obj.name) return;
      if (obj.name.endsWith('Spine1')) {
        this.spine1Bone = obj;
      } else if (obj.name.endsWith('RightArm') && !obj.name.includes('ForeArm')) {
        this.rightArmBone = obj;
      } else if (obj.name.endsWith('RightForeArm')) {
        this.rightForeArmBone = obj;
      } else if (obj.name.endsWith('Head') && !obj.name.includes('HeadTop')) {
        this.headBone = obj;
      } else if (
        obj.name.endsWith('RightHand') &&
        !obj.name.includes('Index') &&
        !obj.name.includes('Middle') &&
        !obj.name.includes('Pinky') &&
        !obj.name.includes('Ring') &&
        !obj.name.includes('Thumb')
      ) {
        this.rightHandBone = obj;
      }
    });

    if (this.headBone) {
      model.updateMatrixWorld(true);
      const headWorldQuat = new THREE.Quaternion();
      this.headBone.getWorldQuaternion(headWorldQuat);
      this.headSocket.quaternion.copy(headWorldQuat.clone().invert());
      this.headSocket.scale.setScalar(1 / this.modelScale);
      this.headBone.add(this.headSocket);
      this.headSocket.add(this.crownGroup);
      this.headSocket.add(this.helmetGroup);
    }

    if (this.rightHandBone) {
      this.rightHandSocket.scale.setScalar(1 / this.modelScale);
      this.rightHandSocket.position.set(-0.015, 0.045, 0.012);
      this.rightHandSocket.rotation.set(Math.PI * 0.42, 0, -0.15);
      this.rightHandBone.add(this.rightHandSocket);
      this.rightHandSocket.add(this.equippedWeaponGroup);
    }

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
    slopePitch = 0,
    isGroundSlamming = false
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

    // Smoothly tilt dwarf model forward/downhill when sliding, gliding, or ground-slamming
    if (isGliding) {
      this.glideTime += dt;
    } else {
      this.glideTime = 0;
    }
    const desiredTiltX = isGroundSlamming ? 0.64 : isSliding ? slopePitch + 0.18 : isGliding ? 0.24 : 0;
    const desiredTiltZ = isGliding ? Math.sin(this.glideTime * 4.0) * 0.08 : 0;
    if (
      Math.abs(this.slideTiltX - desiredTiltX) > 0.0005 ||
      Math.abs(this.slideTiltZ - desiredTiltZ) > 0.0005
    ) {
      this.slideTiltX = THREE.MathUtils.lerp(this.slideTiltX, desiredTiltX, Math.min(1, dt * 10));
      this.slideTiltZ = THREE.MathUtils.lerp(this.slideTiltZ, desiredTiltZ, Math.min(1, dt * 8));
      this.modelContainer.rotation.set(this.slideTiltX, 0, this.slideTiltZ);
    } else if (this.slideTiltX !== desiredTiltX || this.slideTiltZ !== desiredTiltZ) {
      this.slideTiltX = desiredTiltX;
      this.slideTiltZ = desiredTiltZ;
      this.modelContainer.rotation.set(this.slideTiltX, 0, this.slideTiltZ);
    }

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

    // Show Ironbelly Surf-Shield underneath boots when slope-sliding, dashing, or ground-slamming
    this.surfShieldMesh.visible = (isSliding || isGroundSlamming) && !isSwimming;

    // Animate drawing the Fishing Rod out of the backpack (or stowing it back into the backpack)
    const wantFishing = this.isFishingMode && !isSwimming && !isGliding;
    const targetFishBlend = wantFishing ? 1.0 : 0.0;
    if (Math.abs(this.fishingEquipBlend - targetFishBlend) > 0.002) {
      this.fishingEquipBlend = THREE.MathUtils.lerp(
        this.fishingEquipBlend,
        targetFishBlend,
        Math.min(1, dt * 9.5)
      );
    } else {
      this.fishingEquipBlend = targetFishBlend;
    }

    const rodOut = this.fishingEquipBlend > 0.25;
    this.stowedRodGroup.visible = !rodOut;
    this.equippedRodGroup.visible = rodOut;

    if (rodOut) {
      // Smoothly swing rod from backpack over the right shoulder into fishing stance
      const equipT = THREE.MathUtils.smoothstep(this.fishingEquipBlend, 0.25, 1.0);
      let castSwingPitch = 0;
      if (this.castAnimTimer > 0) {
        this.castAnimTimer = Math.max(0, this.castAnimTimer - dt);
        const p = 1.0 - this.castAnimTimer / 0.48;
        // Wind back (0..0.35), snap forward (0.35..0.75), settle (0.75..1.0)
        if (p < 0.35) {
          castSwingPitch = -Math.sin((p / 0.35) * (Math.PI * 0.5)) * 0.68;
        } else {
          castSwingPitch = Math.sin(((p - 0.35) / 0.65) * Math.PI) * 0.54;
        }
      }

      const startX = 0.22;
      const startY = 1.15;
      const startZ = -0.18;
      this.equippedRodGroup.position.set(
        THREE.MathUtils.lerp(startX, 0.32, equipT),
        THREE.MathUtils.lerp(startY, 0.86, equipT),
        THREE.MathUtils.lerp(startZ, 0.26, equipT)
      );
      this.equippedRodGroup.rotation.set(
        THREE.MathUtils.lerp(-0.95, -0.14 + castSwingPitch, equipT),
        THREE.MathUtils.lerp(0.45, -0.06, equipT),
        THREE.MathUtils.lerp(-0.35, 0.0, equipT)
      );

      this.rodBendCurrent = THREE.MathUtils.lerp(
        this.rodBendCurrent,
        this.rodBendTarget,
        Math.min(1, dt * 10.0)
      );
      this.rodBendPivot.rotation.x = this.rodBendCurrent * 0.42 + Math.max(0, castSwingPitch) * 0.25;
    }

    // Animate drawing the Hunting Bow & Arrow out of the backpack (or stowing it back)
    const wantHunting = this.isHuntingMode && !isSwimming && !isGliding;
    const targetHuntBlend = wantHunting ? 1.0 : 0.0;
    if (Math.abs(this.huntingEquipBlend - targetHuntBlend) > 0.002) {
      this.huntingEquipBlend = THREE.MathUtils.lerp(
        this.huntingEquipBlend,
        targetHuntBlend,
        Math.min(1, dt * 9.5)
      );
    } else {
      this.huntingEquipBlend = targetHuntBlend;
    }

    const bowOut = this.huntingEquipBlend > 0.25;
    this.stowedBowGroup.visible = !bowOut;
    this.equippedBowGroup.visible = bowOut;

    if (bowOut) {
      const equipT = THREE.MathUtils.smoothstep(this.huntingEquipBlend, 0.25, 1.0);
      if (this.bowReleaseTimer > 0) {
        this.bowReleaseTimer = Math.max(0, this.bowReleaseTimer - dt);
      }

      this.bowDrawCurrent = THREE.MathUtils.lerp(
        this.bowDrawCurrent,
        this.bowDrawTarget,
        Math.min(1, dt * 11.0)
      );

      const recoilZ = this.bowReleaseTimer > 0 ? Math.sin((this.bowReleaseTimer / 0.28) * Math.PI) * 0.07 : 0;
      const startX = -0.22;
      const startY = 1.12;
      const startZ = -0.18;
      this.equippedBowGroup.position.set(
        THREE.MathUtils.lerp(startX, -0.18, equipT),
        THREE.MathUtils.lerp(startY, 0.92, equipT),
        THREE.MathUtils.lerp(startZ, 0.36 + recoilZ, equipT)
      );
      this.equippedBowGroup.rotation.set(
        THREE.MathUtils.lerp(0.85, -0.06, equipT),
        THREE.MathUtils.lerp(-0.45, 0.08, equipT),
        THREE.MathUtils.lerp(0.55, 0.14, equipT)
      );

      // Flex upper & lower bow limbs backward as the bowstring is drawn
      const limbFlex = this.bowDrawCurrent * 0.36;
      this.upperBowLimb.rotation.x = -limbFlex;
      this.lowerBowLimb.rotation.x = limbFlex;

      // Update 3-point bowstring geometry: upper tip -> nocked center -> lower tip
      const totalAngle = 0.28 + limbFlex;
      const tipY = 0.1 + Math.cos(totalAngle) * 0.46;
      const tipZ = -Math.sin(totalAngle) * 0.46;
      const stringVibration =
        this.bowReleaseTimer > 0
          ? Math.sin(this.bowReleaseTimer * 95.0) * (this.bowReleaseTimer / 0.28) * 0.04
          : 0;
      const nockZ = tipZ - this.bowDrawCurrent * 0.34 + stringVibration;

      this.bowStringPositions[0] = 0;
      this.bowStringPositions[1] = tipY;
      this.bowStringPositions[2] = tipZ;
      this.bowStringPositions[3] = 0;
      this.bowStringPositions[4] = 0;
      this.bowStringPositions[5] = nockZ;
      this.bowStringPositions[6] = 0;
      this.bowStringPositions[7] = -tipY;
      this.bowStringPositions[8] = tipZ;
      this.bowStringAttr.needsUpdate = true;

      // Hide nocked arrow briefly right after releasing a shot while dwarf reaches for next arrow
      const showNockedArrow = this.bowReleaseTimer < 0.12;
      this.nockedArrowGroup.visible = showNockedArrow;
      if (showNockedArrow) {
        this.nockedArrowGroup.position.set(0, 0, nockZ + 0.06);
      }
    }

    // Animate Mason's Hammer & Chisel when chiseling at the Quarry Workbench
    const isChiselingNow = this.chiselAnimTimer > 0 && !isSwimming && !rodOut && !bowOut;
    if (this.chiselAnimTimer > 0) {
      this.chiselAnimTimer = Math.max(0, this.chiselAnimTimer - dt);
    }
    this.chiselToolGroup.visible = isChiselingNow;
    if (isChiselingNow) {
      const phase = (1.0 - this.chiselAnimTimer / this.chiselAnimDuration) * Math.PI * 6.0;
      const strike = Math.abs(Math.sin(phase));
      this.hammerPivot.rotation.x = 0.25 + strike * 0.95;
      this.chiselPivot.position.z = 0.14 + (1.0 - strike) * 0.04;
    }

    // 9. Animate Equipped Melee Weapon (Right Hand) & Shield (Left Arm)
    if (this.meleeSwingTimer > 0) {
      this.meleeSwingTimer = Math.max(0, this.meleeSwingTimer - dt);
    }
    if (this.shieldImpactTimer > 0) {
      this.shieldImpactTimer = Math.max(0, this.shieldImpactTimer - dt);
    }
    const isSwingingNow = this.meleeSwingTimer > 0;

    // Show carried Natural Stones or Chiseled Castle Blocks when not fishing/hunting/swimming/chiseling/swinging
    const canShowCarry = !isSwimming && !rodOut && !bowOut && !isChiselingNow && !isSwingingNow;
    const showRawStones = canShowCarry && this.carriedRawStones > 0 && this.carriedChiseledBlocks === 0;
    const showBlocks = canShowCarry && this.carriedChiseledBlocks > 0;
    this.carriedStoneGroup.visible = showRawStones;
    this.carriedBlockGroup.visible = showBlocks;
    this.carryBobTime += dt * (moveSpeed > 0.2 ? 9.0 : 2.2);
    if (showRawStones || showBlocks) {
      const bobY = Math.sin(this.carryBobTime) * (moveSpeed > 0.2 ? 0.032 : 0.01);
      if (showRawStones) {
        this.carriedStoneGroup.position.y = 0.72 + bobY;
      }
      if (showBlocks) {
        this.carriedBlockGroup.position.y = 0.76 + bobY;
      }
    }

    const busyWithHands =
      isSwimming || isGliding || rodOut || bowOut || isChiselingNow || showRawStones || showBlocks;
    const showWeaponInHand = !busyWithHands;
    const hasShield = this.equippedShieldId !== 'none';
    const showShieldOnArm = !busyWithHands && hasShield;

    this.equippedWeaponGroup.visible = showWeaponInHand;
    this.equippedShieldGroup.visible = showShieldOnArm;
    this.stowedShieldGroup.visible = busyWithHands && hasShield;

    let swingProgress = -1;
    if (showWeaponInHand) {
      if (isSwingingNow) {
        swingProgress = 1.0 - this.meleeSwingTimer / this.meleeSwingDuration;
      } else {
        const readyAngle = this.combatReady ? 0.12 : 0;
        this.rightHandSocket.rotation.set(Math.PI * 0.42 + readyAngle, 0, -0.15);
      }
    }

    if (swingProgress >= 0.22 && swingProgress <= 0.78) {
      const cleaveT = (swingProgress - 0.22) / 0.56;
      this.meleeSlashArcMesh.visible = true;
      this.meleeSlashArcMat.color.setHex(
        this.equippedWeaponId === 'dragon_greataxe'
          ? 0xff3300
          : this.equippedWeaponId === 'runic_greatsword'
          ? 0xffd166
          : this.equippedWeaponId === 'broadsword' || this.equippedWeaponId === 'battle_axe'
            ? 0xe2f1ff
            : 0xf4dcb5
      );
      this.meleeSlashArcMat.opacity = Math.sin(cleaveT * Math.PI) * 0.76;
      this.meleeSlashArcMesh.rotation.y = THREE.MathUtils.lerp(-0.55, 0.65, cleaveT);
      this.meleeSlashArcMesh.scale.setScalar(0.88 + cleaveT * 0.28);
    } else if (this.meleeSlashArcMesh.visible) {
      this.meleeSlashArcMesh.visible = false;
    }

    if (showShieldOnArm) {
      const targetBlock = this.shieldBlocking ? 1.0 : 0.0;
      this.shieldBlockBlend = THREE.MathUtils.lerp(
        this.shieldBlockBlend,
        targetBlock,
        Math.min(1, dt * 14.0)
      );
      const impactRecoil =
        this.shieldImpactTimer > 0
          ? Math.sin((this.shieldImpactTimer / 0.26) * Math.PI) * 0.09
          : 0;
      // Blend from left side-guard (-0.34, 0.84, 0.22) to raised front guard (-0.12, 0.94, 0.44)
      // matching `art/gameplay_protect_against_enemy.jpg`
      this.equippedShieldGroup.position.set(
        THREE.MathUtils.lerp(-0.34, -0.11, this.shieldBlockBlend),
        THREE.MathUtils.lerp(0.82, 0.94, this.shieldBlockBlend),
        THREE.MathUtils.lerp(0.22, 0.44 - impactRecoil, this.shieldBlockBlend)
      );
      this.equippedShieldGroup.rotation.set(
        THREE.MathUtils.lerp(0.08, -0.18, this.shieldBlockBlend),
        THREE.MathUtils.lerp(0.28, 1.38, this.shieldBlockBlend),
        THREE.MathUtils.lerp(-0.12, 0.08, this.shieldBlockBlend)
      );
    }

    // 10. Animate Warhorn of Khazad (raised to lips when blown, stowed at hip otherwise) & Golden Sonic Ring
    if (this.warhornAnimTimer > 0) {
      this.warhornAnimTimer = Math.max(0, this.warhornAnimTimer - dt);
      const t = 1.0 - this.warhornAnimTimer / 1.25;
      const raiseBlend =
        t < 0.22
          ? t / 0.22
          : t < 0.78
            ? 1.0
            : Math.max(0, 1.0 - (t - 0.78) / 0.22);
      this.warhornGroup.position.set(
        THREE.MathUtils.lerp(0.23, 0.06, raiseBlend),
        THREE.MathUtils.lerp(0.58, 1.16, raiseBlend),
        THREE.MathUtils.lerp(0.06, 0.28, raiseBlend)
      );
      this.warhornGroup.rotation.set(
        THREE.MathUtils.lerp(0.4, -0.35, raiseBlend),
        THREE.MathUtils.lerp(0.3, -0.08, raiseBlend),
        THREE.MathUtils.lerp(-0.5, 0.0, raiseBlend)
      );
      if (this.warhornAnimTimer === 0) {
        this.refreshArmorVisibility();
      }
    } else if (this.warhornGroup.visible) {
      this.warhornGroup.position.set(0.23, 0.58, 0.06);
      this.warhornGroup.rotation.set(0.4, 0.3, -0.5);
    }

    if (this.warhornWaveTimer > 0) {
      this.warhornWaveTimer = Math.max(0, this.warhornWaveTimer - dt);
      const p = 1.0 - this.warhornWaveTimer / 1.1;
      this.warhornWaveRing.visible = true;
      this.warhornWaveRing.scale.setScalar(1.0 + p * 14.5);
      (this.warhornWaveRing.material as THREE.MeshBasicMaterial).opacity =
        Math.sin(p * Math.PI) * 0.78;
      if (this.warhornWaveTimer === 0) {
        this.warhornWaveRing.visible = false;
      }
    }

    if (this.slamShockwaveTimer > 0) {
      this.slamShockwaveTimer = Math.max(0, this.slamShockwaveTimer - dt);
      const p = 1.0 - this.slamShockwaveTimer / 0.45;
      this.slamShockwaveRing.visible = true;
      this.slamShockwaveRing.scale.setScalar(1.0 + p * 12.0);
      (this.slamShockwaveRing.material as THREE.MeshBasicMaterial).opacity =
        Math.sin(p * Math.PI) * 0.88;
      if (this.slamShockwaveTimer === 0) {
        this.slamShockwaveRing.visible = false;
      }
    }

    // Emit & simulate world-space trail particles (sparks when sliding or plunging, dust when trailblazing)
    const shouldEmitTrail = (isSliding || isGroundSlamming || (isTrailblazing && moveSpeed > 9.0)) && !isSwimming;
    if (shouldEmitTrail) {
      const rate = isSliding ? 28 : 14;
      this.emitAccum += dt * rate;
      const arr = this.particlePosAttr.array as Float32Array;
      while (this.emitAccum >= 1) {
        this.emitAccum -= 1;
        const idx = this.particleHead;
        this.particleHead = (this.particleHead + 1) % this.maxParticles;
        if (this.particleAge[idx] >= this.particleMaxLife[idx]) {
          this.activeParticleCount++;
        }
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
        this.trailPoints.visible = true;
      }
    }

    // Advance active particles only when at least one slot is live
    if (this.activeParticleCount > 0) {
      let stillActive = 0;
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
            stillActive++;
          }
        }
      }
      this.activeParticleCount = stillActive;
      this.trailPoints.visible = stillActive > 0;
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

      if (this.currentState === 'idle' && !isSwingingNow && !this.wasSwingingWeapon) {
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
        this.mixer.update(dt + this.idleMixerAccum);
        this.idleMixerAccum = 0;
      }

      // Layer procedural right-arm & upper-torso sword swing onto the skeletal bones
      if (swingProgress >= 0) {
        let armPitch = 0;
        let armYaw = 0;
        let foreArmPitch = 0;
        let spineYaw = 0;
        if (swingProgress < 0.28) {
          const w = swingProgress / 0.28;
          armPitch = THREE.MathUtils.lerp(0, -0.75, w);
          armYaw = THREE.MathUtils.lerp(0, -0.35, w);
          foreArmPitch = THREE.MathUtils.lerp(0, -0.55, w);
          spineYaw = THREE.MathUtils.lerp(0, -0.22, w);
        } else if (swingProgress < 0.72) {
          const s = (swingProgress - 0.28) / 0.44;
          armPitch = THREE.MathUtils.lerp(-0.75, 0.85, s);
          armYaw = THREE.MathUtils.lerp(-0.35, 0.48, s);
          foreArmPitch = THREE.MathUtils.lerp(-0.55, 0.35, s);
          spineYaw = THREE.MathUtils.lerp(-0.22, 0.28, s);
        } else {
          const r = (swingProgress - 0.72) / 0.28;
          armPitch = THREE.MathUtils.lerp(0.85, 0, r);
          armYaw = THREE.MathUtils.lerp(0.48, 0, r);
          foreArmPitch = THREE.MathUtils.lerp(0.35, 0, r);
          spineYaw = THREE.MathUtils.lerp(0.28, 0, r);
        }

        if (this.spine1Bone) {
          this.tempSwingEuler.set(Math.abs(spineYaw) * 0.35, spineYaw, 0);
          this.tempSwingQuat.setFromEuler(this.tempSwingEuler);
          this.spine1Bone.quaternion.multiply(this.tempSwingQuat);
        }
        if (this.rightArmBone) {
          this.tempSwingEuler.set(armPitch, armYaw, 0);
          this.tempSwingQuat.setFromEuler(this.tempSwingEuler);
          this.rightArmBone.quaternion.multiply(this.tempSwingQuat);
        }
        if (this.rightForeArmBone) {
          this.tempSwingEuler.set(foreArmPitch, 0, 0);
          this.tempSwingQuat.setFromEuler(this.tempSwingEuler);
          this.rightForeArmBone.quaternion.multiply(this.tempSwingQuat);
        }
      }
      this.wasSwingingWeapon = isSwingingNow;
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

