/* =========================================================================
   BeamDrive Mobile — vehicle catalogue
   Stations run rear (index 0) to nose (last). Y is height above the ground
   plane, X is half-width. All figures are in metres / kilograms / newtons.
   ========================================================================= */
(function () {
  'use strict';

  function st(z, floorY, sillW, sillY, beltW, beltY, roofW, roofY) {
    return { z: z, floorY: floorY, sillW: sillW, sillY: sillY,
             beltW: beltW, beltY: beltY, roofW: roofW, roofY: roofY };
  }

  /* Torque curves are normalised 0..1 against peak torque and sampled at
     even RPM intervals from idle to redline. */
  var CURVE_NA = [0.52, 0.72, 0.86, 0.95, 1.00, 0.99, 0.94, 0.86, 0.74, 0.58];
  var CURVE_TURBO = [0.36, 0.62, 0.90, 1.00, 1.00, 0.98, 0.94, 0.88, 0.80, 0.66];
  var CURVE_V8 = [0.68, 0.84, 0.94, 1.00, 1.00, 0.97, 0.92, 0.85, 0.76, 0.62];
  var CURVE_DIESEL = [0.74, 0.95, 1.00, 1.00, 0.96, 0.88, 0.76, 0.62, 0.46, 0.30];

  var VEHICLES = [

    /* ------------------------------------------------ 1. Comet Hatch ---- */
    {
      id: 'comet',
      name: 'Comet 1.4',
      klass: 'Compact Hatch',
      blurb: 'Featherweight three-door. Slow in a straight line, hilarious everywhere else, and it folds like paper.',
      mass: 1015,
      length: 3.84, width: 1.67, height: 1.44,
      wheelbase: 2.44, track: 1.43, trackFront: 1.44, trackRear: 1.42,
      frontAxleZ: 1.20, rearAxleZ: -1.24,
      enginePos: 1.42,
      drivetrain: 'fwd',
      rhd: true,
      meshSections: 20,
      stations: [
        st(-1.92, 0.34, 0.60, 0.50, 0.66, 0.84, 0.53, 0.86),
        st(-1.52, 0.30, 0.72, 0.48, 0.80, 0.90, 0.66, 1.26),
        st(-0.92, 0.27, 0.80, 0.47, 0.835, 0.92, 0.70, 1.415),
        st(-0.20, 0.26, 0.82, 0.46, 0.835, 0.92, 0.715, 1.44),
        st(0.52, 0.26, 0.815, 0.46, 0.83, 0.915, 0.70, 1.425),
        st(1.06, 0.27, 0.79, 0.47, 0.815, 0.905, 0.66, 1.28),
        st(1.58, 0.31, 0.72, 0.50, 0.76, 0.855, 0.62, 0.875),
        st(1.92, 0.36, 0.58, 0.54, 0.64, 0.80, 0.50, 0.815)
      ],
      wheel: { radius: 0.298, width: 0.185, rim: 0.187, spokes: 5, mass: 22,
               rimColor: [0.56, 0.58, 0.62] },
      suspension: { frontK: 60000, frontD: 3400, rearK: 40000, rearD: 2600,
                    arbFront: 11000, arbRear: 6000 },
      engine: { peakTorque: 128, redline: 6500, idle: 850, curve: CURVE_NA,
                inertia: 0.16, sound: { base: 46, harmonics: [1, 2, 3, 4.5], growl: 0.25 } },
      gearbox: { final: 4.05, ratios: [-3.55, 0, 3.45, 1.95, 1.28, 0.95, 0.76],
                 shiftTime: 0.34, autoUp: 0.86, autoDown: 0.42 },
      brakes: { maxTorque: 2100, frontBias: 0.66 },
      steering: { maxAngle: 0.62, speedFalloff: 0.55, ratio: 2.6 },
      tyres: { gripLong: 1.18, gripLat: 1.10, stiffnessLong: 14, stiffnessLat: 9.5 },
      aero: { drag: 0.33, lift: -0.05, frontal: 2.10 },
      steeringWheelRadius: 0.172,
      colors: [
        [0.78, 0.20, 0.17], [0.92, 0.92, 0.94], [0.16, 0.36, 0.62],
        [0.20, 0.21, 0.23], [0.86, 0.68, 0.14], [0.35, 0.56, 0.36]
      ]
    },

    /* ----------------------------------------------- 2. Meridian Sedan -- */
    {
      id: 'meridian',
      name: 'Meridian 2.5',
      klass: 'Midsize Saloon',
      blurb: 'The sensible one. Soft springs, long bonnet, and a boot big enough to survive a rear-ender.',
      mass: 1445,
      length: 4.72, width: 1.81, height: 1.46,
      wheelbase: 2.78, track: 1.56, trackFront: 1.57, trackRear: 1.55,
      frontAxleZ: 1.40, rearAxleZ: -1.38,
      enginePos: 1.66,
      drivetrain: 'fwd',
      rhd: true,
      meshSections: 22,
      stations: [
        st(-2.36, 0.33, 0.66, 0.50, 0.74, 0.86, 0.60, 0.885),
        st(-1.92, 0.29, 0.80, 0.48, 0.885, 0.90, 0.72, 0.925),
        st(-1.30, 0.26, 0.875, 0.47, 0.905, 0.915, 0.735, 1.31),
        st(-0.62, 0.25, 0.895, 0.46, 0.905, 0.915, 0.755, 1.455),
        st(0.08, 0.25, 0.895, 0.46, 0.905, 0.915, 0.760, 1.46),
        st(0.72, 0.25, 0.885, 0.46, 0.90, 0.915, 0.735, 1.40),
        st(1.30, 0.27, 0.85, 0.47, 0.875, 0.905, 0.70, 1.02),
        st(1.86, 0.30, 0.78, 0.49, 0.83, 0.87, 0.66, 0.895),
        st(2.36, 0.35, 0.62, 0.53, 0.70, 0.815, 0.55, 0.83)
      ],
      wheel: { radius: 0.324, width: 0.215, rim: 0.206, spokes: 5, mass: 26,
               rimColor: [0.60, 0.62, 0.66] },
      suspension: { frontK: 85000, frontD: 4400, rearK: 57000, rearD: 3500,
                    arbFront: 14000, arbRear: 8000 },
      engine: { peakTorque: 238, redline: 6200, idle: 750, curve: CURVE_NA,
                inertia: 0.22, sound: { base: 40, harmonics: [1, 2, 3, 4, 6], growl: 0.18 } },
      gearbox: { final: 3.62, ratios: [-3.20, 0, 3.30, 2.05, 1.42, 1.03, 0.79, 0.64],
                 shiftTime: 0.30, autoUp: 0.84, autoDown: 0.38 },
      brakes: { maxTorque: 3000, frontBias: 0.64 },
      steering: { maxAngle: 0.58, speedFalloff: 0.52, ratio: 2.7 },
      tyres: { gripLong: 1.20, gripLat: 1.14, stiffnessLong: 15, stiffnessLat: 10.5 },
      aero: { drag: 0.30, lift: -0.08, frontal: 2.24 },
      steeringWheelRadius: 0.182,
      colors: [
        [0.78, 0.79, 0.81], [0.09, 0.10, 0.12], [0.20, 0.30, 0.52],
        [0.55, 0.13, 0.15], [0.30, 0.33, 0.30], [0.86, 0.86, 0.88]
      ]
    },

    /* ------------------------------------------------- 3. Rampage GT ---- */
    {
      id: 'rampage',
      name: 'Rampage GT',
      klass: 'Muscle Coupe',
      blurb: 'Five and a half litres of bad decisions, rear-wheel drive and no electronic help whatsoever.',
      mass: 1655,
      length: 4.92, width: 1.93, height: 1.34,
      wheelbase: 2.82, track: 1.66, trackFront: 1.66, trackRear: 1.68,
      frontAxleZ: 1.42, rearAxleZ: -1.40,
      enginePos: 1.60,
      drivetrain: 'rwd',
      rhd: false,
      meshSections: 22,
      stations: [
        st(-2.46, 0.31, 0.72, 0.46, 0.83, 0.78, 0.68, 0.80),
        st(-2.02, 0.27, 0.86, 0.44, 0.94, 0.815, 0.78, 0.845),
        st(-1.44, 0.24, 0.935, 0.43, 0.965, 0.825, 0.795, 1.17),
        st(-0.76, 0.23, 0.955, 0.42, 0.965, 0.825, 0.775, 1.325),
        st(-0.06, 0.23, 0.955, 0.42, 0.965, 0.825, 0.745, 1.34),
        st(0.66, 0.23, 0.945, 0.42, 0.955, 0.82, 0.70, 1.20),
        st(1.32, 0.25, 0.905, 0.43, 0.935, 0.815, 0.76, 0.855),
        st(1.94, 0.28, 0.83, 0.45, 0.885, 0.79, 0.72, 0.815),
        st(2.46, 0.33, 0.66, 0.50, 0.75, 0.735, 0.60, 0.75)
      ],
      wheel: { radius: 0.352, width: 0.295, rim: 0.245, spokes: 5, mass: 32,
               rimColor: [0.20, 0.21, 0.23] },
      suspension: { frontK: 92000, frontD: 4700, rearK: 76000, rearD: 4200,
                    arbFront: 20000, arbRear: 15000 },
      engine: { peakTorque: 624, redline: 6800, idle: 720, curve: CURVE_V8,
                inertia: 0.34, sound: { base: 28, harmonics: [1, 2, 3, 4, 5, 7], growl: 0.62 } },
      gearbox: { final: 3.31, ratios: [-2.90, 0, 2.66, 1.78, 1.30, 1.00, 0.80, 0.63],
                 shiftTime: 0.22, autoUp: 0.90, autoDown: 0.44 },
      brakes: { maxTorque: 4200, frontBias: 0.60 },
      steering: { maxAngle: 0.54, speedFalloff: 0.62, ratio: 2.4 },
      tyres: { gripLong: 1.34, gripLat: 1.26, stiffnessLong: 17, stiffnessLat: 12 },
      aero: { drag: 0.35, lift: -0.18, frontal: 2.30 },
      steeringWheelRadius: 0.178,
      colors: [
        [0.72, 0.09, 0.08], [0.08, 0.08, 0.09], [0.93, 0.62, 0.05],
        [0.12, 0.26, 0.55], [0.90, 0.90, 0.92], [0.28, 0.52, 0.30]
      ]
    },

    /* -------------------------------------------------- 4. Bighorn 4x4 -- */
    {
      id: 'bighorn',
      name: 'Bighorn 4x4',
      klass: 'Pickup Truck',
      blurb: 'Two and a half tonnes of ladder frame. Slow to stop, impossible to kill, and it wins every argument.',
      mass: 2385,
      length: 5.48, width: 2.02, height: 1.92,
      wheelbase: 3.34, track: 1.72, trackFront: 1.72, trackRear: 1.74,
      frontAxleZ: 1.72, rearAxleZ: -1.62,
      enginePos: 1.96,
      drivetrain: 'awd',
      rhd: false,
      meshSections: 22,
      stations: [
        st(-2.74, 0.52, 0.86, 0.66, 0.95, 1.13, 0.80, 1.15),
        st(-2.10, 0.50, 0.93, 0.65, 1.005, 1.16, 0.85, 1.18),
        st(-1.20, 0.48, 0.955, 0.64, 1.01, 1.17, 0.86, 1.19),
        st(-0.42, 0.46, 0.955, 0.63, 1.01, 1.17, 0.86, 1.20),
        st(-0.10, 0.46, 0.95, 0.63, 1.005, 1.17, 0.85, 1.72),
        st(0.72, 0.46, 0.945, 0.63, 1.00, 1.17, 0.845, 1.90),
        st(1.44, 0.48, 0.92, 0.64, 0.985, 1.16, 0.83, 1.60),
        st(2.10, 0.52, 0.86, 0.68, 0.945, 1.13, 0.80, 1.16),
        st(2.74, 0.58, 0.72, 0.76, 0.82, 1.06, 0.70, 1.08)
      ],
      wheel: { radius: 0.412, width: 0.305, rim: 0.245, spokes: 6, mass: 44,
               rimColor: [0.30, 0.31, 0.33] },
      suspension: { frontK: 118000, frontD: 6600, rearK: 100000, rearD: 5900,
                    arbFront: 22000, arbRear: 11000 },
      engine: { peakTorque: 710, redline: 4600, idle: 650, curve: CURVE_DIESEL,
                inertia: 0.52, sound: { base: 22, harmonics: [1, 2, 3, 5], growl: 0.75 } },
      gearbox: { final: 3.92, ratios: [-3.10, 0, 3.80, 2.20, 1.50, 1.10, 0.85, 0.68],
                 shiftTime: 0.42, autoUp: 0.78, autoDown: 0.34 },
      brakes: { maxTorque: 5200, frontBias: 0.58 },
      steering: { maxAngle: 0.52, speedFalloff: 0.48, ratio: 3.2 },
      tyres: { gripLong: 1.10, gripLat: 0.98, stiffnessLong: 12, stiffnessLat: 8.0 },
      aero: { drag: 0.45, lift: 0.04, frontal: 3.35 },
      steeringWheelRadius: 0.205,
      colors: [
        [0.16, 0.36, 0.26], [0.86, 0.87, 0.89], [0.35, 0.22, 0.13],
        [0.10, 0.11, 0.12], [0.72, 0.26, 0.10], [0.24, 0.38, 0.58]
      ]
    },

    /* ---------------------------------------------------- 5. Vector RS -- */
    {
      id: 'vector',
      name: 'Vector RS',
      klass: 'Mid-engine Sports',
      blurb: 'Engine behind your head, wheels on the outside, and not much between you and the scenery.',
      mass: 1288,
      length: 4.38, width: 1.90, height: 1.18,
      wheelbase: 2.62, track: 1.64, trackFront: 1.62, trackRear: 1.67,
      frontAxleZ: 1.30, rearAxleZ: -1.32,
      enginePos: -0.86,
      drivetrain: 'rwd',
      rhd: false,
      meshSections: 22,
      stations: [
        st(-2.19, 0.26, 0.70, 0.40, 0.82, 0.70, 0.68, 0.715),
        st(-1.76, 0.22, 0.86, 0.38, 0.935, 0.735, 0.79, 0.755),
        st(-1.20, 0.19, 0.93, 0.36, 0.95, 0.745, 0.80, 0.86),
        st(-0.58, 0.18, 0.945, 0.35, 0.95, 0.745, 0.70, 1.175),
        st(0.02, 0.18, 0.945, 0.35, 0.945, 0.74, 0.665, 1.18),
        st(0.58, 0.18, 0.935, 0.35, 0.935, 0.735, 0.70, 0.98),
        st(1.24, 0.19, 0.89, 0.35, 0.90, 0.70, 0.74, 0.715),
        st(1.78, 0.22, 0.80, 0.37, 0.845, 0.645, 0.70, 0.66),
        st(2.19, 0.27, 0.62, 0.42, 0.70, 0.595, 0.58, 0.61)
      ],
      wheel: { radius: 0.338, width: 0.285, rim: 0.248, spokes: 5, mass: 27,
               rimColor: [0.14, 0.14, 0.16] },
      suspension: { frontK: 56000, frontD: 3400, rearK: 76000, rearD: 4100,
                    arbFront: 23000, arbRear: 21000 },
      engine: { peakTorque: 452, redline: 8200, idle: 950, curve: CURVE_TURBO,
                inertia: 0.20, sound: { base: 52, harmonics: [1, 2, 3, 4, 5, 6, 8], growl: 0.32 } },
      gearbox: { final: 3.75, ratios: [-3.00, 0, 3.10, 2.12, 1.58, 1.24, 1.00, 0.82, 0.68],
                 shiftTime: 0.13, autoUp: 0.92, autoDown: 0.46 },
      brakes: { maxTorque: 4400, frontBias: 0.62 },
      steering: { maxAngle: 0.55, speedFalloff: 0.66, ratio: 2.2 },
      tyres: { gripLong: 1.48, gripLat: 1.44, stiffnessLong: 19, stiffnessLat: 14 },
      aero: { drag: 0.32, lift: -0.42, frontal: 1.92 },
      steeringWheelRadius: 0.168,
      colors: [
        [0.86, 0.72, 0.06], [0.70, 0.06, 0.07], [0.06, 0.07, 0.09],
        [0.10, 0.42, 0.66], [0.88, 0.89, 0.91], [0.42, 0.14, 0.52]
      ]
    },

    /* -------------------------------------------------- 6. Sprint Rally - */
    {
      id: 'sprint',
      name: 'Sprint Rally',
      klass: 'Rally Hatch',
      blurb: 'Turbocharged, four driven wheels and a handbrake that actually means something. Built for gravel.',
      mass: 1302,
      length: 4.12, width: 1.79, height: 1.49,
      wheelbase: 2.55, track: 1.56, trackFront: 1.57, trackRear: 1.56,
      frontAxleZ: 1.26, rearAxleZ: -1.29,
      enginePos: 1.48,
      drivetrain: 'awd',
      rhd: true,
      meshSections: 20,
      stations: [
        st(-2.06, 0.36, 0.64, 0.52, 0.72, 0.87, 0.58, 0.895),
        st(-1.64, 0.32, 0.79, 0.50, 0.865, 0.925, 0.71, 1.30),
        st(-1.00, 0.29, 0.865, 0.49, 0.89, 0.935, 0.745, 1.46),
        st(-0.24, 0.28, 0.885, 0.48, 0.895, 0.94, 0.755, 1.485),
        st(0.54, 0.28, 0.88, 0.48, 0.89, 0.935, 0.735, 1.465),
        st(1.12, 0.29, 0.855, 0.49, 0.875, 0.925, 0.70, 1.32),
        st(1.66, 0.33, 0.78, 0.52, 0.82, 0.88, 0.66, 0.90),
        st(2.06, 0.38, 0.62, 0.56, 0.70, 0.825, 0.56, 0.84)
      ],
      wheel: { radius: 0.318, width: 0.225, rim: 0.203, spokes: 8, mass: 25,
               rimColor: [0.75, 0.76, 0.24] },
      suspension: { frontK: 78000, frontD: 4300, rearK: 53000, rearD: 3400,
                    arbFront: 16000, arbRear: 13000 },
      engine: { peakTorque: 398, redline: 7200, idle: 950, curve: CURVE_TURBO,
                inertia: 0.19, sound: { base: 44, harmonics: [1, 2, 3, 4, 5.5], growl: 0.40 } },
      gearbox: { final: 4.10, ratios: [-3.40, 0, 3.25, 2.10, 1.55, 1.18, 0.94, 0.78],
                 shiftTime: 0.16, autoUp: 0.90, autoDown: 0.46 },
      brakes: { maxTorque: 3800, frontBias: 0.62 },
      steering: { maxAngle: 0.66, speedFalloff: 0.58, ratio: 2.3 },
      tyres: { gripLong: 1.30, gripLat: 1.22, stiffnessLong: 16, stiffnessLat: 11 },
      aero: { drag: 0.36, lift: -0.22, frontal: 2.16 },
      steeringWheelRadius: 0.170,
      colors: [
        [0.10, 0.28, 0.66], [0.90, 0.91, 0.93], [0.82, 0.30, 0.04],
        [0.09, 0.09, 0.10], [0.62, 0.72, 0.16], [0.68, 0.10, 0.28]
      ]
    }
  ];

  // Derived headline figures for the garage screen.
  VEHICLES.forEach(function (v) {
    var peakKW = 0;
    var steps = v.engine.curve.length;
    for (var i = 0; i < steps; i++) {
      var rpm = v.engine.idle + (v.engine.redline - v.engine.idle) * (i / (steps - 1));
      var tq = v.engine.peakTorque * v.engine.curve[i];
      var kw = tq * rpm * 2 * Math.PI / 60 / 1000;
      if (kw > peakKW) peakKW = kw;
    }
    v.stats = {
      powerKW: Math.round(peakKW),
      powerBHP: Math.round(peakKW * 1.34102),
      torque: Math.round(v.engine.peakTorque),
      mass: v.mass,
      powerToWeight: Math.round(peakKW * 1000 / v.mass),
      drivetrain: v.drivetrain.toUpperCase(),
      // Drag power rises with the cube of speed, so the terminal velocity
      // is a cube root — the square root form was out by a factor of six.
      topSpeedKph: Math.round(Math.cbrt(
        (2 * peakKW * 1000 * 0.82) / (1.225 * v.aero.drag * v.aero.frontal)
      ) * 3.6)
    };
  });

  B.VEHICLES = VEHICLES;
  B.getVehicleSpec = function (id) {
    for (var i = 0; i < VEHICLES.length; i++) if (VEHICLES[i].id === id) return VEHICLES[i];
    return VEHICLES[0];
  };

})();
