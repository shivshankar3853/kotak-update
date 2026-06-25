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
const BrokerOrder = require("./models/BrokerOrder");

const { findInstrument } = require("./instrumentStore");

const {
  getLTP,
  setPostTradeCooldown
} = require("./priceService");

const { getTickAsync } = require("./wsService");

async function placeOrder(order, signalId = null) {

  try {

    const sessionToken = getSessionToken();
    const sid = getSid();
    const baseUrl = getBaseUrl();

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

    let brokerOrderDoc = null;
    try {
      brokerOrderDoc = await BrokerOrder.create({
        signalId,
        symbol,
        side: action,
        quantity,
        product: order?.product || "NRML",
        orderType: order?.order_type || order?.OT || "MARKET",
        validity: order?.validity || order?.VL || "DAY",
        amo: order?.AMO || order?.amo || order?.after_market || order?.afterMarket || order?.am || "NO",
        targetPrice: Number(order?.TP || order?.TGT || order?.targetPrice || 0),
        stopLossPoint: Number(order?.SLP || order?.slp || order?.stop_loss || order?.stopLoss || order?.sl || order?.stop_loss_points || order?.stopLossPoint || 0),
        requestPayload: {
          order,
          jData
        },
        status: "PENDING",
        placedAt: new Date()
      });
    } catch (e) {
      console.error(`❌ BrokerOrder create failed: ${e.message}`);
    }


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

      return axios.post(orderUrl, payload, {
        headers,
        timeout: 10000
      });
    };

    try {
      response = await doPost(sessionToken, sid, baseUrl);
    } catch (err) {
      if (err.response?.status === 403) {
        console.error("🔴 403 Forbidden - Possible reasons: expired session, invalid Sid, rate limit, or payload format");
        console.error("Response:", err.response?.data);
      }

      // If unauthorized, try one refresh via autoLogin and retry once
      if (err.response?.status === 401 && !retriedAfterRefresh) {
        retriedAfterRefresh = true;
        try {
          const refreshResult = await autoLogin();
          if (refreshResult && refreshResult.success) {
            const newToken = getSessionToken();
            const newSid = getSid();
            const newBase = getBaseUrl();
            response = await doPost(newToken, newSid, newBase);
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

    const brokerStatus =
      orderData?.status || orderData?.stat || orderData?.order_status || orderData?.orderStatus || null;

    const statusValue =
      brokerStatus && /rejected|fail|not_ok/i.test(String(brokerStatus))
        ? "REJECTED"
        : "SUCCESS";

    if (brokerOrderDoc?._id) {
      await BrokerOrder.findByIdAndUpdate(brokerOrderDoc._id, {
        brokerOrderId: orderData?.nOrdNo || orderData?.orderId || null,
        brokerStatus,
        response: orderData,
        status: statusValue,
        completedAt: new Date()
      });
    }

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

    try {
      if (brokerOrderDoc?._id) {
        await BrokerOrder.findByIdAndUpdate(brokerOrderDoc._id, {
          status: "FAILED",
          error: err?.response?.data || err.message || "Order failed",
          completedAt: new Date(),
          response: err?.response?.data || null
        });
      }
    } catch (updateErr) {
      console.error(`❌ BrokerOrder failure update error: ${updateErr.message}`);
    }

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