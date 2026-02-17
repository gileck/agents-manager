import { reportError } from './error-handler';

function humanize(path: string): string {
  // "tasks.delete" → "Delete task"
  const parts = path.split('.');
  if (parts.length < 2) return path;

  const resource = parts[parts.length - 2];
  const action = parts[parts.length - 1];

  // Singularize: "tasks" → "task"
  const singular = resource.endsWith('s') ? resource.slice(0, -1) : resource;

  // Capitalize action
  const capitalized = action.charAt(0).toUpperCase() + action.slice(1);

  return `${capitalized} ${singular}`;
}

function createProxy(target: unknown, path: string): unknown {
  if (target === null || target === undefined) return target;
  if (typeof target !== 'object' && typeof target !== 'function') return target;

  return new Proxy(target as object, {
    get(_obj, prop) {
      const value = (target as Record<string | symbol, unknown>)[prop];
      const propName = typeof prop === 'string' ? prop : String(prop);
      const currentPath = path ? `${path}.${propName}` : propName;

      // Skip event listener namespace — these aren't IPC invoke calls
      if (propName === 'on') return value;

      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          try {
            const result = (value as Function).apply(target, args);

            // Only intercept Promise-returning (async IPC) calls
            if (result && typeof result === 'object' && typeof (result as Promise<unknown>).then === 'function') {
              return (result as Promise<unknown>).catch((err: unknown) => {
                const error = err instanceof Error ? err : new Error(String(err));
                (error as Error & { __reported?: boolean }).__reported = true;
                reportError(error, humanize(currentPath));
                throw error;
              });
            }

            return result;
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            (error as Error & { __reported?: boolean }).__reported = true;
            reportError(error, humanize(currentPath));
            throw error;
          }
        };
      }

      // Recurse into nested namespaces (e.g. window.api.tasks.*)
      if (typeof value === 'object' && value !== null) {
        return createProxy(value, currentPath);
      }

      return value;
    },
  });
}

export function installApiErrorProxy(): void {
  if (!window.api) return;
  (window as Window & { api: unknown }).api = createProxy(window.api, 'api');
}
