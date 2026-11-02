// What items are, for the screens (web/src/world/iteminfo.js): every item has a colour by its
// kind and a card of details (what it does, what it's worth, how it's made), and the precious
// things are picked out. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, itemOf } from '../web/src/world/items.js';
import { categoryOf, itemColor, itemDetails, isPrecious, CATEGORY_COLORS } from '../web/src/world/iteminfo.js';

test('every item has a kind, a colour and a card of details', () => {
  for (const it of ITEMS.values()) {
    const c = categoryOf(it);
    assert.ok(CATEGORY_COLORS[c], `${it.key}: a kind with a colour (${c})`);
    assert.match(itemColor(it), /^#[0-9a-f]{6}$/i, `${it.key}: its colour`);
    const d = itemDetails(it, 3);
    assert.equal(d.name, it.name);
    assert.ok(d.kind && Array.isArray(d.lines), `${it.key}: what kind of thing, and what it does`);
    for (const l of [...d.lines, d.worth, d.made]) assert.ok(!/undefined|NaN|null/.test(l), `${it.key}: "${l}"`);
  }
});

test('the details say what matters: damage for guns, healing for food, the tier for pickaxes, worth and how it\'s made', () => {
  const m4 = itemDetails(itemOf('M4'));
  assert.ok(m4.lines.some(l => /damage/.test(l)) && m4.lines.some(l => /shots a second/.test(l)) && m4.lines.some(l => /bullets/.test(l)), m4.lines.join(' | '));
  assert.match(m4.worth, /Worth about \d+ coins/);
  assert.match(m4.made, /gunsmith's bench/);
  assert.ok(itemDetails(itemOf('bread')).lines.some(l => /Heals 25/.test(l)));
  assert.ok(itemDetails(itemOf('iron_pickaxe')).lines.some(l => /iron-tier/.test(l)));
  assert.match(itemDetails(itemOf('diamond'), 2).worth, /\(150 each\)/);
  assert.equal(itemDetails(itemOf('coins')).worth, '', 'coins are just coins');
});

test('precious things: gems, potions, weapons, coins and anything worth a lot; not dirt', () => {
  for (const k of ['ruby', 'diamond', 'healing_potion', 'M4', 'coins', 'gold_pickaxe']) assert.ok(isPrecious(itemOf(k)), k);
  for (const k of ['dirt', 'stone', 'planks', 'torch', 'bread']) assert.ok(!isPrecious(itemOf(k)), k);
});
