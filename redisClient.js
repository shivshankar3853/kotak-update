const { createClient } = require("redis");

let redis = null;

// ================= CREATE CLIENT =================
function createRedisClient() {

  if (redis) {
    return redis;
  }

  const socketOptions = {
    reconnectStrategy: (retries) => {
      console.log(`🔄 Redis reconnect attempt: ${retries}`);
      return Math.min(retries * 1000, 10000);
    }
  };

  if (process.env.REDIS_HOST) {
    socketOptions.host = process.env.REDIS_HOST;
  }

  const redisPort = Number(process.env.REDIS_PORT);
  if (!Number.isNaN(redisPort) && redisPort >= 0 && redisPort < 65536) {
    socketOptions.port = redisPort;
  } else if (process.env.REDIS_PORT) {
    console.log(
      `⚠️ Invalid REDIS_PORT value: ${process.env.REDIS_PORT}`
    );
  }

  const redisOptions = {
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    socket: socketOptions
  };

  if (!socketOptions.host && socketOptions.port === undefined) {
    delete redisOptions.socket;
  }

  redis = createClient(redisOptions);

  // ================= EVENTS =================
  redis.on("connect", () => {

    console.log(
      "🟡 Redis connecting..."
    );
  });

  redis.on("ready", () => {

    console.log(
      "✅ Redis Connected"
    );
  });

  redis.on("reconnecting", () => {

    console.log(
      "🔄 Redis reconnecting..."
    );
  });

  redis.on("error", (err) => {

    console.log(
      "❌ Redis Error:",
      err.message
    );
  });

  redis.on("end", () => {

    console.log(
      "🔌 Redis connection closed"
    );
  });

  return redis;
}

// ================= CONNECT =================
async function connectRedis() {

  try {

    const client =
      createRedisClient();

    if (!client.isOpen) {

      await client.connect();
    }

    return client;

  } catch (err) {

    console.log(
      "Redis connect error:",
      err.message
    );

    return null;
  }
}

// ================= GET CLIENT =================
function getRedisClient() {

  if (!redis) {

    redis = createRedisClient();
  }

  return redis;
}

// ================= DISCONNECT =================
async function disconnectRedis() {

  try {

    if (redis && redis.isOpen) {

      await redis.quit();

      console.log(
        "🛑 Redis disconnected"
      );
    }

  } catch (err) {

    console.log(
      "Redis disconnect error:",
      err.message
    );
  }
}

module.exports = {
  redis: createRedisClient(),
  connectRedis,
  getRedisClient,
  disconnectRedis
};