// DM.js — Direct Messaging module for Yester Chat (well-designed, Firestore "dms" collection)
// Usage: include as an ES module alongside your script.js in index.html:
// <script type="module" src="./DM.js"></script>
//
// Assumptions:
// - Your firebase initialization exports `auth` and `db` from ./firebase.js
// - Friends list entries are elements with attribute data-friend-uid inside #friendsList
// - The global chat container exists with id="chatContainer" and DM windows should be appended there
//
// Features implemented:
// - "+" button next to each friend to open a DM window (created under #chatContainer).
// - "x" close button hides the DM window (does NOT delete messages).
// - Uses Firestore collection "dms" (document id = sorted pair uids joined by "_"), with subcollection "messages".
// - Real-time listeners per DM; cleans up on sign-out / unload.
// - Unread-count badge on the friend's DM button when a new message arrives and DM is hidden.
// - Local persistence of DM visibility (localStorage) so hidden/visible state persists per-browser.
// - Robust error handling and graceful fallbacks; re-uses a global createMessageElement if present.

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ================== Configuration & State ================== */
const FRIENDS_LIST_SELECTOR = "#friendsList";
const CHAT_CONTAINER_SELECTOR = "#chatContainer";
const LOCALSTORAGE_KEY = "yester:dm_visibility_v1";

let currentUser = null;
const dmListeners = {};     // dmId -> unsubscribe function
const dmWindows = {};       // dmId -> { container, messagesBox, input, visible, friendUid, friendProfile }
const profileCache = {};    // uid -> profile object
const unreadCounts = {};    // dmId -> number

/* ================== Utilities & Logging ================== */
function debug(...args) { console.debug("[DM.js]", ...args); }
function debugError(...args) { console.error("[DM.js]", ...args); }
function defaultAvatar() { return "https://www.gravatar.com/avatar/?d=mp&s=160"; }
function escapeHtml(s = "") { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function getDMId(a, b) { return [a, b].sort().join("_"); }
function getFriendUidFromDmId(dmId) {
  if (!currentUser) return null;
  const parts = dmId.split("_");
  return parts[0] === currentUser.uid ? parts[1] : parts[0];
}

/* ================== CSS Injection ================== */
const dmStyles = `
/* DM UI - injected by DM.js */
.dm-window { border:1px solid #e6e6e6; border-radius:8px; margin:10px 0; max-width:820px; background:#fff; box-shadow:0 6px 18px rgba(0,0,0,0.04); font-family:system-ui,Segoe UI,Roboto,"Helvetica Neue",Arial; }
.dm-header { display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:#fafafa; gap:8px; }
.dm-header-left { display:flex; align-items:center; gap:10px; }
.dm-avatar-sm { width:32px; height:32px; border-radius:50%; object-fit:cover; }
.dm-messages { max-height:320px; overflow:auto; padding:10px; display:flex; flex-direction:column; gap:10px; background:linear-gradient(#fff,#fbfbfb); }
.dm-message { display:flex; gap:10px; align-items:flex-start; }
.dm-message .dm-msg-avatar { width:32px; height:32px; border-radius:50%; object-fit:cover; flex-shrink:0; }
.dm-message .dm-msg-body { background:#f1f1f1; padding:8px 10px; border-radius:10px; max-width:78%; word-break:break-word; }
.dm-message.me .dm-msg-body { background:#d1f0ff; align-self:flex-end; }
.dm-message .dm-msg-meta { font-size:11px; color:#666; margin-top:6px; }
.dm-composer { display:flex; gap:8px; padding:10px; border-top:1px solid #eee; }
.dm-composer input[type="text"] { flex:1; padding:8px; border:1px solid #ddd; border-radius:8px; outline:none; }
.dm-composer button { padding:8px 12px; border-radius:8px; border:none; cursor:pointer; background:#1976d2; color:#fff; font-weight:600; }
.dm-open-btn { margin-left:8px; cursor:pointer; padding:4px 8px; border-radius:8px; border:1px solid #ccc; background:#fff; min-width:36px; height:32px; display:inline-flex; align-items:center; justify-content:center; font-weight:700; }
.dm-open-btn:hover { background:#f8f8f8; }
.dm-badge { background:#d32f2f; color:white; font-size:11px; padding:2px 6px; border-radius:999px; margin-left:6px; min-width:20px; text-align:center; display:inline-block; line-height:1; }
`;

// Inject styles once
if (!document.getElementById("dm-js-styles")) {
  const s = document.createElement("style");
  s.id = "dm-js-styles";
  s.textContent = dmStyles;
  document.head.appendChild(s);
}

/* ================== Profile Fetch & Cache ================== */
async function fetchProfile(uid) {
  if (!uid) return { username: "Unknown", photoURL: "" };
  if (profileCache[uid]) return profileCache[uid];
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      profileCache[uid] = snap.data();
      return profileCache[uid];
    }
  } catch (err) {
    debugError("fetchProfile error", err);
  }
  profileCache[uid] = { username: uid, photoURL: "" };
  return profileCache[uid];
}

/* ================== Visibility persistence ================== */
function loadVisibilityMap() {
  try {
    const raw = localStorage.getItem(LOCALSTORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function saveVisibilityMap(map) {
  try { localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(map)); } catch (e) {}
}
function isDMVisible(dmId) {
  const map = loadVisibilityMap();
  return map[dmId] !== false; // default visible if not explicitly false
}
function setDMVisibility(dmId, visible) {
  const map = loadVisibilityMap();
  map[dmId] = !!visible;
  saveVisibilityMap(map);
}

/* ================== DOM Helpers ================== */
function findFriendsList() { return document.querySelector(FRIENDS_LIST_SELECTOR); }
function findChatContainer() { return document.querySelector(CHAT_CONTAINER_SELECTOR); }

function findFriendItemByUid(uid) {
  const list = findFriendsList();
  if (!list) return null;
  return list.querySelector(`[data-friend-uid="${uid}"]`);
}

/* ================== Unread Badge Utilities ================== */
function showUnreadBadgeOnFriend(uid, count) {
  const item = findFriendItemByUid(uid);
  if (!item) return;
  let btn = item.querySelector(".dm-open-btn");
  if (!btn) {
    // if the friend item exists but button hasn't been attached yet, attach now
    ensureDMButtonOnFriendItem(item);
    btn = item.querySelector(".dm-open-btn");
    if (!btn) return;
  }
  // find or create badge
  let badge = btn.querySelector(".dm-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "dm-badge";
    badge.setAttribute("aria-hidden", "false");
    btn.appendChild(badge);
  }
  badge.textContent = count > 99 ? "99+" : String(count);
}
function clearUnreadBadgeOnFriend(uid) {
  const item = findFriendItemByUid(uid);
  if (!item) return;
  const btn = item.querySelector(".dm-open-btn");
  if (!btn) return;
  const badge = btn.querySelector(".dm-badge");
  if (badge) badge.remove();
  const dmId = getDMId(currentUser.uid, uid);
  unreadCounts[dmId] = 0;
}

/* ================== Friend-item DM Button Attachment ================== */
function ensureDMButtonOnFriendItem(item) {
  if (!item || !item.getAttribute) return;
  const uid = item.getAttribute("data-friend-uid");
  if (!uid) return;
  if (item.querySelector(".dm-open-btn")) return; // already has one

  const btn = document.createElement("button");
  btn.className = "dm-open-btn";
  btn.type = "button";
  btn.title = "Open DM";
  btn.textContent = "+";
  btn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    let prof = profileCache[uid];
    if (!prof) prof = await fetchProfile(uid);
    toggleOrCreateDM(uid, prof);
  });

  // Append to end of friend item - keep existing click handlers (don't override)
  item.appendChild(btn);
}

/* Attach buttons to existing items and observe list for changes */
let friendsListObserver = null;
function attachDMButtonsToExisting() {
  const list = findFriendsList();
  if (!list) return;
  const items = list.querySelectorAll('[data-friend-uid]');
  items.forEach(it => ensureDMButtonOnFriendItem(it));
}
function startWatchingFriendsList() {
  const list = findFriendsList();
  if (!list) {
    setTimeout(startWatchingFriendsList, 600);
    return;
  }
  attachDMButtonsToExisting();
  if (friendsListObserver) friendsListObserver.disconnect();
  friendsListObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList" && m.addedNodes.length) {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            if (node.hasAttribute && node.hasAttribute('data-friend-uid')) {
              ensureDMButtonOnFriendItem(node);
            } else {
              const nested = node.querySelector && node.querySelector('[data-friend-uid]');
              if (nested) ensureDMButtonOnFriendItem(nested);
            }
          }
        });
      }
    }
  });
  friendsListObserver.observe(list, { childList: true, subtree: true });
}

/* ================== DM Window Creation & Management ================== */
async function toggleOrCreateDM(friendUid, friendProfile) {
  if (!currentUser) {
    debug("toggleOrCreateDM: no user");
    return;
  }
  const dmId = getDMId(currentUser.uid, friendUid);
  const existing = dmWindows[dmId];
  if (existing) {
    const visible = existing.container.style.display !== "none";
    if (visible) {
      existing.container.style.display = "none";
      existing.visible = false;
      setDMVisibility(dmId, false);
    } else {
      existing.container.style.display = "block";
      existing.visible = true;
      setDMVisibility(dmId, true);
      clearUnreadBadgeOnFriend(friendUid);
      // scroll to bottom
      existing.messagesBox.scrollTop = existing.messagesBox.scrollHeight;
    }
    return;
  }
  await createDMWindow(friendUid, friendProfile);
}

async function createDMWindow(friendUid, friendProfile) {
  if (!currentUser) return;
  const chatContainer = findChatContainer();
  if (!chatContainer) {
    debugError("createDMWindow: chat container (#chatContainer) not found");
    return;
  }
  if (!friendProfile) friendProfile = await fetchProfile(friendUid);
  const friendName = friendProfile?.username || friendUid;
  const friendPhoto = friendProfile?.photoURL || defaultAvatar();
  const dmId = getDMId(currentUser.uid, friendUid);

  // wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "dm-window";
  wrapper.id = `dm-${dmId}`;
  wrapper.setAttribute("data-dm-id", dmId);
  wrapper.setAttribute("data-friend-uid", friendUid);
  wrapper.style.display = isDMVisible(dmId) ? "block" : "none";

  // header
  const header = document.createElement("div");
  header.className = "dm-header";
  const left = document.createElement("div");
  left.className = "dm-header-left";
  const img = document.createElement("img");
  img.className = "dm-avatar-sm";
  img.src = friendPhoto;
  img.onerror = () => { img.src = defaultAvatar(); };
  const title = document.createElement("div");
  title.textContent = friendName;
  left.appendChild(img);
  left.appendChild(title);

  const headerRight = document.createElement("div");
  headerRight.style.display = "flex";
  headerRight.style.gap = "8px";
  headerRight.style.alignItems = "center";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.title = "Close DM (hide)";
  closeBtn.textContent = "x";
  closeBtn.style.cursor = "pointer";
  closeBtn.addEventListener("click", () => {
    wrapper.style.display = "none";
    setDMVisibility(dmId, false);
    if (dmWindows[dmId]) dmWindows[dmId].visible = false;
  });
  headerRight.appendChild(closeBtn);

  header.appendChild(left);
  header.appendChild(headerRight);

  // messages box
  const messagesBox = document.createElement("div");
  messagesBox.className = "dm-messages";
  messagesBox.setAttribute("role", "log");
  messagesBox.setAttribute("aria-live", "polite");

  // composer
  const composer = document.createElement("div");
  composer.className = "dm-composer";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type a message...";
  input.autocomplete = "off";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendDMMessage(dmId, friendUid, input, messagesBox);
    }
  });

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.textContent = "Send";
  sendBtn.addEventListener("click", () => sendDMMessage(dmId, friendUid, input, messagesBox));

  composer.appendChild(input);
  composer.appendChild(sendBtn);

  wrapper.appendChild(header);
  wrapper.appendChild(messagesBox);
  wrapper.appendChild(composer);

  // append below global chat area
  chatContainer.appendChild(wrapper);

  dmWindows[dmId] = {
    container: wrapper,
    messagesBox,
    input,
    visible: wrapper.style.display !== "none",
    friendUid,
    friendProfile
  };

  // ensure DM meta document exists (participants + updatedAt)
  try {
    const metaRef = doc(db, "dms", dmId);
    await setDoc(metaRef, {
      participants: [currentUser.uid, friendUid],
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    debugError("createDMWindow meta set error", err);
  }

  // start real-time listener
  startDMListener(dmId, messagesBox);

  // if previously had unread, clear now
  clearUnreadBadgeOnFriend(friendUid);

  // scroll to bottom after a short delay so initial messages load
  setTimeout(() => { messagesBox.scrollTop = messagesBox.scrollHeight; }, 300);
}

/* ================== Message Rendering (fallback) ================== */
function createDMMessageElement(msg, meUid) {
  const wrapper = document.createElement("div");
  wrapper.className = "dm-message" + (msg.senderId === meUid ? " me" : "");

  const avatar = document.createElement("img");
  avatar.className = "dm-msg-avatar";
  avatar.src = msg.senderPhotoURL || defaultAvatar();
  avatar.onerror = () => { avatar.src = defaultAvatar(); };

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "dm-msg-body";

  const nameEl = document.createElement("div");
  nameEl.style.fontSize = "12px";
  nameEl.style.fontWeight = "600";
  nameEl.style.marginBottom = "6px";
  nameEl.textContent = msg.senderName || (msg.senderId === meUid ? "You" : "Unknown");

  const textEl = document.createElement("div");
  textEl.innerHTML = escapeHtml(msg.text || "");

  const meta = document.createElement("div");
  meta.className = "dm-msg-meta";
  let timeStr = "";
  try {
    if (msg.timestamp?.toDate) timeStr = new Date(msg.timestamp.toDate()).toLocaleString();
    else if (msg.timestamp) timeStr = new Date(msg.timestamp).toLocaleString();
  } catch (e) { timeStr = ""; }
  meta.textContent = timeStr;

  bodyWrap.appendChild(nameEl);
  bodyWrap.appendChild(textEl);
  bodyWrap.appendChild(meta);

  wrapper.appendChild(avatar);
  wrapper.appendChild(bodyWrap);

  return wrapper;
}

/* ================== Real-time DM Listeners ================== */
function startDMListener(dmId, messagesBox) {
  if (dmListeners[dmId]) return; // already listening

  const msgsRef = collection(db, "dms", dmId, "messages");
  const q = query(msgsRef, orderBy("timestamp"));

  dmListeners[dmId] = onSnapshot(q, async (snapshot) => {
    try {
      const added = snapshot.docChanges().filter(c => c.type === "added");
      if (added.length === 0) return;

      // fetch any missing profiles used in messages
      const missing = new Set();
      added.forEach(c => {
        const d = c.doc.data();
        if (d.senderId && !profileCache[d.senderId]) missing.add(d.senderId);
      });
      if (missing.size) await Promise.all(Array.from(missing).map(uid => fetchProfile(uid)));

      for (const c of added) {
        const data = c.doc.data();
        // try to reuse global createMessageElement if available
        let el = null;
        try {
          if (typeof window.createMessageElement === "function") {
            // script.js's createMessageElement expects an object with senderId/senderName/senderPhotoURL/text/timestamp
            el = window.createMessageElement({
              senderId: data.senderId,
              senderName: data.senderName,
              senderPhotoURL: data.senderPhotoURL,
              text: data.text,
              timestamp: data.timestamp
            });
          }
        } catch (e) {
          el = null;
        }
        if (!el) {
          el = createDMMessageElement({
            senderId: data.senderId,
            senderName: data.senderName || (profileCache[data.senderId]?.username),
            senderPhotoURL: data.senderPhotoURL || profileCache[data.senderId]?.photoURL,
            text: data.text,
            timestamp: data.timestamp
          }, currentUser?.uid);
        }
        messagesBox.appendChild(el);
      }

      // unread badge management:
      const friendUid = getFriendUidFromDmId(dmId);
      if (friendUid) {
        // If DM window exists and is visible, keep it unread cleared; else increment unread
        const win = dmWindows[dmId];
        const anyFromOther = added.some(c => c.doc.data().senderId !== currentUser?.uid);
        if (anyFromOther) {
          if (!win || (win && win.container.style.display === "none")) {
            unreadCounts[dmId] = (unreadCounts[dmId] || 0) + added.filter(c => c.doc.data().senderId !== currentUser?.uid).length;
            showUnreadBadgeOnFriend(friendUid, unreadCounts[dmId]);
          } else {
            // DM open, no badge, maybe scroll if near bottom
            const nearBottom = messagesBox.scrollTop + messagesBox.clientHeight >= messagesBox.scrollHeight - 120;
            if (nearBottom) messagesBox.scrollTop = messagesBox.scrollHeight;
          }
        }
      }

      // auto-scroll if near bottom
      const nearBottom = messagesBox.scrollTop + messagesBox.clientHeight >= messagesBox.scrollHeight - 80;
      if (nearBottom) messagesBox.scrollTop = messagesBox.scrollHeight;

    } catch (err) {
      debugError("startDMListener render error", err);
    }
  }, (err) => {
    debugError("startDMListener snapshot error", err);
  });
}

/* ================== Send DM Messages ================== */
async function sendDMMessage(dmId, friendUid, inputEl, messagesBox) {
  if (!currentUser) return;
  const text = (inputEl?.value || "").trim();
  if (!text) return;

  try {
    // update meta
    await setDoc(doc(db, "dms", dmId), {
      participants: [currentUser.uid, friendUid],
      lastMessage: text,
      updatedAt: serverTimestamp()
    }, { merge: true });

    const meProfile = profileCache[currentUser.uid] || await fetchProfile(currentUser.uid);

    await addDoc(collection(db, "dms", dmId, "messages"), {
      text,
      senderId: currentUser.uid,
      senderName: meProfile.username || (currentUser.email?.split("@")[0] || "User"),
      senderPhotoURL: meProfile.photoURL || "",
      timestamp: serverTimestamp()
    });

    inputEl.value = "";
    setTimeout(() => { messagesBox.scrollTop = messagesBox.scrollHeight; }, 200);

    // clear unread for this dm
    const friendItem = findFriendItemByUid(friendUid);
    if (friendItem) clearUnreadBadgeOnFriend(friendUid);

  } catch (err) {
    debugError("sendDMMessage error", err);
    alert("Failed to send message. See console for details.");
  }
}

/* ================== Cleanup ================== */
function cleanupAllDMListeners() {
  Object.keys(dmListeners).forEach(dmId => {
    try { dmListeners[dmId]?.(); } catch (e) {}
    delete dmListeners[dmId];
  });
}
function destroyAllDMWindows() {
  Object.keys(dmWindows).forEach(dmId => {
    try { const w = dmWindows[dmId]; if (w?.container?.remove) w.container.remove(); } catch (e) {}
    delete dmWindows[dmId];
  });
  // clear unread badges map in UI
  const list = findFriendsList();
  if (list) {
    list.querySelectorAll(".dm-badge").forEach(b => b.remove());
  }
}

/* ================== Auth State Handling & Init ================== */
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    fetchProfile(user.uid).catch(()=>{});
    setTimeout(startWatchingFriendsList, 200);
  } else {
    cleanupAllDMListeners();
    destroyAllDMWindows();
  }
});

// if auth already available
if (auth?.currentUser) {
  currentUser = auth.currentUser;
  fetchProfile(currentUser.uid).catch(()=>{});
  setTimeout(startWatchingFriendsList, 200);
}

/* Try to attach DM buttons if friends already in DOM on load */
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(attachDMButtonsToExisting, 400);
  setTimeout(attachDMButtonsToExisting, 1200);
});

/* cleanup on unload */
window.addEventListener("beforeunload", () => {
  cleanupAllDMListeners();
});

/* Expose a tiny debug API under window.__YesterDM for convenience (only in dev) */
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  window.__YesterDM = {
    dmWindows: () => ({ ...dmWindows }),
    dmListeners: () => ({ ...Object.keys(dmListeners) }),
    unread: () => ({ ...unreadCounts }),
    profileCache: () => ({ ...profileCache }),
    forceAttach: attachDMButtonsToExisting
  };
}
