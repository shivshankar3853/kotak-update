const WebSocket = require("ws");
const logger = require("./logger");

const {
  getSessionToken,
  getWSUrl
} = require("./tokenManager");

const {
  getRedisClient
} = require("./redisClient");

const { sessionBus } = require("./sessionManager");

const redis = getRedisClient();

const tickStore = new Map();

let ws = null;
let reconnectTimeout = null;
let heartbeatInterval = null;
let watchdogInterval = null;

let lastPong = Date.now();
let connected = false;
let reconnecting = false;

// ================= SESSION UPDATE HANDLER =================
let sessionReconnectTimer = null;

sessionBus.on("sessionUpdated", () => {

  if (sessionReconnectTimer) return;

  sessionReconnectTimer = setTimeout(() => {

    sessionReconnectTimer = null;

    logger.info("🔄 Session updated → reconnect WS");

    shutdown();
    connectWS();

  }, 1000);
});

// ================= CLEANUP =================
function cleanupWS() {

  connected = false;

  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (watchdogInterval) clearInterval(watchdogInterval);

  heartbeatInterval = null;
  watchdogInterval = null;

  if (ws) {
    try {
  if (ws && ws.readyState !== WebSocket.CLOSED) {
    ws.removeAllListeners();
    ws.terminate();
  }
} catch (_) {}
    ws = null;
  }
}

// ================= RECONNECT =================
function scheduleReconnect() {

  if (reconnecting) return;

  reconnecting = true;

  reconnectTimeout = setTimeout(() => {

    reconnecting = false;

    logger.info("🔄 Reconnecting WS...");

    connectWS();

  }, 5000);
}

// ================= CONNECT =================
async function connectWS() {

  try {

    const token = getSessionToken();
    const wsUrl = getWSUrl();

    if (!token || !wsUrl) {
      logger.error("⚠️ Missing WS token/url");
      scheduleReconnect();
      return;
    }

    cleanupWS();

    logger.info("🔌 Connecting WS...");

    ws = new WebSocket(wsUrl);

    // ================= OPEN =================
    ws.on("open", () => {

      connected = true;
      lastPong = Date.now();

      logger.info("📡 WS Connected");

      ws.send(JSON.stringify({
        type: "subscribe",
        token
      }));

      heartbeatInterval = setInterval(() => {

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }

      }, 20000);

      watchdogInterval = setInterval(() => {

        const now = Date.now();

        if (now - lastPong > 60000) {

          logger.error("⚠️ WS heartbeat timeout");

          cleanupWS();
          scheduleReconnect();
        }

      }, 30000);
    });

    // ================= PONG =================
    ws.on("pong", () => {
      lastPong = Date.now();
    });

    // ================= MESSAGE =================
    ws.on("message", async (data) => {

      try {

        lastPong = Date.now();

        const parsed = JSON.parse(data);

        const symbol =
          parsed.symbol ||
          parsed.ts ||
          parsed.instrument;

        const ltp = Number(
          parsed.ltp ||
          parsed.lastPrice ||
          0
        );

        if (symbol && ltp) {

          const tick = {
            ltp,
            time: Date.now()
          };

          tickStore.set(symbol, tick);

          if (redis?.isOpen) {
            await redis.set(
              `tick:${symbol}`,
              JSON.stringify(tick),
              { EX: 60 }
            );
          }
        }

        global.io?.emit("tick", parsed);

      } catch (err) {
        logger.error(`WS parse error: ${err.message}`);
      }
    });

    // ================= CLOSE =================
    ws.on("close", () => {

      connected = false;

      logger.error("🔌 WS Disconnected");

      cleanupWS();
      scheduleReconnect();
    });

    // ================= ERROR =================
    ws.on("error", (err) => {

      connected = false;

      logger.error(`❌ WS Error: ${err.message}`);
    });

  } catch (err) {

    logger.error(`WS connect error: ${err.message}`);

    scheduleReconnect();
  }
}

// ================= API =================
function getTick(symbol) {
  return tickStore.get(symbol)?.ltp || 0;
}

// async version: checks in-memory store, then Redis cache if available
async function getTickAsync(symbol) {
  if (!symbol) return 0;

  const mem = tickStore.get(symbol);
  if (mem && mem.ltp) return mem.ltp;

  try {
    if (redis && redis.isOpen) {
      const raw = await redis.get(`tick:${symbol}`);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const ltp = Number(parsed.ltp || parsed.value || 0) || 0;
          return ltp;
        } catch (_) {
          const n = Number(raw);
          if (!isNaN(n)) return n;
        }
      }
    }
  } catch (err) {
    logger.error(`Redis tick read error: ${err.message}`);
  }

  return 0;
}

function isWSConnected() {
  return connected;
}

// ================= SHUTDOWN =================
function shutdown() {

  logger.info("🛑 Closing WS...");

  cleanupWS();

  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = null;
}

// ================= EXPORTS =================
module.exports = {
  connectWS,
  getTick,
  getTickAsync,
  isWSConnected,
  shutdown
};