// profile.js (updated with topbar update)
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
  getDocs as _getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged, updateProfile as updateAuthProfile } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ---------- DOM ---------- */
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

/* Topbar elements to update after saving */
const topbarName = document.getElementById("meName");
const topbarAvatar = document.getElementById("meAvatarSmall");

/* ---------- Helpers ---------- */
function defaultAvatar() {
  return "https://www.gravatar.com/avatar/?d=mp&s=160";
}
function qsParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* ---------- State ---------- */
const profileUid = qsParam("uid");
let currentUser = null;
let viewedUid = null;
let viewedProfileData = null;

/* ---------- Auth check & load ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("auth.html");
    return;
  }
  currentUser = user;
  viewedUid = profileUid || currentUser.uid;
  await ensureUserDocExists(currentUser);
  await renderProfile(viewedUid);
});

/* Ensure user doc exists */
async function ensureUserDocExists(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      username: user.email ? user.email.split("@")[0] : "User",
      usernameLower: user.email ? user.email.split("@")[0].toLowerCase() : "user",
      bio: "",
      photoURL: "",
      friends: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}

/* ---------- Render profile ---------- */
async function renderProfile(uid) {
  try {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      profileUsername.textContent = "Profile not found";
      profileBio.textContent = "";
      profileAvatar.src = defaultAvatar();
      profileEmail.textContent = "";
      profileActions.innerHTML = "";
      editArea.style.display = "none";
      return;
    }

    const data = snap.data();
    viewedProfileData = data;

    profileAvatar.src = data.photoURL || defaultAvatar();
    profileUsername.textContent = data.username || "Unknown";
    profileEmail.textContent = (uid === currentUser.uid) ? auth.currentUser?.email || "" : "";
    profileBio.textContent = data.bio || "";

    // Update topbar if viewing self
    if (uid === currentUser.uid) {
      if (topbarName) topbarName.textContent = data.username || "You";
      if (topbarAvatar) topbarAvatar.src = data.photoURL || defaultAvatar();
    }

    if (uid === currentUser.uid) {
      editArea.style.display = "block";
      editUsername.value = data.username || "";
      editBio.value = data.bio || "";
      editAvatarPreview.src = data.photoURL || defaultAvatar();
      setupOwnerActions();
    } else {
      editArea.style.display = "none";
      setupVisitorActions(uid, data);
    }
  } catch (err) {
    console.error("renderProfile error:", err);
    alert("Failed to load profile.");
  }
}
/* ---------- Friend Requests ---------- */
export async function listenForFriendRequests(callback) {
  if (!currentUser) return;
  const q = query(
    collection(db, "friendRequests"),
    where("toUid", "==", currentUser.uid),
    where("status", "==", "pending")
  );

  const { onSnapshot } = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
  return onSnapshot(q, async (snapshot) => {
    const requests = [];
    for (const docSnap of snapshot.docs) {
      const req = docSnap.data();
      const fromSnap = await getDoc(doc(db, "users", req.fromUid));
      requests.push({
        id: docSnap.id,
        ...req,
        fromUser: fromSnap.exists() ? fromSnap.data() : null
      });
    }
    callback(requests);
  });
}

export async function acceptFriendRequest(requestId, fromUid) {
  if (!currentUser) return;
  try {
    // Add each other as friends
    const meRef = doc(db, "users", currentUser.uid);
    const themRef = doc(db, "users", fromUid);

    const meSnap = await getDoc(meRef);
    const themSnap = await getDoc(themRef);

    if (meSnap.exists() && themSnap.exists()) {
      const meData = meSnap.data();
      const themData = themSnap.data();

      await updateDoc(meRef, {
        friends: Array.from(new Set([...(meData.friends || []), fromUid]))
      });
      await updateDoc(themRef, {
        friends: Array.from(new Set([...(themData.friends || []), currentUser.uid]))
      });
    }

    // Update request status
    await updateDoc(doc(db, "friendRequests", requestId), {
      status: "accepted",
      updatedAt: serverTimestamp()
    });

    alert("Friend request accepted!");
  } catch (err) {
    console.error("acceptFriendRequest error:", err);
    alert("Failed to accept friend request.");
  }
}

export async function declineFriendRequest(requestId) {
  if (!currentUser) return;
  try {
    await updateDoc(doc(db, "friendRequests", requestId), {
      status: "declined",
      updatedAt: serverTimestamp()
    });
    alert("Friend request declined.");
  } catch (err) {
    console.error("declineFriendRequest error:", err);
    alert("Failed to decline friend request.");
  }
}
/* ---------- Friends List ---------- */
export async function fetchFriends(callback) {
  if (!currentUser) return;
  try {
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (!userSnap.exists()) {
      callback([]);
      return;
    }
    const friends = userSnap.data().friends || [];
    const friendProfiles = [];
    for (const uid of friends) {
      const fSnap = await getDoc(doc(db, "users", uid));
      if (fSnap.exists()) {
        friendProfiles.push({ uid, ...fSnap.data() });
      }
    }
    callback(friendProfiles);
  } catch (err) {
    console.error("fetchFriends error:", err);
    callback([]);
  }
}

/* ---------- Utility ---------- */
export function getCurrentUser() {
  return currentUser;
}

/* ---------- Init ---------- */
initAuthListener();