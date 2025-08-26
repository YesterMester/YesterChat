import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } 
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// --- Elements ---
const chatBox = document.getElementById("chat");
const input = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const chatContainer = document.getElementById("chatContainer");

// Optional: add a logout button in your HTML
const logoutBtn = document.getElementById("logoutBtn");

// --- 1️⃣ Hide chat container initially to prevent flicker ---
chatContainer.style.display = "none";

// --- 2️⃣ Auth check & redirect ---
let authChecked = false; // flag to prevent double redirect

onAuthStateChanged(auth, user => {
  authChecked = true;

  if (!user) {
    console.log("No user signed in → redirecting to auth.html");
    window.location.replace("auth.html");
  } else {
    console.log("User signed in:", user.email);
    chatContainer.style.display = "block"; // Show chat only when signed in
    initChat(user);
  }
});

// --- 3️⃣ Initialize chat ---
function initChat(user) {

  // Reference messages collection under defaultServer
  const messagesRef = collection(db, "servers", "defaultServer", "messages");

  // --- Real-time listener ---
  const q = query(messagesRef, orderBy("timestamp"));
  onSnapshot(q, snapshot => {
    chatBox.innerHTML = "";
    snapshot.forEach(doc => {
      const msg = doc.data();
      chatBox.innerHTML += `<p><b>${msg.sender}</b>: ${msg.text}</p>`;
    });
    chatBox.scrollTop = chatBox.scrollHeight; // auto-scroll
  }, err => {
    console.error("Error fetching messages:", err);
    chatBox.innerHTML = "<p style='color:red;'>Error loading messages. Check console.</p>";
  });

  // --- Send message ---
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

  // --- Logout button ---
  if (logoutBtn) {
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
}

// --- 4️⃣ Extra safety: Redirect if auth not checked after short timeout ---
setTimeout(() => {
  if (!authChecked) {
    console.warn("Auth check timed out → redirecting to auth.html");
    window.location.replace("auth.html");
  }
}, 3000); // 3 seconds timeout
