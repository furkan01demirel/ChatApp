import { useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "./firebase/firebase";
import {
  addDoc, // koleksiyona yeni doküman ekler (mesaj eklemek).
  collection, //koleksiyon referansı üretir.
  doc, // doküman referansı üretir.
  onSnapshot, // realtime dinleyici (Firestore değişince cb çalışır).
  orderBy,
  query, // sorgu oluşturur.
  serverTimestamp, // tarih/saat’i client’ın değil Firebase sunucusunun zamanı ile yazar
  setDoc, // dokümanı yazar/günceller (online/typing/read için).
  updateDoc, // var olan dokümanı günceller (conversation lastMessage alanları).
  deleteDoc , // mesajları silmek için
} from "firebase/firestore";
import { createOrGetConversation } from "./chat/createOrGetConversation"; 

export default function Chat() {
  const me = auth.currentUser; // anlık login olan olan user'ı alıyor google auth ile giriş yaptığımız için alabiliyoruz

  const [otherUid, setOtherUid] = useState(""); // şaunda diğer konuacağı kişinin Uid'ni alıp input'a yazıp konuşuyoruz
  const [conversationId, setConversationId] = useState(null); // bir id üretiliyor bu id firebase mimarisi için gerekli sohbetin id'si
  const [confirmDelete, setConfirmDelete]=useState(null);

  const [messages, setMessages] = useState([]); // Ekranda gösterilecek mesajalar yani eski mesajlar
  const [text, setText] = useState(""); // gönderilecek mesaj

  const [otherTyping, setOtherTyping] = useState(false); // karşı tarafın yazıp yazmadığına bakıyor
  const [otherOnline, setOtherOnline] = useState(null); // karşı tarafın online olup olmadığına bakıyor
  const [otherLastSeenAt, setOtherLastSeenAt] = useState(null); //Karşı tarafın son giriş tarihi
  const [otherLastReadAt, setOtherLastReadAt] = useState(null); // okundu mesajı için

  const bottomRef = useRef(null); // auto scroll için
  const typingTimerRef = useRef(null); // yazdıktan sonra 800 ms içinde yazmayı bıraktığımı göstermek için

  // --- Online: kendimi online yap ---
  useEffect(() => {
    const myRef = doc(db, "users", me.uid); // kendi uid'im üzerinden dokümanımın referansını oluşturuyorum 

    const setOnline = async () => {
      await setDoc( // setDoc ile bilgilerimi set ediyorum online oluyorum ve 
      // merge true ilede dokğmanı komple ezme sadece bu alanları güncelle diyorum
        myRef,
        { isOnline: true, lastSeenAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true }
      );
    };

    const setOffline = async () => {
      try {
        await setDoc( // setDoc ile bilgilerimi set ediyorum offline oluyorum ve sadece bu bilgiler değişiyor
          myRef,
          { isOnline: false, lastSeenAt: serverTimestamp(), updatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch {}
    };

    setOnline(); // sayfa açılır açılmaz online oluyorum

    
    window.addEventListener("beforeunload", setOffline); // tarayıcı sekmesi kapanırken beforeunload çalışır
    return () => window.removeEventListener("beforeunload", setOffline); // tarayıcıyı kapatınca beni offline yap
  }, [me.uid]);

  const openConversation = async () => {
    const uid = otherUid.trim(); // karşı tarafın Uid'sini al
    if (!uid) return;// boş mu diye kontrol et
    if (uid === me.uid) return alert("Kendi UID'ni giremezsin 🙂");// kendi uid'ini girmeyi engelle

    const cid = await createOrGetConversation(me.uid, uid); // conversation varsa döndür yoksa yeni oluştur
    setConversationId(cid);// conversation'nu set et böylece chatleşmeye başlanabilir
  };


  const messagesRef = useMemo(() => {// her render da yeniden oluşturmaması için useMemo sadece conversationid değişince
    if (!conversationId) return null; // conversation yoksa mesaj koleksiyonuda yok
    return collection(db, "conversations", conversationId, "messages"); // conversation gelince koleksiyonu referans oluştur
  }, [conversationId]);

  const otherUserRef = useMemo(() => { //otherUid veya conversationId değişince ref yenilenir.
    if (!conversationId) return null;
    const uid = otherUid.trim();// karşı tarafın uid sini al
    if (!uid) return null;
    return doc(db, "users", uid); // chat açılınca karşı tarafın users/{uid} dokümanını dinleyeceğiz
  }, [conversationId, otherUid]);

//Realtime dinleme
  useEffect(() => {
    if (!messagesRef) return; // conversation yoksa dinleme yok

    const q = query(messagesRef, orderBy("createdAt", "asc")); // mesajları createdAt artan sırada çek (en eski → en yeni)
    return onSnapshot(q, (snap) => { // Firestore da mesaj değişince otomatik gelir.
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })); // her dokümana id ekleyerek react listesinde key yapıyoruz
      setMessages(rows); // mesajı ekrana bakıyoruz
    });
  }, [messagesRef]);

  // --- Auto-scroll ---
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });// her mesaj geldiğinde (messages.length değişince) en alttaki ref'e scroll yap
    //?. ile null safety yaptık
  }, [messages.length]);

  // --- Typing: karşı tarafı dinle ---
  useEffect(() => {
    if (!conversationId) return;
    const uid = otherUid.trim();
    if (!uid) return;
   //typing/{uid} dokümanını dinle
   //isTyping true ise UI’da “yazıyor…” bas.
    const otherTypingRef = doc(db, "conversations", conversationId, "typing", uid); // yani karşı tarafın dokümanını alıp kullanıyoruz
    return onSnapshot(otherTypingRef, (snap) => {
      setOtherTyping(Boolean(snap.data()?.isTyping));
    });
  }, [conversationId, otherUid]);

  // --- Online/lastSeen: karşı taraf users/{otherUid} dinle ---
  useEffect(() => {
    if (!otherUserRef) return;
    return onSnapshot(otherUserRef, (snap) => {
      const d = snap.data();
      setOtherOnline(d?.isOnline ?? null);
      setOtherLastSeenAt(d?.lastSeenAt ?? null);
    });
  }, [otherUserRef]);

  // --- Seen: reads/{otherUid} dinle ---
  useEffect(() => {
    if (!conversationId) return;
    const uid = otherUid.trim();
    if (!uid) return;

    const otherReadRef = doc(db, "conversations", conversationId, "reads", uid);
    return onSnapshot(otherReadRef, (snap) => {
      setOtherLastReadAt(snap.data()?.lastReadAt ?? null);
    });
  }, [conversationId, otherUid]); // Bu effect sadece conversationId veya otherUid değişirse tekrar çalışsın.

  // --- Seen: ben bu chatteyken okundu işareti güncelle ---
  useEffect(() => {
    if (!conversationId) return;
    const myReadRef = doc(db, "conversations", conversationId, "reads", me.uid); // kendi read dokümanımı aldım

    // sohbet açıkken her mesaj değişiminde "okudum" diye işaretle
    const markRead = async () => {
      await setDoc(
        myReadRef,
        { lastReadAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true } // okudum zamanını güncelle
      );
    };

    if (messages.length > 0) markRead(); // yeni mesaj geldikçe markRead çalışır
  }, [conversationId, messages.length, me.uid]);

  const setMyTyping = async (isTyping) => { // benim typing dokümanımı yazar/günceller.
    if (!conversationId) return;
    const myTypingRef = doc(db, "conversations", conversationId, "typing", me.uid);
    await setDoc(myTypingRef, { isTyping, updatedAt: serverTimestamp() }, { merge: true });
  };

  const onChangeText = async (v) => {
    setText(v);// input değişince text state güncellenir.

    if (!conversationId) return;

    // yazmaya başlayınca typing true
    await setMyTyping(v.trim().length > 0); // boş değilse typing true

    // kullanıcı yazmayı bırakırsa 800ms sonra typing false (debounce)
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      setMyTyping(false);
    }, 800);
  };

  const send = async () => {
    const t = text.trim();
    if (!t || !messagesRef) return; // boş mesajı engelle

    setText(""); // input’u temizle
    await setMyTyping(false); // typing’i kapat (mesaj gönderince artık yazmıyor)

    await addDoc(messagesRef, { // yeni message doc ekler
      senderId: me.uid, // Gönderen
      text: t, // mesaj
      createdAt: serverTimestamp(), // server timestamp
    });

    

    // preview güncelle (opsiyonel ama iyi)
    // await updateDoc(doc(db, "conversations", conversationId), {
    //   lastMessageText: t,
    //   lastMessageAt: serverTimestamp(),
    //   lastMessageSenderId: me.uid,
    // });
  };
  const deleteMessage  = async (messageId) =>{
      if (!conversationId) return;
      try{
        await deleteDoc(
          doc(db, "conversations", conversationId, "messages", messageId)// conversations/{conversationId}/messages/{messageId}
        ); 
      }catch(err){
        console.error("Delete error:", err);
      }
     
    };
  //  Görüldü hesaplama
  const myLastMsg = [...messages].reverse().find((m) => m.senderId === me.uid);
  // mesajların tersini al (en yeni en başa gelsin)
  // benim son gönderdiğim mesajı bul
  const seen =
    myLastMsg?.createdAt && // benim son mesajımın createdAt’i var
    otherLastReadAt && // karşı tarafın lastReadAt’i var
    typeof otherLastReadAt.toMillis === "function" && // ikisi Timestamp ise .toMillis() vardır
    typeof myLastMsg.createdAt.toMillis === "function" &&
    otherLastReadAt.toMillis() >= myLastMsg.createdAt.toMillis(); // karşı tarafın okuma zamanı, benim son mesajımdan sonra ise → “görüldü”

return (
    <div className="chat">
      <div className="chat__panel">
        {!conversationId ? (
          <div className="chat__start">
            <div className="chat__startTop">
              <h2 className="chat__title">Sohbet Aç</h2>
              <p className="chat__hint">
                Şimdilik UID ile açıyoruz (MVP). Sonra kullanıcı listesi + arama ekleriz.
              </p>
            </div>

            <div className="chat__startRow">
              <input
                className="chat__input"
                value={otherUid}
                onChange={(e) => setOtherUid(e.target.value)}
                placeholder="Karşı taraf UID"
              />
              <button className="chat__btn" onClick={openConversation}>
                Sohbeti Aç
              </button>
            </div>

            <div className="chat__uidRow">
              <span className="chat__uidLabel">Benim UID</span>
              <button
                className="chat__uidChip"
                onClick={() => navigator.clipboard.writeText(me.uid)}
                title="Kopyalamak için tıkla"
                type="button"
              >
                {me.uid}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="chat__header">
              <div>
                <h2 className="chat__title">Sohbet</h2>
                <div className="chat__uidRow">
              <span className="chat__uidLabel">Benim UID</span>
              <button
                className="chat__uidChip"
                onClick={() => navigator.clipboard.writeText(me.uid)}
                title="Kopyalamak için tıkla"
                type="button"
              >
                {me.uid}
              </button>
            </div>
                <div className="chat__sub">
                  {otherOnline === null
                    ? "Durum alınıyor..."
                    : otherOnline
                    ? "Online"
                    : `Offline • last seen: ${otherLastSeenAt?.toDate?.()?.toLocaleString?.() ?? "?"}`}
                </div>
              </div>

              <div className="chat__badges">
                {otherOnline ? <span className="badge badge--online">online</span> : null}
                {otherTyping ? <span className="badge badge--typing">yazıyor…</span> : null}
                {/* {seen ? <span className="badge badge--seen">görüldü ✓</span> : null} */}
              </div>
            </div>

            <div className="chat__box">
              {messages.map((m) => {
                const isMe = m.senderId === me.uid;

                // Bu mesaj benim en son mesajım mı?
                const isMyLast =
                  isMe && myLastMsg && m.id === myLastMsg.id;

                // Okundu durumu sadece benim en son mesajım için
                const tick = isMyLast ? (seen ? "✓✓" : "✓") : null;

                return (
                  <div
                    key={m.id}
                    className={`chat__row ${isMe ? "chat__row--me" : "chat__row--other"}`}
                  >
                    <div className={`chat__bubble ${isMe ? "chat__bubble--me" : "chat__bubble--other"}`}>
                      <div className="chat__meta">{isMe ? "Ben" : "Karşı"}</div>

                      <div className="chat__textRow">
                        <div className="chat__text">{m.text}</div>

                        {tick ? (
                          <span className={`chat__tick ${seen ? "chat__tick--seen" : ""}`}>
                            {tick}
                          </span>
                        ) : null} 
                      </div>
                      {isMe ? (
                        <div className="chat__actions">
                        <button
                          className="chat__delete"
                          type="button"
                          onClick={() => setConfirmDelete({ id: m.id, text: m.text })}
                        >
                          Sil
                        </button>
                      </div>
                      ) : null}
                      
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <div className="chat__composer">
              <input
                className="chat__input"
                value={text}
                onChange={(e) => onChangeText(e.target.value)}
                placeholder="Mesaj yaz…"
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              
              <button className="chat__btn" onClick={send}>
                Gönder
              </button>

            </div>
            
          </>
        )}
      </div>
      {confirmDelete ? (
  <div className="modal__backdrop" onClick={() => setConfirmDelete(null)}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3 className="modal__title">Mesaj silinsin mi?</h3>
      <p className="modal__text">
        Bu işlem geri alınamaz.
      </p>

      <div className="modal__preview">
        {confirmDelete.text}
      </div>

      <div className="modal__actions">
        <button
          className="modal__btn modal__btn--ghost"
          type="button"
          onClick={() => setConfirmDelete(null)}
        >
          Vazgeç
        </button>

        <button
          className="modal__btn modal__btn--danger"
          type="button"
          onClick={async () => {
            await deleteMessage(confirmDelete.id);
            setConfirmDelete(null);
          }}
        >
          Sil
        </button>
      </div>
    </div>
  </div>
) : null}
    </div>
  );
}