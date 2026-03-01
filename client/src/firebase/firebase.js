import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyActCy9QnEIxab9bpFXnFXoahbmbKuYJuA",
  authDomain: "chatapp-86b01.firebaseapp.com",
  projectId: "chatapp-86b01",
  storageBucket: "chatapp-86b01.firebasestorage.app",
  messagingSenderId: "1007805478475",
  appId: "1:1007805478475:web:b205f59c00683ea978ffce",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
