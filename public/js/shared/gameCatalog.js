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
    tagline: '8-bit NES 1-on-1 half-court hoops. First to 11, winner stays on!',
    minPlayers: 1,
    maxPlayers: 8,
    status: 'playable',
    controlsHint: 'Offense: JUKE (crossover/spin) • hold SHOOT (pull away to fadeaway, drive close to dunk) • Defense: BLOCK • STEAL',
  },
  {
    id: 'panda-ramen',
    name: 'Panda Ramen Rumble',
    tagline: 'Turn-based 4v4 panda artillery! Nab rival ramen bowls & send chubby pandas rolling home to nap.',
    minPlayers: 1,
    maxPlayers: 8,
    status: 'playable',
    controlsHint: 'D-Pad: ◀▶ direction, ▲▼ distance • NEXT swaps panda • Pick weapon & ARC on wheel • Tap FIRE!',
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
