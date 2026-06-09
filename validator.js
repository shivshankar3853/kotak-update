function validateSignal(s) {

  if (!s || typeof s !== "object") {
    return { ok: false, error: "Invalid signal object" };
  }

  let { TS, TT, Q, OT } = s;

  if (typeof TS !== "string" || !TT || Q === undefined) {
    return { ok: false, error: "Missing required fields (TS, TT, Q)" };
  }

  TS = TS.trim().toUpperCase();
  TS = TS.replace(/\s+/g, "");

  if (
    TS.length < 5 ||
    TS.length > 50 ||
    !/^[A-Z0-9][A-Z0-9:_\-.|]{3,49}$/.test(TS)
  ) {
    return { ok: false, error: "Invalid symbol format" };
  }

  if (typeof TT !== "string") {
    return { ok: false, error: "Invalid transaction type" };
  }

  const action = TT.trim().toUpperCase();

  if (action !== "BUY" && action !== "SELL") {
    return { ok: false, error: "Invalid transaction type (BUY/SELL only)" };
  }

  if (
    (typeof Q !== "number" && !/^\d+$/.test(String(Q))) ||
    isNaN(Q)
  ) {
    return { ok: false, error: "Invalid quantity" };
  }

  const qty = Number(Q);

  if (qty <= 0 || qty > 100000) {
    return { ok: false, error: "Invalid quantity range" };
  }

  OT = OT ? String(OT).trim().toUpperCase() : "MARKET";

  if (!["MARKET", "LIMIT", "SL"].includes(OT)) {
    return { ok: false, error: "Invalid order type" };
  }

  return {
    ok: true,
    data: {
      TS,
      TT: action,
      Q: qty,
      OT
    }
  };
}

module.exports = { validateSignal };