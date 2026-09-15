/* =========================================================================
   BeamDrive Mobile — world objects
   Prop geometry factories, the instanced prop registry, oriented-box
   colliders and the vertical ray query the wheels use to drive on top of
   ramps, kerbs and platforms.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M, V = M.v3, Mat = M.m4, Geo = B.Geo;

  /* ------------------------------------------------------ prop factories */
  var PROTO = {};

  function definePropType(name, factory, material, opts) {
    PROTO[name] = {
      name: name,
      factory: factory,
      material: material,
      opts: opts || {},
      geometry: null
    };
  }

  var MAT_ROUGH = function (color, rough, metal) {
    return { type: 0, baseColor: color, roughness: rough, metallic: metal || 0, clearcoat: 0, opacity: 1 };
  };

  definePropType('tree', function () {
    var mb = new Geo.MeshBuilder();
    var trunk = Geo.cylinder(0.14, 0.24, 3.0, 8, [0.24, 0.17, 0.11], true);
    var m = Mat.create(); m[13] = 1.5;
    mb.append(trunk, m);
    // Three stacked canopy shells give a fuller silhouette than one cone.
    var tiers = [{ y: 3.4, r: 2.05, h: 2.4 }, { y: 4.6, r: 1.55, h: 2.0 }, { y: 5.6, r: 0.95, h: 1.5 }];
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      var cone = Geo.cylinder(0.05, t.r, t.h, 9, [0.09, 0.22, 0.085], true);
      var cm = Mat.create(); cm[13] = t.y;
      mb.append(cone, cm);
    }
    mb.computeNormals();
    return mb;
  }, { type: 9, baseColor: [1, 1, 1], roughness: 0.92, metallic: 0, clearcoat: 0, opacity: 1 });

  definePropType('pine', function () {
    var mb = new Geo.MeshBuilder();
    var trunk = Geo.cylinder(0.10, 0.20, 2.2, 7, [0.20, 0.145, 0.10], true);
    var m = Mat.create(); m[13] = 1.1;
    mb.append(trunk, m);
    for (var i = 0; i < 4; i++) {
      var r = 1.85 - i * 0.40;
      var y = 2.0 + i * 1.28;
      var cone = Geo.cylinder(0.04, r, 1.85, 8, [0.055, 0.17, 0.075], true);
      var cm = Mat.create(); cm[13] = y;
      mb.append(cone, cm);
    }
    mb.computeNormals();
    return mb;
  }, { type: 9, baseColor: [1, 1, 1], roughness: 0.94, metallic: 0, clearcoat: 0, opacity: 1 });

  definePropType('barrier', function () {
    // Jersey barrier: wide foot tapering to a narrow top.
    var mb = new Geo.MeshBuilder();
    var col = [0.66, 0.66, 0.63];
    var secs = [
      { z: -1.5, pts: null }, { z: 1.5, pts: null }
    ];
    var profile = [[-0.30, 0], [0.30, 0], [0.30, 0.16], [0.13, 0.44], [0.11, 0.86], [-0.11, 0.86], [-0.13, 0.44], [-0.30, 0.16]];
    secs[0].pts = profile; secs[1].pts = profile;
    mb.append(Geo.loft(secs, col, true, 1));
    return mb;
  }, MAT_ROUGH([1, 1, 1], 0.88, 0.0), { collide: true, half: [0.30, 0.43, 1.5], offset: [0, 0.43, 0], mass: 900 });

  definePropType('cone', function () {
    var mb = new Geo.MeshBuilder();
    mb.append(Geo.cylinder(0.02, 0.17, 0.62, 10, [0.92, 0.32, 0.05], true), (function () {
      var m = Mat.create(); m[13] = 0.31; return m;
    })());
    mb.append(Geo.box(0.36, 0.035, 0.36, [0.14, 0.14, 0.15]), (function () {
      var m = Mat.create(); m[13] = 0.018; return m;
    })());
    mb.append(Geo.cylinder(0.105, 0.125, 0.10, 10, [0.94, 0.94, 0.95], false), (function () {
      var m = Mat.create(); m[13] = 0.40; return m;
    })());
    mb.computeNormals();
    return mb;
  }, MAT_ROUGH([1, 1, 1], 0.72, 0.0));

  definePropType('tyrestack', function () {
    var mb = new Geo.MeshBuilder();
    for (var i = 0; i < 3; i++) {
      var t = Geo.torus(0.34, 0.13, 14, 8, Math.PI * 2, [0.045, 0.045, 0.05]);
      var m = Mat.create(); m[13] = 0.16 + i * 0.27;
      mb.append(t, m);
    }
    return mb;
  }, { type: 7, baseColor: [1, 1, 1], roughness: 0.9, metallic: 0, clearcoat: 0, opacity: 1 },
     { collide: true, half: [0.46, 0.44, 0.46], offset: [0, 0.44, 0], restitution: 0.45, soft: true });

  definePropType('container', function () {
    var mb = new Geo.MeshBuilder();
    var body = Geo.roundedBox(2.44, 2.59, 6.06, 0.05, [1, 1, 1], 2);
    var m = Mat.create(); m[13] = 1.295;
    mb.append(body, m);
    // Corrugation ribs.
    for (var i = -5; i <= 5; i++) {
      var rib = Geo.box(0.05, 2.3, 0.10, [0.9, 0.9, 0.9]);
      var rm = Mat.create(); rm[12] = 1.235; rm[13] = 1.30; rm[14] = i * 0.5;
      mb.append(rib, rm);
      var rm2 = Mat.create(); rm2[12] = -1.235; rm2[13] = 1.30; rm2[14] = i * 0.5;
      mb.append(rib, rm2);
    }
    mb.computeNormals();
    return mb;
  }, MAT_ROUGH([1, 1, 1], 0.62, 0.35),
     { collide: true, half: [1.28, 1.30, 3.05], offset: [0, 1.30, 0], drivable: true });

  definePropType('block', function () {
    var mb = Geo.roundedBox(2.0, 2.0, 2.0, 0.06, [1, 1, 1], 2);
    mb.translate(0, 1.0, 0);
    return mb;
  }, MAT_ROUGH([1, 1, 1], 0.78, 0.05),
     { collide: true, half: [1.0, 1.0, 1.0], offset: [0, 1.0, 0], drivable: true });

  definePropType('building', function () {
    var mb = new Geo.MeshBuilder();
    var body = Geo.roundedBox(10, 8, 14, 0.15, [1, 1, 1], 2);
    var m = Mat.create(); m[13] = 4;
    mb.append(body, m);
    // Window bands.
    for (var f = 0; f < 3; f++) {
      var y = 1.6 + f * 2.4;
      for (var s = 0; s < 2; s++) {
        var band = Geo.box(0.06, 1.05, 12.4, [0.06, 0.09, 0.12]);
        var bm = Mat.create(); bm[12] = (s ? 1 : -1) * 5.02; bm[13] = y;
        mb.append(band, bm);
      }
      for (var e = 0; e < 2; e++) {
        var band2 = Geo.box(8.6, 1.05, 0.06, [0.06, 0.09, 0.12]);
        var bm2 = Mat.create(); bm2[14] = (e ? 1 : -1) * 7.02; bm2[13] = y;
        mb.append(band2, bm2);
      }
    }
    // Parapet.
    var cap = Geo.box(10.4, 0.42, 14.4, [0.42, 0.42, 0.44]);
    var cm = Mat.create(); cm[13] = 8.1;
    mb.append(cap, cm);
    mb.computeNormals();
    return mb;
  }, MAT_ROUGH([1, 1, 1], 0.80, 0.08),
     { collide: true, half: [5.0, 4.2, 7.0], offset: [0, 4.2, 0] });

  definePropType('warehouse', function () {
    var mb = new Geo.MeshBuilder();
    var body = Geo.box(18, 7, 30, [1, 1, 1]);
    var m = Mat.create(); m[13] = 3.5;
    mb.append(body, m);
    // Shallow pitched roof.
    var roof = Geo.taperedBox(18.6, 0.3, 2.0, 0.3, 30.6, [0.36, 0.38, 0.41]);
    var rm = Mat.create();
    Mat.rotX(rm, Math.PI / 2);
    rm[13] = 7.6;
    mb.append(roof, rm);
    for (var i = -4; i <= 4; i++) {
      var rib = Geo.box(0.10, 6.6, 0.16, [0.52, 0.53, 0.56]);
      var a = Mat.create(); a[12] = 9.06; a[13] = 3.5; a[14] = i * 3.2;
      mb.append(rib, a);
      var b = Mat.create(); b[12] = -9.06; b[13] = 3.5; b[14] = i * 3.2;
      mb.append(rib, b);
    }
    mb.computeNormals();
    return mb;
  }, MAT_ROUGH([1, 1, 1], 0.74, 0.20),
     { collide: true, half: [9.0, 3.6, 15.0], offset: [0, 3.6, 0] });

  definePropType('ramp', function () {
    // A 3.2 m tall wedge, 12 m long. Local origin at the low end, on grade.
    var mb = new Geo.MeshBuilder();
    var w = 5.0, L = 12.0, h = 3.2;
    var col = [0.42, 0.43, 0.46];
    var v = [];
    function V4(x, y, z) { return mb.vert(x, y, z, 0, 1, 0, (x / w) + 0.5, z / L, col); }
    var a0 = V4(-w / 2, 0, -L / 2), a1 = V4(w / 2, 0, -L / 2);
    var a2 = V4(w / 2, h, L / 2), a3 = V4(-w / 2, h, L / 2);
    mb.quad(a0, a1, a2, a3);                      // ramp surface
    var b0 = V4(-w / 2, 0, -L / 2), b1 = V4(w / 2, 0, -L / 2);
    var b2 = V4(w / 2, 0, L / 2), b3 = V4(-w / 2, 0, L / 2);
    mb.quad(b3, b2, b1, b0);                      // underside
    var c0 = V4(-w / 2, 0, L / 2), c1 = V4(w / 2, 0, L / 2);
    var c2 = V4(w / 2, h, L / 2), c3 = V4(-w / 2, h, L / 2);
    mb.quad(c0, c1, c2, c3);                      // back face
    var d0 = V4(w / 2, 0, -L / 2), d1 = V4(w / 2, 0, L / 2);
    var d2 = V4(w / 2, h, L / 2);
    mb.tri(d0, d1, d2);
    var e0 = V4(-w / 2, 0, -L / 2), e1 = V4(-w / 2, h, L / 2), e2 = V4(-w / 2, 0, L / 2);
    mb.tri(e0, e1, e2);
    mb.computeNormals();
    return mb;
  }, MAT_ROUGH([1, 1, 1], 0.70, 0.05),
     { collide: true, ramp: true, half: [2.5, 0.35, 6.2], offset: [0, 0, 0], rampAngle: Math.atan2(3.2, 12.0), drivable: true });

  definePropType('lightpole', function () {
    var mb = new Geo.MeshBuilder();
    var pole = Geo.cylinder(0.09, 0.14, 9.0, 8, [0.30, 0.31, 0.33], true);
    var m = Mat.create(); m[13] = 4.5;
    mb.append(pole, m);
    var arm = Geo.box(0.12, 0.12, 1.6, [0.30, 0.31, 0.33]);
    var am = Mat.create(); am[13] = 8.9; am[14] = 0.8;
    mb.append(arm, am);
    var head = Geo.roundedBox(0.44, 0.16, 0.80, 0.05, [0.84, 0.84, 0.80], 2);
    var hm = Mat.create(); hm[13] = 8.78; hm[14] = 1.5;
    mb.append(head, hm);
    mb.computeNormals();
    return mb;
  }, MAT_ROUGH([1, 1, 1], 0.55, 0.60),
     { collide: true, half: [0.16, 4.5, 0.16], offset: [0, 4.5, 0] });

  definePropType('rock', function () {
    var mb = Geo.sphere(1.0, 10, 7, [1, 1, 1]);
    // Perturb the sphere into something that reads as stone.
    var rnd = M.rng(4242);
    for (var i = 0; i < mb.pos.length; i += 3) {
      var s = 0.72 + rnd() * 0.5;
      mb.pos[i] *= s * 1.25;
      mb.pos[i + 1] *= s * 0.78;
      mb.pos[i + 2] *= s * 1.1;
      if (mb.pos[i + 1] < 0) mb.pos[i + 1] *= 0.35;
    }
    mb.computeNormals();
    mb.translate(0, 0.45, 0);
    return mb;
  }, MAT_ROUGH([0.34, 0.33, 0.31], 0.92, 0.0),
     { collide: true, half: [0.95, 0.60, 0.85], offset: [0, 0.55, 0] });

  definePropType('guardrail', function () {
    var mb = new Geo.MeshBuilder();
    var post = Geo.box(0.10, 0.85, 0.12, [0.42, 0.43, 0.45]);
    var pm = Mat.create(); pm[13] = 0.425;
    mb.append(post, pm);
    var rail = Geo.box(0.06, 0.32, 4.0, [0.70, 0.71, 0.74]);
    var rm = Mat.create(); rm[12] = 0.07; rm[13] = 0.72;
    mb.append(rail, rm);
    mb.computeNormals();
    return mb;
  }, MAT_ROUGH([1, 1, 1], 0.45, 0.75),
     { collide: true, half: [0.12, 0.45, 2.0], offset: [0.05, 0.55, 0], restitution: 0.2 });

  definePropType('sign', function () {
    var mb = new Geo.MeshBuilder();
    var post = Geo.cylinder(0.05, 0.06, 2.4, 6, [0.40, 0.41, 0.43], true);
    var m = Mat.create(); m[13] = 1.2;
    mb.append(post, m);
    var board = Geo.box(1.30, 0.80, 0.06, [0.88, 0.89, 0.90]);
    var bm = Mat.create(); bm[13] = 2.30;
    mb.append(board, bm);
    mb.computeNormals();
    return mb;
  }, MAT_ROUGH([1, 1, 1], 0.55, 0.25));

  definePropType('haybale', function () {
    var mb = Geo.cylinder(0.62, 0.62, 1.3, 12, [0.72, 0.62, 0.30], true);
    var m = Mat.create();
    Mat.rotZ(m, Math.PI / 2);
    m[13] = 0.62;
    var out = new Geo.MeshBuilder();
    out.append(mb, m);
    return out;
  }, MAT_ROUGH([1, 1, 1], 0.96, 0.0),
     { collide: true, half: [0.68, 0.62, 0.64], offset: [0, 0.62, 0], soft: true, restitution: 0.1 });

  /* --------------------------------------------------------------- World */

  function World(terrain) {
    this.terrain = terrain;
    this.instances = {};      // type -> { matrices: [], tints: [] }
    this.colliders = [];
    this.drivables = [];
    this.props = [];          // built render batches
    this.env = null;
    this.water = null;
    this.spawns = [];
    this._m = Mat.create();
    this._t = Mat.create();
  }

  World.prototype.add = function (type, x, y, z, yaw, scale, tint, opts) {
    opts = opts || {};
    var proto = PROTO[type];
    if (!proto) throw new Error('unknown prop type: ' + type);
    if (!this.instances[type]) this.instances[type] = { matrices: [], tints: [] };
    var sx = scale, sy = scale, sz = scale;
    if (scale && scale.length === 3) { sx = scale[0]; sy = scale[1]; sz = scale[2]; }
    else if (!scale) { sx = sy = sz = 1; }

    var m = Mat.create();
    var pitch = opts.pitch || 0;
    var roll = opts.roll || 0;
    Mat.fromEulerYXZ(m, yaw || 0, pitch, roll);
    // Bake the scale into the basis columns.
    m[0] *= sx; m[1] *= sx; m[2] *= sx;
    m[4] *= sy; m[5] *= sy; m[6] *= sy;
    m[8] *= sz; m[9] *= sz; m[10] *= sz;
    m[12] = x; m[13] = y; m[14] = z;

    var inst = this.instances[type];
    for (var i = 0; i < 16; i++) inst.matrices.push(m[i]);
    var t = tint || [1, 1, 1];
    inst.tints.push(t[0], t[1], t[2]);

    var po = proto.opts;
    if (po.collide && opts.collide !== false) {
      var off = po.offset || [0, 0, 0];
      var half = [po.half[0] * sx, po.half[1] * sy, po.half[2] * sz];
      var cm = Mat.create();
      Mat.copy(cm, m);
      // Ramps: tilt the collider so its top face is the driving surface.
      if (po.ramp) {
        var tilt = Mat.create();
        Mat.rotX(tilt, -po.rampAngle);
        var trans = Mat.create();
        Mat.fromTranslation(trans, [off[0] * sx, (po.half[1] * sy), off[2] * sz]);
        Mat.mul(cm, cm, tilt);
        Mat.mul(cm, cm, trans);
      } else {
        var tr = Mat.create();
        Mat.fromTranslation(tr, [off[0], off[1], off[2]]);
        Mat.mul(cm, cm, tr);
      }
      // Strip the scale back out of the rotation part for the inverse.
      var basis = Mat.create();
      Mat.copy(basis, cm);
      Mat.orthonormalize(basis);
      basis[12] = cm[12]; basis[13] = cm[13]; basis[14] = cm[14];
      var inv = Mat.create();
      Mat.invertRigid(inv, basis);
      var rad = Math.sqrt(half[0] * half[0] + half[1] * half[1] + half[2] * half[2]);
      var col = {
        center: [basis[12], basis[13], basis[14]],
        half: half,
        mat: basis,
        inv: inv,
        radiusSq: (rad + 1.2) * (rad + 1.2),
        friction: po.friction !== undefined ? po.friction : 0.85,
        restitution: po.restitution !== undefined ? po.restitution : 0.15,
        soft: !!po.soft,
        drivable: !!po.drivable || !!po.ramp
      };
      this.colliders.push(col);
      if (col.drivable) this.drivables.push(col);
    }
    return this;
  };

  // Scatter props over an area, skipping steep ground, roads and water.
  World.prototype.scatter = function (type, count, opts) {
    opts = opts || {};
    var rnd = M.rng(opts.seed || 991);
    var t = this.terrain;
    var minR = opts.minRadius || 0;
    var maxR = opts.maxRadius || t.half * 0.95;
    var cx = opts.cx || 0, cz = opts.cz || 0;
    var maxSlope = opts.maxSlope !== undefined ? opts.maxSlope : 0.30;
    var minY = opts.minY !== undefined ? opts.minY : -1e9;
    var maxY = opts.maxY !== undefined ? opts.maxY : 1e9;
    var roadClear = opts.roadClear !== undefined ? opts.roadClear : 9;
    var placed = 0, tries = 0;
    while (placed < count && tries < count * 40) {
      tries++;
      var a = rnd() * Math.PI * 2;
      var r = minR + Math.sqrt(rnd()) * (maxR - minR);
      var x = cx + Math.cos(a) * r;
      var z = cz + Math.sin(a) * r;
      if (Math.abs(x) > t.half - 6 || Math.abs(z) > t.half - 6) continue;
      var y = t.height(x, z);
      if (y < minY || y > maxY) continue;
      if (y < t.waterLevel + 0.6) continue;
      if (t.slopeAt(x, z) > maxSlope) continue;
      if (roadClear > 0) {
        var road = t.roadAt(x, z);
        if (road && road.w > 0.001) continue;
        // Also keep a margin either side of the carriageway.
        var near = false;
        for (var k = 0; k < 4 && !near; k++) {
          var ang = k * Math.PI / 2;
          var rr = t.roadAt(x + Math.cos(ang) * roadClear, z + Math.sin(ang) * roadClear);
          if (rr && rr.w > 0.001) near = true;
        }
        if (near) continue;
      }
      var scale = opts.scale ? (opts.scale[0] + rnd() * (opts.scale[1] - opts.scale[0])) : 1;
      var tint = null;
      if (opts.tintRange) {
        var tv = opts.tintRange[0] + rnd() * (opts.tintRange[1] - opts.tintRange[0]);
        tint = [tv, tv * (0.95 + rnd() * 0.1), tv * (0.9 + rnd() * 0.12)];
      }
      this.add(type, x, y, z, rnd() * Math.PI * 2, scale, tint, { collide: opts.collide !== false });
      placed++;
    }
    return this;
  };

  // Run a line of props (guardrails, barrier walls, cone chicanes).
  World.prototype.line = function (type, from, to, spacing, opts) {
    opts = opts || {};
    var dx = to[0] - from[0], dz = to[2] - from[2];
    var len = Math.hypot(dx, dz);
    var n = Math.max(1, Math.round(len / spacing));
    var yaw = Math.atan2(dx, dz) + (opts.yawOffset || 0);
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var x = from[0] + dx * t;
      var z = from[2] + dz * t;
      var y = opts.y !== undefined ? opts.y : this.terrain.height(x, z);
      this.add(type, x, y, z, yaw, opts.scale || 1, opts.tint, opts);
    }
    return this;
  };

  // Ring of props around a point — arena walls, roundabouts.
  World.prototype.ring = function (type, cx, cz, radius, count, opts) {
    opts = opts || {};
    for (var i = 0; i < count; i++) {
      var a = (i / count) * Math.PI * 2;
      var x = cx + Math.cos(a) * radius;
      var z = cz + Math.sin(a) * radius;
      var y = opts.y !== undefined ? opts.y : this.terrain.height(x, z);
      this.add(type, x, y, z, -a + (opts.yawOffset || 0), opts.scale || 1, opts.tint, opts);
    }
    return this;
  };

  /* ------------------------------------------------------- broadphase ---
     The solver runs at several hundred hertz, so testing every node against
     every collider is not affordable. Both collider sets get a uniform grid
     and callers work from a short candidate list instead.                 */

  function Grid(items, cell, half) {
    this.cell = cell;
    this.half = half;
    this.res = Math.max(1, Math.ceil((half * 2) / cell) + 1);
    this.buckets = new Array(this.res * this.res);
    this.stamp = new Int32Array(items.length);
    this.tick = 0;
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      var reach = Math.sqrt(c.radiusSq);
      var x0 = this.cellIndex(c.center[0] - reach), x1 = this.cellIndex(c.center[0] + reach);
      var z0 = this.cellIndex(c.center[2] - reach), z1 = this.cellIndex(c.center[2] + reach);
      for (var gz = z0; gz <= z1; gz++) {
        for (var gx = x0; gx <= x1; gx++) {
          var k = gz * this.res + gx;
          if (!this.buckets[k]) this.buckets[k] = [];
          this.buckets[k].push(i);
        }
      }
    }
  }
  Grid.prototype.cellIndex = function (v) {
    var i = Math.floor((v + this.half) / this.cell);
    if (i < 0) i = 0;
    if (i >= this.res) i = this.res - 1;
    return i;
  };
  // Collects unique item indices overlapping the query disc into `out`.
  Grid.prototype.query = function (x, z, radius, out) {
    out.length = 0;
    var t = ++this.tick;
    var x0 = this.cellIndex(x - radius), x1 = this.cellIndex(x + radius);
    var z0 = this.cellIndex(z - radius), z1 = this.cellIndex(z + radius);
    for (var gz = z0; gz <= z1; gz++) {
      for (var gx = x0; gx <= x1; gx++) {
        var b = this.buckets[gz * this.res + gx];
        if (!b) continue;
        for (var i = 0; i < b.length; i++) {
          var id = b[i];
          if (this.stamp[id] === t) continue;
          this.stamp[id] = t;
          out.push(id);
        }
      }
    }
    return out;
  };

  World.prototype.buildGrids = function () {
    var half = this.terrain.half + 40;
    this.colliderGrid = new Grid(this.colliders, 18, half);
    this.drivableGrid = new Grid(this.drivables, 18, half);
    this._qIds = [];
    this._qOut = [];
    this._rIds = [];
  };

  // Static colliders within `radius` of a point. The returned array is
  // reused, so consume it before the next call.
  World.prototype.nearColliders = function (x, z, radius) {
    if (!this.colliderGrid) this.buildGrids();
    var ids = this.colliderGrid.query(x, z, radius, this._qIds);
    var out = this._qOut;
    out.length = 0;
    for (var i = 0; i < ids.length; i++) out.push(this.colliders[ids[i]]);
    return out;
  };

  /* Spawn points taken from a road centreline, facing along it. Far more
     reliable than hand-placed coordinates, which drift out of date as soon
     as the terrain generator changes. */
  World.prototype.spawnsFromRoad = function (road, fractions, lateral) {
    var pts = road && road.points;
    if (!pts || pts.length < 4) return [];
    var out = [];
    for (var i = 0; i < fractions.length; i++) {
      var idx = Math.max(1, Math.min(pts.length - 2,
        Math.round(fractions[i] * (pts.length - 1))));
      var a = pts[idx], b = pts[idx + 1];
      var dx = b[0] - a[0], dz = b[2] - a[2];
      var len = Math.hypot(dx, dz) || 1;
      var off = (lateral && lateral[i]) || 0;
      // Offset sideways along the road normal, for side-by-side grids.
      var nx = dz / len, nz = -dx / len;
      out.push({
        pos: [a[0] + nx * off, a[1], a[2] + nz * off],
        yaw: Math.atan2(dx / len, dz / len)
      });
    }
    return out;
  };

  /* Height of the topmost drivable collider surface directly above/below a
     point — lets wheels roll onto ramps, containers and platforms. */
  var _ro = new Float32Array(3), _rd = new Float32Array(3);
  World.prototype.rayHeight = function (x, z, fromY) {
    if (!this.drivableGrid) this.buildGrids();
    var best = -1e9;
    var startY = fromY + 4.0;
    var ids = this.drivableGrid.query(x, z, 0.5, this._rIds);
    for (var n = 0; n < ids.length; n++) {
      var c = this.drivables[ids[n]];
      var ddx = x - c.center[0], ddz = z - c.center[2];
      var reach = Math.sqrt(c.radiusSq);
      if (ddx * ddx + ddz * ddz > reach * reach) continue;
      // Transform the downward ray into the box's frame.
      _ro[0] = x; _ro[1] = startY; _ro[2] = z;
      V.xformM4(_ro, _ro, c.inv);
      _rd[0] = 0; _rd[1] = -1; _rd[2] = 0;
      V.xformDir(_rd, _rd, c.inv);
      var tmin = -Infinity, tmax = Infinity;
      var ok = true;
      for (var a = 0; a < 3 && ok; a++) {
        var o = _ro[a], d = _rd[a], h = c.half[a];
        if (Math.abs(d) < 1e-7) {
          if (o < -h || o > h) ok = false;
        } else {
          var t1 = (-h - o) / d, t2 = (h - o) / d;
          if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) ok = false;
        }
      }
      if (!ok || tmax < 0) continue;
      var t = tmin >= 0 ? tmin : 0;
      var hitY = startY - t;
      if (hitY > best && hitY <= startY) best = hitY;
    }
    return best;
  };

  // Turn the accumulated instance lists into GPU batches.
  World.prototype.finalize = function () {
    this.buildGrids();
    this.props = [];
    for (var type in this.instances) {
      var inst = this.instances[type];
      if (!inst.matrices.length) continue;
      var proto = PROTO[type];
      if (!proto.geometry) {
        proto.geometry = proto.factory().toGeometry();
      }
      this.props.push({
        type: type,
        geometry: proto.geometry,
        material: proto.material,
        matrices: new Float32Array(inst.matrices),
        tints: new Float32Array(inst.tints),
        count: inst.matrices.length / 16
      });
    }
    return this;
  };

  World.prototype.dispose = function () {
    this.instances = {};
    this.colliders = [];
    this.drivables = [];
    this.props = [];
    this.colliderGrid = null;
    this.drivableGrid = null;
  };

  // Geometry is cached on the prototype and shared across map loads.
  World.resetGeometryCache = function () {
    for (var k in PROTO) {
      if (PROTO[k].geometry) { PROTO[k].geometry.dispose(); PROTO[k].geometry = null; }
    }
  };

  B.World = World;
  B.PROP_TYPES = PROTO;

})();
