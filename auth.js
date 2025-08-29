// auth.js - Complete working version for responsive UI
import { auth, db } from "./firebase.js";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { 
  doc, 
  setDoc, 
  getDoc,
  serverTimestamp,
  query,
  collection,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ===== Debug Logging ===== */
function debugLog(message, data = null) {
  console.log(`[AUTH DEBUG] ${message}`, data || '');
}

function debugError(message, error = null) {
  console.error(`[AUTH ERROR] ${message}`, error || '');
}

/* ===== State ===== */
let authInitialized = false;
let firebaseReady = false;

/* ===== Test Firebase Connection ===== */
async function testFirebaseConnection() {
  debugLog("Testing Firebase connection...");
  
  try {
    if (!auth) {
      debugError("Auth is null - Firebase not initialized");
      return false;
    }
    if (!db) {
      debugError("Firestore is null - Firebase not initialized");
      return false;
    }
    
    debugLog("Firebase connection test passed");
    firebaseReady = true;
    return true;
    
  } catch (error) {
    debugError("Firebase connection test failed", error);
    return false;
  }
}

/* ===== Enhanced UI Helpers ===== */
function setButtonLoading(buttonId, loading) {
  const button = document.getElementById(buttonId);
  if (!button) {
    debugError(`Button ${buttonId} not found`);
    return;
  }
  
  debugLog(`Setting button ${buttonId} loading: ${loading}`);
  
  if (loading) {
    button.classList.add('loading');
    button.disabled = true;
  } else {
    button.classList.remove('loading');
    button.disabled = false;
  }
}

function showAuthMessage(elementId, message, isError = false) {
  debugLog(`Showing message on ${elementId}: ${message} (Error: ${isError})`);
  
  const element = document.getElementById(elementId);
  if (!element) {
    debugError(`Message element ${elementId} not found`);
    return;
  }
  
  element.textContent = message;
  element.className = 'message show ' + (isError ? 'error' : 'success');
  
  // Auto-hide success messages after 5 seconds
  if (!isError) {
    setTimeout(() => {
      element.classList.remove('show');
    }, 5000);
  }
}

function clearAuthMessage(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  element.classList.remove('show');
  setTimeout(() => {
    element.textContent = '';
  }, 300);
}

/* ===== Validation Helpers ===== */
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValid = emailRegex.test(email);
  debugLog(`Email validation for "${email}": ${isValid}`);
  return isValid;
}

function validatePassword(password) {
  const isValid = password && password.length >= 6;
  debugLog(`Password validation (length ${password?.length}): ${isValid}`);
  return isValid;
}

function validateUsername(username) {
  if (!username || username.length < 2) {
    return { valid: false, message: "Username must be at least 2 characters" };
  }
  if (username.length > 30) {
    return { valid: false, message: "Username must be less than 30 characters" };
  }
  
  const validChars = /^[a-zA-Z0-9\s._-]+$/;
  if (!validChars.test(username)) {
    return { valid: false, message: "Username can only contain letters, numbers, spaces, dots, underscores, and hyphens" };
  }
  
  return { valid: true };
}

/* ===== Check if username is already taken ===== */
async function isUsernameTaken(username) {
  debugLog(`Checking if username "${username}" is taken...`);
  try {
    const normalizedUsername = username.toLowerCase().trim();
    const q = query(
      collection(db, "users"),
      where("usernameLower", "==", normalizedUsername)
    );
    const snapshot = await getDocs(q);
    const taken = !snapshot.empty;
    debugLog(`Username "${username}" taken: ${taken}`);
    return taken;
  } catch (err) {
    debugError("Error checking username availability", err);
    return false;
  }
}

/* ===== Enhanced Error Handling ===== */
function getFirebaseErrorMessage(error) {
  switch (error.code) {
    case "auth/email-already-in-use":
      return "This email is already registered. Try signing in instead.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/weak-password":
      return "Password must be at least 6 characters long.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "Invalid email or password. Please check your credentials.";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact support.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please wait a few minutes before trying again.";
    case "auth/network-request-failed":
      return "Network error. Please check your internet connection and try again.";
    default:
      debugError("Firebase error:", error);
      return error.message || "An unexpected error occurred. Please try again.";
  }
}

/* ===== Auth State Listener ===== */
onAuthStateChanged(auth, (user) => {
  authInitialized = true;
  debugLog("Auth state changed", user ? { uid: user.uid, email: user.email } : "null");
  
  if (user) {
    debugLog("User already signed in, redirecting to index.html");
    showAuthMessage('signin-msg', '✅ Already signed in! Redirecting...', false);
    
    setTimeout(() => {
      window.location.replace("index.html");
    }, 1000);
  }
});

/* ===== DOM Ready Handler ===== */
document.addEventListener("DOMContentLoaded", async () => {
  debugLog("DOM loaded, initializing auth page");

  // Test Firebase connection
  const connectionOk = await testFirebaseConnection();
  if (!connectionOk) {
    debugError("Firebase connection failed - auth will not work");
    showAuthMessage('signin-msg', 'Firebase connection failed. Please refresh the page.', true);
    showAuthMessage('signup-msg', 'Firebase connection failed. Please refresh the page.', true);
    return;
  }

  // Get DOM elements
  const signupUsername = document.getElementById("signup-username");
  const signupEmail = document.getElementById("signup-email");
  const signupPass = document.getElementById("signup-pass");
  const signupBtn = document.getElementById("signup-btn");
  const signupForm = document.getElementById("signup-form");

  const signinEmail = document.getElementById("signin-email");
  const signinPass = document.getElementById("signin-pass");
  const signinBtn = document.getElementById("signin-btn");
  const signinForm = document.getElementById("signin-form");

  debugLog("DOM elements found:", {
    signupUsername: !!signupUsername,
    signupEmail: !!signupEmail,
    signupPass: !!signupPass,
    signupBtn: !!signupBtn,
    signupForm: !!signupForm,
    signinEmail: !!signinEmail,
    signinPass: !!signinPass,
    signinBtn: !!signinBtn,
    signinForm: !!signinForm
  });

  // Check if required elements exist
  if (!signupBtn || !signinBtn) {
    debugError("Required auth form elements not found in DOM");
    return;
  }

  /* ===== Sign Up Handler ===== */
  if (signupForm && signupBtn) {
    debugLog("Setting up signup form handler");
    
    // Handle form submission
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      debugLog("Signup form submitted");
      await handleSignup();
    });

    // Handle button click (backup)
    signupBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      debugLog("Signup button clicked");
      await handleSignup();
    });
  }

  /* ===== Sign In Handler ===== */
  if (signinForm && signinBtn) {
    debugLog("Setting up signin form handler");
    
    // Handle form submission
    signinForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      debugLog("Signin form submitted");
      await handleSignin();
    });

    // Handle button click (backup)
    signinBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      debugLog("Signin button clicked");
      await handleSignin();
    });
  }

  /* ===== Enter key handlers ===== */
  [signupUsername, signupEmail, signupPass].forEach(input => {
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSignup();
      }
    });
  });

  [signinEmail, signinPass].forEach(input => {
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSignin();
      }
    });
  });

  debugLog("Auth handlers initialized successfully");
});

/* ===== Sign Up Handler Function ===== */
async function handleSignup() {
  debugLog("handleSignup called");

  if (!firebaseReady) {
    showAuthMessage('signup-msg', 'Firebase not ready. Please refresh the page.', true);
    return;
  }

  const signupUsername = document.getElementById("signup-username");
  const signupEmail = document.getElementById("signup-email");
  const signupPass = document.getElementById("signup-pass");

  const username = signupUsername?.value?.trim() || "";
  const email = signupEmail?.value?.trim() || "";
  const pass = signupPass?.value?.trim() || "";

  debugLog("Signup attempt", { username, email, passwordLength: pass.length });

  // Clear previous messages
  clearAuthMessage('signup-msg');

  // Client-side validation
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    showAuthMessage('signup-msg', usernameValidation.message, true);
    signupUsername?.focus();
    return;
  }

  if (!validateEmail(email)) {
    showAuthMessage('signup-msg', "Please enter a valid email address.", true);
    signupEmail?.focus();
    return;
  }

  if (!validatePassword(pass)) {
    showAuthMessage('signup-msg', "Password must be at least 6 characters long.", true);
    signupPass?.focus();
    return;
  }

  // Set loading state
  setButtonLoading('signup-btn', true);

  try {
    debugLog("Checking username availability...");
    // Check if username is taken
    const usernameTaken = await isUsernameTaken(username);
    if (usernameTaken) {
      showAuthMessage('signup-msg', "Username is already taken. Please choose another.", true);
      signupUsername?.focus();
      return;
    }

    debugLog("Creating Firebase Auth account...");
    // Create Firebase Auth account
    const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
    const user = userCredential.user;
    debugLog("Auth account created", { uid: user.uid });

    debugLog("Creating Firestore user document...");
    // Create user document in Firestore
    await setDoc(doc(db, "users", user.uid), {
      username: username,
      usernameLower: username.toLowerCase(),
      bio: "",
      photoURL: "",
      friends: [],
      email: email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    debugLog("Firestore user document created");

    showAuthMessage('signup-msg', "✅ Account created successfully! Redirecting...", false);
    
    // Clear form
    if (signupUsername) signupUsername.value = "";
    if (signupEmail) signupEmail.value = "";
    if (signupPass) signupPass.value = "";

    // Redirect after delay
    setTimeout(() => {
      debugLog("Redirecting to index.html");
      window.location.href = "index.html";
    }, 2000);

  } catch (err) {
    debugError("Signup failed", err);
    const errorMessage = getFirebaseErrorMessage(err);
    showAuthMessage('signup-msg', errorMessage, true);
    
    // Clear password field on error
    if (signupPass) signupPass.value = "";
    
    // Focus appropriate field based on error
    if (err.code === 'auth/email-already-in-use' && signupEmail) {
      signupEmail.focus();
    } else if (err.code === 'auth/weak-password' && signupPass) {
      signupPass.focus();
    }
  } finally {
    setButtonLoading('signup-btn', false);
  }
}

/* ===== Sign In Handler Function ===== */
async function handleSignin() {
  debugLog("handleSignin called");

  if (!firebaseReady) {
    showAuthMessage('signin-msg', 'Firebase not ready. Please refresh the page.', true);
    return;
  }

  const signinEmail = document.getElementById("signin-email");
  const signinPass = document.getElementById("signin-pass");

  const email = signinEmail?.value?.trim() || "";
  const pass = signinPass?.value?.trim() || "";

  debugLog("Signin attempt", { email, passwordLength: pass.length });

  // Clear previous messages
  clearAuthMessage('signin-msg');

  // Client-side validation
  if (!validateEmail(email)) {
    showAuthMessage('signin-msg', "Please enter a valid email address.", true);
    signinEmail?.focus();
    return;
  }

  if (!pass) {
    showAuthMessage('signin-msg', "Please enter your password.", true);
    signinPass?.focus();
    return;
  }

  // Set loading state
  setButtonLoading('signin-btn', true);

  try {
    debugLog("Attempting Firebase Auth sign in...");
    const userCredential = await signInWithEmailAndPassword(auth, email, pass);
    debugLog("Sign in successful", { uid: userCredential.user.uid });

    showAuthMessage('signin-msg', "✅ Logged in successfully! Redirecting...", false);
    
    // Clear form
    if (signinEmail) signinEmail.value = "";
    if (signinPass) signinPass.value = "";

    // Redirect after delay
    setTimeout(() => {
      debugLog("Redirecting to index.html");
      window.location.href = "index.html";
    }, 1500);

  } catch (err) {
    debugError("Sign in failed", err);
    const errorMessage = getFirebaseErrorMessage(err);
    showAuthMessage('signin-msg', errorMessage, true);
    
    // Clear password field on error
    if (signinPass) signinPass.value = "";
    
    // Focus email field for most errors
    if (signinEmail) signinEmail.focus();
  } finally {
    setButtonLoading('signin-btn', false);
  }
}

debugLog("Enhanced auth.js loaded successfully");