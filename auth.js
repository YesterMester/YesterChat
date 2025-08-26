import { auth } from "./firebase.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } 
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

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
    await createUserWithEmailAndPassword(auth, email, pass);
    signupMsg.textContent = "✅ Account created successfully!";
    signupMsg.style.color = "green";
    signupEmail.value = "";
    signupPass.value = "";
    setTimeout(() => window.location.href = "index.html", 1000);
  } catch (err) {
    signupMsg.textContent = "❌ " + err.message;
    signupMsg.style.color = "red";
    signupPass.value = "";
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
  }
});
