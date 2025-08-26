// auth.js
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Elements
const signupUsername = document.getElementById("signup-username");
const signupEmail = document.getElementById("signup-email");
const signupPass = document.getElementById("signup-pass");
const signupBtn = document.getElementById("signup-btn");
const signupMsg = document.getElementById("signup-msg");

const signinEmail = document.getElementById("signin-email");
const signinPass = document.getElementById("signin-pass");
const signinBtn = document.getElementById("signin-btn");
const signinMsg = document.getElementById("signin-msg");

// Helper: check username uniqueness (case-insensitive via usernameLower)
async function isUsernameTaken(username) {
  const usernameLower = username.trim().toLowerCase();
  const q = query(collection(db, "users"), where("usernameLower", "==", usernameLower));
  const snap = await getDocs(q);
  return !snap.empty;
}

// SIGNUP
signupBtn.addEventListener("click", async () => {
  signupMsg.textContent = "";
  const username = signupUsername.value.trim();
  const email = signupEmail.value.trim();
  const pass = signupPass.value;

  if (!username || !email || !pass) {
    signupMsg.textContent = "Please fill username, email and password.";
    signupMsg.style.color = "red";
    return;
  }

  try {
    // check username availability
    if (await isUsernameTaken(username)) {
      signupMsg.textContent = "Username already taken. Choose another.";
      signupMsg.style.color = "red";
      return;
    }

    // create auth user
    const userCred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = userCred.user.uid;

    // set displayName on Firebase Auth profile
    await updateProfile(auth.currentUser, { displayName: username });

    // create user profile document
    await setDoc(doc(db, "users", uid), {
      username: username,
      usernameLower: username.toLowerCase(),
      bio: "",
      photoURL: "",
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      createdAt: serverTimestamp()
    });

    signupMsg.textContent = "✅ Account created! Redirecting...";
    signupMsg.style.color = "green";

    // clear
    signupUsername.value = "";
    signupEmail.value = "";
    signupPass.value = "";

    setTimeout(() => window.location.href = "index.html", 900);
  } catch (err) {
    console.error("Signup error", err);
    signupMsg.textContent = "❌ " + err.message;
    signupMsg.style.color = "red";
    signupPass.value = "";
  }
});

// SIGNIN
signinBtn.addEventListener("click", async () => {
  signinMsg.textContent = "";
  const email = signinEmail.value.trim();
  const pass = signinPass.value;

  if (!email || !pass) {
    signinMsg.textContent = "Please enter email and password.";
    signinMsg.style.color = "red";
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    signinMsg.textContent = "✅ Logged in! Redirecting...";
    signinMsg.style.color = "green";
    signinEmail.value = "";
    signinPass.value = "";
    setTimeout(() => window.location.href = "index.html", 500);
  } catch (err) {
    console.error("Signin error", err);
    signinMsg.textContent = "❌ " + err.message;
    signinMsg.style.color = "red";
    signinPass.value = "";
  }
});
