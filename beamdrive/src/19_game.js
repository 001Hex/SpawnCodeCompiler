/* =========================================================================
   BeamDrive Mobile — game
   Owns the world, the vehicles, the fixed-timestep physics loop and the
   scene it hands to the renderer each frame.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M, V = M.v3, Mat = M.m4;

  /* ------------------------------------------------------- skid marks -- */
  function SkidMarks(capacity) {
    this.capacity = capacity || 900;
    this.head = 0;
    this.count = 0;
    var vc = this.capacity * 4;
    this.pos = new Float32Array(vc * 3);
    this.nrm = new Float32Array(vc * 3);
    this.uv = new Float32Array(vc * 2);
    this.col = new Float32Array(vc * 3);
    var idx = new Uint32Array(this.capacity * 6);
    for (var i = 0; i < this.capacity; i++) {
      var b = i * 4;
      idx[i * 6] = b; idx[i * 6 + 1] = b + 1; idx[i * 6 + 2] = b + 2;
      idx[i * 6 + 3] = b; idx[i * 6 + 4] = b + 2; idx[i * 6 + 5] = b + 3;
    }
    for (var j = 0; j < vc; j++) { this.nrm[j * 3 + 1] = 1; }
    this.geometry = new B.GL.Geometry({ dynamic: true });
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('normal', this.nrm);
    this.geometry.setAttribute('uv', this.uv);
    this.geometry.setAttribute('color', this.col);
    this.geometry.setIndices(idx);
    this.geometry.count = 0;
    this.material = {
      type: 10, baseColor: [0.035, 0.033, 0.032], roughness: 0.95,
      metallic: 0, clearcoat: 0, opacity: 0.85, transparent: true, doubleSided: true
    };
    this.matrix = Mat.create();
    this.dirty = false;
  }

  SkidMarks.prototype.addSegment = function (ax, ay, az, bx, by, bz, rx, rz, width, strength) {
    var i = this.head;
    var b4 = i * 4;
    var hw = width * 0.5;
    var p = this.pos, c = this.col;
    function set(vi, x, y, z, s) {
      p[vi * 3] = x; p[vi * 3 + 1] = y; p[vi * 3 + 2] = z;
      c[vi * 3] = s; c[vi * 3 + 1] = s; c[vi * 3 + 2] = s;
    }
    set(b4 + 0, ax - rx * hw, ay, az - rz * hw, strength);
    set(b4 + 1, ax + rx * hw, ay, az + rz * hw, strength);
    set(b4 + 2, bx + rx * hw, by, bz + rz * hw, strength);
    set(b4 + 3, bx - rx * hw, by, bz - rz * hw, strength);
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    this.dirty = true;
  };

  SkidMarks.prototype.flush = function () {
    if (!this.dirty) return;
    this.geometry.updateAttribute('position', this.pos);
    this.geometry.updateAttribute('color', this.col);
    this.geometry.count = this.count * 6;
    this.dirty = false;
  };

  SkidMarks.prototype.clear = function () {
    this.head = 0; this.count = 0;
    for (var i = 0; i < this.pos.length; i++) this.pos[i] = 0;
    this.geometry.count = 0;
    this.dirty = true;
  };

  /* --------------------------------------------------------- simple AI -- */
  function RoadAI(vehicle, drivetrain, points, speedKph) {
    this.v = vehicle;
    this.dt = drivetrain;
    this.points = points;
    this.index = 0;
    this.targetSpeed = (speedKph || 55) / 3.6;
    this.stuckTimer = 0;
  }
  RoadAI.prototype.update = function (dt) {
    var body = this.v.body, d = this.dt;
    var pts = this.points;
    if (!pts || pts.length < 2) { d.throttle = 0; d.brake = 1; return; }
    var c = body.center;
    // Advance along the route once we are close enough to the waypoint.
    var guard = 0;
    while (guard++ < 40) {
      var p = pts[this.index];
      if (Math.hypot(p[0] - c[0], p[2] - c[2]) < 11) {
        this.index = (this.index + 1) % pts.length;
      } else break;
    }
    // Aim a little further ahead at speed.
    var look = Math.min(pts.length - 1, this.index + Math.round(3 + d.speed * 0.25));
    var tp = pts[look % pts.length];
    var f = body.frame;
    var toX = tp[0] - c[0], toZ = tp[2] - c[2];
    var fwd = toX * f[8] + toZ * f[10];
    var side = toX * f[0] + toZ * f[2];
    var steer = M.clamp(Math.atan2(side, Math.max(Math.abs(fwd), 1)) * 1.5, -1, 1);
    d.steerInput = M.damp(d.steerInput, steer, 8, dt);

    var err = this.targetSpeed - d.speed;
    // Back off for the corner ahead.
    var corner = Math.abs(steer);
    var wanted = this.targetSpeed * (1 - corner * 0.55);
    err = wanted - d.speed;
    d.throttle = M.clamp(err * 0.30, 0, 0.85);
    d.brake = M.clamp(-err * 0.18, 0, 0.7);

    if (d.speed < 0.9) { this.stuckTimer += dt; } else this.stuckTimer = 0;
    if (this.stuckTimer > 3.5) {
      d.gear = 0; d.throttle = 0.5;
      if (this.stuckTimer > 5.2) { this.stuckTimer = 0; d.gear = 2; }
    }
  };

  /* -------------------------------------------------------------- Game -- */

  // Hard upper bound on a solver step. Past this the beam stiffnesses in
  // use are no longer stable under explicit integration.
  var MAX_STEP = 1 / 240;

  function Game(canvas) {
    this.canvas = canvas;
    this.renderer = new B.Renderer(canvas);
    this.input = new B.Input();
    this.audio = new B.Audio();
    this.camera = new B.Camera();
    this.particles = new B.Particles();
    this.skid = new SkidMarks(900);

    this.world = null;
    this.terrain = null;
    this.terrainMesh = null;
    this.roadMesh = null;
    this.markingMesh = null;
    this.waterMesh = null;

    this.vehicles = [];
    this.player = null;
    this.playerDrive = null;
    this.driver = null;
    this.ais = [];

    this.scene = { env: null, opaque: [], instanced: [], transparent: [], particles: null,
                   headlight: { on: false, pos: [0, 0, 0], dir: [0, 0, 1] }, bloomStrength: 0.34 };

    this.fixedStep = 1 / 480;
    this.maxSteps = 40;
    this.substeps = 0;
    this.time = 0;
    this.paused = false;
    this.running = false;
    this.slowMotion = 1.0;

    this.settings = {
      quality: 'high',
      fpsCap: 60,
      drawDistance: 1.0,
      fov: 62,
      shake: 1.0,
      motionBlur: true,
      particles: 1.0,
      showDriver: true,
      units: 'mph',
      transmission: 'auto',
      abs: true,
      tc: true,
      esc: false,
      damage: 1.0,
      trafficCount: 0,
      trafficSpeed: 55,
      headlights: false,
      showFps: false
    };

    this.telemetry = {
      speedKph: 0, rpm: 0, gear: 'N', damage: 0, gForce: [0, 0],
      airborne: false, fps: 60, wheelsDown: 4, odo: 0, airTime: 0, bestAir: 0,
      topSpeed: 0, totalDamage: 0, distance: 0
    };

    this._lastImpactSound = 0;
    this._prevVel = new Float32Array(3);
    this._gSmooth = [0, 0];
    this._tmpv = new Float32Array(3);
    this._skidLast = [];
    this._frameTimes = [];
    this._gearPrev = 2;
    this._wasAirborne = false;
  }

  /* ------------------------------------------------------------- maps -- */

  Game.prototype.loadMap = function (mapId, onProgress) {
    var map = B.getMap(mapId);
    this.mapDef = map;
    if (this.world) this.disposeMap();

    if (onProgress) onProgress(0.05, 'Shaping terrain');
    var world = map.build();
    this.world = world;
    this.terrain = world.terrain;
    world.finalize();

    if (onProgress) onProgress(0.45, 'Building geometry');
    var q = this.renderer.q;
    var data = this.terrain.buildMesh(q.terrainLOD);
    this.terrainMesh = B.Geo.fromArrays(data.position, data.normal, data.uv, data.color, data.indices);

    if (world.roadsList && world.roadsList.length) {
      this.roadMesh = this.terrain.buildRoadMesh(world.roadsList).toGeometry();
      var markings = this.terrain.buildRoadMarkings(world.roadsList);
      this.markingMesh = markings.idx.length ? markings.toGeometry() : null;
    } else {
      this.roadMesh = null;
      this.markingMesh = null;
    }

    if (world.water) {
      this.waterMesh = B.Geo.plane(world.water.size, world.water.size, 40, 40, [1, 1, 1]).toGeometry();
    } else {
      this.waterMesh = null;
    }

    this.scene.env = world.env;
    this.skid.clear();
    this.particles.clear();
    if (onProgress) onProgress(0.75, 'Placing props');
    return world;
  };

  Game.prototype.disposeMap = function () {
    if (this.terrainMesh) { this.terrainMesh.dispose(); this.terrainMesh = null; }
    if (this.roadMesh) { this.roadMesh.dispose(); this.roadMesh = null; }
    if (this.markingMesh) { this.markingMesh.dispose(); this.markingMesh = null; }
    if (this.waterMesh) { this.waterMesh.dispose(); this.waterMesh = null; }
    if (this.world) this.world.dispose();
    this.world = null;
  };

  /* ---------------------------------------------------------- vehicles - */

  Game.prototype.clearVehicles = function () {
    for (var i = 0; i < this.vehicles.length; i++) {
      var v = this.vehicles[i];
      for (var p = 0; p < v.parts.length; p++) v.parts[p].skin.geometry.dispose();
      v.wheelGeometry.dispose();
    }
    this.vehicles = [];
    this.ais = [];
    this.player = null;
    this.playerDrive = null;
  };

  Game.prototype.spawnPlayer = function (specId, colorIndex, spawnIndex) {
    var spec = B.getVehicleSpec(specId);
    var color = spec.colors[colorIndex % spec.colors.length];
    var veh = B.buildVehicle(spec, color);
    var spawn = this.world.spawns[(spawnIndex || 0) % this.world.spawns.length];
    var y = this.terrain.height(spawn.pos[0], spawn.pos[2]);
    veh.body.placeAt(spawn.pos[0], y + 0.06, spawn.pos[2], spawn.yaw);
    veh.drivetrain = new B.Drivetrain(veh, this.terrain);
    veh.drivetrain.abs = this.settings.abs;
    veh.drivetrain.tractionControl = this.settings.tc;
    veh.drivetrain.stabilityControl = this.settings.esc;
    veh.drivetrain.autoBox = this.settings.transmission === 'auto';
    veh.spawnPoint = { pos: spawn.pos.slice(), yaw: spawn.yaw };
    veh.isPlayer = true;
    this.vehicles.push(veh);
    this.settleVehicle(veh, 0.8);
    this.player = veh;
    this.playerDrive = veh.drivetrain;

    if (!this.driver) this.driver = new B.Driver(1.0);
    this.steeringWheelGeom = this.steeringWheelGeom ||
      B.buildSteeringWheel(0.18).toGeometry();

    this._skidLast = [];
    for (var i = 0; i < veh.wheels.length; i++) this._skidLast.push(null);
    return veh;
  };

  Game.prototype.spawnTraffic = function (count) {
    var world = this.world;
    var route = (world.roadsList && world.roadsList.length) ? world.roadsList[0].points : null;
    var pool = B.VEHICLES;
    for (var i = 0; i < count; i++) {
      var spec = pool[(i + 1) % pool.length];
      var color = spec.colors[(i * 3 + 2) % spec.colors.length];
      var veh = B.buildVehicle(spec, color);
      var pos, yaw;
      if (route && route.length > 20) {
        var idx = Math.floor((i + 1) / (count + 1) * route.length);
        var p = route[idx % route.length];
        var p2 = route[(idx + 4) % route.length];
        pos = [p[0], p[1], p[2]];
        yaw = Math.atan2(p2[0] - p[0], p2[2] - p[2]);
      } else {
        var sp = world.spawns[(i + 1) % world.spawns.length];
        pos = sp.pos.slice();
        yaw = sp.yaw;
      }
      var y = this.terrain.height(pos[0], pos[2]);
      veh.body.placeAt(pos[0], y + 0.06, pos[2], yaw);
      veh.drivetrain = new B.Drivetrain(veh, this.terrain);
      veh.drivetrain.autoBox = true;
      veh.drivetrain.tractionControl = true;
      veh.drivetrain.abs = true;
      veh.spawnPoint = { pos: pos, yaw: yaw };
      veh.isPlayer = false;
      this.vehicles.push(veh);
      this.settleVehicle(veh, 0.6);
      if (route) {
        var ai = new RoadAI(veh, veh.drivetrain, route, this.settings.trafficSpeed);
        ai.index = Math.floor((i + 1) / (count + 1) * route.length);
        this.ais.push(ai);
      }
    }
  };

  /* Run the solver for a moment with damage switched off so the car drops
     onto its springs and finds its ride height instead of taking a hit for
     it the instant it appears. */
  Game.prototype.settleVehicle = function (veh, seconds) {
    var dt = this.fixedStep;
    var n = Math.min(900, Math.round((seconds || 0.6) / dt));
    var world = this.world;
    var c = veh.body.center;
    var near = world.nearColliders(c[0], c[2], (veh.body.boundRadius || 3) + 3);
    var list = [];
    for (var k = 0; k < near.length; k++) list.push(near[k]);
    var ceiling = this.terrain.height(c[0], c[2]) + 1.2;
    var savedThrottle = veh.drivetrain.throttle;
    veh.drivetrain.throttle = 0;
    veh.drivetrain.engineOn = false;
    for (var i = 0; i < n; i++) {
      veh.body.clearForces();
      veh.drivetrain.step(dt, world);
      veh.body.solveBeams(dt, 0);            // damageScale 0
      veh.body.integrate(dt);
      veh.body.collideTerrain(this.terrain, dt, 0.92, 0.10, ceiling);
      if (list.length) veh.body.collideBoxes(list, dt);
      veh.body.updateFrame();
    }
    veh.drivetrain.engineOn = true;
    veh.drivetrain.throttle = savedThrottle;
    veh.drivetrain.reset();
    veh.body.repair();
    veh.body.updateLocalPositions();
    return veh;
  };

  Game.prototype.respawnPlayer = function (atCurrent) {
    var v = this.player;
    if (!v) return;
    v.body.repair();
    var x, z, yaw;
    if (atCurrent) {
      x = v.body.center[0]; z = v.body.center[2];
      var f = v.body.frame;
      yaw = Math.atan2(f[8], f[10]);
    } else {
      // Nearest spawn point to where we ended up.
      var best = this.world.spawns[0], bd = Infinity;
      for (var i = 0; i < this.world.spawns.length; i++) {
        var s = this.world.spawns[i];
        var d = Math.hypot(s.pos[0] - v.body.center[0], s.pos[2] - v.body.center[2]);
        if (d < bd) { bd = d; best = s; }
      }
      x = best.pos[0]; z = best.pos[2]; yaw = best.yaw;
    }
    var y = this.terrain.height(x, z);
    v.body.placeAt(x, y + 0.10, z, yaw);
    v.body.setVelocity(0, 0, 0);
    this.settleVehicle(v, 0.6);
    this.skid.clear();
    if (this.driver) {
      this.driver.jolt[0] = 0; this.driver.jolt[1] = 0; this.driver.jolt[2] = 0;
      this.driver.joltVel[0] = 0; this.driver.joltVel[1] = 0; this.driver.joltVel[2] = 0;
    }
  };

  Game.prototype.flipPlayer = function () {
    var v = this.player;
    if (!v) return;
    var f = v.body.frame;
    var yaw = Math.atan2(f[8], f[10]);
    var y = this.terrain.height(v.body.center[0], v.body.center[2]);
    v.body.placeAt(v.body.center[0], y + 0.14, v.body.center[2], yaw);
    v.body.setVelocity(0, 0, 0);
  };

  /* --------------------------------------------------------- simulation */

  Game.prototype.applyInput = function () {
    var d = this.playerDrive;
    if (!d) return;
    var s = this.input.state;
    d.throttle = s.throttle;
    d.brake = s.brake;
    d.handbrake = s.handbrake;
    d.steerInput = s.steer;
    d.clutchInput = s.clutch;

    if (this.input.take('shiftUp')) { d.shiftUp(); this.audio.gearShift(); }
    if (this.input.take('shiftDown')) { d.shiftDown(); this.audio.gearShift(); }
    if (this.input.take('camera')) {
      this.camera.cycleMode(1);
      this.audio.ui('select');
    }
    if (this.input.take('reset')) this.respawnPlayer(false);
    if (this.input.take('flip')) this.flipPlayer();
    if (this.input.take('lights')) this.settings.headlights = !this.settings.headlights;
  };

  /* Refreshed once per rendered frame rather than per solver step: the car
     moves at most a metre in that time, so the candidate sets stay valid. */
  Game.prototype.refreshBroadphase = function () {
    var world = this.world;
    for (var i = 0; i < this.vehicles.length; i++) {
      var v = this.vehicles[i];
      var c = v.body.center;
      var r = (v.body.boundRadius || 3) + 3.0;
      var near = world.nearColliders(c[0], c[2], r);
      // nearColliders reuses its buffer, so take a copy per vehicle.
      var list = v._nearColliders || (v._nearColliders = []);
      list.length = 0;
      for (var k = 0; k < near.length; k++) list.push(near[k]);
      // Conservative ground height under the body, for the contact early-out.
      var t = this.terrain;
      var hi = t.height(c[0], c[2]);
      var o = r * 0.75;
      hi = Math.max(hi, t.height(c[0] + o, c[2]), t.height(c[0] - o, c[2]),
                        t.height(c[0], c[2] + o), t.height(c[0], c[2] - o));
      v._groundCeiling = hi + 0.6;
    }
  };

  Game.prototype.physicsStep = function (dt) {
    var i, v;
    var world = this.world;
    var damageScale = this.settings.damage;

    for (i = 0; i < this.vehicles.length; i++) {
      v = this.vehicles[i];
      v.body.clearForces();
      v.drivetrain.step(dt, world);
      v.body.solveBeams(dt, damageScale);
      v.body.integrate(dt);
      v.body.collideTerrain(this.terrain, dt, 0.92, 0.10, v._groundCeiling);
      if (v._nearColliders && v._nearColliders.length) {
        v.body.collideBoxes(v._nearColliders, dt);
      }
    }
    // Car to car.
    for (i = 0; i < this.vehicles.length; i++) {
      for (var j = i + 1; j < this.vehicles.length; j++) {
        B.SoftBody.collidePair(this.vehicles[i].body, this.vehicles[j].body, dt);
      }
    }
    for (i = 0; i < this.vehicles.length; i++) {
      this.vehicles[i].body.updateFrame();
    }
  };

  Game.prototype.step = function (rawDt) {
    var dt = Math.min(rawDt, 0.10) * this.slowMotion;
    this.time += dt;

    this.input.update(rawDt);
    if (this.paused) return;
    this.applyInput();

    for (var a = 0; a < this.ais.length; a++) this.ais[a].update(dt);

    this.refreshBroadphase();

    var steps = Math.ceil(dt / this.fixedStep);
    if (steps < 1) steps = 1;
    if (steps > this.maxSteps) steps = this.maxSteps;
    // dt/steps is never larger than fixedStep unless the maxSteps cap bit,
    // and MAX_STEP is the solver's stability ceiling either way.
    var h = dt / steps;
    if (h > MAX_STEP) h = MAX_STEP;
    this.substeps = steps;
    for (var si = 0; si < steps; si++) this.physicsStep(h);

    this.postPhysics(dt);
  };

  Game.prototype.postPhysics = function (dt) {
    var i, v;
    var player = this.player;
    if (!player) return;
    var body = player.body;
    var d = this.playerDrive;

    for (i = 0; i < this.vehicles.length; i++) {
      v = this.vehicles[i];
      v.body.updateLocalPositions();
      v.body.updateDamage();
      var lod = v.isPlayer ? true : (V.dist(v.body.center, this.camera.position) < 90);
      for (var p = 0; p < v.parts.length; p++) {
        var part = v.parts[p];
        part.skin.update(v.body, part.recomputeNormals && lod);
      }
    }

    // ------------------------------------------------------- impact FX --
    for (i = 0; i < this.vehicles.length; i++) {
      v = this.vehicles[i];
      var imp = v.body.lastImpact;
      v.body.lastImpact = 0;
      if (imp > 40) {
        var strength = M.clamp(imp / 5200, 0, 1);
        var isPlayer = v.isPlayer;
        if (this.time - this._lastImpactSound > 0.055) {
          this.audio.impact(strength * (isPlayer ? 1 : 0.55), true);
          this._lastImpactSound = this.time;
        }
        if (isPlayer) {
          this.camera.addImpact(strength * 1.5);
          this.renderer.damageFlash = Math.min(this.renderer.damageFlash + strength * 0.6, 0.65);
          if (this.driver) {
            this.driver.jolt[1] -= 0;
          }
          this._driverImpact = strength;
        }
        var c = v.body.center;
        this.particles.impactPuff(c[0], c[1], c[2], strength * 2);
        if (strength > 0.12) {
          this.particles.debris(c[0], c[1] + 0.3, c[2], strength * 2.2, v.paint);
          this.particles.sparks(c[0], c[1], c[2], 0, 1, 0, strength * 1.4);
        }
      }
    }
    this.renderer.damageFlash *= Math.exp(-dt * 3.2);

    // ---------------------------------------------- tyre smoke + marks --
    var pbudget = this.settings.particles;
    this.particles.budget = pbudget;
    for (i = 0; i < this.vehicles.length; i++) {
      v = this.vehicles[i];
      var near = v.isPlayer || V.dist(v.body.center, this.camera.position) < 70;
      if (!near) continue;
      var dtv = v.drivetrain;
      for (var w = 0; w < dtv.wheels.length; w++) {
        var wh = dtv.wheels[w];
        if (!wh.contact) { this._skidLast[w] = null; continue; }
        var cp = wh.contactPoint;
        if (wh.skid > 0.16 && pbudget > 0.01) {
          if (Math.random() < wh.skid * 1.4 * pbudget) {
            this.particles.tyreSmoke(cp[0], cp[1], cp[2],
              v.body.velocity[0], v.body.velocity[2], wh.skid, wh.surface);
          }
        }
        // Skid marks, player only, on hard surfaces.
        if (v.isPlayer && wh.skid > 0.22 && wh.surface === B.SURF.ROAD) {
          var last = this._skidLast[w];
          if (last && Math.hypot(cp[0] - last[0], cp[2] - last[2]) > 0.22) {
            var rx = wh.right[0], rz = wh.right[2];
            var rl = Math.hypot(rx, rz) || 1;
            this.skid.addSegment(last[0], last[1] + 0.02, last[2],
              cp[0], cp[1] + 0.02, cp[2], rx / rl, rz / rl,
              wh.def.width * 0.95, M.clamp(wh.skid, 0, 1));
            this._skidLast[w] = [cp[0], cp[1], cp[2]];
          } else if (!last) {
            this._skidLast[w] = [cp[0], cp[1], cp[2]];
          }
        } else if (v.isPlayer) {
          this._skidLast[w] = null;
        }
      }
      // Smoke from a badly damaged engine bay.
      if (v.body.damage > 0.55 && Math.random() < (v.body.damage - 0.5) * 2.4 * pbudget) {
        var eng = v.lattice.engineNode;
        var ex = v.body.pos[eng * 3], ey = v.body.pos[eng * 3 + 1], ez = v.body.pos[eng * 3 + 2];
        this.particles.engineSmoke(ex, ey + 0.25, ez, M.clamp((v.body.damage - 0.5) * 2, 0, 1));
      }
    }
    this.skid.flush();

    // ------------------------------------------------------------ water --
    if (this.world.water) {
      var wl = this.world.water.level;
      for (i = 0; i < this.vehicles.length; i++) {
        v = this.vehicles[i];
        var subm = 0;
        for (var n = 0; n < v.body.nodeCount; n++) {
          var ny = v.body.pos[n * 3 + 1];
          if (ny < wl) {
            subm++;
            // Buoyancy plus heavy drag.
            var depth = Math.min(wl - ny, 1.2);
            v.body.vel[n * 3] *= (1 - 2.4 * dt);
            v.body.vel[n * 3 + 1] += (depth * 16 - v.body.vel[n * 3 + 1] * 3.0) * dt;
            v.body.vel[n * 3 + 2] *= (1 - 2.4 * dt);
          }
        }
        if (subm > 0 && v.isPlayer) {
          if (!this._inWater) {
            this.audio.splash(M.clamp(V.len(v.body.velocity) / 22, 0.2, 1));
            this.particles.waterSplash(v.body.center[0], wl, v.body.center[2], 1.4);
            this._inWater = true;
          }
          if (Math.random() < 0.4) {
            this.particles.waterSplash(v.body.center[0], wl, v.body.center[2], 0.35);
          }
        } else if (v.isPlayer) this._inWater = false;
      }
    }

    this.particles.update(dt, this.terrain, [0, 0, 0]);

    // -------------------------------------------------------- telemetry --
    var speed = d.speed;
    var accel = [
      (body.velocity[0] - this._prevVel[0]) / Math.max(dt, 1e-4),
      (body.velocity[2] - this._prevVel[2]) / Math.max(dt, 1e-4)
    ];
    this._prevVel.set(body.velocity);
    var f = body.frame;
    var latA = accel[0] * f[0] + accel[1] * f[2];
    var lonA = accel[0] * f[8] + accel[1] * f[10];
    this._gSmooth[0] = M.damp(this._gSmooth[0], latA / 9.81, 9, dt);
    this._gSmooth[1] = M.damp(this._gSmooth[1], lonA / 9.81, 9, dt);

    var t = this.telemetry;
    t.speedKph = speed * 3.6;
    t.rpm = d.rpm;
    t.gear = d.gearLabel();
    t.damage = body.damage;
    t.gForce[0] = this._gSmooth[0];
    t.gForce[1] = this._gSmooth[1];
    t.wheelsDown = d.wheelsOnGround || 0;
    t.airborne = t.wheelsDown === 0;
    t.distance += speed * dt;
    if (t.speedKph > t.topSpeed) t.topSpeed = t.speedKph;
    if (t.airborne) {
      t.airTime += dt;
      if (t.airTime > t.bestAir) t.bestAir = t.airTime;
    } else t.airTime = 0;
    t.regionDamage = body.regionDamage;

    // Landing thump after a jump.
    if (this._wasAirborne && !t.airborne && t.bestAir > 0.35) {
      this.camera.addImpact(M.clamp(t.bestAir * 0.5, 0.1, 0.8));
    }
    this._wasAirborne = t.airborne;

    // --------------------------------------------------------- driver ----
    if (this.driver && this.settings.showDriver) {
      var gearChanged = (d.gear !== this._gearPrev);
      this._gearPrev = d.gear;
      this.driver.hideHead = (this.camera.mode === 'cockpit');
      this.driver.animate({
        rig: player.rig,
        steerAngle: d.steeringWheelAngle(),
        throttle: d.throttle,
        brake: d.brake,
        clutch: d.clutchInput,
        gearChanged: gearChanged,
        manual: !d.autoBox,
        rhd: player.spec.rhd,
        lateralG: this._gSmooth[0] * 9.81,
        longitudinalG: this._gSmooth[1] * 9.81,
        speed: speed,
        dt: dt,
        impact: this._driverImpact || 0
      });
      this._driverImpact = 0;
    }

    // --------------------------------------------------------- camera ----
    this.camera.baseFov = this.settings.fov * M.DEG;
    this.camera.shakeIntensity = this.settings.shake;
    this.camera.update({
      vehicle: player,
      drivetrain: d,
      terrain: this.terrain,
      world: this.world,
      dt: dt,
      lateralG: this._gSmooth[0] * 9.81,
      lookYaw: this.input.state.lookYaw,
      lookPitch: this.input.state.lookPitch,
      orbitDelta: this.consumeOrbitDelta(),
      orbitZoom: this.consumeOrbitZoom(),
      freeMove: this.input.state.freeMove,
      freeLook: this.consumeFreeLook(),
      freeBoost: this.input.state.freeBoost
    });

    // Speed blur ramps in above roughly 70 km/h.
    var blur = M.clamp((t.speedKph - 68) / 150, 0, 1);
    this.renderer.speedBlurAmount = M.damp(this.renderer.speedBlurAmount,
      blur * 0.085 * (this.settings.motionBlur ? 1 : 0), 4, dt);

    // ---------------------------------------------------------- audio ----
    var maxSkid = 0, anyDown = 0, surf = B.SURF.ROAD;
    for (var k = 0; k < d.wheels.length; k++) {
      if (d.wheels[k].skid > maxSkid) maxSkid = d.wheels[k].skid;
      if (d.wheels[k].contact) { anyDown = 1; surf = d.wheels[k].surface; }
    }
    var sndSpec = player.spec.engine.sound || {};
    this.audio.update({
      rpm: d.rpm,
      redline: player.spec.engine.redline,
      idle: player.spec.engine.idle,
      load: d.engineLoad,
      speed: speed,
      skid: maxSkid,
      surface: surf,
      wheelsDown: anyDown,
      cylinders: sndSpec.base ? Math.max(3, Math.round(sndSpec.base / 11)) : 4,
      harmonics: sndSpec.harmonics,
      growl: sndSpec.growl,
      turbo: /TURBO/i.test(player.spec.klass) || player.spec.id === 'sprint' || player.spec.id === 'vector',
      gearChanging: d.shiftTimer > 0,
      engineOn: d.engineOn,
      cabin: this.camera.mode === 'cockpit'
    }, dt);

    // Scrape when body panels are dragging on the ground.
    var scraping = 0;
    for (var cn = 0; cn < body.nodeCount; cn++) {
      if (body.contact[cn] && !(body.nodeFlags[cn] & 2)) scraping++;
    }
    this.audio.scrape(scraping > 0 ? M.clamp(scraping * 0.22 * Math.min(speed / 8, 1), 0, 1) : 0);
  };

  Game.prototype.consumeOrbitDelta = function () {
    var d = this.input.state.orbitDelta;
    var out = [d[0], d[1]];
    d[0] = 0; d[1] = 0;
    return out;
  };
  Game.prototype.consumeOrbitZoom = function () {
    var z = this.input.state.orbitZoom;
    this.input.state.orbitZoom = 0;
    return z;
  };
  Game.prototype.consumeFreeLook = function () {
    var d = this.input.state.orbitDelta;
    var out = [-d[0], -d[1]];
    d[0] = 0; d[1] = 0;
    return out;
  };

  /* ------------------------------------------------------- scene build - */

  Game.prototype.buildScene = function () {
    var s = this.scene;
    s.opaque.length = 0;
    s.instanced.length = 0;
    s.transparent.length = 0;
    s.env = this.world.env;
    s.particles = this.particles;

    var identity = this._identity || (this._identity = Mat.create());
    var castTerrain = this.renderer.preset === 'high' || this.renderer.preset === 'ultra';

    s.opaque.push({
      geometry: this.terrainMesh, matrix: identity, castShadow: castTerrain,
      material: { type: 3, baseColor: [1, 1, 1], roughness: 0.9, metallic: 0, clearcoat: 0, opacity: 1 }
    });
    if (this.roadMesh) {
      s.opaque.push({
        geometry: this.roadMesh, matrix: identity, castShadow: false,
        material: { type: 3, baseColor: [1, 1, 1], roughness: 0.72, metallic: 0, clearcoat: 0.05, opacity: 1 }
      });
    }
    if (this.markingMesh) {
      s.opaque.push({
        geometry: this.markingMesh, matrix: identity, castShadow: false,
        material: { type: 0, baseColor: [0.80, 0.79, 0.74], roughness: 0.62, metallic: 0, clearcoat: 0, opacity: 1 }
      });
    }
    if (this.skid.count > 0) {
      s.transparent.push({
        geometry: this.skid.geometry, matrix: identity, castShadow: false,
        material: this.skid.material
      });
    }

    for (var pi = 0; pi < this.world.props.length; pi++) {
      var pr = this.world.props[pi];
      if (!pr.geometry.instanceCount) pr.geometry.setInstances(pr.matrices, pr.tints);
      s.instanced.push({ geometry: pr.geometry, material: pr.material, castShadow: true });
    }

    // Vehicles.
    for (var vi = 0; vi < this.vehicles.length; vi++) {
      var v = this.vehicles[vi];
      var frame = v.body.frame;
      for (var p = 0; p < v.parts.length; p++) {
        var part = v.parts[p];
        var entry = {
          geometry: part.skin.geometry,
          matrix: frame,
          material: part.material,
          castShadow: part.castShadow !== false && part.name !== 'glass'
        };
        if (part.material.transparent) s.transparent.push(entry);
        else s.opaque.push(entry);
        if (part.isLights) {
          var lit = this.settings.headlights || (s.env.sunDir[1] < 0.12);
          part.material.emissive = lit ? [2.4, 2.25, 1.9] : [0.04, 0.04, 0.045];
        }
      }
      // Wheels.
      for (var wi = 0; wi < v.wheels.length; wi++) {
        var wdef = v.wheels[wi];
        var wst = v.drivetrain.wheels[wi];
        var m = wst._matrix || (wst._matrix = Mat.create());
        var rot = wst._rot || (wst._rot = Mat.create());
        var tmp = wst._tmp || (wst._tmp = Mat.create());
        // Body rotation, then steer about local Y, then spin about local X.
        Mat.copy(m, frame);
        m[12] = v.body.pos[wdef.node * 3];
        m[13] = v.body.pos[wdef.node * 3 + 1];
        m[14] = v.body.pos[wdef.node * 3 + 2];
        Mat.rotY(rot, wst.steer);
        Mat.mul(tmp, m, rot);
        Mat.rotX(rot, -wst.spin * wdef.side);
        Mat.mul(m, tmp, rot);
        // The wheel mesh is built around +X; mirror the left-hand pair.
        if (wdef.side < 0) {
          m[0] = -m[0]; m[1] = -m[1]; m[2] = -m[2];
        }
        s.opaque.push({
          geometry: v.wheelGeometry, matrix: m, castShadow: true,
          material: { type: 7, baseColor: [1, 1, 1], roughness: 0.88, metallic: 0.1, clearcoat: 0, opacity: 1 }
        });
      }
    }

    // Driver and steering wheel, in the player's frame.
    if (this.driver && this.settings.showDriver && this.player) {
      var pf = this.player.body.frame;
      s.opaque.push({
        geometry: this.driver.geometry, matrix: pf, castShadow: true,
        material: { type: 5, baseColor: [1, 1, 1], roughness: 0.72, metallic: 0, clearcoat: 0, opacity: 1 }
      });
      if (this.steeringWheelGeom) {
        var rig = this.player.rig;
        var swm = this._swm || (this._swm = Mat.create());
        var local = this._swLocal || (this._swLocal = Mat.create());
        var spin = this._swSpin || (this._swSpin = Mat.create());
        var tiltM = this._swTilt || (this._swTilt = Mat.create());
        Mat.rotX(tiltM, rig.wheelTilt);
        Mat.rotZ(spin, this.playerDrive.steeringWheelAngle());
        Mat.mul(local, tiltM, spin);
        // Scale the stock 0.18 m rim to this car's wheel size.
        var sc = rig.wheelRadius / 0.18;
        for (var c2 = 0; c2 < 12; c2++) local[c2] *= sc;
        local[12] = rig.wheelPos[0]; local[13] = rig.wheelPos[1]; local[14] = rig.wheelPos[2];
        Mat.mul(swm, pf, local);
        s.opaque.push({
          geometry: this.steeringWheelGeom, matrix: swm, castShadow: false,
          material: { type: 0, baseColor: [1, 1, 1], roughness: 0.55, metallic: 0.1, clearcoat: 0.2, opacity: 1 }
        });
      }
    }

    // Water.
    if (this.waterMesh && this.world.water) {
      var wm = this._waterM || (this._waterM = Mat.create());
      Mat.identity(wm);
      wm[12] = this.camera.position[0];
      wm[13] = this.world.water.level;
      wm[14] = this.camera.position[2];
      s.transparent.push({
        geometry: this.waterMesh, matrix: wm, castShadow: false,
        material: {
          type: 6, baseColor: this.world.water.color, roughness: 0.04,
          metallic: 0, clearcoat: 1, opacity: 0.72, transparent: true, doubleSided: true
        }
      });
    }

    // Headlight cone.
    var hl = s.headlight;
    hl.on = this.settings.headlights || (s.env.sunDir[1] < 0.10);
    if (hl.on && this.player) {
      var bf = this.player.body.frame;
      var noseZ = this.player.spec.length * 0.46;
      hl.pos[0] = bf[12] + bf[8] * noseZ + bf[4] * 0.45;
      hl.pos[1] = bf[13] + bf[9] * noseZ + bf[5] * 0.45;
      hl.pos[2] = bf[14] + bf[10] * noseZ + bf[6] * 0.45;
      hl.dir[0] = bf[8] - bf[4] * 0.14;
      hl.dir[1] = bf[9] - bf[5] * 0.14;
      hl.dir[2] = bf[10] - bf[6] * 0.14;
      V.normalize(hl.dir, hl.dir);
    }

    s.bloomStrength = 0.20 + (s.env.sunDir[1] < 0.2 ? 0.14 : 0);
    return s;
  };

  Game.prototype.render = function (dt) {
    var scene = this.buildScene();
    this.camera.setAspect(this.renderer.width / Math.max(this.renderer.height, 1));
    this.renderer.render(scene, this.camera, dt);
  };

  Game.prototype.applyQuality = function (name) {
    this.settings.quality = name;
    this.renderer.setPreset(name);
    var q = this.renderer.q;
    // The explicit solver needs a short step to stay stable at these beam
    // stiffnesses; lower presets trade some fidelity for headroom.
    this.fixedStep = (name === 'low') ? 1 / 300
                   : (name === 'medium' ? 1 / 360 : (name === 'ultra' ? 1 / 600 : 1 / 480));
    // Enough steps to hold real time down to about 12 fps before the
    // simulation is allowed to slow down.
    this.maxSteps = Math.ceil(0.085 / this.fixedStep);
    this.particles.enabled = name !== 'low';
    this.camera.far = q.drawDistance * 1.6;
    // The terrain mesh LOD is baked in, so rebuild it if the step changed.
    if (this.terrain && this.terrainMesh && this._terrainLOD !== q.terrainLOD) {
      this._terrainLOD = q.terrainLOD;
      var data = this.terrain.buildMesh(q.terrainLOD);
      this.terrainMesh.dispose();
      this.terrainMesh = B.Geo.fromArrays(data.position, data.normal, data.uv, data.color, data.indices);
    }
  };

  B.Game = Game;
  B.SkidMarks = SkidMarks;
  B.RoadAI = RoadAI;

})();
