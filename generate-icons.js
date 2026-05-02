// Run with: node generate-icons.js
const { createCanvas } = require('canvas');
const fs = require('fs');

function makeIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Achtergrond
  ctx.fillStyle = '#2563eb';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.2);
  ctx.fill();

  // Locatie-pin symbool
  const cx = size / 2, cy = size * 0.42, r = size * 0.22;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2563eb';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.55, cy + r * 0.2);
  ctx.lineTo(cx + r * 0.55, cy + r * 0.2);
  ctx.closePath();
  ctx.fill();

  // Route lijntje onderaan
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.06;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.2, size * 0.78);
  ctx.lineTo(size * 0.8, size * 0.78);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

fs.writeFileSync('icon-192.png', makeIcon(192));
fs.writeFileSync('icon-512.png', makeIcon(512));
console.log('Iconen aangemaakt: icon-192.png en icon-512.png');
