/*
 * =========================================================================================
 * YESTER CHAT: PROFILE.JS (Using Firebase v12.1.0)
 * =========================================================================================
 * This script manages user profiles, editing, friend requests, and friend lists.
 * It has been updated to use the latest Firebase SDK version for full compatibility.
 * =========================================================================================
 */

/* ---------- Part 1: Imports & DOM Elements ---------- */

import { auth, db } from "./firebase.js";
import { uploadProfileImage } from "./cloudinary.js";
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  serverTimestamp,
  setDoc,
  getDocs,
  onSnapshot,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  updateProfile as updateAuthProfile,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// --- DOM Elements ---
const profileAvatar = document.getElementById("profileAvatar");
const profileUsername = document.getElementById("profileUsername");
const profileEmail = document.getElementById("profileEmail");
const profileBio = document.getElementById("profileBio");
const profileActions = document.getElementById("profile-actions");
const editArea = document.getElementById("editArea");
const editAvatarPreview = document.getElementById("editAvatarPreview");
const editUsername = document.getElementById("editUsername");
const editBio = document.getElementById("editBio");
const photoInput = document.getElementById("photoInput");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const editMsg = document.getElementById("editMsg");
const friendsListContainer = document.getElementById("friendsListContainer");
const friendsList = document.getElementById("friendsList");

/* ---------- Part 2: State & Helpers ---------- */

let currentUser = null;
let viewedProfileData = null;
let friendsListenerUnsubscribe = null;

const defaultAvatar = () => "https://www.gravatar.com/avatar/?d=mp&s=160";
const getUidFromUrl = () => new URLSearchParams(window.location.search).get("uid");

function setButtonLoading(btn, isLoading, text = "Save") {
  if (!btn) return;
  btn.disabled = isLoading;
  const actionText = text.endsWith('e') ? text.slice(0, -1) : text;
  btn.textContent = isLoading ? `${actionText}ing...` : text;
}

/* ---------- Part 3: Core Logic & Profile Rendering ---------- */

export function initAuthListener() {
  if (!auth || !db) {
    console.error(
      "Firebase FATAL ERROR: The 'auth' or 'db' object is not being imported correctly from firebase.js. Please check your firebase.js file to ensure you are exporting 'auth' and 'db' properly."
    );
    profileUsername.textContent = "Configuration Error";
    profileBio.textContent = "Could not connect to the database. Check the console.";
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        currentUser = user;
        const viewedUid = getUidFromUrl() || currentUser.uid;
        await ensureUserDocExists(user);
        await loadProfilePage(viewedUid);
      } catch (error) {
        console.error("Failed to initialize profile page:", error);
        profileUsername.textContent = "Error Loading Profile";
        profileBio.textContent = "Could not load user data. Please check the console and try again.";
      }
    } else {
      window.location.replace("auth.html");
    }
  });
}

async function ensureUserDocExists(user) {
  const userRef = doc(db, "users", user.uid);
  const docSnap = await getDoc(userRef);
  if (!docSnap.exists()) {
    const usernameDefault = user.email ? user.email.split("@")[0].replace(/[^a-zA-Z0-9]/g, '') : "new_user";
    await setDoc(userRef, {
      username: usernameDefault,
      usernameLower: usernameDefault.toLowerCase(),
      bio: "Just joined Yester Chat!",
      photoURL: user.photoURL || "",
      friends: [],
      createdAt: serverTimestamp(),
    });
  }
}

async function loadProfilePage(uid) {
  const userRef = doc(db, "users", uid);
  const docSnap = await getDoc(userRef);

  if (!docSnap.exists()) {
    profileUsername.textContent = "User Not Found";
    [profileBio, profileEmail].forEach((el) => (el.textContent = ""));
    profileAvatar.src = defaultAvatar();
    profileActions.innerHTML = "";
    editArea.style.display = "none";
    friendsListContainer.style.display = "none";
    return;
  }

  viewedProfileData = { uid, ...docSnap.data() };

  profileAvatar.src = viewedProfileData.photoURL || defaultAvatar();
  profileUsername.textContent = viewedProfileData.username;
  profileBio.textContent = viewedProfileData.bio;

  if (uid === currentUser.uid) {
    renderOwnerView();
  } else {
    renderVisitorView();
  }
}

function renderOwnerView() {
  profileEmail.textContent = currentUser.email;
  friendsListContainer.style.display = "block";
  editArea.style.display = "block";
  profileActions.innerHTML = `<div class="small">This is your public profile. Use the form to make changes.</div>`;

  editUsername.value = viewedProfileData.username;
  editBio.value = viewedProfileData.bio;
  editAvatarPreview.src = viewedProfileData.photoURL || defaultAvatar();

  startFriendsListener();
}

async function renderVisitorView() {
  profileEmail.textContent = "";
  editArea.style.display = "none";
  friendsListContainer.style.display = "none";
  profileActions.innerHTML = `<p class="small">Loading actions...</p>`;

  try {
    const myProfileSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (!myProfileSnap.exists()) throw new Error("Could not find your own user profile.");

    const myFriends = myProfileSnap.data()?.friends || [];
    const isFriend = myFriends.includes(viewedProfileData.uid);
    profileActions.innerHTML = "";

    if (isFriend) {
      const unfriendBtn = document.createElement("button");
      unfriendBtn.textContent = "Unfriend";
      unfriendBtn.onclick = () => removeFriend(viewedProfileData.uid, unfriendBtn);
      profileActions.appendChild(unfriendBtn);
    } else {
      const requestsRef = collection(db, "friendRequests");
      const q = query(
        requestsRef,
        where("fromUid", "in", [currentUser.uid, viewedProfileData.uid]),
        where("toUid", "in", [currentUser.uid, viewedProfileData.uid]),
        where("status", "==", "pending")
      );
      const requestSnap = await getDocs(q);

      if (!requestSnap.empty) {
        const request = requestSnap.docs[0].data();
        const statusText = document.createElement("p");
        statusText.className = "small";
        statusText.textContent = request.fromUid === currentUser.uid
            ? "Friend request sent."
            : "This user sent you a friend request.";
        profileActions.appendChild(statusText);
      } else {
        const addFriendBtn = document.createElement("button");
        addFriendBtn.textContent = "Add Friend";
        addFriendBtn.onclick = () => sendFriendRequest(viewedProfileData.uid, addFriendBtn);
        profileActions.appendChild(addFriendBtn);
      }
    }
  } catch (error) {
    console.error("Failed to render visitor actions:", error);
    profileActions.innerHTML = `<p class="small">Could not load actions.</p>`;
  }
}

/* ---------- Part 4: Profile Editing & Saving ---------- */

async function handleProfileSave() {
  const newUsername = editUsername.value.trim();
  const newBio = editBio.value.trim();
  const file = photoInput.files[0];

  if (newUsername.length < 2 || newUsername.length > 30) {
    editMsg.textContent = "Username must be between 2 and 30 characters.";
    return;
  }
  
  setButtonLoading(saveProfileBtn, true, "Save Profile");
  editMsg.textContent = "Checking username...";
  
  try {
    const unameQuery = query(collection(db, "users"), where("usernameLower", "==", newUsername.toLowerCase()));
    const unameSnap = await getDocs(unameQuery);
    const isTaken = !unameSnap.empty && unameSnap.docs[0].id !== currentUser.uid;
    
    if (isTaken) {
      editMsg.textContent = "Username is already taken.";
      setButtonLoading(saveProfileBtn, false, "Save Profile");
      return;
    }
    
    let photoURL = viewedProfileData.photoURL;
    if (file) {
      editMsg.textContent = "Uploading photo...";
      if (file.size > 5 * 1024 * 1024) throw new Error("File size exceeds 5MB.");
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Invalid file type.");
      photoURL = await uploadProfileImage(file, currentUser.uid);
    }

    editMsg.textContent = "Saving profile...";
    const userRef = doc(db, "users", currentUser.uid);
    await updateDoc(userRef, {
      username: newUsername,
      usernameLower: newUsername.toLowerCase(),
      bio: newBio,
      photoURL: photoURL,
      updatedAt: serverTimestamp(),
    });
    
    await updateAuthProfile(currentUser, { displayName: newUsername, photoURL });
    
    editMsg.textContent = "Profile saved successfully!";
    photoInput.value = "";
    await loadProfilePage(currentUser.uid);
  } catch (error) {
    console.error("Profile save error:", error);
    editMsg.textContent = `Error: ${error.message}`;
  } finally {
    setButtonLoading(saveProfileBtn, false, "Save Profile");
  }
}

saveProfileBtn?.addEventListener("click", handleProfileSave);
photoInput?.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (file) editAvatarPreview.src = URL.createObjectURL(file);
});
cancelEditBtn?.addEventListener("click", () => {
  editUsername.value = viewedProfileData.username;
  editBio.value = viewedProfileData.bio;
  editAvatarPreview.src = viewedProfileData.photoURL || defaultAvatar();
  photoInput.value = "";
  editMsg.textContent = "";
});

/* ---------- Part 5: Friend Actions ---------- */

async function sendFriendRequest(targetUid, btn) {
  setButtonLoading(btn, true, "Add Friend");
  try {
    await addDoc(collection(db, "friendRequests"), {
      fromUid: currentUser.uid,
      toUid: targetUid,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    await renderVisitorView();
  } catch (error) {
    console.error("Friend request error:", error);
    alert("Failed to send friend request.");
    setButtonLoading(btn, false, "Add Friend");
  }
}

async function removeFriend(friendUid, btn) {
  if (!confirm(`Are you sure you want to unfriend ${viewedProfileData.username}?`)) return;

  setButtonLoading(btn, true, "Unfriend");
  try {
    const currentUserRef = doc(db, "users", currentUser.uid);
    const friendUserRef = doc(db, "users", friendUid);
    
    await updateDoc(currentUserRef, { friends: arrayRemove(friendUid) });
    await updateDoc(friendUserRef, { friends: arrayRemove(currentUser.uid) });
    
    await renderVisitorView();
  } catch (error) {
    console.error("Unfriend error:", error);
    alert("Failed to remove friend.");
    setButtonLoading(btn, false, "Unfriend");
  }
}

/* ---------- Part 6: Live Friends List ---------- */

function startFriendsListener() {
  if (friendsListenerUnsubscribe) friendsListenerUnsubscribe();

  const userRef = doc(db, "users", currentUser.uid);
  friendsListenerUnsubscribe = onSnapshot(userRef, (docSnap) => {
    if (docSnap.exists()) {
      renderFriendsList(docSnap.data().friends || []);
    }
  }, (error) => {
    console.error("Friends listener error:", error);
    friendsList.innerHTML = `<li class="small">Error loading friends.</li>`;
  });
}

async function renderFriendsList(friendUids) {
  if (friendUids.length === 0) {
    friendsList.innerHTML = `<li class="small">You haven't added any friends yet.</li>`;
    return;
  }
  
  friendsList.innerHTML = `<li class="small">Loading friends...</li>`;

  try {
    const friendPromises = friendUids.map(uid => getDoc(doc(db, "users", uid)));
    const friendDocs = await Promise.all(friendPromises);
    
    friendsList.innerHTML = "";
    
    friendDocs.forEach(docSnap => {
      if (docSnap.exists()) {
        const friend = { uid: docSnap.id, ...docSnap.data() };
        const li = document.createElement("li");
        li.className = "friend-item";
        li.innerHTML = `
          <img src="${friend.photoURL || defaultAvatar()}" alt="${friend.username}" />
          <span>${friend.username || "Unknown"}</span>
        `;
        li.onclick = () => (window.location.href = `profile.html?uid=${friend.uid}`);
        friendsList.appendChild(li);
      }
    });
  } catch (error) {
    console.error("Failed to render friends list:", error);
    friendsList.innerHTML = `<li class="small">Could not load friends list.</li>`;
  }
}

// Automatically initialize the script
initAuthListener();
