import { useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "./firebase/firebase";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  deleteDoc,
  where,
  getDocs
} from "firebase/firestore";
import { createOrGetConversation } from "./chat/createOrGetConversation";
import { onAuthStateChanged } from "firebase/auth";


export default function Chat() {
 
  const [me, setMe] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [otherUid, setOtherUid] = useState("");
  const [conversationId, setConversationId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [conversations, setConversations] = useState([]);

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");

  const [otherTyping, setOtherTyping] = useState(false);
  const [otherOnline, setOtherOnline] = useState(null);
  const [otherLastSeenAt, setOtherLastSeenAt] = useState(null);
  const [otherLastReadAt, setOtherLastReadAt] = useState(null);

  const bottomRef = useRef(null);
  const typingTimerRef = useRef(null);
 
  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setMe(user));
    return unsub;
  }, []);

  const myUid = me?.uid;

  // konuşma listesi
  useEffect(() => {
    if (!myUid) return;
    const q = query(
      collection(db, "conversations"),
      where("members", "array-contains", myUid)
      
    );
    return onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      rows.sort((a,b) => (b.lastMessageAt?.toMillis?.() ?? 0) - (a.lastMessageAt?.toMillis?.() ?? 0));
      setConversations(rows);
    });
  }, [myUid]);

  // ✅ Online/offline: myUid yokken çalışmasın
  useEffect(() => {
    if (!myUid) return;

    const myRef = doc(db, "users", myUid);
    let beatTimer = null;
    const setOnline = async () => {
    await setDoc(
      myRef,
      {
        isOnline: true,
        lastActiveAt: serverTimestamp(), // heartbeat için
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

    const setOffline = async () => {
      try {
        await setDoc(
          myRef,
          {
            isOnline: false,
            lastSeenAt: serverTimestamp(),  //  son görülme
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch {}
    };

    setOnline();
    //heartbeat: 15 sn’de bir aktifliğini güncelle
    beatTimer = setInterval(() => {
      setOnline();
    }, 15000);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") setOffline();
      else setOnline();
    };
   window.addEventListener("beforeunload", setOffline);
   document.addEventListener("visibilitychange", onVisibility);
   return () => {
    if (beatTimer) clearInterval(beatTimer);
    window.removeEventListener("beforeunload", setOffline);
    document.removeEventListener("visibilitychange", onVisibility);
    // component unmount → offline yazmayı dene
    setOffline();
  };
  }, [myUid]);

  const openConversation = async () => {
    const uid = otherUid.trim();
    if (!uid) return;
    if (!myUid) return;
    if (uid === myUid) return alert("Kendi UID'ni giremezsin 🙂");

    const cid = await createOrGetConversation(myUid, uid);
    setConversationId(cid);
  };

  const messagesRef = useMemo(() => {
    if (!conversationId) return null;
    return collection(db, "conversations", conversationId, "messages");
  }, [conversationId]);

  const otherUserRef = useMemo(() => {
    if (!conversationId) return null;
    const uid = otherUid.trim();
    if (!uid) return null;
    return doc(db, "users", uid);
  }, [conversationId, otherUid]);

  // Realtime messages
  useEffect(() => {
    if (!messagesRef) return;
    const q = query(messagesRef, orderBy("createdAt", "asc"));
    return onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMessages(rows);
    });
  }, [messagesRef]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Typing dinle
  useEffect(() => {
    if (!conversationId) return;
    const uid = otherUid.trim();
    if (!uid) return;

    const otherTypingRef = doc(db, "conversations", conversationId, "typing", uid);
    return onSnapshot(otherTypingRef, (snap) => {
      setOtherTyping(Boolean(snap.data()?.isTyping));
    });
  }, [conversationId, otherUid]);

  // Online/lastSeen dinle
  useEffect(() => {
   if (!otherUserRef) return;

  return onSnapshot(otherUserRef, (snap) => {
    const d = snap.data();

    const isOnlineFlag = d?.isOnline ?? null;
    const lastActiveAt = d?.lastActiveAt ?? null;
    const lastSeenAt = d?.lastSeenAt ?? null;

    //  heartbeat ile gerçek online: son 30 sn içinde aktifse online say
    let online = null;
    if (isOnlineFlag === null) {
      online = null;
    } else if (isOnlineFlag === false) {
      online = false;
    } else {
      // isOnline true ise bile, stale olabilir
      const ms =
        typeof lastActiveAt?.toMillis === "function" ? lastActiveAt.toMillis() : 0;
      const fresh = Date.now() - ms < 30000; // 30sn
      online = fresh;
    }

    setOtherOnline(online);
    setOtherLastSeenAt(lastSeenAt);
  });
  }, [otherUserRef]);

  // Reads dinle
  useEffect(() => {
    if (!conversationId) return;
    const uid = otherUid.trim();
    if (!uid) return;

    const otherReadRef = doc(db, "conversations", conversationId, "reads", uid);
    return onSnapshot(otherReadRef, (snap) => {
      setOtherLastReadAt(snap.data()?.lastReadAt ?? null);
    });
  }, [conversationId, otherUid]);

  // Okundu işareti yaz
  useEffect(() => {
    if (!conversationId) return;
    if (!myUid) return;

    const myReadRef = doc(db, "conversations", conversationId, "reads", myUid);

    const markRead = async () => {
      await setDoc(
        myReadRef,
        { lastReadAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true }
      );
    };

    if (messages.length > 0) markRead();
  }, [conversationId, messages.length, myUid]);

  const setMyTyping = async (isTyping) => {
    if (!conversationId) return;
    if (!myUid) return;
    const myTypingRef = doc(db, "conversations", conversationId, "typing", myUid);
    await setDoc(myTypingRef, { isTyping, updatedAt: serverTimestamp() }, { merge: true });
  };

  const onChangeText = async (v) => {
    setText(v);
    if (!conversationId) return;

    await setMyTyping(v.trim().length > 0);

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      setMyTyping(false);
    }, 800);
  };

  const send = async () => {
    const t = text.trim();
    if (!t || !messagesRef || !myUid) return;

    setText("");
    await setMyTyping(false);

    await addDoc(messagesRef, {
      senderId: myUid,
      text: t,
      createdAt: serverTimestamp(),
    });
  };

  const deleteMessage = async (messageId) => {
    if (!conversationId) return;
    try {
      await deleteDoc(doc(db, "conversations", conversationId, "messages", messageId));
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const deleteConversation = async (cid) => {
  try {
    // messages sil
    const msgsRef = collection(db, "conversations", cid, "messages");
    const msgsSnap = await getDocs(msgsRef);

    for (const d of msgsSnap.docs) {
      await deleteDoc(d.ref);
    }

    // typing sil
    const typingRef = collection(db, "conversations", cid, "typing");
    const typingSnap = await getDocs(typingRef);

    for (const d of typingSnap.docs) {
      await deleteDoc(d.ref);
    }

    // reads sil
    const readsRef = collection(db, "conversations", cid, "reads");
    const readsSnap = await getDocs(readsRef);

    for (const d of readsSnap.docs) {
      await deleteDoc(d.ref);
    }

    // conversation ana doc sil
    await deleteDoc(doc(db, "conversations", cid));

    // eğer açık chat buysa kapat
    if (conversationId === cid) {
      setConversationId(null);
      setMessages([]);
    }

  } catch (err) {
    console.error("Conversation delete error:", err);
  }
};

  // Görüldü hesaplama
  const myLastMsg = [...messages].reverse().find((m) => m.senderId === myUid);
  const seen =
    myLastMsg?.createdAt &&
    otherLastReadAt &&
    typeof otherLastReadAt.toMillis === "function" &&
    typeof myLastMsg.createdAt.toMillis === "function" &&
    otherLastReadAt.toMillis() >= myLastMsg.createdAt.toMillis();

  // ✅ Loading UI: hook’lardan sonra koşullu render
  if (!me) {
    return <div style={{ padding: 24, color: "#fff" }}>Yükleniyor...</div>;
  }
return (
  <div className="appShell">
    {/* TOP BRAND (HER SAYFA) */}
    <header className="appTopbar">
      <div className="appTopbar__inner">
        <div className="brand">
          <div className="brand__logo" aria-hidden="true">
            <span className="brand__ring" onClick={() => {
            setConversationId(null);
            setOtherUid("");
          }}/>
            <span className="brand__dot" />
          </div>
          <div className="brand__text">
            <div className="brand__name">LivePing</div>
            <div className="brand__tag">Anlık mesaj • Canlı durum</div>
          </div>
        </div>

        {/* Mobilde menü butonu (her sayfada görünsün) */}
        <button
          className="topbarMenuBtn"
          type="button"
          onClick={() => setIsSidebarOpen(true)}
          aria-label="Sohbet listesini aç"
        >
          ☰
        </button>
      </div>
    </header>

    {/* SAYFA İÇERİĞİ */}
    <div className="chatLayout">
    
      {isSidebarOpen ? (
        <div
          className="sidebarOverlay"
          onClick={() => setIsSidebarOpen(false)}
        />
      ) : null}

      {/* LEFT SIDEBAR */}
      <aside className={`sidebar ${isSidebarOpen ? "sidebar--open" : ""}`}>
        <div className="sidebar__top">
          <h3 className="sidebar__title">💬 Sohbetler</h3>

          <div className="sidebar__me">
            <span className="sidebar__meLabel">Benim UID</span>
            <button
              className="sidebar__meChip"
              onClick={() => navigator.clipboard.writeText(myUid)}
              title="Kopyalamak için tıkla"
              type="button"
            >
              {myUid}
            </button>
          </div>
        </div>

        <div className="sidebar__list">
          {conversations?.length ? (
            conversations.map((c) => {
              const other = Array.isArray(c.members)
                ? c.members.find((u) => u !== myUid)
                : null;

              const lastText = c.lastMessageText
                ? String(c.lastMessageText)
                : "Mesaj yok";

              return (
                <button
                  key={c.id}
                  type="button"
                  className={`sidebar__item ${
                    c.id === conversationId ? "sidebar__item--active" : ""
                  }`}
                  onClick={() => {
                    if (!other) return;
                    setConversationId(c.id);
                    setOtherUid(other);
                    setIsSidebarOpen(false);
                  }}
                >
                  <div className="sidebar__row">
                    <div className="sidebar__name">{other || "?"}</div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div className="sidebar__time">
                        {c.lastMessageAt?.toDate?.()?.toLocaleTimeString?.([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        }) ?? ""}
                      </div>

                      <button
                        className="sidebar__delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(c.id);
                        }}
                        type="button"
                        aria-label="Sohbeti sil"
                        title="Sohbeti sil"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <div className="sidebar__last">{lastText}</div>
                </button>
              );
            })
          ) : (
            <div className="sidebar__empty">
              Henüz sohbet yok. <br />
              Sağdan UID ile sohbet başlat.
            </div>
          )}
        </div>
      </aside>

      {/* RIGHT PANEL */}
      <div className="chat">
        <div className="chat__panel">
          {!conversationId ? (
            <div className="chat__start">
              <div className="chat__startTop">
                <h2 className="chat__title">Live Ping</h2>
                <p className="chat__hint">
                  Karşı tarafın UID bilgisini yazıp "Sohbeti Oluştur" butonuna tıklayın
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
                  💬 Sohbeti Oluştur
                </button>
              </div>

              <div className="chat__uidRow">
                <span className="chat__uidLabel">
                  Benim UID "Kopyalamak için tıkla"
                </span>
                <button
                  className="chat__uidChip"
                  onClick={() => navigator.clipboard.writeText(myUid)}
                  title="Kopyalamak için tıkla"
                  type="button"
                >
                  {myUid}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="chat__header">
                <div style={{ flex: 1 }}>
                  <h2 className="chat__title">LivePing</h2>

                  <div className="chat__sub">
                    {otherOnline === null
                      ? "Durum alınıyor..."
                      : otherOnline
                      ? "Online"
                      : `Offline • last seen: ${
                          otherLastSeenAt?.toDate?.()?.toLocaleString?.() ?? "?"
                        }`}
                  </div>
                </div>

                <div className="chat__badges">
                  {/* {otherOnline ? <span className="badge badge--online">online</span> : null} */}
                  {otherTyping ? <span className="badge badge--typing">yazıyor…</span> : null}
                </div>
              </div>

              <div className="chat__box">
                {messages.map((m) => {
                  const isMe = m.senderId === myUid;

                  const isMyLast = isMe && myLastMsg && m.id === myLastMsg.id;
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
              <p className="modal__text">Bu işlem geri alınamaz.</p>

              <div className="modal__preview">{confirmDelete.text}</div>

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
    </div>
  </div>
);
}