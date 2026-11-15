import { StickmanShowdownClient } from './stickmanShowdownClient.js';

const CLIENT_GAMES = {
  'stickman-showdown': StickmanShowdownClient,
};

export function createClientGame(gameId, boardRoot, config, selfPlayerId) {
  const GameClass = CLIENT_GAMES[gameId];
  if (!GameClass) return null;
  return new GameClass(boardRoot, config, selfPlayerId);
}
