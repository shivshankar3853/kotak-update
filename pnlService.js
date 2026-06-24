const { getPositions } = require("./positionService");
const { getLTP } = require("./ltpEngine");

async function calculatePnL() {
  try {
    const positions = await getPositions();

    if (!Array.isArray(positions) || positions.length === 0) {
      return { totalPnL: 0, positions: [] };
    }

    let totalPnL = 0;
    const enriched = [];

    // ==============================
    // 🔥 STEP 1: SAFE PARALLEL LTP FETCH (BULLETPROOF)
    // ==============================
    const ltpPromises = positions.map(async (p) => {
      try {
        let ltpRaw = p?.ltp;

        let ltp = Number(ltpRaw);

        // fetch only if invalid
        if (!Number.isFinite(ltp) || ltp <= 0) {
          const fetched = await getLTP(p?.instrument || p?.ts || p?.symbol);
          ltp = Number(fetched);
        }

        // final safety
        if (!Number.isFinite(ltp) || ltp < 0) ltp = 0;

        return ltp;
      } catch {
        return 0;
      }
    });

    const ltps = await Promise.all(ltpPromises);

    // ==============================
    // 🔥 STEP 2: PNL CALCULATION (CLEAN + SAFE MATH)
    // ==============================
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const ltp = ltps[i] ?? 0;

      const qty = Number(p?.netQty) || 0;
      const buy = Number(p?.buyAvg) || 0;
      const sell = Number(p?.sellAvg) || 0;

      let pnl = 0;

      // ==========================
      // PRIORITY: TRUST EXISTING PNL ONLY IF VALID
      // ==========================
      const existingPnL = Number(p?.pnl);

      if (Number.isFinite(existingPnL)) {
        pnl = existingPnL;
      } else {
        // ==========================
        // LIVE PNL CALCULATION
        // ==========================
        if (qty > 0 && buy > 0 && ltp > 0) {
          pnl = (ltp - buy) * qty;
        } 
        else if (qty < 0 && sell > 0 && ltp > 0) {
          pnl = (sell - ltp) * Math.abs(qty);
        } 
        else {
          pnl = 0;
        }
      }

      // final safety clamp (VERY IMPORTANT in trading systems)
      pnl = Number.isFinite(pnl) ? pnl : 0;

      totalPnL += pnl;

      enriched.push({
        ...p,
        ltp,
        livePnL: pnl
      });
    }

    totalPnL = Number.isFinite(totalPnL) ? totalPnL : 0;

    return {
      totalPnL,
      positions: enriched
    };

  } catch (err) {
    console.error("❌ PnL Error:", err?.message || err);

    return {
      totalPnL: 0,
      positions: []
    };
  }
}

module.exports = { calculatePnL };