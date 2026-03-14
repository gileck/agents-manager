/**
 * Read a value from stdin when the user passes "-" as the value.
 * Returns undefined if value is undefined, reads all of stdin if value is "-",
 * or returns the value as-is otherwise.
 */
export async function readStdinOrValue(value: string | undefined): Promise<string | undefined> {
  if (value === undefined) return undefined;
  if (value !== '-') return value;

  // Read all of stdin
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8').trimEnd();
  } catch (err) {
    throw new Error(`Failed to read from stdin: ${err instanceof Error ? err.message : 'unknown error'}`, { cause: err });
  }
}
