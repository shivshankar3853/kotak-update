const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ==============================
function getYesterdayFolder() {
  const d = new Date();
  d.setDate(d.getDate() - 1);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

// ==============================
async function downloadCSV(url, retry = 1) {
  try {
    console.log("🌐 Fetching:", url);

    const res = await axios.get(url, {
      timeout: 20000,
      responseType: "text"
    });

    const data = res.data;

    if (!data || typeof data !== "string") return null;
    if (data.includes("<html")) return null;

    return data;

  } catch (err) {
    console.log("❌ Failed:", url);

    if (retry > 0) {
      return downloadCSV(url, retry - 1);
    }

    return null;
  }
}

// ==============================
// SAFE CSV PARSER (improved)
// ==============================
function parseCSV(csv) {
  const lines = csv.split("\n").filter(Boolean);
  const rows = [];

  if (lines.length < 2) return rows;

  const headers = lines[0]
    .replace(/\r/g, "")
    .split(",")
    .map(h => h.trim().toLowerCase());

  const idx = (name) => headers.indexOf(name.toLowerCase());

  const iSymbol = idx("psymbol");
  const iExchSeg = idx("pexchseg");
  const iSymbolName = idx("psymbolname");
  const iTrdSymbol = idx("ptrdsymbol");
  const iOptionType = idx("poptiontype");
  const iLotSize = idx("llotsize");

  for (let i = 1; i < lines.length; i++) {

    const cols = lines[i].split(",");

    const row = {
      pSymbol: cols[iSymbol] || "",
      pExchSeg: cols[iExchSeg] || "",
      pSymbolName: cols[iSymbolName] || "",
      pTrdSymbol: cols[iTrdSymbol] || "",
      pOptionType: cols[iOptionType] || "",
      lLotSize: cols[iLotSize] || "",
    };

    if (!row.pTrdSymbol || !row.pSymbol) continue;

    rows.push(row);
  }

  return rows;
}

// ==============================
async function syncInstruments() {
  try {
    console.log("📥 Kotak Instrument Sync Started...");

    const dateFolder = getYesterdayFolder();

    const base =
      "https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod";

    const urls = [
      `${base}/${dateFolder}/transformed/nse_fo.csv`,
      `${base}/${dateFolder}/transformed/bse_fo.csv`,
      `${base}/${dateFolder}/transformed/mcx_fo.csv`,
      `${base}/${dateFolder}/transformed/nse_com.csv`,
      `${base}/${dateFolder}/transformed-v1/nse_cm-v1.csv`,
      `${base}/${dateFolder}/transformed-v1/bse_cm-v1.csv`
    ];

    let allRows = [];
    let successCount = 0;

    for (const url of urls) {

      const csv = await downloadCSV(url);

      if (!csv) continue;

      const rows = parseCSV(csv);

      if (rows.length === 0) continue;

      console.log(`📊 Loaded ${rows.length} rows`);

      allRows.push(...rows);
      successCount++;

      await new Promise(r => setTimeout(r, 500));
    }

    if (successCount === 0) {
      throw new Error("No CSV sources loaded successfully");
    }

    if (allRows.length === 0) {
      throw new Error("No instruments parsed");
    }

    const dataDir = path.join(__dirname, "data");

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
    }

    const filePath = path.join(dataDir, "instruments.csv");

    const headers = [
      "pSymbol",
      "pExchSeg",
      "pSymbolName",
      "pTrdSymbol",
      "pOptionType",
      "lLotSize",
    ];

    const csvLines = [headers.join(",")];

    for (const row of allRows) {
      csvLines.push(
        headers.map(h => `"${row[h] || ""}"`).join(",")
      );
    }

    fs.writeFileSync(filePath, csvLines.join("\n"));

    console.log("✅ Kotak filtered instruments saved");
    console.log("📁 File:", filePath);
    console.log("📊 Total:", allRows.length);

    return { success: true };

  } catch (err) {
    console.error("❌ Sync failed:", err.message);
    return { success: false };
  }
}

// ==============================
if (require.main === module) {
  syncInstruments().then(() => process.exit(0));
}

module.exports = syncInstruments;