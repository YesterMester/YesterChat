// script.js — With Direct Messaging Feature
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
  getDocs,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Note: uploadProfileImage is not used on this page, but kept for potential future use.
// import { uploadProfileImage } from "./cloudinary.js"; 

/* ===== Debug Logging ===== */
function debugLog(message, data = null) {
  console.log(`[SCRIPT DEBUG] ${message}`, data || '');
}

function debugError(message, error = null) {
  console.error(`[SCRIPT ERROR] ${message}`, error || '');
}

/* ===== DOM elements ===== */
let domElements = {};

function initializeDOMElements() {
  domElements = {
    mePreview: document.getElementById("mePreview"),
    meAvatarSmall: document.getElementById("meAvatarSmall"),
    meName: document.getElementById("meName"),
    myProfileBtn: document.getElementById("myProfileBtn"),
    authBtn: document.getElementById("authBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    signedOutNotice: document.getElementById("signedOutNotice"),
    friendsContainer: document.getElementById("friendsContainer"),
    friendsList: document.getElementById("friendsList"),
    friendRequestsContainer: document.getElementById("friendRequests"),
    chatContainer: document.getElementById("chatContainer"),
    chatBox: document.getElementById("chat"),
    msgInput: document.getElementById("msgInput"),
    sendBtn: document.getElementById("sendBtn"),
    chatMessageTemplate: document.getElementById("chatMessageTemplate"),
    // ===== DM FEATURE START =====
    dmChatsContainer: document.getElementById("dmChatsContainer"),
    dmChatTemplate: document.getElementById("dmChatTemplate"),
    dmFriendItemTemplate: document.getElementById("dmFriendItemTemplate"),
    // ===== DM FEATURE END =====
  };

  debugLog("DOM Elements initialized");
  return domElements;
}

/* ===== State ===== */
let authChecked = false;
let authReady = false;
let currentUser = null;
let unsubscriptions = { chat: null, userDoc: null, incomingRequests: null, outgoingRequests: null, dms: {} }; // Added dms
const profileCache = {};

/* ===== Helpers ===== */
function defaultAvatar() { return "https://www.gravatar.com/avatar/?d=mp&s=160"; }
function escapeHtml(s = "") { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function openProfile(uid) { if (!uid) return; window.location.href = `profile.html?uid=${encodeURIComponent(uid)}`; }

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
    debugError("fetchProfile error", err);
  }
  profileCache[uid] = { username: "Unknown", photoURL: "" };
  return profileCache[uid];
}

async function ensureMyUserDoc(user) {
  if (!user) return;
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      debugLog("User doc doesn't exist, creating...");
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
      profileCache[user.uid] = { username: defaultUsername, usernameLower: defaultUsername.toLowerCase(), bio: "", photoURL: "", friends: [] };
    } else {
      profileCache[user.uid] = snap.data();
    }
  } catch (err) {
    debugError("ensureMyUserDoc error:", err);
  }
}

/* Cleanup realtime listeners */
function cleanupRealtime() {
  debugLog("Cleaning up realtime listeners");
  Object.keys(unsubscriptions).forEach(k => {
    if (k === 'dms') {
      Object.values(unsubscriptions.dms).forEach(unsub => unsub?.());
      unsubscriptions.dms = {};
    } else {
      try { unsubscriptions[k]?.(); } catch (e) { }
      unsubscriptions[k] = null;
    }
  });
  if (domElements.chatBox) domElements.chatBox.innerHTML = "";
  if (domElements.friendsList) domElements.friendsList.innerHTML = "";
  if (domElements.friendRequestsContainer) domElements.friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
  if (domElements.dmChatsContainer) domElements.dmChatsContainer.innerHTML = ""; // Clear DM windows
}

/* Show signed out state */
function showSignedOutState() {
  debugLog("=== SHOWING SIGNED OUT STATE ===");
  if (domElements.mePreview) domElements.mePreview.style.display = "none";
  if (domElements.myProfileBtn) domElements.myProfileBtn.style.display = "none";
  if (domElements.logoutBtn) domElements.logoutBtn.style.display = "none";
  if (domElements.authBtn) domElements.authBtn.style.display = "inline-block";
  if (domElements.signedOutNotice) domElements.signedOutNotice.style.display = "block";
  if (domElements.chatContainer) domElements.chatContainer.style.display = "none";
  if (domElements.friendsContainer) domElements.friendsContainer.style.display = "none";
  cleanupRealtime();
}

/* Show signed in state */
function showSignedInState(user) {
  debugLog("=== SHOWING SIGNED IN STATE ===", { uid: user.uid });
  if (domElements.mePreview) domElements.mePreview.style.display = "inline-flex";
  if (domElements.myProfileBtn) {
    domElements.myProfileBtn.style.display = "inline-block";
    domElements.myProfileBtn.onclick = () => openProfile(user.uid);
  }
  if (domElements.logoutBtn) domElements.logoutBtn.style.display = "inline-block";
  if (domElements.authBtn) domElements.authBtn.style.display = "none";
  if (domElements.signedOutNotice) domElements.signedOutNotice.style.display = "none";
  if (domElements.friendsContainer) domElements.friendsContainer.style.display = "block";
  if (domElements.chatContainer) domElements.chatContainer.style.display = "block";
}

/* Force refresh UI state based on current auth */
function forceUIUpdate() {
  const user = auth?.currentUser;
  if (user) {
    showSignedInState(user);
    const profile = profileCache[user.uid];
    if (profile) {
      if (domElements.meAvatarSmall) domElements.meAvatarSmall.src = profile.photoURL || defaultAvatar();
      if (domElements.meName) domElements.meName.textContent = profile.username || user.email?.split("@")[0] || "User";
    }
  } else {
    showSignedOutState();
  }
}

/* ===== Auth State Handling ===== */
function setupAuthStateListener() {
  onAuthStateChanged(auth, async (user) => {
    authChecked = true;
    authReady = true;
    currentUser = user;
    if (!user) {
      showSignedOutState();
      setTimeout(() => { if (!auth.currentUser && authReady) window.location.replace("auth.html"); }, 8000);
      return;
    }
    try {
      await ensureMyUserDoc(user);
      const me = profileCache[user.uid] || await fetchProfile(user.uid);
      if (domElements.meAvatarSmall) domElements.meAvatarSmall.src = me.photoURL || defaultAvatar();
      if (domElements.meName) domElements.meName.textContent = me.username || (user.displayName || (user.email ? user.email.split("@")[0] : "User"));
      showSignedInState(user);
      startUserDocListener(user);
      startChatListener(user);
      startIncomingRequestsListener(user);
      startOutgoingRequestsListener(user);
    } catch (err) {
      debugError("Post-auth initialization error:", err);
    }
  });
}

/* ===== Initialize Everything ===== */
function initializeApp() {
  initializeDOMElements();
  if (!auth || !db) {
    debugError("Firebase not initialized!");
    return;
  }
  setupAuthButtons();
  setupAuthStateListener();
  // ===== DM FEATURE START =====
  setupFriendsListListener(); // New listener for DM buttons
  // ===== DM FEATURE END =====
  setTimeout(forceUIUpdate, 1000);
}

/* ===== Auth Buttons Setup ===== */
function setupAuthButtons() {
  if (domElements.authBtn) domElements.authBtn.addEventListener("click", () => { window.location.href = "auth.html"; });
  if (domElements.myProfileBtn) domElements.myProfileBtn.addEventListener("click", () => { if (auth.currentUser?.uid) openProfile(auth.currentUser.uid); });
  if (domElements.logoutBtn) domElements.logoutBtn.addEventListener("click", async () => { try { cleanupRealtime(); await signOut(auth); window.location.replace("auth.html"); } catch (err) { debugError("Logout failed:", err); } });
}

/* ===== Global Chat Listener & Send ===== */
function startChatListener(user) {
  if (!user || !domElements.chatBox || unsubscriptions.chat) return;
  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));
  unsubscriptions.chat = onSnapshot(q, async (snapshot) => {
    try {
      const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const missing = new Set(messages.map(m => m.senderId).filter(uid => uid && !profileCache[uid]));
      if (missing.size) await Promise.all(Array.from(missing).map(uid => fetchProfile(uid)));
      domElements.chatBox.innerHTML = "";
      for (const m of messages) {
        renderMessage(m, domElements.chatBox, domElements.chatMessageTemplate);
      }
      domElements.chatBox.scrollTop = domElements.chatBox.scrollHeight;
    } catch (err) {
      debugError("Chat render error:", err);
    }
  }, err => { debugError("Chat onSnapshot error:", err); });

  domElements.chatBox.addEventListener("click", (ev) => { const uid = ev.target.closest("[data-uid]")?.getAttribute("data-uid"); if (uid) openProfile(uid); });
  if (domElements.sendBtn) domElements.sendBtn.onclick = () => sendMessage(domElements.msgInput, 'global');
  if (domElements.msgInput) domElements.msgInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); domElements.sendBtn.click(); } });
}

// ===== DM FEATURE START =====

/* Create a unique DM channel ID from two user IDs */
function getDmChannelId(uid1, uid2) {
    return [uid1, uid2].sort().join('_');
}

/* Setup listener for DM buttons on the friends list */
function setupFriendsListListener() {
    if (!domElements.friendsList) return;
    domElements.friendsList.addEventListener('click', async (e) => {
        const dmButton = e.target.closest('.dm-btn');
        if (dmButton && currentUser) {
            const friendUid = dmButton.getAttribute('data-uid');
            const friendProfile = await fetchProfile(friendUid);
            openDM(friendUid, friendProfile);
        }
    });
}

/* Open a new DM window or focus an existing one */
function openDM(friendUid, friendProfile) {
    if (!friendUid || !domElements.dmChatsContainer) return;

    // If DM window already exists, do nothing.
    if (document.getElementById(`dm-chat-${friendUid}`)) {
        debugLog(`DM with ${friendUid} is already open.`);
        return;
    }
    
    debugLog(`Opening DM with ${friendUid}`);

    const clone = domElements.dmChatTemplate.content.cloneNode(true);
    const dmWindow = clone.querySelector('.dm-chat-window');
    dmWindow.id = `dm-chat-${friendUid}`;

    // Populate header
    clone.querySelector('.dm-friend-name').textContent = friendProfile.username || 'Friend';
    clone.querySelector('.friend-avatar').src = friendProfile.photoURL || defaultAvatar();

    // Add event listeners
    const closeBtn = clone.querySelector('.dm-close-btn');
    closeBtn.onclick = () => closeDM(friendUid);

    const sendBtn = clone.querySelector('.dm-send-btn');
    const msgInput = clone.querySelector('.dm-msg-input');
    sendBtn.onclick = () => sendMessage(msgInput, 'dm', friendUid);
    msgInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });
    
    domElements.dmChatsContainer.appendChild(clone);
    startDMListener(friendUid);
}

/* Close a DM window and stop its listener */
function closeDM(friendUid) {
    debugLog(`Closing DM with ${friendUid}`);
    const dmWindow = document.getElementById(`dm-chat-${friendUid}`);
    if (dmWindow) {
        dmWindow.remove();
    }
    // Stop the Firestore listener
    if (unsubscriptions.dms[friendUid]) {
        unsubscriptions.dms[friendUid]();
        delete unsubscriptions.dms[friendUid];
    }
}

/* Listen for messages in a specific DM channel */
function startDMListener(friendUid) {
    const channelId = getDmChannelId(currentUser.uid, friendUid);
    const messagesRef = collection(db, "dms", channelId, "messages");
    const q = query(messagesRef, orderBy("timestamp"));

    const dmChatBox = document.querySelector(`#dm-chat-${friendUid} .dm-chat-box`);
    if (!dmChatBox) return;

    unsubscriptions.dms[friendUid] = onSnapshot(q, async (snapshot) => {
        try {
            const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            // We already have the profiles of the two participants, so no need to fetch again
            dmChatBox.innerHTML = "";
            for (const m of messages) {
                renderMessage(m, dmChatBox, domElements.chatMessageTemplate);
            }
            dmChatBox.scrollTop = dmChatBox.scrollHeight;
        } catch (err) {
            debugError(`DM render error for ${friendUid}:`, err);
        }
    }, err => {
        debugError(`DM onSnapshot error for ${friendUid}:`, err);
    });
}

// ===== DM FEATURE END =====

/* Universal message sender for global and DM chats */
async function sendMessage(inputElement, type, recipientUid = null) {
  const text = (inputElement && inputElement.value || "").trim();
  if (!text || !auth.currentUser) return;

  try {
    const me = profileCache[auth.currentUser.uid] || await fetchProfile(auth.currentUser.uid);
    const messageData = {
      text,
      senderId: auth.currentUser.uid,
      senderName: me.username || auth.currentUser.email || "User",
      senderPhotoURL: me.photoURL || "",
      timestamp: serverTimestamp()
    };

    if (type === 'global') {
      await addDoc(collection(db, "servers", "defaultServer", "messages"), messageData);
    } else if (type === 'dm' && recipientUid) {
      const channelId = getDmChannelId(currentUser.uid, recipientUid);
      const channelRef = doc(db, "dms", channelId);
      // Ensure the DM document exists with participants list
      await setDoc(channelRef, { participants: [currentUser.uid, recipientUid] }, { merge: true });
      await addDoc(collection(channelRef, "messages"), messageData);
    }
    
    if (inputElement) inputElement.value = "";
  } catch (err) {
    debugError(`Send ${type} message failed:`, err);
    alert("Failed to send message. See console.");
  }
}

/* Universal message renderer */
function renderMessage(messageData, container, template) {
    if (!container || !template) return;
    
    const uid = messageData.senderId;
    const profile = profileCache[uid] || { username: "Unknown", photoURL: "" };
    const name = profile.username || messageData.senderName || "Unknown";
    const avatar = profile.photoURL || messageData.senderPhotoURL || defaultAvatar();
    const timeStr = messageData.timestamp?.toDate ? new Date(messageData.timestamp.toDate()).toLocaleString() : "";

    const clone = template.content.cloneNode(true);
    const msgElement = clone.querySelector(".chat-message");
    
    const img = clone.querySelector("img.avatar");
    const senderNameEl = clone.querySelector(".sender-name");
    const timeEl = clone.querySelector(".time");
    const textEl = clone.querySelector(".message-text");

    if(msgElement) msgElement.setAttribute("data-uid", uid || "");
    if (img) img.src = avatar;
    if (senderNameEl) senderNameEl.textContent = name;
    if (timeEl) timeEl.textContent = timeStr;
    if (textEl) textEl.textContent = messageData.text || "";

    container.appendChild(clone);
}


/* ===== Incoming friend requests listener ===== */
function startIncomingRequestsListener(user) {
    if (!user || !domElements.friendRequestsContainer || unsubscriptions.incomingRequests) return;
    const q = query(collection(db, "friendRequests"), where("toUid", "==", user.uid), where("status", "==", "pending"));
    unsubscriptions.incomingRequests = onSnapshot(q, async snapshot => {
        try {
            domElements.friendRequestsContainer.innerHTML = "";
            if (snapshot.empty) {
                domElements.friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
                return;
            }
            for (const d of snapshot.docs) {
                const data = d.data();
                const fromUid = data.fromUid;
                const prof = await fetchProfile(fromUid);
                const wrapper = document.createElement("div");
                wrapper.className = "friend-request-row";
                wrapper.innerHTML = `<div class="friend-request-info"><img src="${escapeHtml(prof.photoURL || defaultAvatar())}" class="avatar-small" alt="avatar"><span class="friend-name">${escapeHtml(prof.username || fromUid)}</span></div>`;
                const actions = document.createElement("div");
                actions.className = "friend-request-actions";
                const accept = document.createElement("button");
                accept.textContent = "Accept";
                const decline = document.createElement("button");
                decline.textContent = "Decline";
                decline.className = "secondary";
                accept.onclick = async () => { try { await updateDoc(doc(db, "friendRequests", d.id), { status: "accepted", respondedAt: serverTimestamp() }); await updateDoc(doc(db, "users", user.uid), { friends: arrayUnion(fromUid) }); await updateDoc(doc(db, "users", fromUid), { friends: arrayUnion(user.uid) }); } catch (err) { debugError("Accept failed", err); } };
                decline.onclick = async () => { try { await updateDoc(doc(db, "friendRequests", d.id), { status: "declined", respondedAt: serverTimestamp() }); } catch (err) { debugError("Decline failed", err); } };
                actions.append(accept, decline);
                wrapper.appendChild(actions);
                wrapper.querySelector('.friend-request-info').onclick = () => openProfile(fromUid);
                domElements.friendRequestsContainer.appendChild(wrapper);
            }
        } catch (err) {
            debugError("Requests render error:", err);
        }
    }, err => { debugError("Requests onSnapshot error:", err); });
}

/* ===== Outgoing friend requests listener ===== */
function startOutgoingRequestsListener(user) {
  // This function is now less critical as friendships are made reciprocal on accept.
  // It can be kept for backward compatibility or removed. For now, it's simplified.
  if (!user || unsubscriptions.outgoingRequests) return;
  debugLog("Outgoing request listener is minimal. Friendships are now reciprocal on accept.");
}

/* ===== User doc listener for friends & topbar updates ===== */
function startUserDocListener(user) {
  if (!user || unsubscriptions.userDoc) return;
  const userRef = doc(db, "users", user.uid);
  unsubscriptions.userDoc = onSnapshot(userRef, async snap => {
    if (!snap.exists()) {
      debugError("User doc missing after login:", user.uid);
      return;
    }
    const data = snap.data();
    profileCache[user.uid] = data;
    if (domElements.meAvatarSmall) domElements.meAvatarSmall.src = data.photoURL || defaultAvatar();
    if (domElements.meName) domElements.meName.textContent = data.username || (auth.currentUser?.email ? auth.currentUser.email.split("@")[0] : "User");
    showSignedInState(user);

    // Render Friends List with DM buttons
    try {
      const friends = Array.isArray(data.friends) ? data.friends : [];
      domElements.friendsList.innerHTML = "";
      if (!friends.length) {
        domElements.friendsList.innerHTML = "<div class='small'>No friends yet</div>";
      } else {
        await Promise.all(friends.map(uid => fetchProfile(uid)));
        for (const uid of friends) {
          const p = profileCache[uid] || { username: uid, photoURL: "" };
          const clone = domElements.dmFriendItemTemplate.content.cloneNode(true);
          const friendItem = clone.querySelector('.friend-item');
          friendItem.querySelector('.friend-avatar').src = p.photoURL || defaultAvatar();
          friendItem.querySelector('.friend-name').textContent = p.username || uid;
          friendItem.querySelector('.friend-info').onclick = () => openProfile(uid);
          friendItem.querySelector('.dm-btn').setAttribute('data-uid', uid);
          domElements.friendsList.appendChild(friendItem);
        }
      }
    } catch (err) {
      debugError("Error rendering friends", err);
      if (domElements.friendsList) domElements.friendsList.innerHTML = "<div class='small'>Failed to load friends</div>";
    }
  }, err => {
    debugError("User doc snapshot error:", err);
  });
}

/* ===== Main Initialization ===== */
document.addEventListener("DOMContentLoaded", () => {
  initializeApp();
});

if (document.readyState !== 'loading') {
  initializeApp();
}

/* ===== Safety fallback redirect ===== */
setTimeout(() => {
  if (!authChecked) {
    debugError("Auth check timed out; redirecting to auth.html");
    window.location.replace("auth.html");
  }
}, 15000);
