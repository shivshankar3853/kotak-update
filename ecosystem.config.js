module.exports = {
  apps: [
    {
      name: "algo",

      script: "server.js",

      // ================= MODE =================
      exec_mode: "fork",
      instances: 1,

      // ================= AUTO RESTART =================
      autorestart: true,
      watch: false,

      restart_delay: 5000,
      exp_backoff_restart_delay: 100,

      max_restarts: 20,
      min_uptime: "10s",

      // ================= MEMORY =================
      max_memory_restart: "500M",

      node_args: "--max-old-space-size=512",

      // ================= SHUTDOWN =================
      kill_timeout: 5000,
      listen_timeout: 10000,

      // ================= LOGS =================
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",

      time: true,
      merge_logs: true,

      // ================= ENV =================
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    }
  ]
};