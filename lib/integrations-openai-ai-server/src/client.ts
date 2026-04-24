import OpenAI from "openai";

if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

// If the platform owner has set their own OpenAI API key (OPENAI_API_KEY),
// use it directly against api.openai.com — this unlocks all models (e.g. gpt-5.4-mini)
// without going through the Replit proxy. Dentists never need to configure anything.
// Falls back to the Replit AI integration proxy when no custom key is provided.
const useDirectKey = !!process.env.OPENAI_API_KEY;

export const openai = new OpenAI({
  apiKey: useDirectKey
    ? process.env.OPENAI_API_KEY
    : process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: useDirectKey
    ? "https://api.openai.com/v1"
    : process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
