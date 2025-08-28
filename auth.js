// auth.js - Fixed authentication handling with proper error handling and validation
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

/* ===== State ===== */
let authInitialized = false;

/* ===== Helpers ===== */
function showMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.style.color = isError ? "red" : "green";
  element.style.display = "block";
}

function clearMessage(element) {
  if (!element) return;
  element.textContent = "";
  element.style.display = "none";
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePassword(password) {
  return password && password.length >= 6;
}

function validateUsername(username) {
  if (!username || username.length < 2) return false;
  if (username.length > 30) return false;
  // Allow letters, numbers, spaces, and basic punctuation
  const validChars = /^[a-zA-Z0-9\s._-]+$/;
  return validChars.test(username);
}

/* ===== Check if username is already taken ===== */
async function isUsernameTaken(username) {
  try {
    const normalizedUsername = username.toLowerCase().trim();
    const q = query(
      collection(db, "users"),
      where("usernameLower", "==", normalizedUsername)
    );
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch (err) {
    console.error("Error checking username availability:", err);
    // If we can't check, assume it's available to not block registration
    return false;
  }
}

/* ===== Check if user is already signed in and redirect ===== */
onAuthStateChanged(auth, (user) => {
  authInitialized = true;
  if (user) {
    console.log("User already signed in, redirecting to index.html");
    window.location.replace("index.html");
  }
});

/* ===== DOM Ready Handler ===== */
document.addEventListener("DOMContentLoaded", () => {
  console.log("Auth page DOM loaded");

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

  // Check if required elements exist
  if (!signupBtn || !signinBtn) {
    console.error("Required auth form elements not found in DOM");
    return;
  }

  /* ===== Sign Up Handler ===== */
  signupBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    
    const username = signupUsername?.value?.trim() || "";
    const email = signupEmail?.value?.trim() || "";
    const pass = signupPass?.value?.trim() || "";

    // Clear previous messages
    clearMessage(signupMsg);

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

    // Disable button during process
    signupBtn.disabled = true;
    signupBtn.textContent = "Creating Account...";

    try {
      // Check if username is taken
      const usernameTaken = await isUsernameTaken(username);
      if (usernameTaken) {
        showMessage(signupMsg, "Username is already taken. Please choose another.", true);
        signupBtn.disabled = false;
        signupBtn.textContent = "Sign Up";
        return;
      }

      // Create Firebase Auth account
      const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
      const user = userCredential.user;

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

      showMessage(signupMsg, "✅ Account created successfully! Redirecting...");
      
      // Clear form
      if (signupUsername) signupUsername.value = "";
      if (signupEmail) signupEmail.value = "";
      if (signupPass) signupPass.value = "";

      // Redirect after short delay
      setTimeout(() => {
        window.location.href = "index.html";
      }, 1500);

    } catch (err) {
      console.error("Signup error:", err);
      
      // Handle specific Firebase Auth errors
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
        default:
          errorMessage += err.message;
      }
      
      showMessage(signupMsg, "❌ " + errorMessage, true);
      
      // Clear password field
      if (signupPass) signupPass.value = "";
    } finally {
      // Re-enable button
      signupBtn.disabled = false;
      signupBtn.textContent = "Sign Up";
    }
  });

  /* ===== Sign In Handler ===== */
  signinBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    
    const email = signinEmail?.value?.trim() || "";
    const pass = signinPass?.value?.trim() || "";

    // Clear previous messages
    clearMessage(signinMsg);

    // Validation
    if (!validateEmail(email)) {
      showMessage(signinMsg, "Please enter a valid email address.", true);
      return;
    }

    if (!pass) {
      showMessage(signinMsg, "Please enter your password.", true);
      return;
    }

    // Disable button during process
    signinBtn.disabled = true;
    signinBtn.textContent = "Signing In...";

    try {
      await signInWithEmailAndPassword(auth, email, pass);

      showMessage(signinMsg, "✅ Logged in successfully! Redirecting...");
      
      // Clear form
      if (signinEmail) signinEmail.value = "";
      if (signinPass) signinPass.value = "";

      // Redirect after short delay
      setTimeout(() => {
        window.location.href = "index.html";
      }, 1000);

    } catch (err) {
      console.error("Signin error:", err);
      
      // Handle specific Firebase Auth errors
      let errorMessage = "Login failed. ";
      switch (err.code) {
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
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
          errorMessage += err.message;
      }
      
      showMessage(signinMsg, "❌ " + errorMessage, true);
      
      // Clear password field
      if (signinPass) signinPass.value = "";
    } finally {
      // Re-enable button
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

  console.log("Auth handlers initialized successfully");
});

/* ===== Safety check for missing Firebase config ===== */
setTimeout(() => {
  if (!auth || !db) {
    console.error("Firebase not properly initialized");
    const errorElements = [
      document.getElementById("signup-msg"),
      document.getElementById("signin-msg")
    ];
    errorElements.forEach(el => {
      if (el) {
        showMessage(el, "❌ Firebase configuration error. Please check your setup.", true);
      }
    });
  }
}, 1000);