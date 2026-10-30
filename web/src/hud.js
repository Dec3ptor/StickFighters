// Heads-up display, drawn in screen pixels on top of the world.

import { WEAPONS, SLOTS } from './weapons.js';
import { RULES } from './config.js';
import { GUN_GAME_LADDER } from './modes.js';
import { drawObjectiveHud, drawMinimap, bigMap, drawDeploy, drawMoney } from './objdraw.js';
import { moneyOf } from './defuse.js';
import { CLASSES, weaponFor } from './classes.js';
import { GADGETS, rechargeTicks } from './gadgets.js';
import { REWARDS, JUGGER_TICKS, nextReward } from './streaks.js';
import { keyLabel, keyShort, keyText, slotAction } from './keys.js';

const FONT = 'Arial, Helvetica, sans-serif';
const TEAM = { 1: '#2f6fdb', 2: '#d33b2f' };

// Callouts ('Double kill', 'Rampage'...): the colour of each kind. (First blood's red is
// '#c22', which Remastered swaps for a brighter red that reads on its dark glass.)
const CALLOUT = { multi: '#e0a020', spree: '#e5641a', first: '#c22', shutdown: '#8a4fe0', reward: '#2f9a4a', jugger: '#e07a1a', use: '#555' };
// Several at the same moment: which one is the big one.
const CALLOUT_RANK = { first: 6, shutdown: 5, spree: 4, multi: 3, jugger: 2, reward: 1, use: 0 };
// How long they show, in updates: your own (big, in the middle), and news about others (small, at the top).
const CALLOUT_LIFE = 150, NEWS_LIFE = 240;

// Each game's standings, kept between frames: { list (best first), idx (where each one is
// in game.soldiers), compare, ok (false: can't be kept) }.
const standingsKept = new WeakMap();
// Where each soldier is in its game's list (set again when the standings change).
const placeOf = new WeakMap();

/**
 * game.standings(), sorted again only when the order has changed. The kept order is
 * checked first (one pass, no garbage): the same soldiers, each pair in order, ties
 * in the order they're in the game. That's just what sorting again would give.
 */
export function standingsOf(game) {
  const soldiers = game.soldiers, compare = game.rules.compare;
  let k = standingsKept.get(game);
  if (k && k.ok && k.compare === compare && k.list.length === soldiers.length && stillInOrder(k, soldiers, compare)) return k.list;
  const list = game.standings();
  if (!k) standingsKept.set(game, k = { list, idx: new Int32Array(0), compare, ok: false });
  k.list = list;
  k.compare = compare;
  k.ok = list.length === soldiers.length;
  if (!k.ok) return list;
  if (k.idx.length !== list.length) k.idx = new Int32Array(list.length);
  for (let i = 0; i < soldiers.length; i++) placeOf.set(soldiers[i], i);
  for (let i = 0; i < list.length; i++) {
    const at = placeOf.get(list[i]);
    if (at === undefined || soldiers[at] !== list[i]) { k.ok = false; break; }
    k.idx[i] = at;
  }
  return list;
}

function stillInOrder(k, soldiers, compare) {
  const list = k.list, idx = k.idx;
  for (let i = 0; i < list.length; i++) {
    if (soldiers[idx[i]] !== list[i]) return false;
    if (i > 0) {
      const d = compare(list[i - 1], list[i]);
      if (d > 0 || (d === 0 && idx[i - 1] > idx[i])) return false;
    }
  }
  return true;
}

/** A text made from up to three values (by `make`), made again only when they change. */
function textOf(make) {
  let a, b, c, text = null;
  return (x, y, z) => {
    if (text === null || x !== a || y !== b || z !== c) { a = x; b = y; c = z; text = make(x, y, z); }
    return text;
  };
}

// The newest few of a list that pass a test, oldest first: into `out` (used again each frame).
function newest(list, n, keep, out, arg) {
  out.length = 0;
  for (let i = list.length - 1; i >= 0 && out.length < n; i--) if (keep(list[i], arg)) out.push(list[i]);
  out.reverse();
  return out;
}
const NOTES = [], FEED = [], CHAT = [];

/**
 * opts: { showScores, watching (soldier the camera follows when you're out), chat: [{ name, text, system, team, time }],
 *   online (show everyone's ping on the scoreboard), hostId (the host's soldier),
 *   ping (your ping in ms, or a label like 'Host'), perf (frame rate text),
 *   picking (the class picker is open), spectating ({ free (the free camera), target (who it follows) }),
 *   rewardPick (the banked kill streak reward X uses: a REWARDS id; else the newest),
 *   killMark ({ x, y, k }: you just got a kill; the crosshair in screen px, k from 0 to 1 as it fades),
 *   replay (the winning kill's replay is on: nothing is drawn, drawReplay draws its overlay) }
 * With classes on, while you wait to respawn this sets r.classButton (screen px) to the
 * "change class" box, so a click on it can open the class picker.
 */
export function drawHud(r, game, me, opts = {}) {
  if (opts.replay) return;
  const ctx = r.ctx, d = r.dpr, W = r.w, H = r.h;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.textBaseline = 'middle';

  // Blinded by a flashbang: the screen goes white, and clears as it wears off.
  if (me.alive && me.flashTicks > 0) {
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = Math.min(1, me.flashTicks / 75);
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  if (me.alive) {
    drawStatus(ctx, game, me, W, H, opts);
    drawWeaponBar(ctx, me, W, H);
  }

  const standings = standingsOf(game);
  // (Defuse: your money where the scores go; Tab shows everyone.)
  if (game.mode === 'defuse' && game.modeState) drawMoney(ctx, game, me, W, H);
  else drawScores(ctx, game, me, H, standings);
  drawFeed(ctx, game, W, opts.chat);
  drawTop(ctx, game, me, W, standings, r, H);
  if (bigMap(game.map) && !game.over) drawMinimap(r, ctx, game, me, W);
  // Fog of war: sounds from out of sight, off screen.
  r.fogNow?.drawEdgeAlerts(ctx, r, W, H);

  // Callouts: news about others under the scores, your own big above the messages
  // (which move down out of their way).
  const notesY = !game.over && game.callouts?.length ? drawCallouts(ctx, game, me, W, H) : H * 0.3;

  // Messages for the player ("You got the Sniper Rifle").
  NOTE_FOR.me = me; NOTE_FOR.tick = game.tick;
  const notes = game.over ? newest(game.notes, 0, noteShown, NOTES, NOTE_FOR) : newest(game.notes, 3, noteShown, NOTES, NOTE_FOR);
  ctx.textAlign = 'center';
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i], age = game.tick - n.tick;
    ctx.globalAlpha = Math.min(1, (150 - age) / 30);
    ctx.font = FONT_14;
    ctx.fillStyle = '#222';
    ctx.fillText(keyText(n.text), W / 2, notesY + i * 20);
  }
  NOTE_FOR.me = null;
  ctx.globalAlpha = 1;

  if (me.alive && opts.selfDestruct > 0) {
    // Holding K: how long until it goes off.
    const w = 160, x = W / 2 - w / 2, y = H / 2 - 70;
    ctx.textAlign = 'center';
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillStyle = '#c22';
    ctx.fillText('Self-destructing...', W / 2, y - 8);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(x, y, w, 6);
    ctx.fillStyle = '#c22';
    ctx.fillRect(x, y, w * Math.min(1, opts.selfDestruct), 6);
  }

  r.classButton = null;
  if (opts.spectating && !game.over) drawSpectating(ctx, game, opts.spectating, W, H);
  else if (!me.alive && !game.over) {
    ctx.textAlign = 'center';
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillStyle = '#222';
    if (game.rules.canRespawn(game, me)) {
      const waiting = me.holdSpawn > 0 || opts.picking;
      ctx.fillText(waiting ? 'Choosing a class…' : `Respawning in ${Math.max(1, Math.ceil(me.respawnTimer / game.tickRate))}...`, W / 2, H / 2 - 60);
      // Kill streak rewards waiting for you (they keep while you're dead).
      let below = 0;
      if (game.streaksOn && me.bank?.length) {
        ctx.font = `12px ${FONT}`;
        ctx.fillStyle = '#555';
        ctx.fillText(`Banked: ${me.bank.map(id => REWARDS[id]?.name || id).join(', ')}`, W / 2, H / 2 - 38);
        below = 14;
      }
      const deploy = game.deployOptions(me);
      if (deploy) drawDeploy(ctx, game, me, W, H / 2 - 30 + below);
      if (game.classesOn) r.classButton = drawClassChoice(ctx, me, W, (deploy ? H / 2 + 34 : H / 2 - 30) + below);
    } else {
      ctx.fillText(game.rules.outText?.(game, me) ?? "You're out", W / 2, H / 2 - 70);
      if (opts.watching) {
        ctx.font = `14px ${FONT}`;
        ctx.fillText(`Watching ${opts.watching.name}`, W / 2, H / 2 - 46);
        ctx.font = `12px ${FONT}`;
        ctx.fillStyle = '#777';
        ctx.fillText(`${keyLabel('left')} / ${keyLabel('right')} or click: watch someone else`, W / 2, H / 2 - 26);
      }
    }
  }

  if (opts.ping != null) {
    const ms = typeof opts.ping === 'number';
    ctx.textAlign = 'right';
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = ms && opts.ping > 200 ? '#c22' : '#999';
    ctx.fillText(ms ? `Ping ${Math.round(opts.ping)} ms` : String(opts.ping), W - 12, H - 12);
  }
  if (opts.perf) {
    ctx.textAlign = 'right';
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = '#999';
    ctx.fillText(opts.perf, W - 12, H - (opts.ping != null ? 26 : 12));
  }

  if (opts.showScores || game.over) drawScoreboard(ctx, game, me, W, H, opts, standings);
  // You just got a kill: an X round the crosshair (on top of everything).
  if (opts.killMark) drawKillMark(ctx, opts.killMark, W, H);
}

// A message shown to the player: theirs (or everyone's), from the last 150 updates.
const NOTE_FOR = { me: null, tick: 0 };
const noteShown = (n, f) => (n.to == null || n.to === f.me.id) && f.tick - n.tick < 150;
// Fonts used every frame (made once).
const FONT_14 = `14px ${FONT}`, FONT_12 = `12px ${FONT}`, FONT_BOLD_12 = `bold 12px ${FONT}`, FONT_11 = `11px ${FONT}`;
const FONT_BOLD_10 = `bold 10px ${FONT}`, FONT_10 = `10px ${FONT}`, FONT_9 = `9px ${FONT}`, FONT_8 = `8px ${FONT}`;

const BAR_COLORS = {
  health: ['#e02020', '#5c0f0f'],
  armour: ['#3f9a3a', '#1c4a1a'],
  ammo: ['#a39a1f', '#4a4510'],
  fuel: ['#2f74d0', '#163a6b'],
  stamina: ['#2fb3a0', 'rgba(0,0,0,0.18)'],
  winded: ['#d8862a', 'rgba(0,0,0,0.18)'],
  gadget: ['#6d4fc2', '#2e2352'],
  gadgetReady: ['#8c62e8', '#2e2352'],
  // Kill streaks: kills in a row toward the next reward, a reward ready to use, the Juggernaut's time left.
  reward: ['#b8862a', '#4a3512'],
  rewardReady: ['#d49a12', '#4a3512'],
  juggernaut: ['#e0661a', '#4f2008'],
};

// The weapon bar's boxes (drawWeaponBar), and where it sits: centred at the bottom,
// shrunk to fit narrow screens.
const SLOT_SIZE = 46, SLOT_GAP = 4;
function weaponBarScale(W) {
  const total = SLOTS.length * SLOT_SIZE + (SLOTS.length - 1) * SLOT_GAP;
  return Math.min(1, (W - 24) / total);
}

// The status bars' texts (made again only when what's in them changes).
const healthLabel = textOf((h, max) => `Health ${h} / ${max}`);
// (mag -1: reloading.)
const magLabel = textOf((def, mag, ammo) => {
  const spare = ammo === Infinity ? '' : `  ·  ${ammo}`;
  return mag < 0 ? `${def.name}: reloading${spare}` : `${def.name}  ${mag}/${def.mag}${spare}`;
});
const ammoLabel = textOf((def, ammo) => `${def.name}  ${ammo}`);

/**
 * Health, armour, ammo, jet fuel and stamina: just above the weapon bar, in the
 * middle at the bottom of the screen, where your eyes are anyway.
 */
function drawStatus(ctx, game, me, W, H, opts) {
  const k = weaponBarScale(W);
  const half = 172, gap = 8, h = 20;
  ctx.save();
  ctx.translate(W / 2, H - (SLOT_SIZE + 10) * k - 6 * k);
  ctx.scale(k, k);
  // Stamina: a thin strip right above the weapon bar, shown while it isn't full.
  const b = me.body;
  if (b.stamina < 100 || b.sprinting) {
    bar(ctx, -half - gap / 2, -5, half * 2 + gap, 5, b.stamina / 100, b.winded ? 'winded' : 'stamina', '');
  }
  // The main row: health on the left, the weapon in hand on the right.
  let y = -11 - h;
  bar(ctx, -half - gap / 2, y, half, h, me.health / me.maxHealth, 'health', healthLabel(Math.max(0, Math.ceil(me.health)), me.maxHealth), true);
  // (With the soldier's upgrade: Extended mag holds more.)
  const def = weaponFor(me, me.current), inv = me.weapons[me.current];
  if (def && inv) {
    let frac = 1, label = def.name;
    if (def.mag) {
      // (With spare ammo: what's in the magazine, then what's left to reload with.)
      frac = me.reloadTimer > 0 ? 1 - me.reloadTimer / def.reload : inv.mag / def.mag;
      label = magLabel(def, me.reloadTimer > 0 ? -1 : inv.mag, inv.ammo);
    } else if (def.tool) {
      // Building (the Hammer, the Builder): blocks left, and what a click puts up (right click turns it).
      frac = inv.ammo / (me.kitAmmo?.[me.current] || def.maxAmmo || 1);
      label = `${def.name}  ${inv.ammo} block${inv.ammo === 1 ? '' : 's'}  ·  ${me.buildPlank ? 'plank' : 'wall'}`;
    } else if (inv.ammo !== Infinity && !game.rules.infiniteAmmo) {
      frac = inv.ammo / (def.maxAmmo || def.ammo || 1);
      label = ammoLabel(def, inv.ammo);
    }
    bar(ctx, gap / 2, y, half, h, frac, 'ammo', label, true);
  }
  // Anything else, in pairs above it: your class and gadget (classes on), kill streak
  // rewards (streaks on), armour, jet fuel, the minigun spinning up.
  const extra = [];
  const gadget = game.classesOn && gadgetBar(game, me);
  if (gadget) extra.push(gadget);
  if (game.streaksOn) extra.push(...streakBars(me, opts.rewardPick));
  if (me.armour > 0) extra.push([me.armour / RULES.maxArmour, 'armour', `Armour ${Math.ceil(me.armour)}%`]);
  if (b.hasJetpack) extra.push([b.fuel / 100, 'fuel', `Jet fuel ${Math.round(b.fuel)}%`]);
  if (def?.spinup && me.spin > 0 && me.spin < def.spinup) extra.push([me.spin / def.spinup, 'fuel', 'Spinning up…']);
  for (let i = 0; i < extra.length; i++) {
    if (i % 2 === 0) y -= 18;
    const [frac, kind, label] = extra[i];
    const x = i % 2 === 0 ? -half - gap / 2 : gap / 2;
    bar(ctx, x, y, half, 15, frac, kind, label);
    if (kind === 'rewardReady') {
      // A reward to use: a glowing edge that pulses, so it catches your eye.
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(game.tick * 0.15);
      ctx.strokeStyle = '#ffd25a';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 0.75, y - 0.75, half + 1.5, 16.5);
      ctx.globalAlpha = 1;
    }
  }
  if (me.burnTicks > 0) {
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = '#e5641a';
    ctx.textAlign = 'center';
    ctx.fillText('On fire! Find health', 0, y - 12);
  }
  ctx.restore();
}

/** Classes on: your class, and your gadget's charge ("Assault · Medkit (G)" when it's ready). */
function gadgetBar(game, me) {
  const c = CLASSES[me.cls];
  const g = c && GADGETS[c.gadget];
  if (!g) return null;
  if (g.tool) {
    // The Builder: blocks left, and (in hand) what a click puts up.
    const n = me.weapons[g.tool]?.ammo || 0, full = me.kitAmmo?.[g.tool] || WEAPONS[g.tool].maxAmmo || 1;
    const text = me.current === g.tool ? `${me.buildPlank ? 'Plank' : 'Wall'} · ${keyLabel('aim')}: ${me.buildPlank ? 'wall' : 'plank'}` : `${c.name} · ${g.name} (${keyLabel('gadget')})`;
    return [n / full, n > 0 ? 'gadgetReady' : 'gadget', text];
  }
  const total = rechargeTicks(game, g), left = Math.max(0, me.gadgetCharge || 0);
  if (left > 0) return [1 - left / total, 'gadget', `${c.name} · ${g.name} ${Math.floor(100 * (1 - left / total))}%`];
  const up = c.gadget === 'beacon' && game.beacons?.some(b => b.owner === me.id);
  return [1, 'gadgetReady', `${c.name} · ${up ? 'Move beacon' : g.name} (${keyLabel('gadget')})`];
}

/**
 * Kill streak bars: a banked reward ready to use ("Sentry Sheep (X) · Z: next"), else
 * your streak toward the next one; and the Juggernaut's time left while you are one.
 */
function streakBars(me, pick) {
  const out = [];
  const bank = me.bank || [];
  if (bank.length) {
    const id = bank.includes(pick) ? pick : bank[bank.length - 1];
    out.push([1, 'rewardReady', `${REWARDS[id]?.name || id} (${keyLabel('streak')})${bank.length > 1 ? ` · ${keyLabel('streakPick')}: next` : ''}`]);
  } else {
    const next = nextReward(me);
    const streak = me.streak || 0;
    // (Once a streak's going: kills in a row so far, and what the next reward is.)
    if (next && streak > 0) out.push([streak / REWARDS[next].kills, 'reward', `Streak ${streak} · ${REWARDS[next].name} at ${REWARDS[next].kills}`]);
  }
  if (me.jugger > 0) out.push([me.jugger / JUGGER_TICKS, 'juggernaut', `Juggernaut ${Math.ceil(me.jugger / 60)} s`]);
  return out;
}

/** Waiting to respawn with classes on: your class, and how to change it (a box you can click). */
function drawClassChoice(ctx, me, W, y) {
  const now = CLASSES[me.cls]?.name, next = CLASSES[me.pickCls]?.name;
  const text = next && next !== now ? `Next life: ${next}` : `Class: ${now || next || '?'}`;
  ctx.font = `bold 13px ${FONT}`;
  const label = `${text}   ·   ${keyLabel('changeClass')} to change`;
  const w = ctx.measureText(label).width + 28, h = 26, x = W / 2 - w / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#222';
  ctx.textAlign = 'center';
  ctx.fillText(label, W / 2, y + h / 2 + 1);
  return { x, y, w, h };
}

/**
 * Spectating: who the camera follows (their health and weapon), or the free
 * camera, and how to switch, at the bottom of the screen.
 */
function drawSpectating(ctx, game, sp, W, H) {
  const t = sp.free ? null : sp.target;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(W / 2 - 250, H - 86, 500, 74);
  ctx.font = `bold 16px ${FONT}`;
  ctx.fillStyle = t && game.rules.teams ? TEAM[t.team] : '#222';
  ctx.fillText(sp.free ? 'Spectating · free camera' : t ? `Spectating ${t.name}` : 'Spectating · nobody to watch right now', W / 2, H - 70);
  if (t) {
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = '#444';
    const gun = WEAPONS[t.current];
    ctx.fillText(`${Math.max(0, Math.ceil(t.health))} health${t.armour > 0 ? ` · ${Math.ceil(t.armour)} armour` : ''}${gun ? ` · ${gun.name}` : ''}`, W / 2, H - 50);
  }
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = '#777';
  ctx.fillText(sp.free
    ? `${keyLabel('left')} ${keyLabel('right')} ${keyLabel('jump')} ${keyLabel('crouch')}: move (${keyLabel('sprint')}: faster)  ·  ${keyLabel('freeCam')} or click: follow a player  ·  Esc: join game`
    : `${keyLabel('left')} / ${keyLabel('right')} or click: switch player  ·  ${keyLabel('freeCam')}: free camera  ·  Esc: join game`, W / 2, H - 28);
}

/**
 * Callouts (game.callouts). News for everyone (not about you): one or two small lines
 * under the scores. Your own: a big banner in the upper middle that pops in, holds and
 * fades, with up to two older ones smaller under it. Returns where the messages
 * (game.notes) go: under all this.
 */
function drawCallouts(ctx, game, me, W, H) {
  const t = game.tick, list = game.callouts;
  const ageOf = c => Math.max(0, t - c.tick);
  // News: under the top line (and under the objective modes' second line).
  const newsY = game.rules.objective ? 78 : game.mode === 'gungame' ? 54 : 44;
  const news = list.filter(c => c.to == null && c.about !== me.id && ageOf(c) < NEWS_LIFE).slice(-2).reverse();
  ctx.font = `13px ${FONT}`;
  ctx.textAlign = 'left';
  news.forEach((c, i) => {
    const age = ageOf(c), y = newsY + i * 21;
    ctx.globalAlpha = Math.min(1, (age + 1) / 8, (NEWS_LIFE - age) / 40);
    const w = ctx.measureText(keyText(c.text)).width + 34, x = Math.round(W / 2 - w / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(x, y - 9, w, 18);
    ctx.fillStyle = CALLOUT[c.kind] || '#555';
    ctx.fillRect(x, y - 9, 3, 18);
    ctx.beginPath();
    ctx.arc(x + 14, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.fillText(keyText(c.text), x + 24, y + 1);
  });
  ctx.globalAlpha = 1;

  // Yours: the newest (of several at once, the loudest) big, the others small under it.
  const mine = list.filter(c => c.to === me.id && ageOf(c) < CALLOUT_LIFE)
    .sort((a, b) => b.tick - a.tick || (CALLOUT_RANK[b.kind] ?? 0) - (CALLOUT_RANK[a.kind] ?? 0)).slice(0, 3);
  if (!mine.length) return H * 0.3;
  // (Under the news; in Defuse, under the round's result while it shows.)
  const st = game.modeState;
  const cy = game.mode === 'defuse' && st?.phase === 'over' && st.result ? H * 0.24 + 72 : Math.max(H * 0.2, newsY + 72);
  const c = mine[0], age = ageOf(c), color = CALLOUT[c.kind] || '#555';
  const fade = Math.min(1, (CALLOUT_LIFE - age) / 40);
  // Pop in: big for a moment, then settling. (In steps: the WebGL renderer keeps each text size as a picture.)
  const size = age < 3 ? 40 : age < 6 ? 34 : 30;
  const head = keyText(c.text).toUpperCase();
  ctx.font = `bold ${size}px ${FONT}`;
  const hw = ctx.measureText(head).width;
  ctx.font = `13px ${FONT}`;
  const sw = keyText(c.sub) ? ctx.measureText(keyText(c.sub)).width : 0;
  const half = (keyText(c.sub) ? 32 : 24) * (age < 3 ? 1.15 : age < 6 ? 1.06 : 1);
  const bw = Math.min(W, Math.max(hw, sw) + 120);
  band(ctx, W / 2 - bw / 2, cy - half, bw, half * 2, color, fade * Math.min(1, (age + 1) / 3));
  const hy = keyText(c.sub) ? cy - 7 : cy + 1;
  ctx.textAlign = 'center';
  ctx.font = `bold ${size}px ${FONT}`;
  // (A soft dark copy just below: the headline stands off the strip.)
  ctx.fillStyle = '#000';
  ctx.globalAlpha = fade * 0.16;
  ctx.fillText(head, W / 2 + 1, hy + 2);
  ctx.globalAlpha = fade;
  ctx.fillStyle = color;
  ctx.fillText(head, W / 2, hy);
  if (keyText(c.sub)) {
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = '#444';
    ctx.fillText(keyText(c.sub), W / 2, cy + 18);
  }
  let bottom = cy + half;
  for (const o of mine.slice(1)) {
    const y = bottom + 17, head = o.text.toUpperCase();
    // (Only short subs: "3 kills in a row", not a reward's instructions.)
    const sub = o.sub && o.sub.length <= 28 ? o.sub : '';
    ctx.globalAlpha = Math.min(1, (CALLOUT_LIFE - ageOf(o)) / 40);
    ctx.font = `bold 14px ${FONT}`;
    const w1 = ctx.measureText(head).width;
    ctx.font = `12px ${FONT}`;
    const w2 = sub ? ctx.measureText(sub).width + 12 : 0;
    const w = w1 + w2 + 28, x = Math.round(W / 2 - w / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(x, y - 11, w, 22);
    ctx.fillStyle = CALLOUT[o.kind] || '#555';
    ctx.fillRect(x, y - 11, 3, 22);
    ctx.textAlign = 'left';
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillText(head, x + 14, y + 1);
    if (sub) {
      ctx.font = `12px ${FONT}`;
      ctx.fillStyle = '#555';
      ctx.fillText(sub, x + 14 + w1 + 12, y + 1);
    }
    bottom = y + 11;
  }
  ctx.globalAlpha = 1;
  return Math.max(H * 0.3, bottom + 20);
}

/** A strip across the middle like Defuse's round result: soft ends, a coloured line above and below. */
function band(ctx, x, y, w, h, color, alpha) {
  const parts = [[x, w, 1]];
  [0.72, 0.52, 0.36, 0.23, 0.13, 0.05].forEach((a, i) => parts.push([x - 7 * (i + 1), 7, a], [x + w + 7 * i, 7, a]));
  for (const [px, pw, a] of parts) {
    ctx.globalAlpha = alpha * a;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(px, y, pw, h);
    ctx.fillStyle = color;
    ctx.fillRect(px, y, pw, 3);
    ctx.fillRect(px, y + h - 3, pw, 3);
  }
  ctx.globalAlpha = alpha;
}

/**
 * A kill: a sharp red X round the crosshair (m: its screen px, k from 0 to 1 as it goes),
 * big for a moment then snapping smaller, fading out; and a quick white flash.
 */
function drawKillMark(ctx, m, W, H) {
  const k = Math.max(0, Math.min(1, m.k || 0));
  if (k < 0.15) {
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.1 * (1 - k / 0.15);
    ctx.fillRect(0, 0, W, H);
  }
  const grow = 1 + 0.55 * Math.max(0, 1 - k / 0.1) ** 2;
  const r0 = 6 * grow, r1 = 15 * grow;
  const arms = (a, b) => {
    ctx.beginPath();
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      ctx.moveTo(m.x + dx * a * Math.SQRT1_2, m.y + dy * a * Math.SQRT1_2);
      ctx.lineTo(m.x + dx * b * Math.SQRT1_2, m.y + dy * b * Math.SQRT1_2);
    }
  };
  ctx.globalAlpha = k < 0.45 ? 1 : Math.max(0, 1 - (k - 0.45) / 0.55);
  ctx.lineCap = 'butt';
  // A thin white edge (a wider stroke underneath), then the red.
  arms(r0 - 1.5, r1 + 1.5);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5 * Math.sqrt(grow) + 2.5;
  ctx.stroke();
  arms(r0, r1);
  ctx.strokeStyle = '#e8202a';
  ctx.lineWidth = 2.5 * Math.sqrt(grow);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** A bar like the original's: bright fill on a dark track, white label on top (bold: bigger). */
function bar(ctx, x, y, w, h, frac, kind, label, bold = false) {
  const [fg, bg] = BAR_COLORS[kind];
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  if (!label) return;
  ctx.font = bold ? FONT_BOLD_12 : FONT_11;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.fillText(label, x + 6, y + h / 2 + 1);
}

/** One box per slot (1-9, 0, F): what you hold from it, and how many weapons you have there. */
function drawWeaponBar(ctx, me, W, H) {
  const size = SLOT_SIZE, gap = SLOT_GAP, n = SLOTS.length;
  const total = n * size + (n - 1) * gap;
  const scale = weaponBarScale(W);
  ctx.save();
  ctx.translate(W / 2 - (total * scale) / 2, H - (size + 10) * scale);
  ctx.scale(scale, scale);
  // (The weapons you have: worked out once, not again for every slot.)
  const owned = OWNED;
  owned.length = 0;
  for (const id in me.weapons) if (WEAPONS[id] && me.has(id)) owned.push(id);
  for (let i = 0; i < SLOTS.length; i++) {
    const slot = SLOTS[i], x = i * (size + gap);
    // How many you have in this slot, the first of them, and whether the one you last had out is one.
    let count = 0, first, last = false;
    for (let j = 0; j < owned.length; j++) {
      const id = owned[j];
      if (WEAPONS[id].slot !== i) continue;
      if (!count) first = id;
      count++;
      if (id === me.lastInSlot[i]) last = true;
    }
    const current = WEAPONS[me.current]?.slot === i;
    const show = current ? me.current : last ? me.lastInSlot[i] : first;
    ctx.fillStyle = current ? 'rgba(30,30,30,0.88)' : count ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
    ctx.fillRect(x, 0, size, size);
    ctx.strokeStyle = count ? '#333' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, 0.5, size - 1, size - 1);
    ctx.textAlign = 'left';
    ctx.font = FONT_BOLD_10;
    ctx.fillStyle = current ? '#fff' : count ? '#333' : 'rgba(0,0,0,0.25)';
    ctx.fillText(keyShort(slotAction(i)), x + 4, 9);
    if (count > 1) {
      ctx.textAlign = 'right';
      ctx.font = FONT_9;
      ctx.fillText(String(count), x + size - 4, 9);
    }
    ctx.textAlign = 'center';
    if (show) {
      const def = weaponFor(me, show), inv = me.weapons[show];
      ctx.font = def.short.length > 8 ? FONT_8 : FONT_10;
      ctx.fillText(def.short, x + size / 2, 24);
      ctx.font = FONT_9;
      ctx.fillText(def.mag ? (inv.ammo === Infinity ? '∞' : slotAmmo[i](inv.mag, inv.ammo)) : inv.ammo === Infinity ? '' : String(inv.ammo), x + size / 2, 37);
    } else {
      ctx.font = FONT_9;
      ctx.fillText(SLOT_WORDS[i], x + size / 2, 26);
    }
  }
  ctx.restore();
}

const OWNED = [];
// Each slot's first word ("Automatics") and its magazine text ("8/24"), made when it changes.
const SLOT_WORDS = SLOTS.map(slot => slot.name.split(' ')[0]);
const slotAmmo = SLOTS.map(() => textOf((mag, ammo) => `${mag}/${ammo}`));

function drawScores(ctx, game, me, H, standings) {
  const n = Math.min(8, standings.length);
  const rules = game.rules;
  ctx.textAlign = 'left';
  for (let i = 0; i < n; i++) {
    const s = standings[i];
    ctx.font = s === me ? FONT_BOLD_12 : FONT_12;
    ctx.fillStyle = rules.teams ? TEAM[s.team] : '#333';
    const score = rules.scoreLabel === 'Frags' ? s.frags : rules.score(s);
    ctx.fillText(scoreLine(s, rules, score), 12, H - 70 - (n - 1 - i) * 15);
  }
}

// Each soldier's line in the scores ("Sarge: 3"), made again only when it changes.
const scoreLines = new WeakMap();
function scoreLine(s, rules, score) {
  let l = scoreLines.get(s);
  if (!l) scoreLines.set(s, l = { name: null, label: null, score: null, text: '' });
  if (l.name !== s.name || l.label !== rules.scoreLabel || l.score !== score) {
    l.name = s.name; l.label = rules.scoreLabel; l.score = score;
    l.text = rules.scoreLabel === 'Frags' ? `${s.name}: ${score}` : `${s.name}: ${rules.scoreLabel.toLowerCase()} ${score}`;
  }
  return l.text;
}

const feedShown = (f, tick) => tick - f.tick < 360;
const chatShown = (c, now) => now - c.time < 12000;
// Kill feed and chat lines as shown ("A fragged B (Bazooka)", "Bob: gg"), made once each.
const lineTexts = new WeakMap();
function lineText(item, make) {
  let t = lineTexts.get(item);
  if (t === undefined) lineTexts.set(item, t = make(item));
  return t;
}
const feedText = f => f.text + (f.weapon ? ` (${f.weapon})` : '');
const chatText = c => (c.system ? c.text : `${c.name}: ${c.text}`);
// In team modes a chat line's name is in its team's colour: the name part ("Bob: "), and how wide it is in the font now set.
const chatNames = new WeakMap();
function chatName(ctx, c) {
  let n = chatNames.get(c);
  if (!n) chatNames.set(c, n = { text: `${c.name}: `, font: null, w: 0 });
  if (n.font !== ctx.font) { n.font = ctx.font; n.w = ctx.measureText(n.text).width; }
  return n;
}

function drawFeed(ctx, game, W, chat = []) {
  const items = newest(game.feed, 5, feedShown, FEED, game.tick);
  ctx.textAlign = 'right';
  ctx.font = FONT_12;
  for (let i = 0; i < items.length; i++) {
    const f = items[i], age = game.tick - f.tick;
    ctx.globalAlpha = Math.min(1, (360 - age) / 60);
    ctx.fillStyle = '#c21b1b';
    ctx.fillText(lineText(f, feedText), W - 12, 16 + i * 16);
  }
  ctx.globalAlpha = 1;
  const now = performance.now();
  const lines = newest(chat, 6, chatShown, CHAT, now);
  ctx.textAlign = 'left';
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i];
    ctx.globalAlpha = Math.min(1, (12000 - (now - c.time)) / 1500);
    ctx.font = FONT_12;
    if (!c.system && TEAM[c.team]) {
      const name = chatName(ctx, c);
      ctx.fillStyle = TEAM[c.team];
      ctx.fillText(name.text, 180, 20 + i * 16);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText(c.text, 180 + name.w, 20 + i * 16);
      continue;
    }
    ctx.fillStyle = c.system ? '#777' : '#1a1a1a';
    ctx.fillText(lineText(c, chatText), 180, 20 + i * 16);
  }
  ctx.globalAlpha = 1;
}

function drawTop(ctx, game, me, W, standings, r, H) {
  const rules = game.rules;
  if (rules.objective) { drawObjectiveHud(r, ctx, game, me, W, H); return; }
  ctx.textAlign = 'center';
  ctx.font = `bold 14px ${FONT}`;
  if (rules.teams) {
    ctx.fillStyle = TEAM[1];
    ctx.fillText(`Blue ${game.teamScore[1]}`, W / 2 - 50, 16);
    ctx.fillStyle = '#999';
    ctx.fillText(`/ ${game.fragLimit}`, W / 2, 16);
    ctx.fillStyle = TEAM[2];
    ctx.fillText(`Red ${game.teamScore[2]}`, W / 2 + 50, 16);
    return;
  }
  const rank = standings.indexOf(me) + 1;
  ctx.fillStyle = '#333';
  if (game.mode === 'gungame') {
    const lvl = Math.min(me.level || 0, GUN_GAME_LADDER.length - 1);
    const next = GUN_GAME_LADDER[lvl + 1];
    ctx.fillText(`Weapon ${lvl + 1} of ${GUN_GAME_LADDER.length}: ${WEAPONS[GUN_GAME_LADDER[lvl]].name}  ·  ${ordinal(rank)} place`, W / 2, 16);
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = '#777';
    ctx.fillText(next ? `Next: ${WEAPONS[next].name}` : 'Get a kill to win!', W / 2, 34);
  } else if (game.mode === 'oitc') {
    const left = game.soldiers.filter(s => !s.spectating && (s.lives ?? 1) > 0).length;
    const bullets = me.weapons.Chamber?.ammo ?? 0;
    ctx.fillText(`Lives: ${me.lives ?? 0}  ·  Bullets: ${me.alive ? bullets : '-'}  ·  ${left} still in`, W / 2, 16);
  } else {
    ctx.fillText(topLine(me.frags, game.fragLimit, rank), W / 2, 16);
  }
}

const topLine = textOf((frags, limit, rank) => `${frags} / ${limit} frags  ·  ${ordinal(rank)} place`);

function drawScoreboard(ctx, game, me, W, H, opts, standings) {
  // Huge games: the top 20, then you (if you're further down).
  const TOP = 20;
  let list = standings, more = 0;
  if (list.length > TOP + 2) {
    more = list.length - TOP;
    list = list.slice(0, TOP);
    if (!list.includes(me) && me) { list.push(me); more--; }
  }
  const rules = game.rules;
  const extra = rules.scoreLabel !== 'Frags';
  // Columns from the right: [heading, value(soldier), colour(soldier)?]
  const cols = [];
  if (opts.online) cols.push(['Ping', pingText, s => (s.ping > 200 && !s.isBot && s.id !== opts.hostId ? '#c22' : null)]);
  cols.push(['Deaths', s => String(s.deaths)], ['Frags', s => String(s.frags)]);
  if (extra) cols.push([rules.scoreLabel, s => String(rules.score(s))]);
  if (game.classesOn) cols.push(['Class', s => CLASSES[s.cls]?.name ?? '']);
  // Defuse: your teammates' money (not the other team's).
  if (game.mode === 'defuse' && game.modeState) cols.push(['Money', s => (s.team === me.team ? `$${moneyOf(game, s)}` : '')]);
  function pingText(s) {
    if (s.isBot) return '';
    if (s.id === opts.hostId) return 'host';
    return s.ping == null ? '–' : String(Math.round(s.ping));
  }
  const w = 300 + cols.length * 65, rowH = 22, h = 70 + list.length * rowH + (more ? rowH : 0);
  const colX = i => x + w - 20 - i * 65;
  const x = W / 2 - w / 2;
  let y = Math.max(40, H / 2 - h / 2 - 40);
  // The match is over: the awards go round the board (which may move down for them).
  const awards = game.over && game.awards?.length ? game.awards.slice(0, 4) : null;
  let cards = null;
  if (awards) {
    const rounds = game.mode === 'defuse' && game.modeState?.history?.length ? 54 : 0;
    cards = placeAwards(awards.length, W, H, x, y, w, h + rounds);
    y = cards.boardY;
  }
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.textAlign = 'center';
  ctx.font = `bold 16px ${FONT}`;
  ctx.fillStyle = '#111';
  let title = opts.title || 'Scores';
  if (game.over && game.winner) {
    title = game.winner.team ? `${game.winner.team === 1 ? 'Blue' : 'Red'} team wins!` : `${game.winner.soldier === me ? 'You win!' : game.winner.soldier.name + ' wins!'}`;
  }
  ctx.fillText(title, W / 2, y + 22);
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = '#888';
  ctx.textAlign = 'left';
  ctx.fillText('Name', x + 20, y + 48);
  ctx.textAlign = 'right';
  cols.forEach(([head], i) => ctx.fillText(head, colX(i), y + 48));
  // (Round by round: the dead are greyed out until the next round.)
  const rounds = game.mode === 'defuse' && !game.over;
  list.forEach((s, i) => {
    const ry = y + 70 + i * rowH;
    ctx.font = `${s === me ? 'bold ' : ''}13px ${FONT}`;
    ctx.globalAlpha = rounds && !s.alive && !s.spectating ? 0.45 : 1;
    const color = rules.teams ? TEAM[s.team] : '#222';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(s.name, x + 20, ry);
    const nameW = ctx.measureText(s.name).width;
    ctx.textAlign = 'right';
    cols.forEach(([, value, tint], c) => {
      ctx.fillStyle = tint?.(s) || color;
      ctx.fillText(value(s), colX(c), ry);
    });
    if (s.isBot) { ctx.fillStyle = '#aaa'; ctx.font = `10px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText('bot', x + 26 + nameW, ry); }
    else if (s.spectating) { ctx.fillStyle = '#999'; ctx.font = `10px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText('spectating', x + 26 + nameW, ry); }
  });
  ctx.globalAlpha = 1;
  if (more) {
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = '#888';
    ctx.textAlign = 'left';
    ctx.fillText(`…and ${more} more`, x + 20, y + 70 + list.length * rowH);
  }
  if (game.mode === 'defuse') drawRounds(ctx, game, W / 2, y + h + 8);
  if (cards) awards.forEach((a, i) => drawAward(ctx, me, a, cards.at[i].x, cards.at[i].y, cards.w, cards.h, cards.compact));
}

// The end-of-match awards: each one's colour.
const AWARD_COLOR = { mvp: '#e0a020', streak: '#e5641a', headshots: '#c22', demolition: '#555' };

/**
 * Where n award cards go round the scoreboard (bx, by, bw, bh: its box, with Defuse's
 * rounds under it), clear of the buttons at the bottom of the screen: in a row above the
 * board (the two centred together, so the board moves down a little); beside it when a
 * long board leaves no room above; a compact row on small screens.
 * Returns { boardY, at: [{ x, y }], w, h, compact }.
 */
function placeAwards(n, W, H, bx, by, bw, bh) {
  const bottom = H * 0.88 - 52; // (the page keeps 12% under its buttons)
  const compact = W < 700, gap = compact ? 6 : 10;
  const w = compact ? (Math.min(W, 640) - 24 - (n - 1) * gap) / n : Math.min(178, (W - 32 - (n - 1) * gap) / n);
  const h = compact ? 46 : 70;
  const rowW = n * w + (n - 1) * gap;
  const row = y => Array.from({ length: n }, (_, i) => ({ x: Math.round(W / 2 - rowW / 2 + i * (w + gap)), y }));
  const top = Math.max(36, H / 2 - (h + 14 + bh) / 2 - 40);
  if (top + h + 14 + bh <= bottom) return { boardY: top + h + 14, at: row(top), w, h, compact };
  // Beside the board (wide screens), from its top down.
  if (!compact && bx + bw + 14 + w <= W - 12) {
    return { boardY: by, at: Array.from({ length: n }, (_, i) => ({ x: Math.round(bx + bw + 14), y: by + i * (h + 8) })), w, h, compact };
  }
  // No room anywhere: a compact row at the top, the board under it.
  const cw = (Math.min(W, 640) - 24 - (n - 1) * 6) / n, cRow = n * cw + (n - 1) * 6;
  return { boardY: Math.max(by, 36 + 46 + 8), at: Array.from({ length: n }, (_, i) => ({ x: Math.round(W / 2 - cRow / 2 + i * (cw + 6)), y: 36 })), w: cw, h: 46, compact: true };
}

/** One award card: what it's for, who won it (in their team's colour), and the numbers. Yours have a gold edge. */
function drawAward(ctx, me, a, x, y, w, h, compact) {
  const own = a.soldier === me.id, color = AWARD_COLOR[a.id] || '#555';
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, compact ? 2 : 3);
  ctx.strokeStyle = own ? '#d4a017' : '#222';
  ctx.lineWidth = own ? 2.5 : 1.5;
  ctx.strokeRect(x, y, w, h);
  const pad = compact ? 8 : 12;
  let tx = x + pad;
  const ty = y + (compact ? 11 : 19);
  if (!compact) {
    awardIcon(ctx, a.id, x + 19, ty, color);
    tx = x + 33;
  }
  ctx.textAlign = 'left';
  ctx.font = `bold ${compact ? 9 : 10}px ${FONT}`;
  ctx.fillStyle = '#777';
  const youW = own ? (compact ? 22 : 28) : 0;
  // (Online the awards come from the host as they are: a missing field shows blank.)
  ctx.fillText(fit(ctx, String(a.title ?? '').toUpperCase(), x + w - pad - youW - tx), tx, ty);
  if (own) {
    ctx.textAlign = 'right';
    ctx.font = `bold ${compact ? 8 : 9}px ${FONT}`;
    ctx.fillStyle = '#d4a017';
    ctx.fillText('YOU', x + w - pad + 2, ty);
    ctx.textAlign = 'left';
  }
  ctx.font = `bold ${compact ? 12 : 15}px ${FONT}`;
  ctx.fillStyle = TEAM[a.team] || '#222';
  ctx.fillText(fit(ctx, a.name, w - pad * 2), x + pad, y + (compact ? 26 : 40));
  ctx.font = `${compact ? 10 : 11}px ${FONT}`;
  ctx.fillStyle = '#666';
  ctx.fillText(fit(ctx, a.text || '', w - pad * 2), x + pad, y + (compact ? 38 : 58));
}

/** A small picture for each award (about 14 px across, centred on x, y). */
function awardIcon(ctx, id, x, y, color) {
  ctx.fillStyle = ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (id === 'mvp') {
    // A star.
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 3 : 7.2, a = -Math.PI / 2 + i * Math.PI / 5;
      if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  } else if (id === 'streak') {
    // A lightning bolt.
    const p = [[2, -7.5], [-4.5, 1], [-0.5, 1], [-2.5, 7.5], [4.5, -1.5], [0.5, -1.5]];
    p.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)));
    ctx.closePath();
    ctx.fill();
  } else if (id === 'headshots') {
    // Cross hairs.
    ctx.arc(x, y, 4.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(x + dx * 2.5, y + dy * 2.5);
      ctx.lineTo(x + dx * 7.5, y + dy * 7.5);
    }
    ctx.stroke();
  } else {
    // A bomb with a lit fuse.
    ctx.arc(x - 1, y + 1.5, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 2.5, y - 2.5);
    ctx.lineTo(x + 5, y - 5.5);
    ctx.stroke();
    ctx.fillStyle = '#ff9a1f';
    ctx.beginPath();
    ctx.arc(x + 5.6, y - 6.2, 1.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = 'butt';
}

/** Text cut short with "…" to fit max px (in the current font). */
function fit(ctx, text, max) {
  text = String(text ?? '');
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/**
 * Defuse: the rounds so far, under the scores (as Counter-Strike shows them): who won
 * each, and how (wiped out, bomb, defused, time).
 */
function drawRounds(ctx, game, cx, y) {
  const list = game.modeState?.history || [];
  if (!list.length) return;
  const size = 16, gap = 3, n = Math.min(list.length, 30), shown = list.slice(-n);
  const w = n * (size + gap) - gap;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(cx - w / 2 - 8, y, w + 16, size + 30);
  ctx.textAlign = 'center';
  ctx.font = `10px ${FONT}`;
  ctx.fillStyle = '#888';
  ctx.fillText('Rounds', cx, y + 9);
  shown.forEach((h, i) => {
    const team = +h[0], how = h[2];
    const x = cx - w / 2 + i * (size + gap), by = y + 18, mx = x + size / 2, my = by + size / 2;
    ctx.fillStyle = TEAM[team] || '#888';
    ctx.fillRect(x, by, size, size);
    ctx.fillStyle = ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    if (how === 't') {
      // Time ran out: a little clock.
      ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx, my - 3.5); ctx.lineTo(mx, my); ctx.lineTo(mx + 2.5, my); ctx.stroke();
    } else {
      // Wiped out (×), the bomb went off (B), or it was defused (D).
      ctx.font = `bold ${how === 'e' ? 13 : 10}px ${FONT}`;
      ctx.fillText(how === 'e' ? '×' : how === 'b' ? 'B' : 'D', mx, my + 1);
    }
  });
}

// Team colours that read on the replay's black bars.
const TEAM_ON_BLACK = { 1: '#6b9dff', 2: '#ff6a5c' };

/**
 * The slow-motion replay of the winning kill (drawn instead of the HUD): black bars top
 * and bottom that slide in, "REPLAY" with a blinking red dot, "Winning kill", who killed
 * whom with what, how to skip, and a marker while it's in slow motion.
 * r: the renderer (r.ctx, r.dpr, r.w, r.h). info: { killer, victim (names), killerTeam,
 * victimTeam, weapon (its name, or null), headshot, k (0 to 1 through the replay), slow }.
 */
export function drawReplay(r, info) {
  const ctx = r.ctx, d = r.dpr, W = r.w, H = r.h;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 1;
  const k = Math.max(0, Math.min(1, info.k || 0));
  const s = 1 - (1 - Math.min(1, k / 0.06)) ** 3;
  const full = Math.round(Math.max(44, H * 0.09)), bh = Math.round(full * s);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, bh);
  ctx.fillRect(0, H - bh, W, bh);
  // How far through it is: a thin red line under the top bar.
  ctx.fillStyle = '#e8262a';
  ctx.fillRect(0, bh - 2, W * k, 2);
  const top = bh - full / 2, low = H - bh + full / 2;
  ctx.globalAlpha = s;

  // Top left: REPLAY, its dot blinking like a recording light. (Timed by the replay
  // itself, not the clock, like the rest of the drawing: slower in slow motion.)
  const blink = Math.floor(k * 16) % 2 === 0;
  ctx.fillStyle = '#e8262a';
  ctx.globalAlpha = s * (blink ? 1 : 0.35);
  ctx.beginPath();
  ctx.arc(22, top, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = s;
  ctx.textAlign = 'left';
  ctx.font = `bold 14px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText('REPLAY', 34, top + 1);
  // Top middle: what it is. Top right: slow motion.
  ctx.textAlign = 'center';
  ctx.font = `bold 16px ${FONT}`;
  ctx.fillText('WINNING KILL', W / 2, top + 1);
  if (info.slow) {
    ctx.textAlign = 'right';
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillStyle = '#ffd25a';
    const label = 'SLOW MOTION', lw = ctx.measureText(label).width;
    ctx.fillText(label, W - 18, top + 1);
    // An hourglass: time slowed down.
    const ix = W - 18 - lw - 12;
    ctx.beginPath();
    ctx.moveTo(ix - 4, top - 5.5);
    ctx.lineTo(ix + 4, top - 5.5);
    ctx.lineTo(ix, top);
    ctx.closePath();
    ctx.moveTo(ix, top);
    ctx.lineTo(ix + 4, top + 5.5);
    ctx.lineTo(ix - 4, top + 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(ix - 5.5, top - 7, 11, 1.5);
    ctx.fillRect(ix - 5.5, top + 5.5, 11, 1.5);
  }

  // Bottom: killer ▸ victim (weapon, headshot), and how to skip.
  const parts = [
    [info.killer || '?', TEAM_ON_BLACK[info.killerTeam] || '#fff', true],
    ['   ▸   ', '#8c8c8c', false],
    [info.victim || '?', TEAM_ON_BLACK[info.victimTeam] || '#fff', true],
  ];
  if (info.weapon) parts.push([`   (${info.weapon})`, '#c8c8c8', false]);
  if (info.headshot) parts.push(['  ·  headshot', '#ffd25a', true]);
  const fontOf = bold => (bold ? `bold 17px ${FONT}` : `14px ${FONT}`);
  const widths = parts.map(([text, , bold]) => { ctx.font = fontOf(bold); return ctx.measureText(text).width; });
  const total = widths.reduce((a, b) => a + b, 0);
  const hint = 'Click or press any key to skip';
  ctx.font = `11px ${FONT}`;
  const hw = ctx.measureText(hint).width;
  // (Not enough room beside it: the hint goes under the names.)
  const under = W / 2 + total / 2 + 24 > W - 18 - hw;
  const ly = under ? low - 8 : low + 1;
  let x = W / 2 - total / 2;
  ctx.textAlign = 'left';
  parts.forEach(([text, color, bold], i) => {
    ctx.font = fontOf(bold);
    ctx.fillStyle = color;
    ctx.fillText(text, x, ly);
    x += widths[i];
  });
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = '#a3a3a3';
  if (under) {
    ctx.textAlign = 'center';
    ctx.fillText(hint, W / 2, low + 13);
  } else {
    ctx.textAlign = 'right';
    ctx.fillText(hint, W - 18, low + 1);
  }
  ctx.globalAlpha = 1;
}

const ORDINAL = ['th', 'st', 'nd', 'rd'];
function ordinal(n) {
  const s = ORDINAL, v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
