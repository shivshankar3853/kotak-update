const mongoose = require("mongoose");

const ltpSchema = new mongoose.Schema(
  {
    symbol: { type: String, index: true, unique: true },
    ltp: Number,
    source: String,
    raw: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("LTP", ltpSchema);
