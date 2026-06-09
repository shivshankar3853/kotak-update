const axios = require("axios");
const {
  getAccessToken,
  getSessionToken,
  getSid,
  getBaseUrl
} = require("./tokenManager");
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

function formatQuoteSymbol(rawSymbol) {
  const symbol = (rawSymbol || "").toString().trim();
  return symbol;
}

function buildQuoteUrl(baseUrl, exchange, symbol, filter = "all") {
  const cleanExchange = String(exchange || "nse_fo").trim().toLowerCase();
  const quoteSymbol = formatQuoteSymbol(symbol);
  const encoded = encodeURIComponent(`${cleanExchange}|${quoteSymbol}`);

  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/$/, "") + `/script-details/1.0/quotes/neosymbol/${encoded}/${filter}`;
  return url.toString();
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

// ================= QUOTES API =================
async function getQuote(symbol, exchangeOverride, filter = "all", retry = 1) {
  if (!symbol) return null;

  const key = normalize(symbol);
  const quoteSymbol = formatQuoteSymbol(symbol);
  const accessToken = getAccessToken();
  const sessionToken = getSessionToken();
  const sid = getSid();
  const baseUrl = getBaseUrl();

  if (!baseUrl) {
    console.error("❌ Missing baseUrl");
    return null;
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

  const url = buildQuoteUrl(baseUrl, exchange, quoteSymbol, filter);

  const headers = {
    "neo-fin-key": "neotradeapi",
    "Content-Type": "application/json"
  };

  if (sessionToken && sid) {
    headers.Auth = sessionToken;
    headers.Sid = sid;
  }

  if (accessToken) {
    headers.Authorization = accessToken;
  }

  try {
    const res = await axios.get(url, {
      headers,
      timeout: 8000
    });

    return res?.data ?? null;
  } catch (err) {
    const msg = err.response?.data || err.message;

    if (typeof msg === "string" && msg.includes("too many")) {
      console.error("🚨 Quotes THROTTLED BY KOTAK");
    } else {
      console.error("❌ Quote Error:", msg);
    }

    if (retry > 0) {
      return getQuote(symbol, exchangeOverride, filter, retry - 1);
    }

    return null;
  }
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

  const data = await getQuote(symbol, exchangeOverride, "ltp", retry);
  let raw = 0;

  if (Array.isArray(data) && data.length > 0) {
    raw = data[0]?.ltp ?? data[0]?.lastPrice ?? 0;
  } else if (data && typeof data === "object") {
    raw = data?.ltp ?? data?.lastPrice ?? 0;
  }

  const parsed = Number(raw);
  const value = isNaN(parsed) ? 0 : parsed;

  ltpCache.set(key, {
    value,
    time: Date.now()
  });

  return value;
}

module.exports = {
  getLTP,
  getQuote,
  setPostTradeCooldown
};