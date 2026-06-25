const mongoose = require("mongoose");

const brokerPositionSchema = new mongoose.Schema(
  {
    instrument: { type: String, index: true },
    side: String,
    quantity: Number,
    averagePrice: Number,
    marketValue: Number,
    pnl: Number,
    status: String,
    raw: { type: mongoose.Schema.Types.Mixed }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("BrokerPosition", brokerPositionSchema);
