export interface OutputOptions {
  json?: boolean;
  quiet?: boolean;
}

export function output(data: unknown, opts: OutputOptions): void {
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (opts.quiet) {
    // For arrays, print IDs one per line; for objects with id, print just the id
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === 'object' && 'id' in item) {
          console.log(item.id);
        }
      }
    } else if (data && typeof data === 'object' && 'id' in (data as Record<string, unknown>)) {
      console.log((data as Record<string, unknown>).id);
    }
    return;
  }

  // Default: formatted output
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log('No results.');
      return;
    }
    printTable(data);
  } else {
    printDetail(data as Record<string, unknown>);
  }
}

function printTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;

  const keys = Object.keys(rows[0]);
  const widths: Record<string, number> = {};

  for (const key of keys) {
    widths[key] = key.length;
    for (const row of rows) {
      const val = formatValue(row[key]);
      widths[key] = Math.max(widths[key], val.length);
    }
  }

  // Header
  const header = keys.map((k) => k.toUpperCase().padEnd(widths[k])).join('  ');
  console.log(header);
  console.log(keys.map((k) => '-'.repeat(widths[k])).join('  '));

  // Rows
  for (const row of rows) {
    const line = keys.map((k) => formatValue(row[k]).padEnd(widths[k])).join('  ');
    console.log(line);
  }
}

function printDetail(obj: Record<string, unknown>): void {
  const maxKeyLen = Math.max(...Object.keys(obj).map((k) => k.length));
  for (const [key, value] of Object.entries(obj)) {
    const label = key.padEnd(maxKeyLen);
    const val = typeof value === 'object' && value !== null
      ? JSON.stringify(value)
      : String(value ?? '');
    console.log(`${label}  ${val}`);
  }
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}
