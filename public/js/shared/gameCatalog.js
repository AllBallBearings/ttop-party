export const GAME_CATALOG = [
  {
    id: 'stickman-showdown',
    name: 'Stickman Showdown',
    tagline: 'Drop in, grab your gun, last stickman standing wins!',
    minPlayers: 1,
    maxPlayers: 8,
    status: 'playable',
    controlsHint: 'RC Stick: Up=Forward, Down=Back, L/R=Turn • Jump • Shoot',
  },
  {
    id: 'sumo-bumper',
    name: 'Tabletop Sumo',
    tagline: 'Knock rival stickmen off the AR platform edge.',
    minPlayers: 2,
    maxPlayers: 8,
    status: 'coming_soon',
  },
  {
    id: 'king-of-qr',
    name: 'King of the QR',
    tagline: 'Hold the center beacon while dodging blasts.',
    minPlayers: 2,
    maxPlayers: 8,
    status: 'coming_soon',
  },
];

export function getGameDefinition(gameId) {
  return GAME_CATALOG.find((g) => g.id === gameId) || null;
}
