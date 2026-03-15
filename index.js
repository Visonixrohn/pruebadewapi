const express = require("express");
require("dotenv").config();
const path = require("path");
const https = require("https");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Config ───────────────────────────────────────────────────────────────────
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "verify_token_here";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const REPLY_ATTENDED = process.env.REPLY_AFTER_ATTENDED !== "false";

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

if (!supabase) console.warn("[WARN] Supabase no configurado.");

// ─── Respuestas fijas locales (fallback sin Supabase) ─────────────────────────
// Formato: { text, buttons }  donde buttons = [{id, title}] o null
const FALLBACK_RESPONSES = {
  welcome: {
    text: "¡Hola! 👋 Bienvenido a *RoaBusiness*, el directorio digital para negocios.\n\n¿Cómo podemos ayudarte hoy?",
    buttons: [
      { id: "btn_registro", title: "Registrar mi negocio" },
      { id: "btn_admin", title: "Hablar con un asesor" },
    ],
  },
  waiting_intent: {
    text: "Por favor selecciona una opción 👇",
    buttons: [
      { id: "btn_registro", title: "Registrar mi negocio" },
      { id: "btn_admin", title: "Hablar con un asesor" },
    ],
  },
  waiting_business_name: {
    text: "¿Cuál es el *nombre de tu negocio*?",
    buttons: null,
  },
  waiting_contact_phone: {
    text: "¡Genial! ¿Cuál es el *teléfono de contacto* de tu negocio?",
    buttons: null,
  },
  waiting_description: {
    text: "Perfecto 👍 Cuéntanos brevemente *a qué se dedica* tu negocio.",
    buttons: null,
  },
  waiting_plan: {
    text: "Elige tu plan 👇",
    buttons: [
      { id: "btn_basico", title: "Básico $9.99/mes" },
      { id: "btn_profesional", title: "Profesional $19.99/mes" },
      { id: "btn_premium", title: "Premium $34.99/mes" },
    ],
  },
  waiting_logo: {
    text: "¡Plan registrado! ✅ Ahora envía el *logo* de tu negocio como imagen.",
    buttons: null,
  },
  waiting_cover: {
    text: "¡Logo recibido! ✅ Ahora envía la *imagen de portada* de tu negocio.",
    buttons: null,
  },
  waiting_payment_proof: {
    text: "¡Portada recibida! ✅ Realiza tu pago y envía el *comprobante* como imagen.",
    buttons: null,
  },
  waiting_confirmation: {
    text: "📋 *Resumen de tu solicitud:*\n\n🏢 Negocio: {business}\n📞 Teléfono: {phone}\n📝 Descripción: {desc}\n💼 Plan: {plan}\n\n¿Confirmas el registro?",
    buttons: [
      { id: "btn_confirmar", title: "✅ Confirmar registro" },
      { id: "btn_cancelar", title: "❌ Cancelar" },
    ],
  },
  complete: {
    text: "✅ ¡Registro completado! Tu solicitud para *{business}* está en revisión. Te contactaremos pronto. 🚀",
    buttons: null,
  },
  attended: {
    text: "Tu solicitud ya fue recibida y está *pendiente de aprobación*. Pronto te contactaremos. 🙌",
    buttons: null,
  },
  contact_admin: {
    text: "📞 Un asesor de *RoaBusiness* se pondrá en contacto contigo muy pronto.\n\nTambién puedes escribirnos a: _admin@roabusiness.com_ 🙌",
    buttons: null,
  },
  invalid_plan: {
    text: "Por favor elige una de las opciones de plan 👇",
    buttons: [
      { id: "btn_basico", title: "Básico $9.99/mes" },
      { id: "btn_profesional", title: "Profesional $19.99/mes" },
      { id: "btn_premium", title: "Premium $34.99/mes" },
    ],
  },
  need_image: {
    text: "Por favor envía la imagen para continuar. 📷",
    buttons: null,
  },
  cancelled: {
    text: "Registro cancelado. Si cambias de opinión, escríbenos cuando quieras. 😊",
    buttons: null,
  },
};

// ─── Cache bot_responses + preguntas (recarga cada 10 min) ────────────────────
let responsesCache = { data: {}, ts: 0 };
let preguntasCache = { data: [], ts: 0 };
const CACHE_TTL = 10 * 60 * 1000;

async function reloadCaches() {
  if (!supabase) return;
  const now = Date.now();

  if (now - responsesCache.ts > CACHE_TTL) {
    try {
      const { data } = await supabase
        .from("bot_responses")
        .select("state_key, message, buttons")
        .eq("activo", true);
      if (data?.length) {
        responsesCache.data = Object.fromEntries(
          data.map((r) => [
            r.state_key,
            { text: r.message, buttons: r.buttons || null },
          ]),
        );
        responsesCache.ts = now;
        console.log(
          "[Cache] bot_responses recargado:",
          Object.keys(responsesCache.data).length,
        );
      }
    } catch (e) {
      console.error("[Cache] bot_responses error:", e.message);
    }
  }

  if (now - preguntasCache.ts > CACHE_TTL) {
    try {
      const { data } = await supabase
        .from("preguntas")
        .select("keywords, respuesta, buttons, prioridad")
        .eq("activo", true)
        .order("prioridad", { ascending: false });
      if (data?.length) {
        preguntasCache.data = data;
        preguntasCache.ts = now;
        console.log("[Cache] preguntas recargado:", data.length);
      }
    } catch (e) {
      console.error("[Cache] preguntas error:", e.message);
    }
  }
}

// { text, buttons } | null
async function getFixedResponse(key) {
  await reloadCaches();
  return responsesCache.data[key] || FALLBACK_RESPONSES[key] || null;
}

// Busca FAQ por palabras clave en el texto — sin IA
async function matchPregunta(texto) {
  await reloadCaches();
  const t = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const p of preguntasCache.data) {
    if (p.keywords.some((kw) => t.includes(kw.toLowerCase()))) {
      return { text: p.respuesta, buttons: p.buttons || null };
    }
  }
  return null;
}

// ─── Leads helpers ────────────────────────────────────────────────────────────
async function getOrCreateLead(telefono, phoneNumberId) {
  if (!supabase)
    return { id: null, user_phone: telefono, bot_status: "new_lead" };

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("user_phone", telefono)
    .maybeSingle();
  if (error) console.error("[DB] getOrCreateLead:", error.message);
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
  if (e2) console.error("[DB] insert lead:", e2.message);
  return nuevo || { id: null, user_phone: telefono, bot_status: "new_lead" };
}

async function updateLead(id, fields) {
  if (!supabase || !id) return;
  const { error } = await supabase
    .from("leads")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[DB] updateLead:", error.message);
}

async function saveMessage(
  leadId,
  telefono,
  direccion,
  tipo,
  contenido,
  urlMedio = null,
) {
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

async function guardarSolicitud(lead) {
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
      url_comprobante_pago: lead.payment_proof_url,
      estado: "pendiente",
    })
    .catch((e) => console.error("[DB] guardarSolicitud:", e.message));
}

// ─── WhatsApp: mensaje de texto ───────────────────────────────────────────────
function sendWhatsAppMessage(phoneNumberId, to, text) {
  if (!WHATSAPP_TOKEN) {
    console.warn("[WARN] WHATSAPP_TOKEN no configurado.");
    return;
  }
  waPost(
    phoneNumberId,
    JSON.stringify({ messaging_product: "whatsapp", to, text: { body: text } }),
  );
}

// ─── WhatsApp: mensaje interactivo con botones ────────────────────────────────
// buttons: [{id: "btn_id", title: "Texto botón"}]  (máx 3)
function sendWhatsAppInteractive(phoneNumberId, to, bodyText, buttons) {
  if (!WHATSAPP_TOKEN) {
    console.warn("[WARN] WHATSAPP_TOKEN no configurado.");
    return;
  }
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title.substring(0, 20) },
        })),
      },
    },
  };
  waPost(phoneNumberId, JSON.stringify(payload));
}

// ─── WhatsApp: envía POST a Graph API ────────────────────────────────────────
function waPost(phoneNumberId, postData) {
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

// ─── Helper: envía texto o interactivo según si hay botones ──────────────────
async function sendReply(phoneNumberId, to, replyObj, leadId, telefono) {
  if (!replyObj?.text) return;
  if (replyObj.buttons?.length) {
    sendWhatsAppInteractive(phoneNumberId, to, replyObj.text, replyObj.buttons);
  } else {
    sendWhatsAppMessage(phoneNumberId, to, replyObj.text);
  }
  await saveMessage(leadId, telefono, "saliente", "texto", replyObj.text);
}

// ─── Descargar y subir imágenes — sin OpenAI ─────────────────────────────────
async function downloadWhatsAppMedia(mediaId) {
  if (!WHATSAPP_TOKEN) return null;
  try {
    const metaResp = await fetch(
      `https://graph.facebook.com/v17.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      },
    );
    const meta = await metaResp.json();
    if (!meta.url) return null;
    const mediaResp = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });
    return {
      buffer: Buffer.from(await mediaResp.arrayBuffer()),
      mimeType: meta.mime_type || "image/jpeg",
    };
  } catch (e) {
    console.error("[Media] Error:", e.message);
    return null;
  }
}

async function uploadImageToSupabase(buffer, mimeType, telefono, tipo) {
  if (!supabase) return null;
  const ext = mimeType.split("/")[1] || "jpg";
  const file = `${telefono}/${tipo}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("imagenes-comercios")
    .upload(file, buffer, { contentType: mimeType, upsert: true });
  if (error) {
    console.error("[Storage] Error:", error.message);
    return null;
  }
  return supabase.storage.from("imagenes-comercios").getPublicUrl(file).data
    .publicUrl;
}

// ─── OpenAI — SOLO fallback, contexto mínimo ─────────────────────────────────
let openaiCallCount = 0;
async function openAI_Fallback(lead, ultimoMensaje) {
  if (!OPENAI_API_KEY) return null;
  openaiCallCount++;
  console.log(
    `[OpenAI] 🔴 LLAMADA #${openaiCallCount} | ${lead.bot_status} | "${ultimoMensaje.substring(0, 50)}"`,
  );
  const ctx = [
    `Estado: ${lead.bot_status}`,
    lead.business_name ? `Negocio: ${lead.business_name}` : null,
    lead.contact_phone ? `Tel: ${lead.contact_phone}` : null,
    lead.plan_elegido ? `Plan: ${lead.plan_elegido}` : null,
  ]
    .filter(Boolean)
    .join(". ");
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
            content:
              "Eres vendedor breve de ROA Business. Responde corto y directo. Avanza al siguiente dato del registro.",
          },
          { role: "user", content: `${ctx}\nMensaje: "${ultimoMensaje}"` },
        ],
        max_tokens: 80,
        temperature: 0.4,
      }),
    });
    const data = await resp.json();
    if (data.error) {
      console.error("[OpenAI] Error:", data.error.message);
      return null;
    }
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("[OpenAI] Error:", e.message);
    return null;
  }
}

// ─── Detectores locales ───────────────────────────────────────────────────────
const RE_SALUDO =
  /^(hola|hi|hello|buenas|buen[ao]s?\s?(d[ií]as?|tardes?|noches?))[\s!?.]*$/i;

function detectarPlan(texto) {
  const t = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/premium|34/.test(t) || t === "3" || t === "btn_premium")
    return "Premium";
  if (
    /profesional|professional|19/.test(t) ||
    t === "2" ||
    t === "btn_profesional"
  )
    return "Profesional";
  if (/basico|basic|9/.test(t) || t === "1" || t === "btn_basico")
    return "Básico";
  return null;
}
function esTextoUtil(t) {
  return !!t && t.trim().length > 1 && !t.startsWith("{");
}

// ─── Máquina de estados ───────────────────────────────────────────────────────
// Devuelve { text, buttons } | null
async function stateMachine(lead, textoMsg, urlImagen, buttonId) {
  const estado = lead.bot_status;
  let replyObj = null;
  let nextState = null;

  switch (estado) {
    // ── 1. Primer contacto → bienvenida + botones ──────────────────────────
    case "new_lead": {
      replyObj = await getFixedResponse("welcome");
      nextState = "waiting_intent";
      console.log("[FSM] ✅ Fija: bienvenida con botones");
      break;
    }

    // ── 2. Espera que el usuario seleccione botón ──────────────────────────
    case "waiting_intent": {
      const btn = buttonId || textoMsg.toLowerCase();

      if (
        btn === "btn_registro" ||
        /registrar|registro|quiero registr/i.test(textoMsg)
      ) {
        replyObj = await getFixedResponse("waiting_business_name");
        nextState = "waiting_business_name";
        console.log("[FSM] ✅ Fija: → registro, pidiendo nombre");
      } else if (
        btn === "btn_admin" ||
        /asesor|admin|hablar|llamar|contacto/i.test(textoMsg)
      ) {
        replyObj = await getFixedResponse("contact_admin");
        nextState = "attended";
        console.log("[FSM] ✅ Fija: → contacto admin, fin");
      } else {
        // Intento de FAQ antes de OpenAI
        const faqMatch = await matchPregunta(textoMsg);
        if (faqMatch) {
          replyObj = faqMatch;
          console.log("[FSM] ✅ FAQ: respuesta sin OpenAI");
        } else {
          const aiReply = await openAI_Fallback(lead, textoMsg);
          replyObj = aiReply
            ? {
                text: aiReply,
                buttons: (await getFixedResponse("waiting_intent"))?.buttons,
              }
            : await getFixedResponse("waiting_intent");
        }
      }
      break;
    }

    // ── 3. Nombre del negocio ──────────────────────────────────────────────
    case "waiting_business_name": {
      if (esTextoUtil(textoMsg) && !RE_SALUDO.test(textoMsg)) {
        await updateLead(lead.id, { business_name: textoMsg.trim() });
        replyObj = await getFixedResponse("waiting_contact_phone");
        nextState = "waiting_contact_phone";
        console.log(`[FSM] ✅ Fija: nombre="${textoMsg.trim()}"`);
      } else {
        const faqMatch = await matchPregunta(textoMsg);
        replyObj =
          faqMatch || {
            text: (await openAI_Fallback(lead, textoMsg)) || "",
            buttons: null,
          } ||
          (await getFixedResponse("waiting_business_name"));
        if (!replyObj.text)
          replyObj = await getFixedResponse("waiting_business_name");
      }
      break;
    }

    // ── 4. Teléfono ────────────────────────────────────────────────────────
    case "waiting_contact_phone": {
      if (esTextoUtil(textoMsg)) {
        await updateLead(lead.id, { contact_phone: textoMsg.trim() });
        replyObj = await getFixedResponse("waiting_description");
        nextState = "waiting_description";
        console.log("[FSM] ✅ Fija: teléfono guardado");
      } else {
        replyObj = await getFixedResponse("waiting_contact_phone");
      }
      break;
    }

    // ── 5. Descripción ─────────────────────────────────────────────────────
    case "waiting_description": {
      if (esTextoUtil(textoMsg)) {
        await updateLead(lead.id, { business_description: textoMsg.trim() });
        replyObj = await getFixedResponse("waiting_plan");
        nextState = "waiting_plan";
        console.log("[FSM] ✅ Fija: descripción + botones de plan");
      } else {
        replyObj = await getFixedResponse("waiting_description");
      }
      break;
    }

    // ── 6. Plan (botones o texto) ──────────────────────────────────────────
    case "waiting_plan": {
      const planBtn = buttonId ? detectarPlan(buttonId) : null;
      const planTxt = detectarPlan(textoMsg);
      const plan = planBtn || planTxt;

      if (plan) {
        await updateLead(lead.id, { plan_elegido: plan });
        replyObj = await getFixedResponse("waiting_logo");
        nextState = "waiting_logo";
        console.log(`[FSM] ✅ Fija: plan="${plan}"`);
      } else {
        replyObj = await getFixedResponse("invalid_plan");
      }
      break;
    }

    // ── 7. Logo ────────────────────────────────────────────────────────────
    case "waiting_logo": {
      if (urlImagen) {
        await updateLead(lead.id, { logo_url: urlImagen });
        replyObj = await getFixedResponse("waiting_cover");
        nextState = "waiting_cover";
        console.log("[FSM] ✅ Fija: logo guardado");
      } else {
        replyObj = await getFixedResponse("need_image");
      }
      break;
    }

    // ── 8. Portada ─────────────────────────────────────────────────────────
    case "waiting_cover": {
      if (urlImagen) {
        await updateLead(lead.id, { cover_url: urlImagen });
        replyObj = await getFixedResponse("waiting_payment_proof");
        nextState = "waiting_payment_proof";
        console.log("[FSM] ✅ Fija: portada guardada");
      } else {
        replyObj = await getFixedResponse("need_image");
      }
      break;
    }

    // ── 9. Comprobante → mostrar resumen + confirmar ───────────────────────
    case "waiting_payment_proof": {
      if (urlImagen) {
        // Guardar URL del comprobante temporalmente en el lead
        await updateLead(lead.id, { payment_proof_url: urlImagen });
        // Obtener lead actualizado para el resumen
        const updatedLead = { ...lead, payment_proof_url: urlImagen };

        const tpl = await getFixedResponse("waiting_confirmation");
        const text = (tpl?.text || FALLBACK_RESPONSES.waiting_confirmation.text)
          .replace("{business}", updatedLead.business_name || "—")
          .replace("{phone}", updatedLead.contact_phone || "—")
          .replace(
            "{desc}",
            (updatedLead.business_description || "—").substring(0, 80),
          )
          .replace("{plan}", updatedLead.plan_elegido || "—");

        replyObj = {
          text,
          buttons:
            tpl?.buttons || FALLBACK_RESPONSES.waiting_confirmation.buttons,
        };
        nextState = "waiting_confirmation";
        console.log("[FSM] ✅ Fija: resumen + botones confirmar/cancelar");
      } else {
        replyObj = await getFixedResponse("need_image");
      }
      break;
    }

    // ── 10. Confirmación final ─────────────────────────────────────────────
    case "waiting_confirmation": {
      const btn = buttonId || textoMsg.toLowerCase();

      if (
        btn === "btn_confirmar" ||
        /confirm|si|sí|acepto|ok|registr/i.test(textoMsg)
      ) {
        // GUARDAR SOLICITUD — cero OpenAI
        await guardarSolicitud(lead);
        await updateLead(lead.id, { bot_status: "attended" });

        const tpl = await getFixedResponse("complete");
        replyObj = {
          text: (tpl?.text || FALLBACK_RESPONSES.complete.text).replace(
            "{business}",
            lead.business_name || "tu negocio",
          ),
          buttons: null,
        };
        nextState = null; // ya actualizamos bot_status arriba
        console.log(`[FSM] ✅ COMPLETO y guardado: ${lead.user_phone}`);
      } else if (
        btn === "btn_cancelar" ||
        /cancel|no |no$|no\b/i.test(textoMsg)
      ) {
        await updateLead(lead.id, { bot_status: "attended" });
        replyObj = (await getFixedResponse("cancelled")) || {
          text: "Registro cancelado. ¡Escríbenos si cambias de opinión! 😊",
          buttons: null,
        };
        nextState = null;
        console.log("[FSM] ✅ Fija: cancelado");
      } else {
        // No se entendió → volver a mostrar botones
        replyObj = await getFixedResponse("waiting_confirmation");
        const tpl = replyObj;
        const text = (tpl?.text || "")
          .replace("{business}", lead.business_name || "—")
          .replace("{phone}", lead.contact_phone || "—")
          .replace(
            "{desc}",
            (lead.business_description || "—").substring(0, 80),
          )
          .replace("{plan}", lead.plan_elegido || "—");
        replyObj = { text, buttons: tpl?.buttons };
      }
      break;
    }

    // ── Atendido / pendiente (cero OpenAI) ────────────────────────────────
    case "pending_approval":
    case "attended": {
      if (REPLY_ATTENDED) {
        replyObj = await getFixedResponse("attended");
        console.log("[FSM] ✅ Fija: attended, cero OpenAI.");
      } else {
        console.log("[FSM] 🔇 attended + REPLY_AFTER_ATTENDED=false.");
      }
      break;
    }

    default: {
      console.warn("[FSM] ⚠ Estado desconocido:", estado);
      replyObj = {
        text:
          (await openAI_Fallback(lead, textoMsg)) || "¿En qué puedo ayudarte?",
        buttons: null,
      };
    }
  }

  if (nextState && lead.id) {
    await updateLead(lead.id, { bot_status: nextState });
  }

  return replyObj;
}

// ─── Procesamiento principal ──────────────────────────────────────────────────
async function procesarMensaje(msg, phoneNumberId) {
  const telefono = msg.from || "unknown";
  const lead = await getOrCreateLead(telefono, phoneNumberId);

  // Corte temprano: ya atendido → cero OpenAI
  if (
    lead.bot_status === "attended" ||
    lead.bot_status === "pending_approval"
  ) {
    console.log(`[BOT] ${telefono} ya atendido → sin OpenAI.`);
    await saveMessage(
      lead.id,
      telefono,
      "entrante",
      "texto",
      msg.text?.body || msg.type || "[msg]",
    );
    if (REPLY_ATTENDED) {
      const r = await getFixedResponse("attended");
      await sendReply(phoneNumberId, telefono, r, lead.id, telefono);
    }
    return;
  }

  // Extraer contenido
  let textoMsg = "";
  let urlImagen = null;
  let buttonId = null; // id del botón si es mensaje interactivo

  if (msg.type === "interactive" && msg.interactive?.type === "button_reply") {
    // ── Botón pulsado ──────────────────────────────────────────────────────
    buttonId = msg.interactive.button_reply.id;
    textoMsg = msg.interactive.button_reply.title || buttonId;
    console.log(`[BOT] 🔘 Botón: id="${buttonId}" title="${textoMsg}"`);
  } else if (msg.type === "image" && msg.image) {
    // ── Imagen ─────────────────────────────────────────────────────────────
    const tipoImg =
      { waiting_logo: "logo", waiting_cover: "portada" }[lead.bot_status] ||
      "comprobante";
    const media = await downloadWhatsAppMedia(msg.image.id);
    if (media)
      urlImagen = await uploadImageToSupabase(
        media.buffer,
        media.mimeType,
        telefono,
        tipoImg,
      );
    textoMsg = msg.image.caption || "[imagen]";
    console.log(`[BOT] 🖼 Imagen (${tipoImg}) → ${urlImagen ? "OK" : "error"}`);
  } else {
    // ── Texto normal ───────────────────────────────────────────────────────
    textoMsg = msg.text?.body?.trim() || msg.body || "[msg]";
  }

  // Guardar entrante
  await saveMessage(
    lead.id,
    telefono,
    "entrante",
    msg.type === "image" ? "imagen" : "texto",
    textoMsg,
    urlImagen,
  );

  // Máquina de estados
  const replyObj = await stateMachine(lead, textoMsg, urlImagen, buttonId);

  // Enviar respuesta (texto o interactivo)
  await sendReply(phoneNumberId, telefono, replyObj, lead.id, telefono);
}

// ─── Rutas ────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

app.get("/webhook", (req, res) => {
  const {
    "hub.mode": mode,
    "hub.verify_token": token,
    "hub.challenge": challenge,
  } = req.query;
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
      // Procesar mensajes e interactivos
      if (!value?.messages) return;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) return;
      value.messages.forEach((msg) => {
        procesarMensaje(msg, phoneNumberId).catch((e) =>
          console.error("[ERROR] procesarMensaje:", e.message),
        );
      });
    });
  });
});

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

app.get("/leads", async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });
  res.json(data || []);
});

// ─── Servidor ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
