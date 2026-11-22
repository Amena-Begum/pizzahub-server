/** Parses YYYY-MM-DD as midnight UTC so the same calendar day is stored for everyone. */
export function parseDateOnly(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** Today's date at midnight UTC, minus a 14 hour grace so customers far west of UTC can still pick their "today". */
export function earliestDeliveryDate() {
  const now = new Date(Date.now() - 14 * 60 * 60 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function daysAgo(days: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

/** Fills missing days with zero so charts show a continuous line. */
export function fillDays<T extends Record<string, number>>(rows: ({ _id: string } & Partial<T>)[], days: number, keys: (keyof T)[]) {
  const map = new Map(rows.map((r) => [r._id, r]));
  const out: ({ date: string } & T)[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = daysAgo(i).toISOString().slice(0, 10);
    const row = map.get(day);
    const entry = { date: day } as { date: string } & T;
    for (const k of keys) (entry as Record<string, unknown>)[k as string] = (row?.[k] as number) ?? 0;
    out.push(entry);
  }
  return out;
}
