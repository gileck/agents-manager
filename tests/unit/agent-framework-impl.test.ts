import { describe, it, expect, vi } from 'vitest';
import { AgentFrameworkImpl } from '../../src/main/services/agent-framework-impl';
import type { IAgent } from '../../src/main/interfaces/agent';
import type { AgentRunResult } from '../../src/shared/types';

function createMockAgent(type: string, available = true): IAgent {
  return {
    type,
    execute: vi.fn().mockResolvedValue({
      exitCode: 0,
      output: 'done',
      outcome: 'success',
    } as AgentRunResult),
    stop: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(available),
  };
}

describe('AgentFrameworkImpl', () => {
  describe('registerAgent and getAgent', () => {
    it('registers an agent and retrieves it by type', () => {
      const framework = new AgentFrameworkImpl();
      const agent = createMockAgent('planner');

      framework.registerAgent(agent);

      const retrieved = framework.getAgent('planner');
      expect(retrieved).toBe(agent);
      expect(retrieved.type).toBe('planner');
    });

    it('overwrites agent when registering same type twice', () => {
      const framework = new AgentFrameworkImpl();
      const agent1 = createMockAgent('planner');
      const agent2 = createMockAgent('planner');

      framework.registerAgent(agent1);
      framework.registerAgent(agent2);

      const retrieved = framework.getAgent('planner');
      expect(retrieved).toBe(agent2);
      expect(retrieved).not.toBe(agent1);
    });

    it('throws error when getting an unregistered agent type', () => {
      const framework = new AgentFrameworkImpl();

      expect(() => framework.getAgent('nonexistent')).toThrow(
        'Agent type not registered: nonexistent'
      );
    });

    it('registers and retrieves multiple agents of different types', () => {
      const framework = new AgentFrameworkImpl();
      const planner = createMockAgent('planner');
      const reviewer = createMockAgent('reviewer');
      const implementer = createMockAgent('implementer');

      framework.registerAgent(planner);
      framework.registerAgent(reviewer);
      framework.registerAgent(implementer);

      expect(framework.getAgent('planner')).toBe(planner);
      expect(framework.getAgent('reviewer')).toBe(reviewer);
      expect(framework.getAgent('implementer')).toBe(implementer);
    });
  });

  describe('listAgents', () => {
    it('returns empty array when no agents are registered', () => {
      const framework = new AgentFrameworkImpl();

      const result = framework.listAgents();

      expect(result).toEqual([]);
    });

    it('returns AgentInfo for all registered agents', () => {
      const framework = new AgentFrameworkImpl();
      framework.registerAgent(createMockAgent('planner'));
      framework.registerAgent(createMockAgent('reviewer'));

      const result = framework.listAgents();

      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'planner',
            name: 'planner',
            description: 'Agent: planner',
            available: false,
          }),
          expect.objectContaining({
            type: 'reviewer',
            name: 'reviewer',
            description: 'Agent: reviewer',
            available: false,
          }),
        ])
      );
    });

    it('always sets available to false in listAgents', () => {
      const framework = new AgentFrameworkImpl();
      // Even if the agent says it's available, listAgents returns available: false
      framework.registerAgent(createMockAgent('planner', true));

      const result = framework.listAgents();

      expect(result[0].available).toBe(false);
    });
  });

  describe('getAvailableAgents', () => {
    it('calls isAvailable() on each agent and returns results', async () => {
      const framework = new AgentFrameworkImpl();
      const available = createMockAgent('planner', true);
      const unavailable = createMockAgent('reviewer', false);

      framework.registerAgent(available);
      framework.registerAgent(unavailable);

      const result = await framework.getAvailableAgents();

      expect(available.isAvailable).toHaveBeenCalledOnce();
      expect(unavailable.isAvailable).toHaveBeenCalledOnce();

      expect(result).toHaveLength(2);

      const plannerInfo = result.find(a => a.type === 'planner');
      const reviewerInfo = result.find(a => a.type === 'reviewer');

      expect(plannerInfo!.available).toBe(true);
      expect(reviewerInfo!.available).toBe(false);
    });

    it('returns empty array when no agents are registered', async () => {
      const framework = new AgentFrameworkImpl();

      const result = await framework.getAvailableAgents();

      expect(result).toEqual([]);
    });

    it('returns correct AgentInfo structure', async () => {
      const framework = new AgentFrameworkImpl();
      framework.registerAgent(createMockAgent('implementer', true));

      const result = await framework.getAvailableAgents();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'implementer',
        name: 'implementer',
        description: 'Agent: implementer',
        available: true,
      });
    });
  });
});
