/* =========================================================================
   BeamDrive Mobile — input
   Four touch schemes (buttons, tilt, virtual wheel, drag slider) plus
   keyboard and gamepad. Analogue axes are ramped rather than snapped so a
   binary touch still drives like a progressive pedal.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M;

  function Input() {
    this.state = {
      steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0,
      lookYaw: 0, lookPitch: 0, lookActive: false,
      freeMove: [0, 0, 0], freeBoost: false,
      orbitDelta: [0, 0], orbitZoom: 0
    };
    this.raw = { steerLeft: 0, steerRight: 0, throttle: 0, brake: 0, handbrake: 0, wheel: 0, slider: 0 };
    this.edges = {};
    this.scheme = 'buttons';        // buttons | tilt | wheel | slider
    this.sensitivity = 1.0;
    this.steerSpeed = 3.4;
    this.steerReturn = 5.2;
    this.tiltZero = 0;
    this.tiltRange = 26;            // degrees for full lock
    this.tiltCalibrated = false;
    this.invertTilt = false;
    this.keys = {};
    this.pointers = {};
    this.buttons = {};
    this.gamepadIndex = -1;
    this.enabled = true;
    this.lookDecay = 3.0;
    this._wheelActive = false;
    this._wheelStartAngle = 0;
    this._wheelValue = 0;
    this._sliderActive = false;
    this._sliderStartX = 0;
    this._tiltGamma = 0;
    this._tiltBeta = 0;
    this.tiltAvailable = false;
    this.tiltPermission = 'unknown';
    this._lookId = null;
    this._lookLast = [0, 0];
  }

  /* ------------------------------------------------------------ keyboard */

  Input.prototype.attachKeyboard = function (target) {
    var self = this;
    (target || window).addEventListener('keydown', function (e) {
      if (e.repeat) return;
      var k = e.key.toLowerCase();
      self.keys[k] = true;
      if (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright' ||
          k === ' ') e.preventDefault();
      if (k === 'c') self.edges.camera = true;
      if (k === 'r') self.edges.reset = true;
      if (k === 'escape') self.edges.pause = true;
      if (k === 'e') self.edges.shiftUp = true;
      if (k === 'q') self.edges.shiftDown = true;
      if (k === 'f') self.edges.flip = true;
      if (k === 'l') self.edges.lights = true;
      if (k === 'h') self.edges.horn = true;
      if (k === 'p') self.edges.photo = true;
    });
    (target || window).addEventListener('keyup', function (e) {
      self.keys[e.key.toLowerCase()] = false;
    });
    window.addEventListener('blur', function () { self.keys = {}; });
  };

  /* ------------------------------------------------------ touch buttons */

  // `mode` is 'hold' for analogue-style buttons or 'tap' for edge actions.
  Input.prototype.bindButton = function (el, name, mode) {
    if (!el) return;
    var self = this;
    var isTap = mode === 'tap';
    el.style.touchAction = 'none';
    var active = false;

    function down(e) {
      if (!self.enabled) return;
      e.preventDefault();
      e.stopPropagation();
      active = true;
      el.classList.add('pressed');
      if (isTap) self.edges[name] = true;
      else self.buttons[name] = 1;
      if (el.setPointerCapture && e.pointerId !== undefined) {
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
      if (navigator.vibrate && self.haptics) navigator.vibrate(8);
    }
    function up(e) {
      if (!active) return;
      active = false;
      el.classList.remove('pressed');
      if (!isTap) self.buttons[name] = 0;
    }
    el.addEventListener('pointerdown', down, { passive: false });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', function (e) {
      // Keep a held pedal alive if the finger slides but stays down.
      if (!active) return;
      if (e.buttons === 0) up(e);
    });
  };

  /* --------------------------------------------------- virtual steering */

  Input.prototype.bindWheel = function (el) {
    if (!el) return;
    var self = this;
    el.style.touchAction = 'none';
    var rect = null, cx = 0, cy = 0, startAngle = 0, startVal = 0;

    function angleOf(e) {
      return Math.atan2(e.clientY - cy, e.clientX - cx);
    }
    el.addEventListener('pointerdown', function (e) {
      if (!self.enabled) return;
      e.preventDefault();
      rect = el.getBoundingClientRect();
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height / 2;
      startAngle = angleOf(e);
      startVal = self._wheelValue;
      self._wheelActive = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }, { passive: false });
    el.addEventListener('pointermove', function (e) {
      if (!self._wheelActive) return;
      e.preventDefault();
      var d = M.wrapAngle(angleOf(e) - startAngle);
      // 150 degrees of screen rotation equals full lock.
      self._wheelValue = M.clamp(startVal + d / (150 * M.DEG), -1, 1);
      if (el.firstElementChild) {
        el.firstElementChild.style.transform =
          'rotate(' + (self._wheelValue * 150) + 'deg)';
      }
    }, { passive: false });
    function end() {
      self._wheelActive = false;
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    this.wheelEl = el;
  };

  // Drag anywhere in a zone; horizontal travel is the steering axis.
  Input.prototype.bindSlider = function (el) {
    if (!el) return;
    var self = this;
    el.style.touchAction = 'none';
    var startX = 0, startVal = 0, w = 1;
    el.addEventListener('pointerdown', function (e) {
      if (!self.enabled) return;
      e.preventDefault();
      w = el.getBoundingClientRect().width || 1;
      startX = e.clientX;
      startVal = self.raw.slider;
      self._sliderActive = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }, { passive: false });
    el.addEventListener('pointermove', function (e) {
      if (!self._sliderActive) return;
      e.preventDefault();
      var d = (e.clientX - startX) / (w * 0.32);
      self.raw.slider = M.clamp(startVal + d, -1, 1);
    }, { passive: false });
    function end() { self._sliderActive = false; }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  /* ------------------------------------------------------- look / orbit */

  Input.prototype.bindLookArea = function (el) {
    if (!el) return;
    var self = this;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', function (e) {
      if (!self.enabled) return;
      if (self._lookId !== null) return;
      self._lookId = e.pointerId;
      self._lookLast[0] = e.clientX;
      self._lookLast[1] = e.clientY;
      self.state.lookActive = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }, { passive: false });
    el.addEventListener('pointermove', function (e) {
      if (self._lookId !== e.pointerId) return;
      e.preventDefault();
      var dx = (e.clientX - self._lookLast[0]) / (window.innerWidth || 1);
      var dy = (e.clientY - self._lookLast[1]) / (window.innerHeight || 1);
      self._lookLast[0] = e.clientX;
      self._lookLast[1] = e.clientY;
      self.state.lookYaw = M.clamp(self.state.lookYaw - dx * 4.2, -Math.PI, Math.PI);
      self.state.lookPitch = M.clamp(self.state.lookPitch - dy * 2.6, -0.7, 1.1);
      self.state.orbitDelta[0] += dx * 4.2;
      self.state.orbitDelta[1] += dy * 2.6;
    }, { passive: false });
    function end(e) {
      if (self._lookId !== e.pointerId) return;
      self._lookId = null;
      self.state.lookActive = false;
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    // Pinch to zoom in the orbit camera.
    var pinch = {};
    el.addEventListener('touchmove', function (e) {
      if (e.touches.length !== 2) { pinch.d = 0; return; }
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var d = Math.hypot(dx, dy);
      if (pinch.d) self.state.orbitZoom += (pinch.d - d) / 260;
      pinch.d = d;
    }, { passive: true });
    el.addEventListener('wheel', function (e) {
      self.state.orbitZoom += e.deltaY / 900;
    }, { passive: true });
  };

  /* --------------------------------------------------------------- tilt */

  Input.prototype.requestTilt = function () {
    var self = this;
    return new Promise(function (resolve) {
      var DOE = window.DeviceOrientationEvent;
      if (!DOE) { self.tiltPermission = 'unsupported'; resolve(false); return; }
      function attach() {
        window.addEventListener('deviceorientation', function (e) {
          if (e.gamma === null && e.beta === null) return;
          self.tiltAvailable = true;
          self._tiltGamma = e.gamma || 0;
          self._tiltBeta = e.beta || 0;
        });
        self.tiltPermission = 'granted';
        resolve(true);
      }
      if (typeof DOE.requestPermission === 'function') {
        DOE.requestPermission().then(function (r) {
          if (r === 'granted') attach();
          else { self.tiltPermission = 'denied'; resolve(false); }
        }).catch(function () { self.tiltPermission = 'denied'; resolve(false); });
      } else {
        attach();
      }
    });
  };

  Input.prototype.calibrateTilt = function () {
    // In landscape the phone's gamma axis is the one that rolls.
    this.tiltZero = this._tiltGamma;
    this.tiltCalibrated = true;
  };

  /* ------------------------------------------------------------ gamepad */

  Input.prototype.pollGamepad = function () {
    if (!navigator.getGamepads) return null;
    var pads = navigator.getGamepads();
    for (var i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) return pads[i];
    }
    return null;
  };

  /* --------------------------------------------------------- per-frame */

  Input.prototype.update = function (dt) {
    var s = this.state;
    var k = this.keys;
    var b = this.buttons;

    // ---- steering target -------------------------------------------------
    var target = 0;
    var instant = false;
    if (k.a || k.arrowleft) target -= 1;
    if (k.d || k.arrowright) target += 1;

    switch (this.scheme) {
      case 'buttons':
        if (b.steerLeft) target -= 1;
        if (b.steerRight) target += 1;
        break;
      case 'wheel':
        if (this._wheelActive || Math.abs(this._wheelValue) > 0.001) {
          target = M.clamp(target + this._wheelValue, -1, 1);
          instant = true;
        }
        if (!this._wheelActive) {
          this._wheelValue = M.damp(this._wheelValue, 0, 6, dt);
          if (this.wheelEl && this.wheelEl.firstElementChild) {
            this.wheelEl.firstElementChild.style.transform =
              'rotate(' + (this._wheelValue * 150) + 'deg)';
          }
        }
        break;
      case 'slider':
        if (this._sliderActive) { target = M.clamp(target + this.raw.slider, -1, 1); instant = true; }
        else {
          this.raw.slider = M.damp(this.raw.slider, 0, 7, dt);
          if (Math.abs(this.raw.slider) > 0.002) { target = this.raw.slider; instant = true; }
        }
        break;
      case 'tilt':
        if (this.tiltAvailable) {
          var g = this._tiltGamma - this.tiltZero;
          if (this.invertTilt) g = -g;
          target = M.clamp(target + g / this.tiltRange, -1, 1);
          instant = true;
        } else {
          if (b.steerLeft) target -= 1;
          if (b.steerRight) target += 1;
        }
        break;
    }

    var pad = this.pollGamepad();
    if (pad) {
      var ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.08) { target = M.clamp(target + ax, -1, 1); instant = true; }
      if (pad.buttons[7]) b.throttle = Math.max(b.throttle || 0, pad.buttons[7].value);
      if (pad.buttons[6]) b.brake = Math.max(b.brake || 0, pad.buttons[6].value);
      if (pad.buttons[0] && pad.buttons[0].pressed) b.handbrake = 1;
      if (pad.buttons[3] && pad.buttons[3].pressed && !this._padY) this.edges.camera = true;
      this._padY = pad.buttons[3] && pad.buttons[3].pressed;
      if (pad.buttons[1] && pad.buttons[1].pressed && !this._padB) this.edges.reset = true;
      this._padB = pad.buttons[1] && pad.buttons[1].pressed;
    }

    target = M.clamp(target * this.sensitivity, -1, 1);

    if (instant) {
      s.steer = target;
    } else {
      var rate = (Math.abs(target) > 0.001) ? this.steerSpeed : this.steerReturn;
      s.steer = M.moveTowards(s.steer, target, rate * dt);
    }

    // ---- pedals ----------------------------------------------------------
    var thrTarget = 0, brkTarget = 0;
    if (k.w || k.arrowup) thrTarget = 1;
    if (k.s || k.arrowdown) brkTarget = 1;
    if (b.throttle) thrTarget = Math.max(thrTarget, b.throttle);
    if (b.brake) brkTarget = Math.max(brkTarget, b.brake);
    // Ramp so a tap is not instantly wide open.
    s.throttle = M.moveTowards(s.throttle, thrTarget, (thrTarget > s.throttle ? 4.6 : 9.0) * dt);
    s.brake = M.moveTowards(s.brake, brkTarget, (brkTarget > s.brake ? 7.5 : 11.0) * dt);

    var hbTarget = (k[' '] || b.handbrake) ? 1 : 0;
    s.handbrake = M.moveTowards(s.handbrake, hbTarget, 9 * dt);
    s.clutch = (k.shift || b.clutch) ? 1 : 0;

    // ---- free camera -----------------------------------------------------
    s.freeMove[0] = (k.d ? 1 : 0) - (k.a ? 1 : 0);
    s.freeMove[1] = (k.e ? 1 : 0) - (k.q ? 1 : 0);
    s.freeMove[2] = (k.w ? 1 : 0) - (k.s ? 1 : 0);
    s.freeBoost = !!k.shift;

    // Free-look recentres when nobody is dragging.
    if (!s.lookActive) {
      s.lookYaw = M.damp(s.lookYaw, 0, this.lookDecay, dt);
      s.lookPitch = M.damp(s.lookPitch, 0, this.lookDecay, dt);
    }
  };

  // Consume a one-shot action.
  Input.prototype.take = function (name) {
    if (this.edges[name]) { this.edges[name] = false; return true; }
    return false;
  };

  Input.prototype.clearAll = function () {
    this.buttons = {};
    this.keys = {};
    this.edges = {};
    this.state.throttle = 0;
    this.state.brake = 0;
    this.state.steer = 0;
    this.state.handbrake = 0;
    this._wheelValue = 0;
    this.raw.slider = 0;
  };

  B.Input = Input;

})();
