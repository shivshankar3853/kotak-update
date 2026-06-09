const recent = new Map();

function normalize(val) {
  return (val || "").toString().trim();
}

function isDuplicate(signal) {
  if (!signal) return true;

  const key = `${normalize(signal.TS)}_${normalize(signal.TT)}_${normalize(signal.Q)}`;

  const now = Date.now();

  // ==========================================
  // ATOMIC INSERT (safer race handling)
  // ==========================================
  if (recent.has(key)) {
    return true;
  }

  recent.set(key, now);

  // safer cleanup (non-blocking + avoids timer explosion)
  if (!recent.cleanupScheduled) {
    recent.cleanupScheduled = true;

    setTimeout(() => {
      const cutoff = Date.now() - 10000;

      for (const [k, v] of recent.entries()) {
        if (v < cutoff) {
          recent.delete(k);
        }
      }

      recent.cleanupScheduled = false;
    }, 5000);
  }

  return false;
}

module.exports = { isDuplicate };