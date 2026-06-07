import type { DialogTurnResult, KioskSession, TicketIntent, TrainCandidate } from '../../src/types.js';
import { config } from '../config.js';
import { getOpenAI } from '../integrations/openaiClient.js';
import { dialogJsonSchema } from '../schemas/dialogSchema.js';
import { todayInSeoul } from './dateTime.js';

function defaultIntent(): TicketIntent {
  return {
    departureStation: config.defaultDepartureStation,
    passengerCount: 1,
    missingFields: ['arrivalStation', 'date', 'timePreference'],
    confidence: 0
  };
}

export function mergeIntent(intent?: Partial<TicketIntent>): TicketIntent {
  return {
    ...defaultIntent(),
    ...intent,
    departureStation: intent?.departureStation || config.defaultDepartureStation,
    passengerCount: intent?.passengerCount || 1,
    missingFields: intent?.missingFields ?? [],
    confidence: typeof intent?.confidence === 'number' ? intent.confidence : 0
  };
}

function isImmediateControlUtterance(text: string) {
  return /^(네|예|응|맞아|맞아요|그래|좋아|아니|아니요|틀려|틀렸|다시)/.test(text.trim()) || /빠른|제일 빠|싼|저렴|다시\s*(찾|검색)|새로\s*(찾|검색)|다른\s*표/.test(text);
}

function canUseFastHeuristic(result: DialogTurnResult, currentScreen?: string) {
  if (result.error) return true;
  if (['select_train', 'search_trains', 'retry_listening'].includes(result.action)) return true;
  if (result.action === 'ask_destination' && currentScreen !== 'confirm') return true;
  if (result.action === 'ask_time' && Boolean(result.intent.arrivalStation)) return true;
  if (result.action === 'confirm_intent' && Boolean(result.intent.arrivalStation) && result.intent.confidence >= 0.7) return true;
  return false;
}

function stationLabel(value: string) {
  return value.endsWith('역') ? value : `${value}역`;
}

function deterministicFallback(
  transcript: string,
  currentIntent?: Partial<TicketIntent>,
  currentScreen?: string
): DialogTurnResult {
  const text = transcript.trim();
  const intent = mergeIntent(currentIntent);

  if (!text) {
    return {
      action: 'retry_listening',
      nextScreen: 'retry',
      say: '제가 잘 못 들었어요. 한 번만 더 말씀해 주세요.',
      intent,
      requiresTrainSearch: false,
      error: { code: 'STT_EMPTY', userMessage: '음성이 비어 있습니다.' }
    };
  }

  if (/다시\s*(찾|검색)|새로\s*(찾|검색)|다른\s*표/.test(text)) {
    return {
      action: 'ask_destination',
      nextScreen: 'dest',
      say: '좋아요. 다시 찾아드릴게요. 어디로, 언제 가세요?',
      intent: { ...defaultIntent(), departureStation: intent.departureStation || config.defaultDepartureStation },
      requiresTrainSearch: false
    };
  }

  if (/^(아니|아니요|틀려|틀렸|다시)/.test(text)) {
    return {
      action: 'ask_destination',
      nextScreen: 'dest',
      say: '괜찮아요. 어디로 가실지 다시 말씀해 주세요.',
      intent: { ...intent, arrivalStation: undefined, confirmation: 'no', missingFields: ['arrivalStation'] },
      requiresTrainSearch: false
    };
  }

  if (/^(네|예|응|맞아|맞아요|그래|좋아)/.test(text)) {
    const confirmed = recomputeMissing({ ...intent, confirmation: 'yes' });
    if (!confirmed.arrivalStation) {
      return { action: 'ask_destination', nextScreen: 'dest', say: '어디로 가실까요?', intent: confirmed, requiresTrainSearch: false };
    }
    if (!confirmed.timePreference) {
      return { action: 'ask_time', nextScreen: 'time', say: '몇 시쯤 떠나실까요?', intent: confirmed, requiresTrainSearch: false };
    }
    return {
      action: 'search_trains',
      nextScreen: 'searching',
      say: '좋아요. 실제 기차를 찾아볼게요.',
      intent: { ...confirmed, missingFields: [] },
      requiresTrainSearch: true
    };
  }

  if (/빠른|제일 빠/.test(text)) {
    return {
      action: 'select_train',
      nextScreen: 'done',
      say: '제일 빠른 기차로 선택했어요. 이제 결제 단계로 안내해드릴게요.',
      intent,
      selection: 'fastest',
      requiresTrainSearch: false
    };
  }

  if (/싼|저렴/.test(text)) {
    return {
      action: 'select_train',
      nextScreen: 'done',
      say: '제일 저렴한 기차로 선택했어요. 이제 결제 단계로 안내해드릴게요.',
      intent,
      selection: 'cheapest',
      requiresTrainSearch: false
    };
  }

  if (/부산/.test(text)) intent.arrivalStation = '부산';
  if (/대전/.test(text)) intent.arrivalStation = '대전';
  if (/동대구|대구/.test(text)) intent.arrivalStation = '동대구';
  if (/광주/.test(text)) intent.arrivalStation = '광주송정';
  if (/강릉/.test(text)) intent.arrivalStation = '강릉';
  if (/오늘/.test(text)) intent.date = todayInSeoul();
  if (/내일/.test(text)) {
    const d = new Date(`${todayInSeoul()}T00:00:00+09:00`);
    d.setDate(d.getDate() + 1);
    intent.date = d.toISOString().slice(0, 10);
  }
  const koreanHourMap: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12 };
  const hourMatch = text.match(/(오전|오후)?\s*(\d{1,2}|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열한|열두|열)\s*시/);
  if (hourMatch) {
    let hour = Number(hourMatch[2]) || koreanHourMap[hourMatch[2]];
    if (hourMatch[1] === '오후' && hour < 12) hour += 12;
    intent.timePreference = { kind: 'around', time: `${String(hour).padStart(2, '0')}:00` };
  } else if (/오후/.test(text)) {
    intent.timePreference = { kind: 'afternoon' };
  } else if (/아침|오전/.test(text)) {
    intent.timePreference = { kind: 'morning' };
  }

  if ((intent.arrivalStation || intent.timePreference) && !intent.date) intent.date = todayInSeoul();
  const completed = recomputeMissing(intent);
  completed.confidence = completed.arrivalStation ? 0.78 : 0.4;

  if (!completed.arrivalStation) {
    return { action: 'ask_destination', nextScreen: 'dest', say: '어디로 가실까요?', intent: completed, requiresTrainSearch: false };
  }

  if (currentScreen === 'time') {
    if (!completed.timePreference) {
      return { action: 'ask_time', nextScreen: 'time', say: '몇 시쯤 떠나실까요?', intent: completed, requiresTrainSearch: false };
    }
    return {
      action: 'search_trains',
      nextScreen: 'searching',
      say: '좋아요. 실제 기차를 찾아볼게요.',
      intent: { ...completed, confirmation: 'yes', missingFields: [] },
      requiresTrainSearch: true
    };
  }

  return {
    action: 'confirm_intent',
    nextScreen: 'confirm',
    say: `${stationLabel(completed.arrivalStation)} 맞으세요?`,
    intent: completed,
    requiresTrainSearch: false
  };
}

export async function runDialogTurn(input: {
  transcript: string;
  currentScreen?: string;
  currentIntent?: Partial<TicketIntent>;
  lastCandidates?: TrainCandidate[];
  session?: Partial<KioskSession>;
}): Promise<DialogTurnResult> {
  const transcript = input.transcript?.trim() ?? '';
  const heuristic = deterministicFallback(transcript, input.currentIntent, input.currentScreen);
  if (!config.openaiApiKey) return heuristic;
  if (isImmediateControlUtterance(transcript) || canUseFastHeuristic(heuristic, input.currentScreen)) {
    return heuristic;
  }

  const openai = getOpenAI();
  const today = todayInSeoul();
  const response = await openai.responses.create({
    model: config.openaiLlmModel,
    instructions: [
      '너는 한국 기차역의 친절한 사람 매표원처럼 행동하는 발권 도우미다.',
      '너의 역할은 사용자 발화를 발권 의도와 다음 UI action으로 구조화하는 것이다.',
      '부족한 정보는 한 번에 하나만 물어본다.',
      '노인 사용자에게 말하듯 짧고 쉬운 한국어 문장으로 say를 작성한다.',
      '열차 시간, 요금, 열차번호, 좌석 가능 여부는 절대 추측하지 않는다.',
      '실제 열차 조회가 필요하면 action=search_trains, nextScreen=searching, requiresTrainSearch=true만 반환한다.',
      '결제나 발권 완료를 거짓으로 말하지 않는다. MVP에서는 선택 후 결제 안내만 한다.',
      `오늘 날짜는 ${today}, 시간대는 Asia/Seoul이다.`,
      `기본 출발역은 ${config.defaultDepartureStation}이다.`
    ].join('\n'),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              transcript,
              currentScreen: input.currentScreen,
              currentIntent: mergeIntent(input.currentIntent),
              heuristicIntent: heuristic.intent,
              lastCandidates: input.lastCandidates ?? []
            })
          }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'mak_dialog_turn',
        strict: true,
        schema: dialogJsonSchema
      }
    }
  } as any);

  const text = response.output_text;
  if (!text) return deterministicFallback(transcript, input.currentIntent, input.currentScreen);
  return normalizeDialogResult(JSON.parse(text) as DialogTurnResult, heuristic.intent, input.currentScreen, transcript);
}

function normalizeDialogResult(result: DialogTurnResult, fallbackIntent?: TicketIntent, currentScreen?: string, transcript = ''): DialogTurnResult {
  const rawIntent = result.intent as TicketIntent & Record<string, unknown>;
  const intent = mergeIntent({
    ...rawIntent,
    departureStation: rawIntent.departureStation || fallbackIntent?.departureStation || undefined,
    arrivalStation: rawIntent.arrivalStation || fallbackIntent?.arrivalStation || undefined,
    date: rawIntent.date || fallbackIntent?.date || undefined,
    timePreference: normalizeTimePreference(rawIntent.timePreference || fallbackIntent?.timePreference),
    trainTypes: Array.isArray(rawIntent.trainTypes) && rawIntent.trainTypes.length ? rawIntent.trainTypes : ['KTX'],
    seatPreference: rawIntent.seatPreference || 'any',
    confirmation: rawIntent.confirmation || 'unknown'
  });
  intent.missingFields = [];
  if (!intent.arrivalStation) intent.missingFields.push('arrivalStation');
  if (!intent.date) intent.missingFields.push('date');
  if (!intent.timePreference) intent.missingFields.push('timePreference');

  const normalized: DialogTurnResult = {
    ...result,
    intent,
    selection: result.action === 'select_train' ? result.selection || undefined : undefined,
    error: result.error || undefined
  };

  const negative = /^(아니|아니요|틀려|틀렸|다시)/.test(transcript.trim());
  if (negative) {
    return {
      ...normalized,
      action: 'ask_destination',
      nextScreen: 'dest',
      say: '괜찮아요. 어디로 가실지 다시 말씀해 주세요.',
      intent: recomputeMissing({ ...intent, arrivalStation: undefined, confirmation: 'no' }),
      requiresTrainSearch: false
    };
  }

  if (normalized.action === 'select_train') {
    return { ...normalized, nextScreen: 'done', requiresTrainSearch: false };
  }

  if (!intent.arrivalStation || intent.missingFields.includes('arrivalStation')) {
    return { ...normalized, action: 'ask_destination', nextScreen: 'dest', say: '어디로 가실까요?', requiresTrainSearch: false };
  }

  if (normalized.requiresTrainSearch || intent.confirmation === 'yes') {
    if (!intent.timePreference) {
      return { ...normalized, action: 'ask_time', nextScreen: 'time', say: '몇 시쯤 떠나실까요?', requiresTrainSearch: false };
    }
    return { ...normalized, action: 'search_trains', nextScreen: 'searching', say: '좋아요. 실제 기차를 찾아볼게요.', requiresTrainSearch: true };
  }

  if (currentScreen === 'time' && intent.timePreference) {
    return { ...normalized, action: 'search_trains', nextScreen: 'searching', say: '좋아요. 실제 기차를 찾아볼게요.', requiresTrainSearch: true };
  }

  return {
    ...normalized,
    action: 'confirm_intent',
    nextScreen: 'confirm',
    say: `${stationLabel(intent.arrivalStation)} 맞으세요?`,
    requiresTrainSearch: false
  };
}




function recomputeMissing(intent: TicketIntent): TicketIntent {
  const missingFields: TicketIntent['missingFields'] = [];
  if (!intent.arrivalStation) missingFields.push('arrivalStation');
  if (!intent.timePreference) missingFields.push('timePreference');
  return { ...intent, date: intent.date || todayInSeoul(), missingFields };
}

function normalizeTimePreference(value: unknown): TicketIntent['timePreference'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const pref = value as { kind?: NonNullable<TicketIntent['timePreference']>['kind']; time?: string | null };
  if (!pref.kind) return undefined;
  return { kind: pref.kind, time: pref.time || undefined };
}

function describeTime(intent: TicketIntent) {
  const pref = intent.timePreference;
  if (!pref) return '';
  if (pref.time) {
    const [hRaw, mRaw] = pref.time.split(':');
    const h = Number(hRaw);
    const m = Number(mRaw || 0);
    const ampm = h >= 12 ? '오후' : '오전';
    const hour = h > 12 ? h - 12 : h;
    return `${ampm} ${hour}시${m ? ` ${m}분` : ''}쯤`;
  }
  if (pref.kind === 'afternoon') return '오후';
  if (pref.kind === 'morning') return '오전';
  if (pref.kind === 'evening') return '저녁';
  return '';
}
