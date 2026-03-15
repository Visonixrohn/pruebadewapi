const express = require("express");
require("dotenv").config();
const EventEmitter = require("events");
const path = require("path");
const https = require("https");
const SYSTEM_PROMPT = require("./prompt");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "verify_token_here";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const sse = new EventEmitter();
sse.setMaxListeners(100);
let messages = [];

// ─── Envía un mensaje de texto por WhatsApp Cloud API ───────────────────────
function sendWhatsAppMessage(phoneNumberId, to, text) {
  if (!WHATSAPP_TOKEN) {
    console.warn("[WARN] WHATSAPP_TOKEN no configurado.");
    return;
  }

  const postData = JSON.stringify({
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  });

  const options = {
    hostname: "graph.facebook.com",
    path: `/v17.0/${phoneNumberId}/messages`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  const req = https.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () =>
      console.log(`[WhatsApp] ${res.statusCode} →`, body)
    );
  });

  req.on("error", (e) => console.error("[WhatsApp] Error:", e.message));
  req.write(postData);
  req.end();
}

// ─── Genera respuesta con ChatGPT-4o-mini ────────────────────────────────────
async function generateReply(userMessage) {
  if (!OPENAI_API_KEY) {
    console.warn("[WARN] OPENAI_API_KEY no configurado.");
    return "Hola, ¿en qué puedo ayudarte?";
  }

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    const data = await resp.json();

    if (data.error) {
      console.error("[OpenAI] Error API:", data.error.message);
      return "Lo siento, no puedo responder en este momento.";
    }

    return (
      data.choices?.[0]?.message?.content?.trim() ??
      "Lo siento, no puedo responder en este momento."
    );
  } catch (err) {
    console.error("[OpenAI] Error:", err.message);
    return "Lo siento, ocurrió un error al procesar tu mensaje.";
  }
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", (req, res) => {
  console.log("Webhook received");

  if (req.body && req.body.entry) {
    req.body.entry.forEach((entry) => {
      if (entry.changes) {
        entry.changes.forEach((change) => {
          const value = change.value;
          if (value && value.messages) {
            value.messages.forEach((msg) => {
              const text =
                msg.text && msg.text.body
                  ? msg.text.body
                  : msg.body || JSON.stringify(msg);
              const from =
                msg.from ||
                (value.metadata && value.metadata.phone_number_id) ||
                "unknown";
              const item = { from, text, timestamp: Date.now() };
              messages.unshift(item);
              if (messages.length > 100) messages.pop();
              sse.emit("message", JSON.stringify(item));
              console.log("[MSG] De:", from, "|", text);

              const phoneNumberId =
                value?.metadata?.phone_number_id ?? null;

              if (phoneNumberId) {
                // Responder de forma asíncrona sin bloquear el webhook
                (async () => {
                  const reply = await generateReply(text);
                  console.log("[BOT] Respondiendo a", from, ":", reply);
                  sendWhatsAppMessage(phoneNumberId, from, reply);
                })();
              } else {
                console.warn("[WARN] phone_number_id no encontrado en el webhook.");
              }
            });
          }
        });
      }
    });
  }

  res.sendStatus(200);
});

app.get("/messages", (req, res) => {
  res.json(messages);
});

app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${data}\n\n`);
  };

  // send existing messages once
  send(JSON.stringify({ type: "init", messages }));

  const onMessage = (data) => send(data);
  sse.on("message", onMessage);

  req.on("close", () => {
    sse.removeListener("message", onMessage);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
