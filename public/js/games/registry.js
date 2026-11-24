import { StickmanShowdownClient } from './stickmanShowdownClient.js';
import { PixelHoopsClient } from './pixelHoopsClient.js';
import { PandaRamenClient } from './pandaRamenClient.js';

const CLIENT_GAMES = {
  'stickman-showdown': StickmanShowdownClient,
  'pixel-hoops': PixelHoopsClient,
  'panda-ramen': PandaRamenClient,
};

export function createClientGame(gameId, boardRoot, config, selfPlayerId, context) {
  const GameClass = CLIENT_GAMES[gameId];
  if (!GameClass) return null;
  return new GameClass(boardRoot, config, selfPlayerId, context);
}
