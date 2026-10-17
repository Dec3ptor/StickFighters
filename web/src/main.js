// Page wiring: menu, match setup, the game loop, pause and results.

import { SPEEDS, DEFAULT_SPEED } from './config.js';
import { Game } from './game.js';
import { NavGraph } from './nav.js';
import { BotController, BOT_PROFILES } from './bot.js';
import { Input, PlayerController } from './input.js';
import { Renderer } from './render.js';
import { drawHud } from './hud.js';
import { SoundSystem } from './audio.js';
import { setLegAnimations } from './stickman.js';
import { makeRng, lerp } from './util.js';

const $ = id => document.getElementById(id);

const canvas = $('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const audio = new SoundSystem();

const maps = { index: [], data: new Map(), nav: new Map() };
const state = { game: null, me: null, settings: null, paused: false, last: 0, acc: 0, overShown: false };

// ---- Settings (remembered between visits) ------------------------------------

const DEFAULTS = { name: 'Player', map: 'ssdm1.json', mode: 'ffa', bots: 5, difficulty: 'normal', fragLimit: 20, speed: DEFAULT_SPEED, muted: false };

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('stick-soldiers') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  try { localStorage.setItem('stick-soldiers', JSON.stringify(s)); } catch { /* private mode */ }
}

// ---- Menu ---------------------------------------------------------------------

function buildMenu(settings) {
  $('name').value = settings.name;
  $('bots').value = settings.bots;
  $('botsOut').textContent = settings.bots;
  $('difficulty').value = settings.difficulty;
  $('fragLimit').value = String(settings.fragLimit);
  $('speed').value = String(SPEEDS.includes(settings.speed) ? settings.speed : DEFAULT_SPEED);
  for (const r of document.querySelectorAll('input[name=mode]')) r.checked = r.value === settings.mode;
  $('mute').checked = settings.muted;
  audio.setMuted(settings.muted);
  $('bots').addEventListener('input', () => { $('botsOut').textContent = $('bots').value; });

  const box = $('maps');
  box.innerHTML = '';
  for (const m of maps.index) {
    const card = document.createElement('button');
    card.className = 'map-card';
    card.type = 'button';
    card.setAttribute('role', 'radio');
    card.dataset.file = m.file;
    card.setAttribute('aria-checked', String(m.file === settings.map));
    card.innerHTML = `<canvas width="300" height="116"></canvas><span>${m.name}</span><small>${m.mode === 'team' ? 'Team map' : 'Deathmatch'}</small>`;
    card.addEventListener('click', () => {
      for (const c of box.children) c.setAttribute('aria-checked', String(c === card));
      // Team maps default to team mode.
      for (const r of document.querySelectorAll('input[name=mode]')) r.checked = r.value === m.mode;
      audio.unlock();
      audio.play('menuMove');
    });
    box.appendChild(card);
    drawPreview(card.querySelector('canvas'), maps.data.get(m.file));
  }
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) $('pointer-note').classList.remove('hidden');
}

function readMenu() {
  const card = [...$('maps').children].find(c => c.getAttribute('aria-checked') === 'true') || $('maps').children[0];
  return {
    name: ($('name').value.trim() || 'Player').slice(0, 14),
    map: card.dataset.file,
    mode: document.querySelector('input[name=mode]:checked').value,
    bots: +$('bots').value,
    difficulty: $('difficulty').value,
    fragLimit: +$('fragLimit').value,
    speed: SPEEDS.includes(+$('speed').value) ? +$('speed').value : DEFAULT_SPEED,
    muted: $('mute').checked,
  };
}

/** Small black-and-white outline of a map for the menu. */
function drawPreview(cv, data) {
  const ctx = cv.getContext('2d');
  const b = data.bounds;
  const s = Math.min((cv.width - 16) / (b.right - b.left), (cv.height - 16) / (b.bottom - b.top));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(s, 0, 0, s, cv.width / 2 - ((b.left + b.right) / 2) * s, cv.height / 2 - ((b.top + b.bottom) / 2) * s);
  const e = 1.4 / s;
  ctx.fillStyle = '#111';
  for (const p of data.platforms) ctx.fillRect(p.left - e, p.top - e, p.right - p.left + 2 * e, p.bottom - p.top + 2 * e);
  for (const p of data.platforms) {
    ctx.fillStyle = p.bounce ? '#cfe0a8' : '#fff';
    ctx.fillRect(p.left, p.top, p.right - p.left, p.bottom - p.top);
  }
}

function show(id, on) { $(id).classList.toggle('hidden', !on); }

// ---- Matches --------------------------------------------------------------------

function startMatch(settings) {
  state.settings = settings;
  saveSettings(settings);
  show('menu', false); show('pause', false); show('over', false);
  show('loading', true);
  // Let the loading message paint before building the bots' route map.
  setTimeout(() => {
    const mapData = maps.data.get(settings.map);
    const game = new Game({ mapData, mode: settings.mode, fragLimit: settings.fragLimit, speed: settings.speed, seed: (Math.random() * 2 ** 31) | 0 });
    state.step = 1000 / game.tickRate;
    if (!maps.nav.has(settings.map)) maps.nav.set(settings.map, new NavGraph(game.map));
    const nav = maps.nav.get(settings.map);
    const rng = makeRng((Math.random() * 2 ** 31) | 0);

    const team = settings.mode === 'team';
    state.me = game.addSoldier({ name: settings.name, isBot: false, team: team ? 1 : 0 }, new PlayerController(input, renderer));
    const profiles = [...BOT_PROFILES].sort(() => rng() - 0.5).filter(p => p.name.toLowerCase() !== settings.name.toLowerCase());
    for (let i = 0; i < settings.bots; i++) {
      const p = profiles[i % profiles.length];
      game.addSoldier({ name: p.name, isBot: true, team: team ? (i % 2 === 0 ? 2 : 1) : 0, profile: p },
        new BotController(nav, settings.difficulty, p, rng));
    }

    const b = game.map.bounds;
    renderer.snapCamera((b.left + b.right) / 2, (b.top + b.bottom) / 2);
    state.game = game;
    state.paused = false;
    state.overShown = false;
    state.acc = 0;
    state.last = performance.now();
    input.clear();
    input.enabled = true;
    document.body.classList.add('playing');
    show('loading', false);
    canvas.focus?.();
  }, 30);
}

function endMatch() {
  state.game = null;
  input.enabled = false;
  document.body.classList.remove('playing');
  show('pause', false); show('over', false);
  show('menu', true);
}

function setPaused(p) {
  if (!state.game || state.game.over) return;
  state.paused = p;
  input.enabled = !p;
  if (p) input.clear();
  document.body.classList.toggle('playing', !p);
  show('pause', p);
  state.last = performance.now();
}

// ---- Loop -----------------------------------------------------------------------

function frame(now) {
  requestAnimationFrame(frame);
  const g = state.game;
  if (!g) { renderer.ctx.setTransform(1, 0, 0, 1, 0, 0); return; }
  let dt = now - state.last;
  state.last = now;
  if (dt > 250) dt = 250;
  if (!state.paused) {
    state.acc += dt;
    while (state.acc >= state.step) { g.update(); state.acc -= state.step; }
  }
  const alpha = state.paused ? 1 : state.acc / state.step;
  const me = state.me;

  audio.playQueue(g.sounds, me.x, me.y);
  g.sounds.length = 0;

  const sniping = me.alive && me.current === 'SR' && input.mouse.right && !state.paused;
  renderer.updateCamera(g, lerp(me.prevX, me.x, alpha), lerp(me.prevY, me.y, alpha), state.paused ? null : input.mouse, sniping);
  renderer.render(g, alpha, me);
  drawHud(renderer, g, me, { showScores: input.down('Tab') });
  if (!state.paused && !g.over) renderer.drawCrosshair(input.mouse.x, input.mouse.y, sniping);

  if (g.over && !state.overShown) {
    state.overShown = true;
    input.enabled = false;
    document.body.classList.remove('playing');
    setTimeout(() => { if (state.game === g) show('over', true); }, 1500);
  }
}

// ---- Events ---------------------------------------------------------------------

function wire() {
  $('play').addEventListener('click', () => { audio.unlock(); audio.play('menuSelect'); startMatch(readMenu()); });
  $('resume').addEventListener('click', () => setPaused(false));
  $('restart').addEventListener('click', () => startMatch(state.settings));
  $('quit').addEventListener('click', endMatch);
  $('again').addEventListener('click', () => startMatch(state.settings));
  $('toMenu').addEventListener('click', endMatch);
  $('mute').addEventListener('change', () => {
    audio.setMuted($('mute').checked);
    if (state.settings) { state.settings.muted = $('mute').checked; saveSettings(state.settings); }
  });
  window.addEventListener('keydown', e => {
    audio.unlock();
    if (!state.game) {
      if (e.code === 'Enter' && !$('menu').classList.contains('hidden') && document.activeElement?.tagName !== 'BUTTON') startMatch(readMenu());
      return;
    }
    if (e.code === 'Escape') { e.preventDefault(); setPaused(!state.paused); }
    if (e.code === 'KeyM' && !e.repeat) {
      const m = !audio.muted;
      audio.setMuted(m);
      $('mute').checked = m;
      if (state.settings) { state.settings.muted = m; saveSettings(state.settings); }
    }
  });
  canvas.addEventListener('mousedown', () => audio.unlock());
  window.addEventListener('blur', () => { if (state.game && !state.game.over) setPaused(true); });
}

async function boot() {
  const [index, legs] = await Promise.all([
    fetch('data/maps/index.json').then(r => r.json()),
    fetch('data/animations/legs.json').then(r => r.json()),
  ]);
  setLegAnimations(legs);
  audio.preload();
  maps.index = index;
  await Promise.all(index.map(async m => maps.data.set(m.file, await fetch('data/maps/' + m.file).then(r => r.json()))));
  const settings = loadSettings();
  if (!maps.data.has(settings.map)) settings.map = index[0].file;
  buildMenu(settings);
  wire();
  requestAnimationFrame(frame);
  // For automated tests and debugging in the console.
  window.stickSoldiers = { state, startMatch, readMenu, audio };
}

boot().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;top:10px;left:10px;color:#b3261e">Couldn't load the game: ${err.message}</p>`);
});
