const mongoose = require("mongoose");

const Trade = require("./models/Trade");
const { placeOrder } = require("./orderService");

// ==========================================
// AUTO SQUARE OFF
// ==========================================

async function squareOffAll() {

  try {

    console.log("⏰ Running Auto Square-Off...");

    if (mongoose.connection.readyState !== 1) {
      console.log("⚠️ MongoDB not ready");
      return;
    }

    const openTrades = await Trade.find({ status: "OPEN" });

    if (!openTrades.length) {
      console.log("ℹ️ No open trades");
      return;
    }

    for (const t of openTrades) {

      try {

        // ==========================================
        // SAFETY CHECK (prevents duplicate exit)
        // ==========================================

        const freshTrade = await Trade.findOne({
          _id: t._id,
          status: "OPEN"
        });

        if (!freshTrade) continue;

        const exitSide =
          t.side === "BUY" ? "SELL" : "BUY";

        // ==========================================
        // PLACE EXIT ORDER
        // ==========================================

        const orderRes = await placeOrder({
          TS: t.instrument,
          quantity: t.quantity,
          transaction_type: exitSide,
          order_type: "MARKET",
          product: "NRML"
        });

        // ==========================================
        // OPTIONAL: validate order success
        // ==========================================

        if (orderRes && orderRes.status === "REJECTED") {
          console.log(`⚠️ Order rejected: ${t.instrument}`);
          continue;
        }

        freshTrade.status = "CLOSED";
        freshTrade.exitTime = new Date();

        await freshTrade.save();

        console.log(`✅ Squared off: ${t.instrument}`);

      } catch (err) {
        console.error(
          `❌ Square-off failed (${t.instrument}):`,
          err.message
        );
      }
    }

  } catch (err) {
    console.error("❌ squareOffAll Error:", err.message);
  }
}

module.exports = {
  squareOffAll
};