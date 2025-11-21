/*
  Centralized escape hatch for missing Supabase table types.
  Replace usages with proper typed queries once Database types include tables.
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fromUnsafe = (client: any) =>
  // Keep method binding by accessing via client
  (table: string) => client.from(table);
