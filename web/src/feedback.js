// What a fight tells the player, kept here and drawn by the HUD (hud.js), in matches and worlds,
// in both games, offline and online alike:
//   - a hit of theirs landing: a tick (a sharper one for a headshot) and a mark at the crosshair,
//     for every hit, not only the ones that kill;
//   - being hit: where it came from (an arc round them pointing at whoever did it), a red flash at
//     the screen's edges by how much it took, and a slow red pulse (and a heartbeat) when they're
//     nearly dead;
//   - being killed: who did it, with what, how much health they had left and how far off they
//     were, shown while waiting to come back (and the camera goes over to them: main.js).
// The game says the first two as sounds only that player hears ('hittick', 'hitmarker', 'hurt':
// combat.js's damage), so they reach a player online the way everything else of theirs does; the
// flash comes from their own health as it's seen to drop, whatever took it; the last from the kill
// feed, which says who killed whom.

/** How long each lasts (ms): the hit mark, an arc pointing at who hit you, the flash, the recap. */
export const HIT_MARK_MS = 200, HURT_MS = 1400, FLASH_MS = 420, RECAP_MS = 6000;
/** Under this share of their health, the screen's edges pulse red. */
export const LOW_HEALTH = 0.3;
/** The heartbeat while that low: one this often (ms). */
export const BEAT_MS = 900;

/** A player's feedback, nothing having happened yet (main.js keeps one, and starts again each match). */
export function newFeedback() {
  // (hitAt, hitHead: their last hit landing, and whether a headshot. hurts: [{ x, y, at }], where
  // hits on them came from. flash, flashAt: how strong the last flash was (0-1), and when. health:
  // theirs when last looked at. recap: who killed them ({ killer, name, team, weapon, headshot,
  // health, max, dist, at }). feedSeen: the newest of the kill feed looked at. beatAt: the last heartbeat.)
  return { hitAt: -1e9, hitHead: false, hurts: [], flash: 0, flashAt: -1e9, health: null, recap: null, feedSeen: null, beatAt: -1e9 };
}

/**
 * This frame's sounds, for player `me`: a hit of theirs landing, or one landing on them (where
 * from). (A sound for someone else isn't theirs: offline they carry who they're for; online the
 * host only sends a player their own.)
 */
export function hearFeedback(fb, sounds, me, now) {
  for (const s of sounds) {
    if (s.to != null && s.to !== me.id) continue;
    if (s.name === 'hittick' || s.name === 'hitmarker') {
      // (A headshot's mark isn't taken over by a body hit in the same moment: a shotgun's pellets.)
      fb.hitHead = s.name === 'hitmarker' || (fb.hitHead && now - fb.hitAt < 60);
      fb.hitAt = now;
    } else if (s.name === 'hurt' && s.x != null) {
      // (From about where the last one came from: that arc again, not another.)
      const old = fb.hurts.find(h => Math.hypot(h.x - s.x, h.y - s.y) < 90);
      if (old) { old.x = s.x; old.y = s.y; old.at = now; }
      else fb.hurts.push({ x: s.x, y: s.y, at: now });
    }
  }
  if (fb.hurts.length) {
    fb.hurts = fb.hurts.filter(h => now - h.at < HURT_MS);
    if (fb.hurts.length > 6) fb.hurts.splice(0, fb.hurts.length - 6);
  }
}

/** Their health as it is now: a drop flashes, however it came (a burn, a fall, their own blast). */
export function watchHealth(fb, me, now) {
  const h = me.alive ? me.health : null;
  if (h != null && fb.health != null && h < fb.health - 0.5) {
    const left = fb.flash * Math.max(0, 1 - (now - fb.flashAt) / FLASH_MS);
    fb.flash = Math.min(1, left + 0.25 + (fb.health - h) / (0.45 * (me.maxHealth || 100)));
    fb.flashAt = now;
  }
  // (Back from the dead: nothing left of the last life's.)
  if (h != null && fb.health == null) { fb.hurts.length = 0; fb.flash = 0; fb.recap = null; }
  fb.health = h;
}

/**
 * The kill feed's new lines: one saying `me` was killed by someone is kept, with how that someone
 * was just then (the recap while waiting to come back). Lines are looked at once each.
 */
export function seeKills(fb, game, me, now) {
  const feed = game.feed;
  let from = feed.length;
  while (from > 0 && feed[from - 1] !== fb.feedSeen) from--;
  for (let i = from; i < feed.length; i++) {
    const e = feed[i], k = e.killer;
    if (e.victim !== me || !k || k === me) continue;
    fb.recap = {
      killer: k, name: k.name, team: k.team, weapon: e.weapon || null, headshot: !!e.headshot,
      health: Math.max(0, Math.ceil(k.alive ? k.health : 0)), max: k.maxHealth || 100, armour: Math.ceil(k.armour || 0),
      dist: Math.round(Math.hypot(k.x - me.x, k.y - me.y)), at: now,
    };
  }
  if (feed.length) fb.feedSeen = feed[feed.length - 1];
  if (fb.recap && now - fb.recap.at > RECAP_MS) fb.recap = null;
}

/** Whether a heartbeat is due (they're alive and nearly dead): at most one each BEAT_MS. */
export function beatDue(fb, me, now) {
  if (!me.alive || !(me.health > 0) || me.health > LOW_HEALTH * (me.maxHealth || 100)) return false;
  if (now - fb.beatAt < BEAT_MS) return false;
  fb.beatAt = now;
  return true;
}

/**
 * What the HUD draws of it, at `now`, for player `me` drawn at (sx, sy) on the screen with the
 * crosshair at (mx, my): { hit: { x, y, k, head } | null, hurts: [{ a (the angle to who did it),
 * k (0 to 1 as it fades) }], at: { x, y }, flash (0-1), low (0-1: how near dead, 0 when not),
 * recap | null }.
 */
export function feedbackView(fb, me, now, sx, sy, mx, my) {
  const hk = (now - fb.hitAt) / HIT_MARK_MS;
  const hurts = [];
  if (me.alive) for (const h of fb.hurts) hurts.push({ a: Math.atan2(h.y - (me.y - 6), h.x - me.x), k: Math.min(1, (now - h.at) / HURT_MS) });
  const share = me.alive ? me.health / (me.maxHealth || 100) : 1;
  return {
    hit: hk >= 0 && hk < 1 ? { x: mx, y: my, k: hk, head: fb.hitHead } : null,
    hurts, at: { x: sx, y: sy },
    flash: me.alive ? fb.flash * Math.max(0, 1 - (now - fb.flashAt) / FLASH_MS) : 0,
    low: share < LOW_HEALTH && share > 0 ? 1 - share / LOW_HEALTH : 0,
    recap: !me.alive ? fb.recap : null,
  };
}
