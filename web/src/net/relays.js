// Which public Nostr relays the game uses, and the event kinds it sends.
// The lists come from tools/probe-relays.mjs, which tests relays from GitHub Actions.

export const KIND = {
  lobby: 21901,   // live (not stored): game announcements and "who's hosting?" questions
  signal: 21902,  // live: sealed connection offers/answers between two players
  app: 30078,     // stored and replaceable (NIP-78): game listings and community maps
};

export const TAG = {
  game: 'stick-soldiers-game-v1',
  lobby: 'stick-soldiers-lobby-v1',
  map: 'stick-soldiers-map-v1',
};

// Relays for finding games and connecting players (live events). All passed
// every check in the probe (run on GitHub Actions, November 2026), quickest to connect first.
export const RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://relay.damus.io',
  'wss://nostr.oxtr.dev',
  'wss://cdn.satellite.earth',
  'wss://nostr.chaima.info',
];

// Relays that keep community maps (stored events). (nos.lol and nostr.mom hold maps shared
// before November 2026, when they stopped passing the probe: still read, while they answer.)
export const COMMUNITY_RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr.mom',
];

/** Relays to use: `?relay=ws://...` in the page address overrides the list (for local play and tests). */
export function relaysFor(list) {
  try {
    const custom = new URLSearchParams(globalThis.location?.search || '').getAll('relay');
    if (custom.length) return custom;
  } catch { /* not in a browser */ }
  return list;
}

// Public STUN servers let two browsers find a direct route to each other.
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// A relay (TURN) server carries the game between two players whose networks won't let them
// connect directly (some office, school and mobile networks). There's none to start with: they
// cost money to run, and none is free to all. To add one, put what its provider gives you in
// web/turn.json (the README says how); the game reads it when it starts.
let extraIce = [];

/** The servers a connection is made with: the public STUN ones, and any relay servers set up. */
export const iceServers = () => [...ICE_SERVERS, ...extraIce];

/** Whether a relay (TURN) server is set up. */
export const hasRelay = () => extraIce.some(s => [].concat(s.urls).some(u => /^turns?:/i.test(u)));

/**
 * What turn.json says, checked: [{ urls, username, credential }, ...] (a list, or the list under
 * "servers" or "iceServers"). Anything that isn't a server's address is left out.
 */
export function readIceConfig(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.servers) ? json.servers : Array.isArray(json?.iceServers) ? json.iceServers : [];
  const out = [];
  for (const s of list.slice(0, 8)) {
    const urls = [].concat(s?.urls ?? s?.url ?? []).filter(u => typeof u === 'string' && /^(turns?|stun):[^\s]{3,200}$/i.test(u)).slice(0, 6);
    if (!urls.length) continue;
    const e = { urls: urls.length === 1 ? urls[0] : urls };
    if (typeof s.username === 'string') e.username = s.username.slice(0, 300);
    if (typeof s.credential === 'string') e.credential = s.credential.slice(0, 300);
    out.push(e);
  }
  return out;
}

/**
 * Read turn.json (once, as the game starts). It can also name an address that gives the list
 * ("fetch": for providers that hand out passwords that only last a while). Returns the servers
 * connections are made with from now on. `get(url)` fetches JSON (null if there's none).
 */
export async function loadIceServers(get = url => fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)), file = 'turn.json') {
  try {
    const json = await get(file);
    let list = readIceConfig(json);
    if (typeof json?.fetch === 'string' && /^https:\/\//.test(json.fetch)) {
      try { list = [...list, ...readIceConfig(await get(json.fetch))]; } catch { /* that address didn't answer: what's in the file itself */ }
    }
    extraIce = list;
  } catch { /* no file, or it isn't JSON: direct connections only */ }
  return iceServers();
}

/** Why two players couldn't connect, as well as this side can tell from what it found of its own network (peer.js). */
export function whyNoConnection(kinds, relay = hasRelay()) {
  if (kinds && !kinds.srflx && !kinds.relay) {
    return "Couldn't connect: this network blocks the direct connections the game uses (some office, school and mobile networks do). Another network should work: home wifi, or a phone's hotspot.";
  }
  if (relay) return "Couldn't connect, even through the relay server. Check the internet connection at both ends and try again.";
  return "Couldn't connect: the two networks couldn't reach each other directly. It often works the other way round (you host, they join), or from another network such as a phone's hotspot.";
}
