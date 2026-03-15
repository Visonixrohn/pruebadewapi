const express = require("express");
require("dotenv").config();
const path = require("path");
const https = require("https");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Config ───────────────────────────────────────────────────────────────────
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN   || "verify_token_here";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_MODEL   = process.env.OPENAI_MODEL   || "gpt-4o-mini";
// REPLY_AFTER_ATTENDED=false en Vercel para silenciar el bot tras completar
const REPLY_ATTENDED = process.env.REPLY_AFTER_ATTENDED !== "false";

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

if (!supabase) console.warn("[WARN] Supabase no configurado.");

// ─── Respuestas fijas locales (fallback si Supabase no disponible) ────────────
const FALLBACK_RESPONSES = {
  welcome:
    "¡Hola! 👋 Bienvenido a *RoaBusiness*, el directorio digital para negocios.\n\n¿Cuál es el *nombre de tu negocio*?",
  waiting_business_name: "Por favor dinos el *nombre de tu negocio* para continuar.",
  waiting_contact_phone: "¡Genial! ¿Cuál es el *teléfono de contacto* de tu negocio?",
  waiting_description: "Perfecto 👍 Cuéntanos brevemente *a qué se dedica* tu negocio.",
  waiting_plan:
    "Elige tu plan:\n\n🔹 *Básico* $9.99/mes\n🔸 *Profesional* $19.99/mes\n⭐ *Premium* $34.99/mes\n\nResponde: Básico, Profesional o Premium",
  waiting_logo: "¡Plan registrado! ✅ Ahora envía el *logo* de tu negocio como imagen.",
  waiting_cover: "¡Logo recibido! ✅ Ahora envía la *imagen de portada* de tu negocio.",
  waiting_payment_proof:
    "¡Portada recibida! ✅ Realiza tu pago y envía el *comprobante* como imagen.",
  complete:
    "✅ ¡Registro completado! Tu solicitud para *{business}* está en revisión. Te contactaremos pronto. 🚀",
  attended:
    "Tu solicitud ya fue recibida y está *pendiente de aprobación*. Pronto te contactaremos. 🙌",
  invalid_plan: "Por favor elige: *Básico*, *Profesional* o *Premium*.",
  need_image: "Por favor envía la imagen para continuar. 📷",
};

// ─── Cache bot_responses de Supabase (recarga cada 10 min) ────────────────────
let responsesCache = { data: {}, ts: 0 };

async function getFixedResponse(key) {
  if (supabase) {
    if (Date.now() - responsesCache.ts > 10 * 60 * 1000) {
      try {
        const { data } = await supabase
          .from("bot_responses")
          .select("state_key, message")
          .eq("activo", true);
        if (data?.length) {
          responsesCache.data = Object.fromEntries(data.map((r) => [r.state_key, r.message]));
          responsesCache.ts = Date.now();
          console.log("[Cache] bot_responses recargado:", Object.keys(responsesCache.data).length, "entradas");
        }
      } catch (e) {
        console.error("[Supabase] Error cargando bot_responses:", e.message);
      }
    }
    if (responsesCache.data[key]) return responsesCache.data[key];
  }
  return FALLBACK_RESPONSES[key] || null;
}

// ─── Leads helpers ────────────────────────────────────────────────────────────
async function getOrCreateLead(telefono, phoneNumberId) {
  if (!supabase) return { id: null, user_phone: telefono, bot_status: "new_lead" };

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("user_phone", telefono)
    .maybeSingle();

  if (error) console.error("[Supabase] getOrCreateLead:", error.message);
  if (data) return data;

  const { data: nuevo, error: e2 } = await supabase
    .from("leads")
    .insert({
      user_phone: telefono,
      phone_number_id: phoneNumberId,
      bot_status: "new_lead",
      source: "whatsapp",
    })
    .select()
    .single();

  if (e2) console.error("[Supabase] insert lead:", e2.message);
  return nuevo || { id: null, user_phone: telefono, bot_status: "new_lead" };
}

async function updateLead(id, fields) {
  if (!supabase || !id) return;
  const { error } = await supabase
    .from("leads")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[Supabase] updateLead:", error.message);
}

async function saveMessage(leadId, telefono, direccion, tipo, contenido, urlMedio = null) {
  if (!supabase) return;
  await supabase.from("mensajes").insert({
    lead_id: leadId,
    conversacion_id: null,
    telefono,
    direccion,
    tipo,
    contenido,
    url_medio: urlMedio,
  });
}

async function guardarSolicitud(lead, paymentUrl) {
  if (!supabase) return;
  await supabase
    .from("solicitudes_pendientes")
    .insert({
      conversacion_id: null,
      nombre_persona: lead.user_phone,
      nombre_negocio: lead.business_name || "Sin nombre",
      direccion: "—",
      telefonos: lead.contact_phone || lead.user_phone,
      email: "—",
      plan_elegido: lead.plan_elegido || "Sin plan",
      url_logo: lead.logo_url,
      url_portada: lead.cover_url,
      url_comprobante_pago: paymentUrl,
      estado: "pendiente",
    })
    .catch((e) => console.error("[Supabase] guardarSolicitud:", e.message));
}

// ─── WhatsApp helpers ─────────────────────────────────────────────────────────
function sendWhatsAppMessage(phoneNumberId, to, text) {
  if (!WHATSAPP_TOKEN) { console.warn("[WARN] WHATSAPP_TOKEN no configurado."); return; }

  const postData = JSON.stringify({ messaging_product: "whatsapp", to, text: { body: text } });
  const opts = {
    hostname: "graph.facebook.com",
    path: `/v17.0/${phoneNumberId}/messages`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
  };
  const req = https.request(opts, (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => console.log(`[WA →] ${res.statusCode}`));
  });
  req.on("error", (e) => console.error("[WA] Error:", e.message));
  req.write(postData);
  req.end();
}

async function downloadWhatsAppMedia(mediaId) {
  if (!WHATSAPP_TOKEN) return null;
  try {
    const metaResp = await fetch(`https://graph.facebook.com/v17.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });
    const meta = await metaResp.json();
    if (!meta.url) return null;
    const mediaResp = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });
    const buffer = Buffer.from(await mediaResp.arrayBuffer());
    return { buffer, mimeType: meta.mime_type || "image/jpeg" };
  } catch (e) {
    console.error("[Media] Error:", e.message);
    return null;
  }
}

async function uploadImageToSupabase(buffer, mimeType, telefono, tipo) {
  if (!supabase) return null;
  const ext  = mimeType.split("/")[1] || "jpg";
  const file = `${telefono}/${tipo}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("imagenes-comercios")
    .upload(file, buffer, { contentType: mimeType, upsert: true });
  if (error) { console.error("[Storage] Error:", error.message); return null; }
  const { data } = supabase.storage.from("imagenes-comercios").getPublicUrl(file);
  return data.publicUrl;
}

// ─── OpenAI — SOLO fallback ───────────────────────────────────────────────────
let openaiCallCount = 0;

async function openAI_Fallback(lead, ultimoMensaje) {
  if (!OPENAI_API_KEY) return null;

  openaiCallCount++;
  console.log(
    `[OpenAI] 🔴 LLAMADA #${openaiCallCount} | estado: ${lead.bot_status} | msg: "${ultimoMensaje.substring(0, 60)}"`
  );

  // Solo se envía: prompt corto + contexto mínimo + último mensaje. CERO historial.
  const ctx = [
    `Estado: ${lead.bot_status}`,
    lead.business_name ? `Negocio: ${lead.business_name}` : null,
    lead.contact_phone ? `Tel: ${lead.contact_phone}`     : null,
    lead.plan_elegido  ? `Plan: ${lead.plan_elegido}`     : null,
  ].filter(Boolean).join(". ");

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: "Eres vendedor breve de ROA Business. Responde corto y directo. Avanza al siguiente dato del registro.",
          },
          { role: "user", content: `${ctx}\nMensaje: "${ultimoMensaje}"` },
        ],
        max_tokens: 80,
        temperature: 0.4,
      }),
    });

    const data = await resp.json();
    if (data.error) { console.error("[OpenAI] Error:", data.error.message); return null; }
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("[OpenAI] Error:", e.message);
    return null;
  }
}

// ─── Detectores locales (sin IA) ─────────────────────────────────────────────
const RE_SALUDO = /^(hola|hi|hello|buenas|buen[ao]s?\s?(d[ií]as?|tardes?|noches?)|info|informaci[oó]n|precio|precios|planes?)[\s!?.]*$/i;

function detectarPlan(texto) {
  const t = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/premium|34/.test(t)              || t === "3") return "Premium";
  if (/profesional|professional|19/.test(t) || t === "2") return "Profesional";
  if (/basico|basic|9/.test(t)          || t === "1") return "Básico";
  return null;
}

function esTextoUtil(texto) {
  return !!texto && texto.trim().length > 1
    && !texto.startsWith("{") && !texto.startsWith("[");
}

// ─── Máquina de estados ───────────────────────────────────────────────────────
async function stateMachine(lead, textoMsg, urlImagen) {
  const estado = lead.bot_status;
  let reply     = null;
  let nextState = null;

  switch (estado) {

    case "new_lead": {
      reply     = await getFixedResponse("welcome");
      nextState = "waiting_business_name";
      console.log("[FSM] ✅ Fija: bienvenida");
      break;
    }

    case "waiting_business_name": {
      if (esTextoUtil(textoMsg) && !RE_SALUDO.test(textoMsg)) {
        await updateLead(lead.id, { business_name: textoMsg.trim() });
        reply     = await getFixedResponse("waiting_contact_phone");
        nextState = "waiting_contact_phone";
        console.log(`[FSM] ✅ Fija: nombre="${textoMsg.trim()}"`);
      } else {
        // Saludo sin dato → OpenAI para responder amablemente (único caso aquí)
        reply = await openAI_Fallback(lead, textoMsg)
             || await getFixedResponse("waiting_business_name");
      }
      break;
    }

    case "waiting_contact_phone": {
      if (esTextoUtil(textoMsg)) {
        await updateLead(lead.id, { contact_phone: textoMsg.trim() });
        reply     = await getFixedResponse("waiting_description");
        nextState = "waiting_description";
        console.log("[FSM] ✅ Fija: teléfono guardado");
      } else {
        reply = await getFixedResponse("waiting_contact_phone");
      }
      break;
    }

    case "waiting_description": {
      if (esTextoUtil(textoMsg)) {
        await updateLead(lead.id, { business_description: textoMsg.trim() });
        reply     = await getFixedResponse("waiting_plan");
        nextState = "waiting_plan";
        console.log("[FSM] ✅ Fija: descripción guardada");
      } else {
        reply = await getFixedResponse("waiting_description");
      }
      break;
    }

    case "waiting_plan": {
      const plan = detectarPlan(textoMsg);
      if (plan) {
        await updateLead(lead.id, { plan_elegido: plan });
        reply     = await getFixedResponse("waiting_logo");
        nextState = "waiting_logo";
        console.log(`[FSM] ✅ Fija: plan="${plan}"`);
      } else {
        // Respuesta ambigua → OpenAI interpreta cuál plan
        reply = await openAI_Fallback(lead, textoMsg)
             || await getFixedResponse("invalid_plan");
        console.log("[FSM] 🔴 OpenAI: interpretar plan");
      }
      break;
    }

    case "waiting_logo": {
      if (urlImagen) {
        await updateLead(lead.id, { logo_url: urlImagen });
        reply     = await getFixedResponse("waiting_cover");
        nextState = "waiting_cover";
        console.log("[FSM] ✅ Fija: logo guardado");
      } else {
        reply = await getFixedResponse("need_image");
      }
      break;
    }

    case "waiting_cover": {
      if (urlImagen) {
        await updateLead(lead.id, { cover_url: urlImagen });
        reply     = await getFixedResponse("waiting_payment_proof");
        nextState = "waiting_payment_proof";
        console.log("[FSM] ✅ Fija: portada guardada");
      } else {
        reply = await getFixedResponse("need_image");
      }
      break;
    }

    case "waiting_payment_proof": {
      if (urlImagen) {
        await updateLead(lead.id, { payment_proof_url: urlImagen, bot_status: "attended" });
        await guardarSolicitud({ ...lead }, urlImagen);

        const tpl = await getFixedResponse("complete") || FALLBACK_RESPONSES.complete;
        reply = tpl.replace("{business}", lead.business_name || "tu negocio");
        nextState = null; // ya seteamos bot_status arriba
        console.log(`[FSM] ✅ COMPLETO: ${lead.user_phone} → attended. Sin más OpenAI.`);
      } else {
        reply = await getFixedResponse("need_image");
      }
      break;
    }

    case "pending_approval":
    case "attended": {
      if (REPLY_ATTENDED) {
        reply = await getFixedResponse("attended");
        console.log("[FSM] ✅ Fija: attended, cero OpenAI.");
      } else {
        console.log("[FSM] 🔇 attended + REPLY_AFTER_ATTENDED=false → silencio.");
      }
      break;
    }

    default: {
      console.warn("[FSM] ⚠ Estado desconocido:", estado);
      reply = await openAI_Fallback(lead, textoMsg) || "¿En qué puedo ayudarte?";
      break;
    }
  }

  if (nextState && lead.id) {
    await updateLead(lead.id, { bot_status: nextState });
  }

  return reply;
}

// ─── Procesamiento principal del mensaje ──────────────────────────────────────
async function procesarMensaje(msg, phoneNumberId) {
  const telefono = msg.from || "unknown";

  // 1. Obtener/crear lead
  const lead = await getOrCreateLead(telefono, phoneNumberId);

  // 2. Corte temprano: lead atendido → CERO OpenAI
  if (lead.bot_status === "attended" || lead.bot_status === "pending_approval") {
    console.log(`[BOT] ${telefono} ya atendido → sin OpenAI.`);
    await saveMessage(lead.id, telefono, "entrante", "texto",
      msg.text?.body || msg.type || "[msg]");
    if (REPLY_ATTENDED) {
      const r = await getFixedResponse("attended");
      if (r) {
        sendWhatsAppMessage(phoneNumberId, telefono, r);
        await saveMessage(lead.id, telefono, "saliente", "texto", r);
      }
    }
    return;
  }

  // 3. Extraer contenido — imágenes procesadas localmente sin OpenAI
  let textoMsg  = "";
  let urlImagen = null;

  if (msg.type === "image" && msg.image) {
    const tipoImg = { waiting_logo: "logo", waiting_cover: "portada" }[lead.bot_status] || "comprobante";
    const media   = await downloadWhatsAppMedia(msg.image.id);
    if (media) {
      urlImagen = await uploadImageToSupabase(media.buffer, media.mimeType, telefono, tipoImg);
    }
    textoMsg = msg.image.caption || "[imagen]";
    console.log(`[BOT] 🖼 Imagen (${tipoImg}) → ${urlImagen ? "subida OK" : "error de subida"}`);
  } else {
    textoMsg = msg.text?.body?.trim() || msg.body || "[msg]";
  }

  // 4. Guardar mensaje entrante
  await saveMessage(lead.id, telefono, "entrante",
    msg.type === "image" ? "imagen" : "texto", textoMsg, urlImagen);

  // 5. Máquina de estados (OpenAI solo en casos exceptionales)
  const reply = await stateMachine(lead, textoMsg, urlImagen);

  // 6. Enviar respuesta
  if (reply) {
    sendWhatsAppMessage(phoneNumberId, telefono, reply);
    await saveMessage(lead.id, telefono, "saliente", "texto", reply);
  }
}

// ─── Rutas ────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  if (!req.body?.entry) return;
  req.body.entry.forEach((entry) => {
    entry.changes?.forEach((change) => {
      const value = change.value;
      if (!value?.messages) return;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) return;
      value.messages.forEach((msg) => {
        procesarMensaje(msg, phoneNumberId).catch((e) =>
          console.error("[ERROR] procesarMensaje:", e.message)
        );
      });
    });
  });
});

app.get("/mensajes", async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase
    .from("mensajes").select("*")
    .order("creado_en", { ascending: false }).limit(100);
  res.json(data || []);
});

app.get("/solicitudes", async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase
    .from("solicitudes_pendientes").select("*")
    .order("creado_en", { ascending: false });
  res.json(data || []);
});

app.get("/leads", async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase
    .from("leads").select("*")
    .order("created_at", { ascending: false });
  res.json(data || []);
});

// ─── Servidor ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
