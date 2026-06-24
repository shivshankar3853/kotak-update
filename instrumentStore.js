const fs = require("fs");

const path = require("path");

const syncInstruments =
  require("./syncInstruments");

// ==============================
const DATA_DIR = path.join(
  __dirname,
  "data"
);

const FILE_PATH = path.join(
  DATA_DIR,
  "instruments.csv"
);

const DEBUG =
  process.env.DEBUG === "true";

const CSV_REFRESH_DAYS = 7;

const MIN_FLEX_SEARCH_LENGTH = 3;

let instrumentCache = null;

// ==============================
// 🔤 NORMALIZE
// ==============================
function normalize(str) {

  if (!str) {
    return "";
  }

  return String(str)
    .replace(/"/g, "")
    .replace(/\s+/g, "")
    .replace(/\r/g, "")
    .trim()
    .toUpperCase();
}

// ==============================
// 📦 SAFE CSV PARSER
// ==============================
function parseCSVLine(line) {

  try {

    if (!line) {
      return [];
    }

    const cols = line.match(
      /(".*?"|[^",]+)(?=\s*,|\s*$)/g
    );

    if (!cols) {
      return [];
    }

    return cols.map((col) =>
      col
        .replace(/"/g, "")
        .replace(/\r/g, "")
        .trim()
    );

  } catch (err) {

    if (DEBUG) {
      console.log(
        "❌ CSV Parse Error:",
        err.message
      );
    }

    return [];
  }
}

// ==============================
// 📁 ENSURE LOCAL FILE
// ==============================
async function ensureLocalFile() {

  try {

    // ==============================
    // CREATE DATA DIR
    // ==============================
    if (!fs.existsSync(DATA_DIR)) {

      fs.mkdirSync(
        DATA_DIR,
        { recursive: true }
      );

      console.log(
        "📁 Created data directory"
      );
    }

    // ==============================
    // CHECK FILE AGE
    // ==============================
    if (fs.existsSync(FILE_PATH)) {

      const stats =
        fs.statSync(FILE_PATH);

      const mtime =
        new Date(stats.mtime);

      const now =
        new Date();

      const diffDays =
        (now - mtime) /
        (1000 * 60 * 60 * 24);

      if (
        diffDays < CSV_REFRESH_DAYS
      ) {

        console.log(
          "📁 Instrument CSV already exists (Updated < 7 days ago)"
        );

        return true;
      }

      console.log(
        `⚠️ CSV older than ${Math.floor(diffDays)} days → refreshing`
      );

    } else {

      console.log(
        "⚠️ CSV not found → syncing..."
      );
    }

    // ==============================
    // SYNC FILE
    // ==============================
    const result =
      await syncInstruments();

    // CLEAR CACHE AFTER SYNC
    instrumentCache = null;

    return !!(
      result &&
      result.success
    );

  } catch (err) {

    console.log(
      "❌ ensureLocalFile:",
      err.message
    );

    return false;
  }
}

// ==============================
// 📦 LOAD CACHE
// ==============================
function loadInstrumentCache() {

  // ==============================
  // RETURN EXISTING CACHE
  // ==============================
  if (
  instrumentCache &&
  instrumentCache.size > 0
) {
  return instrumentCache;
}
  instrumentCache = new Map();

  try {

    // ==============================
    // FILE EXISTS
    // ==============================
    if (!fs.existsSync(FILE_PATH)) {

      console.log(
        "❌ instruments.csv not found"
      );

      return instrumentCache;
    }

    // ==============================
    // READ FILE
    // ==============================
    const data =
      fs.readFileSync(
        FILE_PATH,
        "utf-8"
      );

    const lines = data
      .split("\n")
      .filter(
        (line) =>
          line &&
          line.trim()
      );

    // ==============================
    // EMPTY FILE
    // ==============================
    if (lines.length < 2) {

      console.log(
        "❌ Empty instrument file"
      );

      return instrumentCache;
    }

    // ==============================
    // READ HEADERS
    // ==============================
    const headers =
      parseCSVLine(lines[0]);

    const idx = (name) =>
      headers.findIndex(
        (h) =>
          normalize(h) ===
          normalize(name)
      );

    const iSymbol =
      idx("pSymbol");

    const iSymbolName =
      idx("pSymbolName");

    const iTrdSymbol =
      idx("pTrdSymbol");

    const iExchSeg =
      idx("pExchSeg");

    const iLotSize =
      idx("lLotSize");

    // ==============================
    // VALIDATE HEADERS
    // ==============================
    if (
      iSymbol === -1 ||
      iSymbolName === -1 ||
      iTrdSymbol === -1 ||
      iExchSeg === -1 ||
      iLotSize === -1
    ) {

      throw new Error(
        "Invalid CSV headers"
      );
    }

    // ==============================
    // LOAD CACHE
    // ==============================
    for (
      let i = 1;
      i < lines.length;
      i++
    ) {

      const line =
        lines[i].trim();

      if (!line) {
        continue;
      }

      const cols =
        parseCSVLine(line);

      if (
        !cols ||
        cols.length === 0
      ) {
        continue;
      }

      const tradingSymbol =
        cols[iTrdSymbol] || "";

      const exchSeg =
        cols[iExchSeg] || "";

      const lotSize =
        cols[iLotSize] || "";
        
      if (!tradingSymbol) {
        continue;
      }

      const normalized =
        normalize(tradingSymbol);

      // ==============================
      // SKIP INVALID
      // ==============================
      if (!normalized) {
        continue;
      }

      instrumentCache.set(
        normalized,
        {
          token:
            cols[iSymbol] || "",

          name:
            cols[iSymbolName] || "",

          ts:
            tradingSymbol,

          es:
            exchSeg || "",

          ls:
            lotSize || ""
        }
      );
    }

    console.log(
      "✅ Instrument cache loaded:",
      instrumentCache.size
    );

  } catch (err) {

    instrumentCache = new Map();

    console.log(
      "❌ Cache load error:",
      err.message
    );
  }

  return instrumentCache;
}

// ==============================
// 🔥 FINAL MATCH
// ==============================
function findInstrument(symbol) {

  // ==============================
  // VALIDATE INPUT
  // ==============================
  if (!symbol) {

    console.log(
      "⚠️ Empty symbol"
    );

    return null;
  }

  const cache =
    loadInstrumentCache();

  const normalizedInput =
    normalize(symbol);

  if (!normalizedInput) {
    return null;
  }

  // ==============================
  // EXACT MATCH
  // ==============================
  if (
    cache.has(normalizedInput)
  ) {

    const result =
      cache.get(normalizedInput);

    if (DEBUG) {
      console.log(
        "🎯 EXACT FOUND:",
        result.ts
      );
    }

    return result;
  }

  // ==============================
  // PREVENT HEAVY FLEX SEARCH
  // ==============================
  if (
    normalizedInput.length <
    MIN_FLEX_SEARCH_LENGTH
  ) {

    if (DEBUG) {
      console.log(
        "⚠️ Symbol too short for flex search"
      );
    }

    return null;
  }

  // ==============================
  // 🔥 FUZZY MATCH FOR FUTURES (BEFORE FLEXIBLE)
  // ==============================
  // Match futures without day number
  // e.g., GOLDPETAL26JULFUT → GOLDPETAL31JUL26FUT
  try {
    const futuresMatch = normalizedInput.match(/^([A-Z]+?)(\d{2})([A-Z]{3})FUT$/);
    
    if (futuresMatch) {
      const [, symbol_name, year_short, month] = futuresMatch;
      
      if (DEBUG) {
        console.log(`🔍 Fuzzy futures search: ${symbol_name} ${month} ${year_short}`);
      }
      
      // Search for matching futures with same symbol, month, and year
      for (const [key, value] of cache.entries()) {
        if (key.includes("FUT") && key.startsWith(symbol_name)) {
          // Extract month and year from database entry
          const dbMatch = key.match(/([A-Z]{3})(\d{2})FUT/);
          if (dbMatch && dbMatch[1] === month && dbMatch[2] === year_short) {
            if (DEBUG) {
              console.log(`✅ FUZZY FUTURES FOUND: ${value.ts}`);
            }
            return value;
          }
        }
      }
    }
  } catch (err) {
    if (DEBUG) {
      console.log("⚠️ Fuzzy match error:", err.message);
    }
  }

  // ==============================
  // FLEXIBLE MATCH
  // ==============================
  for (
    const [key, value]
    of cache.entries()
  ) {

    if (
      key.includes(
        normalizedInput
      ) ||
      normalizedInput.includes(
        key
      )
    ) {

      if (DEBUG) {
        console.log(
          "🎯 FLEX FOUND:",
          value.ts
        );
      }

      return value;
    }
  }

  if (DEBUG) {
    console.log(
      "⚠️ NOT FOUND:",
      normalizedInput
    );
  }

  return null;
}

// ==============================
module.exports = {
  ensureLocalFile,
  loadInstrumentCache,
  findInstrument
};