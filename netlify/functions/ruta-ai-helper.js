const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";
const { GEMINI_API_KEY } = process.env;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (statusCode, body = {}) => ({
  statusCode,
  headers: {
    ...corsHeaders,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }
  if (!GEMINI_API_KEY) {
    return json(500, {
      error:
        "Falta configurar GEMINI_API_KEY en las variables de entorno del servidor.",
    });
  }
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "JSON inválido" });
  }
  const prompt = (payload.prompt || "").trim();
  const context = payload.context || {};
  if (!prompt) {
    return json(400, { error: "El prompt es obligatorio." });
  }
  const composedPrompt = buildPrompt(prompt, context);
  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: composedPrompt }],
          },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("[ai-helper] gemini error", data);
      return json(response.status, {
        error:
          data?.error?.message ||
          "Gemini no pudo generar una respuesta. Revisa la clave o el uso.",
      });
    }
    const suggestion = extractText(data);
    return json(200, { suggestion });
  } catch (err) {
    console.error("[ai-helper] fetch error", err);
    return json(502, { error: "No se pudo contactar a la IA." });
  }
}

function buildPrompt(prompt, context = {}) {
  const cliente = context.cliente ? `Cliente: ${context.cliente}` : "";
  const tolerancia = context.tolerancia
    ? `Tolerancia aproximada: ${context.tolerancia} metros.`
    : "";
  const rutaNombre = context.rutaNombre
    ? `Nombre actual: ${context.rutaNombre}`
    : "";
  const descripcionActual = context.descripcionActual
    ? `Descripción actual: ${context.descripcionActual}`
    : "";
  const puntos = Array.isArray(context.puntos)
    ? `Puntos de la ruta (lat,lng): ${context.puntos
        .slice(0, 20)
        .map((pt) => `${pt.lat?.toFixed(5)},${pt.lng?.toFixed(5)}`)
        .join(" | ")}`
    : "";

  return `Eres un asistente de logística que propone rutas seguras para custodias en Lima, Perú. 
Utiliza lenguaje claro, profesional y enfocado en seguridad.
Debes sugerir un nombre breve para la ruta y una descripción de máximo 3 oraciones que explique el recorrido y recomendaciones.

Contexto disponible:
${cliente}
${tolerancia}
${rutaNombre}
${descripcionActual}
${puntos}

Instrucción del usuario:
${prompt}

Devuelve solo el texto de la sugerencia (sin etiquetas especiales ni listas).`;
}

function extractText(data) {
  try {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((part) => part.text || "").join("\n").trim();
  } catch {
    return "";
  }
}
