// DM.js — Full-featured Direct Messaging
import { auth, db } from "./firebase.js";
import { collection, doc, addDoc, query, orderBy, onSnapshot, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

let domElements = {
  friendsList: document.getElementById("friendsList"),
  chatContainer: document.getElementById("chatContainer")
};

const activeDMs = {}; // { friendUid: { container, input, messageBox } }

function defaultAvatar() { return "https://www.gravatar.com/avatar/?d=mp&s=160"; }

async function fetchProfile(uid) {
  if (!uid) return { username: "Unknown", photoURL: "" };
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) return snap.data();
  } catch (e) { console.error("fetchProfile error:", e); }
  return { username: "Unknown", photoURL: "" };
}

// Create the "+" button next to friend
function createDMButton(friendUid, friendName) {
  const btn = document.createElement("button");
  btn.textContent = "+";
  btn.title = `DM ${friendName}`;
  btn.className = "dm-btn";
  btn.style.cssText = `
    font-weight:bold;font-size:16px;width:28px;height:28px;
    margin-left:8px;border-radius:50%;border:1px solid #555;
    background:#eee;cursor:pointer;
  `;
  btn.onclick = () => toggleDM(friendUid, friendName);
  return btn;
}

// Toggle DM visibility
function toggleDM(friendUid, friendName) {
  if (activeDMs[friendUid]) {
    const dm = activeDMs[friendUid];
    dm.container.style.display = dm.container.style.display === "none" ? "block" : "none";
    return;
  }
  openDM(friendUid, friendName);
}

// Generate consistent Firestore doc ID
function getDMDocId(uid1, uid2) {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
}

// Open a new DM box
async function openDM(friendUid, friendName) {
  if (!auth.currentUser) return;

  const meProfile = await fetchProfile(auth.currentUser.uid);
  const friendProfile = await fetchProfile(friendUid);

  const dmContainer = document.createElement("div");
  dmContainer.style.cssText = `
    border:1px solid #ccc;padding:8px;margin:8px 0;border-radius:8px;
    background:#fefefe; max-width:400px;
  `;

  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-weight:500;";
  header.textContent = friendProfile.username || friendName;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "X";
  closeBtn.style.cssText = `
    font-weight:bold;border:none;background:none;cursor:pointer;color:#900;
  `;
  closeBtn.onclick = () => { dmContainer.style.display = "none"; };
  header.appendChild(closeBtn);
  dmContainer.appendChild(header);

  const messageBox = document.createElement("div");
  messageBox.style.cssText = `
    height:180px; overflow-y:auto; border:1px solid #ddd; padding:4px; margin-bottom:4px;
    background:white;border-radius:4px;
  `;
  dmContainer.appendChild(messageBox);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = `Message ${friendProfile.username || friendName}...`;
  input.style.cssText = "width:calc(100% - 60px); padding:4px; margin-right:4px; border-radius:4px; border:1px solid #aaa;";

  const sendBtn = document.createElement("button");
  sendBtn.textContent = "Send";
  sendBtn.style.cssText = `
    padding:4px 8px; cursor:pointer; border-radius:4px; background:#2d89ef;color:white;border:none;
  `;

  const inputWrapper = document.createElement("div");
  inputWrapper.style.cssText = "display:flex;";
  inputWrapper.appendChild(input);
  inputWrapper.appendChild(sendBtn);
  dmContainer.appendChild(inputWrapper);

  domElements.chatContainer.appendChild(dmContainer);

  activeDMs[friendUid] = { container: dmContainer, input, messageBox };

  const dmRef = collection(db, "dms", getDMDocId(auth.currentUser.uid, friendUid), "messages");
  const q = query(dmRef, orderBy("timestamp"));

  // Listen for messages in real-time
  onSnapshot(q, snapshot => {
    messageBox.innerHTML = "";
    snapshot.docs.forEach(docSnap => {
      const m = docSnap.data();
      const msgDiv = document.createElement("div");
      msgDiv.style.cssText = `
        margin:2px 0;padding:2px 6px;border-radius:6px;
        background:${m.senderId === auth.currentUser.uid ? "#dcf8c6" : "#eee"};
      `;
      const senderName = m.senderId === auth.currentUser.uid ? meProfile.username : friendProfile.username;
      const timestamp = m.timestamp?.toDate ? new Date(m.timestamp.toDate()).toLocaleTimeString() : "";
      msgDiv.textContent = `[${timestamp}] ${senderName}: ${m.text}`;
      messageBox.appendChild(msgDiv);
    });
    messageBox.scrollTop = messageBox.scrollHeight;
  });

  const sendMessage = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await addDoc(dmRef, {
        text,
        senderId: auth.currentUser.uid,
        senderName: meProfile.username,
        senderPhotoURL: meProfile.photoURL || "",
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to send DM:", err);
      alert("Failed to send DM. Check console.");
    }
  };

  sendBtn.onclick = sendMessage;
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") sendMessage();
  });
}

// Attach DM buttons to friend list items
export function attachDMButtons() {
  if (!domElements.friendsList) return;
  const friendItems = domElements.friendsList.querySelectorAll(".friend-item");
  friendItems.forEach(li => {
    const uid = li.getAttribute("data-friend-uid");
    if (!uid) return;
    const nameSpan = li.querySelector(".friend-name");
    const name = nameSpan ? nameSpan.textContent : uid;
    if (!li.querySelector(".dm-btn")) {
      const btn = createDMButton(uid, name);
      li.appendChild(btn);
    }
  });
}

// Observe friends list for changes
const observer = new MutationObserver(() => attachDMButtons());
if (domElements.friendsList) observer.observe(domElements.friendsList, { childList: true, subtree: true });