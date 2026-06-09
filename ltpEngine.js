const axios = require("axios");

const {
  getAccessToken,
  getBaseUrl
} = require("./tokenManager");
const { findInstrument } = require("./instrumentStore");

const cache = new Map();

const queue = [];

let running = false;

const CACHE_MS = 1000;
const DELAY = 120;

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

      let exchange = "nse_fo";
      let symbolKey = symbol;

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

      cache.set(symbol, {
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

function getLTP(symbol) {

  return new Promise((resolve) => {

    try {

      if (!symbol) {
        return resolve(0);
      }

      const now = Date.now();

      const cached = cache.get(symbol);

      if (cached && now - cached.time < CACHE_MS) {
        return resolve(cached.value);
      }

      queue.push({ symbol, resolve });

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