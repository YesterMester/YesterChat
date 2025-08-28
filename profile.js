// profile.js
import { auth, db } from "./firebase.js";
import { uploadProfileImage } from "./cloudinary.js";
import {
  doc, getDoc, updateDoc, addDoc, collection, query, where,
  serverTimestamp, setDoc, getDocs, onSnapshot, arrayRemove,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  updateProfile as updateAuthProfile,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ===== DOM Elements ===== */
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

/* ===== State & Helpers ===== */
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

/* ===== Core Logic & Profile Rendering ===== */
export function initAuthListener() {
  if (!auth || !db) {
    console.error("Firebase FATAL ERROR: The 'auth' or 'db' object is not being imported correctly.");
    if (profileUsername) profileUsername.textContent = "Configuration Error";
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      if (!profileUsername) return; // Don't run this script on pages without profile elements
      try {
        currentUser = user;
        const viewedUid = getUidFromUrl() || currentUser.uid;
        await loadProfilePage(viewedUid);
      } catch (error) {
        console.error("Failed to initialize profile page:", error);
        profileUsername.textContent = "Error Loading Profile";
      }
    } else {
      if (!window.location.pathname.endsWith("auth.html")) {
        window.location.replace("auth.html");
      }
    }
  });
}

async function loadProfilePage(uid) {
  const userRef = doc(db, "users", uid);
  const docSnap = await getDoc(userRef);

  if (!docSnap.exists()) {
    profileUsername.textContent = "User Not Found";
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
        profileActions.innerHTML = `<p class="small">${request.fromUid === currentUser.uid ? "Friend request sent." : "This user sent you a friend request."}</p>`;
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

/* ===== Profile Editing & Saving ===== */
async function handleProfileSave() {
  const newUsername = editUsername.value.trim();
  const newBio = editBio.value.trim();
  const file = photoInput.files[0];

  if (newUsername.length < 2 || newUsername.length > 30) {
    editMsg.textContent = "Username must be between 2 and 30 characters.";
    return;
  }
  
  setButtonLoading(saveProfileBtn, true, "Save Profile");
  
  try {
    const unameQuery = query(collection(db, "users"), where("usernameLower", "==", newUsername.toLowerCase()));
    const unameSnap = await getDocs(unameQuery);
    if (!unameSnap.empty && unameSnap.docs[0].id !== currentUser.uid) {
      throw new Error("Username is already taken.");
    }
    
    let photoURL = viewedProfileData.photoURL;
    if (file) {
      photoURL = await uploadProfileImage(file, currentUser.uid);
    }

    const userRef = doc(db, "users", currentUser.uid);
    await updateDoc(userRef, {
      username: newUsername, usernameLower: newUsername.toLowerCase(),
      bio: newBio, photoURL: photoURL, updatedAt: serverTimestamp(),
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

/* ===== Friend Actions ===== */
async function sendFriendRequest(targetUid, btn) {
  setButtonLoading(btn, true, "Add Friend");
  try {
    await addDoc(collection(db, "friendRequests"), {
      fromUid: currentUser.uid, toUid: targetUid,
      status: "pending", createdAt: serverTimestamp(),
    });
    await renderVisitorView();
  } catch (error) {
    console.error("Friend request error:", error);
    setButtonLoading(btn, false, "Add Friend");
  }
}

async function removeFriend(friendUid, btn) {
  if (!confirm(`Are you sure you want to unfriend ${viewedProfileData.username}?`)) return;
  
  // Bug Fix: Was `setButton.disabled`, now correctly targets `btn`
  btn.disabled = true;
  setButtonLoading(btn, true, "Unfriend");
  try {
    const currentUserRef = doc(db, "users", currentUser.uid);
    const friendUserRef = doc(db, "users", friendUid);
    
    await updateDoc(currentUserRef, { friends: arrayRemove(friendUid) });
    await updateDoc(friendUserRef, { friends: arrayRemove(currentUser.uid) });
    
    await renderVisitorView();
  } catch (error) {
    console.error("Unfriend error:", error);
  } finally {
    setButtonLoading(btn, false, "Unfriend");
  }
}

/* ===== Live Friends List ===== */
function startFriendsListener() {
  if (friendsListenerUnsubscribe) friendsListenerUnsubscribe();

  const userRef = doc(db, "users", currentUser.uid);
  friendsListenerUnsubscribe = onSnapshot(userRef, (docSnap) => {
    if (docSnap.exists()) {
      renderFriendsList(docSnap.data().friends || []);
    }
  });
}

async function renderFriendsList(friendUids) {
  if (!friendsList) return;
  friendsList.innerHTML = "";
  if (friendUids.length === 0) {
    friendsList.innerHTML = `<li class="small">You haven't added any friends yet.</li>`;
    return;
  }
  
  for(const uid of friendUids){
    const userSnap = await getDoc(doc(db, "users", uid));
    if(userSnap.exists()){
      const friend = { uid: userSnap.id, ...userSnap.data() };
      const li = document.createElement("li");
      li.className = "friend-item";
      li.innerHTML = `<img src="${friend.photoURL || defaultAvatar()}" alt="${friend.username}" style="width:32px;height:32px;border-radius:50%;"/><span>${friend.username}</span>`;
      li.onclick = () => window.location.href = `profile.html?uid=${friend.uid}`;
      friendsList.appendChild(li);
    }
  }
}

// Automatically initialize the script
initAuthListener();
