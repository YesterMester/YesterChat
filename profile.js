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

/* ---------- Owner actions ---------- */
if (photoInput) {
  photoInput.addEventListener("change", () => {
    const f = photoInput.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    editAvatarPreview.src = url;
  });
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", () => {
    if (!viewedProfileData) return;
    editUsername.value = viewedProfileData.username || "";
    editBio.value = viewedProfileData.bio || "";
    editAvatarPreview.src = viewedProfileData.photoURL || defaultAvatar();
    photoInput.value = "";
    editMsg.textContent = "";
  });
}

if (saveProfileBtn) {
  saveProfileBtn.addEventListener("click", async () => {
    const newUsername = (editUsername.value || "").trim();
    const newBio = (editBio.value || "").trim();

    if (!newUsername || newUsername.length < 2) {
      editMsg.textContent = "Username must be at least 2 characters.";
      return;
    }

    editMsg.textContent = "Checking username...";
    const usersCol = collection(db, "users");
    const q = query(usersCol, where("usernameLower", "==", newUsername.toLowerCase()));
    const snap = await _getDocs(q);
    if (snap.docs.some(d => d.id !== currentUser.uid)) {
      editMsg.textContent = "Username already taken.";
      return;
    }

    let uploadedUrl = null;
    if (photoInput.files.length > 0) {
      try {
        uploadedUrl = await uploadProfileImage(photoInput.files[0], currentUser.uid);
      } catch (err) {
        console.error(err);
        editMsg.textContent = "Image upload failed.";
        return;
      }
    }

    editMsg.textContent = "Saving...";
    try {
      const userRef = doc(db, "users", currentUser.uid);
      const updatePayload = {
        username: newUsername,
        usernameLower: newUsername.toLowerCase(),
        bio: newBio,
        updatedAt: serverTimestamp()
      };
      if (uploadedUrl) updatePayload.photoURL = uploadedUrl;

      await updateDoc(userRef, updatePayload);
      await updateAuthProfile(currentUser, { displayName: newUsername, photoURL: uploadedUrl || currentUser.photoURL || null });

      editMsg.textContent = "Saved!";

      // Update topbar immediately
      if (topbarName) topbarName.textContent = newUsername;
      if (topbarAvatar) topbarAvatar.src = uploadedUrl || currentUser.photoURL || defaultAvatar();

      await renderProfile(currentUser.uid);
      photoInput.value = "";
    } catch (err) {
      console.error(err);
      editMsg.textContent = "Failed to save profile.";
    }
  });
}

/* ---------- Visitor actions ---------- */
async function setupVisitorActions(uid, profileData) {
  profileActions.innerHTML = "";

  if (!currentUser || uid === currentUser.uid) return;

  let myData = {};
  try {
    const mySnap = await getDoc(doc(db, "users", currentUser.uid));
    myData = mySnap.exists() ? mySnap.data() : {};
  } catch (err) {
    console.error(err);
  }

  const isFriend = Array.isArray(myData.friends) && myData.friends.includes(uid);

  if (isFriend) {
    const btn = document.createElement("button");
    btn.textContent = "Unfriend";
    btn.onclick = async () => {
      await updateDoc(doc(db, "users", currentUser.uid), {
        friends: myData.friends.filter(x => x !== uid)
      });
      alert("Removed from friends.");
      await renderProfile(uid);
    };
    profileActions.appendChild(btn);
  } else {
    const btn = document.createElement("button");
    btn.textContent = "Add Friend";
    btn.onclick = async () => {
      await addDoc(collection(db, "friendRequests"), {
        fromUid: currentUser.uid,
        toUid: uid,
        status: "pending",
        createdAt: serverTimestamp()
      });
      alert("Friend request sent.");
      await renderProfile(uid);
    };
    profileActions.appendChild(btn);
  }
}

/* ---------- Owner helper ---------- */
function setupOwnerActions() {
  profileActions.innerHTML = "";
  const info = document.createElement("div");
  info.className = "small";
  info.textContent = "This is your profile. Use the form below to update username, bio, and photo.";
  profileActions.appendChild(info);
}