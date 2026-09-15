/* =========================================================================
   BeamDrive Mobile — interface
   Screen routing, the garage/map pickers, a declarative settings builder,
   the touch control layer and the per-frame HUD update.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M;
  var STORE_KEY = 'beamdrive.settings.v1';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var TIPS = [
    'Soft-body physics: every panel is a lattice of springs, so no two crashes look the same.',
    'Tap CAM to cycle chase, bonnet, cockpit, bumper and orbit views.',
    'The cockpit camera puts you behind a driver whose hands actually shuffle the wheel.',
    'Hold BRAKE at a standstill to select reverse in automatic.',
    'Damage is permanent until you repair — bent suspension really does pull to one side.',
    'Derby Bowl has no route and no lap time. That is the point.',
    'Add this page to your Home Screen and it runs fullscreen and offline.',
    'Drop the quality preset to Medium if the frame rate dips; the physics rate follows it.',
    'Drag the middle of the screen to look around without steering.',
    'Alpine Pass rewards braking before the corner, not during it.'
  ];

  function UI(game) {
    this.game = game;
    this.screen = 'loading';
    this.selectedCar = 0;
    this.selectedColor = 0;
    this.selectedMap = 0;
    this.inGame = false;
    this.toastTimer = 0;
    this._dialMax = 160;
    this._lastToast = '';
    this.showroomActive = false;
    this.pendingApply = false;
    this.load();
  }

  /* ----------------------------------------------------------- storage */
  UI.prototype.load = function () {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o.settings) {
        for (var k in o.settings) {
          if (this.game.settings[k] !== undefined) this.game.settings[k] = o.settings[k];
        }
      }
      if (typeof o.car === 'number') this.selectedCar = o.car;
      if (typeof o.colour === 'number') this.selectedColor = o.colour;
      if (typeof o.map === 'number') this.selectedMap = o.map;
      if (o.control) {
        this.game.input.scheme = o.control.scheme || 'buttons';
        this.game.input.sensitivity = o.control.sensitivity || 1;
        this.game.input.tiltRange = o.control.tiltRange || 26;
        this.game.input.invertTilt = !!o.control.invertTilt;
        this.game.input.haptics = o.control.haptics !== false;
      }
      if (o.audio) {
        this.game.audio.masterVolume = o.audio.master !== undefined ? o.audio.master : 0.85;
        this.game.audio.sfxVolume = o.audio.sfx !== undefined ? o.audio.sfx : 1;
        this.game.audio.engineVolume = o.audio.engine !== undefined ? o.audio.engine : 1;
        this.game.audio.enabled = o.audio.enabled !== false;
      }
    } catch (e) { /* first run, or storage is blocked */ }
  };

  UI.prototype.save = function () {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        settings: this.game.settings,
        car: this.selectedCar,
        colour: this.selectedColor,
        map: this.selectedMap,
        control: {
          scheme: this.game.input.scheme,
          sensitivity: this.game.input.sensitivity,
          tiltRange: this.game.input.tiltRange,
          invertTilt: this.game.input.invertTilt,
          haptics: this.game.input.haptics
        },
        audio: {
          master: this.game.audio.masterVolume,
          sfx: this.game.audio.sfxVolume,
          engine: this.game.audio.engineVolume,
          enabled: this.game.audio.enabled
        }
      }));
    } catch (e) { /* storage unavailable — settings just will not persist */ }
  };

  /* ------------------------------------------------------------- setup */
  UI.prototype.build = function () {
    var self = this;
    this.els = {
      loading: $('loading'), loadBar: $('load-bar'), loadLabel: $('load-label'), loadTip: $('load-tip'),
      home: $('home'), garage: $('garage'), maps: $('maps'), settings: $('settings'),
      controls: $('controls'), about: $('about'), hud: $('hud'), touch: $('touch'), pause: $('pause'),
      carStrip: $('car-strip'), carName: $('car-name'), carClass: $('car-class'),
      carBlurb: $('car-blurb'), carStats: $('car-stats'), colourRow: $('colour-row'),
      driveBadge: $('car-drive-badge'), mapList: $('map-list'),
      settingsBody: $('settings-body'), controlsBody: $('controls-body'), aboutBody: $('about-body'),
      speedValue: $('speed-value'), speedUnit: $('speed-unit'),
      dialFill: $('dial-fill'), dialTrack: $('dial-track'), dialRed: $('dial-redline'),
      dialNeedle: $('dial-needle'), dialTicks: $('dial-ticks'),
      revFill: $('rev-fill'), revStrip: document.querySelector('.rev-strip'),
      gearValue: $('gear-value'), gearMode: $('gear-mode'), rpmValue: $('rpm-value'),
      dmgPct: $('dmg-pct'), statBlock: $('stat-block'), toast: $('hud-toast'),
      gDot: $('g-dot'), gLabel: $('g-label'),
      wheelZone: $('wheel-zone'), sliderZone: $('slider-zone'), padLeft: $('pad-left'),
      shiftCol: $('shift-col'), pauseStats: $('pause-stats'),
      homeDriveSub: $('home-drive-sub'), rotateHint: $('rotate-hint'),
      dmg: {
        front: $('dmg-front'), rear: $('dmg-rear'), left: $('dmg-left'),
        right: $('dmg-right'), roof: $('dmg-roof')
      }
    };

    // Screen routing.
    document.querySelectorAll('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        var dest = b.getAttribute('data-go');
        self.game.audio.start();
        self.game.audio.ui(dest === 'home' ? 'back' : 'select');
        if (dest === 'drive') self.startDrive();
        else self.show(dest);
      });
    });

    this.buildGarage();
    this.buildMaps();
    this.buildSettings();
    this.buildControls();
    this.buildAbout();
    this.buildDial();
    this.bindTouch();
    this.bindPause();
    this.applySettings();

    this.els.loadTip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    $('version-tag').textContent = 'v' + (B.VERSION || '1.0');
    $('device-tag').textContent = (B.GL.caps.colorBufferFloat ? 'HDR' : 'LDR') +
      ' · WebGL 2 · ' + Math.round(window.devicePixelRatio * 10) / 10 + 'x';
  };

  UI.prototype.show = function (name) {
    var ids = ['loading', 'home', 'garage', 'maps', 'settings', 'controls', 'about'];
    for (var i = 0; i < ids.length; i++) {
      var e = this.els[ids[i]];
      if (e) e.classList.toggle('active', ids[i] === name);
    }
    this.screen = name;
    var menuScreen = name !== null;
    this.els.hud.classList.toggle('hidden', menuScreen || !this.inGame);
    this.els.touch.classList.toggle('hidden', menuScreen || !this.inGame);
    if (name === 'garage') { this.enterShowroom(); this.applyShowroomFraming(); }
    else if (this.showroomActive && name !== 'garage') this.leaveShowroom();
    if (name === 'settings' || name === 'controls') this.refreshSettingsValues();
  };

  UI.prototype.hideAll = function () {
    ['loading', 'home', 'garage', 'maps', 'settings', 'controls', 'about'].forEach(function (id) {
      var e = $(id); if (e) e.classList.remove('active');
    });
    this.screen = null;
    this.els.hud.classList.remove('hidden');
    this.els.touch.classList.remove('hidden');
  };

  /* ------------------------------------------------------------ garage */
  UI.prototype.buildGarage = function () {
    var self = this;
    var strip = this.els.carStrip;
    strip.innerHTML = '';
    B.VEHICLES.forEach(function (v, i) {
      var card = el('button', 'car-card');
      card.appendChild(el('div', 'cc-name', v.name));
      card.appendChild(el('div', 'cc-class', v.klass));
      var bar = el('div', 'cc-bar');
      var fill = el('i');
      fill.style.width = Math.min(100, v.stats.powerToWeight / 3.2) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
      card.addEventListener('click', function () {
        self.selectedCar = i;
        self.selectedColor = 0;
        self.refreshGarage();
        self.save();
        self.game.audio.ui('select');
        if (self.showroomActive) self.enterShowroom(true);
      });
      strip.appendChild(card);
    });
    this.refreshGarage();
  };

  UI.prototype.refreshGarage = function () {
    var v = B.VEHICLES[this.selectedCar];
    var self = this;
    var cards = this.els.carStrip.children;
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('sel', i === this.selectedCar);

    this.els.carName.textContent = v.name;
    this.els.carClass.textContent = v.klass;
    this.els.carBlurb.textContent = v.blurb;
    this.els.driveBadge.textContent = v.stats.drivetrain;

    var units = this.game.settings.units;
    var topSpeed = units === 'mph'
      ? Math.round(v.stats.topSpeedKph * 0.621371) + ' <small>mph</small>'
      : v.stats.topSpeedKph + ' <small>km/h</small>';
    var stats = [
      ['Power', v.stats.powerBHP + ' <small>bhp</small>'],
      ['Torque', v.stats.torque + ' <small>Nm</small>'],
      ['Mass', v.stats.mass + ' <small>kg</small>'],
      ['Power / t', v.stats.powerToWeight + ' <small>kW/t</small>'],
      ['Top speed', '~' + topSpeed],
      ['Gears', (v.gearbox.ratios.length - 2) + ' <small>+ R</small>']
    ];
    this.els.carStats.innerHTML = '';
    stats.forEach(function (s) {
      var d = el('div', 'stat');
      d.appendChild(el('div', 'k', s[0]));
      var val = el('div', 'v');
      val.innerHTML = s[1];
      d.appendChild(val);
      self.els.carStats.appendChild(d);
    });

    this.els.colourRow.innerHTML = '';
    v.colors.forEach(function (c, i) {
      var sw = el('button', 'swatch' + (i === self.selectedColor ? ' sel' : ''));
      sw.style.background = 'rgb(' + Math.round(Math.pow(c[0], 1 / 2.2) * 255) + ',' +
        Math.round(Math.pow(c[1], 1 / 2.2) * 255) + ',' +
        Math.round(Math.pow(c[2], 1 / 2.2) * 255) + ')';
      sw.addEventListener('click', function () {
        self.selectedColor = i;
        self.refreshGarage();
        self.save();
        self.game.audio.ui('tick');
        if (self.showroomActive) self.enterShowroom(true);
      });
      self.els.colourRow.appendChild(sw);
    });
    this.refreshDriveSub();
  };

  UI.prototype.refreshDriveSub = function () {
    var v = B.VEHICLES[this.selectedCar];
    var m = B.MAPS[this.selectedMap];
    if (this.els.homeDriveSub) this.els.homeDriveSub.textContent = v.name + ' · ' + m.name;
  };

  /* --------------------------------------------------------- showroom */
  UI.prototype.enterShowroom = function (force) {
    var g = this.game;
    if (this.inGame) return;
    if (this.showroomActive && !force) return;
    g.clearVehicles();
    if (!this.showroomActive) {
      g.loadMap('showroom');
    }
    g.spawnPlayer(B.VEHICLES[this.selectedCar].id, this.selectedColor, 0);
    g.camera.mode = 'orbit';
    g.camera.orbitDist = B.VEHICLES[this.selectedCar].length * 1.9;
    g.camera.orbitPitch = 0.30;
    this.showroomActive = true;
    this._showroomSpin = true;
    this.applyShowroomFraming();
  };

  // Slide the projection so the car lands in the gap the garage leaves for
  // it: to the left in landscape, upward when the panels stack.
  UI.prototype.applyShowroomFraming = function () {
    var landscape = window.innerWidth >= 640 && window.innerWidth > window.innerHeight;
    this.game.camera.lensShift[0] = landscape ? 0.34 : 0;
    this.game.camera.lensShift[1] = landscape ? -0.06 : 0.42;
  };

  UI.prototype.leaveShowroom = function () {
    this.showroomActive = false;
    this.game.camera.lensShift[0] = 0;
    this.game.camera.lensShift[1] = 0;
  };

  /* ------------------------------------------------------------- maps */
  UI.prototype.buildMaps = function () {
    var self = this;
    var list = this.els.mapList;
    list.innerHTML = '';
    B.MAPS.forEach(function (m, i) {
      var card = el('button', 'map-card');
      card.appendChild(el('h3', null, m.name));
      var row = el('div', 'mc-row');
      row.appendChild(el('span', 'chip', m.difficulty));
      row.appendChild(el('span', 'chip', Math.round(m.size / 100) / 10 + ' km'));
      card.appendChild(row);
      card.appendChild(el('p', null, m.blurb));
      card.addEventListener('click', function () {
        self.selectedMap = i;
        self.refreshMaps();
        self.save();
        self.game.audio.ui('select');
      });
      list.appendChild(card);
    });
    this.refreshMaps();
  };

  UI.prototype.refreshMaps = function () {
    var cards = this.els.mapList.children;
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('sel', i === this.selectedMap);
    this.refreshDriveSub();
  };

  /* --------------------------------------------------- settings builder */

  UI.prototype.row = function (parent, label, hint) {
    var r = el('div', 'row');
    var left = el('div');
    left.appendChild(el('div', 'label', label));
    if (hint) left.appendChild(el('div', 'hint', hint));
    r.appendChild(left);
    var ctrl = el('div', 'control');
    r.appendChild(ctrl);
    parent.appendChild(r);
    return ctrl;
  };

  UI.prototype.seg = function (parent, options, get, set) {
    var self = this;
    var wrap = el('div', 'seg');
    var btns = [];
    options.forEach(function (o) {
      var b = el('button', null, o.label);
      b.addEventListener('click', function () {
        set(o.value);
        btns.forEach(function (x, i) { x.classList.toggle('on', options[i].value === get()); });
        self.game.audio.ui('tick');
        self.save();
      });
      btns.push(b);
      wrap.appendChild(b);
    });
    parent.appendChild(wrap);
    var refresh = function () {
      btns.forEach(function (x, i) { x.classList.toggle('on', options[i].value === get()); });
    };
    refresh();
    (this._refreshers = this._refreshers || []).push(refresh);
    return wrap;
  };

  UI.prototype.toggle = function (parent, get, set) {
    var self = this;
    var sw = el('div', 'sw');
    sw.appendChild(el('i'));
    sw.addEventListener('click', function () {
      set(!get());
      sw.classList.toggle('on', !!get());
      self.game.audio.ui('tick');
      self.save();
    });
    sw.classList.toggle('on', !!get());
    parent.appendChild(sw);
    (this._refreshers = this._refreshers || []).push(function () {
      sw.classList.toggle('on', !!get());
    });
    return sw;
  };

  UI.prototype.slider = function (parent, min, max, step, get, set, fmt) {
    var self = this;
    var input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.value = get();
    var val = el('span', 'range-val', fmt ? fmt(get()) : get());
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      set(v);
      val.textContent = fmt ? fmt(v) : v;
    });
    input.addEventListener('change', function () { self.save(); });
    // Let the slider own its own drags without the page swallowing them.
    input.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    parent.appendChild(input);
    parent.appendChild(val);
    (this._refreshers = this._refreshers || []).push(function () {
      input.value = get();
      val.textContent = fmt ? fmt(get()) : get();
    });
    return input;
  };

  UI.prototype.group = function (parent, title) {
    var g = el('div', 'set-group');
    g.appendChild(el('h3', null, title));
    parent.appendChild(g);
    return g;
  };

  UI.prototype.buildSettings = function () {
    var self = this, g = this.game, s = g.settings;
    var body = this.els.settingsBody;
    body.innerHTML = '';
    this._refreshers = [];

    var gfx = this.group(body, 'Graphics');
    this.seg(this.row(gfx, 'Quality preset', 'Ultra targets a recent iPhone at 60fps.'),
      [{ label: 'LOW', value: 'low' }, { label: 'MED', value: 'medium' },
       { label: 'HIGH', value: 'high' }, { label: 'ULTRA', value: 'ultra' }],
      function () { return s.quality; },
      function (v) { s.quality = v; g.applyQuality(v); self.toast('Quality: ' + v.toUpperCase()); });

    this.seg(this.row(gfx, 'Frame rate cap'),
      [{ label: '30', value: 30 }, { label: '60', value: 60 }, { label: 'MAX', value: 0 }],
      function () { return s.fpsCap; },
      function (v) { s.fpsCap = v; });

    this.slider(this.row(gfx, 'Field of view'), 45, 95, 1,
      function () { return s.fov; }, function (v) { s.fov = v; },
      function (v) { return v + '°'; });

    this.slider(this.row(gfx, 'Camera shake'), 0, 2, 0.05,
      function () { return s.shake; }, function (v) { s.shake = v; },
      function (v) { return Math.round(v * 100) + '%'; });

    this.toggle(this.row(gfx, 'Motion blur', 'Radial blur that builds with speed.'),
      function () { return s.motionBlur; }, function (v) { s.motionBlur = v; });

    this.slider(this.row(gfx, 'Particles'), 0, 1, 0.1,
      function () { return s.particles; }, function (v) { s.particles = v; },
      function (v) { return Math.round(v * 100) + '%'; });

    this.toggle(this.row(gfx, 'Show driver', 'The animated figure behind the wheel.'),
      function () { return s.showDriver; }, function (v) { s.showDriver = v; });

    this.toggle(this.row(gfx, 'Headlights'),
      function () { return s.headlights; }, function (v) { s.headlights = v; });

    this.toggle(this.row(gfx, 'Show performance stats'),
      function () { return s.showFps; }, function (v) { s.showFps = v; });

    var drive = this.group(body, 'Driving');
    this.seg(this.row(drive, 'Transmission'),
      [{ label: 'AUTO', value: 'auto' }, { label: 'MANUAL', value: 'manual' }],
      function () { return s.transmission; },
      function (v) {
        s.transmission = v;
        if (g.playerDrive) g.playerDrive.autoBox = (v === 'auto');
        self.els.shiftCol.classList.toggle('hidden', v !== 'manual');
      });

    this.seg(this.row(drive, 'Units'),
      [{ label: 'MPH', value: 'mph' }, { label: 'KM/H', value: 'kph' }],
      function () { return s.units; },
      function (v) { s.units = v; self.buildDial(); self.refreshGarage(); });

    this.toggle(this.row(drive, 'ABS', 'Stops the wheels locking under braking.'),
      function () { return s.abs; },
      function (v) { s.abs = v; if (g.playerDrive) g.playerDrive.abs = v; });

    this.toggle(this.row(drive, 'Traction control'),
      function () { return s.tc; },
      function (v) { s.tc = v; if (g.playerDrive) g.playerDrive.tractionControl = v; });

    this.toggle(this.row(drive, 'Stability control', 'Brakes a front wheel to catch a slide.'),
      function () { return s.esc; },
      function (v) { s.esc = v; if (g.playerDrive) g.playerDrive.stabilityControl = v; });

    this.slider(this.row(drive, 'Damage multiplier', 'How readily the structure yields.'), 0, 3, 0.1,
      function () { return s.damage; }, function (v) { s.damage = v; },
      function (v) { return Math.round(v * 100) + '%'; });

    this.slider(this.row(drive, 'Other cars', 'Extra vehicles driving the route.'), 0, 4, 1,
      function () { return s.trafficCount; }, function (v) { s.trafficCount = v; },
      function (v) { return String(v); });

    var au = this.group(body, 'Audio');
    this.toggle(this.row(au, 'Sound'),
      function () { return g.audio.enabled; },
      function (v) { g.audio.enabled = v; if (v) g.audio.start(); });
    this.slider(this.row(au, 'Master volume'), 0, 1, 0.05,
      function () { return g.audio.masterVolume; },
      function (v) { g.audio.setMasterVolume(v); },
      function (v) { return Math.round(v * 100) + '%'; });
    this.slider(this.row(au, 'Engine volume'), 0, 1.5, 0.05,
      function () { return g.audio.engineVolume; },
      function (v) { g.audio.engineVolume = v; },
      function (v) { return Math.round(v * 100) + '%'; });
    this.slider(this.row(au, 'Effects volume'), 0, 1.5, 0.05,
      function () { return g.audio.sfxVolume; },
      function (v) { g.audio.sfxVolume = v; },
      function (v) { return Math.round(v * 100) + '%'; });

    $('settings-reset').addEventListener('click', function () {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
      location.reload();
    });
  };

  UI.prototype.buildControls = function () {
    var self = this, g = this.game, inp = g.input;
    var body = this.els.controlsBody;
    body.innerHTML = '';

    var t = this.group(body, 'Steering method');
    this.seg(this.row(t, 'Scheme'),
      [{ label: 'BUTTONS', value: 'buttons' }, { label: 'WHEEL', value: 'wheel' },
       { label: 'TILT', value: 'tilt' }, { label: 'DRAG', value: 'slider' }],
      function () { return inp.scheme; },
      function (v) {
        inp.scheme = v;
        self.applyScheme();
        if (v === 'tilt') {
          inp.requestTilt().then(function (ok) {
            if (ok) { inp.calibrateTilt(); self.toast('Tilt enabled — hold level'); }
            else self.toast('Tilt unavailable — using buttons');
          });
        }
      });

    var cal = this.row(t, 'Calibrate tilt', 'Hold the phone how you want to hold it, then tap.');
    var calBtn = el('button', 'icon-btn', 'SET ZERO');
    calBtn.addEventListener('click', function () {
      inp.requestTilt().then(function (ok) {
        if (ok) { inp.calibrateTilt(); self.toast('Tilt zeroed'); }
        else self.toast('Motion access denied');
      });
    });
    cal.appendChild(calBtn);

    this.slider(this.row(t, 'Tilt sensitivity', 'Degrees of tilt for full lock.'), 10, 45, 1,
      function () { return inp.tiltRange; }, function (v) { inp.tiltRange = v; },
      function (v) { return v + '°'; });
    this.toggle(this.row(t, 'Invert tilt'),
      function () { return inp.invertTilt; }, function (v) { inp.invertTilt = v; });

    var gen = this.group(body, 'General');
    this.slider(this.row(gen, 'Steering sensitivity'), 0.4, 1.6, 0.05,
      function () { return inp.sensitivity; }, function (v) { inp.sensitivity = v; },
      function (v) { return Math.round(v * 100) + '%'; });
    this.slider(this.row(gen, 'Steering speed', 'How fast button steering reaches full lock.'), 1.5, 8, 0.1,
      function () { return inp.steerSpeed; }, function (v) { inp.steerSpeed = v; },
      function (v) { return v.toFixed(1); });
    this.toggle(this.row(gen, 'Haptics', 'Short vibration on button press, where supported.'),
      function () { return inp.haptics !== false; }, function (v) { inp.haptics = v; });

    var kb = this.group(body, 'Keyboard & gamepad');
    var table = el('div', 'keytable');
    [
      ['W / ↑', 'Throttle'], ['S / ↓', 'Brake and reverse'],
      ['A D / ← →', 'Steer'], ['Space', 'Handbrake'],
      ['E / Q', 'Shift up / down'], ['Shift', 'Clutch'],
      ['C', 'Change camera'], ['R', 'Respawn'], ['F', 'Flip upright'],
      ['L', 'Headlights'], ['Esc', 'Pause'],
      ['Gamepad', 'Triggers drive, left stick steers, A handbrake, Y camera, B respawn']
    ].forEach(function (p) {
      table.appendChild(el('b', null, p[0]));
      table.appendChild(el('span', null, p[1]));
    });
    kb.appendChild(table);
    this.applyScheme();
  };

  UI.prototype.buildAbout = function () {
    this.els.aboutBody.innerHTML = [
      '<p><strong>BeamDrive Mobile</strong> is a soft-body driving sandbox that runs entirely ',
      'in the browser. Nothing is downloaded at runtime: every car, map, texture and sound ',
      'is generated from code when the page loads.</p>',
      '<h3>How the crashes work</h3>',
      '<p>Each car is a lattice of point masses joined by damped springs. Beams yield ',
      'plastically past a strain threshold and snap past a second one, so the nose crumples, ',
      'the safety cell resists, and suspension arms bend or tear off. Panels are skinned to ',
      'that lattice, which is why the visible damage matches the structure underneath rather ',
      'than switching to a pre-made wrecked model.</p>',
      '<h3>What is simulated</h3>',
      '<ul>',
      '<li>Engine torque curve, clutch slip, gearbox and final drive</li>',
      '<li>Per-wheel combined-slip tyre forces with load sensitivity</li>',
      '<li>Real suspension geometry: two locating arms plus a spring/damper strut</li>',
      '<li>Aerodynamic drag and downforce, surface-dependent grip</li>',
      '<li>A 39-bone driver solved with two-bone IK onto the wheel rim and pedals</li>',
      '</ul>',
      '<h3>Honest limits</h3>',
      '<p>A phone browser has a small fraction of the budget a native simulator gets. The real ',
      'thing runs thousands of nodes at 2000&nbsp;Hz; this runs around fifty at 240&nbsp;Hz, with ',
      'lower beam stiffness to stay stable at that rate. Expect the spirit of it, not parity.</p>',
      '<h3>Running it offline</h3>',
      '<p>Open the page once, then use <em>Share &rarr; Add to Home Screen</em>. It launches ',
      'fullscreen with no browser chrome and works with no connection.</p>',
      '<p style="margin-top:18px;color:#555c6b">This is an original game. It is not affiliated ',
      'with, endorsed by, or derived from any commercial driving simulator.</p>'
    ].join('');
  };

  /* --------------------------------------------------------------- dial */
  function polar(cx, cy, r, deg) {
    var a = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function arcPath(cx, cy, r, from, to) {
    var s = polar(cx, cy, r, to);
    var e = polar(cx, cy, r, from);
    var large = (to - from) <= 180 ? 0 : 1;
    return 'M ' + s[0].toFixed(2) + ' ' + s[1].toFixed(2) +
           ' A ' + r + ' ' + r + ' 0 ' + large + ' 0 ' + e[0].toFixed(2) + ' ' + e[1].toFixed(2);
  }

  var DIAL_START = -135, DIAL_END = 135;

  UI.prototype.buildDial = function () {
    var kph = this.game.settings.units === 'kph';
    var spec = B.VEHICLES[this.selectedCar];
    var top = spec ? spec.stats.topSpeedKph : 200;
    if (!kph) top *= 0.621371;
    // Round the scale up to a sensible round number.
    var step = kph ? 40 : 20;
    this._dialMax = Math.max(step * 4, Math.ceil(top * 1.10 / step) * step);
    this.els.speedUnit.textContent = kph ? 'KM/H' : 'MPH';
    this.els.dialTrack.setAttribute('d', arcPath(100, 100, 76, DIAL_START, DIAL_END));
    this.els.dialFill.setAttribute('d', arcPath(100, 100, 76, DIAL_START, DIAL_START));

    var ticks = this.els.dialTicks;
    ticks.innerHTML = '';
    ticks.setAttribute('class', 'dial-ticks');
    var n = this._dialMax / step;
    for (var i = 0; i <= n; i++) {
      var deg = DIAL_START + (DIAL_END - DIAL_START) * (i / n);
      var a = polar(100, 100, 66, deg);
      var b = polar(100, 100, (i % 2 === 0) ? 56 : 61, deg);
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a[0].toFixed(1)); line.setAttribute('y1', a[1].toFixed(1));
      line.setAttribute('x2', b[0].toFixed(1)); line.setAttribute('y2', b[1].toFixed(1));
      ticks.appendChild(line);
      if (i % 2 === 0) {
        var p = polar(100, 100, 44, deg);
        var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', p[0].toFixed(1));
        txt.setAttribute('y', (p[1] + 4).toFixed(1));
        txt.textContent = String(Math.round(i * step));
        ticks.appendChild(txt);
      }
    }
  };

  /* ------------------------------------------------------ touch layer */
  UI.prototype.bindTouch = function () {
    var inp = this.game.input;
    inp.bindButton($('btn-left'), 'steerLeft');
    inp.bindButton($('btn-right'), 'steerRight');
    inp.bindButton($('btn-gas'), 'throttle');
    inp.bindButton($('btn-brake'), 'brake');
    inp.bindButton($('btn-hand'), 'handbrake');
    inp.bindButton($('btn-cam'), 'camera', 'tap');
    inp.bindButton($('btn-reset'), 'reset', 'tap');
    inp.bindButton($('btn-flip'), 'flip', 'tap');
    inp.bindButton($('btn-up'), 'shiftUp', 'tap');
    inp.bindButton($('btn-down'), 'shiftDown', 'tap');
    inp.bindWheel($('vwheel'));
    inp.bindSlider($('slider-zone'));
    inp.bindLookArea($('look-zone'));
  };

  UI.prototype.applyScheme = function () {
    var s = this.game.input.scheme;
    this.els.padLeft.style.display = (s === 'buttons' || s === 'tilt') ? 'flex' : 'none';
    this.els.wheelZone.classList.toggle('hidden', s !== 'wheel');
    this.els.sliderZone.classList.toggle('hidden', s !== 'slider');
    this.els.shiftCol.classList.toggle('hidden', this.game.settings.transmission !== 'manual');
  };

  UI.prototype.bindPause = function () {
    var self = this, g = this.game;
    $('btn-pause').addEventListener('click', function () { self.setPaused(true); });
    $('p-resume').addEventListener('click', function () { self.setPaused(false); });
    $('p-repair').addEventListener('click', function () {
      g.respawnPlayer(true);
      self.setPaused(false);
      self.toast('Repaired');
    });
    $('p-respawn').addEventListener('click', function () {
      g.respawnPlayer(false);
      self.setPaused(false);
    });
    $('p-settings').addEventListener('click', function () {
      self.els.pause.classList.remove('active');
      self.show('settings');
      self._returnToPause = true;
    });
    $('p-quit').addEventListener('click', function () {
      self.quitToMenu();
    });
  };

  UI.prototype.setPaused = function (on) {
    this.game.paused = on;
    this.els.pause.classList.toggle('active', on);
    this.els.touch.classList.toggle('hidden', on || !this.inGame);
    this.game.audio.ui(on ? 'back' : 'select');
    if (on) {
      this.game.input.clearAll();
      this.refreshPauseStats();
      this.game.audio.suspend();
    } else {
      this.game.audio.resume();
    }
  };

  UI.prototype.refreshPauseStats = function () {
    var t = this.game.telemetry;
    var kph = this.game.settings.units === 'kph';
    var conv = kph ? 1 : 0.621371;
    var unit = kph ? ' km/h' : ' mph';
    var rows = [
      ['Top speed', Math.round(t.topSpeed * conv) + unit],
      ['Distance', (t.distance / 1000 * (kph ? 1 : 0.621371)).toFixed(2) + (kph ? ' km' : ' mi')],
      ['Best air', t.bestAir.toFixed(2) + ' s'],
      ['Damage', Math.round(t.damage * 100) + '%']
    ];
    this.els.pauseStats.innerHTML = rows.map(function (r) {
      return '<div>' + r[0] + '<b>' + r[1] + '</b></div>';
    }).join('');
  };

  UI.prototype.quitToMenu = function () {
    var g = this.game;
    g.paused = false;
    this.inGame = false;
    this.els.pause.classList.remove('active');
    g.clearVehicles();
    g.disposeMap();
    this.showroomActive = false;
    g.telemetry.topSpeed = 0;
    g.telemetry.distance = 0;
    g.telemetry.bestAir = 0;
    this.show('home');
    this.els.hud.classList.add('hidden');
    this.els.touch.classList.add('hidden');
  };

  /* ---------------------------------------------------------- start up */
  UI.prototype.startDrive = function () {
    var self = this, g = this.game;
    var map = B.MAPS[this.selectedMap];
    var car = B.VEHICLES[this.selectedCar];
    this.showroomActive = false;
    this.els.loading.classList.add('active');
    this.els.loadLabel.textContent = 'Loading ' + map.name;
    this.els.loadTip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    this.setProgress(0.02);
    ['home', 'garage', 'maps', 'settings', 'controls', 'about'].forEach(function (id) {
      $(id).classList.remove('active');
    });

    // Yield to the browser between phases so the bar actually paints.
    var steps = [
      function () { g.clearVehicles(); g.disposeMap(); self.setProgress(0.10, 'Clearing'); },
      function () { g.loadMap(map.id, function (p, label) { self.setProgress(0.10 + p * 0.55, label); }); },
      function () { self.setProgress(0.72, 'Assembling ' + car.name);
                    g.spawnPlayer(car.id, self.selectedColor, 0); },
      function () {
        self.setProgress(0.86, 'Placing traffic');
        if (g.settings.trafficCount > 0) g.spawnTraffic(g.settings.trafficCount);
      },
      function () {
        self.setProgress(0.96, 'Warming up');
        g.camera.mode = 'chase';
        g.camera.snap({
          vehicle: g.player, drivetrain: g.playerDrive, terrain: g.terrain,
          world: g.world, dt: 1 / 60
        });
        self.buildDial();
        g.applyQuality(g.settings.quality);
      },
      function () {
        self.setProgress(1.0, 'Ready');
        self.inGame = true;
        self.hideAll();
        self.els.loading.classList.remove('active');
        self.applyScheme();
        g.audio.start();
        self.toast(car.name + ' · ' + map.name);
      }
    ];
    var i = 0;
    function next() {
      if (i >= steps.length) return;
      try { steps[i++](); } catch (err) {
        console.error(err);
        self.fatal(err.message || String(err));
        return;
      }
      requestAnimationFrame(function () { requestAnimationFrame(next); });
    }
    next();
  };

  UI.prototype.setProgress = function (p, label) {
    this.els.loadBar.style.width = Math.round(M.clamp(p, 0, 1) * 100) + '%';
    if (label) this.els.loadLabel.textContent = label;
  };

  UI.prototype.fatal = function (msg) {
    $('fatal-msg').textContent = msg;
    $('fatal').classList.remove('hidden');
  };

  UI.prototype.toast = function (msg) {
    this.els.toast.textContent = msg;
    this.els.toast.classList.add('show');
    this.toastTimer = 2.4;
  };

  UI.prototype.applySettings = function () {
    var g = this.game, s = g.settings;
    g.applyQuality(s.quality);
    if (g.playerDrive) {
      g.playerDrive.abs = s.abs;
      g.playerDrive.tractionControl = s.tc;
      g.playerDrive.stabilityControl = s.esc;
      g.playerDrive.autoBox = s.transmission === 'auto';
    }
    this.buildDial();
    this.applyScheme();
  };

  UI.prototype.refreshSettingsValues = function () {
    if (!this._refreshers) return;
    for (var i = 0; i < this._refreshers.length; i++) this._refreshers[i]();
  };

  /* ------------------------------------------------------ per-frame HUD */

  var DMG_COLORS = ['#2c313c', '#4a4030', '#7a5a22', '#a8461c', '#c9281a'];
  function damageFill(v) {
    var i = Math.min(DMG_COLORS.length - 1, Math.floor(v * DMG_COLORS.length));
    return DMG_COLORS[i];
  }

  UI.prototype.update = function (dt) {
    var g = this.game;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.els.toast.classList.remove('show');
    }
    if (this.showroomActive && this._showroomSpin && this.screen === 'garage') {
      g.camera.orbitYaw += dt * 0.28;
    }
    if (!this.inGame || this.screen) return;

    var t = g.telemetry;
    var kph = g.settings.units === 'kph';
    var speed = kph ? t.speedKph : t.speedKph * 0.621371;

    this.els.speedValue.textContent = String(Math.round(Math.abs(speed)));
    var frac = M.clamp(Math.abs(speed) / this._dialMax, 0, 1);
    var deg = DIAL_START + (DIAL_END - DIAL_START) * frac;
    this.els.dialFill.setAttribute('d', arcPath(100, 100, 76, DIAL_START, Math.max(deg, DIAL_START + 0.01)));
    this.els.dialNeedle.setAttribute('transform', 'rotate(' + deg.toFixed(1) + ' 100 100)');

    var spec = g.player ? g.player.spec : null;
    if (spec) {
      var revFrac = M.clamp(t.rpm / spec.engine.redline, 0, 1.02);
      this.els.revFill.style.width = (revFrac * 100).toFixed(1) + '%';
      this.els.revStrip.classList.toggle('limit', revFrac > 0.985);
    }
    this.els.gearValue.textContent = t.gear;
    this.els.gearMode.textContent = g.settings.transmission === 'auto' ? 'A' : 'M';
    this.els.rpmValue.textContent = Math.round(t.rpm) + ' rpm';

    this.els.dmgPct.textContent = Math.round(t.damage * 100) + '%';
    var rd = t.regionDamage;
    if (rd) {
      this.els.dmg.front.setAttribute('fill', damageFill(rd[0]));
      this.els.dmg.rear.setAttribute('fill', damageFill(rd[1]));
      this.els.dmg.left.setAttribute('fill', damageFill(rd[2]));
      this.els.dmg.right.setAttribute('fill', damageFill(rd[3]));
      this.els.dmg.roof.setAttribute('fill', damageFill(rd[4]));
    }

    var gx = M.clamp(t.gForce[0], -2, 2), gy = M.clamp(t.gForce[1], -2, 2);
    this.els.gDot.setAttribute('cx', (40 + gx * 17).toFixed(1));
    this.els.gDot.setAttribute('cy', (40 - gy * 17).toFixed(1));
    this.els.gLabel.textContent = Math.hypot(gx, gy).toFixed(1) + 'g';

    if (g.settings.showFps) {
      this.els.statBlock.style.display = '';
      this.els.statBlock.innerHTML =
        '<b>' + Math.round(t.fps) + '</b> fps<br>' +
        '<b>' + g.renderer.stats.drawCalls + '</b> draws<br>' +
        '<b>' + Math.round(g.renderer.stats.triangles / 1000) + 'k</b> tris<br>' +
        '<b>' + t.wheelsDown + '/4</b> down';
    } else {
      this.els.statBlock.style.display = 'none';
    }
  };

  B.UI = UI;

})();
