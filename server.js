const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.static("public"));

app.get("/", (req, res) => res.redirect("/guest"));
app.get("/admin", (req, res) => res.sendFile(__dirname + "/public/admin.html"));
app.get("/guest", (req, res) => res.sendFile(__dirname + "/public/guest.html"));

const server = http.createServer(app);
const io = new Server(server);

// 방/기록 저장 (서버 살아있는 동안 유지)
// ⚠️ Render 재배포/재시작되면 메모리 기록은 초기화됨 (완전 영구 저장은 DB로 바꿔야 함)
const rooms = new Map();
/**
 * rooms.get(roomId) = {
 *   roomId,
 *   branch,
 *   guestName,
 *   createdAt,
 *   closed: false,
 *   messages: [{ from:"manager"|"guest", text, ts }]
 * }
 */

function nowTs() {
  return Date.now();
}

function safeText(s) {
  return String(s || "").slice(0, 500);
}

io.on("connection", (socket) => {
  // 역할 설정: guest/admin
  socket.on("guest:join", ({ branch, nickname }) => {
    const roomId = socket.id; // 게스트 1명당 고유 room
    socket.data.role = "guest";
    socket.data.roomId = roomId;

    const meta = {
      roomId,
      branch: safeText(branch),
      guestName: safeText(nickname) || "익명",
      createdAt: nowTs(),
      closed: false,
      messages: [],
    };
    rooms.set(roomId, meta);

    socket.join(roomId);

    // 게스트에게 룸 정보
    socket.emit("guest:joined", {
      roomId,
      managerName: "OYO Night Manager",
      branch: meta.branch,
      guestName: meta.guestName,
    });

    // 관리자들에게 새 방 알림
    io.to("admins").emit("admin:room_list", getRoomList());
  });

  socket.on("admin:hello", () => {
    socket.data.role = "admin";
    socket.join("admins");
    socket.emit("admin:room_list", getRoomList());
  });

  // 관리자: 특정 방 입장(기록 같이 내려줌)
  socket.on("admin:enter_room", ({ roomId }) => {
    if (socket.data.role !== "admin") return;

    const room = rooms.get(roomId);
    if (!room) return socket.emit("admin:error", { message: "방을 찾을 수 없어요." });

    socket.data.activeRoomId = roomId;

    socket.emit("admin:room_entered", {
      roomId,
      branch: room.branch,
      guestName: room.guestName,
      createdAt: room.createdAt,
      closed: room.closed,
      messages: room.messages,
      managerName: "OYO Night Manager",
    });
  });

  // 게스트 -> 관리자(해당 room으로만)
  socket.on("guest:message", ({ text }) => {
    if (socket.data.role !== "guest") return;
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.closed) return;

    const msg = { from: "guest", text: safeText(text), ts: nowTs() };
    room.messages.push(msg);

    // 해당 룸의 게스트에게도 반영(자기 화면)
    io.to(roomId).emit("room:message", {
      roomId,
      msg,
      branch: room.branch,
      guestName: room.guestName,
      managerName: "OYO Night Manager",
    });

    // 관리자 화면이 보고 있으면 갱신 이벤트
    io.to("admins").emit("admin:room_updated", {
      roomId,
      lastMsg: msg,
      list: getRoomList(),
    });
  });

  // 관리자 -> 게스트(선택한 room으로만)
  socket.on("admin:message", ({ roomId, text }) => {
    if (socket.data.role !== "admin") return;

    const room = rooms.get(roomId);
    if (!room || room.closed) return;

    const msg = { from: "manager", text: safeText(text), ts: nowTs() };
    room.messages.push(msg);

    io.to(roomId).emit("room:message", {
      roomId,
      msg,
      branch: room.branch,
      guestName: room.guestName,
      managerName: "OYO Night Manager",
    });

    io.to("admins").emit("admin:room_updated", {
      roomId,
      lastMsg: msg,
      list: getRoomList(),
    });
  });

  // 관리자: 방 종료(기록은 rooms에 남겨두고 closed만 true)
  socket.on("admin:end_room", ({ roomId }) => {
    if (socket.data.role !== "admin") return;
    const room = rooms.get(roomId);
    if (!room) return;

    room.closed = true;

    // 게스트 화면에 종료 알림
    io.to(roomId).emit("room:ended", { roomId });

    io.to("admins").emit("admin:room_list", getRoomList());
  });

  // (선택) 관리자: 방 완전 삭제(기록도 삭제)
  socket.on("admin:delete_room", ({ roomId }) => {
    if (socket.data.role !== "admin") return;
    rooms.delete(roomId);
    io.to("admins").emit("admin:room_list", getRoomList());
  });

  socket.on("disconnect", () => {
    // 게스트가 나가도 기록은 남겨둠(관리자가 확인 가능)
    if (socket.data.role === "guest") {
      const roomId = socket.data.roomId;
      const room = rooms.get(roomId);
      if (room) {
        // 방 자동 종료는 하지 않음(요구사항: 종료시까지 기록)
        io.to("admins").emit("admin:room_list", getRoomList());
      }
    }
  });
});

function getRoomList() {
  // 관리자 목록용: 최신 메시지/상태 포함
  const arr = [];
  for (const [roomId, r] of rooms.entries()) {
    const last = r.messages[r.messages.length - 1];
    arr.push({
      roomId,
      branch: r.branch,
      guestName: r.guestName,
      createdAt: r.createdAt,
      closed: r.closed,
      lastAt: last?.ts || r.createdAt,
      lastPreview: last ? `${last.from === "manager" ? "매니저" : r.guestName}: ${last.text}` : "",
      count: r.messages.length,
    });
  }
  // 최신 대화가 위로 오게 정렬
  arr.sort((a, b) => b.lastAt - a.lastAt);
  return arr;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));
