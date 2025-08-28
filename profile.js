// profile.js — COMPLETE WITH NAV & LIVE FRIEND UPDATES

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
  getDocs as _getDocs,
  onSnapshot
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

/* Topbar elements */
const topbarName = document.getElementById("meName");
const topbarAvatar = document.getElementById("meAvatarSmall");

/* ---------- Helpers ---------- */
function defaultAvatar() {
  return "https://www.gravatar.com/avatar/?d=mp&s=160";
}

function qsParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function navigateToProfile(uid) {
  window.location.href = `profile.html?uid=${uid}`;
}

/* ---------- State ---------- */
let currentUser = null;
let viewedUid = null;
let viewedProfileData = null;

/* ---------- Auth init ---------- */
export function initAuthListener() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace("auth.html");
      return;
    }
    currentUser = user;
    viewedUid = qsParam("uid") || currentUser.uid;
    try {
      await ensureUserDocExists(currentUser);
      await renderProfile(viewedUid);
      startLiveFriendsListener();
    } catch (err) {
      console.error("Auth init error in profile.js:", err);
    }
  });
}

/* ---------- Ensure user doc exists ---------- */
export async function ensureUserDocExists(user) {
  if (!user) return;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const usernameDefault = user.email ? user.email.split("@")[0] : "User";
    await setDoc(ref, {
      username: usernameDefault,
      usernameLower: usernameDefault.toLowerCase(),
      bio: "",
      photoURL: "",
      friends: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}

/* ---------- Render profile ---------- */
export async function renderProfile(uid) {
  if (!uid) return;

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
  profileEmail.textContent = uid === currentUser.uid ? auth.currentUser?.email || "" : "";
  profileBio.textContent = data.bio || "";

  if (uid === currentUser.uid) {
    topbarName.textContent = data.username || "You";
    topbarAvatar.src = data.photoURL || defaultAvatar();
    editArea.style.display = "block";
    editUsername.value = data.username || "";
    editBio.value = data.bio || "";
    editAvatarPreview.src = data.photoURL || defaultAvatar();
    setupOwnerActions();
  } else {
    editArea.style.display = "none";
    await setupVisitorActions(uid, data);
  }
}

/* ---------- Owner Edit Handlers ---------- */
photoInput?.addEventListener("change", () => {
  const f = photoInput.files[0];
  if (!f) return;
  editAvatarPreview.src = URL.createObjectURL(f);
});

cancelEditBtn?.addEventListener("click", () => {
  if (!viewedProfileData) return;
  editUsername.value = viewedProfileData.username || "";
  editBio.value = viewedProfileData.bio || "";
  editAvatarPreview.src = viewedProfileData.photoURL || defaultAvatar();
  photoInput.value = "";
  editMsg.textContent = "";
});

saveProfileBtn?.addEventListener("click", async () => {
  if (!currentUser) return alert("Not signed in.");
  const newUsername = (editUsername?.value || "").trim();
  const newBio = (editBio?.value || "").trim();

  if (!newUsername || newUsername.length < 2) {
    editMsg.textContent = "Username must be at least 2 characters.";
    return;
  }
  if (newUsername.length > 30) {
    editMsg.textContent = "Username must be 30 characters or less.";
    return;
  }

  editMsg.textContent = "Checking username availability...";
  const unameSnap = await _getDocs(
    query(collection(db, "users"), where("usernameLower", "==", newUsername.toLowerCase()))
  );
  const conflict = unameSnap.docs.some(d => d.id !== currentUser.uid);
  if (conflict) {
    editMsg.textContent = "Username already taken — choose another.";
    return;
  }

  let uploadedUrl = null;
  if (photoInput.files && photoInput.files.length > 0) {
    try {
      const file = photoInput.files[0];
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        editMsg.textContent = "Only PNG/JPEG/WebP images allowed.";
        return;
      }
      if (file.size > 6 * 1024 * 1024) {
        editMsg.textContent = "Image too large (max 6MB).";
        return;
      }
      editMsg.textContent = "Uploading photo...";
      uploadedUrl = await uploadProfileImage(file, currentUser.uid);
    } catch {
      editMsg.textContent = "Image upload failed.";
      return;
    }
  }

  try {
    const userRef = doc(db, "users", currentUser.uid);
    const payload = {
      username: newUsername,
      usernameLower: newUsername.toLowerCase(),
      bio: newBio,
      updatedAt: serverTimestamp()
    };
    if (uploadedUrl) payload.photoURL = uploadedUrl;

    await updateDoc(userRef, payload);
    await updateAuthProfile(currentUser, {
      displayName: newUsername,
      photoURL: uploadedUrl || currentUser.photoURL || null
    });

    editMsg.textContent = "Saved.";
    topbarName.textContent = newUsername;
    topbarAvatar.src = uploadedUrl || currentUser.photoURL || defaultAvatar();
    await renderProfile(currentUser.uid);
    photoInput.value = "";
  } catch {
    editMsg.textContent = "Failed to save profile.";
  }
});

/* ---------- Visitor Actions ---------- */
async function hasPendingRequestBetween(aUid, bUid) {
  const colRef = collection(db, "friendRequests");
  const snap1 = await _getDocs(query(colRef, where("fromUid", "==", aUid), where("toUid", "==", bUid), where("status", "==", "pending")));
  if (!snap1.empty) return { exists: true, doc: snap1.docs[0], direction: "outgoing" };
  const snap2 = await _getDocs(query(colRef, where("fromUid", "==", bUid), where("toUid", "==", aUid), where("status", "==", "pending")));
  if (!snap2.empty) return { exists: true, doc: snap2.docs[0], direction: "incoming" };
  return { exists: false };
}

export async function setupVisitorActions(uid, profileData) {
  profileActions.innerHTML = "";
  if (!currentUser || uid === currentUser.uid) return;

  const mySnap = await getDoc(doc(db, "users", currentUser.uid));
  const myData = mySnap.exists() ? mySnap.data() : {};
  const friendsArr = Array.isArray(myData.friends) ? myData.friends : [];
  const isFriend = friendsArr.includes(uid);

  if (isFriend) {
    const unfriendBtn = document.createElement("button");
    unfriendBtn.textContent = "Unfriend";
    unfriendBtn.onclick = async () => {
      await updateDoc(doc(db, "users", currentUser.uid), { friends: friendsArr.filter(x => x !== uid) });
      try {
        const theirSnap = await getDoc(doc(db, "users", uid));
        if (theirSnap.exists()) {
          const theirFriends = Array.isArray(theirSnap.data().friends) ? theirSnap.data().friends : [];
          if (theirFriends.includes(currentUser.uid)) {
            await updateDoc(doc(db, "users", uid), { friends: theirFriends.filter(x => x !== currentUser.uid) });
          }
        }
      } catch {}
      alert("Removed from your friends list.");
      await renderProfile(uid);
    };
    profileActions.appendChild(unfriendBtn);
    return;
  }

  const addBtn = document.createElement("button");
  addBtn.textContent = "Add Friend";
  addBtn.onclick = async () => {
    const pending = await hasPendingRequestBetween(currentUser.uid, uid);
    if (pending.exists) {
      if (pending.direction === "outgoing") alert("You already sent a friend request.");
      else if (pending.direction === "incoming") alert("This user sent you a request.");
      return;
    }
    await addDoc(collection(db, "friendRequests"), { fromUid: currentUser.uid, toUid: uid, status: "pending", createdAt: serverTimestamp() });
    alert("Friend request sent.");
    await renderProfile(uid);
  };
  profileActions.appendChild(addBtn);
}

/* ---------- Owner Actions ---------- */
export function setupOwnerActions() {
  profileActions.innerHTML = "";
  const info = document.createElement("div");
  info.className = "small";
  info.textContent = "This is your profile. Use the form below to update username, bio, and photo.";
  profileActions.appendChild(info);
}

/* ---------- Friend Requests ---------- */
export function listenForFriendRequests(callback) {
  if (!currentUser) return () => {};
  const q = query(collection(db, "friendRequests"), where("toUid", "==", currentUser.uid), where("status", "==", "pending"));
  const unsubscribe = onSnapshot(q, async (snapshot) => {
    const requests = [];
    for (const docSnap of snapshot.docs) {
      const req = docSnap.data();
      let fromUser = null;
      try {
        const fromSnap = await getDoc(doc(db, "users", req.fromUid));
        if (fromSnap.exists()) fromUser = fromSnap.data();
      } catch {}
      requests.push({ id: docSnap.id, ...req, fromUser });
    }
    callback(requests);
  });
  return unsubscribe;
}

export async function acceptFriendRequest(requestId, fromUid) {
  await updateDoc(doc(db, "friendRequests", requestId), { status: "accepted", respondedAt: serverTimestamp() });
  const myRef = doc(db, "users", currentUser.uid);
  const mySnap = await getDoc(myRef);
  const myFriends = mySnap.exists() ? mySnap.data().friends || [] : [];
  if (!myFriends.includes(fromUid)) {
    await updateDoc(myRef, { friends: Array.from(new Set([...myFriends, fromUid])), updatedAt: serverTimestamp() });
  }
}

export async function declineFriendRequest(requestId) {
  await updateDoc(doc(db, "friendRequests", requestId), { status: "declined", respondedAt: serverTimestamp() });
}

export function startOutgoingRequestsListener() {
  if (!currentUser) return () => {};
  const q = query(collection(db, "friendRequests"), where("fromUid", "==", currentUser.uid), where("status", "==", "accepted"));
  return onSnapshot(q, async (snapshot) => {
    for (const docSnap of snapshot.docs) {
      const toUid = docSnap.data().toUid;
      if (!toUid) continue;
      const myRef = doc(db, "users", currentUser.uid);
      const mySnap = await getDoc(myRef);
      const myFriends = mySnap.exists() ? mySnap.data().friends || [] : [];
      if (!myFriends.includes(toUid)) await updateDoc(myRef, { friends: Array.from(new Set([...myFriends, toUid])), updatedAt: serverTimestamp() });
    }
  });
}

/* ---------- Fetch Friends ---------- */
export async function fetchFriends(callback) {
  if (!currentUser) return callback([]);
  const userSnap = await getDoc(doc(db, "users", currentUser.uid));
  if (!userSnap.exists()) return callback([]);
  const friends = Array.isArray(userSnap.data().friends) ? userSnap.data().friends : [];
  if (!friends.length) return callback([]);
  const friendProfiles = [];
  for (const uid of friends) {
    try {
      const fSnap = await getDoc(doc(db, "users", uid));
      if (fSnap.exists()) friendProfiles.push({ uid, ...fSnap.data() });
    } catch {}
  }
  callback(friendProfiles);
}

/* ---------- Live Friends Update ---------- */
let friendsUnsub = null;
function startLiveFriendsListener() {
  if (friendsUnsub) friendsUnsub();
  const userRef = doc(db, "users", currentUser.uid);
  friendsUnsub = onSnapshot(userRef, async (snap) => {
    if (!snap.exists()) return;
    const friendsArr = Array.isArray(snap.data().friends) ? snap.data().friends : [];
    updateFriendListUI(friendsArr); // you implement rendering friend list
  });
}

/* ---------- Utility ---------- */
export function getCurrentUser() {
  return currentUser;
}

/* ---------- Initialize ---------- */
initAuthListener();