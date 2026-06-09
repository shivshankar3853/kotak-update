const axios = require("axios");
const { getAccessToken, getBaseUrl } = require("./tokenManager");
const { findInstrument } = require("./instrumentStore");

// ================= GLOBAL STATE =================
let lastCallTime = 0;
let postTradeLockUntil = 0;

// ================= CONFIG =================
const MIN_GAP_MS = 1500;
const POST_TRADE_COOLDOWN = 4000;

// ================= CACHE =================
const ltpCache = new Map();
const CACHE_MS = 1200;

// ================= HELPERS =================
function normalize(symbol) {
  return (symbol || "").toString().trim().toUpperCase();
}

// ================= POST TRADE CONTROL =================
function setPostTradeCooldown() {
  postTradeLockUntil = Date.now() + POST_TRADE_COOLDOWN;
}

// ================= SAFE THROTTLE =================
async function safeLTPCall(fn) {
  const now = Date.now();

  if (now < postTradeLockUntil) {
    await new Promise(r =>
      setTimeout(r, postTradeLockUntil - now)
    );
  }

  const diff = now - lastCallTime;
  if (diff < MIN_GAP_MS) {
    await new Promise(r =>
      setTimeout(r, MIN_GAP_MS - diff)
    );
  }

  lastCallTime = Date.now();
  return fn();
}

// ================= GET LTP =================
async function getLTP(symbol, exchangeOverride, retry = 1) {
  if (!symbol) return 0;

  const key = normalize(symbol);
  const now = Date.now();

  // 1️⃣ CACHE CHECK
  const cached = ltpCache.get(key);
  if (cached && now - cached.time < CACHE_MS) {
    return cached.value;
  }

  // 2️⃣ SAFE API CALL
  const value = await safeLTPCall(async () => {
    try {
      const token = getAccessToken();
      const baseUrl = getBaseUrl();

      if (!token || !baseUrl) {
        console.error("❌ Missing token/baseUrl");
        return 0;
      }

      let exchange = String(exchangeOverride || "").trim().toLowerCase();

      if (!exchange) {
        const instrument = findInstrument(key);
        if (instrument?.es) {
          exchange = String(instrument.es).trim().toLowerCase();
        }
      }

      if (!exchange) {
        exchange = "nse_fo";
      }

      const formatted = `${exchange}|${key}`;

      const res = await axios.get(
        `${baseUrl}/script-details/1.0/quotes/neosymbol/${formatted}/all`,
        {
          headers: { Authorization: token },
          timeout: 8000
        }
      );

      const raw =
        res?.data?.data?.lastPrice ??
        res?.data?.data?.ltp ??
        0;

      const parsed = Number(raw);
      return isNaN(parsed) ? 0 : parsed;

    } catch (err) {
      const msg = err.response?.data || err.message;

      if (typeof msg === "string" && msg.includes("too many")) {
        console.error("🚨 LTP THROTTLED BY KOTAK");
      } else {
        console.error("❌ LTP Error:", msg);
      }

      // optional retry for network failure only
      if (retry > 0) {
        return getLTP(symbol, exchangeOverride, retry - 1);
      }

      return 0;
    }
  });

  // 3️⃣ CACHE STORE (only valid values)
  ltpCache.set(key, {
    value,
    time: Date.now()
  });

  return value;
}

module.exports = {
  getLTP,
  setPostTradeCooldown
};