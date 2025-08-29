// profile.js — Enhanced and fixed version with better error handling and architecture
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
  arrayUnion,
  arrayRemove,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { 
  onAuthStateChanged, 
  updateProfile as updateAuthProfile 
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ===== Debug Logging ===== */
function debugLog(message, data = null) {
  console.log(`[PROFILE DEBUG] ${message}`, data || '');
}

function debugError(message, error = null) {
  console.error(`[PROFILE ERROR] ${message}`, error || '');
}

/* ===== DOM Elements ===== */
const DOM = {
  profileAvatar: document.getElementById("profileAvatar"),
  profileUsername: document.getElementById("profileUsername"),
  profileEmail: document.getElementById("profileEmail"),
  profileBio: document.getElementById("profileBio"),
  profileActions: document.getElementById("profile-actions"),
  
  editArea: document.getElementById("editArea"),
  editAvatarPreview: document.getElementById("editAvatarPreview"),
  editUsername: document.getElementById("editUsername"),
  editBio: document.getElementById("editBio"),
  photoInput: document.getElementById("photoInput"),
  saveProfileBtn: document.getElementById("saveProfileBtn"),
  cancelEditBtn: document.getElementById("cancelEditBtn"),
  editMsg: document.getElementById("editMsg"),
  
  // Topbar elements
  topbarName: document.getElementById("meName"),
  topbarAvatar: document.getElementById("meAvatarSmall"),
  
  // Loading indicator
  loadingIndicator: document.getElementById("loadingIndicator")
};

/* ===== State Management ===== */
const state = {
  currentUser: null,
  viewedUid: null,
  viewedProfileData: null,
  isEditing: false,
  unsubscribes: []
};

/* ===== Utility Functions ===== */
function defaultAvatar() {
  return "https://www.gravatar.com/avatar/?d=mp&s=160";
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function showMessage(element, message, isError = false, timeout = 5000) {
  if (!element) return;
  
  element.textContent = message;
  element.className = `message ${isError ? 'error' : 'success'}`;
  element.style.display = 'block';
  
  if (!isError && timeout) {
    setTimeout(() => {
      element.style.display = 'none';
      element.textContent = '';
    }, timeout);
  }
}

function clearMessage(element) {
  if (!element) return;
  element.textContent = '';
  element.style.display = 'none';
}

function setLoading(isLoading) {
  if (DOM.loadingIndicator) {
    DOM.loadingIndicator.style.display = isLoading ? 'block' : 'none';
  }
  
  // Disable form elements during loading
  const buttons = document.querySelectorAll('button');
  const inputs = document.querySelectorAll('input, textarea');
  
  buttons.forEach(btn => btn.disabled = isLoading);
  inputs.forEach(input => input.disabled = isLoading);
}

function validateUsername(username) {
  if (!username || username.trim().length < 2) {
    return { valid: false, message: "Username must be at least 2 characters" };
  }
  if (username.length > 30) {
    return { valid: false, message: "Username must be 30 characters or less" };
  }
  const validChars = /^[a-zA-Z0-9\s._-]+$/;
  if (!validChars.test(username)) {
    return { valid: false, message: "Username can only contain letters, numbers, spaces, dots, underscores, and hyphens" };
  }
  return { valid: true };
}

function validateBio(bio) {
  if (bio && bio.length > 500) {
    return { valid: false, message: "Bio must be 500 characters or less" };
  }
  return { valid: true };
}

/* ===== Core Functions ===== */
async function ensureUserDocExists(user) {
  if (!user) throw new Error("No user provided");
  
  debugLog(`Ensuring user doc exists for ${user.uid}`);
  
  const ref = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      debugLog("Creating new user document");
      const usernameDefault = user.email ? user.email.split("@")[0] : "User";
      await setDoc(ref, {
        username: usernameDefault,
        usernameLower: usernameDefault.toLowerCase(),
        bio: "",
        photoURL: user.photoURL || "",
        friends: [],
        email: user.email || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  } catch (err) {
    debugError("ensureUserDocExists error:", err);
    throw new Error(`Failed to ensure user document: ${err.message}`);
  }
}

async function loadProfile(uid) {
  if (!uid) throw new Error("No uid provided to loadProfile");
  
  debugLog(`Loading profile for ${uid}`);
  setLoading(true);
  
  try {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      debugError(`Profile not found for uid: ${uid}`);
      return null;
    }

    const data = snap.data();
    debugLog("Profile loaded successfully", data);
    return data;
  } catch (err) {
    debugError("loadProfile error:", err);
    throw new Error(`Failed to load profile: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

async function renderProfile(uid) {
  try {
    debugLog(`Rendering profile for ${uid}`);
    
    const data = await loadProfile(uid);
    if (!data) {
      renderProfileNotFound();
      return;
    }

    state.viewedUid = uid;
    state.viewedProfileData = data;

    // Update profile display
    updateProfileDisplay(data);
    
    // Update topbar if viewing own profile
    if (uid === state.currentUser?.uid) {
      updateTopbar(data);
      showEditArea(data);
    } else {
      hideEditArea();
      await setupVisitorActions(uid, data);
    }
    
    debugLog("Profile render complete");
  } catch (err) {
    debugError("renderProfile error:", err);
    showMessage(DOM.editMsg, `Failed to load profile: ${err.message}`, true);
  }
}

function renderProfileNotFound() {
  debugLog("Rendering profile not found state");
  
  if (DOM.profileUsername) DOM.profileUsername.textContent = "Profile not found";
  if (DOM.profileBio) DOM.profileBio.textContent = "This user does not exist or their profile is not available.";
  if (DOM.profileAvatar) DOM.profileAvatar.src = defaultAvatar();
  if (DOM.profileEmail) DOM.profileEmail.textContent = "";
  if (DOM.profileActions) DOM.profileActions.innerHTML = "";
  if (DOM.editArea) DOM.editArea.style.display = "none";
}

function updateProfileDisplay(data) {
  if (DOM.profileAvatar) {
    DOM.profileAvatar.src = data.photoURL || defaultAvatar();
    DOM.profileAvatar.onerror = () => {
      DOM.profileAvatar.src = defaultAvatar();
    };
  }
  
  if (DOM.profileUsername) DOM.profileUsername.textContent = data.username || "Unknown User";
  if (DOM.profileBio) DOM.profileBio.textContent = data.bio || "No bio provided.";
  
  // Only show email for own profile
  if (DOM.profileEmail) {
    DOM.profileEmail.textContent = (state.viewedUid === state.currentUser?.uid) 
      ? (data.email || state.currentUser?.email || "") 
      : "";
  }
}

function updateTopbar(data) {
  if (DOM.topbarName) DOM.topbarName.textContent = data.username || "You";
  if (DOM.topbarAvatar) {
    DOM.topbarAvatar.src = data.photoURL || defaultAvatar();
    DOM.topbarAvatar.onerror = () => {
      DOM.topbarAvatar.src = defaultAvatar();
    };
  }
}

function showEditArea(data) {
  if (!DOM.editArea) return;
  
  DOM.editArea.style.display = "block";
  if (DOM.editUsername) DOM.editUsername.value = data.username || "";
  if (DOM.editBio) DOM.editBio.value = data.bio || "";
  if (DOM.editAvatarPreview) {
    DOM.editAvatarPreview.src = data.photoURL || defaultAvatar();
    DOM.editAvatarPreview.onerror = () => {
      DOM.editAvatarPreview.src = defaultAvatar();
    };
  }
  setupOwnerActions();
}

function hideEditArea() {
  if (DOM.editArea) DOM.editArea.style.display = "none";
}

function setupOwnerActions() {
  if (!DOM.profileActions) return;
  
  DOM.profileActions.innerHTML = `
    <div class="owner-info">
      <p class="info-text">This is your profile. Use the form below to update your information.</p>
    </div>
  `;
}

/* ===== Photo Upload Handler ===== */
function setupPhotoPreview() {
  if (!DOM.photoInput) return;
  
  DOM.photoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file type
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      showMessage(DOM.editMsg, "Please select a valid image file (PNG, JPEG, WebP, or GIF)", true);
      e.target.value = '';
      return;
    }
    
    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      showMessage(DOM.editMsg, "Image file must be smaller than 5MB", true);
      e.target.value = '';
      return;
    }
    
    try {
      const url = URL.createObjectURL(file);
      if (DOM.editAvatarPreview) {
        DOM.editAvatarPreview.src = url;
        DOM.editAvatarPreview.onerror = () => {
          DOM.editAvatarPreview.src = defaultAvatar();
          showMessage(DOM.editMsg, "Failed to preview image", true);
        };
      }
      clearMessage(DOM.editMsg);
    } catch (err) {
      debugError("Photo preview failed:", err);
      showMessage(DOM.editMsg, "Failed to preview image", true);
    }
  });
}

/* ===== Profile Save Handler ===== */
async function saveProfile() {
  if (!state.currentUser) {
    showMessage(DOM.editMsg, "Not signed in", true);
    return;
  }

  const newUsername = DOM.editUsername?.value?.trim() || "";
  const newBio = DOM.editBio?.value?.trim() || "";

  clearMessage(DOM.editMsg);

  // Validate input
  const usernameValidation = validateUsername(newUsername);
  if (!usernameValidation.valid) {
    showMessage(DOM.editMsg, usernameValidation.message, true);
    DOM.editUsername?.focus();
    return;
  }

  const bioValidation = validateBio(newBio);
  if (!bioValidation.valid) {
    showMessage(DOM.editMsg, bioValidation.message, true);
    DOM.editBio?.focus();
    return;
  }

  setLoading(true);
  showMessage(DOM.editMsg, "Checking username availability...", false);

  try {
    // Check username uniqueness
    const usersCol = collection(db, "users");
    const unameQuery = query(usersCol, where("usernameLower", "==", newUsername.toLowerCase()));
    const unameSnap = await getDocs(unameQuery);
    const conflict = unameSnap.docs.some(d => d.id !== state.currentUser.uid);
    
    if (conflict) {
      showMessage(DOM.editMsg, "Username already taken. Please choose another.", true);
      DOM.editUsername?.focus();
      return;
    }

    // Handle photo upload if present
    let uploadedUrl = null;
    if (DOM.photoInput?.files?.length > 0) {
      showMessage(DOM.editMsg, "Uploading photo...", false);
      
      const file = DOM.photoInput.files[0];
      try {
        uploadedUrl = await uploadProfileImage(file, state.currentUser.uid);
        debugLog("Photo uploaded successfully", uploadedUrl);
      } catch (uploadErr) {
        debugError("Photo upload failed:", uploadErr);
        showMessage(DOM.editMsg, `Photo upload failed: ${uploadErr.message}`, true);
        return;
      }
    }

    // Save to Firestore
    showMessage(DOM.editMsg, "Saving profile...", false);
    
    const userRef = doc(db, "users", state.currentUser.uid);
    const updatePayload = {
      username: newUsername,
      usernameLower: newUsername.toLowerCase(),
      bio: newBio,
      updatedAt: serverTimestamp()
    };
    
    if (uploadedUrl) {
      updatePayload.photoURL = uploadedUrl;
    }

    await updateDoc(userRef, updatePayload);

    // Update Firebase Auth profile (best effort)
    try {
      const authUpdatePayload = { displayName: newUsername };
      if (uploadedUrl) authUpdatePayload.photoURL = uploadedUrl;
      
      await updateAuthProfile(state.currentUser, authUpdatePayload);
      debugLog("Auth profile updated successfully");
    } catch (authErr) {
      debugError("Failed to update Auth profile:", authErr);
      // Don't fail the entire save for this
    }

    showMessage(DOM.editMsg, "Profile saved successfully!", false);
    
    // Clear file input
    if (DOM.photoInput) DOM.photoInput.value = "";
    
    // Re-render profile
    await renderProfile(state.currentUser.uid);
    
    debugLog("Profile save complete");

  } catch (err) {
    debugError("Save profile failed:", err);
    showMessage(DOM.editMsg, `Failed to save profile: ${err.message}`, true);
  } finally {
    setLoading(false);
  }
}

/* ===== Cancel Edit Handler ===== */
function cancelEdit() {
  if (!state.viewedProfileData) return;
  
  // Reset form to original values
  if (DOM.editUsername) DOM.editUsername.value = state.viewedProfileData.username || "";
  if (DOM.editBio) DOM.editBio.value = state.viewedProfileData.bio || "";
  if (DOM.editAvatarPreview) DOM.editAvatarPreview.src = state.viewedProfileData.photoURL || defaultAvatar();
  if (DOM.photoInput) DOM.photoInput.value = "";
  
  clearMessage(DOM.editMsg);
  debugLog("Edit cancelled");
}

/* ===== Friend Request Management ===== */
async function hasPendingRequestBetween(aUid, bUid) {
  try {
    const colRef = collection(db, "friendRequests");
    const queries = [
      query(colRef, where("fromUid", "==", aUid), where("toUid", "==", bUid), where("status", "==", "pending")),
      query(colRef, where("fromUid", "==", bUid), where("toUid", "==", aUid), where("status", "==", "pending"))
    ];
    
    const [snap1, snap2] = await Promise.all(queries.map(q => getDocs(q)));
    
    if (!snap1.empty) return { exists: true, doc: snap1.docs[0], direction: "outgoing" };
    if (!snap2.empty) return { exists: true, doc: snap2.docs[0], direction: "incoming" };
    
    return { exists: false };
  } catch (err) {
    debugError("hasPendingRequestBetween error:", err);
    return { exists: false, error: err };
  }
}

async function sendFriendRequest(uid) {
  if (!state.currentUser) {
    throw new Error("Not signed in");
  }
  
  // Check for existing requests
  const pending = await hasPendingRequestBetween(state.currentUser.uid, uid);
  if (pending.exists) {
    const message = pending.direction === "outgoing" 
      ? "You already sent a friend request. Please wait for a response."
      : "This user has already sent you a request. Check your incoming requests.";
    throw new Error(message);
  }

  // Send request
  await addDoc(collection(db, "friendRequests"), {
    fromUid: state.currentUser.uid,
    toUid: uid,
    status: "pending",
    createdAt: serverTimestamp()
  });
  
  debugLog(`Friend request sent to ${uid}`);
}

async function unfriendUser(uid) {
  if (!state.currentUser) {
    throw new Error("Not signed in");
  }
  
  // Remove from current user's friends list
  const myRef = doc(db, "users", state.currentUser.uid);
  await updateDoc(myRef, {
    friends: arrayRemove(uid),
    updatedAt: serverTimestamp()
  });
  
  // Try to remove from their friends list (best effort)
  try {
    const theirRef = doc(db, "users", uid);
    await updateDoc(theirRef, {
      friends: arrayRemove(state.currentUser.uid),
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    debugError("Could not remove from other user's friends list:", err);
    // This might fail due to permissions, but that's ok
  }
  
  debugLog(`Unfriended user ${uid}`);
}

/* ===== Visitor Actions Setup ===== */
async function setupVisitorActions(uid, profileData) {
  if (!DOM.profileActions || !state.currentUser || uid === state.currentUser.uid) {
    return;
  }

  DOM.profileActions.innerHTML = "";
  
  try {
    // Check current friendship status
    const myRef = doc(db, "users", state.currentUser.uid);
    const mySnap = await getDoc(myRef);
    const myData = mySnap.exists() ? mySnap.data() : {};
    const friendsArr = Array.isArray(myData.friends) ? myData.friends : [];
    const isFriend = friendsArr.includes(uid);

    if (isFriend) {
      // Show unfriend button
      const unfriendBtn = document.createElement("button");
      unfriendBtn.textContent = "Unfriend";
      unfriendBtn.className = "btn-secondary";
      unfriendBtn.onclick = async () => {
        if (confirm("Are you sure you want to unfriend this user?")) {
          try {
            await unfriendUser(uid);
            showMessage(DOM.editMsg, "User removed from friends list", false);
            await renderProfile(uid);
          } catch (err) {
            debugError("Unfriend failed:", err);
            showMessage(DOM.editMsg, `Failed to unfriend: ${err.message}`, true);
          }
        }
      };
      DOM.profileActions.appendChild(unfriendBtn);
    } else {
      // Show add friend button
      const addBtn = document.createElement("button");
      addBtn.textContent = "Add Friend";
      addBtn.className = "btn-primary";
      addBtn.onclick = async () => {
        try {
          await sendFriendRequest(uid);
          showMessage(DOM.editMsg, "Friend request sent!", false);
          await renderProfile(uid);
        } catch (err) {
          debugError("Send friend request failed:", err);
          showMessage(DOM.editMsg, err.message, true);
        }
      };
      DOM.profileActions.appendChild(addBtn);
    }
  } catch (err) {
    debugError("setupVisitorActions error:", err);
    DOM.profileActions.innerHTML = `<p class="error">Failed to load user actions</p>`;
  }
}

/* ===== Event Listeners Setup ===== */
function setupEventListeners() {
  debugLog("Setting up event listeners");
  
  // Photo preview
  setupPhotoPreview();
  
  // Save button
  if (DOM.saveProfileBtn) {
    DOM.saveProfileBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await saveProfile();
    });
  }
  
  // Cancel button
  if (DOM.cancelEditBtn) {
    DOM.cancelEditBtn.addEventListener("click", (e) => {
      e.preventDefault();
      cancelEdit();
    });
  }
  
  // Form validation on input
  if (DOM.editUsername) {
    DOM.editUsername.addEventListener("blur", () => {
      const validation = validateUsername(DOM.editUsername.value);
      if (!validation.valid) {
        showMessage(DOM.editMsg, validation.message, true, 0);
      } else {
        clearMessage(DOM.editMsg);
      }
    });
  }
  
  if (DOM.editBio) {
    DOM.editBio.addEventListener("input", () => {
      const remaining = 500 - DOM.editBio.value.length;
      const counter = document.getElementById("bioCounter");
      if (counter) {
        counter.textContent = `${remaining} characters remaining`;
        counter.style.color = remaining < 50 ? "#e74c3c" : "#666";
      }
    });
  }
}

/* ===== Cleanup Function ===== */
function cleanup() {
  debugLog("Cleaning up listeners and state");
  
  state.unsubscribes.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch (err) {
      debugError("Error during cleanup:", err);
    }
  });
  
  state.unsubscribes = [];
  state.currentUser = null;
  state.viewedUid = null;
  state.viewedProfileData = null;
}

/* ===== Auth State Management ===== */
function initAuthListener() {
  debugLog("Initializing auth listener");
  
  onAuthStateChanged(auth, async (user) => {
    debugLog("Auth state changed", user ? { uid: user.uid, email: user.email } : "null");
    
    if (!user) {
      debugLog("No user, redirecting to auth page");
      cleanup();
      window.location.replace("auth.html");
      return;
    }

    try {
      state.currentUser = user;
      const profileUid = getQueryParam("uid");
      const targetUid = profileUid || user.uid;
      
      debugLog(`Initializing profile page for user ${targetUid}`);
      
      await ensureUserDocExists(user);
      await renderProfile(targetUid);
      
      debugLog("Profile initialization complete");
    } catch (err) {
      debugError("Auth initialization error:", err);
      showMessage(DOM.editMsg, `Failed to initialize profile: ${err.message}`, true);
    }
  });
}

/* ===== Initialization ===== */
document.addEventListener("DOMContentLoaded", () => {
  debugLog("Profile page DOM loaded");
  
  // Check if required elements exist
  const requiredElements = ['profileAvatar', 'profileUsername'];
  const missing = requiredElements.filter(id => !document.getElementById(id));
  
  if (missing.length > 0) {
    debugError(`Missing required DOM elements: ${missing.join(', ')}`);
  }
  
  setupEventListeners();
  initAuthListener();
  
  debugLog("Profile page initialization complete");
});

/* ===== Cleanup on page unload ===== */
window.addEventListener("beforeunload", cleanup);

/* ===== Export functions for external use ===== */
export {
  initAuthListener,
  renderProfile,
  ensureUserDocExists,
  sendFriendRequest,
  unfriendUser,
  getCurrentUser: () => state.currentUser
};

debugLog("Profile.js module loaded successfully");