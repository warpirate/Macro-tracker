import OpenAI from 'openai'

/**
 * Nebius Token Factory — OpenAI-compatible inference endpoint.
 * Models are listed at GET {BASE_URL}/models.
 */
export const BASE_URL = process.env.NEBIUS_BASE_URL ?? 'https://api.tokenfactory.nebius.com/v1'

/** Tool-calling model used by the chat assistant. */
export const CHAT_MODEL = process.env.NEBIUS_CHAT_MODEL ?? 'Qwen/Qwen3-235B-A22B-Instruct-2507'

/** Vision model used for meal photo analysis. */
export const VISION_MODEL = process.env.NEBIUS_VISION_MODEL ?? 'Qwen/Qwen2.5-VL-72B-Instruct'

export const client = new OpenAI({
  apiKey: process.env.NEBIUS_API_KEY,
  baseURL: BASE_URL,
})
