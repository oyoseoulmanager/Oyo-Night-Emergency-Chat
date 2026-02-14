const socket = io();

const roomsEl = document.getElementById("rooms");
const logEl = document.getElementById("log");
const titleEl = document.getElementById("title");
const msgEl = document.getElementById("message");
const sendBtn = document.getElementById("send");
const endBtn = document.getElementById("endRoom");
const delBtn = document.getElementById("deleteRoom");

const MANAGER_NAME = "OYO Night Manager";

let activeRoomId = null;
let roomCache = []; // 목록 캐시

function addLine(text) {
  logEl.textContent += text + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function renderRooms(list) {
  roomCache = list || [];
  roomsEl.innerHTML = "";

  if (roomCache.length === 0) {
    roomsEl.innerHTML = `<div class="muted">현재 접속자가 없습니다.</div>`;
    return;
  }

  for (const r of roomCache) {
    const div = document.createElement("div");
    div.className = "room" + (r.roomId === activeRoomId ? " active" : "");
    const t = new Date(r.createdAt).toLocaleTimeString();
    div.innerHTML = `
      <div><b>${r.guestName}</b> <span class="muted">(${r.branch})</span> ${r.closed ? "✅종료됨" : ""}</div>
      <div class="muted">접속 ${t} · 메시지 ${r.count}개</div>
      <div class="muted">${r.lastPreview || ""}</div>
    `;
    div.onclick = () => enterRoom(r.roomId);
    roomsEl.appendChild(div);
  }
}

function enterRoom(roomId) {
  activeRoomId = roomId;
  socket.emit("admin:enter_room", { roomId });
}

socket.emit("admin:hello");

socket.on("admin:room_list", (list) => {
  renderRooms(list);
});

socket.on("admin:room_updated", ({ roomId, list }) => {
  renderRooms(list);
  // 보고 있는 방이면 새 메시지는 room:message 이벤트로 로그에 찍힘
});

socket.on("admin:room_entered", (data) => {
  titleEl.textContent = `${data.guestName} (${data.branch}) — ${MANAGER_NAME}`;
  logEl.textContent = "";

  if (data.messages.length === 0) {
    addLine("--- 대화 기록 없음 ---");
  } else {
    for (const m of data.messages) {
      const t = new Date(m.ts).toLocaleTimeString();
      const who = m.from === "manager" ? MANAGER_NAME : data.guestName;
      addLine(`[${t}] ${who}: ${m.text}`);
    }
  }

  if (data.closed) addLine("--- 이 방은 종료된 상태입니다 ---");
});

socket.on("admin:error", ({ message }) => alert(message));

socket.on("room:message", ({ roomId, msg, guestName }) => {
  // 관리자 화면은 모든 room 메시지를 받지 않음.
  // (하지만, 우리가 room으로 emit 했기 때문에 admin은 room에 join하지 않음 -> 여기 안 옴)
  // 혹시 추후 admin이 join 하도록 바꾸면 아래 조건으로 필터
  if (roomId !== activeRoomId) return;
  const t = new Date(msg.ts).toLocaleTimeString();
  const who = msg.from === "manager" ? MANAGER_NAME : guestName;
  addLine(`[${t}] ${who}: ${msg.text}`);
});

function send() {
  if (!activeRoomId) return alert("왼쪽에서 방을 선택하세요!");
  const text = (msgEl.value || "").trim();
  if (!text) return;
  socket.emit("admin:message", { roomId: activeRoomId, text });
  msgEl.value = "";
  // 내가 보낸 것도 서버에서 기록 후 room:message로 내려오게 할 수도 있지만,
  // 여기서는 즉시 보이게 하고 싶으면 아래처럼 로컬 표시해도 됨.
  // (중복 방지하려면 서버 이벤트만 쓰는 게 깔끔함)
  addLine(`[${new Date().toLocaleTimeString()}] ${MANAGER_NAME}: ${text}`);
}

sendBtn.onclick = send;
msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});

endBtn.onclick = () => {
  if (!activeRoomId) return alert("방을 선택하세요!");
  socket.emit("admin:end_room", { roomId: activeRoomId });
  addLine("--- 방 종료 처리됨 ---");
};

delBtn.onclick = () => {
  if (!activeRoomId) return alert("방을 선택하세요!");
  if (!confirm("정말 이 방을 삭제할까요? (기록도 삭제됨)")) return;
  socket.emit("admin:delete_room", { roomId: activeRoomId });
  activeRoomId = null;
  titleEl.textContent = "방을 선택하세요";
  logEl.textContent = "";
};
