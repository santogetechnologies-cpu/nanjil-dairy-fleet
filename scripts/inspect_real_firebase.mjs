import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDlC2usrNb8wMQzyBao9BTXse5j7u-33co",
  authDomain: "nanjil-fleet.firebaseapp.com",
  projectId: "nanjil-fleet",
  storageBucket: "nanjil-fleet.firebasestorage.app",
  messagingSenderId: "711799024177",
  appId: "1:711799024177:web:7cb85074bbce28f586c310",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspectVehicles() {
  console.log("Fetching vehicles from Firestore collection 'vechile'...");
  const snap = await getDocs(collection(db, "vechile"));
  console.log(`Found ${snap.size} documents in 'vechile' collection:`);
  snap.forEach((doc) => {
    console.log(`\nDoc ID: "${doc.id}"`);
    console.log("Data:", JSON.stringify(doc.data(), null, 2));
  });
  process.exit(0);
}

inspectVehicles().catch((err) => {
  console.error("Error inspecting Firebase:", err);
  process.exit(1);
});
