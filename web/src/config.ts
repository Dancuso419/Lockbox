export const CONFIG = {
  bffUrl: import.meta.env.VITE_BFF_URL ?? "http://localhost:8081",
  poolFactory: import.meta.env.VITE_POOL_FACTORY as `0x${string}`, // deployed via M8 script
  rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
  explorer: "https://coston2-explorer.flare.network",
  chainId: 114,
} as const;
