const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "trade_logs.json");

// ==============================
// SAFE SERIALIZER
// ==============================
function safeStringify(data) {
  try {
    return JSON.stringify({
      time: new Date().toISOString(),
      ...data
    });
  } catch (err) {
    return JSON.stringify({
      time: new Date().toISOString(),
      error: "log serialization failed"
    });
  }
}

// ==============================
// 🚀 NON-BLOCKING LOG WRITER (IMPROVED)
// ==============================
function logTrade(data) {
  try {

    const line = safeStringify(data) + "\n";

    fs.appendFile(LOG_FILE, line, (err) => {
      if (err) {
        console.error("❌ Trade log write failed:", err.message);
      }
    });

  } catch (err) {
    console.error("❌ Trade log error:", err.message);
  }
}

// ==============================
// 📂 DAILY LOG ROTATION
// ==============================
function getLogFileByDate() {
  const date = new Date().toISOString().split("T")[0];
  return path.join(__dirname, `trade_logs_${date}.json`);
}

// ==============================
// DAILY LOGGER (IMPROVED)
// ==============================
function logTradeDaily(data) {
  try {

    const file = getLogFileByDate();

    const line = safeStringify(data) + "\n";

    fs.appendFile(file, line, (err) => {
      if (err) {
        console.error("❌ Daily log error:", err.message);
      }
    });

  } catch (err) {
    console.error("❌ Logging error:", err.message);
  }
}

module.exports = {
  logTrade,
  logTradeDaily
};