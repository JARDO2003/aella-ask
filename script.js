// ===== Aella — script.js =====
// Le front ne parle jamais directement à l'API Gemini : il appelle une
// Cloud Function ("askAella") qui détient la clé côté serveur.
// Voir aella-plan-technique.md, section 1.1.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// La apiKey Firebase est publique par nature (protégée par les règles
// Firestore, pas par le secret) — voir plan technique section 1.2.
const firebaseConfig = {
  apiKey: "AIzaSyCPGgtXoDUycykLaTSee0S0yY0tkeJpqKI",
  authDomain: "data-com-a94a8.firebaseapp.com",
  databaseURL: "https://data-com-a94a8-default-rtdb.firebaseio.com",
  projectId: "data-com-a94a8",
  storageBucket: "data-com-a94a8.firebasestorage.app",
  messagingSenderId: "276904640935",
  appId: "1:276904640935:web:9cd805aeba6c34c767f682",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const askAella = httpsCallable(functions, "askAella");

// ===== DOM =====
const logEl = document.getElementById("log");
const emptyState = document.getElementById("emptyState");
const form = document.getElementById("composerForm");
const input = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const statusDot = document.getElementById("statusDot");
const statusLabel = document.getElementById("statusLabel");
const newConvBtn = document.getElementById("newConvBtn");

let currentUser = null;
let conversationId = null;
let unsubscribeMessages = null;

// ===== État de connexion =====
function setStatus(state, label) {
  statusDot.dataset.state = state;
  statusLabel.textContent = label;
}

setStatus("connecting", "Connexion…");

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    setStatus("online", "En ligne");
    startConversation();
  }
});

signInAnonymously(auth).catch((err) => {
  console.error("Auth error:", err);
  setStatus("error", "Connexion impossible");
});

// ===== Conversation =====
async function startConversation() {
  const convRef = await addDoc(collection(db, "conversations"), {
    userId: currentUser.uid,
    title: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessagePreview: "",
  });
  conversationId = convRef.id;
  listenToMessages();
}

function listenToMessages() {
  if (unsubscribeMessages) unsubscribeMessages();

  const q = query(
    collection(db, "messages"),
    where("conversationId", "==", conversationId),
    orderBy("createdAt", "asc"),
    limit(200)
  );

  unsubscribeMessages = onSnapshot(q, (snapshot) => {
    logEl.innerHTML = "";
    let hasMessages = false;

    snapshot.forEach((docSnap) => {
      hasMessages = true;
      renderMessage(docSnap.data());
    });

    emptyState.style.display = hasMessages ? "none" : "flex";
    scrollToBottom();
  });
}

function renderMessage({ role, content }) {
  const msg = document.createElement("div");
  msg.className = `msg ${role === "user" ? "user" : "aella"}`;

  const label = document.createElement("div");
  label.className = "msg-label";
  label.textContent = role === "user" ? "Toi" : "Aella";

  const body = document.createElement("div");
  body.className = "msg-body";
  body.textContent = content;

  msg.appendChild(label);
  msg.appendChild(body);
  logEl.appendChild(msg);
}

function scrollToBottom() {
  const chat = document.getElementById("chat");
  chat.scrollTop = chat.scrollHeight;
}

// ===== Envoi d'un message =====
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !conversationId) return;

  input.value = "";
  autoResize();
  sendBtn.disabled = true;
  setStatus("thinking", "Aella réfléchit…");

  try {
    await addDoc(collection(db, "messages"), {
      conversationId,
      userId: currentUser.uid,
      role: "user",
      content: text,
      createdAt: serverTimestamp(),
    });

    showTypingIndicator();

    const result = await askAella({ conversationId, prompt: text });
    const reply = result.data.text;

    removeTypingIndicator();

    await addDoc(collection(db, "messages"), {
      conversationId,
      userId: currentUser.uid,
      role: "aella",
      content: reply,
      createdAt: serverTimestamp(),
    });

    await setDoc(
      doc(db, "conversations", conversationId),
      { updatedAt: serverTimestamp(), lastMessagePreview: reply.slice(0, 80) },
      { merge: true }
    );

    setStatus("online", "En ligne");
  } catch (err) {
    console.error("Erreur d'envoi:", err);
    removeTypingIndicator();
    setStatus("error", "Erreur — réessaie");
  } finally {
    sendBtn.disabled = false;
  }
});

function showTypingIndicator() {
  const msg = document.createElement("div");
  msg.className = "msg aella typing";
  msg.id = "typingIndicator";

  const label = document.createElement("div");
  label.className = "msg-label";
  label.textContent = "Aella";

  const body = document.createElement("div");
  body.className = "msg-body typing-dots";
  body.innerHTML = "<span></span><span></span><span></span>";

  msg.appendChild(label);
  msg.appendChild(body);
  logEl.appendChild(msg);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

// ===== Nouvelle conversation =====
newConvBtn.addEventListener("click", () => {
  if (unsubscribeMessages) unsubscribeMessages();
  logEl.innerHTML = "";
  emptyState.style.display = "flex";
  conversationId = null;
  startConversation();
});

// ===== Textarea auto-resize + Enter pour envoyer =====
function autoResize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}

input.addEventListener("input", autoResize);

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});
