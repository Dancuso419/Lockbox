import type { PublicClient } from "viem";
import PoolAbi from "../abi/Pool.json";
import PoolFactoryAbi from "../abi/PoolFactory.json";
import { CONFIG } from "../config";

export const poolFactoryConfig = {
  address: CONFIG.poolFactory,
  abi: PoolFactoryAbi,
} as const;

export function poolConfig(address: `0x${string}`) {
  return { address, abi: PoolAbi } as const;
}

export interface PoolState {
  organizer: `0x${string}`;
  asset: `0x${string}`;
  totalDeposited: bigint;
  totalClaimed: bigint;
  deadline: bigint;
  status: number;
  complianceReported: boolean;
  reportedTotalAllocated: bigint;
  reportedRecipientCount: bigint;
  authorizedSigner: `0x${string}`;
}

// readPool fetches all pool state fields in parallel.
// ponytail: individual calls rather than multicall3 — simpler, no multicall3 address needed on Coston2
export async function readPool(
  publicClient: PublicClient,
  address: `0x${string}`
): Promise<PoolState> {
  const cfg = { address, abi: PoolAbi } as const;
  const [
    organizer,
    asset,
    totalDeposited,
    totalClaimed,
    deadline,
    status,
    complianceReported,
    reportedTotalAllocated,
    reportedRecipientCount,
    authorizedSigner,
  ] = await Promise.all([
    publicClient.readContract({ ...cfg, functionName: "organizer" }),
    publicClient.readContract({ ...cfg, functionName: "asset" }),
    publicClient.readContract({ ...cfg, functionName: "totalDeposited" }),
    publicClient.readContract({ ...cfg, functionName: "totalClaimed" }),
    publicClient.readContract({ ...cfg, functionName: "deadline" }),
    publicClient.readContract({ ...cfg, functionName: "status" }),
    publicClient.readContract({ ...cfg, functionName: "complianceReported" }),
    publicClient.readContract({ ...cfg, functionName: "reportedTotalAllocated" }),
    publicClient.readContract({ ...cfg, functionName: "reportedRecipientCount" }),
    publicClient.readContract({ ...cfg, functionName: "authorizedSigner" }),
  ]);

  return {
    organizer: organizer as `0x${string}`,
    asset: asset as `0x${string}`,
    totalDeposited: totalDeposited as bigint,
    totalClaimed: totalClaimed as bigint,
    deadline: deadline as bigint,
    status: status as number,
    complianceReported: complianceReported as boolean,
    reportedTotalAllocated: reportedTotalAllocated as bigint,
    reportedRecipientCount: reportedRecipientCount as bigint,
    authorizedSigner: authorizedSigner as `0x${string}`,
  };
}
