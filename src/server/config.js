// Hằng số dùng chung toàn server — gom một chỗ để khỏi đi tìm.
const path = require("path");
const os = require("os");

module.exports = {
  PORT: +(process.env.PORT || 7799),
  PROJECTS_DIR: path.join(os.homedir(), ".claude", "projects"),
  HERMES_DB: path.join(os.homedir(), ".hermes", "state.db"),
  HERMES_LOG: path.join(os.homedir(), ".hermes", "logs", "agent.log"),
  HERMES_BIN: process.env.HERMES_BIN || path.join(os.homedir(), ".hermes", "hermes-agent", "venv", "bin", "hermes"),
  HERMES_MODEL: process.env.HERMES_MODEL || "tencent/hy3:free",
  AGY_DIR: process.env.AGY_DIR || path.join(os.homedir(), "Desktop", "project", "agy-proxy"),
};
