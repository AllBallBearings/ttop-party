import { StickmanShowdownClient } from './stickmanShowdownClient.js';
import { PixelHoopsClient } from './pixelHoopsClient.js';

const CLIENT_GAMES = {
  'stickman-showdown': StickmanShowdownClient,
  'pixel-hoops': PixelHoopsClient,
};

export function createClientGame(gameId, boardRoot, config, selfPlayerId) {
  const GameClass = CLIENT_GAMES[gameId];
  if (!GameClass) return null;
  return new GameClass(boardRoot, config, selfPlayerId);
}
