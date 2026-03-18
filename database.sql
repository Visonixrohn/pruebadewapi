-- ============================================================
--  RoaBusiness WhatsApp Bot  –  Supabase Database Schema
-- ============================================================
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. PROMPT DEL SISTEMA  (editable desde el dashboard)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_prompts (
  id          BIGSERIAL PRIMARY KEY,
  nombre      TEXT        NOT NULL DEFAULT 'default',
  contenido   TEXT        NOT NULL,
  activo      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Solo un prompt activo a la vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_prompts_activo
  ON system_prompts (activo)
  WHERE activo = TRUE;

-- Trigger: actualiza updated_at automáticamente
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_system_prompts_updated
  BEFORE UPDATE ON system_prompts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Prompt inicial del vendedor (se puede editar en Supabase)
INSERT INTO system_prompts (nombre, contenido, activo) VALUES (
  'vendedor_roabusiness',
  $PROMPT$
Eres "Roa", un vendedor profesional, amable y entusiasta de RoaBusiness.

RoaBusiness es un directorio digital donde los negocios locales pueden
tener su perfil con: logo, foto de portada, descripción, dirección,
teléfonos, email y más. Les ayuda a ganar visibilidad en internet.

PLANES:
- Plan Básico  → $9.99/mes  (perfil básico, 3 fotos, posición estándar)
- Plan Premium → $19.99/mes (perfil destacado, fotos ilimitadas, posición preferente, soporte prioritario)

TU FLUJO DE TRABAJO:
1. Saluda cordialmente al cliente.
2. Explica brevemente qué es RoaBusiness y sus beneficios.
3. Presenta los planes y ayuda al cliente a elegir el que más le conviene.
4. Cuando el cliente decida, recopila ESTOS datos uno por uno de forma natural:
   - Nombre completo de la persona responsable
   - Nombre del negocio
   - Dirección del negocio
   - Teléfono(s) del negocio
   - Correo electrónico
   - Plan elegido (Básico o Premium)
5. Solicita que el cliente envíe:
   - Logo del negocio (imagen)
   - Foto de portada del negocio (imagen)
   - Comprobante de pago (imagen)
6. Cuando tengas TODOS los datos e imágenes, confirma al cliente que
   su solicitud está siendo procesada y que le contactarán pronto.

REGLAS:
- Responde siempre en español.
- Sé conciso, amable y profesional.
- No inventes datos; si no tienes un dato, pídelo.
- No respondas preguntas fuera del contexto de venta de RoaBusiness.
- Cuando el sistema te indique que la solicitud fue guardada, solo
  despídete cordialmente y no respondas más mensajes de ese cliente.
$PROMPT$,
  TRUE
) ON CONFLICT DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 2. CONVERSACIONES  (una por número de teléfono)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversaciones (
  id            BIGSERIAL    PRIMARY KEY,
  telefono      TEXT         NOT NULL UNIQUE,
  estado        TEXT         NOT NULL DEFAULT 'activa'
                             CHECK (estado IN ('activa', 'completada')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_conversaciones_updated
  BEFORE UPDATE ON conversaciones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_conversaciones_telefono ON conversaciones (telefono);
CREATE INDEX IF NOT EXISTS idx_conversaciones_estado   ON conversaciones (estado);


-- ────────────────────────────────────────────────────────────
-- 3. MENSAJES  (historial completo recibidos + enviados)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mensajes (
  id                BIGSERIAL    PRIMARY KEY,
  conversacion_id   BIGINT       NOT NULL REFERENCES conversaciones (id) ON DELETE CASCADE,
  telefono          TEXT         NOT NULL,
  direccion         TEXT         NOT NULL CHECK (direccion IN ('entrante', 'saliente')),
  tipo              TEXT         NOT NULL DEFAULT 'texto'
                                 CHECK (tipo IN ('texto', 'imagen', 'documento', 'audio', 'video', 'otro')),
  contenido         TEXT,
  media_whatsapp_id TEXT,          -- ID de media de WhatsApp (para descargar la imagen)
  media_url         TEXT,          -- URL pública en Supabase Storage
  leido             BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mensajes_conversacion ON mensajes (conversacion_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_telefono     ON mensajes (telefono);
CREATE INDEX IF NOT EXISTS idx_mensajes_created_at   ON mensajes (created_at DESC);


-- ────────────────────────────────────────────────────────────
-- 4. SOLICITUDES PENDIENTES  (registros de nuevos negocios)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solicitudes_pendientes (
  id                   BIGSERIAL    PRIMARY KEY,
  conversacion_id      BIGINT       REFERENCES conversaciones (id),

  -- Datos del responsable
  nombre_persona       TEXT         NOT NULL,
  email                TEXT         NOT NULL,

  -- Datos del negocio
  nombre_negocio       TEXT         NOT NULL,
  direccion            TEXT         NOT NULL,
  telefonos            TEXT[]       NOT NULL DEFAULT '{}',  -- array de teléfonos

  -- Plan contratado
  plan_elegido         TEXT         NOT NULL DEFAULT 'basico'
                                    CHECK (plan_elegido IN ('basico', 'premium')),

  -- Imágenes (URLs en Supabase Storage)
  logo_url             TEXT,
  portada_url          TEXT,
  comprobante_pago_url TEXT,

  -- Estado del proceso
  estado               TEXT         NOT NULL DEFAULT 'pendiente'
                                    CHECK (estado IN (
                                      'pendiente',
                                      'en_revision',
                                      'aprobada',
                                      'rechazada'
                                    )),
  notas_admin          TEXT,        -- notas internas del administrador

  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_solicitudes_updated
  BEFORE UPDATE ON solicitudes_pendientes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_solicitudes_estado      ON solicitudes_pendientes (estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_email       ON solicitudes_pendientes (email);
CREATE INDEX IF NOT EXISTS idx_solicitudes_created_at  ON solicitudes_pendientes (created_at DESC);


-- ────────────────────────────────────────────────────────────
-- 5. STORAGE BUCKETS  (ejecutar desde Supabase Dashboard o API)
-- ────────────────────────────────────────────────────────────
-- Desde el SQL Editor de Supabase:

INSERT INTO storage.buckets (id, name, public)
VALUES ('roa-business-assets', 'roa-business-assets', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Política: cualquiera puede leer (imágenes públicas)
CREATE POLICY "Lectura pública de assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'roa-business-assets');

-- Política: solo el service role puede subir/eliminar
CREATE POLICY "Servicio puede subir assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'roa-business-assets');

CREATE POLICY "Servicio puede eliminar assets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'roa-business-assets');


-- ────────────────────────────────────────────────────────────
-- RLS (Row Level Security)  –  habilitado por defecto en Supabase
-- ────────────────────────────────────────────────────────────
ALTER TABLE system_prompts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversaciones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensajes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_pendientes ENABLE ROW LEVEL SECURITY;

-- El backend usa service_role key → bypasea RLS automáticamente.
-- Para el dashboard de Supabase, crea políticas adicionales según necesites.
