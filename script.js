// script.js
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Elements
const chatBox = document.getElementById("chat");
const input = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const chatContainer = document.getElementById("chatContainer");
const logoutBtn = document.getElementById("logoutBtn");
const authBtn = document.getElementById("authBtn");
const mePreview = document.getElementById("mePreview");
const meAvatarSmall = document.getElementById("meAvatarSmall");
const meNameSpan = document.getElementById("meName");

// Initial UI
chatContainer.style.display = "none";
logoutBtn.style.display = "none";
mePreview.style.display = "none";

let authChecked = false;
let currentProfile = null; // store profile doc for current user

// Auth guard
onAuthStateChanged(auth, async (user) => {
  authChecked = true;
  if (!user) {
    // NOT signed in
    console.log("No user signed in");
    chatContainer.style.display = "none";
    logoutBtn.style.display = "none";
    mePreview.style.display = "none";
    authBtn.style.display = "inline-block";
  } else {
    // Signed in: fetch profile
    const profileDoc = await getDoc(doc(db, "users", user.uid));
    if (profileDoc.exists()) {
      currentProfile = profileDoc.data();
      mePreview.style.display = "inline-flex";
      meAvatarSmall.src = currentProfile.photoURL || defaultAvatar();
      meNameSpan.textContent = currentProfile.username || user.displayName || user.email;
    } else {
      // If profile missing, create a fallback in the background (rare)
      currentProfile = { username: user.displayName || user.email.split("@")[0], photoURL: "" };
    }

    authBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    chatContainer.style.display = "block";
    initChat(user);
  }
});

// Clickable avatar/name to view profile
mePreview.addEventListener("click", () => {
  if (auth.currentUser) window.location.href = `profile.html?uid=${auth.currentUser.uid}`;
});

// Logout
logoutBtn.onclick = async () => {
  try {
    await signOut(auth);
    window.location.replace("auth.html");
  } catch (err) {
    console.error("Logout error", err);
    alert("Logout failed");
  }
};

// Auth btn: fallback to auth page
authBtn.onclick = () => window.location.href = "auth.html";

// Init chat
async function initChat(user) {
  // Reference messages collection
  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  // Real-time listener
  onSnapshot(q, (snapshot) => {
    chatBox.innerHTML = "";
    snapshot.forEach(docSnap => {
      const msg = docSnap.data();

      // Backwards compatibility: handle old messages (that used `sender` email)
      const senderId = msg.senderId || null;
      const senderName = msg.senderName || msg.sender || (senderId ? senderId : "Unknown");
      const photo = msg.senderPhotoURL || "";

      // sender clickable (store uid if present)
      const uidAttr = senderId ? `data-uid="${senderId}"` : "";

      chatBox.innerHTML += `
        <div class="message-row">
          <img src="${photo || defaultAvatar()}" class="avatar" ${uidAttr} />
          <div class="message-content">
            <div class="message-meta">
              <span class="sender-name" ${uidAttr}>${escapeHtml(senderName)}</span>
              <span class="time small">${formatTime(msg.timestamp)}</span>
            </div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
          </div>
        </div>
      `;
    });

    chatBox.scrollTop = chatBox.scrollHeight;
  }, err => {
    console.error("Snapshot error:", err);
    chatBox.innerHTML = "<p style='color: red;'>Failed to load messages.</p>";
  });

  // Send message behavior
  sendBtn.onclick = async () => {
    const text = input.value.trim();
    if (!text) return;

    // ensure we have currentProfile for username/photo
    const senderName = (currentProfile && currentProfile.username) ? currentProfile.username : (auth.currentUser.displayName || auth.currentUser.email);
    const senderPhoto = (currentProfile && currentProfile.photoURL) ? currentProfile.photoURL : "";

    try {
      await addDoc(messagesRef, {
        text,
        senderId: auth.currentUser.uid,
        senderName,
        senderPhotoURL: senderPhoto,
        timestamp: serverTimestamp()
      });
      input.value = "";
    } catch (err) {
      console.error("Send error:", err);
      alert("Failed to send. Check console.");
    }
  };

  // allow pressing Enter to send
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  // Make avatar/name clickable via event delegation
  chatBox.addEventListener("click", (e) => {
    const target = e.target;
    const uid = target.getAttribute?.("data-uid");
    if (uid) {
      window.location.href = `profile.html?uid=${uid}`;
    }
  });
}

// small helpers
function defaultAvatar() {
  return "https://www.gravatar.com/avatar/?d=mp&s=80"; // generic fallback
}

function formatTime(ts) {
  if (!ts) return "";
  // Firestore serverTimestamp can be a Timestamp object or a number depending on the doc state
  try {
    if (ts.toDate) return new Date(ts.toDate()).toLocaleTimeString();
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "";
  }
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Fallback redirect if firebase doesn't respond
setTimeout(() => {
  if (!authChecked) {
    console.warn("Auth check timeout, redirecting.");
    window.location.replace("auth.html");
  }
}, 4000);
