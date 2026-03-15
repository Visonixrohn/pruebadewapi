const express = require("express");
require("dotenv").config();
const path = require("path");
const https = require("https");
const { createClient } = require("@supabase/supabase-js");
const FALLBACK_PROMPT = require("./prompt");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Clientes ────────────────────────────────────────────────────────────────
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN   || "verify_token_here";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

if (!supabase) console.warn("[WARN] Supabase no configurado. Los mensajes no se guardarán.");

// ─── Cache del prompt (se recarga cada 5 minutos) ────────────────────────────
let promptCache = { text: FALLBACK_PROMPT, ts: 0 };

async function getSystemPrompt() {
  if (!supabase) return FALLBACK_PROMPT;
  if (Date.now() - promptCache.ts < 5 * 60 * 1000) return promptCache.text;
  try {
    const { data } = await supabase
      .from("configuracion_bot")
      .select("valor")
      .eq("clave", "system_prompt")
      .single();
    if (data?.valor) {
      promptCache = { text: data.valor, ts: Date.now() };
    }
  } catch (e) {
    console.error("[Supabase] Error cargando prompt:", e.message);
  }
  return promptCache.text;
}

// ─── Tool definition para OpenAI function calling ────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "guardar_solicitud",
      description:
        "Guarda la solicitud de suscripción a RoaBusiness cuando se tienen TODOS los datos del cliente y las 3 imágenes (logo, portada, comprobante de pago).",
      parameters: {
        type: "object",
        properties: {
          nombre_persona:       { type: "string", description: "Nombre completo del contacto" },
          nombre_negocio:       { type: "string", description: "Nombre del negocio" },
          direccion:            { type: "string", description: "Dirección del negocio" },
          telefonos:            { type: "string", description: "Teléfonos del negocio" },
          email:                { type: "string", description: "Email de contacto" },
          plan_elegido:         { type: "string", description: "Plan elegido (Básico, Profesional o Premium)" },
          url_logo:             { type: "string", description: "URL del logo en Supabase Storage" },
          url_portada:          { type: "string", description: "URL de la imagen de portada en Supabase Storage" },
          url_comprobante_pago: { type: "string", description: "URL del comprobante de pago en Supabase Storage" },
        },
        required: ["nombre_persona","nombre_negocio","direccion","telefonos","email","plan_elegido"],
      },
    },
  },
];

// ─── Supabase helpers ────────────────────────────────────────────────────────
async function getOrCreateConversacion(telefono, phoneNumberId) {
  if (!supabase) return null;
  let { data } = await supabase
    .from("conversaciones")
    .select("*")
    .eq("telefono", telefono)
    .single();

  if (!data) {
    const { data: nueva } = await supabase
      .from("conversaciones")
      .insert({ telefono, phone_number_id: phoneNumberId, estado: "activa" })
      .select()
      .single();
    data = nueva;
  }
  return data;
}

async function getHistorial(conversacionId, limite = 20) {
  if (!supabase || !conversacionId) return [];
  const { data } = await supabase
    .from("mensajes")
    .select("direccion, tipo, contenido, url_medio")
    .eq("conversacion_id", conversacionId)
    .order("creado_en", { ascending: true })
    .limit(limite);
  return data || [];
}

async function guardarMensaje(conversacionId, telefono, direccion, tipo, contenido, urlMedio = null) {
  if (!supabase) return;
  await supabase.from("mensajes").insert({
    conversacion_id: conversacionId,
    telefono,
    direccion,
    tipo,
    contenido,
    url_medio: urlMedio,
  });
}

async function marcarConversacionCompletada(conversacionId) {
  if (!supabase || !conversacionId) return;
  await supabase
    .from("conversaciones")
    .update({ estado: "completada" })
    .eq("id", conversacionId);
}

async function guardarSolicitudDB(conversacionId, datos) {
  if (!supabase) return;
  await supabase.from("solicitudes_pendientes").insert({
    conversacion_id: conversacionId,
    ...datos,
    estado: "pendiente",
  });
}

// ─── WhatsApp helpers ────────────────────────────────────────────────────────
function sendWhatsAppMessage(phoneNumberId, to, text) {
  if (!WHATSAPP_TOKEN) { console.warn("[WARN] WHATSAPP_TOKEN no configurado."); return; }

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
    res.on("data", (c) => (body += c));
    res.on("end", () => console.log(`[WhatsApp →] ${res.statusCode}`, body));
  });

  req.on("error", (e) => console.error("[WhatsApp] Error:", e.message));
  req.write(postData);
  req.end();
}

async function downloadWhatsAppMedia(mediaId) {
  if (!WHATSAPP_TOKEN) return null;
  try {
    // 1. Obtener URL del media
    const metaResp = await fetch(`https://graph.facebook.com/v17.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });
    const meta = await metaResp.json();
    if (!meta.url) return null;

    // 2. Descargar el binario
    const mediaResp = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });
    const buffer = Buffer.from(await mediaResp.arrayBuffer());
    return { buffer, mimeType: meta.mime_type || "image/jpeg" };
  } catch (e) {
    console.error("[Media] Error descargando:", e.message);
    return null;
  }
}

async function uploadImageToSupabase(buffer, mimeType, carpeta, nombre) {
  if (!supabase) return null;
  const ext = mimeType.split("/")[1] || "jpg";
  const filename = `${carpeta}/${nombre}_${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from("imagenes-comercios")
    .upload(filename, buffer, { contentType: mimeType, upsert: true });

  if (error) { console.error("[Storage] Error subiendo imagen:", error.message); return null; }

  const { data } = supabase.storage
    .from("imagenes-comercios")
    .getPublicUrl(filename);

  return data.publicUrl;
}

// ─── OpenAI helper ────────────────────────────────────────────────────────────
async function callOpenAI(systemPrompt, historialDB, nuevosMensajesOAI) {
  if (!OPENAI_API_KEY) return { tipo: "texto", contenido: "Hola, ¿en qué puedo ayudarte?" };

  // Convertir historial DB a formato OpenAI
  const historialOAI = historialDB.map((m) => {
    const role = m.direccion === "saliente" ? "assistant" : "user";
    if (m.tipo === "imagen" && m.url_medio) {
      return {
        role,
        content: [
          { type: "text", text: m.contenido || "[imagen]" },
          { type: "image_url", image_url: { url: m.url_medio } },
        ],
      };
    }
    return { role, content: m.contenido || "" };
  });

  const messages = [
    { role: "system", content: systemPrompt },
    ...historialOAI,
    ...nuevosMensajesOAI,
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: 400,
      temperature: 0.7,
    }),
  });

  const data = await resp.json();
  if (data.error) { console.error("[OpenAI] Error:", data.error.message); return { tipo: "texto", contenido: "Lo siento, no puedo responder ahora." }; }

  const choice = data.choices?.[0];

  // ¿Llamó a una función?
  if (choice?.finish_reason === "tool_calls" && choice?.message?.tool_calls?.length) {
    const toolCall = choice.message.tool_calls[0];
    try {
      const args = JSON.parse(toolCall.function.arguments);
      return { tipo: "tool_call", nombre: toolCall.function.name, args };
    } catch {
      return { tipo: "texto", contenido: "Lo siento, hubo un error procesando los datos." };
    }
  }

  return { tipo: "texto", contenido: choice?.message?.content?.trim() || "Lo siento, no puedo responder ahora." };
}

// ─── Lógica principal de procesamiento de mensaje ───────────────────────────
async function procesarMensaje(msg, value, phoneNumberId) {
  const telefono = msg.from || "unknown";

  // 1. Obtener/crear conversación
  const conv = await getOrCreateConversacion(telefono, phoneNumberId);

  // 2. Si la conversación ya está completada → no responder
  if (conv?.estado === "completada" || conv?.estado === "cerrada") {
    console.log(`[BOT] Conversación ${telefono} ya completada. Ignorando mensaje.`);
    return;
  }

  const convId = conv?.id ?? null;

  // 3. Procesar contenido del mensaje (texto o imagen)
  let textoMsg = "";
  let urlImagenSubida = null;
  const nuevosMensajesOAI = [];

  if (msg.type === "image" && msg.image) {
    console.log("[IMG] Imagen recibida, procesando...");
    const mediaData = await downloadWhatsAppMedia(msg.image.id);
    if (mediaData) {
      urlImagenSubida = await uploadImageToSupabase(
        mediaData.buffer,
        mediaData.mimeType,
        telefono,
        "img"
      );
    }

    textoMsg = msg.image.caption || "[El cliente envió una imagen]";

    // Construir mensaje para OpenAI con visión
    const contentArr = [{ type: "text", text: textoMsg }];
    if (urlImagenSubida) {
      contentArr.push({ type: "image_url", image_url: { url: urlImagenSubida } });
    }
    nuevosMensajesOAI.push({ role: "user", content: contentArr });

  } else {
    textoMsg = msg.text?.body || msg.body || JSON.stringify(msg);
    nuevosMensajesOAI.push({ role: "user", content: textoMsg });
  }

  // 4. Guardar mensaje entrante
  await guardarMensaje(
    convId, telefono, "entrante",
    msg.type === "image" ? "imagen" : "texto",
    textoMsg, urlImagenSubida
  );

  // 5. Cargar historial previo
  const historialDB = await getHistorial(convId, 30);
  // Quitar el último message que acabamos de insertar para no duplicar
  const historialSinUltimo = historialDB.slice(0, -1);

  // 6. Llamar a OpenAI
  const systemPrompt = await getSystemPrompt();
  const resultado = await callOpenAI(systemPrompt, historialSinUltimo, nuevosMensajesOAI);

  // 7. Manejar resultado
  if (resultado.tipo === "tool_call" && resultado.nombre === "guardar_solicitud") {
    console.log("[BOT] Guardando solicitud:", resultado.args);

    await guardarSolicitudDB(convId, resultado.args);
    await marcarConversacionCompletada(convId);

    const mensajeFinal =
      `✅ ¡Gracias ${resultado.args.nombre_persona}! Tu solicitud de suscripción a *RoaBusiness* para *${resultado.args.nombre_negocio}* ha sido registrada exitosamente.\n\n` +
      `📋 *Resumen:*\n` +
      `• Plan: ${resultado.args.plan_elegido}\n` +
      `• Dirección: ${resultado.args.direccion}\n` +
      `• Email: ${resultado.args.email}\n\n` +
      `Nuestro equipo revisará tu solicitud y comprobante de pago. Te contactaremos a la brevedad. 🚀`;

    sendWhatsAppMessage(phoneNumberId, telefono, mensajeFinal);
    await guardarMensaje(convId, telefono, "saliente", "texto", mensajeFinal);
    console.log(`[BOT] Solicitud guardada y conversación completada para ${telefono}`);

  } else {
    const reply = resultado.contenido;
    sendWhatsAppMessage(phoneNumberId, telefono, reply);
    await guardarMensaje(convId, telefono, "saliente", "texto", reply);
    console.log(`[BOT] Respondiendo a ${telefono}: ${reply.substring(0, 80)}...`);
  }
}

// ─── Rutas ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", (req, res) => {
  // Responder inmediatamente a WhatsApp
  res.sendStatus(200);

  if (!req.body?.entry) return;

  req.body.entry.forEach((entry) => {
    entry.changes?.forEach((change) => {
      const value = change.value;
      if (!value?.messages) return;

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) { console.warn("[WARN] phone_number_id no encontrado."); return; }

      value.messages.forEach((msg) => {
        // Procesar en background sin bloquear
        procesarMensaje(msg, value, phoneNumberId).catch((e) =>
          console.error("[ERROR] procesarMensaje:", e.message)
        );
      });
    });
  });
});

// ─── API interna de lectura ──────────────────────────────────────────────────
app.get("/mensajes", async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase
    .from("mensajes")
    .select("*")
    .order("creado_en", { ascending: false })
    .limit(100);
  res.json(data || []);
});

app.get("/solicitudes", async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase
    .from("solicitudes_pendientes")
    .select("*")
    .order("creado_en", { ascending: false });
  res.json(data || []);
});

// ─── Servidor ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
