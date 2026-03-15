-- ============================================================
--  RoaBusiness Bot v2  –  Máquina de estados + respuestas fijas
--  Ejecuta en: Supabase → SQL Editor → Run
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. TABLA LEADS  (reemplaza conversaciones para el bot)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                    BIGSERIAL PRIMARY KEY,
  user_phone            TEXT NOT NULL UNIQUE,
  phone_number_id       TEXT,

  -- Datos recogidos por el bot
  business_name         TEXT,
  contact_phone         TEXT,
  business_description  TEXT,
  plan_elegido          TEXT,

  -- Imágenes (URLs de Supabase Storage)
  logo_url              TEXT,
  cover_url             TEXT,
  payment_proof_url     TEXT,

  -- Estado de la máquina de estados
  bot_status            TEXT NOT NULL DEFAULT 'new_lead'
    CHECK (bot_status IN (
      'new_lead',
      'waiting_business_name',
      'waiting_contact_phone',
      'waiting_description',
      'waiting_plan',
      'waiting_logo',
      'waiting_cover',
      'waiting_payment_proof',
      'pending_approval',
      'attended'
    )),

  source                TEXT DEFAULT 'whatsapp',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone    ON leads(user_phone);
CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(bot_status);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_updated ON leads;
CREATE TRIGGER trg_leads_updated
BEFORE UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION update_leads_updated_at();


-- ────────────────────────────────────────────────────────────
-- 2. COLUMNA lead_id en mensajes (opcional, para trazabilidad)
-- ────────────────────────────────────────────────────────────
ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS
  lead_id BIGINT REFERENCES leads(id) ON DELETE SET NULL;


-- ────────────────────────────────────────────────────────────
-- 3. TABLA BOT_RESPONSES  (respuestas fijas editables)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_responses (
  id          BIGSERIAL PRIMARY KEY,
  state_key   TEXT UNIQUE NOT NULL,
  message     TEXT NOT NULL,
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_bot_responses_updated ON bot_responses;
CREATE TRIGGER trg_bot_responses_updated
BEFORE UPDATE ON bot_responses
FOR EACH ROW EXECUTE FUNCTION update_leads_updated_at();

-- Inserta las respuestas fijas (edítalas desde Supabase cuando quieras)
INSERT INTO bot_responses (state_key, message) VALUES
(
  'welcome',
  '¡Hola! 👋 Bienvenido a *RoaBusiness*, el directorio digital que conecta negocios con clientes.

¿Cuál es el *nombre de tu negocio*?'
),
(
  'waiting_business_name',
  'Por favor dinos el *nombre de tu negocio* para continuar.'
),
(
  'waiting_contact_phone',
  '¡Genial! ¿Cuál es el *teléfono de contacto* de tu negocio?'
),
(
  'waiting_description',
  'Perfecto 👍 Cuéntanos brevemente *a qué se dedica* tu negocio.'
),
(
  'waiting_plan',
  'Excelente 🎯 Elige tu plan:

🔹 *Básico* – $9.99/mes: Perfil + 1 foto + datos de contacto
🔸 *Profesional* – $19.99/mes: + galería + mapa + redes sociales
⭐ *Premium* – $34.99/mes: + video + posición destacada + estadísticas

Responde: *Básico*, *Profesional* o *Premium*'
),
(
  'waiting_logo',
  '¡Plan registrado! ✅ Ahora envía el *logo* de tu negocio como imagen.'
),
(
  'waiting_cover',
  '¡Logo recibido! ✅ Ahora envía la *imagen de portada* de tu negocio.'
),
(
  'waiting_payment_proof',
  '¡Portada recibida! ✅

Datos bancarios para el pago:
🏦 Banco: _[Tu banco aquí]_
💳 Cuenta: _[Tu cuenta aquí]_

Realiza el pago y envía el *comprobante* como imagen.'
),
(
  'complete',
  '✅ ¡Registro completado! Tu solicitud para *{business}* está en revisión.

Nuestro equipo verificará tu comprobante y te contactará pronto. ¡Gracias! 🚀'
),
(
  'attended',
  'Tu solicitud ya fue recibida y está *pendiente de aprobación*. Pronto te contactaremos. 🙌'
),
(
  'invalid_plan',
  'Por favor elige una opción válida: *Básico*, *Profesional* o *Premium*.'
),
(
  'need_image',
  'Por favor envía la imagen para continuar. 📷'
)
ON CONFLICT (state_key) DO NOTHING;
