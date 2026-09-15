/* =========================================================================
   BeamDrive Mobile — math library
   Column-major mat4 (WebGL convention). Vectors are plain arrays/Float32.
   ========================================================================= */
var B = (typeof B !== 'undefined') ? B : {};

(function () {
  'use strict';

  var M = {};
  B.M = M;

  var PI = Math.PI;
  M.PI = PI;
  M.TAU = PI * 2;
  M.DEG = PI / 180;
  M.RAD = 180 / PI;

  M.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  M.lerp = function (a, b, t) { return a + (b - a) * t; };
  M.mix = M.lerp;
  M.sign = function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); };
  M.smoothstep = function (e0, e1, x) {
    var t = M.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  M.saturate = function (v) { return v < 0 ? 0 : (v > 1 ? 1 : v); };
  // Framerate-independent exponential smoothing.
  M.damp = function (a, b, lambda, dt) { return M.lerp(a, b, 1 - Math.exp(-lambda * dt)); };
  M.moveTowards = function (a, b, maxDelta) {
    var d = b - a;
    if (Math.abs(d) <= maxDelta) return b;
    return a + M.sign(d) * maxDelta;
  };
  M.wrapAngle = function (a) {
    a = (a + PI) % M.TAU;
    if (a < 0) a += M.TAU;
    return a - PI;
  };
  M.angleLerp = function (a, b, t) { return a + M.wrapAngle(b - a) * t; };

  /* ---------------------------------------------------------------- vec3 */
  var V = {};
  M.v3 = V;

  V.create = function (x, y, z) { return new Float32Array([x || 0, y || 0, z || 0]); };
  V.of = function (x, y, z) { return [x, y, z]; };
  V.set = function (o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; };
  V.copy = function (o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };
  V.clone = function (a) { return new Float32Array([a[0], a[1], a[2]]); };
  V.add = function (o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; };
  V.sub = function (o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; };
  V.mul = function (o, a, b) { o[0] = a[0] * b[0]; o[1] = a[1] * b[1]; o[2] = a[2] * b[2]; return o; };
  V.scale = function (o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; };
  V.addScaled = function (o, a, b, s) {
    o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o;
  };
  V.dot = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
  V.cross = function (o, a, b) {
    var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
    o[0] = ay * bz - az * by;
    o[1] = az * bx - ax * bz;
    o[2] = ax * by - ay * bx;
    return o;
  };
  V.len = function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); };
  V.len2 = function (a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; };
  V.dist = function (a, b) {
    var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
    return Math.sqrt(x * x + y * y + z * z);
  };
  V.dist2 = function (a, b) {
    var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
    return x * x + y * y + z * z;
  };
  V.normalize = function (o, a) {
    var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    if (l > 1e-9) { l = 1 / l; o[0] = a[0] * l; o[1] = a[1] * l; o[2] = a[2] * l; }
    else { o[0] = 0; o[1] = 0; o[2] = 0; }
    return o;
  };
  V.negate = function (o, a) { o[0] = -a[0]; o[1] = -a[1]; o[2] = -a[2]; return o; };
  V.lerp = function (o, a, b, t) {
    o[0] = a[0] + (b[0] - a[0]) * t;
    o[1] = a[1] + (b[1] - a[1]) * t;
    o[2] = a[2] + (b[2] - a[2]) * t;
    return o;
  };
  // Transform as a point (applies translation).
  V.xformM4 = function (o, a, m) {
    var x = a[0], y = a[1], z = a[2];
    var w = m[3] * x + m[7] * y + m[11] * z + m[15];
    w = w || 1;
    var ox = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    var oy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    var oz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    o[0] = ox; o[1] = oy; o[2] = oz;
    return o;
  };
  // Transform as a direction (ignores translation).
  V.xformDir = function (o, a, m) {
    var x = a[0], y = a[1], z = a[2];
    var ox = m[0] * x + m[4] * y + m[8] * z;
    var oy = m[1] * x + m[5] * y + m[9] * z;
    var oz = m[2] * x + m[6] * y + m[10] * z;
    o[0] = ox; o[1] = oy; o[2] = oz;
    return o;
  };
  // Transform by the transpose of the 3x3 part (inverse for orthonormal bases).
  V.xformDirT = function (o, a, m) {
    var x = a[0], y = a[1], z = a[2];
    var ox = m[0] * x + m[1] * y + m[2] * z;
    var oy = m[4] * x + m[5] * y + m[6] * z;
    var oz = m[8] * x + m[9] * y + m[10] * z;
    o[0] = ox; o[1] = oy; o[2] = oz;
    return o;
  };
  V.xformQ = function (o, a, q) {
    var x = a[0], y = a[1], z = a[2];
    var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    var ix = qw * x + qy * z - qz * y;
    var iy = qw * y + qz * x - qx * z;
    var iz = qw * z + qx * y - qy * x;
    var iw = -qx * x - qy * y - qz * z;
    o[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    o[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    o[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return o;
  };

  /* ---------------------------------------------------------------- mat4 */
  var Mat = {};
  M.m4 = Mat;

  Mat.create = function () {
    var o = new Float32Array(16);
    o[0] = 1; o[5] = 1; o[10] = 1; o[15] = 1;
    return o;
  };
  Mat.identity = function (o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  };
  Mat.copy = function (o, a) { o.set(a); return o; };
  Mat.clone = function (a) { return new Float32Array(a); };

  Mat.mul = function (o, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b0, b1, b2, b3;
    b0 = b[0]; b1 = b[1]; b2 = b[2]; b3 = b[3];
    o[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    o[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    o[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    o[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    o[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    o[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    o[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    o[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    o[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    o[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    o[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    o[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    return o;
  };

  Mat.fromTranslation = function (o, v) {
    Mat.identity(o);
    o[12] = v[0]; o[13] = v[1]; o[14] = v[2];
    return o;
  };
  Mat.fromScale = function (o, v) {
    Mat.identity(o);
    o[0] = v[0]; o[5] = v[1]; o[10] = v[2];
    return o;
  };
  Mat.setTranslation = function (o, x, y, z) {
    o[12] = x; o[13] = y; o[14] = z;
    return o;
  };
  Mat.getTranslation = function (out, m) {
    out[0] = m[12]; out[1] = m[13]; out[2] = m[14];
    return out;
  };
  Mat.rotX = function (o, r) {
    var c = Math.cos(r), s = Math.sin(r);
    Mat.identity(o);
    o[5] = c; o[6] = s; o[9] = -s; o[10] = c;
    return o;
  };
  Mat.rotY = function (o, r) {
    var c = Math.cos(r), s = Math.sin(r);
    Mat.identity(o);
    o[0] = c; o[2] = -s; o[8] = s; o[10] = c;
    return o;
  };
  Mat.rotZ = function (o, r) {
    var c = Math.cos(r), s = Math.sin(r);
    Mat.identity(o);
    o[0] = c; o[1] = s; o[4] = -s; o[5] = c;
    return o;
  };
  Mat.fromAxisAngle = function (o, axis, rad) {
    var x = axis[0], y = axis[1], z = axis[2];
    var l = Math.sqrt(x * x + y * y + z * z);
    if (l < 1e-9) return Mat.identity(o);
    l = 1 / l; x *= l; y *= l; z *= l;
    var s = Math.sin(rad), c = Math.cos(rad), t = 1 - c;
    o[0] = x * x * t + c; o[1] = y * x * t + z * s; o[2] = z * x * t - y * s; o[3] = 0;
    o[4] = x * y * t - z * s; o[5] = y * y * t + c; o[6] = z * y * t + x * s; o[7] = 0;
    o[8] = x * z * t + y * s; o[9] = y * z * t - x * s; o[10] = z * z * t + c; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  };
  // Build from explicit basis vectors (columns) plus origin.
  Mat.fromBasis = function (o, right, up, fwd, pos) {
    o[0] = right[0]; o[1] = right[1]; o[2] = right[2]; o[3] = 0;
    o[4] = up[0]; o[5] = up[1]; o[6] = up[2]; o[7] = 0;
    o[8] = fwd[0]; o[9] = fwd[1]; o[10] = fwd[2]; o[11] = 0;
    o[12] = pos ? pos[0] : 0; o[13] = pos ? pos[1] : 0; o[14] = pos ? pos[2] : 0; o[15] = 1;
    return o;
  };
  // Euler YXZ (yaw, pitch, roll) — matches the camera convention used in game.
  Mat.fromEulerYXZ = function (o, yaw, pitch, roll) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cr = Math.cos(roll), sr = Math.sin(roll);
    o[0] = cy * cr + sy * sp * sr;
    o[1] = cp * sr;
    o[2] = -sy * cr + cy * sp * sr;
    o[3] = 0;
    o[4] = -cy * sr + sy * sp * cr;
    o[5] = cp * cr;
    o[6] = sy * sr + cy * sp * cr;
    o[7] = 0;
    o[8] = sy * cp;
    o[9] = -sp;
    o[10] = cy * cp;
    o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  };

  Mat.perspective = function (o, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[11] = -1;
    o[12] = 0; o[13] = 0; o[15] = 0;
    var nf = 1 / (near - far);
    o[10] = (far + near) * nf;
    o[14] = 2 * far * near * nf;
    return o;
  };
  Mat.ortho = function (o, l, r, b, t, n, f) {
    var lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
    o[0] = -2 * lr; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = -2 * bt; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 2 * nf; o[11] = 0;
    o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf; o[15] = 1;
    return o;
  };
  Mat.lookAt = function (o, eye, center, up) {
    var z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    var l = z0 * z0 + z1 * z1 + z2 * z2;
    if (l < 1e-12) return Mat.identity(o);
    l = 1 / Math.sqrt(l); z0 *= l; z1 *= l; z2 *= l;
    var x0 = up[1] * z2 - up[2] * z1;
    var x1 = up[2] * z0 - up[0] * z2;
    var x2 = up[0] * z1 - up[1] * z0;
    l = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
    if (l < 1e-9) { x0 = 1; x1 = 0; x2 = 0; } else { l = 1 / l; x0 *= l; x1 *= l; x2 *= l; }
    var y0 = z1 * x2 - z2 * x1;
    var y1 = z2 * x0 - z0 * x2;
    var y2 = z0 * x1 - z1 * x0;
    o[0] = x0; o[1] = y0; o[2] = z0; o[3] = 0;
    o[4] = x1; o[5] = y1; o[6] = z1; o[7] = 0;
    o[8] = x2; o[9] = y2; o[10] = z2; o[11] = 0;
    o[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    o[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    o[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    o[15] = 1;
    return o;
  };
  // Fast inverse for rigid transforms (rotation + translation only).
  Mat.invertRigid = function (o, m) {
    var m00 = m[0], m01 = m[1], m02 = m[2];
    var m10 = m[4], m11 = m[5], m12 = m[6];
    var m20 = m[8], m21 = m[9], m22 = m[10];
    var tx = m[12], ty = m[13], tz = m[14];
    o[0] = m00; o[1] = m10; o[2] = m20; o[3] = 0;
    o[4] = m01; o[5] = m11; o[6] = m21; o[7] = 0;
    o[8] = m02; o[9] = m12; o[10] = m22; o[11] = 0;
    o[12] = -(m00 * tx + m01 * ty + m02 * tz);
    o[13] = -(m10 * tx + m11 * ty + m12 * tz);
    o[14] = -(m20 * tx + m21 * ty + m22 * tz);
    o[15] = 1;
    return o;
  };
  Mat.invert = function (o, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    var b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    var b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    var b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    var b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    var b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return Mat.identity(o);
    det = 1.0 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  };
  // Normal matrix: inverse-transpose of the upper 3x3, written into a mat4.
  Mat.normalMatrix = function (o, m) {
    Mat.invert(o, m);
    var t01 = o[1], t02 = o[2], t12 = o[6];
    o[1] = o[4]; o[2] = o[8]; o[4] = t01;
    o[6] = o[9]; o[8] = t02; o[9] = t12;
    o[3] = 0; o[7] = 0; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  };

  /* --------------------------------------------------------------- quat */
  var Q = {};
  M.quat = Q;
  Q.create = function () { return new Float32Array([0, 0, 0, 1]); };
  Q.fromMat4 = function (o, m) {
    var tr = m[0] + m[5] + m[10], s;
    if (tr > 0) {
      s = Math.sqrt(tr + 1.0) * 2;
      o[3] = 0.25 * s;
      o[0] = (m[6] - m[9]) / s;
      o[1] = (m[8] - m[2]) / s;
      o[2] = (m[1] - m[4]) / s;
    } else if (m[0] > m[5] && m[0] > m[10]) {
      s = Math.sqrt(1.0 + m[0] - m[5] - m[10]) * 2;
      o[3] = (m[6] - m[9]) / s;
      o[0] = 0.25 * s;
      o[1] = (m[1] + m[4]) / s;
      o[2] = (m[8] + m[2]) / s;
    } else if (m[5] > m[10]) {
      s = Math.sqrt(1.0 + m[5] - m[0] - m[10]) * 2;
      o[3] = (m[8] - m[2]) / s;
      o[0] = (m[1] + m[4]) / s;
      o[1] = 0.25 * s;
      o[2] = (m[6] + m[9]) / s;
    } else {
      s = Math.sqrt(1.0 + m[10] - m[0] - m[5]) * 2;
      o[3] = (m[1] - m[4]) / s;
      o[0] = (m[8] + m[2]) / s;
      o[1] = (m[6] + m[9]) / s;
      o[2] = 0.25 * s;
    }
    return o;
  };
  Q.toMat4 = function (o, q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2;
    var yy = y * y2, yz = y * z2, zz = z * z2;
    var wx = w * x2, wy = w * y2, wz = w * z2;
    o[0] = 1 - (yy + zz); o[1] = xy + wz; o[2] = xz - wy; o[3] = 0;
    o[4] = xy - wz; o[5] = 1 - (xx + zz); o[6] = yz + wx; o[7] = 0;
    o[8] = xz + wy; o[9] = yz - wx; o[10] = 1 - (xx + yy); o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  };
  Q.slerp = function (o, a, b, t) {
    var ax = a[0], ay = a[1], az = a[2], aw = a[3];
    var bx = b[0], by = b[1], bz = b[2], bw = b[3];
    var cosom = ax * bx + ay * by + az * bz + aw * bw;
    if (cosom < 0) { cosom = -cosom; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    var s0, s1;
    if (1 - cosom > 1e-6) {
      var omega = Math.acos(cosom), sinom = Math.sin(omega);
      s0 = Math.sin((1 - t) * omega) / sinom;
      s1 = Math.sin(t * omega) / sinom;
    } else { s0 = 1 - t; s1 = t; }
    o[0] = s0 * ax + s1 * bx;
    o[1] = s0 * ay + s1 * by;
    o[2] = s0 * az + s1 * bz;
    o[3] = s0 * aw + s1 * bw;
    return o;
  };

  /* --------------------------------------------- orthonormalisation helper
     Gram-Schmidt on the 3x3 part of a mat4. Used after shape matching to
     scrub out scale/shear that the covariance fit leaves behind.          */
  var _gsA = new Float32Array(3), _gsB = new Float32Array(3), _gsC = new Float32Array(3);
  Mat.orthonormalize = function (m) {
    _gsA[0] = m[0]; _gsA[1] = m[1]; _gsA[2] = m[2];
    _gsB[0] = m[4]; _gsB[1] = m[5]; _gsB[2] = m[6];
    V.normalize(_gsA, _gsA);
    // up = normalize(up - right*dot(right,up))
    var d = V.dot(_gsA, _gsB);
    _gsB[0] -= _gsA[0] * d; _gsB[1] -= _gsA[1] * d; _gsB[2] -= _gsA[2] * d;
    V.normalize(_gsB, _gsB);
    V.cross(_gsC, _gsA, _gsB);
    V.normalize(_gsC, _gsC);
    m[0] = _gsA[0]; m[1] = _gsA[1]; m[2] = _gsA[2];
    m[4] = _gsB[0]; m[5] = _gsB[1]; m[6] = _gsB[2];
    m[8] = _gsC[0]; m[9] = _gsC[1]; m[10] = _gsC[2];
    return m;
  };

  /* --------------------------------------------------------- random (PRNG)
     Deterministic map generation needs a seedable generator.             */
  M.rng = function (seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };
  M.rngRange = function (r, a, b) { return a + r() * (b - a); };

})();
