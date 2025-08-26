// firebase.js
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCEMU7Sp8WXQ0fGQRfhtY_P15JDo6eI0Wk",
  authDomain: "yester-chat.firebaseapp.com",
  projectId: "yester-chat",
  storageBucket: "yester-chat.firebasestorage.app",
  messagingSenderId: "39250187153",
  appId: "1:39250187153:web:b01fe53afbaa249195c030",
  measurementId: "G-YX8QQGBELH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// --- NEW: Initialize and export Auth & Firestore ---
export const auth = getAuth(app);
export const db = getFirestore(app);
