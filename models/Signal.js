const mongoose = require("mongoose");

const signalSchema = new mongoose.Schema(
  {
    receivedAt: { type: Date, default: Date.now },
    source: { type: String, default: "TRADINGVIEW" },
    raw: { type: mongoose.Schema.Types.Mixed },
    normalized: { type: mongoose.Schema.Types.Mixed },
    validated: { type: Boolean, default: false },
    validationErrors: { type: [String], default: [] },
    duplicate: { type: Boolean, default: false },
    processed: { type: Boolean, default: false },
    orderId: { type: String, default: null },
    error: { type: String, default: null }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("Signal", signalSchema);
