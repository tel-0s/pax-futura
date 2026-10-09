/** Present in every runtime we target (Node 18+ and all browsers); the pure
 *  ES lib doesn't declare it because it's a host global, not a language API.
 *  Declared as a global via a real module so it travels with the import graph
 *  into every package that compiles domain sources. */
declare global {
  function structuredClone<T>(value: T, options?: { transfer?: unknown[] }): T;
}

export {};
