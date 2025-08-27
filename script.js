// script.js — working with new Firestore rules
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  getDoc,
  addDoc,
  arrayUnion
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

/* ===== state & helpers ===== */
let authChecked = false;
let unsubscriptions = { chat: null, userDoc: null, requests: null };
const profileCache = {}; // uid -> profile data cache

function defaultAvatar() { return "https://www.gravatar.com/avatar/?d=mp&s=160"; }
function escapeHtml(s = "") { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function openProfile(uid) { if (!uid) return; window.location.href = `profile.html?uid=${encodeURIComponent(uid)}`; }

/* fetch & cache profile */
async function fetchProfile(uid) {
  if (!uid) return { username: "Unknown", photoURL: "" };
  if (profileCache[uid]) return profileCache[uid];
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      profileCache[uid] = snap.data();
      return profileCache[uid];
    }
  } catch (err) { console.error("fetchProfile error", err); }
  profileCache[uid] = { username: "Unknown", photoURL: "" };
  return profileCache[uid];
}

/* ensure users/{uid} exists for the signed-in user */
async function ensureMyUserDoc(user) {
  if (!user) return;
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const defaultUsername = user.email ? user.email.split("@")[0] : "User";
      await setDoc(ref, {
        username: defaultUsername,
        usernameLower: defaultUsername.toLowerCase(),
        bio: "",
        photoURL: "",
        friends: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      profileCache[user.uid] = {
        username: defaultUsername,
        usernameLower: defaultUsername.toLowerCase(),
        bio: "",
        photoURL: "",
        friends: []
      };
    } else {
      profileCache[user.uid] = snap.data();
    }
  } catch (err) { console.warn("ensureMyUserDoc error:", err); }
}

/* ===== onAuthStateChanged ===== */
onAuthStateChanged(auth, async (user) => {
  authChecked = true;

  if (!user) {
    if (mePreview) mePreview.style.display = "none";
    if (myProfileBtn) { myProfileBtn.style.display = "none"; myProfileBtn.onclick = null; }
    if (logoutBtn) logoutBtn.style.display = "none";
    if (authBtn) authBtn.style.display = "inline-block";
    if (signedOutNotice) signedOutNotice.style.display = "block";
    if (chatContainer) chatContainer.style.display = "none";
    if (friendsContainer) friendsContainer.style.display = "none";

    cleanupRealtime();

    setTimeout(() => {
      if (!auth.currentUser) window.location.replace("auth.html");
    }, 8000);
    return;
  }

  // Signed in
  try {
    await ensureMyUserDoc(user);

    const me = profileCache[user.uid] || await fetchProfile(user.uid);
    if (meAvatarSmall) meAvatarSmall.src = me.photoURL || defaultAvatar();
    if (meName) meName.textContent = me.username || (user.displayName || user.email.split("@")[0]);

    if (mePreview) mePreview.style.display = "inline-flex";
    if (myProfileBtn) { myProfileBtn.style.display = "inline-block"; myProfileBtn.onclick = () => openProfile(user.uid); }
    if (logoutBtn) logoutBtn.style.display = "inline-block";
    if (authBtn) authBtn.style.display = "none";
    if (signedOutNotice) signedOutNotice.style.display = "none";
    if (friendsContainer) friendsContainer.style.display = "block";
    if (chatContainer) chatContainer.style.display = "block";

    startUserDocListener(user);
    startChatListener(user);
    startIncomingRequestsListener(user);
  } catch (err) { console.error("Post-auth initialization error:", err); }
});

/* ===== auth buttons ===== */
if (authBtn) authBtn.addEventListener("click", () => window.location.href = "auth.html");
if (myProfileBtn) myProfileBtn.addEventListener("click", () => {
  const uid = auth.currentUser?.uid;
  if (uid) openProfile(uid);
});
if (logoutBtn) logoutBtn.addEventListener("click", async () => {
  try { cleanupRealtime(); await signOut(auth); window.location.replace("auth.html"); }
  catch (err) { console.error("Logout failed:", err); alert("Logout failed. See console."); }
});

/* ===== Chat listener & send ===== */
function startChatListener(user) {
  if (!user || !chatBox) return;
  if (unsubscriptions.chat) return;

  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  unsubscriptions.chat = onSnapshot(q, async (snapshot) => {
    chatBox.innerHTML = "";
    const missing = new Set();
    snapshot.docs.forEach(d => { const m = d.data(); if (m.senderId && !profileCache[m.senderId]) missing.add(m.senderId); });
    if (missing.size) await Promise.all(Array.from(missing).map(uid => fetchProfile(uid)));

    snapshot.docs.forEach(d => {
      const m = d.data();
      const uid = m.senderId;
      const prof = uid ? profileCache[uid] || { username: m.senderName || "Unknown", photoURL: m.senderPhotoURL || "" } : { username: m.senderName || "Unknown", photoURL: "" };
      const name = prof.username || m.senderName || "Unknown";
      const avatar = prof.photoURL || m.senderPhotoURL || defaultAvatar();
      const timeStr = m.timestamp?.toDate ? new Date(m.timestamp.toDate()).toLocaleString() : "";

      if (chatMessageTemplate) {
        const clone = chatMessageTemplate.content.cloneNode(true);
        clone.querySelector("img.avatar").src = avatar;
        clone.querySelector("img.avatar").setAttribute("data-uid", uid || "");
        const senderNameEl = clone.querySelector(".sender-name");
        senderNameEl.textContent = name;
        senderNameEl.setAttribute("data-uid", uid || "");
        senderNameEl.style.cursor = uid ? "pointer" : "default";
        clone.querySelector(".time").textContent = timeStr;
        clone.querySelector(".message-text").innerHTML = escapeHtml(m.text || "");
        const wrapper = document.createElement("div"); wrapper.appendChild(clone);
        chatBox.appendChild(wrapper.firstElementChild || wrapper);
      }
    });
    chatBox.scrollTop = chatBox.scrollHeight;
  }, err => {
    console.error("Chat onSnapshot error:", err);
    if (err?.code === "permission-denied") chatBox.innerHTML = "<div style='color:crimson'>Permission denied reading messages.</div>";
  });

  chatBox.addEventListener("click", (ev) => {
    const uid = ev.target.getAttribute?.("data-uid") || ev.target.closest?.("[data-uid]")?.getAttribute("data-uid");
    if (uid) openProfile(uid);
  });

  if (sendBtn && msgInput) {
    sendBtn.onclick = async () => {
      const text = msgInput.value.trim(); if (!text) return;
      if (!auth.currentUser) return alert("You must be signed in to send messages.");
      try {
        const me = profileCache[auth.currentUser.uid] || await fetchProfile(auth.currentUser.uid);
        await addDoc(collection(db, "servers", "defaultServer", "messages"), {
          text,
          senderId: auth.currentUser.uid,
          senderName: me.username || auth.currentUser.email.split("@")[0],
          senderPhotoURL: me.photoURL || "",
          timestamp: serverTimestamp()
        });
        msgInput.value = "";
      } catch (err) { console.error("Send message failed:", err); alert("Failed to send message."); }
    };
    msgInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBtn.click(); } });
  }
}

/* ===== Incoming friend requests (predictable IDs) ===== */
function startIncomingRequestsListener(user) {
  if (!user || !friendRequestsContainer) return;
  if (unsubscriptions.requests) return;

  const q = query(collection(db, "friendRequests"), where("toUid", "==", user.uid), where("status", "==", "pending"));
  unsubscriptions.requests = onSnapshot(q, async snapshot => {
    friendRequestsContainer.innerHTML = "";
    if (snapshot.empty) { friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>"; return; }

    for (const d of snapshot.docs) {
      const data = d.data();
      const fromUid = data.fromUid;
      const prof = await fetchProfile(fromUid);
      const wrapper = document.createElement("div");
      wrapper.className = "friend-request-row";
      wrapper.innerHTML = `<img src="${escapeHtml(prof.photoURL || defaultAvatar())}" class="avatar-small" />
        <strong style="margin-left:8px">${escapeHtml(prof.username || fromUid)}</strong>`;

      const accept = document.createElement("button"); accept.textContent = "Accept";
      const decline = document.createElement("button"); decline.textContent = "Decline";

      accept.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        try {
          const frDocId = fromUid + "_" + user.uid; // predictable ID
          const frRef = doc(db, "friendRequests", frDocId);
          await updateDoc(frRef, { status: "accepted", respondedAt: serverTimestamp() });

          const meRef = doc(db, "users", user.uid);
          const themRef = doc(db, "users", fromUid);
          await updateDoc(meRef, { friends: arrayUnion(fromUid) });
          await updateDoc(themRef, { friends: arrayUnion(user.uid) });
        } catch (err) { console.error("Accept failed", err); alert("Accept failed"); }
      });

      decline.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        try {
          const frDocId = fromUid + "_" + user.uid;
          await updateDoc(doc(db, "friendRequests", frDocId), { status: "declined", respondedAt: serverTimestamp() });
        } catch (err) { console.error("Decline failed", err); alert("Decline failed"); }
      });

      const btnWrap = document.createElement("span");
      btnWrap.style.marginLeft = "8px";
      btnWrap.appendChild(accept); btnWrap.appendChild(decline);
      wrapper.appendChild(btnWrap);
      wrapper.addEventListener("click", () => openProfile(fromUid));
      friendRequestsContainer.appendChild(wrapper);
    }
  }, err => { console.error("Requests onSnapshot error:", err); friendRequestsContainer.innerHTML = "<div class='small' style='color:crimson'>Permission error</div>"; });
}

/* ===== User doc listener ===== */
function startUserDocListener(user) {
  if (!user) return;
  if (unsubscriptions.userDoc) return;

  const userRef = doc(db, "users", user.uid);
  unsubscriptions.userDoc = onSnapshot(userRef, async snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    profileCache[user.uid] = data;

    if (meAvatarSmall) meAvatarSmall.src = data.photoURL || defaultAvatar();
    if (meName) meName.textContent = data.username || (auth.currentUser?.email || "User");
    if (mePreview) mePreview.style.display = "inline-flex";
    if (myProfileBtn) myProfileBtn.style.display = "inline-block";
    if (logoutBtn) logoutBtn.style.display = "inline-block";
    if (authBtn) authBtn.style.display = "none";
    if (friendsContainer) friendsContainer.style.display = "block";
    if (chatContainer) chatContainer.style.display = "block";

    // render friends
    const friends = Array.isArray(data.friends) ? data.friends : [];
    friendsList.innerHTML = "";
    if (!friends.length) friendsList.innerHTML = "<div class='small'>No friends yet</div>";
    else {
      await Promise.all(friends.map(uid => fetchProfile(uid)));
      for (const uid of friends) {
        const p = profileCache[uid] || { username: uid, photoURL: "" };
        if (friendItemTemplate) {
          const clone = friendItemTemplate.content.cloneNode(true);
          clone.querySelector(".friend-avatar").src = p.photoURL || defaultAvatar();
          const nameEl = clone.querySelector(".friend-name");
          nameEl.textContent = p.username || uid;
          nameEl.setAttribute("data-uid", uid);
          clone.querySelector(".friend-avatar").setAttribute("data-uid", uid);
          const tempContainer = document.createElement("div"); tempContainer.appendChild(clone);
          const appended = tempContainer.firstElementChild;
          appended.addEventListener("click", () => openProfile(uid));
          friendsList.appendChild(appended);
        }
      }
    }
  }, err => { console.error("User doc snapshot error:", err); friendsList.innerHTML = "<div class='small' style='color:crimson'>Permission denied</div>"; });
}

/* ===== Cleanup ===== */
function cleanupRealtime() {
  for (const key in unsubscriptions) {
    if (unsubscriptions[key]) unsubscriptions[key]();
    unsubscriptions[key] = null;
  }
}

/* ===== Fallback redirect ===== */
setTimeout(() => {
  if (!authChecked) window.location.replace("auth.html");
}, 10000);

console.log("script.js loaded — ready");
