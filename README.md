# WAPI - Webhook para WhatsApp (Meta)

Pasos rápidos:

- Ejecutar localmente:

```bash
npm install
cp .env.example .env
# editar .env con VERIFY_TOKEN y WHATSAPP_TOKEN
npm run start
```

- URL del webhook: `https://<tu-deployment>.vercel.app/webhook` (usar para configurar en Meta)

- Variables de entorno importantes:
  - `VERIFY_TOKEN`: token de verificación que configuras en Meta
  - `WHATSAPP_TOKEN`: access token de la API de WhatsApp (Meta)

Checklist para Meta (resumen):

- Usar un número: registrar o asignar un número en Meta Business/WhatsApp Manager.
- Método de pago: configurar método de pago en el administrador de Meta (para usar la API de producción si aplica).
- Plantilla: crear y aprobar plantillas de mensajes en Business Manager (útiles para mensajes iniciados por la empresa).
- Modo activo: una vez listo, poner la integración en producción/activo desde el panel de Meta.

Cómo usar este webhook:

- Meta envía verificación GET al endpoint `/webhook` con `hub.mode`, `hub.verify_token` y `hub.challenge`.
- POST a `/webhook` recibe los mensajes y aquí puedes procesarlos y reaccionar (el ejemplo solo los imprime en consola).

Despliegue en Vercel:

1. Crear un repositorio en GitHub y subir este proyecto.
2. Conectar el repositorio a Vercel e importar.
3. En Vercel, añadir variables de entorno `VERIFY_TOKEN` y `WHATSAPP_TOKEN`.
4. Deployar; usar la URL pública en Meta para el webhook.

Comandos para Git/GitHub (local):

```bash
git init
git add .
git commit -m "Initial webhook for WhatsApp"
# crear repo en GitHub y luego:
git remote add origin git@github.com:TU_USUARIO/TU_REPO.git
git push -u origin main
```

Si quieres, puedo:

- Crear el repo en GitHub desde aquí (necesitarás autorizarme o ejecutar `gh` localmente).
- Hacer el deploy automático a Vercel (requiere conectar cuenta Vercel/GitHub).
