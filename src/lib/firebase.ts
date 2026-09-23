import { initializeApp, getApps, getApp } from "firebase/app";
import type { Analytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDlC2usrNb8wMQzyBao9BTXse5j7u-33co",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "nanjil-fleet.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "nanjil-fleet",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "nanjil-fleet.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "711799024177",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:711799024177:web:7cb85074bbce28f586c310",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-KCQ63F630K"
};

// Initialize Firebase (safeguarded for hot-reloads/HMR)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firebase services
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Initialize Analytics conditionally and lazily (resilient to ad-blockers / net::ERR_BLOCKED_BY_CLIENT)
let analytics: Analytics | undefined;
if (typeof window !== "undefined") {
  import("firebase/analytics")
    .then(({ getAnalytics, isSupported }) => {
      isSupported()
        .then((supported) => {
          if (supported) {
            analytics = getAnalytics(app);
          }
        })
        .catch(() => {});
    })
    .catch(() => {
      // Ignored if blocked by client (ad-blocker/privacy extension)
    });
}

export { app, auth, db, storage, analytics };
