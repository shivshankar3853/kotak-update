const axios = require("axios");
const logger = require("./logger");
const BrokerPosition = require("./models/BrokerPosition");
const { getLTP: getLTPFromEngine } = require("./ltpEngine");
const { getLTP: getLTPFromPriceService } = require("./priceService");

const { getSession } = require("./sessionManager");
const { isTokenExpired } = require("./tokenManager");

let cachedPositions = [];
let lastFetchTime = 0;

const CACHE_TTL = 5000; // 5 sec

// rate-limit repetitive missing-session warnings
let lastMissingSessionLog = 0;
const MISSING_SESSION_LOG_INTERVAL = 60 * 1000; // 1 minute

// ================= FETCH POSITIONS =================
async function fetchPositions(force = false) {
  try {

    const session = getSession();

  
    const sessionToken = session?.token || session?.session_token;
    const sid = session?.sid;
    const baseUrl = session?.baseUrl;

    if (!sessionToken || !sid || !baseUrl) {
      const now = Date.now();
      if (now - lastMissingSessionLog > MISSING_SESSION_LOG_INTERVAL) {
        logger.warn("⚠️ Missing session for positions");
        lastMissingSessionLog = now;
      }

      return cachedPositions;
    }

    // cache throttle
    const now = Date.now();
    if (!force && now - lastFetchTime < CACHE_TTL) {
      return cachedPositions;
    }

    if (isTokenExpired()) {
      logger.warn("🔁 Token expired → returning cached positions");
      return cachedPositions;
    }

    const url = `${baseUrl}/quick/user/positions`;

    logger.info(`📡 Fetching positions: ${url}`);

    const headers = {
      Auth: sessionToken,
      Sid: sid,
      "neo-fin-key": "neotradeapi"
    };

    const response = await axios.get(url, {
      headers,
      timeout: 10000
    });

    const positions =
      response.data?.data ||
      response.data?.Success ||
      response.data ||
      [];

    cachedPositions = Array.isArray(positions)
      ? positions
      : [];

    lastFetchTime = now;

    if (Array.isArray(cachedPositions) && cachedPositions.length > 0) {
      await Promise.all(
        cachedPositions.map(async (pos) => {
          const rawInstrument =
            pos.TS ||
            pos.symbol ||
            pos.ticker ||
            pos.instrument ||
            pos.s ||
            pos.ts ||
            null;

          // normalize stored instrument to a consistent alphanumeric-only form
          let instrument = null;
          try {
            instrument = String(rawInstrument || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (/^[A-Z]+EQ$/.test(instrument)) {
              instrument = instrument.replace(/EQ$/, "");
            }
          } catch (_) {
            instrument = rawInstrument;
          }

          if (!instrument) return;

          const side =
            pos.side ||
            pos.transaction_type ||
            pos.tt ||
            pos.action ||
            null;

          const quantity = Number(
            pos.quantity || pos.qty || pos.Q || 0
          );

          const averagePrice = Number(
            pos.averagePrice ||
            pos.avg_price ||
            pos.price ||
            0
          );

          const marketValue = Number(
            pos.marketValue || pos.MV || pos.value || 0
          );

          const pnl = Number(
            pos.pnl || pos.PnL || pos.profit || pos.profitLoss || 0
          );

          const status = pos.status || "OPEN";

          try {
            await BrokerPosition.findOneAndUpdate(
              { instrument },
              {
                instrument,
                side,
                quantity,
                averagePrice,
                marketValue,
                pnl,
                status,
                raw: pos,
                updatedAt: new Date()
              },
              {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
              }
            );
          } catch (e) {
            logger.error(`❌ BrokerPosition persistence error: ${e.message}`);
          }
        })
      );
    }

    logger.info(`📊 Positions Loaded: ${cachedPositions.length}`);

    return cachedPositions;

  } catch (err) {

    logger.error(`❌ Position fetch error: ${err.message}`);

    if (err.response) {

      logger.error(
        `📡 API Response: ${JSON.stringify(err.response.data)}`
      );

      // 🔥 AUTO RECOVER ON INVALID SESSION
      if (err.response.status === 401) {
        logger.warn("🔁 401 detected → invalid session or expired token");
      }
    }

    return cachedPositions;
  }
}

// ================= PUBLIC =================
async function getPositions() {
  try {
    const raw = await fetchPositions();

    if (!Array.isArray(raw)) return [];

    // Map raw broker positions into normalized objects the UI expects
    const mapped = await Promise.all(
      raw.map(async (pos) => {
        // prefer explicit trading symbol fields from broker response
        const rawTrdSym = pos.trdSym || pos.trdSymbol || pos.trd_sym || pos.trd || null;

        const rawInstrument =
          pos.TS || pos.symbol || pos.ticker || pos.instrument || pos.s || pos.ts || pos.sym || rawTrdSym || "";

        // normalized id used for lookups
        let instrument = String(rawInstrument || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (/^[A-Z]+EQ$/.test(instrument)) {
          instrument = instrument.replace(/EQ$/, "");
        }

        // compute quantity from known fields (prefer explicit quantity, else compute net filled qty)
        const explicitQty = Number(pos.quantity || pos.qty || pos.Q || 0);
        const flBuy = Number(pos.flBuyQty || pos.fl_buy_qty || pos.flBuy || 0);
        const flSell = Number(pos.flSellQty || pos.fl_sell_qty || pos.flSell || 0);
        const cfBuy = Number(pos.cfBuyQty || pos.cf_buy_qty || pos.cfBuy || 0);
        const cfSell = Number(pos.cfSellQty || pos.cf_sell_qty || pos.cfSell || 0);

        let quantity = explicitQty;
        if (!quantity) {
          const netFl = flBuy - flSell;
          const netCf = cfBuy - cfSell;
          quantity = netFl || netCf || 0;
        }

        // determine side from quantity if not explicitly provided
        let side = String(pos.side || pos.transaction_type || pos.tt || pos.action || "").toUpperCase();
        if (!side) {
          if (quantity > 0) side = "BUY";
          else if (quantity < 0) side = "SELL";
          else side = "FLAT";
        }

        const pnl = Number(pos.pnl || pos.PnL || pos.profit || pos.profitLoss || 0);

        // get current LTP if possible (fallback to broker-provided values)
        let last_price = Number(pos.lastPrice || pos.ltp || pos.last || pos.MV || 0);
        try {
          // Prefer priceService.getLTP (includes session headers); fallback to engine
          let l = 0;
          try {
            l = await getLTPFromPriceService(instrument || rawTrdSym || pos.sym);
          } catch (_) {
            // ignore
          }

          if (!l || l === 0) {
            try {
              l = await getLTPFromEngine(instrument || rawTrdSym || pos.sym);
            } catch (_) {}
          }

          if (l && l > 0) last_price = l;
        } catch (_) {}

        // Fallback: derive a sensible last_price from broker fields when LTP not available
        if (!last_price || last_price === 0) {
          try {
            const buyAmt = Number(pos.buyAmt || pos.cfBuyAmt || 0);
            const sellAmt = Number(pos.sellAmt || pos.cfSellAmt || 0);
            const flBuy = Number(pos.flBuyQty || pos.flBuy || 0);
            const flSell = Number(pos.flSellQty || pos.flSell || 0);
            const cfBuy = Number(pos.cfBuyQty || pos.cfBuyQty || 0) || Number(pos.cfBuyQty || 0);
            const cfSell = Number(pos.cfSellQty || pos.cfSellQty || 0) || Number(pos.cfSellQty || 0);

            if (flBuy > 0 && buyAmt > 0) {
              last_price = buyAmt / flBuy;
            } else if (flSell > 0 && sellAmt > 0) {
              last_price = sellAmt / flSell;
            } else if (cfBuy > 0 && buyAmt > 0) {
              last_price = buyAmt / cfBuy;
            } else if (cfSell > 0 && sellAmt > 0) {
              last_price = sellAmt / cfSell;
            }

            if ((!last_price || last_price === 0) && (buyAmt > 0 || sellAmt > 0)) {
              // as a last resort, use the smaller of buy/sell amounts
              last_price = (buyAmt > 0 && sellAmt > 0) ? Math.min(buyAmt, sellAmt) : Math.max(buyAmt, sellAmt);
            }

            if (process.env.DEBUG === "true") {
              console.log("🔁 LTP fallback for", trading_symbol || instrument || rawTrdSym, "=>", last_price);
            }
          } catch (_) {}
        }

        // present a readable trading symbol for the UI
        const trading_symbol = rawTrdSym || pos.trdSym || pos.trdSymbol || pos.sym || rawInstrument || instrument;

        if (typeof last_price === "number" && !Number.isNaN(last_price)) {
          last_price = Number(last_price.toFixed(2));
        }

        return {
          trading_symbol,
          quantity,
          side,
          last_price,
          pnl,
          raw: pos
        };
      })
    );

    return mapped;
  } catch (err) {
    logger.error(`getPositions mapping error: ${err.message}`);
    return [];
  }
}

module.exports = {
  getPositions,
  fetchPositions
};