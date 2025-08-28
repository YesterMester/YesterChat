// profile.js — Part 1/3 (imports, DOM, helpers, auth init, renderProfile)
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
  arrayUnion
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

/* ---------- Auth init (exposed via initAuthListener called later) ---------- */
export function initAuthListener() {
  // Use onAuthStateChanged to initialize page
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      // Not signed in — send to auth page (keep previous UX)
      window.location.replace("auth.html");
      return;
    }
    currentUser = user;
    viewedUid = profileUid || currentUser.uid;
    try {
      await ensureUserDocExists(currentUser);
      await renderProfile(viewedUid);
    } catch (err) {
      console.error("Auth init error in profile.js:", err);
    }
  });
}

/* Ensure users/{uid} exists (creates minimal profile if missing) */
export async function ensureUserDocExists(user) {
  if (!user) return;
  const ref = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      // Create a safe minimal profile
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
  } catch (err) {
    console.error("ensureUserDocExists error:", err);
    throw err;
  }
}

/* ---------- Render profile ---------- */
export async function renderProfile(uid) {
  try {
    if (!uid) {
      throw new Error("No uid provided to renderProfile");
    }
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      // gracefully handle missing profile
      if (profileUsername) profileUsername.textContent = "Profile not found";
      if (profileBio) profileBio.textContent = "";
      if (profileAvatar) profileAvatar.src = defaultAvatar();
      if (profileEmail) profileEmail.textContent = "";
      if (profileActions) profileActions.innerHTML = "";
      if (editArea) editArea.style.display = "none";
      return;
    }

    const data = snap.data();
    viewedProfileData = data;

    if (profileAvatar) profileAvatar.src = data.photoURL || defaultAvatar();
    if (profileUsername) profileUsername.textContent = data.username || "Unknown";
    if (profileEmail) profileEmail.textContent = (uid === currentUser?.uid) ? (auth.currentUser?.email || "") : "";
    if (profileBio) profileBio.textContent = data.bio || "";

    // Update topbar if viewing self
    if (uid === currentUser?.uid) {
      if (topbarName) topbarName.textContent = data.username || "You";
      if (topbarAvatar) topbarAvatar.src = data.photoURL || defaultAvatar();
    }

    // Show edit area if viewing own profile
    if (uid === currentUser?.uid) {
      if (editArea) editArea.style.display = "block";
      if (editUsername) editUsername.value = data.username || "";
      if (editBio) editBio.value = data.bio || "";
      if (editAvatarPreview) editAvatarPreview.src = data.photoURL || defaultAvatar();
      setupOwnerActions();
    } else {
      if (editArea) editArea.style.display = "none";
      await setupVisitorActions(uid, data);
    }
  } catch (err) {
    console.error("renderProfile error:", err);
    alert("Failed to load profile. See console for details.");
  }
}
// profile.js — Part 2/3 (owner edit handlers, visitor actions, utilities)

/* ---------- Owner edit handlers (photo preview, cancel, save) ---------- */
if (photoInput) {
  photoInput.addEventListener("change", () => {
    const f = photoInput.files[0];
    if (!f) return;
    try {
      const url = URL.createObjectURL(f);
      if (editAvatarPreview) editAvatarPreview.src = url;
    } catch (err) {
      console.warn("Preview creation failed:", err);
    }
  });
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (!viewedProfileData) return;
    if (editUsername) editUsername.value = viewedProfileData.username || "";
    if (editBio) editBio.value = viewedProfileData.bio || "";
    if (editAvatarPreview) editAvatarPreview.src = viewedProfileData.photoURL || defaultAvatar();
    if (photoInput) photoInput.value = "";
    if (editMsg) editMsg.textContent = "";
  });
}

if (saveProfileBtn) {
  saveProfileBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("Not signed in.");

    const newUsername = (editUsername?.value || "").trim();
    const newBio = (editBio?.value || "").trim();

    if (!newUsername || newUsername.length < 2) {
      if (editMsg) editMsg.textContent = "Username must be at least 2 characters.";
      return;
    }
    if (newUsername.length > 30) {
      if (editMsg) editMsg.textContent = "Username must be 30 characters or less.";
      return;
    }

    if (editMsg) editMsg.textContent = "Checking username availability...";

    try {
      // Ensure username uniqueness (case-insensitive)
      const usersCol = collection(db, "users");
      const unameQ = query(usersCol, where("usernameLower", "==", newUsername.toLowerCase()));
      const unameSnap = await _getDocs(unameQ);
      const conflict = unameSnap.docs.some(d => d.id !== currentUser.uid);
      if (conflict) {
        if (editMsg) editMsg.textContent = "Username already taken — choose another.";
        return;
      }
    } catch (err) {
      console.error("username check failed:", err);
      if (editMsg) editMsg.textContent = "Failed to validate username. Try again.";
      return;
    }

    // Optional image upload
    let uploadedUrl = null;
    if (photoInput && photoInput.files && photoInput.files.length > 0) {
      try {
        if (editMsg) editMsg.textContent = "Uploading photo...";
        const file = photoInput.files[0];
        // client-side checks
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
          if (editMsg) editMsg.textContent = "Only PNG/JPEG/WebP images allowed.";
          return;
        }
        if (file.size > 6 * 1024 * 1024) {
          if (editMsg) editMsg.textContent = "Image too large (max 6MB).";
          return;
        }
        uploadedUrl = await uploadProfileImage(file, currentUser.uid);
      } catch (err) {
        console.error("Image upload failed:", err);
        if (editMsg) editMsg.textContent = "Image upload failed.";
        return;
      }
    }

    // Save to Firestore + update Auth profile
    try {
      if (editMsg) editMsg.textContent = "Saving profile...";
      const userRef = doc(db, "users", currentUser.uid);
      const updatePayload = {
        username: newUsername,
        usernameLower: newUsername.toLowerCase(),
        bio: newBio,
        updatedAt: serverTimestamp()
      };
      if (uploadedUrl) updatePayload.photoURL = uploadedUrl;

      await updateDoc(userRef, updatePayload);

      // Update Firebase Auth profile (best-effort)
      try {
        await updateAuthProfile(currentUser, {
          displayName: newUsername,
          photoURL: uploadedUrl || currentUser.photoURL || null
        });
      } catch (authErr) {
        console.warn("Failed to update Auth profile:", authErr);
      }

      if (editMsg) editMsg.textContent = "Saved.";
      // Update topbar immediately
      if (topbarName) topbarName.textContent = newUsername;
      if (topbarAvatar) topbarAvatar.src = uploadedUrl || currentUser.photoURL || defaultAvatar();

      // Re-render profile to reflect changes
      await renderProfile(currentUser.uid);
      if (photoInput) photoInput.value = "";
    } catch (err) {
      console.error("Failed to save profile:", err);
      if (editMsg) editMsg.textContent = "Failed to save profile.";
    }
  });
}

/* ---------- Helper: check existing pending friend request between two users ---------- */
async function hasPendingRequestBetween(aUid, bUid) {
  // Check both directions for a pending request
  try {
    const colRef = collection(db, "friendRequests");
    const q1 = query(colRef, where("fromUid", "==", aUid), where("toUid", "==", bUid), where("status", "==", "pending"));
    const q2 = query(colRef, where("fromUid", "==", bUid), where("toUid", "==", aUid), where("status", "==", "pending"));
    const snap1 = await _getDocs(q1);
    if (!snap1.empty) return { exists: true, doc: snap1.docs[0], direction: "outgoing" };
    const snap2 = await _getDocs(q2);
    if (!snap2.empty) return { exists: true, doc: snap2.docs[0], direction: "incoming" };
    return { exists: false };
  } catch (err) {
    console.error("hasPendingRequestBetween error:", err);
    return { exists: false, error: err };
  }
}

/* ---------- Visitor actions (send request / unfriend) ---------- */
export async function setupVisitorActions(uid, profileData) {
  // This function can be awaited (renderProfile calls it with await)
  profileActions.innerHTML = "";

  // Guard
  if (!currentUser || !uid || uid === currentUser.uid) return;

  // Load current user's doc to check current friendship
  let myData = {};
  try {
    const mySnap = await getDoc(doc(db, "users", currentUser.uid));
    myData = mySnap.exists() ? mySnap.data() : {};
  } catch (err) {
    console.error("Failed to load my user doc:", err);
    myData = {};
  }

  const friendsArr = Array.isArray(myData.friends) ? myData.friends : [];
  const isFriend = friendsArr.includes(uid);

  if (isFriend) {
    // Unfriend button
    const unfriendBtn = document.createElement("button");
    unfriendBtn.textContent = "Unfriend";
    unfriendBtn.onclick = async () => {
      try {
        // remove target from my friends
        await updateDoc(doc(db, "users", currentUser.uid), {
          friends: friendsArr.filter(x => x !== uid)
        });
        // Try to remove me from their friends if permitted (best-effort)
        try {
          const theirSnap = await getDoc(doc(db, "users", uid));
          if (theirSnap.exists()) {
            const theirFriends = Array.isArray(theirSnap.data().friends) ? theirSnap.data().friends : [];
            if (theirFriends.includes(currentUser.uid)) {
              await updateDoc(doc(db, "users", uid), {
                friends: theirFriends.filter(x => x !== currentUser.uid)
              });
            }
          }
        } catch (err) {
          console.warn("Could not remove friendship from other user's doc (may be permission rules):", err);
        }
        alert("Removed from your friends list.");
        await renderProfile(uid);
      } catch (err) {
        console.error("Unfriend failed:", err);
        alert("Failed to unfriend. Check console.");
      }
    };
    profileActions.appendChild(unfriendBtn);
    return;
  }

  // Not friends — show Add Friend (but prevent duplicate pending)
  const addBtn = document.createElement("button");
  addBtn.textContent = "Add Friend";
  addBtn.onclick = async () => {
    try {
      if (!currentUser) return alert("Not signed in.");
      // Prevent duplicate pending requests
      const pending = await hasPendingRequestBetween(currentUser.uid, uid);
      if (pending.exists) {
        if (pending.direction === "outgoing") {
          alert("You already sent a friend request. Please wait for a response.");
        } else if (pending.direction === "incoming") {
          alert("This user has already sent you a request — check incoming requests.");
        } else {
          alert("A pending friend request already exists.");
        }
        return;
      }

      await addDoc(collection(db, "friendRequests"), {
        fromUid: currentUser.uid,
        toUid: uid,
        status: "pending",
        createdAt: serverTimestamp()
      });
      alert("Friend request sent.");
      await renderProfile(uid);
    } catch (err) {
      console.error("Send friend request failed:", err);
      alert("Failed to send friend request. See console.");
    }
  };

  profileActions.appendChild(addBtn);
}

/* ---------- Owner helper ---------- */
export function setupOwnerActions() {
  profileActions.innerHTML = "";
  const info = document.createElement("div");
  info.className = "small";
  info.textContent = "This is your profile. Use the form below to update username, bio, and photo.";
  profileActions.appendChild(info);
}
// profile.js — Part 3 (friend-request helpers, outgoing-listener, exports)

/* ---------- Friend-request listeners & actions ---------- */

/**
 * Listen for incoming friend requests for the current signed-in user.
 * @param {(requests: Array)} callback - invoked with an array of request objects { id, fromUid, toUid, status, createdAt, fromUser }
 * @returns {Function} unsubscribe function
 */
export function listenForFriendRequests(callback) {
  if (!currentUser) {
    console.warn("listenForFriendRequests: no currentUser yet");
    return () => {};
  }

  const q = query(
    collection(db, "friendRequests"),
    where("toUid", "==", currentUser.uid),
    where("status", "==", "pending")
  );

  const unsubscribe = onSnapshot(q, async (snapshot) => {
    try {
      const requests = [];
      for (const docSnap of snapshot.docs) {
        const req = docSnap.data();
        // include a light profile of the sender to show in UI
        let fromUser = null;
        try {
          const fromSnap = await getDoc(doc(db, "users", req.fromUid));
          if (fromSnap.exists()) fromUser = fromSnap.data();
        } catch (err) {
          console.warn("Could not load fromUser profile:", err);
        }

        requests.push({
          id: docSnap.id,
          ...req,
          fromUser
        });
      }
      callback(requests);
    } catch (err) {
      console.error("listenForFriendRequests handler error:", err);
      callback([]);
    }
  }, (err) => {
    console.error("listenForFriendRequests onSnapshot error:", err);
    callback([]);
  });

  // return unsubscribe to caller for cleanup
  return unsubscribe;
}

/**
 * Accept a friend request.
 * - Marks the friendRequest doc as 'accepted'
 * - Adds requester uid to the current user's friends array (client-side update)
 * - DOES NOT update the other user's doc (sender) — instead the sender's client will detect the status change and update their own doc via startOutgoingRequestsListener.
 *
 * @param {string} requestId - the friendRequests doc id
 * @param {string} fromUid - uid of the user who sent the request
 */
export async function acceptFriendRequest(requestId, fromUid) {
  if (!currentUser) throw new Error("Not signed in");

  try {
    // 1) mark the request accepted
    await updateDoc(doc(db, "friendRequests", requestId), {
      status: "accepted",
      respondedAt: serverTimestamp()
    });

    // 2) add them to *this* user's friends array (acceptor)
    try {
      const myRef = doc(db, "users", currentUser.uid);
      const mySnap = await getDoc(myRef);
      const myFriends = mySnap.exists() ? (mySnap.data().friends || []) : [];
      if (!myFriends.includes(fromUid)) {
        // create a deduplicated array and write
        await updateDoc(myRef, {
          friends: Array.from(new Set([...myFriends, fromUid])),
          updatedAt: serverTimestamp()
        });
      }
    } catch (err) {
      // If this fails (shouldn't for user's own doc), log and continue
      console.error("Failed to add friend to acceptor's doc:", err);
      // Do not throw — request already accepted in Firestore
    }

    // success
    return { ok: true };
  } catch (err) {
    console.error("acceptFriendRequest error:", err);
    throw err;
  }
}

/**
 * Decline a friend request by id.
 * @param {string} requestId
 */
export async function declineFriendRequest(requestId) {
  if (!currentUser) throw new Error("Not signed in");
  try {
    await updateDoc(doc(db, "friendRequests", requestId), {
      status: "declined",
      respondedAt: serverTimestamp()
    });
    return { ok: true };
  } catch (err) {
    console.error("declineFriendRequest error:", err);
    throw err;
  }
}

/* ---------- Outgoing requests listener ----------
   Ensures the sender updates their own friends array when their outgoing request is accepted.
   This avoids needing the acceptor to write to the sender's users/{uid} (which often triggers permission issues).
   Call this on sign-in (script.js should start it alongside incoming listener).
*/
export function startOutgoingRequestsListener() {
  if (!currentUser) {
    console.warn("startOutgoingRequestsListener: no currentUser yet");
    return () => {};
  }

  const q = query(
    collection(db, "friendRequests"),
    where("fromUid", "==", currentUser.uid),
    where("status", "==", "accepted")
  );

  const unsubscribe = onSnapshot(q, async (snapshot) => {
    try {
      if (snapshot.empty) return;
      // For each accepted outgoing request, ensure this user's friends list contains the toUid
      for (const docSnap of snapshot.docs) {
        const req = docSnap.data();
        const toUid = req.toUid;
        if (!toUid) continue;

        try {
          const myRef = doc(db, "users", currentUser.uid);
          const mySnap = await getDoc(myRef);
          const myFriends = mySnap.exists() ? (mySnap.data().friends || []) : [];
          if (!myFriends.includes(toUid)) {
            await updateDoc(myRef, {
              friends: Array.from(new Set([...myFriends, toUid])),
              updatedAt: serverTimestamp()
            });
          }
        } catch (err) {
          console.error("startOutgoingRequestsListener: failed to update my friends array:", err);
        }
      }
    } catch (err) {
      console.error("startOutgoingRequestsListener snapshot handler error:", err);
    }
  }, (err) => {
    console.error("startOutgoingRequestsListener onSnapshot error:", err);
  });

  return unsubscribe;
}

/* ---------- Fetch friends helper (returns array of profile objects) ---------- */
/**
 * Fetch the current user's friends' profiles and pass them to callback.
 * @param {(friendProfiles:Array) => void} callback
 */
export async function fetchFriends(callback) {
  if (!currentUser) {
    callback([]);
    return;
  }

  try {
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (!userSnap.exists()) {
      callback([]);
      return;
    }

    const friends = Array.isArray(userSnap.data().friends) ? userSnap.data().friends : [];
    if (!friends.length) {
      callback([]);
      return;
    }

    const friendProfiles = [];
    for (const uid of friends) {
      try {
        const fSnap = await getDoc(doc(db, "users", uid));
        if (fSnap.exists()) friendProfiles.push({ uid, ...fSnap.data() });
      } catch (err) {
        console.warn("fetchFriends: failed to load friend profile", uid, err);
      }
    }

    callback(friendProfiles);
  } catch (err) {
    console.error("fetchFriends error:", err);
    callback([]);
  }
}

/* ---------- Utility: return current user ---------- */
export function getCurrentUser() {
  return currentUser;
}

/* ---------- Export notes ----------
 - listenForFriendRequests(callback) -> returns unsubscribe()
 - startOutgoingRequestsListener() -> returns unsubscribe()
 - acceptFriendRequest(requestId, fromUid)
 - declineFriendRequest(requestId)
 - fetchFriends(callback)
 - getCurrentUser()
 
 Usage tips:
  - Have script.js call startOutgoingRequestsListener() after signing in (so the sender will add friends to their own doc automatically).
  - When accepting, call acceptFriendRequest(requestId, fromUid) instead of attempting to write to the other user's doc directly.
  - All returned unsubscribes should be called during cleanup (e.g., on logout) to avoid memory leaks.
*/

/* ---------- End of Part 3 ---------- */