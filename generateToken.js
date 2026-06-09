const fs = require("fs");

const path = require("path");

// ======================================================
// 🔥 PUT REAL VALUES FROM KOTAK LOGIN RESPONSE
// ======================================================
const tokenData = {

  access_token:
    "PASTE_ACCESS_TOKEN_HERE",

  session_token:
    "PASTE_SESSION_TOKEN_HERE",

  sid:
    "PASTE_SID_HERE",

  baseUrl:
    "https://api.kotaksecurities.com"
};

// ======================================================
// ✅ VALIDATE TOKEN DATA
// ======================================================
if (

  !tokenData.access_token ||
  !tokenData.session_token ||
  !tokenData.sid ||
  !tokenData.baseUrl ||

  tokenData.access_token.includes("PASTE_") ||
  tokenData.session_token.includes("PASTE_") ||
  tokenData.sid.includes("PASTE_")

) {

  console.log(
    "❌ Please replace all placeholder token values"
  );

  process.exit(1);
}

// ======================================================
// 📁 TOKEN FILE PATH
// ======================================================
const tokenFilePath = path.join(
  __dirname,
  "token.json"
);

// ======================================================
// 💾 WRITE TOKEN FILE
// ======================================================
try {

  fs.writeFileSync(
    tokenFilePath,
    JSON.stringify(
      tokenData,
      null,
      2
    )
  );

  console.log(
    "✅ Kotak token.json created"
  );

} catch (err) {

  console.log(
    "❌ Failed to create token.json:",
    err.message
  );
}