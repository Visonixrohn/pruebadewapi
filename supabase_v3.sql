-- ============================================================
--  RoaBusiness Bot v3  –  Botones interactivos + preguntas FAQ
--  Ejecuta en: Supabase → SQL Editor → Run
--  (ejecuta DESPUÉS de supabase_v2.sql)
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. AMPLIAR estados del lead (nuevos: waiting_intent,
--    waiting_confirmation)
-- ────────────────────────────────────────────────────────────
ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_bot_status_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_bot_status_check
  CHECK (bot_status IN (
    'new_lead',
    'waiting_intent',           -- mostró bienvenida y botones, espera selección
    'waiting_business_name',
    'waiting_contact_phone',
    'waiting_description',
    'waiting_plan',
    'waiting_logo',
    'waiting_cover',
    'waiting_payment_proof',
    'waiting_confirmation',     -- mostró resumen y botones Confirmar/Cancelar
    'pending_approval',
    'attended'
  ));


-- ────────────────────────────────────────────────────────────
-- 2. AGREGAR columna buttons a bot_responses
--    Formato JSON:
--    [{"id":"btn_registro","title":"Registrar mi negocio"},
--     {"id":"btn_admin","title":"Hablar con asesor"}]
-- ────────────────────────────────────────────────────────────
ALTER TABLE bot_responses
  ADD COLUMN IF NOT EXISTS buttons JSONB DEFAULT NULL;

-- Actualizar TODOS los mensajes con botones interactivos
UPDATE bot_responses SET
  message = '¡Hola! 👋 Bienvenido a *RoaBusiness*, el directorio digital para negocios locales.\n\n¿Cómo podemos ayudarte hoy?',
  buttons = '[{"id":"btn_registro","title":"📋 Registrar negocio"},{"id":"btn_admin","title":"💬 Hablar con asesor"}]'::jsonb
WHERE state_key = 'welcome';

UPDATE bot_responses SET
  message = 'Paso 1/5 — ✏️ *¿Cuál es el nombre de tu negocio?*\n\nEscríbelo a continuación:',
  buttons = '[{"id":"btn_cancelar_reg","title":"❌ Cancelar registro"}]'::jsonb
WHERE state_key = 'waiting_business_name';

UPDATE bot_responses SET
  message = 'Paso 2/5 — 📞 *¿Cuál es el teléfono de contacto?*\n\nEscríbelo, o usa el botón para usar tu número actual:',
  buttons = '[{"id":"btn_usar_numero","title":"📱 Usar este número"},{"id":"btn_cancelar_reg","title":"❌ Cancelar"}]'::jsonb
WHERE state_key = 'waiting_contact_phone';

UPDATE bot_responses SET
  message = 'Paso 3/5 — 📝 *Cuéntanos brevemente a qué se dedica tu negocio:*',
  buttons = '[{"id":"btn_cancelar_reg","title":"❌ Cancelar registro"}]'::jsonb
WHERE state_key = 'waiting_description';

UPDATE bot_responses SET
  message = 'Paso 4/5 — 💼 *Elige tu plan:*\n\n🔹 *Básico* $9.99/mes — Perfil + contacto\n🔸 *Profesional* $19.99/mes — + galería + mapa\n⭐ *Premium* $34.99/mes — + video + posición top',
  buttons = '[{"id":"btn_basico","title":"🔹 Básico $9.99"},{"id":"btn_profesional","title":"🔸 Profesional $19.99"},{"id":"btn_premium","title":"⭐ Premium $34.99"}]'::jsonb
WHERE state_key = 'waiting_plan';

UPDATE bot_responses SET
  message = 'Paso 5a/5 — 🖼️ *Envía el logo de tu negocio como imagen.*\n\nFormatos aceptados: JPG, PNG',
  buttons = '[{"id":"btn_cancelar_reg","title":"❌ Cancelar registro"}]'::jsonb
WHERE state_key = 'waiting_logo';

UPDATE bot_responses SET
  message = 'Paso 5b/5 — 🖼️ ¡Logo recibido! ✅\n\n*Ahora envía la imagen de portada de tu negocio:*',
  buttons = '[{"id":"btn_cancelar_reg","title":"❌ Cancelar registro"}]'::jsonb
WHERE state_key = 'waiting_cover';

UPDATE bot_responses SET
  message = 'Paso 5c/5 — 💳 ¡Portada recibida! ✅\n\nRealiza tu pago y *envía el comprobante como imagen.*',
  buttons = '[{"id":"btn_datos_pago","title":"💳 Ver datos de pago"},{"id":"btn_cancelar_reg","title":"❌ Cancelar"}]'::jsonb
WHERE state_key = 'waiting_payment_proof';

UPDATE bot_responses SET
  message = '📋 *Resumen de tu solicitud:*\n\n🏢 Negocio: {business}\n📞 Teléfono: {phone}\n📝 Descripción: {desc}\n💼 Plan: {plan}\n\n¿Confirmas el registro?',
  buttons = '[{"id":"btn_confirmar","title":"✅ Confirmar"},{"id":"btn_cancelar","title":"❌ Cancelar"}]'::jsonb
WHERE state_key = 'waiting_confirmation';

UPDATE bot_responses SET
  message = '🎉 ¡Registro completado! Tu solicitud para *{business}* está en revisión.\n\nTe contactaremos pronto. 🚀',
  buttons = '[{"id":"btn_asesor","title":"💬 Hablar con asesor"},{"id":"btn_volver","title":"↩️ Menú principal"}]'::jsonb
WHERE state_key = 'complete';

UPDATE bot_responses SET
  message = 'Tu solicitud está *pendiente de aprobación*. Pronto te contactaremos. 🙌',
  buttons = '[{"id":"btn_asesor","title":"💬 Hablar con asesor"},{"id":"btn_nuevo","title":"🔄 Nuevo registro"}]'::jsonb
WHERE state_key = 'attended';

UPDATE bot_responses SET
  message = 'Por favor elige uno de estos planes 👇',
  buttons = '[{"id":"btn_basico","title":"🔹 Básico $9.99"},{"id":"btn_profesional","title":"🔸 Profesional $19.99"},{"id":"btn_premium","title":"⭐ Premium $34.99"}]'::jsonb
WHERE state_key = 'invalid_plan';

UPDATE bot_responses SET
  message = 'Por favor envía la imagen para continuar. 📷',
  buttons = '[{"id":"btn_cancelar_reg","title":"❌ Cancelar registro"}]'::jsonb
WHERE state_key = 'need_image';

-- Insertar / actualizar registros que pueden no existir
INSERT INTO bot_responses (state_key, message, buttons) VALUES
(
  'waiting_confirmation',
  '📋 *Resumen de tu solicitud:*\n\n🏢 Negocio: {business}\n📞 Teléfono: {phone}\n📝 Descripción: {desc}\n💼 Plan: {plan}\n\n¿Confirmas el registro?',
  '[{"id":"btn_confirmar","title":"✅ Confirmar"},{"id":"btn_cancelar","title":"❌ Cancelar"}]'::jsonb
)
ON CONFLICT (state_key) DO UPDATE
  SET message = EXCLUDED.message, buttons = EXCLUDED.buttons;

INSERT INTO bot_responses (state_key, message, buttons) VALUES
(
  'contact_admin',
  '📞 Un asesor de *RoaBusiness* se pondrá en contacto contigo muy pronto.\n\nTambién puedes escribirnos a: _admin@roabusiness.com_ 🙌',
  '[{"id":"btn_volver","title":"↩️ Menú principal"}]'::jsonb
)
ON CONFLICT (state_key) DO UPDATE
  SET message = EXCLUDED.message, buttons = EXCLUDED.buttons;

INSERT INTO bot_responses (state_key, message, buttons) VALUES
(
  'cancelled',
  'Registro cancelado 🙅‍♂️\n\n¡Sin problema! Escríbenos cuando quieras.',
  '[{"id":"btn_nuevo","title":"🔄 Empezar de nuevo"},{"id":"btn_asesor","title":"💬 Hablar con asesor"}]'::jsonb
)
ON CONFLICT (state_key) DO UPDATE
  SET message = EXCLUDED.message, buttons = EXCLUDED.buttons;

INSERT INTO bot_responses (state_key, message, buttons) VALUES
(
  'datos_pago',
  '💳 *Datos bancarios para el pago:*\n\nBanco: _Banco Ejemplo_\nCuenta: _0000-0000-0000_\nTitular: _RoaBusiness SA_\n\nEnvía el comprobante como imagen cuando realices el pago.',
  '[{"id":"btn_ya_pague","title":"✅ Ya pagué"},{"id":"btn_cancelar_reg","title":"❌ Cancelar registro"}]'::jsonb
)
ON CONFLICT (state_key) DO UPDATE
  SET message = EXCLUDED.message, buttons = EXCLUDED.buttons;


-- ────────────────────────────────────────────────────────────
-- 3. TABLA PREGUNTAS  (FAQ interactivas)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS preguntas (
  id           BIGSERIAL PRIMARY KEY,
  keywords     TEXT[]    NOT NULL,   -- palabras clave para detectar la pregunta
  pregunta     TEXT      NOT NULL,   -- texto descriptivo de la pregunta
  respuesta    TEXT      NOT NULL,   -- respuesta que enviará el bot
  buttons      JSONB     DEFAULT NULL, -- botones opcionales de seguimiento
  activo       BOOLEAN   DEFAULT TRUE,
  prioridad    INT       DEFAULT 0,   -- mayor número = mayor prioridad
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preguntas_activo ON preguntas(activo);

DROP TRIGGER IF EXISTS trg_preguntas_updated ON preguntas;
CREATE TRIGGER trg_preguntas_updated
BEFORE UPDATE ON preguntas
FOR EACH ROW EXECUTE FUNCTION update_leads_updated_at();

-- FAQ inicial (edítalas desde Supabase cuando quieras)
INSERT INTO preguntas (keywords, pregunta, respuesta, buttons, prioridad) VALUES

(
  ARRAY['precio','precios','cuanto','cuesta','costo','tarifa','valor'],
  '¿Cuáles son los precios?',
  '💰 Nuestros planes son:\n\n🔹 *Básico* $9.99/mes — Perfil + 1 foto + contacto\n🔸 *Profesional* $19.99/mes — + galería + mapa + redes\n⭐ *Premium* $34.99/mes — + video + posición destacada\n\n¿Te gustaría registrar tu negocio?',
  '[{"id":"btn_registro","title":"Registrar mi negocio"},{"id":"btn_admin","title":"Hablar con asesor"}]'::jsonb,
  10
),

(
  ARRAY['que es','que hace','para que','directorio','roabusiness','roa business'],
  '¿Qué es RoaBusiness?',
  '🏢 *RoaBusiness* es un directorio digital que conecta negocios locales con clientes en línea.\n\nTu negocio aparece con:\n✅ Perfil completo\n✅ Datos de contacto\n✅ Fotos y descripción\n✅ Mapa de ubicación\n\n¿Quieres registrar tu negocio?',
  '[{"id":"btn_registro","title":"Registrar mi negocio"},{"id":"btn_admin","title":"Hablar con asesor"}]'::jsonb,
  9
),

(
  ARRAY['como funciona','como registro','como me registro','pasos','proceso'],
  '¿Cómo funciona el registro?',
  '📝 El proceso es muy sencillo:\n\n1️⃣ Nos das el nombre de tu negocio\n2️⃣ Tu teléfono de contacto\n3️⃣ Una breve descripción\n4️⃣ Eliges tu plan\n5️⃣ Envías logo, portada y comprobante de pago\n\n¡Y listo! Tu negocio aparece en el directorio. 🚀',
  '[{"id":"btn_registro","title":"¡Quiero registrarme!"},{"id":"btn_admin","title":"Hablar con asesor"}]'::jsonb,
  8
),

(
  ARRAY['pago','pagar','transferencia','cuenta','deposito','banco'],
  '¿Cómo hago el pago?',
  '💳 Aceptamos pagos por transferencia bancaria.\n\nUna vez que elijas tu plan, te compartiremos los datos bancarios y solo deberás enviar el comprobante de pago como imagen.',
  '[{"id":"btn_registro","title":"Registrar mi negocio"},{"id":"btn_admin","title":"Ver datos de pago"}]'::jsonb,
  7
),

(
  ARRAY['contacto','asesor','hablar','llamar','comunicarme','whatsapp','telefono admin'],
  '¿Cómo contacto a un asesor?',
  '📞 Puedo conectarte con un asesor de RoaBusiness ahora mismo.',
  '[{"id":"btn_admin","title":"Contactar asesor"}]'::jsonb,
  6
);
