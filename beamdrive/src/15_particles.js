/* =========================================================================
   BeamDrive Mobile — particles
   One instanced, camera-facing quad batch for tyre smoke, dust, sparks,
   debris and impact puffs. Soft radial falloff, no textures.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M;

  var VS = [
    '#version 300 es',
    'precision highp float;',
    'layout(location = 0) in vec2 aCorner;',
    'layout(location = 4) in vec4 aPosSize;',
    'layout(location = 5) in vec4 aColor;',
    'layout(location = 6) in vec2 aRotSoft;',
    'uniform mat4 uViewProj;',
    'uniform vec3 uRight;',
    'uniform vec3 uUp;',
    'out vec2 vUV;',
    'out vec4 vColor;',
    'out float vSoft;',
    'void main(){',
    '  vUV = aCorner;',
    '  vColor = aColor;',
    '  vSoft = aRotSoft.y;',
    '  float c = cos(aRotSoft.x), s = sin(aRotSoft.x);',
    '  vec2 r = vec2(aCorner.x*c - aCorner.y*s, aCorner.x*s + aCorner.y*c);',
    '  vec3 world = aPosSize.xyz + uRight*r.x*aPosSize.w + uUp*r.y*aPosSize.w;',
    '  gl_Position = uViewProj * vec4(world, 1.0);',
    '}'
  ].join('\n');

  var FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV;',
    'in vec4 vColor;',
    'in float vSoft;',
    'out vec4 fragColor;',
    'void main(){',
    '  float d = length(vUV);',
    '  if(d > 1.0) discard;',
    '  // vSoft 1 = fluffy smoke, 0 = hard-edged spark or chunk.',
    '  float a = mix(smoothstep(1.0, 0.55, d), step(d, 0.92), 1.0 - vSoft);',
    '  a *= vColor.a;',
    '  fragColor = vec4(vColor.rgb * a, a);',
    '}'
  ].join('\n');

  var MAX = 1400;

  function Particles() {
    var gl = B.GL.get();
    this.program = new B.GL.Program(VS, FS, 'particles');
    this.max = MAX;
    this.count = 0;

    // CPU-side pools.
    this.px = new Float32Array(MAX);
    this.py = new Float32Array(MAX);
    this.pz = new Float32Array(MAX);
    this.vx = new Float32Array(MAX);
    this.vy = new Float32Array(MAX);
    this.vz = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.size0 = new Float32Array(MAX);
    this.size1 = new Float32Array(MAX);
    this.r = new Float32Array(MAX);
    this.g = new Float32Array(MAX);
    this.b = new Float32Array(MAX);
    this.a0 = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.rot = new Float32Array(MAX);
    this.rotV = new Float32Array(MAX);
    this.soft = new Float32Array(MAX);
    this.additive = new Uint8Array(MAX);

    this.instPS = new Float32Array(MAX * 4);
    this.instCol = new Float32Array(MAX * 4);
    this.instRot = new Float32Array(MAX * 2);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    var corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.bufPS = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPS);
    gl.bufferData(gl.ARRAY_BUFFER, this.instPS.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(4, 1);

    this.bufCol = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufCol);
    gl.bufferData(gl.ARRAY_BUFFER, this.instCol.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(5, 1);

    this.bufRot = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufRot);
    gl.bufferData(gl.ARRAY_BUFFER, this.instRot.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(6, 1);

    gl.bindVertexArray(null);
    this.enabled = true;
    this.budget = 1.0;
  }

  Particles.prototype.spawn = function (o) {
    if (!this.enabled) return;
    if (this.count >= this.max * this.budget) return;
    var i = this.count++;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    this.maxLife[i] = o.life || 1;
    this.life[i] = this.maxLife[i];
    this.size0[i] = o.size0 !== undefined ? o.size0 : 0.2;
    this.size1[i] = o.size1 !== undefined ? o.size1 : this.size0[i];
    var c = o.color || [1, 1, 1];
    this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
    this.a0[i] = o.alpha !== undefined ? o.alpha : 0.5;
    this.drag[i] = o.drag !== undefined ? o.drag : 1.4;
    this.grav[i] = o.gravity !== undefined ? o.gravity : 0;
    this.rot[i] = o.rot !== undefined ? o.rot : Math.random() * 6.28;
    this.rotV[i] = o.rotV !== undefined ? o.rotV : (Math.random() - 0.5) * 2.4;
    this.soft[i] = o.soft !== undefined ? o.soft : 1;
    this.additive[i] = o.additive ? 1 : 0;
  };

  Particles.prototype.update = function (dt, terrain, wind) {
    var i = 0;
    var wx = wind ? wind[0] : 0, wz = wind ? wind[2] : 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Swap-remove keeps the arrays packed.
        var last = --this.count;
        if (i !== last) {
          this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
          this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
          this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
          this.size0[i] = this.size0[last]; this.size1[i] = this.size1[last];
          this.r[i] = this.r[last]; this.g[i] = this.g[last]; this.b[i] = this.b[last];
          this.a0[i] = this.a0[last]; this.drag[i] = this.drag[last]; this.grav[i] = this.grav[last];
          this.rot[i] = this.rot[last]; this.rotV[i] = this.rotV[last];
          this.soft[i] = this.soft[last]; this.additive[i] = this.additive[last];
        }
        continue;
      }
      var d = 1 - this.drag[i] * dt;
      if (d < 0) d = 0;
      this.vx[i] = this.vx[i] * d + wx * dt * 0.4;
      this.vz[i] = this.vz[i] * d + wz * dt * 0.4;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      // Debris bounces once off the ground rather than sinking through it.
      if (this.grav[i] < -2 && terrain) {
        var gh = terrain.height(this.px[i], this.pz[i]);
        if (this.py[i] < gh + 0.03) {
          this.py[i] = gh + 0.03;
          this.vy[i] = -this.vy[i] * 0.34;
          this.vx[i] *= 0.6; this.vz[i] *= 0.6;
          this.rotV[i] *= 0.5;
        }
      }
      this.rot[i] += this.rotV[i] * dt;
      i++;
    }
  };

  Particles.prototype.render = function (renderer, camera) {
    if (!this.count) return;
    var gl = B.GL.get();
    var n = this.count;
    var ps = this.instPS, col = this.instCol, rt = this.instRot;
    for (var i = 0; i < n; i++) {
      var t = 1 - this.life[i] / this.maxLife[i];
      ps[i * 4] = this.px[i];
      ps[i * 4 + 1] = this.py[i];
      ps[i * 4 + 2] = this.pz[i];
      ps[i * 4 + 3] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      col[i * 4] = this.r[i];
      col[i * 4 + 1] = this.g[i];
      col[i * 4 + 2] = this.b[i];
      // Fade in fast, out slow.
      var fade = Math.min(t * 7, 1) * (1 - t) * (1 - t);
      col[i * 4 + 3] = this.a0[i] * fade;
      rt[i * 2] = this.rot[i];
      rt[i * 2 + 1] = this.soft[i];
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPS);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, ps, 0, n * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufCol);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, col, 0, n * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufRot);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rt, 0, n * 2);

    var p = this.program.use();
    p.uM4('uViewProj', renderer.viewProj);
    p.u3f('uRight', camera.right[0], camera.right[1], camera.right[2]);
    p.u3f('uUp', camera.up[0], camera.up[1], camera.up[2]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied
    gl.depthMask(false);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    renderer.stats.drawCalls++;
  };

  Particles.prototype.clear = function () { this.count = 0; };

  /* ------------------------------------------------------ effect presets */

  Particles.prototype.tyreSmoke = function (x, y, z, vx, vz, intensity, surface) {
    var tint = [0.80, 0.80, 0.82];
    var alpha = 0.16 * intensity;
    var size = 0.30;
    if (surface === B.SURF.DIRT || surface === B.SURF.SAND) {
      tint = [0.52, 0.42, 0.29]; alpha = 0.26 * intensity; size = 0.42;
    } else if (surface === B.SURF.GRASS) {
      tint = [0.40, 0.42, 0.26]; alpha = 0.18 * intensity; size = 0.34;
    } else if (surface === B.SURF.SNOW) {
      tint = [0.94, 0.95, 0.98]; alpha = 0.30 * intensity; size = 0.40;
    }
    this.spawn({
      x: x + (Math.random() - 0.5) * 0.22,
      y: y + 0.06,
      z: z + (Math.random() - 0.5) * 0.22,
      vx: vx * 0.16 + (Math.random() - 0.5) * 1.1,
      vy: 0.5 + Math.random() * 1.0,
      vz: vz * 0.16 + (Math.random() - 0.5) * 1.1,
      life: 0.9 + Math.random() * 1.1,
      size0: size, size1: size * 4.6,
      color: tint, alpha: alpha, drag: 1.5, gravity: 0.35, soft: 1
    });
  };

  Particles.prototype.sparks = function (x, y, z, nx, ny, nz, amount) {
    var n = Math.min(14, Math.ceil(amount * 12));
    for (var i = 0; i < n; i++) {
      var sp = 3 + Math.random() * 11;
      this.spawn({
        x: x, y: y, z: z,
        vx: nx * sp + (Math.random() - 0.5) * 7,
        vy: ny * sp + Math.random() * 4.5,
        vz: nz * sp + (Math.random() - 0.5) * 7,
        life: 0.22 + Math.random() * 0.45,
        size0: 0.035, size1: 0.012,
        color: [3.4, 1.9, 0.55], alpha: 1.0,
        drag: 1.0, gravity: -13, soft: 0, additive: true
      });
    }
  };

  Particles.prototype.debris = function (x, y, z, amount, color) {
    var n = Math.min(12, Math.ceil(amount * 8));
    for (var i = 0; i < n; i++) {
      this.spawn({
        x: x, y: y, z: z,
        vx: (Math.random() - 0.5) * 8,
        vy: 1.5 + Math.random() * 6,
        vz: (Math.random() - 0.5) * 8,
        life: 1.4 + Math.random() * 1.4,
        size0: 0.05 + Math.random() * 0.09, size1: 0.05 + Math.random() * 0.09,
        color: color || [0.45, 0.45, 0.48], alpha: 0.95,
        drag: 0.45, gravity: -16, soft: 0,
        rotV: (Math.random() - 0.5) * 14
      });
    }
  };

  Particles.prototype.impactPuff = function (x, y, z, amount) {
    var n = Math.min(10, Math.ceil(amount * 6));
    for (var i = 0; i < n; i++) {
      this.spawn({
        x: x, y: y, z: z,
        vx: (Math.random() - 0.5) * 4.5,
        vy: 0.6 + Math.random() * 2.6,
        vz: (Math.random() - 0.5) * 4.5,
        life: 0.55 + Math.random() * 0.75,
        size0: 0.22, size1: 1.5,
        color: [0.62, 0.60, 0.58], alpha: 0.38,
        drag: 2.4, gravity: 0.6, soft: 1
      });
    }
  };

  Particles.prototype.engineSmoke = function (x, y, z, intensity) {
    this.spawn({
      x: x + (Math.random() - 0.5) * 0.25,
      y: y + (Math.random() - 0.5) * 0.15,
      z: z + (Math.random() - 0.5) * 0.25,
      vx: (Math.random() - 0.5) * 0.7,
      vy: 1.2 + Math.random() * 1.4,
      vz: (Math.random() - 0.5) * 0.7,
      life: 1.4 + Math.random() * 1.6,
      size0: 0.24, size1: 2.3,
      color: [0.16, 0.16, 0.17], alpha: 0.30 * intensity,
      drag: 1.1, gravity: 0.9, soft: 1
    });
  };

  Particles.prototype.waterSplash = function (x, y, z, amount) {
    var n = Math.min(16, Math.ceil(amount * 10));
    for (var i = 0; i < n; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 0.7, y: y, z: z + (Math.random() - 0.5) * 0.7,
        vx: (Math.random() - 0.5) * 5,
        vy: 2 + Math.random() * 6,
        vz: (Math.random() - 0.5) * 5,
        life: 0.7 + Math.random() * 0.8,
        size0: 0.12, size1: 0.5,
        color: [0.78, 0.86, 0.92], alpha: 0.55,
        drag: 0.9, gravity: -11, soft: 1
      });
    }
  };

  B.Particles = Particles;

})();
