// profile.js - Complete fixed version with proper error handling and friend sync
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
  initialized: false,
  friendsListener: null
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
  
  // Disable/enable interactive elements
  const buttons = document.querySelectorAll('button:not([data-always-enabled])');
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

// Load user profile from Firestore or create from auth data
async function loadUserProfile(uid) {
  if (!uid) {
    throw new Error("No user ID provided");
  }
  
  debugLog(`Loading profile for user: ${uid}`);
  
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const userData = userSnap.data();
      debugLog("Profile loaded from Firestore:", userData);
      return userData;
    } else {
      debugLog(`No Firestore profile found for ${uid}`);
      
      if (uid === profileState.currentUser?.uid) {
        // For current user, create basic profile from auth data
        const user = profileState.currentUser;
        const basicProfile = {
          username: user.displayName || (user.email ? user.email.split("@")[0] : "User"),
          usernameLower: (user.displayName || (user.email ? user.email.split("@")[0] : "User")).toLowerCase(),
          bio: "",
          photoURL: user.photoURL || "",
          email: user.email || "",
          friends: [],
          isBasicProfile: true
        };
        debugLog("Created basic profile from auth:", basicProfile);
        return basicProfile;
      } else {
        return null;
      }
    }
  } catch (error) {
    debugError("loadUserProfile failed:", error);
    
    if (error.code === 'permission-denied') {
      throw new Error(`Permission denied reading profile for user ${uid}`);
    }
    
    throw new Error(`Failed to load profile: ${error.message}`);
  }
}

// UI update functions
function updateProfileDisplay(userData, isOwnProfile = false) {
  // Update avatar
  const profileAvatar = document.getElementById('profileAvatar');
  if (profileAvatar) {
    const avatarUrl = userData.photoURL || defaultAvatar();
    profileAvatar.src = avatarUrl;
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
      profileEmail.style.display = "block";
    } else {
      profileEmail.textContent = "";
      profileEmail.style.display = "none";
    }
  }
  
  // Update bio
  const profileBio = document.getElementById('profileBio');
  if (profileBio) {
    profileBio.textContent = userData.bio || (isOwnProfile ? "Click edit to add a bio" : "No bio provided");
  }
  
  // Update topbar if viewing own profile
  if (isOwnProfile) {
    updateTopbar(userData);
  }
}

function updateTopbar(userData) {
  const topbarName = document.getElementById('meName');
  const topbarAvatar = document.getElementById('meAvatarSmall');
  
  if (topbarName) {
    topbarName.textContent = userData.username || "You";
  }
  
  if (topbarAvatar) {
    const avatarUrl = userData.photoURL || defaultAvatar();
    topbarAvatar.src = avatarUrl;
    topbarAvatar.onerror = function() {
      this.src = defaultAvatar();
    };
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
    const avatarUrl = userData.photoURL || defaultAvatar();
    editAvatarPreview.src = avatarUrl;
    editAvatarPreview.onerror = function() {
      this.src = defaultAvatar();
    };
  }
  
  setupOwnerActions(userData);
}

function hideEditArea() {
  const editArea = document.getElementById('editArea');
  if (editArea) {
    editArea.style.display = 'none';
  }
}

function setupOwnerActions(userData) {
  const profileActions = document.getElementById('profile-actions');
  if (!profileActions) return;
  
  let actionHtml = '';
  
  if (userData.isBasicProfile) {
    actionHtml = `
      <div class="owner-info">
        <p class="info-text">Welcome! Complete your profile by adding a username and bio below.</p>
      </div>
    `;
  } else {
    actionHtml = `
      <div class="owner-info">
        <p class="info-text">This is your profile. Use the form below to update your information.</p>
      </div>
    `;
  }
  
  profileActions.innerHTML = actionHtml;
}

function showProfileNotFound() {
  debugLog("Showing profile not found state");
  
  const profileUsername = document.getElementById('profileUsername');
  const profileBio = document.getElementById('profileBio');
  const profileAvatar = document.getElementById('profileAvatar');
  const profileEmail = document.getElementById('profileEmail');
  const profileActions = document.getElementById('profile-actions');
  
  if (profileUsername) profileUsername.textContent = "Profile Not Found";
  if (profileBio) profileBio.textContent = "This user does not exist or their profile is not available.";
  if (profileAvatar) profileAvatar.src = defaultAvatar();
  if (profileEmail) {
    profileEmail.textContent = "";
    profileEmail.style.display = "none";
  }
  if (profileActions) profileActions.innerHTML = "";
  
  hideEditArea();
}

// Friend management functions
async function checkPendingRequests(fromUid, toUid) {
  try {
    const requestsRef = collection(db, "friendRequests");
    
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
  
  debugLog(`Attempting to send friend request from ${fromUid} to ${toUid}`);
  
  try {
    const pendingCheck = await checkPendingRequests(fromUid, toUid);
    
    if (pendingCheck.exists) {
      const message = pendingCheck.direction === "outgoing" 
        ? "You already sent a friend request. Please wait for a response."
        : "This user has already sent you a request. Check your incoming requests.";
      throw new Error(message);
    }
    
    const requestData = {
      fromUid: fromUid,
      toUid: toUid,
      status: "pending",
      createdAt: serverTimestamp()
    };
    
    debugLog("Creating friend request with data:", requestData);
    
    await addDoc(collection(db, "friendRequests"), requestData);
    debugLog(`Friend request sent successfully from ${fromUid} to ${toUid}`);
    
  } catch (error) {
    debugError("sendFriendRequest failed:", error);
    
    if (error.code === 'permission-denied') {
      throw new Error("Unable to send friend request. Please check your account permissions or try again later.");
    } else if (error.code === 'invalid-argument') {
      throw new Error("Invalid request data. Please try again.");
    } else if (error.code === 'network-request-failed') {
      throw new Error("Network error. Please check your connection and try again.");
    } else if (error.message.includes("already sent") || error.message.includes("already received")) {
      throw error;
    } else {
      throw new Error(`Failed to send friend request: ${error.message}`);
    }
  }
}

// Enhanced unfriend function that triggers friends list update
async function removeFriend(friendUid) {
  if (!profileState.currentUser) {
    throw new Error("Not signed in");
  }
  
  const currentUid = profileState.currentUser.uid;
  
  try {
    debugLog(`Removing friendship between ${currentUid} and ${friendUid}`);
    
    // Remove from current user's friends list
    const currentUserRef = doc(db, "users", currentUid);
    await updateDoc(currentUserRef, {
      friends: arrayRemove(friendUid),
      updatedAt: serverTimestamp()
    });
    
    debugLog("Removed from current user's friends list");
    
    // Try to remove from friend's list (best effort)
    try {
      const friendRef = doc(db, "users", friendUid);
      await updateDoc(friendRef, {
        friends: arrayRemove(currentUid),
        updatedAt: serverTimestamp()
      });
      debugLog("Removed from friend's friends list");
    } catch (error) {
      debugError("Could not update friend's list (this might be expected due to permissions):", error);
    }
    
    // Notify index.html about the friend removal if it exists
    notifyFriendRemoval(friendUid);
    
    debugLog(`Successfully removed friendship between ${currentUid} and ${friendUid}`);
    
  } catch (error) {
    debugError("removeFriend failed:", error);
    throw new Error(`Failed to remove friend: ${error.message}`);
  }
}

// Function to notify index.html about friend removal
function notifyFriendRemoval(removedFriendUid) {
  try {
    // Check if we're in an environment where we can communicate with index.html
    if (typeof window !== 'undefined') {
      // Try to trigger a friends list refresh on index.html
      // This works if both pages are open and can communicate
      if (window.opener && !window.opener.closed) {
        // If this profile page was opened from index.html
        window.opener.postMessage({
          type: 'FRIEND_REMOVED',
          friendUid: removedFriendUid,
          timestamp: Date.now()
        }, window.location.origin);
        debugLog("Sent friend removal notification to parent window");
      }
      
      // Also store in localStorage for cross-tab communication
      try {
        const friendsUpdateEvent = {
          type: 'FRIEND_REMOVED',
          friendUid: removedFriendUid,
          timestamp: Date.now(),
          userId: profileState.currentUser?.uid
        };
        localStorage.setItem('friendsUpdate', JSON.stringify(friendsUpdateEvent));
        
        // Trigger storage event for other tabs
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'friendsUpdate',
          newValue: JSON.stringify(friendsUpdateEvent),
          storageArea: localStorage
        }));
        
        debugLog("Stored friend removal event in localStorage");
        
        // Clean up after a short delay
        setTimeout(() => {
          try {
            localStorage.removeItem('friendsUpdate');
          } catch (e) {
            // Ignore cleanup errors
          }
        }, 5000);
        
      } catch (storageError) {
        debugError("Could not use localStorage for friend update notification:", storageError);
      }
    }
  } catch (error) {
    debugError("Failed to notify about friend removal:", error);
    // Don't throw - this is not critical for the unfriend operation
  }
}

async function setupVisitorActions(targetUid, userData) {
  const profileActions = document.getElementById('profile-actions');
  if (!profileActions || !profileState.currentUser || targetUid === profileState.currentUser.uid) {
    return;
  }
  
  profileActions.innerHTML = "";
  
  try {
    let friends = [];
    try {
      const currentUserRef = doc(db, "users", profileState.currentUser.uid);
      const currentUserSnap = await getDoc(currentUserRef);
      const currentUserData = currentUserSnap.exists() ? currentUserSnap.data() : {};
      friends = Array.isArray(currentUserData.friends) ? currentUserData.friends : [];
    } catch (error) {
      debugError("Could not load current user's friends:", error);
    }
    
    const isFriend = friends.includes(targetUid);
    
    if (isFriend) {
      const unfriendBtn = document.createElement('button');
      unfriendBtn.textContent = 'Unfriend';
      unfriendBtn.className = 'btn-danger';
      
      unfriendBtn.addEventListener('click', async function() {
        if (confirm('Are you sure you want to unfriend this user?')) {
          try {
            setLoading(true);
            await removeFriend(targetUid);
            showMessage('User removed from friends list', false);
            await renderProfile(targetUid);
          } catch (error) {
            debugError("Unfriend failed:", error);
            showMessage(`Failed to unfriend: ${error.message}`, true);
          } finally {
            setLoading(false);
          }
        }
      });
      
      profileActions.appendChild(unfriendBtn);
    } else {
      const addFriendBtn = document.createElement('button');
      addFriendBtn.textContent = 'Add Friend';
      addFriendBtn.className = 'btn-primary';
      
      addFriendBtn.addEventListener('click', async function() {
        try {
          setLoading(true);
          await sendFriendRequest(targetUid);
          showMessage('Friend request sent!', false);
          await renderProfile(targetUid);
        } catch (error) {
          debugError("Send friend request failed:", error);
          showMessage(error.message, true);
        } finally {
          setLoading(false);
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

// Create or update profile in Firestore
async function createOrUpdateProfile(userData) {
  if (!profileState.currentUser) {
    throw new Error("Not signed in");
  }
  
  const userRef = doc(db, "users", profileState.currentUser.uid);
  
  try {
    const existingSnap = await getDoc(userRef);
    
    const dataToSave = {
      ...userData,
      updatedAt: serverTimestamp()
    };
    
    if (!existingSnap.exists()) {
      dataToSave.createdAt = serverTimestamp();
    }
    
    debugLog("Saving profile data:", dataToSave);
    await updateDoc(userRef, dataToSave);
    
  } catch (error) {
    if (error.code === 'not-found') {
      // Document doesn't exist, create it
      const dataToSave = {
        ...userData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      debugLog("Creating new profile:", dataToSave);
      await updateDoc(userRef, dataToSave);
    } else {
      throw error;
    }
  }
}

// Enhanced profile saving with improved error handling
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
  
  try {
    // Check username uniqueness (skip if unchanged)
    const currentUsername = profileState.viewedProfileData?.usernameLower;
    if (newUsername.toLowerCase() !== currentUsername) {
      showMessage("Checking username availability...", false);
      
      const usersRef = collection(db, "users");
      const usernameQuery = query(usersRef, where("usernameLower", "==", newUsername.toLowerCase()));
      const usernameSnap = await getDocs(usernameQuery);
      
      const isUsernameTaken = usernameSnap.docs.some(doc => doc.id !== profileState.currentUser.uid);
      if (isUsernameTaken) {
        showMessage("Username already taken. Please choose another.", true);
        if (editUsername) editUsername.focus();
        return;
      }
    }
    
    // Handle photo upload with improved error handling
    let uploadedPhotoURL = profileState.viewedProfileData?.photoURL || null;
    if (photoInput?.files?.length > 0) {
      showMessage("Uploading photo...", false);
      
      const file = photoInput.files[0];
      
      // Validate file
      const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
        showMessage("Please select a valid image file (PNG, JPEG, WebP, or GIF)", true);
        return;
      }
      
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        showMessage("Image must be smaller than 5MB", true);
        return;
      }
      
      try {
        debugLog("Starting photo upload...");
        
        if (typeof uploadProfileImage !== 'function') {
          throw new Error("Photo upload service not available. Check cloudinary.js configuration.");
        }
        
        uploadedPhotoURL = await uploadProfileImage(file, profileState.currentUser.uid);
        debugLog("Photo upload successful:", uploadedPhotoURL);
        showMessage("Photo uploaded successfully, saving profile...", false);
        
      } catch (uploadError) {
        debugError("Photo upload failed:", uploadError);
        
        let errorMessage = "Photo upload failed: ";
        
        if (uploadError.message.includes('fetch') || uploadError.name === 'TypeError') {
          errorMessage += "Network connection failed. Check your internet connection and try again.";
        } else if (uploadError.message.includes('cloudinary') || uploadError.message.includes('upload')) {
          errorMessage += "Upload service error. Please try again or contact support.";
        } else if (uploadError.message.includes('configured')) {
          errorMessage += "Upload service not configured properly.";
        } else {
          errorMessage += uploadError.message || "Unknown upload error occurred.";
        }
        
        showMessage(errorMessage, true);
        return;
      }
    }
    
    // Prepare profile data
    showMessage("Saving profile...", false);
    
    const profileData = {
      username: newUsername,
      usernameLower: newUsername.toLowerCase(),
      bio: newBio,
      photoURL: uploadedPhotoURL || "",
      email: profileState.currentUser.email || "",
      friends: profileState.viewedProfileData?.friends || []
    };
    
    debugLog("Saving profile data:", profileData);
    
    // Save to Firestore
    await createOrUpdateProfile(profileData);
    
    // Update Firebase Auth profile
    try {
      const authUpdateData = { displayName: newUsername };
      if (uploadedPhotoURL) {
        authUpdateData.photoURL = uploadedPhotoURL;
      }
      await updateAuthProfile(profileState.currentUser, authUpdateData);
      debugLog("Firebase Auth profile updated successfully");
    } catch (authError) {
      debugError("Firebase Auth profile update failed (non-critical):", authError);
    }
    
    showMessage("Profile saved successfully!", false);
    
    // Clear file input
    if (photoInput) photoInput.value = "";
    
    // Re-render profile to show updated data
    await renderProfile(profileState.currentUser.uid);
    
    debugLog("Profile save operation completed");
    
  } catch (error) {
    debugError("saveProfile failed:", error);
    
    let errorMessage = "Failed to save profile: ";
    if (error.code === 'permission-denied') {
      errorMessage += "Permission denied. Check your Firestore security rules.";
    } else if (error.code === 'network-request-failed') {
      errorMessage += "Network error. Please check your connection and try again.";
    } else {
      errorMessage += error.message;
    }
    
    showMessage(errorMessage, true);
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
  if (editAvatarPreview) {
    const avatarUrl = profileState.viewedProfileData.photoURL || defaultAvatar();
    editAvatarPreview.src = avatarUrl;
  }
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
      const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
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
  
  // Username validation
  const editUsername = document.getElementById('editUsername');
  if (editUsername) {
    editUsername.addEventListener('blur', function() {
      if (this.value) {
        const validation = validateUsername(this.value);
        if (!validation.valid) {
          showMessage(validation.message, true, 0);
        }
      }
    });
    
    editUsername.addEventListener('focus', clearMessage);
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
  
  // Listen for friend removal notifications from other tabs/windows
  window.addEventListener('storage', function(e) {
    if (e.key === 'friendsUpdate' && e.newValue) {
      try {
        const updateEvent = JSON.parse(e.newValue);
        if (updateEvent.type === 'FRIEND_REMOVED' && 
            updateEvent.userId === profileState.currentUser?.uid) {
          debugLog("Received friend removal notification from another tab");
          // Refresh the current profile if we're viewing the removed friend
          if (profileState.viewedUid === updateEvent.friendUid) {
            renderProfile(profileState.viewedUid);
          }
        }
      } catch (error) {
        debugError("Error processing friends update event:", error);
      }
    }
  });
  
  // Listen for messages from parent window (if opened from index.html)
  window.addEventListener('message', function(event) {
    if (event.origin !== window.location.origin) return;
    
    if (event.data.type === 'REFRESH_PROFILE' && profileState.viewedUid) {
      debugLog("Received profile refresh request from parent window");
      renderProfile(profileState.viewedUid);
    }
  });
}

// Cleanup function
function cleanup() {
  debugLog("Cleaning up profile state and listeners");
  
  if (profileState.friendsListener) {
    try {
      profileState.friendsListener();
      profileState.friendsListener = null;
    } catch (error) {
      debugError("Error during cleanup:", error);
    }
  }
  
  profileState.currentUser = null;
  profileState.viewedUid = null;
  profileState.viewedProfileData = null;
  profileState.initialized = false;
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
    
    profileState.currentUser = user;
    profileState.initialized = true;
    
    const targetUid = getQueryParam("uid") || user.uid;
    debugLog(`Rendering profile for target UID: ${targetUid}`);
    
    await renderProfile(targetUid);
  });
}

// DOM ready handler
document.addEventListener('DOMContentLoaded', function() {
  debugLog("Profile page DOM loaded");
  
  // Check if Cloudinary module is available
  if (typeof uploadProfileImage === 'undefined') {
    debugError("uploadProfileImage function not found - check cloudinary.js import");
    showMessage("Photo upload functionality not available", true);
  } else {
    debugLog("Cloudinary upload function is available");
  }
  
  setupEventListeners();
  initAuth();
  
  debugLog("Profile page initialization complete");
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
  cleanup();
});

// Global error handlers
window.addEventListener('error', function(event) {
  debugError("Global error:", event.error);
});

window.addEventListener('unhandledrejection', function(event) {
  debugError("Unhandled promise rejection:", event.reason);
  event.preventDefault(); // Prevent the error from showing in console
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