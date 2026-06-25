const WebSocket = require("ws");
const logger = require("./logger");
const LTPModel = require("./models/LTP");

const {
  getSessionToken,
  getSid,
  getWSUrl
} = require("./tokenManager");

const { findInstrument } = require("./instrumentStore");
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

const subscribedTokens = new Set();

function normalizeSymbol(symbol) {
  return (symbol || "").toString().trim().toUpperCase();
}

function buildInstrumentToken(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;

  if (normalized.includes("|")) {
    return normalized;
  }

  const instrument = findInstrument(normalized);
  const exchange = instrument?.es ? instrument.es.trim() : null;
  const tokenSymbol = instrument?.ts || normalized;

  if (exchange) {
    return `${exchange}|${tokenSymbol}`;
  }

  return normalized;
}

function buildSubscribePayload(tokens) {
  if (!tokens || !tokens.length) return null;

  return JSON.stringify({
    type: "subscribe",
    instrumentTokens: tokens
  });
}

function sendPendingSubscriptions() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const tokens = Array.from(subscribedTokens);
  if (!tokens.length) return;

  const payload = buildSubscribePayload(tokens);
  if (payload) {
    if (process.env.DEBUG_LTP === "true") {
      logger.info("📡 WS subscribing pending tokens", { tokens });
    }
    ws.send(payload);
  }
}

async function subscribeSymbols(symbols) {
  if (!symbols) return;

  const items = Array.isArray(symbols) ? symbols : [symbols];
  const tokens = items
    .map(buildInstrumentToken)
    .filter(Boolean);

  let added = false;
  for (const token of tokens) {
    if (!subscribedTokens.has(token)) {
      subscribedTokens.add(token);
      added = true;
    }
  }

  if (!added) return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    const payload = buildSubscribePayload(tokens);
    if (payload) {
      if (process.env.DEBUG_LTP === "true") {
        logger.info("📡 WS subscribe request", { tokens });
      }
      ws.send(payload);
    }
  }
}

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
    const sid = getSid();
    const wsUrl = getWSUrl();

    if (!token || !sid || !wsUrl) {
      logger.error("⚠️ Missing WS token/sid/url");
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

      const authPayload = `{type:cn,Authorization:${token},Sid:${sid},src:WEB}`;
      ws.send(authPayload);

      sendPendingSubscriptions();

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
          parsed.instrument ||
          parsed.instrumentToken ||
          parsed.token ||
          parsed.tkn;

        const ltp = Number(
          parsed.ltp ||
          parsed.lastPrice ||
          parsed.last_price ||
          parsed.lp ||
          0
        );

        if (symbol && ltp) {

          const tick = {
            ltp,
            time: Date.now()
          };

          const keys = new Set([
            normalizeSymbol(parsed.symbol),
            normalizeSymbol(parsed.ts),
            normalizeSymbol(parsed.instrument),
            normalizeSymbol(parsed.instrumentToken),
            normalizeSymbol(parsed.token),
            normalizeSymbol(parsed.tkn)
          ]);

          const primarySymbol = normalizeSymbol(symbol) || Array.from(keys).find(Boolean);

          for (const key of keys) {
            if (key) tickStore.set(key, tick);
          }

          if (redis?.isOpen) {
            for (const key of keys) {
              if (!key) continue;
              await redis.set(
                `tick:${key}`,
                JSON.stringify(tick),
                { EX: 60 }
              );
            }
          }

          if (primarySymbol) {
            try {
              await LTPModel.findOneAndUpdate(
                { symbol: primarySymbol },
                {
                  symbol: primarySymbol,
                  ltp,
                  source: "WS",
                  raw: parsed,
                  timestamp: new Date()
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
              );
            } catch (e) {
              logger.error(`❌ LTP persistence error: ${e.message}`);
            }
          }
        }

        global.io?.emit("tick", parsed);
        global.io?.emit("realtime", parsed);

        if (parsed.order || parsed.orderId || parsed.status) {
          global.io?.emit("order-event", parsed);
        }

        if (parsed.position || parsed.positions || parsed.type === "position") {
          global.io?.emit("position-event", parsed);
        }
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
  const key = normalizeSymbol(symbol);
  return tickStore.get(key)?.ltp || 0;
}

// async version: checks in-memory store, then Redis cache if available
async function getTickAsync(symbol) {
  if (!symbol) return 0;

  const key = normalizeSymbol(symbol);
  const mem = tickStore.get(key);
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