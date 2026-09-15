/* =========================================================================
   BeamDrive Mobile — procedural geometry
   A small mesh builder plus the primitives every asset in the game is
   assembled from. Nothing is loaded from disk: the whole world is code.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M, V = M.v3, Mat = M.m4;
  var Geo = {};
  B.Geo = Geo;

  /* --------------------------------------------------------- MeshBuilder */
  function MeshBuilder() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }
  Geo.MeshBuilder = MeshBuilder;

  MeshBuilder.prototype.vertexCount = function () { return this.pos.length / 3; };

  MeshBuilder.prototype.vert = function (x, y, z, nx, ny, nz, u, v, c) {
    this.pos.push(x, y, z);
    this.nrm.push(nx || 0, ny || 0, nz || 0);
    this.uv.push(u || 0, v || 0);
    if (c) this.col.push(c[0], c[1], c[2]); else this.col.push(1, 1, 1);
    return (this.pos.length / 3) - 1;
  };

  MeshBuilder.prototype.tri = function (a, b, c) { this.idx.push(a, b, c); return this; };
  MeshBuilder.prototype.quad = function (a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
    return this;
  };

  // Merge another builder, optionally transformed and/or recoloured.
  MeshBuilder.prototype.append = function (other, xform, color) {
    var base = this.vertexCount();
    var i, n = other.pos.length / 3;
    var p = new Float32Array(3), nn = new Float32Array(3);
    var nmat = null;
    if (xform) {
      nmat = Mat.create();
      Mat.normalMatrix(nmat, xform);
    }
    for (i = 0; i < n; i++) {
      p[0] = other.pos[i * 3]; p[1] = other.pos[i * 3 + 1]; p[2] = other.pos[i * 3 + 2];
      nn[0] = other.nrm[i * 3]; nn[1] = other.nrm[i * 3 + 1]; nn[2] = other.nrm[i * 3 + 2];
      if (xform) {
        V.xformM4(p, p, xform);
        V.xformDir(nn, nn, nmat);
        V.normalize(nn, nn);
      }
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nn[0], nn[1], nn[2]);
      this.uv.push(other.uv[i * 2], other.uv[i * 2 + 1]);
      if (color) this.col.push(color[0], color[1], color[2]);
      else this.col.push(other.col[i * 3], other.col[i * 3 + 1], other.col[i * 3 + 2]);
    }
    for (i = 0; i < other.idx.length; i++) this.idx.push(other.idx[i] + base);
    return this;
  };

  MeshBuilder.prototype.translate = function (x, y, z) {
    for (var i = 0; i < this.pos.length; i += 3) {
      this.pos[i] += x; this.pos[i + 1] += y; this.pos[i + 2] += z;
    }
    return this;
  };

  MeshBuilder.prototype.setColor = function (c) {
    for (var i = 0; i < this.col.length; i += 3) {
      this.col[i] = c[0]; this.col[i + 1] = c[1]; this.col[i + 2] = c[2];
    }
    return this;
  };

  // Area-weighted smooth normals; `hardAngle` splits creases apart first.
  MeshBuilder.prototype.computeNormals = function () {
    var n = this.pos.length;
    for (var i = 0; i < n; i++) this.nrm[i] = 0;
    for (var t = 0; t < this.idx.length; t += 3) {
      var ia = this.idx[t] * 3, ib = this.idx[t + 1] * 3, ic = this.idx[t + 2] * 3;
      var ax = this.pos[ia], ay = this.pos[ia + 1], az = this.pos[ia + 2];
      var bx = this.pos[ib], by = this.pos[ib + 1], bz = this.pos[ib + 2];
      var cx = this.pos[ic], cy = this.pos[ic + 1], cz = this.pos[ic + 2];
      var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      var nx = e1y * e2z - e1z * e2y;
      var ny = e1z * e2x - e1x * e2z;
      var nz = e1x * e2y - e1y * e2x;
      this.nrm[ia] += nx; this.nrm[ia + 1] += ny; this.nrm[ia + 2] += nz;
      this.nrm[ib] += nx; this.nrm[ib + 1] += ny; this.nrm[ib + 2] += nz;
      this.nrm[ic] += nx; this.nrm[ic + 1] += ny; this.nrm[ic + 2] += nz;
    }
    for (var j = 0; j < n; j += 3) {
      var x = this.nrm[j], y = this.nrm[j + 1], z = this.nrm[j + 2];
      var l = Math.sqrt(x * x + y * y + z * z);
      if (l > 1e-9) { this.nrm[j] = x / l; this.nrm[j + 1] = y / l; this.nrm[j + 2] = z / l; }
      else { this.nrm[j] = 0; this.nrm[j + 1] = 1; this.nrm[j + 2] = 0; }
    }
    return this;
  };

  // Duplicate every vertex per-triangle so each face gets a flat normal.
  MeshBuilder.prototype.unweld = function () {
    var pos = [], nrm = [], uv = [], col = [], idx = [];
    for (var t = 0; t < this.idx.length; t += 3) {
      for (var k = 0; k < 3; k++) {
        var s = this.idx[t + k];
        pos.push(this.pos[s * 3], this.pos[s * 3 + 1], this.pos[s * 3 + 2]);
        nrm.push(this.nrm[s * 3], this.nrm[s * 3 + 1], this.nrm[s * 3 + 2]);
        uv.push(this.uv[s * 2], this.uv[s * 2 + 1]);
        col.push(this.col[s * 3], this.col[s * 3 + 1], this.col[s * 3 + 2]);
        idx.push(t + k);
      }
    }
    this.pos = pos; this.nrm = nrm; this.uv = uv; this.col = col; this.idx = idx;
    return this;
  };

  MeshBuilder.prototype.toData = function () {
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nrm),
      uv: new Float32Array(this.uv),
      color: new Float32Array(this.col),
      indices: (this.pos.length / 3 > 65535) ? new Uint32Array(this.idx) : new Uint16Array(this.idx)
    };
  };

  MeshBuilder.prototype.toGeometry = function (dynamic) {
    var d = this.toData();
    var g = new B.GL.Geometry({ dynamic: !!dynamic });
    g.setAttribute('position', d.position);
    g.setAttribute('normal', d.normal);
    g.setAttribute('uv', d.uv);
    g.setAttribute('color', d.color);
    g.setIndices(d.indices);
    g.computeBounds();
    return g;
  };

  /* ---------------------------------------------------------- primitives */

  // Axis-aligned box centred on the origin. Unwelded (hard edges).
  Geo.box = function (sx, sy, sz, color, uvScale) {
    var mb = new MeshBuilder();
    var hx = sx / 2, hy = sy / 2, hz = sz / 2;
    var us = uvScale || 1;
    var faces = [
      // normal, and the four corners in CCW order seen from outside
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], sx, sy],
      [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], sx, sy],
      [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], sz, sy],
      [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], sz, sy],
      [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], sx, sz],
      [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], sx, sz]
    ];
    for (var f = 0; f < 6; f++) {
      var nrm = faces[f][0], c = faces[f][1];
      var uw = faces[f][2] * us, uh = faces[f][3] * us;
      var uvs = [[0, 0], [uw, 0], [uw, uh], [0, uh]];
      var base = mb.vertexCount();
      for (var i = 0; i < 4; i++) {
        mb.vert(c[i][0], c[i][1], c[i][2], nrm[0], nrm[1], nrm[2], uvs[i][0], uvs[i][1], color);
      }
      mb.quad(base, base + 1, base + 2, base + 3);
    }
    return mb;
  };

  /* Box with rounded edges, built as 6 flat faces + 12 quarter-round edge
     strips + 8 spherical corner patches. Reads far better than a hard box
     under a moving sun because the bevels catch a highlight.             */
  Geo.roundedBox = function (sx, sy, sz, bevel, color, seg) {
    var mb = new MeshBuilder();
    var hx = sx / 2, hy = sy / 2, hz = sz / 2;
    var b = Math.min(bevel, Math.min(hx, Math.min(hy, hz)) * 0.49);
    var ix = hx - b, iy = hy - b, iz = hz - b;
    seg = Math.max(2, seg || 3);

    // ---- 6 flat faces -------------------------------------------------
    function face(nrm, c0, c1, c2, c3) {
      var base = mb.vertexCount();
      var pts = [c0, c1, c2, c3];
      var uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (var i = 0; i < 4; i++) {
        mb.vert(pts[i][0], pts[i][1], pts[i][2], nrm[0], nrm[1], nrm[2], uvs[i][0], uvs[i][1], color);
      }
      mb.quad(base, base + 1, base + 2, base + 3);
    }
    face([0, 0, 1], [-ix, -iy, hz], [ix, -iy, hz], [ix, iy, hz], [-ix, iy, hz]);
    face([0, 0, -1], [ix, -iy, -hz], [-ix, -iy, -hz], [-ix, iy, -hz], [ix, iy, -hz]);
    face([1, 0, 0], [hx, -iy, iz], [hx, -iy, -iz], [hx, iy, -iz], [hx, iy, iz]);
    face([-1, 0, 0], [-hx, -iy, -iz], [-hx, -iy, iz], [-hx, iy, iz], [-hx, iy, -iz]);
    face([0, 1, 0], [-ix, hy, iz], [ix, hy, iz], [ix, hy, -iz], [-ix, hy, -iz]);
    face([0, -1, 0], [-ix, -hy, -iz], [ix, -hy, -iz], [ix, -hy, iz], [-ix, -hy, iz]);

    // ---- 12 quarter-round edges ---------------------------------------
    // Each edge sweeps a quarter arc in the plane spanned by u and v while
    // running along axis `dir` from -len to +len.
    function edge(centerA, centerB, u, v) {
      var base = mb.vertexCount();
      for (var s = 0; s <= seg; s++) {
        var a = (s / seg) * (Math.PI / 2);
        var ca = Math.cos(a), sa = Math.sin(a);
        var nx = u[0] * ca + v[0] * sa;
        var ny = u[1] * ca + v[1] * sa;
        var nz = u[2] * ca + v[2] * sa;
        mb.vert(centerA[0] + nx * b, centerA[1] + ny * b, centerA[2] + nz * b,
          nx, ny, nz, s / seg, 0, color);
        mb.vert(centerB[0] + nx * b, centerB[1] + ny * b, centerB[2] + nz * b,
          nx, ny, nz, s / seg, 1, color);
      }
      for (var k = 0; k < seg; k++) {
        var i0 = base + k * 2;
        mb.quad(i0, i0 + 2, i0 + 3, i0 + 1);
      }
    }
    var X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
    var nX = [-1, 0, 0], nY = [0, -1, 0], nZ = [0, 0, -1];
    // Edges running along Z (vary in x,y)
    edge([ix, iy, -iz], [ix, iy, iz], X, Y);
    edge([-ix, iy, iz], [-ix, iy, -iz], Y, nX);
    edge([-ix, -iy, -iz], [-ix, -iy, iz], nX, nY);
    edge([ix, -iy, iz], [ix, -iy, -iz], nY, X);
    // Edges running along X (vary in y,z)
    edge([-ix, iy, iz], [ix, iy, iz], Z, Y);
    edge([ix, iy, -iz], [-ix, iy, -iz], Y, nZ);
    edge([-ix, -iy, -iz], [ix, -iy, -iz], nZ, nY);
    edge([ix, -iy, iz], [-ix, -iy, iz], nY, Z);
    // Edges running along Y (vary in x,z)
    edge([ix, -iy, iz], [ix, iy, iz], X, Z);
    edge([-ix, -iy, iz], [-ix, iy, iz], Z, nX);
    edge([-ix, -iy, -iz], [-ix, iy, -iz], nX, nZ);
    edge([ix, -iy, -iz], [ix, iy, -iz], nZ, X);

    // ---- 8 spherical corners ------------------------------------------
    function corner(cx, cy, cz, sgx, sgy, sgz) {
      var base = mb.vertexCount();
      var r, c2;
      for (r = 0; r <= seg; r++) {
        var phi = (r / seg) * (Math.PI / 2);          // from equator to pole
        for (c2 = 0; c2 <= seg; c2++) {
          var th = (c2 / seg) * (Math.PI / 2);
          var nx = Math.cos(phi) * Math.cos(th) * sgx;
          var nz = Math.cos(phi) * Math.sin(th) * sgz;
          var ny = Math.sin(phi) * sgy;
          mb.vert(cx + nx * b, cy + ny * b, cz + nz * b, nx, ny, nz, c2 / seg, r / seg, color);
        }
      }
      var flip = (sgx * sgy * sgz) < 0;
      for (r = 0; r < seg; r++) {
        for (c2 = 0; c2 < seg; c2++) {
          var i0 = base + r * (seg + 1) + c2;
          var i1 = i0 + seg + 1;
          if (flip) mb.quad(i0, i0 + 1, i1 + 1, i1);
          else mb.quad(i0, i1, i1 + 1, i0 + 1);
        }
      }
    }
    for (var xs = -1; xs <= 1; xs += 2) {
      for (var ys = -1; ys <= 1; ys += 2) {
        for (var zs = -1; zs <= 1; zs += 2) {
          corner(ix * xs, iy * ys, iz * zs, xs, ys, zs);
        }
      }
    }
    return mb;
  };

  /* Cylinder along +Y, centred at the origin. */
  Geo.cylinder = function (rTop, rBottom, height, segments, color, capped) {
    var mb = new MeshBuilder();
    segments = segments || 16;
    var hy = height / 2;
    var i, a, ca, sa;
    // Side wall
    for (i = 0; i <= segments; i++) {
      a = (i / segments) * Math.PI * 2;
      ca = Math.cos(a); sa = Math.sin(a);
      var slope = (rBottom - rTop) / height;
      var nl = Math.sqrt(1 + slope * slope);
      mb.vert(ca * rTop, hy, sa * rTop, ca / nl, slope / nl, sa / nl, i / segments, 1, color);
      mb.vert(ca * rBottom, -hy, sa * rBottom, ca / nl, slope / nl, sa / nl, i / segments, 0, color);
    }
    for (i = 0; i < segments; i++) {
      var b0 = i * 2;
      mb.quad(b0 + 1, b0 + 3, b0 + 2, b0);
    }
    if (capped !== false) {
      // Top cap
      var ct = mb.vert(0, hy, 0, 0, 1, 0, 0.5, 0.5, color);
      var topStart = mb.vertexCount();
      for (i = 0; i <= segments; i++) {
        a = (i / segments) * Math.PI * 2;
        mb.vert(Math.cos(a) * rTop, hy, Math.sin(a) * rTop, 0, 1, 0,
          Math.cos(a) * 0.5 + 0.5, Math.sin(a) * 0.5 + 0.5, color);
      }
      for (i = 0; i < segments; i++) mb.tri(ct, topStart + i, topStart + i + 1);
      // Bottom cap
      var cb = mb.vert(0, -hy, 0, 0, -1, 0, 0.5, 0.5, color);
      var botStart = mb.vertexCount();
      for (i = 0; i <= segments; i++) {
        a = (i / segments) * Math.PI * 2;
        mb.vert(Math.cos(a) * rBottom, -hy, Math.sin(a) * rBottom, 0, -1, 0,
          Math.cos(a) * 0.5 + 0.5, Math.sin(a) * 0.5 + 0.5, color);
      }
      for (i = 0; i < segments; i++) mb.tri(cb, botStart + i + 1, botStart + i);
    }
    return mb;
  };

  Geo.sphere = function (radius, wSeg, hSeg, color) {
    var mb = new MeshBuilder();
    wSeg = wSeg || 16; hSeg = hSeg || 12;
    var x, y;
    for (y = 0; y <= hSeg; y++) {
      var v = y / hSeg;
      var phi = v * Math.PI;
      for (x = 0; x <= wSeg; x++) {
        var u = x / wSeg;
        var theta = u * Math.PI * 2;
        var nx = Math.sin(phi) * Math.cos(theta);
        var ny = Math.cos(phi);
        var nz = Math.sin(phi) * Math.sin(theta);
        mb.vert(nx * radius, ny * radius, nz * radius, nx, ny, nz, u, 1 - v, color);
      }
    }
    for (y = 0; y < hSeg; y++) {
      for (x = 0; x < wSeg; x++) {
        var a = y * (wSeg + 1) + x;
        var b = a + wSeg + 1;
        mb.quad(a, a + 1, b + 1, b);
      }
    }
    return mb;
  };

  // Ellipsoid — handy for heads, shoulders, fenders.
  Geo.ellipsoid = function (rx, ry, rz, wSeg, hSeg, color) {
    var mb = Geo.sphere(1, wSeg, hSeg, color);
    for (var i = 0; i < mb.pos.length; i += 3) {
      mb.pos[i] *= rx; mb.pos[i + 1] *= ry; mb.pos[i + 2] *= rz;
    }
    mb.computeNormals();
    return mb;
  };

  Geo.capsule = function (radius, height, segments, rings, color) {
    var mb = new MeshBuilder();
    segments = segments || 12; rings = rings || 6;
    var half = Math.max(height / 2 - radius, 0);
    var y, x, i;
    var rows = [];
    // Top hemisphere
    for (i = 0; i <= rings; i++) {
      var p = (i / rings) * (Math.PI / 2);
      rows.push({ y: half + Math.cos(p) * radius, r: Math.sin(p) * radius, ny: Math.cos(p), nr: Math.sin(p) });
    }
    // Bottom hemisphere
    for (i = 0; i <= rings; i++) {
      var q = (Math.PI / 2) + (i / rings) * (Math.PI / 2);
      rows.push({ y: -half + Math.cos(q) * radius, r: Math.sin(q) * radius, ny: Math.cos(q), nr: Math.sin(q) });
    }
    for (y = 0; y < rows.length; y++) {
      for (x = 0; x <= segments; x++) {
        var a = (x / segments) * Math.PI * 2;
        var ca = Math.cos(a), sa = Math.sin(a);
        mb.vert(ca * rows[y].r, rows[y].y, sa * rows[y].r,
          ca * rows[y].nr, rows[y].ny, sa * rows[y].nr,
          x / segments, y / (rows.length - 1), color);
      }
    }
    for (y = 0; y < rows.length - 1; y++) {
      for (x = 0; x < segments; x++) {
        var i0 = y * (segments + 1) + x;
        var i1 = i0 + segments + 1;
        mb.quad(i0, i0 + 1, i1 + 1, i1);
      }
    }
    return mb;
  };

  // A tapered box — the workhorse for limbs, chassis rails and body panels.
  Geo.taperedBox = function (w0, h0, w1, h1, length, color) {
    var mb = new MeshBuilder();
    var hl = length / 2;
    var a = [[-w0 / 2, -h0 / 2], [w0 / 2, -h0 / 2], [w0 / 2, h0 / 2], [-w0 / 2, h0 / 2]];
    var b = [[-w1 / 2, -h1 / 2], [w1 / 2, -h1 / 2], [w1 / 2, h1 / 2], [-w1 / 2, h1 / 2]];
    var base = mb.vertexCount();
    var i;
    for (i = 0; i < 4; i++) mb.vert(a[i][0], -hl, a[i][1], 0, 0, 0, i / 4, 0, color);
    for (i = 0; i < 4; i++) mb.vert(b[i][0], hl, b[i][1], 0, 0, 0, i / 4, 1, color);
    for (i = 0; i < 4; i++) {
      var n = (i + 1) % 4;
      mb.quad(base + i, base + n, base + 4 + n, base + 4 + i);
    }
    mb.quad(base + 3, base + 2, base + 1, base + 0);
    mb.quad(base + 4, base + 5, base + 6, base + 7);
    mb.computeNormals();
    return mb;
  };

  /* Loft: sweep a sequence of closed 2D cross-sections along an axis.
     Sections are [{ z: position along sweep, pts: [[x,y], ...] }] with the
     same point count. This is how every car body in the game is shaped.   */
  Geo.loft = function (sections, color, closeEnds, uvScale) {
    var mb = new MeshBuilder();
    if (!sections.length) return mb;
    var n = sections[0].pts.length;
    var s, i;
    var us = uvScale || 1;
    for (s = 0; s < sections.length; s++) {
      var sec = sections[s];
      for (i = 0; i < n; i++) {
        mb.vert(sec.pts[i][0], sec.pts[i][1], sec.z, 0, 0, 0,
          (i / n) * us, (s / (sections.length - 1)) * us, sec.color || color);
      }
    }
    for (s = 0; s < sections.length - 1; s++) {
      for (i = 0; i < n; i++) {
        var ni = (i + 1) % n;
        var a = s * n + i, b = s * n + ni;
        var c = (s + 1) * n + ni, d = (s + 1) * n + i;
        mb.quad(a, b, c, d);
      }
    }
    if (closeEnds) {
      // Fan-triangulate the first and last rings around their centroid.
      var addCap = function (ring, flip) {
        var cx = 0, cy = 0, cz = sections[ring].z;
        for (var k = 0; k < n; k++) { cx += sections[ring].pts[k][0]; cy += sections[ring].pts[k][1]; }
        cx /= n; cy /= n;
        var ci = mb.vert(cx, cy, cz, 0, 0, flip ? -1 : 1, 0.5, 0.5, color);
        var start = mb.vertexCount();
        for (var j = 0; j < n; j++) {
          mb.vert(sections[ring].pts[j][0], sections[ring].pts[j][1], cz, 0, 0, flip ? -1 : 1,
            j / n, 0, color);
        }
        for (var t = 0; t < n; t++) {
          var t1 = start + t, t2 = start + ((t + 1) % n);
          if (flip) mb.tri(ci, t2, t1); else mb.tri(ci, t1, t2);
        }
      };
      addCap(0, true);
      addCap(sections.length - 1, false);
    }
    mb.computeNormals();
    return mb;
  };

  /* A flat grid on XZ — used for water, road decals and the shadow catcher. */
  Geo.plane = function (width, depth, segW, segD, color) {
    var mb = new MeshBuilder();
    segW = segW || 1; segD = segD || 1;
    var x, z;
    for (z = 0; z <= segD; z++) {
      for (x = 0; x <= segW; x++) {
        var px = (x / segW - 0.5) * width;
        var pz = (z / segD - 0.5) * depth;
        mb.vert(px, 0, pz, 0, 1, 0, x / segW, z / segD, color);
      }
    }
    for (z = 0; z < segD; z++) {
      for (x = 0; x < segW; x++) {
        var a = z * (segW + 1) + x;
        var b = a + segW + 1;
        mb.quad(a, a + 1, b + 1, b);
      }
    }
    return mb;
  };

  /* A ring/torus slice — steering wheel rims, tyres, roll cages. */
  Geo.torus = function (radius, tube, radialSeg, tubeSeg, arc, color) {
    var mb = new MeshBuilder();
    radialSeg = radialSeg || 24; tubeSeg = tubeSeg || 10;
    arc = arc === undefined ? Math.PI * 2 : arc;
    var j, i;
    for (j = 0; j <= radialSeg; j++) {
      var u = (j / radialSeg) * arc;
      var cu = Math.cos(u), su = Math.sin(u);
      for (i = 0; i <= tubeSeg; i++) {
        var v = (i / tubeSeg) * Math.PI * 2;
        var cv = Math.cos(v), sv = Math.sin(v);
        var nx = cu * cv, ny = sv, nz = su * cv;
        mb.vert((radius + tube * cv) * cu, tube * sv, (radius + tube * cv) * su,
          nx, ny, nz, j / radialSeg, i / tubeSeg, color);
      }
    }
    for (j = 0; j < radialSeg; j++) {
      for (i = 0; i < tubeSeg; i++) {
        var a = j * (tubeSeg + 1) + i;
        var b = a + tubeSeg + 1;
        mb.quad(a, b, b + 1, a + 1);
      }
    }
    return mb;
  };

  /* Wheel: tyre carcass with tread blocks + a spoked rim. Built around +X
     as the axle so it can be dropped straight onto a hub node.            */
  Geo.wheel = function (radius, width, rimRadius, spokes, tyreColor, rimColor) {
    var mb = new MeshBuilder();
    var seg = 22;
    var hw = width / 2;
    var i, a, ca, sa;

    // Tyre outer surface with a shallow shoulder radius.
    var profile = [
      { x: -hw, r: radius * 0.90 },
      { x: -hw * 0.92, r: radius * 0.985 },
      { x: -hw * 0.55, r: radius },
      { x: hw * 0.55, r: radius },
      { x: hw * 0.92, r: radius * 0.985 },
      { x: hw, r: radius * 0.90 }
    ];
    var ringStart = mb.vertexCount();
    for (var p = 0; p < profile.length; p++) {
      for (i = 0; i <= seg; i++) {
        a = (i / seg) * Math.PI * 2;
        ca = Math.cos(a); sa = Math.sin(a);
        // Tread block relief, modulated around the circumference.
        var tread = (p >= 2 && p <= 3) ? (((i % 3) === 0) ? -0.012 : 0.008) : 0;
        var rr = profile[p].r + tread * radius;
        mb.vert(profile[p].x, ca * rr, sa * rr, 0, ca, sa, i / seg, p / (profile.length - 1), tyreColor);
      }
    }
    for (p = 0; p < profile.length - 1; p++) {
      for (i = 0; i < seg; i++) {
        var i0 = ringStart + p * (seg + 1) + i;
        var i1 = i0 + seg + 1;
        mb.quad(i0, i1, i1 + 1, i0 + 1);
      }
    }

    // Sidewalls closing onto the rim.
    var sideRing = function (xPos, outerR, innerR, nx) {
      var sBase = mb.vertexCount();
      for (var k = 0; k <= seg; k++) {
        var ang = (k / seg) * Math.PI * 2;
        var c = Math.cos(ang), s = Math.sin(ang);
        mb.vert(xPos, c * outerR, s * outerR, nx, 0, 0, k / seg, 0, tyreColor);
        mb.vert(xPos, c * innerR, s * innerR, nx, 0, 0, k / seg, 1, tyreColor);
      }
      for (var m = 0; m < seg; m++) {
        var b0 = sBase + m * 2;
        if (nx > 0) mb.quad(b0, b0 + 2, b0 + 3, b0 + 1);
        else mb.quad(b0, b0 + 1, b0 + 3, b0 + 2);
      }
    };
    sideRing(hw, radius * 0.90, rimRadius, 1);
    sideRing(-hw, radius * 0.90, rimRadius, -1);

    // Rim barrel + face.
    var rim = Geo.cylinder(rimRadius, rimRadius, width * 0.96, seg, rimColor, false);
    var rot = Mat.create();
    Mat.rotZ(rot, Math.PI / 2);
    mb.append(rim, rot);

    var faceDiscs = [hw * 0.82, -hw * 0.82];
    for (var fd = 0; fd < faceDiscs.length; fd++) {
      var disc = Geo.cylinder(rimRadius * 0.99, rimRadius * 0.99, 0.012, seg, rimColor, true);
      var m2 = Mat.create();
      Mat.rotZ(m2, Math.PI / 2);
      m2[12] = faceDiscs[fd];
      mb.append(disc, m2);
    }

    // Spokes.
    spokes = spokes || 5;
    for (var s2 = 0; s2 < spokes; s2++) {
      var ang2 = (s2 / spokes) * Math.PI * 2;
      var sp = Geo.box(width * 0.42, rimRadius * 1.55, rimRadius * 0.24, rimColor);
      var mrot = Mat.create();
      var rx = Mat.create();
      Mat.fromAxisAngle(rx, [1, 0, 0], ang2);
      Mat.copy(mrot, rx);
      mrot[12] = hw * 0.35;
      mb.append(sp, mrot);
    }
    // Hub cap.
    var hub = Geo.cylinder(rimRadius * 0.30, rimRadius * 0.34, width * 0.30, 14, rimColor, true);
    var mh = Mat.create();
    Mat.rotZ(mh, Math.PI / 2);
    mh[12] = hw * 0.55;
    mb.append(hub, mh);

    return mb;
  };

  /* Build a GL geometry straight from arrays (used by the terrain). */
  Geo.fromArrays = function (position, normal, uv, color, indices, dynamic) {
    var g = new B.GL.Geometry({ dynamic: !!dynamic });
    g.setAttribute('position', position);
    g.setAttribute('normal', normal);
    g.setAttribute('uv', uv);
    g.setAttribute('color', color);
    g.setIndices(indices);
    g.computeBounds();
    return g;
  };

  /* Smooth-normal recompute for a live (deforming) mesh. Writes into the
     supplied normal array; avoids all allocation so it can run per-frame. */
  Geo.recomputeNormals = function (positions, indices, normals) {
    var i, n = normals.length;
    for (i = 0; i < n; i++) normals[i] = 0;
    for (i = 0; i < indices.length; i += 3) {
      var ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
      var ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
      var e1x = positions[ib] - ax, e1y = positions[ib + 1] - ay, e1z = positions[ib + 2] - az;
      var e2x = positions[ic] - ax, e2y = positions[ic + 1] - ay, e2z = positions[ic + 2] - az;
      var nx = e1y * e2z - e1z * e2y;
      var ny = e1z * e2x - e1x * e2z;
      var nz = e1x * e2y - e1y * e2x;
      normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
      normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
      normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
    }
    for (i = 0; i < n; i += 3) {
      var x = normals[i], y = normals[i + 1], z = normals[i + 2];
      var l = Math.sqrt(x * x + y * y + z * z);
      if (l > 1e-9) { normals[i] = x / l; normals[i + 1] = y / l; normals[i + 2] = z / l; }
      else { normals[i] = 0; normals[i + 1] = 1; normals[i + 2] = 0; }
    }
  };

})();
