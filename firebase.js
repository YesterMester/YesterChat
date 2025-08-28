// firebase.js - Firebase configuration and initialization
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Your web app's Firebase configuration
// WARNING: These are public configuration values, but should still be protected in production
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
let app;
let auth;
let db;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  
  console.log("Firebase initialized successfully");
  
  // Enable offline persistence for better UX
  // Note: This should be called before any other Firestore operations
  import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js")
    .then(({ enableNetwork, disableNetwork }) => {
      // Optional: You can enable offline persistence here if needed
      console.log("Firestore network capabilities loaded");
    })
    .catch(err => {
      console.warn("Failed to load Firestore network capabilities:", err);
    });

} catch (error) {
  console.error("Firebase initialization failed:", error);
  
  // Create fallback objects to prevent import errors
  auth = null;
  db = null;
  
  // Show user-friendly error
  document.addEventListener("DOMContentLoaded", () => {
    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #ff4444;
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      z-index: 10000;
      font-family: Arial, sans-serif;
    `;
    errorDiv.textContent = "Firebase initialization failed. Please refresh the page.";
    document.body.appendChild(errorDiv);
    
    setTimeout(() => errorDiv.remove(), 10000);
  });
}

// Export Firebase services
export { auth, db };

// Optional: Export app instance if needed elsewhere
export { app };

// Analytics initialization (optional, only if you're using it)
let analytics = null;
try {
  import("https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js")
    .then(({ getAnalytics }) => {
      analytics = getAnalytics(app);
      console.log("Firebase Analytics initialized");
    })
    .catch(err => {
      console.warn("Analytics initialization failed (this is optional):", err);
    });
} catch (err) {
  console.warn("Analytics not available:", err);
}

export { analytics };