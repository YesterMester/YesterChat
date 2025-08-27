// script.js — polished, robust version for the index.html you provided
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { uploadProfileImage } from "./cloudinary.js"; // used only on profile page if needed

/* ===== DOM elements (match index.html) ===== */
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
const profileCache = {}; // uid -> profile doc data

function defaultAvatar() { return "https://www.gravatar.com/avatar/?d=mp&s=160"; }
function escapeHtml(s = "") { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function openProfile(uid) { if (!uid) return; window.location.href = `profile.html?uid=${encodeURIComponent(uid)}`; }

/* fetch profile doc and cache it */
async function fetchProfile(uid) {
  if (!uid) return { username: "Unknown", photoURL: "" };
  if (profileCache[uid]) return profileCache[uid];
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      profileCache[uid] = snap.data();
      return profileCache[uid];
    }
  } catch (err) {
    console.error("fetchProfile error:", err);
  }
  profileCache[uid] = { username: "Unknown", photoURL: "" };
  return profileCache[uid];
}

/* ensure user's own doc exists (create default if missing) */
async function ensureMyUserDoc(user) {
  if (!user) return;
  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        username: user.email ? user.email.split("@")[0] : "User",
        usernameLower: user.email ? user.email.split("@")[0].toLowerCase() : "user",
        bio: "",
        photoURL: "",
        friends: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      profileCache[user.uid] = {
        username: user.email ? user.email.split("@")[0] : "User",
        usernameLower: user.email ? user.email.split("@")[0].toLowerCase() : "user",
        bio: "",
        photoURL: "",
        friends: []
      };
    } else {
      profileCache[user.uid] = snap.data();
    }
  } catch (err) {
    console.error("ensureMyUserDoc failed:", err);
  }
}

/* cleanup realtime listeners on sign-out or before reattach */
function cleanupRealtime() {
  if (unsubscriptions.chat) { try { unsubscriptions.chat(); } catch{}; unsubscriptions.chat = null; }
  if (unsubscriptions.userDoc) { try { unsubscriptions.userDoc(); } catch{}; unsubscriptions.userDoc = null; }
  if (unsubscriptions.requests) { try { unsubscriptions.requests(); } catch{}; unsubscriptions.requests = null; }
  // clear UI
  if (chatBox) chatBox.innerHTML = "";
  if (friendsList) friendsList.innerHTML = "";
  if (friendRequestsContainer) friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
}

/* ===== onAuthStateChanged ===== */
onAuthStateChanged(auth, async (user) => {
  authChecked = true;
  console.log("Auth state changed:", user && user.uid);

  if (!user) {
    // not signed in: show sign-in button and scheduled redirect
    if (mePreview) mePreview.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "none";
    if (authBtn) authBtn.style.display = "inline-block";
    if (signedOutNotice) signedOutNotice.style.display = "block";
    if (chatContainer) chatContainer.style.display = "none";
    if (friendsContainer) friendsContainer.classList.add("hidden");

    cleanupRealtime();

    // gentle redirect after 8 seconds (gives user time to click button)
    setTimeout(() => {
      if (!auth.currentUser) {
        console.log("Redirecting to auth.html (no user after timeout).");
        window.location.replace("auth.html");
      }
    }, 8000);

    return;
  }

  // signed in -> initialize UI & realtime
  try {
    // ensure user doc exists (so other reads won't fail)
    await ensureMyUserDoc(user);

    // set topbar
    const me = profileCache[user.uid] || (await fetchProfile(user.uid));
    if (meAvatarSmall) meAvatarSmall.src = me.photoURL || defaultAvatar();
    if (meName) meName.textContent = me.username || (user.displayName || user.email.split("@")[0]);
    if (mePreview) mePreview.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "inline-block";
    if (authBtn) authBtn.style.display = "none";
    if (signedOutNotice) signedOutNotice.style.display = "none";
    if (friendsContainer) friendsContainer.classList.remove("hidden");
    if (chatContainer) chatContainer.style.display = "block";

    // my profile button
    if (myProfileBtn) myProfileBtn.onclick = () => openProfile(user.uid);

    // start realtime pieces
    startUserDocListener(user);
    startChatListener(user);
    startIncomingRequestsListener(user);
    // initial friends list will be rendered by userDoc listener
  } catch (err) {
    console.error("Error during auth initialization:", err);
    // if permission issues, show friendly message
    if (err && err.code === "permission-denied") {
      alert("Permission denied. Check your Firestore rules (console).");
    }
  }
});

/* ===== UI button handlers ===== */
if (authBtn) authBtn.addEventListener("click", () => window.location.href = "auth.html");
if (logoutBtn) logoutBtn.addEventListener("click", async () => {
  try {
    cleanupRealtime();
    await signOut(auth);
    window.location.replace("auth.html");
  } catch (err) {
    console.error("Logout failed:", err);
    alert("Logout failed. See console.");
  }
});

/* ===== Chat listener & send ===== */
function startChatListener(user) {
  if (!user || !chatBox) return;
  if (unsubscriptions.chat) return; // already listening

  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  unsubscriptions.chat = onSnapshot(q, async snapshot => {
    try {
      // build list of missing profile uids
      const docs = snapshot.docs;
      const messages = docs.map(d => ({ id: d.id, ...d.data() }));
      const missingUids = new Set();
      messages.forEach(m => {
        if (m.senderId && !profileCache[m.senderId]) missingUids.add(m.senderId);
      });
      if (missingUids.size) {
        await Promise.all(Array.from(missingUids).map(uid => fetchProfile(uid)));
      }

      // render messages
      chatBox.innerHTML = "";
      for (const m of messages) {
        const uid = m.senderId;
        const prof = uid ? (profileCache[uid] || { username: m.senderName || "Unknown", photoURL: m.senderPhotoURL || "" }) : { username: m.senderName || "Unknown", photoURL: m.senderPhotoURL || "" };
        const name = prof.username || m.senderName || "Unknown";
        const avatar = prof.photoURL || m.senderPhotoURL || defaultAvatar();
        const timeStr = m.timestamp && m.timestamp.toDate ? new Date(m.timestamp.toDate()).toLocaleString() : "";

        // render template
        if (chatMessageTemplate) {
          const clone = chatMessageTemplate.content.cloneNode(true);
          const img = clone.querySelector("img.avatar");
          const senderNameEl = clone.querySelector(".sender-name");
          const timeEl = clone.querySelector(".time");
          const textEl = clone.querySelector(".message-text");

          img.src = avatar;
          img.setAttribute("data-uid", uid || "");
          img.style.cursor = uid ? "pointer" : "default";

          senderNameEl.textContent = name;
          senderNameEl.setAttribute("data-uid", uid || "");
          senderNameEl.style.cursor = uid ? "pointer" : "default";

          timeEl.textContent = timeStr;
          textEl.innerHTML = escapeHtml(m.text || "");

          const row = document.createElement("div");
          row.appendChild(clone);
          // append actual fragment
          chatBox.appendChild(row.firstElementChild || row);
        } else {
          const p = document.createElement("p");
          p.innerHTML = `<strong data-uid="${uid}">${escapeHtml(name)}</strong>: ${escapeHtml(m.text||"")}`;
          chatBox.appendChild(p);
        }
      }

      chatBox.scrollTop = chatBox.scrollHeight;
    } catch (err) {
      console.error("Chat render error:", err);
    }
  }, err => {
    console.error("Chat onSnapshot error:", err);
    if (err && err.code === "permission-denied") {
      chatBox.innerHTML = "<div style='color:crimson'>Permission denied reading messages. Check Firestore rules.</div>";
    }
  });

  // clicking name/avatar -> open profile (event delegation)
  chatBox.addEventListener("click", (ev) => {
    const target = ev.target;
    const uid = target.getAttribute?.("data-uid") || target.closest?.("[data-uid]")?.getAttribute("data-uid");
    if (uid) openProfile(uid);
  });

  // send button
  if (sendBtn) {
    sendBtn.onclick = async () => {
      const text = (msgInput && msgInput.value || "").trim();
      if (!text) return;
      if (!auth.currentUser) return alert("You must be signed in to send messages.");

      try {
        // ensure my profile cached
        await fetchProfile(auth.currentUser.uid);
        const me = profileCache[auth.currentUser.uid] || {};
        await addDoc(collection(db, "servers", "defaultServer", "messages"), {
          text,
          senderId: auth.currentUser.uid,
          senderName: me.username || auth.currentUser.email || "User",
          senderPhotoURL: me.photoURL || "",
          timestamp: serverTimestamp()
        });
        if (msgInput) msgInput.value = "";
      } catch (err) {
        console.error("Send message failed:", err);
        alert("Failed to send message. See console.");
      }
    };

    // Enter to send
    if (msgInput) {
      msgInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      });
    }
  }
}

/* ===== Incoming friend requests listener ===== */
function startIncomingRequestsListener(user) {
  if (!user || !friendRequestsContainer) return;
  if (unsubscriptions.requests) return;

  const q = query(collection(db, "friendRequests"), where("toUid", "==", user.uid), where("status", "==", "pending"));
  unsubscriptions.requests = onSnapshot(q, async snapshot => {
    try {
      friendRequestsContainer.innerHTML = "";
      if (snapshot.empty) {
        friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
        return;
      }
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
          try { await updateDoc(doc(db, "friendRequests", d.id), { status: "accepted" }); }
          catch(err){ console.error("Accept failed", err); alert("Accept failed"); }
        });
        decline.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          try { await updateDoc(doc(db, "friendRequests", d.id), { status: "declined" }); }
          catch(err){ console.error("Decline failed", err); alert("Decline failed"); }
        });
        const btnWrap = document.createElement("span"); btnWrap.style.marginLeft = "8px"; btnWrap.appendChild(accept); btnWrap.appendChild(decline);
        wrapper.appendChild(btnWrap);
        wrapper.addEventListener("click", () => openProfile(fromUid));
        friendRequestsContainer.appendChild(wrapper);
      }
    } catch (err) {
      console.error("Requests render error:", err);
      friendRequestsContainer.innerHTML = "<div class='small'>Failed to load requests</div>";
    }
  }, err => {
    console.error("Requests onSnapshot error:", err);
    friendRequestsContainer.innerHTML = "<div class='small' style='color:crimson'>Permission error loading requests</div>";
  });
}

/* ===== user doc listener (keeps friends list & topbar in sync) ===== */
function startUserDocListener(user) {
  if (!user) return;
  if (unsubscriptions.userDoc) return;

  const userRef = doc(db, "users", user.uid);
  unsubscriptions.userDoc = onSnapshot(userRef, async snap => {
    if (!snap.exists()) {
      console.warn("User doc missing after login:", user.uid);
      return;
    }
    const data = snap.data();
    profileCache[user.uid] = data;
    // update topbar
    if (meAvatarSmall) meAvatarSmall.src = data.photoURL || defaultAvatar();
    if (meName) meName.textContent = data.username || (auth.currentUser?.email || "User");
    if (mePreview) mePreview.style.display = "inline-flex";

    // render friends list
    try {
      const friends = Array.isArray(data.friends) ? data.friends : [];
      friendsList.innerHTML = "";
      if (!friends.length) {
        friendsList.innerHTML = "<div class='small'>No friends yet</div>";
      } else {
        // fetch all friend profiles in parallel
        await Promise.all(friends.map(uid => fetchProfile(uid)));
        for (const uid of friends) {
          const p = profileCache[uid] || { username: uid, photoURL: "" };
          // use template if present
          if (friendItemTemplate) {
            const clone = friendItemTemplate.content.cloneNode(true);
            const img = clone.querySelector(".friend-avatar");
            const nameEl = clone.querySelector(".friend-name");
            img.src = p.photoURL || defaultAvatar();
            nameEl.textContent = p.username || uid;
            nameEl.setAttribute("data-uid", uid);
            img.setAttribute("data-uid", uid);
            const tempContainer = document.createElement("div");
            tempContainer.appendChild(clone);
            const appended = tempContainer.firstElementChild;
            appended.addEventListener("click", () => openProfile(uid));
            friendsList.appendChild(appended);
          } else {
            const li = document.createElement("li");
            li.className = "friend-item";
            li.innerHTML = `<img src="${p.photoURL || defaultAvatar()}" class="avatar-small" /><span>${escapeHtml(p.username || uid)}</span>`;
            li.addEventListener("click", () => openProfile(uid));
            friendsList.appendChild(li);
          }
        }
      }
    } catch (err) {
      console.error("Error rendering friends", err);
      friendsList.innerHTML = "<div class='small'>Failed to load friends</div>";
    }
  }, err => {
    console.error("User doc snapshot error:", err);
    // If permission denied, give user guidance
    if (friendsList) friendsList.innerHTML = "<div class='small' style='color:crimson'>Permission denied reading user data</div>";
  });
}

/* ===== safety redirect fallback ===== */
setTimeout(() => {
  if (!authChecked) {
    console.warn("Auth check timed out; attempting to redirect to auth.html");
    window.location.replace("auth.html");
  }
}, 10000); // 10s gives more time for slow networks

/* ===== Helpful console message for debugging ===== */
console.log("script.js loaded — waiting for auth state. If nothing appears, open DevTools (Console/Network) and check for errors and your firebase config.");