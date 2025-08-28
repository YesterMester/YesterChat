// script.js
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, setDoc, query, where,
  orderBy, onSnapshot, serverTimestamp, getDoc, getDocs, arrayUnion
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ===== DOM elements ===== */
const mePreview = document.getElementById("mePreview");
const meAvatarSmall = document.getElementById("meAvatarSmall");
const meName = document.getElementById("meName");
const myProfileBtn = document.getElementById("myProfileBtn");
const authBtn = document.getElementById("authBtn");
const logoutBtn = document.getElementById("logoutBtn");
const signedOutNotice = document.getElementById("signedOutNotice");
const friendsContainer = document.getElementById("friendsContainer");
const friendsList = document.getElementById("friendsList");
const friendRequestsContainer = document.getElementById("friendRequests");
const chatContainer = document.getElementById("chatContainer");
const chatBox = document.getElementById("chat");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const chatMessageTemplate = document.getElementById("chatMessageTemplate");
const friendItemTemplate = document.getElementById("friendItemTemplate");

/* ===== State & Helpers ===== */
let unsubscriptions = {};
const profileCache = {};
const defaultAvatar = () => "https://www.gravatar.com/avatar/?d=mp&s=160";
const openProfile = (uid) => { if (uid) window.location.href = `profile.html?uid=${uid}`; };

async function fetchProfile(uid) {
  if (!uid) return {};
  if (profileCache[uid]) return profileCache[uid];
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      profileCache[uid] = snap.data();
      return profileCache[uid];
    }
  } catch (err) { console.error("fetchProfile error", err); }
  return {};
}

// THIS IS NOW THE PRIMARY FUNCTION FOR CREATING USER DOCS
async function ensureUserDocExists(user) {
  if (!user) return;
  const userRef = doc(db, "users", user.uid);
  const docSnap = await getDoc(userRef);

  if (!docSnap.exists()) {
    console.log(`User doc for ${user.uid} not found, creating it now.`);
    const username = user.email.split("@")[0]; // Create a default username
    await setDoc(userRef, {
      username: username,
      usernameLower: username.toLowerCase(),
      bio: "Just joined Yester Chat!",
      photoURL: "",
      friends: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}

function cleanupRealtime() {
  Object.values(unsubscriptions).forEach(unsub => unsub?.());
  unsubscriptions = {};
  if (chatBox) chatBox.innerHTML = "";
  if (friendsList) friendsList.innerHTML = "";
  if (friendRequestsContainer) friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
}

/* ===== Auth State Handling ===== */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    await ensureUserDocExists(user); // Ensure the user has a database entry
    const me = await fetchProfile(user.uid);
    
    // Update UI
    meAvatarSmall.src = me.photoURL || defaultAvatar();
    meName.textContent = me.username || "User";
    mePreview.style.display = "inline-flex";
    myProfileBtn.style.display = "inline-block";
    logoutBtn.style.display = "inline-block";
    authBtn.style.display = "none";
    signedOutNotice.style.display = "none";
    friendsContainer.style.display = "block";
    chatContainer.style.display = "block";
    
    startUserDocListener(user);
    startChatListener();
    startIncomingRequestsListener(user);
  } else {
    cleanupRealtime();
    mePreview.style.display = "none";
    myProfileBtn.style.display = "none";
    logoutBtn.style.display = "none";
    authBtn.style.display = "inline-block";
    signedOutNotice.style.display = "block";
    friendsContainer.style.display = "none";
    chatContainer.style.display = "none";
    
    // Safety check to prevent redirect loops
    if (!window.location.pathname.endsWith("auth.html")) {
      window.location.replace("auth.html");
    }
  }
});

/* ===== Auth Buttons ===== */
authBtn?.addEventListener("click", () => window.location.href = "auth.html");
myProfileBtn?.addEventListener("click", () => openProfile(auth.currentUser?.uid));
logoutBtn?.addEventListener("click", () => signOut(auth));

/* ===== Chat, Friends, and other functions... ===== */
// ... (The rest of your functions like startChatListener, startIncomingRequestsListener, etc. are correct and remain unchanged)
// This is the complete file, so copy and paste the full content below.
function startChatListener() {
  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));
  unsubscriptions.chat = onSnapshot(q, async (snapshot) => {
    chatBox.innerHTML = "";
    for (const doc of snapshot.docs) {
      const msg = doc.data();
      const prof = await fetchProfile(msg.senderId);
      const clone = chatMessageTemplate.content.cloneNode(true);
      const img = clone.querySelector("img.avatar");
      img.src = prof.photoURL || defaultAvatar();
      img.onclick = () => openProfile(msg.senderId);
      clone.querySelector(".sender-name").textContent = prof.username || "Unknown";
      clone.querySelector(".time").textContent = new Date(msg.timestamp?.toDate()).toLocaleString([], {timeStyle: 'short'});
      clone.querySelector(".message-text").textContent = msg.text;
      chatBox.appendChild(clone);
    }
    chatBox.scrollTop = chatBox.scrollHeight;
  });
}

sendBtn?.addEventListener("click", async () => {
  const text = msgInput.value.trim();
  const user = auth.currentUser;
  if (!text || !user) return;
  try {
    msgInput.value = "";
    await addDoc(collection(db, "servers", "defaultServer", "messages"), {
      text,
      senderId: user.uid,
      timestamp: serverTimestamp()
    });
  } catch (err) { console.error("Send message failed:", err); }
});

msgInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

function startIncomingRequestsListener(user) {
  const q = query(collection(db, "friendRequests"), where("toUid", "==", user.uid), where("status", "==", "pending"));
  unsubscriptions.incomingRequests = onSnapshot(q, async (snapshot) => {
    friendRequestsContainer.innerHTML = snapshot.empty ? "<div class='small'>No incoming requests</div>" : "";
    for (const docSnap of snapshot.docs) {
      const request = docSnap.data();
      const prof = await fetchProfile(request.fromUid);
      const reqEl = document.createElement("div");
      reqEl.style.display = "flex";
      reqEl.style.alignItems = "center";
      reqEl.style.marginBottom = "8px";
      reqEl.innerHTML = `<img src="${prof.photoURL || defaultAvatar()}" class="avatar-small" style="margin-right:8px;"/><strong style="flex: 1;">${prof.username}</strong>`;
      
      const acceptBtn = document.createElement("button");
      acceptBtn.textContent = "Accept";
      acceptBtn.onclick = async () => {
        try {
          acceptBtn.disabled = true;
          await updateDoc(doc(db, "users", user.uid), { friends: arrayUnion(request.fromUid) });
          await updateDoc(doc(db, "users", request.fromUid), { friends: arrayUnion(user.uid) });
          await updateDoc(docSnap.ref, { status: "accepted" });
        } catch(e) { console.error("Failed to accept friend request:", e); acceptBtn.disabled = false; }
      };
      
      reqEl.appendChild(acceptBtn);
      friendRequestsContainer.appendChild(reqEl);
    }
  });
}

function startUserDocListener(user) {
  unsubscriptions.userDoc = onSnapshot(doc(db, "users", user.uid), async (snap) => {
    if (!snap.exists()) return;
    const userData = snap.data();
    profileCache[user.uid] = userData;
    meAvatarSmall.src = userData.photoURL || defaultAvatar();
    meName.textContent = userData.username || "User";
    const friends = userData.friends || [];
    friendsList.innerHTML = !friends.length ? "<div class='small'>No friends yet</div>" : "";
    for (const friendId of friends) {
      const prof = await fetchProfile(friendId);
      const clone = friendItemTemplate.content.cloneNode(true);
      const friendItem = clone.querySelector(".friend-item");
      clone.querySelector(".friend-avatar").src = prof.photoURL || defaultAvatar();
      clone.querySelector(".friend-name").textContent = prof.username || "Unknown";
      friendItem.onclick = () => openProfile(friendId);
      friendsList.appendChild(clone);
    }
  });
}
