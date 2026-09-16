/** Tiny className joiner so conditional classes stay readable inline. */
export function Cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}
