import { db } from "../firebase/firebase";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

export async function createOrGetConversation(myUid, otherUid) {
  const members = [myUid, otherUid].sort();
  const membersKey = members.join("_");

  const q = query(
    collection(db, "conversations"),
    where("membersKey", "==", membersKey),
  );

  const snap = await getDocs(q);
  if (!snap.empty) {
    return snap.docs[0].id;
  }

  const docRef = await addDoc(collection(db, "conversations"), {
    members,
    membersKey,
    createdAt: serverTimestamp(),
    lastMessageText: "",
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: "",
  });

  return docRef.id;
}
