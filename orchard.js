import { buildImpact, drawImpact, takeChasePiece } from "./impact.js?v=2";

const definitions = [
  ["watermelon", "西瓜", "#e9efd8", "#cfd9b8", "#f46159", -9, 392],
  ["strawberry", "草莓", "#f9e6e0", "#e9cfc6", "#f16559", 7, 440],
  ["orange", "橙子", "#ffecd0", "#e7d5b2", "#ffaf38", -7, 494],
  ["banana", "香蕉", "#faf1c9", "#e5dba9", "#ffdc54", -8, 523],
  ["grapes", "葡萄", "#eee6f1", "#d8cbe0", "#ab73be", 6, 587],
  ["pear", "梨", "#e8eed7", "#d0dbb7", "#b3d555", 8, 659]
];

function sprite(path) {
  const image = new Image();
  image.src = "./assets/" + path + ".webp";
  return image;
}

export const fruits = definitions.map(([id, name, card, edge, juice, tilt, note]) => ({
  id, name, card, edge, juice, tilt, note, image: sprite(id), cut: sprite(id + "-cut")
}));
export const bomb = {id: "bomb", name: "炸弹", bomb: true, image: sprite("bomb")};

const between = (low, high) => low + Math.random() * (high - low);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const chaseDuration = 1800;

function paceForScore(score) {
  // Reach 1.5× at 20 points and approach 2× gradually for small hands.
  return 1 + score / (score + 20);
}

function shuffled(items) {
  const ordered = [...items];
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  return ordered;
}

function contact(target, a, b) {
  const {x, y, size} = target;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? clamp(((x - a.x) * dx + (y - a.y) * dy) / length, 0, 1) : 0;
  const distance = Math.hypot(x - a.x - dx*t, y - a.y - dy*t);
  // Forgive near misses on fruit. The bomb only responds closer to its body.
  const radius = target.fruit.bomb ? size*.35 : size*.48 + Math.min(12, size*.12);
  return distance <= radius ? {target, t, distance} : null;
}

function canFollow(chase, stroke, from, point) {
  if (!chase || chase.origin !== stroke || chase.turned) return true;
  const {cut, ux, uy, nx, ny} = chase;
  const dx = point.x - cut.x, dy = point.y - cut.y;
  const advance = dx*ux + dy*uy;
  const previous = (from.x - cut.x)*ux + (from.y - cut.y)*uy;
  chase.furthest = Math.max(chase.furthest, previous, advance);
  // A straight follow-through stays one cut. Moving off that line or back along it is a new pass.
  chase.turned = Math.abs(dx*nx + dy*ny) >= 13 || chase.furthest - advance >= 10;
  return chase.turned;
}

export class FruitRound {
  constructor(field, layer, canvas, message, onHit, getScore) {
    this.field = field;
    this.layer = layer;
    this.canvas = canvas;
    this.pen = canvas.getContext("2d");
    this.message = message;
    this.onHit = onHit;
    this.getScore = getScore;
    this.state = "home";
    this.active = [];
    this.pending = [];
    this.cuts = [];
    this.trails = [];
    this.pointers = new Map();
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.tick = this.tick.bind(this);
    this.resize = this.resize.bind(this);
    new ResizeObserver(this.resize).observe(field);
    field.addEventListener("pointerdown", event => this.beginStroke(event));
    field.addEventListener("pointermove", event => this.moveStroke(event));
    field.addEventListener("pointerup", event => this.endStroke(event));
    for (const type of ["pointercancel", "lostpointercapture"]) {
      field.addEventListener(type, event => this.pointers.delete(event.pointerId));
    }
  }

  start(first = fruits[0]) {
    this.stop();
    this.field.hidden = false;
    this.state = "playing";
    this.flightTime = 0;
    this.effectTime = 0;
    this.freezeUntil = 0;
    this.hits = 0;
    this.wave = 1;
    this.rainUntil = 0;
    this.messageUntil = 0;
    this.preferred = null;
    this.bag = shuffled(fruits.filter(fruit => fruit !== first));
    this.resize();
    this.throwFruit(first, {middle: .5, apex: .35, scale: 1.12});
    this.nextLaunch = 3270;
    this.restartClock();
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.state = "home";
    this.active.length = this.cuts.length = this.trails.length = 0;
    this.pending.length = 0;
    this.pointers.clear();
    this.layer.replaceChildren();
    this.pen.clearRect(0, 0, this.width || 0, this.height || 0);
    this.field.hidden = true;
    this.message.hidden = true;
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    cancelAnimationFrame(this.frame);
    this.pointers.clear();
    this.trails.length = 0;
    this.paintEffects();
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.restartClock();
  }

  restartClock() {
    this.lastFrame = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  queueNext(fruit) {
    this.preferred = fruit;
    this.nextLaunch = Math.min(this.nextLaunch, this.flightTime + 220);
  }

  resize() {
    const width = this.field.clientWidth;
    const height = this.field.clientHeight;
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * density);
    this.canvas.height = Math.round(height * density);
    this.pen.setTransform(density, 0, 0, density, 0, 0);
    this.active.forEach(target => this.position(target));
    this.paintEffects();
  }

  drawFruit() {
    if (!this.bag.length) this.bag = shuffled(fruits);
    return this.bag.shift();
  }

  scheduleWave() {
    if (this.preferred) {
      this.throwFruit(this.preferred, {middle: .5, apex: .35});
      this.bag = this.bag.filter(fruit => fruit !== this.preferred);
      this.preferred = null;
      this.nextLaunch = this.flightTime + 3050;
      return;
    }
    const pattern = this.wave++ % 5;
    if (pattern === 0) {
      this.throwFruit(fruits[0], {middle: .5, apex: .35, scale: 1.12});
      this.nextLaunch = this.flightTime + 3250;
    } else if (pattern === 1 || pattern === 4) {
      const diagonal = pattern === 4;
      const mirror = Math.floor((this.wave - 1) / 5) % 2 === 1;
      for (let i = 0; i < 3; i++) {
        const lane = i - 1;
        this.scheduleThrow(this.drawFruit(), 45 * i, {
          middle: .5 + (mirror ? -lane : lane) * .27,
          apex: diagonal ? .40 - lane*.12 : .40 - lane*.014,
          travel: -lane*.085, scale: .87, duration: 3500, tilt: 0, spin: 28
        });
      }
      if (diagonal) this.scheduleBomb(mirror ? .62 : .38, .65);
      this.nextLaunch = this.flightTime + 3630;
    } else {
      const middle = pattern === 2 ? .33 : .66;
      this.throwFruit(this.drawFruit(), {middle});
      if (pattern === 3) this.scheduleBomb(.28, .49);
      this.nextLaunch = this.flightTime + (pattern === 2 ? 2610 : 3190);
    }
  }

  scheduleBomb(middle, apex) {
    if (this.pending.some(throwing => throwing.fruit.bomb) || this.active.some(target => target.fruit.bomb)) return;
    this.scheduleThrow(bomb, 240, {middle, apex, scale: .74, duration: 3200});
  }

  scheduleThrow(fruit, delay, flight) {
    this.pending.push({fruit, at: this.flightTime + delay, flight});
  }

  releaseThrows() {
    const due = this.pending.filter(throwing => this.flightTime >= throwing.at);
    this.pending = this.pending.filter(throwing => this.flightTime < throwing.at);
    for (const {fruit, flight} of due) this.throwFruit(fruit, flight);
  }

  throwFruit(fruit, flight) {
    const image = fruit.image.cloneNode();
    image.alt = "";
    image.draggable = false;
    this.addTarget({
      fruit, born: this.flightTime, duration: between(3770, 4280),
      travel: between(-.18, .18), apex: between(.31, .43),
      scale: between(.94, 1.06), tilt: between(-22, 22), spin: between(-46, 46),
      ...flight
    }, image);
  }

  addTarget(target, image) {
    const {fruit, chase} = target;
    const button = document.createElement("button");
    button.type = "button";
    button.className = chase ? "air-fruit chase-piece" : "air-fruit";
    const label = chase ? "再切发亮的西瓜片" : fruit.bomb ? "炸弹，碰到扣 1 分" : "切开" + fruit.name;
    button.setAttribute("aria-label", label);
    button.dataset.fruit = fruit.id;
    if (chase) image.setAttribute("aria-hidden", "true");
    button.append(image);
    button.addEventListener("click", event => {
      // Keyboard and assistive clicks do not have a pointer stroke.
      if (event.detail === 0 && this.state === "playing") this.tapTarget(target);
    });
    target.button = button;
    this.active.push(target);
    this.position(target);
    this.layer.append(button);
  }

  position(target) {
    const {chase} = target;
    const t = clamp(((chase ? this.effectTime : this.flightTime) - target.born) / target.duration, 0, 1);
    const size = clamp(Math.min(this.width*.205, this.height*.32), 58, 168) * target.scale;
    let x, y, angle;
    if (chase) {
      const separation = size*.60 * (1 - (1 - t)**3);
      x = chase.middle*this.width + chase.side*chase.nx*separation;
      y = chase.apex*this.height + chase.side*chase.ny*separation - size*.26*Math.sin(t*Math.PI) + this.height*.27*t*t;
      y = clamp(y, 48 + size*.46, this.height - size*.56);
      angle = chase.side * 24 * t;
    } else {
      const bottom = this.height + size*.55;
      const apex = Math.max(54 + size*.48, this.height*target.apex);
      x = (target.middle + target.travel*(t - .5))*this.width;
      // A constant-gravity arc starts and ends just below the grass.
      y = bottom - 4*(bottom - apex)*t*(1 - t);
      angle = target.tilt + target.spin*(t - .5);
    }
    if (target.size !== size) {
      target.button.style.width = size + "px";
      target.button.style.height = size + "px";
    }
    target.size = size;
    target.x = clamp(x, size*.56, this.width - size*.56);
    target.y = y;
    target.angle = angle;
    target.button.style.transform = "translate3d(" + (target.x - size/2) + "px," + (y - size/2) + "px,0) rotate(" + angle + "deg)";
  }

  say(text, kind, duration) {
    this.message.dataset.kind = kind;
    this.message.hidden = false;
    this.message.textContent = text;
    this.messageUntil = this.effectTime + duration;
  }

  launchChase(impact, line, stroke, originalScale) {
    const piece = takeChasePiece(impact);
    if (!piece) return false;
    const {image, x, y, side, size} = piece;
    const chase = {
      image, side, origin: stroke, cut: line, furthest: 0, turned: false,
      middle: x/this.width, apex: y/this.height,
      ux: impact.ux, uy: impact.uy, nx: impact.nx, ny: impact.ny
    };
    const scale = Math.max(.87, originalScale * size/impact.size);
    this.addTarget({fruit: impact.fruit, chase, scale, born: this.effectTime, duration: chaseDuration}, image);
    return true;
  }

  startRain() {
    this.pending.length = 0;
    this.active = this.active.filter(target => {
      if (!target.fruit.bomb) return true;
      target.button.remove();
      return false;
    });
    const rain = shuffled(fruits.slice(1));
    for (const [i, fruit] of rain.entries()) {
      const distance = Math.abs(i - 2);
      this.scheduleThrow(fruit, 75 + distance*85, {
        middle: .12 + i*.19, apex: .30 + distance*.036, travel: (i-2)*.032,
        scale: .80, duration: 3970, tilt: (i-2)*8, spin: 22
      });
    }
    this.rainUntil = this.flightTime + 4300;
    this.nextLaunch = this.rainUntil + 130;
    this.say("果汁雨！", "rain", 1660);
  }

  tick(timestamp) {
    if (this.state !== "playing") return;
    const elapsed = clamp(timestamp - this.lastFrame, 0, 64);
    const held = clamp(this.freezeUntil - this.effectTime, 0, elapsed);
    this.effectTime += elapsed;
    this.flightTime += (elapsed - held) * paceForScore(this.getScore());
    this.lastFrame = timestamp;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const target = this.active[i];
      const clock = target.chase ? this.effectTime : this.flightTime;
      if (clock - target.born >= target.duration) {
        target.button.remove();
        this.active.splice(i, 1);
      } else {
        this.position(target);
      }
    }
    if (this.effectTime >= this.messageUntil) this.message.hidden = true;
    if (this.flightTime >= this.nextLaunch && this.flightTime >= this.rainUntil && !this.active.some(target => target.chase)) this.scheduleWave();
    if (this.pending.length) this.releaseThrows();
    if (this.cuts.length || this.trails.length) this.paintEffects();
    this.frame = requestAnimationFrame(this.tick);
  }

  point(event, bounds) {
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  beginStroke(event) {
    if (this.state !== "playing" || event.button !== 0) return;
    event.preventDefault();
    const point = this.point(event, this.field.getBoundingClientRect());
    const candidates = this.active.map(target => contact(target, point, point)).filter(Boolean);
    candidates.sort((a, b) => a.distance - b.distance);
    this.pointers.set(event.pointerId, {start: point, last: point, dragging: false, candidate: candidates[0]?.target, chain: 0});
    this.field.setPointerCapture(event.pointerId);
  }

  moveStroke(event) {
    if (this.state !== "playing" || !this.pointers.has(event.pointerId)) return;
    event.preventDefault();
    const bounds = this.field.getBoundingClientRect();
    const samples = event.getCoalescedEvents?.() || [];
    const stroke = this.pointers.get(event.pointerId);
    for (const sample of [...samples, event]) {
      const next = this.point(sample, bounds);
      const a = stroke.last;
      if (a.x === next.x && a.y === next.y) continue;
      if (!stroke.dragging && Math.hypot(next.x-stroke.start.x, next.y-stroke.start.y) < 6) continue;
      const angle = Math.atan2(next.y-a.y, next.x-a.x);
      if (!stroke.dragging && stroke.candidate && this.active.includes(stroke.candidate)) {
        this.strike(stroke.candidate, {...stroke.start, angle}, stroke);
      }
      stroke.dragging = true;
      this.trails.push({a, b: next, born: this.effectTime});
      const contacts = this.active.map(target => canFollow(target.chase, stroke, a, next) && contact(target, a, next)).filter(Boolean);
      contacts.sort((first, second) => first.t - second.t);
      contacts.forEach(hit => this.strike(hit.target, {...a, angle}, stroke));
      stroke.last = next;
    }
  }

  endStroke(event) {
    const stroke = this.pointers.get(event.pointerId);
    if (!stroke) return;
    this.moveStroke(event);
    if (this.state === "playing" && !stroke.dragging && stroke.candidate) this.tapTarget(stroke.candidate);
    this.pointers.delete(event.pointerId);
  }

  tapTarget(target) {
    this.strike(target, {x: target.x, y: target.y, angle: -.69 + target.angle * Math.PI / 360}, {chain: 0});
  }

  strike(target, line, stroke) {
    const index = this.active.indexOf(target);
    if (index < 0) return;
    this.active.splice(index, 1);
    target.button.remove();
    const gentle = this.reducedMotion.matches;
    const secondSlice = Boolean(target.chase);
    const {fruit} = target;
    let bonus = 0;
    if (fruit.bomb) stroke.chain = 0;
    else if (!secondSlice) {
      stroke.chain++;
      this.hits++;
      if (stroke.chain === 3 && !stroke.rewarded) { bonus = 3; stroke.rewarded = true; }
    }
    const impact = buildImpact(target, line, this.effectTime, gentle, secondSlice ? 0 : stroke.chain);
    this.cuts.push(impact);
    if (secondSlice) this.startRain();
    else if (fruit.id === "watermelon" && !this.active.some(item => item.chase) && this.launchChase(impact, line, stroke, target.scale)) {
      this.say("追一刀！", "chase", chaseDuration);
    }
    if (bonus) this.say("三连切！额外 +3", "combo", 1450);
    this.onHit({fruit, hits: this.hits, chain: stroke.chain, secondSlice, bonus}).then(delta => { impact.points = delta; });
    this.freezeUntil = this.effectTime + (gentle ? 16 : secondSlice ? 75 : fruit.bomb ? 72 : 52);
    if (!gentle) {
      const kick = target.fruit.bomb ? 3.8 : 2.3;
      this.layer.animate([
        {transform: "translate(0,0)"}, {transform: "translate(" + kick*impact.nx + "px," + kick*impact.ny + "px)"},
        {transform: "translate(" + -kick*.55*impact.nx + "px," + -kick*.55*impact.ny + "px)"}, {transform: "translate(0,0)"}
      ], {duration: 115, easing: "ease-out"});
    }
    if (!this.active.length && !this.pending.length) {
      this.rainUntil = 0;
      this.nextLaunch = Math.min(this.nextLaunch, this.flightTime + 380);
    }
    this.paintEffects();
  }

  paintEffects() {
    const ctx = this.pen;
    if (!this.width || !this.height) return;
    ctx.clearRect(0, 0, this.width, this.height);
    this.trails = this.trails.filter(stroke => this.effectTime - stroke.born < 180);
    ctx.lineCap = "round";
    this.trails.forEach(({a, b, born}) => {
      const strength = 1 - (this.effectTime - born) / 180;
      ctx.globalAlpha = strength * .92;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.lineWidth = 2 + strength * 8; ctx.strokeStyle = "#f5c961"; ctx.stroke();
      ctx.lineWidth = 1 + strength * 4; ctx.strokeStyle = "#fffcec"; ctx.stroke();
    });
    this.cuts = this.cuts.filter(cut => this.effectTime - cut.born < 975);
    this.cuts.forEach(cut => drawImpact(ctx, cut, this.effectTime));
    ctx.globalAlpha = 1;
  }
}
