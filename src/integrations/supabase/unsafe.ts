/*
  Centralized escape hatch for missing Supabase table types.
  Replace usages with proper typed queries once Database types include tables.
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fromUnsafe = (fromFn: any) =>
  // Wrap to confine `any` to this module
  (table: string) => fromFn(table);

