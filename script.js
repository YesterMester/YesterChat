// script.js (REPLACEMENT)
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
// cloudinary helper (only used if profile form exists on this page)
import { uploadProfileImage } from "./cloudinary.js";

// ---------- DOM ----------
const chatBox = document.getElementById("chat");
const input = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const chatContainer = document.getElementById("chatContainer");

const mePreview = document.getElementById("mePreview");
const meAvatarSmall = document.getElementById("meAvatarSmall");
const meName = document.getElementById("meName");
const myProfileBtn = document.getElementById("myProfileBtn");

const authBtn = document.getElementById("authBtn") || document.getElementById("signInBtn");
const logoutBtn = document.getElementById("logoutBtn");

const friendsContainer = document.getElementById("friendsContainer");
const friendsList = document.getElementById("friendsList");

const friendRequestsContainer = document.getElementById("friendRequests"); // may be null

const profileForm = document.getElementById("profileForm"); // may be null (profile page only)
const profileImageInput = document.getElementById("profileImage"); // may be null

const chatMessageTemplate = document.getElementById("chatMessageTemplate");
const friendItemTemplate = document.getElementById("friendItemTemplate");

// ---------- state & cache ----------
let authChecked = false;
const profileCache = {}; // uid -> { username, photoURL, ... }

// ---------- helpers ----------
function defaultAvatar() {
  return "https://www.gravatar.com/avatar/?d=mp&s=120";
}
function escapeHtml(t = "") {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function openProfile(uid) {
  if (!uid) return;
  window.location.href = `profile.html?uid=${encodeURIComponent(uid)}`;
}
// fetch and cache profile
async function fetchProfile(uid) {
  if (!uid) return { username: "Unknown", photoURL: "" };
  if (profileCache[uid]) return profileCache[uid];
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      profileCache[uid] = snap.data();
      return profileCache[uid];
    } else {
      // Optionally create the doc for yourself if missing (only allowed for your own uid)
      profileCache[uid] = { username: "Unknown", photoURL: "" };
      return profileCache[uid];
    }
  } catch (err) {
    console.error("fetchProfile error", err);
    profileCache[uid] = { username: "Unknown", photoURL: "" };
    return profileCache[uid];
  }
}

// ---------- auth state ----------
onAuthStateChanged(auth, async (user) => {
  authChecked = true;

  if (!user) {
    // not signed in
    chatContainer && (chatContainer.style.display = "none");
    friendsContainer && (friendsContainer.style.display = "none");
    if (mePreview) mePreview.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "none";
    if (authBtn) authBtn.style.display = "inline-block";

    // Redirect to auth.html after a brief delay (gives user a chance to click auth button)
    setTimeout(() => {
      if (!auth.currentUser) window.location.replace("auth.html");
    }, 5000);
    return;
  }

  // signed in: ensure user document exists and populate topbar
  try {
    // ensure users/{uid} exists (create default if missing)
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
    } else {
      profileCache[user.uid] = snap.data();
    }

    // update topbar
    const meProfile = await fetchProfile(user.uid);
    if (meAvatarSmall) meAvatarSmall.src = meProfile.photoURL || defaultAvatar();
    if (meName) meName.textContent = meProfile.username || (user.displayName || user.email.split("@")[0]);

    if (mePreview) mePreview.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "inline-block";
    if (authBtn) authBtn.style.display = "none";
    if (friendsContainer) friendsContainer.style.display = "block";

    // My profile button
    if (myProfileBtn) {
      myProfileBtn.onclick = () => openProfile(user.uid);
    }

    // initialize app pieces
    initChat(user);
    listenForFriendRequests(user);
    loadFriendsList(user);
    if (profileForm) loadProfileForm(user); // only if profile form present on page

  } catch (err) {
    console.error("Error during post-auth initialization:", err);
  }
});

// ---------- auth controls ----------
if (authBtn) authBtn.addEventListener("click", () => window.location.href = "auth.html");
if (logoutBtn) logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("auth.html");
  } catch (err) {
    console.error("Logout failed", err);
    alert("Logout failed. Check console.");
  }
});

// ---------- Chat ----------
function initChat(user) {
  if (!chatBox) return;

  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  onSnapshot(q, async (snapshot) => {
    try {
      // gather unique senderIds we don't have
      const missing = new Set();
      const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      messages.forEach(m => { if (m.senderId && !profileCache[m.senderId]) missing.add(m.senderId); });

      // fetch missing profiles
      if (missing.size) {
        await Promise.all(Array.from(missing).map(uid => fetchProfile(uid)));
      }

      // render messages (using template if available)
      chatBox.innerHTML = "";
      for (const m of messages) {
        const uid = m.senderId;
        const profile = uid ? (profileCache[uid] || { username: m.senderName || "Unknown", photoURL: "" }) : { username: m.senderName || "Unknown", photoURL: "" };
        const name = profile.username || m.senderName || "Unknown";
        const avatar = profile.photoURL || m.senderPhotoURL || defaultAvatar();
        const text = escapeHtml(m.text || "");
        const timeStr = m.timestamp && m.timestamp.toDate ? new Date(m.timestamp.toDate()).toLocaleString() : "";

        if (chatMessageTemplate) {
          const clone = chatMessageTemplate.content.cloneNode(true);
          const userEl = clone.querySelector(".chat-user");
          const textEl = clone.querySelector(".chat-text");
          const wrapper = document.createElement("div");
          wrapper.className = "message-row";

          // build avatar + content
          const img = document.createElement("img");
          img.src = avatar;
          img.className = "avatar";
          img.style.width = "40px";
          img.style.height = "40px";
          img.setAttribute("data-uid", uid || "");
          img.title = name;
          img.style.cursor = uid ? "pointer" : "default";

          userEl.textContent = name;
          userEl.setAttribute("data-uid", uid || "");
          userEl.style.cursor = uid ? "pointer" : "default";
          textEl.innerHTML = text;

          const right = document.createElement("div");
          right.className = "message-content";
          right.innerHTML = `<div class="message-meta"><span class="sender-name">${escapeHtml(name)}</span> <span class="small">${escapeHtml(timeStr)}</span></div>`;
          const txtDiv = document.createElement("div");
          txtDiv.className = "message-text";
          txtDiv.innerHTML = text;
          right.appendChild(txtDiv);

          wrapper.appendChild(img);
          wrapper.appendChild(right);
          chatBox.appendChild(wrapper);
        } else {
          // fallback
          const p = document.createElement("p");
          const nameSpan = document.createElement("span");
          nameSpan.className = "chat-user";
          nameSpan.setAttribute("data-uid", uid || "");
          nameSpan.textContent = name;
          nameSpan.style.fontWeight = "700";
          nameSpan.style.cursor = uid ? "pointer" : "default";

          const textSpan = document.createElement("span");
          textSpan.className = "chat-text";
          textSpan.innerHTML = `: ${text}`;

          p.appendChild(nameSpan);
          p.appendChild(textSpan);
          chatBox.appendChild(p);
        }
      }

      // scroll
      chatBox.scrollTop = chatBox.scrollHeight;
    } catch (err) {
      console.error("Render messages error:", err);
    }
  }, err => console.error("Error fetching messages:", err));

  // delegation: clicking user name or avatar opens profile
  chatBox.addEventListener("click", (e) => {
    const target = e.target;
    const uid = target.getAttribute?.("data-uid") || target.closest?.("[data-uid]")?.getAttribute("data-uid");
    if (uid) openProfile(uid);
  });

  // send logic
  if (sendBtn) {
    sendBtn.onclick = async () => {
      const text = (input && input.value || "").trim();
      if (!text) return;
      if (!auth.currentUser) return alert("You must be signed in to send messages.");

      try {
        // ensure we have my profile cached
        const meProf = await fetchProfile(auth.currentUser.uid);
        await addDoc(messagesRef, {
          text,
          senderId: auth.currentUser.uid,
          senderName: meProf.username || auth.currentUser.email || "User",
          senderPhotoURL: meProf.photoURL || "",
          timestamp: serverTimestamp()
        });
        if (input) input.value = "";
      } catch (err) {
        console.error("Error sending message:", err);
        alert("Failed to send message.");
      }
    };

    // enter to send (no shift)
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      });
    }
  }
}

// ---------- Friend requests ----------
async function acceptFriend(requestId) {
  try {
    await updateDoc(doc(db, "friendRequests", requestId), { status: "accepted" });
    // Cloud Function will handle adding to friends arrays
  } catch (err) {
    console.error("Error accepting friend:", err);
    alert("Failed to accept friend request.");
  }
}
async function declineFriend(requestId) {
  try {
    await updateDoc(doc(db, "friendRequests", requestId), { status: "declined" });
  } catch (err) {
    console.error("Error declining friend:", err);
    alert("Failed to decline request.");
  }
}

function listenForFriendRequests(user) {
  if (!friendRequestsContainer) return; // nothing to render into

  const q = query(collection(db, "friendRequests"), where("toUid", "==", user.uid), where("status", "==", "pending"));
  onSnapshot(q, async (snapshot) => {
    friendRequestsContainer.innerHTML = "";
    const docs = snapshot.docs;
    if (!docs.length) {
      friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
      return;
    }

    for (const d of docs) {
      const data = d.data();
      const fromUid = data.fromUid;
      const prof = await fetchProfile(fromUid);

      const wrapper = document.createElement("div");
      wrapper.className = "friend-request-row";
      wrapper.innerHTML = `<img src="${escapeHtml(prof.photoURL || defaultAvatar())}" class="avatar-small" />
        <strong>${escapeHtml(prof.username || fromUid)}</strong>`;

      const btnAccept = document.createElement("button");
      btnAccept.textContent = "Accept";
      btnAccept.addEventListener("click", (ev) => { ev.stopPropagation(); acceptFriend(d.id); });

      const btnDecline = document.createElement("button");
      btnDecline.textContent = "Decline";
      btnDecline.addEventListener("click", (ev) => { ev.stopPropagation(); declineFriend(d.id); });

      const btnWrap = document.createElement("span");
      btnWrap.style.marginLeft = "8px";
      btnWrap.appendChild(btnAccept);
      btnWrap.appendChild(btnDecline);

      wrapper.appendChild(btnWrap);
      wrapper.addEventListener("click", () => openProfile(fromUid));
      friendRequestsContainer.appendChild(wrapper);
    }
  }, err => console.error("friendRequests snapshot error:", err));
}

// ---------- Friends list ----------
async function loadFriendsList(user) {
  if (!friendsList) return;
  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (!userSnap.exists()) {
      friendsList.innerHTML = "<div class='small'>No friends yet</div>";
      return;
    }

    const friends = userSnap.data().friends || [];
    friendsList.innerHTML = "";

    if (!friends.length) {
      friendsList.innerHTML = "<div class='small'>No friends yet</div>";
      return;
    }

    // fetch all friend profiles
    await Promise.all(friends.map(uid => fetchProfile(uid)));

    for (const uid of friends) {
      const p = profileCache[uid] || { username: uid, photoURL: "" };
      let item;
      if (friendItemTemplate) {
        const clone = friendItemTemplate.content.cloneNode(true);
        const img = clone.querySelector(".friend-avatar");
        const nameEl = clone.querySelector(".friend-name");
        img.src = p.photoURL || defaultAvatar();
        nameEl.textContent = p.username || uid;
        nameEl.setAttribute("data-uid", uid);
        img.setAttribute("data-uid", uid);
        item = clone;
        const container = document.createElement("div");
        container.appendChild(item);
        // Find the appended element's root node
        const appended = container.firstChild;
        appended.style.cursor = "pointer";
        appended.addEventListener("click", () => openProfile(uid));
        friendsList.appendChild(appended);
      } else {
        const el = document.createElement("div");
        el.className = "friend-item";
        el.innerHTML = `<img src="${p.photoURL || defaultAvatar()}" class="avatar-small" /><span data-uid="${uid}">${escapeHtml(p.username || uid)}</span>`;
        el.addEventListener("click", () => openProfile(uid));
        friendsList.appendChild(el);
      }
    }
  } catch (err) {
    console.error("Error loading friends", err);
    friendsList.innerHTML = "<div class='small'>Failed to load friends</div>";
  }
}

// ---------- Profile form (only if present on this page) ----------
function loadProfileForm(user) {
  if (!profileForm) return;

  // show existing values
  const userRef = doc(db, "users", user.uid);
  onSnapshot(userRef, (snap) => {
    const data = snap.data();
    if (!data) return;
    profileForm.username.value = data.username || "";
    profileForm.bio.value = data.bio || "";
    if (meAvatarSmall) meAvatarSmall.src = data.photoURL || defaultAvatar();
  });

  profileForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = profileForm.username.value.trim();
    const bio = profileForm.bio.value.trim();
    let photoURL = null;

    if (profileImageInput && profileImageInput.files.length > 0) {
      try {
        photoURL = await uploadProfileImage(profileImageInput.files[0], user.uid);
      } catch (err) {
        console.error("Upload failed", err);
        alert("Image upload failed. See console.");
        return;
      }
    }

    try {
      await updateDoc(doc(db, "users", user.uid), {
        username,
        usernameLower: username.toLowerCase(),
        bio,
        ...(photoURL && { photoURL }),
        updatedAt: serverTimestamp()
      });
      alert("Profile saved.");
    } catch (err) {
      console.error("Failed saving profile", err);
      alert("Failed to save profile.");
    }
  };
}

// ---------- safety fallback redirect ----------
setTimeout(() => {
  if (!authChecked) {
    console.warn("Auth check timeout - redirecting to auth.html");
    window.location.replace("auth.html");
  }
}, 6000);