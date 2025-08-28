/*
 * =========================================================================================
 * YESTER CHAT: PROFILE.JS (REWRITTEN)
 * =========================================================================================
 * This script manages user profiles, editing, friend requests, and friend lists.
 *
 * Key Fixes & Improvements:
 * 1.  **Profile Editing:** The edit form now reliably shows for the logged-in user.
 * 2.  **Friend Requests:** Sending requests is now a robust async operation with UI feedback.
 * 3.  **Mutual Unfriending:** Removing a friend now correctly updates the relationship for both users.
 * 4.  **Live Friends List:** The friends list is now rendered directly by this script and updates in real-time.
 * 5.  **Code Structure:** Logic is better organized, with clear functions for each action and robust error handling.
 * 6.  **User Experience:** Buttons are disabled and text is updated during actions (e.g., "Saving...", "Sending...") to give the user clear feedback.
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
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"; // Note: Using a specific stable version
import {
  onAuthStateChanged,
  updateProfile as updateAuthProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- DOM Elements ---
const profileAvatar = document.getElementById("profileAvatar");
const profileUsername = document.getElementById("profileUsername");
const profileEmail = document.getElementById("profileEmail");
const profileBio = document.getElementById("profileBio");
const profileActions = document.getElementById("profile-actions");

// Profile Editing
const editArea = document.getElementById("editArea");
const editAvatarPreview = document.getElementById("editAvatarPreview");
const editUsername = document.getElementById("editUsername");
const editBio = document.getElementById("editBio");
const photoInput = document.getElementById("photoInput");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const editMsg = document.getElementById("editMsg");

// Friends List
const friendsListContainer = document.getElementById("friendsListContainer");
const friendsList = document.getElementById("friendsList");

/* ---------- Part 2: State & Helpers ---------- */

let currentUser = null; // The authenticated user object
let viewedProfileData = null; // The profile data of the user being viewed
let friendsListenerUnsubscribe = null; // To stop the friends listener

// --- Helper Functions ---
const defaultAvatar = () => "https://www.gravatar.com/avatar/?d=mp&s=160";
const getUidFromUrl = () => new URLSearchParams(window.location.search).get("uid");

/**
 * Toggles the disabled state and text of a button.
 * @param {HTMLButtonElement} btn The button element.
 * @param {boolean} isLoading Whether the button should be in a loading state.
 * @param {string} text The text to display when not loading.
 */
function setButtonLoading(btn, isLoading, text = "Save") {
  if (btn) {
    btn.disabled = isLoading;
    btn.textContent = isLoading ? `${text.replace(/e$/, "")}ing...` : text;
  }
}

/* ---------- Part 3: Core Logic & Profile Rendering ---------- */

/**
 * Initializes the authentication listener. This is the entry point of the script.
 */
export function initAuthListener() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      const viewedUid = getUidFromUrl() || currentUser.uid;
      await ensureUserDocExists(user);
      await loadProfilePage(viewedUid);
    } else {
      window.location.replace("auth.html");
    }
  });
}

/**
 * Creates a user document in Firestore if it doesn't already exist.
 * @param {object} user The Firebase auth user object.
 */
async function ensureUserDocExists(user) {
  const userRef = doc(db, "users", user.uid);
  const docSnap = await getDoc(userRef);
  if (!docSnap.exists()) {
    const usernameDefault = user.email ? user.email.split("@")[0] : "new_user";
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

/**
 * Fetches data and renders the entire profile page for a given UID.
 * @param {string} uid The UID of the profile to load.
 */
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

  // Render basic profile info
  profileAvatar.src = viewedProfileData.photoURL || defaultAvatar();
  profileUsername.textContent = viewedProfileData.username;
  profileBio.textContent = viewedProfileData.bio;

  // Determine if viewing own profile or another user's
  if (uid === currentUser.uid) {
    renderOwnerView();
  } else {
    renderVisitorView();
  }
}

/**
 * Renders the view for the profile owner (shows edit form, friends list).
 */
function renderOwnerView() {
  profileEmail.textContent = currentUser.email;
  friendsListContainer.style.display = "block";
  editArea.style.display = "block";
  profileActions.innerHTML = `<div class="small">This is your public profile. Use the form to make changes.</div>`;

  // Populate edit form with current data
  editUsername.value = viewedProfileData.username;
  editBio.value = viewedProfileData.bio;
  editAvatarPreview.src = viewedProfileData.photoURL || defaultAvatar();

  // Start listening for real-time friend updates
  startFriendsListener();
}

/**
 * Renders the view for a visitor (shows friend actions, hides sensitive info).
 */
async function renderVisitorView() {
  profileEmail.textContent = ""; // Hide email from visitors
  editArea.style.display = "none";
  friendsListContainer.style.display = "none"; // Hide other users' friend lists

  // Setup action buttons (Add/Unfriend, etc.)
  profileActions.innerHTML = ""; // Clear previous buttons
  const loadingIndicator = document.createElement("p");
  loadingIndicator.textContent = "Loading actions...";
  profileActions.appendChild(loadingIndicator);

  // Check friendship status
  const myProfileSnap = await getDoc(doc(db, "users", currentUser.uid));
  const myFriends = myProfileSnap.data()?.friends || [];
  const isFriend = myFriends.includes(viewedProfileData.uid);

  loadingIndicator.remove(); // Remove loading text

  if (isFriend) {
    const unfriendBtn = document.createElement("button");
    unfriendBtn.textContent = "Unfriend";
    unfriendBtn.onclick = () => removeFriend(viewedProfileData.uid, unfriendBtn);
    profileActions.appendChild(unfriendBtn);
  } else {
    // Check for pending friend requests
    const q = query(
      collection(db, "friendRequests"),
      where("fromUid", "in", [currentUser.uid, viewedProfileData.uid]),
      where("toUid", "in", [currentUser.uid, viewedProfileData.uid]),
      where("status", "==", "pending")
    );
    const requestSnap = await getDocs(q);

    if (!requestSnap.empty) {
      const request = requestSnap.docs[0].data();
      const statusText = document.createElement("p");
      statusText.className = "small";
      statusText.textContent =
        request.fromUid === currentUser.uid
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
}

/* ---------- Part 4: Profile Editing & Saving ---------- */

async function handleProfileSave() {
  const newUsername = editUsername.value.trim();
  const newBio = editBio.value.trim();
  const file = photoInput.files[0];

  // --- Validation ---
  if (newUsername.length < 2 || newUsername.length > 30) {
    editMsg.textContent = "Username must be between 2 and 30 characters.";
    return;
  }
  
  setButtonLoading(saveProfileBtn, true, "Save");
  editMsg.textContent = "Checking username availability...";
  
  // --- Check if username is taken ---
  const unameQuery = query(collection(db, "users"), where("usernameLower", "==", newUsername.toLowerCase()));
  const unameSnap = await getDocs(unameQuery);
  const isTaken = !unameSnap.empty && unameSnap.docs[0].id !== currentUser.uid;
  
  if (isTaken) {
    editMsg.textContent = "Username is already taken.";
    setButtonLoading(saveProfileBtn, false, "Save Profile");
    return;
  }
  
  // --- Handle Photo Upload ---
  let photoURL = viewedProfileData.photoURL; // Keep old photo by default
  if (file) {
    editMsg.textContent = "Uploading photo...";
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("File size exceeds 5MB.");
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Invalid file type.");
      photoURL = await uploadProfileImage(file, currentUser.uid);
    } catch (error) {
      editMsg.textContent = `Photo upload failed: ${error.message}`;
      setButtonLoading(saveProfileBtn, false, "Save Profile");
      return;
    }
  }

  // --- Update Firestore & Auth Profile ---
  try {
    editMsg.textContent = "Saving profile...";
    const userRef = doc(db, "users", currentUser.uid);
    await updateDoc(userRef, {
      username: newUsername,
      usernameLower: newUsername.toLowerCase(),
      bio: newBio,
      photoURL: photoURL,
      updatedAt: serverTimestamp(),
    });
    
    await updateAuthProfile(currentUser, {
      displayName: newUsername,
      photoURL: photoURL,
    });
    
    editMsg.textContent = "Profile saved successfully!";
    photoInput.value = ""; // Clear file input
    await loadProfilePage(currentUser.uid); // Reload profile to show changes
  } catch (error) {
    console.error("Profile save error:", error);
    editMsg.textContent = "Failed to save profile. Please try again.";
  } finally {
    setButtonLoading(saveProfileBtn, false, "Save Profile");
  }
}

// --- Event Listeners for Edit Form ---
saveProfileBtn?.addEventListener("click", handleProfileSave);

photoInput?.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (file) {
    editAvatarPreview.src = URL.createObjectURL(file);
  }
});

cancelEditBtn?.addEventListener("click", () => {
  // Reset form to its original state
  editUsername.value = viewedProfileData.username;
  editBio.value = viewedProfileData.bio;
  editAvatarPreview.src = viewedProfileData.photoURL || defaultAvatar();
  photoInput.value = "";
  editMsg.textContent = "";
});


/* ---------- Part 5: Friend Actions ---------- */

/**
 * Sends a friend request to the target user.
 * @param {string} targetUid The UID of the user to send a request to.
 * @param {HTMLButtonElement} btn The button that triggered the action.
 */
async function sendFriendRequest(targetUid, btn) {
  setButtonLoading(btn, true, "Add Friend");
  try {
    await addDoc(collection(db, "friendRequests"), {
      fromUid: currentUser.uid,
      toUid: targetUid,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    // Reload the actions to show "Request Sent"
    await renderVisitorView();
  } catch (error) {
    console.error("Friend request error:", error);
    alert("Failed to send friend request.");
    setButtonLoading(btn, false, "Add Friend");
  }
}

/**
 * Removes a friend mutually.
 * @param {string} friendUid The UID of the friend to remove.
 * @param {HTMLButtonElement} btn The button that triggered the action.
 */
async function removeFriend(friendUid, btn) {
  if (!confirm(`Are you sure you want to unfriend ${viewedProfileData.username}?`)) {
    return;
  }
  setButtonLoading(btn, true, "Unfriend");
  try {
    const currentUserRef = doc(db, "users", currentUser.uid);
    const friendUserRef = doc(db, "users", friendUid);
    
    // Use arrayRemove for atomic operations
    await updateDoc(currentUserRef, { friends: arrayRemove(friendUid) });
    await updateDoc(friendUserRef, { friends: arrayRemove(currentUser.uid) });
    
    // Reload the actions to show the "Add Friend" button again
    await renderVisitorView();
  } catch (error) {
    console.error("Unfriend error:", error);
    alert("Failed to remove friend. Please try again.");
    setButtonLoading(btn, false, "Unfriend");
  }
}


/* ---------- Part 6: Live Friends List ---------- */

/**
 * Sets up a real-time listener for the current user's friends list.
 */
function startFriendsListener() {
  // Unsubscribe from any previous listener
  if (friendsListenerUnsubscribe) friendsListenerUnsubscribe();

  const userRef = doc(db, "users", currentUser.uid);
  friendsListenerUnsubscribe = onSnapshot(userRef, (docSnap) => {
    if (docSnap.exists()) {
      const friendUids = docSnap.data().friends || [];
      renderFriendsList(friendUids);
    }
  });
}

/**
 * Fetches profile data for friend UIDs and renders them to the DOM.
 * @param {string[]} friendUids Array of friend UIDs.
 */
async function renderFriendsList(friendUids) {
  friendsList.innerHTML = ""; // Clear the list first

  if (friendUids.length === 0) {
    friendsList.innerHTML = `<li class="small">You have no friends yet.</li>`;
    return;
  }

  // Create a list of promises to fetch all friend profiles
  const friendPromises = friendUids.map(uid => getDoc(doc(db, "users", uid)));
  
  const friendDocs = await Promise.all(friendPromises);
  
  friendDocs.forEach(docSnap => {
    if (docSnap.exists()) {
      const friend = { uid: docSnap.id, ...docSnap.data() };
      const li = document.createElement("li");
      li.className = "friend-item";
      li.innerHTML = `
        <img src="${friend.photoURL || defaultAvatar()}" alt="${friend.username}" />
        <span>${friend.username || "Unknown"}</span>
      `;
      // Navigate to friend's profile on click
      li.onclick = () => (window.location.href = `profile.html?uid=${friend.uid}`);
      friendsList.appendChild(li);
    }
  });
}

// Automatically initialize the script when loaded
initAuthListener();
