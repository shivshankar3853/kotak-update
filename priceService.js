const axios = require("axios");
const {
  getAccessToken,
  getSessionToken,
  getSid,
  getBaseUrl
} = require("./tokenManager");
const { findInstrument } = require("./instrumentStore");
const { getTickAsync, subscribeSymbols } = require("./wsService");

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
  if (!symbol) return symbol;
  if (symbol.includes("|")) {
    return symbol.split("|")[1];
  }
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
  let quoteSymbol = formatQuoteSymbol(symbol);
  const accessToken = getAccessToken();
  const sessionToken = getSessionToken();
  const sid = getSid();
  const baseUrl = getBaseUrl();

  let exchange = String(exchangeOverride || "").trim().toLowerCase();
  if (!exchange && key.includes("|")) {
    const [exchangePart] = key.split("|");
    exchange = exchangePart.toLowerCase();
  }

  if (!exchange) {
    const instrument = findInstrument(key);
    if (instrument?.es) {
      exchange = String(instrument.es).trim().toLowerCase();
    }
  }

  if (!exchange) {
    exchange = "nse_fo";
  }

  if (!baseUrl) {
    console.error("❌ Missing baseUrl");
    return null;
  }

  const url = buildQuoteUrl(baseUrl, exchange, quoteSymbol, filter);

  const headers = {
    "neo-fin-key": "neotradeapi",
    "Content-Type": "application/json"
  };

  if (process.env.DEBUG_LTP === "true") {
    console.log("🔎 Quote request", { url, exchange, quoteSymbol, filter, headers });
  }

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

    if (process.env.DEBUG_LTP === "true") {
      console.log("✅ Quote response", { status: res.status, data: res.data });
    }

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

  // 2️⃣ LIVE WS TICK CACHE
  try {
    const wsLtp = await getTickAsync(key);
    if (wsLtp && wsLtp > 0) {
      ltpCache.set(key, { value: wsLtp, time: Date.now() });
      return wsLtp;
    }
  } catch (_) {
    // ignore websocket cache failures
  }

  // 3️⃣ Subscribe for future live ticks
  try {
    const instrument = findInstrument(key);
    const subscriptionSymbols = [key];
    if (instrument?.ts && instrument.ts !== key) {
      subscriptionSymbols.push(instrument.ts);
    }
    await subscribeSymbols(subscriptionSymbols);
  } catch (_) {
    // ignore subscription failures
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