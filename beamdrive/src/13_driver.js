/* =========================================================================
   BeamDrive Mobile — the driver
   A 39-bone rig, CPU-skinned in one draw call. Arms and legs are solved
   with two-bone IK against the steering wheel rim and the pedal faces; the
   hands genuinely shuffle around the rim past about 100 degrees of lock,
   releasing and re-gripping the way a person does.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M, V = M.v3, Mat = M.m4, Geo = B.Geo;

  /* ----------------------------------------------------------- rig setup */
  // Bones point along their local +Y toward the child joint.
  function Bone(name, parent, offset, len) {
    this.name = name;
    this.parent = parent;          // index, -1 for root
    this.offset = offset;          // position in parent space
    this.len = len || 0;
    this.rot = [0, 0, 0];          // local Euler XYZ, animated
    this.world = Mat.create();
    this.bindInv = Mat.create();
    this.override = false;         // set by the IK solvers
  }

  var SKIN = [0.76, 0.58, 0.46];
  var SKIN_DARK = [0.66, 0.49, 0.38];
  var SUIT = [0.15, 0.17, 0.22];
  var SUIT2 = [0.11, 0.12, 0.16];
  var GLOVE = [0.09, 0.09, 0.11];
  var HAIR = [0.14, 0.11, 0.09];
  var SHOE = [0.08, 0.08, 0.09];

  function Driver(scale) {
    scale = scale || 1;
    this.scale = scale;
    this.bones = [];
    this.byName = {};

    var s = scale;
    // Proportions for a ~1.78 m adult, seated.
    var d = {
      hipW: 0.17 * s, spineLen: 0.17 * s, chestLen: 0.19 * s,
      neckLen: 0.075 * s, headLen: 0.135 * s,
      clavW: 0.155 * s, upperArm: 0.285 * s, foreArm: 0.255 * s, hand: 0.095 * s,
      thigh: 0.42 * s, shin: 0.40 * s, foot: 0.13 * s
    };
    this.dims = d;

    var self = this;
    function add(name, parent, offset, len) {
      var b = new Bone(name, parent === null ? -1 : self.byName[parent], offset, len);
      self.byName[name] = self.bones.length;
      self.bones.push(b);
      return self.bones.length - 1;
    }

    add('hips', null, [0, 0, 0], d.spineLen);
    add('spine', 'hips', [0, d.spineLen * 0.35, 0], d.spineLen);
    add('chest', 'spine', [0, d.spineLen, 0], d.chestLen);
    add('neck', 'chest', [0, d.chestLen, 0], d.neckLen);
    add('head', 'neck', [0, d.neckLen, 0], d.headLen);

    ['L', 'R'].forEach(function (side) {
      var sx = side === 'L' ? -1 : 1;
      add('clav' + side, 'chest', [sx * 0.045 * s, d.chestLen * 0.86, 0], d.clavW);
      add('upperArm' + side, 'clav' + side, [sx * d.clavW, 0, 0], d.upperArm);
      add('foreArm' + side, 'upperArm' + side, [0, d.upperArm, 0], d.foreArm);
      add('hand' + side, 'foreArm' + side, [0, d.foreArm, 0], d.hand);
      // Four fingers plus a thumb, two segments each.
      for (var f = 0; f < 4; f++) {
        var fx = (f - 1.5) * 0.021 * s;
        add('f' + side + f + 'a', 'hand' + side, [fx, d.hand * 0.92, 0.004 * s], 0.040 * s);
        add('f' + side + f + 'b', 'f' + side + f + 'a', [0, 0.040 * s, 0], 0.033 * s);
      }
      add('th' + side + 'a', 'hand' + side, [sx * 0.032 * s, d.hand * 0.42, 0.018 * s], 0.038 * s);
      add('th' + side + 'b', 'th' + side + 'a', [0, 0.038 * s, 0], 0.030 * s);
    });

    ['L', 'R'].forEach(function (side) {
      var sx = side === 'L' ? -1 : 1;
      add('thigh' + side, 'hips', [sx * d.hipW * 0.55, -0.02 * s, 0], d.thigh);
      add('shin' + side, 'thigh' + side, [0, d.thigh, 0], d.shin);
      add('foot' + side, 'shin' + side, [0, d.shin, 0], d.foot);
    });

    this.root = Mat.create();
    this._tmp = Mat.create();
    this._tmp2 = Mat.create();

    this.buildMesh();
    this.computeBindPose();

    /* ---------------------------------------------------- animation state */
    this.hands = [
      { side: -1, gripAngle: Math.PI, state: 'grip', moveT: 0, fromAngle: 0, toAngle: 0, curl: 1, lift: 0 },
      { side: 1, gripAngle: 0, state: 'grip', moveT: 0, fromAngle: 0, toAngle: 0, curl: 1, lift: 0 }
    ];
    this.breath = 0;
    this.lean = [0, 0];          // lateral, longitudinal
    this.headYaw = 0;
    this.headPitch = 0;
    this.jolt = [0, 0, 0];
    this.joltVel = [0, 0, 0];
    this.shiftTimer = 0;
    this.shiftHand = 1;
    this.visible = true;
    this.hideHead = false;
  }

  /* ------------------------------------------------------------- the mesh */

  Driver.prototype.buildMesh = function () {
    var mb = new Geo.MeshBuilder();
    var boneIds = [];
    var d = this.dims, s = this.scale;
    var self = this;

    // Append a part in a bone's local space and tag every vertex with it.
    function part(boneName, mesh, xform) {
      var bi = self.byName[boneName];
      var before = mb.vertexCount();
      mb.append(mesh, xform || null);
      var after = mb.vertexCount();
      for (var i = before; i < after; i++) boneIds.push(bi);
    }
    function at(x, y, z, rx) {
      var m = Mat.create();
      if (rx) Mat.rotX(m, rx);
      m[12] = x; m[13] = y; m[14] = z;
      return m;
    }

    // Torso.
    part('hips', Geo.ellipsoid(d.hipW * 1.05, 0.11 * s, 0.135 * s, 12, 8, SUIT2), at(0, 0.03 * s, 0));
    part('spine', Geo.taperedBox(0.30 * s, 0.185 * s, 0.335 * s, 0.20 * s, d.spineLen, SUIT),
      at(0, d.spineLen * 0.5, 0));
    part('chest', Geo.taperedBox(0.345 * s, 0.205 * s, 0.315 * s, 0.185 * s, d.chestLen, SUIT),
      at(0, d.chestLen * 0.5, 0));
    // Shoulder caps.
    part('chest', Geo.ellipsoid(0.075 * s, 0.070 * s, 0.075 * s, 10, 7, SUIT),
      at(-0.155 * s, d.chestLen * 0.84, 0));
    part('chest', Geo.ellipsoid(0.075 * s, 0.070 * s, 0.075 * s, 10, 7, SUIT),
      at(0.155 * s, d.chestLen * 0.84, 0));
    part('neck', Geo.cylinder(0.046 * s, 0.052 * s, d.neckLen * 1.3, 9, SKIN_DARK, false),
      at(0, d.neckLen * 0.45, 0));

    // Head: skull, jaw, ears, hair, eyes.
    part('head', Geo.ellipsoid(0.083 * s, 0.100 * s, 0.093 * s, 14, 10, SKIN), at(0, 0.085 * s, 0));
    part('head', Geo.ellipsoid(0.066 * s, 0.056 * s, 0.070 * s, 10, 8, SKIN), at(0, 0.040 * s, 0.018 * s));
    part('head', Geo.ellipsoid(0.088 * s, 0.075 * s, 0.085 * s, 12, 8, HAIR), at(0, 0.108 * s, -0.008 * s));
    part('head', Geo.ellipsoid(0.014 * s, 0.024 * s, 0.010 * s, 6, 5, SKIN_DARK), at(-0.082 * s, 0.082 * s, 0));
    part('head', Geo.ellipsoid(0.014 * s, 0.024 * s, 0.010 * s, 6, 5, SKIN_DARK), at(0.082 * s, 0.082 * s, 0));
    part('head', Geo.sphere(0.0125 * s, 8, 6, [0.94, 0.94, 0.95]), at(-0.030 * s, 0.092 * s, 0.078 * s));
    part('head', Geo.sphere(0.0125 * s, 8, 6, [0.94, 0.94, 0.95]), at(0.030 * s, 0.092 * s, 0.078 * s));
    part('head', Geo.sphere(0.0062 * s, 6, 5, [0.09, 0.07, 0.06]), at(-0.030 * s, 0.092 * s, 0.087 * s));
    part('head', Geo.sphere(0.0062 * s, 6, 5, [0.09, 0.07, 0.06]), at(0.030 * s, 0.092 * s, 0.087 * s));
    part('head', Geo.ellipsoid(0.017 * s, 0.013 * s, 0.020 * s, 7, 5, SKIN), at(0, 0.070 * s, 0.084 * s));

    ['L', 'R'].forEach(function (side) {
      var sx = side === 'L' ? -1 : 1;
      part('upperArm' + side,
        Geo.taperedBox(0.088 * s, 0.088 * s, 0.072 * s, 0.072 * s, d.upperArm, SUIT),
        at(0, d.upperArm * 0.5, 0));
      part('upperArm' + side, Geo.ellipsoid(0.040 * s, 0.040 * s, 0.040 * s, 8, 6, SUIT),
        at(0, d.upperArm, 0));
      part('foreArm' + side,
        Geo.taperedBox(0.070 * s, 0.070 * s, 0.056 * s, 0.056 * s, d.foreArm, SUIT),
        at(0, d.foreArm * 0.5, 0));
      part('foreArm' + side, Geo.ellipsoid(0.030 * s, 0.030 * s, 0.030 * s, 8, 6, GLOVE),
        at(0, d.foreArm, 0));
      // Palm.
      part('hand' + side, Geo.roundedBox(0.075 * s, 0.092 * s, 0.032 * s, 0.012 * s, GLOVE, 2),
        at(0, d.hand * 0.50, 0));
      for (var f = 0; f < 4; f++) {
        part('f' + side + f + 'a', Geo.roundedBox(0.018 * s, 0.042 * s, 0.019 * s, 0.007 * s, GLOVE, 2),
          at(0, 0.020 * s, 0));
        part('f' + side + f + 'b', Geo.roundedBox(0.016 * s, 0.035 * s, 0.017 * s, 0.007 * s, GLOVE, 2),
          at(0, 0.017 * s, 0));
      }
      part('th' + side + 'a', Geo.roundedBox(0.021 * s, 0.040 * s, 0.021 * s, 0.008 * s, GLOVE, 2),
        at(0, 0.019 * s, 0));
      part('th' + side + 'b', Geo.roundedBox(0.019 * s, 0.032 * s, 0.019 * s, 0.008 * s, GLOVE, 2),
        at(0, 0.016 * s, 0));

      part('thigh' + side,
        Geo.taperedBox(0.130 * s, 0.140 * s, 0.105 * s, 0.112 * s, d.thigh, SUIT2),
        at(0, d.thigh * 0.5, 0));
      part('thigh' + side, Geo.ellipsoid(0.056 * s, 0.056 * s, 0.056 * s, 8, 6, SUIT2),
        at(0, d.thigh, 0));
      part('shin' + side,
        Geo.taperedBox(0.098 * s, 0.100 * s, 0.070 * s, 0.072 * s, d.shin, SUIT2),
        at(0, d.shin * 0.5, 0));
      part('foot' + side, Geo.roundedBox(0.090 * s, 0.062 * s, 0.245 * s, 0.020 * s, SHOE, 2),
        at(0, 0.028 * s, 0.062 * s));
    });

    mb.computeNormals();
    var data = mb.toData();

    this.restPos = data.position;
    this.positions = new Float32Array(data.position);
    this.restNrm = data.normal;
    this.normals = new Float32Array(data.normal);
    this.boneOf = new Int32Array(boneIds);
    this.indices = data.indices;
    this.vertexCount = data.position.length / 3;

    this.geometry = new B.GL.Geometry({ dynamic: true });
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('normal', this.normals);
    this.geometry.setAttribute('uv', data.uv);
    this.geometry.setAttribute('color', data.color);
    this.geometry.setIndices(this.indices);
    this.geometry.computeBounds();
  };

  /* Bind pose: the rest mesh is authored in each bone's local space, so the
     inverse bind is simply the inverse of the bone's rest world matrix. */
  Driver.prototype.computeBindPose = function () {
    this.resetPose();
    this.updateFK(true);
    for (var i = 0; i < this.bones.length; i++) {
      Mat.invertRigid(this.bones[i].bindInv, this.bones[i].world);
    }
  };

  Driver.prototype.resetPose = function () {
    for (var i = 0; i < this.bones.length; i++) {
      this.bones[i].rot[0] = 0; this.bones[i].rot[1] = 0; this.bones[i].rot[2] = 0;
      this.bones[i].override = false;
    }
  };

  var _localM = Mat.create(), _rotM = Mat.create();
  Driver.prototype.updateFK = function (identityRoot) {
    for (var i = 0; i < this.bones.length; i++) {
      var b = this.bones[i];
      if (b.override) continue;
      Mat.fromEulerYXZ(_rotM, b.rot[1], b.rot[0], b.rot[2]);
      Mat.copy(_localM, _rotM);
      _localM[12] = b.offset[0]; _localM[13] = b.offset[1]; _localM[14] = b.offset[2];
      if (b.parent < 0) {
        if (identityRoot) Mat.copy(b.world, _localM);
        else Mat.mul(b.world, this.root, _localM);
      } else {
        Mat.mul(b.world, this.bones[b.parent].world, _localM);
      }
    }
  };

  // FK for one bone only (used after IK writes a parent's world matrix).
  Driver.prototype.updateBone = function (i) {
    var b = this.bones[i];
    if (b.override) return;
    Mat.fromEulerYXZ(_rotM, b.rot[1], b.rot[0], b.rot[2]);
    Mat.copy(_localM, _rotM);
    _localM[12] = b.offset[0]; _localM[13] = b.offset[1]; _localM[14] = b.offset[2];
    if (b.parent < 0) Mat.mul(b.world, this.root, _localM);
    else Mat.mul(b.world, this.bones[b.parent].world, _localM);
  };

  /* ------------------------------------------------------ two-bone IK ---- */
  var _S = new Float32Array(3), _T = new Float32Array(3), _dir = new Float32Array(3);
  var _pole = new Float32Array(3), _xA = new Float32Array(3), _yA = new Float32Array(3),
      _zA = new Float32Array(3), _E = new Float32Array(3), _tmpv = new Float32Array(3);

  // Solves a chain root -> mid -> end so the end lands on `target`.
  // `pole` biases which way the joint bends.
  Driver.prototype.solveIK = function (rootIdx, midIdx, endIdx, target, pole, endTwist) {
    var bones = this.bones;
    var root = bones[rootIdx], mid = bones[midIdx], end = bones[endIdx];
    var L1 = root.len, L2 = mid.len;

    // The root joint's world position comes from its parent chain.
    this.updateBone(rootIdx);
    _S[0] = root.world[12]; _S[1] = root.world[13]; _S[2] = root.world[14];
    _T.set(target);

    V.sub(_dir, _T, _S);
    var dist = V.len(_dir);
    var maxReach = (L1 + L2) * 0.995;
    if (dist > maxReach) { V.scale(_dir, _dir, maxReach / dist); dist = maxReach; V.add(_T, _S, _dir); }
    if (dist < 1e-4) { dist = 1e-4; _dir[0] = 0; _dir[1] = 1; _dir[2] = 0; }
    V.normalize(_dir, _dir);

    var cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
    cosA = M.clamp(cosA, -1, 1);
    var alpha = Math.acos(cosA);

    // Bend axis is perpendicular to the chain direction and the pole.
    _pole.set(pole);
    V.cross(_xA, _dir, _pole);
    if (V.len2(_xA) < 1e-8) {
      _tmpv[0] = 0; _tmpv[1] = 0; _tmpv[2] = 1;
      V.cross(_xA, _dir, _tmpv);
      if (V.len2(_xA) < 1e-8) { _xA[0] = 1; _xA[1] = 0; _xA[2] = 0; }
    }
    V.normalize(_xA, _xA);

    // Rotate the chain direction by alpha about the bend axis -> upper limb.
    var ca = Math.cos(alpha), sa = Math.sin(alpha);
    V.cross(_tmpv, _xA, _dir);
    _yA[0] = _dir[0] * ca + _tmpv[0] * sa;
    _yA[1] = _dir[1] * ca + _tmpv[1] * sa;
    _yA[2] = _dir[2] * ca + _tmpv[2] * sa;
    V.normalize(_yA, _yA);
    V.cross(_zA, _xA, _yA);
    V.normalize(_zA, _zA);

    Mat.fromBasis(root.world, _xA, _yA, _zA, _S);
    root.override = true;

    // Elbow / knee position, then aim the second bone at the target.
    _E[0] = _S[0] + _yA[0] * L1;
    _E[1] = _S[1] + _yA[1] * L1;
    _E[2] = _S[2] + _yA[2] * L1;
    V.sub(_tmpv, _T, _E);
    V.normalize(_tmpv, _tmpv);
    V.cross(_zA, _xA, _tmpv);
    V.normalize(_zA, _zA);
    Mat.fromBasis(mid.world, _xA, _tmpv, _zA, _E);
    mid.override = true;

    // End effector: sits at the target, oriented along the second bone with
    // an optional twist about its own axis.
    var ex = _xA, ey = _tmpv, ez = _zA;
    if (endTwist) {
      var ct = Math.cos(endTwist), stw = Math.sin(endTwist);
      var nx = ex[0] * ct + ez[0] * stw, ny = ex[1] * ct + ez[1] * stw, nz = ex[2] * ct + ez[2] * stw;
      var mx = -ex[0] * stw + ez[0] * ct, my = -ex[1] * stw + ez[1] * ct, mz = -ex[2] * stw + ez[2] * ct;
      _S[0] = nx; _S[1] = ny; _S[2] = nz;
      Mat.fromBasis(end.world, [nx, ny, nz], ey, [mx, my, mz], _T);
    } else {
      Mat.fromBasis(end.world, ex, ey, ez, _T);
    }
    end.override = true;
  };

  /* ------------------------------------------------------ the animation -- */

  var _wheelM = Mat.create(), _gripW = new Float32Array(3), _poleV = new Float32Array(3);
  var _tv = new Float32Array(3), _tv2 = new Float32Array(3);

  /*  ctx = {
        rig, steerAngle, throttle, brake, clutch, gearChanged, manual,
        lateralG, longitudinalG, speed, dt, impact
      }  */
  Driver.prototype.animate = function (ctx) {
    var dt = Math.min(ctx.dt, 0.05);
    var rig = ctx.rig;
    var s = this.scale;
    var b = this.byName;
    var bones = this.bones;
    var i;

    this.breath += dt * 1.15;

    // --- impact jolt: a spring the crash impulses kick ---------------------
    for (i = 0; i < 3; i++) {
      var k = 240, c = 19;
      var a = -k * this.jolt[i] - c * this.joltVel[i];
      this.joltVel[i] += a * dt;
      this.jolt[i] += this.joltVel[i] * dt;
    }
    if (ctx.impact > 0.01) {
      this.joltVel[0] += (Math.random() - 0.5) * ctx.impact * 3.2;
      this.joltVel[1] -= ctx.impact * 2.4;
      this.joltVel[2] += (Math.random() - 0.5) * ctx.impact * 2.0;
    }

    // --- G-force lean -------------------------------------------------------
    var latTarget = M.clamp(-ctx.lateralG * 0.085, -0.22, 0.22);
    var lonTarget = M.clamp(ctx.longitudinalG * 0.055, -0.16, 0.16);
    this.lean[0] = M.damp(this.lean[0], latTarget, 7, dt);
    this.lean[1] = M.damp(this.lean[1], lonTarget, 7, dt);

    this.resetPose();

    // --- seated base pose ---------------------------------------------------
    var breathe = Math.sin(this.breath) * 0.012;
    bones[b.hips].rot[0] = -0.16;
    bones[b.spine].rot[0] = 0.26 + this.lean[1] * 0.5 + breathe;
    bones[b.spine].rot[2] = this.lean[0] * 0.6;
    bones[b.chest].rot[0] = 0.10 + this.lean[1] * 0.4 + breathe * 0.6 + this.jolt[1] * 0.10;
    bones[b.chest].rot[2] = this.lean[0] * 0.5 + this.jolt[0] * 0.05;
    bones[b.chest].rot[1] = this.jolt[2] * 0.04;

    // --- head: look into the corner, settle back on the straights ----------
    var lookYaw = M.clamp(ctx.steerAngle * 0.30 - ctx.lateralG * 0.045, -0.75, 0.75);
    var lookPitch = M.clamp(-ctx.longitudinalG * 0.02, -0.12, 0.12);
    this.headYaw = M.damp(this.headYaw, lookYaw, 5.5, dt);
    this.headPitch = M.damp(this.headPitch, lookPitch, 6, dt);
    bones[b.neck].rot[0] = 0.10 + this.headPitch * 0.4;
    bones[b.neck].rot[1] = this.headYaw * 0.35;
    bones[b.head].rot[0] = -0.06 + this.headPitch * 0.6 + this.jolt[1] * 0.16;
    bones[b.head].rot[1] = this.headYaw * 0.65 + this.jolt[2] * 0.10;
    bones[b.head].rot[2] = -this.lean[0] * 0.45 + this.jolt[0] * 0.08;

    // Root transform: the rig sits at the hip anchor in car-local space.
    Mat.identity(this.root);
    this.root[12] = rig.hipPos[0] + this.jolt[0] * 0.012;
    this.root[13] = rig.hipPos[1] + this.jolt[1] * 0.012;
    this.root[14] = rig.hipPos[2] + this.jolt[2] * 0.012;

    this.updateFK(false);

    // --- steering wheel frame ----------------------------------------------
    // Local axes: +X across the rim, +Y up the rim, +Z out of the hub toward
    // the driver. Tilt lays the column back.
    var tilt = rig.wheelTilt;
    var ct = Math.cos(tilt), stl = Math.sin(tilt);
    Mat.identity(_wheelM);
    _wheelM[0] = 1; _wheelM[1] = 0; _wheelM[2] = 0;
    _wheelM[4] = 0; _wheelM[5] = ct; _wheelM[6] = -stl;
    _wheelM[8] = 0; _wheelM[9] = stl; _wheelM[10] = ct;
    _wheelM[12] = rig.wheelPos[0]; _wheelM[13] = rig.wheelPos[1]; _wheelM[14] = rig.wheelPos[2];
    this.wheelMatrix = _wheelM;

    var R = rig.wheelRadius;
    var steer = ctx.steerAngle;

    // --- hand shuffle state machine ----------------------------------------
    var shifting = ctx.manual && this.shiftTimer > 0;
    if (ctx.gearChanged && ctx.manual) {
      this.shiftTimer = 0.45;
      this.shiftHand = ctx.rhd ? 0 : 1;
    }
    if (this.shiftTimer > 0) this.shiftTimer -= dt;

    for (var h = 0; h < 2; h++) {
      var hand = this.hands[h];
      var base = h === 0 ? Math.PI * 0.86 : Math.PI * 0.14;   // ~10 and ~2 o'clock
      var worldAngle = hand.gripAngle + steer;
      if (hand.state === 'grip') {
        var err = M.wrapAngle(worldAngle - base);
        if (Math.abs(err) > 1.75) {
          hand.state = 'moving';
          hand.moveT = 0;
          hand.fromAngle = hand.gripAngle;
          hand.toAngle = base - steer + (err > 0 ? -1 : 1) * 0.0;
        }
      } else {
        hand.moveT += dt / 0.22;
        if (hand.moveT >= 1) {
          hand.moveT = 1;
          hand.state = 'grip';
          hand.gripAngle = hand.toAngle;
        } else {
          hand.gripAngle = hand.fromAngle + M.wrapAngle(hand.toAngle - hand.fromAngle) *
            M.smoothstep(0, 1, hand.moveT);
        }
      }
      var offWheel = (hand.state === 'moving') ? Math.sin(hand.moveT * Math.PI) : 0;
      // The shifting hand leaves the rim entirely.
      var shiftOff = (shifting && h === this.shiftHand)
        ? Math.sin(M.clamp(1 - this.shiftTimer / 0.45, 0, 1) * Math.PI) : 0;
      hand.lift = M.damp(hand.lift, Math.max(offWheel, shiftOff), 20, dt);
      hand.curl = M.damp(hand.curl, 1 - Math.max(offWheel, shiftOff) * 0.85, 16, dt);
      hand.shiftOff = shiftOff;
    }

    // --- arm IK -------------------------------------------------------------
    var sides = ['L', 'R'];
    for (h = 0; h < 2; h++) {
      var hd = this.hands[h];
      var side = sides[h];
      var ang = hd.gripAngle + steer;
      // Grip point on the rim, in wheel space, then into car space.
      _tv[0] = Math.cos(ang) * R;
      _tv[1] = Math.sin(ang) * R;
      _tv[2] = 0.035 * s + hd.lift * 0.14;
      V.xformM4(_gripW, _tv, _wheelM);

      // While shifting, the hand goes to the gear lever instead.
      if (hd.shiftOff > 0.01 && rig.shifterPos) {
        _tv2[0] = rig.shifterPos[0]; _tv2[1] = rig.shifterPos[1] + 0.03; _tv2[2] = rig.shifterPos[2];
        V.lerp(_gripW, _gripW, _tv2, hd.shiftOff);
      }

      // Pole vector: elbows drop down and out, never through the door card.
      var sx = h === 0 ? -1 : 1;
      _poleV[0] = sx * 0.85; _poleV[1] = -0.55; _poleV[2] = -0.4;
      V.normalize(_poleV, _poleV);

      // Wrist twist keeps the palm facing the rim.
      var twist = -ang - Math.PI * 0.5 + (h === 0 ? Math.PI : 0);
      this.solveIK(b['upperArm' + side], b['foreArm' + side], b['hand' + side],
        _gripW, _poleV, 0);

      // Orient the hand so the fingers wrap the rim: rebuild its basis from
      // the rim tangent rather than inheriting the forearm's roll.
      var hb = bones[b['hand' + side]];
      _tv[0] = -Math.sin(ang); _tv[1] = Math.cos(ang); _tv[2] = 0;
      V.xformDir(_tv, _tv, _wheelM);              // rim tangent, world
      V.normalize(_tv, _tv);
      _tv2[0] = Math.cos(ang); _tv2[1] = Math.sin(ang); _tv2[2] = 0;
      V.xformDir(_tv2, _tv2, _wheelM);            // rim outward normal
      V.normalize(_tv2, _tv2);
      if (hd.lift < 0.5) {
        var blend = 1 - hd.lift * 2;
        var ox = hb.world[0], oy = hb.world[1], oz = hb.world[2];
        var ux = hb.world[4], uy = hb.world[5], uz = hb.world[6];
        // Fingers curl around the tangent: bone +Y points along -outward.
        var yx = -_tv2[0] * sx, yy = -_tv2[1] * sx, yz = -_tv2[2] * sx;
        var nxx = M.lerp(ux, yx, blend), nyy = M.lerp(uy, yy, blend), nzz = M.lerp(uz, yz, blend);
        var axx = M.lerp(ox, _tv[0], blend), ayy = M.lerp(oy, _tv[1], blend), azz = M.lerp(oz, _tv[2], blend);
        _tv[0] = axx; _tv[1] = ayy; _tv[2] = azz;
        V.normalize(_tv, _tv);
        _tv2[0] = nxx; _tv2[1] = nyy; _tv2[2] = nzz;
        var dp = V.dot(_tv2, _tv);
        _tv2[0] -= _tv[0] * dp; _tv2[1] -= _tv[1] * dp; _tv2[2] -= _tv[2] * dp;
        V.normalize(_tv2, _tv2);
        var cz0 = new Float32Array(3);
        V.cross(cz0, _tv, _tv2);
        var hp = [hb.world[12], hb.world[13], hb.world[14]];
        Mat.fromBasis(hb.world, _tv, _tv2, cz0, hp);
      }

      // Finger curl.
      var curl = hd.curl;
      for (var f = 0; f < 4; f++) {
        var fa = bones[b['f' + side + f + 'a']];
        var fb = bones[b['f' + side + f + 'b']];
        fa.rot[0] = -0.35 - curl * 1.20 - Math.sin(this.breath * 1.3 + f) * 0.012;
        fb.rot[0] = -0.30 - curl * 1.45;
        this.updateBone(b['f' + side + f + 'a']);
        this.updateBone(b['f' + side + f + 'b']);
      }
      var ta = bones[b['th' + side + 'a']];
      var tb2 = bones[b['th' + side + 'b']];
      ta.rot[0] = -0.15 - curl * 0.55;
      ta.rot[2] = sx * (0.55 + curl * 0.35);
      tb2.rot[0] = -0.10 - curl * 0.70;
      this.updateBone(b['th' + side + 'a']);
      this.updateBone(b['th' + side + 'b']);
    }

    // --- leg IK -------------------------------------------------------------
    var pedal = rig.pedalPos;
    for (var lg = 0; lg < 2; lg++) {
      var lside = sides[lg];
      var isRight = (lg === 1);
      // Right foot works throttle and brake, left rests on the dead pedal.
      var travel = isRight ? (ctx.throttle * 0.045 - ctx.brake * 0.075)
                           : (-ctx.clutch * 0.085);
      var footX = pedal[0] + (isRight ? 0.085 : -0.095);
      _tv[0] = footX;
      _tv[1] = pedal[1] + 0.02 - travel * 0.35;
      _tv[2] = pedal[2] - 0.02 + travel;
      // Knees splay outward and up.
      _poleV[0] = (isRight ? 0.7 : -0.7); _poleV[1] = 0.85; _poleV[2] = 0.35;
      V.normalize(_poleV, _poleV);
      this.solveIK(b['thigh' + lside], b['shin' + lside], b['foot' + lside], _tv, _poleV, 0);
      // Ankle: point the toe into the pedal face.
      var fbn = bones[b['foot' + lside]];
      var ankle = -1.15 + travel * 2.2;
      var rx = Mat.create();
      Mat.rotX(rx, ankle);
      var fm = Mat.create();
      Mat.copy(fm, fbn.world);
      var fp = [fm[12], fm[13], fm[14]];
      fm[12] = 0; fm[13] = 0; fm[14] = 0;
      Mat.mul(fbn.world, fm, rx);
      fbn.world[12] = fp[0]; fbn.world[13] = fp[1]; fbn.world[14] = fp[2];
    }

    this.skin();
  };

  /* Linear blend skinning with one bone per vertex (segments are rigid and
     the joint caps overlap, which reads cleanly at driver scale). */
  Driver.prototype.skin = function () {
    var pos = this.positions, nrm = this.normals;
    var rp = this.restPos, rn = this.restNrm;
    var bo = this.boneOf;
    var bones = this.bones;
    var cache = this._skinCache || (this._skinCache = []);
    var i;
    for (i = 0; i < bones.length; i++) {
      var m = cache[i] || (cache[i] = Mat.create());
      Mat.mul(m, bones[i].world, bones[i].bindInv);
    }
    var hideHead = this.hideHead;
    var headBone = this.byName.head, neckBone = this.byName.neck;
    for (i = 0; i < this.vertexCount; i++) {
      var bi = bo[i];
      var m2 = cache[bi];
      var i3 = i * 3;
      var x = rp[i3], y = rp[i3 + 1], z = rp[i3 + 2];
      if (hideHead && (bi === headBone || bi === neckBone)) {
        // Collapse the head to a point when the camera is inside it.
        pos[i3] = m2[12]; pos[i3 + 1] = m2[13]; pos[i3 + 2] = m2[14];
        nrm[i3] = 0; nrm[i3 + 1] = 1; nrm[i3 + 2] = 0;
        continue;
      }
      pos[i3] = m2[0] * x + m2[4] * y + m2[8] * z + m2[12];
      pos[i3 + 1] = m2[1] * x + m2[5] * y + m2[9] * z + m2[13];
      pos[i3 + 2] = m2[2] * x + m2[6] * y + m2[10] * z + m2[14];
      var nx = rn[i3], ny = rn[i3 + 1], nz = rn[i3 + 2];
      nrm[i3] = m2[0] * nx + m2[4] * ny + m2[8] * nz;
      nrm[i3 + 1] = m2[1] * nx + m2[5] * ny + m2[9] * nz;
      nrm[i3 + 2] = m2[2] * nx + m2[6] * ny + m2[10] * nz;
    }
    this.geometry.updateAttribute('position', pos);
    this.geometry.updateAttribute('normal', nrm);
  };

  Driver.prototype.getEyePosition = function (out) {
    var hb = this.bones[this.byName.head];
    out[0] = hb.world[12] + hb.world[4] * 0.095 + hb.world[8] * 0.075;
    out[1] = hb.world[13] + hb.world[5] * 0.095 + hb.world[9] * 0.075;
    out[2] = hb.world[14] + hb.world[6] * 0.095 + hb.world[10] * 0.075;
    return out;
  };

  B.Driver = Driver;

})();
