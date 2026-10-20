// The class pages: the Loadout screen (main menu) and the class picker (while
// waiting to respawn, or from the pause menu). main.js shows and hides them.

import { WEAPONS } from './weapons.js';
import { CLASSES, CLASS_IDS, UPGRADES, upgradesFor, kitWeapons, kitText } from './classes.js';
import { GADGETS } from './gadgets.js';

/**
 * The Loadout screen: for each class its gadget, main weapon and an upgrade for
 * each weapon. Choices change `kit` ({ cls, loadouts }) straight away; onChange()
 * is called after each (to save it).
 */
export function renderLoadout(root, kit, { onChange }) {
  let html = `<div class="lo-top">
    <p class="muted-note">Your choices for matches with <b>Classes</b> on. Each class has its own weapons and gadget (<kbd>G</kbd>); pick a main weapon and an upgrade for each weapon.</p>
  </div><div class="lo-classes">`;
  for (const cls of CLASS_IDS) html += classCard(kit, cls);
  html += '</div>';
  root.innerHTML = html;

  for (const el of root.querySelectorAll('input[name=loClass]')) {
    el.addEventListener('change', () => { kit.cls = el.value; onChange(); });
  }
  for (const el of root.querySelectorAll('select[data-main]')) {
    el.addEventListener('change', () => {
      const cls = el.dataset.main;
      kit.loadouts[cls] = { ...kit.loadouts[cls], main: el.value };
      onChange();
      renderLoadout(root, kit, { onChange }); // (the kit's weapons change with it)
    });
  }
  for (const el of root.querySelectorAll('select[data-up]')) {
    el.addEventListener('change', () => {
      const [cls, id] = el.dataset.up.split(':');
      const ups = { ...kit.loadouts[cls].ups };
      if (el.value) ups[id] = el.value; else delete ups[id];
      kit.loadouts[cls] = { ...kit.loadouts[cls], ups };
      onChange();
    });
  }
}

function classCard(kit, cls) {
  const c = CLASSES[cls], g = GADGETS[c.gadget];
  const lo = kit.loadouts[cls];
  let html = `<section class="lo-class" data-cls="${cls}">
    <header><h3>${c.name}</h3><label class="lo-pick"><input type="radio" name="loClass" value="${cls}"${kit.cls === cls ? ' checked' : ''}> Play as</label></header>
    <small>${c.blurb}</small>
    <p class="lo-gadget"><b>${g.name}:</b> ${g.blurb}</p>
    <label class="lo-row"><span>${c.mainLabel}</span><select data-main="${cls}">`;
  for (const m of c.mains) html += `<option value="${m.id}"${m.id === lo.main ? ' selected' : ''}>${WEAPONS[m.id].name}</option>`;
  html += '</select></label>';
  for (const { id } of kitWeapons(cls, lo.main)) {
    const ups = upgradesFor(id);
    if (!ups.length) continue;
    html += `<label class="lo-row"><span>${WEAPONS[id].name}</span><select data-up="${cls}:${id}">
      <option value="">No upgrade</option>`;
    for (const up of ups) {
      html += `<option value="${up}"${lo.ups[id] === up ? ' selected' : ''}>${UPGRADES[up].name}: ${UPGRADES[up].blurb.toLowerCase()}</option>`;
    }
    html += '</select></label>';
  }
  return `${html}</section>`;
}

/**
 * The class picker: a card for each class (press its number or click it).
 * `current` is the class you are, `next` the one you'll spawn as.
 */
export function renderPicker(root, kit, { current, next }) {
  root.innerHTML = CLASS_IDS.map((cls, i) => {
    const c = CLASSES[cls];
    const tag = cls === next && next !== current ? ' <i>next life</i>' : cls === current ? ' <i>now</i>' : '';
    return `<button type="button" class="class-card" data-cls="${cls}" aria-pressed="${cls === next}">
      <kbd>${i + 1}</kbd> <b>${c.name}</b>${tag}
      <span>${kitText(cls, kit.loadouts[cls].main)}</span>
      <small>${GADGETS[c.gadget].name} (G)</small>
    </button>`;
  }).join('');
}
