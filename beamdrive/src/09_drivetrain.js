/* =========================================================================
   BeamDrive Mobile — drivetrain and tyres
   Engine inertia -> clutch -> gearbox -> final drive -> wheel inertia ->
   contact patch. Tyre forces use a combined-slip friction ellipse with a
   peak-and-falloff curve, so past the limit grip actually drops away
   instead of clipping flat.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M, V = M.v3;

  var RPM2RAD = Math.PI / 30;
  var RAD2RPM = 30 / Math.PI;

  /* The tyre force curve: rises to 1.0 at unit normalised slip, then
     falls away. Cheap stand-in for a full Pacejka fit and it feels right. */
  function slipCurve(u) {
    return (2 * u) / (1 + u * u);
  }

  function Drivetrain(vehicle, terrain) {
    this.v = vehicle;
    this.spec = vehicle.spec;
    this.body = vehicle.body;
    this.terrain = terrain;

    var spec = this.spec;
    this.wheels = [];
    for (var i = 0; i < vehicle.wheels.length; i++) {
      var w = vehicle.wheels[i];
      this.wheels.push({
        def: w,
        node: w.node,
        omega: 0,
        spin: 0,                // visual rotation angle
        steer: 0,
        inertia: 0.5 * (spec.wheel.mass || 26) * w.radius * w.radius,
        radius: w.radius,
        contact: false,
        load: 0,
        slipRatio: 0,
        slipAngle: 0,
        skid: 0,
        surfaceGrip: 1,
        surface: 0,
        compression: 0,
        lastContactY: 0,
        contactPoint: new Float32Array(3),
        contactNormal: new Float32Array([0, 1, 0]),
        forward: new Float32Array([0, 0, 1]),
        right: new Float32Array([1, 0, 0])
      });
    }

    // Engine / transmission state.
    this.rpm = spec.engine.idle;
    this.omegaE = this.rpm * RPM2RAD;
    this.gear = 2;                 // index into ratios: 0=R, 1=N, 2=1st...
    this.gearCount = spec.gearbox.ratios.length;
    this.shiftTimer = 0;
    this.shiftCooldown = 0;
    this.clutchLock = 1;
    this.autoBox = true;
    this.engineOn = true;
    this.stalled = false;
    this.revLimitCut = 0;

    // Inputs, 0..1 unless noted.
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.steerInput = 0;           // -1..1
    this.clutchInput = 0;

    // Assists.
    this.abs = true;
    this.tractionControl = true;
    this.stabilityControl = false;

    // Telemetry for HUD / audio.
    this.speed = 0;
    this.engineLoad = 0;
    this.wheelSlipAvg = 0;
    this.skidTotal = 0;
    this.driveWheels = 0;
    for (i = 0; i < this.wheels.length; i++) if (this.wheels[i].def.driven) this.driveWheels++;

    this._f = new Float32Array(3);
    this._wf = new Float32Array(3);
    this._wr = new Float32Array(3);
    this._hv = new Float32Array(3);
    this._r = new Float32Array(3);
    this._u = new Float32Array(3);
    this._tmp = new Float32Array(3);
    this._n = new Float32Array(3);
  }

  Drivetrain.prototype.reset = function () {
    for (var i = 0; i < this.wheels.length; i++) {
      this.wheels[i].omega = 0;
      this.wheels[i].spin = 0;
      this.wheels[i].skid = 0;
    }
    this.rpm = this.spec.engine.idle;
    this.omegaE = this.rpm * RPM2RAD;
    this.gear = 2;
    this.shiftTimer = 0;
    this.shiftCooldown = 0;
    this.stalled = false;
  };

  Drivetrain.prototype.ratio = function () {
    return this.spec.gearbox.ratios[this.gear] || 0;
  };

  Drivetrain.prototype.gearLabel = function () {
    if (this.gear === 0) return 'R';
    if (this.gear === 1) return 'N';
    return String(this.gear - 1);
  };

  Drivetrain.prototype.shiftUp = function () {
    if (this.gear < this.gearCount - 1) {
      this.gear++;
      this.shiftTimer = this.spec.gearbox.shiftTime;
      this.shiftCooldown = this.spec.gearbox.shiftTime + 0.45;
    }
  };
  Drivetrain.prototype.shiftDown = function () {
    if (this.gear > 0) {
      this.gear--;
      this.shiftTimer = this.spec.gearbox.shiftTime;
      this.shiftCooldown = this.spec.gearbox.shiftTime + 0.30;
    }
  };

  /* Engine torque at a given rpm, sampled from the normalised curve. */
  Drivetrain.prototype.engineTorque = function (rpm) {
    var e = this.spec.engine;
    var curve = e.curve;
    var t = (rpm - e.idle) / (e.redline - e.idle);
    t = M.clamp(t, 0, 1) * (curve.length - 1);
    var i0 = Math.floor(t);
    var i1 = Math.min(i0 + 1, curve.length - 1);
    var f = t - i0;
    return e.peakTorque * (curve[i0] + (curve[i1] - curve[i0]) * f);
  };

  /* -------------------------------------------------------- the main step

     Order matters here. Tyre forces are evaluated first from the wheel
     speeds we already have, then the engine and driveline are advanced
     together with an IMPLICIT clutch solve.

     Why implicit: the clutch is a very stiff damper, and it sits across a
     gear ratio of up to 14:1. Referred to the wheels its damping is scaled
     by the ratio SQUARED, which puts the stable explicit timestep down
     around 8 kHz — far beyond anything a phone can run. Solved implicitly
     the same coupling is unconditionally stable, and it still slips
     properly once the torque exceeds the clutch's capacity.               */

  Drivetrain.prototype.step = function (dt, world) {
    var body = this.body;
    var spec = this.spec;
    var frame = body.frame;
    var wheels = this.wheels;
    var i;

    this.speed = V.len(body.velocity);

    // Body basis vectors straight out of the shape-matched frame.
    var bx = this._r, by = this._u, bz = this._f;
    bx[0] = frame[0]; bx[1] = frame[1]; bx[2] = frame[2];
    by[0] = frame[4]; by[1] = frame[5]; by[2] = frame[6];
    bz[0] = frame[8]; bz[1] = frame[9]; bz[2] = frame[10];

    /* ---------------------------------------------------------- steering */
    var st = spec.steering;
    var speedKph = this.speed * 3.6;
    var falloff = 1 / (1 + speedKph * st.speedFalloff * 0.009);
    var targetSteer = this.steerInput * st.maxAngle * Math.max(falloff, 0.22);
    var rackRate = st.ratio * dt * 3.4;
    for (i = 0; i < wheels.length; i++) {
      var sw = wheels[i];
      if (!sw.def.steered) { sw.steer = 0; continue; }
      var tgt = targetSteer * sw.def.steered;
      if (tgt !== 0) {
        // Ackermann: the inside wheel turns a little more than the outside.
        var inside = (tgt > 0) === (sw.def.side > 0);
        tgt *= inside ? 1.14 : 0.88;
      }
      sw.steer = M.moveTowards(sw.steer, tgt, rackRate);
    }

    /* --------------------------------------------------- gearbox state */
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      this.clutchLock = 0;
    } else {
      this.clutchLock = 1 - this.clutchInput;
    }

    var ratio = this.ratio();
    var final = spec.gearbox.final;
    var totalRatio = ratio * final;
    var idleOmega = spec.engine.idle * RPM2RAD;
    var redOmega = spec.engine.redline * RPM2RAD;

    /* ============================ pass 1: contact and tyre forces ====== */
    var tyres = spec.tyres;
    var fwd = this._wf, rgt = this._wr, hubV = this._hv, n = this._n;
    var totalSkid = 0, slipSum = 0, contactCount = 0;
    var drivenOmega = 0, nDriven = 0, drivenInertia = 0, drivenSideT = 0;

    for (i = 0; i < wheels.length; i++) {
      var wh = wheels[i];
      var ni = wh.node * 3;
      var px = body.pos[ni], py = body.pos[ni + 1], pz = body.pos[ni + 2];
      hubV[0] = body.vel[ni]; hubV[1] = body.vel[ni + 1]; hubV[2] = body.vel[ni + 2];

      // Wheel frame: body basis rotated by the steer angle about body up.
      var cs = Math.cos(wh.steer), sn = Math.sin(wh.steer);
      fwd[0] = bz[0] * cs + bx[0] * sn;
      fwd[1] = bz[1] * cs + bx[1] * sn;
      fwd[2] = bz[2] * cs + bx[2] * sn;
      rgt[0] = bx[0] * cs - bz[0] * sn;
      rgt[1] = bx[1] * cs - bz[1] * sn;
      rgt[2] = bx[2] * cs - bz[2] * sn;
      wh.forward.set(fwd);
      wh.right.set(rgt);

      // Ground query directly beneath the hub.
      var gh = this.terrain.height(px, pz);
      var surf = this.terrain.surfaceAt ? this.terrain.surfaceAt(px, pz) : 0;
      wh.surface = surf;
      var muSurf = this.terrain.surfaceGrip ? this.terrain.surfaceGrip(surf) : 1;
      if (world && world.rayHeight) {
        var ph = world.rayHeight(px, pz, py);
        if (ph > gh) { gh = ph; muSurf = 1.0; }
      }
      this.terrain.normal(px, pz, n);
      wh.contactNormal.set(n);
      wh.contactPoint[0] = px; wh.contactPoint[1] = gh; wh.contactPoint[2] = pz;

      var pen = (gh + wh.radius) - py;
      wh.compression = M.clamp(pen / (wh.radius * 0.45), 0, 1.2);

      var brakeT = this.brake * spec.brakes.maxTorque * wh.def.brakeBias;
      if (this.handbrake > 0 && !wh.def.front) {
        brakeT = Math.max(brakeT, this.handbrake * spec.brakes.maxTorque * 0.62);
      }
      wh._brakeT = brakeT;

      var vx, vy, vref, Fn = 0, Fx = 0, Fy = 0, muLong = 0;

      if (pen <= 0) {
        wh.contact = false;
        wh.load = 0;
        wh.slipRatio = 0;
        wh.slipAngle = 0;
        wh.skid *= Math.max(0, 1 - dt * 6);
        vx = hubV[0] * fwd[0] + hubV[1] * fwd[1] + hubV[2] * fwd[2];
        vref = Math.max(Math.abs(vx), 2.2);
        // Airborne: brakes still bite, nothing else does.
        wh._sideT = -M.sign(wh.omega) * brakeT;
        wh._capacity = 0;
        wh._tyreDamp = 0;
      } else {
        wh.contact = true;
        contactCount++;

        // Vertical: the tyre carcass is a stiff spring/damper.
        var vN = hubV[0] * n[0] + hubV[1] * n[1] + hubV[2] * n[2];
        var tyreK = 210000 * (wh.radius / 0.32);
        Fn = tyreK * pen - 3400 * vN;
        if (Fn < 0) Fn = 0;
        // Bump stop: past ~55% compression the rate climbs steeply.
        if (pen > wh.radius * 0.55) Fn += (pen - wh.radius * 0.55) * tyreK * 5.0;
        wh.load = Fn;

        vx = hubV[0] * fwd[0] + hubV[1] * fwd[1] + hubV[2] * fwd[2];
        vy = hubV[0] * rgt[0] + hubV[1] * rgt[1] + hubV[2] * rgt[2];
        vref = Math.max(Math.abs(vx), 2.2);
        var slipLong = (vx - wh.omega * wh.radius) / vref;
        var slipLat = vy / vref;
        wh.slipRatio = -slipLong;
        wh.slipAngle = Math.atan2(vy, Math.max(Math.abs(vx), 0.35));

        var ux = slipLong * tyres.stiffnessLong;
        var uy = slipLat * tyres.stiffnessLat;
        var u = Math.sqrt(ux * ux + uy * uy);

        // Load sensitivity: grip per newton falls as the tyre is loaded up.
        var loadRef = body.totalMass * 9.81 * 0.25;
        var loadFactor = 1.06 - 0.18 * M.clamp(Fn / Math.max(loadRef, 1), 0, 2.4);
        muLong = tyres.gripLong * muSurf * loadFactor;
        var muLat = tyres.gripLat * muSurf * loadFactor;

        if (u > 1e-5) {
          var curveVal = slipCurve(u);
          var dirx = ux / u, diry = uy / u;
          var muC = Math.sqrt((dirx * muLong) * (dirx * muLong) + (diry * muLat) * (diry * muLat));
          var Fmag = muC * Fn * curveVal;
          Fx = -dirx * Fmag;
          Fy = -diry * Fmag;
        }

        // ABS releases the brake when the wheel is about to lock.
        if (this.abs && this.brake > 0.02 && Math.abs(slipLong) > 0.22 && Math.abs(vx) > 2.5) {
          brakeT *= 0.28;
          wh._brakeT = brakeT;
        }

        // Apply the contact patch force to the hub node.
        body.force[ni] += n[0] * Fn + fwd[0] * Fx + rgt[0] * Fy;
        body.force[ni + 1] += n[1] * Fn + fwd[1] * Fx + rgt[1] * Fy;
        body.force[ni + 2] += n[2] * Fn + fwd[2] * Fx + rgt[2] * Fy;

        // Torques acting on the wheel from outside the driveline.
        var tyreT = -Fx * wh.radius;
        var rollRes = -M.sign(wh.omega) * Fn * 0.014 * wh.radius;
        var brakeApplied = -M.sign(wh.omega) * brakeT;
        var maxBrakeStop = Math.abs(wh.omega) * wh.inertia / Math.max(dt, 1e-5);
        if (Math.abs(brakeApplied) > maxBrakeStop) {
          brakeApplied = -M.sign(wh.omega) * maxBrakeStop;
        }
        wh._sideT = tyreT + rollRes + brakeApplied;
        wh._capacity = muLong * Fn * wh.radius;
        /* How hard the contact patch resists a change in wheel speed, i.e.
           R * d(Fx)/d(omega) at small slip. This is what makes the wheel
           equation stiff — at a standstill it is several times I/dt — so it
           is fed into an implicit update below rather than integrated
           explicitly. The small-slip slope is used everywhere: past the grip
           peak the true slope is negative, and using the positive one there
           merely over-damps, which is safe. */
        wh._tyreDamp = 2 * muLong * Fn * tyres.stiffnessLong *
                       wh.radius * wh.radius / vref;

        var slipMag = Math.min(u / 1.9, 3);
        var sliding = Math.max(0, slipMag - 1.0);
        wh.skid = M.damp(wh.skid, Math.min(sliding, 1) * (Fn > 200 ? 1 : 0), 14, dt);
        totalSkid += wh.skid;
        slipSum += Math.abs(slipLong);
      }

      wh._vx = vx;
      wh._vref = vref;
      wh._muLong = muLong;
      wh._Fn = Fn;
      wh._Fx = Fx;

      if (wh.def.driven) {
        drivenOmega += wh.omega;
        drivenInertia += wh.inertia;
        drivenSideT += wh._sideT;
        nDriven++;
      }
    }
    if (nDriven) drivenOmega /= nDriven;

    /* ============================ pass 2: engine and clutch ============ */
    var throttle = this.throttle;
    // Idle governor: enough throttle to hold the idle speed.
    var idleAssist = M.clamp((idleOmega * 1.04 - this.omegaE) / (idleOmega * 0.4), 0, 1) * 0.30;
    var effThrottle = Math.max(throttle, this.engineOn ? idleAssist : 0);

    if (this.omegaE > redOmega) this.revLimitCut = 0.045;
    if (this.revLimitCut > 0) { this.revLimitCut -= dt; effThrottle = 0; }
    if (this.shiftTimer > 0) effThrottle = 0;

    var Te = this.engineOn ? this.engineTorque(this.omegaE * RAD2RPM) * effThrottle : 0;
    // Pumping and friction losses rise with speed and with a closed throttle.
    var fric = (0.018 * spec.engine.peakTorque +
                0.0032 * spec.engine.peakTorque * (this.omegaE * RAD2RPM / 1000)) *
               (1.15 - effThrottle * 0.75);
    Te -= fric;

    var I_e = spec.engine.inertia;
    var Tc = 0;
    var engaged = (totalRatio !== 0 && nDriven > 0 && this.clutchLock > 0);

    if (engaged) {
      var omegaT = drivenOmega * totalRatio;              // transmission, at the crank

      /* Launch behaviour. While the transmission is still turning slower
         than the engine wants to, the clutch only takes up gradually as the
         crank speed rises toward a throttle-dependent target. That is what
         lets the engine spin up to a couple of thousand rpm and then drive
         the car away, instead of being dragged straight down to a bog; at a
         closed throttle the same curve gives an automatic its creep. */
      var engage = this.clutchLock;
      var launchOmega = idleOmega * 1.25 + throttle * (redOmega - idleOmega) * 0.30;
      if (Math.abs(omegaT) < launchOmega) {
        var floorOmega = idleOmega * 0.70;
        engage *= M.clamp((this.omegaE - floorOmega) /
                          Math.max(launchOmega - floorOmega, 1), 0, 1);
      }
      var cap = spec.engine.peakTorque * 1.5 * engage;
      var cDamp = cap * 0.5 + 1e-6;         // saturates at ~2 rad/s of slip

      var I_t = drivenInertia / (totalRatio * totalRatio);
      var T_ext = drivenSideT / totalRatio;

      var s0 = this.omegaE - omegaT;
      var invIe = 1 / I_e, invIt = 1 / Math.max(I_t, 1e-6);
      var sNew = (s0 + dt * (Te * invIe - T_ext * invIt)) /
                 (1 + dt * cDamp * (invIe + invIt));
      Tc = cDamp * sNew;
      if (Tc > cap) Tc = cap;
      else if (Tc < -cap) Tc = -cap;
    }

    this.omegaE += (Te - Tc) / I_e * dt;
    if (this.omegaE < idleOmega * 0.35) this.omegaE = idleOmega * 0.35;
    if (this.omegaE > redOmega * 1.06) this.omegaE = redOmega * 1.06;
    this.rpm = this.omegaE * RAD2RPM;
    this.engineLoad = M.clamp(effThrottle, 0, 1);

    var wheelTorque = engaged ? (Tc * totalRatio * 0.94 / nDriven) : 0;

    if (this.debug) {
      this.dbg = { Te: Te, Tc: Tc, omegaE: this.omegaE, totalRatio: totalRatio,
                   effThrottle: effThrottle, nDriven: nDriven, wheelTorque: wheelTorque,
                   wheels: [] };
    }

    /* ============================ pass 3: advance the wheels =========== */
    for (i = 0; i < wheels.length; i++) {
      var w2 = wheels[i];
      var driveT = 0;
      if (w2.def.driven && engaged) {
        driveT = wheelTorque;
        // Traction control trims this wheel's share only.
        if (this.tractionControl && this.throttle > 0.1 && w2.slipRatio > 0.26) {
          driveT *= 0.42;
        }
      }
      // Implicit in the tyre's own resistance: stable however stiff the
      // contact patch is, and it settles on the correct slip in one step
      // instead of ringing around it.
      w2.omega += (driveT + w2._sideT) / (w2.inertia / dt + w2._tyreDamp);

      if (w2._brakeT > spec.brakes.maxTorque * 0.02 &&
          Math.abs(w2.omega) < 0.6 && Math.abs(w2._vx) < 0.6) {
        w2.omega = 0;
      }
      w2.spin += w2.omega * dt;

      if (this.debug) {
        this.dbg.wheels.push({ i: i, driven: !!w2.def.driven, Fn: w2._Fn, Fx: w2._Fx,
          driveT: driveT, sideT: w2._sideT, cap: w2._capacity, omega: w2.omega,
          vx: w2._vx, slipRatio: w2.slipRatio });
      }
    }

    this.wheelSlipAvg = wheels.length ? slipSum / wheels.length : 0;
    this.skidTotal = totalSkid;
    this.wheelsOnGround = contactCount;

    /* ---------------------------------------------------- automatic box */
    if (this.shiftCooldown > 0) this.shiftCooldown -= dt;
    if (this.autoBox && this.shiftTimer <= 0 && this.shiftCooldown <= 0 && this.gear >= 1) {
      // Reference the engine speed to ROAD speed, not wheel speed, so a
      // spinning wheel cannot talk the box into a higher gear.
      var wr = wheels.length ? wheels[0].radius : 0.3;
      var roadOmega = this.speed / Math.max(wr, 0.05);
      var refRpm = Math.max(roadOmega * Math.abs(totalRatio) * RAD2RPM, spec.engine.idle);
      var span = spec.engine.redline - spec.engine.idle;
      var rpmFrac = (refRpm - spec.engine.idle) / span;
      if (this.gear === 1 && (this.throttle > 0.05 || this.speed > 0.4)) {
        this.gear = 2;
      } else if (this.gear >= 2) {
        var minKph = (this.gear - 1) * 9;
        if (rpmFrac > spec.gearbox.autoUp && this.gear < this.gearCount - 1 &&
            this.throttle > 0.06 && this.speed * 3.6 > minKph) {
          this.shiftUp();
        } else if (rpmFrac < spec.gearbox.autoDown && this.gear > 2) {
          // Only drop down if the lower gear would not immediately ask to go
          // back up, otherwise the box hunts and the clutch never closes.
          var lowerRatio = spec.gearbox.ratios[this.gear - 1] * final;
          var lowerRpm = roadOmega * Math.abs(lowerRatio) * RAD2RPM;
          var lowerFrac = (lowerRpm - spec.engine.idle) / span;
          if (lowerFrac < spec.gearbox.autoUp * 0.80) this.shiftDown();
        }
      }
    }

    /* ------------------------------------------------------------- aero */
    var aero = spec.aero;
    var sp = this.speed;
    if (sp > 0.5) {
      var q = 0.5 * 1.225 * sp * sp;
      var dragF = q * aero.drag * aero.frontal;
      var dir = body.velocity;
      var inv = -1 / Math.max(sp, 1e-4);
      var dfx = dir[0] * inv * dragF;
      var dfy = dir[1] * inv * dragF;
      var dfz = dir[2] * inv * dragF;
      var liftF = q * aero.lift * aero.frontal;
      for (i = 0; i < body.nodeCount; i++) {
        if (body.nodeFlags[i] & 2) continue;
        var share = body.mass[i] / body.totalMass;
        body.force[i * 3] += dfx * share + by[0] * liftF * share;
        body.force[i * 3 + 1] += dfy * share + by[1] * liftF * share;
        body.force[i * 3 + 2] += dfz * share + by[2] * liftF * share;
      }
    }

    /* ------------------------------------------- stability control aid */
    if (this.stabilityControl && this.speed > 6 && contactCount >= 3) {
      var vDotF = body.velocity[0] * bz[0] + body.velocity[1] * bz[1] + body.velocity[2] * bz[2];
      var vDotR = body.velocity[0] * bx[0] + body.velocity[1] * bx[1] + body.velocity[2] * bx[2];
      var beta = Math.atan2(vDotR, Math.abs(vDotF) + 0.1);
      if (Math.abs(beta) > 0.16) {
        var corrective = -M.sign(beta) * Math.min(Math.abs(beta) - 0.16, 0.5) *
                          body.totalMass * 2.6;
        for (i = 0; i < wheels.length; i++) {
          var cw = wheels[i];
          if (!cw.def.front || !cw.contact) continue;
          if ((cw.def.side > 0) === (beta < 0)) continue;
          var cni = cw.node * 3;
          body.force[cni] += cw.right[0] * corrective;
          body.force[cni + 1] += cw.right[1] * corrective;
          body.force[cni + 2] += cw.right[2] * corrective;
        }
      }
    }
  };

  /* Steering-wheel angle the driver animation should show, in radians. */
  Drivetrain.prototype.steeringWheelAngle = function () {
    var lock = this.spec.steering.ratio || 2.5;
    var s = 0, n = 0;
    for (var i = 0; i < this.wheels.length; i++) {
      if (this.wheels[i].def.steered) { s += this.wheels[i].steer; n++; }
    }
    if (!n) return 0;
    return (s / n) / this.spec.steering.maxAngle * lock * Math.PI * 0.5;
  };

  B.Drivetrain = Drivetrain;

})();
