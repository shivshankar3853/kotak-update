const MONTH_MAP = {
  1: "JAN",
  2: "FEB",
  3: "MAR",
  4: "APR",
  5: "MAY",
  6: "JUN",
  7: "JUL",
  8: "AUG",
  9: "SEP",
  10: "OCT",
  11: "NOV",
  12: "DEC"
};

function decodeSymbol(raw) {
  const match = raw.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})(\d+)(CE|PE)$/);

  if (!match) {
    throw new Error("Invalid symbol format: " + raw);
  }

  const [, index, year, month, day, strike, type] = match;

  const shortYear = year; // ✅ unchanged

  const monthName = MONTH_MAP[Number(month)];

  if (!monthName) {
    throw new Error("Invalid month in symbol");
  }

  // ✅ YOUR ORIGINAL FORMAT (UNCHANGED)
  const tradingSymbol = `${index} ${strike} ${type} ${day} ${monthName} ${shortYear}`;

  // 🔥 KOTAK FORMAT (ADDED ONLY)
  const kotakSymbol = `${index} ${day} ${monthName} ${shortYear} ${type} ${strike}`;

  return {
    index,
    strike,
    type,
    day,
    month: monthName,
    year: shortYear,

    tradingSymbol,   // 👈 keep existing (no break)
    kotakSymbol,     // 👈 NEW (use this in order API)

    isDecoded: true
  };
}

module.exports = { decodeSymbol };