// auth.js
import { auth } from "./firebase.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } 
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Sign Up
const signupBtn = document.getElementById("signup-btn");
signupBtn.addEventListener("click", async () => {
  const email = document.getElementById("signup-email").value;
  const password = document.getElementById("signup-pass").value;

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("Account created! Redirecting to chat...");
    window.location.href = "index.html"; // go to chat
  } catch (error) {
    alert("Error: " + error.message);
  }
});

// Sign In
const signinBtn = document.getElementById("signin-btn");
signinBtn.addEventListener("click", async () => {
  const email = document.getElementById("signin-email").value;
  const password = document.getElementById("signin-pass").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("Logged in! Redirecting to chat...");
    window.location.href = "index.html"; // go to chat
  } catch (error) {
    alert("Error: " + error.message);
  }
});
