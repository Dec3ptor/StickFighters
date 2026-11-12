// Page wiring: menus, match setup, online play, the game loop, pause and results.

import { SPEEDS, DEFAULT_SPEED, SHOW_SPEED_MENU } from './config.js';
import { Game } from './game.js';
import { NavGraph } from './nav.js';
import { BotController, BOT_PROFILES } from './bot.js';
import { Input, PlayerController, FIREFOX } from './input.js';
import { createRenderer, autoGraphics } from './glrender.js';
import { Renderer, setCamera, tidyCamera, cameraInUse, CAMERA_DEFAULTS, CAMERA_LIMITS } from './render.js';
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
import { MODES, MODE_IDS } from './modes.js';
import { WEAPONS } from './weapons.js';
import { GameMap, seamsOf, fillSeams } from './map.js';
import { Lobby, inviteCode, parseInvite } from './net/lobby.js';
import { NetHost } from './net/host.js';
import { NetClient } from './net/client.js';
import { Community } from './net/community.js';
import { PROTOCOL } from './net/protocol.js';
import { CLASSES, CLASS_IDS, weaponFor } from './classes.js';
import { shotDelay, shotReach } from './combat.js';
import { holdSpawn } from './gadgets.js';
import { loadKit, saveKit, KIT_KEY } from './kitchoice.js';
import { BuyMenu } from './buymenu.js';
import { canShop } from './defuse.js';
import { renderLoadout, renderPicker } from './loadout.js';
import { CROSSHAIR_STYLES, CROSSHAIR_COLORS, CROSSHAIR_DEFAULTS, CROSSHAIR_LIMITS, setCrosshair, drawCrosshair, crosshairCursor } from './crosshair.js';
import { setKeys, savedKeys, resetKeys, isKey, keysFor, keyOf, mouseKey, keyName, keyLabel, keyText, useLayout, boundKeys } from './keys.js';
import { KeybindList } from './keysui.js';
import { loadTuning, tuningToShare, useOwnTuning, tuningVersion } from './tuning.js';
import { DevMenu } from './devmenu.js';
import { DEFAULT_GROUPS, CHOICE_KEYS, defaultRows, changedDefaults, gameDefaults, readDefaults, tidy, equal } from './gamedefaults.js';
import { SKINS, isSkin } from './skins.js';
import { drawSkinPreview } from './skinpreview.js';
import { TileWorld } from './world/tileworld.js';
import { listWorlds, createWorld, loadChunks, saveWorld, deleteWorld, exportWorld, importWorld, FILE_EXT, genOf } from './world/worldsave.js';
import { playerToSave, worldFromSave, dropItem, chestAt, boxFor, boxKind, chestsToSave, chestsFromSave, claimsToSave, claimsFromSave, gravesToSave, gravesFromSave, rehire, REACH, makeRecipe, devTake, stackToChests, fitAttachment, stripGun } from './world/worldplay.js';
import { warp, waystonesToSave, waystonesFromSave } from './world/waystones.js';
import { boatsToSave, boatsFromSave } from './world/boats.js';
// (The creatures out there, asleep or awake, and where the townsfolk were: kept with the world.)
import { sleepersToSave, sleepersFromSave } from './world/sleepers.js';
import { folkToSave, folkFromSave } from './world/townsfolk.js';
// (Building and decorating: signs, blueprints going up, the pick block and undo keys.)
import { signsToSave, signsFromSave, SIGN_MAX } from './world/decor.js';
import { finishBuildings, buildAction, signWrite } from './world/worldplay.js';
import { skyHears } from './world/sky.js';
import { WORLD_SETTINGS, cleanSettings, settingsSummary, kitOf } from './world/worldrules.js';
import { itemOf } from './world/items.js';
import { InventoryScreen } from './world/inventoryui.js';
import { TalkScreen } from './world/talkui.js';
import { talkView, talkDo, endTalk } from './world/talk.js';
import { JournalScreen } from './world/questui.js';
import { DevPanel } from './world/devpanel.js';
import { scopeOf } from './world/attachments.js';
import { newScopeView, scopeWheel, shotEnd, SCOPE_OFF, SCOPE_SNIPER, SCOPE_FAR } from './scope.js';
// (What a fight tells you: hits landing, where you're hit from, who killed you.)
import { newFeedback, hearFeedback, watchHealth, seeKills, beatDue, feedbackView } from './feedback.js';
import { TEAM_PALETTES, setTeamPalette } from './teamcolors.js';
import { footsteps } from './footsteps.js';
import { rightHand } from './world/worldplay.js';
import { devAct } from './world/devtools.js';
import { questsOf, dropQuest } from './world/quests.js';
import { spendPoint } from './world/progress.js';
import { PlayerMenu, TradeScreen } from './world/socialui.js';
import { socialOptions, socialDo, tradeView, offerTrade, acceptTrade, cancelTrade, shareQuest } from './world/social.js';
import { progOf } from './world/progress.js';
import { WorldHost, WorldClient } from './world/worldnet.js';
import { seedOf } from './world/noise.js';
import { setDev, devKey, devView } from './world/devmode.js';

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
  world: null,         // playing a world: { rec (as kept: worldsave.js), game, savedAt }
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
const prefs = { teamColors: 'standard', graphics: 'canvas', graphicsPicked: false, fpsCap: 'auto', showFps: false, showPing: true, sprint: 'hold', quality: 'auto', pointer: 'system', fullscreen: false, volume: 60, aimZoom: 'slight', crosshair: { ...CROSSHAIR_DEFAULTS }, camera: { ...CAMERA_DEFAULTS }, keys: {}, skin: 'auto' };
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
  teamColors: 'standard', // the two sides' colours: 'standard', or 'strong' (colour-blind friendly): teamcolors.js
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
  skin: 'auto',    // how your soldier looks (Settings, Character: skins.js); 'auto' is each game's own
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
  if (!isSkin(s.skin)) s.skin = 'auto';
  if (!TEAM_PALETTES[s.teamColors]) s.teamColors = 'standard';
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
// closer, and further toward where you aim. A sniper's scope zooms out instead (scope.js).
const AIM_ZOOM = { off: 1, slight: 1.1, more: 1.2 };
const SIGHTED = new Set(['bullet', 'arrow', 'rocket', 'seeker', 'flame']); // (the weapons with sights: guns)
const FAR_FOLLOW = 110; // ms the camera takes going to a sniper's far view (further than it can see at once: there at once)

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

/** The game setup's choices, as saved (at the start, and when pasted into the developer menu). */
function fillSetup(settings) {
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
  $('mute').checked = settings.muted;
  audio.setMuted(settings.muted);
}

function buildMenu(settings) {
  fillSetup(settings);
  $('playClass').innerHTML = CLASS_IDS.map(c => `<option value="${c}">${CLASSES[c].name}</option>`).join('');
  $('playClass').value = profile.cls;
  $('playClass').addEventListener('change', () => { profile.cls = $('playClass').value; saveKit(profile); });
  // (Remembered for this mode first: modeFields() shows the choice remembered for the mode.)
  $('classes').addEventListener('change', () => { rememberMenu(); modeFields(); });
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
  $('tabOffline').setAttribute('aria-pressed', String(tab !== 'online' && tab !== 'worlds'));
  $('tabWorlds').setAttribute('aria-pressed', String(tab === 'worlds'));
  show('online', tab === 'online');
  show('worlds', tab === 'worlds');
  show('setup', tab !== 'online' && tab !== 'worlds');
  if (tab === 'online') { startWatching(); setupFor('offline', false); }
  else if (tab === 'worlds') { stopWatching(); setupFor('offline', false); show('setup', false); renderWorlds(); }
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
  // Our own numbers (Settings, Developer), camera and aiming zoom for a game of ours: someone else's game had theirs.
  useOwnRules();
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
  // (And on the developer menu's numbers: jumps and runs are worked out with them.)
  const navKey = `${map.navKey}@${settings.speed}@${tuningVersion()}`;
  if (!maps.nav.has(navKey)) maps.nav.set(navKey, new NavGraph(new GameMap(map.data)));
  const nav = game.useNav(maps.nav.get(navKey));
  const rng = makeRng((Math.random() * 2 ** 31) | 0);

  const team = game.rules.teams ? (settings.side === 2 ? 2 : 1) : 0;
  state.me = game.addSoldier({ name: settings.name, isBot: false, team, skin: prefs.skin }, new PlayerController(input, () => renderer, playerOptions));

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
  // (A world: where it starts, not the middle of all of it.)
  const at = game.world?.spawns[0];
  renderer.snapCamera(at ? at.x : (b.left + b.right) / 2, at ? at.y - 20 : (b.top + b.bottom) / 2);
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
  state.feedback = newFeedback();
  state.deathLook = { x: 0, y: 0 };
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
  // A world: kept as it is now (and the soldier's things and where they are). Its chunk maker stopped.
  if (state.world) saveWorldNow(true);
  state.game?.world?.stopWorker?.();
  closeInventory();
  closeTalk();
  closeJournal();
  closeDevPanel();
  closePlayerMenu();
  closeTrade(false);
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
  if (state.tab === 'worlds') renderWorlds();
}

function openEditor(record) {
  stopWatching();
  show('menu', false);
  $('edMode').value = readMenu().mode;
  editor.open(record);
}

function toast(text, ms = 5000) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), ms);
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
  // (A team game: over to the other side, while that's fair. Bots even the sides up after.)
  const sides = !!state.game?.rules.teams && !state.world && !!state.me && !state.me.spectating && !state.game.over;
  show('switchTeam', sides);
  if (sides) $('switchTeam').textContent = `Change sides (to ${state.me.team === 1 ? 'Red' : 'Blue'})`;
  $('quit').textContent = state.mode === 'host' ? 'End game for everyone' : state.mode === 'client' ? 'Leave game' : state.world ? 'Save and quit' : 'Quit to menu';
  // (A world: no restarting it, and no sitting out to watch. Pausing keeps it as it is.)
  if (state.world) { show('restart', false); show('spectate', false); if (p) saveWorldNow(); }
  else show('spectate', true);
  if (p) { closeInventory(); closeTalk(); closeJournal(); closeDevPanel(); closePlayerMenu(); }
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

/**
 * Over to the other side (from the menu, in a team game). Online, the host decides (it's fair
 * while it doesn't leave that side with two more players than the other); the host, or anyone
 * playing bots, just goes. Bots even the sides up after, and it's kept for the next match.
 */
function changeSides() {
  const g = state.game, me = state.me;
  if (!g || !me || g.over || !g.rules.teams) return;
  if (state.mode === 'client') state.net?.client?.sendTeam();
  else {
    const why = state.mode === 'host' ? state.net?.host?.switchTeam(me, true) : (g.switchTeam(me, 3 - me.team) ? (g.evenTeams(), null) : 'Not now');
    if (why) toast(why);
    else if (state.settings) state.settings.side = me.team;
  }
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
  return !!g && !g.over && !state.menuOpen && !state.chatOpen && !state.pickerOpen && !buyMenu?.open && !invScreen?.open && !talkScreen?.open && !journal?.open && !devPanel?.open && !playerMenu?.open && !tradeScreen?.open &&
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

// ---- Worlds ---------------------------------------------------------------------------------

/** The Worlds tab's list: the worlds kept in this browser, the last played first. */
async function renderWorlds() {
  const el = $('worldList');
  let list;
  try { list = await listWorlds(); }
  catch (err) { el.innerHTML = `<p class="muted-note">This browser can't keep worlds: ${esc(err?.message || err)}</p>`; return; }
  state.worldList = list;
  if (!list.length) { el.innerHTML = '<p class="muted-note">No worlds yet: make one below.</p>'; return; }
  const when = t => {
    const d = new Date(t), today = new Date();
    return d.toDateString() === today.toDateString() ? `today, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  el.innerHTML = list.map(w => `
    <div class="world-card" data-world="${esc(w.id)}">
      <div class="world-info"><b>${esc(w.name)}</b><span class="muted-note">Seed ${esc(w.seed)} &middot; played ${esc(when(w.played))}${settingsSummary(w.settings) ? ` &middot; ${esc(settingsSummary(w.settings))}` : ''}${w.over ? ' &middot; <b>over</b> (hardcore)' : ''}</span></div>
      <button type="button" class="primary" data-act="play">Play</button>
      <button type="button" data-act="host" title="Play it online: friends can join (keep it open while they play)">Host online</button>
      <button type="button" class="small" data-act="export">Export</button>
      <button type="button" class="small" data-act="delete">Delete</button>
    </div>`).join('');
}

/** A click in the list of worlds: play, export or delete one. */
async function worldAction(e) {
  const b = e.target.closest('button[data-act]'), card = e.target.closest('[data-world]');
  if (!b || !card) return;
  const rec = state.worldList?.find(w => w.id === card.dataset.world);
  if (!rec) return;
  audio.unlock();
  if (b.dataset.act === 'play') { audio.play('menuSelect'); startWorld(rec); return; }
  if (b.dataset.act === 'host') { audio.play('menuSelect'); startWorld(rec, { online: true }); return; }
  if (b.dataset.act === 'export') {
    try {
      const { text, file } = await exportWorld(rec.id);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: file });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) { toast(`Couldn't export that world: ${err?.message || err}`); }
    return;
  }
  if (b.dataset.act === 'delete' && confirm(`Delete "${rec.name}"? Everything built in it goes too, and this can't be undone.`)) {
    await deleteWorld(rec.id).catch(err => toast(`Couldn't delete it: ${err?.message || err}`));
    renderWorlds();
  }
}

/** A new world, from the Worlds tab (its seed as typed, or a random one), played straight away. */
async function newWorld() {
  audio.unlock(); audio.play('menuSelect');
  const typed = $('worldSeed').value.trim();
  const seed = typed ? seedOf(typed) : (Math.random() * 2 ** 31) | 0;
  const n = (state.worldList?.length || 0) + 1;
  try {
    // (Its settings, as chosen: worldrules.js.)
    const settings = cleanSettings(Object.fromEntries(Object.keys(WORLD_SETTINGS).map(k => [k, $(`ws-${k}`)?.value])));
    const rec = await createWorld({ name: $('worldName').value.trim() || `World ${n}`, seed, settings });
    $('worldName').value = '';
    $('worldSeed').value = '';
    startWorld(rec);
  } catch (err) { toast(`Couldn't make the world: ${err?.message || err}`); }
}

/**
 * Play world `rec` (as kept): its changed chunks loaded, you back where you were with your
 * things. online: hosted, for friends to join (the Worlds tab's choices: how many, who, PvP).
 */
async function startWorld(rec, { online = false } = {}) {
  stopWatching();
  state.returnTo = 'menu';
  state.settings = readMenu();
  show('menu', false); show('pause', false); show('over', false); show('connecting', false);
  $('toEditor').classList.add('hidden');
  show('loading', true);
  await new Promise(r => setTimeout(r, 30));
  let saved;
  try { saved = await loadChunks(rec.id); }
  catch (err) { show('loading', false); showMenu(); toast(`Couldn't load that world: ${err?.message || err}`); return; }
  // Our own numbers (Settings, Developer), camera and aiming zoom: a world's played offline.
  useOwnRules();
  // (Its settings, as it was made: worlds from before them, as they were then: worldrules.js.)
  const settings = cleanSettings(rec.settings || { death: rec.death });
  const world = new TileWorld({ seed: rec.seed, name: rec.name, saved, gen: genOf(rec), noTowns: settings.towns === 'off' });
  world.settings = settings;
  chestsFromSave(world, rec.chests);
  gravesFromSave(world, rec.graves);
  waystonesFromSave(world, rec.waystones);
  boatsFromSave(world, rec.boats);
  signsFromSave(world, rec.signs);
  sleepersFromSave(world, rec.creatures);
  folkFromSave(world, rec.folk);
  // (What's lost on dying: in a grave.)
  world.death = settings.death;
  claimsFromSave(world, rec.claims);
  world.time = Number.isFinite(rec.time) ? rec.time : 0;
  // (What the towns' shops have sold today.)
  world.townState = rec.towns && typeof rec.towns === 'object' ? structuredClone(rec.towns) : {};
  if (online) rec.pvp = $('worldPvp').value !== 'off';
  world.pvp = rec.pvp !== false;
  // (Seeing only what can be seen: fog of war's hiding of what's out of sight, the world's way.)
  const game = new Game({ world, mode: 'world', speed: state.settings.speed, options: { destruction: true, crates: 'off', streaks: false, fog: settings.vision === 'sight' }, seed: (Math.random() * 2 ** 31) | 0 });
  state.step = 1000 / game.tickRate;
  const me = game.addSoldier({ name: playerName(), isBot: false, team: 0, skin: prefs.skin }, new PlayerController(input, () => renderer, playerOptions));
  me.world = worldFromSave(rec.player, kitOf(world));
  me.respawnTimer = 1;
  rehire(game, me);
  state.mode = 'offline';
  rec.played = Date.now();
  state.world = { rec, game, savedAt: performance.now(), sync: null };
  if (online) hostWorld(game, rec);
  enterMatch(game, me);
  const at = me.world.resume || world.spawns[0];
  renderer.snapCamera(at.x, at.y - 20);
}

/** The world being played, hosted online: friends can join it (worldnet.js keeps them in step). */
function hostWorld(game, rec) {
  const net = state.net = { role: 'host' };
  const settings = net.settings = {
    name: playerName(), maxPlayers: Math.max(2, Math.min(16, +$('worldMax').value || 8)), visibility: $('worldVis').value === 'private' ? 'private' : 'public',
    gameName: `${playerName()}'s world`,
  };
  // (Players who've been here before have their things back: kept in the world, by name.)
  const sync = state.world.sync = new WorldHost(game, {
    load: name => rec.players?.[name.toLowerCase()] || null,
    save: (name, data) => { (rec.players ||= {})[name.toLowerCase()] = data; },
  });
  net.matchInfo = { mode: 'world', mapName: rec.name, speed: game.speed, options: game.options };
  net.host = new NetHost({
    maxPlayers: settings.maxPlayers, botCount: 0, world: sync,
    matchInfo: () => ({ ...net.matchInfo, world: sync.info(), ...rulesToShare() }),
    addBot: () => {},
    onChange: () => net.handle?.update(),
    onChat: m => addChat(m),
  });
  net.host.setGame(game);
  state.mode = 'host';
  net.handle = getLobby().host({
    info: () => ({
      name: settings.gameName, hostName: settings.name, mapName: rec.name, mode: 'world',
      players: net.host.humans, max: settings.maxPlayers, bots: 0, private: settings.visibility === 'private',
    }),
    accept: () => (net.host.humans >= net.host.opts.maxPlayers ? 'That world is full' : null),
    onPlayer: (link, name) => net.host.addPlayer(link, name),
  });
  addChat({ system: true, text: `Your world is online${settings.visibility === 'private' ? ' (invite only)' : ''}, PvP ${game.world.pvp ? 'on' : 'off'}: press Esc to copy an invite link.` });
}

/**
 * Keep the world being played (its changed chunks, and your things and where you are).
 * last: it's being left (let go of once it's kept).
 */
function saveWorldNow(last = false) {
  const w = state.world;
  if (!w) return Promise.resolve();
  if (last) state.world = null;
  w.savedAt = performance.now();
  const me = w.game.soldiers.find(s => s.world && !s.isBot && !s.remote);
  if (me) w.rec.player = playerToSave(me, w.game);
  // (Hardcore: once your one life's spent, the world says so.)
  if (me?.world?.over) w.rec.over = true;
  // (Hosted: the players in it keep their things too.)
  w.sync?.saveAll();
  // (Buildings going up from blueprints: finished, so what's saved has them whole.)
  finishBuildings(w.game);
  w.rec.signs = signsToSave(w.game.world);
  w.rec.chests = chestsToSave(w.game.world);
  w.rec.graves = gravesToSave(w.game.world);
  w.rec.waystones = waystonesToSave(w.game.world);
  w.rec.claims = claimsToSave(w.game.world);
  w.rec.boats = boatsToSave(w.game.world);
  w.rec.creatures = sleepersToSave(w.game);
  w.rec.folk = folkToSave(w.game);
  w.rec.time = Math.round(w.game.world.time || 0);
  w.rec.towns = w.game.world.townState || {};
  w.rec.played = Date.now();
  const chunks = w.game.world.takeDirty();
  return saveWorld(w.rec, chunks).catch(err => {
    // (Kept for the next try.)
    for (const c of chunks) c.dirty = true;
    toast(`Couldn't save the world: ${err?.message || err}`);
  });
}

/** A world file chosen (the Worlds tab's Import): kept here as a new world. */
async function importWorldFile(file) {
  if (!file) return;
  try {
    const rec = await importWorld(await file.text());
    toast(`"${rec.name}" is in your worlds`);
    renderWorlds();
  } catch (err) { toast(err?.message || String(err)); }
}

// ---- Worlds: the inventory screen ----------------------------------------------------------------

let invScreen = null;
const getInventory = () => (invScreen ||= new InventoryScreen($('inventory'), {
  drop: i => dropFromInventory(i), craft: (r, times) => craftItem(r, times), close: () => closeInventory(),
  // (Attachments on guns: attachments.js.)
  attach: (i, j) => { const g = state.game, me = state.me; if (g?.world && me?.world) { const t = fitAttachment(g, me, i, j); if (t) localNote(t); } },
  detach: i => { const g = state.game, me = state.me; if (g?.world && me?.world) { const t = stripGun(g, me, i); if (t) localNote(t); } },
  // (Your bag into the chests near you that have some of the same: worldplay.js.)
  stack: () => { const g = state.game, me = state.me; if (g?.world && me?.world) localNote(stackToChests(g, me)); },
}));

/**
 * I: your things (the game carries on; your soldier stands still while it's open). chest: one
 * opened with a right click ({ inv, tx, ty }), shown beside them.
 */
function openInventory(chest = null) {
  const g = state.game, me = state.me;
  if (!g?.world || !me?.world || state.menuOpen || state.chatOpen || g.over) return;
  const inv = getInventory();
  inv.remote = state.mode === 'client' ? op => state.net?.client?.link.send({ t: 'wop', ...op }, true) : null;
  inv.show(me, g, chest);
  input.enabled = false;
  input.clear();
  input.unlock();
}

function closeInventory() {
  if (!invScreen?.open) return;
  // (In someone else's world: the host's told the chest's closed.)
  if (invScreen.chest && state.mode === 'client') state.net?.client?.link.send({ t: 'wop', op: 'close' }, true);
  invScreen.hide();
  if (state.game && !state.menuOpen && !state.chatOpen && !state.game.over) { input.enabled = true; grabControls(); }
}

// ---- Worlds: talking to townsfolk -------------------------------------------------------------------

let talkScreen = null;
const getTalk = () => (talkScreen ||= new TalkScreen($('talk'), { act: d => talkAct(d), close: () => closeTalk(true) }));

/** A talk began or changed (talk.js's view of it): shown (the game carries on; your soldier stands still). */
function showTalk(view) {
  const g = state.game, me = state.me;
  if (!g?.world || !me?.world || state.menuOpen || g.over) return;
  if (invScreen?.open) closeInventory();
  const t = getTalk();
  const was = t.open;
  t.show(view, me);
  if (!was) {
    input.enabled = false;
    input.clear();
    input.unlock();
  }
}

/** The talk screen closed (bye: said goodbye, so the talk's ended too). */
function closeTalk(bye = false) {
  if (!talkScreen?.open) return;
  talkScreen.hide();
  const g = state.game, me = state.me;
  if (bye && g && me) {
    if (state.mode === 'client') state.net?.client?.link.send({ t: 'wop', op: 'talk', d: { op: 'bye' } }, true);
    else endTalk(g, me);
  }
  if (g && !state.menuOpen && !state.chatOpen && !g.over && !invScreen?.open) { input.enabled = true; grabControls(); }
}

/** Something done in a talk (buying, selling, healing...): online, the host does it. */
function talkAct(d) {
  const g = state.game, me = state.me;
  if (!g?.world || !me?.world) return;
  if (state.mode === 'client') { state.net?.client?.link.send({ t: 'wop', op: 'talk', d }, true); return; }
  talkDo(g, me, d);
  audio.play('click');
}

// ---- Worlds: the journal (quests, level and perks) --------------------------------------------------

let journal = null;
const getJournal = () => (journal ||= new JournalScreen($('journal'), { act: d => journalAct(d), close: () => closeJournal() }));

/** J: the journal (the game carries on; your soldier stands still while it's open). */
function openJournal(tab = null) {
  const g = state.game, me = state.me;
  if (!g?.world || !me?.world || state.menuOpen || state.chatOpen || g.over) return;
  closeInventory();
  getJournal().show(me, tab);
  input.enabled = false;
  input.clear();
  input.unlock();
}

function closeJournal() {
  if (!journal?.open) return;
  journal.hide();
  const g = state.game;
  if (g && !state.menuOpen && !state.chatOpen && !g.over && !invScreen?.open && !talkScreen?.open && !devPanel?.open) { input.enabled = true; grabControls(); }
}

// ---- Worlds: the dev menu (P in dev mode: devpanel.js, devtools.js) ------------------------------------

let devPanel = null;
const getDevPanel = () => (devPanel ||= new DevPanel($('devPanel'), { act: (a, arg) => devPanelAct(a, arg), kick: id => devKick(id), close: () => closeDevPanel() }));

/** P in dev mode: the dev menu (the game carries on; your soldier stands still while it's open). */
function openDevPanel() {
  const g = state.game, me = state.me;
  if (!g?.world || !me?.world || !devView(me) || state.menuOpen || state.chatOpen || g.over) return;
  closeInventory();
  closeJournal();
  getDevPanel().show(me, g, state.mode !== 'client');
  holdStill();
}

function closeDevPanel() {
  if (!devPanel?.open) return;
  devPanel.hide();
  letGo();
}

/** Something done in the dev menu (online, in someone else's creative world, the host does it). */
function devPanelAct(act, arg) {
  const g = state.game, me = state.me;
  if (!g?.world || !me?.world) return;
  audio.play('click');
  if (state.mode === 'client') { state.net?.client?.link.send({ t: 'wop', op: 'dev', act, arg }, true); return; }
  const text = devAct(g, me, act, arg, true);
  if (text) { localNote(text); devPanel?.say(text); }
}

/** The host sends a player away (the dev menu's Players). */
function devKick(id) {
  const g = state.game, o = g?.soldiers.find(s => s.id === id);
  if (state.mode !== 'host' || !o) return;
  if (state.net?.host?.kick(id)) { localNote(`${o.name} was sent away`); devPanel?.say(`${o.name} was sent away`); }
}

/** Something done in the journal: following a quest, giving one up, spending a perk point (online, the host does it). */
function journalAct(d) {
  const g = state.game, me = state.me;
  if (!g?.world || !me?.world || typeof d?.op !== 'string') return;
  if (state.mode === 'client') { state.net?.client?.link.send({ t: 'wop', ...d }, true); audio.play('click'); return; }
  const qs = questsOf(me);
  if (d.op === 'qtrack' && qs.list.some(q => q.id === d.id)) { qs.track = d.id; qs.v++; }
  else if (d.op === 'qdrop') dropQuest(me, d.id);
  else if (d.op === 'qshare') { const text = shareQuest(g, me, d.id); if (text) localNote(text); }
  else if (d.op === 'perk') { const text = spendPoint(me, d.id); if (text) localNote(text); }
  // (Dev mode: something from the codex, free.)
  else if (d.op === 'devtake') { const text = devTake(g, me, d.id); if (text) localNote(text); }
  audio.play('click');
}

// ---- Worlds online: another player (party, trade: social.js) ---------------------------------------------

let playerMenu = null, tradeScreen = null;
const getPlayerMenu = () => (playerMenu ||= new PlayerMenu($('playerMenu'), { pick: (v, op) => playerPick(v, op), close: () => closePlayerMenu() }));
const getTrade = () => (tradeScreen ||= new TradeScreen($('trade'), {
  offer: (slots, coins) => tradeAct({ op: 'toffer', slots, coins }), accept: () => tradeAct({ op: 'taccept' }), cancel: () => closeTrade(true),
}));
/** A screen over the game that holds your soldier still. */
function holdStill() { input.enabled = false; input.clear(); input.unlock(); }
function letGo() {
  const g = state.game;
  if (g && !state.menuOpen && !state.chatOpen && !g.over && !invScreen?.open && !talkScreen?.open && !journal?.open && !devPanel?.open && !playerMenu?.open && !tradeScreen?.open) { input.enabled = true; grabControls(); }
}

/** Another player right clicked on: what you can do with them ({ id, name, level, options }). */
function showPlayerMenu(view) {
  if (!state.game?.world || state.menuOpen) return;
  getPlayerMenu().show(view);
  holdStill();
}
function closePlayerMenu() { if (!playerMenu?.open) return; playerMenu.hide(); letGo(); }
function playerPick(view, op) {
  const g = state.game, me = state.me;
  closePlayerMenu();
  if (!g?.world || !me?.world || !view) return;
  // (A waystone's list: going there: waystones.js.)
  if (view.kind === 'waystone') {
    if (state.mode === 'client') state.net?.client?.link.send({ t: 'wop', op: 'warp', from: view.id, to: op }, true);
    else { const text = warp(g, me, view.id, op); if (text) localNote(text); }
    audio.play('click');
    return;
  }
  if (state.mode === 'client') state.net?.client?.link.send({ t: 'wop', op: 'social', id: view.id, act: op }, true);
  else { const o = g.soldiers.find(x => x.id === view.id), text = o && socialDo(g, me, o, op); if (text) localNote(text); }
  audio.play('click');
}

/** A trade began, changed, or ended (null). */
function showTrade(view) {
  const me = state.me;
  if (!view) { if (tradeScreen?.open) { tradeScreen.hide(); letGo(); } return; }
  if (!state.game?.world || !me?.world) return;
  const was = tradeScreen?.open;
  getTrade().show(view, me);
  if (!was) holdStill();
}
function closeTrade(cancel) {
  if (cancel) tradeAct({ op: 'tcancel' });
  if (tradeScreen?.open) { tradeScreen.hide(); letGo(); }
}
function tradeAct(d) {
  const g = state.game, me = state.me;
  if (!g?.world || !me?.world) return;
  if (state.mode === 'client') { state.net?.client?.link.send({ t: 'wop', ...d }, true); return; }
  if (d.op === 'toffer') offerTrade(g, me, d.slots, d.coins);
  else if (d.op === 'taccept') { const text = acceptTrade(g, me); if (text) localNote(text); }
  else if (d.op === 'tcancel') cancelTrade(g, me);
}

/** The inventory screen's crafting: recipe r made up to `times` times (what doesn't fit goes on the ground). */
function craftItem(r, times) {
  const g = state.game, me = state.me;
  if (!g?.world || !me?.world || !me.alive) return;
  if (state.mode === 'client') { state.net?.client?.link.send({ t: 'wop', op: 'craft', r: r.id, times }, true); audio.play('click'); return; }
  // (Free in dev mode, worldplay.js.)
  const made = makeRecipe(g, me, r, times);
  if (!made) return;
  audio.play('click');
  localNote(`Made ${made * r.n} × ${itemOf(r.key).name}`);
}

/** The inventory screen's Drop: slot i's stack, thrown in front of you. */
function dropFromInventory(i) {
  const g = state.game, me = state.me;
  if (!g?.world || !me?.world || !me.alive) return;
  if (state.mode === 'client') { state.net?.client?.link.send({ t: 'wop', op: 'drop', i }, true); return; }
  const taken = me.world.inv.take(i);
  if (taken) dropItem(g, taken.key, taken.n, me.x + me.facing * 8, me.y - 14, me.facing * 3, -2, 60, taken.g || null);
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
  fillSettings();
  showSettingsPage(state.settingsPage);
  show('settings', true);
  $('settingsDone').focus();
}

/** The Settings screen's controls, as chosen. */
function fillSettings() {
  // Experimental: the same choices as the game setup's.
  $('setBotVision').value = $('botVision').value;
  $('setFog').value = $('fog').value;
  $('graphics').value = prefs.graphics;
  $('quality').value = prefs.quality;
  $('sprintMode').value = prefs.sprint === 'toggle' ? 'toggle' : 'hold';
  $('fpsCap').value = String(prefs.fpsCap);
  $('showFps').checked = prefs.showFps;
  $('showPing').checked = prefs.showPing;
  $('teamColors').value = TEAM_PALETTES[prefs.teamColors] ? prefs.teamColors : 'standard';
  $('pointerMode').value = prefs.pointer === 'locked' ? 'locked' : 'system';
  $('fullscreenPref').checked = prefs.fullscreen;
  $('aimZoom').value = AIM_ZOOM[prefs.aimZoom] ? prefs.aimZoom : 'slight';
  showCrosshair();
  showCamera();
  keybinds.render();
  devMenu.render();
  showSkins();
  settingsNotes();
}

/** Show one section of Settings (the one last looked at, when it opens again). */
function showSettingsPage(page) {
  const pages = [...document.querySelectorAll('#settings .set-page')];
  if (!pages.some(p => p.dataset.page === page)) page = pages[0].dataset.page;
  for (const p of pages) p.classList.toggle('hidden', p.dataset.page !== page);
  for (const t of document.querySelectorAll('#settings .set-tab')) t.setAttribute('aria-selected', String(t.dataset.page === page));
  state.settingsPage = page;
  // (The developer menu shows what's chosen in the other sections: as it is now.)
  if (page === 'dev') devMenu.render();
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

/** A camera setting changed: use it (straight away, mid-match too; in someone else's game, from our own next), save it and show it. */
function changeCamera(change) {
  prefs.camera = tidyCamera({ ...prefs.camera, ...change });
  if (!hostFeel) setCamera(prefs.camera);
  savePrefs();
  showCamera();
  shareRules();
}

// In someone else's game, everyone sees it as its host does: the host's camera, and how far
// aiming down the sights zooms (Settings). Ours are kept, for our own games. (Null in ours.)
let hostFeel = null;
/** Our camera and aiming zoom, for the players in our game. */
const feelToShare = () => ({ camera: { ...prefs.camera }, aimZoom: prefs.aimZoom });
/** Use the host's camera and aiming zoom (null: our own again). */
function useHostFeel(f) {
  hostFeel = f && typeof f === 'object' ? { camera: tidyCamera(f.camera), aimZoom: AIM_ZOOM[f.aimZoom] ? f.aimZoom : 'slight' } : null;
  setCamera(hostFeel ? hostFeel.camera : prefs.camera);
  for (const el of document.querySelectorAll('.host-feel')) el.classList.toggle('hidden', !hostFeel);
}
/** How much aiming down the sights zooms: the host's, in someone else's game. */
const aimZoomNow = () => AIM_ZOOM[hostFeel ? hostFeel.aimZoom : prefs.aimZoom] ?? 1;
/** Back to our own numbers, camera and aiming zoom (our own games, or out of someone else's). */
function useOwnRules() {
  useOwnTuning();
  useHostFeel(null);
}

// Our numbers (Settings, Developer), camera and aiming zoom: everyone in a game we host goes by
// them, as they join and whenever we change one (sent once it's settled: a slider being dragged
// sends the last of it).
const rulesToShare = () => ({ tuning: tuningToShare(), feel: feelToShare() });
let rulesTimer = 0;
function shareRules() {
  if (state.net?.role !== 'host') return;
  clearTimeout(rulesTimer);
  rulesTimer = setTimeout(() => { if (state.net?.role === 'host') state.net.host?.broadcast({ t: 'rules', ...rulesToShare() }); }, 150);
}

// The keys (Settings: Controls): the list of actions and their keys, saved as they change.
const keybinds = new KeybindList($('keybinds'), {
  onChange: () => { prefs.keys = savedKeys(); savePrefs(); showKeys(); },
  classes: () => CLASSES_ON,
});

// ---- Settings, Character: how your soldier looks (skins.js) -------------------------------

let skinsDrawnFor = null; // (the game the cards' pictures were drawn for)

/** The skins to pick from (a picture of each, as this game draws it), and a big picture of yours. */
function showSkins() {
  const box = $('skinCards'), look = edition === 'remastered' ? 'remastered' : 'original';
  if (!box.children.length) {
    for (const k of SKINS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'skin-card';
      b.dataset.skin = k.id;
      b.setAttribute('role', 'radio');
      b.innerHTML = '<canvas width="240" height="150" aria-hidden="true"></canvas><b></b><small></small>';
      b.querySelector('b').textContent = k.name;
      b.querySelector('small').textContent = k.blurb;
      b.addEventListener('click', () => setSkin(k.id));
      box.append(b);
    }
  }
  for (const b of box.children) {
    b.setAttribute('aria-checked', String(b.dataset.skin === prefs.skin));
    if (skinsDrawnFor !== look) drawSkinPreview(b.querySelector('canvas'), b.dataset.skin, look, { pair: false });
  }
  skinsDrawnFor = look;
  drawSkinPreview($('skinPreview'), prefs.skin, look);
}

/** Wear a skin: saved, and in a match, at once (online, everyone sees it). */
function setSkin(id) {
  if (!isSkin(id)) return;
  prefs.skin = id;
  savePrefs();
  const me = state.me;
  if (me && state.game) {
    me.skin = id;
    if (state.net?.role === 'host') state.net.host?.rosterChanged();
    if (state.net?.role === 'client') state.net.client?.sendSkin(id);
  }
  showSkins();
}

/** Use the saved Settings' choices (at the start, and when pasted into the developer menu). */
function usePrefs(settings) {
  for (const k in prefs) prefs[k] = settings[k];
  setTeamPalette(prefs.teamColors);
  setVolume(prefs.volume, false);
  prefs.crosshair = setCrosshair(prefs.crosshair);
  prefs.camera = tidyCamera(prefs.camera);
  setCamera(hostFeel ? hostFeel.camera : prefs.camera);
  prefs.keys = setKeys(prefs.keys);
  showKeys();
  pacer.setMode(prefs.fpsCap);
  perf.on = prefs.showFps || params.has('fps');
}

// The developer menu's Settings & setup (gamedefaults.js): the defaults for the choices players
// make, kept apart from your own (just those changed from the game's own), changed there or
// pulled from the current game, copied out to become the game's own.
const DEV_DEFAULTS = 'stick-soldiers-dev-defaults';
function loadDevDefaults() {
  try { const d = JSON.parse(localStorage.getItem(DEV_DEFAULTS) || '{}'); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; } catch { return {}; }
}
function saveDevDefaults(d) {
  try { if (Object.keys(d).length) localStorage.setItem(DEV_DEFAULTS, JSON.stringify(d)); else localStorage.removeItem(DEV_DEFAULTS); } catch { /* private mode */ }
}

// How each is picked there, and checked (gamedefaults.js: tidy): those picked from a list in
// Settings or the game setup, from the same list.
const SELECTS = {
  graphics: 'graphics', quality: 'quality', fpsCap: 'fpsCap', sprint: 'sprintMode', aimZoom: 'aimZoom', pointer: 'pointerMode', teamColors: 'teamColors',
  mode: 'mode', difficulty: 'difficulty', fragLimit: 'fragLimit', side: 'side', lives: 'lives', gunKills: 'gunKills', crates: 'crates',
  destruction: 'destruction', streaks: 'streaks', botVision: 'botVision', fog: 'fog', maxPlayers: 'maxPlayers', visibility: 'visibility',
};
function choiceSpecs() {
  const list = pairs => ({ type: 'select', options: pairs.map(([value, label]) => ({ value, label })) });
  const num = ([min, max], step) => ({ type: 'number', min, max, step });
  const specs = {};
  for (const [key, id] of Object.entries(SELECTS)) {
    specs[key] = list([...$(id).options].map(o => [typeof DEFAULTS[key] === 'number' ? +o.value : o.value, o.textContent.trim()]));
  }
  for (const key of ['showFps', 'fullscreen', 'muted', 'showPing']) specs[key] = { type: 'bool' };
  specs.volume = num([0, 100], 1);
  specs.bots = list(BOT_STEPS.map(n => [n, String(n)]));
  specs.skin = list(SKINS.map(k => [k.id, k.name]));
  specs.map = list(maps.index.map(m => [m.file, m.name]));
  specs.keys = { type: 'keys' };
  const fields = (defs, rows) => rows.map(([key, label, spec]) => ({ key, label, spec, def: defs[key] }));
  specs.crosshair = {
    type: 'fields', fields: fields(CROSSHAIR_DEFAULTS, [
      ['style', 'Style', list(CROSSHAIR_STYLES)], ['color', 'Colour', list(CROSSHAIR_COLORS)], ['custom', 'Custom colour', { type: 'color' }],
      ['size', 'Size', num(CROSSHAIR_LIMITS.size, 1)], ['thickness', 'Thickness', num(CROSSHAIR_LIMITS.thickness, 0.5)],
      ['gap', 'Gap', num(CROSSHAIR_LIMITS.gap, 1)], ['opacity', 'Opacity (%)', num(CROSSHAIR_LIMITS.opacity, 5)], ['outline', 'Edge', { type: 'bool' }],
    ]),
  };
  specs.camera = {
    type: 'fields', fields: fields(CAMERA_DEFAULTS, [
      ['look', 'Look toward the mouse (%)', num(CAMERA_LIMITS.look, 5)], ['glide', 'Look smoothing (ms)', num(CAMERA_LIMITS.glide, 10)],
      ['follow', 'Follow smoothing (ms)', num(CAMERA_LIMITS.follow, 10)],
    ]),
  };
  // (Each objective mode's goal: those not at the mode's own.)
  specs.goals = {
    type: 'fields', sparse: true,
    fields: MODE_IDS.filter(m => MODES[m].goal).map(m => ({
      key: m, label: `${MODES[m].name}: ${MODES[m].goal.label.toLowerCase()}`, def: MODES[m].goal.value,
      spec: list(MODES[m].goal.options.map(v => [v, v === 0 ? 'Auto' : String(v)])),
    })),
  };
  return specs;
}

/** The game's own, for each choice. */
const ownChoices = () => Object.fromEntries(CHOICE_KEYS.map(k => [k, JSON.parse(JSON.stringify(DEFAULTS[k]))]));

/** The defaults, each choice: the game's own, but for those changed in the developer menu. */
function devDefaults(specs = choiceSpecs()) {
  const d = loadDevDefaults(), out = ownChoices();
  for (const k of CHOICE_KEYS) {
    const v = Object.hasOwn(d, k) ? tidy(specs[k], d[k]) : undefined;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Change some of the defaults ({ key: value }, each as tidied up). */
function keepDevDefaults(values) {
  const d = loadDevDefaults();
  for (const [k, v] of Object.entries(values)) {
    if (equal(v, DEFAULTS[k])) delete d[k];
    else d[k] = v;
  }
  saveDevDefaults(d);
}

/**
 * Your choices as they are now (the current game): Settings, and the game setup: the match's,
 * while you're in one you started, the main menu's otherwise. Each tidied up as the defaults are.
 */
function currentChoices(specs = choiceSpecs()) {
  const saved = loadSettings();
  const setup = state.game && state.mode !== 'client' && state.settings ? state.settings : readMenu();
  const out = {};
  for (const g of DEFAULT_GROUPS) {
    for (const [k] of g.fields) {
      const raw = g.id === 'settings' ? (k in prefs ? prefs[k] : saved[k]) : (k in setup ? setup[k] : saved[k]);
      const v = tidy(specs[k], raw);
      out[k] = v === undefined ? raw : v;
    }
  }
  return out;
}

/** Use these choices as yours ({ key: value }: every one, for the defaults tried out). */
function useChoices(values) {
  const was = { graphics: prefs.graphics, quality: prefs.quality, skin: prefs.skin };
  const saved = loadSettings();
  saveSettings({ ...saved, ...values, graphicsPicked: saved.graphicsPicked || values.graphics !== DEFAULTS.graphics });
  const now = loadSettings();
  usePrefs(now);
  savePrefs(); // (as tidied up)
  if (prefs.graphics !== was.graphics) setGraphics(prefs.graphics);
  if (prefs.quality !== was.quality) { renderer.setQuality?.(prefs.quality); pacer.restart(performance.now(), true); }
  if (prefs.pointer !== 'locked') input.unlock();
  if (prefs.skin !== was.skin) setSkin(prefs.skin);
  fillSetup(now);
  modeFields();
  buildMapCards(now.map, { follow: true });
  fillSettings();
  shareRules();
}

const gameChoices = {
  rows() { const specs = choiceSpecs(); return defaultRows(devDefaults(specs), DEFAULTS, currentChoices(specs), specs); },
  changed: () => changedDefaults(devDefaults(), DEFAULTS),
  read: ({ all = false } = {}) => gameDefaults(devDefaults(), DEFAULTS, { all }),
  /** One default changed: kept as tidied up (returned), or undefined if it isn't one it can be. */
  set(key, v) {
    const kept = tidy(choiceSpecs()[key], v);
    if (kept !== undefined) keepDevDefaults({ [key]: kept });
    return kept;
  },
  /** One default (or every one) back to the game's own. */
  reset(key) {
    if (key) keepDevDefaults({ [key]: DEFAULTS[key] });
    else saveDevDefaults({});
  },
  /**
   * One default (or every one) pulled from the current game: made yours. Returns how many
   * changed, and those skipped (yours can't be one: one of your own maps, say).
   */
  pull(key) {
    const specs = choiceSpecs(), mine = currentChoices(specs), was = devDefaults(specs), values = {}, skipped = [];
    for (const k of key ? [key] : CHOICE_KEYS) {
      const v = tidy(specs[k], mine[k]);
      if (v === undefined) skipped.push(k);
      else values[k] = v;
    }
    keepDevDefaults(values);
    return { changed: Object.keys(values).filter(k => !equal(values[k], was[k])).length, skipped };
  },
  /** Choices pasted in: made the defaults (each checked). */
  apply(obj) {
    const { values, skipped } = readDefaults(obj, DEFAULTS, choiceSpecs());
    keepDevDefaults(values);
    return { applied: Object.keys(values).length, skipped };
  },
  /** The defaults tried out: every one made yours, as a new player starts. */
  use() { useChoices(devDefaults()); },
};

// The developer menu (Settings: Developer): the game's numbers (tuning.js), and the choices above.
const devMenu = new DevMenu($('devMenu'), { choices: gameChoices, onChange: shareRules });

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
  koth: 'King of the hill', ctf: 'Capture the flag', conquest: 'Conquest', rush: 'Rush', defuse: 'Defuse', world: 'World',
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
      // (With our numbers, camera and aiming zoom as they are when each player joins.)
      matchInfo: () => ({ ...net.matchInfo, ...rulesToShare() }),
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
        name: net.settings.gameName || `${net.settings.name}'s game`, hostName: net.settings.name, mapName: net.matchInfo.mapName,
        // (As it is now: the map and mode can change between matches.)
        mode: net.settings.mode, players: net.host.humans, max: net.settings.maxPlayers, bots: (net.host.game || game).soldiers.filter(s => s.isBot).length,
        private: net.settings.visibility === 'private',
      }),
      // (Those let in but still connecting count too, for a while: several asking at once don't all get the last place.)
      accept: () => {
        const t = Date.now();
        net.coming = (net.coming || []).filter(at => t - at < 16000);
        if (net.host.humans + net.coming.length >= net.host.opts.maxPlayers) return 'That game is full';
        net.coming.push(t);
        return null;
      },
      onPlayer: (link, name) => { net.coming?.shift(); return net.host.addPlayer(link, name); },
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
  const world = new WorldClient({
    onInv: () => invScreen?.refresh(true),
    onChest: chest => {
      if (!chest) { if (invScreen?.open && invScreen.chest) { invScreen.chest = null; closeInventory(); } return; }
      if (invScreen?.open && invScreen.chest?.tx === chest.tx && invScreen.chest?.ty === chest.ty) { invScreen.chest.inv = chest.inv; invScreen.refresh(true); }
      else { closeInventory(); openInventory(chest); }
    },
    onTalk: view => { if (view) showTalk(view); else closeTalk(); },
    onSocial: view => showPlayerMenu(view),
    onTrade: view => showTrade(view),
    onSign: sign => openSignEditor(sign),
  });
  net.client = new NetClient({
    link, world,
    controller: new PlayerController(input, () => renderer, playerOptions),
    loadMap: async m => {
      if (m.map?.builtin && maps.data.has(m.map.builtin)) return maps.data.get(m.map.builtin);
      if (m.map?.code) return decodeShare(m.map.code);
      throw new Error('unknown map');
    },
    onStart: (game, me) => {
      state.mode = 'client';
      state.returnTo = 'menu';
      // How we look (Settings, Character): the host tells everyone.
      me.skin = prefs.skin;
      net.client.sendSkin(prefs.skin);
      state.step = 1000 / game.tickRate;
      enterMatch(game, me);
    },
    onFeel: f => useHostFeel(f),
    onEnd: reason => {
      if (state.net !== net) return;
      state.net = null;
      useOwnRules();
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
  // (Someone else's game had its own numbers, camera and aiming zoom: ours again.)
  useOwnRules();
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
  // (A sign being written on: left as it was. The box back to chat's.)
  state.signEdit = null;
  $('chatInput').maxLength = 140;
  $('chatInput').placeholder = 'Say something (Enter to send, Esc to cancel)';
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
  // What the fight tells you (feedback.js): a hit of yours landing, where you're hit from (both
  // said as sounds that are yours alone), your health dropping, who killed you (the kill feed),
  // and a heartbeat while you're nearly dead.
  const fb = state.feedback ||= newFeedback();
  hearFeedback(fb, g.sounds, me, now);
  watchHealth(fb, me, now);
  seeKills(fb, g, me, now);
  if (!state.paused && !g.over && beatDue(fb, me, now)) audio.play('heartbeat', 0.55);
  // (Others running near you: their footsteps: footsteps.js.)
  if (!state.paused && !g.over) footsteps(g, me, ear.x, ear.y, g.sounds);
  // (A world: bangs scare the birds off: sky.js.)
  if (g.world) skyHears(g, g.sounds);
  audio.playQueue(g.sounds, ear.x, ear.y, me.id, me.team);
  g.sounds.length = 0;
  // (Online, the hit-stop holds the picture: the game itself can't stop.)
  if (state.mode !== 'offline' && now < state.hitStopUntil && state.drawnOnce) { pacer.drawn(now, 0); return; }

  // (Where the view follows: who's watched, or the free camera.)
  const ax = free ? free.x : lerp(view.prevX ?? view.x, view.x, alpha) + (view.drawDX || 0);
  const ay = free ? free.y : lerp(view.prevY ?? view.y, view.y, alpha) + (view.drawDY || 0);
  // Down a scope, right click held: a sniper rifle in a match; in a world, any gun with a scope
  // (fitted, or a sniper rifle's own: attachments.js), with nothing in the right hand (which right
  // click would use). The sniper view, zoomed out and looking further toward the crosshair; the
  // wheel up, the far view: the camera where the shot would end (whoever or whatever it meets
  // first, or as far as it goes), that spot under the crosshair, and then still, to aim (scope.js).
  const aiming = view === me && me.alive && !watchMode && !state.menuOpen && !state.chatOpen && input.held('aim');
  const scoped = aiming && (g.world ? !rightHand(me).item && !!scopeOf(me.world?.inv?.slots[me.world.slot]) : !!weaponFor(me, me.current)?.zoom);
  const sv = state.scopeView ||= newScopeView();
  // (The shot aimed now: from the shoulder (where it's drawn) through the crosshair.)
  const aimNow = () => {
    const p = renderer.screenToWorld(input.mouse.x, input.mouse.y), gx = me.shoulderX + ax - me.x, gy = me.shoulderY + ay - me.y;
    return [gx, gy, Math.atan2(p.y - gy, p.x - gx)];
  };
  input.scoping = scoped;
  if (!scoped) sv.mode = SCOPE_OFF;
  else {
    if (sv.mode === SCOPE_OFF) sv.mode = SCOPE_SNIPER;
    // (The wheel: a notch at a time, however finely a touchpad sends it. Up: where the shot aimed now ends.)
    if (input.scopeZoom && now - (sv.wheelAt || 0) > 150) {
      scopeWheel(sv, Math.sign(input.scopeZoom), g, me, weaponFor(me, me.current), aimNow);
      sv.wheelAt = now;
    }
  }
  input.scopeZoom = 0;
  const far = sv.mode === SCOPE_FAR, sniping = sv.mode === SCOPE_SNIPER || far;
  // (The far view: the camera put where the shot's end is under the crosshair, as it went there
  // (the sniper view's zoom, kept), and then still in the world, wherever the shooter moves.
  // Kept as the camera's offset from who it follows, to come back to them after, eased.)
  const back = state.scopeBack ||= { x: 0, y: 0 };
  if (far) {
    if (sv.fresh) {
      const sc = renderer.baseScale * renderer.zoomScale * 0.72;
      sv.cx = sv.x - (input.mouse.x - renderer.w / 2) / sc;
      sv.cy = sv.y - (input.mouse.y - renderer.h / 2) / sc;
      sv.fresh = false;
    }
    back.x = sv.cx - ax;
    back.y = sv.cy + 20 - ay;
    // (What the shot aimed now would meet, as the crosshair moves, for the HUD: whether it's on someone.)
    const [gx, gy, a] = aimNow();
    sv.aimed = shotEnd(g, gx, gy, a, sv.reach, me);
  }
  else if (back.x || back.y) { back.x *= 0.7; back.y *= 0.7; if (Math.hypot(back.x, back.y) < 2) back.x = back.y = 0; }
  // (The chunks out there made ready, as round a player, and what lives there awake and about:
  // worldplay.js, sleepers.js.)
  if (g.world) g.world.lookAt = far && sv.cx != null && Math.hypot(sv.cx - ax, sv.cy - ay) > 600 ? { x: sv.cx, y: sv.cy } : null;
  // Aiming down the sights: right click held with a gun (Settings); in a world, with nothing in the right hand.
  const sights = !scoped && me.alive && input.held('aim') && SIGHTED.has(weaponFor(me, me.current)?.kind) && !watchMode && !g.over &&
    !state.menuOpen && !state.chatOpen && !state.pickerOpen && !buyMenu?.open && !(g.world && rightHand(me).item);
  // (A world's dev mode: the wheel, or + and -, zoom a long way out and back in.)
  if (devView(me)) {
    if (input.devZoom) state.devZoom = Math.max(0.08, Math.min(3, (state.devZoom || 1) * Math.pow(1.2, input.devZoom)));
    renderer.zoomScale = state.devZoom || 1;
  } else renderer.zoomScale = 1;
  input.devZoom = 0;
  // (Flying in dev mode: the camera stays right with you, rather than trailing behind, which at
  // that speed leaves you at the edge of the screen, and drifting on after you stop.)
  // (The far view: zoomed out as the sniper view is, not looking toward the mouse; there quickly.)
  // Killed, and waiting to come back: the camera goes over to whoever did it (the recap says who:
  // feedback.js), and it's back with you as you return. (Not while watching the others: out of
  // lives, or spectating.)
  const dl = state.deathLook ||= { x: 0, y: 0 };
  const killer = !me.alive && !watchMode && view === me && !g.over && fb.recap?.killer?.alive && now - fb.recap.at > 450 ? fb.recap.killer : null;
  if (killer) {
    const k = 1 - Math.pow(0.86, dt / (1000 / 60));
    dl.x += (killer.x - ax - dl.x) * k;
    dl.y += (killer.y - ay - dl.y) * k;
  } else if (dl.x || dl.y) {
    if (me.alive) dl.x = dl.y = 0;
    else { dl.x *= 0.8; dl.y *= 0.8; if (Math.hypot(dl.x, dl.y) < 2) dl.x = dl.y = 0; }
  }
  renderer.updateCamera(g, ax + back.x + dl.x, ay + back.y + dl.y, state.menuOpen || watchMode || far ? null : input.mouse, sniping, dt, sights ? aimZoomNow() : 1, devView(me) && view === me ? 0 : far ? FAR_FOLLOW : undefined);
  const aimed = view === me ? liveAim(me, ax, ay) : null;
  const drawStart = performance.now();
  renderer.fogFrom = view;
  // (The far view: only what the shooter can see from where they stand, and no further than the shot goes.)
  renderer.scopeSight = far ? sv.reach : 0;
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
    // (What the fight tells you: a hit landing, where you're hit from, the red at the edges, who killed you: feedback.js.)
    feedback: state.menuOpen ? null : feedbackView(fb, me, now, renderer.w / 2 + (ax - renderer.cam.x) * renderer.scale, renderer.h / 2 + (ay - renderer.cam.y) * renderer.scale, input.mouse.x, input.mouse.y),
    showScores: input.held('scores') && !state.chatOpen, showItems: input.held('showItems') && !state.chatOpen, watching, chat: state.chat,
    // (Down a scope: which view, and in the far one, what the shot aimed now meets: someone (who), something (hit), or
    // nothing; how far out (in blocks, in a world).)
    scope: scoped ? { far, hit: far && !!sv.aimed?.hit, who: far ? sv.aimed?.who?.name || null : null, blocks: far && g.world && sv.aimed ? Math.round(sv.aimed.d / 16) : null } : null,
    spectating: me.spectating ? { free: !!free, target: watching } : null,
    online: state.mode !== 'offline',
    hostId: state.mode === 'host' ? me.id : state.mode === 'client' ? g.soldiers.find(s => !s.isBot && !s.remote)?.id : null,
    ping: !prefs.showPing ? null : client ? client.ping : state.mode === 'host' ? 'Host' : null,
    perf: perf.on ? perf.text : null,
    picking: state.pickerOpen,
  });
  if (hudR !== renderer) renderer.classButton = hudR.classButton;
  // A world: kept every minute (and when it's paused or left); the inventory screen up to date.
  if (state.world && !state.paused && now - state.world.savedAt > 60000) saveWorldNow();
  // (A waystone right clicked, playing here: where it can take you.)
  if (g.world && me.world?.wayMenu) { const v = me.world.wayMenu; me.world.wayMenu = null; showPlayerMenu(v); }
  // (A sign put up, or right clicked, playing here: written on: decor.js.)
  if (g.world && me.world?.signEdit && state.mode !== 'client') { const sg = me.world.signEdit; me.world.signEdit = null; openSignEditor(sg); }
  if (g.world && me.world?.openChest) {
    // (A chest, a shulker box, or your own ender chest: worldplay.js.)
    const c = me.world.openChest, inv = boxFor(g, me, c.tx, c.ty);
    me.world.openChest = null;
    if (inv) openInventory({ inv, tx: c.tx, ty: c.ty, ...boxKind(g.world, c.tx, c.ty) });
  }
  const chest = invScreen?.open && invScreen.chest;
  if (chest && state.mode !== 'client' && (!me.alive || !boxFor(g, me, chest.tx, chest.ty) || Math.hypot(chest.tx * 16 + 8 - me.x, chest.ty * 16 + 8 - me.y) > REACH * 1.5)) closeInventory();
  if (invScreen?.open) invScreen.refresh();
  // Talking to townsfolk (here: in someone else's world, the host says when it begins and ends).
  if (g.world && state.mode !== 'client') {
    const view = me.world?.talk ? talkView(g, me) : null;
    if (view) showTalk(view);
    else if (talkScreen?.open) closeTalk();
  } else if (talkScreen?.open) talkScreen.refresh();
  if (journal?.open) journal.refresh();
  // (The dev menu: as things change; gone with dev mode.)
  if (devPanel?.open) { if (devView(me)) devPanel.refresh(); else closeDevPanel(); }
  // Another player (social.js): here (hosting), right clicked on one; a trade going on.
  if (g.world && state.mode !== 'client' && me.world) {
    if (me.world.social) {
      const o = g.soldiers.find(x => x.id === me.world.social.id);
      me.world.social = null;
      if (o?.world) showPlayerMenu({ id: o.id, name: o.name, level: progOf(o).level, options: socialOptions(g, me, o) });
    }
    const tv = tradeView(g, me);
    if (tv) showTrade(tv); else if (tradeScreen?.open) showTrade(null);
  }
  if (tradeScreen?.open) tradeScreen.refresh();
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
    // (Red down a scope.)
    const pointer = !input.locked, red = scoped;
    showPointer(pointer ? crosshairCursor(edition === 'remastered' ? 'remastered' : 'classic', red, window.devicePixelRatio || 1) : '');
    renderer.drawCrosshair(input.mouse.x, input.mouse.y, red, reload, pointer);
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
    autoNextMatch(g, now);
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
    autoNextMatch(g, now);
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

/** A world's dev mode (devmode.js), on or off: in your own worlds (alone, or hosting), not someone else's. */
function toggleDev() {
  const g = state.game, me = state.me;
  if (!g?.world || !me?.world) return;
  if (state.mode === 'client') { localNote("Dev mode is for your own worlds (played alone, or hosted)"); return; }
  state.devZoom = 1;
  setDev(g, me, !me.world.dev);
}

/**
 * A press of one of the keys main.js reads itself (Settings, Controls: buy, change class, chat,
 * mute), mid-match with no menu open. Returns whether it was one.
 */
function pressMenuKey(key) {
  const g = state.game;
  if (!g || state.menuOpen || state.chatOpen) return false;
  if (isKey('buy', key) && g.rules.buyItem) { openBuy(); return true; }
  if (isKey('inventory', key) && g.world) { openInventory(); return true; }
  if (isKey('devMode', key) && g.world) { toggleDev(); return true; }
  if (isKey('devMenu', key) && g.world && devView(state.me)) { openDevPanel(); return true; }
  if (g.world && state.me?.world?.dev) {
    if (key === 'Equal' || key === 'NumpadAdd') { input.devZoom += 1; return true; }
    if (key === 'Minus' || key === 'NumpadSubtract') { input.devZoom -= 1; return true; }
    // (A key one of the game's actions has is that action's: the journal's, say.)
    if (!boundKeys().has(key) && devKey(g, state.me, key)) return true;
  }
  if (isKey('journal', key) && g.world) { openJournal(); return true; }
  // (Building: the block under the crosshair into your hand; what you last built undone.)
  if (g.world && (isKey('pickBlock', key) || isKey('undo', key))) { worldBuildKey(isKey('undo', key) ? 'undo' : 'pick'); return true; }
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

/** A world's building key (worldplay.js's buildAction): here, or online, the host's to do. */
function worldBuildKey(op) {
  const g = state.game, me = state.me;
  if (!me?.world || !me.alive || state.menuOpen) return;
  if (state.mode === 'client') { state.net?.client?.link.send({ t: 'wop', op }, true); return; }
  const text = buildAction(g, me, op);
  if (text) g.notify(me, text);
}

/** Write on a sign ({ tx, ty, text }: decor.js): the chat box, as a sign's. Enter puts it up. */
function openSignEditor(sign) {
  if (state.chatOpen || !state.game?.world || state.menuOpen) return;
  state.chatOpen = true;
  state.signEdit = sign;
  input.enabled = false;
  input.clear();
  input.unlock();
  show('chatForm', true);
  const el = $('chatInput');
  el.value = sign.text || '';
  el.maxLength = SIGN_MAX;
  el.placeholder = 'Write on the sign (Enter to put it up, Esc to leave it)';
  el.focus();
}

/** What's written on the sign being edited, put up (online: the host's to do). */
function writeSignNow(text) {
  const sign = state.signEdit, g = state.game, me = state.me;
  state.signEdit = null;
  if (!sign || !g?.world || !me) return;
  if (state.mode === 'client') state.net?.client?.link.send({ t: 'wop', op: 'sign', tx: sign.tx, ty: sign.ty, text }, true);
  else signWrite(g, me, sign.tx, sign.ty, text);
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
  // (Once for each match that's over: autoNextMatch.)
  state.nextFor = state.game;
  startMatch(s, { returnTo: state.returnTo, online: state.mode === 'host' });
}

/**
 * Hosting, match g over: the next one, 12 seconds on (18 with a replay to watch first). Called
 * from the results screen as it's drawn, and, with the tab hidden and nothing drawn, from where
 * the game's kept going: either way everyone gets their next match.
 */
function autoNextMatch(g, now) {
  if (state.mode !== 'host' || !g?.over || state.nextFor === g) return;
  if (!state.nextMatchAt) state.nextMatchAt = now + (g.finalKill ? 18000 : 12000);
  else if (now >= state.nextMatchAt) { state.nextMatchAt = 0; nextMatch(); }
}

// Keep online games running in a background tab (browsers pause animation frames there).
function startBackgroundTicker() {
  try {
    // The worker only ticks while the tab is hidden.
    const src = 'let t = null; onmessage = e => { clearInterval(t); t = e.data ? setInterval(() => postMessage(0), 16) : null; };';
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = () => {
      if (!document.hidden || !state.game || state.mode === 'offline') return;
      const now = performance.now();
      simulate(now);
      // (Hosting, the match over with the tab hidden: nothing's drawn, so the results screen's
      // countdown never runs. The next match starts from here instead, or everyone waits for good.)
      if (state.game?.over) autoNextMatch(state.game, now);
    };
    document.addEventListener('visibilitychange', () => worker.postMessage(document.hidden));
    worker.postMessage(document.hidden);
  } catch { /* no workers: online games pause in background tabs */ }
}

// ---- Events ---------------------------------------------------------------------

function wire() {
  $('tabOnline').addEventListener('click', () => { showTab('online'); rememberMenu(); });
  $('tabOffline').addEventListener('click', () => { showTab('offline'); rememberMenu(); });
  $('tabWorlds').addEventListener('click', () => { showTab('worlds'); rememberMenu(); });
  $('worldList').addEventListener('click', worldAction);
  $('newWorldForm').addEventListener('submit', e => { e.preventDefault(); newWorld(); });
  // (A new world's settings: a choice for each, as worldrules.js has them.)
  $('worldSettings').querySelector('[data-ws]').innerHTML = Object.entries(WORLD_SETTINGS).map(([k, d]) => `<label class="field" title="${esc(d.tip || '')}">${esc(d.label)}
    <select id="ws-${k}">${Object.entries(d.options).map(([v, t]) => `<option value="${v}"${v === d.def ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`).join('');
  $('importWorld').addEventListener('click', () => $('importWorldFile').click());
  $('importWorldFile').addEventListener('change', () => { importWorldFile($('importWorldFile').files[0]); $('importWorldFile').value = ''; });
  // (Leaving the page mid-world: kept as it is, as far as the browser lets it finish.)
  window.addEventListener('pagehide', () => { if (state.world) saveWorldNow(); });
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
  $('switchTeam').addEventListener('click', changeSides);
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
  // (The two sides' colours, everywhere they're drawn: teamcolors.js.)
  $('teamColors').addEventListener('change', () => { prefs.teamColors = setTeamPalette($('teamColors').value); savePrefs(); });
  $('sprintMode').addEventListener('change', () => { prefs.sprint = $('sprintMode').value === 'toggle' ? 'toggle' : 'hold'; savePrefs(); });
  $('pointerMode').addEventListener('change', () => { prefs.pointer = $('pointerMode').value === 'locked' ? 'locked' : 'system'; savePrefs(); if (prefs.pointer !== 'locked') input.unlock(); });
  $('fullscreenPref').addEventListener('change', () => { prefs.fullscreen = $('fullscreenPref').checked; savePrefs(); if (!prefs.fullscreen) leaveFullscreen(true); });
  $('aimZoom').addEventListener('change', () => { prefs.aimZoom = AIM_ZOOM[$('aimZoom').value] ? $('aimZoom').value : 'slight'; savePrefs(); shareRules(); });
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
  $('chatForm').addEventListener('submit', e => { e.preventDefault(); if (state.signEdit) writeSignNow($('chatInput').value); else sendChat($('chatInput').value); closeChat(); });
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
    // A world's inventory screen: I or Esc closes it.
    if (invScreen?.open) {
      if (!e.repeat && invScreen.key(e.code)) e.preventDefault();
      return;
    }
    // Talking: the number keys pick what to say, Esc says goodbye.
    if (talkScreen?.open) {
      if (!e.repeat && talkScreen.key(e.code)) e.preventDefault();
      return;
    }
    // The journal: J or Esc closes it.
    if (journal?.open) {
      if (!e.repeat && journal.key(e.code, isKey('journal', keyOf(e.code)))) e.preventDefault();
      return;
    }
    // The dev menu: P or Esc closes it.
    if (devPanel?.open) {
      if (!e.repeat && devPanel.key(e.code, isKey('devMenu', keyOf(e.code)))) e.preventDefault();
      return;
    }
    // Another player's menu, a trade: Esc closes them (a trade's called off).
    if (playerMenu?.open) { if (!e.repeat && playerMenu.key(e.code)) e.preventDefault(); return; }
    if (tradeScreen?.open) { if (!e.repeat && tradeScreen.key(e.code)) e.preventDefault(); return; }
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
  // (When the page really goes: not on the browser's "leave this page?" question, which can be
  // answered "stay", and the game with everyone in it should then still be there.)
  window.addEventListener('pagehide', e => { if (!e.persisted) leaveOnline(); });
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
  usePrefs(settings);
  // The developer menu's numbers, as changed in this browser.
  loadTuning();
  // (Keyboards other than QWERTY: name keys as they're printed, where the browser can say.)
  navigator.keyboard?.getLayoutMap?.().then(m => { useLayout(m); keybinds.render(); showKeys(); }).catch(() => {});
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
  // Firefox's own menu on Shift + right click, which no page can stop: how to stop it (once).
  input.onFirefoxMenu = () => {
    if (state.firefoxTold) return;
    state.firefoxTold = true;
    toast("Firefox opens its own menu on Shift + right click, and no web page can stop it. To play without it, lock the mouse to the game (Settings, Mouse & crosshair), or open about:config in Firefox and set dom.event.contextmenu.shift_suppresses_event to false.", 15000);
  };
  // (Firefox-only notes in Settings.)
  document.documentElement.classList.toggle('firefox', FIREFOX);
  setLegAnimations(legs);
  audio.preload();
  audio.listen(window); // (sound starts at the first click, tap or key; nothing listens once it's running)
  maps.index = index;
  await Promise.all(index.map(async m => maps.data.set(m.file, await fetch('data/maps/' + m.file).then(r => r.json()))));
  state.tab = ['offline', 'worlds'].includes(settings.tab) ? settings.tab : 'online';

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
    startWorld, saveWorldNow, renderWorlds, openInventory, closeInventory, craftItem, get inventory() { return invScreen; }, get talk() { return talkScreen; }, get journal() { return journal; }, openJournal, get devPanel() { return devPanel; }, openDevPanel,
    devExport: all => JSON.parse(devMenu.exportText(all)), // (what the developer menu copies out)
    // The camera and aiming zoom in use (the host's, in someone else's game).
    feelNow: () => ({ camera: cameraInUse(), aimZoom: hostFeel ? hostFeel.aimZoom : prefs.aimZoom, host: !!hostFeel }),
  };
}

boot().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;top:10px;left:10px;color:#b3261e">Couldn't load the game: ${esc(err.message)}</p>`);
});
