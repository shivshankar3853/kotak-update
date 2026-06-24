const axios = require("axios");
const qs = require("qs");
const mongoose = require("mongoose");

const {
  getSessionToken,
  getSid,
  getBaseUrl
} = require("./tokenManager");
const { autoLogin } = require("./authController");

const Trade = require("./models/Trade");

const { findInstrument } = require("./instrumentStore");

const {
  getLTP,
  setPostTradeCooldown
} = require("./priceService");

const { getTickAsync } = require("./wsService");

async function placeOrder(order) {

  try {

    const sessionToken = getSessionToken();
    const sid = getSid();
    const baseUrl = getBaseUrl();

    // Debug: Check token integrity
    console.log("TOKEN LENGTH:", sessionToken?.length);
    console.log("TOKEN START:", sessionToken?.substring(0,50));
    console.log("SID:", sid);
    console.log("BASE_URL:", baseUrl);

    // ==============================
    // 🧯 SAFE GUARD
    // ==============================
    if (!sessionToken || !sid || !baseUrl) {
      throw new Error("Missing auth/session/baseUrl");
    }

    // ==============================
    // ✅ VALIDATION
    // ==============================
    const action = (order?.transaction_type || "")
      .trim()
      .toUpperCase();

    const quantity = Number(order?.quantity);

    const rawSymbol = order?.TS;

    if (!action || !["BUY", "SELL"].includes(action)) {
      throw new Error("Invalid Action: " + action);
    }

    if (!rawSymbol) {
      throw new Error("Symbol missing");
    }

    if (!quantity || isNaN(quantity)) {
      throw new Error("Invalid quantity");
    }

    // ==============================
    // 🔍 FIND INSTRUMENT
    // ==============================
    console.log("🔍 Searching Instrument:", rawSymbol);

    const instrument = findInstrument(rawSymbol);

    if (!instrument) {
      throw new Error("Instrument not found for: " + rawSymbol);
    }

    const symbol = instrument?.ts || rawSymbol;

    const lotSize = Number(instrument?.ls);

    if (!lotSize || isNaN(lotSize)) {
      throw new Error("Invalid lot size");
    }

    // ==============================
    // 🚀 BUILD ORDER
    // ==============================
    const qtyFinal = String((quantity || 0) * lotSize);

    const rawAmo =
      order?.AMO ||
      order?.amo ||
      order?.after_market ||
      order?.afterMarket ||
      order?.am ||
      "";

    const amoValue = String(rawAmo).trim().toUpperCase();
    const amFlag = ["YES", "Y", "TRUE", "1", "AMO"].includes(amoValue)
      ? "YES"
      : "NO";

    const rawTP =
      order?.TP ||
      order?.tp ||
      order?.TGT ||
      order?.target_point ||
      order?.targetPoints ||
      order?.target_points ||
      order?.targetPrice;
    const rawSLP =
      order?.SLP ||
      order?.slp ||
      order?.stop_loss ||
      order?.stopLoss ||
      order?.sl ||
      order?.stop_loss_points ||
      order?.stopLossPoint;

    const targetPoints = Number(rawTP);
    const stopLossPoints = Number(rawSLP);
    const targetPointsFinal =
      Number.isFinite(targetPoints) && targetPoints > 0
        ? targetPoints
        : 10;
    const stopLossPointsFinal =
      Number.isFinite(stopLossPoints) && stopLossPoints > 0
        ? stopLossPoints
        : 100;

    const productMap = {
  CNC: "CNC",
  MIS: "MIS",
  NRML: "NRML"
};

const jData = {
  am: amFlag,
  dq: "0",
  es: instrument?.es || "nse_fo",
  mp: "0",
  pc: productMap[
    String(order?.product || "")
      .trim()
      .toUpperCase()
  ] || "CNC",
  pf: "N",
  pr: "0",
  pt: "MKT",
  qt: qtyFinal,
  rt: "DAY",
  tp: "0",
  ts: symbol,
  tt: action === "BUY" ? "B" : "S"
};
    console.log(`📡 Sending Order (AMO=${amFlag}):`, jData);

    console.log("📡 Sending Order:", jData);

    // ==============================
    // 📦 API CALL (with one-shot 401 auto-retry)
    // ==============================
    let response;
    let retriedAfterRefresh = false;

    const doPost = async (authToken, sidVal, baseUrlArg) => {
      const targetBase = baseUrlArg || getBaseUrl();
      const orderUrl = `${targetBase}/quick/order/rule/ms/place`;

      const payload = qs.stringify({
        jData: JSON.stringify(jData),
        jKey: authToken
      });

      const headers = {
        Accept: "application/json",
        Auth: authToken,
        Sid: sidVal,
        "neo-fin-key": "neotradeapi",
        "Content-Type": "application/x-www-form-urlencoded"
      };

      // Debug logs requested: URL, headers (snippet), body
      console.log("ORDER URL:", orderUrl);
      console.log("ORDER HEADERS:", { auth: headers.Auth?.substring(0,30), Sid: headers.Sid, neoFinKey: headers["neo-fin-key"] });
      console.log("ORDER BODY:", payload);

      return axios.post(orderUrl, payload, {
        headers,
        timeout: 10000
      });
    };

    try {
      response = await doPost(sessionToken, sid, baseUrl);
      console.log(response.data);
    } catch (err) {
      console.log("Status:", err.response?.status);
      console.log("Headers:", err.config?.headers);
      console.log("Response:", err.response?.data);
      console.log("Token:", getSessionToken());

      // If unauthorized, try one refresh via autoLogin and retry once
      if (err.response?.status === 401 && !retriedAfterRefresh) {
        retriedAfterRefresh = true;
        try {
          console.log("401 detected — attempting auto-login refresh...");
          const refreshResult = await autoLogin();
          if (refreshResult && refreshResult.success) {
            const newToken = getSessionToken();
            const newSid = getSid();
            const newBase = getBaseUrl();
            console.log("Auto-login refreshed token — retrying order against updated baseUrl:", newBase);
            response = await doPost(newToken, newSid, newBase);
            console.log(response.data);
          } else {
            console.error("Auto-login did not refresh session:", refreshResult);
          }
        } catch (refreshErr) {
          console.error("Auto-login retry failed:", refreshErr?.message || refreshErr);
        }
      }

      if (!response) {
        throw err;
      }
    }

    const orderData =
      (response?.data && typeof response.data === "object")
        ? response.data
        : {};

    console.log("✅ Order Success");

    // ==============================
    // 🔥 POST TRADE SAFETY
    // ==============================
    try {
      setPostTradeCooldown();
    } catch (e) {
      console.log("⚠️ Cooldown Error:", e.message);
    }

    await new Promise(r => setTimeout(r, 2000));

    // ==============================
    // 📊 GET LTP SAFELY
    // ==============================
    let tradePrice = 0;

    try {
      const ltpVal = await getLTP(symbol, instrument?.es);
      tradePrice = Number(ltpVal) || 0;

      // fallback to WS/Redis cached tick if API LTP is unavailable
      if ((!tradePrice || tradePrice === 0) && getTickAsync) {
        try {
          const tickVal = await getTickAsync(symbol);
          tradePrice = Number(tickVal) || tradePrice || 0;
        } catch (_) {
          // ignore
        }
      }
    } catch (e) {
      tradePrice = 0;
    }

    if (tradePrice < 0 || isNaN(tradePrice)) {
      tradePrice = 0;
    }

    const targetPrice =
      action === "BUY"
        ? tradePrice + targetPointsFinal
        : tradePrice - targetPointsFinal;
    const stopLossPrice =
      action === "BUY"
        ? tradePrice - stopLossPointsFinal
        : tradePrice + stopLossPointsFinal;

    // ==============================
    // ⚠️ DB CHECK
    // ==============================
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      console.log("⚠️ MongoDB not ready");
      return orderData;
    }

    // ==============================
    // 🟢 BUY ENTRY
    // ==============================
    if (action === "BUY") {

      await Trade.create({
        broker: "KOTAK",
        side: "BUY",
        quantity,
        instrument: symbol,
        orderId: orderData?.nOrdNo || "NA",
        price: tradePrice,
        entryPrice: tradePrice,
        targetPrice,
        targetPoints: targetPointsFinal,
        stopLossPoints: stopLossPointsFinal,
        stopLossPrice,
        status: "OPEN",
        time: new Date(),
        highestPrice: tradePrice,
        trailingSL: tradePrice > 0 ? tradePrice - 10 : 0
      });

      console.log("🟢 BUY Trade Recorded");
    }

    // ==============================
    // 🔴 SELL EXIT
    // ==============================
    else {

      const openTrade = await Trade.findOne({
        instrument: symbol,
        status: "OPEN",
        broker: "KOTAK"
      });

      if (openTrade) {

        const entryPrice = Number(openTrade.price) || 0;

        let pnl = 0;

        if (openTrade.side === "BUY") {
          pnl = (tradePrice - entryPrice) * quantity;
        } else {
          pnl = (entryPrice - tradePrice) * quantity;
        }

        openTrade.status = "CLOSED";
        openTrade.pnl = pnl;
        openTrade.exitPrice = tradePrice;
        openTrade.exitTime = new Date();

        await openTrade.save();

        await Trade.create({
          broker: "KOTAK",
          side: "SELL",
          quantity,
          instrument: symbol,
          orderId: orderData?.nOrdNo || "NA",
          price: tradePrice,
          status: "CLOSED",
          pnl,
          targetPoints: targetPointsFinal,
          stopLossPoints: stopLossPointsFinal,
          stopLossPrice,
          time: new Date()
        });

        console.log("💰 Trade Closed | PnL:", pnl);

      } else {
        console.log("⚠️ No OPEN trade found");
      }
    }

    // ==============================
    // 📡 SOCKET UPDATE
    // ==============================
    if (global.io) {
      global.io.emit("order", orderData);
    }

    return orderData;

  } catch (err) {

    console.error(
      "❌ Order Error:",
      err?.response?.data || err.message
    );

    throw err;
  }
}

// ==============================
// 📜 GET TRADE LOG
// ==============================
async function getTradeLog() {

  try {

    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      console.log("⚠️ MongoDB not ready");
      return [];
    }

    return await Trade.find({ broker: "KOTAK" })
      .sort({ time: -1 });

  } catch (err) {
    console.error("❌ getTradeLog Error:", err.message);
    return [];
  }
}

// ==============================
// EXPORT
// ==============================
module.exports = {
  placeOrder,
  getTradeLog
};