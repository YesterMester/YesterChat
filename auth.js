import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } 
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp } 
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ===== DOM Elements ===== */
const signupEmail = document.getElementById("signup-email");
const signupPass = document.getElementById("signup-pass");
const signupBtn = document.getElementById("signup-btn");
const signupMsg = document.getElementById("signup-msg");

const signinEmail = document.getElementById("signin-email");
const signinPass = document.getElementById("signin-pass");
const signinBtn = document.getElementById("signin-btn");
const signinMsg = document.getElementById("signin-msg");

/* ===== Utility Functions ===== */
function showMessage(el, msg, color = "black") {
  if (!el) return;
  el.textContent = msg;
  el.style.color = color;
}

function clearInput(...inputs) {
  inputs.forEach(i => { if (i) i.value = ""; });
}

function validateEmail(email) {
  return /^\S+@\S+\.\S+$/.test(email);
}

function validatePassword(pass) {
  return pass.length >= 6;
}

/* ===== SIGN UP ===== */
async function handleSignUp() {
  const email = signupEmail.value.trim();
  const pass = signupPass.value.trim();

  if (!email || !pass) {
    return showMessage(signupMsg, "Please enter email and password.", "red");
  }
  if (!validateEmail(email)) {
    return showMessage(signupMsg, "Invalid email format.", "red");
  }
  if (!validatePassword(pass)) {
    return showMessage(signupMsg, "Password must be at least 6 characters.", "red");
  }

  try {
    // 1️⃣ Create Firebase Auth user
    const { user } = await createUserWithEmailAndPassword(auth, email, pass);

    // 2️⃣ Create Firestore profile
    const username = email.split("@")[0];
    await setDoc(doc(db, "users", user.uid), {
      username,
      usernameLower: username.toLowerCase(),
      bio: "",
      photoURL: "",
      friends: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showMessage(signupMsg, "✅ Account created successfully!", "green");
    clearInput(signupEmail, signupPass);

    setTimeout(() => window.location.href = "index.html", 1000);
  } catch (err) {
    showMessage(signupMsg, "❌ " + err.message, "red");
    signupPass.value = "";
    console.error("Sign Up Error:", err);
  }
}

/* ===== Attach Sign Up Event ===== */
if (signupBtn) signupBtn.addEventListener("click", handleSignUp);
if (signupPass) signupPass.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSignUp();
});
if (signupEmail) signupEmail.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSignUp();
});
/* ===== SIGN IN ===== */
async function handleSignIn() {
  const email = signinEmail.value.trim();
  const pass = signinPass.value.trim();

  if (!email || !pass) {
    return showMessage(signinMsg, "Please enter email and password.", "red");
  }
  if (!validateEmail(email)) {
    return showMessage(signinMsg, "Invalid email format.", "red");
  }
  if (!validatePassword(pass)) {
    return showMessage(signinMsg, "Password must be at least 6 characters.", "red");
  }

  try {
    await signInWithEmailAndPassword(auth, email, pass);

    showMessage(signinMsg, "✅ Logged in successfully!", "green");
    clearInput(signinEmail, signinPass);

    setTimeout(() => window.location.href = "index.html", 500);
  } catch (err) {
    showMessage(signinMsg, "❌ " + err.message, "red");
    signinPass.value = "";
    console.error("Sign In Error:", err);
  }
}

/* ===== Attach Sign In Event ===== */
if (signinBtn) signinBtn.addEventListener("click", handleSignIn);
if (signinPass) signinPass.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSignIn();
});
if (signinEmail) signinEmail.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSignIn();
});