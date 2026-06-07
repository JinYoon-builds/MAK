export const dialogJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'nextScreen', 'say', 'intent', 'requiresTrainSearch', 'selection', 'error'],
  properties: {
    action: {
      type: 'string',
      enum: [
        'ask_destination',
        'ask_time',
        'confirm_intent',
        'search_trains',
        'show_results',
        'select_train',
        'retry_listening',
        'handoff_staff'
      ]
    },
    nextScreen: {
      type: 'string',
      enum: ['start', 'dest', 'confirm', 'time', 'summary', 'searching', 'results', 'done', 'nudge', 'idle', 'retry', 'staff']
    },
    say: { type: 'string' },
    requiresTrainSearch: { type: 'boolean' },
    selection: { type: ['string', 'null'], enum: ['fastest', 'cheapest', 'soonest', 'first', 'unknown', null] },
    error: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'userMessage'],
          properties: {
            code: {
              type: 'string',
              enum: ['STT_EMPTY', 'LOW_CONFIDENCE', 'TRAIN_API_TIMEOUT', 'NO_TRAINS', 'PROVIDER_ERROR', 'INVALID_INTENT']
            },
            userMessage: { type: 'string' }
          }
        }
      ]
    },
    intent: {
      type: 'object',
      additionalProperties: false,
      required: [
        'departureStation',
        'arrivalStation',
        'date',
        'timePreference',
        'passengerCount',
        'trainTypes',
        'seatPreference',
        'confirmation',
        'missingFields',
        'confidence'
      ],
      properties: {
        departureStation: { type: ['string', 'null'] },
        arrivalStation: { type: ['string', 'null'] },
        date: { type: ['string', 'null'] },
        timePreference: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'time'],
              properties: {
                kind: { type: 'string', enum: ['around', 'after', 'before', 'morning', 'afternoon', 'evening', 'any'] },
                time: { type: ['string', 'null'] }
              }
            }
          ]
        },
        passengerCount: { type: 'integer', minimum: 1, maximum: 9 },
        trainTypes: { type: 'array', items: { type: 'string', enum: ['KTX', 'ITX', 'MUGUNGHWA', 'SRT', 'ANY'] } },
        seatPreference: { type: ['string', 'null'], enum: ['window', 'aisle', 'any', null] },
        confirmation: { type: ['string', 'null'], enum: ['yes', 'no', 'unknown', null] },
        missingFields: {
          type: 'array',
          items: { type: 'string', enum: ['arrivalStation', 'date', 'timePreference', 'passengerCount'] }
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 }
      }
    }
  }
} as const;
