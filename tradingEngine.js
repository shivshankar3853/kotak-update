const express = require("express");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ===============================
// ⚠️ SYSTEM LIMITATIONS (IMPORTANT)
// ===============================
// ⚠️ Still single-instance memory system (NOT cluster-safe)
// ⚠️ Still no broker reconciliation layer (state may mismatch broker)
// ⚠️ Still assumes WS feed is always correct (no secondary validation)
// ===============================

console.warn("⚠️ SYSTEM WARNING:");
console.warn("➡️ Single-instance memory system only");
console.warn("➡️ No broker reconciliation layer");
console.warn("➡️ WS feed is assumed to be 100% accurate");

// ===============================
// PERSISTENCE FILE
// ===============================
const STATE_FILE = path.join(__dirname, "positions_state.json");

// ===============================
// POSITION STORE (IN MEMORY)
// ===============================
let positions = {};

// ===============================
// LOAD STATE ON START (RECOVERY)
// ===============================
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const data = JSON.parse(raw || "{}");
      positions = data && typeof data === "object" ? data : {};
      console.log("♻️ Positions restored:", Object.keys(positions).length);
    }
  } catch (err) {
    console.error("❌ Failed to load state:", err.message);
    positions = {};
  }
}

// ===============================
// SAVE STATE (PERSISTENCE SAFE)
// ===============================
function saveState() {
  try {
    fs.writeFile(STATE_FILE, JSON.stringify(positions, null, 2), (err) => {
      if (err) console.error("❌ Failed to save state:", err.message);
    });
  } catch (err) {
    console.error("❌ Failed to save state:", err.message);
  }
}

// ===============================
// BROKER PLACEHOLDERS
// ===============================
async function placeMarketOrder({ symbol, qty, side }) {
  console.log("📤 ORDER:", { symbol, qty, side });

  const price = await getLTP(symbol);

  return {
    avgPrice: price,
    status: "SUCCESS"
  };
}

// fallback ONLY for testing
async function getLTP(symbol) {
  if (!symbol) return 0;
  return 100 + Math.random() * 10;
}

// ===============================
// STOP LOSS CONFIG
// ===============================
const STOP_LOSS_POINTS = 5;

// ===============================
// WEBSOCKET
// ===============================
const ws = new WebSocket("wss://YOUR_BROKER_LTP_SOCKET");

ws.on("open", () => {
  console.log("🟢 WebSocket Connected");

  ws.send(JSON.stringify({
    type: "subscribe",
    symbols: ["ALL"]
  }));
});

ws.on("message", async (data) => {
  try {

    const tick = JSON.parse(data || "{}");

    const symbol = tick.symbol;
    const ltp = Number(tick.ltp);

    if (!symbol || !ltp) return;

    const pos = positions[symbol];
    if (!pos) return;

    console.log(`⚡ WS ${symbol} LTP=${ltp} Target=${pos.target} SL=${pos.sl}`);

    let hitTarget = false;
    let hitSL = false;

    // ===============================
    // TARGET CHECK
    // ===============================
    if (pos.side === "BUY" && ltp >= pos.target) hitTarget = true;
    if (pos.side === "SELL" && ltp <= pos.target) hitTarget = true;

    // ===============================
    // STOP LOSS CHECK
    // ===============================
    if (pos.side === "BUY" && ltp <= pos.sl) hitSL = true;
    if (pos.side === "SELL" && ltp >= pos.sl) hitSL = true;

    if (!hitTarget && !hitSL) return;

    if (pos._closing) return;
    pos._closing = true;

    console.log(hitTarget ? "🎯 TARGET HIT" : "🛑 STOP LOSS HIT", symbol);

    const order = await placeMarketOrder({
      symbol,
      qty: pos.qty,
      side: pos.side === "BUY" ? "SELL" : "BUY"
    });

    if (!order || order.status !== "SUCCESS") {
      pos._closing = false;
      return;
    }

    console.log("📉 CLOSED:", {
      symbol,
      entry: pos.entryPrice,
      exit: order.avgPrice
    });

    delete positions[symbol];
    saveState();

  } catch (err) {
    console.error("WS error:", err.message);
  }
});

// ===============================
// SAFE RECONNECT
// ===============================
ws.on("close", () => {
  console.log("🔴 WS disconnected. Restarting safely...");
  setTimeout(() => {
    process.exit(1);
  }, 3000);
});

// ===============================
// WEBHOOK (ENTRY)
// ===============================
app.post("/webhook", async (req, res) => {

  try {

    const { action, symbol, qty, target_points, sl_points } = req.body;

    if (!symbol || !qty || !action) {
      return res.status(400).send({ status: "invalid request" });
    }

    if (positions[symbol]) {
      return res.send({ status: "already open" });
    }

    const order = await placeMarketOrder({
      symbol,
      qty,
      side: action
    });

    if (!order || !order.avgPrice) {
      return res.status(500).send({ status: "order failed" });
    }

    const entryPrice = Number(order.avgPrice);

    const target =
      action === "BUY"
        ? entryPrice + Number(target_points || 0)
        : entryPrice - Number(target_points || 0);

    const sl =
      action === "BUY"
        ? entryPrice - Number(sl_points || STOP_LOSS_POINTS)
        : entryPrice + Number(sl_points || STOP_LOSS_POINTS);

    positions[symbol] = {
      entryPrice,
      qty,
      target,
      sl,
      side: action,
      _closing: false
    };

    saveState();

    console.log("📌 POSITION OPENED:", positions[symbol]);

    res.send({ status: "ok", entryPrice, target, sl });

  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).send({ status: "error" });
  }
});

// ===============================
// START SERVER + RECOVERY
// ===============================
loadState();

app.listen(3000, () => {
  console.log("🚀 Bot running on port 3000");
});