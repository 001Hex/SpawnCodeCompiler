#!/usr/bin/env node
/* =========================================================================
   BeamDrive Mobile — build
   Produces two things from the same sources:

     dist/index.html   installable PWA (manifest + service worker + icons)
     BeamDrive.html    one self-contained file, no network access at all

   No bundler, no dependencies: the sources are plain scripts sharing one
   global, concatenated in filename order.
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { makeIcon } = require('./png.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const WEB = path.join(ROOT, 'web');
const DIST = path.join(ROOT, 'dist');
/* GitHub Pages, deploying from a branch, only offers "/" or "/docs" as the
   publish folder — it cannot serve a nested path like /beamdrive/dist. So the
   same PWA build is mirrored into <repo>/docs, which Pages can serve. */
const DOCS = path.resolve(ROOT, '..', 'docs');

const pkgVersion = '1.0.0';

function log(...a) { console.log('[build]', ...a); }

/* ------------------------------------------------------------ concatenate */
function bundleScripts() {
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort();
  log('bundling', files.length, 'modules:', files.join(', '));
  const parts = [
    '/* BeamDrive Mobile v' + pkgVersion + ' — generated bundle, do not edit.',
    '   Sources live in beamdrive/src/ and are concatenated in filename order. */',
    '(function(){',
    '"use strict";',
    'var B = {};',
    'if (typeof window !== "undefined") window.BeamDrive = B;'
  ];
  for (const f of files) {
    let code = fs.readFileSync(path.join(SRC, f), 'utf8');
    // The first module declares B; every module then closes over the same one.
    code = code.replace(/^var B = \(typeof B !== 'undefined'\) \? B : \{\};\s*$/m, '');
    parts.push('\n/* ================= ' + f + ' ================= */\n');
    parts.push(code);
  }
  parts.push('\n})();\n');
  return parts.join('\n');
}

/* --------------------------------------------------------------- minify
   A conservative squeeze: strip full-line comments and leading indentation.
   Deliberately does NOT touch string or template literal contents, so the
   GLSL that lives in string arrays comes through untouched.               */
function squeeze(src) {
  const out = [];
  let inBlock = false;
  for (let line of src.split('\n')) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) { inBlock = false; }
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    if (t.startsWith('//')) continue;
    if (t === '') continue;
    out.push(t);
  }
  return out.join('\n');
}

/* --------------------------------------------------------------- assemble */
function buildHtml(opts) {
  const template = fs.readFileSync(path.join(WEB, 'index.template.html'), 'utf8');
  const css = fs.readFileSync(path.join(WEB, 'style.css'), 'utf8');
  let js = bundleScripts();
  if (opts.minify) js = squeeze(js);

  // Guard: a stray </script> inside the bundle would close the tag early.
  if (/<\/script/i.test(js)) {
    js = js.replace(/<\/script/gi, '<\\/script');
  }

  return template
    .replace('<!--HEAD_EXTRA-->', opts.headExtra || '')
    .replace('/*STYLES*/', opts.minify ? squeezeCss(css) : css)
    .replace('/*SCRIPTS*/', js);
}

function squeezeCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\n+/g, '\n')
    .trim();
}

/* ------------------------------------------------------------------ main */
function main() {
  const minify = !process.argv.includes('--no-minify');
  fs.mkdirSync(DIST, { recursive: true });

  // ---- icons -------------------------------------------------------------
  const icon180 = makeIcon(180);
  const icon192 = makeIcon(192);
  const icon512 = makeIcon(512);
  fs.writeFileSync(path.join(DIST, 'icon-180.png'), icon180);
  fs.writeFileSync(path.join(DIST, 'icon-192.png'), icon192);
  fs.writeFileSync(path.join(DIST, 'icon-512.png'), icon512);
  log('icons written');

  // ---- PWA build ---------------------------------------------------------
  const pwaHead = [
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="icon-180.png">',
    '<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">'
  ].join('\n');
  const pwaHtml = buildHtml({ minify, headExtra: pwaHead });
  fs.writeFileSync(path.join(DIST, 'index.html'), pwaHtml);
  log('dist/index.html', (pwaHtml.length / 1024).toFixed(1) + ' KB');

  const manifest = {
    name: 'BeamDrive Mobile',
    short_name: 'BeamDrive',
    description: 'A soft-body crash driving sim that runs entirely in the browser.',
    start_url: './index.html',
    scope: './',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'landscape',
    background_color: '#0a0b0e',
    theme_color: '#0a0b0e',
    categories: ['games'],
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
  fs.writeFileSync(path.join(DIST, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

  // Cache-first service worker: after one visit the game runs with no network.
  const sw = `/* BeamDrive Mobile service worker — cache-first, offline capable. */
const CACHE = 'beamdrive-v${pkgVersion}';
const ASSETS = ['./', './index.html', './manifest.webmanifest',
                './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
`;
  fs.writeFileSync(path.join(DIST, 'sw.js'), sw);

  // Register the worker only in the PWA build — it cannot run from file://.
  const withSW = pwaHtml.replace('</body>',
    `<script>
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  });
}
</script>
</body>`);
  fs.writeFileSync(path.join(DIST, 'index.html'), withSW);

  // ---- single-file build -------------------------------------------------
  const iconDataURI = 'data:image/png;base64,' + icon180.toString('base64');
  const soloHead = [
    '<link rel="apple-touch-icon" href="' + iconDataURI + '">',
    '<link rel="icon" type="image/png" href="' + iconDataURI + '">'
  ].join('\n');
  const soloHtml = buildHtml({ minify, headExtra: soloHead });
  const soloPath = path.join(ROOT, 'BeamDrive.html');
  fs.writeFileSync(soloPath, soloHtml);
  log('BeamDrive.html', (soloHtml.length / 1024).toFixed(1) + ' KB (self-contained)');

  // ---- sanity checks -----------------------------------------------------
  const problems = [];
  if (/https?:\/\/(?!www\.w3\.org)/.test(soloHtml.replace(/https:\/\/claude\.ai[^\s"']*/g, ''))) {
    const m = soloHtml.match(/https?:\/\/(?!www\.w3\.org)[^\s"'<>)]+/g) || [];
    const external = m.filter(u => !u.includes('w3.org'));
    if (external.length) problems.push('external URLs found: ' + [...new Set(external)].slice(0, 5).join(', '));
  }
  if (soloHtml.includes('/*SCRIPTS*/')) problems.push('script placeholder not replaced');
  if (soloHtml.includes('/*STYLES*/')) problems.push('style placeholder not replaced');
  if (problems.length) {
    console.error('[build] WARNING:\n  - ' + problems.join('\n  - '));
  } else {
    log('self-contained check passed — no runtime network requests');
  }

  // ---- mirror the PWA build into <repo>/docs for GitHub Pages ----------
  fs.mkdirSync(DOCS, { recursive: true });
  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js',
                   'icon-180.png', 'icon-192.png', 'icon-512.png']) {
    fs.copyFileSync(path.join(DIST, f), path.join(DOCS, f));
  }
  // Pages runs Jekyll by default, which skips files starting with an
  // underscore and can mangle things; this opts out.
  fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');
  log('docs/ mirrored for GitHub Pages');

  log('done');
}

main();
