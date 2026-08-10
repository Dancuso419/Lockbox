import { useEffect, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { parseUnits, getAddress, decodeEventLog, isAddress } from "viem";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONFIG } from "@/config";
import { poolFactoryConfig } from "@/lib/contracts";
import { TeeClient } from "@/lib/teeClient";
import PoolFactoryAbi from "@/abi/PoolFactory.json";
import { Skeleton, ErrorState } from "./States";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const ERC20_DECIMALS_ABI = [
  { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { name: "approve", type: "function", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;

interface Props {
  onPoolCreated: (addr: `0x${string}`) => void;
}

export default function CreatePoolForm({ onPoolCreated }: Props) {
  const { chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [assetType, setAssetType] = useState<"native" | "erc20">("native");
  const [tokenAddress, setTokenAddress] = useState("");
  const [tokenAddressError, setTokenAddressError] = useState("");
  const [total, setTotal] = useState("");
  const [totalError, setTotalError] = useState("");
  const [deadline, setDeadline] = useState("");
  const [deadlineError, setDeadlineError] = useState("");

  const [signerAddress, setSignerAddress] = useState<string | null>(null);
  const [signerLoading, setSignerLoading] = useState(true);
  const [signerFailed, setSignerFailed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [createdPool, setCreatedPool] = useState<`0x${string}` | null>(null);

  const wrongChain = isConnected && chainId !== CONFIG.chainId;

  // Fetch signer address from TEE on mount (retryable — the BFF may be down)
  const [signerAttempt, setSignerAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSignerLoading(true);
    setSignerFailed(false);
    TeeClient.state()
      .then((s) => { if (!cancelled) { setSignerAddress(s.signerAddress); setSignerLoading(false); } })
      .catch(() => { if (!cancelled) { setSignerFailed(true); setSignerLoading(false); } });
    return () => { cancelled = true; };
  }, [signerAttempt]);

  function validate(): { ok: boolean; totalBigInt: bigint; deadlineBigInt: bigint } {
    let ok = true;
    let totalBigInt = 0n;
    let deadlineBigInt = 0n;

    if (assetType === "erc20" && !isAddress(tokenAddress)) {
      setTokenAddressError("Enter a valid ERC-20 token address (0x…)");
      ok = false;
    } else {
      setTokenAddressError("");
    }

    if (!total.trim()) {
      setTotalError("Enter the total amount");
      ok = false;
    } else {
      try {
        // For native: 18 decimals. For ERC-20: we'll fetch decimals in submit.
        // Here we validate it's a positive number; actual parsing done in submit.
        const parsed = BigInt(total.trim().replace(".", ""));
        if (parsed <= 0n) throw new Error("non-positive");
        totalBigInt = parsed;
      } catch {
        setTotalError("Enter a valid positive integer (base units)");
        ok = false;
      }
    }

    if (!deadline) {
      setDeadlineError("Pick a deadline date and time");
      ok = false;
    } else {
      const ms = new Date(deadline).getTime();
      if (isNaN(ms) || ms <= Date.now()) {
        setDeadlineError("Deadline must be in the future");
        ok = false;
      } else {
        deadlineBigInt = BigInt(Math.floor(ms / 1000));
        setDeadlineError("");
      }
    }

    return { ok, totalBigInt, deadlineBigInt };
  }

  async function handleSubmit() {
    if (!isConnected) { toast.error("Connect your wallet first."); return; }
    if (wrongChain) { toast.error("Switch to Coston2 first."); return; }
    if (!publicClient) return;
    if (!signerAddress || signerFailed) { toast.error("TEE signer unavailable — try again."); return; }

    const { ok, deadlineBigInt } = validate();
    if (!ok) return;

    setSubmitting(true);
    setCreatedPool(null);
    try {
      const asset: `0x${string}` = assetType === "native" ? ZERO_ADDR : getAddress(tokenAddress as `0x${string}`);
      const factoryAddr = poolFactoryConfig.address;

      // Resolve decimals and parse total
      let decimals = 18;
      if (assetType === "erc20") {
        try {
          const d = await publicClient.readContract({
            address: asset,
            abi: ERC20_DECIMALS_ABI,
            functionName: "decimals",
          });
          decimals = d as number;
        } catch {
          // ponytail: fallback 18 if decimals() unavailable
        }
      }
      const totalAmount = parseUnits(total.trim(), decimals);

      // ERC-20: approve factory first
      if (assetType === "erc20") {
        toast.info("Approving token transfer…");
        const approveHash = await writeContractAsync({
          address: asset,
          abi: ERC20_DECIMALS_ABI,
          functionName: "approve",
          args: [factoryAddr, totalAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        toast.info("Approved. Creating pool…");
      }

      const createHash = await writeContractAsync({
        ...poolFactoryConfig,
        functionName: "createPool",
        args: [asset, totalAmount, deadlineBigInt, getAddress(signerAddress as `0x${string}`)],
        value: assetType === "native" ? totalAmount : 0n,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

      // Decode PoolCreated log to extract pool address
      let poolAddr: `0x${string}` | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: PoolFactoryAbi,
            data: log.data,
            topics: log.topics,
            eventName: "PoolCreated",
          });
          // pool is the first indexed topic → log.topics[1]
          poolAddr = (decoded.args as unknown as { pool: `0x${string}` }).pool;
          break;
        } catch {
          // not this log
        }
      }

      if (!poolAddr && receipt.logs.length > 0) {
        // Fallback: pool address is topics[1] of the PoolCreated log
        for (const log of receipt.logs) {
          if (log.topics.length >= 2) {
            poolAddr = getAddress(("0x" + log.topics[1]!.slice(26)) as `0x${string}`);
            break;
          }
        }
      }

      if (poolAddr) {
        setCreatedPool(poolAddr);
        onPoolCreated(poolAddr);
        toast.success("Pool created!");
      } else {
        toast.error("Pool created but couldn't extract address from receipt. Check explorer.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.length > 160 ? msg.slice(0, 160) + "…" : msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {wrongChain && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
          <span className="text-sm text-warning">Wrong network — switch to Coston2.</span>
          <Button size="sm" variant="outline" className="shrink-0 border-warning/40 text-warning hover:bg-warning/15"
            onClick={() => switchChain({ chainId: CONFIG.chainId })}>Switch</Button>
        </div>
      )}

      {/* Asset type */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Asset</label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={assetType === "native"} onChange={() => setAssetType("native")} />
            Native (C2FLR)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={assetType === "erc20"} onChange={() => setAssetType("erc20")} />
            ERC-20
          </label>
        </div>
        {assetType === "erc20" && (
          <div className="space-y-1 mt-1">
            <Input placeholder="Token address (0x…)" value={tokenAddress}
              onChange={(e) => { setTokenAddress(e.target.value); setTokenAddressError(""); }}
              className="font-mono text-sm" />
            {tokenAddressError && <p className="text-xs text-destructive">{tokenAddressError}</p>}
          </div>
        )}
      </div>

      {/* Total amount */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Total amount</label>
        <Input placeholder={assetType === "native" ? "e.g. 1.5 (C2FLR)" : "e.g. 1.5 (token units)"}
          value={total} onChange={(e) => { setTotal(e.target.value); setTotalError(""); }}
          className="font-mono text-sm" />
        <p className="text-xs text-muted-foreground">
          {assetType === "native"
            ? "Parsed as 18-decimal C2FLR (e.g. 1.5 = 1.5 C2FLR)."
            : "Parsed using the token's decimals() (fetched on submit). Enter a human-readable amount."}
        </p>
        {totalError && <p className="text-xs text-destructive">{totalError}</p>}
      </div>

      {/* Deadline */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Deadline</label>
        <Input type="datetime-local" value={deadline}
          onChange={(e) => { setDeadline(e.target.value); setDeadlineError(""); }}
          className="text-sm" />
        {deadlineError && <p className="text-xs text-destructive">{deadlineError}</p>}
      </div>

      {/* Authorized signer (auto-filled from TEE) */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Authorized signer <span className="text-muted-foreground font-normal">(TEE, read-only)</span></label>
        {signerLoading && <Skeleton className="h-10 w-full" />}
        {signerFailed && (
          <ErrorState
            title="TEE signer unavailable"
            detail="The pool needs the enclave's signing address before it can be created. The BFF may be offline — start it and retry."
            onRetry={() => setSignerAttempt((n) => n + 1)}
          />
        )}
        {signerAddress && (
          <Input value={signerAddress} readOnly className="bg-muted font-mono text-sm" />
        )}
      </div>

      <Button onClick={handleSubmit} disabled={submitting || wrongChain || signerLoading} className="w-full">
        {submitting ? "Creating pool…" : "Create pool"}
      </Button>

      {createdPool && (
        <div className="space-y-1 rounded-lg border border-success/25 bg-success/10 p-3 text-sm">
          <p className="font-medium text-success">Pool created</p>
          <a href={`${CONFIG.explorer}/address/${createdPool}`} target="_blank" rel="noopener noreferrer"
            className="break-all font-mono text-xs text-glow hover:underline">{createdPool}</a>
        </div>
      )}
    </div>
  );
}
