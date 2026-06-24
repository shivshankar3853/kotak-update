const fs = require("fs");
const config = require("./config");

let tokenData = null;
let loading = false;

// ================= LOAD TOKEN =================
function loadToken() {
  try {

    if (loading) return tokenData;
    loading = true;

    if (fs.existsSync(config.TOKEN_FILE)) {
      const raw = fs.readFileSync(config.TOKEN_FILE, "utf-8");

      const data = JSON.parse(raw);

      // basic validation
      if (!data || typeof data !== "object") {
        throw new Error("Invalid token file format");
      }

      tokenData = {
  ...data
};
      if (isTokenExpired()) {

  console.log("⚠️ Token expired");

  clearToken();

  return null;
}

      console.log("🔑 Kotak Token Loaded");
      return tokenData;
    }

  } catch (err) {
    console.error("❌ Token load error:", err.message);
  } finally {
    loading = false;
  }

  return null;
}

// ================= SAVE TOKEN =================
function saveToken(data) {
  try {

    const finalData = {
      access_token: data?.access_token || null,
      session_token: data?.session_token || null,
      sid: data?.sid || null,
      baseUrl: data?.baseUrl || null,
wsUrl: data?.wsUrl || process.env.KOTAK_WS_URL || null,
      created_at: Date.now()
    };

    const tempFile = config.TOKEN_FILE + ".tmp";

    fs.writeFileSync(
      tempFile,
      JSON.stringify(finalData, null, 2)
    );

    // atomic replace
    fs.renameSync(tempFile, config.TOKEN_FILE);

    tokenData = finalData;

    console.log("💾 Kotak Token Saved");

  } catch (err) {
    console.error("❌ Token save error:", err.message);
  }
}

// ================= ACCESS TOKEN =================
function getAccessToken() {
  if (!tokenData) loadToken();
  return tokenData?.access_token || process.env.KOTAK_NEO_ACCESS_TOKEN || null;
}

// ================= SESSION TOKEN =================
function getSessionToken() {
  if (!tokenData) loadToken();
  return tokenData?.session_token || null;
}

// ================= SID =================
function getSid() {
  if (!tokenData) loadToken();
  return tokenData?.sid || null;
}

// ================= BASE URL =================
function getBaseUrl() {
  if (!tokenData) loadToken();
  return tokenData?.baseUrl || null;
}
function buildWsUrl(baseUrl) {
  try {
    if (!baseUrl) return null;
    const url = new URL(baseUrl);
    return `wss://${url.host}/realtime`;
  } catch {
    return null;
  }
}

function getWSUrl() {
  if (!tokenData) {
    loadToken();
  }

  if (typeof tokenData?.wsUrl === "string" && tokenData.wsUrl.length > 0) {
    return tokenData.wsUrl;
  }

  const derived = buildWsUrl(tokenData?.baseUrl);
  if (derived) return derived;

  return process.env.KOTAK_WS_URL || null;
}

// ================= TOKEN VALIDATION =================
function isTokenExpired() {

  if (!tokenData?.created_at) {
    return true;
  }

  const createdAt = Number(tokenData.created_at);

  if (!createdAt || Number.isNaN(createdAt)) {
    return true;
  }

  const now = Date.now();

  return (
    now - createdAt >
    23 * 60 * 60 * 1000
  );
}
// ================= VALID SESSION CHECK =================
function hasValidSession() {

  if (!tokenData) {
    loadToken();
  }

  return !!(
    tokenData?.session_token &&
    tokenData?.sid &&
    tokenData?.baseUrl &&
    typeof tokenData?.wsUrl === "string"
  );
}

// ================= RESET TOKEN =================
function clearToken() {
  tokenData = null;
loading = false;

  try {
    if (fs.existsSync(config.TOKEN_FILE)) {
      fs.unlinkSync(config.TOKEN_FILE);
      console.log("🧹 Token cleared");
    }
  } catch (e) {
    console.error("❌ Token clear error:", e.message);
  }
}




module.exports = {
  loadToken,
  saveToken,
  getAccessToken,
  getSessionToken,
  getSid,
  getBaseUrl,
  getWSUrl,
  isTokenExpired,
  hasValidSession,
  clearToken
};