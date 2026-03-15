/**
 * Prompt de fallback LOCAL — SOLO se usa cuando OpenAI es llamado como fallback.
 * Mantenlo MUY corto para minimizar tokens de entrada.
 * El prompt real puede editarse en Supabase → configuracion_bot → system_prompt.
 */
const SYSTEM_PROMPT = `Eres vendedor breve de ROA Business. Responde corto y directo. Avanza al siguiente dato del registro. No des explicaciones largas.`;

module.exports = SYSTEM_PROMPT;

