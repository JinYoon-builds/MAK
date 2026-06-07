import OpenAI from 'openai';
import { config, requireEnv } from '../config.js';

let client: OpenAI | null = null;

export function getOpenAI() {
  requireEnv('OPENAI_API_KEY');
  client ??= new OpenAI({ apiKey: config.openaiApiKey });
  return client;
}
