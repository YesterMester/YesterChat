// script.js — Fixed with extensive debugging for auth state issues
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

  debugLog("DOM Elements initialized:", {
    mePreview: !!domElements.mePreview,
    meAvatarSmall: !!domElements.meAvatarSmall,
    meName: !!domElements.meName,
    myProfileBtn: !!domElements.myProfileBtn,
    authBtn: !!domElements.authBtn,
    logoutBtn: !!domElements.logoutBtn,
    signedOutNotice: !!domElements.signedOutNotice,
    friendsContainer: !!domElements.friendsContainer,
    friendsList: !!domElements.friendsList,
    friendRequestsContainer: !!domElements.friendRequestsContainer,
    chatContainer: !!domElements.chatContainer,
    chatBox: !!domElements.chatBox,
    msgInput: !!domElements.msgInput,
    sendBtn: !!domElements.sendBtn,
    chatMessageTemplate: !!domElements.chatMessageTemplate,
    friendItemTemplate: !!domElements.friendItemTemplate
  });

  return domElements;
}

/* ===== State ===== */
let authChecked = false;
let authReady = false;
let currentUser = null;
let unsubscriptions = { chat: null, userDoc: null, incomingRequests: null, outgoingRequests: null };
const profileCache = {}; // uid -> profile data cache

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
      debugLog(`Profile cached for ${uid}:`, profileCache[uid]);
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
  debugLog(`Ensuring user doc exists for ${user.uid}`);
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
      profileCache[user.uid] = {
        username: defaultUsername,
        usernameLower: defaultUsername.toLowerCase(),
        bio: "",
        photoURL: "",
        friends: []
      };
      debugLog("User doc created");
    } else {
      profileCache[user.uid] = snap.data();
      debugLog("User doc exists, cached profile");
    }
  } catch (err) {
    debugError("ensureMyUserDoc error:", err);
  }
}

/* Cleanup realtime listeners */
function cleanupRealtime() {
  debugLog("Cleaning up realtime listeners");
  Object.keys(unsubscriptions).forEach(k => {
    try { unsubscriptions[k]?.(); } catch (e) {}
    unsubscriptions[k] = null;
  });
  // clear UI sections
  if (domElements.chatBox) domElements.chatBox.innerHTML = "";
  if (domElements.friendsList) domElements.friendsList.innerHTML = "";
  if (domElements.friendRequestsContainer) domElements.friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
}

/* Show signed out state */
function showSignedOutState() {
  debugLog("=== SHOWING SIGNED OUT STATE ===");

  if (domElements.mePreview) {
    domElements.mePreview.style.display = "none";
    debugLog("Hidden mePreview");
  }

  if (domElements.myProfileBtn) { 
    domElements.myProfileBtn.style.display = "none"; 
    domElements.myProfileBtn.onclick = null; 
    debugLog("Hidden myProfileBtn");
  }

  if (domElements.logoutBtn) {
    domElements.logoutBtn.style.display = "none";
    debugLog("Hidden logoutBtn");
  }

  if (domElements.authBtn) {
    domElements.authBtn.style.display = "inline-block";
    debugLog("Shown authBtn");
  }

  if (domElements.signedOutNotice) {
    domElements.signedOutNotice.style.display = "block";
    debugLog("Shown signedOutNotice");
  }

  if (domElements.chatContainer) {
    domElements.chatContainer.style.display = "none";
    debugLog("Hidden chatContainer");
  }

  if (domElements.friendsContainer) {
    domElements.friendsContainer.style.display = "none";
    debugLog("Hidden friendsContainer");
  }

  cleanupRealtime();
  debugLog("=== SIGNED OUT STATE COMPLETE ===");
}

/* Show signed in state */
function showSignedInState(user) {
  debugLog("=== SHOWING SIGNED IN STATE ===", { uid: user.uid });

  if (domElements.mePreview) {
    domElements.mePreview.style.display = "inline-flex";
    debugLog("Shown mePreview");
  }

  if (domElements.myProfileBtn) { 
    domElements.myProfileBtn.style.display = "inline-block"; 
    domElements.myProfileBtn.onclick = () => openProfile(user.uid); 
    debugLog("Shown myProfileBtn");
  }

  if (domElements.logoutBtn) {
    domElements.logoutBtn.style.display = "inline-block";
    debugLog("Shown logoutBtn");
  }

  if (domElements.authBtn) {
    domElements.authBtn.style.display = "none";
    debugLog("Hidden authBtn");
  }

  if (domElements.signedOutNotice) {
    domElements.signedOutNotice.style.display = "none";
    debugLog("Hidden signedOutNotice");
  }

  if (domElements.friendsContainer) {
    domElements.friendsContainer.style.display = "block";
    debugLog("Shown friendsContainer");
  }

  if (domElements.chatContainer) {
    domElements.chatContainer.style.display = "block";
    debugLog("Shown chatContainer");
  }

  debugLog("=== SIGNED IN STATE COMPLETE ===");
}

/* Force refresh UI state based on current auth */
function forceUIUpdate() {
  debugLog("=== FORCING UI UPDATE ===");
  const user = auth?.currentUser;

  if (user) {
    debugLog("User exists, forcing signed in state", { uid: user.uid });
    showSignedInState(user);

    // Update profile info if cached
    const profile = profileCache[user.uid];
    if (profile) {
      if (domElements.meAvatarSmall) domElements.meAvatarSmall.src = profile.photoURL || defaultAvatar();
      if (domElements.meName) domElements.meName.textContent = profile.username || user.email?.split("@")[0] || "User";
      debugLog("Updated profile info from cache");
    }
  } else {
    debugLog("No user, forcing signed out state");
    showSignedOutState();
  }
}

/* ===== Auth State Handling ===== */
function setupAuthStateListener() {
  debugLog("Setting up auth state listener");

  onAuthStateChanged(auth, async (user) => {
    authChecked = true;
    authReady = true;
    currentUser = user;

    debugLog("=== AUTH STATE CHANGED ===", user ? { uid: user.uid, email: user.email } : "null");

    if (!user) {
      debugLog("User signed out");
      showSignedOutState();

      // Friendly redirect to auth page after 8s
      setTimeout(() => {
        if (!auth.currentUser && authReady) {
          debugLog("Redirecting to auth.html - no user found");
          window.location.replace("auth.html");
        }
      }, 8000);
      return;
    }

    // User signed in
    try {
      debugLog("User is signed in, initializing...");
      await ensureMyUserDoc(user);

      const me = profileCache[user.uid] || await fetchProfile(user.uid);

      // Update topbar immediately
      if (domElements.meAvatarSmall) domElements.meAvatarSmall.src = me.photoURL || defaultAvatar();
      if (domElements.meName) domElements.meName.textContent = me.username || (user.displayName || (user.email ? user.email.split("@")[0] : "User"));

      // Show signed in state
      showSignedInState(user);

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

  // Initialize DOM elements
  initializeDOMElements();

  // Check if Firebase is ready
  if (!auth || !db) {
    debugError("Firebase not initialized!");
    return;
  }

  // Setup auth buttons
  setupAuthButtons();

  // Setup auth state listener
  setupAuthStateListener();

  // Force initial UI update after delay
  setTimeout(forceUIUpdate, 1000);

  debugLog("=== APP INITIALIZATION COMPLETE ===");
}

/* ===== Auth Buttons Setup ===== */
function setupAuthButtons() {
  debugLog("Setting up auth buttons");

  if (domElements.authBtn) {
    domElements.authBtn.addEventListener("click", () => {
      debugLog("Auth button clicked");
      window.location.href = "auth.html";
    });
  }

  if (domElements.myProfileBtn) {
    domElements.myProfileBtn.addEventListener("click", () => {
      const uid = auth.currentUser?.uid;
      if (uid) openProfile(uid);
    });
  }

  if (domElements.logoutBtn) {
    domElements.logoutBtn.addEventListener("click", async () => {
      try {
        debugLog("Logging out...");
        cleanupRealtime();
        await signOut(auth);
        window.location.replace("auth.html");
      } catch (err) {
        debugError("Logout failed:", err);
        alert("Logout failed. See console.");
      }
    });
  }
}

/* ===== Chat Listener & Send ===== */
function startChatListener(user) {
  if (!user || !domElements.chatBox) return;
  if (unsubscriptions.chat) {
    debugLog("Chat listener already active");
    return;
  }

  debugLog("Starting chat listener");
  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  unsubscriptions.chat = onSnapshot(q, async (snapshot) => {
    try {
      debugLog("Chat messages updated:", snapshot.docs.length);
      const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const missing = new Set();
      messages.forEach(m => { if (m.senderId && !profileCache[m.senderId]) missing.add(m.senderId); });
      if (missing.size) await Promise.all(Array.from(missing).map(uid => fetchProfile(uid)));

      domElements.chatBox.innerHTML = "";
      for (const m of messages) {
        const uid = m.senderId;
        const prof = uid ? (profileCache[uid] || { username: m.senderName || "Unknown", photoURL: m.senderPhotoURL || "" }) : { username: m.senderName || "Unknown", photoURL: "" };
        const name = prof.username || m.senderName || "Unknown";
        const avatar = prof.photoURL || m.senderPhotoURL || defaultAvatar();
        const timeStr = m.timestamp && m.timestamp.toDate ? new Date(m.timestamp.toDate()).toLocaleString() : "";

        if (domElements.chatMessageTemplate) {
          const clone = domElements.chatMessageTemplate.content.cloneNode(true);
          const img = clone.querySelector("img.avatar");
          const senderNameEl = clone.querySelector(".sender-name");
          const timeEl = clone.querySelector(".time");
          const textEl = clone.querySelector(".message-text");

          if (img) {
            img.src = avatar;
            img.setAttribute("data-uid", uid || "");
            img.style.cursor = uid ? "pointer" : "default";
          }

          if (senderNameEl) {
            senderNameEl.textContent = name;
            senderNameEl.setAttribute("data-uid", uid || "");
            senderNameEl.style.cursor = uid ? "pointer" : "default";
          }

          if (timeEl) timeEl.textContent = timeStr;
          if (textEl) textEl.innerHTML = escapeHtml(m.text || "");

          const wrapper = document.createElement("div");
          wrapper.appendChild(clone);
          domElements.chatBox.appendChild(wrapper.firstElementChild || wrapper);
        } else {
          const p = document.createElement("p");
          p.innerHTML = `<strong data-uid="${uid}">${escapeHtml(name)}</strong>: ${escapeHtml(m.text || "")}`;
          domElements.chatBox.appendChild(p);
        }
      }
      domElements.chatBox.scrollTop = domElements.chatBox.scrollHeight;
    } catch (err) {
      debugError("Chat render error:", err);
    }
  }, err => {
    debugError("Chat onSnapshot error:", err);
    if (err && err.code === "permission-denied" && domElements.chatBox) {
      domElements.chatBox.innerHTML = "<div style='color:crimson'>Permission denied reading messages. Check Firestore rules.</div>";
    }
  });

  // Name/avatar click -> profile
  domElements.chatBox.addEventListener("click", (ev) => {
    const t = ev.target;
    const uid = t.getAttribute?.("data-uid") || t.closest?.("[data-uid]")?.getAttribute("data-uid");
    if (uid) openProfile(uid);
  });

  // Send messages
  if (domElements.sendBtn) {
    domElements.sendBtn.onclick = async () => {
      const text = (domElements.msgInput && domElements.msgInput.value || "").trim();
      if (!text) return;
      if (!auth.currentUser) return alert("You must be signed in to send messages.");
      try {
        await fetchProfile(auth.currentUser.uid);
        const me = profileCache[auth.currentUser.uid] || {};
        await addDoc(collection(db, "servers", "defaultServer", "messages"), {
          text,
          senderId: auth.currentUser.uid,
          senderName: me.username || auth.currentUser.email || "User",
          senderPhotoURL: me.photoURL || "",
          timestamp: serverTimestamp()
        });
        if (domElements.msgInput) domElements.msgInput.value = "";
      } catch (err) {
        debugError("Send message failed:", err);
        alert("Failed to send message. See console.");
      }
    };

    if (domElements.msgInput) {
      domElements.msgInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          domElements.sendBtn.click();
        }
      });
    }
  }
}

/* ===== Incoming friend requests listener ===== */
function startIncomingRequestsListener(user) {
  if (!user || !domElements.friendRequestsContainer) return;
  if (unsubscriptions.incomingRequests) return;

  debugLog("Starting incoming requests listener");
  const q = query(
    collection(db, "friendRequests"),
    where("toUid", "==", user.uid),
    where("status", "==", "pending")
  );

  unsubscriptions.incomingRequests = onSnapshot(q, async snapshot => {
    try {
      debugLog("Incoming requests updated:", snapshot.docs.length);
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
            await updateDoc(doc(db, "friendRequests", d.id), {
              status: "accepted",
              respondedAt: serverTimestamp(),
              acceptedBy: user.uid
            });
            const meRef = doc(db, "users", user.uid);
            await updateDoc(meRef, { friends: arrayUnion(fromUid) });
          } catch (err) {
            debugError("Accept failed", err);
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
            debugError("Decline failed", err);
            alert("Decline failed. Check console for details.");
          }
        });

        const btnWrap = document.createElement("span");
        btnWrap.style.marginLeft = "8px";
        btnWrap.appendChild(accept);
        btnWrap.appendChild(decline);
        wrapper.appendChild(btnWrap);

        wrapper.addEventListener("click", () => openProfile(fromUid));
        domElements.friendRequestsContainer.appendChild(wrapper);
      }
    } catch (err) {
      debugError("Requests render error:", err);
      if (domElements.friendRequestsContainer) {
        domElements.friendRequestsContainer.innerHTML = "<div class='small'>Failed to load requests</div>";
      }
    }
  }, err => {
    debugError("Requests onSnapshot error:", err);
    if (domElements.friendRequestsContainer) {
      domElements.friendRequestsContainer.innerHTML = "<div class='small' style='color:crimson'>Permission error loading requests</div>";
    }
  });
}

/* ===== Outgoing friend requests listener ===== */
function startOutgoingRequestsListener(user) {
  if (!user) return;
  if (unsubscriptions.outgoingRequests) return;

  debugLog("Starting outgoing requests listener");
  const q = query(
    collection(db, "friendRequests"),
    where("fromUid", "==", user.uid),
    where("status", "==", "accepted")
  );

  unsubscriptions.outgoingRequests = onSnapshot(q, async snapshot => {
    try {
      if (snapshot.empty) return;
      debugLog("Processing", snapshot.docs.length, "accepted outgoing requests");

      for (const d of snapshot.docs) {
        const data = d.data();
        const toUid = data.toUid;
        if (data.processed === true) continue;

        try {
                              const myRef = doc(db, "users", user.uid);
          await updateDoc(myRef, { friends: arrayUnion(toUid) });
          await updateDoc(doc(db, "friendRequests", d.id), { processed: true, processedAt: serverTimestamp() });
          debugLog("Processed accepted request from", toUid);
        } catch (err) {
          debugError("Outgoing request processing failed for", d.id, err);
        }
      }
    } catch (err) {
      debugError("Outgoing requests snapshot error:", err);
    }
  }, err => {
    debugError("Outgoing requests onSnapshot error:", err);
  });
}

/* ===== User doc listener for friends & topbar updates ===== */
function startUserDocListener(user) {
  if (!user) return;
  if (unsubscriptions.userDoc) return;

  debugLog("Starting user doc listener");
  const userRef = doc(db, "users", user.uid);
  unsubscriptions.userDoc = onSnapshot(userRef, async snap => {
    if (!snap.exists()) {
      debugError("User doc missing after login:", user.uid);
      return;
    }

    const data = snap.data();
    profileCache[user.uid] = data;
    debugLog("User doc updated:", data);

    // Update topbar
    if (domElements.meAvatarSmall) domElements.meAvatarSmall.src = data.photoURL || defaultAvatar();
    if (domElements.meName) domElements.meName.textContent = data.username || (auth.currentUser?.email ? auth.currentUser.email.split("@")[0] : "User");

    // Ensure UI is visible
    showSignedInState(user);

    // ====================================================================
    // ===== MODIFICATION START: Friend Verification & UI Rendering Fix =====
    // ====================================================================

    const friends = Array.isArray(data.friends) ? data.friends : [];
    const verifiedFriends = [];
    const friendsToRemove = [];

    // --- Friend Removal Check ---
    // This section verifies that each person on your friends list also has you on theirs.
    // If the friendship is not reciprocal or the user was deleted, they are removed.
    if (friends.length > 0) {
      debugLog(`Verifying ${friends.length} friendships for reciprocity...`);
      const friendDocsPromises = friends.map(uid => getDoc(doc(db, "users", uid)));
      const friendDocsSnaps = await Promise.all(friendDocsPromises);

      friendDocsSnaps.forEach((friendSnap, index) => {
        const friendUid = friends[index];
        if (friendSnap.exists()) {
          const friendData = friendSnap.data();
          // Check if they have the current user in their friends list
          if (Array.isArray(friendData.friends) && friendData.friends.includes(user.uid)) {
            verifiedFriends.push(friendUid);
          } else {
            debugLog(`Friendship not reciprocated by ${friendUid}. Marking for removal.`);
            friendsToRemove.push(friendUid);
          }
        } else {
          // Friend's user document has been deleted.
          debugLog(`Friend document for ${friendUid} not found. Marking for removal.`);
          friendsToRemove.push(friendUid);
        }
      });

      if (friendsToRemove.length > 0) {
        debugLog(`Removing ${friendsToRemove.length} stale friend entries.`, friendsToRemove);
        // Update the user's document with the clean list of verified friends.
        await updateDoc(userRef, { friends: verifiedFriends });
        // The listener will re-run automatically after this update, so we can stop here
        // to avoid rendering the old, incorrect list.
        return;
      }
    }

    // --- Render Friends List ---
    try {
      debugLog("Rendering", friends.length, "friends");

      if (domElements.friendsList) {
        domElements.friendsList.innerHTML = "";
        if (!friends.length) {
          domElements.friendsList.innerHTML = "<div class='small'>No friends yet</div>";
        } else {
          await Promise.all(friends.map(uid => fetchProfile(uid)));
          for (const uid of friends) {
            const p = profileCache[uid] || { username: uid, photoURL: "" };
            if (domElements.friendItemTemplate) {

              // **BUG FIX**: This logic correctly handles the friend item template.
              // It creates a wrapper for each friend to ensure the entire item (image and name)
              // is added to the list and is clickable.

              const clone = domElements.friendItemTemplate.content.cloneNode(true);

              // Create a wrapper to ensure consistent structure and event handling.
              const friendItemWrapper = document.createElement("li");
              friendItemWrapper.className = "friend-item";

              // Find and populate elements within the cloned template.
              const img = clone.querySelector(".friend-avatar");
              const nameEl = clone.querySelector(".friend-name");
              if (img) img.src = p.photoURL || defaultAvatar();
              if (nameEl) nameEl.textContent = p.username || uid;

              // Append the entire populated template content to our wrapper.
              friendItemWrapper.appendChild(clone);

              // Add the click listener to the wrapper, making the whole item clickable.
              friendItemWrapper.addEventListener("click", () => openProfile(uid));

              // Append the final, fully-constructed item to the friends list.
              domElements.friendsList.appendChild(friendItemWrapper);

            } else {
              // Fallback logic (if template doesn't exist) remains the same.
              const li = document.createElement("li");
              li.className = "friend-item";
              li.innerHTML = `<img src="${p.photoURL || defaultAvatar()}" class="avatar-small" /><span>${escapeHtml(p.username || uid)}</span>`;
              li.addEventListener("click", () => openProfile(uid));
              domElements.friendsList.appendChild(li);
            }
          }
        }
      }
    } catch (err) {
      debugError("Error rendering friends", err);
      if (domElements.friendsList) {
        domElements.friendsList.innerHTML = "<div class='small'>Failed to load friends</div>";
      }
    }
    // ==================================================================
    // ===== MODIFICATION END: Friend Verification & UI Rendering Fix =====
    // ==================================================================
  }, err => {
    debugError("User doc snapshot error:", err);
    if (domElements.friendsList) {
      domElements.friendsList.innerHTML = "<div class='small' style='color:crimson'>Permission denied reading user data</div>";
    }
  });
}

/* ===== Helper functions (keeping original API) ===== */
async function hasExistingPendingRequestBetween(aUid, bUid) {
  try {
    const q1 = query(collection(db, "friendRequests"), where("fromUid", "==", aUid), where("toUid", "==", bUid), where("status", "==", "pending"));
    const q2 = query(collection(db, "friendRequests"), where("fromUid", "==", bUid), where("toUid", "==", aUid), where("status", "==", "pending"));
    const [r1, r2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    return !r1.empty || !r2.empty;
  } catch (err) {
    debugError("hasExistingPendingRequestBetween error", err);
    return false;
  }
}

/* ===== Main Initialization ===== */
document.addEventListener("DOMContentLoaded", () => {
  debugLog("=== DOM CONTENT LOADED ===");
  initializeApp();
});

// Fallback initialization if DOM is already loaded
if (document.readyState === 'loading') {
  // Do nothing, DOMContentLoaded will fire
} else {
  // DOM is already loaded
  debugLog("=== DOM ALREADY LOADED ===");
  setTimeout(initializeApp, 100);
}

/* ===== Safety fallback redirect ===== */
setTimeout(() => {
  if (!authChecked) {
    debugError("Auth check timed out; redirecting to auth.html");
    window.location.replace("auth.html");
  }
}, 15000);

// Check if user exists but UI isn't showing after 5 seconds
setTimeout(() => {
  if (authReady && auth?.currentUser && domElements.chatContainer && domElements.chatContainer.style.display === "none") {
    debugError("User signed in but UI not showing, forcing update");
    forceUIUpdate();
  }
}, 5000);

// Add debug info to window for console debugging
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  window.debugScript = {
    forceUIUpdate,
    showSignedInState: () => showSignedInState(auth?.currentUser),
    showSignedOutState,
    domElements: () => domElements,
    auth: () => auth,
    currentUser: () => auth?.currentUser,
    profileCache: () => profileCache
  };
  debugLog("Debug functions added to window.debugScript");
}

debugLog("script.js loaded — enhanced debugging version active");
