/* =========================================================================
   BeamDrive Mobile — soft-body solver
   Cars are point masses ("nodes") wired together by damped springs
   ("beams"). Beams yield plastically past a strain threshold and snap past
   a second one, which is what produces permanent, shape-specific damage
   rather than a canned "wrecked" model.

   Everything lives in flat typed arrays; the inner loops allocate nothing.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M, V = M.v3, Mat = M.m4;

  var GRAVITY = -9.81;

  /* Müller et al., "A Robust Method to Extract the Rotational Part of
     Deformations" (2016). Nudges a quaternion until its rotation matrix's
     columns line up with the columns of A. `A` is row-major 3x3. */
  var _rcol = [new Float32Array(3), new Float32Array(3), new Float32Array(3)];
  var _om = new Float32Array(3);
  var _cr = new Float32Array(3);
  var _rm = Mat.create();
  function extractRotation(A, q, maxIter) {
    for (var iter = 0; iter < maxIter; iter++) {
      M.quat.toMat4(_rm, q);
      _rcol[0][0] = _rm[0]; _rcol[0][1] = _rm[1]; _rcol[0][2] = _rm[2];
      _rcol[1][0] = _rm[4]; _rcol[1][1] = _rm[5]; _rcol[1][2] = _rm[6];
      _rcol[2][0] = _rm[8]; _rcol[2][1] = _rm[9]; _rcol[2][2] = _rm[10];

      _om[0] = 0; _om[1] = 0; _om[2] = 0;
      var denom = 1e-9;
      for (var c = 0; c < 3; c++) {
        var ax = A[c], ay = A[3 + c], az = A[6 + c];     // column c of A
        var r = _rcol[c];
        _cr[0] = r[1] * az - r[2] * ay;
        _cr[1] = r[2] * ax - r[0] * az;
        _cr[2] = r[0] * ay - r[1] * ax;
        _om[0] += _cr[0]; _om[1] += _cr[1]; _om[2] += _cr[2];
        denom += r[0] * ax + r[1] * ay + r[2] * az;
      }
      var inv = 1 / Math.abs(denom);
      _om[0] *= inv; _om[1] *= inv; _om[2] *= inv;
      var w = Math.sqrt(_om[0] * _om[0] + _om[1] * _om[1] + _om[2] * _om[2]);
      if (w < 1e-9) break;
      var ax2 = _om[0] / w, ay2 = _om[1] / w, az2 = _om[2] / w;
      var half = w * 0.5;
      var sn = Math.sin(half), cs = Math.cos(half);
      var dx = ax2 * sn, dy = ay2 * sn, dz = az2 * sn, dw = cs;
      // q = delta * q
      var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      var nx = dw * qx + dx * qw + dy * qz - dz * qy;
      var ny = dw * qy - dx * qz + dy * qw + dz * qx;
      var nz = dw * qz + dx * qy - dy * qx + dz * qw;
      var nw = dw * qw - dx * qx - dy * qy - dz * qz;
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw) || 1;
      q[0] = nx / len; q[1] = ny / len; q[2] = nz / len; q[3] = nw / len;
    }
    return q;
  }
  B.extractRotation = extractRotation;

  function SoftBody(opts) {
    opts = opts || {};
    var nodeDefs = opts.nodes || [];
    var beamDefs = opts.beams || [];
    var n = nodeDefs.length;

    this.nodeCount = n;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.force = new Float32Array(n * 3);
    this.restLocal = new Float32Array(n * 3);   // undeformed, body space
    this.curLocal = new Float32Array(n * 3);    // current, body space (for skinning)
    this.mass = new Float32Array(n);
    this.invMass = new Float32Array(n);
    this.radius = new Float32Array(n);
    this.nodeFlags = new Uint8Array(n);         // bit 0: frame, bit 1: wheel hub
    this.nodeGroup = new Uint8Array(n);         // body region, for damage readout
    this.contact = new Uint8Array(n);
    this.contactDepth = new Float32Array(n);
    this.nodeDamage = new Float32Array(n);
    this.names = [];

    var i;
    for (i = 0; i < n; i++) {
      var nd = nodeDefs[i];
      this.pos[i * 3] = nd.p[0]; this.pos[i * 3 + 1] = nd.p[1]; this.pos[i * 3 + 2] = nd.p[2];
      this.restLocal[i * 3] = nd.p[0]; this.restLocal[i * 3 + 1] = nd.p[1]; this.restLocal[i * 3 + 2] = nd.p[2];
      this.curLocal[i * 3] = nd.p[0]; this.curLocal[i * 3 + 1] = nd.p[1]; this.curLocal[i * 3 + 2] = nd.p[2];
      this.mass[i] = nd.m || 25;
      this.invMass[i] = 1 / this.mass[i];
      this.radius[i] = nd.r !== undefined ? nd.r : 0.06;
      this.nodeFlags[i] = (nd.frame ? 1 : 0) | (nd.wheel ? 2 : 0) | (nd.noCollide ? 4 : 0);
      this.nodeGroup[i] = nd.group || 0;
      this.names.push(nd.name || ('n' + i));
    }

    var m = beamDefs.length;
    this.beamCount = m;
    this.bA = new Int32Array(m);
    this.bB = new Int32Array(m);
    this.restLen = new Float32Array(m);
    this.curRest = new Float32Array(m);
    this.stiff = new Float32Array(m);
    this.bdamp = new Float32Array(m);
    this.deformStart = new Float32Array(m);
    this.deformRate = new Float32Array(m);
    this.breakStrain = new Float32Array(m);
    this.broken = new Uint8Array(m);
    this.beamStress = new Float32Array(m);

    for (i = 0; i < m; i++) {
      var bd = beamDefs[i];
      var a = bd.a, b2 = bd.b;
      this.bA[i] = a; this.bB[i] = b2;
      var dx = this.pos[a * 3] - this.pos[b2 * 3];
      var dy = this.pos[a * 3 + 1] - this.pos[b2 * 3 + 1];
      var dz = this.pos[a * 3 + 2] - this.pos[b2 * 3 + 2];
      var L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-5) L = 1e-5;
      this.restLen[i] = L;
      this.curRest[i] = L;
      this.stiff[i] = bd.k !== undefined ? bd.k : 620000;
      this.bdamp[i] = bd.d !== undefined ? bd.d : 640;
      this.deformStart[i] = bd.deform !== undefined ? bd.deform : 0.055;
      this.deformRate[i] = bd.plastic !== undefined ? bd.plastic : 0.42;
      this.breakStrain[i] = bd.brk !== undefined ? bd.brk : 0.62;
    }

    // Working state shared with the renderer / camera / driver.
    this.frame = Mat.create();          // body -> world
    this.frameInv = Mat.create();
    this.center = new Float32Array(3);
    this.velocity = new Float32Array(3);
    this.angVel = new Float32Array(3);
    this.prevFrame = Mat.create();
    this.totalMass = 0;
    for (i = 0; i < n; i++) this.totalMass += this.mass[i];

    this.damage = 0;            // 0..1 overall
    this.regionDamage = new Float32Array(8);
    this.brokenBeams = 0;
    this.lastImpact = 0;        // magnitude of the most recent hit
    this.impactAccum = 0;
    this.groundContacts = 0;

    // Shape-matching reference (frame nodes only).
    this.frameNodes = [];
    for (i = 0; i < n; i++) if (this.nodeFlags[i] & 1) this.frameNodes.push(i);
    if (!this.frameNodes.length) for (i = 0; i < n; i++) this.frameNodes.push(i);
    this.frameRestCenter = new Float32Array(3);
    var fm = 0;
    for (i = 0; i < this.frameNodes.length; i++) {
      var fi = this.frameNodes[i];
      var w = this.mass[fi];
      this.frameRestCenter[0] += this.restLocal[fi * 3] * w;
      this.frameRestCenter[1] += this.restLocal[fi * 3 + 1] * w;
      this.frameRestCenter[2] += this.restLocal[fi * 3 + 2] * w;
      fm += w;
    }
    V.scale(this.frameRestCenter, this.frameRestCenter, 1 / fm);
    this.frameRestMass = fm;

    this._A = new Float32Array(9);
    this._tmp = new Float32Array(3);
    this._tmp2 = new Float32Array(3);
    this.frameQuat = new Float32Array([0, 0, 0, 1]);
    this.frameFitted = false;

    this.enabled = true;
    this.sleeping = false;
    this.sleepTimer = 0;
  }

  /* --------------------------------------------------------------- setup */

  // Place the body in the world with a yaw-only orientation.
  SoftBody.prototype.placeAt = function (x, y, z, yaw, pitch, roll) {
    var mrot = Mat.create();
    Mat.fromEulerYXZ(mrot, yaw || 0, pitch || 0, roll || 0);
    var p = this._tmp;
    for (var i = 0; i < this.nodeCount; i++) {
      p[0] = this.restLocal[i * 3];
      p[1] = this.restLocal[i * 3 + 1];
      p[2] = this.restLocal[i * 3 + 2];
      V.xformDir(p, p, mrot);
      this.pos[i * 3] = p[0] + x;
      this.pos[i * 3 + 1] = p[1] + y;
      this.pos[i * 3 + 2] = p[2] + z;
      this.vel[i * 3] = 0; this.vel[i * 3 + 1] = 0; this.vel[i * 3 + 2] = 0;
    }
    this.frameFitted = false;
    this.frameQuat[0] = 0; this.frameQuat[1] = 0; this.frameQuat[2] = 0; this.frameQuat[3] = 1;
    this.updateFrame();
    Mat.copy(this.prevFrame, this.frame);
    return this;
  };

  // Undo all plastic deformation and breakage.
  SoftBody.prototype.repair = function () {
    var i;
    for (i = 0; i < this.beamCount; i++) {
      this.curRest[i] = this.restLen[i];
      this.broken[i] = 0;
      this.beamStress[i] = 0;
    }
    for (i = 0; i < this.nodeCount; i++) this.nodeDamage[i] = 0;
    for (i = 0; i < 8; i++) this.regionDamage[i] = 0;
    this.damage = 0;
    this.brokenBeams = 0;
    this.impactAccum = 0;
    return this;
  };

  SoftBody.prototype.setVelocity = function (vx, vy, vz) {
    for (var i = 0; i < this.nodeCount; i++) {
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    }
    return this;
  };

  SoftBody.prototype.addForceAt = function (nodeIndex, fx, fy, fz) {
    this.force[nodeIndex * 3] += fx;
    this.force[nodeIndex * 3 + 1] += fy;
    this.force[nodeIndex * 3 + 2] += fz;
  };

  SoftBody.prototype.applyImpulse = function (nodeIndex, ix, iy, iz) {
    var im = this.invMass[nodeIndex];
    this.vel[nodeIndex * 3] += ix * im;
    this.vel[nodeIndex * 3 + 1] += iy * im;
    this.vel[nodeIndex * 3 + 2] += iz * im;
  };

  /* ----------------------------------------------------- shape matching
     Best-fit rigid transform from the undeformed frame nodes to their
     current positions. Gram-Schmidt stands in for a full polar
     decomposition: cheap, and the frame set is stiff enough that the
     shear it leaves behind is negligible.                              */
  SoftBody.prototype.updateFrame = function () {
    var fn = this.frameNodes, cnt = fn.length;
    var cx = 0, cy = 0, cz = 0, tm = 0, i, fi, w;
    for (i = 0; i < cnt; i++) {
      fi = fn[i]; w = this.mass[fi];
      cx += this.pos[fi * 3] * w;
      cy += this.pos[fi * 3 + 1] * w;
      cz += this.pos[fi * 3 + 2] * w;
      tm += w;
    }
    cx /= tm; cy /= tm; cz /= tm;
    this.center[0] = cx; this.center[1] = cy; this.center[2] = cz;

    var A = this._A;
    for (i = 0; i < 9; i++) A[i] = 0;
    var rc = this.frameRestCenter;
    for (i = 0; i < cnt; i++) {
      fi = fn[i]; w = this.mass[fi];
      var px = this.pos[fi * 3] - cx;
      var py = this.pos[fi * 3 + 1] - cy;
      var pz = this.pos[fi * 3 + 2] - cz;
      var qx = this.restLocal[fi * 3] - rc[0];
      var qy = this.restLocal[fi * 3 + 1] - rc[1];
      var qz = this.restLocal[fi * 3 + 2] - rc[2];
      A[0] += w * px * qx; A[1] += w * px * qy; A[2] += w * px * qz;
      A[3] += w * py * qx; A[4] += w * py * qy; A[5] += w * py * qz;
      A[6] += w * pz * qx; A[7] += w * pz * qy; A[8] += w * pz * qz;
    }

    /* A = R * S, where S is the rest covariance. S is strongly anisotropic
       for a car body and has a non-zero Y-Z term (the cabin is tall in the
       middle, the nose and tail are low), so orthonormalising A's columns
       does NOT give back R — it bakes in a spurious pitch of several
       degrees. Extract the true rotation instead, iteratively, warm-started
       from last frame's result so two passes are plenty. */
    extractRotation(A, this.frameQuat, this.frameFitted ? 2 : 14);
    this.frameFitted = true;
    var f = this.frame;
    M.quat.toMat4(f, this.frameQuat);
    f[12] = cx; f[13] = cy; f[14] = cz; f[15] = 1;
    Mat.invertRigid(this.frameInv, f);

    // Bulk velocity (mass-weighted over every node, not just the frame).
    var vx = 0, vy = 0, vz = 0, tm2 = 0;
    for (i = 0; i < this.nodeCount; i++) {
      w = this.mass[i];
      vx += this.vel[i * 3] * w;
      vy += this.vel[i * 3 + 1] * w;
      vz += this.vel[i * 3 + 2] * w;
      tm2 += w;
    }
    this.velocity[0] = vx / tm2;
    this.velocity[1] = vy / tm2;
    this.velocity[2] = vz / tm2;
    return this;
  };

  // Node positions expressed in the current body frame — the renderer's
  // skinning step consumes these.
  SoftBody.prototype.updateLocalPositions = function () {
    var inv = this.frameInv;
    for (var i = 0; i < this.nodeCount; i++) {
      var x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      this.curLocal[i * 3] = inv[0] * x + inv[4] * y + inv[8] * z + inv[12];
      this.curLocal[i * 3 + 1] = inv[1] * x + inv[5] * y + inv[9] * z + inv[13];
      this.curLocal[i * 3 + 2] = inv[2] * x + inv[6] * y + inv[10] * z + inv[14];
    }
  };

  /* ----------------------------------------------------- the solver step */

  SoftBody.prototype.clearForces = function () {
    var f = this.force;
    for (var i = 0; i < this.nodeCount; i++) {
      f[i * 3] = 0;
      f[i * 3 + 1] = GRAVITY * this.mass[i];
      f[i * 3 + 2] = 0;
    }
  };

  // Spring/damper pass, with plastic yield and breakage folded in.
  SoftBody.prototype.solveBeams = function (dt, damageScale) {
    var pos = this.pos, vel = this.vel, force = this.force;
    var newBreaks = 0;
    var deformEnergy = 0;
    for (var i = 0; i < this.beamCount; i++) {
      if (this.broken[i]) continue;
      var a = this.bA[i], b = this.bB[i];
      var a3 = a * 3, b3 = b * 3;
      var dx = pos[b3] - pos[a3];
      var dy = pos[b3 + 1] - pos[a3 + 1];
      var dz = pos[b3 + 2] - pos[a3 + 2];
      var len2 = dx * dx + dy * dy + dz * dz;
      var len = Math.sqrt(len2);
      if (len < 1e-6) continue;
      var inv = 1 / len;
      var ux = dx * inv, uy = dy * inv, uz = dz * inv;

      var rest = this.curRest[i];
      var ext = len - rest;

      // Relative velocity projected onto the beam axis.
      var rvx = vel[b3] - vel[a3];
      var rvy = vel[b3 + 1] - vel[a3 + 1];
      var rvz = vel[b3 + 2] - vel[a3 + 2];
      var rv = rvx * ux + rvy * uy + rvz * uz;

      var f = this.stiff[i] * ext + this.bdamp[i] * rv;
      this.beamStress[i] = ext / this.restLen[i];

      var fx = ux * f, fy = uy * f, fz = uz * f;
      force[a3] += fx; force[a3 + 1] += fy; force[a3 + 2] += fz;
      force[b3] -= fx; force[b3 + 1] -= fy; force[b3 + 2] -= fz;

      // --- plastic yield -------------------------------------------------
      var strain = ext / this.restLen[i];
      var astrain = strain < 0 ? -strain : strain;
      var ds = this.deformStart[i];
      if (astrain > ds) {
        var over = astrain - ds;
        // Move the rest length toward the current length: permanent set.
        var move = over * this.deformRate[i] * dt * 60.0;
        if (move > 0.9) move = 0.9;
        var target = len;
        this.curRest[i] += (target - this.curRest[i]) * move;
        var d = over * damageScale;
        deformEnergy += d * this.stiff[i] * 1e-6;
        this.nodeDamage[a] += d * 0.5;
        this.nodeDamage[b] += d * 0.5;
        if (astrain > this.breakStrain[i]) {
          this.broken[i] = 1;
          newBreaks++;
        }
      }
    }
    if (newBreaks) this.brokenBeams += newBreaks;
    this.impactAccum += deformEnergy;
    return newBreaks;
  };

  /* Symplectic Euler.

     The damping term bleeds numerical energy out of the lattice, but it is
     applied ONLY to each node's deviation from the body's mean velocity.
     Damping the raw velocity would be an invisible aerodynamic brake on the
     whole car — at 60 km/h a seemingly harmless 0.1/s rate costs about
     1.7 m/s^2, which is most of a small hatchback's acceleration.
     `internalDampRate` is per second, so the solver rate can change freely. */
  SoftBody.prototype.integrate = function (dt, internalDampRate) {
    var pos = this.pos, vel = this.vel, force = this.force, im = this.invMass;
    var n = this.nodeCount;
    var i, i3, m;
    var maxV = 260;  // hard clamp: keeps a bad step from launching the car

    for (i = 0; i < n; i++) {
      i3 = i * 3;
      m = im[i];
      vel[i3] += force[i3] * m * dt;
      vel[i3 + 1] += force[i3 + 1] * m * dt;
      vel[i3 + 2] += force[i3 + 2] * m * dt;
    }

    var rate = (internalDampRate === undefined ? 1.6 : internalDampRate) * dt;
    if (rate > 0.9) rate = 0.9;
    if (rate > 0) {
      var mx = 0, my = 0, mz = 0, tm = 0;
      for (i = 0; i < n; i++) {
        i3 = i * 3;
        var w = this.mass[i];
        mx += vel[i3] * w; my += vel[i3 + 1] * w; mz += vel[i3 + 2] * w;
        tm += w;
      }
      mx /= tm; my /= tm; mz /= tm;
      var keep = 1 - rate;
      for (i = 0; i < n; i++) {
        i3 = i * 3;
        vel[i3] = mx + (vel[i3] - mx) * keep;
        vel[i3 + 1] = my + (vel[i3 + 1] - my) * keep;
        vel[i3 + 2] = mz + (vel[i3 + 2] - mz) * keep;
      }
    }

    for (i = 0; i < n; i++) {
      i3 = i * 3;
      var vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
      var sp = vx * vx + vy * vy + vz * vz;
      if (sp > maxV * maxV) {
        var s = maxV / Math.sqrt(sp);
        vx *= s; vy *= s; vz *= s;
        vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      }
      pos[i3] += vx * dt;
      pos[i3 + 1] += vy * dt;
      pos[i3 + 2] += vz * dt;
    }
  };

  /* ------------------------------------------------------- ground contact
     `terrain` must expose height(x,z) and normal(x,z,out).             */
  SoftBody.prototype.collideTerrain = function (terrain, dt, friction, restitution, ceiling) {
    var pos = this.pos, vel = this.vel;
    var n = new Float32Array(3);
    var contacts = 0;
    var impact = 0;
    friction = friction === undefined ? 0.95 : friction;
    restitution = restitution === undefined ? 0.12 : restitution;
    // `ceiling` is a conservative upper bound on the ground height beneath
    // the body, refreshed once per frame. Anything clearly above it cannot be
    // in contact, which skips the expensive height query for most nodes.
    var hasCeiling = ceiling !== undefined && ceiling !== null;

    for (var i = 0; i < this.nodeCount; i++) {
      this.contact[i] = 0;
      this.contactDepth[i] = 0;
      if (this.nodeFlags[i] & 4) continue;   // wheels handle their own contact
      var i3 = i * 3;
      var x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2];
      if (hasCeiling && y - this.radius[i] > ceiling) continue;
      var gh = terrain.height(x, z);
      var r = this.radius[i];
      var pen = (gh + r) - y;
      if (pen <= 0) continue;

      terrain.normal(x, z, n);
      contacts++;
      this.contact[i] = 1;
      this.contactDepth[i] = pen;

      // Positional correction along the surface normal.
      pos[i3] += n[0] * pen;
      pos[i3 + 1] += n[1] * pen;
      pos[i3 + 2] += n[2] * pen;

      var vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
      var vn = vx * n[0] + vy * n[1] + vz * n[2];
      if (vn < 0) {
        var jn = -(1 + restitution) * vn;
        vx += n[0] * jn; vy += n[1] * jn; vz += n[2] * jn;
        var mag = -vn * this.mass[i];
        if (mag > impact) impact = mag;
        // Scraping the body on the ground deforms it.
        if (-vn > 2.2) {
          var d = (-vn - 2.2) * 0.012;
          this.nodeDamage[i] += d;
          this.impactAccum += d * 0.4;
        }
      }
      // Coulomb friction against the tangential component.
      var dn = vx * n[0] + vy * n[1] + vz * n[2];
      var tx = vx - n[0] * dn, ty = vy - n[1] * dn, tz = vz - n[2] * dn;
      var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl > 1e-5) {
        var maxFric = friction * Math.abs(dn > 0 ? dn : -vn) + friction * 9.81 * dt * 4;
        var scale = tl <= maxFric ? 0 : (1 - maxFric / tl);
        vx = n[0] * dn + tx * scale;
        vy = n[1] * dn + ty * scale;
        vz = n[2] * dn + tz * scale;
      }
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
    }
    this.groundContacts = contacts;
    if (impact > this.lastImpact) this.lastImpact = impact;
    return impact;
  };

  /* Collide against the map's static box/ramp colliders. */
  SoftBody.prototype.collideBoxes = function (boxes, dt) {
    if (!boxes || !boxes.length) return 0;
    var pos = this.pos, vel = this.vel;
    var impact = 0;
    var lp = new Float32Array(3), ln = new Float32Array(3), wn = new Float32Array(3);
    for (var bi = 0; bi < boxes.length; bi++) {
      var box = boxes[bi];
      var inv = box.inv, he = box.half;
      for (var i = 0; i < this.nodeCount; i++) {
        var i3 = i * 3;
        lp[0] = pos[i3]; lp[1] = pos[i3 + 1]; lp[2] = pos[i3 + 2];
        // Quick reject against the bounding sphere.
        var ddx = lp[0] - box.center[0], ddy = lp[1] - box.center[1], ddz = lp[2] - box.center[2];
        if (ddx * ddx + ddy * ddy + ddz * ddz > box.radiusSq) continue;
        V.xformM4(lp, lp, inv);
        var r = this.radius[i];
        var ex = he[0] + r, ey = he[1] + r, ez = he[2] + r;
        if (lp[0] < -ex || lp[0] > ex || lp[1] < -ey || lp[1] > ey || lp[2] < -ez || lp[2] > ez) continue;

        // Push out along the axis of least penetration.
        var px = ex - Math.abs(lp[0]);
        var py = ey - Math.abs(lp[1]);
        var pz = ez - Math.abs(lp[2]);
        var pen, axis;
        if (px < py && px < pz) { pen = px; axis = 0; }
        else if (py < pz) { pen = py; axis = 1; }
        else { pen = pz; axis = 2; }
        ln[0] = 0; ln[1] = 0; ln[2] = 0;
        ln[axis] = lp[axis] >= 0 ? 1 : -1;
        V.xformDir(wn, ln, box.mat);
        V.normalize(wn, wn);

        pos[i3] += wn[0] * pen;
        pos[i3 + 1] += wn[1] * pen;
        pos[i3 + 2] += wn[2] * pen;

        var vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
        var vn = vx * wn[0] + vy * wn[1] + vz * wn[2];
        if (vn < 0) {
          var rest = box.restitution !== undefined ? box.restitution : 0.15;
          var jn = -(1 + rest) * vn;
          vx += wn[0] * jn; vy += wn[1] * jn; vz += wn[2] * jn;
          var mag = -vn * this.mass[i];
          if (mag > impact) impact = mag;
          if (-vn > 1.6 && !box.soft) {
            var d = (-vn - 1.6) * 0.03;
            this.nodeDamage[i] += d;
            this.impactAccum += d * 0.9;
          }
        }
        var mu = box.friction !== undefined ? box.friction : 0.8;
        var dn = vx * wn[0] + vy * wn[1] + vz * wn[2];
        var tx = vx - wn[0] * dn, ty = vy - wn[1] * dn, tz = vz - wn[2] * dn;
        var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 1e-5) {
          var maxF = mu * Math.abs(vn) + mu * 9.81 * dt * 4;
          var sc = tl <= maxF ? 0 : (1 - maxF / tl);
          vx = wn[0] * dn + tx * sc;
          vy = wn[1] * dn + ty * sc;
          vz = wn[2] * dn + tz * sc;
        }
        vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      }
    }
    if (impact > this.lastImpact) this.lastImpact = impact;
    return impact;
  };

  /* Node-vs-node collision between two bodies — car-to-car crashes. */
  SoftBody.collidePair = function (A, C, dt) {
    var impact = 0;
    // Bounding-sphere reject first.
    var dx = A.center[0] - C.center[0];
    var dy = A.center[1] - C.center[1];
    var dz = A.center[2] - C.center[2];
    var rr = (A.boundRadius || 3) + (C.boundRadius || 3);
    if (dx * dx + dy * dy + dz * dz > rr * rr) return 0;

    var i, j;
    for (i = 0; i < A.nodeCount; i++) {
      var ax = A.pos[i * 3], ay = A.pos[i * 3 + 1], az = A.pos[i * 3 + 2];
      var ar = A.radius[i] * 2.4;
      for (j = 0; j < C.nodeCount; j++) {
        var bx = C.pos[j * 3], by = C.pos[j * 3 + 1], bz = C.pos[j * 3 + 2];
        var ex = bx - ax, ey = by - ay, ez = bz - az;
        var d2 = ex * ex + ey * ey + ez * ez;
        var rsum = ar + C.radius[j] * 2.4;
        if (d2 >= rsum * rsum || d2 < 1e-9) continue;
        var d = Math.sqrt(d2);
        var nx = ex / d, ny = ey / d, nz = ez / d;
        var pen = rsum - d;

        var imA = A.invMass[i], imC = C.invMass[j];
        var tot = imA + imC;
        if (tot < 1e-9) continue;
        var corr = pen / tot * 0.62;
        A.pos[i * 3] -= nx * corr * imA;
        A.pos[i * 3 + 1] -= ny * corr * imA;
        A.pos[i * 3 + 2] -= nz * corr * imA;
        C.pos[j * 3] += nx * corr * imC;
        C.pos[j * 3 + 1] += ny * corr * imC;
        C.pos[j * 3 + 2] += nz * corr * imC;

        var rvx = C.vel[j * 3] - A.vel[i * 3];
        var rvy = C.vel[j * 3 + 1] - A.vel[i * 3 + 1];
        var rvz = C.vel[j * 3 + 2] - A.vel[i * 3 + 2];
        var vn = rvx * nx + rvy * ny + rvz * nz;
        if (vn < 0) {
          var jn = -(1 + 0.08) * vn / tot;
          A.vel[i * 3] -= nx * jn * imA;
          A.vel[i * 3 + 1] -= ny * jn * imA;
          A.vel[i * 3 + 2] -= nz * jn * imA;
          C.vel[j * 3] += nx * jn * imC;
          C.vel[j * 3 + 1] += ny * jn * imC;
          C.vel[j * 3 + 2] += nz * jn * imC;
          var mag = -vn;
          if (mag > impact) impact = mag;
          if (mag > 1.5) {
            var dmg = (mag - 1.5) * 0.020;
            A.nodeDamage[i] += dmg;
            C.nodeDamage[j] += dmg;
            A.impactAccum += dmg * 0.8;
            C.impactAccum += dmg * 0.8;
          }
        }
      }
    }
    if (impact > A.lastImpact) A.lastImpact = impact;
    if (impact > C.lastImpact) C.lastImpact = impact;
    return impact;
  };

  /* Roll the damage bookkeeping forward and derive the 0..1 readouts. */
  SoftBody.prototype.updateDamage = function () {
    var i;
    var total = 0;
    for (i = 0; i < 8; i++) this.regionDamage[i] = 0;
    for (i = 0; i < this.nodeCount; i++) {
      var d = this.nodeDamage[i];
      if (d > 4) { this.nodeDamage[i] = 4; d = 4; }
      total += d;
      var g = this.nodeGroup[i];
      if (g < 8) this.regionDamage[g] += d;
    }
    for (i = 0; i < 8; i++) {
      this.regionDamage[i] = M.clamp(this.regionDamage[i] / 5.0, 0, 1);
    }
    var beamFrac = this.beamCount ? this.brokenBeams / this.beamCount : 0;
    this.damage = M.clamp(total / (this.nodeCount * 1.35) * 0.72 + beamFrac * 1.5, 0, 1);
    return this.damage;
  };

  SoftBody.prototype.getSpeed = function () {
    return V.len(this.velocity);
  };

  // Are we upside down / on the roof?
  SoftBody.prototype.getUprightness = function () {
    return this.frame[5];   // world Y component of the body's up axis
  };

  B.SoftBody = SoftBody;
  B.GRAVITY = GRAVITY;

})();
