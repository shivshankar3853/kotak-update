const mongoose = require("mongoose");

mongoose.set("strictQuery", false);

let isConnected = false;

async function connectDB() {

  try {

    // ==============================
    // PREVENT DUPLICATE CONNECTION
    // ==============================
    if (isConnected) {

      console.log(
        "⚠️ MongoDB Already Connected"
      );

      return true;
    }

    if (!process.env.MONGO_URI) {
      throw new Error(
        "MONGO_URI Missing"
      );
    }

    console.log(
      "🔄 Connecting MongoDB..."
    );

    await mongoose.connect(
      process.env.MONGO_URI,
      {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10
      }
    );

    isConnected = true;

    console.log(
      "✅ MongoDB Atlas Connected"
    );

    // ==========================================
    // CONNECTION EVENTS
    // ==========================================
    mongoose.connection.removeAllListeners();

    mongoose.connection.on(
      "connected",
      () => {

        console.log(
          "📡 Mongoose connected"
        );
      }
    );

    mongoose.connection.on(
      "error",
      (err) => {

        console.error(
          "❌ Mongoose error:",
          err.message
        );
      }
    );

    mongoose.connection.on(
      "disconnected",
      () => {

        console.log(
          "⚠️ MongoDB disconnected"
        );

        isConnected = false;
      }
    );

    return true;

  } catch (err) {

    isConnected = false;

    console.error(
      "❌ DB Error:",
      err.message
    );

    return false;
  }
}

module.exports = connectDB;