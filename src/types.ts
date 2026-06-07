export type ScreenId =
  | 'start'
  | 'dest'
  | 'confirm'
  | 'time'
  | 'summary'
  | 'searching'
  | 'results'
  | 'done'
  | 'nudge'
  | 'idle'
  | 'retry'
  | 'staff';

export type TimePreference = {
  kind: 'around' | 'after' | 'before' | 'morning' | 'afternoon' | 'evening' | 'any';
  time?: string;
};

export type TicketIntent = {
  departureStation?: string;
  arrivalStation?: string;
  date?: string;
  timePreference?: TimePreference;
  passengerCount: number;
  trainTypes?: Array<'KTX' | 'ITX' | 'MUGUNGHWA' | 'SRT' | 'ANY'>;
  seatPreference?: 'window' | 'aisle' | 'any';
  confirmation?: 'yes' | 'no' | 'unknown';
  missingFields: Array<'arrivalStation' | 'date' | 'timePreference' | 'passengerCount'>;
  confidence: number;
};

export type TrainCandidate = {
  id: string;
  trainNo: string;
  trainName: string;
  departureStation: string;
  arrivalStation: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  adultFareKrw?: number;
  tags: Array<'fastest' | 'cheapest' | 'soonest' | 'recommended'>;
  source: 'TAGO' | 'MOCK';
};

export type AgentAction =
  | 'ask_destination'
  | 'ask_time'
  | 'confirm_intent'
  | 'search_trains'
  | 'show_results'
  | 'select_train'
  | 'retry_listening'
  | 'handoff_staff';

export type DialogTurnResult = {
  action: AgentAction;
  nextScreen: ScreenId;
  say: string;
  intent: TicketIntent;
  requiresTrainSearch: boolean;
  selection?: 'fastest' | 'cheapest' | 'soonest' | 'first' | 'unknown';
  error?: {
    code: 'STT_EMPTY' | 'LOW_CONFIDENCE' | 'TRAIN_API_TIMEOUT' | 'NO_TRAINS' | 'PROVIDER_ERROR' | 'INVALID_INTENT';
    userMessage: string;
  };
};

export type KioskSession = {
  currentScreen: ScreenId;
  intent: TicketIntent;
  transcriptHistory: string[];
  assistantMessages: string[];
  trainCandidates: TrainCandidate[];
  selectedCandidate?: TrainCandidate;
  retryCount: number;
};
