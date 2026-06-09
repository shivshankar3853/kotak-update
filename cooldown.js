const cooldownMap = new Map();

function isCooldown(symbol, ms = 30000) {

  if (!symbol) return false;

  const now = Date.now();

  if (
    cooldownMap.has(symbol) &&
    now - cooldownMap.get(symbol) < ms
  ) {
    return true;
  }

  cooldownMap.set(symbol, now);

  return false;
}

setInterval(() => {

  const now = Date.now();

  for (const [symbol, time] of cooldownMap) {

    if (now - time > 60000) {
      cooldownMap.delete(symbol);
    }
  }

}, 60000);

module.exports = {
  isCooldown
};