const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ===== DB (기존 로직 최대한 유지) =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL 없음: DB 저장은 배포 후 활성화됩니다.");
    return;
  }
  try {
    await pool.query("SELECT 1");
    console.log("DB 연결 성공!");
  } catch (e) {
    console.error("DB 연결 실패:", e.message);
  }
}

async function saveMessage({ roomId, name, message, time }) {
  if (!process.env.DATABASE_URL) return;
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        room_id TEXT NOT NULL,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        time TIMESTAMPTZ NOT NULL
      )`
    );

    await pool.query(
      "INSERT INTO messages(room_id, name, message, time) VALUES ($1,$2,$3,$4)",
      [roomId, name, message, time]
    );
  } catch (e) {
    console.error("DB save error:", e.message);
  }
}

async function loadRecentMessages(roomId, limit = 50) {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { rows } = await pool.query(
      "SELECT room_id as \"roomId\", name, message, time FROM messages WHERE room_id=$1 ORDER BY time DESC LIMIT $2",
      [roomId, limit]
    );
    return rows.reverse();
  } catch (e) {
    console.error("DB load error:", e.message);
    return [];
  }
}

// ===== 1:1 Room Chat 핵심 =====
// 유저 접속하면: 자기 socket.id 를 roomId 로 방 생성+입장
// 관리자는: roomId 를 받아 그 방에 join 해서 1:1 대화
io.on("connection", async (socket) => {
  // 1) 유저 기본값
  socket.data.role = "user";

  // 2) 유저 전용 room 생성
  const roomId = socket.id;
  socket.data.roomId = roomId;
  socket.join(roomId);

  // 유저에게 roomId 알려줌
  socket.emit("roomAssigned", { roomId });

  // 관리자에게 "새 유저 들어옴" 알려줌
  io.to("admins").emit("user:new", { roomId });

  // 접속자 수(전체) 방송(원하면 제거 가능)
  io.emit("presence", { onlineCount: io.engine.clientsCount });

  // 방별 최근 메시지 내려주기
  const recent = await loadRecentMessages(roomId, 50);
  socket.emit("chat:history", recent);

  // 3) 관리자가 관리자 모드로 들어오기 (admins 룸에 join)
  socket.on("admin:hello", () => {
    socket.data.role = "admin";
    socket.join("admins");

    // 현재 대기중인 room 목록(지금은 "현재 접속중" 기준이라 간단)
    const activeRooms = [];
    for (const [id, s] of io.of("/").sockets) {
      if (s.data?.role === "user" && s.data?.roomId) activeRooms.push(s.data.roomId);
    }
    socket.emit("admin:rooms", { rooms: activeRooms });
  });

  // 4) 관리자가 특정 유저 room에 join
  socket.on("admin:join", async ({ roomId }) => {
    if (socket.data.role !== "admin") return;

    socket.join(roomId);
    socket.data.activeRoomId = roomId;

    // 해당 방 히스토리 다시 내려주기
    const history = await loadRecentMessages(roomId, 50);
    socket.emit("chat:history", history);
    socket.emit("admin:joined", { roomId });
  });

  // 5) 메시지 전송 (중요: io.emit 금지! room으로만)
  socket.on("chat:message", async ({ name, message, time, roomId: clientRoomId }) => {
    // 유저: 자기 roomId 고정
    // 관리자: clientRoomId(선택한 방)로 보냄
    const targetRoomId =
      socket.data.role === "admin"
        ? (clientRoomId || socket.data.activeRoomId)
        : socket.data.roomId;

    if (!targetRoomId) return;

    const payload = {
      roomId: targetRoomId,
      name,
      message,
      time: time || new Date().toISOString(),
    };

    io.to(targetRoomId).emit("chat:message", payload);
    await saveMessage(payload);
  });

  socket.on("disconnect", () => {
    io.emit("presence", { onlineCount: io.engine.clientsCount });
  });
});

// ===== Render 포트 =====
const PORT = process.env.PORT || 3000;

initDb().finally(() => {
  server.listen(PORT, () => {
    console.log(`서버 켜짐: http://localhost:${PORT}`);
  });
});
