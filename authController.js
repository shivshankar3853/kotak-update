const axios = require("axios");
const speakeasy = require("speakeasy");
const { saveToken } = require("./tokenManager");
const { connectWS } = require("./wsService");
const { setSession, sessionBus } = require("./sessionManager");

const DEBUG = false;

const AUTH_BASE_URL =
  process.env.KOTAK_BASE_URL ||
  "https://mis.kotaksecurities.com";

function buildWsUrl(baseUrl) {
  try {
    if (!baseUrl) return null;

    const url = new URL(baseUrl);
    return `wss://${url.host}/realtime`;
  } catch {
    return null;
  }
}

// ======================================================
// 🔐 TOTP GENERATION (Google Authenticator Compatible)
// ======================================================
function getTotpSecret() {
  return process.env.KOTAK_TOTP_SECRET || process.env.TOTP_SECRET;
}

function hasTotpSecret() {
  const secret = getTotpSecret();
  return Boolean(secret && secret !== "YOUR_SECRET_KEY");
}

function generateTOTP() {
  const secret = getTotpSecret();
  
  if (!hasTotpSecret()) {
    console.error("❌ TOTP Secret not configured. Set KOTAK_TOTP_SECRET in .env");
    throw new Error("TOTP_SECRET not configured");
  }
  
  try {
    const token = speakeasy.totp({
      secret: secret,
      encoding: "base32",
      algorithm: "sha1",      // Google Authenticator standard
      digits: 6,              // 6-digit code
      step: 30,               // 30-second time step
      window: 1               // Allow 1 window for clock drift tolerance
    });
    
    console.log("🔐 TOTP Generated:", token);
    return token;
  } catch (err) {
    console.error("❌ TOTP Generation Error:", err.message);
    throw err;
  }
}

const REQUEST_TIMEOUT = 15000;

let isLoggingIn = false;
let autoLoginEnabled = false;
let autoLoginTimer = null;

// ======================================================
// 🔄 AUTO LOGIN FUNCTION
// ======================================================
async function autoLogin() {
  try {
    if (isLoggingIn) {
      console.log("⏳ Login already in progress, skipping auto-login");
      return {
        success: false,
        error: "Login already in progress"
      };
    }

    if (!hasTotpSecret()) {
      const errorMessage = "TOTP secret not configured. Auto-login skipped.";
      console.error(`❌ ${errorMessage}`);
      return {
        success: false,
        error: errorMessage
      };
    }

    let totp;
    try {
      totp = generateTOTP();
    } catch (totpErr) {
      console.error("❌ Cannot generate TOTP:", totpErr.message);
      return {
        success: false,
        error: "TOTP generation failed"
      };
    }
    
    console.log("🔄 Auto-login attempt with TOTP:", totp);
    
    const result = await loginCore(totp);
    
    if (result.success) {
      console.log("✅ Auto-login successful");
    } else {
      console.error("❌ Auto-login failed:", result.error);
    }
    
    return result;
    
  } catch (err) {
    console.error("❌ Auto-login error:", err.message);
    return {
      success: false,
      error: err.message || "Auto-login failed"
    };
  }
}

// ======================================================
// 🔄 ENABLE AUTO LOGIN
// ======================================================
function enableAutoLogin(intervalMs = 3600000) {
  // Default: 1 hour (3600000 ms)
  if (autoLoginEnabled) {
    console.log("⚠️ Auto-login already enabled");
    return;
  }

  if (!hasTotpSecret()) {
    console.error("❌ Auto-login disabled: KOTAK_TOTP_SECRET is not configured.");
    return;
  }

  autoLoginEnabled = true;
  console.log(`🚀 Auto-login enabled (interval: ${intervalMs}ms)`);

  // Try login immediately
  autoLogin();

  // Set interval for periodic refresh
  autoLoginTimer = setInterval(() => {
    console.log("⏰ Auto-login interval triggered");
    autoLogin();
  }, intervalMs);
}

// ======================================================
// 🛑 DISABLE AUTO LOGIN
// ======================================================
function disableAutoLogin() {
  if (autoLoginTimer) {
    clearInterval(autoLoginTimer);
    autoLoginTimer = null;
  }
  autoLoginEnabled = false;
  console.log("🛑 Auto-login disabled");
}

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
      wsUrl:
        final.wsUrl ||
        buildWsUrl(final.baseUrl) ||
        process.env.KOTAK_WS_URL ||
        null
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
  loginCore,
  autoLogin,
  enableAutoLogin,
  disableAutoLogin,
  generateTOTP
};