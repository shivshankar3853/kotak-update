require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");

const apiLimiter = require("./rateLimiter");
const errorHandler = require("./errorHandler");
const logger = require("./logger");

const {
  connectRedis,
  redis
} = require("./redisClient");

const { setSession, getSession } = require("./sessionManager");

// ================= FLAGS =================
let squareOffDone = false;
let intervalsStarted = false;
let serverStarted = false;
let shuttingDown = false;
let wsReconnectLock = false;

// ================= SERVICES =================
const connectDB = require("./db");

const {
  loadToken,
  getSessionToken,
  getSid,
  getBaseUrl,
  isTokenExpired,
  hasValidSession
} = require("./tokenManager");

const {
  handleWebhook
} = require("./webhookController");

const {
  login
} = require("./authController");

const {
  getPositions
} = require("./positionService");

const {
  getTradeLog
} = require("./orderService");

const {
  ensureLocalFile
} = require("./instrumentStore");

const Trade = require("./models/Trade");

const {
  startTrading,
  stopTrading,
  isTradingEnabled
} = require("./control");

const {
  getProfile
} = require("./profileService");

const {
  monitorTrailingSL
} = require("./trailingSL");

const {
  connectWS,
  isWSConnected,
  shutdown
} = require("./wsService");

const {
  squareOffAll
} = require("./squareOff");

const {
  monitorTrades
} = require("./riskManager");

const {
  monitorTargets
} = require("./targetEngine");

const {
  calculatePnL
} = require("./pnlService");

// ================= APP =================
const app = express();
const server = http.createServer(app);

// ================= SERVER HARDENING =================
server.timeout = 30000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// ================= SOCKET IO =================
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000
});

global.io = io;

process.on("unhandledRejection", (reason, promise) => {
  logger.error(`UnhandledRejection: ${reason?.stack || reason}`);
});

process.on("uncaughtException", (err) => {
  logger.error(`UncaughtException: ${err?.stack || err?.message}`);
});

// ================= MIDDLEWARE =================
app.use(express.json({ limit: "1mb" }));
app.use(apiLimiter);

// JSON parse error handler - returns clear 400 for invalid JSON bodies
app.use((err, req, res, next) => {
  try {
    if (err && err.type === "entity.parse.failed") {
      logger.error("❌ JSON parse error in request body");
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  } catch (e) {
    // ignore
  }
  next(err);
});

const publicDir = path.join(__dirname, "public");
const frontendDir = path.join(__dirname, "frontend");

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
} else if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
} else {
  logger.warn(
    "⚠️ No static asset folder found (public/frontend). Static file serving disabled."
  );
}

// ================= DUPLICATE HELPERS =================
const recentTrades = new Map();

function isRecent(symbol) {
  if (!symbol) return false;

  const now = Date.now();

  if (recentTrades.has(symbol) && now - recentTrades.get(symbol) < 5000) {
    return true;
  }

  recentTrades.set(symbol, now);
  return false;
}

// ================= CLEANUP =================
setInterval(() => {
  try {
    const now = Date.now();

    for (const [key, time] of recentTrades.entries()) {
      if (now - time > 60000) {
        recentTrades.delete(key);
      }
    }
  } catch (err) {
    logger.error(`Duplicate cleanup error: ${err.message}`);
  }
}, 60000);

// ================= DB DUPLICATE =================
async function isDuplicateTrade(symbol) {
  try {
    if (!symbol) return false;

    const existing = await Trade.findOne({
      instrument: symbol,
      status: "OPEN"
    });

    return !!existing;
  } catch (err) {
    logger.error(`Duplicate check error: ${err.message}`);
    return false;
  }
}

// ================= INIT =================
async function init() {
  try {
    logger.info("⬇️ Initializing Kotak Algo System...");

    const dbConnected = await connectDB();

    if (!dbConnected) {
      logger.warn("⚠️ MongoDB not configured or connection failed. Running in degraded mode.");
    }

    mongoose.connection.on("connected", () =>
      logger.info("✅ MongoDB connected")
    );

    mongoose.connection.on("disconnected", () =>
      logger.error("❌ MongoDB disconnected")
    );

    mongoose.connection.on("reconnected", () =>
      logger.info("🔄 MongoDB reconnected")
    );

    mongoose.connection.on("error", (err) =>
      logger.error(`MongoDB error: ${err.message}`)
    );

    await connectRedis();

    loadToken();

    const token = getSessionToken();
    const sid = getSid();
    const baseUrl = getBaseUrl();

    logger.info("🧠 SESSION RAW CHECK:", {
      tokenPresent: !!token,
      sidPresent: !!sid,
      baseUrlPresent: !!baseUrl
    });

    const isValid = !!(token && sid && baseUrl);

    if (isValid) {
      const sessionData = {
        token,
        sid,
        baseUrl
      };

      setSession(sessionData, { emit: false });

      logger.info("🔐 Session restored from saved token");
      logger.info("🧠 SESSION ACTIVE:", sessionData);

    } else {
      setSession({
        token: null,
        sid: null,
        baseUrl: null
      });

      logger.warn("⚠️ No valid saved session found");
    }

    await ensureLocalFile();

    logger.info("✅ System ready (Kotak Trade API)");

  } catch (err) {
    logger.error(`❌ Init failed: ${err.stack || err.message}`);
    process.exit(1);
  }
}

// ================= ROUTES =================
app.get("/", (req, res) => {
  const publicIndex = path.join(__dirname, "public", "index.html");
  const frontendIndex = path.join(__dirname, "frontend", "index.html");

  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  }

  if (fs.existsSync(frontendIndex)) {
    return res.sendFile(frontendIndex);
  }

  return res.send("🚀 Kotak Algo Server Running");
});

app.get("/login", (req, res) => res.send("Use POST /login to authenticate"));
app.post("/login", login);

app.get("/profile", async (req, res) => {
  try {
    const profile = await getProfile();

    res.json({
      loggedIn: Boolean(profile?.loggedIn),
      name: profile?.user_name || null,
      clientId: profile?.user_id || null
    });
  } catch (err) {
    logger.error(`Profile route error: ${err.message}`);
    res.status(500).json({
      loggedIn: false,
      name: null,
      clientId: null
    });
  }
});

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  try {
    if (!isTradingEnabled()) return res.send("Trading disabled");
    if (isTokenExpired()) return res.send("Token expired");

    const data = req.body || {};
    
    // Check for symbol using multiple possible field names (consistent with normalizeSignal)
    const symbol = data.TS || 
                   data.symbol || 
                   data.ticker || 
                   data.s || 
                   data.instrument;

    if (!symbol) return res.status(400).json({ status: "invalid signal", errors: ["Missing required field: symbol (TS, symbol, ticker, s, or instrument)"] });

    if (isRecent(symbol)) {
      logger.warn(`⚠️ Fast duplicate blocked: ${symbol}`);
      return res.send("Blocked duplicate");
    }

    const duplicate = await isDuplicateTrade(symbol);

    if (duplicate) {
      logger.warn(`⚠️ DB duplicate blocked: ${symbol}`);
      return res.send("Blocked (duplicate trade)");
    }

    await handleWebhook(req, res);

  } catch (err) {
    logger.error(`Webhook error: ${err.stack || err.message}`);
    res.status(500).send("Error");
  }
});

// ================= STATUS =================
app.get("/status", (req, res) => {
  const session = getSession();

  res.json({
    server: "running",
    tokenExpired: isTokenExpired(),
    trading: isTradingEnabled(),
    mongo: mongoose.connection.readyState === 1,
    redis: redis?.isOpen || false,
    ws: isWSConnected(),
    session,
    time: new Date()
  });
});

// ================= HEALTH =================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    mongo: mongoose.connection.readyState === 1,
    redis: redis?.isOpen || false,
    trading: isTradingEnabled(),
    ws: isWSConnected(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pid: process.pid,
    time: new Date()
  });
});

// ================= POSITIONS =================
app.get("/positions", async (req, res) => {
  try {
    const positions = await getPositions();
    res.json(positions);
  } catch (err) {
    logger.error(`Positions error: ${err.message}`);
    res.status(500).send("Error fetching positions");
  }
});

// ================= TRADES =================
app.get("/trades", async (req, res) => {
  try {
    const trades = await getTradeLog();
    res.json(trades);
  } catch (err) {
    logger.error(`Trades error: ${err.message}`);
    res.status(500).send("Error fetching trades");
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 10000;

async function startServer() {
  if (serverStarted) return;

  serverStarted = true;

  await init();

  startIntervals();

  const session = getSession();

  try {
    if (session?.token && session?.sid && session?.baseUrl) {
      logger.info("🔐 Using saved session");
      await connectWS();
    } else {
      logger.warn("⚠️ No session. Please login using POST /login");
    }
  } catch (err) {
    logger.error(`WS init error: ${err.message}`);
  }

  server.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
  });

  server.on("error", (err) => {
    logger.error(`HTTP Server error: ${err.message}`);
  });
}

// ================= INTERVALS =================
function startIntervals() {
  if (intervalsStarted) return;
  intervalsStarted = true;

  logger.info("⏱️ Starting background services...");

  setInterval(async () => {
    try {
      if (mongoose.connection.readyState !== 1) return;
      await monitorTrailingSL();
    } catch (e) {
      logger.error(`Trailing SL error: ${e.message}`);
    }
  }, 10000);

  setInterval(async () => {
    try {
      if (mongoose.connection.readyState !== 1) return;
      await monitorTargets();
    } catch (e) {
      logger.error(`Target engine error: ${e.message}`);
    }
  }, 3000);

  setInterval(async () => {
    try {
      if (mongoose.connection.readyState !== 1) return;
      await monitorTrades();
    } catch (e) {
      logger.error(`Risk manager error: ${e.message}`);
    }
  }, 5000);

  setInterval(async () => {
    try {
      const pnl = await calculatePnL();
      global.io?.emit("pnl", pnl);
    } catch (err) {
      logger.error(`PnL error: ${err.message}`);
    }
  }, 10000);
}

// ================= ERROR HANDLER =================
app.use(errorHandler);

// ================= BOOT =================
startServer();
