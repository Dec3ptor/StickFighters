// Page wiring: menu, match setup, the game loop, pause and results.

import { SPEEDS, DEFAULT_SPEED, SHOW_SPEED_MENU } from './config.js';
import { Game } from './game.js';
import { NavGraph } from './nav.js';
import { BotController, BOT_PROFILES } from './bot.js';
import { Input, PlayerController } from './input.js';
import { Renderer } from './render.js';
import { drawHud } from './hud.js';
import { SoundSystem } from './audio.js';
import { setLegAnimations } from './stickman.js';
import { makeRng, lerp } from './util.js';
import { Editor } from './editor.js';
import { listMaps, getMap, saveMap } from './mapstore.js';
import { decodeShare } from './custommaps.js';

const $ = id => document.getElementById(id);

const canvas = $('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const audio = new SoundSystem();

const maps = { index: [], data: new Map(), nav: new Map() };
const state = { game: null, me: null, settings: null, paused: false, last: 0, acc: 0, overShown: false, returnTo: 'menu' };
let editor = null;

// ---- Settings (remembered between visits) ------------------------------------

const DEFAULTS = { name: 'Player', map: 'ssdm1.json', mode: 'ffa', bots: 5, difficulty: 'normal', fragLimit: 20, speed: DEFAULT_SPEED, muted: false };

function loadSettings() {
  let s;
  try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('stick-soldiers') || '{}') }; }
  catch { s = { ...DEFAULTS }; }
  if (!SHOW_SPEED_MENU) s.speed = DEFAULT_SPEED; // ignore speeds saved before the picker was hidden
  return s;
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
  $('speedField').classList.toggle('hidden', !SHOW_SPEED_MENU);
  for (const r of document.querySelectorAll('input[name=mode]')) r.checked = r.value === settings.mode;
  $('mute').checked = settings.muted;
  audio.setMuted(settings.muted);
  $('bots').addEventListener('input', () => { $('botsOut').textContent = $('bots').value; });

  buildMapCards(settings.map);
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) $('pointer-note').classList.remove('hidden');
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Map cards: the 8 originals, then the player's own maps, then "New map". Keys are file names or "custom:<id>". */
function buildMapCards(selected) {
  const box = $('maps');
  box.innerHTML = '';
  const cards = [
    ...maps.index.map(m => ({ key: m.file, name: m.name, label: m.mode === 'team' ? 'Team map' : 'Deathmatch', mode: m.mode, data: maps.data.get(m.file) })),
    ...listMaps().map(m => ({ key: `custom:${m.id}`, id: m.id, name: m.name, label: 'Your map', data: m.data })),
  ];
  if (!cards.some(c => c.key === selected)) selected = cards[0].key;
  for (const c of cards) {
    const card = document.createElement('div');
    card.className = 'map-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'radio');
    card.dataset.key = c.key;
    card.setAttribute('aria-checked', String(c.key === selected));
    card.innerHTML = `<canvas width="300" height="116"></canvas><span>${esc(c.name)}</span><small>${c.label}</small>${c.id ? '<button type="button" class="edit">Edit</button>' : ''}`;
    const pick = () => {
      for (const el of box.querySelectorAll('.map-card')) el.setAttribute('aria-checked', String(el === card));
      // Team maps default to team mode.
      if (c.mode) for (const r of document.querySelectorAll('input[name=mode]')) r.checked = r.value === c.mode;
      audio.unlock();
      audio.play('menuMove');
    };
    card.addEventListener('click', pick);
    card.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); pick(); } });
    card.querySelector('.edit')?.addEventListener('click', e => { e.stopPropagation(); openEditor(getMap(c.id)); });
    box.appendChild(card);
    drawPreview(card.querySelector('canvas'), c.data);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'map-card new-map';
  add.textContent = '+ Make a new map';
  add.addEventListener('click', () => openEditor(null));
  box.appendChild(add);
}

/** The map data for a menu key, falling back to the first original map. */
function mapDataFor(key) {
  if (key?.startsWith('custom:')) {
    const rec = getMap(key.slice(7));
    if (rec) return { data: rec.data, navKey: `${key}@${rec.updated}` };
  }
  const file = maps.data.has(key) ? key : maps.index[0].file;
  return { data: maps.data.get(file), navKey: file };
}

function readMenu() {
  const card = $('maps').querySelector('.map-card[aria-checked="true"]') || $('maps').querySelector('.map-card');
  return {
    name: ($('name').value.trim() || 'Player').slice(0, 14),
    map: card.dataset.key,
    mode: document.querySelector('input[name=mode]:checked').value,
    bots: +$('bots').value,
    difficulty: $('difficulty').value,
    fragLimit: +$('fragLimit').value,
    speed: SHOW_SPEED_MENU && SPEEDS.includes(+$('speed').value) ? +$('speed').value : DEFAULT_SPEED,
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

function startMatch(settings, { returnTo = 'menu' } = {}) {
  state.settings = settings;
  state.returnTo = returnTo;
  if (returnTo === 'menu') saveSettings(settings);
  show('menu', false); show('pause', false); show('over', false);
  $('toEditor').classList.toggle('hidden', returnTo !== 'editor');
  $('toMenu').textContent = returnTo === 'editor' ? 'Back to map maker' : 'Menu';
  show('loading', true);
  // Let the loading message paint before building the bots' route map.
  setTimeout(() => {
    const { data: mapData, navKey: mapKey } = mapDataFor(settings.map);
    const game = new Game({ mapData, mode: settings.mode, fragLimit: settings.fragLimit, speed: settings.speed, seed: (Math.random() * 2 ** 31) | 0 });
    state.step = 1000 / game.tickRate;
    // Route maps depend on the map version and the speed's move timings.
    const navKey = `${mapKey}@${settings.speed}`;
    if (!maps.nav.has(navKey)) maps.nav.set(navKey, new NavGraph(game.map));
    const nav = maps.nav.get(navKey);
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

function endMatch(to = state.returnTo) {
  state.game = null;
  input.enabled = false;
  document.body.classList.remove('playing');
  show('pause', false); show('over', false);
  if (to === 'editor') editor.resume();
  else showMenu();
}

function showMenu() {
  buildMapCards(readMenu().map);
  show('menu', true);
}

function openEditor(record) {
  show('menu', false);
  editor.open(record);
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 4000);
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

  audio.playQueue(g.sounds, me.x, me.y, me.id);
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
  $('restart').addEventListener('click', () => startMatch(state.settings, { returnTo: state.returnTo }));
  $('quit').addEventListener('click', () => endMatch('menu'));
  $('toEditor').addEventListener('click', () => endMatch('editor'));
  $('again').addEventListener('click', () => startMatch(state.settings, { returnTo: state.returnTo }));
  $('toMenu').addEventListener('click', () => endMatch());
  $('openEditor').addEventListener('click', () => openEditor(listMaps()[0] || null));
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

/**
 * A shared map link (#map=...) adds that map to "Your maps" (once: opening the
 * same link again reuses the saved copy). Returns { key?, text } or null if
 * there's no link.
 */
async function importSharedMap() {
  if (!location.hash.startsWith('#map=')) return null;
  const code = location.hash.slice(5);
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const data = await decodeShare(code);
    const same = JSON.stringify(data);
    const old = listMaps().find(m => JSON.stringify(m.data) === same);
    const rec = old || saveMap({ name: data.name, data });
    if (!rec) return { text: "Couldn't save the shared map: this browser's storage is full." };
    const where = $('menu').classList.contains('hidden') ? 'Find it in the menu.' : "It's selected below.";
    return { key: `custom:${rec.id}`, text: `${old ? 'Already in your maps' : 'Added to your maps'}: "${data.name}". ${where}` };
  } catch (e) {
    return { text: `Couldn't open the shared map. ${e.message}.` };
  }
}

function revealSelectedMap() {
  $('maps').querySelector('.map-card[aria-checked="true"]')?.scrollIntoView({ block: 'nearest' });
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

  editor = new Editor({
    root: $('editor'),
    originals: maps.index.map(m => ({ name: m.name, data: maps.data.get(m.file) })),
    onExit: () => showMenu(),
    onTestPlay: record => startMatch({ ...readMenu(), map: `custom:${record.id}` }, { returnTo: 'editor' }),
  });

  const shared = await importSharedMap();
  if (shared?.key) settings.map = shared.key;

  buildMenu(settings);
  wire();
  requestAnimationFrame(frame);
  if (shared) { toast(shared.text); revealSelectedMap(); }
  // A link pasted into a tab that already has the game open only changes the hash.
  window.addEventListener('hashchange', async () => {
    const result = await importSharedMap();
    if (!result) return;
    if (result.key && !$('menu').classList.contains('hidden')) { buildMapCards(result.key); revealSelectedMap(); }
    toast(result.text);
  });
  // For automated tests and debugging in the console.
  window.stickSoldiers = { state, startMatch, readMenu, audio, editor, openEditor };
}

boot().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;top:10px;left:10px;color:#b3261e">Couldn't load the game: ${err.message}</p>`);
});
