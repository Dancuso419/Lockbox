/**
 * The pools a wallet has worked on, remembered in this browser.
 *
 * Not a chain query, deliberately: PoolCreated carries the organizer, but
 * Coston2's public RPC caps eth_getLogs at 30 blocks, so finding a pool made
 * last week would take thousands of requests. Remembering locally is honest
 * about what it is — a convenience list, per browser — and the address itself
 * remains the source of truth, so nothing is lost by pasting one in by hand.
 */

const KEY = "lockbox.pools.v1";

type Book = Record<string, string[]>; // owner (lowercased) → pool addresses

function read(): Book {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Book) : {};
  } catch {
    // ponytail: private mode or corrupt entry — an empty list is a fine answer
    return {};
  }
}

function write(book: Book) {
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    // Non-fatal: the picker just won't remember across reloads.
  }
}

/** Pools this wallet has created or loaded, newest first. */
export function listPools(owner: string | undefined): string[] {
  if (!owner) return [];
  return read()[owner.toLowerCase()] ?? [];
}

/** Record a pool against a wallet. Newest first, no duplicates. */
export function rememberPool(owner: string | undefined, pool: string): void {
  if (!owner || !pool) return;
  const book = read();
  const key = owner.toLowerCase();
  const existing = (book[key] ?? []).filter((p) => p.toLowerCase() !== pool.toLowerCase());
  book[key] = [pool, ...existing].slice(0, 20);
  write(book);
}

export function forgetPool(owner: string | undefined, pool: string): void {
  if (!owner) return;
  const book = read();
  const key = owner.toLowerCase();
  book[key] = (book[key] ?? []).filter((p) => p.toLowerCase() !== pool.toLowerCase());
  write(book);
}
