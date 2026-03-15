-- ============================================================
--  RoaBusiness WhatsApp Bot  –  Esquema Supabase
--  Ejecuta este script en: Supabase → SQL Editor → Run
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- FUNCIÓN GENÉRICA  actualizado_en
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ────────────────────────────────────────────────────────────
-- 1. CONFIGURACIÓN DEL BOT  (prompt editable desde Supabase)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS configuracion_bot (
  id              BIGSERIAL PRIMARY KEY,
  clave           TEXT UNIQUE NOT NULL,
  valor           TEXT        NOT NULL,
  descripcion     TEXT,
  actualizado_en  TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_config_updated
BEFORE UPDATE ON configuracion_bot
FOR EACH ROW EXECUTE FUNCTION update_actualizado_en();

-- Prompt inicial del vendedor
INSERT INTO configuracion_bot (clave, valor, descripcion)
VALUES (
  'system_prompt',
  'Eres un vendedor profesional y cordial de RoaBusiness, un directorio digital para negocios. Tu misión es vender suscripciones al directorio.

PLANES DISPONIBLES:
- Plan Básico $9.99/mes: Perfil del negocio, 1 foto, datos de contacto.
- Plan Profesional $19.99/mes: Todo lo anterior + galería de fotos, mapa, redes sociales.
- Plan Premium $34.99/mes: Todo lo anterior + video, posicionamiento destacado, estadísticas.

TU PROCESO DE VENTA:
1. Saluda al cliente de forma cordial y cálida.
2. Presenta RoaBusiness y sus beneficios brevemente.
3. Explica los planes y sus precios.
4. Al mostrar interés, recopila OBLIGATORIAMENTE estos datos en el siguiente orden:
   a) Nombre completo de la persona contacto
   b) Nombre del negocio
   c) Dirección del negocio
   d) Teléfonos del negocio
   e) Email de contacto
   f) Plan elegido
   g) Logo del negocio (pide que adjunten la imagen)
   h) Imagen de portada del negocio (pide que adjunten la imagen)
   i) Comprobante de pago (pide que realicen el pago y adjunten el comprobante)
5. Analiza el comprobante de pago para verificar que sea un comprobante válido.
6. Cuando tengas TODOS los datos y las 3 imágenes, llama a la función guardar_solicitud.

REGLAS IMPORTANTES:
- Responde siempre en español.
- Sé amable, paciente y profesional en todo momento.
- Si el cliente envía una imagen, asume que es para uno de los pasos del proceso.
- Lleva el orden: logo → portada → comprobante.
- No inventes datos, pide cada uno al cliente.
- No llames a guardar_solicitud hasta tener TODO.',
  'Prompt principal del vendedor de RoaBusiness'
)
ON CONFLICT (clave) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 2. CONVERSACIONES  (estado por número de teléfono)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversaciones (
  id              BIGSERIAL PRIMARY KEY,
  telefono        TEXT NOT NULL UNIQUE,
  phone_number_id TEXT,
  estado          TEXT NOT NULL DEFAULT 'activa'
                  CHECK (estado IN ('activa', 'completada', 'cerrada')),
  creado_en       TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversaciones_telefono
  ON conversaciones(telefono);

CREATE OR REPLACE TRIGGER trg_conversaciones_updated
BEFORE UPDATE ON conversaciones
FOR EACH ROW EXECUTE FUNCTION update_actualizado_en();


-- ────────────────────────────────────────────────────────────
-- 3. MENSAJES  (entrantes y salientes)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mensajes (
  id               BIGSERIAL PRIMARY KEY,
  conversacion_id  BIGINT REFERENCES conversaciones(id) ON DELETE CASCADE,
  telefono         TEXT NOT NULL,
  direccion        TEXT NOT NULL CHECK (direccion IN ('entrante', 'saliente')),
  tipo             TEXT NOT NULL DEFAULT 'texto'
                   CHECK (tipo IN ('texto', 'imagen', 'audio', 'documento', 'otro')),
  contenido        TEXT,
  url_medio        TEXT,
  creado_en        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mensajes_conversacion
  ON mensajes(conversacion_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_telefono
  ON mensajes(telefono);
CREATE INDEX IF NOT EXISTS idx_mensajes_creado_en
  ON mensajes(creado_en DESC);


-- ────────────────────────────────────────────────────────────
-- 4. SOLICITUDES PENDIENTES
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solicitudes_pendientes (
  id                    BIGSERIAL PRIMARY KEY,
  conversacion_id       BIGINT REFERENCES conversaciones(id) ON DELETE SET NULL,

  -- Datos del contacto
  nombre_persona        TEXT NOT NULL,
  email                 TEXT NOT NULL,

  -- Datos del negocio
  nombre_negocio        TEXT NOT NULL,
  direccion             TEXT NOT NULL,
  telefonos             TEXT NOT NULL,
  plan_elegido          TEXT NOT NULL,

  -- Imágenes (URLs de Supabase Storage)
  url_logo              TEXT,
  url_portada           TEXT,
  url_comprobante_pago  TEXT,

  -- Estado de la solicitud
  estado                TEXT NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'en_revision', 'aprobada', 'rechazada')),
  notas                 TEXT,

  creado_en             TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_estado
  ON solicitudes_pendientes(estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_conversacion
  ON solicitudes_pendientes(conversacion_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_creado_en
  ON solicitudes_pendientes(creado_en DESC);

CREATE OR REPLACE TRIGGER trg_solicitudes_updated
BEFORE UPDATE ON solicitudes_pendientes
FOR EACH ROW EXECUTE FUNCTION update_actualizado_en();


-- ============================================================
--  STORAGE BUCKET  –  imagenes-comercios
--  Crear MANUALMENTE en: Supabase → Storage → New Bucket
--  Nombre:  imagenes-comercios
--  Marcar:  Public bucket  ✓
-- ============================================================
-- O ejecuta esto si prefieres vía SQL (requiere extension habilitada):

INSERT INTO storage.buckets (id, name, public)
VALUES ('imagenes-comercios', 'imagenes-comercios', true)
ON CONFLICT (id) DO NOTHING;

-- Política: lectura pública
CREATE POLICY "Lectura pública imagenes-comercios"
ON storage.objects FOR SELECT
USING ( bucket_id = 'imagenes-comercios' );

-- Política: escritura con service_role (el servidor)
CREATE POLICY "Subida con service role"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'imagenes-comercios' );
