/* =========================================================================
   BeamDrive Mobile — cameras
   Chase, bonnet, cockpit, bumper, orbit and free-fly, plus the shake rig:
   speed hum, surface rumble, engine vibration and impact kicks, each with
   its own decay so a big hit reads differently from a rough road.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M, V = M.v3, Mat = M.m4;

  var MODES = ['chase', 'chaseFar', 'bonnet', 'cockpit', 'bumper', 'orbit'];
  var MODE_LABELS = {
    chase: 'Chase', chaseFar: 'Chase Far', bonnet: 'Bonnet',
    cockpit: 'Cockpit', bumper: 'Bumper', orbit: 'Orbit', free: 'Free'
  };

  function Camera(opts) {
    opts = opts || {};
    this.position = new Float32Array([0, 3, -8]);
    this.target = new Float32Array([0, 1, 0]);
    this.up = new Float32Array([0, 1, 0]);
    this.right = new Float32Array([1, 0, 0]);
    this.forward = new Float32Array([0, 0, 1]);
    this.viewMatrix = Mat.create();
    this.projMatrix = Mat.create();
    this.fov = 62 * M.DEG;
    this.baseFov = 62 * M.DEG;
    this.near = 0.10;
    this.far = 1400;
    this.aspect = 1.6;

    this.mode = 'chase';
    this.roll = 0;
    this.shakeIntensity = 1.0;
    this.fovSpeedGain = 1.0;

    // Smoothed state.
    this._pos = new Float32Array([0, 3, -8]);
    this._look = new Float32Array([0, 1, 0]);
    this._vel = new Float32Array(3);
    this._roll = 0;
    this._fov = this.baseFov;

    // Shake accumulators.
    this.shakeImpact = 0;
    this.shakeRough = 0;
    this.shakeTime = 0;
    this._shakeOff = new Float32Array(3);
    this._shakeRot = new Float32Array(3);

    // Orbit / free.
    this.orbitYaw = 2.4;
    this.orbitPitch = 0.28;
    this.orbitDist = 9;
    this.freePos = new Float32Array([0, 10, 0]);
    this.freeYaw = 0;
    this.freePitch = -0.2;

    this._tmp = new Float32Array(3);
    this._tmp2 = new Float32Array(3);
    this._m = Mat.create();
    // Off-centre projection, in NDC. Used by the garage to slide the car
    // out from behind the stats panel without moving the camera itself.
    this.lensShift = [0, 0];
  }

  Camera.MODES = MODES;
  Camera.LABELS = MODE_LABELS;

  Camera.prototype.setAspect = function (a) { this.aspect = a; };

  Camera.prototype.cycleMode = function (dir) {
    var i = MODES.indexOf(this.mode);
    if (i < 0) i = 0;
    i = (i + (dir || 1) + MODES.length) % MODES.length;
    this.mode = MODES[i];
    return this.mode;
  };

  /* ctx: { vehicle, drivetrain, terrain, world, dt, input, settings } */
  Camera.prototype.update = function (ctx) {
    var dt = Math.min(ctx.dt, 0.06);
    this.shakeTime += dt;
    var veh = ctx.vehicle;
    var body = veh ? veh.body : null;
    var dtr = ctx.drivetrain;

    if (this.mode === 'free' || !body) {
      this.updateFree(ctx, dt);
    } else if (this.mode === 'orbit') {
      this.updateOrbit(ctx, dt);
    } else {
      this.updateFollow(ctx, dt);
    }

    // ---------------------------------------------------------- shake ----
    var speed = dtr ? dtr.speed : 0;
    var rough = 0;
    if (dtr) {
      for (var i = 0; i < dtr.wheels.length; i++) {
        var w = dtr.wheels[i];
        if (!w.contact) continue;
        var surfaceBump = (w.surface === B.SURF.ROAD) ? 0.12 : 0.55;
        rough += surfaceBump * Math.min(w.compression, 1.2) * 0.25;
        rough += w.skid * 0.18;
      }
    }
    this.shakeRough = M.damp(this.shakeRough, rough * Math.min(speed / 22, 1.3), 9, dt);
    this.shakeImpact *= Math.exp(-dt * 7.5);

    var rpmVib = dtr ? (dtr.rpm / dtr.spec.engine.redline) * (0.35 + dtr.engineLoad * 0.65) : 0;
    var t = this.shakeTime;
    var n = B.noise;
    var amp = (this.shakeRough * 0.055 + this.shakeImpact * 0.34) * this.shakeIntensity;
    var vib = rpmVib * 0.0042 * this.shakeIntensity * (this.mode === 'cockpit' ? 1.5 : 0.7);

    this._shakeOff[0] = n.n3(t * 14.0, 0.0, 0.0) * amp + Math.sin(t * 78) * vib;
    this._shakeOff[1] = n.n3(0.0, t * 16.5, 0.0) * amp * 1.25 + Math.sin(t * 91 + 1.7) * vib;
    this._shakeOff[2] = n.n3(0.0, 0.0, t * 13.0) * amp * 0.65;
    this._shakeRot[0] = n.n3(t * 11.0, 5.0, 0.0) * amp * 0.30;
    this._shakeRot[1] = n.n3(5.0, t * 12.0, 0.0) * amp * 0.30;
    this._shakeRot[2] = n.n3(0.0, 5.0, t * 10.0) * amp * 0.55;

    // ---------------------------------------------------------- FOV ------
    var speedFov = Math.min(speed / 62, 1.25) * 13 * M.DEG * this.fovSpeedGain;
    var targetFov = this.baseFov + speedFov;
    this._fov = M.damp(this._fov, targetFov, 3.2, dt);
    this.fov = this._fov;

    this.buildMatrices();
  };

  Camera.prototype.updateFollow = function (ctx, dt) {
    var veh = ctx.vehicle, body = veh.body, dtr = ctx.drivetrain;
    var frame = body.frame;
    var rig = veh.rig;

    var fx = frame[8], fy = frame[9], fz = frame[10];     // body forward
    var ux = frame[4], uy = frame[5], uz = frame[6];      // body up
    var rx = frame[0], ry = frame[1], rz = frame[2];      // body right
    var cx = frame[12], cy = frame[13], cz = frame[14];

    var speed = dtr ? dtr.speed : 0;
    var upright = body.getUprightness();
    var local = null, lookLocal = null;
    var stiff = 7.0, lookStiff = 9.0;
    var useBodyUp = false;

    var len = veh.spec.length;
    switch (this.mode) {
      case 'chase':
        local = [0, 0.62 * veh.spec.height + 0.42, -len * 0.92 - 1.35];
        lookLocal = [0, 0.42 * veh.spec.height + 0.20, 2.2];
        stiff = 6.5; lookStiff = 10;
        break;
      case 'chaseFar':
        local = [0, 0.95 * veh.spec.height + 1.55, -len * 1.55 - 2.6];
        lookLocal = [0, 0.40 * veh.spec.height, 3.0];
        stiff = 4.4; lookStiff = 8;
        break;
      case 'bonnet':
        local = [rig.wheelPos[0] * 0.30, veh.spec.height * 0.62,
                 veh.spec.length * 0.20];
        lookLocal = [0, veh.spec.height * 0.55, 14];
        stiff = 40; lookStiff = 26; useBodyUp = true;
        break;
      case 'cockpit':
        local = [rig.eyePos[0], rig.eyePos[1] + 0.045, rig.eyePos[2] + 0.02];
        lookLocal = [rig.eyePos[0], rig.eyePos[1], rig.eyePos[2] + 14];
        stiff = 60; lookStiff = 34; useBodyUp = true;
        break;
      case 'bumper':
        local = [0, veh.spec.height * 0.24, veh.spec.length * 0.46];
        lookLocal = [0, veh.spec.height * 0.24, 16];
        stiff = 48; lookStiff = 30; useBodyUp = true;
        break;
    }

    // Body-local -> world.
    var wx = cx + rx * local[0] + ux * local[1] + fx * local[2];
    var wy = cy + ry * local[0] + uy * local[1] + fy * local[2];
    var wz = cz + rz * local[0] + uz * local[1] + fz * local[2];
    var lx = cx + rx * lookLocal[0] + ux * lookLocal[1] + fx * lookLocal[2];
    var ly = cy + ry * lookLocal[0] + uy * lookLocal[1] + fy * lookLocal[2];
    var lz = cz + rz * lookLocal[0] + uz * lookLocal[1] + fz * lookLocal[2];

    // Chase cameras lag and aim a little ahead of where the car is going.
    if (this.mode === 'chase' || this.mode === 'chaseFar') {
      var vlen = Math.max(speed, 0.001);
      var la = Math.min(speed / 30, 1) * 4.5;
      lx += body.velocity[0] / vlen * la;
      ly += body.velocity[1] / vlen * la * 0.3;
      lz += body.velocity[2] / vlen * la;
      // When the car flips, keep the camera the right way up.
      if (upright < 0.2) {
        wy = Math.max(wy, cy + 1.2);
      }
    }

    // Free-look drag on the chase cameras.
    if (ctx.lookYaw || ctx.lookPitch) {
      var ly2 = ctx.lookYaw || 0, lp = ctx.lookPitch || 0;
      var offX = Math.sin(ly2) * Math.cos(lp);
      var offY = Math.sin(lp);
      var offZ = Math.cos(ly2) * Math.cos(lp);
      if (this.mode === 'chase' || this.mode === 'chaseFar') {
        var dist = Math.hypot(local[0], local[2]);
        wx = cx + (rx * offX + ux * (local[1] / dist + offY) + fx * -offZ) * dist;
        wy = cy + (ry * offX + uy * (local[1] / dist + offY) + fy * -offZ) * dist;
        wz = cz + (rz * offX + uz * (local[1] / dist + offY) + fz * -offZ) * dist;
      } else {
        lx = cx + (rx * offX + ux * offY + fx * offZ) * 16 + rx * lookLocal[0] + ux * lookLocal[1];
        ly = cy + (ry * offX + uy * offY + fy * offZ) * 16 + ry * lookLocal[0] + uy * lookLocal[1];
        lz = cz + (rz * offX + uz * offY + fz * offZ) * 16 + rz * lookLocal[0] + uz * lookLocal[1];
      }
    }

    // Smooth toward the target rig position.
    this._pos[0] = M.damp(this._pos[0], wx, stiff, dt);
    this._pos[1] = M.damp(this._pos[1], wy, stiff, dt);
    this._pos[2] = M.damp(this._pos[2], wz, stiff, dt);
    this._look[0] = M.damp(this._look[0], lx, lookStiff, dt);
    this._look[1] = M.damp(this._look[1], ly, lookStiff, dt);
    this._look[2] = M.damp(this._look[2], lz, lookStiff, dt);

    // Keep the camera out of the ground.
    if (ctx.terrain) {
      var minY = ctx.terrain.height(this._pos[0], this._pos[2]) + 0.45;
      if (this._pos[1] < minY) this._pos[1] = minY;
    }

    // Roll: follow the body for in-car views, a hint of lateral G outside.
    var targetRoll;
    if (useBodyUp) {
      targetRoll = Math.atan2(frame[1], frame[5]);
      this._roll = M.angleLerp(this._roll, targetRoll, 1 - Math.exp(-24 * dt));
    } else {
      var latG = ctx.lateralG || 0;
      targetRoll = M.clamp(-latG * 0.016, -0.09, 0.09);
      this._roll = M.damp(this._roll, targetRoll, 4.5, dt);
    }
    this.roll = this._roll;

    this.position.set(this._pos);
    this.target.set(this._look);
  };

  Camera.prototype.updateOrbit = function (ctx, dt) {
    var body = ctx.vehicle.body;
    if (ctx.orbitDelta) {
      this.orbitYaw -= ctx.orbitDelta[0];
      this.orbitPitch = M.clamp(this.orbitPitch + ctx.orbitDelta[1], -0.35, 1.30);
    }
    if (ctx.orbitZoom) {
      this.orbitDist = M.clamp(this.orbitDist * (1 + ctx.orbitZoom), 3.2, 46);
    }
    var cy = Math.cos(this.orbitPitch), sy = Math.sin(this.orbitPitch);
    var tx = body.center[0] + Math.sin(this.orbitYaw) * cy * this.orbitDist;
    var ty = body.center[1] + sy * this.orbitDist + 0.7;
    var tz = body.center[2] + Math.cos(this.orbitYaw) * cy * this.orbitDist;
    this._pos[0] = M.damp(this._pos[0], tx, 14, dt);
    this._pos[1] = M.damp(this._pos[1], ty, 14, dt);
    this._pos[2] = M.damp(this._pos[2], tz, 14, dt);
    if (ctx.terrain) {
      var minY = ctx.terrain.height(this._pos[0], this._pos[2]) + 0.5;
      if (this._pos[1] < minY) this._pos[1] = minY;
    }
    this._look[0] = M.damp(this._look[0], body.center[0], 16, dt);
    this._look[1] = M.damp(this._look[1], body.center[1] + 0.35, 16, dt);
    this._look[2] = M.damp(this._look[2], body.center[2], 16, dt);
    this._roll = M.damp(this._roll, 0, 8, dt);
    this.roll = this._roll;
    this.position.set(this._pos);
    this.target.set(this._look);
  };

  Camera.prototype.updateFree = function (ctx, dt) {
    var mv = ctx.freeMove || [0, 0, 0];
    if (ctx.freeLook) {
      this.freeYaw -= ctx.freeLook[0];
      this.freePitch = M.clamp(this.freePitch + ctx.freeLook[1], -1.5, 1.5);
    }
    var cy = Math.cos(this.freeYaw), sy = Math.sin(this.freeYaw);
    var cp = Math.cos(this.freePitch), sp = Math.sin(this.freePitch);
    var fx = sy * cp, fy = sp, fz = cy * cp;
    var rx = cy, rz = -sy;
    var sp2 = (ctx.freeBoost ? 46 : 15) * dt;
    this.freePos[0] += (fx * mv[2] + rx * mv[0]) * sp2;
    this.freePos[1] += (fy * mv[2] + mv[1]) * sp2;
    this.freePos[2] += (fz * mv[2] + rz * mv[0]) * sp2;
    this.position.set(this.freePos);
    this.target[0] = this.freePos[0] + fx;
    this.target[1] = this.freePos[1] + fy;
    this.target[2] = this.freePos[2] + fz;
    this.roll = 0;
    this._roll = 0;
  };

  Camera.prototype.addImpact = function (magnitude) {
    this.shakeImpact = Math.min(this.shakeImpact + magnitude, 2.4);
  };

  var _eye = new Float32Array(3), _tgt = new Float32Array(3), _up = new Float32Array(3);
  Camera.prototype.buildMatrices = function () {
    // Base orientation, then roll and shake applied in camera space.
    _eye.set(this.position);
    _tgt.set(this.target);
    _up[0] = 0; _up[1] = 1; _up[2] = 0;
    Mat.lookAt(this.viewMatrix, _eye, _tgt, _up);

    // Extract the camera basis from the (row-major inverse) view matrix.
    var v = this.viewMatrix;
    this.right[0] = v[0]; this.right[1] = v[4]; this.right[2] = v[8];
    this.up[0] = v[1]; this.up[1] = v[5]; this.up[2] = v[9];
    this.forward[0] = -v[2]; this.forward[1] = -v[6]; this.forward[2] = -v[10];

    // Shake: translate in camera space, then roll + small rotational noise.
    var sh = this._shakeOff, sr = this._shakeRot;
    var ox = this.right[0] * sh[0] + this.up[0] * sh[1] + this.forward[0] * sh[2];
    var oy = this.right[1] * sh[0] + this.up[1] * sh[1] + this.forward[1] * sh[2];
    var oz = this.right[2] * sh[0] + this.up[2] * sh[1] + this.forward[2] * sh[2];
    _eye[0] += ox; _eye[1] += oy; _eye[2] += oz;
    _tgt[0] += ox + this.right[0] * sr[1] * 6 + this.up[0] * sr[0] * 6;
    _tgt[1] += oy + this.right[1] * sr[1] * 6 + this.up[1] * sr[0] * 6;
    _tgt[2] += oz + this.right[2] * sr[1] * 6 + this.up[2] * sr[0] * 6;

    var totalRoll = this.roll + sr[2];
    var cr = Math.cos(totalRoll), sr2 = Math.sin(totalRoll);
    _up[0] = this.right[0] * -sr2 + this.up[0] * cr;
    _up[1] = this.right[1] * -sr2 + this.up[1] * cr;
    _up[2] = this.right[2] * -sr2 + this.up[2] * cr;

    Mat.lookAt(this.viewMatrix, _eye, _tgt, _up);
    this.position.set(_eye);
    var v2 = this.viewMatrix;
    this.right[0] = v2[0]; this.right[1] = v2[4]; this.right[2] = v2[8];
    this.up[0] = v2[1]; this.up[1] = v2[5]; this.up[2] = v2[9];
    this.forward[0] = -v2[2]; this.forward[1] = -v2[6]; this.forward[2] = -v2[10];

    Mat.perspective(this.projMatrix, this.fov, this.aspect, this.near, this.far);
    if (this.lensShift[0] !== 0 || this.lensShift[1] !== 0) {
      this.projMatrix[8] += this.lensShift[0];
      this.projMatrix[9] += this.lensShift[1];
    }
  };

  // Snap straight to the rig position — used after a respawn.
  Camera.prototype.snap = function (ctx) {
    for (var i = 0; i < 40; i++) {
      ctx.dt = 1 / 30;
      this.update(ctx);
    }
  };

  B.Camera = Camera;

})();
