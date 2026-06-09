const Trade = require("./models/Trade");
const { placeOrder } = require("./orderService");

const {
  getTick,
  getTickAsync
} = require("./wsService");

const logger = require("./logger");

async function monitorTargets() {

  try {

    const trades = await Trade.find({
      status: "OPEN"
    });

    for (const trade of trades) {

      try {
        const symbol = trade.instrument || trade.symbol;
        if (!symbol) {
          continue;
        }

        const ltp = await getTickAsync(symbol);

        if (!ltp) {
          continue;
        }

        // BUY TARGET
        if (
          trade.side === "BUY" &&
          trade.targetPrice &&
          ltp >= trade.targetPrice
        ) {

          logger.info(
            `🎯 BUY target hit: ${symbol} @ ${ltp}`
          );

          const orderRes = await placeOrder({
            TS: symbol,
            quantity: trade.quantity,
            transaction_type: "SELL",
            order_type: "MARKET",
            product: "NRML"
          });

          if (!orderRes) {
            logger.error(`❌ Failed to square off BUY target: ${symbol}`);
            continue;
          }

          trade.status = "CLOSED";
          trade.closeReason = "TARGET_HIT";
          trade.exitPrice = ltp;
          trade.exitTime = new Date();

          const entryPrice = Number(trade.entryPrice || trade.price || 0);
          trade.pnl =
            (ltp - entryPrice) *
            trade.quantity;

          await trade.save();

          if (global.io) {
            global.io.emit(
              "targetHit",
              {
                symbol,
                ltp
              }
            );
          }
        }

        // SELL TARGET
        if (
          trade.side === "SELL" &&
          trade.targetPrice &&
          ltp <= trade.targetPrice
        ) {

          logger.info(
            `🎯 SELL target hit: ${symbol} @ ${ltp}`
          );

          const orderRes = await placeOrder({
            TS: symbol,
            quantity: trade.quantity,
            transaction_type: "BUY",
            order_type: "MARKET",
            product: "NRML"
          });

          if (!orderRes) {
            logger.error(`❌ Failed to square off SELL target: ${symbol}`);
            continue;
          }

          trade.status = "CLOSED";
          trade.closeReason = "TARGET_HIT";
          trade.exitPrice = ltp;
          trade.exitTime = new Date();

          const entryPrice = Number(trade.entryPrice || trade.price || 0);
          trade.pnl =
            (entryPrice - ltp) *
            trade.quantity;

          await trade.save();

          if (global.io) {
            global.io.emit(
              "targetHit",
              {
                symbol,
                ltp
              }
            );
          }
        }

      } catch (err) {

        logger.error(
          `Target trade error: ${err.message}`
        );
      }
    }

  } catch (err) {

    logger.error(
      `Monitor target error: ${err.message}`
    );
  }
}

module.exports = {
  monitorTargets
};