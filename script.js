// script.js — Final fix for friend acceptance and race conditions
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

import { uploadProfileImage } from "./cloudinary.js"; // still needed by profile page

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
    friendItemTemplate: document.getElementById("friendItemTemplate")
  };
  return domElements;
}

/* ===== State ===== */
let authChecked = false;
let authReady = false;
let currentUser = null;
let unsubscriptions = { chat: null, userDoc: null, incomingRequests: null, outgoingRequests: null };
const profileCache = {}; // uid -> profile data cache
let isAcceptingFriend = false; // Flag to handle acceptance delay

/* ===== Helpers ===== */
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
  } catch (err) {
    debugError("fetchProfile error", err);
  }
  profileCache[uid] = { username: "Unknown", photoURL: "" };
  return profileCache[uid];
}

/* ensure users/{uid} exists for the signed-in user */
async function ensureMyUserDoc(user) {
  if (!user) return;
  const ref = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      debugLog("User doc doesn't exist, creating...");
      const defaultUsername = user.email ? user.email.split("@")[0] : "User";
      const newUserDoc = {
        username: defaultUsername,
        usernameLower: defaultUsername.toLowerCase(),
        bio: "",
        photoURL: "",
        friends: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      await setDoc(ref, newUserDoc);
      profileCache[user.uid] = newUserDoc;
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
    if (unsubscriptions[k]) unsubscriptions[k]();
    unsubscriptions[k] = null;
  });
  if (domElements.chatBox) domElements.chatBox.innerHTML = "";
  if (domElements.friendsList) domElements.friendsList.innerHTML = "";
  if (domElements.friendRequestsContainer) domElements.friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
}

/* Show signed out state */
function showSignedOutState() {
  debugLog("=== SHOWING SIGNED OUT STATE ===");
  document.body.classList.add('signed-out');
  document.body.classList.remove('signed-in');
}

/* Show signed in state */
function showSignedInState() {
  debugLog("=== SHOWING SIGNED IN STATE ===");
  document.body.classList.add('signed-in');
  document.body.classList.remove('signed-out');
}

/* ===== Auth State Handling ===== */
function setupAuthStateListener() {
  debugLog("Setting up auth state listener");
  onAuthStateChanged(auth, async (user) => {
    authChecked = true;
    authReady = true;
    currentUser = user;

    if (!user) {
      debugLog("User signed out");
      cleanupRealtime();
      showSignedOutState();
      return;
    }

    // User signed in
    try {
      debugLog("User is signed in, initializing...");
      await ensureMyUserDoc(user);

      const me = profileCache[user.uid];
      if (domElements.meAvatarSmall) domElements.meAvatarSmall.src = me.photoURL || defaultAvatar();
      if (domElements.meName) domElements.meName.textContent = me.username;
      
      showSignedInState();

      // Start listeners
      startUserDocListener(user);
      startChatListener(user);
      startIncomingRequestsListener(user);
      startOutgoingRequestsListener(user);

      debugLog("=== USER INITIALIZATION COMPLETE ===");
    } catch (err) {
      debugError("Post-auth initialization error:", err);
    }
  });
}

/* ===== Initialize Everything ===== */
function initializeApp() {
  debugLog("=== INITIALIZING APP ===");
  initializeDOMElements();
  if (!auth || !db) {
    debugError("Firebase not initialized!");
    return;
  }
  setupAuthButtons();
  setupAuthStateListener();
}

/* ===== Auth Buttons Setup ===== */
function setupAuthButtons() {
  domElements.authBtn?.addEventListener("click", () => {
    window.location.href = "auth.html";
  });
  domElements.myProfileBtn?.addEventListener("click", () => {
    if (currentUser) openProfile(currentUser.uid);
  });
  domElements.logoutBtn?.addEventListener("click", async () => {
    try {
      debugLog("Logging out...");
      await signOut(auth);
      window.location.replace("auth.html");
    } catch (err) {
      debugError("Logout failed:", err);
    }
  });
}

/**
 * Creates an HTML element for a single chat message.
 */
function createMessageElement(messageData) {
  const { senderId, senderName, senderPhotoURL, text, timestamp } = messageData;
  if (!domElements.chatMessageTemplate) return null;

  const profile = profileCache[senderId] || { username: senderName, photoURL: senderPhotoURL };
  const name = profile.username || "Unknown";
  const avatar = profile.photoURL || defaultAvatar();
  const timeStr = timestamp?.toDate ? new Date(timestamp.toDate()).toLocaleString() : "";

  const clone = domElements.chatMessageTemplate.content.cloneNode(true);
  const msgElement = clone.querySelector(".chat-message");
  const imgEl = clone.querySelector("img.avatar");
  const senderNameEl = clone.querySelector(".sender-name");
  const timeEl = clone.querySelector(".time");
  const textEl = clone.querySelector(".message-text");

  if (msgElement) msgElement.setAttribute("data-uid", senderId || "");
  if (imgEl) imgEl.src = avatar;
  if (senderNameEl) senderNameEl.textContent = name;
  if (timeEl) timeEl.textContent = timeStr;
  if (textEl) textEl.innerHTML = escapeHtml(text || "");

  const wrapper = document.createElement("div");
  wrapper.appendChild(clone);
  return wrapper.firstElementChild;
}

/* ===== Chat Listener & Send ===== */
function startChatListener(user) {
  if (!user || !domElements.chatBox || unsubscriptions.chat) return;

  debugLog("Starting chat listener");
  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));
  
  domElements.chatBox.innerHTML = "";

  unsubscriptions.chat = onSnapshot(q, async (snapshot) => {
    const changes = snapshot.docChanges();
    if (changes.length === 0) return;

    const newMessages = changes.filter(c => c.type === 'added').map(c => c.doc.data());
    const missingProfiles = new Set(newMessages.filter(m => m.senderId && !profileCache[m.senderId]).map(m => m.senderId));
    if (missingProfiles.size > 0) {
      await Promise.all(Array.from(missingProfiles).map(uid => fetchProfile(uid)));
    }
    
    const shouldScroll = domElements.chatBox.scrollTop + domElements.chatBox.clientHeight >= domElements.chatBox.scrollHeight - 50;

    changes.forEach(change => {
      if (change.type === "added") {
        const messageElement = createMessageElement(change.doc.data());
        if (messageElement) domElements.chatBox.appendChild(messageElement);
      }
    });
    
    if (shouldScroll) domElements.chatBox.scrollTop = domElements.chatBox.scrollHeight;
  }, err => debugError("Chat onSnapshot error:", err));

  domElements.chatBox.addEventListener("click", (ev) => {
    const target = ev.target.closest("[data-uid]");
    if (target?.dataset.uid) openProfile(target.dataset.uid);
  });

  const sendMessage = async () => {
    const text = domElements.msgInput?.value.trim();
    if (!text || !currentUser) return;
    try {
      const me = profileCache[currentUser.uid] || await fetchProfile(currentUser.uid);
      await addDoc(messagesRef, {
        text,
        senderId: currentUser.uid,
        senderName: me.username || "User",
        senderPhotoURL: me.photoURL || "",
        timestamp: serverTimestamp()
      });
      if (domElements.msgInput) domElements.msgInput.value = "";
    } catch (err) {
      debugError("Send message failed:", err);
    }
  };

  domElements.sendBtn?.addEventListener("click", sendMessage);
  domElements.msgInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

/* ===== Incoming friend requests listener ===== */
function startIncomingRequestsListener(user) {
  if (!user || !domElements.friendRequestsContainer || unsubscriptions.incomingRequests) return;

  const q = query(collection(db, "friendRequests"), where("toUid", "==", user.uid), where("status", "==", "pending"));

  unsubscriptions.incomingRequests = onSnapshot(q, async (snapshot) => {
    if (!domElements.friendRequestsContainer) return;
    domElements.friendRequestsContainer.innerHTML = "";
    if (snapshot.empty) {
      domElements.friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
      return;
    }

    for (const d of snapshot.docs) {
      const { fromUid } = d.data();
      const prof = await fetchProfile(fromUid);

      const wrapper = document.createElement("div");
      wrapper.className = "friend-request-row";
      wrapper.innerHTML = `<img src="${prof.photoURL || defaultAvatar()}" class="avatar-small"><strong>${escapeHtml(prof.username || fromUid)}</strong>`;
      
      const acceptBtn = document.createElement("button");
      acceptBtn.textContent = "Accept";
      const declineBtn = document.createElement("button");
      declineBtn.textContent = "Decline";
      
      acceptBtn.onclick = async (e) => {
        e.stopPropagation();
        isAcceptingFriend = true; // Set flag to delay verification
        try {
          // Add friend to both users' friend lists and update the request
          const requestRef = doc(db, "friendRequests", d.id);
          const myRef = doc(db, "users", user.uid);
          const theirRef = doc(db, "users", fromUid);
          await Promise.all([
            updateDoc(requestRef, { status: "accepted", respondedAt: serverTimestamp() }),
            updateDoc(myRef, { friends: arrayUnion(fromUid) }),
            updateDoc(theirRef, { friends: arrayUnion(user.uid) })
          ]);
        } catch (err) {
          debugError("Accept friend failed", err);
          alert("Failed to accept friend request. The other user's account may not exist.");
        } finally {
          // After 1 second, reset the flag. This allows Firestore time to sync.
          setTimeout(() => { isAcceptingFriend = false; }, 1000);
        }
      };

      declineBtn.onclick = (e) => {
        e.stopPropagation();
        updateDoc(doc(db, "friendRequests", d.id), { status: "declined", respondedAt: serverTimestamp() });
      };

      const btnWrapper = document.createElement("span");
      btnWrapper.className = "button-group";
      btnWrapper.append(acceptBtn, declineBtn);
      wrapper.append(btnWrapper);
      wrapper.onclick = () => openProfile(fromUid);
      domElements.friendRequestsContainer.appendChild(wrapper);
    }
  }, err => debugError("Requests onSnapshot error:", err));
}

/* ===== Outgoing friend requests listener (processes accepted requests from others) ===== */
function startOutgoingRequestsListener(user) {
    // This function is kept for backward compatibility if the atomic accept fails or for other systems.
    // It ensures that if someone accepts your request, you add them back.
    if (!user || unsubscriptions.outgoingRequests) return;
    const q = query(collection(db, "friendRequests"), where("fromUid", "==", user.uid), where("status", "==", "accepted"));
    unsubscriptions.outgoingRequests = onSnapshot(q, (snapshot) => {
        snapshot.docs.forEach(d => {
            const { toUid, processed } = d.data();
            if (processed) return;
            const myFriends = profileCache[user.uid]?.friends || [];
            if (!myFriends.includes(toUid)) {
                updateDoc(doc(db, "users", user.uid), { friends: arrayUnion(toUid) });
            }
            updateDoc(d.ref, { processed: true, processedAt: serverTimestamp() });
        });
    }, err => debugError("Outgoing requests snapshot error:", err));
}

/* ===== User doc listener for friends & topbar updates ===== */
function startUserDocListener(user) {
  if (!user || unsubscriptions.userDoc) return;

  const userRef = doc(db, "users", user.uid);
  unsubscriptions.userDoc = onSnapshot(userRef, async (snap) => {
    // **FIX**: If we just accepted a friend, wait before running verification.
    if (isAcceptingFriend) {
      debugLog("Delaying friend list render due to recent acceptance.");
      return;
    }
    
    if (!snap.exists()) {
      debugError("User doc missing after login:", user.uid);
      return;
    }

    const data = snap.data();
    profileCache[user.uid] = data;

    if (domElements.meAvatarSmall) domElements.meAvatarSmall.src = data.photoURL || defaultAvatar();
    if (domElements.meName) domElements.meName.textContent = data.username;

    const friends = data.friends || [];
    
    // --- Self-Healing Friend Verification ---
    const friendsToRemove = [];
    if (friends.length > 0) {
        const friendDocs = await Promise.all(friends.map(uid => getDoc(doc(db, "users", uid))));
        friends.forEach((friendUid, index) => {
            const friendDoc = friendDocs[index];
            if (!friendDoc.exists() || !friendDoc.data().friends?.includes(user.uid)) {
                friendsToRemove.push(friendUid);
            }
        });

        if (friendsToRemove.length > 0) {
            debugLog("Removing non-reciprocal friends:", friendsToRemove);
            const verifiedFriends = friends.filter(uid => !friendsToRemove.includes(uid));
            await updateDoc(userRef, { friends: verifiedFriends });
            return; // Listener will re-run with the corrected list
        }
    }

    // --- Render Friends List ---
    if (!domElements.friendsList) return;
    domElements.friendsList.innerHTML = "";
    if (friends.length === 0) {
      domElements.friendsList.innerHTML = "<div class='small'>No friends yet</div>";
    } else {
      await Promise.all(friends.map(uid => fetchProfile(uid)));
      friends.forEach(uid => {
        const p = profileCache[uid] || {};
        const friendItemWrapper = document.createElement("li");
        friendItemWrapper.className = "friend-item";
        friendItemWrapper.innerHTML = `<img src="${p.photoURL || defaultAvatar()}" class="avatar-small"><span>${escapeHtml(p.username || uid)}</span>`;
        friendItemWrapper.onclick = () => openProfile(uid);
        domElements.friendsList.appendChild(friendItemWrapper);
      });
    }
  }, err => debugError("User doc snapshot error:", err));
}

/* ===== Main Initialization ===== */
document.addEventListener("DOMContentLoaded", initializeApp);

// Fallback initialization if the script is loaded after the DOM is ready
if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(initializeApp, 1);
}

/* ===== Safety Fallbacks ===== */
// Redirect to auth page if Firebase doesn't initialize in time
setTimeout(() => {
  if (!authChecked) {
    debugError("Auth check timed out; redirecting to auth.html");
    window.location.replace("auth.html");
  }
}, 15000);

// Force a UI update if the user is signed in but the UI is still hidden after 5s
setTimeout(() => {
  if (authReady && currentUser && !document.body.classList.contains('signed-in')) {
    debugError("User is signed in but UI not showing, forcing update.");
    showSignedInState();
  }
}, 5000);


// Add debug info to the window object for easier console debugging on localhost
if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  window.debugScript = {
    forceUIUpdate: () => {
        if(currentUser) showSignedInState(); else showSignedOutState();
    },
    showSignedInState,
    showSignedOutState,
    getDomElements: () => domElements,
    getAuth: () => auth,
    getCurrentUser: () => currentUser,
    getProfileCache: () => profileCache
  };
  debugLog("Debug functions added to window.debugScript");
}

debugLog("script.js loaded — final version active");
