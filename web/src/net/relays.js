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

// Relays for finding games and connecting players (live events).
export const RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://offchain.pub',
];

// Relays that keep community maps (stored events).
export const COMMUNITY_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nostr.mom',
];

// Public STUN servers let two browsers find a direct route to each other.
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
