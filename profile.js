// profile.js - Bug-free version with proper error handling and structure
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

// Debug logging
function debugLog(message, data = null) {
  console.log(`[PROFILE DEBUG] ${message}`, data || '');
}

function debugError(message, error = null) {
  console.error(`[PROFILE ERROR] ${message}`, error || '');
}

// State management
const profileState = {
  currentUser: null,
  viewedUid: null,
  viewedProfileData: null,
  isLoading: false,
  unsubscribes: []
};

// Utility functions
function defaultAvatar() {
  return "https://www.gravatar.com/avatar/?d=mp&s=160";
}

function getQueryParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

function showMessage(message, isError = false, timeout = 5000) {
  const editMsg = document.getElementById('editMsg');
  if (!editMsg) return;
  
  editMsg.textContent = message;
  editMsg.style.display = 'block';
  editMsg.className = isError ? 'message error' : 'message success';
  
  if (!isError && timeout) {
    setTimeout(() => {
      editMsg.style.display = 'none';
      editMsg.textContent = '';
    }, timeout);
  }
}

function clearMessage() {
  const editMsg = document.getElementById('editMsg');
  if (editMsg) {
    editMsg.textContent = '';
    editMsg.style.display = 'none';
    editMsg.className = 'message';
  }
}

function setLoading(isLoading) {
  profileState.isLoading = isLoading;
  
  const loadingIndicator = document.getElementById("loadingIndicator");
  if (loadingIndicator) {
    loadingIndicator.style.display = isLoading ? 'block' : 'none';
  }
  
  // Disable/enable form elements
  const buttons = document.querySelectorAll('button');
  const inputs = document.querySelectorAll('input, textarea');
  
  buttons.forEach(btn => {
    btn.disabled = isLoading;
  });
  
  inputs.forEach(input => {
    input.disabled = isLoading;
  });
}

// Validation functions
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, message: "Username is required" };
  }
  
  const trimmed = username.trim();
  if (trimmed.length < 2) {
    return { valid: false, message: "Username must be at least 2 characters" };
  }
  if (trimmed.length > 30) {
    return { valid: false, message: "Username must be 30 characters or less" };
  }
  
  const validChars = /^[a-zA-Z0-9\s._-]+$/;
  if (!validChars.test(trimmed)) {
    return { valid: false, message: "Username can only contain letters, numbers, spaces, dots, underscores, and hyphens" };
  }
  
  return { valid: true };
}

function validateBio(bio) {
  if (!bio) return { valid: true };
  
  if (typeof bio !== 'string') {
    return { valid: false, message: "Bio must be text" };
  }
  
  if (bio.length > 500) {
    return { valid: false, message: "Bio must be 500 characters or less" };
  }
  
  return { valid: true };
}

// Firebase functions
async function ensureUserDocExists(user) {
  if (!user || !user.uid) {
    throw new Error("Invalid user object");
  }
  
  debugLog(`Ensuring user doc exists for ${user.uid}`);
  
  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      debugLog("Creating new user document");
      
      const defaultUsername = user.email ? user.email.split("@")[0] : "User";
      const userData = {
        username: defaultUsername,
        usernameLower: defaultUsername.toLowerCase(),
        bio: "",
        photoURL: user.photoURL || "",
        friends: [],
        email: user.email || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      await setDoc(userRef, userData);
      debugLog("User document created successfully");
    }
  } catch (error) {
    debugError("ensureUserDocExists failed:", error);
    throw new Error(`Failed to create user document: ${error.message}`);
  }
}

async function loadUserProfile(uid) {
  if (!uid) {
    throw new Error("No user ID provided");
  }
  
  debugLog(`Loading profile for user: ${uid}`);
  
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      debugError(`Profile not found for user: ${uid}`);
      return null;
    }
    
    const userData = userSnap.data();
    debugLog("Profile loaded successfully", userData);
    return userData;
  } catch (error) {
    debugError("loadUserProfile failed:", error);
    throw new Error(`Failed to load profile: ${error.message}`);
  }
}

// UI update functions
function updateProfileDisplay(userData, isOwnProfile = false) {
  // Update avatar
  const profileAvatar = document.getElementById('profileAvatar');
  if (profileAvatar) {
    profileAvatar.src = userData.photoURL || defaultAvatar();
    profileAvatar.onerror = function() {
      this.src = defaultAvatar();
    };
  }
  
  // Update username
  const profileUsername = document.getElementById('profileUsername');
  if (profileUsername) {
    profileUsername.textContent = userData.username || "Unknown User";
  }
  
  // Update email (only for own profile)
  const profileEmail = document.getElementById('profileEmail');
  if (profileEmail) {
    if (isOwnProfile) {
      profileEmail.textContent = userData.email || profileState.currentUser?.email || "";
    } else {
      profileEmail.textContent = "";
    }
  }
  
  // Update bio
  const profileBio = document.getElementById('profileBio');
  if (profileBio) {
    profileBio.textContent = userData.bio || "No bio provided.";
  }
  
  // Update topbar if viewing own profile
  if (isOwnProfile) {
    const topbarName = document.getElementById('meName');
    const topbarAvatar = document.getElementById('meAvatarSmall');
    
    if (topbarName) {
      topbarName.textContent = userData.username || "You";
    }
    
    if (topbarAvatar) {
      topbarAvatar.src = userData.photoURL || defaultAvatar();
      topbarAvatar.onerror = function() {
        this.src = defaultAvatar();
      };
    }
  }
}

function showEditArea(userData) {
  const editArea = document.getElementById('editArea');
  if (!editArea) return;
  
  editArea.style.display = 'block';
  
  // Populate form fields
  const editUsername = document.getElementById('editUsername');
  const editBio = document.getElementById('editBio');
  const editAvatarPreview = document.getElementById('editAvatarPreview');
  
  if (editUsername) editUsername.value = userData.username || "";
  if (editBio) editBio.value = userData.bio || "";
  
  if (editAvatarPreview) {
    editAvatarPreview.src = userData.photoURL || defaultAvatar();
    editAvatarPreview.onerror = function() {
      this.src = defaultAvatar();
    };
  }
  
  setupOwnerActions();
}

function hideEditArea() {
  const editArea = document.getElementById('editArea');
  if (editArea) {
    editArea.style.display = 'none';
  }
}

function setupOwnerActions() {
  const profileActions = document.getElementById('profile-actions');
  if (!profileActions) return;
  
  profileActions.innerHTML = `
    <div class="owner-info">
      <p class="info-text">This is your profile. Use the form below to update your information.</p>
    </div>
  `;
}

function showProfileNotFound() {
  debugLog("Showing profile not found state");
  
  updateProfileDisplay({
    username: "Profile Not Found",
    bio: "This user does not exist or their profile is not available.",
    photoURL: "",
    email: ""
  }, false);
  
  const profileActions = document.getElementById('profile-actions');
  if (profileActions) {
    profileActions.innerHTML = "";
  }
  
  hideEditArea();
}

// Friend request functions
async function checkPendingRequests(fromUid, toUid) {
  try {
    const requestsRef = collection(db, "friendRequests");
    
    // Check both directions
    const outgoingQuery = query(requestsRef, 
      where("fromUid", "==", fromUid), 
      where("toUid", "==", toUid), 
      where("status", "==", "pending")
    );
    
    const incomingQuery = query(requestsRef, 
      where("fromUid", "==", toUid), 
      where("toUid", "==", fromUid), 
      where("status", "==", "pending")
    );
    
    const [outgoingSnap, incomingSnap] = await Promise.all([
      getDocs(outgoingQuery),
      getDocs(incomingQuery)
    ]);
    
    if (!outgoingSnap.empty) {
      return { exists: true, direction: "outgoing", doc: outgoingSnap.docs[0] };
    }
    
    if (!incomingSnap.empty) {
      return { exists: true, direction: "incoming", doc: incomingSnap.docs[0] };
    }
    
    return { exists: false };
  } catch (error) {
    debugError("checkPendingRequests failed:", error);
    return { exists: false, error };
  }
}

async function sendFriendRequest(toUid) {
  if (!profileState.currentUser) {
    throw new Error("Not signed in");
  }
  
  const fromUid = profileState.currentUser.uid;
  
  // Check for existing requests
  const pendingCheck = await checkPendingRequests(fromUid, toUid);
  
  if (pendingCheck.exists) {
    const message = pendingCheck.direction === "outgoing" 
      ? "You already sent a friend request. Please wait for a response."
      : "This user has already sent you a request. Check your incoming requests.";
    throw new Error(message);
  }
  
  // Create friend request
  const requestData = {
    fromUid: fromUid,
    toUid: toUid,
    status: "pending",
    createdAt: serverTimestamp()
  };
  
  await addDoc(collection(db, "friendRequests"), requestData);
  debugLog(`Friend request sent from ${fromUid} to ${toUid}`);
}

async function removeFriend(friendUid) {
  if (!profileState.currentUser) {
    throw new Error("Not signed in");
  }
  
  const currentUid = profileState.currentUser.uid;
  
  // Remove from current user's friends
  const currentUserRef = doc(db, "users", currentUid);
  await updateDoc(currentUserRef, {
    friends: arrayRemove(friendUid),
    updatedAt: serverTimestamp()
  });
  
  // Try to remove from friend's list (best effort)
  try {
    const friendRef = doc(db, "users", friendUid);
    await updateDoc(friendRef, {
      friends: arrayRemove(currentUid),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    debugError("Could not update friend's list (this is expected with some permission setups):", error);
  }
  
  debugLog(`Removed friendship between ${currentUid} and ${friendUid}`);
}

async function setupVisitorActions(targetUid, userData) {
  const profileActions = document.getElementById('profile-actions');
  if (!profileActions || !profileState.currentUser || targetUid === profileState.currentUser.uid) {
    return;
  }
  
  profileActions.innerHTML = "";
  
  try {
    // Check if already friends
    const currentUserRef = doc(db, "users", profileState.currentUser.uid);
    const currentUserSnap = await getDoc(currentUserRef);
    const currentUserData = currentUserSnap.exists() ? currentUserSnap.data() : {};
    const friends = Array.isArray(currentUserData.friends) ? currentUserData.friends : [];
    const isFriend = friends.includes(targetUid);
    
    if (isFriend) {
      // Show unfriend button
      const unfriendBtn = document.createElement('button');
      unfriendBtn.textContent = 'Unfriend';
      unfriendBtn.className = 'btn-danger';
      
      unfriendBtn.addEventListener('click', async function() {
        if (confirm('Are you sure you want to unfriend this user?')) {
          try {
            await removeFriend(targetUid);
            showMessage('User removed from friends list', false);
            await renderProfile(targetUid);
          } catch (error) {
            debugError("Unfriend failed:", error);
            showMessage(`Failed to unfriend: ${error.message}`, true);
          }
        }
      });
      
      profileActions.appendChild(unfriendBtn);
    } else {
      // Show add friend button
      const addFriendBtn = document.createElement('button');
      addFriendBtn.textContent = 'Add Friend';
      addFriendBtn.className = 'btn-primary';
      
      addFriendBtn.addEventListener('click', async function() {
        try {
          await sendFriendRequest(targetUid);
          showMessage('Friend request sent!', false);
          await renderProfile(targetUid);
        } catch (error) {
          debugError("Send friend request failed:", error);
          showMessage(error.message, true);
        }
      });
      
      profileActions.appendChild(addFriendBtn);
    }
  } catch (error) {
    debugError("setupVisitorActions failed:", error);
    profileActions.innerHTML = '<p style="color: #e74c3c;">Failed to load profile actions</p>';
  }
}

// Main render function
async function renderProfile(uid) {
  if (!uid) {
    debugError("No UID provided to renderProfile");
    showProfileNotFound();
    return;
  }
  
  debugLog(`Rendering profile for: ${uid}`);
  setLoading(true);
  clearMessage();
  
  try {
    const userData = await loadUserProfile(uid);
    
    if (!userData) {
      showProfileNotFound();
      return;
    }
    
    profileState.viewedUid = uid;
    profileState.viewedProfileData = userData;
    
    const isOwnProfile = uid === profileState.currentUser?.uid;
    
    // Update UI
    updateProfileDisplay(userData, isOwnProfile);
    
    if (isOwnProfile) {
      showEditArea(userData);
    } else {
      hideEditArea();
      await setupVisitorActions(uid, userData);
    }
    
    debugLog("Profile render completed successfully");
    
  } catch (error) {
    debugError("renderProfile failed:", error);
    showMessage(`Failed to load profile: ${error.message}`, true);
    showProfileNotFound();
  } finally {
    setLoading(false);
  }
}

// Profile saving
async function saveProfile() {
  if (!profileState.currentUser) {
    showMessage("Not signed in", true);
    return;
  }
  
  const editUsername = document.getElementById('editUsername');
  const editBio = document.getElementById('editBio');
  const photoInput = document.getElementById('photoInput');
  
  const newUsername = editUsername?.value?.trim() || "";
  const newBio = editBio?.value?.trim() || "";
  
  clearMessage();
  
  // Validate inputs
  const usernameValidation = validateUsername(newUsername);
  if (!usernameValidation.valid) {
    showMessage(usernameValidation.message, true);
    if (editUsername) editUsername.focus();
    return;
  }
  
  const bioValidation = validateBio(newBio);
  if (!bioValidation.valid) {
    showMessage(bioValidation.message, true);
    if (editBio) editBio.focus();
    return;
  }
  
  setLoading(true);
  showMessage("Checking username availability...", false);
  
  try {
    // Check username uniqueness
    const usersRef = collection(db, "users");
    const usernameQuery = query(usersRef, where("usernameLower", "==", newUsername.toLowerCase()));
    const usernameSnap = await getDocs(usernameQuery);
    
    const isUsernameTaken = usernameSnap.docs.some(doc => doc.id !== profileState.currentUser.uid);
    if (isUsernameTaken) {
      showMessage("Username already taken. Please choose another.", true);
      if (editUsername) editUsername.focus();
      return;
    }
    
    // Handle photo upload
    let uploadedPhotoURL = null;
    if (photoInput?.files?.length > 0) {
      showMessage("Uploading photo...", false);
      
      const file = photoInput.files[0];
      
      // Validate file
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
        showMessage("Please select a valid image file (PNG, JPEG, WebP, or GIF)", true);
        return;
      }
      
      if (file.size > 5 * 1024 * 1024) {
        showMessage("Image must be smaller than 5MB", true);
        return;
      }
      
      try {
        uploadedPhotoURL = await uploadProfileImage(file, profileState.currentUser.uid);
        debugLog("Photo uploaded successfully:", uploadedPhotoURL);
      } catch (uploadError) {
        debugError("Photo upload failed:", uploadError);
        showMessage(`Photo upload failed: ${uploadError.message}`, true);
        return;
      }
    }
    
    // Save to Firestore
    showMessage("Saving profile...", false);
    
    const userRef = doc(db, "users", profileState.currentUser.uid);
    const updateData = {
      username: newUsername,
      usernameLower: newUsername.toLowerCase(),
      bio: newBio,
      updatedAt: serverTimestamp()
    };
    
    if (uploadedPhotoURL) {
      updateData.photoURL = uploadedPhotoURL;
    }
    
    await updateDoc(userRef, updateData);
    
    // Update Firebase Auth profile (best effort)
    try {
      const authUpdateData = { displayName: newUsername };
      if (uploadedPhotoURL) {
        authUpdateData.photoURL = uploadedPhotoURL;
      }
      await updateAuthProfile(profileState.currentUser, authUpdateData);
      debugLog("Auth profile updated successfully");
    } catch (authError) {
      debugError("Auth profile update failed (non-critical):", authError);
    }
    
    showMessage("Profile saved successfully!", false);
    
    // Clear file input
    if (photoInput) photoInput.value = "";
    
    // Re-render profile
    await renderProfile(profileState.currentUser.uid);
    
  } catch (error) {
    debugError("saveProfile failed:", error);
    showMessage(`Failed to save profile: ${error.message}`, true);
  } finally {
    setLoading(false);
  }
}

function cancelEdit() {
  if (!profileState.viewedProfileData) return;
  
  const editUsername = document.getElementById('editUsername');
  const editBio = document.getElementById('editBio');
  const editAvatarPreview = document.getElementById('editAvatarPreview');
  const photoInput = document.getElementById('photoInput');
  
  // Reset form to original values
  if (editUsername) editUsername.value = profileState.viewedProfileData.username || "";
  if (editBio) editBio.value = profileState.viewedProfileData.bio || "";
  if (editAvatarPreview) editAvatarPreview.src = profileState.viewedProfileData.photoURL || defaultAvatar();
  if (photoInput) photoInput.value = "";
  
  clearMessage();
  debugLog("Edit cancelled - form reset");
}

// Event listeners setup
function setupEventListeners() {
  debugLog("Setting up event listeners");
  
  // Photo input preview
  const photoInput = document.getElementById('photoInput');
  if (photoInput) {
    photoInput.addEventListener('change', function() {
      const file = this.files[0];
      if (!file) return;
      
      const editAvatarPreview = document.getElementById('editAvatarPreview');
      if (!editAvatarPreview) return;
      
      // Validate file type
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
        showMessage("Please select a valid image file (PNG, JPEG, WebP, or GIF)", true);
        this.value = '';
        return;
      }
      
      // Validate file size
      if (file.size > 5 * 1024 * 1024) {
        showMessage("Image must be smaller than 5MB", true);
        this.value = '';
        return;
      }
      
      // Show preview
      try {
        const objectURL = URL.createObjectURL(file);
        editAvatarPreview.src = objectURL;
        editAvatarPreview.onload = function() {
          URL.revokeObjectURL(objectURL);
        };
        clearMessage();
      } catch (error) {
        debugError("Photo preview failed:", error);
        showMessage("Failed to preview image", true);
      }
    });
  }
  
  // Save button
  const saveProfileBtn = document.getElementById('saveProfileBtn');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', function(e) {
      e.preventDefault();
      saveProfile();
    });
  }
  
  // Cancel button
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', function(e) {
      e.preventDefault();
      cancelEdit();
    });
  }
  
  // Username validation on blur
  const editUsername = document.getElementById('editUsername');
  if (editUsername) {
    editUsername.addEventListener('blur', function() {
      const validation = validateUsername(this.value);
      if (this.value && !validation.valid) {
        showMessage(validation.message, true, 0);
      }
    });
    
    editUsername.addEventListener('focus', function() {
      clearMessage();
    });
  }
  
  // Bio character counter
  const editBio = document.getElementById('editBio');
  const bioCounter = document.getElementById('bio-counter');
  if (editBio && bioCounter) {
    editBio.addEventListener('input', function() {
      const remaining = 500 - this.value.length;
      bioCounter.textContent = `${remaining} characters remaining`;
      bioCounter.className = remaining < 50 ? 'char-counter warning' : 'char-counter';
    });
  }
}

// Cleanup function
function cleanup() {
  debugLog("Cleaning up profile state and listeners");
  
  profileState.unsubscribes.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch (error) {
      debugError("Error during cleanup:", error);
    }
  });
  
  profileState.unsubscribes = [];
  profileState.currentUser = null;
  profileState.viewedUid = null;
  profileState.viewedProfileData = null;
}

// Auth state handler
function initAuth() {
  debugLog("Initializing auth listener");
  
  onAuthStateChanged(auth, async function(user) {
    debugLog("Auth state changed:", user ? { uid: user.uid, email: user.email } : "signed out");
    
    if (!user) {
      debugLog("No user - redirecting to auth page");
      cleanup();
      window.location.replace("auth.html");
      return;
    }
    
    try {
      profileState.currentUser = user;
      
      await ensureUserDocExists(user);
      
      const targetUid = getQueryParam("uid") || user.uid;
      debugLog(`Rendering profile for target UID: ${targetUid}`);
      
      await renderProfile(targetUid);
      
    } catch (error) {
      debugError("Auth initialization failed:", error);
      showMessage(`Initialization failed: ${error.message}`, true);
    }
  });
}

// DOM ready handler
document.addEventListener('DOMContentLoaded', function() {
  debugLog("Profile page DOM loaded");
  
  // Check required elements
  const requiredElements = ['profileAvatar', 'profileUsername', 'profile-actions'];
  const missingElements = requiredElements.filter(id => !document.getElementById(id));
  
  if (missingElements.length > 0) {
    debugError(`Missing required DOM elements: ${missingElements.join(', ')}`);
  }
  
  setupEventListeners();
  initAuth();
  
  debugLog("Profile page initialization complete");
});

// Cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Global error handlers
window.addEventListener('error', function(event) {
  debugError("Global error:", event.error);
});

window.addEventListener('unhandledrejection', function(event) {
  debugError("Unhandled promise rejection:", event.reason);
});

// Export functions for external use
export {
  renderProfile,
  saveProfile,
  cancelEdit,
  sendFriendRequest,
  removeFriend
};

export function getCurrentUser() {
  return profileState.currentUser;
}

debugLog("Profile.js module loaded successfully");