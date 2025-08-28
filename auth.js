// auth.js - Debug version with extensive logging
import { auth, db } from "./firebase.js";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  onAuthStateChanged,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { 
  doc, 
  setDoc, 
  getDoc,
  serverTimestamp,
  query,
  collection,
  where,
  getDocs,
  connectFirestoreEmulator
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
    
    // Test Firestore connection by reading a test document
    debugLog("Testing Firestore connection...");
    try {
      await getDoc(doc(db, "test", "connection"));
      debugLog("Firestore connection successful");
    } catch (firestoreError) {
      debugError("Firestore connection failed", firestoreError);
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

/* ===== Helpers ===== */
function showMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.style.color = isError ? "red" : "green";
  element.style.display = "block";
  debugLog(`UI Message: ${message} (Error: ${isError})`);
}

function clearMessage(element) {
  if (!element) return;
  element.textContent = "";
  element.style.display = "none";
}

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
    debugLog(`Username validation failed: too short (${username?.length})`);
    return false;
  }
  if (username.length > 30) {
    debugLog(`Username validation failed: too long (${username.length})`);
    return false;
  }
  const validChars = /^[a-zA-Z0-9\s._-]+$/;
  const isValid = validChars.test(username);
  debugLog(`Username validation for "${username}": ${isValid}`);
  return isValid;
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

/* ===== Auth State Listener ===== */
onAuthStateChanged(auth, (user) => {
  authInitialized = true;
  debugLog("Auth state changed", user ? { uid: user.uid, email: user.email } : "null");
  
  if (user) {
    debugLog("User already signed in, redirecting to index.html");
    setTimeout(() => {
      window.location.replace("index.html");
    }, 1000);
  }
});

/* ===== DOM Ready Handler ===== */
document.addEventListener("DOMContentLoaded", async () => {
  debugLog("DOM loaded, initializing auth page");

  // Test Firebase connection first
  const connectionOk = await testFirebaseConnection();
  if (!connectionOk) {
    debugError("Firebase connection failed - auth will not work");
  }

  // Get DOM elements
  const signupUsername = document.getElementById("signup-username");
  const signupEmail = document.getElementById("signup-email");
  const signupPass = document.getElementById("signup-pass");
  const signupBtn = document.getElementById("signup-btn");
  const signupMsg = document.getElementById("signup-msg");

  const signinEmail = document.getElementById("signin-email");
  const signinPass = document.getElementById("signin-pass");
  const signinBtn = document.getElementById("signin-btn");
  const signinMsg = document.getElementById("signin-msg");

  // Debug DOM elements
  debugLog("DOM elements found:", {
    signupUsername: !!signupUsername,
    signupEmail: !!signupEmail,
    signupPass: !!signupPass,
    signupBtn: !!signupBtn,
    signupMsg: !!signupMsg,
    signinEmail: !!signinEmail,
    signinPass: !!signinPass,
    signinBtn: !!signinBtn,
    signinMsg: !!signinMsg
  });

  if (!signupBtn || !signinBtn) {
    debugError("Required auth form elements not found in DOM");
    return;
  }

  /* ===== Sign Up Handler ===== */
  signupBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    debugLog("Sign up button clicked");
    
    const username = signupUsername?.value?.trim() || "";
    const email = signupEmail?.value?.trim() || "";
    const pass = signupPass?.value?.trim() || "";

    debugLog("Sign up attempt", { username, email, passwordLength: pass.length });

    clearMessage(signupMsg);

    if (!firebaseReady) {
      showMessage(signupMsg, "Firebase not ready. Please refresh the page.", true);
      return;
    }

    // Validation
    if (!validateUsername(username)) {
      showMessage(signupMsg, "Username must be 2-30 characters and contain only letters, numbers, spaces, dots, underscores, and hyphens.", true);
      return;
    }

    if (!validateEmail(email)) {
      showMessage(signupMsg, "Please enter a valid email address.", true);
      return;
    }

    if (!validatePassword(pass)) {
      showMessage(signupMsg, "Password must be at least 6 characters long.", true);
      return;
    }

    signupBtn.disabled = true;
    signupBtn.textContent = "Creating Account...";

    try {
      debugLog("Checking username availability...");
      const usernameTaken = await isUsernameTaken(username);
      if (usernameTaken) {
        showMessage(signupMsg, "Username is already taken. Please choose another.", true);
        return;
      }

      debugLog("Creating Firebase Auth account...");
      const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
      const user = userCredential.user;
      debugLog("Auth account created", { uid: user.uid });

      debugLog("Creating Firestore user document...");
      const userData = {
        username: username,
        usernameLower: username.toLowerCase(),
        bio: "",
        photoURL: "",
        friends: [],
        email: email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      await setDoc(doc(db, "users", user.uid), userData);
      debugLog("Firestore user document created");

      showMessage(signupMsg, "✅ Account created successfully! Redirecting...");
      
      if (signupUsername) signupUsername.value = "";
      if (signupEmail) signupEmail.value = "";
      if (signupPass) signupPass.value = "";

      setTimeout(() => {
        debugLog("Redirecting to index.html");
        window.location.href = "index.html";
      }, 1500);

    } catch (err) {
      debugError("Signup failed", err);
      
      let errorMessage = "Registration failed. ";
      switch (err.code) {
        case "auth/email-already-in-use":
          errorMessage += "This email is already registered.";
          break;
        case "auth/invalid-email":
          errorMessage += "Invalid email address.";
          break;
        case "auth/weak-password":
          errorMessage += "Password is too weak.";
          break;
        case "auth/network-request-failed":
          errorMessage += "Network error. Check your connection.";
          break;
        case "permission-denied":
          errorMessage += "Database permission denied. Check Firestore rules.";
          break;
        default:
          errorMessage += `${err.code}: ${err.message}`;
      }
      
      showMessage(signupMsg, "❌ " + errorMessage, true);
      if (signupPass) signupPass.value = "";
    } finally {
      signupBtn.disabled = false;
      signupBtn.textContent = "Sign Up";
    }
  });

  /* ===== Sign In Handler ===== */
  signinBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    debugLog("Sign in button clicked");
    
    const email = signinEmail?.value?.trim() || "";
    const pass = signinPass?.value?.trim() || "";

    debugLog("Sign in attempt", { email, passwordLength: pass.length });

    clearMessage(signinMsg);

    if (!firebaseReady) {
      showMessage(signinMsg, "Firebase not ready. Please refresh the page.", true);
      return;
    }

    if (!validateEmail(email)) {
      showMessage(signinMsg, "Please enter a valid email address.", true);
      return;
    }

    if (!pass) {
      showMessage(signinMsg, "Please enter your password.", true);
      return;
    }

    signinBtn.disabled = true;
    signinBtn.textContent = "Signing In...";

    try {
      debugLog("Attempting Firebase Auth sign in...");
      const userCredential = await signInWithEmailAndPassword(auth, email, pass);
      debugLog("Sign in successful", { uid: userCredential.user.uid });

      showMessage(signinMsg, "✅ Logged in successfully! Redirecting...");
      
      if (signinEmail) signinEmail.value = "";
      if (signinPass) signinPass.value = "";

      setTimeout(() => {
        debugLog("Redirecting to index.html");
        window.location.href = "index.html";
      }, 1000);

    } catch (err) {
      debugError("Sign in failed", err);
      
      let errorMessage = "Login failed. ";
      switch (err.code) {
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
        case "auth/invalid-login-credentials":
          errorMessage += "Invalid email or password.";
          break;
        case "auth/invalid-email":
          errorMessage += "Invalid email address.";
          break;
        case "auth/user-disabled":
          errorMessage += "This account has been disabled.";
          break;
        case "auth/too-many-requests":
          errorMessage += "Too many failed attempts. Try again later.";
          break;
        case "auth/network-request-failed":
          errorMessage += "Network error. Check your connection.";
          break;
        default:
          errorMessage += `${err.code}: ${err.message}`;
      }
      
      showMessage(signinMsg, "❌ " + errorMessage, true);
      if (signinPass) signinPass.value = "";
    } finally {
      signinBtn.disabled = false;
      signinBtn.textContent = "Sign In";
    }
  });

  /* ===== Enter key handlers ===== */
  [signupUsername, signupEmail, signupPass].forEach(input => {
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !signupBtn.disabled) {
        e.preventDefault();
        signupBtn.click();
      }
    });
  });

  [signinEmail, signinPass].forEach(input => {
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !signinBtn.disabled) {
        e.preventDefault();
        signinBtn.click();
      }
    });
  });

  debugLog("Auth handlers initialized successfully");
});

/* ===== Debug Panel (remove in production) ===== */
setTimeout(() => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    const debugPanel = document.createElement('div');
    debugPanel.innerHTML = `
      <div style="position: fixed; top: 10px; right: 10px; background: #333; color: white; padding: 10px; border-radius: 5px; font-size: 12px; z-index: 10000;">
        <div>Firebase Ready: ${firebaseReady}</div>
        <div>Auth: ${auth ? '✓' : '✗'}</div>
        <div>DB: ${db ? '✓' : '✗'}</div>
        <button onclick="console.clear()" style="margin-top: 5px; padding: 2px 5px;">Clear Console</button>
      </div>
    `;
    document.body.appendChild(debugPanel);
  }
}, 2000);