import { describe, it, expect } from 'vitest';
import { AGENT_BUILDERS } from '../../src/core/agents/agent-builders';
import {
  VALID_TASK_TYPES,
  VALID_TASK_SIZES,
  VALID_TASK_COMPLEXITIES,
  VALID_START_PHASES,
} from '../../src/shared/types';
import type { AgentContext } from '../../src/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal AgentContext stub sufficient for getOutputFormat() calls. */
function makeMinimalContext(): AgentContext {
  return {
    task: {
      id: 'test-task',
      projectId: 'test-project',
      pipelineId: 'test-pipeline',
      title: 'Test task',
      description: null,
      type: 'bug',
      size: null,
      complexity: null,
      status: 'open',
      priority: 2,
      tags: [],
      parentTaskId: null,
      featureId: null,
      assignee: null,
      prLink: null,
      branchName: null,
      plan: null,
      investigationReport: null,
      technicalDesign: null,
      postMortem: null,
      debugInfo: null,
      subtasks: [],
      phases: null,
      planComments: [],
      technicalDesignComments: [],
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: null,
    },
    project: {
      id: 'test-project',
      name: 'Test Project',
      description: null,
      path: '/tmp/test',
      config: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    workdir: '/tmp/test',
    mode: 'new',
  };
}

interface SchemaProperty {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
}

interface EnumField {
  path: string;
  fieldName: string;
  values: unknown[];
}

/**
 * Recursively traverse a JSON schema and collect all enum fields.
 * `path` tracks the dotted property path for error messages.
 */
function collectEnumFields(
  schema: SchemaProperty,
  path: string,
): EnumField[] {
  const results: EnumField[] = [];

  if (schema.enum) {
    const fieldName = path.split('.').pop() ?? path;
    results.push({ path, fieldName, values: schema.enum });
  }

  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      results.push(...collectEnumFields(value, `${path}.${key}`));
    }
  }

  if (schema.items) {
    results.push(...collectEnumFields(schema.items, `${path}[]`));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Mapping: field names → shared constants they must match
// ---------------------------------------------------------------------------

/**
 * Maps schema field names to the shared constant arrays they should be
 * a subset of. The test asserts every enum value appears in the constant.
 */
const FIELD_CONSTANT_MAP: Record<string, { constant: readonly string[]; label: string }> = {
  type: { constant: VALID_TASK_TYPES, label: 'VALID_TASK_TYPES' },
  suggestedType: { constant: VALID_TASK_TYPES, label: 'VALID_TASK_TYPES' },
  size: { constant: VALID_TASK_SIZES, label: 'VALID_TASK_SIZES' },
  complexity: { constant: VALID_TASK_COMPLEXITIES, label: 'VALID_TASK_COMPLEXITIES' },
  startPhase: { constant: VALID_START_PHASES, label: 'VALID_START_PHASES' },
  suggestedPhase: { constant: VALID_START_PHASES, label: 'VALID_START_PHASES' },
};

/**
 * Known exceptions: specific (agentType, path) combinations where the enum
 * intentionally includes extra values beyond the shared constant. The extra
 * values are listed so the test can verify them explicitly.
 */
const KNOWN_EXTENSIONS: Record<string, string[]> = {
  // Triager's suggestedPhase also allows 'closed' (task irrelevant)
  'triager:.suggestedPhase': ['closed'],
  // Investigator's proposedOptions[].size uses fix-tier letters (S/M/L/XL), not task-size values
  'investigator:.proposedOptions[].size': ['S', 'M', 'L', 'XL'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Prompt builder output schemas — enum consistency', () => {
  const context = makeMinimalContext();
  const builderEntries = Object.entries(AGENT_BUILDERS);

  it('should have at least 9 registered prompt builders', () => {
    expect(builderEntries.length).toBeGreaterThanOrEqual(9);
  });

  for (const [agentType, BuilderClass] of builderEntries) {
    describe(`${agentType} prompt builder`, () => {
      it('should instantiate without errors', () => {
        const builder = new BuilderClass();
        expect(builder.type).toBe(agentType);
      });

      it('should produce a valid output format (or undefined)', () => {
        const builder = new BuilderClass();
        // Access protected method via buildExecutionConfig
        const config = builder.buildExecutionConfig(context, {}, undefined);
        const format = config.outputFormat as { schema?: SchemaProperty } | undefined;

        if (format === undefined) {
          // Some builders may not define an output format for certain contexts
          return;
        }

        expect(format).toHaveProperty('schema');
      });

      it('should have task-classification enum fields matching shared constants', () => {
        const builder = new BuilderClass();
        const config = builder.buildExecutionConfig(context, {}, undefined);
        const format = config.outputFormat as { schema?: SchemaProperty } | undefined;

        if (!format?.schema) return;

        const enumFields = collectEnumFields(format.schema, '');

        for (const field of enumFields) {
          const mapping = FIELD_CONSTANT_MAP[field.fieldName];
          if (!mapping) continue; // Not a task-classification field

          const key = `${agentType}:${field.path}`;
          const knownExtras = KNOWN_EXTENSIONS[key] ?? [];
          const allowedValues = new Set<string>([
            ...mapping.constant,
            ...knownExtras,
          ]);

          for (const value of field.values) {
            expect(
              allowedValues.has(value as string),
              `${agentType} schema field "${field.path}" has enum value "${value}" ` +
              `not found in ${mapping.label} (${[...mapping.constant].join(', ')})` +
              (knownExtras.length > 0 ? ` or known extensions (${knownExtras.join(', ')})` : ''),
            ).toBe(true);
          }
        }
      });
    });
  }

  // Verify that all shared constants are non-empty (guard against accidental clearing)
  describe('shared constants sanity', () => {
    it('VALID_TASK_TYPES should be non-empty', () => {
      expect(VALID_TASK_TYPES.length).toBeGreaterThan(0);
    });

    it('VALID_TASK_SIZES should be non-empty', () => {
      expect(VALID_TASK_SIZES.length).toBeGreaterThan(0);
    });

    it('VALID_TASK_COMPLEXITIES should be non-empty', () => {
      expect(VALID_TASK_COMPLEXITIES.length).toBeGreaterThan(0);
    });

    it('VALID_START_PHASES should be non-empty', () => {
      expect(VALID_START_PHASES.length).toBeGreaterThan(0);
    });
  });
});
