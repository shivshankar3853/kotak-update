// ==============================
// 🟢 TRADING CONTROL SYSTEM
// ==============================

let tradingEnabled = true;

// ==============================
// ▶️ START / STOP TRADING
// ==============================
function startTrading() {

  tradingEnabled = true;

  console.log("🟢 Trading ENABLED");
}

function stopTrading() {

  tradingEnabled = false;

  console.log("🔴 Trading DISABLED");
}

function isTradingEnabled() {

  return tradingEnabled;
}

// ==============================
// 🚫 DUPLICATE SIGNAL PROTECTION
// ==============================
const recentSignals = new Map();

const DUPLICATE_WINDOW = 45000;

const MAX_SIGNAL_CACHE = 1000;

function cleanupOldSignals() {

  const now = Date.now();

  for (const [key, timestamp] of recentSignals) {

    if (now - timestamp > DUPLICATE_WINDOW) {
      recentSignals.delete(key);
    }
  }

  // SAFETY LIMIT
  if (recentSignals.size > MAX_SIGNAL_CACHE) {

    const firstKey =
      recentSignals.keys().next().value;

    if (firstKey) {
      recentSignals.delete(firstKey);
    }
  }
}

function isDuplicate(signal) {

  // ================= VALIDATE =================
  if (
    !signal ||
    !signal.TS ||
    !signal.TT ||
    !signal.Q
  ) {
    return false;
  }

  cleanupOldSignals();

  const key =
    `${signal.TS}_${signal.TT}_${signal.Q}`;

  if (recentSignals.has(key)) {
    return true;
  }

  recentSignals.set(
    key,
    Date.now()
  );

  return false;
}

// ==============================
// ⚡ TRADE LIMIT CONTROL
// ==============================
let maxTradesPerMinute = 5;

let tradeCount = 0;

let lastReset = Date.now();

function canTrade() {

  const now = Date.now();

  // RESET EVERY MINUTE
  if (now - lastReset > 60000) {

    tradeCount = 0;

    lastReset = now;
  }

  if (tradeCount >= maxTradesPerMinute) {

    console.log(
      "🚫 Trade Limit Reached"
    );

    return false;
  }

  tradeCount++;

  return true;
}

// ==============================
// 📦 EXPORTS
// ==============================
module.exports = {
  isTradingEnabled,
  startTrading,
  stopTrading,
  isDuplicate,
  canTrade
};