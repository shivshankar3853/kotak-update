const mongoose = require("mongoose");

const Trade = require("./models/Trade");
const { getLTP } = require("./ltpEngine");
const { placeOrder } = require("./orderService");

// ==========================================
// SETTINGS
// ==========================================

const TRAIL_GAP = 10;
const INITIAL_SL = -500;

// ==========================================
// TRAILING SL MONITOR
// ==========================================

async function monitorTrailingSL() {

  try {

    if (mongoose.connection.readyState !== 1) return;

    const openTrades = await Trade.find({ status: "OPEN" });

    if (!openTrades.length) return;

    for (const t of openTrades) {

      try {

        const ltp = await getLTP(t.instrument);

        if (!ltp || isNaN(ltp) || !t.price || !t.quantity) {
          continue;
        }

        let updated = false;

        // ==========================================
        // INIT TRAILING VALUES
        // ==========================================

        if (t.highestPrice == null) {
          t.highestPrice = t.price;
          updated = true;
        }

        if (t.side === "SELL" && t.lowestPrice == null) {
          t.lowestPrice = t.price;
          updated = true;
        }

        if (t.trailingSL == null) {
          t.trailingSL =
            t.side === "BUY"
              ? t.price + INITIAL_SL
              : t.price - INITIAL_SL;
          updated = true;
        }

        // ==========================================
        // UPDATE TRAILING
        // ==========================================

        if (t.side === "BUY") {

          if (ltp > t.highestPrice) {
            t.highestPrice = ltp;

            const newSL = ltp - TRAIL_GAP;

            if (!t.trailingSL || newSL > t.trailingSL) {
              t.trailingSL = newSL;
              updated = true;

              console.log(`📈 Trailing SL Updated: ${t.instrument} → ${t.trailingSL}`);
            }
          }

        } else if (t.side === "SELL") {

          if (ltp < t.lowestPrice) {
            t.lowestPrice = ltp;

            const newSL = ltp + TRAIL_GAP;

            if (!t.trailingSL || newSL < t.trailingSL) {
              t.trailingSL = newSL;
              updated = true;

              console.log(`📉 Trailing SL Updated: ${t.instrument} → ${t.trailingSL}`);
            }
          }
        }

        // ==========================================
        // EXIT CONDITION
        // ==========================================

        const slHit =
          (t.side === "BUY" && ltp <= t.trailingSL) ||
          (t.side === "SELL" && ltp >= t.trailingSL);

        if (!slHit) {
          if (updated) await t.save();
          continue;
        }

        // safety lock (runtime only)
        if (t._closing) return;
        t._closing = true;

        console.log("🔻 Trailing SL Hit:", t.instrument);

        const exitSide = t.side === "BUY" ? "SELL" : "BUY";

        await placeOrder({
          TS: t.instrument,
          quantity: t.quantity,
          transaction_type: exitSide,
          order_type: "MARKET",
          product: "NRML"
        });

        t.status = "CLOSED";
        t.exitPrice = ltp;
        t.exitTime = new Date();

        t.pnl =
          t.side === "BUY"
            ? (ltp - t.price) * t.quantity
            : (t.price - ltp) * t.quantity;

        await t.save();

        console.log(`✅ Trade closed: ${t.instrument}`);

      } catch (err) {
        console.error(`❌ Trailing SL Error (${t.instrument}):`, err.message);
      }
    }

  } catch (err) {
    console.error("❌ monitorTrailingSL Error:", err.message);
  }
}

// ==========================================
// EXPORT
// ==========================================

module.exports = {
  monitorTrailingSL
};