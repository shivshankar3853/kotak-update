// config.js
const path = require("path");

require("dotenv").config();

module.exports = {

  PORT: Number(process.env.PORT) || 3000,

  // ================= BROKER =================
  BROKER:
    (process.env.BROKER || "KOTAK")
      .toUpperCase(),

  MONGO_URI:
    process.env.MONGO_URI,

  // ================= KOTAK NEO =================
  KOTAK_NEO_ACCESS_TOKEN:
    process.env.KOTAK_NEO_ACCESS_TOKEN,

  MOBILE_NUMBER:
    process.env.MOBILE_NUMBER,

  UCC:
    process.env.UCC,

  MPIN:
    process.env.MPIN,

  CLIENT_NAME:
    process.env.CLIENT_NAME,

  // ================= UPSTOX =================
  UPSTOX_API_KEY:
    process.env.UPSTOX_API_KEY,

  UPSTOX_API_SECRET:
    process.env.UPSTOX_API_SECRET,

  UPSTOX_REDIRECT_URI:
    process.env.UPSTOX_REDIRECT_URI,

  UPSTOX_ACCESS_TOKEN:
    process.env.UPSTOX_ACCESS_TOKEN,

  // ================= ZERODHA =================
  ZERODHA_API_KEY:
    process.env.ZERODHA_API_KEY,

  ZERODHA_ACCESS_TOKEN:
    process.env.ZERODHA_ACCESS_TOKEN,

  ZERODHA_CLIENT_ID:
    process.env.ZERODHA_CLIENT_ID,

  // ================= COMMON =================
  TOKEN_FILE:
    path.join(__dirname, "token.json"),

  INSTRUMENT_FILE:
    path.join(
      __dirname,
      "data",
      "instruments.csv"
    ),

  DEBUG:
    process.env.DEBUG === "true"
};