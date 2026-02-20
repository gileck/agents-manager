export interface OutcomeDefinition {
  description: string;
  schema: OutcomeSchema | null; // null = signal-only, no payload
}

interface OutcomeSchema {
  required: string[];
  properties: Record<string, { type: string }>;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export const OUTCOME_SCHEMAS: Record<string, OutcomeDefinition> = {
  // WITH payloads
  needs_info: {
    description: 'Agent needs additional information from the user',
    schema: {
      required: ['questions'],
      properties: {
        questions: { type: 'array' },
      },
    },
  },
  options_proposed: {
    description: 'Agent is presenting options for the user to choose from',
    schema: {
      required: ['summary', 'options'],
      properties: {
        summary: { type: 'string' },
        options: { type: 'array' },
      },
    },
  },
  changes_requested: {
    description: 'Review found issues that need to be addressed',
    schema: {
      required: ['summary', 'comments'],
      properties: {
        summary: { type: 'string' },
        comments: { type: 'array' },
      },
    },
  },
  // Signal-only (no payload)
  failed: { description: 'Agent execution failed (timeout, error, or abort)', schema: null },
  interrupted: { description: 'Agent run interrupted (e.g. app shutdown)', schema: null },
  no_changes: { description: 'Agent completed but made no changes', schema: null },
  conflicts_detected: { description: 'Merge conflicts detected on branch', schema: null },
  plan_complete: { description: 'Planning finished', schema: null },
  investigation_complete: { description: 'Investigation finished', schema: null },
  pr_ready: { description: 'Implementation done, PR created', schema: null },
  approved: { description: 'Review passed', schema: null },
  design_ready: { description: 'Design completed', schema: null },
  reproduced: { description: 'Bug reproduced', schema: null },
  cannot_reproduce: { description: 'Bug not reproducible', schema: null },
};

const JS_TYPE_CHECKS: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
};

export function validateOutcomePayload(outcome: string, payload: unknown): ValidationResult {
  const definition = OUTCOME_SCHEMAS[outcome];

  // Unknown outcome — warn but don't block
  if (!definition) {
    return { valid: false, error: `Unknown outcome: "${outcome}"` };
  }

  // Signal-only outcome: payload should be absent or empty
  if (definition.schema === null) {
    return { valid: true };
  }

  // Schema-based outcome requires an object payload
  if (typeof payload !== 'object' || payload === null) {
    return { valid: false, error: `Outcome "${outcome}" requires an object payload` };
  }

  const obj = payload as Record<string, unknown>;
  const { required, properties } = definition.schema;

  // Check required fields
  for (const field of required) {
    if (!(field in obj)) {
      return { valid: false, error: `Outcome "${outcome}" payload missing required field: "${field}"` };
    }

    // Check type if defined
    const expectedType = properties[field]?.type;
    if (expectedType) {
      const check = JS_TYPE_CHECKS[expectedType];
      if (check && !check(obj[field])) {
        return { valid: false, error: `Outcome "${outcome}" payload field "${field}" must be ${expectedType}` };
      }
    }
  }

  return { valid: true };
}
