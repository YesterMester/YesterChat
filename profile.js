// profile.js
import { auth, db } from "./firebase.js";
import { uploadToCloudinary } from "./cloudinary.js";
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// Elements
const profileAvatar = document.getElementById("profileAvatar");
const profileUsername = document.getElementById("profileUsername");
const profileEmail = document.getElementById("profileEmail");
const profileBio = document.getElementById("profileBio");

const profileActions = document.getElementById("profile-actions");

const editArea = document.getElementById("editArea");
const editBio = document.getElementById("editBio");
const photoInput = document.getElementById("photoInput");
const saveProfileBtn = document.getElementById("saveProfileBtn");

// Get profile UID from query string: ?uid=<uid>
const urlParams = new URLSearchParams(window.location.search);
const profileUid = urlParams.get("uid");

// Current logged-in user
let currentUser = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("auth.html");
    return;
  }
  currentUser = user;
  if (!profileUid) {
    alert("No profile specified.");
    return;
  }
  await loadProfile(profileUid);
});

async function loadProfile(uid) {
  const profileRef = doc(db, "users", uid);
  const profileSnap = await getDoc(profileRef);

  if (!profileSnap.exists()) {
    alert("Profile not found.");
    return;
  }

  const data = profileSnap.data();

  // Populate fields
  profileUsername.textContent = data.username || "Unknown";
  profileEmail.textContent = data.email || "";
  profileBio.textContent = data.bio || "";
  profileAvatar.src = data.photoURL || "default-avatar.png";

  // Show edit area if this is the current user's profile
  if (currentUser.uid === uid) {
    editArea.style.display = "block";
    editBio.value = data.bio || "";
  }

  // Setup actions
  setupProfileActions(uid, data);
}

// --- Profile actions (Add Friend / Accept / Unfriend) ---
async function setupProfileActions(uid, profileData) {
  profileActions.innerHTML = "";

  // Cannot friend yourself
  if (currentUser.uid === uid) return;

  const currentRef = doc(db, "users", currentUser.uid);

  // Determine friendship status
  const isFriend = (profileData.friends || []).includes(currentUser.uid);
  const incoming = (profileData.incomingRequests || []).includes(currentUser.uid);
  const outgoing = (profileData.outgoingRequests || []).includes(currentUser.uid);

  if (isFriend) {
    const unfriendBtn = document.createElement("button");
    unfriendBtn.textContent = "Unfriend";
    unfriendBtn.onclick = async () => {
      await updateDoc(currentRef, { friends: arrayRemove(uid) });
      await updateDoc(doc(db, "users", uid), { friends: arrayRemove(currentUser.uid) });
      alert("Unfriended!");
      setupProfileActions(uid, profileData);
    };
    profileActions.appendChild(unfriendBtn);
  } else if (incoming) {
    const acceptBtn = document.createElement("button");
    acceptBtn.textContent = "Accept Friend Request";
    acceptBtn.onclick = async () => {
      await updateDoc(currentRef, { friends: arrayUnion(uid), incomingRequests: arrayRemove(uid) });
      await updateDoc(doc(db, "users", uid), { friends: arrayUnion(currentUser.uid), outgoingRequests: arrayRemove(currentUser.uid) });
      alert("Friend request accepted!");
      setupProfileActions(uid, profileData);
    };
    profileActions.appendChild(acceptBtn);
  } else if (outgoing) {
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel Friend Request";
    cancelBtn.onclick = async () => {
      await updateDoc(currentRef, { outgoingRequests: arrayRemove(uid) });
      await updateDoc(doc(db, "users", uid), { incomingRequests: arrayRemove(currentUser.uid) });
      alert("Friend request canceled!");
      setupProfileActions(uid, profileData);
    };
    profileActions.appendChild(cancelBtn);
  } else {
    const addBtn = document.createElement("button");
    addBtn.textContent = "Add Friend";
    addBtn.onclick = async () => {
      await updateDoc(currentRef, { outgoingRequests: arrayUnion(uid) });
      await updateDoc(doc(db, "users", uid), { incomingRequests: arrayUnion(currentUser.uid) });
      alert("Friend request sent!");
      setupProfileActions(uid, profileData);
    };
    profileActions.appendChild(addBtn);
  }
}

// --- Save profile edits (bio + photo) ---
saveProfileBtn.onclick = async () => {
  const bio = editBio.value.trim();
  let photoURL = profileAvatar.src;

  if (photoInput.files.length > 0) {
    try {
      const file = photoInput.files[0];
      photoURL = await uploadToCloudinary(file);
    } catch (err) {
      console.error("Photo upload failed", err);
      alert("❌ Failed to upload photo.");
      return;
    }
  }

  try {
    await updateDoc(doc(db, "users", currentUser.uid), { bio, photoURL });
    profileBio.textContent = bio;
    profileAvatar.src = photoURL;
    alert("✅ Profile updated!");
  } catch (err) {
    console.error("Profile update failed", err);
    alert("❌ Failed to save profile.");
  }
};
