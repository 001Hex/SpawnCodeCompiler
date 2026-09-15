/* =========================================================================
   BeamDrive Mobile — thin WebGL2 layer
   Programs, geometry (static + dynamic), textures, framebuffers.
   Deliberately small: the renderer owns all policy, this owns only state.
   ========================================================================= */
(function () {
  'use strict';

  var G = {};
  B.GL = G;

  var gl = null;
  G.caps = {
    colorBufferFloat: false,
    textureFloatLinear: false,
    maxTextureSize: 2048,
    maxSamples: 0,
    anisotropy: 0,
    anisoExt: null
  };

  G.get = function () { return gl; };

  G.init = function (canvas, opts) {
    opts = opts || {};
    var attrs = {
      alpha: false,
      depth: true,
      stencil: false,
      antialias: false,           // we resolve through our own post chain
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
      desynchronized: true
    };
    gl = canvas.getContext('webgl2', attrs);
    if (!gl) return null;

    G.caps.colorBufferFloat = !!gl.getExtension('EXT_color_buffer_float');
    G.caps.textureFloatLinear = !!gl.getExtension('OES_texture_float_linear');
    var aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      G.caps.anisoExt = aniso;
      G.caps.anisotropy = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    }
    G.caps.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    try { G.caps.maxSamples = gl.getParameter(gl.MAX_SAMPLES); } catch (e) { G.caps.maxSamples = 0; }

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return gl;
  };

  /* --------------------------------------------------------------- shaders */
  function compile(type, src, label) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      var lines = src.split('\n');
      var numbered = lines.map(function (l, i) { return (i + 1) + ': ' + l; }).join('\n');
      gl.deleteShader(sh);
      throw new Error('Shader compile failed [' + label + ']\n' + log + '\n' + numbered);
    }
    return sh;
  }

  function Program(vsSrc, fsSrc, label) {
    this.label = label || 'program';
    var vs = compile(gl.VERTEX_SHADER, vsSrc, this.label + ':vs');
    var fs = compile(gl.FRAGMENT_SHADER, fsSrc, this.label + ':fs');
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    // Fixed attribute slots keep every VAO layout interchangeable.
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aNormal');
    gl.bindAttribLocation(p, 2, 'aUV');
    gl.bindAttribLocation(p, 3, 'aColor');
    gl.bindAttribLocation(p, 4, 'aIM0');
    gl.bindAttribLocation(p, 5, 'aIM1');
    gl.bindAttribLocation(p, 6, 'aIM2');
    gl.bindAttribLocation(p, 7, 'aIM3');
    gl.bindAttribLocation(p, 8, 'aITint');
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error('Program link failed [' + this.label + ']: ' + log);
    }
    this.id = p;
    this.uniforms = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      var name = info.name.replace(/\[0\]$/, '');
      this.uniforms[name] = gl.getUniformLocation(p, name);
    }
    this._texUnit = 0;
  }

  Program.prototype.use = function () {
    gl.useProgram(this.id);
    this._texUnit = 0;
    return this;
  };
  Program.prototype.has = function (n) { return this.uniforms[n] !== undefined; };
  Program.prototype.u1f = function (n, v) { var l = this.uniforms[n]; if (l) gl.uniform1f(l, v); return this; };
  Program.prototype.u1i = function (n, v) { var l = this.uniforms[n]; if (l) gl.uniform1i(l, v); return this; };
  Program.prototype.u2f = function (n, a, b) { var l = this.uniforms[n]; if (l) gl.uniform2f(l, a, b); return this; };
  Program.prototype.u3f = function (n, a, b, c) { var l = this.uniforms[n]; if (l) gl.uniform3f(l, a, b, c); return this; };
  Program.prototype.u4f = function (n, a, b, c, d) { var l = this.uniforms[n]; if (l) gl.uniform4f(l, a, b, c, d); return this; };
  Program.prototype.u3v = function (n, v) { var l = this.uniforms[n]; if (l) gl.uniform3f(l, v[0], v[1], v[2]); return this; };
  Program.prototype.uM4 = function (n, m) { var l = this.uniforms[n]; if (l) gl.uniformMatrix4fv(l, false, m); return this; };
  Program.prototype.uTex = function (n, tex) {
    var l = this.uniforms[n];
    if (!l || !tex) return this;
    var unit = this._texUnit++;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(tex.target || gl.TEXTURE_2D, tex.id !== undefined ? tex.id : tex);
    gl.uniform1i(l, unit);
    return this;
  };
  G.Program = Program;

  /* -------------------------------------------------------------- geometry
     A Geometry owns interleaved-by-stream buffers. Streams are separate
     buffers so the soft-body code can re-upload only positions + normals.  */
  function Geometry(opts) {
    opts = opts || {};
    this.dynamic = !!opts.dynamic;
    this.vao = gl.createVertexArray();
    this.buffers = {};
    this.indexBuffer = null;
    this.count = 0;
    this.vertexCount = 0;
    this.mode = gl.TRIANGLES;
    this.indexType = gl.UNSIGNED_SHORT;
    this.instanceCount = 0;
    this.instanceBuffer = null;
    this.bounds = { min: [0, 0, 0], max: [0, 0, 0], radius: 1, center: [0, 0, 0] };
  }

  var ATTR = { position: 0, normal: 1, uv: 2, color: 3 };
  var ATTR_SIZE = { position: 3, normal: 3, uv: 2, color: 3 };

  Geometry.prototype.setAttribute = function (name, data) {
    var loc = ATTR[name];
    if (loc === undefined) throw new Error('unknown attribute ' + name);
    var size = ATTR_SIZE[name];
    gl.bindVertexArray(this.vao);
    var buf = this.buffers[name];
    if (!buf) {
      buf = gl.createBuffer();
      this.buffers[name] = buf;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, this.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    if (name === 'position') this.vertexCount = data.length / 3;
    this['_' + name] = data;
    gl.bindVertexArray(null);
    return this;
  };

  Geometry.prototype.updateAttribute = function (name, data) {
    var buf = this.buffers[name];
    if (!buf) return this.setAttribute(name, data);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    return this;
  };

  Geometry.prototype.setIndices = function (data) {
    gl.bindVertexArray(this.vao);
    if (!this.indexBuffer) this.indexBuffer = gl.createBuffer();
    var arr = data;
    if (!(arr instanceof Uint16Array) && !(arr instanceof Uint32Array)) {
      arr = (this.vertexCount > 65535) ? new Uint32Array(data) : new Uint16Array(data);
    }
    this.indexType = (arr instanceof Uint32Array) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    this.count = arr.length;
    this._indices = arr;
    gl.bindVertexArray(null);
    return this;
  };

  // Per-instance mat4 + tint. Slots 4..7 hold the matrix rows, 8 the tint.
  Geometry.prototype.setInstances = function (matrices, tints) {
    gl.bindVertexArray(this.vao);
    if (!this.instanceBuffer) this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, matrices, gl.STATIC_DRAW);
    for (var i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(4 + i);
      gl.vertexAttribPointer(4 + i, 4, gl.FLOAT, false, 64, i * 16);
      gl.vertexAttribDivisor(4 + i, 1);
    }
    if (tints) {
      if (!this.tintBuffer) this.tintBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tintBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, tints, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(8);
      gl.vertexAttribPointer(8, 3, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(8, 1);
    }
    this.instanceCount = matrices.length / 16;
    gl.bindVertexArray(null);
    return this;
  };

  Geometry.prototype.computeBounds = function () {
    var p = this._position;
    if (!p || !p.length) return this;
    var minx = Infinity, miny = Infinity, minz = Infinity;
    var maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (var i = 0; i < p.length; i += 3) {
      if (p[i] < minx) minx = p[i]; if (p[i] > maxx) maxx = p[i];
      if (p[i + 1] < miny) miny = p[i + 1]; if (p[i + 1] > maxy) maxy = p[i + 1];
      if (p[i + 2] < minz) minz = p[i + 2]; if (p[i + 2] > maxz) maxz = p[i + 2];
    }
    var cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
    var dx = maxx - cx, dy = maxy - cy, dz = maxz - cz;
    this.bounds.min = [minx, miny, minz];
    this.bounds.max = [maxx, maxy, maxz];
    this.bounds.center = [cx, cy, cz];
    this.bounds.radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return this;
  };

  Geometry.prototype.bind = function () { gl.bindVertexArray(this.vao); return this; };

  Geometry.prototype.draw = function () {
    gl.bindVertexArray(this.vao);
    if (this.instanceCount > 0) {
      gl.drawElementsInstanced(this.mode, this.count, this.indexType, 0, this.instanceCount);
    } else {
      gl.drawElements(this.mode, this.count, this.indexType, 0);
    }
  };

  Geometry.prototype.dispose = function () {
    for (var k in this.buffers) gl.deleteBuffer(this.buffers[k]);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
    if (this.tintBuffer) gl.deleteBuffer(this.tintBuffer);
    gl.deleteVertexArray(this.vao);
  };

  G.Geometry = Geometry;

  /* -------------------------------------------------------------- textures */
  function Texture(opts) {
    opts = opts || {};
    this.target = opts.target || gl.TEXTURE_2D;
    this.id = gl.createTexture();
    this.width = opts.width || 1;
    this.height = opts.height || 1;
    gl.bindTexture(this.target, this.id);

    var internal = opts.internalFormat || gl.RGBA8;
    var format = opts.format || gl.RGBA;
    var type = opts.type || gl.UNSIGNED_BYTE;

    if (opts.image) {
      gl.texImage2D(this.target, 0, internal, format, type, opts.image);
      this.width = opts.image.width;
      this.height = opts.image.height;
    } else {
      gl.texImage2D(this.target, 0, internal, this.width, this.height, 0, format, type,
        opts.data !== undefined ? opts.data : null);
    }

    var min = opts.min || (opts.mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    var mag = opts.mag || gl.LINEAR;
    var wrap = opts.wrap || gl.REPEAT;
    gl.texParameteri(this.target, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(this.target, gl.TEXTURE_MAG_FILTER, mag);
    gl.texParameteri(this.target, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(this.target, gl.TEXTURE_WRAP_T, wrap);
    if (opts.compare) {
      gl.texParameteri(this.target, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(this.target, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    }
    if (opts.mipmap) gl.generateMipmap(this.target);
    if (opts.aniso && G.caps.anisoExt) {
      gl.texParameterf(this.target, G.caps.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(opts.aniso, G.caps.anisotropy));
    }
    gl.bindTexture(this.target, null);
  }
  Texture.prototype.dispose = function () { gl.deleteTexture(this.id); };
  G.Texture = Texture;

  /* ---------------------------------------------------------- framebuffers */
  function Framebuffer(opts) {
    opts = opts || {};
    this.width = opts.width | 0;
    this.height = opts.height | 0;
    this.fbo = gl.createFramebuffer();
    this.color = null;
    this.depth = null;
    this.depthTex = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);

    if (opts.color !== false) {
      var hdr = opts.hdr && G.caps.colorBufferFloat;
      this.color = new Texture({
        width: this.width, height: this.height,
        internalFormat: hdr ? gl.RGBA16F : gl.RGBA8,
        format: gl.RGBA,
        type: hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
        min: gl.LINEAR, mag: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE
      });
      this.hdr = !!hdr;
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.color.id, 0);
    } else {
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
    }

    if (opts.depthTexture) {
      this.depthTex = new Texture({
        width: this.width, height: this.height,
        internalFormat: gl.DEPTH_COMPONENT24,
        format: gl.DEPTH_COMPONENT,
        type: gl.UNSIGNED_INT,
        min: gl.LINEAR, mag: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE,
        compare: !!opts.compare
      });
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex.id, 0);
    } else if (opts.depth !== false) {
      this.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    }

    var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    this.complete = (status === gl.FRAMEBUFFER_COMPLETE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  Framebuffer.prototype.bind = function () {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    return this;
  };
  Framebuffer.prototype.dispose = function () {
    if (this.color) this.color.dispose();
    if (this.depthTex) this.depthTex.dispose();
    if (this.depth) gl.deleteRenderbuffer(this.depth);
    gl.deleteFramebuffer(this.fbo);
  };
  G.Framebuffer = Framebuffer;

  /* ------------------------------------------------------- fullscreen quad */
  var quadVAO = null;
  G.drawFullscreen = function () {
    if (!quadVAO) {
      quadVAO = gl.createVertexArray();
      gl.bindVertexArray(quadVAO);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      // One oversized triangle beats a quad: no diagonal seam, fewer verts.
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  G.bindScreen = function (w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
  };

})();
