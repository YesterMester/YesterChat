// script.js — Firebase chat/friends script

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
  getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Cloudinary helper only used on profile page
import { uploadProfileImage } from "./cloudinary.js";

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

/* ===== State ===== */
let authChecked = false;
let unsubscriptions = { chat: null, userDoc: null, requests: null };
const profileCache = {}; // uid -> profile data

/* ===== Helper functions ===== */
function defaultAvatar() {
  return "https://www.gravatar.com/avatar/?d=mp&s=160";
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

function openProfile(uid) {
  if (!uid) return;
  window.location.href = `profile.html?uid=${encodeURIComponent(uid)}`;
}

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
  } catch (err) {
    console.error("fetchProfile error", err);
  }
  profileCache[uid] = { username: "Unknown", photoURL: "" };
  return profileCache[uid];
}

/* ensure users/{uid} exists for signed-in user */
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
  } catch (err) {
    console.warn("ensureMyUserDoc error:", err);
  }
}

/* ===== Cleanup Realtime Listeners ===== */
function cleanupRealtime() {
  try { if (unsubscriptions.chat) unsubscriptions.chat(); } catch {}
  try { if (unsubscriptions.userDoc) unsubscriptions.userDoc(); } catch {}
  try { if (unsubscriptions.requests) unsubscriptions.requests(); } catch {}
  unsubscriptions = { chat: null, userDoc: null, requests: null };

  if (chatBox) chatBox.innerHTML = "";
  if (friendsList) friendsList.innerHTML = "";
  if (friendRequestsContainer) friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
}
/* ===== onAuthStateChanged ===== */
onAuthStateChanged(auth, async (user) => {
  authChecked = true;
  console.log("Auth state changed:", user ? user.uid : null);

  if (!user) {
    // Signed out: hide profile controls & show auth button
    if (mePreview) mePreview.style.display = "none";
    if (myProfileBtn) { myProfileBtn.style.display = "none"; myProfileBtn.onclick = null; }
    if (logoutBtn) logoutBtn.style.display = "none";
    if (authBtn) authBtn.style.display = "inline-block";
    if (signedOutNotice) signedOutNotice.style.display = "block";
    if (chatContainer) chatContainer.style.display = "none";
    if (friendsContainer) friendsContainer.style.display = "none";

    cleanupRealtime();

    // gentle redirect to auth page after 8s
    setTimeout(() => {
      if (!auth.currentUser) window.location.replace("auth.html");
    }, 8000);

    return;
  }

  // Signed in: prepare UI
  try {
    await ensureMyUserDoc(user);

    const me = profileCache[user.uid] || await fetchProfile(user.uid);
    if (meAvatarSmall) meAvatarSmall.src = me.photoURL || defaultAvatar();
    if (meName) meName.textContent = me.username || (user.displayName || user.email.split("@")[0]);

    if (mePreview) mePreview.style.display = "inline-flex";
    if (myProfileBtn) {
      myProfileBtn.style.display = "inline-block";
      myProfileBtn.onclick = () => openProfile(user.uid);
    }
    if (logoutBtn) logoutBtn.style.display = "inline-block";
    if (authBtn) authBtn.style.display = "none";
    if (signedOutNotice) signedOutNotice.style.display = "none";
    if (friendsContainer) friendsContainer.style.display = "block";
    if (chatContainer) chatContainer.style.display = "block";

    // start realtime listeners
    startUserDocListener(user);
    startChatListener(user);
    startIncomingRequestsListener(user);

  } catch (err) {
    console.error("Post-auth initialization error:", err);
  }
});

/* ===== Auth buttons ===== */
if (authBtn) authBtn.addEventListener("click", () => window.location.href = "auth.html");

if (myProfileBtn) myProfileBtn.addEventListener("click", () => {
  const uid = auth.currentUser?.uid;
  if (uid) openProfile(uid);
});

if (logoutBtn) logoutBtn.addEventListener("click", async () => {
  try {
    cleanupRealtime(); // fixed: defined before use
    await signOut(auth);
    window.location.replace("auth.html");
  } catch (err) {
    console.error("Logout failed:", err);
    alert("Logout failed. See console.");
  }
});

/* ===== Safety fallback redirect ===== */
setTimeout(() => {
  if (!authChecked) {
    console.warn("Auth check timed out; redirecting to auth.html");
    window.location.replace("auth.html");
  }
}, 10000);
/* ===== Chat listener & send ===== */
function startChatListener(user) {
  if (!user || !chatBox) return;
  if (unsubscriptions.chat) return;

  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  unsubscriptions.chat = onSnapshot(q, async (snapshot) => {
    try {
      const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const missing = new Set();

      // Collect missing profiles to fetch
      messages.forEach(m => {
        if (m.senderId && !profileCache[m.senderId]) missing.add(m.senderId);
      });
      if (missing.size) await Promise.all(Array.from(missing).map(uid => fetchProfile(uid)));

      chatBox.innerHTML = "";
      for (const m of messages) {
        const uid = m.senderId;
        const prof = uid ? (profileCache[uid] || { username: m.senderName || "Unknown", photoURL: m.senderPhotoURL || "" }) : { username: m.senderName || "Unknown", photoURL: "" };
        const name = prof.username || m.senderName || "Unknown";
        const avatar = prof.photoURL || m.senderPhotoURL || defaultAvatar();
        const timeStr = m.timestamp && m.timestamp.toDate ? new Date(m.timestamp.toDate()).toLocaleString() : "";

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

          const wrapper = document.createElement("div");
          wrapper.appendChild(clone);
          chatBox.appendChild(wrapper.firstElementChild || wrapper);
        } else {
          const p = document.createElement("p");
          p.innerHTML = `<strong data-uid="${uid}">${escapeHtml(name)}</strong>: ${escapeHtml(m.text || "")}`;
          chatBox.appendChild(p);
        }
      }
      chatBox.scrollTop = chatBox.scrollHeight;

    } catch (err) {
      console.error("Chat render error:", err);
    }
  }, err => {
    console.error("Chat onSnapshot error:", err);
    if (err && err.code === "permission-denied" && chatBox) {
      chatBox.innerHTML = "<div style='color:crimson'>Permission denied reading messages. Check Firestore rules.</div>";
    }
  });

  // name/avatar click -> profile
  chatBox.addEventListener("click", (ev) => {
    const t = ev.target;
    const uid = t.getAttribute?.("data-uid") || t.closest?.("[data-uid]")?.getAttribute("data-uid");
    if (uid) openProfile(uid);
  });

  // send messages
  if (sendBtn) {
    sendBtn.onclick = async () => {
      const text = (msgInput && msgInput.value || "").trim();
      if (!text) return;
      if (!auth.currentUser) return alert("You must be signed in to send messages.");
      try {
        await fetchProfile(auth.currentUser.uid); // ensure cached
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
/* ===== Incoming friend requests ===== */
function startIncomingRequestsListener(user) {
  if (!user || !friendRequestsContainer) return;
  if (unsubscriptions.requests) return;

  const q = query(
    collection(db, "friendRequests"),
    where("toUid", "==", user.uid),
    where("status", "==", "pending")
  );

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
        wrapper.innerHTML = `
          <img src="${escapeHtml(prof.photoURL || defaultAvatar())}" class="avatar-small" />
          <strong style="margin-left:8px">${escapeHtml(prof.username || fromUid)}</strong>
        `;

        const accept = document.createElement("button"); 
        accept.textContent = "Accept";
        const decline = document.createElement("button"); 
        decline.textContent = "Decline";

        accept.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          try {
            // Update request status
            await updateDoc(doc(db, "friendRequests", d.id), { 
              status: "accepted", 
              respondedAt: serverTimestamp() 
            });

            // Add each other to friends list
            const fromUserRef = doc(db, "users", fromUid);
            const toUserRef = doc(db, "users", user.uid);

            await updateDoc(fromUserRef, { 
              friends: arrayUnion(user.uid) 
            });
            await updateDoc(toUserRef, { 
              friends: arrayUnion(fromUid) 
            });

          } catch (err) {
            console.error("Accept failed", err);
            alert("Accept failed. Check console for details.");
          }
        });

        decline.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          try {
            await updateDoc(doc(db, "friendRequests", d.id), { 
              status: "declined", 
              respondedAt: serverTimestamp() 
            });
          } catch (err) {
            console.error("Decline failed", err);
            alert("Decline failed. Check console for details.");
          }
        });

        const btnWrap = document.createElement("span");
        btnWrap.style.marginLeft = "8px"; 
        btnWrap.appendChild(accept); 
        btnWrap.appendChild(decline);
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

/* ===== User doc listener for friends & topbar updates ===== */
function startUserDocListener(user) {
  if (!user) return;
  if (unsubscriptions.userDoc) return;

  const userRef = doc(db, "users", user.uid);
  unsubscriptions.userDoc = onSnapshot(userRef, async snap => {
    if (!snap.exists()) return;

    const data = snap.data();
    profileCache[user.uid] = data;

    // Update topbar
    if (meAvatarSmall) meAvatarSmall.src = data.photoURL || defaultAvatar();
    if (meName) meName.textContent = data.username || (auth.currentUser?.email || "User");
    if (mePreview) mePreview.style.display = "inline-flex";
    if (myProfileBtn) myProfileBtn.style.display = "inline-block";
    if (logoutBtn) logoutBtn.style.display = "inline-block";
    if (authBtn) authBtn.style.display = "none";
    if (friendsContainer) friendsContainer.style.display = "block";
    if (chatContainer) chatContainer.style.display = "block";

    // Render friends list
    try {
      const friends = Array.isArray(data.friends) ? data.friends : [];
      friendsList.innerHTML = "";
      if (!friends.length) {
        friendsList.innerHTML = "<div class='small'>No friends yet</div>";
      } else {
        await Promise.all(friends.map(uid => fetchProfile(uid)));
        for (const uid of friends) {
          const p = profileCache[uid] || { username: uid, photoURL: "" };
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
    if (friendsList) friendsList.innerHTML = "<div class='small' style='color:crimson'>Permission denied reading user data</div>";
  });
}
/* ===== Safety fallback redirect ===== */
setTimeout(() => {
  if (!authChecked) {
    console.warn("Auth check timed out; redirecting to auth.html");
    window.location.replace("auth.html");
  }
}, 10000);

/* ===== Logout button with proper cleanup ===== */
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      // Ensure cleanupRealtime exists
      if (typeof cleanupRealtime === "function") cleanupRealtime();

      await signOut(auth);
      window.location.replace("auth.html");
    } catch (err) {
      console.error("Logout failed:", err);
      alert("Logout failed. See console.");
    }
  });
}

/* ===== Auth & Profile buttons (final check) ===== */
if (authBtn) {
  authBtn.addEventListener("click", () => {
    window.location.href = "auth.html";
  });
}

if (myProfileBtn) {
  myProfileBtn.addEventListener("click", () => {
    const uid = auth.currentUser?.uid;
    if (uid) openProfile(uid);
  });
}

/* ===== Debug log ===== */
console.log(
  "script.js loaded — topbar controls show/hide based on auth state. " +
  "If My Profile still doesn't appear, check console for errors and that the myProfileBtn element exists."
);
