function errorHandler(err, req, res, next) {

  console.error(
    "Central Error:",
    err?.message || err
  );

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    success: false,
    error: err?.message || "Internal server error"
  });
}

module.exports = errorHandler;