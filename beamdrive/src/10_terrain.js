/* =========================================================================
   BeamDrive Mobile — terrain + roads
   A heightfield carries the landscape; roads are separate smooth ribbons
   whose surface the height query blends in exactly, so the car drives on
   the road you can see rather than on a stair-stepped approximation of it.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M, V = M.v3;

  var SURF = { GRASS: 0, ROAD: 1, DIRT: 2, ROCK: 3, SAND: 4, SNOW: 5 };
  var SURF_GRIP = [0.72, 1.00, 0.68, 0.80, 0.55, 0.42];

  /* ------------------------------------------------------------ Terrain */

  function Terrain(opts) {
    this.size = opts.size || 720;
    this.res = opts.res || 176;
    this.half = this.size / 2;
    this.cell = this.size / this.res;
    this.invCell = 1 / this.cell;
    var n = (this.res + 1) * (this.res + 1);
    this.heights = new Float32Array(n);
    this.surf = new Uint8Array(n);
    this.waterLevel = opts.waterLevel !== undefined ? opts.waterLevel : -1000;
    this.baseSurface = opts.baseSurface !== undefined ? opts.baseSurface : SURF.GRASS;

    // Road lookup.
    this.roadSegs = [];
    this.roadGrid = null;
    this.roadGridCell = 10;
    this.roadGridRes = 0;
  }

  Terrain.prototype.idx = function (gx, gz) {
    return gz * (this.res + 1) + gx;
  };

  Terrain.prototype.generate = function (fn) {
    var r = this.res, h = this.half, c = this.cell;
    for (var gz = 0; gz <= r; gz++) {
      var z = -h + gz * c;
      for (var gx = 0; gx <= r; gx++) {
        var x = -h + gx * c;
        var v = fn(x, z);
        var i = gz * (r + 1) + gx;
        if (typeof v === 'number') {
          this.heights[i] = v;
          this.surf[i] = this.baseSurface;
        } else {
          this.heights[i] = v.y;
          this.surf[i] = v.s === undefined ? this.baseSurface : v.s;
        }
      }
    }
    return this;
  };

  // Raw heightfield sample (bilinear), ignoring roads.
  Terrain.prototype.rawHeight = function (x, z) {
    var fx = (x + this.half) * this.invCell;
    var fz = (z + this.half) * this.invCell;
    var gx = Math.floor(fx), gz = Math.floor(fz);
    if (gx < 0) { gx = 0; fx = 0; }
    if (gz < 0) { gz = 0; fz = 0; }
    if (gx >= this.res) { gx = this.res - 1; fx = this.res; }
    if (gz >= this.res) { gz = this.res - 1; fz = this.res; }
    var tx = fx - gx, tz = fz - gz;
    var r1 = this.res + 1;
    var i00 = gz * r1 + gx;
    var h00 = this.heights[i00];
    var h10 = this.heights[i00 + 1];
    var h01 = this.heights[i00 + r1];
    var h11 = this.heights[i00 + r1 + 1];
    var a = h00 + (h10 - h00) * tx;
    var b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  };

  /* ----------------------------------------------------------- roads ---- */

  /* Add a road from a list of control points. The centreline is smoothed
     with Catmull-Rom, sampled at `step` metres, and each sample stores the
     surface frame so the height query can reconstruct camber exactly. */
  Terrain.prototype.addRoad = function (controls, opts) {
    opts = opts || {};
    var width = opts.width || 8;
    var step = opts.step || 3.0;
    var camber = opts.camber || 0.0;
    var shoulder = opts.shoulder !== undefined ? opts.shoulder : 3.5;
    var followTerrain = opts.followTerrain !== false;
    var smooth = opts.smooth !== undefined ? opts.smooth : 0.55;
    var surface = opts.surface !== undefined ? opts.surface : SURF.ROAD;
    var closed = !!opts.closed;

    var pts = [];
    var n = controls.length;
    var segCount = closed ? n : n - 1;
    for (var i = 0; i < segCount; i++) {
      var p0 = controls[(i - 1 + n) % n];
      var p1 = controls[i % n];
      var p2 = controls[(i + 1) % n];
      var p3 = controls[(i + 2) % n];
      if (!closed) {
        p0 = controls[Math.max(i - 1, 0)];
        p2 = controls[Math.min(i + 1, n - 1)];
        p3 = controls[Math.min(i + 2, n - 1)];
      }
      var segLen = Math.hypot(p2[0] - p1[0], p2[2] - p1[2]);
      var divs = Math.max(2, Math.ceil(segLen / step));
      for (var d = 0; d < divs; d++) {
        var t = d / divs;
        var t2 = t * t, t3 = t2 * t;
        var px = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        var pz = 0.5 * ((2 * p1[2]) + (-p0[2] + p2[2]) * t +
          (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 +
          (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3);
        var py;
        if (p1[1] !== undefined && !followTerrain) {
          py = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        } else {
          py = this.rawHeight(px, pz) + (opts.lift || 0);
        }
        // Keep the carriageway above a floor — a coastal road that follows
        // the terrain exactly will happily dive under the waterline.
        if (opts.minY !== undefined && py < opts.minY) py = opts.minY;
        pts.push([px, py, pz]);
      }
    }
    if (closed && pts.length) pts.push(pts[0].slice());
    else if (pts.length) {
      var last = controls[n - 1];
      var ly = followTerrain ? this.rawHeight(last[0], last[2]) + (opts.lift || 0) : last[1];
      if (opts.minY !== undefined && ly < opts.minY) ly = opts.minY;
      pts.push([last[0], ly, last[2]]);
    }

    // Longitudinal smoothing: a road should not follow every terrain bump.
    if (followTerrain && smooth > 0) {
      var passes = Math.max(1, Math.round(smooth * 12));
      for (var pass = 0; pass < passes; pass++) {
        for (var k = 1; k < pts.length - 1; k++) {
          pts[k][1] = pts[k][1] * (1 - smooth) + (pts[k - 1][1] + pts[k + 1][1]) * 0.5 * smooth;
        }
      }
    }

    // Build segments with their frames.
    var startIndex = this.roadSegs.length;
    for (var s = 0; s < pts.length - 1; s++) {
      var a = pts[s], b = pts[s + 1];
      var dx = b[0] - a[0], dz = b[2] - a[2];
      var len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      this.roadSegs.push({
        ax: a[0], ay: a[1], az: a[2],
        bx: b[0], by: b[1], bz: b[2],
        dx: dx / len, dz: dz / len,
        len: len,
        width: width,
        shoulder: shoulder,
        camber: camber,
        surface: surface
      });
    }
    this._roadGridDirty = true;
    this.lastRoad = { points: pts, width: width, from: startIndex, to: this.roadSegs.length };
    return this.lastRoad;
  };

  Terrain.prototype.buildRoadGrid = function () {
    var cs = this.roadGridCell;
    var res = Math.ceil(this.size / cs) + 1;
    this.roadGridRes = res;
    var grid = new Array(res * res);
    var maxReach = 0;
    for (var i = 0; i < this.roadSegs.length; i++) {
      var s = this.roadSegs[i];
      var reach = s.width * 0.5 + s.shoulder + 1;
      if (reach > maxReach) maxReach = reach;
      var minX = Math.min(s.ax, s.bx) - reach, maxX = Math.max(s.ax, s.bx) + reach;
      var minZ = Math.min(s.az, s.bz) - reach, maxZ = Math.max(s.az, s.bz) + reach;
      var gx0 = M.clamp(Math.floor((minX + this.half) / cs), 0, res - 1);
      var gx1 = M.clamp(Math.floor((maxX + this.half) / cs), 0, res - 1);
      var gz0 = M.clamp(Math.floor((minZ + this.half) / cs), 0, res - 1);
      var gz1 = M.clamp(Math.floor((maxZ + this.half) / cs), 0, res - 1);
      for (var gz = gz0; gz <= gz1; gz++) {
        for (var gx = gx0; gx <= gx1; gx++) {
          var ci = gz * res + gx;
          if (!grid[ci]) grid[ci] = [];
          grid[ci].push(i);
        }
      }
    }
    this.roadGrid = grid;
    this.roadMaxReach = maxReach;
    this._roadGridDirty = false;
  };

  /* Road influence at a point: returns {y, weight, surface} or null. */
  var _ri = { y: 0, w: 0, surface: 1, dirx: 0, dirz: 0 };
  Terrain.prototype.roadAt = function (x, z) {
    if (this._roadGridDirty) this.buildRoadGrid();
    if (!this.roadGrid) return null;
    var cs = this.roadGridCell, res = this.roadGridRes;
    var gx = Math.floor((x + this.half) / cs);
    var gz = Math.floor((z + this.half) / cs);
    if (gx < 0 || gz < 0 || gx >= res || gz >= res) return null;
    var bucket = this.roadGrid[gz * res + gx];
    if (!bucket) return null;

    var bestW = 0, bestY = 0, bestSurf = 1, bdx = 0, bdz = 0;
    for (var i = 0; i < bucket.length; i++) {
      var s = this.roadSegs[bucket[i]];
      var vx = x - s.ax, vz = z - s.az;
      var t = (vx * s.dx + vz * s.dz) / s.len;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var cx = s.ax + (s.bx - s.ax) * t;
      var cz = s.az + (s.bz - s.az) * t;
      var ddx = x - cx, ddz = z - cz;
      var dist = Math.sqrt(ddx * ddx + ddz * ddz);
      var halfW = s.width * 0.5;
      if (dist > halfW + s.shoulder) continue;
      var cy = s.ay + (s.by - s.ay) * t;
      // Camber: crown the centre of the carriageway.
      if (s.camber !== 0) {
        var lat = Math.min(dist, halfW) / halfW;
        cy -= s.camber * lat * lat;
      }
      var w = dist <= halfW ? 1 : (1 - (dist - halfW) / s.shoulder);
      w = M.smoothstep(0, 1, w);
      if (w > bestW) {
        bestW = w; bestY = cy; bestSurf = s.surface;
        bdx = s.dx; bdz = s.dz;
      } else if (w > 0 && bestW > 0) {
        // Where two segments overlap (a corner), take the higher surface so
        // the inside of the bend does not dip below the road.
        if (cy > bestY) { bestY = cy; }
      }
    }
    if (bestW <= 0) return null;
    _ri.y = bestY; _ri.w = bestW; _ri.surface = bestSurf;
    _ri.dirx = bdx; _ri.dirz = bdz;
    return _ri;
  };

  Terrain.prototype.height = function (x, z) {
    var base = this.rawHeight(x, z);
    var r = this.roadAt(x, z);
    if (!r) return base;
    return base + (r.y - base) * r.w;
  };

  var _nTmp = new Float32Array(3);
  Terrain.prototype.normal = function (x, z, out) {
    var e = 0.55;
    var hL = this.height(x - e, z);
    var hR = this.height(x + e, z);
    var hD = this.height(x, z - e);
    var hU = this.height(x, z + e);
    var nx = hL - hR;
    var nz = hD - hU;
    var ny = 2 * e;
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    out[0] = nx / len; out[1] = ny / len; out[2] = nz / len;
    return out;
  };

  Terrain.prototype.slopeAt = function (x, z) {
    this.normal(x, z, _nTmp);
    return 1 - _nTmp[1];
  };

  Terrain.prototype.surfaceAt = function (x, z) {
    var r = this.roadAt(x, z);
    if (r && r.w > 0.55) return r.surface;
    var fx = M.clamp(Math.round((x + this.half) * this.invCell), 0, this.res);
    var fz = M.clamp(Math.round((z + this.half) * this.invCell), 0, this.res);
    return this.surf[fz * (this.res + 1) + fx];
  };

  Terrain.prototype.surfaceGrip = function (s) {
    return SURF_GRIP[s] !== undefined ? SURF_GRIP[s] : 0.8;
  };

  /* --------------------------------------------------------- mesh build */

  /* Builds the render mesh. Vertex colour encodes surface weights:
     r = asphalt, g = grass, b = rock; whatever is left over reads as dirt. */
  Terrain.prototype.buildMesh = function (lodStep) {
    var step = lodStep || 1;
    var r = Math.floor(this.res / step);
    var c = this.cell * step;
    var h = this.half;
    var vcount = (r + 1) * (r + 1);
    var pos = new Float32Array(vcount * 3);
    var nrm = new Float32Array(vcount * 3);
    var uv = new Float32Array(vcount * 2);
    var col = new Float32Array(vcount * 3);
    var idx = (vcount > 65535) ? new Uint32Array(r * r * 6) : new Uint16Array(r * r * 6);

    var gx, gz, i = 0;
    for (gz = 0; gz <= r; gz++) {
      var z = -h + gz * c;
      for (gx = 0; gx <= r; gx++) {
        var x = -h + gx * c;
        var y = this.height(x, z);
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        uv[i * 2] = gx * 0.5; uv[i * 2 + 1] = gz * 0.5;

        var road = this.roadAt(x, z);
        var roadW = road ? road.w : 0;
        var slope = this.slopeAt(x, z);
        var surfType = this.surf[Math.min(gz * step, this.res) * (this.res + 1) +
                                 Math.min(gx * step, this.res)];
        var rockW = M.clamp((slope - 0.22) * 3.2, 0, 1);
        var grassW = 1 - rockW;
        var dirtW = 0;
        if (surfType === SURF.ROAD) { roadW = Math.max(roadW, 0.88); grassW *= 0.06; rockW *= 0.2; }
        else if (surfType === SURF.DIRT) { dirtW = 0.85; grassW *= 0.2; }
        else if (surfType === SURF.SAND) { dirtW = 0.95; grassW *= 0.05; rockW *= 0.3; }
        else if (surfType === SURF.ROCK) { rockW = Math.max(rockW, 0.85); grassW *= 0.15; }
        else if (surfType === SURF.SNOW) { grassW = 0; rockW *= 0.35; dirtW = 0; }
        // Break up the transition so it does not read as a hard contour.
        var jitter = B.noise.fbm2(x * 0.045, z * 0.045, 3) * 0.28;
        grassW = M.clamp(grassW + jitter, 0, 1);
        rockW = M.clamp(rockW - jitter * 0.5, 0, 1);
        var nonRoad = 1 - roadW;
        col[i * 3] = roadW;
        col[i * 3 + 1] = grassW * nonRoad;
        col[i * 3 + 2] = rockW * nonRoad;
        i++;
      }
    }

    var ti = 0;
    for (gz = 0; gz < r; gz++) {
      for (gx = 0; gx < r; gx++) {
        var a = gz * (r + 1) + gx;
        var b = a + 1;
        var d = a + r + 1;
        var e = d + 1;
        idx[ti++] = a; idx[ti++] = d; idx[ti++] = e;
        idx[ti++] = a; idx[ti++] = e; idx[ti++] = b;
      }
    }

    B.Geo.recomputeNormals(pos, idx, nrm);
    return { position: pos, normal: nrm, uv: uv, color: col, indices: idx };
  };

  /* A separate thin ribbon laid over the road so the carriageway has crisp
     edges, lane markings and a darker, smoother surface than the terrain. */
  Terrain.prototype.buildRoadMesh = function (roads) {
    var mb = new B.Geo.MeshBuilder();
    if (!roads || !roads.length) return mb;
    var lift = 0.035;
    for (var ri = 0; ri < roads.length; ri++) {
      var road = roads[ri];
      var pts = road.points;
      if (!pts || pts.length < 2) continue;
      var hw = road.width * 0.5;
      var base = mb.vertexCount();
      var distAcc = 0;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var prev = pts[Math.max(i - 1, 0)];
        var next = pts[Math.min(i + 1, pts.length - 1)];
        var dx = next[0] - prev[0], dz = next[2] - prev[2];
        var dl = Math.hypot(dx, dz) || 1;
        dx /= dl; dz /= dl;
        var rx = dz, rz = -dx;
        if (i > 0) distAcc += Math.hypot(p[0] - pts[i - 1][0], p[2] - pts[i - 1][2]);
        var y = p[1] + lift;
        // Five lanes of vertices: edge, mid, crown, mid, edge.
        var offs = [-hw, -hw * 0.5, 0, hw * 0.5, hw];
        for (var k = 0; k < 5; k++) {
          var o = offs[k];
          var crown = (1 - Math.abs(o) / hw);
          mb.vert(p[0] + rx * o, y + crown * 0.045, p[2] + rz * o,
            0, 1, 0, (o / hw) * 0.5 + 0.5, distAcc * 0.12, [1, 1, 1]);
        }
      }
      for (var s = 0; s < pts.length - 1; s++) {
        for (var q = 0; q < 4; q++) {
          var a = base + s * 5 + q;
          var b = a + 5;
          mb.quad(a, b, b + 1, a + 1);
        }
      }
    }
    mb.computeNormals();
    return mb;
  };

  /* Painted lane markings, emitted as flat quads just above the ribbon. */
  Terrain.prototype.buildRoadMarkings = function (roads) {
    var mb = new B.Geo.MeshBuilder();
    if (!roads || !roads.length) return mb;
    var lift = 0.055;
    var white = [1, 1, 1];
    for (var ri = 0; ri < roads.length; ri++) {
      var road = roads[ri];
      var pts = road.points;
      if (!pts || pts.length < 2 || road.width < 5) continue;
      var hw = road.width * 0.5;
      var dashOn = true, dashAcc = 0;
      for (var i = 0; i < pts.length - 1; i++) {
        var p = pts[i], q = pts[i + 1];
        var dx = q[0] - p[0], dz = q[2] - p[2];
        var dl = Math.hypot(dx, dz);
        if (dl < 1e-4) continue;
        dx /= dl; dz /= dl;
        var rx = dz, rz = -dx;
        dashAcc += dl;
        if (dashAcc > (dashOn ? 3.0 : 4.5)) { dashOn = !dashOn; dashAcc = 0; }

        // Solid edge lines.
        for (var e = 0; e < 2; e++) {
          var off = (e === 0 ? -1 : 1) * (hw - 0.34);
          var w = 0.12;
          var base = mb.vertexCount();
          var y0 = p[1] + lift, y1 = q[1] + lift;
          mb.vert(p[0] + rx * (off - w), y0, p[2] + rz * (off - w), 0, 1, 0, 0, 0, white);
          mb.vert(p[0] + rx * (off + w), y0, p[2] + rz * (off + w), 0, 1, 0, 1, 0, white);
          mb.vert(q[0] + rx * (off + w), y1, q[2] + rz * (off + w), 0, 1, 0, 1, 1, white);
          mb.vert(q[0] + rx * (off - w), y1, q[2] + rz * (off - w), 0, 1, 0, 0, 1, white);
          mb.quad(base, base + 1, base + 2, base + 3);
        }
        // Dashed centre line.
        if (dashOn) {
          var cw = 0.10;
          var cb = mb.vertexCount();
          var cy0 = p[1] + lift + 0.045, cy1 = q[1] + lift + 0.045;
          mb.vert(p[0] - rx * cw, cy0, p[2] - rz * cw, 0, 1, 0, 0, 0, white);
          mb.vert(p[0] + rx * cw, cy0, p[2] + rz * cw, 0, 1, 0, 1, 0, white);
          mb.vert(q[0] + rx * cw, cy1, q[2] + rz * cw, 0, 1, 0, 1, 1, white);
          mb.vert(q[0] - rx * cw, cy1, q[2] - rz * cw, 0, 1, 0, 0, 1, white);
          mb.quad(cb, cb + 1, cb + 2, cb + 3);
        }
      }
    }
    return mb;
  };

  B.Terrain = Terrain;
  B.SURF = SURF;

})();
