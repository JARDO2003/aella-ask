const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { GoogleGenerativeAI } = require("@google/generative-ai");

initializeApp();
const db = getFirestore();

// La clé est stockée comme secret côté serveur, jamais dans le code ni côté client.
// Se configure avec : firebase functions:secrets:set GEMINI_API_KEY
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const AELLA_SYSTEM_PROMPT = `Tu es Aella, une intelligence artificielle conversationnelle...`;
// (Remplace cette ligne par le system prompt complet fourni au départ du projet.)

exports.askAella = onCall(
  {
    secrets: [GEMINI_API_KEY],
    // Autorise les appels depuis ton front déployé.
    // "cors: true" laisse le SDK gérer automatiquement les origines pour
    // les fonctions "callable" — c'est ce qui manquait dans la version précédente.
    cors: true,
  },
  async (request) => {
    const { conversationId, prompt } = request.data;

    if (!prompt || typeof prompt !== "string") {
      throw new HttpsError("invalid-argument", "Le champ 'prompt' est requis.");
    }

    // Récupère les souvenirs les plus importants pour personnaliser la réponse.
    let memoryContext = "";
    try {
      const memoriesSnap = await db
        .collection("memories")
        .where("status", "==", "active")
        .orderBy("importance", "desc")
        .limit(20)
        .get();

      if (!memoriesSnap.empty) {
        const lines = memoriesSnap.docs.map((d) => `- ${d.data().content}`);
        memoryContext = `\n\n<MEMORY>\n${lines.join("\n")}\n</MEMORY>`;
      }
    } catch (err) {
      // Si la lecture mémoire échoue, on continue sans bloquer la réponse.
      console.error("Erreur lecture mémoire:", err);
    }

    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: AELLA_SYSTEM_PROMPT + memoryContext,
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      return { text };
    } catch (err) {
      console.error("Erreur Gemini:", err);
      throw new HttpsError("internal", "Aella n'a pas pu générer de réponse.");
    }
  }
);
