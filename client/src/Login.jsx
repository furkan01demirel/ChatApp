import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider, db } from "./firebase/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export default function Login() {

  const login = async () => {
    const result = await signInWithPopup(auth, googleProvider);

    const user = result.user;

    await setDoc(
      doc(db, "users", user.uid),
      {
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
        isOnline: true,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  return (
    <div style={{ padding: 30 }}>
      <h1>Chat App</h1>
      <button onClick={login}>Google ile giriş</button>
    </div>
  );
}