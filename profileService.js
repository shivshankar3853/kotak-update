const axios = require("axios");
const { getSessionToken, getSid, getBaseUrl } = require("./tokenManager");

async function getProfile() {
  try {
    const sessionToken = getSessionToken();
    const sid = getSid();
    const baseUrl = getBaseUrl();

    if (!sessionToken || !sid || !baseUrl) {
      console.log("⚠️ Profile skipped (not logged in)");
      return {
        loggedIn: false,
        user_name: null,
        user_id: null
      };
    }

    const url = `${baseUrl}/quick/user/profile`;

    try {
      const res = await axios.get(url, {
        headers: {
          Auth: sessionToken,
          Sid: sid,
          "neo-fin-key": "neotradeapi"
        },
        timeout: 8000
      });

      if (res?.data?.stat === "Ok" && res?.data?.data) {
        const data = res.data.data;

        const userId = data.clientId || data.userId || "NA";

        return {
          loggedIn: true,
          user_name: data.clientName || data.userName || "NA",
          user_id: String(userId)
        };
      }

      console.log("⚠️ Invalid profile response (unexpected format)");

    } catch (apiErr) {
      if (apiErr.response?.status === 404) {
        // Profile API not available; fallback will be used.
      } else {
        console.log(
          "⚠️ Profile API error:",
          apiErr.response?.data || apiErr.message
        );
      }
    }

    return {
      loggedIn: true,
      user_name: process.env.CLIENT_NAME || "Kotak User",
      user_id: String(process.env.UCC || "NA")
    };

  } catch (err) {
    console.error("❌ Profile Service Error:", err.message);

    return {
      loggedIn: false,
      user_name: null,
      user_id: null
    };
  }
}

module.exports = { getProfile };