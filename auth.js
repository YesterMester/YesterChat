// auth.js
import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
// No longer need firestore imports here, simplifying the file.

// --- Elements ---
const signupEmail = document.getElementById("signup-email");
const signupPass = document.getElementById("signup-pass");
const signupBtn = document.getElementById("signup-btn");
const signupMsg = document.getElementById("signup-msg");

const signinEmail = document.getElementById("signin-email");
const signinPass = document.getElementById("signin-pass");
const signinBtn = document.getElementById("signin-btn");
const signinMsg = document.getElementById("signin-msg");

// --- Sign Up ---
signupBtn.addEventListener("click", async () => {
  const email = signupEmail.value.trim();
  const pass = signupPass.value.trim();

  if (!email || pass.length < 6) {
    signupMsg.textContent = "Please enter a valid email and a password of at least 6 characters.";
    signupMsg.style.color = "red";
    return;
  }

  signupBtn.disabled = true; // Disable button to prevent double-clicks
  signupMsg.textContent = "Creating account...";
  signupMsg.style.color = "black";

  try {
    // 1️⃣ Create Firebase Auth user. That's it!
    await createUserWithEmailAndPassword(auth, email, pass);

    // 2️⃣ REMOVED: Firestore document creation is now handled by other scripts
    // (like profile.js) using the robust `ensureUserDocExists` function.
    // This makes your app's logic much cleaner.

    signupMsg.textContent = "✅ Account created successfully! Redirecting...";
    signupMsg.style.color = "green";

    // The onAuthStateChanged listener on the next page will handle the rest.
    setTimeout(() => window.location.href = "index.html", 1000);

  } catch (err) {
    signupMsg.textContent = `❌ ${err.message}`;
    signupMsg.style.color = "red";
    console.error("Sign up error:", err);
  } finally {
    signupBtn.disabled = false; // Re-enable button
  }
});

// --- Sign In ---
signinBtn.addEventListener("click", async () => {
  const email = signinEmail.value.trim();
  const pass = signinPass.value.trim();

  if (!email || !pass) {
    signinMsg.textContent = "Please enter email and password.";
    signinMsg.style.color = "red";
    return;
  }

  signinBtn.disabled = true; // Disable button
  signinMsg.textContent = "Logging in...";
  signinMsg.style.color = "black";

  try {
    await signInWithEmailAndPassword(auth, email, pass);

    signinMsg.textContent = "✅ Logged in successfully! Redirecting...";
    signinMsg.style.color = "green";

    // The onAuthStateChanged listener on the next page will detect this login.
    setTimeout(() => window.location.href = "index.html", 500);

  } catch (err) {
    signinMsg.textContent = `❌ ${err.message}`;
    signinMsg.style.color = "red";
    console.error("Sign in error:", err);
  } finally {
    signinBtn.disabled = false; // Re-enable button
  }
});
, signInWithEmailAndPassword } 
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp } 
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// --- Elements ---
const signupEmail = document.getElementById("signup-email");
const signupPass = document.getElementById("signup-pass");
const signupBtn = document.getElementById("signup-btn");
const signupMsg = document.getElementById("signup-msg");

const signinEmail = document.getElementById("signin-email");
const signinPass = document.getElementById("signin-pass");
const signinBtn = document.getElementById("signin-btn");
const signinMsg = document.getElementById("signin-msg");

// --- Sign Up ---
signupBtn.addEventListener("click", async () => {
  const email = signupEmail.value.trim();
  const pass = signupPass.value.trim();

  if (!email || !pass) {
    signupMsg.textContent = "Please enter email and password.";
    signupMsg.style.color = "red";
    return;
  }

  try {
    // 1️⃣ Create Firebase Auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
    const user = userCredential.user;

    // 2️⃣ Create Firestore user profile document
    await setDoc(doc(db, "users", user.uid), {
      username: email.split("@")[0],      // default username
      usernameLower: email.split("@")[0].toLowerCase(),
      bio: "",
      photoURL: "",
      friends: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    signupMsg.textContent = "✅ Account created successfully!";
    signupMsg.style.color = "green";
    signupEmail.value = "";
    signupPass.value = "";

    setTimeout(() => window.location.href = "index.html", 1000);

  } catch (err) {
    signupMsg.textContent = "❌ " + err.message;
    signupMsg.style.color = "red";
    signupPass.value = "";
    console.error(err);
  }
});

// --- Sign In ---
signinBtn.addEventListener("click", async () => {
  const email = signinEmail.value.trim();
  const pass = signinPass.value.trim();

  if (!email || !pass) {
    signinMsg.textContent = "Please enter email and password.";
    signinMsg.style.color = "red";
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, pass);

    signinMsg.textContent = "✅ Logged in successfully!";
    signinMsg.style.color = "green";
    signinEmail.value = "";
    signinPass.value = "";

    setTimeout(() => window.location.href = "index.html", 500);

  } catch (err) {
    signinMsg.textContent = "❌ " + err.message;
    signinMsg.style.color = "red";
    signinPass.value = "";
    console.error(err);
  }
});
