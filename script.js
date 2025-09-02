// script.js — Complete fixed version with friend request accept fix and cross-tab communication
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

import { uploadProfileImage } from "./cloudinary.js";

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
const profileCache = {};

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

/* ===== Cross-Tab Communication and Friend Removal ===== */
function setupCrossTabCommunication() {
  debugLog("Setting up cross-tab communication for friend updates");
  
  window.addEventListener('storage', function(e) {
    if (e.key === 'friendsUpdate' && e.newValue) {
      try {
        const updateEvent = JSON.parse(e.newValue);
        debugLog("Received friend update event:", updateEvent);
        
        if (updateEvent.type === 'FRIEND_REMOVED' && 
            updateEvent.userId === currentUser?.uid) {
          debugLog("Processing friend removal for current user");
          removeFriendFromUI(updateEvent.friendUid);
        }
      } catch (error) {
        debugError("Error processing friend update event:", error);
      }
    }
  });
  
  window.addEventListener('message', function(event) {
    if (event.origin !== window.location.origin) return;
    
    if (event.data.type === 'FRIEND_REMOVED' && 
        event.data.userId === currentUser?.uid) {
      debugLog("Received friend removal message from profile window");
      removeFriendFromUI(event.data.friendUid);
    }
  });
}

function removeFriendFromUI(removedFriendUid) {
  debugLog(`Removing friend ${removedFriendUid} from UI`);
  
  if (!domElements.friendsList) return;
  
  const friendElements = domElements.friendsList.querySelectorAll('[data-friend-uid]');
  friendElements.forEach(element => {
    if (element.getAttribute('data-friend-uid') === removedFriendUid) {
      element.remove();
      debugLog(`Removed friend ${removedFriendUid} from friends list UI`);
    }
  });
  
  if (domElements.friendsList.children.length === 0) {
    domElements.friendsList.innerHTML = "<div class='small'>No friends yet</div>";
  }
  
  if (profileCache[removedFriendUid]) {
    delete profileCache[removedFriendUid];
    debugLog(`Removed ${removedFriendUid} from profile cache`);
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

      setTimeout(() => {
        if (!auth.currentUser && authReady) {
          debugLog("Redirecting to auth.html - no user found");
          window.location.replace("auth.html");
        }
      }, 8000);
      return;
    }

    try {
      debugLog("User is signed in, initializing...");
      await ensureMyUserDoc(user);

      const me = profileCache[user.uid] || await fetchProfile(user.uid);

      if (domElements.meAvatarSmall) domElements.meAvatarSmall.src = me.photoURL || defaultAvatar();
      if (domElements.meName) domElements.meName.textContent = me.username || (user.displayName || (user.email ? user.email.split("@")[0] : "User"));

      showSignedInState(user);

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
  setupCrossTabCommunication();
  setupAuthStateListener();

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
  if (!user || !domElements.chatBox) return;
  if (unsubscriptions.chat) return;

  debugLog("Starting chat listener");
  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  domElements.chatBox.innerHTML = "";

  unsubscriptions.chat = onSnapshot(q, async (snapshot) => {
    try {
      const changes = snapshot.docChanges();
      if (changes.length === 0) return;

      const newMessages = changes
        .filter(change => change.type === 'added')
        .map(change => change.doc.data());

      const missingProfiles = new Set();
      newMessages.forEach(m => {
        if (m.senderId && !profileCache[m.senderId]) {
          missingProfiles.add(m.senderId);
        }
      });
      if (missingProfiles.size > 0) {
        await Promise.all(Array.from(missingProfiles).map(uid => fetchProfile(uid)));
      }

      const shouldScroll = domElements.chatBox.scrollTop + domElements.chatBox.clientHeight >= domElements.chatBox.scrollHeight - 50;

      for (const change of changes) {
        if (change.type === "added") {
          const messageData = { id: change.doc.id, ...change.doc.data() };
          const messageElement = createMessageElement(messageData);
          if (messageElement) {
            domElements.chatBox.appendChild(messageElement);
          }
        }
      }

      if (shouldScroll) {
        domElements.chatBox.scrollTop = domElements.chatBox.scrollHeight;
      }

    } catch (err) {
      debugError("Chat render error:", err);
    }
  }, err => {
    debugError("Chat onSnapshot error:", err);
    if (err?.code === "permission-denied" && domElements.chatBox) {
      domElements.chatBox.innerHTML = "<div style='color:crimson'>Permission denied reading messages. Check Firestore rules.</div>";
    }
  });

  domElements.chatBox.addEventListener("click", (ev) => {
    const target = ev.target.closest("[data-uid]");
    if (target) {
      const uid = target.getAttribute("data-uid");
      if (uid) openProfile(uid);
    }
  });

  if (domElements.sendBtn) {
    const sendMessage = async () => {
      const text = domElements.msgInput?.value.trim();
      if (!text || !auth.currentUser) return;

      try {
        const me = profileCache[auth.currentUser.uid] || await fetchProfile(auth.currentUser.uid);
        await addDoc(collection(db, "servers", "defaultServer", "messages"), {
          text,
          senderId: auth.currentUser.uid,
          senderName: me.username || auth.currentUser.email?.split("@")[0] || "User",
          senderPhotoURL: me.photoURL || "",
          timestamp: serverTimestamp()
        });
        if (domElements.msgInput) domElements.msgInput.value = "";
      } catch (err) {
        debugError("Send message failed:", err);
        alert("Failed to send message. See console.");
      }
    };

    domElements.sendBtn.onclick = sendMessage;
    domElements.msgInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
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

        // Enhanced accept handler with better error handling
        accept.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          
          accept.disabled = true;
          accept.textContent = "Accepting...";
          
          try {
            debugLog(`Attempting to accept friend request from ${fromUid}`);
            
            const requestRef = doc(db, "friendRequests", d.id);
            await updateDoc(requestRef, {
              status: "accepted",
              respondedAt: serverTimestamp(),
              acceptedBy: user.uid
            });
            debugLog("Friend request marked as accepted");
            
            const meRef = doc(db, "users", user.uid);
            
            const currentUserSnap = await getDoc(meRef);
            if (!currentUserSnap.exists()) {
              throw new Error("Current user document not found");
            }
            
            const currentUserData = currentUserSnap.data();
            const currentFriends = Array.isArray(currentUserData.friends) ? currentUserData.friends : [];
            
            if (!currentFriends.includes(fromUid)) {
              await updateDoc(meRef, { 
                friends: arrayUnion(fromUid),
                updatedAt: serverTimestamp()
              });
              debugLog(`Added ${fromUid} to current user's friends list`);
            } else {
              debugLog(`${fromUid} already in friends list, skipping add`);
            }
            
            debugLog("Friend request accepted successfully");
            
          } catch (err) {
            debugError("Accept friend request failed:", err);
            
            let errorMessage = "Accept failed: ";
            if (err.code === 'permission-denied') {
              errorMessage += "Permission denied. Check Firestore rules.";
            } else if (err.code === 'not-found') {
              errorMessage += "Friend request or user not found.";
            } else if (err.code === 'network-request-failed') {
              errorMessage += "Network error. Check your connection.";
            } else {
              errorMessage += err.message || "Unknown error occurred.";
            }
            
            alert(errorMessage);
            
            accept.disabled = false;
            accept.textContent = "Accept";
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
        btnWrap.style.marginLeft = "auto";
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

    if (domElements.meAvatarSmall) domElements.meAvatarSmall.src = data.photoURL || defaultAvatar();
    if (domElements.meName) domElements.meName.textContent = data.username || (auth.currentUser?.email ? auth.currentUser.email.split("@")[0] : "User");

    showSignedInState(user);

    const friends = Array.isArray(data.friends) ? data.friends : [];

    if (friends.length > 0) {
      const verifiedFriends = [];
      const friendsToRemove = [];

      const acceptedRequestsQuery = query(
        collection(db, "friendRequests"),
        where("toUid", "==", user.uid),
        where("status", "==", "accepted")
      );
      const acceptedRequestsSnap = await getDocs(acceptedRequestsQuery);
      const recentlyAcceptedSenderIds = new Set(
        acceptedRequestsSnap.docs.map(d => d.data().fromUid)
      );

      const friendDocsSnaps = await Promise.all(friends.map(uid => getDoc(doc(db, "users", uid))));

      friendDocsSnaps.forEach((friendSnap, index) => {
        const friendUid = friends[index];
        const isReciprocal = friendSnap.exists() && friendSnap.data().friends?.includes(user.uid);

        if (isReciprocal) {
          verifiedFriends.push(friendUid);
        } else {
          if (recentlyAcceptedSenderIds.has(friendUid)) {
            verifiedFriends.push(friendUid);
          } else {
            friendsToRemove.push(friendUid);
          }
        }
      });

      if (friendsToRemove.length > 0) {
        debugLog(`Removing ${friendsToRemove.length} non-reciprocal friends.`, friendsToRemove);
        await updateDoc(userRef, { friends: verifiedFriends });
        return;
      }
    }

    try {
      if (domElements.friendsList) {
        domElements.friendsList.innerHTML = "";
        if (!friends.length) {
          domElements.friendsList.innerHTML = "<div class='small'>No friends yet</div>";
        } else {
          await Promise.all(friends.map(uid => fetchProfile(uid)));
          for (const uid of friends) {
            const p = profileCache[uid] || { username: uid, photoURL: "" };
            
            if (domElements.friendItemTemplate) {
              const clone = domElements.friendItemTemplate.content.cloneNode(true);
              const friendItemWrapper = document.createElement("li");
              friendItemWrapper.className = "friend-item";
              friendItemWrapper.setAttribute("data-friend-uid", uid);

              const img = clone.querySelector(".friend-avatar");
              const nameEl = clone.querySelector(".friend-name");

              if (img) {
                img.src = p.photoURL || defaultAvatar();
                img.className = "friend-avatar avatar-small";
                img.style.cssText = "width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;";
                img.onerror = function() { this.src = defaultAvatar(); };
              }
              
              if (nameEl) {
                nameEl.textContent = p.username || uid;
                nameEl.style.cssText = "flex: 1; font-weight: 500;";
              }

              friendItemWrapper.appendChild(clone);
              friendItemWrapper.addEventListener("click", () => openProfile(uid));
              domElements.friendsList.appendChild(friendItemWrapper);

            } else {
              const li = document.createElement("li");
              li.className = "friend-item";
              li.setAttribute("data-friend-uid", uid);
              li.style.cssText = "display: flex; align-items: center; padding: 8px; cursor: pointer; border: 1px solid #ddd; margin: 4px; border-radius: 4px;";
              
              const img = document.createElement("img");
              img.src = p.photoURL || defaultAvatar();
              img.className = "avatar-small";
              img.style.cssText = "width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;";
              img.onerror = function() { this.src = defaultAvatar(); };
              
              const span = document.createElement("span");
              span.textContent = p.username || uid;
              span.style.cssText = "flex: 1; font-weight: 500;";
              
              li.appendChild(img);
              li.appendChild(span);
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
  }, err => {
    debugError("User doc snapshot error:", err);
    if (domElements.friendsList) {
      domElements.friendsList.innerHTML = "<div class='small' style='color:crimson'>Permission denied reading user data</div>";
    }
  });
}

/* ===== Helper functions ===== */
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

if (document.readyState !== 'loading') {
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

setTimeout(() => {
  if (authReady && auth?.currentUser && domElements.chatContainer && domElements.chatContainer.style.display === "none") {
    debugError("User signed in but UI not showing, forcing update");
    forceUIUpdate();
  }
}, 5000);

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
