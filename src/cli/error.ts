import { ApiError } from '../client/api-client';

/**
 * Handle CLI command errors consistently.
 * - ApiError with 404 → "Not found: <entity>"
 * - ApiError with other status → show status + server message
 * - Other errors → show error message
 * - Unknown → show fallback message
 */
export function handleCliError(err: unknown, fallbackMessage: string): void {
  if (err instanceof ApiError) {
    console.error(`${fallbackMessage}: ${err.message} (HTTP ${err.status})`);
  } else if (err instanceof Error) {
    console.error(err.message);
  } else {
    console.error(fallbackMessage);
  }
  process.exitCode = 1;
}
