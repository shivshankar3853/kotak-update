const axios = require("axios");
const { saveToken } = require("./tokenManager");
const { connectWS } = require("./wsService");
const { setSession, sessionBus } = require("./sessionManager");

const DEBUG = false;

const AUTH_BASE_URL =
  process.env.KOTAK_BASE_URL ||
  "https://mis.kotaksecurities.com";

const REQUEST_TIMEOUT = 15000;

let isLoggingIn = false;

// ======================================================
// 🔐 CORE LOGIN FUNCTION
// ======================================================
async function loginCore(totp) {

  if (isLoggingIn) {
    return {
      success: false,
      error: "Login already in progress"
    };
  }

  isLoggingIn = true;

  try {

    if (!totp || !/^\d{6}$/.test(String(totp))) {
      return {
        success: false,
        error: "Invalid TOTP"
      };
    }

    const apiAccessToken = process.env.KOTAK_NEO_ACCESS_TOKEN;
    const mobile = process.env.MOBILE_NUMBER;
    const ucc = process.env.UCC;
    const mpin = process.env.MPIN;

    if (!apiAccessToken || !mobile || !ucc || !mpin) {
      throw new Error("Missing env variables");
    }

    let final = null;

    for (let attempt = 1; attempt <= 2; attempt++) {

      try {

        // STEP 1
        const step1Res = await axios.post(
          `${AUTH_BASE_URL}/login/1.0/tradeApiLogin`,
          {
            mobileNumber: mobile,
            ucc,
            totp: String(totp)
          },
          {
            timeout: REQUEST_TIMEOUT,
            headers: {
              Authorization: apiAccessToken,
              "neo-fin-key": "neotradeapi",
              "Content-Type": "application/json"
            }
          }
        );

        const step1 = step1Res.data?.data || {};

        if (!step1.token || !step1.sid) {
          throw new Error("TOTP login failed");
        }

        // STEP 2
        const step2Res = await axios.post(
          `${AUTH_BASE_URL}/login/1.0/tradeApiValidate`,
          {
            mpin
          },
          {
            timeout: REQUEST_TIMEOUT,
            headers: {
              Authorization: apiAccessToken,
              "neo-fin-key": "neotradeapi",
              sid: step1.sid,
              Auth: step1.token,
              "Content-Type": "application/json"
            }
          }
        );

        final = step2Res.data?.data || {};

        if (!final.token || !final.sid || !final.baseUrl) {
          throw new Error("MPIN validation failed");
        }

        break;

      } catch (retryErr) {

        if (attempt === 2) throw retryErr;

        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // ================= SAVE TOKEN =================
    const sessionData = {
      token: final.token,
      sid: final.sid,
      baseUrl: final.baseUrl
    };

    setSession(sessionData);

    saveToken({
      access_token: apiAccessToken,
      session_token: final.token,
      sid: final.sid,
      baseUrl: final.baseUrl,
      wsUrl: final.wsUrl || process.env.KOTAK_WS_URL || null
    });

console.log("✅ Kotak Login Success");

    // ================= WS RECONNECT =================
    try {
      sessionBus.emit("sessionUpdated");
      await connectWS();
    } catch (wsErr) {
      console.log("⚠️ WS Connection Failed:", wsErr.message);
    }

    return { success: true };

  } catch (err) {

    return {
      success: false,
      error:
        err.response?.data?.message ||
        err.response?.data ||
        err.message ||
        "Unknown login error"
    };

  } finally {
    isLoggingIn = false;
  }
}

// ======================================================
// 🌐 EXPRESS HANDLER
// ======================================================
async function login(req, res) {
  try {

    const { totp } = req.body;

    if (!totp || !/^\d{6}$/.test(String(totp))) {
      return res.status(400).json({
        success: false,
        error: "Valid 6-digit TOTP required"
      });
    }

    const result = await loginCore(totp);

    if (result.success) {
      return res.json({ success: true });
    }

    return res.status(400).json(result);

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
}

module.exports = {
  login,
  loginCore
};