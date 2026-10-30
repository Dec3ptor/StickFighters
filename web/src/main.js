// Page wiring: menus, match setup, online play, the game loop, pause and results.

import { SPEEDS, DEFAULT_SPEED, SHOW_SPEED_MENU } from './config.js';
import { Game } from './game.js';
import { NavGraph } from './nav.js';
import { BotController, BOT_PROFILES } from './bot.js';
import { Input, PlayerController } from './input.js';
import { createRenderer, autoGraphics } from './glrender.js';
import { Renderer, setCamera, CAMERA_DEFAULTS } from './render.js';
import { RemasteredRenderer, drawRemasteredPreview } from './rm/renderer.js';
import { FramePacer, isEven } from './framerate.js';
import { drawHud, drawReplay } from './hud.js';
import { Tape, tapeFx, ReplayPlayer } from './replay.js';
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
import { shotDelay } from './combat.js';
import { holdSpawn } from './gadgets.js';
import { loadKit, saveKit, KIT_KEY } from './kitchoice.js';
import { BuyMenu } from './buymenu.js';
import { canShop } from './defuse.js';
import { renderLoadout, renderPicker } from './loadout.js';
import { CROSSHAIR_STYLES, CROSSHAIR_COLORS, CROSSHAIR_DEFAULTS, setCrosshair, drawCrosshair, crosshairCursor } from './crosshair.js';
import { setKeys, savedKeys, resetKeys, isKey, keysFor, keyOf, mouseKey, keyName, keyLabel, keyText, useLayout } from './keys.js';
import { KeybindList } from './keysui.js';

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
// When frames can't keep up, lighter drawing first (Remastered's auto quality), then a lower frame rate.
pacer.shed = now => {
  const q = renderer.quality, held = !!renderer.shed?.(now);
  if (renderer.quality !== q && !$('settings').classList.contains('hidden')) settingsNotes();
  return held;
};
const params = new URLSearchParams(location.search);
// Which game: 'original' (the 2003 look) or 'remastered' (2.5D), from ?game= in the address,
// or the one played last time (see boot()). The first time, the picker asks.
const EDITIONS = ['original', 'remastered'];
let edition = EDITIONS.includes(params.get('game')) ? params.get('game') : null;
// Classes (kits, gadgets, the Loadout screen) are switched off for now: ?classes in the
// address turns them back on (to try them, and for their tests).
const CLASSES_ON = params.has('classes');
// (?tiles=on: the canvas keeps the map in tiles, maptiles.js. Off by default: slower with a graphics card.)
if (['on', 'off'].includes(params.get('tiles'))) Renderer.tiles = params.get('tiles');
// The Settings screen's choices (saved with the other settings).
const prefs = { graphics: 'canvas', graphicsPicked: false, fpsCap: 'auto', showFps: false, showPing: true, sprint: 'hold', quality: 'auto', pointer: 'system', fullscreen: false, volume: 60, aimZoom: 'slight', crosshair: { ...CROSSHAIR_DEFAULTS }, camera: { ...CAMERA_DEFAULTS }, keys: {} };
// Locking the mouse to the game (Settings: Mouse pointer, "Locked to the game"): ?lock=on /
// ?lock=off in the address. (Browsers driven by tests move the mouse oddly while it's locked,
// so it's off for them unless the address asks.)
const LOCK_PARAM = params.get('lock');
const lockAllowed = () => prefs.pointer === 'locked' && (LOCK_PARAM === 'on' || (LOCK_PARAM !== 'off' && !navigator.webdriver));
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
  // Kill streak rewards, in the modes that have them ('on' | 'off').
  streaks: 'on',
  // Classes ('on' | 'off'), as last chosen for each mode (conquest and rush start on).
  classesByMode: {},
  // Settings screen
  // (graphicsPicked: graphics was chosen in Settings, not just the default saved.)
  graphics: 'canvas', graphicsPicked: false, fpsCap: 'auto', showFps: false, showPing: true,
  sprint: 'hold', // Shift: 'hold' to sprint, or 'toggle' it on and off
  quality: 'auto', // Remastered's graphics: 'auto', 'high', 'medium' or 'low'
  // The mouse while playing: 'system' (its own pointer is the crosshair: moved by the system, as
  // smoothly as anywhere else) or 'locked' (locked to the game, which draws the crosshair; Esc frees it).
  pointer: 'system',
  fullscreen: false, // play in full screen (with the keyboard's browser shortcuts kept for the game, where browsers allow it)
  volume: 60,       // sound volume, percent (100: as loud as it goes; it was a bit much, so 60 to start with)
  aimZoom: 'slight', // aiming down the sights (hold right click with a gun): 'off', 'slight' or 'more' (AIM_ZOOM)
  crosshair: { ...CROSSHAIR_DEFAULTS }, // how the crosshair looks (crosshair.js)
  camera: { ...CAMERA_DEFAULTS }, // how the camera moves: following you, and toward the mouse (render.js)
  keys: {},        // the keys changed in Settings (Controls): { action: [keys] } (keys.js)
  edition: null,   // the game last picked
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
  delete s.fireZoom; // (the zoom while firing, replaced by aiming down the sights)
  if (s.pointer !== 'locked') s.pointer = 'system';
  delete s.lockMouse; // (the old on/off lock, on to start with: the system's pointer is the crosshair now, unless Locked is chosen)
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
// Aiming down the sights (Settings): holding right click with a gun, the camera comes this much
// closer, and further toward where you aim. The sniper rifle's scope zooms out instead.
const AIM_ZOOM = { off: 1, slight: 1.1, more: 1.2 };
const SIGHTED = new Set(['bullet', 'arrow', 'rocket', 'seeker', 'flame']); // (the weapons with sights: guns)

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
  $('streaks').value = settings.streaks === 'off' ? 'off' : 'on';
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
  for (const id of ['difficulty', 'fragLimit', 'goal', 'side', 'botVision', 'fog', 'lives', 'gunKills', 'crates', 'destruction', 'streaks', 'maxPlayers', 'visibility', 'name', 'gameName']) $(id).addEventListener('change', rememberMenu);
  $('bots').addEventListener('change', rememberMenu);
  modeFields();
  buildMapCards(settings.map, { follow: true });
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) $('pointer-note').classList.remove('hidden');
}

/** Show the options that matter for the chosen mode. */
function modeFields() {
  const mode = $('mode').value, m = MODES[mode];
  $('modeBlurb').textContent = keyText(m.blurb);
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
  $('side').options[0].textContent = mode === 'rush' ? 'Blue (attack)' : mode === 'defuse' ? 'Blue (T first)' : 'Blue';
  $('side').options[1].textContent = mode === 'rush' ? 'Red (defend)' : mode === 'defuse' ? 'Red (CT first)' : 'Red';
  show('livesField', mode === 'oitc');
  show('gunField', mode === 'gungame');
  show('crateField', m.crates);
  show('streakField', m.streaks !== false);
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
      menuScenery();
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
  defuse: { medium: 0, small: 0.5, large: 1.5, original: 2.5 },
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
    streaks: $('streaks').value === 'off' ? 'off' : 'on',
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
    streaks: settings.streaks !== 'off',
    classes: CLASSES_ON && settings.classes === 'on' && MODES[settings.mode]?.classes !== false,
  };
  const game = new Game({ mapData: map.data, mode: settings.mode, fragLimit: limitOf(settings), speed: settings.speed, options, seed: (Math.random() * 2 ** 31) | 0 });
  state.step = 1000 / game.tickRate;
  // The last few seconds are kept, for the replay of the winning kill (replay.js).
  game.tape = new Tape();
  game.fx = tapeFx(game.fx, game.tape);
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
  pacer.restart(performance.now()); // (the first seconds of a match are no measure of how it plays)
  state.overShown = false;
  state.nextMatchAt = 0;
  state.replay = null;
  renderer.cam.zoom = 1; // (a replay cut short by the next match: no zooming in on it)
  state.replayTried = false;
  state.hitStopUntil = 0;
  state.killAt = -1e9;
  state.acc = 0;
  state.last = null; // (the first frame's time is from before the match was set up: start the clock there)
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
  grabControls();
}

function endMatch(to = state.returnTo) {
  state.replay = null;
  renderer.cam.zoom = 1;
  renderer.forgetMatch?.();
  closePicker();
  closeBuy();
  input.unlock();
  leaveFullscreen();
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
  // (Menu first, so closing the buy menu doesn't go back to playing.)
  if (p) { state.menuOpen = true; closeBuy(); input.unlock(); }
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
  fullscreenButton();
  state.last = null;
  if (!p) grabControls();
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

/** Watching (spectating, or out of lives): who there is to watch, in a steady order (Defuse: your teammates, while any are left). */
function watchable(g, me) {
  const list = g.soldiers.filter(s => s.alive && s !== me && !s.spectating);
  if (g.rules.teamWatch && !me.spectating) {
    const mates = list.filter(s => s.team === me.team);
    if (mates.length) return mates;
  }
  return list;
}

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

/** The free camera moves with the movement keys (jump: up, crouch: down, sprint: faster), and stays over the map. */
function moveFreeCam(g, dt) {
  const sp = state.spec;
  if (!state.menuOpen && !state.chatOpen) {
    const speed = (input.held('sprint') ? 1600 : 650) * dt / 1000;
    sp.x += ((input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0)) * speed;
    // (Up: the jump keys, but not the one that's also the free camera's, Space to start with.)
    const up = keysFor('jump').some(k => input.keys.has(k) && !isKey('freeCam', k));
    sp.y += ((input.held('crouch') ? 1 : 0) - (up ? 1 : 0)) * speed;
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

// ---- Keeping the controls in the game ------------------------------------------------------

/** True while the match is being played (no menu, chat or picker open over it). */
function playingNow() {
  const g = state.game;
  return !!g && !g.over && !state.menuOpen && !state.chatOpen && !state.pickerOpen && !buyMenu?.open &&
    document.body.classList.contains('playing') && $('settings').classList.contains('hidden');
}

/**
 * Back to playing: lock the mouse to the game again, and full screen if that's chosen.
 * (Browsers only allow these from a click or key press: when they don't, the next click on the game does it.)
 */
function grabControls() {
  if (!playingNow()) return;
  if (lockAllowed()) input.lock();
  enterFullscreen();
}

/** Full screen for playing (Settings): with the keyboard kept for the game where the browser can (Chrome, Edge: even Ctrl+W). */
function enterFullscreen() {
  if (!prefs.fullscreen || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  try {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => { state.ownFullscreen = true; return navigator.keyboard?.lock?.(); })
      .catch(() => {});
  } catch { /* not allowed now */ }
}

/** Out of full screen (ours, or any: `always`). */
function leaveFullscreen(always = false) {
  if (!state.ownFullscreen && !always) return;
  state.ownFullscreen = false;
  navigator.keyboard?.unlock?.();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

/** The pause menu's full screen button says what it'll do. */
function fullscreenButton() {
  const b = $('fullscreen');
  if (!b) return;
  b.classList.toggle('hidden', !document.documentElement.requestFullscreen);
  b.textContent = document.fullscreenElement ? 'Leave full screen' : 'Full screen';
}

// ---- Defuse: the buy menu ----------------------------------------------------------------

let buyMenu = null;
const getBuyMenu = () => (buyMenu ||= new BuyMenu($('buyMenu'), { buy: id => buyItem(id), close: () => closeBuy() }));

/** B: the buy menu, while you can buy (the game carries on; your soldier stands still while it's open). */
function openBuy() {
  const g = state.game, me = state.me;
  if (!g?.rules.buyItem || !me || state.menuOpen || state.chatOpen || g.over) return;
  if (!canShop(g, me)) {
    localNote(!me.alive ? "You can buy when you're back next round" : g.modeState?.buy > 0 ? 'Buy in your spawn area' : 'Buy time is over: it\'s at the start of each round');
    return;
  }
  getBuyMenu().show(g, me);
  input.enabled = false;
  input.clear();
  input.unlock();
}

function closeBuy() {
  if (!buyMenu?.open) return;
  buyMenu.hide();
  if (state.game && !state.menuOpen && !state.chatOpen && !state.game.over) { input.enabled = true; grabControls(); }
}

/** Buy something: straight away offline or hosting; online, the host does it. */
function buyItem(id) {
  const g = state.game, me = state.me;
  if (!g || !me) return;
  if (state.mode === 'client') { state.net?.client?.sendBuy(id); audio.play('click'); return; }
  const why = g.rules.buyItem(g, me, id);
  if (why) { localNote(why); audio.play('menuMove'); }
  buyMenu?.refresh(g, me);
}

/** The class picker (C while waiting to respawn, or the pause menu's Change class). */
function openPicker() {
  const g = state.game;
  if (!g?.classesOn || g.over || state.pickerOpen) return;
  state.pickerOpen = true;
  input.enabled = false;
  input.clear();
  input.unlock();
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
  if (state.game && !state.menuOpen && !state.chatOpen && !state.game.over) { input.enabled = true; grabControls(); }
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

/** The sound volume (percent), from either slider (the pause menu's or Settings'): both show it. */
function setVolume(v, save = true) {
  v = Math.round(Math.min(100, Math.max(0, Number.isFinite(+v) ? +v : 60)));
  prefs.volume = v;
  audio.setVolume(v / 100);
  for (const id of ['volume', 'setVolume']) if ($(id).value !== String(v)) $(id).value = String(v);
  for (const id of ['volumeOut', 'setVolumeOut']) $(id).textContent = `${v}%`;
  if (save) savePrefs();
}

function openSettings() {
  // Experimental: the same choices as the game setup's.
  $('setBotVision').value = $('botVision').value;
  $('setFog').value = $('fog').value;
  $('graphics').value = prefs.graphics;
  $('quality').value = prefs.quality;
  $('sprintMode').value = prefs.sprint === 'toggle' ? 'toggle' : 'hold';
  $('fpsCap').value = String(prefs.fpsCap);
  $('showFps').checked = prefs.showFps;
  $('showPing').checked = prefs.showPing;
  $('pointerMode').value = prefs.pointer === 'locked' ? 'locked' : 'system';
  $('fullscreenPref').checked = prefs.fullscreen;
  $('aimZoom').value = AIM_ZOOM[prefs.aimZoom] ? prefs.aimZoom : 'slight';
  showCrosshair();
  showCamera();
  keybinds.render();
  settingsNotes();
  showSettingsPage(state.settingsPage);
  show('settings', true);
  $('settingsDone').focus();
}

/** Show one section of Settings (the one last looked at, when it opens again). */
function showSettingsPage(page) {
  const pages = [...document.querySelectorAll('#settings .set-page')];
  if (!pages.some(p => p.dataset.page === page)) page = pages[0].dataset.page;
  for (const p of pages) p.classList.toggle('hidden', p.dataset.page !== page);
  for (const t of document.querySelectorAll('#settings .set-tab')) t.setAttribute('aria-selected', String(t.dataset.page === page));
  state.settingsPage = page;
}

function closeSettings() {
  keybinds.cancel();
  show('settings', false);
}

// The crosshair's settings: the controls, and a picture of it on a light and a dark background.
const XH_RANGES = { xhSize: ['size', v => `${v}`], xhThickness: ['thickness', v => `${v}`], xhGap: ['gap', v => `${v}`], xhOpacity: ['opacity', v => `${v}%`] };

/** Put the crosshair's settings in the controls, and draw the picture. */
function showCrosshair() {
  const xh = prefs.crosshair;
  $('xhStyle').value = xh.style;
  $('xhColor').value = xh.color;
  $('xhCustom').value = xh.custom;
  $('xhCustomField').classList.toggle('hidden', xh.color !== 'custom');
  for (const [id, [k, label]] of Object.entries(XH_RANGES)) {
    if ($(id).value !== String(xh[k])) $(id).value = String(xh[k]);
    setText($(`${id}Out`), label(xh[k]));
  }
  $('xhOutline').checked = xh.outline;
  const cv = $('xhPreview'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height;
  const rm = edition === 'remastered';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = rm ? '#8fa3b8' : '#ffffff';
  ctx.fillRect(0, 0, w / 2, h);
  ctx.fillStyle = rm ? '#141a22' : '#3a3f46';
  ctx.fillRect(w / 2, 0, w / 2, h);
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  for (const x of [w / 8, w * 3 / 8]) drawCrosshair(ctx, x, h / 4, { edition: rm ? 'remastered' : 'classic' });
}

/** A crosshair setting changed: use it, save it and show it. */
function changeCrosshair(change) {
  prefs.crosshair = setCrosshair({ ...prefs.crosshair, ...change });
  savePrefs();
  showCrosshair();
}

// The camera's settings: its sliders, and how each shows its value.
const CAM_RANGES = {
  camLook: ['look', v => `${v}%`],
  camGlide: ['glide', v => v ? `${v} ms` : 'Off'],
  camFollow: ['follow', v => v ? `${v} ms` : 'Off'],
};

/** Put the camera's settings in the sliders. */
function showCamera() {
  for (const [id, [k, label]] of Object.entries(CAM_RANGES)) {
    if ($(id).value !== String(prefs.camera[k])) $(id).value = String(prefs.camera[k]);
    setText($(`${id}Out`), label(prefs.camera[k]));
  }
}

/** A camera setting changed: use it (straight away, mid-match too), save it and show it. */
function changeCamera(change) {
  prefs.camera = setCamera({ ...prefs.camera, ...change });
  savePrefs();
  showCamera();
}

// The keys (Settings: Controls): the list of actions and their keys, saved as they change.
const keybinds = new KeybindList($('keybinds'), {
  onChange: () => { prefs.keys = savedKeys(); savePrefs(); showKeys(); },
  classes: () => CLASSES_ON,
});

/** The keys named on the page (the menu's Controls) as they're set: <span data-keys="action"> (data-first: just the first). */
function showKeys() {
  for (const el of document.querySelectorAll('[data-keys]')) {
    const keys = keysFor(el.dataset.keys), shown = el.hasAttribute('data-first') ? keys.slice(0, 1) : keys;
    const kbds = shown.map(k => { const b = document.createElement('kbd'); b.textContent = keyName(k); return b; });
    if (!kbds.length) { el.textContent = 'unbound'; continue; }
    el.replaceChildren(...kbds.flatMap((b, i) => (i ? [' or ', b] : [b])));
  }
}

/** Set an element's text, only if it's different (no needless changes to the page). */
function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

/**
 * A dropdown's Auto option, saying what Auto is doing now. Not while the dropdown's in use:
 * changing its options while it's open closes it (Chrome), and the choice is lost.
 */
function autoLabel(id, text) {
  const el = $(id);
  if (document.activeElement !== el) setText(el.options[0], text);
}

/** The notes under the settings: what's being used right now (kept up to date while they're open). */
function settingsNotes() {
  if (renderer.kind === 'remastered') {
    const q = renderer.quality, names = { high: 'High', medium: 'Medium', low: 'Low' };
    autoLabel('quality', renderer.auto ? `Auto (${names[q]})` : 'Auto');
    setText($('qualityNote'), renderer.auto && q !== 'high' ? `Auto turned the quality down to ${names[q]} so your computer keeps up.` : 'Auto starts on High and turns it down if your computer can\'t keep up.');
  }
  const auto = autoGraphics();
  autoLabel('graphics', `Auto (${auto === 'webgl' ? 'WebGL' : 'Canvas'})`);
  let g = renderer.kind === 'webgl' ? 'Drawing with WebGL, on the graphics card.' : 'Drawing with the canvas.';
  if (prefs.graphics === 'webgl' && renderer.kind !== 'webgl') g += " WebGL isn't available in this browser.";
  else if (prefs.graphics === 'auto' && auto === 'canvas') g += ' WebGL would run without a graphics card here, which is slower.';
  setText($('graphicsNote'), g);
  const hz = pacer.refresh, target = Math.round(pacer.target);
  autoLabel('fpsCap', pacer.mode === 'auto' ? `Auto (${target} fps)` : 'Auto');
  if (document.activeElement !== $('fpsCap')) setText($('fpsCap').querySelector('option[value="half"]'), `Half the screen rate (${Math.round(hz / 2)} fps)`);
  let f = `Your screen refreshes ${hz} times a second, so that's the most it can show.`;
  if (pacer.mode === 'auto') f += pacer.divisor > 1 ? ` Auto is drawing ${target} fps: your computer couldn't keep up with ${hz}, and it'll try again soon.` : ' Auto matches it.';
  else if (pacer.mode === 'half') f += ` Every other refresh is drawn: a steady ${target} fps.`;
  else if (pacer.mode > hz) f += ` ${pacer.mode} fps needs a faster screen.`;
  else if (!isEven(pacer.target, hz)) f += ` ${pacer.mode} fps doesn't divide evenly into ${hz}, so frames come at slightly uneven times: half the screen rate is steadier.`;
  else if (pacer.target !== pacer.mode) f += ` Drawing ${target} fps, every ${['', '', 'other', 'third', 'fourth', 'fifth', 'sixth'][Math.round(hz / pacer.target)] ?? 'n-th'} refresh, which is steadier than exactly ${pacer.mode}.`;
  setText($('fpsNote'), f);
}

/** A renderer for the game being played: Remastered's, or the original's (canvas or WebGL). */
function makeRenderer(el) {
  return edition === 'remastered' ? new RemasteredRenderer(el, prefs.quality) : createRenderer(el, params.get('renderer') || prefs.graphics);
}

/** Draw with renderer r from now on (made on a copy of the canvas: it takes the old one's place). */
function useRenderer(r) {
  r.cam = { ...renderer.cam };
  r.shake = renderer.shake;
  canvas.replaceWith(r.canvas);
  renderer.destroy();
  renderer = r;
  canvas = r.canvas;
  input.attach(canvas);
  pacer.restart(performance.now(), true); // (new graphics: a fresh try at the full rate)
}

/** Play the original or Remastered (from the picker): the look changes, everything else stays. */
async function setEdition(kind) {
  kind = EDITIONS.includes(kind) ? kind : 'original';
  const changed = kind !== edition;
  edition = kind;
  document.documentElement.dataset.game = kind;
  const url = new URL(location.href);
  url.searchParams.set('game', kind);
  history.replaceState(history.state, '', url);
  saveSettings({ ...loadSettings(), edition: kind });
  if (changed || (kind === 'remastered') !== (renderer.kind === 'remastered')) useRenderer(await makeRenderer(canvas.cloneNode(false)));
  editionText();
  menuScenery();
  show('gamePicker', false);
}

/** The names on the menu and the tab for the game being played. */
function editionText() {
  const rm = edition === 'remastered';
  $('gameSub').textContent = rm ? 'Remastered' : '';
  $('gameTag').textContent = rm ? 'The same fights in 2.5D: scenery in layers, solid blocks, lighting and weather.' : 'The 2003 stick-figure shooter, remade for the browser.';
  $('switchGame').textContent = rm ? 'Play the original' : 'Play Remastered';
  document.title = rm ? 'Stick Soldiers Remastered' : 'Stick Soldiers';
}

/** Remastered: the menus show the scenery of the map picked. */
function menuScenery() {
  if (!renderer.setMenuMap) return;
  const key = selectedMap();
  const data = key && !key.includes(':') ? maps.data.get(key) : key?.startsWith('custom:') ? getMap(key.slice(7))?.data : null;
  renderer.setMenuMap(data || null);
}

/** Show the game picker (both games, side by side). */
function openGamePicker() {
  for (const b of document.querySelectorAll('[data-edition]')) b.classList.toggle('current', b.dataset.edition === (edition || loadSettings().edition));
  drawPickerArt();
  show('gamePicker', true);
  document.querySelector(`[data-edition="${edition || loadSettings().edition || 'remastered'}"]`)?.focus();
}

/** The pictures on the picker's two cards. */
function drawPickerArt() {
  const og = document.querySelector('[data-edition="original"] canvas'), rm = document.querySelector('[data-edition="remastered"] canvas');
  if (og && !og.dataset.drawn) { og.dataset.drawn = 1; drawOriginalArt(og); }
  if (rm && !rm.dataset.drawn) { rm.dataset.drawn = 1; drawRemasteredPreview(rm); }
}

/** A little paper scene in the original's style: black outlines, white blocks, stick figures. */
function drawOriginalArt(cv) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.fillStyle = '#fff';
  for (const [x, y, bw, bh] of [[20, 190, 400, 40], [60, 120, 110, 18], [270, 110, 120, 18], [190, 150, 60, 40]]) { ctx.fillRect(x, y, bw, bh); ctx.strokeRect(x, y, bw, bh); }
  const stick = (x, y, dir) => {
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y - 44, 8, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - 36); ctx.lineTo(x, y - 14); ctx.lineTo(x - 9, y); ctx.moveTo(x, y - 14); ctx.lineTo(x + 9, y);
    ctx.moveTo(x, y - 30); ctx.lineTo(x + dir * 18, y - 28); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.fillRect(x + dir * 12 - (dir < 0 ? 16 : 0), y - 31, 16, 4);
  };
  stick(115, 120, 1); stick(330, 110, -1); stick(220, 190, 1);
}

/** Switch between WebGL and canvas drawing (from Settings), even mid-match. */
let switching = false, nextChoice = null;
async function setGraphics(choice) {
  if (edition === 'remastered') return; // (Remastered has its own quality setting)
  if (switching) { nextChoice = choice; return; } // (picked again while switching: do that next)
  const want = choice === 'auto' ? autoGraphics() : choice;
  if (renderer.kind === want) { settingsNotes(); return; }
  switching = true;
  try {
    const r = await createRenderer(canvas.cloneNode(false), want);
    if (r.kind === renderer.kind) { r.destroy(); return; } // WebGL failed, and we're already on the canvas
    useRenderer(r);
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
  koth: 'King of the hill', ctf: 'Capture the flag', conquest: 'Conquest', rush: 'Rush', defuse: 'Defuse',
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
  return h ? `${location.origin}${location.pathname}${edition === 'remastered' ? '?game=remastered' : ''}#join=${inviteCode(h.invite)}` : '';
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
  state.chat.push({ name: m.name || '', text: m.text, system: !!m.system, team: m.team || 0, time: performance.now() });
  if (state.chat.length > 30) state.chat.shift();
  if (!m.system) audio.play('chat');
}

function openChat() {
  if (state.mode === 'offline' || state.chatOpen) return;
  state.chatOpen = true;
  input.enabled = false;
  input.clear();
  input.unlock();
  show('chatForm', true);
  $('chatInput').value = '';
  $('chatInput').focus();
}

function closeChat() {
  if (!state.chatOpen) return;
  state.chatOpen = false;
  show('chatForm', false);
  $('chatInput').blur();
  if (state.game && !state.menuOpen) { input.enabled = true; grabControls(); }
}

function sendChat(text) {
  text = text.trim();
  if (!text) return;
  if (state.net?.role === 'host') state.net.host.chat(state.settings.name, text, state.me?.team);
  else if (state.net?.role === 'client') state.net.client.sendChat(text);
}

// ---- Loop ------------------------------------------------------------------------------

/** Run the game forward to `now` in fixed steps (60 a second). */
function simulate(now) {
  const g = state.game;
  if (!g) { state.last = now; return; }
  let dt = state.last == null ? 0 : now - state.last;
  state.last = now;
  dt = Math.min(1000, Math.max(0, dt));
  if (state.paused) return;
  // Hit-stop: offline, the game holds still for a moment when you get a kill.
  if (state.mode === 'offline' && now < state.hitStopUntil) return;
  state.acc += dt;
  let n = 0;
  const started = performance.now();
  while (state.acc >= state.step) {
    // Behind (a hitch, a slow frame): two updates a frame catch up, more only while they're
    // quick (a burst of them would look like a jump). Too much to do (thousands of bots):
    // run in slow motion rather than freeze the page.
    const spent = performance.now() - started;
    if (n >= 2 && (spent > 4 || n >= 6)) break;
    if (spent > 50) break;
    if (state.mode === 'client') state.net?.client?.tick();
    else { g.update(); state.net?.host?.afterTick(); }
    state.acc -= state.step;
    n++;
    perf.updates++;
  }
  // What couldn't be caught up on is let go: the game runs a moment behind, not in a rush.
  if (state.acc > state.step) state.acc = state.step;
}

// The game updates 60 times a second; frames are drawn as often as the screen
// refreshes (60, 120, 144 Hz...), with everything drawn in between updates.
function frame(now) {
  requestAnimationFrame(frame);
  // The frame rate setting: skip this screen refresh if it's too soon to draw again. (Not
  // counted while a menu's open over the game: that's no measure of how it plays.)
  // (The game updates whether or not this refresh is drawn: input is read and updates come
  // evenly at 60 Hz, so a capped frame rate doesn't mean updates in pairs.)
  if (!pacer.frame(now, !!state.game && !state.menuOpen)) { simulate(now); return; }
  // Behind the menus nothing's being played: drawn at most 30 times a second, so the menus
  // stay quick to use. (An online game still runs.)
  if ((!state.game || state.menuOpen) && now - (state.menuDrawAt ?? -1e9) < 32) { simulate(now); return; }
  state.menuDrawAt = now;
  const workStart = performance.now();
  const dt = Math.min(100, Math.max(0, now - (state.frameAt ?? now)));
  state.frameAt = now;
  simulate(now);
  if (!$('settings').classList.contains('hidden') && now - (state.notesAt || 0) > 500) { state.notesAt = now; settingsNotes(); }
  const g = state.game;
  if (!g) {
    showPointer('');
    // Nothing playing: keep the canvas blank behind the menus (Remastered: its scenery,
    // except under the map maker and the picker, which cover it).
    if ($('editor').classList.contains('hidden') && $('gamePicker').classList.contains('hidden')) renderer.clear();
    pacer.worked(performance.now() - workStart);
    return;
  }
  // The replay of the winning kill, once the match is over.
  if (state.replay) { showPointer(''); replayFrame(now, dt, workStart); return; }
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
  // A kill of ours: the kill-confirm mark at the crosshair, and a moment's hit-stop (offline the
  // game holds still; online, the picture does). (Sounds to another player aren't ours: offline
  // they carry who they're for; online the host only sends us ours.)
  if (g.sounds.some(x => x.name === 'killConfirm' && (x.to == null || x.to === me.id))) confirmKill(now);
  audio.playQueue(g.sounds, ear.x, ear.y, me.id, me.team);
  g.sounds.length = 0;
  // (Online, the hit-stop holds the picture: the game itself can't stop.)
  if (state.mode !== 'offline' && now < state.hitStopUntil && state.drawnOnce) { pacer.drawn(now, 0); return; }

  const sniping = me.alive && me.current === 'SR' && input.held('aim') && !state.menuOpen && !state.chatOpen;
  // Aiming down the sights: right click held with a gun (Settings).
  const sights = !sniping && me.alive && input.held('aim') && SIGHTED.has(weaponFor(me, me.current)?.kind) && !watchMode && !g.over &&
    !state.menuOpen && !state.chatOpen && !state.pickerOpen && !buyMenu?.open;
  const ax = free ? free.x : lerp(view.prevX ?? view.x, view.x, alpha) + (view.drawDX || 0);
  const ay = free ? free.y : lerp(view.prevY ?? view.y, view.y, alpha) + (view.drawDY || 0);
  renderer.updateCamera(g, ax, ay, state.menuOpen || watchMode ? null : input.mouse, sniping, dt, sights ? AIM_ZOOM[prefs.aimZoom] ?? 1 : 1);
  const aimed = view === me ? liveAim(me, ax, ay) : null;
  const drawStart = performance.now();
  renderer.fogFrom = view;
  renderer.render(g, alpha, me);
  if (client) me.ping = client.ping;
  // Holding K to self-destruct: shown as it counts down (it goes off after a second).
  const holdingK = me.alive && input.held('selfDestruct') && !state.menuOpen && !state.chatOpen;
  state.destructSince = holdingK ? state.destructSince ?? now : null;
  const hudR = renderer.hud || renderer;
  const killK = (now - state.killAt) / KILL_MARK_MS;
  drawHud(hudR, g, me, {
    selfDestruct: holdingK ? (now - state.destructSince) / 1000 : 0,
    rewardPick: myController()?.pickedReward?.(me) ?? null,
    // (A moment on the final picture, without the HUD, before the replay of the winning kill.)
    replay: g.over && !!g.finalKill && !state.replayTried,
    killMark: killK >= 0 && killK < 1 && !state.menuOpen && !watchMode ? { x: input.mouse.x, y: input.mouse.y, k: killK } : null,
    showScores: input.held('scores') && !state.chatOpen, watching, chat: state.chat,
    spectating: me.spectating ? { free: !!free, target: watching } : null,
    online: state.mode !== 'offline',
    hostId: state.mode === 'host' ? me.id : state.mode === 'client' ? g.soldiers.find(s => !s.isBot && !s.remote)?.id : null,
    ping: !prefs.showPing ? null : client ? client.ping : state.mode === 'host' ? 'Host' : null,
    perf: perf.on ? perf.text : null,
    picking: state.pickerOpen,
  });
  if (hudR !== renderer) renderer.classButton = hudR.classButton;
  // Defuse's buy menu: kept up to date, and closed when you can't buy any more.
  if (buyMenu?.open) {
    if (canShop(g, me)) buyMenu.refresh(g, me);
    else { closeBuy(); if (me.alive) localNote(g.modeState?.buy > 0 ? 'You left your buy zone' : 'Buy time is over'); }
  }
  if (!state.menuOpen && !g.over && !state.chatOpen && !state.pickerOpen && !watchMode) {
    // Reloading: a ring round the crosshair fills up, complete when the gun's ready. That's
    // the pistol's magazine, and the wait between shots of slow guns (sniper rifle, rockets...).
    const gun = weaponFor(me, me.current);
    let reload = null;
    if (me.alive && gun) {
      if (gun.mag && me.reloadTimer > 0) reload = 1 - me.reloadTimer / gun.reload;
      else if (shotDelay(g, gun) >= SLOW_GUN && me.cooldown > 0) reload = 1 - me.cooldown / shotDelay(g, gun);
    }
    // (The system's own pointer is the crosshair, unless the mouse is locked to the game: the
    // browser hides it then, and the game draws it.)
    const pointer = !input.locked;
    showPointer(pointer ? crosshairCursor(edition === 'remastered' ? 'remastered' : 'classic', sniping, window.devicePixelRatio || 1) : '');
    renderer.drawCrosshair(input.mouse.x, input.mouse.y, sniping, reload, pointer);
  } else {
    showPointer('');
  }
  renderer.present();
  state.drawnOnce = true;
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
/**
 * The game's mouse pointer (on its canvas): `css`, a CSS cursor (the crosshair, as the system's
 * own pointer), or '' for the page's (none while playing). Set only when it changes.
 */
let pointerOn = null, pointerCss = '';
function showPointer(css) {
  const el = renderer.canvas;
  if (el === pointerOn && css === pointerCss) return;
  // (A new canvas, after a graphics change: the old one's let go of.)
  if (pointerOn && pointerOn !== el) pointerOn.style.cursor = '';
  el.style.cursor = css;
  pointerOn = el; pointerCss = css;
}

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
      + (pacer.mode === 'auto' && pacer.divisor > 1 ? ` · auto at ${Math.round(pacer.target)}` : '')
      + (renderer.auto ? ` · quality ${renderer.quality}` : '')
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
    closeChat(); // (keys skip the replay, not type)
    closeBuy();
    input.enabled = false;
    input.unlock();
    document.body.classList.remove('playing');
    state.overAt = now;
    state.resultsAt = now + RESULTS_DELAY;
    // (Hosting: the next match in 12 seconds; more when there's a replay to watch first.)
    if (state.mode === 'host') state.nextMatchAt = now + (g.finalKill ? 18000 : 12000);
    show('pause', false);
    state.menuOpen = false;
    show('again', state.mode !== 'client');
    closePicker();
    $('again').textContent = state.mode === 'host' ? 'Next match now' : 'Play again';
    $('toMenu').textContent = state.mode === 'host' ? 'End game' : state.mode === 'client' ? 'Leave' : state.returnTo === 'editor' ? 'Back to map maker' : 'Menu';
  }
  // The replay of the winning kill (if a kill won it), after a moment on the final picture;
  // the results (the scores and awards on the canvas, and the buttons) after that.
  if (!state.replayTried && now - state.overAt > REPLAY_DELAY) startReplay(g, now);
  if (!state.replay && now > state.resultsAt) show('over', true);
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

// The kill-confirm mark at the crosshair lasts this long; hit-stop holds the game (offline)
// or the picture (online) this long, at most once in HIT_STOP_GAP (a minigun can kill fast).
const KILL_MARK_MS = 320, HIT_STOP_MS = 70, HIT_STOP_GAP = 400;
// After the match: the final picture holds this long before the replay; the results show
// this long after the end (or after the replay).
const REPLAY_DELAY = 900, RESULTS_DELAY = 1500;

/** A kill of ours (its kill-confirm sound came through): the mark at the crosshair, and hit-stop. */
function confirmKill(now) {
  state.killAt = now;
  if (now - (state.hitStopAt ?? -1e9) > HIT_STOP_GAP) {
    state.hitStopAt = now;
    state.hitStopUntil = now + HIT_STOP_MS;
  }
}

/**
 * A press of one of the keys main.js reads itself (Settings, Controls: buy, change class, chat,
 * mute), mid-match with no menu open. Returns whether it was one.
 */
function pressMenuKey(key) {
  const g = state.game;
  if (!g || state.menuOpen || state.chatOpen) return false;
  if (isKey('buy', key) && g.rules.buyItem) { openBuy(); return true; }
  if (isKey('changeClass', key) && g.classesOn && !g.over) {
    if (!state.me.alive) openPicker();
    else localNote(`Change class while waiting to respawn (${keyLabel('changeClass')}), or from the menu (Esc)`);
    return true;
  }
  if (isKey('chat', key) && state.mode !== 'offline') { openChat(); return true; }
  if (isKey('mute', key)) {
    const m = !audio.muted;
    audio.setMuted(m);
    $('mute').checked = m;
    return true;
  }
  return false;
}

/** The controller reading our keyboard and mouse (online, the client's). */
function myController() {
  if (state.mode === 'client') return state.net?.client?.opts.controller || null;
  return state.game?.controllers.get(state.me) || null;
}

/** Start the slow-motion replay of the kill that won the match, if there's one and it was recorded. */
function startReplay(g, now) {
  state.replayTried = true;
  const tape = state.mode === 'client' ? state.net?.client?.tape : g.tape;
  if (!g.finalKill || !tape) return;
  const rp = new ReplayPlayer(g, tape, g.finalKill);
  if (!rp.ok) return;
  state.replay = rp;
  const f = rp.focus();
  renderer.snapCamera(f.x, f.y - 20);
  audio.play('replay');
}

/** The replay's over (or skipped): on to the results. */
function endReplay() {
  state.replay = null;
  renderer.cam.zoom = 1;
  state.resultsAt = performance.now() + 500;
  if (state.game?.awards?.length) audio.play('awards');
}

/** One frame of the replay: drawn from its own copy of the game, with its own camera and overlay. */
function replayFrame(now, dt, workStart) {
  const rp = state.replay, v = rp.view, me = state.me;
  const done = rp.update(dt);
  const f = rp.focus();
  renderer.noFog = true;
  renderer.fogFrom = null;
  audio.playQueue(v.sounds, f.x, f.y, me?.id, me?.team);
  v.sounds.length = 0;
  // (Its own smooth glide, whatever Settings says about following.)
  renderer.updateCamera(v, f.x, f.y, null, false, dt, 1, CAMERA_DEFAULTS.follow);
  renderer.cam.zoom = rp.zoom();
  renderer.render(v, 1, null);
  const k = rp.killer, victim = rp.victim, kill = rp.kill;
  drawReplay(renderer.hud || renderer, {
    killer: k?.name ?? '?', victim: victim?.name ?? '?', killerTeam: g2team(k), victimTeam: g2team(victim),
    weapon: kill.weapon ? WEAPONS[kill.weapon]?.name ?? String(kill.weapon) : null, headshot: !!kill.headshot,
    k: rp.progress, slow: rp.slow,
  });
  renderer.present();
  const end = performance.now();
  pacer.drawn(now + (end - workStart), end - workStart);
  if (done) endReplay();
}

/** A soldier's team for drawing their name (none in free-for-all). */
const g2team = s => (s && state.game?.rules.teams ? s.team : 0);

/** Skip the replay (any key or click). */
function skipReplay() { state.replay?.finish(); }

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
  for (const t of document.querySelectorAll('#settings .set-tab')) t.addEventListener('click', () => showSettingsPage(t.dataset.page));
  $('keysReset').addEventListener('click', () => { keybinds.cancel(); prefs.keys = resetKeys(); savePrefs(); keybinds.render(); showKeys(); });
  $('graphics').addEventListener('change', () => { prefs.graphics = $('graphics').value; prefs.graphicsPicked = true; savePrefs(); setGraphics(prefs.graphics); });
  $('quality').addEventListener('change', () => { prefs.quality = $('quality').value; savePrefs(); renderer.setQuality?.(prefs.quality); pacer.restart(performance.now(), true); settingsNotes(); });
  // The game picker.
  for (const b of document.querySelectorAll('[data-edition]')) b.addEventListener('click', () => { audio.unlock(); audio.play('menuMove'); setEdition(b.dataset.edition); });
  $('switchGame').addEventListener('click', () => { audio.unlock(); audio.play('menuMove'); setEdition(edition === 'remastered' ? 'original' : 'remastered'); });
  $('fpsCap').addEventListener('change', () => { prefs.fpsCap = $('fpsCap').value; pacer.setMode(prefs.fpsCap); savePrefs(); settingsNotes(); });
  for (const id of ['volume', 'setVolume']) {
    $(id).addEventListener('input', () => setVolume($(id).value, false));
    $(id).addEventListener('change', () => setVolume($(id).value));
  }
  $('showFps').addEventListener('change', () => { prefs.showFps = $('showFps').checked; perf.on = prefs.showFps || params.has('fps'); savePrefs(); });
  $('showPing').addEventListener('change', () => { prefs.showPing = $('showPing').checked; savePrefs(); });
  $('sprintMode').addEventListener('change', () => { prefs.sprint = $('sprintMode').value === 'toggle' ? 'toggle' : 'hold'; savePrefs(); });
  $('pointerMode').addEventListener('change', () => { prefs.pointer = $('pointerMode').value === 'locked' ? 'locked' : 'system'; savePrefs(); if (prefs.pointer !== 'locked') input.unlock(); });
  $('fullscreenPref').addEventListener('change', () => { prefs.fullscreen = $('fullscreenPref').checked; savePrefs(); if (!prefs.fullscreen) leaveFullscreen(true); });
  $('aimZoom').addEventListener('change', () => { prefs.aimZoom = AIM_ZOOM[$('aimZoom').value] ? $('aimZoom').value : 'slight'; savePrefs(); });
  // The crosshair.
  for (const [id, label] of CROSSHAIR_STYLES) $('xhStyle').add(new Option(label, id));
  for (const [id, label] of CROSSHAIR_COLORS) $('xhColor').add(new Option(label, id));
  $('xhStyle').addEventListener('change', () => changeCrosshair({ style: $('xhStyle').value }));
  $('xhColor').addEventListener('change', () => changeCrosshair({ color: $('xhColor').value }));
  $('xhCustom').addEventListener('input', () => changeCrosshair({ color: 'custom', custom: $('xhCustom').value }));
  for (const [id, [k]] of Object.entries(XH_RANGES)) $(id).addEventListener('input', () => changeCrosshair({ [k]: Number($(id).value) }));
  $('xhOutline').addEventListener('change', () => changeCrosshair({ outline: $('xhOutline').checked }));
  $('xhReset').addEventListener('click', () => changeCrosshair({ ...CROSSHAIR_DEFAULTS }));
  // The camera.
  for (const [id, [k]] of Object.entries(CAM_RANGES)) $(id).addEventListener('input', () => changeCamera({ [k]: Number($(id).value) }));
  $('camReset').addEventListener('click', () => changeCamera({ ...CAMERA_DEFAULTS }));
  $('fullscreen').addEventListener('click', () => {
    // (From the menu: full screen now, and for the matches after this one.)
    prefs.fullscreen = !document.fullscreenElement;
    savePrefs();
    if (prefs.fullscreen) enterFullscreen(); else leaveFullscreen(true);
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { state.ownFullscreen = false; navigator.keyboard?.unlock?.(); } fullscreenButton(); });
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
      // (While a key's being set, Esc keeps it as it was: keysui.js has it first.)
      if (e.code === 'Escape' && !keybinds.capturing) { e.preventDefault(); closeSettings(); }
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
      else if (e.code === 'Escape' || isKey('changeClass', keyOf(e.code))) { e.preventDefault(); closePicker(); }
      return;
    }
    if (!state.game) {
      if (e.code === 'Enter' && !$('menu').classList.contains('hidden') && !$('setup').classList.contains('hidden') && !/^(BUTTON|INPUT|SELECT)$/.test(document.activeElement?.tagName)) {
        startMatch(readMenu(), { online: state.setupFor === 'host' });
      }
      return;
    }
    // The replay of the winning kill: any key skips it.
    if (state.replay) {
      if (!e.repeat && !/^(Tab|Shift|Control|Alt|Meta)/.test(e.code)) { e.preventDefault(); skipReplay(); }
      return;
    }
    // Defuse: the buy menu takes the keys while it's open (number keys, B or Esc to close).
    if (buyMenu?.open) {
      if (!e.repeat && buyMenu.key(e.code, state.game, state.me)) e.preventDefault();
      return;
    }
    const key = keyOf(e.code);
    if (!e.repeat && pressMenuKey(key)) { e.preventDefault(); return; }
    if (e.code === 'Escape') {
      e.preventDefault();
      // (Esc also frees a locked mouse, which opens the menu: one press, not two.)
      if (performance.now() - (state.freedAt || 0) > 400) setPaused(!state.menuOpen);
    }
    // Watching (spectating, or out of lives): left and right switch who you follow, and
    // spectating, jump gives a free camera (where the movement keys move it instead).
    const me = state.me;
    if (me && !e.repeat && !state.menuOpen && !state.game.over && (me.spectating || (!me.alive && !state.game.rules.canRespawn(state.game, me)))) {
      const step = isKey('left', key) ? -1 : isKey('right', key) ? 1 : 0;
      if (step && !state.spec.free) { e.preventDefault(); cycleWatch(step); }
      if (isKey('freeCam', key) && me.spectating) { e.preventDefault(); toggleFreeCam(); }
    }
  });
  window.addEventListener('mousedown', e => {
    audio.unlock();
    if (state.replay && e.target === canvas) { skipReplay(); return; }
    // (Menu keys can be mouse buttons too: Settings, Controls.)
    if (e.target === canvas && state.game && !state.chatOpen && pressMenuKey(mouseKey(e.button))) return;
    // Watching: a click follows the next player (right click: the one before).
    const g = state.game, me = state.me;
    if (g && me && e.target === canvas && !state.menuOpen && !state.pickerOpen && !g.over &&
        (me.spectating || (!me.alive && !g.rules.canRespawn(g, me)))) cycleWatch(e.button === 2 ? -1 : 1);
    // Waiting to respawn with classes on: a click on "C to change" opens the class picker.
    const b = renderer?.classButton;
    const mx = input.locked ? input.mouse.x : e.clientX, my = input.locked ? input.mouse.y : e.clientY;
    if (b && state.game && !state.menuOpen && !state.pickerOpen && e.target === canvas &&
        mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) openPicker();
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
  // Which game, if the address doesn't say: links to a map or to join a game open in
  // the original (Remastered's links say so); otherwise the one played last time.
  if (!edition) edition = /^#(map|join)=/.test(location.hash) ? 'original' : EDITIONS.includes(settings.edition) ? settings.edition : null;
  document.documentElement.dataset.game = edition || 'original';
  profile = loadKit();
  // (Classes switched off: nothing about them in the menus.)
  document.body.classList.toggle('no-classes', !CLASSES_ON);
  for (const k in prefs) prefs[k] = settings[k];
  setVolume(prefs.volume, false);
  prefs.crosshair = setCrosshair(prefs.crosshair);
  prefs.camera = setCamera(prefs.camera);
  prefs.keys = setKeys(prefs.keys);
  showKeys();
  // (Keyboards other than QWERTY: name keys as they're printed, where the browser can say.)
  navigator.keyboard?.getLayoutMap?.().then(m => { useLayout(m); keybinds.render(); showKeys(); }).catch(() => {});
  pacer.setMode(prefs.fpsCap);
  perf.on ||= prefs.showFps;
  const [index, legs, r] = await Promise.all([
    fetch('data/maps/index.json').then(r => r.json()),
    fetch('data/animations/legs.json').then(r => r.json()),
    makeRenderer(canvas),
  ]);
  renderer = r;
  canvas = renderer.canvas;
  input = new Input(canvas);
  // A click on the game locks the mouse to it while playing; Esc frees it (and opens the menu).
  input.wantsLock = () => lockAllowed() && playingNow();
  input.onPress = () => grabControls();
  input.onLockLost = () => {
    if (!playingNow()) return;
    state.freedAt = performance.now();
    setPaused(true);
  };
  setLegAnimations(legs);
  audio.preload();
  audio.listen(window); // (sound starts at the first click, tap or key; nothing listens once it's running)
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
  // (Nothing picked yet, the first time: ask.)
  editionText();
  menuScenery();
  if (!edition) openGamePicker();
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
    state, get renderer() { return renderer; }, get edition() { return edition; }, get input() { return input; }, setEdition, openGamePicker, pacer, prefs, perf, setGraphics, startMatch, endMatch, readMenu, audio, editor, openEditor, joinGame, quickMatch, getLobby, showTab,
    get profile() { return profile; }, openPicker, openLoadout,
  };
}

boot().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;top:10px;left:10px;color:#b3261e">Couldn't load the game: ${esc(err.message)}</p>`);
});
