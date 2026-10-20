// Page wiring: menus, match setup, online play, the game loop, pause and results.

import { SPEEDS, DEFAULT_SPEED, SHOW_SPEED_MENU } from './config.js';
import { Game } from './game.js';
import { NavGraph } from './nav.js';
import { BotController, BOT_PROFILES } from './bot.js';
import { Input, PlayerController } from './input.js';
import { createRenderer, autoGraphics } from './glrender.js';
import { Renderer } from './render.js';
import { FramePacer } from './framerate.js';
import { drawHud } from './hud.js';
import { SoundSystem } from './audio.js';
import { setLegAnimations } from './stickman.js';
import { makeRng, lerp } from './util.js';
import { Editor } from './editor.js';
import { listMaps, getMap, saveMap } from './mapstore.js';
import { decodeShare, encodeShare, normalizeMap } from './custommaps.js';
import { MODES } from './modes.js';
import { WEAPONS } from './weapons.js';
import { GameMap, seamsOf, fillSeams } from './map.js';
import { Lobby, inviteCode, parseInvite } from './net/lobby.js';
import { NetHost } from './net/host.js';
import { NetClient } from './net/client.js';
import { Community } from './net/community.js';
import { PROTOCOL } from './net/protocol.js';
import { CLASSES, CLASS_IDS, weaponFor } from './classes.js';
import { holdSpawn } from './gadgets.js';
import { loadKit, saveKit, KIT_KEY } from './kitchoice.js';
import { renderLoadout, renderPicker } from './loadout.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Set up in boot(): the renderer (WebGL or canvas) decides which canvas element we draw on.
let canvas = $('game');
let renderer = null;
let input = null;
const audio = new SoundSystem();

const maps = { index: [], data: new Map(), nav: new Map(), community: new Map() };
const state = {
  game: null, me: null, settings: null, paused: false, last: 0, acc: 0, step: 1000 / 60,
  overShown: false, returnTo: 'menu',
  mode: 'offline',     // 'offline' | 'host' | 'client'
  net: null,           // online session: { role, host?, handle?, client?, target? }
  chat: [], chatOpen: false, setupFor: 'offline', nextMatchAt: 0,
  spectating: false,   // chosen from the in-game menu (sitting out to watch)
  spec: { id: null, free: false, x: 0, y: 0 }, // watching: who the camera follows, or the free camera
};
let editor = null;
let lobby = null;
const pacer = new FramePacer();
const params = new URLSearchParams(location.search);
// Classes (kits, gadgets, the Loadout screen) are switched off for now: ?classes in the
// address turns them back on (to try them, and for their tests).
const CLASSES_ON = params.has('classes');
// (?tiles=on or off: whether the canvas keeps the map in tiles, rather than deciding by the graphics card.)
if (['on', 'off'].includes(params.get('tiles'))) Renderer.tiles = params.get('tiles');
// The Settings screen's choices (saved with the other settings).
const prefs = { graphics: 'canvas', graphicsPicked: false, fpsCap: 'auto', showFps: false, showPing: true, sprint: 'hold' };
let community = null;
let watcher = null;
// Classes on: the class and loadouts we play with (saved apart from the settings: kitchoice.js).
let profile = null;

// ---- Settings (remembered between visits) ------------------------------------

const DEFAULTS = {
  name: 'Player', map: 'ssdm1.json', mode: 'ffa', bots: 5, difficulty: 'normal', fragLimit: 20, speed: DEFAULT_SPEED, muted: false,
  lives: 3, gunKills: 1, crates: 'normal', destruction: 'on', maxPlayers: 8, visibility: 'public', gameName: '', tab: 'online', mapSource: 'originals',
  // Objective modes: the goal chosen for each (points, captures, tickets), and which team you're on.
  goals: {}, side: 1,
  // Experimental: what bots notice ('classic' | 'sight') and fog of war ('off' | 'on').
  botVision: 'classic', fog: 'off',
  // Classes ('on' | 'off'), as last chosen for each mode (conquest and rush start on).
  classesByMode: {},
  // Settings screen
  // (graphicsPicked: graphics was chosen in Settings, not just the default saved.)
  graphics: 'canvas', graphicsPicked: false, fpsCap: 'auto', showFps: false, showPing: true,
  sprint: 'hold', // Shift: 'hold' to sprint, or 'toggle' it on and off
};

function loadSettings() {
  let s;
  try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('stick-soldiers') || '{}') }; }
  catch { s = { ...DEFAULTS }; }
  if (!SHOW_SPEED_MENU) s.speed = DEFAULT_SPEED; // ignore speeds saved before the picker was hidden
  if (!MODES[s.mode]) s.mode = 'ffa';
  // Draw with the canvas unless WebGL or Auto was picked in Settings (earlier visits
  // saved the old default, Auto, without anyone choosing it).
  if (!s.graphicsPicked) s.graphics = 'canvas';
  return s;
}
function saveSettings(s) {
  try { localStorage.setItem('stick-soldiers', JSON.stringify(s)); } catch { /* private mode */ }
}
function rememberMenu() {
  const s = { ...loadSettings(), ...readMenu(), tab: state.tab, mapSource: mapSource() };
  saveSettings(s);
}

// Guns with at least this many updates between shots (about half a second) show the reload ring between them.
const SLOW_GUN = 35;

// The player's controls follow the Settings screen (read each update, so changes apply mid-match).
const playerOptions = { sprintMode: () => prefs.sprint };

const playerName = () => ($('name').value.trim() || 'Player').slice(0, 14);

// ---- Menu ---------------------------------------------------------------------

// The bots slider: one at a time up to 10, then bigger steps, up to 4,000 (for testing huge battles).
const BOT_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000];
const botsChosen = () => BOT_STEPS[+$('bots').value] ?? 5;
function showBots() {
  $('botsOut').textContent = botsChosen();
  $('botsNote').classList.toggle('hidden', botsChosen() < 300);
}

function buildMenu(settings) {
  $('name').value = settings.name;
  $('bots').max = BOT_STEPS.length - 1;
  $('bots').value = BOT_STEPS.reduce((best, n, i) => (Math.abs(n - settings.bots) < Math.abs(BOT_STEPS[best] - settings.bots) ? i : best), 0);
  showBots();
  $('difficulty').value = settings.difficulty;
  $('fragLimit').value = String(settings.fragLimit);
  $('lives').value = String(settings.lives);
  $('gunKills').value = String(settings.gunKills);
  $('crates').value = settings.crates;
  $('destruction').value = settings.destruction === 'off' ? 'off' : 'on';
  $('maxPlayers').value = String(settings.maxPlayers);
  $('visibility').value = settings.visibility;
  $('gameName').value = settings.gameName;
  $('speed').value = String(SPEEDS.includes(settings.speed) ? settings.speed : DEFAULT_SPEED);
  $('speedField').classList.toggle('hidden', !SHOW_SPEED_MENU);
  $('mode').value = settings.mode;
  $('side').value = String(settings.side === 2 ? 2 : 1);
  $('botVision').value = settings.botVision === 'sight' ? 'sight' : 'classic';
  $('fog').value = settings.fog === 'on' ? 'on' : 'off';
  $('playClass').innerHTML = CLASS_IDS.map(c => `<option value="${c}">${CLASSES[c].name}</option>`).join('');
  $('playClass').value = profile.cls;
  $('playClass').addEventListener('change', () => { profile.cls = $('playClass').value; saveKit(profile); });
  // (Remembered for this mode first: modeFields() shows the choice remembered for the mode.)
  $('classes').addEventListener('change', () => { rememberMenu(); modeFields(); });
  $('mute').checked = settings.muted;
  audio.setMuted(settings.muted);
  $('bots').addEventListener('input', showBots);
  $('mode').addEventListener('change', () => {
    modeFields();
    rememberMenu();
    // The best maps for the new mode go to the top.
    buildMapCards(selectedMap());
    $('maps').scrollTop = 0;
  });
  for (const r of document.querySelectorAll('input[name=mapSource]')) {
    r.checked = r.value === settings.mapSource;
    r.addEventListener('change', () => { buildMapCards(selectedMap()); rememberMenu(); });
  }
  for (const id of ['difficulty', 'fragLimit', 'goal', 'side', 'botVision', 'fog', 'lives', 'gunKills', 'crates', 'destruction', 'maxPlayers', 'visibility', 'name', 'gameName']) $(id).addEventListener('change', rememberMenu);
  $('bots').addEventListener('change', rememberMenu);
  modeFields();
  buildMapCards(settings.map, { follow: true });
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) $('pointer-note').classList.remove('hidden');
}

/** Show the options that matter for the chosen mode. */
function modeFields() {
  const mode = $('mode').value, m = MODES[mode];
  $('modeBlurb').textContent = m.blurb;
  show('fragField', m.limit === 'frags');
  show('goalField', m.limit === 'goal');
  if (m.goal) {
    // Points to win, captures or tickets: the choice last made for this mode.
    const saved = loadSettings().goals?.[mode];
    $('goalLabel').textContent = m.goal.label;
    $('goal').innerHTML = m.goal.options.map(v => `<option value="${v}">${v === 0 ? 'Auto' : v}</option>`).join('');
    $('goal').value = String(m.goal.options.includes(saved) ? saved : m.goal.value);
  }
  show('sideField', !!m.teams);
  $('side').options[0].textContent = mode === 'rush' ? 'Blue (attack)' : 'Blue';
  $('side').options[1].textContent = mode === 'rush' ? 'Red (defend)' : 'Red';
  show('livesField', mode === 'oitc');
  show('gunField', mode === 'gungame');
  show('crateField', m.crates);
  // Classes: offered unless the mode hands out its own weapons; the choice last made for this
  // mode (or the mode's default). The "Your class" choice only matters with them on.
  const classes = CLASSES_ON && m.classes !== false;
  show('classesField', classes);
  if (classes) {
    const saved = loadSettings().classesByMode?.[mode];
    $('classes').value = saved === 'on' || saved === 'off' ? saved : m.classesDefault ? 'on' : 'off';
  }
  const on = classes && $('classes').value === 'on';
  show('classField', on);
  show('classesNote', on);
}

function showTab(tab) {
  state.tab = tab;
  $('tabOnline').setAttribute('aria-pressed', String(tab === 'online'));
  $('tabOffline').setAttribute('aria-pressed', String(tab !== 'online'));
  show('online', tab === 'online');
  show('setup', tab !== 'online');
  if (tab === 'online') { startWatching(); setupFor('offline', false); }
  else { stopWatching(); setupFor(tab === 'host' ? 'host' : 'offline'); }
}

/** The setup screen is used for both offline games and hosting online. */
function setupFor(kind, visible = true) {
  state.setupFor = kind;
  const host = kind === 'host';
  show('hostHead', host);
  show('hostFields', host);
  $('play').textContent = host ? 'Host game' : 'Play';
  $('gameName').placeholder = `${playerName()}'s game`;
  if (visible) { show('online', false); show('setup', true); }
}

const mapSource = () => document.querySelector('input[name=mapSource]:checked')?.value || 'originals';
const sourceOf = key => (key?.startsWith('custom:') ? 'mine' : key?.startsWith('community:') ? 'community' : 'originals');
const selectedMap = () => $('maps').querySelector('.map-card[aria-checked="true"]')?.dataset.key || state.selectedMap;

/**
 * Map cards for the chosen source: the 8 originals, your maps (+ "new map"), or community uploads.
 * follow: switch to the source the selected map is in (otherwise keep the source the player picked).
 */
function buildMapCards(selected, { follow = false } = {}) {
  if (follow && selected && sourceOf(selected) !== mapSource()) {
    for (const r of document.querySelectorAll('input[name=mapSource]')) r.checked = r.value === sourceOf(selected);
  }
  const source = mapSource();
  const box = $('maps');
  box.innerHTML = '';
  show('mapsNote', false);
  let cards = [];
  if (source === 'originals') {
    // Best for the chosen mode first.
    const mode = $('mode').value;
    cards = maps.index
      .map((m, i) => ({ m, i, fit: mapFit(m, mode) }))
      .sort((a, b) => a.fit - b.fit || a.i - b.i)
      .map(({ m }) => ({
        key: m.file, name: m.name, label: mapLabel(m), mode: m.mode, modes: m.modes, players: m.players, data: maps.data.get(m.file),
        madeFor: m.modes?.[0] === mode ? MODE_SHORT[mode] : null,
      }));
  } else if (source === 'mine') {
    cards = listMaps().map(m => ({ key: `custom:${m.id}`, id: m.id, name: m.name, label: 'Your map', data: m.data }));
  } else {
    if (!state.communityLoaded) { loadCommunity(); note('Loading community maps…'); }
    cards = [...maps.community.values()].map(e => ({ key: `community:${e.key}`, entry: e, name: e.name, label: `by ${e.author}`, data: e.data }));
    if (state.communityLoaded && !cards.length) note('No community maps yet. Make one in the map maker and upload it!');
  }
  if (selected && cards.some(c => c.key === selected)) state.selectedMap = selected;
  else if (!cards.some(c => c.key === state.selectedMap)) state.selectedMap = cards[0]?.key || state.selectedMap;
  for (const c of cards) {
    const card = document.createElement('div');
    card.className = 'map-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'radio');
    card.dataset.key = c.key;
    card.setAttribute('aria-checked', String(c.key === state.selectedMap));
    const extra = c.id ? '<button type="button" class="edit">Edit</button>'
      : c.entry ? `<button type="button" class="save" title="${c.entry.mine ? 'Remove your upload' : 'Save a copy to your maps'}">${c.entry.mine ? 'Remove' : 'Save'}</button>` : '';
    card.innerHTML = `<canvas width="300" height="116"></canvas><span>${esc(c.name)}</span><small class="by">${esc(c.label)}</small>${extra}` +
      (c.madeFor ? `<b class="made-for">Made for ${esc(c.madeFor)}</b>` : '');
    const pick = () => {
      for (const el of box.querySelectorAll('.map-card')) el.setAttribute('aria-checked', String(el === card));
      state.selectedMap = c.key;
      // New maps switch to the mode they're made for, unless it's already one of their best two
      // (originals: team maps switch free-for-all to team deathmatch).
      if (c.modes?.length ? !c.modes.slice(0, 2).includes($('mode').value) : c.mode === 'team' && $('mode').value === 'ffa') { $('mode').value = c.mode; modeFields(); }
      // Big maps feel empty with a handful of bots: start at the map's smallest player count.
      const least = parseInt(c.players, 10);
      if (least > 1 && botsChosen() < least - 1) {
        $('bots').value = BOT_STEPS.findIndex(n => n >= least - 1);
        showBots();
      }
      audio.unlock();
      audio.play('menuMove');
      rememberMenu();
    };
    card.addEventListener('click', pick);
    card.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); pick(); } });
    card.querySelector('.edit')?.addEventListener('click', e => { e.stopPropagation(); openEditor(getMap(c.id)); });
    card.querySelector('.save')?.addEventListener('click', e => { e.stopPropagation(); communityAction(c.entry); });
    box.appendChild(card);
    const cv = card.querySelector('canvas');
    if (c.data) drawPreview(cv, c.data);
    else if (c.entry) decodeCommunity(c.entry).then(d => { if (d) drawPreview(cv, d); }).catch(() => {});
  }
  if (source === 'mine') {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'map-card new-map';
    add.textContent = '+ Make a new map';
    add.addEventListener('click', () => openEditor(null));
    box.appendChild(add);
  }
  function note(text) { $('mapsNote').textContent = text; show('mapsNote', true); }
}

async function loadCommunity() {
  if (state.communityLoading) return;
  state.communityLoading = true;
  try {
    community ||= new Community();
    const list = await community.list();
    maps.community.clear();
    for (const e of list) maps.community.set(e.key, e);
  } catch (e) {
    toast(`Couldn't load community maps: ${e.message}`);
  } finally {
    state.communityLoaded = true;
    state.communityLoading = false;
    if (mapSource() === 'community') buildMapCards(selectedMap());
  }
}

async function decodeCommunity(entry) {
  if (entry.data) return entry.data;
  if (!entry.decoding) entry.decoding = decodeShare(entry.code).then(d => (entry.data = d)).catch(() => null);
  return entry.decoding;
}

async function communityAction(entry) {
  if (entry.mine) {
    if (!confirm(`Take "${entry.name}" down from the community maps?`)) return;
    try { await community.remove(entry); maps.community.delete(entry.key); buildMapCards(selectedMap()); toast('Removed'); }
    catch (e) { toast(`Couldn't remove it: ${e.message}`); }
    return;
  }
  const data = await decodeCommunity(entry);
  if (!data) { toast("That map couldn't be loaded"); return; }
  const rec = saveMap({ name: data.name, data });
  toast(rec ? `Saved "${data.name}" to your maps` : "Couldn't save: this browser's storage is full");
}

/** The map data for a menu key: { data, navKey, name, ref } where ref tells online players how to get it. */
async function mapDataFor(key) {
  if (key?.startsWith('custom:')) {
    const rec = getMap(key.slice(7));
    if (rec) return { data: rec.data, navKey: `${key}@${rec.updated}`, name: rec.name, custom: true };
  }
  if (key?.startsWith('community:')) {
    const e = maps.community.get(key.slice(10));
    const data = e && await decodeCommunity(e);
    if (data) return { data, navKey: key, name: data.name, custom: true };
  }
  const file = maps.data.has(key) ? key : maps.index[0].file;
  return { data: maps.data.get(file), navKey: file, name: maps.index.find(m => m.file === file)?.name || file, builtin: file };
}

/** What a game map's card says: the original's kind, or a new map's size, players and best modes. */
function mapLabel(m) {
  if (!m.size) return `Original · ${m.mode === 'team' ? 'team map' : 'deathmatch'}`;
  const best = (m.modes || []).slice(0, 2).map(id => MODE_SHORT[id]).join(', ');
  return `${m.size[0].toUpperCase()}${m.size.slice(1)} · ${m.players} players · ${best}`;
}

// How well each size of map suits each mode (lower is better): big maps for Rush and Conquest,
// small ones for the rest. Originals are small arenas made for deathmatch.
const SIZE_FIT = {
  ffa: { original: 0, small: 0, medium: 1, large: 3 },
  gungame: { original: 0, small: 0, medium: 1, large: 3 },
  oitc: { original: 0, small: 0, medium: 1, large: 3 },
  team: { original: 0, small: 0, medium: 0.5, large: 2 },
  koth: { small: 0, medium: 1, original: 1.5, large: 2.5 },
  ctf: { small: 0, medium: 1, original: 1.5, large: 2.5 },
  conquest: { large: 0, medium: 1, small: 2.5, original: 3 },
  rush: { large: 0, medium: 1, small: 2.5, original: 3 },
};

/** How well a game map suits a mode (lower is better), for ordering the map list. */
function mapFit(m, mode) {
  let fit = SIZE_FIT[mode]?.[m.size || 'original'] ?? 0;
  if (m.modes) {
    // Made for this mode, or it's a close second.
    const i = m.modes.indexOf(mode);
    fit += i === 0 ? -1 : i === 1 ? -0.5 : i < 0 ? 1 : 0;
  } else if (m.mode === mode) fit -= 0.5; // (Two Towers, for team games)
  return fit;
}

/** The match limit for the chosen mode: frags, or the objective modes' goal (0 = the mode's own). */
const limitOf = s => (MODES[s.mode]?.limit === 'goal' ? (s.goal ?? 0) : s.fragLimit);

function readMenu() {
  const mode = $('mode').value;
  const goals = { ...(loadSettings().goals || {}) };
  if (MODES[mode]?.goal) goals[mode] = +$('goal').value;
  const classesByMode = { ...(loadSettings().classesByMode || {}) };
  const classesOffered = CLASSES_ON && MODES[mode]?.classes !== false;
  if (classesOffered) classesByMode[mode] = $('classes').value === 'on' ? 'on' : 'off';
  return {
    name: playerName(),
    map: selectedMap() || maps.index[0]?.file,
    mode,
    bots: botsChosen(),
    difficulty: $('difficulty').value,
    fragLimit: +$('fragLimit').value,
    goal: MODES[mode]?.goal ? +$('goal').value : 0,
    goals,
    side: +$('side').value === 2 ? 2 : 1,
    botVision: $('botVision').value,
    fog: $('fog').value,
    classes: classesOffered && $('classes').value === 'on' ? 'on' : 'off',
    classesByMode,
    lives: +$('lives').value,
    gunKills: +$('gunKills').value,
    crates: $('crates').value,
    destruction: $('destruction').value,
    speed: SHOW_SPEED_MENU && SPEEDS.includes(+$('speed').value) ? +$('speed').value : DEFAULT_SPEED,
    muted: $('mute').checked,
    maxPlayers: +$('maxPlayers').value,
    visibility: $('visibility').value,
    gameName: $('gameName').value.trim(),
  };
}

/** Small black-and-white outline of a map for the menu. */
function drawPreview(cv, data) {
  const ctx = cv.getContext('2d');
  const b = data.bounds;
  const s = Math.min((cv.width - 16) / (b.right - b.left), (cv.height - 16) / (b.bottom - b.top));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(s, 0, 0, s, cv.width / 2 - ((b.left + b.right) / 2) * s, cv.height / 2 - ((b.top + b.bottom) / 2) * s);
  const e = 1.4 / s;
  ctx.fillStyle = '#111';
  for (const p of data.platforms) ctx.fillRect(p.left - e, p.top - e, p.right - p.left + 2 * e, p.bottom - p.top + 2 * e);
  ctx.fillStyle = '#fff';
  for (const p of data.platforms) ctx.fillRect(p.left, p.top, p.right - p.left, p.bottom - p.top);
  // No hairlines where platforms just meet.
  fillSeams(seamsOf(data.platforms.map(p => ({ l: p.left, t: p.top, r: p.right, b: p.bottom }))), e, (x, y, w, h) => ctx.fillRect(x, y, w, h));
  ctx.fillStyle = '#cfe0a8';
  for (const p of data.platforms) if (p.bounce) ctx.fillRect(p.left, p.top, p.right - p.left, p.bottom - p.top);
}

function show(id, on) { $(id).classList.toggle('hidden', !on); }

// ---- Matches (offline, and hosting) ----------------------------------------------

function addBot(game, nav, settings, rng) {
  const used = new Set(game.soldiers.map(s => s.name.toLowerCase()));
  const p = BOT_PROFILES.find(b => !used.has(b.name.toLowerCase())) || BOT_PROFILES[game.soldiers.length % BOT_PROFILES.length];
  let team = 0;
  if (game.rules.teams) {
    const n = t => game.soldiers.filter(s => s.team === t).length;
    team = n(1) <= n(2) ? 1 : 2;
  }
  game.addSoldier({ name: used.has(p.name.toLowerCase()) ? `${p.name}${game.soldiers.length}` : p.name, isBot: true, team, profile: p },
    new BotController(nav, settings.difficulty, p, rng));
}

/** Start a match. online: host it (other players can join). */
async function startMatch(settings, { returnTo = 'menu', online = false } = {}) {
  state.settings = settings;
  state.returnTo = returnTo;
  if (returnTo === 'menu') saveSettings({ ...loadSettings(), ...settings, tab: state.tab, mapSource: mapSource() });
  show('menu', false); show('pause', false); show('over', false); show('connecting', false);
  $('toEditor').classList.toggle('hidden', returnTo !== 'editor');
  $('toMenu').textContent = returnTo === 'editor' ? 'Back to map maker' : 'Menu';
  show('loading', true);
  const map = await mapDataFor(settings.map);
  // Let the loading message paint before building the bots' route map.
  await new Promise(r => setTimeout(r, 30));
  const options = {
    lives: settings.lives, gunGameKills: settings.gunKills, crates: settings.crates,
    botVision: settings.botVision === 'sight' ? 'sight' : 'classic', fog: settings.fog === 'on',
    destruction: settings.destruction !== 'off',
    classes: CLASSES_ON && settings.classes === 'on' && MODES[settings.mode]?.classes !== false,
  };
  const game = new Game({ mapData: map.data, mode: settings.mode, fragLimit: limitOf(settings), speed: settings.speed, options, seed: (Math.random() * 2 ** 31) | 0 });
  state.step = 1000 / game.tickRate;
  // Route maps depend on the map version and the speed's move timings. (Built on a
  // fresh copy of the map: when the map can change (holes, building), the match works
  // on a copy of the route map, and its own map changes.)
  const navKey = `${map.navKey}@${settings.speed}`;
  if (!maps.nav.has(navKey)) maps.nav.set(navKey, new NavGraph(new GameMap(map.data)));
  const nav = game.useNav(maps.nav.get(navKey));
  const rng = makeRng((Math.random() * 2 ** 31) | 0);

  const team = game.rules.teams ? (settings.side === 2 ? 2 : 1) : 0;
  state.me = game.addSoldier({ name: settings.name, isBot: false, team }, new PlayerController(input, () => renderer, playerOptions));

  if (online) {
    state.mode = 'host';
    await hostMatch(game, settings, map, nav, rng);
  } else {
    state.mode = 'offline';
    for (let i = 0; i < settings.bots; i++) addBot(game, nav, settings, rng);
  }
  enterMatch(game, state.me);
  show('loading', false);
}

function enterMatch(game, me) {
  const b = game.map.bounds;
  renderer.snapCamera((b.left + b.right) / 2, (b.top + b.bottom) / 2);
  state.game = game;
  state.me = me;
  state.paused = false;
  state.menuOpen = false;
  state.overShown = false;
  state.nextMatchAt = 0;
  state.acc = 0;
  state.last = performance.now();
  input.clear();
  input.enabled = true;
  document.body.classList.add('playing');
  show('pause', false); show('over', false); show('menu', false); show('connecting', false); show('loading', false);
  // Classes on: our class and loadouts on our soldier (online: sent to the host).
  state.pickerOpen = false;
  show('classPicker', false);
  syncKit(false);
  // Spectating carries on into the next match (online, the host remembers it for us).
  state.spec = { id: null, free: false, x: 0, y: 0 };
  if (state.spectating && state.mode !== 'client') game.spectate(me, true, { quiet: true });
  canvas.focus?.();
}

function endMatch(to = state.returnTo) {
  closePicker();
  state.game = null;
  state.spectating = false;
  state.mode = 'offline';
  state.menuOpen = false;
  input.enabled = false;
  closeChat();
  document.body.classList.remove('playing');
  show('pause', false); show('over', false); show('loading', false);
  if (to === 'editor') editor.resume();
  else showMenu();
}

function showMenu() {
  show('menu', true);
  buildMapCards(selectedMap(), { follow: true });
  if (state.tab === 'online') startWatching();
}

function openEditor(record) {
  stopWatching();
  show('menu', false);
  $('edMode').value = readMenu().mode;
  editor.open(record);
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 5000);
}

function setPaused(p) {
  if (!state.game || (state.game.over && p)) return;
  const online = state.mode !== 'offline';
  state.paused = online ? false : p;
  input.enabled = !p;
  if (p) input.clear();
  document.body.classList.toggle('playing', !p);
  $('pauseTitle').textContent = online ? 'Menu' : 'Paused';
  show('pauseNote', online);
  show('invite', state.mode === 'host');
  show('restart', state.mode !== 'client');
  show('changeClass', !!state.game?.classesOn);
  $('spectate').textContent = state.me?.spectating ? 'Join game' : 'Spectate';
  $('quit').textContent = state.mode === 'host' ? 'End game for everyone' : state.mode === 'client' ? 'Leave game' : 'Quit to menu';
  state.menuOpen = p;
  show('pause', p);
  state.last = performance.now();
}

// ---- Spectating ---------------------------------------------------------------------------

/** Sit out and watch (from the menu), or join the game again. */
function setSpectating(on) {
  const g = state.game, me = state.me;
  if (!g || !me || g.over) return;
  state.spectating = on;
  if (state.mode === 'client') state.net?.client?.sendSpectate(on);
  else g.spectate(me, on);
  state.spec = { id: null, free: false, x: renderer.cam.x, y: renderer.cam.y };
  setPaused(false);
}

/** Watching (spectating, or out of lives): who there is to watch, in a steady order. */
const watchable = (g, me) => g.soldiers.filter(s => s.alive && s !== me && !s.spectating);

/** Who the camera follows: the one picked, while they're alive, otherwise the leader. */
function watchTarget(g, me) {
  const list = watchable(g, me);
  let t = list.find(s => s.id === state.spec.id);
  if (!t) {
    t = g.standings().find(s => list.includes(s)) || null;
    state.spec.id = t?.id ?? null;
  }
  return t;
}

/** A/D or a click while watching: the next (or previous) one to follow. */
function cycleWatch(dir) {
  const g = state.game, me = state.me, list = watchable(g, me);
  if (!list.length) return;
  if (state.spec.free) {
    // From the free camera: whoever's nearest the middle of the screen.
    const c = renderer.cam;
    state.spec.id = list.reduce((a, b) => (Math.hypot(b.x - c.x, b.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? b : a)).id;
    state.spec.free = false;
    return;
  }
  const i = list.findIndex(s => s.id === state.spec.id);
  state.spec.id = list[(i + dir + list.length) % list.length].id;
}

/** Space while spectating: a free camera (WASD), starting where the camera is. */
function toggleFreeCam() {
  const sp = state.spec;
  if (sp.free) { cycleWatch(0); return; }
  sp.free = true;
  sp.x = renderer.cam.x;
  sp.y = renderer.cam.y + 20;
}

/** The free camera moves with WASD or the arrow keys (Shift: faster), and stays over the map. */
function moveFreeCam(g, dt) {
  const sp = state.spec;
  if (!state.menuOpen && !state.chatOpen) {
    const speed = (input.down('ShiftLeft', 'ShiftRight') ? 1600 : 650) * dt / 1000;
    sp.x += ((input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0)) * speed;
    sp.y += ((input.down('KeyS', 'ArrowDown') ? 1 : 0) - (input.down('KeyW', 'ArrowUp') ? 1 : 0)) * speed;
  }
  const b = g.map.bounds;
  sp.x = Math.max(b.left, Math.min(b.right, sp.x));
  sp.y = Math.max(b.top, Math.min(b.bottom, sp.y));
  return sp;
}

// ---- Classes ----------------------------------------------------------------------------

/** The class and loadouts we play with. */
const kitChoice = () => ({ cls: profile.cls, loadouts: profile.loadouts });

/**
 * Classes on: our class and loadouts onto our soldier, for the next spawn (online, the
 * host is told). hold: we're choosing a class while dead, so the respawn waits.
 */
function syncKit(hold = state.pickerOpen) {
  const g = state.game, me = state.me;
  if (!g?.classesOn || !me) return;
  const kit = kitChoice();
  me.pickCls = kit.cls; // (online, only for our own screen: "Next life: Recon")
  if (state.mode === 'client') { state.net?.client?.sendKit({ ...kit, hold: !!hold && !me.alive }); return; }
  me.loadouts = kit.loadouts;
  holdSpawn(me, !!hold);
}

/** A message on our own screen only. */
function localNote(text) {
  const g = state.game;
  if (g && state.me) g.notes.push({ text, tick: g.tick, to: state.me.id });
}

/** The class picker (C while waiting to respawn, or the pause menu's Change class). */
function openPicker() {
  const g = state.game;
  if (!g?.classesOn || g.over || state.pickerOpen) return;
  state.pickerOpen = true;
  input.enabled = false;
  input.clear();
  drawPicker();
  show('classPicker', true);
  syncKit(true);
}

function drawPicker() {
  renderPicker($('pickerCards'), profile, { current: state.me?.cls, next: profile.cls });
}

function closePicker() {
  if (!state.pickerOpen) return;
  state.pickerOpen = false;
  show('classPicker', false);
  show('loadout', false);
  syncKit(false);
  if (state.game && !state.menuOpen && !state.chatOpen && !state.game.over) input.enabled = true;
}

/** Choose the class to spawn as next (and from now on). */
function pickClass(cls) {
  if (!CLASSES[cls]) return;
  profile.cls = cls;
  saveKit(profile);
  $('playClass').value = cls;
  if (state.me?.alive) localNote(`You'll spawn as ${CLASSES[cls].name} next time`);
  closePicker();
}

/** The Loadout screen (main menu, or from the class picker). */
function openLoadout() {
  renderLoadout($('loadoutBody'), profile, {
    onChange: () => {
      saveKit(profile);
      $('playClass').value = profile.cls;
      syncKit();
      if (state.pickerOpen) drawPicker();
    },
  });
  show('loadout', true);
  $('loadoutDone').focus();
}

function closeLoadout() { show('loadout', false); }

// ---- Settings screen -----------------------------------------------------------------

function savePrefs() { saveSettings({ ...loadSettings(), ...prefs }); }

function openSettings() {
  // Experimental: the same choices as the game setup's.
  $('setBotVision').value = $('botVision').value;
  $('setFog').value = $('fog').value;
  $('graphics').value = prefs.graphics;
  $('sprintMode').value = prefs.sprint === 'toggle' ? 'toggle' : 'hold';
  $('fpsCap').value = String(prefs.fpsCap);
  $('showFps').checked = prefs.showFps;
  $('showPing').checked = prefs.showPing;
  settingsNotes();
  show('settings', true);
  $('settingsDone').focus();
}

function closeSettings() {
  show('settings', false);
}

/** The notes under the settings: what's being used right now. */
function settingsNotes() {
  const auto = autoGraphics();
  $('graphics').options[0].textContent = `Auto (${auto === 'webgl' ? 'WebGL' : 'Canvas'})`;
  let g = renderer.kind === 'webgl' ? 'Drawing with WebGL, on the graphics card.' : 'Drawing with the canvas.';
  if (prefs.graphics === 'webgl' && renderer.kind !== 'webgl') g += " WebGL isn't available in this browser.";
  else if (prefs.graphics === 'auto' && auto === 'canvas') g += ' WebGL would run without a graphics card here, which is slower.';
  $('graphicsNote').textContent = g;
  const hz = pacer.refresh, target = Math.round(pacer.target);
  $('fpsCap').options[0].textContent = pacer.mode === 'auto' ? `Auto (${target} fps)` : 'Auto';
  let f = `Your screen refreshes ${hz} times a second, so that's the most it can show.`;
  if (pacer.mode === 'auto') f += pacer.divisor > 1 ? ` Auto is drawing ${target} fps: your computer couldn't keep up with ${hz}, and it'll try again soon.` : ' Auto matches it.';
  else if (pacer.mode > hz) f += ` ${pacer.mode} fps needs a faster screen.`;
  $('fpsNote').textContent = f;
}

/** Switch between WebGL and canvas drawing (from Settings), even mid-match. */
let switching = false, nextChoice = null;
async function setGraphics(choice) {
  if (switching) { nextChoice = choice; return; } // (picked again while switching: do that next)
  const want = choice === 'auto' ? autoGraphics() : choice;
  if (renderer.kind === want) { settingsNotes(); return; }
  switching = true;
  try {
    const r = await createRenderer(canvas.cloneNode(false), want);
    if (r.kind === renderer.kind) { r.destroy(); return; } // WebGL failed, and we're already on the canvas
    r.cam = { ...renderer.cam };
    r.shake = renderer.shake;
    canvas.replaceWith(r.canvas);
    renderer.destroy();
    renderer = r;
    canvas = r.canvas;
    input.attach(canvas);
  } finally {
    switching = false;
    settingsNotes();
    if (nextChoice) { const c = nextChoice; nextChoice = null; setGraphics(c); }
  }
}

// ---- Online ------------------------------------------------------------------------

function getLobby() {
  if (!lobby) {
    lobby = new Lobby({ log: m => console.debug('[lobby]', m) });
    lobby.pool.onStatus(() => relayStatus());
  }
  return lobby;
}

function relayStatus() {
  if (!lobby) return;
  const { connected, total } = lobby.status();
  $('relayStatus').textContent = connected ? `Connected to ${connected} of ${total} game servers` : 'Connecting to the game servers…';
}

function startWatching() {
  if (watcher || $('menu').classList.contains('hidden')) return;
  renderGameList(null);
  watcher = getLobby().watch(renderGameList);
  relayStatus();
}

function stopWatching() { watcher?.stop(); watcher = null; }

const MODE_SHORT = {
  ffa: 'Free-for-all', team: 'Team', gungame: 'Gun game', oitc: 'One in the chamber',
  koth: 'King of the hill', ctf: 'Capture the flag', conquest: 'Conquest', rush: 'Rush',
};

function renderGameList(list) {
  const box = $('gameList');
  if (!list || !list.length) {
    box.innerHTML = `<div class="empty">${list ? 'No open games right now. Host one, or try Quick match: it starts a game for others to join.' : 'Looking for games…'}</div>`;
    return;
  }
  box.innerHTML = '';
  for (const g of list) {
    const row = document.createElement('div');
    const old = g.version !== PROTOCOL, full = g.players >= g.max;
    row.className = `game-row${full ? ' full' : ''}${old ? ' old' : ''}`;
    row.innerHTML = `<div><b>${esc(g.name)}</b><small>hosted by ${esc(g.hostName)}</small></div>
      <div class="hide-small">${esc(g.mapName)}</div>
      <div class="hide-small">${MODE_SHORT[g.mode]}</div>
      <div class="players">${g.players}/${g.max}<small>${g.bots ? ` +${g.bots} bots` : ''}</small></div>
      <button type="button"${old || full ? ' disabled' : ''}>${old ? 'Old version' : full ? 'Full' : 'Join'}</button>`;
    row.querySelector('button').addEventListener('click', () => joinGame(g));
    box.appendChild(row);
  }
}

function connecting(title, text = '', onCancel = null) {
  $('connTitle').textContent = title;
  $('connText').textContent = text;
  state.cancelConnect = onCancel;
  show('connecting', true);
}

async function hostMatch(game, settings, map, nav, rng) {
  const net = state.net?.role === 'host' ? state.net : (state.net = { role: 'host' });
  net.settings = settings;
  net.matchInfo = {
    mode: settings.mode, fragLimit: limitOf(settings), speed: settings.speed, mapName: map.name,
    options: game.options,
    map: map.builtin ? { builtin: map.builtin } : { code: await encodeShare(map.data) },
  };
  net.addBot = g => addBot(g, nav, settings, rng);
  if (!net.host) {
    net.host = new NetHost({
      maxPlayers: settings.maxPlayers, botCount: settings.bots,
      matchInfo: () => net.matchInfo,
      addBot: g => net.addBot(g),
      onChange: () => net.handle?.update(),
      onChat: m => addChat(m),
    });
  }
  net.host.opts.maxPlayers = settings.maxPlayers;
  net.host.opts.botCount = settings.bots;
  net.host.setGame(game);
  if (!net.handle) {
    const l = getLobby();
    net.handle = l.host({
      info: () => ({
        name: settings.gameName || `${settings.name}'s game`, hostName: settings.name, mapName: net.matchInfo.mapName,
        mode: settings.mode, players: net.host.humans, max: settings.maxPlayers, bots: game.soldiers.filter(s => s.isBot).length,
        private: settings.visibility === 'private',
      }),
      accept: () => (net.host.humans >= net.host.opts.maxPlayers ? 'That game is full' : null),
      onPlayer: (link, name) => net.host.addPlayer(link, name),
    });
    l.pool.ready(1, 6000).then(ok => { if (!ok && state.net === net) toast("Couldn't reach the game servers yet, so nobody can find your game. Still trying…"); });
    addChat({ system: true, text: settings.visibility === 'private' ? 'Your game is invite-only: press Esc to copy the invite link.' : 'Your game is listed. Press Esc to copy an invite link.' });
  } else {
    net.handle.update();
  }
}

function inviteLink() {
  const h = state.net?.handle;
  return h ? `${location.origin}${location.pathname}#join=${inviteCode(h.invite)}` : '';
}

async function joinGame(target) {
  audio.unlock();
  stopWatching();
  let cancelled = false;
  connecting(`Joining ${target.name || 'game'}`, 'Connecting to the host…', () => { cancelled = true; });
  try {
    const link = await getLobby().join(target, playerName());
    if (cancelled) { link.close('cancelled'); return; }
    startClient(link);
  } catch (e) {
    if (cancelled) return;
    show('connecting', false);
    showMenu();
    toast(e.message);
  }
}

async function quickMatch() {
  audio.unlock();
  stopWatching();
  let cancelled = false;
  connecting('Quick match', 'Looking for games…', () => { cancelled = true; });
  try {
    const res = await getLobby().quickMatch(playerName(), text => { $('connText').textContent = text; });
    if (cancelled) { res?.link.close('cancelled'); return; }
    if (res) { startClient(res.link); return; }
    $('connText').textContent = 'No open games, so starting one for others to join…';
    const s = { ...readMenu(), visibility: 'public', gameName: '' };
    if (sourceOf(s.map) !== 'originals') s.map = maps.index[Math.floor(Math.random() * maps.index.length)].file;
    await startMatch(s, { online: true });
  } catch (e) {
    if (cancelled) return;
    show('connecting', false);
    showMenu();
    toast(e.message);
  }
}

function startClient(link) {
  const net = state.net = { role: 'client' };
  net.client = new NetClient({
    link,
    controller: new PlayerController(input, () => renderer, playerOptions),
    loadMap: async m => {
      if (m.map?.builtin && maps.data.has(m.map.builtin)) return maps.data.get(m.map.builtin);
      if (m.map?.code) return decodeShare(m.map.code);
      throw new Error('unknown map');
    },
    onStart: (game, me) => {
      state.mode = 'client';
      state.returnTo = 'menu';
      state.step = 1000 / game.tickRate;
      enterMatch(game, me);
    },
    onEnd: reason => {
      if (state.net !== net) return;
      state.net = null;
      show('connecting', false);
      endMatch('menu');
      if (reason) toast(reason);
    },
    onChat: m => addChat(m),
  });
  $('connText').textContent = 'Connected. Loading the match…';
}

/** Leave whatever online game we're in. */
function leaveOnline() {
  const net = state.net;
  state.net = null;
  if (!net) return;
  if (net.role === 'host') { net.handle?.close(); net.host?.close(); }
  if (net.role === 'client') net.client?.leave();
}

// ---- Chat ----------------------------------------------------------------------------

function addChat(m) {
  state.chat.push({ name: m.name || '', text: m.text, system: !!m.system, time: performance.now() });
  if (state.chat.length > 30) state.chat.shift();
  if (!m.system) audio.play('chat');
}

function openChat() {
  if (state.mode === 'offline' || state.chatOpen) return;
  state.chatOpen = true;
  input.enabled = false;
  input.clear();
  show('chatForm', true);
  $('chatInput').value = '';
  $('chatInput').focus();
}

function closeChat() {
  if (!state.chatOpen) return;
  state.chatOpen = false;
  show('chatForm', false);
  $('chatInput').blur();
  if (state.game && !state.menuOpen) input.enabled = true;
}

function sendChat(text) {
  text = text.trim();
  if (!text) return;
  if (state.net?.role === 'host') state.net.host.chat(state.settings.name, text);
  else if (state.net?.role === 'client') state.net.client.sendChat(text);
}

// ---- Loop ------------------------------------------------------------------------------

/** Run the game forward to `now` in fixed steps (60 a second). */
function simulate(now) {
  const g = state.game;
  if (!g) { state.last = now; return; }
  let dt = now - state.last;
  state.last = now;
  if (dt > 1000) dt = 1000;
  if (state.paused) return;
  state.acc += dt;
  let n = 0;
  const started = performance.now();
  while (state.acc >= state.step && n++ < 90) {
    if (state.mode === 'client') state.net?.client?.tick();
    else { g.update(); state.net?.host?.afterTick(); }
    state.acc -= state.step;
    perf.updates++;
    // Too much to do (thousands of bots): run in slow motion rather than freeze the page.
    if (performance.now() - started > 50) { state.acc = 0; break; }
  }
  if (n >= 90) state.acc = 0;
}

// The game updates 60 times a second; frames are drawn as often as the screen
// refreshes (60, 120, 144 Hz...), with everything drawn in between updates.
function frame(now) {
  requestAnimationFrame(frame);
  // The frame rate setting: skip this screen refresh if it's too soon to draw again.
  if (!pacer.frame(now, !!state.game)) return;
  const workStart = performance.now();
  const dt = Math.min(100, Math.max(0, now - (state.frameAt ?? now)));
  state.frameAt = now;
  simulate(now);
  if (!$('settings').classList.contains('hidden') && now - (state.notesAt || 0) > 500) { state.notesAt = now; settingsNotes(); }
  const g = state.game;
  if (!g) {
    // Nothing playing: keep the canvas blank behind the menus.
    renderer.clear();
    return;
  }
  const client = state.mode === 'client' ? state.net?.client : null;
  if (client) client.updateView(now);
  const alpha = state.paused ? 1 : Math.min(1, state.acc / state.step);
  const me = state.me;

  // Spectating, or out of lives: watch someone else (or, spectating, look around freely).
  const watchMode = !!me.spectating || (!me.alive && !g.rules.canRespawn(g, me));
  let view = me, watching = null, free = null;
  if (watchMode) {
    if (me.spectating && state.spec.free) free = moveFreeCam(g, dt);
    else { watching = watchTarget(g, me); if (watching) view = watching; }
  }
  renderer.noFog = !!free;

  // Fog of war: sounds from places you can't see show where they came from.
  if (g.options.fog && !free) renderer.fog?.hear(g.sounds, view);
  const ear = free || view;
  audio.playQueue(g.sounds, ear.x, ear.y, me.id, me.team);
  g.sounds.length = 0;

  const sniping = me.alive && me.current === 'SR' && input.mouse.right && !state.menuOpen && !state.chatOpen;
  const ax = free ? free.x : lerp(view.prevX ?? view.x, view.x, alpha) + (view.drawDX || 0);
  const ay = free ? free.y : lerp(view.prevY ?? view.y, view.y, alpha) + (view.drawDY || 0);
  renderer.updateCamera(g, ax, ay, state.menuOpen || watchMode ? null : input.mouse, sniping, dt);
  const aimed = view === me ? liveAim(me, ax, ay) : null;
  const drawStart = performance.now();
  renderer.fogFrom = view;
  renderer.render(g, alpha, me);
  if (client) me.ping = client.ping;
  // Holding K to self-destruct: shown as it counts down (it goes off after a second).
  const holdingK = me.alive && input.down('KeyK') && !state.menuOpen && !state.chatOpen;
  state.destructSince = holdingK ? state.destructSince ?? now : null;
  drawHud(renderer, g, me, {
    selfDestruct: holdingK ? (now - state.destructSince) / 1000 : 0,
    showScores: input.down('Tab') && !state.chatOpen, watching, chat: state.chat,
    spectating: me.spectating ? { free: !!free, target: watching } : null,
    online: state.mode !== 'offline',
    hostId: state.mode === 'host' ? me.id : state.mode === 'client' ? g.soldiers.find(s => !s.isBot && !s.remote)?.id : null,
    ping: !prefs.showPing ? null : client ? client.ping : state.mode === 'host' ? 'Host' : null,
    perf: perf.on ? perf.text : null,
    picking: state.pickerOpen,
  });
  if (!state.menuOpen && !g.over && !state.chatOpen && !state.pickerOpen && !watchMode) {
    // Reloading: a ring round the crosshair fills up, complete when the gun's ready. That's
    // the pistol's magazine, and the wait between shots of slow guns (sniper rifle, rockets...).
    const gun = weaponFor(me, me.current);
    let reload = null;
    if (me.alive && gun) {
      if (gun.mag && me.reloadTimer > 0) reload = 1 - me.reloadTimer / gun.reload;
      else if (gun.rof >= SLOW_GUN && me.cooldown > 0) reload = 1 - me.cooldown / gun.rof;
    }
    renderer.drawCrosshair(input.mouse.x, input.mouse.y, sniping, reload);
  }
  renderer.present();
  if (aimed) { me.aim = aimed.aim; me.facing = aimed.facing; }
  const end = performance.now();
  if (perf.on) countFrame(now, end - drawStart);
  pacer.drawn(now + (end - workStart), end - workStart);
  if (g.over) matchOver(g);
}

/**
 * Between game updates, draw your gun pointing where the mouse is right now, so
 * aiming feels instant at any frame rate. (Only for drawing: shots use the aim
 * from the last update.) Returns the real aim and facing, to put back.
 */
function liveAim(me, x, y) {
  if (!me.alive || me.kamikaze || !input.enabled || state.paused || state.game.over) return null;
  const saved = { aim: me.aim, facing: me.facing };
  const w = renderer.screenToWorld(input.mouse.x, input.mouse.y);
  me.aim = Math.atan2(w.y - (me.shoulderY + y - me.y), w.x - x);
  const c = Math.cos(me.aim);
  if (Math.abs(c) > 0.05) me.facing = c < 0 ? -1 : 1;
  return saved;
}

// Frame rate readout (Settings -> Show frame rate, or ?fps in the address).
const perf = { on: params.has('fps'), text: null, at: 0, frames: 0, ms: 0, updates: 0 };

function countFrame(now, drawMs) {
  perf.frames++;
  perf.ms += drawMs;
  if (now - perf.at < 500) return;
  if (perf.at) {
    const secs = (now - perf.at) / 1000;
    const fps = Math.round(perf.frames / secs);
    const speed = Math.round((perf.updates / secs / 60) * 100);
    perf.text = `${renderer.kind === 'webgl' ? 'WebGL' : 'Canvas'} · ${fps} fps · ${(perf.ms / perf.frames).toFixed(1)} ms drawing`
      + (!state.paused && speed < 95 ? ` · game at ${speed}% speed` : '');
  }
  perf.at = now;
  perf.frames = 0;
  perf.ms = 0;
  perf.updates = 0;
}

function matchOver(g) {
  const now = performance.now();
  if (!state.overShown) {
    state.overShown = true;
    input.enabled = false;
    document.body.classList.remove('playing');
    state.overAt = now;
    if (state.mode === 'host') state.nextMatchAt = now + 12000;
    show('pause', false);
    state.menuOpen = false;
    show('again', state.mode !== 'client');
    closePicker();
    $('again').textContent = state.mode === 'host' ? 'Next match now' : 'Play again';
    $('toMenu').textContent = state.mode === 'host' ? 'End game' : state.mode === 'client' ? 'Leave' : state.returnTo === 'editor' ? 'Back to map maker' : 'Menu';
  }
  if (now - state.overAt > 1500) {
    show('over', true);
  }
  const noteEl = $('overNote');
  if (state.mode === 'host') {
    const left = Math.max(0, Math.ceil((state.nextMatchAt - now) / 1000));
    noteEl.textContent = `Next match in ${left}…`;
    show('overNote', true);
    if (now >= state.nextMatchAt && state.nextMatchAt) { state.nextMatchAt = 0; nextMatch(); }
  } else if (state.mode === 'client') {
    noteEl.textContent = 'The next match starts soon…';
    show('overNote', true);
  } else show('overNote', false);
}

function nextMatch() {
  const s = state.settings;
  startMatch(s, { returnTo: state.returnTo, online: state.mode === 'host' });
}

// Keep online games running in a background tab (browsers pause animation frames there).
function startBackgroundTicker() {
  try {
    // The worker only ticks while the tab is hidden.
    const src = 'let t = null; onmessage = e => { clearInterval(t); t = e.data ? setInterval(() => postMessage(0), 16) : null; };';
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = () => { if (document.hidden && state.game && state.mode !== 'offline') simulate(performance.now()); };
    document.addEventListener('visibilitychange', () => worker.postMessage(document.hidden));
    worker.postMessage(document.hidden);
  } catch { /* no workers: online games pause in background tabs */ }
}

// ---- Events ---------------------------------------------------------------------

function wire() {
  $('tabOnline').addEventListener('click', () => { showTab('online'); rememberMenu(); });
  $('tabOffline').addEventListener('click', () => { showTab('offline'); rememberMenu(); });
  $('openEditor').addEventListener('click', () => openEditor(listMaps()[0] || null));
  $('quickMatch').addEventListener('click', quickMatch);
  $('hostGame').addEventListener('click', () => { stopWatching(); setupFor('host'); });
  $('setupBack').addEventListener('click', () => showTab('online'));
  $('refreshGames').addEventListener('click', () => { watcher?.refresh(); renderGameList(null); setTimeout(() => watcher && renderGameList([...watcher.games.values()]), 2500); });
  $('play').addEventListener('click', () => {
    audio.unlock(); audio.play('menuSelect');
    startMatch(readMenu(), { online: state.setupFor === 'host' });
  });
  $('connCancel').addEventListener('click', () => {
    state.cancelConnect?.();
    leaveOnline();
    show('connecting', false);
    showMenu();
  });
  $('resume').addEventListener('click', () => setPaused(false));
  $('restart').addEventListener('click', () => nextMatch());
  $('quit').addEventListener('click', () => { leaveOnline(); endMatch('menu'); });
  $('invite').addEventListener('click', async () => {
    const link = inviteLink();
    try { await navigator.clipboard.writeText(link); toast('Invite link copied: send it to a friend'); }
    catch { prompt('Send this link to a friend:', link); }
  });
  $('toEditor').addEventListener('click', () => endMatch('editor'));
  $('again').addEventListener('click', () => { state.nextMatchAt = 0; nextMatch(); });
  $('toMenu').addEventListener('click', () => { if (state.mode !== 'offline') { leaveOnline(); endMatch('menu'); } else endMatch(); });
  $('openSettings').addEventListener('click', openSettings);
  $('openLoadout').addEventListener('click', openLoadout);
  $('loadoutDone').addEventListener('click', closeLoadout);
  $('changeClass').addEventListener('click', openPicker);
  $('spectate').addEventListener('click', () => setSpectating(!state.me?.spectating));
  $('pickerClose').addEventListener('click', closePicker);
  $('pickerLoadout').addEventListener('click', openLoadout);
  $('pickerCards').addEventListener('click', e => { const card = e.target.closest('[data-cls]'); if (card) pickClass(card.dataset.cls); });
  $('pauseSettings').addEventListener('click', openSettings);
  $('settingsDone').addEventListener('click', closeSettings);
  $('graphics').addEventListener('change', () => { prefs.graphics = $('graphics').value; prefs.graphicsPicked = true; savePrefs(); setGraphics(prefs.graphics); });
  $('fpsCap').addEventListener('change', () => { prefs.fpsCap = $('fpsCap').value; pacer.setMode(prefs.fpsCap); savePrefs(); settingsNotes(); });
  $('showFps').addEventListener('change', () => { prefs.showFps = $('showFps').checked; perf.on = prefs.showFps || params.has('fps'); savePrefs(); });
  $('showPing').addEventListener('change', () => { prefs.showPing = $('showPing').checked; savePrefs(); });
  $('sprintMode').addEventListener('change', () => { prefs.sprint = $('sprintMode').value === 'toggle' ? 'toggle' : 'hold'; savePrefs(); });
  // Mid-match, closing or leaving the page (Ctrl+W, say) asks first.
  window.addEventListener('beforeunload', e => {
    if (state.game && !state.game.over) { e.preventDefault(); e.returnValue = ''; }
  });
  // Experimental (the same choices as the game setup's, for the next game started or hosted).
  $('setBotVision').addEventListener('change', () => { $('botVision').value = $('setBotVision').value; rememberMenu(); });
  $('setFog').addEventListener('change', () => { $('fog').value = $('setFog').value; rememberMenu(); });
  $('mute').addEventListener('change', () => {
    audio.setMuted($('mute').checked);
    if (state.settings) { state.settings.muted = $('mute').checked; saveSettings({ ...loadSettings(), muted: $('mute').checked }); }
  });
  $('chatForm').addEventListener('submit', e => { e.preventDefault(); sendChat($('chatInput').value); closeChat(); });
  $('chatInput').addEventListener('keydown', e => { if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); closeChat(); } });

  window.addEventListener('keydown', e => {
    audio.unlock();
    if (state.chatOpen) return;
    if (!$('settings').classList.contains('hidden')) {
      if (e.code === 'Escape') { e.preventDefault(); closeSettings(); }
      return;
    }
    if (!$('loadout').classList.contains('hidden')) {
      if (e.code === 'Escape') { e.preventDefault(); closeLoadout(); }
      return;
    }
    if (state.pickerOpen) {
      // The class picker takes the number keys while it's open (not conquest's spawn choice).
      const k = /^Digit([1-4])$/.exec(e.code);
      if (k) { e.preventDefault(); pickClass(CLASS_IDS[+k[1] - 1]); }
      else if (e.code === 'Escape' || e.code === 'KeyC') { e.preventDefault(); closePicker(); }
      return;
    }
    if (!state.game) {
      if (e.code === 'Enter' && !$('menu').classList.contains('hidden') && !$('setup').classList.contains('hidden') && !/^(BUTTON|INPUT|SELECT)$/.test(document.activeElement?.tagName)) {
        startMatch(readMenu(), { online: state.setupFor === 'host' });
      }
      return;
    }
    if (e.code === 'Escape') { e.preventDefault(); setPaused(!state.menuOpen); }
    // Watching (spectating, or out of lives): A/D (or the arrows) switch who you follow,
    // and spectating, Space gives a free camera (where A/D move it instead).
    const me = state.me;
    if (me && !e.repeat && !state.menuOpen && !state.game.over && (me.spectating || (!me.alive && !state.game.rules.canRespawn(state.game, me)))) {
      const step = { KeyA: -1, ArrowLeft: -1, KeyD: 1, ArrowRight: 1 }[e.code];
      if (step && !state.spec.free) { e.preventDefault(); cycleWatch(step); }
      if (e.code === 'Space' && me.spectating) { e.preventDefault(); toggleFreeCam(); }
    }
    if (e.code === 'KeyC' && !e.repeat && !state.menuOpen && !state.chatOpen && state.game.classesOn && !state.game.over) {
      if (!state.me.alive) openPicker();
      else localNote('Change class while waiting to respawn (C), or from the menu (Esc)');
    }
    if ((e.code === 'Enter' || e.code === 'KeyT') && state.mode !== 'offline' && !state.menuOpen && !e.repeat) { e.preventDefault(); openChat(); return; }
    if (e.code === 'KeyM' && !e.repeat && !state.menuOpen) {
      const m = !audio.muted;
      audio.setMuted(m);
      $('mute').checked = m;
    }
  });
  window.addEventListener('mousedown', e => {
    audio.unlock();
    // Watching: a click follows the next player (right click: the one before).
    const g = state.game, me = state.me;
    if (g && me && e.target === canvas && !state.menuOpen && !state.pickerOpen && !g.over &&
        (me.spectating || (!me.alive && !g.rules.canRespawn(g, me)))) cycleWatch(e.button === 2 ? -1 : 1);
    // Waiting to respawn with classes on: a click on "C to change" opens the class picker.
    const b = renderer?.classButton;
    if (b && state.game && !state.menuOpen && !state.pickerOpen && e.target === canvas &&
        e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h) openPicker();
  });
  // Offline games pause when you switch away; online ones can't.
  window.addEventListener('blur', () => { if (state.game && !state.game.over && state.mode === 'offline') setPaused(true); });
  window.addEventListener('beforeunload', () => leaveOnline());
  // Another tab changed the class or loadouts: take them here too.
  window.addEventListener('storage', e => { if (e.key === KIT_KEY) Object.assign(profile, loadKit()); });
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

/** An invite link (#join=...): join that game. */
function takeInvite() {
  if (!location.hash.startsWith('#join=')) return null;
  const inv = parseInvite(location.hash.slice(6));
  history.replaceState(null, '', location.pathname + location.search);
  return inv;
}

async function boot() {
  const settings = loadSettings();
  profile = loadKit();
  // (Classes switched off: nothing about them in the menus.)
  document.body.classList.toggle('no-classes', !CLASSES_ON);
  for (const k in prefs) prefs[k] = settings[k];
  pacer.setMode(prefs.fpsCap);
  perf.on ||= prefs.showFps;
  const [index, legs, r] = await Promise.all([
    fetch('data/maps/index.json').then(r => r.json()),
    fetch('data/animations/legs.json').then(r => r.json()),
    createRenderer(canvas, params.get('renderer') || prefs.graphics),
  ]);
  renderer = r;
  canvas = renderer.canvas;
  input = new Input(canvas);
  setLegAnimations(legs);
  audio.preload();
  maps.index = index;
  await Promise.all(index.map(async m => maps.data.set(m.file, await fetch('data/maps/' + m.file).then(r => r.json()))));
  state.tab = settings.tab === 'offline' ? 'offline' : 'online';

  editor = new Editor({
    root: $('editor'),
    originals: maps.index.map(m => ({ name: m.name, data: maps.data.get(m.file) })),
    onExit: record => {
      const key = record?.id ? `custom:${record.id}` : selectedMap();
      show('menu', true);
      showTab('offline');
      buildMapCards(key, { follow: true });
    },
    onTestPlay: record => {
      const s = readMenu(), mode = $('edMode').value || s.mode;
      startMatch({ ...s, mode, goal: mode === s.mode ? s.goal : 0, map: `custom:${record.id}`, name: playerName() }, { returnTo: 'editor' });
    },
    onUpload: async record => {
      community ||= new Community();
      const res = await community.publish(normalizeMap(record.data), playerName(), record.communitySlot);
      saveMap({ id: record.id, name: record.name, data: record.data, communitySlot: res.slot });
      state.communityLoaded = false;
      return res;
    },
  });

  const shared = await importSharedMap();
  if (shared?.key) settings.map = shared.key;
  const invite = takeInvite();

  buildMenu(settings);
  wire();
  showTab(shared?.key ? 'offline' : state.tab);
  requestAnimationFrame(frame);
  startBackgroundTicker();
  if (shared) { toast(shared.text); revealSelectedMap(); }
  if (invite) joinGame({ ...invite, name: 'your friend\'s game' });
  // A link pasted into a tab that already has the game open only changes the hash.
  window.addEventListener('hashchange', async () => {
    const inv = takeInvite();
    if (inv && !state.game) { joinGame({ ...inv, name: 'your friend\'s game' }); return; }
    const result = await importSharedMap();
    if (!result) return;
    if (result.key && !$('menu').classList.contains('hidden')) { showTab('offline'); buildMapCards(result.key, { follow: true }); revealSelectedMap(); }
    toast(result.text);
  });
  // For automated tests and debugging in the console.
  window.stickSoldiers = {
    state, get renderer() { return renderer; }, pacer, prefs, perf, setGraphics, startMatch, readMenu, audio, editor, openEditor, joinGame, quickMatch, getLobby, showTab,
    get profile() { return profile; }, openPicker, openLoadout,
  };
}

boot().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;top:10px;left:10px;color:#b3261e">Couldn't load the game: ${esc(err.message)}</p>`);
});
