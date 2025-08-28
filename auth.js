// auth.js
import { auth } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// --- Elements ---
const signupUsername = document.getElementById("signup-username");
const signupEmail = document.getElementById("signup-email");
const signupPass = document.getElementById("signup-pass");
const signupBtn = document.getElementById("signup-btn");
const signupMsg = document.getElementById("signup-msg");

const signinEmail = document.getElementById("signin-email");
const signinPass = document.getElementById("signin-pass");
const signinBtn = document.getElementById("signin-btn");
const signinMsg = document.getElementById("signin-msg");

// --- Sign Up ---
signupBtn?.addEventListener("click", async () => {
  const email = signupEmail.value.trim();
  const pass = signupPass.value.trim();
  // The username is captured here but will be stored by the next page's script.

  if (!email || pass.length < 6) {
    signupMsg.textContent = "Please enter a valid email and password (at least 6 characters).";
    signupMsg.style.color = "red";
    return;
  }

  signupBtn.disabled = true;
  signupMsg.textContent = "Creating account...";
  signupMsg.style.color = "black";

  try {
    // This function now ONLY creates the authentication user.
    // The user document in the database is handled by script.js or profile.js
    // to prevent race conditions and errors.
    await createUserWithEmailAndPassword(auth, email, pass);
    
    // On success, redirect to the main app.
    window.location.href = "index.html";

  } catch (err) {
    signupMsg.textContent = `❌ ${err.message}`;
    signupMsg.style.color = "red";
  } finally {
    signupBtn.disabled = false;
  }
});

// --- Sign In ---
signinBtn?.addEventListener("click", async () => {
  const email = signinEmail.value.trim();
  const pass = signinPass.value.trim();

  if (!email || !pass) {
    signinMsg.textContent = "Please enter email and password.";
    signinMsg.style.color = "red";
    return;
  }

  signinBtn.disabled = true;
  signinMsg.textContent = "Logging in...";
  signinMsg.style.color = "black";

  try {
    await signInWithEmailAndPassword(auth, email, pass);

    // On success, redirect to the main app.
    window.location.href = "index.html";

  } catch (err) {
    signinMsg.textContent = `❌ ${err.message}`;
    signinMsg.style.color = "red";
  } finally {
    signinBtn.disabled = false;
  }
});
