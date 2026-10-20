// The pages for classes and progression: the Loadout screen (main menu), the
// class picker (while waiting to respawn, or from the pause menu) and the XP
// summary at the end of a match. main.js shows and hides them.

import { WEAPONS } from './weapons.js';
import { CLASSES, CLASS_IDS, UPGRADES, upgradesFor, kitWeapons, kitText } from './classes.js';
import { GADGETS } from './gadgets.js';
import {
  rankOf, classRankOf, rankProgress, mainUnlocked, upgradeKills, upgradeUnlocked, nextMain, nextUpgrade, playLoadouts, RANKS,
} from './progression.js';

const num = n => Math.round(n).toLocaleString('en-GB');
const bar = frac => `<div class="lo-bar"><span style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></span></div>`;
const rankName = r => `Rank ${r.rank} · ${r.name}`;

/**
 * The Loadout screen: your rank, and for each class its rank, gadget, main
 * weapon (from those unlocked) and an upgrade for each weapon. Choices change
 * `profile` straight away; onChange() is called after each (to save it).
 */
export function renderLoadout(root, profile, { onChange }) {
  const r = rankOf(profile.xp);
  const next = r.next == null ? 'Top rank!' : `${num(r.next - profile.xp)} XP to ${RANKS[r.rank + 1]}`;
  let html = `<div class="lo-top">
    <div class="lo-rankline"><b>${rankName(r)}</b><span>${num(profile.xp)} XP</span></div>
    ${bar(rankProgress(r))}
    <small>${next} · ${profile.matches} matches, ${profile.wins} won</small>
    <p class="muted-note">Earn XP in matches with <b>Classes</b> on: kills (and headshots), objectives, helping your team with your gadget, and finishing a match (more for winning). Each class ranks up from the XP you earn playing it, unlocking other main weapons. Kills with a weapon unlock its upgrades.</p>
  </div><div class="lo-classes">`;
  for (const cls of CLASS_IDS) html += classCard(profile, cls);
  html += '</div>';
  root.innerHTML = html;

  for (const el of root.querySelectorAll('input[name=loClass]')) {
    el.addEventListener('change', () => { profile.cls = el.value; onChange(); });
  }
  for (const el of root.querySelectorAll('select[data-main]')) {
    el.addEventListener('change', () => {
      const cls = el.dataset.main;
      profile.loadouts[cls] = { ...profile.loadouts[cls], main: el.value };
      onChange();
      renderLoadout(root, profile, { onChange }); // (the kit's weapons change with it)
    });
  }
  for (const el of root.querySelectorAll('select[data-up]')) {
    el.addEventListener('change', () => {
      const [cls, id] = el.dataset.up.split(':');
      const ups = { ...profile.loadouts[cls].ups };
      if (el.value) ups[id] = el.value; else delete ups[id];
      profile.loadouts[cls] = { ...profile.loadouts[cls], ups };
      onChange();
    });
  }
}

function classCard(profile, cls) {
  const c = CLASSES[cls], g = GADGETS[c.gadget];
  const cr = classRankOf(profile.classXp[cls] || 0);
  const lo = playLoadouts(profile)[cls];
  const nm = nextMain(profile, cls);
  const nextText = nm ? `Next: ${WEAPONS[nm.id].name} at class rank ${nm.rank} (${num(nm.xpLeft)} XP to go)` : 'Every main weapon unlocked';
  let html = `<section class="lo-class" data-cls="${cls}">
    <header><h3>${c.name}</h3><label class="lo-pick"><input type="radio" name="loClass" value="${cls}"${profile.cls === cls ? ' checked' : ''}> Play as</label></header>
    <div class="lo-rankline"><span>Class rank ${cr.rank}</span><small>${num(cr.xp)} XP</small></div>
    ${bar(rankProgress(cr))}
    <small class="lo-next">${nextText}</small>
    <p class="lo-gadget"><b>${g.name}:</b> ${g.blurb}</p>
    <label class="lo-row"><span>${c.mainLabel}</span><select data-main="${cls}">`;
  for (const m of c.mains) {
    const open = mainUnlocked(profile, cls, m.id);
    html += `<option value="${m.id}"${m.id === lo.main ? ' selected' : ''}${open ? '' : ' disabled'}>${WEAPONS[m.id].name}${open ? '' : ` (class rank ${m.rank})`}</option>`;
  }
  html += '</select></label>';
  for (const { id } of kitWeapons(cls, lo.main)) {
    const ups = upgradesFor(id);
    if (!ups.length) continue;
    const kills = profile.kills[id] || 0;
    const nu = nextUpgrade(profile, id);
    html += `<label class="lo-row"><span>${WEAPONS[id].name} <small>${kills} kill${kills === 1 ? '' : 's'}</small></span><select data-up="${cls}:${id}">
      <option value="">No upgrade</option>`;
    for (const up of ups) {
      const open = upgradeUnlocked(profile, id, up);
      html += `<option value="${up}"${lo.ups[id] === up ? ' selected' : ''}${open ? '' : ' disabled'}>${UPGRADES[up].name}${open ? `: ${UPGRADES[up].blurb.toLowerCase()}` : ` (${upgradeKills(id, up)} kills)`}</option>`;
    }
    html += `</select><small class="lo-next">${nu ? `Next: ${UPGRADES[nu.up].name} at ${nu.kills} kills` : 'Every upgrade unlocked'}</small></label>`;
  }
  return `${html}</section>`;
}

/**
 * The class picker: a card for each class (press its number or click it).
 * `current` is the class you are, `next` the one you'll spawn as.
 */
export function renderPicker(root, profile, { current, next }) {
  const los = playLoadouts(profile);
  root.innerHTML = CLASS_IDS.map((cls, i) => {
    const c = CLASSES[cls], cr = classRankOf(profile.classXp[cls] || 0);
    const tag = cls === next && next !== current ? ' <i>next life</i>' : cls === current ? ' <i>now</i>' : '';
    return `<button type="button" class="class-card" data-cls="${cls}" aria-pressed="${cls === next}">
      <kbd>${i + 1}</kbd> <b>${c.name}</b>${tag}
      <span>${kitText(cls, los[cls].main)}</span>
      <small>${GADGETS[c.gadget].name} (G) · class rank ${cr.rank}</small>
    </button>`;
  }).join('');
}

/** The end of a match: XP by reason, rank (and class rank) progress, and anything newly unlocked. */
export function renderSummary(root, sum) {
  let html = `<h3>Match XP <b>+${num(sum.total)}</b></h3>`;
  if (sum.reasons.length) {
    html += '<table class="sum-xp">';
    for (const r of sum.reasons) html += `<tr><td>${r.label}${r.count > 1 ? ` ×${r.count}` : ''}</td><td>${num(r.n)}</td></tr>`;
    html += '</table>';
  } else html += '<p class="muted-note">No XP this time.</p>';
  const { before, after } = sum.rank;
  html += `<div class="sum-rank"><b>${rankName(after)}</b>${after.rank > before.rank ? ' <span class="sum-up">Rank up!</span>' : ''}
    ${bar(rankProgress(after))}<small>${after.next == null ? `${num(after.xp)} XP` : `${num(after.xp)} / ${num(after.next)} XP`}</small></div>`;
  for (const c of sum.classes) {
    html += `<div class="sum-rank"><span>${c.name} · class rank ${c.after.rank}</span>${c.after.rank > c.before.rank ? ' <span class="sum-up">Rank up!</span>' : ''}${bar(rankProgress(c.after))}</div>`;
  }
  if (sum.unlocked.length) html += `<div class="sum-unlocks"><b>Unlocked</b><ul>${sum.unlocked.map(u => `<li>${u.text}</li>`).join('')}</ul></div>`;
  root.innerHTML = html;
}
