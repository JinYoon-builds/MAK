import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';

const prompts = {
  dest: '어디로 가세요?',
  searching: '좋아요. 실제 기차를 찾아볼게요. 잠깐만 기다려 주세요.',
  results: '제일 빠른 기차와 제일 저렴한 기차를 찾았어요. 어느 걸로 해드릴까요?',
  done: '표를 선택했어요. 이제 결제 단계로 안내해드릴게요.',
  retry: '제가 잘 못 들었어요. 천천히 한 번만 더 말씀해 주세요.',
  nudge: '천천히 말씀하셔도 괜찮아요. 어디로 가세요?',
  idle: '아직 계신가요? 계속하시려면 화면을 눌러 주세요.',
  staff: '직원이 바로 도와드릴게요.'
};

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is required');
const client = new OpenAI({ apiKey });
const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const voice = process.env.OPENAI_TTS_VOICE || 'coral';
const outDir = path.resolve('assets/audio');
await fs.mkdir(outDir, { recursive: true });

for (const [name, text] of Object.entries(prompts)) {
  const out = path.join(outDir, `${name}.mp3`);
  try {
    await fs.access(out);
    console.log(`skip ${name}`);
    continue;
  } catch {}
  console.log(`generate ${name}`);
  const speech = await client.audio.speech.create({
    model,
    voice,
    input: text,
    instructions: '따뜻하고 친절한 여성 역무원처럼, 시니어 사용자가 이해하기 쉽게 너무 느리지 않게 또렷한 한국어로 말하세요.',
    response_format: 'mp3'
  });
  const buffer = Buffer.from(await speech.arrayBuffer());
  await fs.writeFile(out, buffer);
}
