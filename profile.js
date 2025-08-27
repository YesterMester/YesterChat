// profile.js
import { auth, db } from "./firebase.js";
import { uploadProfileImage } from "./cloudinary.js"; // expects (file, userId) -> secure_url
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  setDoc
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

/* ---------- Helpers ---------- */
function defaultAvatar() {
  return "https://www.gravatar.com/avatar/?d=mp&s=160";
}
function escapeHtml(t = "") {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function qsParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* ---------- State ---------- */
const profileUid = qsParam("uid"); // may be null -> show current user's profile
let currentUser = null;
let viewedUid = null; // who we are viewing
let viewedProfileData = null; // cached profile data for viewedUid

/* ---------- Main: auth check & initial load ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Not signed in -> require auth
    window.location.replace("auth.html");
    return;
  }
  currentUser = user;
  // If no uid provided, view own profile
  viewedUid = profileUid || currentUser.uid;
  await ensureUserDocExists(currentUser); // avoid missing-doc errors
  await renderProfile(viewedUid);
});

/* Ensure the signed-in user has a users/{uid} doc (create default if missing) */
async function ensureUserDocExists(user) {
  try {
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
  } catch (err) {
    console.warn("ensureUserDocExists error (non-fatal):", err);
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

    // Populate view fields
    profileAvatar.src = data.photoURL || defaultAvatar();
    profileUsername.textContent = data.username || "Unknown";
    // only show email if viewing self
    profileEmail.textContent = (uid === currentUser.uid) ? (auth.currentUser?.email || "") : "";
    profileBio.textContent = data.bio || "";

    // If viewing own profile -> show edit area
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
    alert("Failed to load profile. See console for details.");
  }
}

/* ---------- Owner: edit/save handlers ---------- */
if (photoInput) {
  photoInput.addEventListener("change", () => {
    const f = photoInput.files[0];
    if (!f) return;
    // Preview
    try {
      const url = URL.createObjectURL(f);
      if (editAvatarPreview) editAvatarPreview.src = url;
    } catch (err) {
      console.warn("preview error", err);
    }
  });
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", (e) => {
    e.preventDefault();
    // revert preview + inputs to last loaded viewedProfileData
    if (viewedProfileData) {
      editUsername.value = viewedProfileData.username || "";
      editBio.value = viewedProfileData.bio || "";
      editAvatarPreview.src = viewedProfileData.photoURL || defaultAvatar();
    }
    editMsg.textContent = "";
  });
}

if (saveProfileBtn) {
  saveProfileBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("Not signed in.");

    const newUsername = (editUsername.value || "").trim();
    const newBio = (editBio.value || "").trim();

    // Basic validation
    if (!newUsername || newUsername.length < 2) {
      editMsg.textContent = "Username must be at least 2 characters.";
      return;
    }
    if (newUsername.length > 30) {
      editMsg.textContent = "Username must be 30 characters or less.";
      return;
    }

    editMsg.textContent = "Checking username...";
    // Ensure username uniqueness (case-insensitive)
    try {
      const usersCol = collection(db, "users");
      const q = query(usersCol, where("usernameLower", "==", newUsername.toLowerCase()));
      const snap = await getDocs(q);
      let conflict = false;
      for (const d of snap.docs) {
        if (d.id !== currentUser.uid) {
          conflict = true;
          break;
        }
      }
      if (conflict) {
        editMsg.textContent = "Username already taken — choose another.";
        return;
      }
    } catch (err) {
      console.error("username check failed", err);
      editMsg.textContent = "Failed to validate username. Try again.";
      return;
    }

    // Handle optional photo upload
    let uploadedUrl = null;
    if (photoInput && photoInput.files && photoInput.files.length > 0) {
      editMsg.textContent = "Uploading photo...";
      try {
        const file = photoInput.files[0];
        // Optional client-side checks
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
          editMsg.textContent = "Only PNG/JPEG/WebP images allowed.";
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          editMsg.textContent = "Image too large (max 5MB).";
          return;
        }
        uploadedUrl = await uploadProfileImage(file, currentUser.uid);
      } catch (err) {
        console.error("upload failed", err);
        editMsg.textContent = "Image upload failed.";
        return;
      }
    }

    // Commit changes to Firestore (and update Auth profile)
    editMsg.textContent = "Saving profile...";
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

      // update Firebase Auth profile for the signed-in user (displayName/photoURL)
      try {
        await updateAuthProfile(currentUser, {
          displayName: newUsername,
          photoURL: uploadedUrl || currentUser.photoURL || null
        });
      } catch (authErr) {
        // Not critical; still continue
        console.warn("Failed to update Auth profile:", authErr);
      }

      editMsg.textContent = "Saved.";
      // refresh view
      await renderProfile(currentUser.uid);
    } catch (err) {
      console.error("Failed to save profile:", err);
      editMsg.textContent = "Failed to save profile.";
    }
  });
}

/* ---------- Visitor actions (friend requests) ---------- */
async function setupVisitorActions(uid, profileData) {
  profileActions.innerHTML = "";

  // Make sure currentUser is available
  if (!currentUser) return;

  // Prevent friending self (should not happen here)
  if (uid === currentUser.uid) return;

  // Fetch current user's doc to check friends
  let myData = {};
  try {
    const mySnap = await getDoc(doc(db, "users", currentUser.uid));
    myData = mySnap.exists() ? mySnap.data() : {};
  } catch (err) {
    console.error("Failed loading my user doc:", err);
  }

  const isFriend = Array.isArray(myData.friends) && myData.friends.includes(uid);

  // Check friendRequests (outgoing / incoming)
  let outgoingReq = null;
  let incomingReq = null;
  try {
    // outgoing: from me -> them
    const outgoingQ = query(
      collection(db, "friendRequests"),
      where("fromUid", "==", currentUser.uid),
      where("toUid", "==", uid),
      where("status", "==", "pending")
    );
    const outSnap = await getDocs(outgoingQ);
    if (!outSnap.empty) outgoingReq = outSnap.docs[0];

    // incoming: from them -> me
    const incomingQ = query(
      collection(db, "friendRequests"),
      where("fromUid", "==", uid),
      where("toUid", "==", currentUser.uid),
      where("status", "==", "pending")
    );
    const inSnap = await getDocs(incomingQ);
    if (!inSnap.empty) incomingReq = inSnap.docs[0];
  } catch (err) {
    console.error("Failed checking friend requests:", err);
  }

  // Build buttons according to state
  if (isFriend) {
    const unfriendBtn = document.createElement("button");
    unfriendBtn.textContent = "Unfriend";
    unfriendBtn.onclick = async () => {
      try {
        // Remove friend from your own doc only (server-side or other user's client should remove theirs)
        await updateDoc(doc(db, "users", currentUser.uid), {
          friends: (Array.isArray(myData.friends) ? myData.friends.filter(x => x !== uid) : [])
        });
        alert("Removed from your friends list.");
        // refresh UI
        await renderProfile(uid);
      } catch (err) {
        console.error("Unfriend failed:", err);
        alert("Failed to unfriend.");
      }
    };
    profileActions.appendChild(unfriendBtn);

  } else if (incomingReq) {
    const acceptBtn = document.createElement("button");
    acceptBtn.textContent = "Accept Friend Request";
    acceptBtn.onclick = async () => {
      try {
        // update the friendRequests doc's status to 'accepted' (Cloud Function will finish mutual friend update)
        await updateDoc(doc(db, "friendRequests", incomingReq.id), { status: "accepted", respondedAt: serverTimestamp() });
        alert("Accepted! The system will add you as friends shortly.");
        await renderProfile(uid);
      } catch (err) {
        console.error("Accept failed:", err);
        alert("Failed to accept request.");
      }
    };
    const declineBtn = document.createElement("button");
    declineBtn.textContent = "Decline";
    declineBtn.onclick = async () => {
      try {
        await updateDoc(doc(db, "friendRequests", incomingReq.id), { status: "declined", respondedAt: serverTimestamp() });
        alert("Declined.");
        await renderProfile(uid);
      } catch (err) {
        console.error("Decline failed:", err);
        alert("Failed to decline.");
      }
    };
    profileActions.appendChild(acceptBtn);
    profileActions.appendChild(declineBtn);

  } else if (outgoingReq) {
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel Request";
    cancelBtn.onclick = async () => {
      try {
        await updateDoc(doc(db, "friendRequests", outgoingReq.id), { status: "cancelled", respondedAt: serverTimestamp() });
        alert("Cancelled friend request.");
        await renderProfile(uid);
      } catch (err) {
        console.error("Cancel failed:", err);
        alert("Failed to cancel.");
      }
    };
    profileActions.appendChild(cancelBtn);

  } else {
    const addBtn = document.createElement("button");
    addBtn.textContent = "Add Friend";
    addBtn.onclick = async () => {
      try {
        await addDoc(collection(db, "friendRequests"), {
          fromUid: currentUser.uid,
          toUid: uid,
          status: "pending",
          createdAt: serverTimestamp()
        });
        alert("Friend request sent.");
        await renderProfile(uid);
      } catch (err) {
        console.error("Send request failed:", err);
        alert("Failed to send friend request.");
      }
    };
    profileActions.appendChild(addBtn);
  }
}

/* ---------- Owner actions helper (shows edit note) ---------- */
function setupOwnerActions() {
  profileActions.innerHTML = "";
  const info = document.createElement("div");
  info.className = "small";
  info.textContent = "This is your profile. Use the form below to update your username, bio, and photo.";
  profileActions.appendChild(info);
}

/* ---------- Utility: getDocs wrapper used earlier ---------- */
async function getDocs(q) {
  // wrapper to avoid importing getDocs twice; but import above included getDocs already via named import if desired.
  return (await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js")).getDocs(q);
}

/* ---------- End of file ---------- */