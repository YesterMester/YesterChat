// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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
