/* =========================================================================
   BeamDrive Mobile — vehicle construction
   A car is described by a handful of longitudinal "stations". From those we
   derive (a) the node/beam lattice the solver runs on and (b) the lofted
   body shell, which is then skinned to the lattice so the visible panels
   crumple with the structure.

   Suspension is real geometry, not a fudge: two stiff lower-arm beams pin
   the hub laterally and longitudinally while leaving one rotational degree
   of freedom, and a soft strut beam is the spring/damper working along it.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M, V = M.v3, Mat = M.m4, Geo = B.Geo;

  /* ------------------------------------------------- station interpolation */

  var STATION_KEYS = ['floorY', 'sillW', 'sillY', 'beltW', 'beltY', 'roofW', 'roofY'];

  function catmull(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  // Resample the key stations into `count` smooth sections along Z.
  function resampleStations(keys, count) {
    var out = [];
    var n = keys.length;
    var zMin = keys[0].z, zMax = keys[n - 1].z;
    // Build a normalized arc parameter from the key z positions.
    for (var s = 0; s < count; s++) {
      var t = s / (count - 1);
      var z = zMin + (zMax - zMin) * t;
      // Locate the segment containing z.
      var i = 0;
      while (i < n - 2 && keys[i + 1].z < z) i++;
      var span = keys[i + 1].z - keys[i].z;
      var lt = span > 1e-6 ? (z - keys[i].z) / span : 0;
      lt = M.clamp(lt, 0, 1);
      var k0 = keys[Math.max(i - 1, 0)];
      var k1 = keys[i];
      var k2 = keys[Math.min(i + 1, n - 1)];
      var k3 = keys[Math.min(i + 2, n - 1)];
      var sec = { z: z };
      for (var a = 0; a < STATION_KEYS.length; a++) {
        var key = STATION_KEYS[a];
        sec[key] = catmull(k0[key], k1[key], k2[key], k3[key], lt);
      }
      // Never let an interpolated width go negative.
      sec.sillW = Math.max(sec.sillW, 0.01);
      sec.beltW = Math.max(sec.beltW, 0.01);
      sec.roofW = Math.max(sec.roofW, 0.005);
      sec.roofY = Math.max(sec.roofY, sec.beltY);
      out.push(sec);
    }
    return out;
  }

  /* Closed 16-point silhouette for one station, traced anticlockwise seen
     from +Z. Identical point count on every station so the loft stitches. */
  function sectionOutline(s) {
    var fy = s.floorY, sw = s.sillW, sy = s.sillY;
    var bw = s.beltW, by = s.beltY, rw = s.roofW, ry = s.roofY;
    var shoulderY = by + (ry - by) * 0.42;
    var shoulderW = rw + (bw - rw) * 0.58;
    var pts = [
      [0, fy],
      [sw * 0.62, fy],
      [sw, fy + (sy - fy) * 0.42],
      [bw * 0.985, sy + (by - sy) * 0.42],
      [bw, by],
      [shoulderW, shoulderY],
      [rw * 1.02, by + (ry - by) * 0.84],
      [rw * 0.62, ry],
      [0, ry]
    ];
    // Mirror back down the left-hand side (skip the two centreline points).
    var full = pts.slice();
    for (var i = pts.length - 2; i >= 1; i--) full.push([-pts[i][0], pts[i][1]]);
    return full;   // 16 points
  }

  /* --------------------------------------------------------- node lattice */

  // Region codes used for the damage readout in the HUD.
  var REGION = { FRONT: 0, REAR: 1, LEFT: 2, RIGHT: 3, ROOF: 4, FLOOR: 5, WHEEL: 6 };

  function buildLattice(spec) {
    var keys = spec.stations;
    var nStations = keys.length;
    var nodes = [];
    var beams = [];
    var index = {};   // "role_station" -> node index

    var bodyMass = spec.mass;
    // Reserve mass for the drivetrain lumps; spread the rest over the shell.
    var engineMass = bodyMass * 0.20;
    var fuelMass = bodyMass * 0.055;
    var wheelMass = spec.wheel.mass || 26;
    var shellMass = bodyMass - engineMass - fuelMass - wheelMass * 4;
    var perStation = shellMass / (nStations * 5);

    function addNode(role, si, x, y, z, mass, group, opts) {
      opts = opts || {};
      var idx = nodes.length;
      nodes.push({
        p: [x, y, z], m: mass, r: opts.r || 0.045,
        frame: opts.frame !== undefined ? opts.frame : true,
        wheel: !!opts.wheel,
        noCollide: !!opts.noCollide,
        group: group,
        name: role + si
      });
      index[role + '_' + si] = idx;
      return idx;
    }

    var i;
    for (i = 0; i < nStations; i++) {
      var s = keys[i];
      var topW = s.roofY > s.beltY + 0.02 ? s.roofW : s.beltW * 0.80;
      var topY = s.roofY;
      var isCabin = s.roofY > s.beltY + 0.10;
      // The safety cell must not be part of the crumple zone, so the cabin
      // stations are the only ones flagged as frame references.
      var frameRef = isCabin || (i > 0 && i < nStations - 1);
      var sideGroupL = REGION.LEFT, sideGroupR = REGION.RIGHT;
      var endGroup = (i <= 1) ? REGION.REAR : ((i >= nStations - 2) ? REGION.FRONT : -1);

      addNode('fl', i, -s.sillW * 0.82, s.floorY, s.z, perStation,
        endGroup >= 0 ? endGroup : sideGroupL, { frame: frameRef });
      addNode('fc', i, 0, s.floorY, s.z, perStation,
        endGroup >= 0 ? endGroup : REGION.FLOOR, { frame: frameRef });
      addNode('fr', i, s.sillW * 0.82, s.floorY, s.z, perStation,
        endGroup >= 0 ? endGroup : sideGroupR, { frame: frameRef });
      addNode('tl', i, -topW * 0.92, topY, s.z, perStation,
        isCabin ? REGION.ROOF : (endGroup >= 0 ? endGroup : sideGroupL), { frame: frameRef });
      addNode('tr', i, topW * 0.92, topY, s.z, perStation,
        isCabin ? REGION.ROOF : (endGroup >= 0 ? endGroup : sideGroupR), { frame: frameRef });
    }

    // Drivetrain masses: the engine block over its bay, the tank ahead of
    // the rear axle. Both are heavy enough to change how the car crashes.
    var engZ = spec.enginePos !== undefined ? spec.enginePos : keys[nStations - 2].z;
    var engStation = 0;
    for (i = 0; i < nStations; i++) {
      if (Math.abs(keys[i].z - engZ) < Math.abs(keys[engStation].z - engZ)) engStation = i;
    }
    var engIdx = nodes.length;
    nodes.push({
      p: [0, keys[engStation].floorY + 0.30, engZ], m: engineMass, r: 0.14,
      frame: true, group: engStation > nStations * 0.5 ? REGION.FRONT : REGION.REAR,
      name: 'engine'
    });
    var tankStation = 1;
    var tankZ = keys[tankStation].z;
    var tankIdx = nodes.length;
    nodes.push({
      p: [0, keys[tankStation].floorY + 0.24, tankZ], m: fuelMass, r: 0.10,
      frame: true, group: REGION.REAR, name: 'tank'
    });

    /* -------------------------------------------------- beam helpers ---- */
    // Stiffness scales with the mass the beam has to carry so heavy trucks
    // do not wobble and light hatchbacks are not rigid bricks.
    var kScale = bodyMass / 1200;
    var K_STRUCT = 245000 * kScale;
    var K_PANEL = 145000 * kScale;
    var K_BRACE = 82000 * kScale;
    var D_STRUCT = 1500 * kScale;
    var D_PANEL = 820 * kScale;

    function addBeam(a, b, k, d, deform, plastic, brk) {
      if (a === undefined || b === undefined || a === b) return;
      beams.push({
        a: a, b: b, k: k, d: d,
        deform: deform, plastic: plastic, brk: brk
      });
    }

    // Crumple profile: soft nose and tail, rigid passenger cell.
    function zoneFactor(si) {
      var frac = si / (nStations - 1);
      var s2 = keys[si];
      var cabin = s2.roofY > s2.beltY + 0.10;
      if (cabin) return { k: 1.35, deform: 0.16, brk: 1.05 };
      if (frac < 0.20) return { k: 0.60, deform: 0.034, brk: 0.50 };   // tail
      if (frac > 0.78) return { k: 0.52, deform: 0.030, brk: 0.46 };   // nose
      return { k: 1.0, deform: 0.075, brk: 0.72 };
    }

    var roles = ['fl', 'fc', 'fr', 'tl', 'tr'];

    // Lateral ring + cross bracing at every station.
    for (i = 0; i < nStations; i++) {
      var zf = zoneFactor(i);
      var fl = index['fl_' + i], fc = index['fc_' + i], fr = index['fr_' + i];
      var tl = index['tl_' + i], tr = index['tr_' + i];
      addBeam(fl, fc, K_PANEL * zf.k, D_PANEL, zf.deform, 0.40, zf.brk);
      addBeam(fc, fr, K_PANEL * zf.k, D_PANEL, zf.deform, 0.40, zf.brk);
      addBeam(fl, fr, K_BRACE * zf.k, D_PANEL, zf.deform, 0.40, zf.brk);
      addBeam(tl, tr, K_PANEL * zf.k, D_PANEL, zf.deform, 0.40, zf.brk);
      addBeam(fl, tl, K_PANEL * zf.k, D_PANEL, zf.deform, 0.40, zf.brk);
      addBeam(fr, tr, K_PANEL * zf.k, D_PANEL, zf.deform, 0.40, zf.brk);
      addBeam(fl, tr, K_BRACE * zf.k, D_PANEL, zf.deform, 0.40, zf.brk);
      addBeam(fr, tl, K_BRACE * zf.k, D_PANEL, zf.deform, 0.40, zf.brk);
      addBeam(fc, tl, K_BRACE * zf.k, D_PANEL, zf.deform, 0.40, zf.brk);
      addBeam(fc, tr, K_BRACE * zf.k, D_PANEL, zf.deform, 0.40, zf.brk);
    }

    // Longitudinal rails and the shear diagonals between stations.
    for (i = 0; i < nStations - 1; i++) {
      var z0 = zoneFactor(i), z1 = zoneFactor(i + 1);
      var kf = Math.min(z0.k, z1.k);
      var df = Math.min(z0.deform, z1.deform);
      var bf = Math.min(z0.brk, z1.brk);
      for (var r = 0; r < roles.length; r++) {
        var ra = index[roles[r] + '_' + i];
        var rb = index[roles[r] + '_' + (i + 1)];
        addBeam(ra, rb, K_STRUCT * kf, D_STRUCT, df, 0.42, bf);
      }
      // Diagonals: floor plane, roof plane and both flanks.
      addBeam(index['fl_' + i], index['fc_' + (i + 1)], K_BRACE * kf, D_PANEL, df, 0.42, bf);
      addBeam(index['fc_' + i], index['fl_' + (i + 1)], K_BRACE * kf, D_PANEL, df, 0.42, bf);
      addBeam(index['fc_' + i], index['fr_' + (i + 1)], K_BRACE * kf, D_PANEL, df, 0.42, bf);
      addBeam(index['fr_' + i], index['fc_' + (i + 1)], K_BRACE * kf, D_PANEL, df, 0.42, bf);
      addBeam(index['tl_' + i], index['tr_' + (i + 1)], K_BRACE * kf, D_PANEL, df, 0.42, bf);
      addBeam(index['tr_' + i], index['tl_' + (i + 1)], K_BRACE * kf, D_PANEL, df, 0.42, bf);
      addBeam(index['fl_' + i], index['tl_' + (i + 1)], K_BRACE * kf, D_PANEL, df, 0.42, bf);
      addBeam(index['tl_' + i], index['fl_' + (i + 1)], K_BRACE * kf, D_PANEL, df, 0.42, bf);
      addBeam(index['fr_' + i], index['tr_' + (i + 1)], K_BRACE * kf, D_PANEL, df, 0.42, bf);
      addBeam(index['tr_' + i], index['fr_' + (i + 1)], K_BRACE * kf, D_PANEL, df, 0.42, bf);
    }

    // Long-range spine: keeps the whole hull from banana-ing under load but
    // is allowed to yield in a really big hit.
    for (i = 0; i < nStations - 2; i++) {
      addBeam(index['fc_' + i], index['fc_' + (i + 2)], K_STRUCT * 0.7, D_STRUCT, 0.10, 0.30, 0.80);
      addBeam(index['fl_' + i], index['fl_' + (i + 2)], K_STRUCT * 0.5, D_STRUCT, 0.10, 0.30, 0.80);
      addBeam(index['fr_' + i], index['fr_' + (i + 2)], K_STRUCT * 0.5, D_STRUCT, 0.10, 0.30, 0.80);
    }

    // Anchor the drivetrain lumps into the shell.
    function anchor(idx, si, k) {
      addBeam(idx, index['fl_' + si], k, D_STRUCT, 0.22, 0.30, 1.4);
      addBeam(idx, index['fr_' + si], k, D_STRUCT, 0.22, 0.30, 1.4);
      addBeam(idx, index['fc_' + si], k, D_STRUCT, 0.22, 0.30, 1.4);
    }
    anchor(engIdx, engStation, K_STRUCT * 1.1);
    if (engStation + 1 < nStations) anchor(engIdx, engStation + 1, K_STRUCT * 0.7);
    if (engStation - 1 >= 0) anchor(engIdx, engStation - 1, K_STRUCT * 0.7);
    anchor(tankIdx, tankStation, K_STRUCT * 0.8);

    /* --------------------------------------------------------- suspension */
    var wheels = [];
    var axles = [
      { z: spec.frontAxleZ, front: true },
      { z: spec.rearAxleZ, front: false }
    ];
    var trackF = spec.trackFront || spec.track;
    var trackR = spec.trackRear || spec.track;

    for (var ax = 0; ax < 2; ax++) {
      var axle = axles[ax];
      var track = axle.front ? trackF : trackR;
      // Station nearest the axle, and its neighbours fore and aft.
      var near = 0;
      for (i = 0; i < nStations; i++) {
        if (Math.abs(keys[i].z - axle.z) < Math.abs(keys[near].z - axle.z)) near = i;
      }
      var fore = Math.min(near + 1, nStations - 1);
      var aft = Math.max(near - 1, 0);
      if (fore === near) fore = Math.max(near - 1, 0);
      if (aft === near) aft = Math.min(near + 1, nStations - 1);

      for (var side = 0; side < 2; side++) {
        var sx = side === 0 ? -1 : 1;
        var hubX = sx * track * 0.5;
        var hubY = spec.wheel.radius;
        var hubIdx = nodes.length;
        nodes.push({
          p: [hubX, hubY, axle.z], m: wheelMass, r: 0.10,
          frame: false, wheel: true, noCollide: true,
          group: REGION.WHEEL, name: 'hub' + ax + side
        });

        // Two lower arms to inboard floor nodes fore and aft of the hub.
        // Their shared axis is roughly longitudinal, so the remaining
        // freedom is the vertical arc a real wishbone sweeps.
        var armA = index['fc_' + aft];
        var armB = index['fc_' + fore];
        var K_ARM = 210000 * kScale;
        addBeam(hubIdx, armA, K_ARM, 1900 * kScale, 0.12, 0.30, 0.52);
        addBeam(hubIdx, armB, K_ARM, 1900 * kScale, 0.12, 0.30, 0.52);
        // Deliberately no third locating link: the two arms above already
        // pin the hub laterally and longitudinally, and a short beam to the
        // nearby sill would be stretched by every millimetre of travel.

        // The strut: soft, well damped, works along the free arc.
        var topNode = index[(sx < 0 ? 'tl_' : 'tr_') + near];
        var springK = (axle.front ? spec.suspension.frontK : spec.suspension.rearK);
        var springD = (axle.front ? spec.suspension.frontD : spec.suspension.rearD);
        beams.push({
          a: hubIdx, b: topNode,
          k: springK, d: springD,
          deform: 0.55, plastic: 0.10, brk: 0.90,
          isStrut: true
        });

        wheels.push({
          node: hubIdx,
          side: sx,
          front: axle.front,
          steered: axle.front ? 1 : (spec.rearSteer || 0),
          driven: (spec.drivetrain === 'awd') ||
                  (spec.drivetrain === 'fwd' && axle.front) ||
                  (spec.drivetrain === 'rwd' && !axle.front),
          brakeBias: axle.front ? spec.brakes.frontBias : (1 - spec.brakes.frontBias),
          radius: spec.wheel.radius,
          width: spec.wheel.width,
          restLocal: [hubX, hubY, axle.z]
        });
      }
    }

    // Anti-roll bars: tie the two hubs on an axle together through a long,
    // soft beam so body roll loads the outside wheel.
    if (spec.suspension.arbFront > 0) {
      beams.push({
        a: wheels[0].node, b: wheels[1].node,
        k: spec.suspension.arbFront, d: 120, deform: 0.9, plastic: 0.05, brk: 1.6
      });
    }
    if (spec.suspension.arbRear > 0) {
      beams.push({
        a: wheels[2].node, b: wheels[3].node,
        k: spec.suspension.arbRear, d: 120, deform: 0.9, plastic: 0.05, brk: 1.6
      });
    }

    return { nodes: nodes, beams: beams, index: index, wheels: wheels,
             engineNode: engIdx, tankNode: tankIdx, stations: keys };
  }

  /* ------------------------------------------------------------- skinning */

  function SkinnedMesh(meshData, lattice, opts) {
    opts = opts || {};
    this.rest = meshData.position;
    this.positions = new Float32Array(meshData.position);
    this.normals = new Float32Array(meshData.normal);
    this.indices = meshData.indices;
    this.vertexCount = meshData.position.length / 3;
    this.influences = opts.influences || 4;
    this.stiffness = opts.stiffness === undefined ? 1 : opts.stiffness;

    var vc = this.vertexCount, inf = this.influences;
    this.boneIdx = new Int32Array(vc * inf);
    this.boneW = new Float32Array(vc * inf);

    var nodes = lattice.nodes;
    var candidates = [];
    for (var n = 0; n < nodes.length; n++) {
      if (nodes[n].wheel) continue;         // wheels move independently
      candidates.push(n);
    }

    var best = new Array(inf);
    for (var v = 0; v < vc; v++) {
      var vx = this.rest[v * 3], vy = this.rest[v * 3 + 1], vz = this.rest[v * 3 + 2];
      for (var k = 0; k < inf; k++) { best[k] = { i: -1, d: Infinity }; }
      for (var c = 0; c < candidates.length; c++) {
        var ni = candidates[c];
        var p = nodes[ni].p;
        var dx = p[0] - vx, dy = p[1] - vy, dz = p[2] - vz;
        var d2 = dx * dx + dy * dy + dz * dz;
        for (var q = 0; q < inf; q++) {
          if (d2 < best[q].d) {
            for (var w = inf - 1; w > q; w--) { best[w].i = best[w - 1].i; best[w].d = best[w - 1].d; }
            best[q] = { i: ni, d: d2 };
            break;
          }
        }
      }
      var sum = 0, wts = new Array(inf);
      for (var b2 = 0; b2 < inf; b2++) {
        if (best[b2].i < 0) { wts[b2] = 0; continue; }
        // Inverse-square falloff, softened so the nearest node does not
        // completely dominate and produce faceted deformation.
        var wv = 1 / (best[b2].d + 0.045);
        wts[b2] = wv;
        sum += wv;
      }
      for (var b3 = 0; b3 < inf; b3++) {
        this.boneIdx[v * inf + b3] = best[b3].i < 0 ? 0 : best[b3].i;
        this.boneW[v * inf + b3] = sum > 0 ? (wts[b3] / sum) * this.stiffness : 0;
      }
    }

    this.geometry = new B.GL.Geometry({ dynamic: true });
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('normal', this.normals);
    this.geometry.setAttribute('uv', meshData.uv);
    this.geometry.setAttribute('color', meshData.color);
    this.geometry.setIndices(this.indices);
    this.geometry.computeBounds();
    this._dirty = true;
  }

  // Rewrite the vertex buffer from the current node displacements. Local
  // space throughout: the body frame is applied by the model matrix.
  SkinnedMesh.prototype.update = function (body, recomputeNormals) {
    var inf = this.influences;
    var cur = body.curLocal, rest = body.restLocal;
    var pos = this.positions, r = this.rest;
    var bi = this.boneIdx, bw = this.boneW;
    for (var v = 0; v < this.vertexCount; v++) {
      var ox = 0, oy = 0, oz = 0;
      var base = v * inf;
      for (var k = 0; k < inf; k++) {
        var w = bw[base + k];
        if (w === 0) continue;
        var n3 = bi[base + k] * 3;
        ox += (cur[n3] - rest[n3]) * w;
        oy += (cur[n3 + 1] - rest[n3 + 1]) * w;
        oz += (cur[n3 + 2] - rest[n3 + 2]) * w;
      }
      pos[v * 3] = r[v * 3] + ox;
      pos[v * 3 + 1] = r[v * 3 + 1] + oy;
      pos[v * 3 + 2] = r[v * 3 + 2] + oz;
    }
    this.geometry.updateAttribute('position', pos);
    if (recomputeNormals) {
      Geo.recomputeNormals(pos, this.indices, this.normals);
      this.geometry.updateAttribute('normal', this.normals);
    }
  };

  B.SkinnedMesh = SkinnedMesh;

  /* -------------------------------------------------------- shell meshes */

  function buildBodyShell(spec, sections) {
    var lofted = [];
    for (var i = 0; i < sections.length; i++) {
      lofted.push({ z: sections[i].z, pts: sectionOutline(sections[i]) });
    }
    return Geo.loft(lofted, [1, 1, 1], true, 1);
  }

  // Windows are cut as separate panels sitting just inside the greenhouse.
  function buildGlass(spec, sections) {
    var mb = new Geo.MeshBuilder();
    var cabin = [];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].roofY > sections[i].beltY + 0.10) cabin.push(i);
    }
    if (cabin.length < 2) return mb;
    var first = cabin[0], last = cabin[cabin.length - 1];
    var inset = 0.018;

    // Side glass: a strip between the belt line and just under the roof.
    for (var side = 0; side < 2; side++) {
      var sx = side === 0 ? -1 : 1;
      for (var c = first; c < last; c++) {
        var a = sections[c], b = sections[c + 1];
        var aw = (a.roofW + (a.beltW - a.roofW) * 0.42) * sx;
        var bw = (b.roofW + (b.beltW - b.roofW) * 0.42) * sx;
        var ay0 = a.beltY + 0.035, ay1 = a.beltY + (a.roofY - a.beltY) * 0.90;
        var by0 = b.beltY + 0.035, by1 = b.beltY + (b.roofY - b.beltY) * 0.90;
        if (ay1 - ay0 < 0.06) continue;
        var base = mb.vertexCount();
        var nx = sx * (1 - inset);
        mb.vert(aw, ay0, a.z, nx, 0, 0, 0, 0, [1, 1, 1]);
        mb.vert(bw, by0, b.z, nx, 0, 0, 1, 0, [1, 1, 1]);
        mb.vert(bw, by1, b.z, nx, 0, 0, 1, 1, [1, 1, 1]);
        mb.vert(aw, ay1, a.z, nx, 0, 0, 0, 1, [1, 1, 1]);
        if (sx > 0) mb.quad(base, base + 1, base + 2, base + 3);
        else mb.quad(base + 3, base + 2, base + 1, base);
      }
    }

    // Windscreen and backlight: raked panels bridging belt to roof.
    function screen(iA, iB, flip) {
      var a = sections[iA], b = sections[iB];
      var base = mb.vertexCount();
      var aw = a.beltW * 0.90, bw = b.roofW * 0.94;
      var ay = a.beltY + 0.03, by = b.roofY - 0.012;
      var col = [1, 1, 1];
      mb.vert(-aw, ay, a.z, 0, 0, flip ? -1 : 1, 0, 0, col);
      mb.vert(aw, ay, a.z, 0, 0, flip ? -1 : 1, 1, 0, col);
      mb.vert(bw, by, b.z, 0, 0, flip ? -1 : 1, 1, 1, col);
      mb.vert(-bw, by, b.z, 0, 0, flip ? -1 : 1, 0, 1, col);
      if (flip) mb.quad(base + 3, base + 2, base + 1, base);
      else mb.quad(base, base + 1, base + 2, base + 3);
    }
    if (last < sections.length - 1) screen(last + 1, last, false);   // windscreen
    if (first > 0) screen(first - 1, first, true);                   // backlight
    mb.computeNormals();
    return mb;
  }

  // Bumpers, grille, lights, mirrors — the details that sell the silhouette.
  function buildTrim(spec, sections, lights) {
    var mb = new Geo.MeshBuilder();
    var n = sections.length;
    var front = sections[n - 1], rear = sections[0];
    var dark = [0.10, 0.10, 0.11];
    var chrome = [0.62, 0.63, 0.66];

    function place(mesh, x, y, z, ry) {
      var m = Mat.create();
      if (ry) Mat.rotY(m, ry);
      m[12] = x; m[13] = y; m[14] = z;
      mb.append(mesh, m);
    }

    // Bumpers.
    var fbW = front.beltW * 1.96, fbH = 0.17;
    place(Geo.roundedBox(fbW, fbH, 0.22, 0.05, dark, 2),
      0, front.floorY + (front.sillY - front.floorY) * 0.55 + 0.04, front.z - 0.055);
    var rbW = rear.beltW * 1.96;
    place(Geo.roundedBox(rbW, fbH, 0.22, 0.05, dark, 2),
      0, rear.floorY + (rear.sillY - rear.floorY) * 0.55 + 0.04, rear.z + 0.055);

    // Grille.
    place(Geo.roundedBox(front.beltW * 1.20, 0.14, 0.07, 0.025, [0.06, 0.06, 0.07], 2),
      0, front.beltY - 0.10, front.z - 0.035);

    // Side skirts.
    for (var s = 0; s < 2; s++) {
      var sx = s === 0 ? -1 : 1;
      var midZ = (sections[2].z + sections[n - 3].z) * 0.5;
      var len = Math.abs(sections[n - 3].z - sections[2].z);
      place(Geo.box(0.05, 0.10, len, dark),
        sx * sections[Math.floor(n / 2)].sillW * 0.98, sections[Math.floor(n / 2)].floorY + 0.06, midZ);
      // Wing mirrors, mounted at the A-pillar.
      var cabinEnd = n - 2;
      for (var q = n - 1; q >= 0; q--) { if (sections[q].roofY > sections[q].beltY + 0.10) { cabinEnd = q; break; } }
      var cs = sections[Math.min(cabinEnd, n - 2)];
      place(Geo.roundedBox(0.055, 0.075, 0.135, 0.025, dark, 2),
        sx * (cs.beltW + 0.085), cs.beltY + 0.045, cs.z - 0.06);
      place(Geo.box(0.05, 0.035, 0.05, dark),
        sx * (cs.beltW + 0.035), cs.beltY + 0.035, cs.z - 0.06);
      // Door handles.
      place(Geo.roundedBox(0.03, 0.035, 0.115, 0.012, chrome, 2),
        sx * (cs.beltW + 0.012), cs.beltY - 0.045, cs.z - 0.55);
    }

    // Exhaust.
    var exRot = Mat.create();
    Mat.rotX(exRot, Math.PI / 2);
    exRot[12] = rear.beltW * 0.55; exRot[13] = rear.floorY + 0.03; exRot[14] = rear.z + 0.05;
    mb.append(Geo.cylinder(0.038, 0.038, 0.16, 10, chrome, true), exRot);

    mb.computeNormals();

    /* Lights live in their own emissive mesh so they can glow at night. */
    if (lights) {
      var lm = lights;
      var hy = front.beltY - 0.045;
      for (var hs = 0; hs < 2; hs++) {
        var hx = (hs === 0 ? -1 : 1) * front.beltW * 0.70;
        var hm = Mat.create();
        hm[12] = hx; hm[13] = hy; hm[14] = front.z - 0.022;
        lm.append(Geo.roundedBox(0.26, 0.105, 0.05, 0.02, [1.0, 0.97, 0.90], 2), hm);
      }
      var ty = rear.beltY - 0.055;
      for (var ts = 0; ts < 2; ts++) {
        var tx = (ts === 0 ? -1 : 1) * rear.beltW * 0.74;
        var tm = Mat.create();
        tm[12] = tx; tm[13] = ty; tm[14] = rear.z + 0.022;
        lm.append(Geo.roundedBox(0.22, 0.12, 0.05, 0.02, [0.85, 0.06, 0.05], 2), tm);
      }
      lm.computeNormals();
    }

    return mb;
  }

  // Cabin: floor pan, seats, dash, console. The steering wheel and pedals
  // are separate objects because the driver animation drives them.
  function buildInterior(spec, sections) {
    var mb = new Geo.MeshBuilder();
    var n = sections.length;
    var cabinIdx = [];
    for (var i = 0; i < n; i++) if (sections[i].roofY > sections[i].beltY + 0.10) cabinIdx.push(i);
    if (!cabinIdx.length) return mb;
    var cRear = sections[cabinIdx[0]];
    var cFront = sections[cabinIdx[cabinIdx.length - 1]];
    var midZ = (cRear.z + cFront.z) * 0.5;
    var cabinLen = cFront.z - cRear.z;
    var floorY = cFront.floorY + 0.035;
    var trimCol = [0.115, 0.118, 0.128];
    var seatCol = [0.075, 0.078, 0.088];

    function place(mesh, x, y, z, rx, ry) {
      var m = Mat.create();
      var tmp = Mat.create();
      if (ry) Mat.rotY(m, ry);
      if (rx) { Mat.rotX(tmp, rx); Mat.mul(m, m, tmp); }
      m[12] = x; m[13] = y; m[14] = z;
      mb.append(mesh, m);
    }

    // Floor pan and the bulkhead behind the rear seats.
    place(Geo.box(cFront.sillW * 1.70, 0.03, cabinLen + 0.34, trimCol), 0, floorY, midZ);
    place(Geo.box(cFront.sillW * 1.70, 0.34, 0.05, trimCol), 0, floorY + 0.17, cRear.z - 0.06);

    // Dashboard, raked back from the base of the windscreen.
    place(Geo.roundedBox(cFront.beltW * 1.72, 0.17, 0.32, 0.035, trimCol, 2),
      0, cFront.beltY - 0.055, cFront.z - 0.12, 0.26);
    // Instrument binnacle, in front of the driver.
    var dx = (spec.rhd ? 1 : -1) * cFront.beltW * 0.46;
    place(Geo.roundedBox(0.34, 0.11, 0.17, 0.03, [0.045, 0.045, 0.055], 2),
      dx, cFront.beltY - 0.012, cFront.z - 0.26, 0.30);
    // Centre console with gear lever.
    place(Geo.roundedBox(0.20, 0.23, 0.54, 0.03, trimCol, 2), 0, floorY + 0.115, cFront.z - 0.52);
    place(Geo.cylinder(0.013, 0.018, 0.17, 8, [0.14, 0.14, 0.15], true), 0, floorY + 0.29, cFront.z - 0.42);
    place(Geo.sphere(0.033, 10, 8, [0.085, 0.085, 0.095]), 0, floorY + 0.375, cFront.z - 0.42);
    // Handbrake.
    place(Geo.roundedBox(0.035, 0.035, 0.22, 0.014, [0.10, 0.10, 0.11], 2),
      0.085, floorY + 0.26, cFront.z - 0.66, -0.55);

    // Front seats.
    var seatX = cFront.beltW * 0.44;
    var seatZ = cFront.z - 0.78;
    for (var s = 0; s < 2; s++) {
      var sx = (s === 0 ? -1 : 1) * seatX;
      place(Geo.roundedBox(0.44, 0.11, 0.50, 0.05, seatCol, 2), sx, floorY + 0.13, seatZ + 0.10);
      place(Geo.roundedBox(0.44, 0.62, 0.12, 0.05, seatCol, 2), sx, floorY + 0.47, seatZ - 0.16, 0.16);
      place(Geo.roundedBox(0.23, 0.15, 0.10, 0.04, seatCol, 2), sx, floorY + 0.82, seatZ - 0.22);
      place(Geo.roundedBox(0.075, 0.40, 0.11, 0.035, seatCol, 2), sx - 0.185, floorY + 0.43, seatZ - 0.12, 0.16);
      place(Geo.roundedBox(0.075, 0.40, 0.11, 0.035, seatCol, 2), sx + 0.185, floorY + 0.43, seatZ - 0.12, 0.16);
    }
    // Rear bench when there is room for one.
    if (cabinLen > 1.10) {
      place(Geo.roundedBox(cFront.sillW * 1.50, 0.11, 0.44, 0.05, seatCol, 2),
        0, floorY + 0.13, cRear.z + 0.30);
      place(Geo.roundedBox(cFront.sillW * 1.50, 0.54, 0.12, 0.05, seatCol, 2),
        0, floorY + 0.41, cRear.z + 0.06, 0.14);
    }

    // Pedal box.
    for (var p = 0; p < 2; p++) {
      place(Geo.roundedBox(0.075, 0.015, 0.14, 0.006, [0.16, 0.16, 0.17], 1),
        dx + (p === 0 ? 0.075 : -0.075), floorY + 0.075, cFront.z + 0.06, 0.45);
    }

    mb.computeNormals();
    return mb;
  }

  /* The steering wheel is its own object: it has to spin with the input and
     the driver's hands have to track its rim. */
  function buildSteeringWheel(radius) {
    var mb = new Geo.MeshBuilder();
    var rimCol = [0.055, 0.055, 0.062];
    var hubCol = [0.10, 0.10, 0.115];
    // Rim in the XY plane (the wheel's local +Z is its axis).
    var rim = Geo.torus(radius, radius * 0.115, 26, 9, Math.PI * 2, rimCol);
    var rot = Mat.create();
    Mat.rotX(rot, Math.PI / 2);
    mb.append(rim, rot);
    // Three spokes.
    for (var i = 0; i < 3; i++) {
      var a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      var sp = Geo.box(radius * 0.92, 0.022, 0.05, hubCol);
      var m = Mat.create();
      Mat.fromAxisAngle(m, [0, 0, 1], a);
      var off = Mat.create();
      Mat.fromTranslation(off, [radius * 0.46, 0, 0]);
      Mat.mul(m, m, off);
      mb.append(sp, m);
    }
    // Centre boss.
    var boss = Geo.cylinder(radius * 0.26, radius * 0.23, 0.055, 14, hubCol, true);
    var bm = Mat.create();
    Mat.rotX(bm, Math.PI / 2);
    mb.append(boss, bm);
    mb.computeNormals();
    return mb;
  }

  B.buildSteeringWheel = buildSteeringWheel;

  /* ------------------------------------------------------ public assembly */

  function buildVehicle(spec, paintColor) {
    var sections = resampleStations(spec.stations, spec.meshSections || 20);
    var lattice = buildLattice(spec);

    var body = new B.SoftBody({ nodes: lattice.nodes, beams: lattice.beams });
    body.boundRadius = spec.length * 0.62;

    var shellMB = buildBodyShell(spec, sections);
    var glassMB = buildGlass(spec, sections);
    var lightMB = new Geo.MeshBuilder();
    var trimMB = buildTrim(spec, sections, lightMB);
    var interiorMB = buildInterior(spec, sections);

    var parts = [];
    var paint = paintColor || spec.colors[0];

    parts.push({
      name: 'shell',
      skin: new B.SkinnedMesh(shellMB.toData(), lattice, { stiffness: 1.0 }),
      material: {
        type: 1, baseColor: paint.slice(), roughness: 0.30, metallic: 0.55,
        clearcoat: 1.0, opacity: 1
      },
      recomputeNormals: true
    });
    if (glassMB.idx.length) {
      parts.push({
        name: 'glass',
        skin: new B.SkinnedMesh(glassMB.toData(), lattice, { stiffness: 1.0 }),
        material: {
          type: 2, baseColor: [0.08, 0.10, 0.12], roughness: 0.05, metallic: 0,
          clearcoat: 1, opacity: 0.30, transparent: true, doubleSided: true
        },
        recomputeNormals: false
      });
    }
    parts.push({
      name: 'trim',
      skin: new B.SkinnedMesh(trimMB.toData(), lattice, { stiffness: 1.0 }),
      material: {
        type: 0, baseColor: [1, 1, 1], roughness: 0.55, metallic: 0.25, clearcoat: 0.1, opacity: 1
      },
      recomputeNormals: true
    });
    parts.push({
      name: 'lights',
      skin: new B.SkinnedMesh(lightMB.toData(), lattice, { stiffness: 1.0 }),
      material: {
        type: 4, baseColor: [1, 1, 1], emissive: [0.05, 0.05, 0.05], roughness: 0.2,
        metallic: 0, opacity: 1
      },
      recomputeNormals: false,
      isLights: true
    });
    parts.push({
      name: 'interior',
      skin: new B.SkinnedMesh(interiorMB.toData(), lattice, { stiffness: 1.0 }),
      material: {
        type: 0, baseColor: [1, 1, 1], roughness: 0.82, metallic: 0.05, clearcoat: 0, opacity: 1
      },
      recomputeNormals: true
    });

    // Wheels are rigid meshes parented to their hub nodes.
    var wheelGeom = Geo.wheel(spec.wheel.radius, spec.wheel.width,
      spec.wheel.rim, spec.wheel.spokes || 5,
      [0.035, 0.035, 0.040], spec.wheel.rimColor || [0.58, 0.60, 0.64]).toGeometry();

    // Where the driver sits and what they hold on to. Everything the
    // driver rig needs is derived from the frontmost greenhouse station.
    var cFront = null, cRear = null;
    for (var ci = sections.length - 1; ci >= 0; ci--) {
      if (sections[ci].roofY > sections[ci].beltY + 0.10) { cFront = sections[ci]; break; }
    }
    for (var cj = 0; cj < sections.length; cj++) {
      if (sections[cj].roofY > sections[cj].beltY + 0.10) { cRear = sections[cj]; break; }
    }
    if (!cFront) cFront = sections[Math.floor(sections.length / 2)];
    if (!cRear) cRear = cFront;
    var driverX = (spec.rhd ? 1 : -1) * cFront.beltW * 0.44;
    var floorY = cFront.floorY + 0.035;
    var seatZ = cFront.z - 0.78;
    var wheelRadius = spec.steeringWheelRadius || 0.175;
    var rig = {
      hipPos: [driverX, floorY + 0.26, seatZ + 0.02],
      wheelPos: [driverX, cFront.beltY - 0.045, cFront.z - 0.40],
      wheelRadius: wheelRadius,
      wheelTilt: 0.38,
      pedalPos: [driverX, floorY + 0.09, cFront.z + 0.04],
      shifterPos: [0, floorY + 0.375, cFront.z - 0.42],
      eyePos: [driverX, cFront.beltY + (cFront.roofY - cFront.beltY) * 0.40, seatZ + 0.14],
      cabinRoofY: cFront.roofY,
      cabinFrontZ: cFront.z,
      cabinRearZ: cRear.z,
      floorY: floorY
    };

    return {
      spec: spec,
      body: body,
      lattice: lattice,
      parts: parts,
      wheels: lattice.wheels,
      wheelGeometry: wheelGeom,
      sections: sections,
      rig: rig,
      paint: paint
    };
  }

  B.buildVehicle = buildVehicle;
  B.REGION = REGION;
  B.resampleStations = resampleStations;

})();
