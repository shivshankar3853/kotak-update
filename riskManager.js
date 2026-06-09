const mongoose = require("mongoose");

const Trade = require("./models/Trade");
const { getLTP } = require("./ltpEngine");
const { placeOrder } = require("./orderService");

// ==========================================
// SETTINGS
// ==========================================

const STOP_LOSS = -500;
const TARGET = 1000;

// ==========================================
// MONITOR TRADES
// ==========================================

async function monitorTrades() {

  try {

    if (mongoose.connection.readyState !== 1) {
      console.log("⚠️ MongoDB not ready");
      return;
    }

    const openTrades = await Trade.find({ status: "OPEN" });

    if (!openTrades.length) return;

    for (const t of openTrades) {

      try {

        const ltp = await getLTP(t.instrument);

        if (!ltp || isNaN(ltp)) continue;

        let pnl = 0;

        if (t.side === "BUY") {
          pnl = (ltp - t.price) * t.quantity;
        } else {
          pnl = (t.price - ltp) * t.quantity;
        }

        console.log(`📊 ${t.instrument} | PnL: ₹${pnl}`);

        if (pnl <= STOP_LOSS || pnl >= TARGET) {

          console.log("🎯 SL/Target hit:", t.instrument);

          // ==========================================
          // ⚠️ SAFETY LOCK (prevents duplicate exits)
          // ==========================================

          const freshTrade = await Trade.findOne({
            _id: t._id,
            status: "OPEN"
          });

          if (!freshTrade) continue;

          const exitSide =
            t.side === "BUY" ? "SELL" : "BUY";

          await placeOrder({
            TS: t.instrument,
            quantity: t.quantity,
            transaction_type: exitSide,
            order_type: "MARKET",
            product: "NRML"
          });

          // update again safely
          freshTrade.status = "CLOSED";
          freshTrade.exitPrice = ltp;
          freshTrade.pnl = pnl;
          freshTrade.exitTime = new Date();

          await freshTrade.save();

          console.log(`✅ Trade closed: ${t.instrument}`);
        }

      } catch (err) {
        console.error(`❌ Trade error (${t.instrument}):`, err.message);
      }
    }

  } catch (err) {
    console.error("❌ monitorTrades Error:", err.message);
  }
}

module.exports = {
  monitorTrades
};