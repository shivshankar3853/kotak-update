const axios = require("axios");

const {
  getAccessToken,
  getBaseUrl
} = require("./tokenManager");
const { findInstrument } = require("./instrumentStore");
const { getTickAsync, subscribeSymbols } = require("./wsService");

const cache = new Map();

const queue = [];

let running = false;

const CACHE_MS = 1000;
const DELAY = 120;

function normalize(symbol) {
  return (symbol || "").toString().trim().toUpperCase();
}

async function processQueue() {

  if (running) return;

  running = true;

  while (queue.length > 0) {

    const { symbol, resolve } = queue.shift();

    try {

      const token = getAccessToken();
      const baseUrl = getBaseUrl();

      if (!token || !baseUrl) {
        console.log("⚠️ Missing access token or baseUrl");
        resolve(0);
        continue;
      }

      const normalizedSymbol = normalize(symbol);
      // default to cash market (nse_cm). options/futures will switch to nse_fo below.
      let exchange = "nse_cm";
      let symbolKey = normalizedSymbol;

      try {
        const instrument = findInstrument(symbol);
        if (instrument?.es) {
          exchange = String(instrument.es).trim().toLowerCase();
        }
        if (instrument?.ts) {
          symbolKey = instrument.ts;
        }
      } catch (_) {
        // fallback to raw symbol
      }

      // If no instrument mapping and the symbol looks like an option/future,
      // prefer the FO segment to avoid calling the wrong API endpoint.
      try {
        if ((exchange === "nse_cm" || !exchange) && /(?:CE|PE|FUT)$/.test(normalizedSymbol)) {
          exchange = "nse_fo";
        }
      } catch (_) {}

      const formatted = `${exchange}|${symbolKey}`;

      const res = await axios.get(
        `${baseUrl}/script-details/1.0/quotes/neosymbol/${formatted}/all`,
        {
          headers: {
            Authorization: token
          },
          timeout: 8000
        }
      );

      const ltp = Number(
        res.data?.data?.lastPrice ||
        res.data?.data?.ltp ||
        0
      );

      cache.set(normalizedSymbol, {
        value: ltp,
        time: Date.now()
      });

      resolve(ltp);

    } catch (err) {

      console.log("❌ LTP Error:", err.message);

      resolve(0);

    }

    await new Promise(r => setTimeout(r, DELAY));
  }

  running = false;
}

async function getLTP(symbol) {
  if (!symbol) return 0;

  const normalizedSymbol = normalize(symbol);
  const now = Date.now();

  const cached = cache.get(normalizedSymbol);
  if (cached && now - cached.time < CACHE_MS) {
    return cached.value;
  }

  try {
    const wsLtp = await getTickAsync(normalizedSymbol);
    if (wsLtp && wsLtp > 0) {
      cache.set(normalizedSymbol, { value: wsLtp, time: Date.now() });
      return wsLtp;
    }
  } catch (_) {
    // ignore websocket cache failures
  }

  try {
    const instrument = findInstrument(normalizedSymbol);
    const subscriptionSymbols = [normalizedSymbol];
    if (instrument?.ts && instrument.ts !== normalizedSymbol) {
      subscriptionSymbols.push(instrument.ts);
    }
    await subscribeSymbols(subscriptionSymbols);
  } catch (_) {
    // ignore subscription failures
  }

  return new Promise((resolve) => {

    try {

      if (!symbol) {
        return resolve(0);
      }

      const normalizedSymbol = normalize(symbol);
      const now = Date.now();

      const cached = cache.get(normalizedSymbol);

      if (cached && now - cached.time < CACHE_MS) {
        return resolve(cached.value);
      }

      queue.push({ symbol: normalizedSymbol, resolve });

      processQueue();

    } catch (err) {

      console.log("❌ getLTP Error:", err.message);

      resolve(0);
    }
  });
}

module.exports = {
  getLTP
};