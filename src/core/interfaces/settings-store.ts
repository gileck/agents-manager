export interface ISettingsStore {
  get(key: string, defaultValue?: string): string;
  set(key: string, value: string): void;
  getAll(): Record<string, string>;
  setMany(updates: Record<string, string>): void;
}
