export const GAME_CATALOG = [
  {
    id: 'stickman-showdown',
    name: 'Stickman Showdown',
    tagline: 'Drop in, grab your gun, last stickman standing wins!',
    minPlayers: 1,
    maxPlayers: 8,
    status: 'playable',
    controlsHint: 'Stick moves relative to you: Up=Away, Down=Toward you • Jump • Shoot',
  },
  {
    id: 'pixel-hoops',
    name: 'Pixel Hoops 1-on-1',
    tagline: 'Half-court streetball on your table. First to 11, winner stays on!',
    minPlayers: 1,
    maxPlayers: 8,
    status: 'playable',
    controlsHint: 'JUKE: still = pump fake, cut sideways = crossover, drive = spin • SHOOT: pull back = fadeaway, slide in close = hook, at the rim = layup/dunk • Defense: BLOCK • STEAL',
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
