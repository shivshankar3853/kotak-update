const { placeOrder } = require("./orderService");
const { isTradingEnabled, canTrade } = require("./control");
const { validateSignal } = require("./validator");
const { decodeSymbol } = require("./symbolDecoder");

// ==============================
// 🚫 DUPLICATE SIGNAL PROTECTION (SAFE + LEAK FREE)
// ==============================
const recentSignals = new Map();

// periodic cleanup (prevents memory leak)
setInterval(() => {
  const now = Date.now();
  for (const [key, time] of recentSignals.entries()) {
    if (now - time > 10000) recentSignals.delete(key);
  }
}, 5000);

function isDuplicate(signal) {
  if (!signal) return true;

  const key = `${signal.TS || ""}_${signal.TT || ""}_${signal.Q || ""}`;

  if (recentSignals.has(key)) return true;

  recentSignals.set(key, Date.now());
  return false;
}

// ==============================
// 🔁 NORMALIZE SIGNAL FORMAT
// ==============================
// 🔁 NORMALIZE SIGNAL FORMAT
// ==============================
function normalizeSignal(signal) {
  try {
    if (!signal || typeof signal !== "object") return null;

    // Extract and convert quantity to number
    const qty = signal.Q || signal.quantity || signal.qty || signal.QTY || signal.amount;
    const parsedQty = Number(qty);

    // Extract transaction type and normalize to uppercase
    const tt = signal.TT ||
               signal.tt ||
               signal.transaction_type ||
               signal.transactionType ||
               signal.action ||
               "";

    return {
      TS: formatSymbol(
        signal.TS ||
        signal.symbol ||
        signal.ticker ||
        signal.s ||
        signal.instrument
      ),
      TT: String(tt).trim().toUpperCase(),
      Q: !isNaN(parsedQty) ? parsedQty : qty,
      P: signal.P || signal.product || signal.product_type || "NRML",
      VL: signal.VL || signal.validity || signal.time_in_force || "DAY",
      OT:
        signal.OT ||
        signal.order_type ||
        signal.orderType ||
        signal.type ||
        "MARKET",
      AMO:
        signal.AMO ||
        signal.amo ||
        signal.after_market ||
        signal.afterMarket ||
        signal.am ||
        signal.AT ||
        signal.at,
      PRICE:
        signal.PRICE ||
        signal.price ||
        signal.limit_price ||
        signal.price_inr ||
        0,
      TGT:
        signal.TGT ||
        signal.TP ||
        signal.tp ||
        signal.target ||
        signal.targetPrice ||
        signal.target_point ||
        signal.target_points ||
        signal.target_price ||
        signal.TARGET ||
        0,
      SLP:
        signal.SLP ||
        signal.slp ||
        signal.stop_loss ||
        signal.stopLoss ||
        signal.sl ||
        signal.stop_loss_points ||
        0
    };
  } catch (err) {
    console.log("❌ Normalize error:", err.message);
    return null;
  }
}

// ==============================
// 🔁 CONVERT INTERNAL → ORDER FORMAT
// ==============================
function convertTV(signal) {
  try {
    if (!signal) return null;

    const qty = Number(signal.Q);
    if (!Number.isFinite(qty) || qty <= 0) return null;

    // 🔄 Try to decode symbol using symbolDecoder
    let finalSymbol = signal.TS;
    try {
      const decoded = decodeSymbol(signal.TS);
      finalSymbol = decoded.kotakSymbol; // Use Kotak format for API
      console.log(`✅ Symbol decoded: ${signal.TS} → ${finalSymbol}`);
    } catch (decodeErr) {
      // If decoding fails, use original symbol (might be equity or already correct)
      console.log(`⚠️ Symbol decode failed (might be equity): ${signal.TS}`);
    }

    return {
      TS: finalSymbol,
      quantity: qty,
      product: signal.P || "NRML",
      validity: signal.VL || "DAY",
      price: Number(signal.PRICE || 0),
      order_type: signal.OT || "MARKET",
      transaction_type: signal.TT,
      targetPrice: Number(signal.TGT || 0),
      stopLossPoint: Number(signal.SLP || 0),
      disclosed_quantity: 0
    };
  } catch (err) {
    console.log("❌ Conversion error:", err.message);
    return null;
  }
}

// ==============================
// 📡 WEBHOOK HANDLER
// ==============================
async function handleWebhook(req, res) {
  try {
    const body = req.body;

    console.log("📡 Signal Received:", JSON.stringify(body));

    if (global.io?.emit) {
      global.io.emit("signal", body);
    }

    if (!isTradingEnabled()) {
      return res.send("⛔ Trading Disabled");
    }

    const signals = Array.isArray(body) ? body : [body];

    const errors = [];
    let processedAny = false;

    for (const rawSignal of signals) {
      try {
        const normalizedSignal = normalizeSignal(rawSignal);

        if (!normalizedSignal) {
          errors.push("Invalid payload format");
          continue;
        }

        const result = validateSignal(normalizedSignal);

        if (!result.ok) {
          console.log("❌ Invalid signal:", result.error);
          errors.push(result.error);
          continue;
        }

        const validSignal = result.data;

        if (isDuplicate(validSignal)) {
          console.log("⚠️ Duplicate ignored:", validSignal.TS);
          continue;
        }

        if (!canTrade()) {
          console.log("⛔ Trade limit reached");
          continue;
        }

        const order = convertTV(validSignal);
        if (!order) {
          errors.push("Order conversion failed");
          continue;
        }

        console.log("📤 Final Order:", order);

        const resultOrder = await placeOrder(order);

        console.log("✅ Order Success:", resultOrder);
        processedAny = true;
      } catch (err) {
        console.error("❌ Order Failed:", err.message);
        errors.push(err.message);
      }
    }

    if (!processedAny && errors.length > 0) {
      return res.status(400).json({ status: "invalid signal", errors });
    }

    return res.send("✅ Signal processed");
  } catch (err) {
    console.error("❌ Webhook Error:", err.message);
    return res.status(500).send("Error");
  }
}

// ==============================
// SYMBOL FORMATTER (SAFE)
// ==============================
function formatSymbol(ts) {
  try {
    if (!ts) return ts;

    let symbol = String(ts).trim().toUpperCase();

    // normalize common spaced formats by removing separators
    if (/\s/.test(symbol)) {
      symbol = symbol.replace(/[^A-Z0-9]/g, "");
    }

    const parts = symbol.split(/\s+/);

    if (parts.length === 6) {
      const [index, strike, type, day, month, year] = parts;
      const shortYear = year.slice(-2);
      return `${index}${shortYear}${month.toUpperCase()}${strike}${type}`;
    }

    if (parts.length === 5) {
      const [index, strike, month, year, type] = parts;
      const shortYear = year.slice(-2);
      return `${index}${shortYear}${month.toUpperCase()}${strike}${type}`;
    }

    return symbol.replace(/\s+/g, "");
  } catch {
    return ts;
  }
}

module.exports = { handleWebhook };