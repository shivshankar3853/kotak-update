const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { getAccessToken, getBaseUrl } = require("./tokenManager");

const DATA_DIR = path.join(__dirname, "data");
const MASTER_SCRIPT_CACHE = path.join(DATA_DIR, "master-script.json");
const CACHE_VALIDITY_DAYS = 7;

let masterScriptCache = null;

// ======================================================
// 🔄 FETCH MASTER SCRIPT FILE PATHS
// ======================================================
async function fetchMasterScriptFilePaths() {
  try {
    const accessToken = getAccessToken();
    const baseUrl = getBaseUrl() || "https://e21.kotaksecurities.com";

    if (!accessToken) {
      throw new Error("Missing access token for master script fetch");
    }

    console.log("📥 Fetching master script file paths from:", baseUrl);

    const response = await axios.get(
      `${baseUrl}/script-details/1.0/masterscrip/file-paths`,
      {
        headers: {
          Authorization: accessToken,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    console.log("✅ Master script file paths received");
    return response.data;

  } catch (err) {
    console.error("❌ Master script fetch error:", err.message);
    throw err;
  }
}

// ======================================================
// 💾 SAVE MASTER SCRIPT CACHE
// ======================================================
function saveMasterScriptCache(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    fs.writeFileSync(
      MASTER_SCRIPT_CACHE,
      JSON.stringify({
        data,
        cached_at: Date.now()
      }, null, 2)
    );

    console.log("💾 Master script cached");
  } catch (err) {
    console.error("❌ Cache save error:", err.message);
  }
}

// ======================================================
// 📂 LOAD MASTER SCRIPT CACHE
// ======================================================
function loadMasterScriptCache() {
  try {
    if (!fs.existsSync(MASTER_SCRIPT_CACHE)) {
      return null;
    }

    const raw = fs.readFileSync(MASTER_SCRIPT_CACHE, "utf-8");
    const cached = JSON.parse(raw);

    // Check cache validity
    const ageMs = Date.now() - cached.cached_at;
    const maxAgeMs = CACHE_VALIDITY_DAYS * 24 * 60 * 60 * 1000;

    if (ageMs > maxAgeMs) {
      console.log("⏰ Master script cache expired");
      return null;
    }

    console.log("✅ Master script loaded from cache");
    return cached.data;

  } catch (err) {
    console.error("❌ Cache load error:", err.message);
    return null;
  }
}

// ======================================================
// 🔍 GET MASTER SCRIPT (with cache)
// ======================================================
async function getMasterScript(forceRefresh = false) {
  try {
    // Try cache first
    if (!forceRefresh && masterScriptCache) {
      return masterScriptCache;
    }

    // Try disk cache
    if (!forceRefresh) {
      const cached = loadMasterScriptCache();
      if (cached) {
        masterScriptCache = cached;
        return cached;
      }
    }

    // Fetch fresh
    console.log("🔄 Fetching fresh master script...");
    const data = await fetchMasterScriptFilePaths();

    // Cache it
    masterScriptCache = data;
    saveMasterScriptCache(data);

    return data;

  } catch (err) {
    console.error("❌ Master script error:", err.message);
    
    // Fallback to disk cache if available
    const diskCache = loadMasterScriptCache();
    if (diskCache) {
      console.log("⚠️ Using stale cache due to fetch error");
      masterScriptCache = diskCache;
      return diskCache;
    }

    throw err;
  }
}

// ======================================================
// 🔎 SEARCH TRADING SYMBOL
// ======================================================
async function searchSymbol(query) {
  try {
    if (!query || query.length < 2) {
      return [];
    }

    const masterScript = await getMasterScript();

    if (!masterScript || !Array.isArray(masterScript.exchanges)) {
      return [];
    }

    const searchQuery = String(query).toUpperCase().trim();
    const results = [];

    for (const exchange of masterScript.exchanges) {
      if (!exchange.instruments || !Array.isArray(exchange.instruments)) {
        continue;
      }

      for (const instrument of exchange.instruments) {
        const name = String(instrument.name || "").toUpperCase();
        const symbol = String(instrument.symbol || "").toUpperCase();

        // Match by symbol or name
        if (symbol.includes(searchQuery) || name.includes(searchQuery)) {
          results.push({
            symbol: instrument.symbol,
            name: instrument.name,
            exchange: exchange.name,
            type: instrument.type || "unknown",
            token: instrument.token
          });

          // Limit results
          if (results.length >= 20) break;
        }
      }

      if (results.length >= 20) break;
    }

    return results;

  } catch (err) {
    console.error("❌ Symbol search error:", err.message);
    return [];
  }
}

// ======================================================
// 📋 GET ALL SYMBOLS FOR EXCHANGE
// ======================================================
async function getExchangeSymbols(exchangeName = "NSE") {
  try {
    const masterScript = await getMasterScript();

    if (!masterScript || !Array.isArray(masterScript.exchanges)) {
      return [];
    }

    const exchange = masterScript.exchanges.find(
      e => String(e.name).toUpperCase() === String(exchangeName).toUpperCase()
    );

    if (!exchange || !Array.isArray(exchange.instruments)) {
      return [];
    }

    return exchange.instruments.map(inst => ({
      symbol: inst.symbol,
      name: inst.name,
      type: inst.type || "unknown",
      token: inst.token
    }));

  } catch (err) {
    console.error("❌ Exchange symbols error:", err.message);
    return [];
  }
}

module.exports = {
  getMasterScript,
  fetchMasterScriptFilePaths,
  searchSymbol,
  getExchangeSymbols,
  saveMasterScriptCache,
  loadMasterScriptCache
};
