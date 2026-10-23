// Shared setup for headless tests: load maps and run bot matches without a browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../web/src/game.js';
import { NavGraph } from '../web/src/nav.js';
import { BotController, BOT_PROFILES } from '../web/src/bot.js';
import { makeRng } from '../web/src/util.js';
import { DEFAULT_SPEED } from '../web/src/config.js';
import { modeOf } from '../web/src/modes.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

export const mapIndex = () => JSON.parse(fs.readFileSync(path.join(WEB, 'data/maps/index.json'), 'utf8'));
export const loadMap = file => JSON.parse(fs.readFileSync(path.join(WEB, 'data/maps', file), 'utf8'));

/** A bots-only match. */
export function botMatch(file, { bots = 6, mode = 'ffa', difficulty = 'normal', seed = 7, fragLimit = 999, speed = DEFAULT_SPEED, options = {}, nav: kept = null } = {}) {
  const mapData = loadMap(file);
  const game = new Game({ mapData, mode, fragLimit, seed, effects: false, speed, options });
  // (kept: a route map kept between matches, as the page does.)
  const nav = game.useNav(kept || new NavGraph(game.map));
  const rng = makeRng(seed * 31 + 1);
  for (let i = 0; i < bots; i++) {
    const profile = BOT_PROFILES[i % BOT_PROFILES.length];
    game.addSoldier({ name: profile.name, isBot: true, team: modeOf(mode).teams ? 1 + (i % 2) : 0, profile },
      new BotController(nav, difficulty, profile, rng));
  }
  return { game, nav };
}
