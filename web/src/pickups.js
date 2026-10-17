// Health, armour, jetpacks and weapons lying on the map, plus weapons dropped by the dead.

import { BODY, ITEM_RESPAWN, ITEM_SIZE, RULES } from './config.js';
import { WEAPONS } from './weapons.js';

export class Pickups {
  constructor(map) {
    this.items = map.items
      .filter(it => it.type !== 'weapon' || WEAPONS[it.weapon])
      .map(it => ({ ...it, active: true, timer: 0, dropped: false, bob: Math.random() * 6 }));
  }

  /** Drop a weapon where a soldier died. */
  drop(id, ammo, x, y, vx) {
    this.items.push({ type: 'weapon', weapon: id, ammo, x, y, vx, vy: -2, active: true, dropped: true, life: RULES.droppedWeaponTicks, bob: 0 });
  }

  update(game) {
    for (const it of this.items) {
      if (it.dropped) {
        it.life--;
        if (it.vy !== null) {
          it.vy = Math.min(it.vy + 0.3, 10);
          const hit = game.map.raycast(it.x, it.y, it.x + it.vx, it.y + it.vy + 4);
          if (hit) { it.x = hit.x; it.y = hit.y - 4; it.vx = 0; it.vy = null; }
          else { it.x += it.vx; it.y += it.vy; it.vx *= 0.98; }
          if (it.y > game.map.bounds.bottom + RULES.fallDeathMargin) it.life = 0;
        }
      } else if (!it.active && --it.timer <= 0) {
        it.active = true;
        game.sound('respawnItem', it.x, it.y);
      }
    }
    this.items = this.items.filter(it => !it.dropped || it.life > 0);
  }

  /** Give the soldier anything they're touching. */
  touch(game, s) {
    const top = s.y + (s.body.crouching ? BODY.crouchTop : BODY.top);
    for (const it of this.items) {
      if (!it.active) continue;
      if (Math.abs(it.x - s.x) > BODY.halfW + ITEM_SIZE) continue;
      if (it.y < top - ITEM_SIZE || it.y > s.y + BODY.bottom + ITEM_SIZE) continue;
      if (!give(game, s, it)) continue;
      if (it.dropped) it.life = 0;
      else { it.active = false; it.timer = ITEM_RESPAWN[it.type] || 600; }
    }
  }
}

function give(game, s, it) {
  switch (it.type) {
    case 'health':
      if (s.health >= RULES.maxHealth && s.burnTicks <= 0) return false;
      s.health = RULES.maxHealth;
      s.burnTicks = 0;
      game.sound('health', it.x, it.y);
      game.notify(s, 'Health restored');
      return true;
    case 'armour':
      if (s.armour >= RULES.maxArmour) return false;
      s.armour = RULES.maxArmour;
      game.sound('armour', it.x, it.y);
      game.notify(s, 'You got the Armour');
      return true;
    case 'jetpack':
      if (s.body.hasJetpack && s.body.fuel >= 100) return false;
      s.body.hasJetpack = true;
      s.body.fuel = 100;
      game.sound('pickup', it.x, it.y);
      game.notify(s, 'You got the Jetpack — hold jump in the air to fly');
      return true;
    case 'weapon': {
      const def = WEAPONS[it.weapon];
      const inv = s.weapons[it.weapon];
      const amount = it.ammo ?? def.ammo;
      if (!inv) {
        s.weapons[it.weapon] = { ammo: amount };
        s.select(it.weapon);
        game.notify(s, `You got the ${def.name}`);
      } else {
        if (inv.ammo >= def.maxAmmo) return false;
        inv.ammo = Math.min(def.maxAmmo, inv.ammo + amount);
        game.notify(s, `${def.name} ammo`);
      }
      game.sound('pickup', it.x, it.y);
      return true;
    }
  }
  return false;
}
