// script.js — combined, fixed friend-request flow, outgoing listener to apply accepted requests safely
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
let authReady = false;
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
      return profileCache[uid];
    }
  } catch (err) {
    console.error("fetchProfile error", err);
  }
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
  } catch (err) {
    console.warn("ensureMyUserDoc error:", err);
  }
}

/* Cleanup realtime listeners */
function cleanupRealtime() {
  Object.keys(unsubscriptions).forEach(k => {
    try { unsubscriptions[k]?.(); } catch (e) {}
    unsubscriptions[k] = null;
  });
  // clear UI sections
  if (chatBox) chatBox.innerHTML = "";
  if (friendsList) friendsList.innerHTML = "";
  if (friendRequestsContainer) friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
}

/* Show signed out state */
function showSignedOutState() {
  console.log("Showing signed out state");
  if (mePreview) mePreview.style.display = "none";
  if (myProfileBtn) { 
    myProfileBtn.style.display = "none"; 
    myProfileBtn.onclick = null; 
  }
  if (logoutBtn) logoutBtn.style.display = "none";
  if (authBtn) authBtn.style.display = "inline-block";
  if (signedOutNotice) signedOutNotice.style.display = "block";
  if (chatContainer) chatContainer.style.display = "none";
  if (friendsContainer) friendsContainer.style.display = "none";
  
  cleanupRealtime();
}

/* Show signed in state */
function showSignedInState(user) {
  console.log("Showing signed in state for user:", user.uid);
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
}

/* ===== Auth State Handling ===== */
onAuthStateChanged(auth, async (user) => {
  authChecked = true;
  authReady = true;
  console.log("Auth state changed:", user ? user.uid : null);

  if (!user) {
    // Signed out: hide profile controls & show auth button
    showSignedOutState();

    // friendly redirect to auth page after 8s (as your original UX did)
    setTimeout(() => {
      if (!auth.currentUser && authReady) {
        console.log("Redirecting to auth.html - no user found");
        window.location.replace("auth.html");
      }
    }, 8000);

    return;
  }

  // Signed in
  try {
    console.log("User is signed in, initializing...");
    await ensureMyUserDoc(user);

    const me = profileCache[user.uid] || await fetchProfile(user.uid);
    
    // Update topbar immediately
    if (meAvatarSmall) meAvatarSmall.src = me.photoURL || defaultAvatar();
    if (meName) meName.textContent = me.username || (user.displayName || (user.email ? user.email.split("@")[0] : "User"));

    // Show signed in state
    showSignedInState(user);

    // start listeners
    startUserDocListener(user);
    startChatListener(user);
    startIncomingRequestsListener(user);
    startOutgoingRequestsListener(user);

    console.log("User initialization complete");
  } catch (err) {
    console.error("Post-auth initialization error:", err);
  }
});

/* ===== Auth Buttons ===== */
if (authBtn) {
  authBtn.addEventListener("click", () => {
    console.log("Auth button clicked");
    window.location.href = "auth.html";
  });
}

if (myProfileBtn) {
  myProfileBtn.addEventListener("click", () => {
    const uid = auth.currentUser?.uid;
    if (uid) openProfile(uid);
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      console.log("Logging out...");
      cleanupRealtime();
      await signOut(auth);
      window.location.replace("auth.html");
    } catch (err) {
      console.error("Logout failed:", err);
      alert("Logout failed. See console.");
    }
  });
}

/* ===== Chat Listener & Send ===== */
function startChatListener(user) {
  if (!user || !chatBox) return;
  if (unsubscriptions.chat) {
    console.log("Chat listener already active");
    return;
  }

  console.log("Starting chat listener");
  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  unsubscriptions.chat = onSnapshot(q, async (snapshot) => {
    try {
      console.log("Chat messages updated:", snapshot.docs.length);
      const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const missing = new Set();
      messages.forEach(m => { if (m.senderId && !profileCache[m.senderId]) missing.add(m.senderId); });
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

/* ===== Incoming friend requests (what the current user receives) =====
   Accept flow:
     - Update the friendRequests doc to status 'accepted' (allowed)
     - Add the sender UID to the current user's (acceptor) friends array (allowed)
     - DON'T update the other user's users/{uid} doc here (that caused permission errors)
   The sender's client listens to their outgoing requests and will add the acceptor to their own friends list when they see the request accepted.
*/
function startIncomingRequestsListener(user) {
  if (!user || !friendRequestsContainer) return;
  if (unsubscriptions.incomingRequests) {
    console.log("Incoming requests listener already active");
    return;
  }

  console.log("Starting incoming requests listener");
  const q = query(
    collection(db, "friendRequests"),
    where("toUid", "==", user.uid),
    where("status", "==", "pending")
  );

  unsubscriptions.incomingRequests = onSnapshot(q, async snapshot => {
    try {
      console.log("Incoming requests updated:", snapshot.docs.length);
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

        // Accept friend request (recipient action)
        accept.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          try {
            // 1) update the friendRequests doc to accepted
            await updateDoc(doc(db, "friendRequests", d.id), {
              status: "accepted",
              respondedAt: serverTimestamp(),
              acceptedBy: user.uid // optional helpful metadata
            });

            // 2) add the sender to current user's friends array (allowed)
            const meRef = doc(db, "users", user.uid);
            await updateDoc(meRef, { friends: arrayUnion(fromUid) });

            // UI will update from user doc snapshot listener
          } catch (err) {
            console.error("Accept failed", err);
            // This indicates a Firestore permission issue or network error.
            alert("Accept failed. Check console for details.");
          }
        });

        // Decline friend request (recipient action)
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
      if (friendRequestsContainer) {
        friendRequestsContainer.innerHTML = "<div class='small'>Failed to load requests</div>";
      }
    }
  }, err => {
    console.error("Requests onSnapshot error:", err);
    if (friendRequestsContainer) {
      friendRequestsContainer.innerHTML = "<div class='small' style='color:crimson'>Permission error loading requests</div>";
    }
  });
}

/* ===== Outgoing friend requests listener (for the sender) =====
   Purpose: When someone you sent a request to accepts it (status -> 'accepted'), your client sees it,
   then your client updates *your* users/{yourUid}.friends array (allowed) and marks the friendRequest as processed.
*/
function startOutgoingRequestsListener(user) {
  if (!user) return;
  if (unsubscriptions.outgoingRequests) {
    console.log("Outgoing requests listener already active");
    return;
  }

  console.log("Starting outgoing requests listener");
  const q = query(
    collection(db, "friendRequests"),
    where("fromUid", "==", user.uid),
    where("status", "==", "accepted")
  );

  unsubscriptions.outgoingRequests = onSnapshot(q, async snapshot => {
    try {
      if (snapshot.empty) return;
      console.log("Processing", snapshot.docs.length, "accepted outgoing requests");
      
      for (const d of snapshot.docs) {
        const data = d.data();
        const toUid = data.toUid;
        // Skip if we've already processed this acceptance
        if (data.processed === true) continue;

        try {
          // Add the accepter (toUid) to my friends array (I am the sender, allowed)
          const myRef = doc(db, "users", user.uid);
          await updateDoc(myRef, { friends: arrayUnion(toUid) });

          // Mark request as processed so we don't apply again
          await updateDoc(doc(db, "friendRequests", d.id), { processed: true, processedAt: serverTimestamp() });
          console.log("Processed accepted request from", toUid);
        } catch (err) {
          console.error("Outgoing request processing failed for", d.id, err);
        }
      }
    } catch (err) {
      console.error("Outgoing requests snapshot error:", err);
    }
  }, err => {
    console.error("Outgoing requests onSnapshot error:", err);
  });
}

/* ===== User doc listener for friends & topbar updates ===== */
function startUserDocListener(user) {
  if (!user) return;
  if (unsubscriptions.userDoc) {
    console.log("User doc listener already active");
    return;
  }

  console.log("Starting user doc listener");
  const userRef = doc(db, "users", user.uid);
  unsubscriptions.userDoc = onSnapshot(userRef, async snap => {
    if (!snap.exists()) {
      console.warn("User doc missing after login:", user.uid);
      return;
    }

    const data = snap.data();
    profileCache[user.uid] = data;

    // Update topbar
    if (meAvatarSmall) meAvatarSmall.src = data.photoURL || defaultAvatar();
    if (meName) meName.textContent = data.username || (auth.currentUser?.email ? auth.currentUser.email.split("@")[0] : "User");
    
    // Ensure UI is visible
    showSignedInState(user);

    // Render friends list
    try {
      const friends = Array.isArray(data.friends) ? data.friends : [];
      console.log("Rendering", friends.length, "friends");
      
      if (friendsList) {
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
              if (img) img.src = p.photoURL || defaultAvatar();
              if (nameEl) {
                nameEl.textContent = p.username || uid;
                nameEl.setAttribute("data-uid", uid);
              }
              if (img) img.setAttribute("data-uid", uid);

              const tempContainer = document.createElement("div");
              tempContainer.appendChild(clone);
              const appended = tempContainer.firstElementChild;
              if (appended) {
                appended.addEventListener("click", () => openProfile(uid));
                friendsList.appendChild(appended);
              }
            } else {
              const li = document.createElement("li");
              li.className = "friend-item";
              li.innerHTML = `<img src="${p.photoURL || defaultAvatar()}" class="avatar-small" /><span>${escapeHtml(p.username || uid)}</span>`;
              li.addEventListener("click", () => openProfile(uid));
              friendsList.appendChild(li);
            }
          }
        }
      }
    } catch (err) {
      console.error("Error rendering friends", err);
      if (friendsList) {
        friendsList.innerHTML = "<div class='small'>Failed to load friends</div>";
      }
    }
  }, err => {
    console.error("User doc snapshot error:", err);
    if (friendsList) {
      friendsList.innerHTML = "<div class='small' style='color:crimson'>Permission denied reading user data</div>";
    }
  });
}

/* ===== Utility helper: check for existing pending requests (avoid duplicates) ===== */
async function hasExistingPendingRequestBetween(aUid, bUid) {
  // check either direction for a pending request
  try {
    const q1 = query(collection(db, "friendRequests"), where("fromUid", "==", aUid), where("toUid", "==", bUid), where("status", "==", "pending"));
    const q2 = query(collection(db, "friendRequests"), where("fromUid", "==", bUid), where("toUid", "==", aUid), where("status", "==", "pending"));
    const [r1, r2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    return !r1.empty || !r2.empty;
  } catch (err) {
    console.error("hasExistingPendingRequestBetween error", err);
    return false;
  }
}

/* ===== Setup visitor actions used on profile page (keeps original behavior but avoids duplicates) =====
   NOTE: your profile.js also creates friend requests — keep it consistent with this behavior.
*/
async function setupVisitorActionsFromIndex(uid) {
  // This function is provided if you want to reuse visitor logic in index.html context.
  // For profile.js you already have a similar implementation; this is just to show consistent safe create.
  if (!auth.currentUser) return;
  const currentUid = auth.currentUser.uid;

  // non-blocking example of sending a request
  if (currentUid === uid) return;

  const alreadyFriendsSnap = await getDoc(doc(db, "users", currentUid));
  const myFriends = alreadyFriendsSnap.exists() ? (alreadyFriendsSnap.data().friends || []) : [];
  if (Array.isArray(myFriends) && myFriends.includes(uid)) {
    alert("Already friends.");
    return;
  }

  // guard duplicates
  const existsPending = await hasExistingPendingRequestBetween(currentUid, uid);
  if (existsPending) {
    alert("A pending friend request already exists between you and this user.");
    return;
  }

  // create request
  try {
    await addDoc(collection(db, "friendRequests"), {
      fromUid: currentUid,
      toUid: uid,
      status: "pending",
      createdAt: serverTimestamp()
    });
    alert("Friend request sent.");
  } catch (err) {
    console.error("Failed to send friend request", err);
    alert("Failed to send friend request. See console.");
  }
}

/* ===== Safety fallback redirect ===== */
setTimeout(() => {
  if (!authChecked) {
    console.warn("Auth check timed out; redirecting to auth.html");
    window.location.replace("auth.html");
  }
}, 15000); // Increased timeout to 15 seconds

// Also check if user exists but UI isn't showing after 3 seconds
setTimeout(() => {
  if (authReady && auth.currentUser && chatContainer && chatContainer.style.display === "none") {
    console.warn("User signed in but UI not showing, forcing update");
    showSignedInState(auth.currentUser);
  }
}, 3000);

console.log("script.js loaded — topbar controls, chat, friends and friend-request listeners active.");