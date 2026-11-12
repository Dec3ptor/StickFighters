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
