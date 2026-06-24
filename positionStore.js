// ================= POSITION STORE =================

let positions = [];

// ================= SET POSITIONS =================
function setPositions(data = []) {

  if (!Array.isArray(data)) {
    positions = [];
    return;
  }

  positions = data;
}

// ================= GET POSITIONS =================
function getPositions() {

  return positions || [];
}

// ================= CLEAR POSITIONS =================
function clearPositions() {

  positions = [];
}

module.exports = {
  setPositions,
  getPositions,
  clearPositions
};