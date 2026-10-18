// Checking a map before it goes in the game: everything the map maker's check
// looks for (spots players can't get out of or can't get to, spawns in walls,
// items out of reach), plus what the objective modes need:
//   - both teams can get to every hill, flag, capture point and M-COM
//   - every Rush sector has somewhere for both teams to spawn
//   - how long each team takes to get to each objective (to keep it fair)
// and, with --play, bot matches in the objective modes to see how they go.
//
// Usage: node tools/maps/check.mjs <design or map> [--play koth,ctf,conquest,rush] [--bots 16] [--seconds 120]
import { loadMap } from './load.mjs';
import { checkMap } from '../../web/src/custommaps.js';
import { GameMap } from '../../web/src/map.js';
import { NavGraph } from '../../web/src/nav.js';
import { makeBody, stepBody } from '../../web/src/physics.js';
import { setGameSpeed } from '../../web/src/speed.js';
import { DEFAULT_SPEED, RULES } from '../../web/src/config.js';
import { objectivesOf, inZone, mcomZone, STAND } from '../../web/src/objectives.js';

/** Where a soldier dropped at a spawn point ends up standing (null: falls off the map). */
function landing(map, x, y) {
  const body = makeBody(x, y);
  for (let i = 0; i < 600; i++) {
    stepBody(body, { move: 0 }, map);
    if (body.onGround) return body;
    if (body.y > map.bounds.bottom + RULES.fallDeathMargin) return null;
  }
  return null;
}

/** Spots bots stand on that count as being at an objective. */
function nodesAt(nav, o) {
  if (o.type === 'hill' || o.type === 'point') return nav.nodes.filter(n => inZone(n, o));
  if (o.type === 'mcom') return nav.nodes.filter(n => inZone(n, mcomZone(o)));
  return nav.nodes.filter(n => Math.abs(n.x - o.x) <= 14 && Math.abs(n.y - (o.y - STAND)) < 3);
}

const nameOf = o => (o.type === 'hill' ? 'The hill' : o.type === 'flag' ? `The ${o.team === 1 ? 'blue' : 'red'} flag`
  : o.type === 'point' ? `Point ${o.label}` : `M-COM (sector ${o.sector})`) + ` at ${Math.round(o.x ?? (o.left + o.right) / 2)}, ${Math.round(o.y ?? o.bottom)}`;

/**
 * The objective modes' checks. Returns { problems: [{ level, text }], travel, stats }
 * where travel lists, for each objective, about how many seconds each team's
 * spawn points are from it.
 */
export function checkObjectives(data) {
  setGameSpeed(DEFAULT_SPEED);
  const problems = [];
  const add = (level, text) => problems.push({ level, text });
  const map = new GameMap(data);
  const t0 = performance.now();
  const nav = new NavGraph(map);
  const buildMs = performance.now() - t0;
  const { comp } = nav.groups();

  // The main area: the group of spots holding the most spawn points.
  const spawnNodes = [];
  for (const s of map.spawns) {
    const body = landing(map, s.x, s.y);
    const n = body && nav.nodeAt(body.x, body.y, 12);
    if (n) spawnNodes.push({ s, n });
  }
  const votes = new Map();
  for (const { n } of spawnNodes) votes.set(comp[n.id], (votes.get(comp[n.id]) || 0) + 1);
  const main = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];

  const own = new Set((data.objectives || []).map(o => o.type));
  for (const type of ['hill', 'flag', 'point', 'mcom']) {
    if (!own.has(type)) add('note', `No ${type === 'mcom' ? 'M-COM' : type}s placed: the game works some out from the layout.`);
  }
  const all = ['hill', 'flag', 'point', 'mcom'].flatMap(t => objectivesOf(map, t));
  const at = new Map();
  for (const o of all) {
    const nodes = nodesAt(nav, o).filter(n => comp[n.id] === main);
    at.set(o, nodes);
    if (!nodes.length) add('error', `${nameOf(o)}: there's nowhere players can reach to stand at it.`);
  }

  // Flags: far enough apart, and not right next to the other team's spawns.
  const flags = objectivesOf(map, 'flag');
  if (Math.hypot(flags[0].x - flags[1].x, flags[0].y - flags[1].y) < 500) add('warning', 'The flags are less than 500 px apart.');
  for (const f of flags) {
    const near = map.spawns.filter(s => s.team !== f.team && Math.hypot(s.x - f.x, s.y - f.y) < 300).length;
    if (near) add('warning', `${nameOf(f)} has ${near} enemy spawn point${near > 1 ? 's' : ''} within 300 px.`);
  }
  // Points: labels unique.
  const labels = objectivesOf(map, 'point').map(p => p.label);
  if (new Set(labels).size !== labels.length) add('error', `Capture point labels repeat: ${labels.join(', ')}`);

  // Rush: sectors in order, with spawns for both teams in each.
  const sectors = [...new Set(objectivesOf(map, 'mcom').map(m => m.sector))].sort((a, b) => a - b);
  const sectorSpawns = map.spawns.some(s => s.sector);
  for (const sec of sectors) {
    for (const team of [1, 2]) {
      const list = map.spawns.filter(s => s.team === team && s.sector === sec);
      if (sectorSpawns && !list.length && !map.spawns.some(s => s.team === team && !s.sector)) {
        add('error', `Rush sector ${sec}: no ${team === 1 ? 'blue (attacker)' : 'red (defender)'} spawn points for it, and none without a sector to fall back on.`);
      }
    }
  }

  // How far each team's spawn points are from each objective (seconds, roughly).
  const from = { 1: [], 2: [] };
  for (const { s, n } of spawnNodes) if (comp[n.id] === main) from[s.team]?.push({ s, cost: nav.costsFrom(n).cost });
  const travel = all.map(o => {
    const row = { name: nameOf(o) };
    for (const team of [1, 2]) {
      // Rush: from that sector's spawns where there are some.
      // Other modes: from the base spawns (the ones without a sector), as the game does.
      let list = from[team];
      const base = list.filter(x => !x.s.sector);
      if (o.type === 'mcom' && list.some(x => x.s.sector === o.sector)) list = list.filter(x => x.s.sector === o.sector);
      else if (base.length) list = base;
      const times = list.map(({ cost }) => Math.min(...(at.get(o) || []).map(n => cost[n.id]))).filter(Number.isFinite);
      row[team] = times.length ? Math.min(...times) / 60 : null;
    }
    return row;
  });
  return { problems, travel, stats: { nodes: nav.nodes.length, links: nav.linkCount, buildMs, nav, map } };
}

/** Bots-only matches in a mode: what happened, and whether bots got stuck. */
export async function playMode(data, mode, { bots = 16, seconds = 120, seed = 3 } = {}) {
  const { Game } = await import('../../web/src/game.js');
  const { MODES } = await import('../../web/src/modes.js');
  const { BotController, BOT_PROFILES } = await import('../../web/src/bot.js');
  const { makeRng } = await import('../../web/src/util.js');
  if (!MODES[mode]) return { mode, skipped: `no mode called ${mode}` };
  const game = new Game({ mapData: data, mode, fragLimit: 0, seed, effects: false, speed: DEFAULT_SPEED });
  const nav = new NavGraph(game.map);
  const rng = makeRng(seed);
  for (let i = 0; i < bots; i++) {
    const p = BOT_PROFILES[i % BOT_PROFILES.length];
    game.addSoldier({ name: `${p.name}${i}`, isBot: true, team: 1 + (i % 2), profile: p }, new BotController(nav, 'normal', p, rng));
  }
  const events = [];
  const feed = game.addFeed.bind(game);
  game.addFeed = e => { if (!e.victim) events.push(`${(game.tick / 60).toFixed(0)}s ${e.text}`); feed(e); };
  // Stuck: alive bots that haven't moved 40 px in 15 seconds.
  const last = new Map();
  let stuck = 0, ticks = 0;
  const t0 = performance.now();
  while (ticks < seconds * 60 && !game.over) {
    game.update();
    ticks++;
    if (ticks % 900 === 0) {
      for (const s of game.soldiers) {
        const p = last.get(s);
        if (p && s.alive && p.alive && s.deaths === p.deaths && Math.hypot(s.x - p.x, s.y - p.y) < 40) stuck++;
        last.set(s, { x: s.x, y: s.y, alive: s.alive, deaths: s.deaths });
      }
    }
  }
  return {
    mode, seconds: ticks / 60, ms: (performance.now() - t0) / ticks, kills: game.stats.kills, falls: game.stats.falls,
    teamScore: { ...game.teamScore }, winner: game.winner?.team ?? null, stuck, events, state: game.modeState,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const play = opt('--play'), bots = +(opt('--bots') || 16), seconds = +(opt('--seconds') || 120);
  const name = args[0];
  if (!name) { console.log('Usage: node tools/maps/check.mjs <design or map> [--play koth,ctf,conquest,rush] [--bots 16] [--seconds 120]'); process.exit(1); }
  const data = await loadMap(name);
  const b = data.bounds;
  console.log(`${data.name}: ${b.right - b.left} x ${b.bottom - b.top} px, ${data.platforms.length} platforms, ` +
    `${data.spawns.filter(s => s.team === 1).length} blue + ${data.spawns.filter(s => s.team === 2).length} red spawns, ${data.items.length} items`);
  const base = checkMap(data);
  const obj = checkObjectives(data);
  console.log(`Route map: ${obj.stats.nodes} spots, ${obj.stats.links} moves, built in ${obj.stats.buildMs.toFixed(0)} ms`);
  let errors = 0;
  for (const p of [...base.problems, ...obj.problems]) {
    if (p.level === 'error') errors++;
    console.log(`  ${p.level.toUpperCase().padEnd(7)} ${p.text}${p.x != null ? ` (at ${Math.round(p.x)}, ${Math.round(p.y)})` : ''}`);
  }
  console.log('Seconds from the nearest spawn point (blue / red):');
  for (const r of obj.travel) console.log(`  ${r.name.padEnd(40)} ${r[1] == null ? '  -  ' : r[1].toFixed(1).padStart(5)} / ${r[2] == null ? '  -  ' : r[2].toFixed(1).padStart(5)}`);
  if (play) {
    for (const mode of play.split(',')) {
      const r = await playMode(data, mode, { bots, seconds });
      if (r.skipped) { console.log(`${mode}: skipped (${r.skipped})`); continue; }
      console.log(`\n${mode}: ${r.seconds.toFixed(0)} s with ${bots} bots, ${r.ms.toFixed(2)} ms per update, ${r.kills} kills, ${r.falls} falls, ` +
        `score blue ${r.teamScore[1]} red ${r.teamScore[2]}, ${r.winner ? `${r.winner === 1 ? 'blue' : 'red'} won` : 'no winner yet'}, ${r.stuck} stuck`);
      for (const e of r.events.slice(0, 40)) console.log(`  ${e}`);
      if (r.events.length > 40) console.log(`  ...and ${r.events.length - 40} more`);
    }
  }
  process.exit(errors ? 1 : 0);
}
