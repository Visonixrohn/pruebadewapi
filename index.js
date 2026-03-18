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

// ─── Respuestas fijas locales (fallback vendedor estrella) ────────────────────
const FALLBACK_RESPONSES = {
  welcome: {
    text: "¡Hola! 👋 Bienvenido a *RoaBusiness*. El lugar donde los negocios de Honduras se vuelven imparables. 🚀\n\n¿Listo para que miles de clientes te encuentren?",
    buttons: [
      { id: "btn_registro", title: "📋 Registrar negocio" },
      { id: "btn_admin", title: "💬 Hablar con asesor" },
    ],
  },
  waiting_intent: {
    text: "¡Excelente! Elige una opción para arrancar 👇",
    buttons: [
      { id: "btn_registro", title: "🚀 Registrar mi negocio" },
      { id: "btn_admin", title: "💬 Hablar con asesor" },
    ],
  },
  waiting_business_name: {
    text: "Paso 1/5 — ✏️ *¿Cuál es el nombre de tu negocio?*\n\nEscríbelo aquí abajo para empezar a hacerlo famoso:",
    buttons: [{ id: "btn_cancelar_reg", title: "❌ Cancelar" }],
  },
  waiting_contact_phone: {
    text: "Paso 2/5 — 📞 *¿A qué número quieres que te lleguen los clientes?*\n\nEscríbelo, o usa el botón para dejar tu número actual:",
    buttons: [
      { id: "btn_usar_numero", title: "📱 Usar este número" },
      { id: "btn_cancelar_reg", title: "❌ Cancelar" },
    ],
  },
  waiting_description: {
    text: "Paso 3/5 — 📝 *¡Véndeme tu idea! ¿A qué se dedica tu negocio?*\n\n(Hazlo breve pero irresistible para tus clientes)",
    buttons: [{ id: "btn_cancelar_reg", title: "❌ Cancelar" }],
  },
  waiting_plan: {
    text: "Paso 4/5 — 💼 *¡Elige cómo dominar el mercado!*\n\n🔥 *Pro 6 Meses:* 350 Lps\n👑 *Premium 12 Meses:* 600 Lps (¡El más vendido!)\n\n¿Cuál prefieres?",
    buttons: [
      { id: "btn_basico", title: "🔥 6 Meses (350 Lps)" },
      { id: "btn_premium", title: "👑 12 Meses (600 Lps)" },
    ],
  },
  waiting_logo: {
    text: "Paso 5a/5 — 🖼️ *¡Hora de brillar! Envía el logo de tu negocio como imagen.*\n\n(Asegúrate que se vea espectacular)",
    buttons: [{ id: "btn_cancelar_reg", title: "❌ Cancelar" }],
  },
  waiting_cover: {
    text: "Paso 5b/5 — 🖼️ ¡Logo impecable! ✅\n\n*Ahora, envíame la imagen de portada. Puede ser tu local o tu mejor producto:*",
    buttons: [{ id: "btn_cancelar_reg", title: "❌ Cancelar" }],
  },
  waiting_payment_proof: {
    text: "Paso 5c/5 — 💳 ¡Todo listo! ✅\n\nRealiza tu pago para activar tu vitrina hoy mismo y *envía la foto del comprobante.*",
    buttons: [
      { id: "btn_datos_pago", title: "💳 Ver datos de pago" },
      { id: "btn_cancelar_reg", title: "❌ Cancelar" },
    ],
  },
  waiting_confirmation: {
    text: "📋 *¡REVISIÓN FINAL!* 🚀\n\n🏢 Negocio: {business}\n📞 Teléfono: {phone}\n📝 Descripción: {desc}\n💼 Plan: {plan}\n\n¿Estás listo para recibir más clientes?",
    buttons: [
      { id: "btn_confirmar", title: "✅ ¡Sí, confirmar!" },
      { id: "btn_cancelar", title: "❌ Cancelar" },
    ],
  },
  complete: {
    text: "🎉 ¡Felicidades! Acabas de dar el mejor paso para *{business}*.\n\nTu solicitud está en revisión y en breve estarás en línea. 🚀",
    buttons: [
      { id: "btn_asesor", title: "💬 Hablar con asesor" },
      { id: "btn_volver", title: "↩️ Menú principal" },
    ],
  },
  attended: {
    text: "Tu solicitud está *en proceso*. ¡Pronto tendrás noticias de tu asesor! 🙌",
    buttons: [
      { id: "btn_asesor", title: "💬 Hablar con asesor" },
      { id: "btn_nuevo", title: "🔄 Nuevo registro" },
    ],
  },
  contact_admin: {
    text: "📞 ¡Claro que sí! Un asesor experto de *RoaBusiness* te contactará pronto.\n\nTambién puedes escribir a: _admin@roabusiness.com_ 🙌",
    buttons: [{ id: "btn_volver", title: "↩️ Menú principal" }],
  },
  invalid_plan: {
    text: "¡Ups! Necesito que elijas una opción válida para continuar 👇",
    buttons: [
      { id: "btn_basico", title: "🔥 6 Meses (350 Lps)" },
      { id: "btn_premium", title: "👑 12 Meses (600 Lps)" },
    ],
  },
  need_image: {
    text: "¡No te olvides de la imagen! 📷 Envíala como foto para poder avanzar.",
    buttons: [{ id: "btn_cancelar_reg", title: "❌ Cancelar" }],
  },
  cancelled: {
    text: "Registro cancelado 🙅‍♂️\n\nNo hay problema. Cuando estés listo para aumentar tus ventas, aquí estaremos.",
    buttons: [
      { id: "btn_nuevo", title: "🔄 Empezar de nuevo" },
      { id: "btn_asesor", title: "💬 Hablar con asesor" },
    ],
  },
  datos_pago: {
    text: "💳 *INVIRTIENDO EN TU ÉXITO:*\n\n🏦 *Banco:* BAC Credomatic\n👤 *Titular:* Miguel Angel Romero Guillen\n🔢 *Cuenta:* 751787611\n\n📸 Envía la captura del pago aquí mismo.",
    buttons: [
      { id: "btn_ya_pague", title: "✅ Ya pagué (enviar foto)" },
      { id: "btn_cancelar_reg", title: "❌ Cancelar" },
    ],
  },
};

// ─── Cache bot_responses + preguntas ──────────────────────────────────────────
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
        responsesCache.data = {};
        // 🚨 CAMBIO MAGISTRAL: Agrupamos las respuestas en arrays
        data.forEach((r) => {
          if (!responsesCache.data[r.state_key]) responsesCache.data[r.state_key] = [];
          responsesCache.data[r.state_key].push({ text: r.message, buttons: r.buttons || null });
        });
        responsesCache.ts = now;
        console.log("[Cache] bot_responses recargado (soporta variaciones randómicas).");
      }
    } catch (e) {
      console.error("[Cache] bot_responses error:", e.message);
    }
  }

  // ... (el caché de preguntas se mantiene igual)
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
      }
    } catch (e) {
      console.error("[Cache] preguntas error:", e.message);
    }
  }
}

// 🚨 CAMBIO MAGISTRAL: Elige una respuesta aleatoria si hay múltiples para la misma key
async function getFixedResponse(key) {
  await reloadCaches();
  const options = responsesCache.data[key];
  if (options && options.length > 0) {
    const randomIndex = Math.floor(Math.random() * options.length);
    return options[randomIndex];
  }
  return FALLBACK_RESPONSES[key] || null;
}

// ... EL RESTO DEL CÓDIGO SE MANTIENE EXACTAMENTE IGUAL A PARTIR DE AQUÍ ...
// (matchPregunta, leads helpers, waPost, sendWhatsAppInteractive, openAI_Fallback, stateMachine, etc.)

// Asegúrate de modificar SOLO detectarPlan() para que reconozca los nuevos botones:
function detectarPlan(texto) {
  const t = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/premium|12|600/.test(t) || t === "2" || t === "btn_premium") return "Premium (12 Meses)";
  if (/basico|pro|6|350/.test(t) || t === "1" || t === "btn_basico") return "Pro (6 Meses)";
  return null;
}