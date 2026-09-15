/* =========================================================================
   BeamDrive Mobile — procedural audio
   Everything is synthesised in the Web Audio graph: no samples ship with
   the game. The engine is a harmonic stack plus a firing-pulse noise bed,
   filtered by load; tyres, wind, impacts and scrapes are shaped noise.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M;

  function Audio() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.masterVolume = 0.85;
    this.sfxVolume = 1.0;
    this.engineVolume = 1.0;
    this._started = false;
  }

  Audio.prototype.start = function () {
    if (this._started) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this._started = true;
    var ctx = this.ctx = new AC({ latencyHint: 'interactive' });

    var master = this.master = ctx.createGain();
    master.gain.value = this.masterVolume;
    // A limiter keeps a big crash from clipping the phone speaker.
    var comp = this.comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 14;
    comp.ratio.value = 7;
    comp.attack.value = 0.004;
    comp.release.value = 0.16;
    master.connect(comp);
    comp.connect(ctx.destination);

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0;
    this.engineBus.connect(master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(master);

    this.buildNoise();
    this.buildEngine();
    this.buildTyres();
    this.buildWind();
    this.ready = true;
  };

  Audio.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };
  Audio.prototype.suspend = function () {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  };

  /* ------------------------------------------------------------- noise -- */
  Audio.prototype.buildNoise = function () {
    var ctx = this.ctx;
    var len = Math.floor(ctx.sampleRate * 2.2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    // Slightly brown-tinted noise sits better under an engine than white.
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      last = (last + 0.028 * w) / 1.028;
      d[i] = w * 0.55 + last * 2.6;
    }
    this.noiseBuffer = buf;
  };

  Audio.prototype.noiseSource = function (loop) {
    var s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer;
    s.loop = loop !== false;
    return s;
  };

  /* ------------------------------------------------------------ engine -- */
  Audio.prototype.buildEngine = function () {
    var ctx = this.ctx;
    this.engine = { oscs: [], gains: [] };

    // Tone stack: one oscillator per firing harmonic.
    var shaper = this.engineShaper = ctx.createWaveShaper();
    var curve = new Float32Array(1024);
    for (var i = 0; i < 1024; i++) {
      var x = (i / 1023) * 2 - 1;
      // Soft asymmetric clip gives the harmonics a bit of bite.
      curve[i] = Math.tanh(x * 2.1) * 0.82 + Math.tanh(x * 5.5) * 0.18;
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    var tone = this.engineTone = ctx.createGain();
    tone.gain.value = 0.42;

    var lp = this.engineLP = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.9;

    var hp = this.engineHP = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 42;

    var body = this.engineBody = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 180;
    body.Q.value = 1.1;
    body.gain.value = 6;

    tone.connect(shaper);
    shaper.connect(body);
    body.connect(lp);
    lp.connect(hp);
    hp.connect(this.engineBus);

    for (var h = 0; h < 7; h++) {
      var o = ctx.createOscillator();
      o.type = h === 0 ? 'sawtooth' : (h % 2 ? 'square' : 'sawtooth');
      o.frequency.value = 60;
      var g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g);
      g.connect(tone);
      o.start();
      this.engine.oscs.push(o);
      this.engine.gains.push(g);
    }

    // Induction / exhaust roar: noise gated by a bandpass that tracks rpm.
    var n = this.engineNoise = this.noiseSource();
    var nbp = this.engineNoiseBP = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 420;
    nbp.Q.value = 0.85;
    var ng = this.engineNoiseGain = ctx.createGain();
    ng.gain.value = 0;
    n.connect(nbp);
    nbp.connect(ng);
    ng.connect(this.engineBus);
    n.start();

    // Turbo whistle and blow-off, used when the spec asks for it.
    var to = this.turboOsc = ctx.createOscillator();
    to.type = 'sine';
    to.frequency.value = 3000;
    var tg = this.turboGain = ctx.createGain();
    tg.gain.value = 0;
    to.connect(tg);
    tg.connect(this.engineBus);
    to.start();
  };

  /* ------------------------------------------------------------- tyres -- */
  Audio.prototype.buildTyres = function () {
    var ctx = this.ctx;
    var n = this.tyreNoise = this.noiseSource();
    var bp = this.tyreBP = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1250;
    bp.Q.value = 5.5;
    var bp2 = this.tyreBP2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 2400;
    bp2.Q.value = 3.2;
    var g = this.tyreGain = ctx.createGain();
    g.gain.value = 0;
    n.connect(bp);
    bp.connect(bp2);
    bp2.connect(g);
    g.connect(this.sfxBus);
    n.start();

    // Rolling / surface roar.
    var rn = this.rollNoise = this.noiseSource();
    var rlp = this.rollLP = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 500;
    var rg = this.rollGain = ctx.createGain();
    rg.gain.value = 0;
    rn.connect(rlp);
    rlp.connect(rg);
    rg.connect(this.sfxBus);
    rn.start();
  };

  Audio.prototype.buildWind = function () {
    var ctx = this.ctx;
    var n = this.windNoise = this.noiseSource();
    var lp = this.windLP = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    var g = this.windGain = ctx.createGain();
    g.gain.value = 0;
    n.connect(lp); lp.connect(hp); hp.connect(g);
    g.connect(this.sfxBus);
    n.start();
  };

  /* -------------------------------------------------------- per-frame --- */

  /* s = { rpm, redline, idle, load, speed, skid, surface, cylinders,
          gearChanging, engineOn, turbo, cabin } */
  Audio.prototype.update = function (s, dt) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx;
    var now = ctx.currentTime;
    var tc = 0.035;

    var rpm = Math.max(s.rpm, 1);
    var cyl = s.cylinders || 4;
    // Firing frequency for a four-stroke.
    var f0 = rpm / 60 * (cyl / 2);
    var load = M.clamp(s.load, 0, 1);
    var rev = M.clamp((rpm - s.idle) / (s.redline - s.idle), 0, 1);

    var harmonics = s.harmonics || [1, 2, 3, 4];
    var growl = s.growl !== undefined ? s.growl : 0.3;

    for (var h = 0; h < this.engine.oscs.length; h++) {
      var mult = harmonics[h % harmonics.length] * (1 + Math.floor(h / harmonics.length));
      var freq = M.clamp(f0 * mult, 18, 11000);
      this.engine.oscs[h].frequency.setTargetAtTime(freq, now, tc);
      // Higher harmonics come in with load; the fundamental always sits there.
      var base = 1 / (1 + mult * 0.85);
      var g = base * (0.30 + load * 0.78) * (h === 0 ? 1.25 : 1.0);
      if (mult > 3) g *= (0.35 + growl * 0.9);
      g *= s.engineOn ? 1 : 0;
      if (s.gearChanging) g *= 0.45;
      this.engine.gains[h].gain.setTargetAtTime(g * 0.30, now, tc);
    }

    this.engineLP.frequency.setTargetAtTime(
      M.clamp(420 + rev * 3400 + load * 2400, 300, 11000), now, 0.05);
    this.engineBody.frequency.setTargetAtTime(M.clamp(f0 * 2.1, 60, 900), now, 0.08);
    this.engineNoiseBP.frequency.setTargetAtTime(M.clamp(220 + rev * 1500, 120, 4000), now, 0.05);
    this.engineNoiseGain.gain.setTargetAtTime(
      (0.020 + load * 0.075 + rev * 0.035) * growl * (s.engineOn ? 1 : 0), now, 0.05);

    var engGain = (s.cabin ? 0.60 : 0.85) * this.engineVolume;
    this.engineBus.gain.setTargetAtTime(s.engineOn ? engGain : 0.0, now, 0.08);

    if (s.turbo) {
      this.turboOsc.frequency.setTargetAtTime(1800 + rev * 5200, now, 0.06);
      this.turboGain.gain.setTargetAtTime(load * rev * 0.020, now, 0.08);
    } else {
      this.turboGain.gain.setTargetAtTime(0, now, 0.1);
    }

    // Tyres.
    var skid = M.clamp(s.skid, 0, 1);
    this.tyreGain.gain.setTargetAtTime(skid * 0.26 * this.sfxVolume, now, 0.045);
    this.tyreBP.frequency.setTargetAtTime(950 + skid * 780 + Math.min(s.speed, 40) * 9, now, 0.06);

    var surfaceRoar = (s.surface === B.SURF.ROAD) ? 0.35 : 1.0;
    var roll = M.clamp(s.speed / 42, 0, 1) * surfaceRoar * (s.wheelsDown ? 1 : 0.1);
    this.rollGain.gain.setTargetAtTime(roll * 0.085 * this.sfxVolume, now, 0.07);
    this.rollLP.frequency.setTargetAtTime(240 + Math.min(s.speed, 60) * 22, now, 0.1);

    // Wind.
    var wind = M.clamp((s.speed - 6) / 55, 0, 1.3);
    this.windGain.gain.setTargetAtTime(wind * wind * 0.14 * this.sfxVolume *
      (s.cabin ? 0.55 : 1.0), now, 0.1);
    this.windLP.frequency.setTargetAtTime(500 + wind * 2400, now, 0.12);
  };

  /* ---------------------------------------------------------- one-shots - */

  Audio.prototype.impact = function (strength, metallic) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, now = ctx.currentTime;
    strength = M.clamp(strength, 0, 1);
    if (strength < 0.02) return;

    // Body thump.
    var n = this.noiseSource(false);
    var bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(900 + strength * 2600, now);
    bp.frequency.exponentialRampToValueAtTime(110, now + 0.22 + strength * 0.3);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(strength * 0.85 * this.sfxVolume, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.28 + strength * 0.45);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(now);
    n.stop(now + 0.9 + strength);

    // Low-frequency body punch.
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140 - strength * 60, now);
    o.frequency.exponentialRampToValueAtTime(34, now + 0.26);
    var og = ctx.createGain();
    og.gain.setValueAtTime(strength * 0.55 * this.sfxVolume, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    o.connect(og); og.connect(this.sfxBus);
    o.start(now); o.stop(now + 0.4);

    // Metallic ring for panel damage.
    if (metallic && strength > 0.18) {
      var ring = ctx.createOscillator();
      ring.type = 'triangle';
      ring.frequency.setValueAtTime(420 + Math.random() * 900, now);
      var rg = ctx.createGain();
      rg.gain.setValueAtTime(strength * 0.16 * this.sfxVolume, now);
      rg.gain.exponentialRampToValueAtTime(0.0005, now + 0.45);
      var rbp = ctx.createBiquadFilter();
      rbp.type = 'bandpass'; rbp.Q.value = 12;
      rbp.frequency.value = 1600 + Math.random() * 1600;
      ring.connect(rbp); rbp.connect(rg); rg.connect(this.sfxBus);
      ring.start(now); ring.stop(now + 0.55);
    }
  };

  Audio.prototype.scrape = function (intensity) {
    if (!this.ready || !this.enabled) return;
    if (!this._scrapeGain) {
      var ctx = this.ctx;
      var n = this.noiseSource();
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 2.4;
      var g = ctx.createGain(); g.gain.value = 0;
      n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
      n.start();
      this._scrapeGain = g;
      this._scrapeBP = bp;
    }
    var now = this.ctx.currentTime;
    this._scrapeGain.gain.setTargetAtTime(
      M.clamp(intensity, 0, 1) * 0.22 * this.sfxVolume, now, 0.05);
    this._scrapeBP.frequency.setTargetAtTime(1800 + Math.random() * 1600, now, 0.08);
  };

  Audio.prototype.gearShift = function () {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, now = ctx.currentTime;
    var n = this.noiseSource(false);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 6;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.10 * this.sfxVolume, now);
    g.gain.exponentialRampToValueAtTime(0.0005, now + 0.075);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(now); n.stop(now + 0.12);
  };

  Audio.prototype.ui = function (kind) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, now = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sine';
    var f = kind === 'back' ? 420 : (kind === 'select' ? 880 : 660);
    o.frequency.setValueAtTime(f, now);
    o.frequency.exponentialRampToValueAtTime(f * (kind === 'back' ? 0.7 : 1.45), now + 0.07);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.09 * this.sfxVolume, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    o.connect(g); g.connect(this.sfxBus);
    o.start(now); o.stop(now + 0.16);
  };

  Audio.prototype.splash = function (strength) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, now = ctx.currentTime;
    var n = this.noiseSource(false);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2600, now);
    bp.frequency.exponentialRampToValueAtTime(600, now + 0.5);
    bp.Q.value = 1.2;
    var g = ctx.createGain();
    g.gain.setValueAtTime(M.clamp(strength, 0, 1) * 0.5 * this.sfxVolume, now);
    g.gain.exponentialRampToValueAtTime(0.0005, now + 0.7);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(now); n.stop(now + 0.8);
  };

  Audio.prototype.setMasterVolume = function (v) {
    this.masterVolume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  };

  B.Audio = Audio;

})();
