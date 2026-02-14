const socket = io();

const branchEl = document.getElementById("branch");
const nickEl = document.getElementById("nickname");
const enterBtn = document.getElementById("enter");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const msgEl = document.getElementById("message");
const sendBtn = document.getElementById("send");

let roomId = null;
let joined = false;

function addLine(text) {
  logEl.textContent += text + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

enterBtn.onclick = () => {
  const branch = branchEl.value;
  const nickname = (nickEl.value || "").trim() || "익명";

  socket.emit("guest:join", { branch, nickname });
};

socket.on("guest:joined", (data) => {
  roomId = data.roomId;
  joined = true;
  statusEl.textContent = `입장 완료 (${data.branch}) / 매니저: ${data.managerName}`;
  addLine(`--- ${data.managerName}와 1:1 채팅이 시작되었습니다 ---`);
});

function send() {
  if (!joined) return alert("먼저 입장하세요!");
  const text = (msgEl.value || "").trim();
  if (!text) return;
  socket.emit("guest:message", { text });
  msgEl.value = "";
}

sendBtn.onclick = send;
msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});

socket.on("room:message", ({ msg, guestName, managerName }) => {
  const t = new Date(msg.ts).toLocaleTimeString();
  const who = msg.from === "manager" ? managerName : guestName;
  addLine(`[${t}] ${who}: ${msg.text}`);
});

socket.on("room:ended", () => {
  addLine("--- 채팅이 종료되었습니다. ---");
  statusEl.textContent = "종료됨";
  joined = false;
});
