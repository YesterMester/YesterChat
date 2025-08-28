// auth.js
import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

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
  const username = signupUsername.value.trim();
  const email = signupEmail.value.trim();
  const pass = signupPass.value.trim();

  if (!username || !email || pass.length < 6) {
    signupMsg.textContent = "Please fill all fields. Password must be at least 6 characters.";
    signupMsg.style.color = "red";
    return;
  }

  signupBtn.disabled = true;
  signupMsg.textContent = "Creating account...";
  signupMsg.style.color = "black";

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
    const user = userCredential.user;

    await setDoc(doc(db, "users", user.uid), {
      username: username,
      usernameLower: username.toLowerCase(),
      bio: "Just joined Yester Chat!",
      photoURL: "",
      friends: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    signupMsg.textContent = "✅ Account created successfully! Redirecting...";
    signupMsg.style.color = "green";
    
    setTimeout(() => window.location.href = "index.html", 1000);

  } catch (err) {
    // This part of the code correctly displays the sign-up error from Firebase
    signupMsg.textContent = `❌ ${err.message}`;
    signupMsg.style.color = "red";
    console.error("Sign up error:", err);
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

    signinMsg.textContent = "✅ Logged in successfully! Redirecting...";
    signinMsg.style.color = "green";
    
    setTimeout(() => window.location.href = "index.html", 500);

  } catch (err) {
    // This part of the code correctly displays the login error from Firebase
    signinMsg.textContent = `❌ ${err.message}`;
    signinMsg.style.color = "red";
    console.error("Sign in error:", err);
  } finally {
    signinBtn.disabled = false;
  }
});
