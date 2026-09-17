/** Startup facts worth seeing in the dev log. One line, no levels, no library. */
export function log(message: string): void {
  console.log(`[duang] ${message}`);
}
