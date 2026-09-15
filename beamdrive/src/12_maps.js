/* =========================================================================
   BeamDrive Mobile — maps
   Each map builds a Terrain, lays roads, scatters props and hands back the
   lighting environment. Everything is generated from a seed, so the whole
   game ships as code with no assets to download.
   ========================================================================= */
(function () {
  'use strict';

  var M = B.M, SURF = B.SURF;

  function sunFrom(azimuthDeg, elevationDeg) {
    var az = azimuthDeg * M.DEG, el = elevationDeg * M.DEG;
    return [
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az)
    ];
  }

  var MAPS = [

    /* ================================================== Proving Grounds == */
    {
      id: 'grounds',
      name: 'Proving Grounds',
      blurb: 'Flat tarmac, jumps, a skid pad and a crash wall. The place to find out what breaks first.',
      difficulty: 'Easy',
      size: 620,
      build: function () {
        var t = new B.Terrain({ size: 620, res: 152, baseSurface: SURF.GRASS });
        var n = B.noise;
        t.generate(function (x, z) {
          var d = Math.hypot(x, z);
          // A wide, almost dead-flat pan with a low berm around the outside.
          var base = n.fbm2(x * 0.0035, z * 0.0035, 3) * 3.0;
          var flat = M.smoothstep(240, 70, d);
          var berm = M.smoothstep(250, 300, d) * 14;
          var y = base * (1 - flat * 0.94) + berm;
          if (d < 210) y += n.fbm2(x * 0.02, z * 0.02, 2) * 0.10;
          return { y: y, s: d < 215 ? SURF.GRASS : SURF.GRASS };
        });

        var roads = [];
        // Outer high-speed oval.
        roads.push(t.addRoad([
          [0, 0, 190], [130, 0, 150], [178, 0, 40], [178, 0, -40],
          [130, 0, -150], [0, 0, -190], [-130, 0, -150], [-178, 0, -40],
          [-178, 0, 40], [-130, 0, 150]
        ], { width: 14, camber: 0.22, closed: true, shoulder: 5, step: 4 }));
        // Infield handling loop.
        roads.push(t.addRoad([
          [-90, 0, 60], [-20, 0, 92], [58, 0, 70], [96, 0, 8],
          [50, 0, -58], [-30, 0, -74], [-92, 0, -36]
        ], { width: 9, camber: 0.10, closed: true, shoulder: 4, step: 3 }));
        // Drag strip down the middle.
        roads.push(t.addRoad([[0, 0, -150], [0, 0, 150]],
          { width: 12, camber: 0.04, shoulder: 4, step: 5 }));

        var w = new B.World(t);

        // Jumps down the drag strip.
        var jumpZ = [-40, 10, 62];
        for (var j = 0; j < jumpZ.length; j++) {
          w.add('ramp', -26, t.height(-26, jumpZ[j]), jumpZ[j], 0, [1, 0.55 + j * 0.25, 1]);
        }
        // Kicker facing the other way, for the brave.
        w.add('ramp', 26, t.height(26, 20), 20, Math.PI, [1.2, 1.0, 1.4]);

        // Skid pad marked out with cones.
        w.ring('cone', -120, -90, 30, 26, {});
        w.ring('cone', -120, -90, 16, 16, {});

        // Cone slalom on the infield straight.
        for (var c = 0; c < 14; c++) {
          w.add('cone', -70 + c * 11, t.height(-70 + c * 11, 92 + (c % 2 ? 3.5 : -3.5)),
            92 + (c % 2 ? 3.5 : -3.5), 0, 1);
        }

        // Crash wall: a solid block of concrete to aim at.
        w.line('barrier', [96, 0, -120], [140, 0, -120], 3.0, { yawOffset: Math.PI / 2 });
        w.line('barrier', [96, 0, -123], [140, 0, -123], 3.0, { yawOffset: Math.PI / 2 });
        for (var s = 0; s < 8; s++) {
          w.add('tyrestack', 100 + s * 5.4, t.height(100 + s * 5.4, -116), -116, 0, 1);
        }

        // Block course to climb and bounce off.
        var bx = [-160, -150, -140, -152, -142, -164];
        var bz = [-140, -152, -138, -126, -118, -126];
        for (var b = 0; b < bx.length; b++) {
          w.add('block', bx[b], t.height(bx[b], bz[b]), bz[b], b * 0.7, 1 + (b % 3) * 0.25);
        }

        // Containers stacked for a jump landing / climbing course.
        w.add('container', 130, t.height(130, 90), 90, 0.3, 1);
        w.add('container', 130, t.height(130, 90) + 2.6, 90, 0.3, 1);
        w.add('container', 138, t.height(138, 96), 96, 1.1, 1);

        w.line('guardrail', [-178, 0, 120], [-178, 0, -120], 4.0, { yawOffset: Math.PI / 2 });
        w.scatter('tree', 220, { seed: 7, minRadius: 215, maxRadius: 300, scale: [0.8, 1.5], collide: false });
        w.scatter('rock', 60, { seed: 9, minRadius: 220, maxRadius: 300, scale: [0.7, 2.0] });

        for (var lp = 0; lp < 10; lp++) {
          var a = (lp / 10) * Math.PI * 2;
          w.add('lightpole', Math.cos(a) * 196, t.height(Math.cos(a) * 196, Math.sin(a) * 196),
            Math.sin(a) * 196, -a, 1);
        }

        w.env = {
          sunDir: sunFrom(38, 52),
          sunColor: [4.4, 4.15, 3.75],
          skyZenith: [0.21, 0.38, 0.72],
          skyHorizon: [0.62, 0.72, 0.88],
          groundAmb: [0.16, 0.16, 0.14],
          fogColor: [0.66, 0.74, 0.86],
          fogDensity: 0.00095,
          fogHeight: 20,
          cloudAmount: 0.30,
          turbidity: 1.0,
          exposure: 1.0
        };
        w.water = null;
        // The drag strip is roads[2]; start everyone on the line.
        w.spawns = w.spawnsFromRoad(roads[2], [0.04, 0.04, 0.04, 0.50], [0, 3.4, -3.4, 0]);
        w.roadsList = roads;
        return w;
      }
    },

    /* ====================================================== Coastal Run == */
    {
      id: 'coast',
      name: 'Coastal Run',
      blurb: 'A cliff road above the sea at golden hour. No barriers on the drop side. Watch the camber.',
      difficulty: 'Medium',
      size: 780,
      build: function () {
        var t = new B.Terrain({ size: 780, res: 180, baseSurface: SURF.GRASS, waterLevel: 0 });
        var n = B.noise;
        t.generate(function (x, z) {
          // Coastline runs roughly along Z; land rises to the east.
          var shore = x * 0.055 + n.fbm2(x * 0.004, z * 0.0055, 4) * 22 - 4;
          var hills = n.fbm2(x * 0.0048, z * 0.0042, 5) * 46;
          var ridge = n.ridged2(x * 0.0030, z * 0.0026, 4) * 58;
          var y = shore + hills * 0.65 + ridge * M.smoothstep(-10, 120, x) * 0.75;
          // Carve a beach band and a cliff edge.
          y -= M.smoothstep(40, -140, x) * 26;
          var s = SURF.GRASS;
          if (y < 2.2) s = SURF.SAND;
          else if (y > 78) s = SURF.ROCK;
          return { y: y, s: s };
        });

        var roads = [];
        roads.push(t.addRoad([
          [26, 0, -360], [48, 0, -280], [18, 0, -190], [44, 0, -104],
          [78, 0, -30], [66, 0, 52], [26, 0, 118], [46, 0, 200],
          [86, 0, 272], [72, 0, 352]
        ], { width: 11, camber: 0.16, shoulder: 11, step: 3.5, smooth: 0.45,
             lift: 0.4, minY: 7 }));
        // Inland link road climbing into the hills.
        roads.push(t.addRoad([
          [78, 0, -30], [130, 0, -46], [186, 0, -8], [222, 0, 78], [180, 0, 168], [104, 0, 196]
        ], { width: 8.5, camber: 0.12, shoulder: 10, step: 3.5, smooth: 0.42,
             lift: 0.4, minY: 8 }));

        var w = new B.World(t);

        // Guardrail on the seaward side of the worst corners.
        var rail = [[18, 0, -190], [44, 0, -104], [78, 0, -30], [66, 0, 52], [26, 0, 118]];
        for (var r = 0; r < rail.length - 1; r++) {
          var a = rail[r], b = rail[r + 1];
          var dx = b[0] - a[0], dz = b[2] - a[2];
          var len = Math.hypot(dx, dz);
          var nx = -dz / len, nz = dx / len;
          w.line('guardrail',
            [a[0] + nx * 7.4, 0, a[2] + nz * 7.4],
            [b[0] + nx * 7.4, 0, b[2] + nz * 7.4], 4.0,
            { yawOffset: Math.PI / 2 });
        }

        w.scatter('pine', 420, { seed: 21, maxRadius: 370, minY: 8, maxY: 110, scale: [0.75, 1.55],
                                 maxSlope: 0.45, collide: false, roadClear: 11 });
        w.scatter('tree', 260, { seed: 22, maxRadius: 360, minY: 4, maxY: 60, scale: [0.8, 1.4],
                                 maxSlope: 0.35, collide: false, roadClear: 11 });
        w.scatter('rock', 190, { seed: 23, maxRadius: 370, minY: 1, scale: [0.6, 2.6], maxSlope: 0.85 });

        // A small settlement on the inland loop.
        w.add('building', 150, t.height(150, 30), 30, 0.4, 0.9);
        w.add('building', 178, t.height(178, 58), 58, 1.8, 1.1);
        w.add('warehouse', 120, t.height(120, 74), 74, 0.9, 0.8);
        for (var lp = 0; lp < 14; lp++) {
          var tt = lp / 13;
          var lx = -40 + tt * 60 - Math.sin(tt * 6) * 30;
          var lz = -360 + tt * 700;
          w.add('lightpole', lx + 8, t.height(lx + 8, lz), lz, 0, 1);
        }

        w.env = {
          sunDir: sunFrom(286, 13),
          sunColor: [6.2, 3.6, 1.85],
          skyZenith: [0.16, 0.26, 0.55],
          skyHorizon: [0.95, 0.60, 0.34],
          groundAmb: [0.13, 0.11, 0.10],
          fogColor: [0.78, 0.55, 0.42],
          fogDensity: 0.0015,
          fogHeight: 22,
          cloudAmount: 0.46,
          turbidity: 1.9,
          exposure: 1.05
        };
        w.water = { level: 0, size: 2400, color: [0.014, 0.046, 0.060] };
        w.spawns = w.spawnsFromRoad(roads[0], [0.02, 0.02, 0.30, 0.62], [0, 3.2, 0, 3.2]);
        w.roadsList = roads;
        return w;
      }
    },

    /* ======================================================= Alpine Pass == */
    {
      id: 'alpine',
      name: 'Alpine Pass',
      blurb: 'Switchbacks, sheer drops and snow above the treeline. Brakes will be an issue.',
      difficulty: 'Hard',
      size: 860,
      build: function () {
        var t = new B.Terrain({ size: 860, res: 190, baseSurface: SURF.ROCK });
        var n = B.noise;
        t.generate(function (x, z) {
          var d = Math.hypot(x * 0.85, z) / 380;
          // Deliberately restrained relief. The pass has to be a road you
          // can drive, not a cliff face with a ribbon draped over it: past
          // roughly this gradient the carriageway ends up perched above the
          // ground beside it and a wheel off line is unrecoverable.
          var ridge = n.ridged2(x * 0.0026, z * 0.0024, 5) * 92;
          var rough = n.fbm2(x * 0.0085, z * 0.0080, 4) * 7;
          var bowl = -M.smoothstep(0.0, 0.75, 1 - d) * 22;
          var y = ridge * (0.40 + 0.75 * M.smoothstep(0.1, 1.0, d)) + rough + bowl + 20;
          var s = SURF.ROCK;
          if (y > 86) s = SURF.SNOW;
          else if (y < 52) s = SURF.GRASS;
          return { y: y, s: s };
        });

        var roads = [];
        // A climbing series of switchbacks up the valley side.
        roads.push(t.addRoad([
          [-300, 0, -300], [-200, 0, -250], [-120, 0, -290], [-40, 0, -220],
          [-90, 0, -130], [-190, 0, -140], [-230, 0, -40], [-140, 0, 30],
          [-30, 0, 10], [40, 0, 80], [-20, 0, 170], [-130, 0, 190],
          [-170, 0, 280], [-60, 0, 330], [70, 0, 300], [160, 0, 230],
          [210, 0, 120], [170, 0, 10], [240, 0, -90], [300, 0, -200]
        ], { width: 11, camber: 0.16, shoulder: 17, step: 3.0, smooth: 0.30, lift: 0.5 }));

        var w = new B.World(t);

        // Guardrails on the outside of every hairpin.
        var pts = roads[0].points;
        for (var i = 4; i < pts.length - 4; i += 6) {
          var a = pts[i], b = pts[Math.min(i + 5, pts.length - 1)];
          var dx = b[0] - a[0], dz = b[2] - a[2];
          var len = Math.hypot(dx, dz) || 1;
          var nx = -dz / len, nz = dx / len;
          // Put the rail on whichever side falls away fastest.
          var hA = t.rawHeight(a[0] + nx * 12, a[2] + nz * 12);
          var hB = t.rawHeight(a[0] - nx * 12, a[2] - nz * 12);
          var sgn = hA < hB ? 1 : -1;
          w.line('guardrail',
            [a[0] + nx * sgn * 8.2, 0, a[2] + nz * sgn * 8.2],
            [b[0] + nx * sgn * 8.2, 0, b[2] + nz * sgn * 8.2], 5.0,
            { yawOffset: Math.PI / 2 });
        }

        w.scatter('pine', 620, { seed: 31, maxRadius: 410, minY: 20, maxY: 88,
                                 scale: [0.7, 1.7], maxSlope: 0.60, collide: false, roadClear: 10 });
        w.scatter('rock', 320, { seed: 32, maxRadius: 415, scale: [0.6, 3.4], maxSlope: 0.95 });
        w.scatter('tree', 140, { seed: 33, maxRadius: 300, minY: 12, maxY: 50,
                                 scale: [0.8, 1.3], maxSlope: 0.42, collide: false, roadClear: 10 });

        w.env = {
          sunDir: sunFrom(150, 34),
          sunColor: [3.6, 3.7, 3.9],
          skyZenith: [0.30, 0.40, 0.58],
          skyHorizon: [0.72, 0.76, 0.82],
          groundAmb: [0.20, 0.21, 0.24],
          fogColor: [0.74, 0.78, 0.84],
          fogDensity: 0.0021,
          fogHeight: 46,
          cloudAmount: 0.72,
          turbidity: 0.7,
          exposure: 1.0
        };
        w.water = null;
        w.spawns = w.spawnsFromRoad(roads[0], [0.05, 0.05, 0.38, 0.72], [0, 3.0, 0, 3.0]);
        w.roadsList = roads;
        return w;
      }
    },

    /* ======================================================== Derby Bowl == */
    {
      id: 'derby',
      name: 'Derby Bowl',
      blurb: 'A dirt saucer ringed with tyre walls. No route, no lap time. Just you and the bodywork.',
      difficulty: 'Chaos',
      size: 420,
      build: function () {
        var t = new B.Terrain({ size: 420, res: 140, baseSurface: SURF.DIRT });
        var n = B.noise;
        t.generate(function (x, z) {
          var d = Math.hypot(x, z);
          // Dished arena floor with a raised rim and spectator banking.
          var bowl = -M.smoothstep(96, 0, d) * 3.2;
          var rim = M.smoothstep(96, 132, d) * 12;
          var outer = M.smoothstep(132, 190, d) * 16;
          var rough = n.fbm2(x * 0.05, z * 0.05, 3) * 0.22 * M.smoothstep(120, 40, d);
          var y = bowl + rim + outer + rough;
          var s = d < 120 ? SURF.DIRT : SURF.GRASS;
          return { y: y, s: s };
        });

        var w = new B.World(t);

        // Tyre wall around the arena.
        w.ring('tyrestack', 0, 0, 94, 96, {});
        w.ring('tyrestack', 0, 0, 90, 90, {});
        // Concrete outer ring behind it.
        w.ring('barrier', 0, 0, 100, 64, { yawOffset: Math.PI / 2 });

        // Obstacles in the middle.
        w.add('block', 0, t.height(0, 0), 0, 0.4, 1.6);
        w.ring('block', 0, 0, 34, 6, { scale: 1.1 });
        w.ring('haybale', 0, 0, 58, 18, {});
        w.ring('cone', 0, 0, 72, 30, {});
        w.add('container', -52, t.height(-52, 30), 30, 0.8, 1);
        w.add('container', 48, t.height(48, -34), -34, 2.1, 1);
        w.add('ramp', 0, t.height(0, -62), -62, 0, [1.3, 0.7, 1.2]);
        w.add('ramp', 0, t.height(0, 62), 62, Math.PI, [1.3, 0.7, 1.2]);

        // Floodlights and stands.
        for (var i = 0; i < 8; i++) {
          var a = (i / 8) * Math.PI * 2 + 0.4;
          w.add('lightpole', Math.cos(a) * 116, t.height(Math.cos(a) * 116, Math.sin(a) * 116),
            Math.sin(a) * 116, -a, 1.35);
        }
        w.scatter('tree', 180, { seed: 41, minRadius: 150, maxRadius: 200, scale: [0.8, 1.4], collide: false });

        w.env = {
          sunDir: sunFrom(212, 9),
          sunColor: [5.2, 3.2, 1.9],
          skyZenith: [0.12, 0.16, 0.34],
          skyHorizon: [0.72, 0.42, 0.30],
          groundAmb: [0.14, 0.12, 0.12],
          fogColor: [0.46, 0.34, 0.30],
          fogDensity: 0.0026,
          fogHeight: 18,
          cloudAmount: 0.55,
          turbidity: 2.4,
          exposure: 1.12
        };
        w.water = null;
        w.spawns = [
          { pos: [0, 0, -76], yaw: 0 },
          { pos: [22, 0, -72], yaw: 0.2 },
          { pos: [-22, 0, -72], yaw: -0.2 },
          { pos: [0, 0, 76], yaw: Math.PI },
          { pos: [70, 0, 0], yaw: -Math.PI / 2 },
          { pos: [-70, 0, 0], yaw: Math.PI / 2 }
        ];
        w.roadsList = [];
        return w;
      }
    },

    /* ======================================================== Port Docks == */
    {
      id: 'docks',
      name: 'Port Docks',
      blurb: 'Container stacks, wet concrete and a quayside with nothing to stop you going in.',
      difficulty: 'Medium',
      size: 560,
      build: function () {
        var t = new B.Terrain({ size: 560, res: 150, baseSurface: SURF.ROAD, waterLevel: -1.6 });
        var n = B.noise;
        t.generate(function (x, z) {
          // Flat concrete apron that drops away to the harbour on the west.
          var apron = 1.2 + n.fbm2(x * 0.02, z * 0.02, 2) * 0.10;
          var quayEdge = M.smoothstep(-150, -196, x);
          var y = apron - quayEdge * 8.0;
          if (x < -196) y = -6.5;
          var s = SURF.ROAD;
          if (x > 150) { y += M.smoothstep(150, 230, x) * 12; s = SURF.GRASS; }
          return { y: y, s: s };
        });

        var roads = [];
        roads.push(t.addRoad([[-150, 0, -240], [-150, 0, 240]],
          { width: 13, camber: 0.05, shoulder: 3, step: 5, smooth: 0.9 }));
        roads.push(t.addRoad([[-160, 0, 0], [140, 0, 0]],
          { width: 13, camber: 0.05, shoulder: 3, step: 5, smooth: 0.9 }));
        roads.push(t.addRoad([[60, 0, -240], [60, 0, 240]],
          { width: 11, camber: 0.05, shoulder: 3, step: 5, smooth: 0.9 }));
        roads.push(t.addRoad([[-160, 0, -120], [140, 0, -120]],
          { width: 11, camber: 0.05, shoulder: 3, step: 5, smooth: 0.9 }));
        roads.push(t.addRoad([[-160, 0, 120], [140, 0, 120]],
          { width: 11, camber: 0.05, shoulder: 3, step: 5, smooth: 0.9 }));

        var w = new B.World(t);
        var rnd = M.rng(5150);

        // Container yard: rows of stacks between the access roads.
        var tints = [[0.72, 0.24, 0.16], [0.14, 0.34, 0.58], [0.82, 0.70, 0.20],
                     [0.22, 0.48, 0.30], [0.66, 0.66, 0.68], [0.52, 0.26, 0.48]];
        for (var row = 0; row < 6; row++) {
          for (var col = 0; col < 9; col++) {
            var cx = -110 + row * 28;
            var cz = -95 + col * 24;
            if (Math.abs(cz) < 14 || Math.abs(Math.abs(cz) - 120) < 14) continue;
            var stack = 1 + Math.floor(rnd() * 3);
            for (var h = 0; h < stack; h++) {
              w.add('container', cx, t.height(cx, cz) + h * 2.60, cz,
                (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.05, 1,
                tints[(row * 9 + col + h) % tints.length]);
            }
          }
        }

        w.add('warehouse', 105, t.height(105, -70), -70, 0, 1);
        w.add('warehouse', 105, t.height(105, 70), 70, 0, 1);
        w.add('building', 120, t.height(120, 0), 0, Math.PI / 2, 0.8);

        // Quayside furniture.
        w.line('barrier', [-188, 0, -200], [-188, 0, 200], 3.2, { yawOffset: Math.PI / 2 });
        for (var lp = 0; lp < 12; lp++) {
          var lz = -220 + lp * 40;
          w.add('lightpole', -176, t.height(-176, lz), lz, Math.PI / 2, 1);
          w.add('lightpole', 78, t.height(78, lz), lz, -Math.PI / 2, 1);
        }
        // A jump built out of a ramp and a container gap.
        w.add('ramp', 20, t.height(20, -180), -180, 0, [1.2, 0.9, 1.3]);
        w.ring('cone', 20, 60, 22, 18, {});
        w.scatter('tree', 90, { seed: 51, minRadius: 200, maxRadius: 260, scale: [0.8, 1.3], collide: false });

        w.env = {
          sunDir: sunFrom(96, 24),
          sunColor: [3.3, 3.35, 3.55],
          skyZenith: [0.34, 0.40, 0.50],
          skyHorizon: [0.70, 0.72, 0.76],
          groundAmb: [0.19, 0.20, 0.22],
          fogColor: [0.70, 0.72, 0.76],
          fogDensity: 0.0013,
          fogHeight: 18,
          cloudAmount: 0.80,
          turbidity: 0.55,
          exposure: 1.02
        };
        w.water = { level: -1.6, size: 1600, color: [0.020, 0.040, 0.048] };
        w.spawns = w.spawnsFromRoad(roads[0], [0.08, 0.08, 0.50, 0.88], [0, 3.6, 0, 3.6]);
        w.roadsList = roads;
        return w;
      }
    }
  ];

  /* A tiny studio used by the garage screen: flat floor, soft key light,
     nothing to collide with. Not listed in the map picker. */
  var SHOWROOM = {
    id: "showroom",
    name: "Showroom",
    blurb: "",
    hidden: true,
    size: 90,
    build: function () {
      var t = new B.Terrain({ size: 90, res: 24, baseSurface: SURF.ROAD });
      t.generate(function () { return { y: 0, s: SURF.ROAD }; });
      var w = new B.World(t);
      w.env = {
        sunDir: sunFrom(214, 42),
        sunColor: [3.9, 3.85, 3.95],
        skyZenith: [0.16, 0.18, 0.24],
        skyHorizon: [0.30, 0.31, 0.36],
        groundAmb: [0.13, 0.135, 0.15],
        fogColor: [0.14, 0.15, 0.18],
        fogDensity: 0.0165,
        fogHeight: 6,
        cloudAmount: 0.0,
        turbidity: 0.4,
        exposure: 1.06
      };
      w.water = null;
      w.spawns = [{ pos: [0, 0, 0], yaw: 0 }];
      w.roadsList = [];
      return w;
    }
  };

  B.SHOWROOM = SHOWROOM;

  B.MAPS = MAPS;
  B.getMap = function (id) {
    if (id === "showroom") return SHOWROOM;
    for (var i = 0; i < MAPS.length; i++) if (MAPS[i].id === id) return MAPS[i];
    return MAPS[0];
  };

})();
