const { placeOrder, exitAndReenter } = require("./orderService");
const { isTradingEnabled, canTrade, isDuplicate } = require("./control");
const { validateSignal } = require("./validator");
const { decodeSymbol } = require("./symbolDecoder");
const { fetchPositions } = require("./positionService");
const BrokerPosition = require("./models/BrokerPosition");
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
      // ensure we normalize common noise like hyphens and trailing EQ
      try {
        finalSymbol = formatSymbol(finalSymbol);
      } catch (_) {}
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

function normalizePositionSymbol(value) {
  return formatSymbol(String(value || "").trim().toUpperCase());
}

function normalizePositionSide(side) {
  const normalized = String(side || "").trim().toUpperCase();
  if (normalized === "B" || normalized === "BUY") return "BUY";
  if (normalized === "S" || normalized === "SELL") return "SELL";
  return normalized;
}

async function findBrokerPosition(symbol) {
  try {
    const targetSymbol = String(symbol || "").trim();

    // build candidate variants to match against stored positions
    const variants = new Set();
    try {
      if (targetSymbol) variants.add(normalizePositionSymbol(targetSymbol));
    } catch (_) {}
    try {
      variants.add((targetSymbol || "").toUpperCase());
    } catch (_) {}

    // also include formatted/stripped variants and plain ticker
    try {
      variants.add(formatSymbol(targetSymbol));
      const lettersOnly = String(targetSymbol || "").toUpperCase().replace(/[^A-Z]/g, "");
      if (lettersOnly) variants.add(lettersOnly);
    } catch (_) {}

    // try decodeSymbol (if available) to get broker-specific formats
    try {
      const decoded = decodeSymbol(targetSymbol);
      if (decoded) {
        if (decoded.kotakSymbol) variants.add(String(decoded.kotakSymbol).toUpperCase());
        if (decoded.tradingSymbol) variants.add(String(decoded.tradingSymbol).toUpperCase());
        if (decoded.index) variants.add(String(decoded.index).toUpperCase());
      }
    } catch (_) {}

    const candidateArray = Array.from(variants).filter(Boolean);

    // 1) check persisted BrokerPosition first (fast and authoritative from last fetch)
    try {
      if (process.env.DEBUG === "true") {
        console.log("🔎 Candidate symbols for broker lookup:", candidateArray);
      }

      const dbMatch = await BrokerPosition.findOne({
        instrument: { $in: candidateArray }
      }).lean();

      if (dbMatch) {
        if (process.env.DEBUG === "true") {
          console.log("🗃️ BrokerPosition DB match:", dbMatch.instrument, "qty:", dbMatch.quantity, "status:", dbMatch.status);
        }
        const qty = Number(dbMatch.quantity || dbMatch.qty || 0);
        const st = String(dbMatch.status || "").toUpperCase();
        if (qty > 0 && !["CLOSED", "EXITED", "FLAT", "SQUAREOFF"].includes(st)) {
          return dbMatch;
        }
      }
    } catch (e) {
      console.error("❌ BrokerPosition DB lookup failed:", e.message || e);
    }

    // 2) fallback to fresh fetch from broker API
    const positions = await fetchPositions(true);
    return positions.find((pos) => {
      const instrument = normalizePositionSymbol(
        pos.TS || pos.symbol || pos.ticker || pos.instrument || pos.s || pos.ts || ""
      );
      const quantity = Number(pos.quantity || pos.qty || pos.Q || pos.q || 0);
      const status = String(pos.status || pos.position_status || pos.st || "").toUpperCase();

      if (!instrument) return false;

      // compare against any candidate variant
      const match = candidateArray.some((v) => v && v === instrument);
      if (!match) return false;

      if (!quantity || quantity <= 0) return false;
      if (["CLOSED", "SQUAREOFF", "FLAT", "EXITED"].includes(status)) return false;
      return true;
    });
  } catch (err) {
    console.error("❌ Broker position lookup failed:", err.message);
    return null;
  }
}

async function appendDecision(signalId, message, decision = null) {
  try {
    const update = { $push: { decisionLog: `${new Date().toISOString()} - ${message}` } };
    if (decision) update.$set = { decision };
    await Signal.findByIdAndUpdate(signalId, update);
  } catch (e) {
    console.error("❌ appendDecision error:", e.message || e);
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

        const incomingSide = normalizePositionSide(order.transaction_type);
        const currentPosition = await findBrokerPosition(order.TS);
        const currentSide = normalizePositionSide(
          currentPosition?.side ||
          currentPosition?.transaction_type ||
          currentPosition?.tt ||
          currentPosition?.action ||
          ""
        );

        if (currentPosition && currentSide === incomingSide) {
          await Signal.findByIdAndUpdate(signalDoc._id, {
            processed: true,
            error: `Same ${incomingSide} position already open in broker terminal; ignored.`
          });
          await appendDecision(signalDoc._id, `Ignored signal because same-side ${incomingSide} position exists for ${order.TS}`, "IGNORED");
          console.log(`⛔ Ignoring same-side broker position for ${order.TS}`);
          continue;
        }

        if (currentPosition && currentSide && currentSide !== incomingSide) {
          const oppositeQty = Number(
            currentPosition.quantity ||
            currentPosition.qty ||
            currentPosition.Q ||
            0
          ) || order.quantity;

          console.log(
            `🔁 Opposite broker position detected for ${order.TS}: ${currentSide} ${oppositeQty}. Exiting first before opening new position.`
          );

          await appendDecision(signalDoc._id, `Detected opposite-side ${currentSide} position (${oppositeQty}). Will exit then open ${incomingSide}.`, "EXIT_AND_REENTER");

          try {
            const result = await exitAndReenter(currentPosition, order, signalDoc._id);
            await appendDecision(signalDoc._id, `Exit result: ${JSON.stringify(result?.exitRes || result)}`);
            await appendDecision(signalDoc._id, `Open result: ${JSON.stringify(result?.newRes || result)}`, "OPENED");
          } catch (e) {
            await appendDecision(signalDoc._id, `Exit+Reenter failed: ${e.message || e}`, "ERROR");
            throw e;
          }
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

    // remove non-alphanumeric separators (hyphen, slash, dots, spaces)
    symbol = symbol.replace(/[^A-Z0-9]/g, "");

    // strip common equity suffix 'EQ' if present (e.g., CANBK-EQ → CANBK)
    if (/^[A-Z]+EQ$/.test(symbol)) {
      symbol = symbol.replace(/EQ$/, "");
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