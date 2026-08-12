import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { isAddress } from "viem";
import { Lock } from "lucide-react";

import { Input } from "@/components/ui/input";
import CreatePoolForm from "@/components/CreatePoolForm";
import AllocationForm from "@/components/AllocationForm";
import CompliancePanel from "@/components/CompliancePanel";
import UnclaimedPanel from "@/components/UnclaimedPanel";
import PageHeader from "@/components/PageHeader";
import { readPool } from "@/lib/contracts";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

const STEPS = [
  { n: "01", id: "create", label: "Create pool", note: "Fund it once, in the open" },
  { n: "02", id: "allocate", label: "Submit allocation", note: "Sealed to the enclave" },
  { n: "03", id: "attest", label: "Publish attestation", note: "Prove the split balances" },
  { n: "04", id: "sweep", label: "Unclaimed funds", note: "After the deadline" },
] as const;

/** One step of the workspace: a numbered band with the form beneath it. */
function Step({
  n,
  id,
  label,
  note,
  children,
}: {
  n: string;
  id: string;
  label: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border px-6 py-4">
        <span className="font-mono text-xs text-glow">{n}</span>
        <h2 className="text-sm font-medium">{label}</h2>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {note}
        </span>
      </header>
      <div className="p-6">{children}</div>
    </section>
  );
}

export default function Organizer() {
  const publicClient = usePublicClient();

  const [poolInput, setPoolInput] = useState("");
  const [selectedPool, setSelectedPool] = useState<`0x${string}` | null>(null);

  // resolved for UnclaimedPanel display
  const [poolDecimals, setPoolDecimals] = useState(18);
  const [poolAsset, setPoolAsset] = useState<`0x${string}` | undefined>(undefined);

  function applyPool(addr: `0x${string}`) {
    setSelectedPool(addr);
    setPoolInput(addr);
  }

  // When pool is selected, resolve decimals (same pattern as ClaimForm/PublicPoolCard)
  useEffect(() => {
    if (!publicClient || !selectedPool || !isAddress(selectedPool)) return;
    let cancelled = false;

    async function resolve() {
      if (!publicClient || !selectedPool) return;
      try {
        const ps = await readPool(publicClient, selectedPool);
        if (cancelled) return;
        setPoolAsset(ps.asset);
        if (ps.asset === ZERO_ADDR) { setPoolDecimals(18); return; }
        try {
          const d = await publicClient.readContract({
            address: ps.asset,
            abi: [{ name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" }],
            functionName: "decimals",
          }) as number;
          if (!cancelled) setPoolDecimals(d);
        } catch {
          // ponytail: fallback 18
          if (!cancelled) setPoolDecimals(18);
        }
      } catch {
        // pool not reachable yet
      }
    }

    resolve();
    return () => { cancelled = true; };
  }, [publicClient, selectedPool]);

  const poolValid = Boolean(selectedPool && isAddress(selectedPool));

  return (
    <div className="shell space-y-12 py-16">
      <PageHeader
        eyebrow="Organizer"
        title="Run a confidential pool"
        lede="Fund once, allocate privately inside the enclave, attest the split on-chain, and reveal only the non-claimants to yourself after the deadline."
        aside={
          <div>
            <label
              htmlFor="active-pool"
              className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              Work on an existing pool
            </label>
            <div className="flex gap-2">
              <Input
                id="active-pool"
                placeholder="0x… pool address"
                value={poolInput}
                onChange={(e) => setPoolInput(e.target.value)}
                className="h-11 font-mono"
              />
              <button
                className="h-11 shrink-0 rounded-lg border border-border-strong px-4 text-sm transition-colors hover:bg-accent disabled:opacity-40"
                disabled={!isAddress(poolInput)}
                onClick={() => {
                  if (isAddress(poolInput)) applyPool(poolInput as `0x${string}`);
                }}
              >
                Load
              </button>
            </div>
          </div>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
        {/* The lifecycle, always visible, so it's clear what comes next and
            what is still locked behind choosing a pool. */}
        <nav className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Lifecycle
          </h2>
          <ol className="mt-4 space-y-px bg-border">
            {STEPS.map((s, i) => {
              const locked = i > 0 && !poolValid;
              return (
                <li key={s.id} className="bg-background">
                  <a
                    href={locked ? undefined : `#${s.id}`}
                    aria-disabled={locked}
                    className={`flex items-baseline gap-3 py-3 transition-colors ${
                      locked
                        ? "cursor-default text-muted-foreground/50"
                        : "text-foreground hover:text-glow"
                    }`}
                  >
                    <span className="font-mono text-xs text-glow">{s.n}</span>
                    <span className="text-sm">{s.label}</span>
                    {locked && <Lock className="ml-auto size-3 shrink-0 self-center" />}
                  </a>
                </li>
              );
            })}
          </ol>

          <div className="mt-6 border-t border-border pt-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Active pool
            </div>
            {selectedPool ? (
              <p className="mt-2 break-all font-mono text-xs text-foreground">{selectedPool}</p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                None yet — create one, or load an address above.
              </p>
            )}
          </div>
        </nav>

        <div className="space-y-6">
          <Step {...STEPS[0]}>
            <CreatePoolForm onPoolCreated={applyPool} />
          </Step>

          {poolValid ? (
            <>
              <Step {...STEPS[1]}>
                <AllocationForm
                  pool={selectedPool!}
                  decimals={poolDecimals}
                  ticker={poolAsset === ZERO_ADDR ? "C2FLR" : "tokens"}
                />
              </Step>
              <Step {...STEPS[2]}>
                <CompliancePanel pool={selectedPool!} />
              </Step>
              <Step {...STEPS[3]}>
                <UnclaimedPanel pool={selectedPool!} decimals={poolDecimals} asset={poolAsset} />
              </Step>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border-strong bg-surface p-8 text-center">
              <Lock className="mx-auto size-4 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Steps 02–04 need a pool</p>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
                Create one above and it becomes active automatically, or load an existing pool
                address to pick up where you left off.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
