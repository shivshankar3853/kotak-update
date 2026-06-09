const mongoose = require("mongoose");

const tradeSchema = new mongoose.Schema({
  time: { type: Date, default: Date.now },

  broker: { type: String, default: "KOTAK" },

  side: String,
  quantity: Number,
  instrument: String,
  orderId: String,

  price: Number,
  entryPrice: Number,
  targetPrice: Number,
  exitPrice: Number,
  exitTime: Date,
  closeReason: String,

  status: { type: String, default: "OPEN" },
  pnl: { type: Number, default: 0 },

  // 🚀 Trailing SL
  highestPrice: { type: Number, default: 0 },
  trailingSL: { type: Number, default: 0 }
});

module.exports = mongoose.model("Trade", tradeSchema);