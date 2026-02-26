import type { IAgentLib } from '../interfaces/agent-lib';

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
