import { randomUUID } from 'crypto';

export function generateId(): string {
  return randomUUID();
}

export function now(): number {
  return Date.now();
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
