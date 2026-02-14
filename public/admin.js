const socket = io();

const roomSelect = document.getElementById("roomSelect");
const enterRoomBtn = document.getElementById("enterRoomBtn");
const currentRoomEl = document.getElementById("currentRoom");
const roomCountEl = document.getElementById("roomCount");
const systemMsgEl = document.getElementById("systemMsg");

const logEl = document.getElementById("log");
const msgEl = document.getElementById("message");
const sendBtn = document.getElementById("sendBtn");

const ADMIN_NAME = "OYO Night Manager";

let selectedRoomId = "";

function appendLine(text) {
  const div = document.createElement("div");
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function fmtTime(d) {
  try {
    return new Date(d).toLocaleTimeString();
  } catch {
    return "";
  }
}

// Connect as admin
socket.emit("join:admin");

socket.on("admin:system", ({ text }) => {
  systemMsgEl.textContent = text || "";
});

socket.on("rooms:update", ({ rooms }) => {
  const list = rooms || [];
  roomCountEl.textContent = `${list.length} room(s)`;

  const prev = roomSelect.value;

  roomSelect.innerHTML = `<option value="">-- Select a room --</option>`;
  list
    .sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt))
    .forEach((r) => {
      const label = `${r.branch} / ${r.nickname}  (${new Date(r.lastActiveAt).toLocaleTimeString()})`;
      const opt = document.createElement("option");
      opt.value = r.roomId;
      opt.textContent = label;
      roomSelect.appendChild(opt);
    });

  // keep selection if still exists
  if (prev) roomSelect.value = prev;
});

enterRoomBtn.addEventListener("click", () => {
  const roomId = roomSelect.value;
  if (!roomId) {
    systemMsgEl.textContent = "Please select a room first.";
    return;
  }
  socket.emit("admin:selectRoom", { roomId });
});

socket.on("admin:selectedRoom", ({ roomId }) => {
  selectedRoomId = roomId;
  currentRoomEl.textContent = `Current room: ${roomId}`;
  systemMsgEl.textContent = "Room opened. Loading history...";
});

socket.on("chat:history", (history) => {
  logEl.innerHTML = "";
  if (!history || history.length === 0) {
    appendLine("[System] No previous messages for this room.");
    return;
  }
  history.forEach((m) => {
    appendLine(`[${fmtTime(m.sentAt)}] ${m.senderName}: ${m.message}`);
  });
});

socket.on("admin:message", (m) => {
  // Only show messages for currently selected room
  if (!selectedRoomId || m.roomId !== selectedRoomId) return;
  appendLine(`[${fmtTime(m.sentAt)}] ${m.senderName}: ${m.message}`);
});

function sendAdminMessage() {
  if (!selectedRoomId) {
    systemMsgEl.textContent = "Select and open a room first.";
    return;
  }
  const text = (msgEl.value || "").trim();
  if (!text) return;

  socket.emit("chat:message", {
    roomId: selectedRoomId,
    senderName: ADMIN_NAME,
    message: text,
    sentAt: new Date().toISOString(),
  });

  msgEl.value = "";
}

sendBtn.addEventListener("click", sendAdminMessage);
msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendAdminMessage();
});
