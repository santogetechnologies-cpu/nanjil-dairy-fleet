import { initializeApp, getApps, getApp } from "firebase/app";
import type { Analytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { initializeFirestore, getFirestore, setLogLevel } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || "AIzaSyDlC2usrNb8wMQzyBao9BTXse5j7u-33co",
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || "nanjil-fleet.firebaseapp.com",
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || "nanjil-fleet",
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || "nanjil-fleet.firebasestorage.app",
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "711799024177",
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || "1:711799024177:web:7cb85074bbce28f586c310",
  measurementId: import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID || "G-KCQ63F630K",
};

// Initialize Firebase (safeguarded for hot-reloads/HMR)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firebase services
const auth = getAuth(app);

// Configure Firestore with experimentalForceLongPolling to eliminate:
// 1. net::ERR_QUIC_PROTOCOL_ERROR.QUIC_TOO_MANY_RTOS (UDP 443 drops on proxies/ISPs)
// 2. WebChannelConnection RPC 'Listen' stream transport errored
// 3. /google.firestore.v1.Firestore/Listen/channel 400 (Bad Request) on stale session reconnects
let db: ReturnType<typeof getFirestore>;
try {
  db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
  });
} catch {
  db = getFirestore(app);
}

// Suppress transient WebChannel transport noise so console stays clean
try {
  setLogLevel("error");
} catch {}

const storage = getStorage(app);

// Analytics is optional and safely stubbed to prevent browser ad-blockers
// (e.g. uBlock, Brave Shields) from logging net::ERR_BLOCKED_BY_CLIENT in DevTools
const analytics: Analytics | undefined = undefined;

export { app, auth, db, storage, analytics };
