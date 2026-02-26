import type { IAgentLib, AgentLibModelOption } from '../interfaces/agent-lib';

export class AgentLibRegistry {
  private libs = new Map<string, IAgentLib>();

  register(lib: IAgentLib): void {
    this.libs.set(lib.name, lib);
  }

  getLib(name: string): IAgentLib {
    const lib = this.libs.get(name);
    if (!lib) {
      throw new Error(`Agent lib not registered: ${name}. Available: ${Array.from(this.libs.keys()).join(', ')}`);
    }
    return lib;
  }

  listNames(): string[] {
    return Array.from(this.libs.keys());
  }

  getModelsForLib(name: string): AgentLibModelOption[] {
    return this.getLib(name).getSupportedModels();
  }

  getAllModels(): Record<string, { models: AgentLibModelOption[]; defaultModel: string }> {
    const result: Record<string, { models: AgentLibModelOption[]; defaultModel: string }> = {};
    for (const [name, lib] of this.libs) {
      result[name] = { models: lib.getSupportedModels(), defaultModel: lib.getDefaultModel() };
    }
    return result;
  }

  async getAvailableLibs(): Promise<{ name: string; available: boolean }[]> {
    const results: { name: string; available: boolean }[] = [];
    for (const lib of this.libs.values()) {
      try {
        const available = await lib.isAvailable();
        results.push({ name: lib.name, available });
      } catch {
        results.push({ name: lib.name, available: false });
      }
    }
    return results;
  }
}
