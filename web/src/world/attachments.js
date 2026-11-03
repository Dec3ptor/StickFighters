// Weapon attachments (worlds): fitted to a gun in the inventory (an attachment picked up and put
// on the gun; right click the gun to take them all off again), one in each of its places: a
// sight (red dot, or a scope: aiming with it, right click held, the view zooms in and can be
// steered out as far as it reaches, the best many hundreds of blocks: scope.js), the muzzle (a suppressor, a compensator, a long
// barrel), under the barrel (a foregrip, a laser sight) and the magazine (bigger ones, faster
// ones, for guns with one; hollow points for any). What's fitted is kept with the gun (its slot's
// g.att: items.js's cleanGear keeps it), and adds to what the gun's own affixes do (gear.js's
// weaponWith). Made at a gunsmith's bench (crafting.js), sold by gunsmiths, found in crates.

import { WEAPONS } from '../weapons.js';

/** Where on a gun an attachment goes, and what each place is called. */
export const ATT_SLOTS = { sight: 'Sight', muzzle: 'Muzzle', under: 'Under the barrel', mag: 'Magazine' };

/**
 * The attachments: name, place, what they add (gear.js's weapon stats: wdmg, wrof, wreload, wmag,
 * wacc), and anything else: scope { reach (blocks it sees out to), mag (how far it zooms in) },
 * quiet (heard by far fewer), long (reaches further: ×), laser (a beam shows where it's aimed),
 * needs ('mag': only guns with a magazine), color (its picture's), tier (worth).
 */
export const ATTACHMENTS = {
  red_dot: { name: 'Red dot sight', slot: 'sight', stats: { wacc: 15 }, scope: { reach: 14, mag: 1.25 }, color: '#e0303c', tier: 1 },
  scope2: { name: '2× scope', slot: 'sight', stats: { wacc: 10 }, scope: { reach: 30, mag: 1.6 }, color: '#5a6a7a', tier: 2 },
  scope4: { name: '4× scope', slot: 'sight', stats: { wacc: 15 }, scope: { reach: 60, mag: 2 }, color: '#4a5a6a', tier: 3 },
  scope8: { name: '8× scope', slot: 'sight', stats: { wacc: 20 }, scope: { reach: 120, mag: 2.4 }, color: '#3a4a5a', tier: 4 },
  scope16: { name: '16× long-range scope', slot: 'sight', stats: { wacc: 25 }, scope: { reach: 240, mag: 2.8 }, color: '#2f62ee', tier: 5 },
  hawkeye: { name: 'Hawkeye scope', slot: 'sight', stats: { wacc: 35 }, scope: { reach: 500, mag: 3.2 }, color: '#c4f6ff', tier: 6 },
  suppressor: { name: 'Suppressor', slot: 'muzzle', stats: { wdmg: -5 }, quiet: true, color: '#2a2a2a', tier: 2 },
  compensator: { name: 'Compensator', slot: 'muzzle', stats: { wacc: 25 }, color: '#8a8f96', tier: 2 },
  long_barrel: { name: 'Long barrel', slot: 'muzzle', stats: { wdmg: 15 }, long: 1.5, color: '#5a5f66', tier: 3 },
  foregrip: { name: 'Foregrip', slot: 'under', stats: { wacc: 20 }, color: '#5c3f22', tier: 1 },
  laser: { name: 'Laser sight', slot: 'under', stats: { wacc: 12 }, laser: true, color: '#e0213c', tier: 2 },
  ext_mag: { name: 'Extended magazine', slot: 'mag', stats: { wmag: 50 }, needs: 'mag', color: '#4f5a46', tier: 1 },
  drum_mag: { name: 'Drum magazine', slot: 'mag', stats: { wmag: 150, wreload: -20 }, needs: 'mag', color: '#3a4434', tier: 3 },
  quick_mag: { name: 'Quick-release magazine', slot: 'mag', stats: { wreload: 40 }, needs: 'mag', color: '#6a7a5a', tier: 2 },
  hollow_points: { name: 'Hollow-point rounds', slot: 'mag', stats: { wdmg: 15 }, color: '#c8a040', tier: 2 },
};

// The kinds of gun each place suits.
const SUITS = {
  sight: new Set(['bullet', 'rail', 'arrow', 'seeker', 'rocket']),
  muzzle: new Set(['bullet', 'rail']),
  under: new Set(['bullet', 'rail', 'rocket', 'arrow']),
  mag: new Set(['bullet', 'rail']),
};

/** Whether attachment `key` fits weapon `id` (and why not: a reason, or ''). */
export function fitsWhy(key, id) {
  const a = ATTACHMENTS[key], def = WEAPONS[id];
  if (!a || !def) return 'That isn\'t an attachment for a gun';
  if (!SUITS[a.slot].has(def.kind)) return `A ${a.name.toLowerCase()} won't go on a ${def.name.toLowerCase()}`;
  if (a.needs === 'mag' && !(typeof def.mag === 'number' && def.mag > 0)) return `The ${def.name} has no magazine for it`;
  return '';
}
export const fits = (key, id) => !fitsWhy(key, id);

/** What gun `id`'s fitted attachments (att: { place: key }) add: { stats (gear.js's), scope, quiet, long, laser }. */
export function attachmentsOf(att) {
  const out = { stats: {}, scope: null, quiet: false, long: 1, laser: false };
  if (!att) return out;
  for (const place of Object.keys(ATT_SLOTS)) {
    const a = ATTACHMENTS[att[place]];
    if (!a || a.slot !== place) continue;
    for (const [k, v] of Object.entries(a.stats || {})) out.stats[k] = (out.stats[k] || 0) + v;
    if (a.scope) out.scope = a.scope;
    if (a.quiet) out.quiet = true;
    if (a.long) out.long *= a.long;
    if (a.laser) out.laser = true;
  }
  return out;
}

/**
 * The stats gun slot `sl` fires with: its own affixes (g.stats) and its attachments', with what
 * gear.js's weaponWith needs for them besides (wrange: how far it reaches, in pixels, when a
 * scope sees further; quiet; laser). null: nothing changed.
 */
export function gunStats(sl) {
  const g = sl?.g;
  if (!g) return null;
  if (!g.att) return g.stats || null;
  const a = attachmentsOf(g.att), def = WEAPONS[sl.key], st = { ...(g.stats || {}) };
  for (const [k, v] of Object.entries(a.stats)) st[k] = (st[k] || 0) + v;
  const range = typeof def?.range === 'number' ? def.range * a.long : 0;
  // (A scope that sees further than the gun reaches: it reaches as far as it sees.)
  const seen = a.scope ? a.scope.reach * 16 : 0;
  if (range && Math.max(range, seen) !== def.range) st.wrange = Math.round(Math.max(range, seen));
  if (a.quiet) st.wquiet = 1;
  if (a.laser) st.wlaser = 1;
  return st;
}

/** A gun's own scope, with none fitted (or a lesser one): a sniper rifle's. */
export const OWN_SCOPES = { SR: { reach: 45, mag: 1.8 } };

/** The scope on gun slot `sl`: the one fitted, or the gun's own if that sees further; { reach (blocks), mag }, or null. */
export function scopeOf(sl) {
  const fitted = sl?.g?.att ? attachmentsOf(sl.g.att).scope : null, own = sl ? OWN_SCOPES[sl.key] : null;
  return !own ? fitted : !fitted || own.reach > fitted.reach ? own : fitted;
}

/** A gun's attachments from a save or the network: only real ones, each where it goes, on a gun it fits. */
export function cleanAtt(att, id) {
  if (!att || typeof att !== 'object') return null;
  const out = {};
  for (const place of Object.keys(ATT_SLOTS)) {
    const key = att[place];
    if (typeof key === 'string' && ATTACHMENTS[key]?.slot === place && (!id || fits(key, id))) out[place] = key;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Fit attachment `key` to the gun in slot `sl` ({ key, n, g? }; a plain one gets details of its
 * own: basic). Returns { ok, why, off } (off: the attachment that was there before, now off).
 * The slot's g is a new object (what's held is worked out again: worldplay.js's hold).
 */
export function fitTo(sl, key, name = null) {
  const why = fitsWhy(key, sl?.key);
  if (why) return { ok: false, why, off: null };
  const a = ATTACHMENTS[key], old = sl.g?.att?.[a.slot] || null;
  const g = sl.g ? { ...sl.g } : { r: 'basic', name: name || WEAPONS[sl.key].name, stats: {}, ilvl: 1 };
  g.att = { ...(g.att || {}), [a.slot]: key };
  sl.g = g;
  return { ok: true, why: '', off: old };
}

/** Take everything off the gun in slot `sl`: the attachments' keys (the slot's g, a new object). */
export function strip(sl) {
  const att = sl?.g?.att;
  if (!att) return [];
  const off = Object.values(att).filter(k => ATTACHMENTS[k]);
  const g = { ...sl.g };
  delete g.att;
  // (A plain gun's details, there only for its attachments: gone too.)
  if (g.r === 'basic' && !Object.keys(g.stats || {}).length && !g.unique && !g.set) delete sl.g;
  else sl.g = g;
  return off;
}

/** What a gun's attachments are, said: one line each (the card's: iteminfo.js). */
export function attLines(att) {
  const out = [];
  for (const place of Object.keys(ATT_SLOTS)) {
    const a = ATTACHMENTS[att?.[place]];
    if (a) out.push(`${ATT_SLOTS[place]}: ${a.name}${describe(a)}`);
  }
  return out;
}

/** What an attachment does, in a few words (after its name). */
export function describe(a) {
  const bits = effects(a);
  return bits.length ? ` (${bits.join(', ')})` : '';
}

/** What an attachment does: a few words for each thing. */
export function effects(a) {
  const bits = [];
  if (a.scope) bits.push(`aiming, looks out to ${a.scope.reach} blocks (as far as its shots go) and zooms up to ${a.scope.mag}× with the wheel`);
  if (a.stats?.wacc) bits.push(`${a.stats.wacc}% more accurate`);
  if (a.stats?.wdmg) bits.push(`${a.stats.wdmg > 0 ? '+' : ''}${a.stats.wdmg}% damage`);
  if (a.stats?.wmag) bits.push(`+${a.stats.wmag}% magazine`);
  if (a.stats?.wreload) bits.push(a.stats.wreload > 0 ? `${a.stats.wreload}% faster reloading` : `${-a.stats.wreload}% slower reloading`);
  if (a.quiet) bits.push('quiet: monsters hear it from a quarter as far');
  if (a.long) bits.push(`reaches ${Math.round((a.long - 1) * 100)}% further`);
  if (a.laser) bits.push('a beam shows where it\'s aimed');
  return bits;
}
