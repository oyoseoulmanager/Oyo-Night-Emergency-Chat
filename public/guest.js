const socket = io();

const branchEl = document.getElementById("branch");
const nicknameEl = document.getElementById("nickname");
const enterBtn = document.getElementById("enterBtn");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const msgEl = document.getElementById("message");
const sendBtn = document.getElementById("sendBtn");

let roomId = null;
let entered = false;

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

enterBtn.addEventListener("click", () => {
  const branch = branchEl.value;
  const nickname = (nicknameEl.value || "").trim() || "Guest";

  socket.emit("join:guest", { branch, nickname });
  statusEl.textContent = "Connecting...";
});

socket.on("room:assigned", ({ roomId: rid }) => {
  roomId = rid;
  entered = true;
  statusEl.textContent = "Connected. You are chatting with OYO Night Manager.";
  appendLine(`[System] Connected. Room created.`);
});

socket.on("chat:history", (history) => {
  logEl.innerHTML = "";
  if (!history || history.length === 0) {
    appendLine("[System] No previous messages.");
    return;
  }
  history.forEach((m) => {
    appendLine(`[${fmtTime(m.sentAt)}] ${m.senderName}: ${m.message}`);
  });
});

socket.on("chat:message", (m) => {
  appendLine(`[${fmtTime(m.sentAt)}] ${m.senderName}: ${m.message}`);
});

function sendMessage() {
  if (!entered || !roomId) {
    appendLine("[System] Please click 'Enter Chat' first.");
    return;
  }
  const text = (msgEl.value || "").trim();
  if (!text) return;

  const nickname = (nicknameEl.value || "").trim() || "Guest";

  socket.emit("chat:message", {
    roomId,
    senderName: nickname,
    message: text,
    sentAt: new Date().toISOString(),
  });

  msgEl.value = "";
}

sendBtn.addEventListener("click", sendMessage);
msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});
