/* =========================================================================
   BeamDrive Mobile — renderer
   Forward shading into an HDR target, two cascaded shadow maps, an analytic
   sky, and a bloom + tonemap + speed-blur composite. Quality presets scale
   render resolution, shadow size, filter width and which post passes run.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M, Mat = M.m4, V = M.v3;

  var PRESETS = {
    low: {
      renderScale: 0.62, maxDPR: 1.4, shadowRes: 512, shadowQuality: 1, cascades: 1,
      bloom: false, speedBlur: false, chroma: 0, grain: 0.0, aniso: 2,
      shadowFar: 60, terrainLOD: 2, cloudAmount: 0.6, drawDistance: 420
    },
    medium: {
      renderScale: 0.80, maxDPR: 1.8, shadowRes: 1024, shadowQuality: 1, cascades: 2,
      bloom: true, speedBlur: false, chroma: 0.0008, grain: 0.012, aniso: 4,
      shadowFar: 90, terrainLOD: 1, cloudAmount: 0.85, drawDistance: 600
    },
    high: {
      renderScale: 1.0, maxDPR: 2.0, shadowRes: 1536, shadowQuality: 1, cascades: 2,
      bloom: true, speedBlur: true, chroma: 0.0014, grain: 0.016, aniso: 8,
      shadowFar: 120, terrainLOD: 1, cloudAmount: 1.0, drawDistance: 800
    },
    ultra: {
      renderScale: 1.0, maxDPR: 3.0, shadowRes: 2048, shadowQuality: 2, cascades: 2,
      bloom: true, speedBlur: true, chroma: 0.0020, grain: 0.020, aniso: 16,
      shadowFar: 150, terrainLOD: 1, cloudAmount: 1.0, drawDistance: 1000
    }
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.gl = B.GL.init(canvas);
    if (!this.gl) throw new Error('WebGL 2 is not available');
    var gl = this.gl;

    this.preset = 'high';
    this.q = PRESETS.high;
    this.width = 1;
    this.height = 1;
    this.rtWidth = 1;
    this.rtHeight = 1;
    this.dpr = 1;

    var S = B.Shaders;
    this.progMain = new B.GL.Program(S.mainVS, S.mainFS, 'main');
    this.progMainInst = new B.GL.Program(
      S.withDefines(S.mainVS, ['INSTANCED']),
      S.withDefines(S.mainFS, ['INSTANCED']), 'mainInst');
    this.progDepth = new B.GL.Program(S.depthVS, S.depthFS, 'depth');
    this.progDepthInst = new B.GL.Program(
      S.withDefines(S.depthVS, ['INSTANCED']), S.depthFS, 'depthInst');
    this.progSky = new B.GL.Program(S.skyVS, S.skyFS, 'sky');
    this.progBright = new B.GL.Program(S.postVS, S.brightFS, 'bright');
    this.progBlur = new B.GL.Program(S.postVS, S.blurFS, 'blur');
    this.progComposite = new B.GL.Program(S.postVS, S.compositeFS, 'composite');
    this.progBlit = new B.GL.Program(S.postVS, S.blitFS, 'blit');

    this.sceneFBO = null;
    this.bloomA = null;
    this.bloomB = null;
    this.bloomC = null;
    this.bloomD = null;
    this.shadowFBO = [];

    this.viewMatrix = Mat.create();
    this.projMatrix = Mat.create();
    this.viewProj = Mat.create();
    this.invViewProj = Mat.create();
    this.normalMat = Mat.create();
    this.lightVP = [Mat.create(), Mat.create()];
    this._tmpM = Mat.create();
    this._tmpM2 = Mat.create();
    this._eye = new Float32Array(3);
    this._focus = new Float32Array(3);

    this.time = 0;
    this.speedBlurAmount = 0;
    this.damageFlash = 0;
    this.blurCenter = [0.5, 0.5];
    this.exposure = 1.0;
    this.saturation = 1.06;
    this.contrast = 1.05;
    this.sepia = 0;

    this.stats = { drawCalls: 0, triangles: 0 };

    this.setPreset('high');
  }

  Renderer.prototype.setPreset = function (name) {
    if (!PRESETS[name]) name = 'high';
    this.preset = name;
    this.q = PRESETS[name];
    this.resize(this.cssWidth || window.innerWidth, this.cssHeight || window.innerHeight, this.dprRequest);
    this.buildShadowMaps();
  };

  Renderer.prototype.buildShadowMaps = function () {
    var gl = this.gl;
    for (var i = 0; i < this.shadowFBO.length; i++) this.shadowFBO[i].dispose();
    this.shadowFBO = [];
    var res = this.q.shadowRes;
    var count = this.q.cascades;
    for (var c = 0; c < count; c++) {
      this.shadowFBO.push(new B.GL.Framebuffer({
        width: c === 0 ? res : Math.max(512, res >> 1),
        height: c === 0 ? res : Math.max(512, res >> 1),
        color: false, depthTexture: true
      }));
    }
    // A 1x1 white stand-in keeps the sampler bound when a cascade is absent.
    if (!this.dummyShadow) {
      this.dummyShadow = new B.GL.Texture({
        width: 1, height: 1,
        internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE,
        data: new Uint8Array([255]), min: gl.NEAREST, mag: gl.NEAREST,
        wrap: gl.CLAMP_TO_EDGE
      });
    }
  };

  Renderer.prototype.resize = function (cssW, cssH, dprRequest) {
    var gl = this.gl;
    this.cssWidth = cssW;
    this.cssHeight = cssH;
    this.dprRequest = dprRequest;
    var dpr = Math.min(dprRequest || window.devicePixelRatio || 1, this.q.maxDPR);
    this.dpr = dpr;
    var w = Math.max(2, Math.round(cssW * dpr));
    var h = Math.max(2, Math.round(cssH * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.width = w;
    this.height = h;

    var rw = Math.max(2, Math.round(w * this.q.renderScale));
    var rh = Math.max(2, Math.round(h * this.q.renderScale));
    if (rw === this.rtWidth && rh === this.rtHeight && this.sceneFBO) return;
    this.rtWidth = rw;
    this.rtHeight = rh;

    if (this.sceneFBO) this.sceneFBO.dispose();
    this.sceneFBO = new B.GL.Framebuffer({ width: rw, height: rh, hdr: true, depth: true });

    var bw = Math.max(2, rw >> 1), bh = Math.max(2, rh >> 1);
    var cw = Math.max(2, rw >> 2), ch = Math.max(2, rh >> 2);
    [this.bloomA, this.bloomB, this.bloomC, this.bloomD].forEach(function (f) { if (f) f.dispose(); });
    this.bloomA = new B.GL.Framebuffer({ width: bw, height: bh, hdr: true, depth: false });
    this.bloomB = new B.GL.Framebuffer({ width: bw, height: bh, hdr: true, depth: false });
    this.bloomC = new B.GL.Framebuffer({ width: cw, height: ch, hdr: true, depth: false });
    this.bloomD = new B.GL.Framebuffer({ width: cw, height: ch, hdr: true, depth: false });
  };

  /* ----------------------------------------------------- shadow cascades */

  var _lightPos = new Float32Array(3);
  var _up = new Float32Array(3);
  Renderer.prototype.buildCascade = function (index, focus, radius, sunDir) {
    var view = this._tmpM, proj = this._tmpM2;
    // Snap the focus to shadow-map texels so the map does not crawl.
    var res = this.shadowFBO[index].width;
    var texelSize = (radius * 2) / res;
    var fx = Math.round(focus[0] / texelSize) * texelSize;
    var fy = Math.round(focus[1] / texelSize) * texelSize;
    var fz = Math.round(focus[2] / texelSize) * texelSize;

    var dist = radius * 3.2 + 60;
    _lightPos[0] = fx + sunDir[0] * dist;
    _lightPos[1] = fy + sunDir[1] * dist;
    _lightPos[2] = fz + sunDir[2] * dist;
    _up[0] = 0; _up[1] = 1; _up[2] = 0;
    if (Math.abs(sunDir[1]) > 0.985) { _up[1] = 0; _up[2] = 1; }
    Mat.lookAt(view, _lightPos, [fx, fy, fz], _up);
    Mat.ortho(proj, -radius, radius, -radius, radius, 1, dist * 2 + radius * 2);
    Mat.mul(this.lightVP[index], proj, view);
  };

  /* --------------------------------------------------------- the drawing */

  Renderer.prototype.setMaterialUniforms = function (p, mat, env) {
    p.u3v('uBaseColor', mat.baseColor || [1, 1, 1]);
    p.u1f('uRoughness', mat.roughness !== undefined ? mat.roughness : 0.7);
    p.u1f('uMetallic', mat.metallic !== undefined ? mat.metallic : 0);
    p.u3v('uEmissive', mat.emissive || [0, 0, 0]);
    p.u1f('uClearcoat', mat.clearcoat || 0);
    p.u1f('uOpacity', mat.opacity !== undefined ? mat.opacity : 1);
    p.u1i('uMatType', mat.type || 0);
  };

  Renderer.prototype.setFrameUniforms = function (p, env, camPos) {
    p.uM4('uProj', this.projMatrix);
    p.uM4('uView', this.viewMatrix);
    p.uM4('uLightVP0', this.lightVP[0]);
    p.uM4('uLightVP1', this.q.cascades > 1 ? this.lightVP[1] : this.lightVP[0]);
    p.u3v('uCamPos', camPos);
    p.u3v('uSunDir', env.sunDir);
    p.u3v('uSunColor', env.sunColor);
    p.u3v('uSkyZenith', env.skyZenith);
    p.u3v('uSkyHorizon', env.skyHorizon);
    p.u3v('uGroundAmb', env.groundAmb);
    p.u1f('uTurbidity', env.turbidity !== undefined ? env.turbidity : 1);
    p.u3v('uFogColor', env.fogColor);
    p.u1f('uFogDensity', env.fogDensity);
    p.u1f('uFogHeight', env.fogHeight || 20);
    p.u1f('uTime', this.time);
    p.u1f('uExposure', 1.0);
    p.u1i('uShadowQuality', this.q.shadowQuality);
    p.u1f('uShadowSplit', this.shadowSplit);
    p.u2f('uShadowTexel0', 1 / this.shadowFBO[0].width, 1 / this.shadowFBO[0].height);
    if (this.q.cascades > 1) {
      p.u2f('uShadowTexel1', 1 / this.shadowFBO[1].width, 1 / this.shadowFBO[1].height);
    } else {
      p.u2f('uShadowTexel1', 1 / this.shadowFBO[0].width, 1 / this.shadowFBO[0].height);
    }
    p.u3f('uWindPhase', this.time * 1.35, 0, 0);
  };

  Renderer.prototype.bindShadowTextures = function (p) {
    p.uTex('uShadow0', this.shadowFBO[0].depthTex);
    p.uTex('uShadow1', this.q.cascades > 1 ? this.shadowFBO[1].depthTex : this.shadowFBO[0].depthTex);
  };

  Renderer.prototype.render = function (scene, camera, dt) {
    var gl = this.gl;
    this.time += dt;
    this.stats.drawCalls = 0;
    this.stats.triangles = 0;

    var env = scene.env;
    Mat.copy(this.viewMatrix, camera.viewMatrix);
    Mat.copy(this.projMatrix, camera.projMatrix);
    Mat.mul(this.viewProj, this.projMatrix, this.viewMatrix);
    Mat.invert(this.invViewProj, this.viewProj);
    this._eye[0] = camera.position[0];
    this._eye[1] = camera.position[1];
    this._eye[2] = camera.position[2];

    /* ---------------------------------------------------- shadow passes */
    // Push the cascade centre out ahead of the camera so more of the map in
    // front of the car is covered.
    this._focus[0] = camera.position[0] + camera.forward[0] * this.q.shadowFar * 0.22;
    this._focus[1] = camera.position[1] + camera.forward[1] * this.q.shadowFar * 0.10;
    this._focus[2] = camera.position[2] + camera.forward[2] * this.q.shadowFar * 0.22;

    var nearRadius = Math.max(16, this.q.shadowFar * 0.20);
    this.shadowSplit = nearRadius * 1.9;
    this.buildCascade(0, this._focus, nearRadius, env.sunDir);
    if (this.q.cascades > 1) {
      this.buildCascade(1, this._focus, this.q.shadowFar, env.sunDir);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    for (var c = 0; c < this.q.cascades; c++) {
      var fbo = this.shadowFBO[c];
      fbo.bind();
      gl.clear(gl.DEPTH_BUFFER_BIT);
      // Front-face culling in the depth pass pushes peter-panning off the
      // lit side of thin geometry.
      gl.cullFace(gl.FRONT);
      var pd = this.progDepth.use();
      pd.uM4('uLightVP', this.lightVP[c]);
      var i, o;
      for (i = 0; i < scene.opaque.length; i++) {
        o = scene.opaque[i];
        if (o.castShadow === false || o.visible === false) continue;
        pd.uM4('uModel', o.matrix);
        o.geometry.draw();
        this.stats.drawCalls++;
      }
      var pdi = this.progDepthInst.use();
      pdi.uM4('uLightVP', this.lightVP[c]);
      for (i = 0; i < scene.instanced.length; i++) {
        o = scene.instanced[i];
        if (o.castShadow === false || o.visible === false) continue;
        o.geometry.draw();
        this.stats.drawCalls++;
      }
      gl.cullFace(gl.BACK);
    }

    /* ------------------------------------------------------- main pass */
    this.sceneFBO.bind();
    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);

    var head = scene.headlight;
    var p = this.progMain.use();
    this.setFrameUniforms(p, env, this._eye);
    this.bindShadowTextures(p);
    p.u1i('uHeadlights', head && head.on ? 1 : 0);
    if (head && head.on) { p.u3v('uHeadPos', head.pos); p.u3v('uHeadDir', head.dir); }

    var drawOpaque = function (self, list) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o.visible === false) continue;
        if (o.material.doubleSided) gl.disable(gl.CULL_FACE);
        p.uM4('uModel', o.matrix);
        Mat.normalMatrix(self.normalMat, o.matrix);
        p.uM4('uNormalMat', self.normalMat);
        self.setMaterialUniforms(p, o.material, env);
        // Texture units must be rebound after the material rebinds samplers.
        p._texUnit = 0;
        self.bindShadowTextures(p);
        o.geometry.draw();
        self.stats.drawCalls++;
        self.stats.triangles += o.geometry.count / 3;
        if (o.material.doubleSided) gl.enable(gl.CULL_FACE);
      }
    };
    drawOpaque(this, scene.opaque);

    // Instanced props.
    var pi = this.progMainInst.use();
    this.setFrameUniforms(pi, env, this._eye);
    pi.u1i('uHeadlights', head && head.on ? 1 : 0);
    if (head && head.on) { pi.u3v('uHeadPos', head.pos); pi.u3v('uHeadDir', head.dir); }
    for (var k = 0; k < scene.instanced.length; k++) {
      var io = scene.instanced[k];
      if (io.visible === false) continue;
      if (io.material.doubleSided) gl.disable(gl.CULL_FACE);
      this.setMaterialUniforms(pi, io.material, env);
      pi._texUnit = 0;
      this.bindShadowTextures(pi);
      io.geometry.draw();
      this.stats.drawCalls++;
      this.stats.triangles += io.geometry.count / 3 * io.geometry.instanceCount;
      if (io.material.doubleSided) gl.enable(gl.CULL_FACE);
    }

    /* ------------------------------------------------------------- sky */
    gl.depthMask(false);
    var ps = this.progSky.use();
    ps.uM4('uInvViewProj', this.invViewProj);
    ps.u3v('uCamPos', this._eye);
    ps.u3v('uSunDir', env.sunDir);
    ps.u3v('uSunColor', env.sunColor);
    ps.u3v('uSkyZenith', env.skyZenith);
    ps.u3v('uSkyHorizon', env.skyHorizon);
    ps.u1f('uTurbidity', env.turbidity !== undefined ? env.turbidity : 1);
    ps.u1f('uTime', this.time);
    ps.u1f('uCloudAmount', (env.cloudAmount || 0) * this.q.cloudAmount);
    ps.u1f('uExposure', 1.0);
    B.GL.drawFullscreen();
    this.stats.drawCalls++;

    /* ----------------------------------------------------- transparents */
    if (scene.transparent.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      var pt = this.progMain.use();
      this.setFrameUniforms(pt, env, this._eye);
      pt.u1i('uHeadlights', head && head.on ? 1 : 0);
      if (head && head.on) { pt.u3v('uHeadPos', head.pos); pt.u3v('uHeadDir', head.dir); }
      // Farthest first so overlapping panes blend in the right order.
      var eye = this._eye;
      scene.transparent.sort(function (a, b) {
        var ax = a.matrix[12] - eye[0], ay = a.matrix[13] - eye[1], az = a.matrix[14] - eye[2];
        var bx = b.matrix[12] - eye[0], by = b.matrix[13] - eye[1], bz = b.matrix[14] - eye[2];
        return (bx * bx + by * by + bz * bz) - (ax * ax + ay * ay + az * az);
      });
      for (var ti = 0; ti < scene.transparent.length; ti++) {
        var to = scene.transparent[ti];
        if (to.visible === false) continue;
        gl.disable(gl.CULL_FACE);
        pt.uM4('uModel', to.matrix);
        Mat.normalMatrix(this.normalMat, to.matrix);
        pt.uM4('uNormalMat', this.normalMat);
        this.setMaterialUniforms(pt, to.material, env);
        pt._texUnit = 0;
        this.bindShadowTextures(pt);
        to.geometry.draw();
        this.stats.drawCalls++;
        gl.enable(gl.CULL_FACE);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    /* ------------------------------------------------------- particles */
    if (scene.particles && scene.particles.count > 0) {
      scene.particles.render(this, camera);
    }

    /* ------------------------------------------------------------- post */
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    var bloomTexA = null, bloomTexB = null;
    if (this.q.bloom) {
      var pb = this.progBright.use();
      this.bloomA.bind();
      pb.uTex('uTex', this.sceneFBO.color);
      pb.u1f('uThreshold', 1.45);
      pb.u1f('uSoftKnee', 0.45);
      B.GL.drawFullscreen();

      var pbl = this.progBlur.use();
      this.bloomB.bind();
      pbl.uTex('uTex', this.bloomA.color);
      pbl.u2f('uDir', 1.4 / this.bloomA.width, 0);
      B.GL.drawFullscreen();

      this.bloomA.bind();
      pbl = this.progBlur.use();
      pbl.uTex('uTex', this.bloomB.color);
      pbl.u2f('uDir', 0, 1.4 / this.bloomA.height);
      B.GL.drawFullscreen();

      // Second, wider mip.
      this.bloomC.bind();
      pbl = this.progBlur.use();
      pbl.uTex('uTex', this.bloomA.color);
      pbl.u2f('uDir', 2.6 / this.bloomC.width, 0);
      B.GL.drawFullscreen();

      this.bloomD.bind();
      pbl = this.progBlur.use();
      pbl.uTex('uTex', this.bloomC.color);
      pbl.u2f('uDir', 0, 2.6 / this.bloomD.height);
      B.GL.drawFullscreen();

      bloomTexA = this.bloomA.color;
      bloomTexB = this.bloomD.color;
    }

    B.GL.bindScreen(this.width, this.height);
    var pc = this.progComposite.use();
    pc.uTex('uScene', this.sceneFBO.color);
    pc.uTex('uBloom0', bloomTexA || this.sceneFBO.color);
    pc.uTex('uBloom1', bloomTexB || this.sceneFBO.color);
    pc.u1f('uBloomStrength', this.q.bloom ? (scene.bloomStrength !== undefined ? scene.bloomStrength : 0.34) : 0);
    pc.u1f('uVignette', 0.34);
    pc.u1f('uChroma', this.q.chroma);
    pc.u1f('uGrain', this.q.grain);
    pc.u1f('uSpeedBlur', this.q.speedBlur ? this.speedBlurAmount : 0);
    pc.u2f('uBlurCenter', this.blurCenter[0], this.blurCenter[1]);
    pc.u1f('uTime', this.time);
    pc.u1f('uExposure', this.exposure * (env.exposure || 1));
    pc.u1f('uContrast', this.contrast);
    pc.u1f('uSaturation', this.saturation);
    pc.u1f('uDamageFlash', this.damageFlash);
    pc.u1f('uSepia', this.sepia);
    B.GL.drawFullscreen();
  };

  Renderer.PRESETS = PRESETS;
  B.Renderer = Renderer;

})();
