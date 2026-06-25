const mongoose = require("mongoose");

const brokerOrderSchema = new mongoose.Schema(
  {
    signalId: { type: mongoose.Schema.Types.ObjectId, ref: "Signal", default: null },
    symbol: String,
    side: String,
    quantity: Number,
    product: String,
    orderType: String,
    validity: String,
    amo: String,
    targetPrice: Number,
    stopLossPoint: Number,
    requestPayload: { type: mongoose.Schema.Types.Mixed },
    brokerOrderId: String,
    status: { type: String, default: "PENDING" },
    brokerStatus: String,
    response: { type: mongoose.Schema.Types.Mixed },
    error: String,
    placedAt: Date,
    completedAt: Date
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("BrokerOrder", brokerOrderSchema);
