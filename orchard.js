import { buildImpact, drawImpact } from "./impact.js";

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
  const radius = target.fruit.bomb ? size*.35 : size*.48 + Math.min(12, size*.10);
  return distance <= radius ? {target, t, distance} : null;
}

export class FruitRound {
  constructor(field, layer, canvas, onHit, getScore) {
    this.field = field;
    this.layer = layer;
    this.canvas = canvas;
    this.pen = canvas.getContext("2d");
    this.onHit = onHit;
    this.getScore = getScore;
    this.state = "home";
    this.active = [];
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
    this.launchCount = 0;
    this.bombDue = 4;
    this.preferred = null;
    this.bag = [first, ...shuffled(fruits.filter(fruit => fruit !== first))];
    this.resize();
    this.launch();
    this.nextLaunch = 1150;
    this.restartClock();
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.state = "home";
    this.active.length = this.cuts.length = this.trails.length = 0;
    this.pointers.clear();
    this.layer.replaceChildren();
    this.pen.clearRect(0, 0, this.width || 0, this.height || 0);
    this.field.hidden = true;
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

  launch() {
    if (!this.bag.length) this.bag = shuffled(fruits);
    let fruit;
    if (this.preferred) {
      fruit = this.preferred;
      this.preferred = null;
      this.bag = this.bag.filter(item => item !== fruit);
    } else if (this.launchCount >= this.bombDue && !this.active.some(target => target.fruit.bomb)) {
      fruit = bomb;
      this.bombDue = this.launchCount + Math.floor(between(5, 8));
    } else {
      fruit = this.bag.shift();
    }
    const lane = [0.50, 0.22, 0.78][this.launchCount % 3];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "air-fruit";
    button.setAttribute("aria-label", fruit.bomb ? "炸弹，碰到扣 1 分" : "切开" + fruit.name);
    button.dataset.fruit = fruit.id;
    const image = fruit.image.cloneNode();
    image.alt = "";
    image.draggable = false;
    button.append(image);
    const target = {
      fruit, button, born: this.flightTime, duration: between(4100, 4750),
      middle: lane + between(-.035, .035), travel: between(.13, .27) * (lane > .5 ? -1 : lane < .5 ? 1 : Math.random() < .5 ? -1 : 1),
      apex: between(.26, .41), scale: between(.94, 1.06), tilt: between(-22, 22), spin: between(-52, 52)
    };
    button.addEventListener("click", event => {
      // Keyboard and assistive clicks do not have a pointer stroke.
      if (event.detail === 0 && this.state === "playing") this.tapTarget(target);
    });
    this.launchCount++;
    this.active.push(target);
    this.position(target);
    this.layer.append(button);
  }

  position(target) {
    const t = clamp((this.flightTime - target.born) / target.duration, 0, 1);
    const size = clamp(Math.min(this.width * .205, this.height * .32), 76, 172) * target.scale;
    const bottom = this.height + size * .55;
    const apex = Math.max(54 + size * .48, this.height * target.apex);
    const x = clamp((target.middle + target.travel * (t - .5)) * this.width, size * .56, this.width - size * .56);
    // A constant-gravity arc starts and ends just below the grass.
    const y = bottom - 4 * (bottom - apex) * t * (1 - t);
    if (target.size !== size) {
      target.button.style.width = size + "px";
      target.button.style.height = size + "px";
    }
    target.size = size;
    target.x = x;
    target.y = y;
    target.angle = target.tilt + target.spin * (t - .5);
    target.button.style.transform = "translate3d(" + (x - size / 2) + "px," + (y - size / 2) + "px,0) rotate(" + target.angle + "deg)";
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
      if (this.flightTime - target.born >= target.duration) {
        target.button.remove();
        this.active.splice(i, 1);
      } else {
        this.position(target);
      }
    }
    if (this.flightTime >= this.nextLaunch && this.active.length < 3) {
      this.launch();
      this.nextLaunch = this.flightTime + between(1430, 1830);
    }
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
      const contacts = this.active.map(target => contact(target, a, next)).filter(Boolean);
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
    if (target.fruit.bomb) stroke.chain = 0;
    else { stroke.chain++; this.hits++; }
    const impact = buildImpact(target, line, this.effectTime, gentle, stroke.chain);
    this.cuts.push(impact);
    this.onHit(target.fruit, this.hits, stroke.chain).then(delta => { impact.points = delta; });
    this.freezeUntil = this.effectTime + (gentle ? 16 : target.fruit.bomb ? 72 : 52);
    if (!gentle) {
      const kick = target.fruit.bomb ? 3.8 : 2.3;
      this.layer.animate([
        {transform: "translate(0,0)"}, {transform: "translate(" + kick*impact.nx + "px," + kick*impact.ny + "px)"},
        {transform: "translate(" + -kick*.55*impact.nx + "px," + -kick*.55*impact.ny + "px)"}, {transform: "translate(0,0)"}
      ], {duration: 115, easing: "ease-out"});
    }
    if (!this.active.length) this.nextLaunch = Math.min(this.nextLaunch, this.flightTime + 380);
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
