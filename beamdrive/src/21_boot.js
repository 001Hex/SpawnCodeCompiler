/* =========================================================================
   BeamDrive Mobile — boot
   Creates the game, wires the frame loop and handles the platform bits that
   only matter on a phone: safe areas, orientation, backgrounding, and the
   gesture Safari needs before it will let us make a sound.
   ========================================================================= */
(function () {
  'use strict';

  B.VERSION = '1.0.0';

  var game = null, ui = null;
  var lastTime = 0;
  var frameBudget = 0;
  var fpsSamples = [];

  function fail(msg) {
    var f = document.getElementById('fatal');
    var m = document.getElementById('fatal-msg');
    if (m) m.textContent = msg;
    if (f) f.classList.remove('hidden');
    var l = document.getElementById('loading');
    if (l) l.classList.remove('active');
  }

  function sizeCanvas() {
    if (!game) return;
    var w = window.innerWidth;
    var h = window.innerHeight;
    game.renderer.resize(w, h, window.devicePixelRatio || 1);
    game.camera.setAspect(w / Math.max(h, 1));
  }

  function checkOrientation() {
    var hint = document.getElementById('rotate-hint');
    if (!hint) return;
    var portrait = window.innerHeight > window.innerWidth;
    var smallScreen = Math.min(window.innerWidth, window.innerHeight) < 500;
    // Only nag on phone-sized portrait screens; tablets and desktops are fine.
    hint.classList.toggle('hidden', !(portrait && smallScreen));
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!game) return;

    var dt = (now - lastTime) / 1000;
    if (!isFinite(dt) || dt < 0) dt = 1 / 60;
    lastTime = now;
    if (dt > 0.25) dt = 0.25;      // a long tab-switch must not teleport the car

    // Frame-rate cap.
    var cap = game.settings.fpsCap;
    if (cap > 0) {
      frameBudget += dt;
      var target = 1 / (cap + 0.5);
      if (frameBudget < target) return;
      dt = frameBudget;
      frameBudget = 0;
      if (dt > 0.25) dt = 0.25;
    }

    fpsSamples.push(dt);
    if (fpsSamples.length > 30) fpsSamples.shift();
    var sum = 0;
    for (var i = 0; i < fpsSamples.length; i++) sum += fpsSamples[i];
    game.telemetry.fps = fpsSamples.length / Math.max(sum, 1e-6);

    try {
      if (game.world) {
        game.step(dt);
        game.render(dt);
      }
      ui.update(dt);
      if (game.input.take('pause') && ui.inGame) ui.setPaused(!game.paused);
    } catch (err) {
      console.error(err);
      fail((err && err.message) || String(err));
      game = null;
    }
  }

  function boot() {
    var canvas = document.getElementById('gl');
    try {
      game = new B.Game(canvas);
    } catch (e) {
      fail('This browser could not start WebGL 2. On iOS make sure you are on iOS 15 ' +
           'or newer and that Safari is not in Lockdown Mode. Details: ' + (e.message || e));
      return;
    }

    ui = new B.UI(game);
    B.game = game;
    B.ui = ui;

    game.input.attachKeyboard(window);
    ui.build();
    sizeCanvas();
    checkOrientation();

    // Resume audio on the first real gesture — Safari requires it.
    var unlock = function () {
      game.audio.start();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    window.addEventListener('resize', function () {
      sizeCanvas();
      checkOrientation();
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { sizeCanvas(); checkOrientation(); }, 260);
    });

    // Pause when the page is hidden so we do not chew battery in the background.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        game.audio.suspend();
        if (ui.inGame && !game.paused) ui.setPaused(true);
      } else {
        lastTime = performance.now();
      }
    });

    // Block the pull-to-refresh and rubber-band gestures over the canvas.
    document.addEventListener('touchmove', function (e) {
      if (e.target && e.target.closest &&
          e.target.closest('.scroll, .car-strip, .map-list, .home-menu, .pause-card, input')) return;
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
    window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // Warm the shaders and prop geometry on the studio scene before the menu
    // appears, so the first real frame is not a long stall.
    ui.setProgress(0.45, 'Compiling shaders');
    requestAnimationFrame(function () {
      try {
        game.loadMap('showroom');
        ui.setProgress(0.80, 'Building the garage');
        requestAnimationFrame(function () {
          try {
            game.spawnPlayer(B.VEHICLES[ui.selectedCar].id, ui.selectedColor, 0);
            game.camera.mode = 'orbit';
            game.camera.orbitDist = B.VEHICLES[ui.selectedCar].length * 2.0;
            ui.showroomActive = true;
            game.step(1 / 60);
            game.render(1 / 60);
            ui.setProgress(1.0, 'Ready');
            setTimeout(function () {
              ui.show('home');
              lastTime = performance.now();
            }, 220);
          } catch (e2) { fail((e2 && e2.message) || String(e2)); }
        });
      } catch (e1) { fail((e1 && e1.message) || String(e1)); }
    });

    lastTime = performance.now();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
