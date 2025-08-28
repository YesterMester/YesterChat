// script.js — Part 1 of 3
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

/* ===== DOM elements ===== */
const topbar = document.getElementById("topbar");
const appShell = document.querySelector(".app-shell");
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
const profileCache = {}; // Cache to avoid re-fetching user profiles

// Helper to get a default avatar image
const defaultAvatar = () => "https://www.gravatar.com/avatar/?d=mp&s=160";

// Helper to navigate to a user's profile page
const openProfile = (uid) => {
if (uid) window.location.href = `profile.html?uid=${uid}`;
};

/**
* Fetches a user's profile from Firestore or from the local cache.
* @param {string} uid The user ID to fetch.
* @returns {Promise<object>} The user's profile data.
*/
async function fetchProfile(uid) {
if (!uid) return {};
if (profileCache[uid]) return profileCache[uid];
try {
const userDocSnap = await getDoc(doc(db, "users", uid));
if (userDocSnap.exists()) {
profileCache[uid] = userDocSnap.data();
return profileCache[uid];
}
} catch (err) {
console.error("Error fetching profile:", err);
}
return {}; // Return empty object if user not found
}

/**
* Ensures a user document exists in Firestore. If not, it creates one.
* This is the primary function for creating user profiles after sign-up.
* @param {object} user The Firebase auth user object.
*/
async function ensureUserDocExists(user) {
if (!user) return;
const userRef = doc(db, "users", user.uid);
try {
const userDocSnap = await getDoc(userRef);
if (!userDocSnap.exists()) {
console.log(`User document for ${user.uid} not found, creating it now.`);
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
} catch (err) {
console.error("Error ensuring user doc exists:", err);
}
}

/**
* Stops all active Firestore listeners to prevent memory leaks on logout.
*/
function cleanupRealtime() {
Object.values(unsubscriptions).forEach(unsub => unsub?.());
unsubscriptions = {};
if (chatBox) chatBox.innerHTML = "";
if (friendsList) friendsList.innerHTML = "";
if (friendRequestsContainer) friendRequestsContainer.innerHTML = "<div class='small'>No incoming requests</div>";
}
// script.js — Part 2 of 3

/* ===== Auth State Handling ===== */
// This is the main function that runs when the page loads.
// It checks if a user is logged in and updates the UI accordingly.
onAuthStateChanged(auth, async (user) => {
  // Hide the main app content to prevent a "flash" of the wrong UI
  if (appShell) appShell.style.visibility = 'hidden';

  try {
    if (user) {
      // --- User is SIGNED IN ---
      await ensureUserDocExists(user); // Ensure the user has a database entry
      const me = await fetchProfile(user.uid);

      // Update topbar UI with user's info
      if (meAvatarSmall) meAvatarSmall.src = me.photoURL || defaultAvatar();
      if (meName) meName.textContent = me.username || "User";

      // Show signed-in UI elements
      if (mePreview) mePreview.style.display = "inline-flex";
      if (myProfileBtn) myProfileBtn.style.display = "inline-block";
      if (logoutBtn) logoutBtn.style.display = "inline-block";
      if (authBtn) authBtn.style.display = "none";
      if (signedOutNotice) signedOutNotice.style.display = "none";
      if (friendsContainer) friendsContainer.style.display = "block";
      if (chatContainer) chatContainer.style.display = "block";

      // Start all the realtime data listeners for the app
      startUserDocListener(user);
      startChatListener();
      startIncomingRequestsListener(user);
      startOutgoingRequestsListener(user);
    } else {
      // --- User is SIGNED OUT ---
      cleanupRealtime(); // Stop any active listeners

      // Show signed-out UI elements
      if (mePreview) mePreview.style.display = "none";
      if (myProfileBtn) myProfileBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "none";
      if (authBtn) authBtn.style.display = "inline-block";
      if (signedOutNotice) signedOutNotice.style.display = "block";
      if (friendsContainer) friendsContainer.style.display = "none";
      if (chatContainer) chatContainer.style.display = "none";

      // Safety Check: Only redirect to the login page if we are NOT already on it.
      if (!window.location.pathname.endsWith("auth.html")) {
        window.location.replace("auth.html");
      }
    }
  } catch (error) {
    console.error("Critical error during authentication check:", error);
    // You could display an error message to the user here
    if (signedOutNotice) {
      signedOutNotice.textContent = "Error loading user data. Please refresh.";
      signedOutNotice.style.display = "block";
    }
  } finally {
    // Show the main app content now that the check is complete
    if (appShell) appShell.style.visibility = 'visible';
  }
});

/* ===== Auth Buttons ===== */
authBtn?.addEventListener("click", () => window.location.href = "auth.html");

myProfileBtn?.addEventListener("click", () => {
  if (auth.currentUser) {
    openProfile(auth.currentUser.uid);
  }
});

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("Logout failed:", err);
  }
});
// script.js — Part 3 of 3

/* ===== Chat ===== */
function startChatListener() {
  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));

  unsubscriptions.chat = onSnapshot(q, async (snapshot) => {
    if (!chatBox) return;
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

/* ===== Friends & Requests ===== */
function startIncomingRequestsListener(user) {
  const q = query(collection(db, "friendRequests"), where("toUid", "==", user.uid), where("status", "==", "pending"));
  
  unsubscriptions.incomingRequests = onSnapshot(q, async (snapshot) => {
    if (!friendRequestsContainer) return;
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
      acceptBtn.style.marginRight = "4px";
      acceptBtn.onclick = async () => {
        try {
          acceptBtn.disabled = true;
          // Add each other to friends lists and update request status
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

function startOutgoingRequestsListener(user) {
  if (!user) return;
  const q = query(collection(db, "friendRequests"), where("fromUid", "==", user.uid), where("status", "==", "accepted"));
  unsubscriptions.outgoingRequests = onSnapshot(q, snapshot => {
    // This function was in your original code.
    // The logic for adding a friend is now fully handled by the acceptor
    // in startIncomingRequestsListener, making this function's original purpose redundant.
    // It is kept here for completeness.
  });
}

function startUserDocListener(user) {
  unsubscriptions.userDoc = onSnapshot(doc(db, "users", user.uid), async (snap) => {
    if (!snap.exists() || !friendsList) return;
    const userData = snap.data();
    
    // Update topbar with latest data from the listener
    profileCache[user.uid] = userData;
    if (meAvatarSmall) meAvatarSmall.src = userData.photoURL || defaultAvatar();
    if (meName) meName.textContent = userData.username || "User";
    
    // Render friends list
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

/* ===== Safety fallback ===== */
// A final check in case the main onAuthStateChanged listener fails for an unknown reason.
setTimeout(() => {
    if (appShell && appShell.style.visibility === 'hidden') {
        console.warn("Auth check timed out. Displaying page as signed-out.");
        if (appShell) appShell.style.visibility = 'visible';
        if (!window.location.pathname.endsWith("auth.html")) {
            window.location.replace("auth.html");
        }
    }
}, 5000); // 5 seconds
