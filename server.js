const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let onlineCount = 0;

// Render/클라우드에서는 환경변수 DATABASE_URL 사용
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  // 로컬에선 DATABASE_URL이 없을 수 있으니 저장 기능은 배포 후에 활성화돼도 OK
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL 없음: DB 저장은 배포 후 활성화됩니다.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      message TEXT NOT NULL,
      time BIGINT NOT NULL
    );
  `);
  console.log("DB 준비 완료");
}

async function loadRecentMessages(limit = 50) {
  if (!process.env.DATABASE_URL) return [];
  const { rows } = await pool.query(
    `SELECT name, message, time FROM messages ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return rows.reverse(); // 오래된 것부터
}

async function saveMessage({ name, message, time }) {
  if (!process.env.DATABASE_URL) return;
  await pool.query(
    `INSERT INTO messages (name, message, time) VALUES ($1, $2, $3)`,
    [name, message, time]
  );
}

io.on("connection", async (socket) => {
  const roomId = socket.id;
  socket.join(roomId);
  socket.emit("roomAssigned", { roomId });
  onlineCount++;
  io.emit("presence", { onlineCount });

  // 접속하면 최근 메시지 내려주기
  const recent = await loadRecentMessages(50);
  socket.emit("chat:history", recent);

  socket.on("chat:message", async (payload) => {
    // payload: { name, message, time }
    io.emit("chat:message", payload);
    // 저장
    try {
      await saveMessage(payload);
    } catch (e) {
      console.error("DB save error:", e.message);
    }
  });

  socket.on("disconnect", () => {
    onlineCount = Math.max(0, onlineCount - 1);
    io.emit("presence", { onlineCount });
  });
});

const PORT = process.env.PORT || 3000;

// 서버 실행(딱 1번만)
function startServer() {
  server.listen(PORT, () => {
    console.log(`서버 켜짐: http://localhost:${PORT}`);
  });
}

// DB 연결 시도 후, 성공/실패 상관없이 서버는 실행
initDb()
  .then(() => {
    console.log("DB 연결 성공!");
    startServer();
  })
  .catch((e) => {
    console.log("DATABASE URL 없음: DB 저장은 배포 후 활성화됩니다.");
    startServer();
  });