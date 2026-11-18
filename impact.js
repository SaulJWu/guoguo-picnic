const TAU = Math.PI * 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const random = (a, b) => a + Math.random() * (b - a);

// Clip a strip between two distances along the normal to the finger's stroke.
function clipStrip(ctx, ux, uy, a, b, reach) {
  const nx = -uy, ny = ux;
  ctx.beginPath();
  ctx.moveTo(nx*a - ux*reach, ny*a - uy*reach);
  ctx.lineTo(nx*a + ux*reach, ny*a + uy*reach);
  ctx.lineTo(nx*b + ux*reach, ny*b + uy*reach);
  ctx.lineTo(nx*b - ux*reach, ny*b - uy*reach);
  ctx.closePath();
  ctx.clip();
}

function cutPiece(target, ux, uy, offset, side, span) {
  const {fruit, size} = target;
  const density = Math.min(devicePixelRatio || 1, 2);
  const tile = document.createElement("canvas");
  tile.width = tile.height = Math.ceil(span * density);
  const ctx = tile.getContext("2d");
  ctx.scale(tile.width / span, tile.height / span);
  ctx.translate(span / 2, span / 2);
  clipStrip(ctx, ux, uy, offset, side * span, span);
  if (!fruit.image.naturalWidth) return tile;

  ctx.save();
  ctx.rotate(target.angle * Math.PI / 180);
  const scale = size / Math.max(fruit.image.naturalWidth, fruit.image.naturalHeight);
  const w = fruit.image.naturalWidth * scale, h = fruit.image.naturalHeight * scale;
  ctx.drawImage(fruit.image, -w/2, -h/2, w, h);
  ctx.restore();

  // The flesh and rind end at the original silhouette and follow the same cut.
  ctx.globalCompositeOperation = "source-atop";
  const depth = size * (side > 0 ? .16 : .115);
  clipStrip(ctx, ux, uy, offset, offset + side * depth, span);
  ctx.rotate(Math.atan2(uy, ux));
  ctx.fillStyle = fruit.juice;
  ctx.fillRect(-span, -span, span*2, span*2);
  const inside = fruit.cut;
  if (inside.naturalWidth) {
    const iw = inside.naturalWidth, ih = inside.naturalHeight;
    const top = side > 0 ? offset : offset - depth;
    ctx.drawImage(inside, iw*.16, ih*.33, iw*.68, ih*.38, -size*.56, top - depth*.1, size*1.12, depth*1.2);
  }
  ctx.fillStyle = "#fff5c9";
  ctx.fillRect(-span, offset - size*.013, 2*span, size*.026);
  return tile;
}

export function buildImpact(target, stroke, born, gentle, chain) {
  const ux = Math.cos(stroke.angle), uy = Math.sin(stroke.angle);
  const nx = -uy, ny = ux;
  const {size, fruit, x, y} = target;
  const offset = clamp((stroke.x - x)*nx + (stroke.y - y)*ny, -size*.29, size*.29);
  const span = Math.ceil(size * 1.52);
  const bomb = Boolean(fruit.bomb);
  const pieces = bomb ? [] : [-1, 1].map(side => cutPiece(target, ux, uy, offset, side, span));
  const bits = [];
  const count = gentle ? 5 : bomb ? 11 : 19;
  for (let i = 0; i < count; i++) {
    const angle = i * TAU / count + random(-.23, .23);
    const burst = random(.55, 1.65) * size * (gentle ? .45 : 1.35);
    bits.push({
      dx: Math.cos(angle) * burst, dy: Math.sin(angle) * burst - size*.30,
      r: random(.021, .054) * size, spin: random(-4, 4), phase: random(0, 6), variant: i % 4
    });
  }
  return { x, y, size, fruit, ux, uy, nx, ny, offset, angle: stroke.angle, pieces, span, bits, born, gentle, bomb, chain, points: bomb ? -1 : 2 };
}

function star(ctx, x, y, r, turn) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(turn);
  ctx.beginPath(); ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r*.14, -r*.14, r, 0);
  ctx.quadraticCurveTo(r*.14, r*.14, 0, r);
  ctx.quadraticCurveTo(-r*.14, r*.14, -r, 0);
  ctx.quadraticCurveTo(-r*.14, -r*.14, 0, -r);
  ctx.fill(); ctx.restore();
}

function drawFruitImpact(ctx, hit, t) {
  const {size, gentle, ux, uy, nx, ny} = hit;
  const flight = Math.max(0, t - .047);
  const fade = clamp((.94 - t) / .38, 0, 1);
  const spread = size * (gentle ? .18 : .65) * (1 - Math.exp(-5.7*flight)) + flight*(gentle ? 0 : 19);
  const fall = gentle ? 0 : size * (-.64*flight + 1.86*flight*flight);
  for (const [i, side] of [-1, 1].entries()) {
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(hit.x + nx*side*spread + ux*flight*11, hit.y + ny*side*spread + uy*flight*11 + fall);
    ctx.rotate(side * flight * (gentle ? .12 : .85));
    ctx.drawImage(hit.pieces[i], -hit.span/2, -hit.span/2, hit.span, hit.span);
    ctx.restore();
  }

  const sx = hit.x + nx*hit.offset, sy = hit.y + ny*hit.offset;
  for (const bit of hit.bits) {
    ctx.globalAlpha = clamp(1 - t/.64, 0, 1);
    const x = sx + bit.dx*t, y = sy + bit.dy*t + 120*t*t;
    ctx.fillStyle = bit.variant === 0 ? "#fffdd8" : bit.variant === 1 ? "#ffd85b" : hit.fruit.juice;
    if (bit.variant === 0) star(ctx, x, y, bit.r*1.55, bit.phase + bit.spin*t);
    else {
      ctx.beginPath(); ctx.ellipse(x, y, bit.r*1.27, bit.r*.78, bit.phase + bit.spin*t, 0, TAU); ctx.fill();
    }
  }
  if (t < .22) {
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(hit.angle);
    ctx.globalAlpha = 1 - t/.22;
    const reach = size * (.51 + .42 * Math.min(1, t/.11));
    const wide = size * .041 * (1 - t/.22);
    ctx.fillStyle = "#f5bf4d";
    ctx.beginPath(); ctx.moveTo(-reach, 0); ctx.lineTo(-reach*.18, -wide*1.6); ctx.lineTo(reach, 0); ctx.lineTo(reach*.05, wide*1.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fffef0";
    ctx.beginPath(); ctx.moveTo(-reach*1.05, 0); ctx.lineTo(-reach*.18, -wide*.86); ctx.lineTo(reach*1.1, 0); ctx.lineTo(reach*.05, wide*.86); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function drawPuff(ctx, hit, t) {
  const {x, y, size, gentle} = hit;
  const fade = clamp((.86 - t)/.40, 0, 1);
  const swell = 1 - Math.exp(-6.8*t);
  ctx.save();
  ctx.globalAlpha = fade;
  for (const bit of hit.bits) {
    const dx = bit.dx*.25*swell, dy = bit.dy*.22*swell;
    const px = x + dx, py = y + dy - (gentle ? 4 : 25)*t;
    const rad = size*(.10 + .13*swell) + bit.r;
    if (bit.variant === 0) {
      ctx.fillStyle = "#ffd65a";
      star(ctx, x+dx*1.95, y+dy*2.1, rad*.5, bit.phase);
    } else {
      ctx.fillStyle = ["#c8c6d5", "#b3afc6", "#dedbe5", "#f1edec"][bit.variant];
      ctx.beginPath(); ctx.arc(px, py, rad, 0, TAU); ctx.fill();
    }
  }
  if (t < .26) {
    ctx.globalAlpha = (1-t/.26)*.88;
    ctx.lineWidth = 2.6; ctx.strokeStyle = "#fff4c8";
    ctx.beginPath(); ctx.arc(x, y, size*(.26 + swell*.36), 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

export function drawImpact(ctx, hit, now) {
  const t = (now - hit.born)/1000;
  ctx.save();
  if (hit.bomb) drawPuff(ctx, hit, t);
  else drawFruitImpact(ctx, hit, t);
  const fade = clamp((.97-t)/.30, 0, 1);
  ctx.globalAlpha = fade;
  const pop = hit.gentle ? 1 : 1 + Math.sin(Math.min(1,t/.19)*Math.PI)*.19;
  const label = hit.points === 0 ? "0 分" : hit.points > 0 ? "+" + hit.points : "−" + Math.abs(hit.points);
  const font = Math.round(clamp(hit.size*.30, 29, 48)*pop);
  const y = Math.max(font+4, hit.y - hit.size*.36 - t*(hit.gentle ? 7 : 53));
  ctx.font = "900 " + font + "px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.lineJoin = "round"; ctx.lineWidth = 7;
  ctx.strokeStyle = "#fff8d9"; ctx.fillStyle = hit.bomb ? "#73516e" : "#265c36";
  ctx.strokeText(label, hit.x, y); ctx.fillText(label, hit.x, y);
  if (hit.chain > 1 && !hit.bomb) {
    ctx.font = "800 16px system-ui, sans-serif"; ctx.lineWidth = 4;
    const chainLabel = hit.chain + " 连切";
    ctx.strokeText(chainLabel, hit.x, y+22); ctx.fillText(chainLabel, hit.x, y+22);
  }
  ctx.restore();
}
