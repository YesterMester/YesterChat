<script type="module">
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } 
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const chatBox = document.getElementById("chat");
const input = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");

onAuthStateChanged(auth, user ={">"} {
  if (!user) {
    window.location.href = "auth.html";
  {"}"} else {
    console.log("Logged in:", user.email);

    // Listen to messages
    const q = query(
      collection(db, "servers", "defaultServer", "channels", "general", "messages"),
      orderBy("timestamp")
    );
    onSnapshot(q, snapshot ={">"} {
      chatBox.innerHTML = "";
      snapshot.forEach(doc ={">"} {
        const msg = doc.data();
        chatBox.innerHTML += `<p><b>${msg.sender}</b>: ${msg.text}</p>`;
      {"}"});
    {"}"});

    // Send message
    sendBtn.onclick = async () ={">"} {
      if (input.value.trim() === "") return;
      await addDoc(collection(db, "servers", "defaultServer", "channels", "general", "messages"), {
        text: input.value,
        sender: user.email,
        timestamp: serverTimestamp()
      {"}"});
      input.value = "";
    {"}"};
  {"}"}
{"}"});
</script>

