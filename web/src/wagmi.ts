import { http, createConfig } from "wagmi";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";
import { CONFIG } from "./config";

export const coston2 = defineChain({
  id: 114,
  name: "Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
  blockExplorers: { default: { name: "Coston2 Explorer", url: CONFIG.explorer } },
});

export const wagmiConfig = createConfig({
  chains: [coston2],
  connectors: [injected()],
  transports: { [coston2.id]: http(CONFIG.rpcUrl) },
});
