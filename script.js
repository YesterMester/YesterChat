import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } 
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } 
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// --- Elements ---
const chatBox = document.getElementById("chat");
const input = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const chatContainer = document.getElementById("chatContainer");
const logoutBtn = document.getElementById("logoutBtn");
const authBtn = document.getElementById("authBtn");

// --- Initial UI state ---
chatContainer.style.display = "none";
logoutBtn.style.display = "none";

let authChecked = false; // flag to prevent double redirect

// --- Auth check ---
onAuthStateChanged(auth, user => {
  authChecked = true;

  if (!user) {
    console.log("❌ No user signed in");
    chatContainer.style.display = "none";
    logoutBtn.style.display = "none";
    authBtn.style.display = "inline-block";
  } else {
    console.log("✅ Signed in as:", user.email);
    chatContainer.style.display = "block";
    logoutBtn.style.display = "inline-block";
    authBtn.style.display = "none";
    initChat(user);
  }
});

// --- Initialize chat ---
function initChat(user) {
  const messagesRef = collection(db, "servers", "defaultServer", "messages");

  // Real-time listener
  const q = query(messagesRef, orderBy("timestamp"));
  onSnapshot(q, snapshot => {
    chatBox.innerHTML = "";
    snapshot.forEach(doc => {
      const msg = doc.data();
      chatBox.innerHTML += `<p><b>${msg.sender}</b>: ${msg.text}</p>`;
    });
    chatBox.scrollTop = chatBox.scrollHeight;
  }, err => {
    console.error("Error fetching messages:", err);
    chatBox.innerHTML = "<p style='color:red;'>⚠️ Error loading messages. Check console.</p>";
  });

  // Send message
  sendBtn.onclick = async () => {
    const text = input.value.trim();
    if (!text) return;

    try {
      await addDoc(messagesRef, {
        text,
        sender: user.email,
        timestamp: serverTimestamp()
      });
      input.value = "";
    } catch (err) {
      console.error("Error sending message:", err);
      alert("❌ Failed to send message. Try again.");
    }
  };

  // Logout button
  logoutBtn.onclick = async () => {
    try {
      await signOut(auth);
      window.location.replace("auth.html");
    } catch (err) {
      console.error("Error signing out:", err);
      alert("❌ Logout failed. Try again.");
    }
  };
}

// --- Sign In/Up button ---
authBtn.onclick = () => {
  window.location.href = "auth.html";
};

// --- Fallback redirect if auth check fails ---
setTimeout(() => {
  if (!authChecked) {
    console.warn("⚠️ Auth check timeout → forcing redirect");
    window.location.replace("auth.html");
  }
}, 3000);
