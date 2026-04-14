// Generate the app icon for QNSub Screen Recorder.
//
// Produces:
//   build/icon.svg  — the vector source (editable by hand)
//   build/icon.png  — 1024×1024 master PNG (used by electron-builder)
//   build/icon.ico  — multi-resolution ICO for Windows
//   tray-icon.png   — 256×256 tray icon (overwrites the old flat red one)
//
// Run with: `node scripts/make-icon.mjs`.

import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const buildDir = resolve(root, 'build');
mkdirSync(buildDir, { recursive: true });

// Icon design: a rounded-square "chip" in a bold gradient (red →
// magenta) with a stylised viewfinder / aperture mark in the middle.
// Reads as a recording app at every size from 16×16 to 1024×1024.
// Tuned for the Windows 11 and macOS home screen grids where icons
// sit on a light background — the drop shadow keeps it crisp on
// both light and dark surfaces.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#FF3D5A"/>
      <stop offset="55%" stop-color="#E11D48"/>
      <stop offset="100%" stop-color="#9F1239"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.35" cy="0.28" r="0.8">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="22"/>
      <feOffset dx="0" dy="18"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <g filter="url(#shadow)">
    <!-- Rounded-square body (iOS/macOS 22% squircle ratio). -->
    <rect x="64" y="64" width="896" height="896" rx="224" ry="224" fill="url(#body)"/>
    <!-- Specular highlight sweep top-left for a subtle 3D feel. -->
    <rect x="64" y="64" width="896" height="896" rx="224" ry="224" fill="url(#glow)"/>

    <!-- Camcorder glyph — large, centred, simple. One body rectangle
         with a small lens circle; a triangular viewfinder lens hood on
         the right edge makes it unmistakably a camera at tiny sizes. -->
    <g fill="#ffffff">
      <!-- Main body: rounded rectangle, centred horizontally. -->
      <rect x="232" y="360" width="440" height="304" rx="56" ry="56"/>
      <!-- Lens hood: right-pointing trapezoid protruding from the body. -->
      <path d="M 672 430
               L 820 370
               a 24 24 0 0 1 34 22
               v 240
               a 24 24 0 0 1 -34 22
               l -148 -60 z"/>
    </g>

    <!-- Dark lens dot inside the body to add focal depth. -->
    <circle cx="452" cy="512" r="64" fill="#9F1239"/>
    <circle cx="452" cy="512" r="32" fill="#FF3D5A"/>
  </g>
</svg>
`;

const svgPath = resolve(buildDir, 'icon.svg');
writeFileSync(svgPath, svg);
console.log('wrote', svgPath);

// Master PNG at 1024×1024. electron-builder will use this to
// auto-generate the .icns for macOS. For Windows we also build our
// own multi-res .ico below.
const master = await sharp(Buffer.from(svg)).resize(1024, 1024).png().toBuffer();
writeFileSync(resolve(buildDir, 'icon.png'), master);
console.log('wrote build/icon.png (1024×1024)');

// Multi-resolution ICO for Windows. Sizes cover taskbar, Start menu,
// File Explorer, jump list, and the Settings → Apps list.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(
  icoSizes.map((s) => sharp(Buffer.from(svg)).resize(s, s).png().toBuffer())
);
const icoBuffer = await pngToIco(pngBuffers);
writeFileSync(resolve(buildDir, 'icon.ico'), icoBuffer);
console.log('wrote build/icon.ico (sizes:', icoSizes.join(', ') + ')');

// Tray icon — a smaller variant used by Tray in the main process.
// The tray API expects a square PNG; 256 is fine on all platforms.
const tray = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
writeFileSync(resolve(root, 'tray-icon.png'), tray);
console.log('wrote tray-icon.png (256×256)');

console.log('done.');
