const socket = io();
socket.on("roomAssigned", (data) => {
  console.log("내 roomId:", data.roomId);
});
const log = document.getElementById("log");
const input = document.getElementById("message");
const button = document.getElementById("send");
const nameInput = document.getElementById("name");
const status = document.getElementById("status");

// 닉네임 저장/불러오기
const savedName = localStorage.getItem("chat_name");
if (savedName) nameInput.value = savedName;

nameInput.addEventListener("change", () => {
  localStorage.setItem("chat_name", nameInput.value.trim());
});

function addMessage({ name, message, time }) {
  const div = document.createElement("div");
  const t = new Date(time).toLocaleTimeString();
  div.textContent = `[${t}] ${name}: ${message}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function sendMessage() {
  const name = (nameInput.value.trim() || "익명");
  const message = input.value.trim();
  if (!message) return;

  socket.emit("chat:message", {
    name,
    message,
    time: Date.now(),
  });

  input.value = "";
}

button.addEventListener("click", sendMessage);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// 메시지 받기
socket.on("chat:message", (payload) => {
  addMessage(payload);
});

// 접속자 수 받기
socket.on("presence", ({ onlineCount }) => {
  status.textContent = `접속자: ${onlineCount}명`;
});
// 과거 메시지(히스토리) 받기
socket.on("chat:history", (messages) => {
  messages.forEach((m) => addMessage(m));
});
