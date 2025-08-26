// profile.js
import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged, updateProfile as updateAuthProfile } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc, getDoc, updateDoc, setDoc, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

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

// Helpers
function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

// Read target uid from query string, otherwise show self
const targetUid = getQueryParam("uid");

// Wait for auth
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("auth.html");
    return;
  }

  const meUid = user.uid;
  const viewUid = targetUid || meUid;

  // fetch both docs
  const meRef = doc(db, "users", meUid);
  const targetRef = doc(db, "users", viewUid);

  const meSnap = await getDoc(meRef);
  const targetSnap = await getDoc(targetRef);

  if (!targetSnap.exists()) {
    profileUsername.textContent = "Unknown user";
    profileBio.textContent = "";
    return;
  }

  const meData = meSnap.exists() ? meSnap.data() : null;
  const targetData = targetSnap.data();

  // populate UI
  profileAvatar.src = targetData.photoURL || defaultAvatar();
  profileUsername.textContent = targetData.username || "Anonymous";
  profileEmail.textContent = (viewUid === meUid) ? auth.currentUser.email : ""; // only show email to self
  profileBio.textContent = targetData.bio || "";

  // If viewing your own profile -> show edit area
  if (viewUid === meUid) {
    editArea.style.display = "block";
    editBio.value = targetData.bio || "";

    // Photo upload handler
    photoInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const ref = storageRef(storage, `profilePhotos/${meUid}/${file.name}`);
        await uploadBytes(ref, file);
        const url = await getDownloadURL(ref);
        await updateDoc(targetRef, { photoURL: url });
        // update auth profile photo URL too
        await updateAuthProfile(auth.currentUser, { photoURL: url });
        profileAvatar.src = url;
        alert("Profile photo updated.");
      } catch (err) {
        console.error("Upload error", err);
        alert("Failed to upload photo.");
      }
    });

    saveProfileBtn.addEventListener("click", async () => {
      const newBio = editBio.value.trim();
      try {
        await updateDoc(targetRef, { bio: newBio });
        profileBio.textContent = newBio;
        alert("Profile saved.");
      } catch (err) {
        console.error("Save profile error", err);
        alert("Failed to save profile.");
      }
    });
  } else {
    // Viewing someone else's profile -> show friend-state action buttons
    editArea.style.display = "none";
    profileActions.innerHTML = ""; // reset

    // Determine relationship
    const friends = meData?.friends || [];
    const incoming = meData?.incomingRequests || [];
    const outgoing = meData?.outgoingRequests || [];

    const isFriend = friends.includes(viewUid);
    const sentRequest = outgoing.includes(viewUid);
    const receivedRequest = incoming.includes(viewUid);

    if (isFriend) {
      const btn = document.createElement("button");
      btn.textContent = "Unfriend";
      btn.onclick = async () => {
        try {
          await updateDoc(meRef, { friends: arrayRemove(viewUid) });
          await updateDoc(targetRef, { friends: arrayRemove(meUid) });
          alert("Unfriended.");
          location.reload();
        } catch (err) {
          console.error("Unfriend error", err);
          alert("Failed to unfriend.");
        }
      };
      profileActions.appendChild(btn);
    } else if (receivedRequest) {
      const acceptBtn = document.createElement("button");
      acceptBtn.textContent = "Accept Friend";
      acceptBtn.onclick = async () => {
        try {
          await updateDoc(meRef, {
            friends: arrayUnion(viewUid),
            incomingRequests: arrayRemove(viewUid)
          });
          await updateDoc(targetRef, {
            friends: arrayUnion(meUid),
            outgoingRequests: arrayRemove(meUid)
          });
          alert("Friend request accepted.");
          location.reload();
        } catch (err) {
          console.error("Accept error", err);
          alert("Failed to accept.");
        }
      };
      const declineBtn = document.createElement("button");
      declineBtn.textContent = "Decline";
      declineBtn.onclick = async () => {
        try {
          await updateDoc(meRef, { incomingRequests: arrayRemove(viewUid) });
          await updateDoc(targetRef, { outgoingRequests: arrayRemove(meUid) });
          alert("Declined.");
          location.reload();
        } catch (err) {
          console.error("Decline error", err);
          alert("Failed to decline.");
        }
      };
      profileActions.appendChild(acceptBtn);
      profileActions.appendChild(declineBtn);
    } else if (sentRequest) {
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel Request";
      cancelBtn.onclick = async () => {
        try {
          await updateDoc(meRef, { outgoingRequests: arrayRemove(viewUid) });
          await updateDoc(targetRef, { incomingRequests: arrayRemove(meUid) });
          alert("Request cancelled.");
          location.reload();
        } catch (err) {
          console.error("Cancel error", err);
          alert("Failed to cancel.");
        }
      };
      profileActions.appendChild(cancelBtn);
    } else {
      const addBtn = document.createElement("button");
      addBtn.textContent = "Add Friend";
      addBtn.onclick = async () => {
        try {
          await updateDoc(meRef, { outgoingRequests: arrayUnion(viewUid) });
          await updateDoc(targetRef, { incomingRequests: arrayUnion(meUid) });
          alert("Friend request sent.");
          location.reload();
        } catch (err) {
          console.error("Send request error", err);
          alert("Failed to send request.");
        }
      };
      profileActions.appendChild(addBtn);
    }
  }
});

// fallback avatar
function defaultAvatar() {
  return "https://www.gravatar.com/avatar/?d=mp&s=160";
}
