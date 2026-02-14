const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static assets
app.use(express.static(path.join(__dirname, "public")));

// ✅ Split routes: guest vs admin
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "guest.html")));
app.get("/guest", (req, res) => res.sendFile(path.join(__dirname, "public", "guest.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

// ✅ Render port binding
const PORT = process.env.PORT || 3000;

// ✅ Postgres (optional in local)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL not set. DB persistence will be disabled locally.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      branch TEXT,
      message TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("DB connected & table ensured.");
}

async function saveRoomMessage({ roomId, senderName, branch, message, sentAt }) {
  if (!process.env.DATABASE_URL) return;
  await pool.query(
    `INSERT INTO messages (room_id, sender_name, branch, message, sent_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [roomId, senderName, branch || null, message, sentAt ? new Date(sentAt) : new Date()]
  );
}

async function loadRoomMessages(roomId, limit = 200) {
  if (!process.env.DATABASE_URL) return [];
  const { rows } = await pool.query(
    `SELECT room_id, sender_name, branch, message, sent_at
     FROM messages
     WHERE room_id = $1
     ORDER BY sent_at ASC
     LIMIT $2`,
    [roomId, limit]
  );
  return rows.map((r) => ({
    roomId: r.room_id,
    senderName: r.sender_name,
    branch: r.branch,
    message: r.message,
    sentAt: r.sent_at,
  }));
}

// ====== 1:1 room system state ======
const activeRooms = new Map(); 
// roomId -> { guestSocketId, branch, nickname, createdAt, lastActiveAt }

let adminSocketId = null;

// Utility: room list for admin UI
function roomsPayload() {
  return Array.from(activeRooms.entries()).map(([roomId, v]) => ({
    roomId,
    branch: v.branch,
    nickname: v.nickname,
    createdAt: v.createdAt,
    lastActiveAt: v.lastActiveAt,
  }));
}

io.on("connection", (socket) => {
  // Guest joins
  socket.on("join:guest", async ({ branch, nickname }) => {
    const safeBranch = String(branch || "").slice(0, 50);
    const safeNickname = String(nickname || "Guest").slice(0, 50);

    const roomId = socket.id; // ✅ unique room per guest
    socket.join(roomId);

    activeRooms.set(roomId, {
      guestSocketId: socket.id,
      branch: safeBranch,
      nickname: safeNickname,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });

    socket.emit("room:assigned", { roomId });

    // Send guest history for their own room
    const history = await loadRoomMessages(roomId, 200);
    socket.emit("chat:history", history);

    // Notify admin with updated list
    if (adminSocketId) {
      io.to(adminSocketId).emit("rooms:update", { rooms: roomsPayload() });
      io.to(adminSocketId).emit("admin:system", {
        text: `New guest connected: ${safeBranch} / ${safeNickname}`,
      });
    }
  });

  // Admin joins
  socket.on("join:admin", () => {
    adminSocketId = socket.id;
    socket.emit("rooms:update", { rooms: roomsPayload() });
    socket.emit("admin:system", { text: "Admin connected. Waiting for guests..." });
  });

  // Admin selects a room to view
  socket.on("admin:selectRoom", async ({ roomId }) => {
    if (socket.id !== adminSocketId) return;
    const rid = String(roomId || "");
    if (!rid) return;

    const history = await loadRoomMessages(rid, 400);
    socket.emit("chat:history", history);
    socket.emit("admin:selectedRoom", { roomId: rid });
  });

  // Chat message (either guest to their room, or admin to selected room)
  socket.on("chat:message", async ({ roomId, senderName, message, sentAt }) => {
    const rid = String(roomId || "");
    const msg = String(message || "").trim();
    if (!rid || !msg) return;

    const isAdmin = socket.id === adminSocketId;
    const isGuestOfRoom = socket.id === rid; // guest's roomId == their socket.id

    if (!isAdmin && !isGuestOfRoom) return;

    // Determine branch for DB logging
    const roomInfo = activeRooms.get(rid);
    const branch = roomInfo?.branch || null;

    // Update room activity timestamp
    if (roomInfo) roomInfo.lastActiveAt = new Date();

    const payload = {
      roomId: rid,
      senderName: String(senderName || (isAdmin ? "OYO Night Manager" : "Guest")).slice(0, 50),
      branch,
      message: msg.slice(0, 2000),
      sentAt: sentAt ? new Date(sentAt) : new Date(),
    };

    // ✅ emit only to that room
    io.to(rid).emit("chat:message", payload);

    // ✅ also send to admin so admin UI can show new message even if not joined
    if (adminSocketId) io.to(adminSocketId).emit("admin:message", payload);

    // ✅ persist
    try {
      await saveRoomMessage(payload);
    } catch (e) {
      console.error("DB save error:", e.message);
    }

    // Update admin room list
    if (adminSocketId) io.to(adminSocketId).emit("rooms:update", { rooms: roomsPayload() });
  });

  socket.on("disconnect", () => {
    // If guest disconnects, remove their active room (DB history stays)
    if (activeRooms.has(socket.id)) {
      const roomInfo = activeRooms.get(socket.id);
      activeRooms.delete(socket.id);

      if (adminSocketId) {
        io.to(adminSocketId).emit("rooms:update", { rooms: roomsPayload() });
        io.to(adminSocketId).emit("admin:system", {
          text: `Guest disconnected: ${roomInfo.branch} / ${roomInfo.nickname}`,
        });
      }
    }

    if (socket.id === adminSocketId) {
      adminSocketId = null;
    }
  });
});

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server listening on ${PORT}`);
    });
  })
  .catch((e) => {
    console.error("DB init error:", e.message);
    // Still start server even if DB init fails
    server.listen(PORT, () => {
      console.log(`Server listening on ${PORT}`);
    });
  });
