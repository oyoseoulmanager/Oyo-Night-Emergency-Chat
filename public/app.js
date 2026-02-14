const socket = io();

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

// ===== 역할/방 상태 =====
let myRoomId = null;          // 유저: 내 roomId
let isAdmin = false;          // 관리자 모드 여부
let adminActiveRoomId = null; // 관리자가 현재 대화중인 room

// 관리자 UI: room 선택 드롭다운을 동적으로 추가
const adminBar = document.createElement("div");
adminBar.style.margin = "10px 0";
adminBar.style.display = "none";
adminBar.innerHTML = `
  <b>관리자 모드</b>
  <select id="roomSelect" style="margin-left:10px; padding:4px;"></select>
  <button id="joinRoomBtn" style="margin-left:6px;">입장</button>
  <span id="roomInfo" style="margin-left:10px; color:#555;"></span>
`;
status.parentNode.insertBefore(adminBar, status.nextSibling);

const roomSelect = adminBar.querySelector("#roomSelect");
const joinRoomBtn = adminBar.querySelector("#joinRoomBtn");
const roomInfo = adminBar.querySelector("#roomInfo");

// ===== 서버 이벤트 =====
socket.on("roomAssigned", ({ roomId }) => {
  myRoomId = roomId;
  console.log("내 roomId:", roomId);
});

socket.on("presence", ({ onlineCount }) => {
  status.textContent = `접속자: ${onlineCount}명`;
});

socket.on("chat:history", (messages) => {
  // 기록은 한번에 렌더 (간단하게 전체 비우고 다시)
  log.innerHTML = "";
  messages.forEach(addMessage);
});

socket.on("chat:message", (payload) => {
  addMessage(payload);
});

// 관리자용: 현재 방 목록 받기
socket.on("admin:rooms", ({ rooms }) => {
  roomSelect.innerHTML = "";
  rooms.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    roomSelect.appendChild(opt);
  });
});

// 새 유저 들어오면 목록에 추가(관리자만 받음)
socket.on("user:new", ({ roomId }) => {
  if (!isAdmin) return;

  // 중복 방지
  const exists = Array.from(roomSelect.options).some((o) => o.value === roomId);
  if (!exists) {
    const opt = document.createElement("option");
    opt.value = roomId;
    opt.textContent = roomId;
    roomSelect.appendChild(opt);
  }
});

socket.on("admin:joined", ({ roomId }) => {
  adminActiveRoomId = roomId;
  roomInfo.textContent = `현재 방: ${roomId}`;
});

// ===== 관리자 모드 전환 규칙 =====
// 이름칸에 "관리자" 또는 "admin" 이면 관리자 모드로 동작
function refreshRole() {
  const n = (nameInput.value || "").trim().toLowerCase();
  const nextIsAdmin = (n === "관리자" || n === "admin");

  if (nextIsAdmin && !isAdmin) {
    isAdmin = true;
    adminBar.style.display = "block";
    socket.emit("admin:hello");
  } else if (!nextIsAdmin && isAdmin) {
    isAdmin = false;
    adminBar.style.display = "none";
    adminActiveRoomId = null;
    roomInfo.textContent = "";
  }
}

nameInput.addEventListener("change", refreshRole);
refreshRole();

// 관리자: 방 입장 버튼
joinRoomBtn.addEventListener("click", () => {
  const roomId = roomSelect.value;
  if (!roomId) return;
  socket.emit("admin:join", { roomId });
});

// ===== 전송 =====
function sendMessage() {
  const name = (nameInput.value || "").trim() || "익명";
  const message = (input.value || "").trim();
  if (!message) return;

  const time = new Date().toISOString();

  // 유저: roomId 안보내도 서버가 알아서 자기방으로 보냄
  // 관리자: 현재 선택된 방(room)으로 보내야 하므로 roomId 같이 보냄
  const payload = isAdmin
    ? { name, message, time, roomId: adminActiveRoomId }
    : { name, message, time };

  socket.emit("chat:message", payload);
  input.value = "";
}

button.addEventListener("click", sendMessage);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// ===== 화면 렌더 =====
function addMessage({ name, message, time }) {
  const div = document.createElement("div");
  const t = new Date(time).toLocaleTimeString();
  div.textContent = `[${t}] ${name}: ${message}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
