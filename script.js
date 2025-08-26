import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, doc, addDoc, query, orderBy, onSnapshot, serverTimestamp } 
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const chatBox = document.getElementById("chat");
const input = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const chatContainer = document.getElementById("chatContainer");

// --- 1️⃣ Auth check ---
onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.replace("auth.html");
  } else {
    chatContainer.style.display = "block"; // Show chat only when signed in
    initChat(user);
  }
});

// --- 2️⃣ Initialize chat ---
function initChat(user) {
  console.log("Logged in as:", user.email);

  // --- Reference nested Firestore collection ---
  const generalChannelDoc = doc(db, "servers", "defaultServer", "channels", "general");
  const messagesRef = collection(generalChannelDoc, "messages");

  // --- Real-time listener ---
  const q = query(messagesRef, orderBy("timestamp"));
  onSnapshot(q, snapshot => {
    chatBox.innerHTML = "";
    snapshot.forEach(doc => {
      const msg = doc.data();
      chatBox.innerHTML += `<p><b>${msg.sender}</b>: ${msg.text}</p>`;
    });
    chatBox.scrollTop = chatBox.scrollHeight; // auto-scroll
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
      input.value = ""; // clear input
    } catch (err) {
      console.error("Error sending message:", err);
      alert("❌ Failed to send message. Try again.");
    }
  };
}
