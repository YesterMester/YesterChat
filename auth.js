// auth.js

import { auth } from "./firebase.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } 
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Sign Up
document.getElementById("signup-btn").addEventListener("click", async () => {
  const emailField = document.getElementById("signup-email");
  const passField = document.getElementById("signup-pass");
  const email = emailField.value.trim();
  const password = passField.value.trim();

  if (!email || !password) {
    alert("Please enter both email and password.");
    return;
  }

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("✅ Account created successfully!");
    // Clear input fields
    emailField.value = "";
    passField.value = "";
    // Redirect to chat
    window.location.href = "index.html";
  } catch (error) {
    alert("❌ Error: " + error.message);
    // Optional: clear password field
    passField.value = "";
  }
});

// Sign In
document.getElementById("signin-btn").addEventListener("click", async () => {
  const emailField = document.getElementById("signin-email");
  const passField = document.getElementById("signin-pass");
  const email = emailField.value.trim();
  const password = passField.value.trim();

  if (!email || !password) {
    alert("Please enter both email and password.");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("✅ Logged in successfully!");
    // Clear input fields
    emailField.value = "";
    passField.value = "";
    // Redirect to chat
    window.location.href = "index.html";
  } catch (error) {
    alert("❌ Error: " + error.message);
    // Optional: clear password field
    passField.value = "";
  }
});
