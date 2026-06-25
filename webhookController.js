const { placeOrder } = require("./orderService");
const { isTradingEnabled, canTrade, isDuplicate } = require("./control");
const { validateSignal } = require("./validator");
const { decodeSymbol } = require("./symbolDecoder");
const Signal = require("./models/Signal");

// ==============================
// 🚫 DUPLICATE SIGNAL PROTECTION (SAFE + LEAK FREE)
// Use control.js for the 45-second dedupe window.
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
      AMO: signal.AMO || signal.amo || signal.after_market || signal.afterMarket || signal.am || "",
      TP: Number(signal.TGT || 0),
      SLP: Number(signal.SLP || 0),
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
      let signalDoc = null;
      try {
        const normalizedSignal = normalizeSignal(rawSignal);

        signalDoc = await Signal.create({
          raw: rawSignal,
          normalized: normalizedSignal || null,
          validated: false,
          duplicate: false,
          processed: false
        });

        if (!normalizedSignal) {
          await Signal.findByIdAndUpdate(signalDoc._id, {
            validationErrors: ["Invalid payload format"],
            error: "Invalid payload format"
          });
          errors.push("Invalid payload format");
          continue;
        }

        const result = validateSignal(normalizedSignal);

        if (!result.ok) {
          await Signal.findByIdAndUpdate(signalDoc._id, {
            validated: false,
            validationErrors: [result.error],
            error: result.error
          });
          console.log("❌ Invalid signal:", result.error);
          errors.push(result.error);
          continue;
        }

        const validSignal = {
          ...normalizedSignal,
          ...result.data
        };

        await Signal.findByIdAndUpdate(signalDoc._id, {
          normalized: validSignal,
          validated: true
        });

        if (isDuplicate(validSignal)) {
          await Signal.findByIdAndUpdate(signalDoc._id, {
            duplicate: true,
            error: "Duplicate signal"
          });
          console.log("⚠️ Duplicate ignored:", validSignal.TS);
          continue;
        }

        if (!canTrade()) {
          await Signal.findByIdAndUpdate(signalDoc._id, {
            error: "Trade limit reached"
          });
          console.log("⛔ Trade limit reached");
          continue;
        }

        const order = convertTV(validSignal);
        if (!order) {
          await Signal.findByIdAndUpdate(signalDoc._id, {
            error: "Order conversion failed"
          });
          errors.push("Order conversion failed");
          continue;
        }

        console.log("📤 Final Order:", order);

        const resultOrder = await placeOrder(order, signalDoc._id);

        console.log("✅ Order Success:", resultOrder);

        await Signal.findByIdAndUpdate(signalDoc._id, {
          processed: true,
          orderId: resultOrder?.nOrdNo || resultOrder?.orderId || null,
          error: null
        });

        processedAny = true;
      } catch (err) {
        if (signalDoc) {
          await Signal.findByIdAndUpdate(signalDoc._id, {
            error: err.message || "Order processing failed"
          });
        }
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