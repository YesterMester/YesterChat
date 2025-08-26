import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, doc, addDoc, updateDoc, query, orderBy, onSnapshot, serverTimestamp, getDoc } 
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { uploadProfileImage } from "./cloudinary.js"; // handles profile uploads

// --- DOM Elements ---
const chatBox = document.getElementById("chat");
const input = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const chatContainer = document.getElementById("chatContainer");
const logoutBtn = document.getElementById("logoutBtn");
const signInBtn = document.getElementById("signInBtn");
const friendsList = document.getElementById("friendsList");
const friendRequestsContainer = document.getElementById("friendRequests");
const profileForm = document.getElementById("profileForm");
const profileImageInput = document.getElementById("profileImage");

// --- 1️⃣ Auth check ---
let authChecked = false;

onAuthStateChanged(auth, user => {
  authChecked = true;

  if (!user) {
    chatContainer.style.display = "none";
    console.log("No user signed in → redirecting to auth.html in 5s");
    setTimeout(() => window.location.replace("auth.html"), 5000);
  } else {
    chatContainer.style.display = "block";
    initChat(user);
    listenForFriendRequests(user);
    loadFriendsList(user);
    loadProfileForm(user);
  }
});

// --- 2️⃣ Logout ---
if (logoutBtn) {
  logoutBtn.onclick = async () => {
    try {
      await signOut(auth);
      window.location.replace("auth.html");
    } catch (err) {
      console.error("Logout failed", err);
    }
  };
}

// --- 3️⃣ Sign-in fallback ---
if (signInBtn) {
  signInBtn.onclick = () => window.location.replace("auth.html");
}

// --- 4️⃣ Chat functions ---
function initChat(user) {
  const messagesRef = collection(db, "servers", "defaultServer", "messages");
  const q = query(messagesRef, orderBy("timestamp"));
  
  onSnapshot(q, snapshot => {
    chatBox.innerHTML = "";
    snapshot.forEach(doc => {
      const msg = doc.data();
      const displayName = msg.senderName || msg.senderId;
      chatBox.innerHTML += `<p><b>${displayName}</b>: ${msg.text}</p>`;
    });
    chatBox.scrollTop = chatBox.scrollHeight;
  }, err => console.error("Error fetching messages:", err));

  sendBtn.onclick = async () => {
    const text = input.value.trim();
    if (!text) return;

    try {
      // Get latest username
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const username = userDoc.exists() ? userDoc.data().username : user.email;

      await addDoc(messagesRef, {
        text,
        senderId: user.uid,
        senderName: username,
        timestamp: serverTimestamp()
      });
      input.value = "";
    } catch (err) {
      console.error("Error sending message:", err);
    }
  };
}

// --- 5️⃣ Friend requests ---
async function sendFriendRequest(toUid) {
  try {
    await addDoc(collection(db, "friendRequests"), {
      fromUid: auth.currentUser.uid,
      toUid,
      status: "pending",
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error("Error sending friend request", err);
  }
}

async function acceptFriend(requestId) {
  const requestRef = doc(db, "friendRequests", requestId);
  try {
    await updateDoc(requestRef, { status: "accepted" });
  } catch (err) {
    console.error("Error accepting friend request", err);
  }
}

async function declineFriend(requestId) {
  const requestRef = doc(db, "friendRequests", requestId);
  try {
    await updateDoc(requestRef, { status: "declined" });
  } catch (err) {
    console.error("Error declining friend request", err);
  }
}

function listenForFriendRequests(user) {
  const q = query(collection(db, "friendRequests"));
  onSnapshot(q, snapshot => {
    friendRequestsContainer.innerHTML = "";
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.toUid === user.uid && data.status === "pending") {
        const reqEl = document.createElement("div");
        reqEl.innerHTML = `
          <span>Friend request from: ${data.fromUid}</span>
          <button onclick="acceptFriend('${doc.id}')">Accept</button>
          <button onclick="declineFriend('${doc.id}')">Decline</button>
        `;
        friendRequestsContainer.appendChild(reqEl);
      }
    });
  });
}

// --- 6️⃣ Friends list ---
async function loadFriendsList(user) {
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists()) return;
  const friends = userDoc.data().friends || [];

  friendsList.innerHTML = "";
  for (const friendUid of friends) {
    const friendDoc = await getDoc(doc(db, "users", friendUid));
    const friendData = friendDoc.exists() ? friendDoc.data() : { username: friendUid };
    const friendEl = document.createElement("div");
    friendEl.textContent = friendData.username;
    friendsList.appendChild(friendEl);
  }
}

// --- 7️⃣ Profile updates ---
function loadProfileForm(user) {
  const userRef = doc(db, "users", user.uid);
  onSnapshot(userRef, snapshot => {
    const data = snapshot.data();
    if (!data) return;
    profileForm.username.value = data.username || "";
    profileForm.bio.value = data.bio || "";
    profileImageInput.value = "";
  });

  profileForm.onsubmit = async e => {
    e.preventDefault();
    const username = profileForm.username.value.trim();
    const bio = profileForm.bio.value.trim();
    let photoURL = null;

    if (profileImageInput.files.length > 0) {
      const file = profileImageInput.files[0];
      photoURL = await uploadProfileImage(file, user.uid); // returns Cloudinary URL
    }

    try {
      await updateDoc(doc(db, "users", user.uid), {
        username,
        usernameLower: username.toLowerCase(),
        bio,
        ...(photoURL && { photoURL }),
        updatedAt: serverTimestamp()
      });
      alert("Profile updated ✅");
    } catch (err) {
      console.error("Error updating profile:", err);
      alert("❌ Could not update profile");
    }
  };
}
