import { FruitRound, fruits } from "./orchard.js?v=2";
import { playMusic, pauseMusic, duckMusic } from "./music.js";

const $ = id => document.getElementById(id);
const icon = id => '<svg class="icon" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
const legacyBasketKey = "guoguo.picnic.basket.v1";
const progressKey = "guoguo.picnic.progress.v2";
const soundKey = "guoguo.picnic.sound";
const emptyBasket = () => Object.fromEntries(fruits.map(fruit => [fruit.id, 0]));

function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeLocal(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function safeBasket(data) {
  const values = emptyBasket();
  for (const fruit of fruits) {
    const n = data?.[fruit.id];
    if (Number.isSafeInteger(n) && n >= 0) values[fruit.id] = n;
  }
  return values;
}

function savedProgress() {
  try {
    const data = JSON.parse(readLocal(progressKey));
    if (Number.isSafeInteger(data?.score) && data.score >= 0) return {score: data.score, basket: safeBasket(data.basket)};
    const old = JSON.parse(readLocal(legacyBasketKey));
    if (!old || typeof old !== "object") return null;
    const basket = safeBasket(old);
    return {score: Object.values(basket).reduce((sum, n) => sum + n, 0), basket};
  } catch { return null; }
}

let progress = savedProgress() || {score: 0, basket: emptyBasket()};
let progressStored = true;
let soundOn = readLocal(soundKey) !== "off";
let context;
let noiseBuffer;
let panel = null;
let picked = null;
let fallbackFullscreen = false;
let backgroundPause = false;
const scene = $("scene"), dialog = $("dialog");
const round = new FruitRound($("playfield"), $("fruit-layer"), $("effects"), $("round-message"), onHit, () => progress.score);
const cards = new Map();

for (const fruit of fruits) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "fruit-card";
  card.style.setProperty("--card", fruit.card);
  card.style.setProperty("--edge", fruit.edge);
  card.style.setProperty("--tilt", fruit.tilt + "deg");
  const image = fruit.image.cloneNode();
  image.alt = ""; image.draggable = false;
  const label = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = fruit.name;
  const count = document.createElement("small");
  label.append(name, count); card.append(image, label);
  card.addEventListener("click", () => {
    openPanel("fruit", fruit);
    sayName(fruit);
  });
  $("fruit-cards").append(card);
  cards.set(fruit.id, {card, count});
}

function renderBasket() {
  let varieties = 0;
  for (const fruit of fruits) {
    const n = progress.basket[fruit.id];
    if (n) varieties++;
    const {card, count} = cards.get(fruit.id);
    count.textContent = "× " + n;
    card.classList.toggle("found", n > 0);
    card.setAttribute("aria-label", fruit.name + "，已收集 " + n + " 个");
  }
  $("score").textContent = String(progress.score);
  $("varieties").textContent = varieties + " / " + fruits.length;
  $("progress-bar").style.width = (varieties / fruits.length * 100) + "%";
}

function recordHit({fruit, secondSlice, bonus}) {
  function apply() {
    if (progressStored) progress = savedProgress() || progress;
    const points = secondSlice ? 1 : 2 + bonus;
    const delta = fruit.bomb ? -Math.min(1, progress.score) : points;
    progress.score += delta;
    if (!fruit.bomb && !secondSlice) progress.basket[fruit.id]++;
    progressStored = writeLocal(progressKey, JSON.stringify(progress));
    renderBasket();
    const action = fruit.bomb ? "碰到了炸弹" : secondSlice ? "切中西瓜片" : "切开了" + fruit.name;
    $("announcement").textContent = action + "，现在有 " + progress.score + " 分";
    return delta;
  }
  if (navigator.locks?.request) return navigator.locks.request(progressKey, apply).catch(apply);
  return Promise.resolve(apply());
}

function onHit(hit) {
  const {fruit, hits, chain, secondSlice, bonus} = hit;
  duckMusic();
  impactSound(fruit, chain, secondSlice, bonus);
  if (navigator.vibrate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    navigator.vibrate(fruit.bomb ? [12, 24, 12] : 9);
  }
  const score = $("score").parentNode;
  score.classList.remove("bump", "deduct");
  void score.offsetWidth;
  score.classList.add(fruit.bomb ? "deduct" : "bump");
  if (hits >= 3) $("game-hint").hidden = true;
  return recordHit(hit);
}

function audioContext() {
  if (!soundOn) return null;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return null;
  try {
    if (!context) context = new Audio();
    if (context.state !== "running") context.resume().catch(() => {});
    return context;
  } catch { return null; }
}

function chime(notes) {
  const audio = audioContext();
  if (!audio) return;
  const now = audio.currentTime;
  notes.forEach((note, i) => {
    const start = now + i * .075;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = i ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(note, start);
    oscillator.frequency.exponentialRampToValueAtTime(note * .994, start + .16);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(i ? .072 : .05, start + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .23);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(start); oscillator.stop(start + .25);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}

function impactSound(item, chain, secondSlice, bonus) {
  const audio = audioContext();
  if (!audio) return;
  if (!noiseBuffer) {
    noiseBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate*.24), audio.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random()*2 - 1;
  }
  const now = audio.currentTime, bomb = Boolean(item.bomb);
  const span = bomb ? .21 : .115;
  const noise = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
  noise.buffer = noiseBuffer;
  filter.type = bomb ? "lowpass" : "bandpass";
  filter.Q.value = bomb ? .65 : .9;
  filter.frequency.setValueAtTime(bomb ? 1120 : 4200, now);
  filter.frequency.exponentialRampToValueAtTime(bomb ? 240 : 850, now+span);
  gain.gain.setValueAtTime(.0001, now);
  gain.gain.exponentialRampToValueAtTime(bomb ? .19 : .27, now+.009);
  gain.gain.exponentialRampToValueAtTime(.0001, now+span);
  noise.connect(filter); filter.connect(gain); gain.connect(audio.destination);
  noise.start(now); noise.stop(now+span);
  noise.onended = () => { noise.disconnect(); filter.disconnect(); gain.disconnect(); };
  const pop = audio.createOscillator(), thump = audio.createGain();
  pop.type = "sine";
  pop.frequency.setValueAtTime(bomb ? 205 : 490, now);
  pop.frequency.exponentialRampToValueAtTime(bomb ? 70 : 160, now+span);
  thump.gain.setValueAtTime(.0001, now);
  thump.gain.exponentialRampToValueAtTime(bomb ? .13 : .105, now+.007);
  thump.gain.exponentialRampToValueAtTime(.0001, now+span);
  pop.connect(thump); thump.connect(audio.destination);
  pop.start(now); pop.stop(now+span);
  pop.onended = () => { pop.disconnect(); thump.disconnect(); };
  if (secondSlice) chime([587, 740, 880]);
  else if (bonus) chime([523, 659, 784]);
  else if (!bomb) chime(chain > 1 ? [item.note*1.25, item.note*1.75] : [item.note, item.note*1.5]);
}

function sayName(fruit) {
  chime([fruit.note]);
  if (!soundOn || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  const speech = window.speechSynthesis;
  const voice = speech.getVoices().find(v => /^zh[-_]CN/i.test(v.lang));
  const utterance = new SpeechSynthesisUtterance(fruit.name);
  utterance.lang = "zh-CN";
  if (voice) utterance.voice = voice;
  utterance.rate = .85; utterance.volume = .7;
  speech.cancel();
  speech.speak(utterance);
}

function renderSound() {
  const control = $("sound");
  control.setAttribute("aria-pressed", String(soundOn));
  control.setAttribute("aria-label", soundOn ? "关闭声音" : "打开声音");
  control.title = control.getAttribute("aria-label");
  control.querySelector("use").setAttribute("href", soundOn ? "#i-sound" : "#i-mute");
  control.querySelector("span").textContent = soundOn ? "声音开" : "声音关";
  const inside = dialog.querySelector('[data-action="sound"]');
  if (inside) inside.textContent = soundOn ? "关闭声音" : "打开声音";
}

function syncMusic() {
  if (soundOn && round.state === "playing" && !document.hidden) playMusic(audioContext());
  else pauseMusic(round.state === "home", !soundOn || document.hidden);
}

function applySoundPreference() {
  renderSound();
  syncMusic();
  if (!soundOn) {
    window.speechSynthesis?.cancel();
    if (context?.state === "running") context.suspend().catch(() => {});
  }
}

function toggleSound() {
  soundOn = !soundOn;
  writeLocal(soundKey, soundOn ? "on" : "off");
  applySoundPreference();
  if (soundOn) chime([440, 554.4]);
}

function startRound(first) {
  closePanel(false);
  $("welcome").hidden = true;
  $("pause").hidden = false;
  $("game-hint").hidden = false;
  round.start(first);
  syncMusic();
  chime([392, 494, 587]);
  $("pause").focus({preventScroll: true});
}

function goHome() {
  closePanel(false);
  round.stop();
  syncMusic();
  $("pause").hidden = true;
  $("welcome").hidden = false;
  $("start").focus({preventScroll: true});
}

function actionButton(action, label) {
  return '<button class="primary" type="button" data-action="' + action + '">' + icon("play") + label + '</button>';
}

function openPanel(type, fruit = null) {
  if (round.state === "playing") round.pause();
  syncMusic();
  panel = type;
  picked = fruit;
  const art = fruit || (type === "help" ? fruits[0] : fruits[2]);
  const picture = '<img class="dialog-art" alt="" draggable="false" src="' + art.image.src + '">';
  let content;
  if (type === "help") {
    content = '<h2 id="dialog-title">怎么玩？</h2><p>水果飞起来时，划一划或点一下。</p><div class="score-rules"><span><img src="./assets/orange.webp" alt="">切开水果 <b>+2</b></span><span><img src="./assets/bomb.webp" alt="">碰到炸弹 <b>−1</b></span></div><p class="rule-note">追切发亮的西瓜片，<b>加 1 分</b>，还会飞出五颗水果。<br>一刀切三颗，<b>额外加 3 分</b>。<br>落地不扣分。分高飞得快，掉分就放慢。</p>' +
      actionButton("play", round.state === "home" ? "开始游戏" : "继续玩");
  } else if (type === "pause") {
    content = '<h2 id="dialog-title">休息一下</h2><p>这一轮切开了 <b>' + round.hits + '</b> 个水果。</p>' +
      actionButton("play", "继续玩") +
      '<div class="dialog-links"><button type="button" class="quiet-action" data-action="home">回到果园</button><button type="button" class="quiet-action" data-action="sound"></button></div>';
  } else {
    content = '<h2 id="dialog-title">' + fruit.name + '</h2><p>果篮里已经有 <b>' + progress.basket[fruit.id] + '</b> 个啦。</p>' + actionButton("choose", "切个" + fruit.name);
  }
  $("dialog-content").innerHTML = picture + content;
  renderSound();
  if (!dialog.open) dialog.showModal();
  dialog.querySelector(".primary").focus({preventScroll: true});
}

function closePanel(resume = true) {
  if (!panel) return;
  panel = null; picked = null;
  dialog.close();
  window.speechSynthesis?.cancel();
  if (resume && !document.hidden) { round.resume(); syncMusic(); }
}

dialog.addEventListener("click", event => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closePanel();
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "play") {
    if (round.state === "home") startRound(); else closePanel();
  } else if (action === "choose" && picked) {
    if (round.state === "home") startRound(picked);
    else {
      round.queueNext(picked);
      closePanel();
    }
  } else if (action === "home") goHome();
  else if (action === "sound") toggleSound();
});
dialog.addEventListener("cancel", event => { event.preventDefault(); closePanel(); });
$("dialog-close").addEventListener("click", () => closePanel());
$("help").addEventListener("click", () => openPanel("help"));
$("pause").addEventListener("click", () => openPanel("pause"));
$("start").addEventListener("click", () => startRound());
$("sound").addEventListener("click", toggleSound);
$("brand").addEventListener("click", goHome);

function nativeFullscreen() { return document.fullscreenElement === scene || document.webkitFullscreenElement === scene; }
function showFullscreenState() {
  const expanded = nativeFullscreen() || fallbackFullscreen;
  scene.classList.toggle("expanded", fallbackFullscreen);
  document.body.classList.toggle("focus-mode", expanded);
  const button = $("expand");
  button.setAttribute("aria-pressed", String(expanded));
  button.setAttribute("aria-label", expanded ? "退出全屏" : "全屏玩");
  button.title = button.getAttribute("aria-label");
  button.querySelector("use").setAttribute("href", expanded ? "#i-collapse" : "#i-expand");
  round.resize();
}

$("expand").addEventListener("click", async () => {
  if (nativeFullscreen()) {
    if (document.exitFullscreen) await document.exitFullscreen();
    else document.webkitExitFullscreen?.();
  } else if (fallbackFullscreen) {
    fallbackFullscreen = false;
  } else {
    if (scene.requestFullscreen && document.fullscreenEnabled) {
      try { await scene.requestFullscreen(); showFullscreenState(); return; } catch { /* Use the in-page canvas on this browser. */ }
    }
    fallbackFullscreen = true;
  }
  showFullscreenState();
});
document.addEventListener("fullscreenchange", showFullscreenState);
document.addEventListener("webkitfullscreenchange", showFullscreenState);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && fallbackFullscreen && !panel) {
    fallbackFullscreen = false; showFullscreenState();
  }
});
function leavePage() {
  if (round.state === "playing") {
    round.pause(); backgroundPause = true;
  }
  pauseMusic(false, true);
}
function returnToPage() {
  if (!document.hidden && backgroundPause) {
    backgroundPause = false;
    openPanel("pause");
  }
}
document.addEventListener("visibilitychange", () => { if (document.hidden) leavePage(); else returnToPage(); });
window.addEventListener("pagehide", leavePage);
window.addEventListener("pageshow", returnToPage);
window.addEventListener("storage", event => {
  if (event.key === progressKey || event.key === legacyBasketKey || event.key === null) {
    progress = savedProgress() || {score: 0, basket: emptyBasket()};
    renderBasket();
  }
  if (event.key === soundKey || event.key === null) { soundOn = readLocal(soundKey) !== "off"; applySoundPreference(); }
});
renderBasket();
renderSound();
