/* =========================================================================
   BeamDrive Mobile — coherent noise
   Classic Perlin with a seedable permutation table, plus fBm/ridged helpers
   used by terrain generation, procedural textures and camera shake.
   ========================================================================= */
(function () {
  'use strict';

  function Noise(seed) {
    var rnd = B.M.rng(seed || 1337);
    var p = new Uint8Array(512);
    var perm = new Uint8Array(256);
    var i, j, t;
    for (i = 0; i < 256; i++) perm[i] = i;
    for (i = 255; i > 0; i--) {
      j = (rnd() * (i + 1)) | 0;
      t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (i = 0; i < 512; i++) p[i] = perm[i & 255];
    this.p = p;
  }

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

  function grad2(hash, x, y) {
    switch (hash & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }

  function grad3(hash, x, y, z) {
    var h = hash & 15;
    var u = h < 8 ? x : y;
    var v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  Noise.prototype.n2 = function (x, y) {
    var p = this.p;
    var X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    var u = fade(x), v = fade(y);
    var A = p[X] + Y, B2 = p[X + 1] + Y;
    var n00 = grad2(p[A], x, y);
    var n10 = grad2(p[B2], x - 1, y);
    var n01 = grad2(p[A + 1], x, y - 1);
    var n11 = grad2(p[B2 + 1], x - 1, y - 1);
    var nx0 = n00 + u * (n10 - n00);
    var nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 0.7;
  };

  Noise.prototype.n3 = function (x, y, z) {
    var p = this.p;
    var X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    var u = fade(x), v = fade(y), w = fade(z);
    var A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    var B2 = p[X + 1] + Y, BA = p[B2] + Z, BB = p[B2 + 1] + Z;
    function lerp(a, b, t) { return a + t * (b - a); }
    return lerp(
      lerp(
        lerp(grad3(p[AA], x, y, z), grad3(p[BA], x - 1, y, z), u),
        lerp(grad3(p[AB], x, y - 1, z), grad3(p[BB], x - 1, y - 1, z), u), v),
      lerp(
        lerp(grad3(p[AA + 1], x, y, z - 1), grad3(p[BA + 1], x - 1, y, z - 1), u),
        lerp(grad3(p[AB + 1], x, y - 1, z - 1), grad3(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  };

  // Fractal Brownian motion — the bread and butter of the terrain shapes.
  Noise.prototype.fbm2 = function (x, y, octaves, lacunarity, gain) {
    octaves = octaves || 4;
    lacunarity = lacunarity || 2.0;
    gain = gain === undefined ? 0.5 : gain;
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var i = 0; i < octaves; i++) {
      sum += this.n2(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  };

  // Ridged multifractal — gives mountain ridges sharp crests.
  Noise.prototype.ridged2 = function (x, y, octaves, lacunarity, gain) {
    octaves = octaves || 4;
    lacunarity = lacunarity || 2.0;
    gain = gain === undefined ? 0.5 : gain;
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var i = 0; i < octaves; i++) {
      var n = 1 - Math.abs(this.n2(x * freq, y * freq));
      n *= n;
      sum += n * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  };

  Noise.prototype.fbm3 = function (x, y, z, octaves) {
    octaves = octaves || 4;
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var i = 0; i < octaves; i++) {
      sum += this.n3(x * freq, y * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };

  B.Noise = Noise;
  B.noise = new Noise(20260915);
})();
