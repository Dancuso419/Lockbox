import { describe, it, expect, beforeEach } from "vitest";

// The suite runs in node, and what's under test is the bookkeeping, not the
// browser's storage — so a map standing in for localStorage is enough, and
// avoids dragging in a DOM implementation for four string operations.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

import { listPools, rememberPool, forgetPool } from "./myPools";

const ALICE = "0xAAaAaA00000000000000000000000000000000Aa";
const BOB = "0xBbBbBb00000000000000000000000000000000Bb";
const POOL_1 = "0x1111111111111111111111111111111111111111";
const POOL_2 = "0x2222222222222222222222222222222222222222";

describe("remembered pools", () => {
  beforeEach(() => localStorage.clear());

  it("keeps each wallet's pools apart", () => {
    rememberPool(ALICE, POOL_1);
    rememberPool(BOB, POOL_2);
    expect(listPools(ALICE)).toEqual([POOL_1]);
    expect(listPools(BOB)).toEqual([POOL_2]);
  });

  it("puts the newest first and never duplicates", () => {
    rememberPool(ALICE, POOL_1);
    rememberPool(ALICE, POOL_2);
    rememberPool(ALICE, POOL_1); // revisiting an old pool
    expect(listPools(ALICE)).toEqual([POOL_1, POOL_2]);
  });

  it("matches a wallet whatever case it arrives in", () => {
    rememberPool(ALICE, POOL_1);
    expect(listPools(ALICE.toLowerCase())).toEqual([POOL_1]);
    expect(listPools(ALICE.toUpperCase())).toEqual([POOL_1]);
  });

  it("forgets on request, leaving the rest", () => {
    rememberPool(ALICE, POOL_1);
    rememberPool(ALICE, POOL_2);
    forgetPool(ALICE, POOL_1);
    expect(listPools(ALICE)).toEqual([POOL_2]);
  });

  it("answers with an empty list rather than throwing", () => {
    expect(listPools(undefined)).toEqual([]);
    expect(listPools(ALICE)).toEqual([]);
    localStorage.setItem("lockbox.pools.v1", "not json");
    expect(listPools(ALICE)).toEqual([]);
  });
});
