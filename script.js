import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } 
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const chatBox = document.getElementById("chat");
const input = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const chatContainer = document.getElementById("chatContainer");

// --- Auth check ---
onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.replace("auth.html");
  } else {
    chatContainer.style.display = "block"; // Show chat only if signed in
    initChat(user);
  }
});

function initChat(user) {
  console.log("Logged in as:", user.email);

  const q = query(
    collection(db, "servers", "defaultServer", "channels", "general", "messages"),
    orderBy("timestamp")
  );

  onSnapshot(q, snapshot => {
    chatBox.innerHTML = "";
    snapshot.forEach(doc => {
      const msg = doc.data();
      chatBox.innerHTML += `<p><b>${msg.sender}</b>: ${msg.text}</p>`;
    });
    chatBox.scrollTop = chatBox.scrollHeight;
  });

  sendBtn.onclick = async () => {
    const text = input.value.trim();
    if (!text) return;

    await addDoc(
      collection(db, "servers", "defaultServer", "channels", "general", "messages"),
      {
        text,
        sender: user.email,
        timestamp: serverTimestamp()
      }
    );
    input.value = "";
  };
}
