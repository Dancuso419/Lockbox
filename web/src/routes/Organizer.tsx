import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { isAddress } from "viem";
import { Check, ChevronLeft, ChevronRight, Lock } from "lucide-react";

import { Input } from "@/components/ui/input";
import CreatePoolForm from "@/components/CreatePoolForm";
import AllocationForm from "@/components/AllocationForm";
import CompliancePanel from "@/components/CompliancePanel";
import UnclaimedPanel from "@/components/UnclaimedPanel";
import PageHeader from "@/components/PageHeader";
import PoolPicker from "@/components/PoolPicker";
import { rememberPool } from "@/lib/myPools";
import { readPool } from "@/lib/contracts";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

const STEPS = [
  { n: "01", label: "Create pool", note: "Fund it once, in the open" },
  { n: "02", label: "Submit allocation", note: "Sealed to the enclave" },
  { n: "03", label: "Publish attestation", note: "Prove the split balances" },
  { n: "04", label: "Unclaimed funds", note: "After the deadline" },
] as const;

export default function Organizer() {
  const publicClient = usePublicClient();
  const { address: wallet } = useAccount();

  const [poolInput, setPoolInput] = useState("");
  const [selectedPool, setSelectedPool] = useState<`0x${string}` | null>(null);

  // resolved for the allocation + unclaimed panels
  const [poolDecimals, setPoolDecimals] = useState(18);
  const [poolAsset, setPoolAsset] = useState<`0x${string}` | undefined>(undefined);

  // Which card is showing, and which way we last travelled — the direction is
  // what tells forward apart from back without reading the heading.
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);

  // Completion is driven by what actually happened, not by having visited a step.
  const [allocated, setAllocated] = useState<number | null>(null);
  const [attested, setAttested] = useState(false);

  const poolValid = Boolean(selectedPool && isAddress(selectedPool));
  const done = [poolValid, allocated !== null, attested, false];

  function goTo(next: number) {
    if (next === step || next < 0 || next > 3) return;
    if (next > 0 && !poolValid) return; // 02-04 need a pool
    setDir(next > step ? 1 : -1);
    setStep(next);
  }

  function applyPool(addr: `0x${string}`) {
    setSelectedPool(addr);
    setPoolInput(addr);
    rememberPool(wallet, addr);
    // A fresh pool is a fresh lifecycle — don't carry the last one's progress.
    setAllocated(null);
    setAttested(false);
    setDir(1);
    setStep(1);
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

  const ticker = poolAsset === ZERO_ADDR ? "C2FLR" : "tokens";

  // Only one panel is ever on screen, so this is a switch rather than an array
  // of elements waiting for keys they will never need.
  function renderPanel() {
    if (step > 0 && !poolValid) {
      return (
        <div className="py-6 text-center">
          <Lock className="mx-auto size-4 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">This step needs a pool</p>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Create one in step 01, or load an existing pool address above.
          </p>
        </div>
      );
    }
    switch (step) {
      case 0:
        return <CreatePoolForm onPoolCreated={applyPool} />;
      case 1:
        return (
          <AllocationForm
            pool={selectedPool!}
            decimals={poolDecimals}
            ticker={ticker}
            onSubmitted={(count) => {
              setAllocated(count);
              setDir(1);
              setStep(2);
            }}
          />
        );
      case 2:
        return (
          <CompliancePanel
            pool={selectedPool!}
            onPublished={() => {
              setAttested(true);
              setDir(1);
              setStep(3);
            }}
          />
        );
      default:
        return (
          <UnclaimedPanel pool={selectedPool!} decimals={poolDecimals} asset={poolAsset} />
        );
    }
  }

  const current = STEPS[step];

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
            <div className="mt-2">
              <PoolPicker owner={wallet} current={selectedPool} onSelect={applyPool} />
            </div>
          </div>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
        {/* The lifecycle: where you are, what is done, what is still locked. */}
        <nav className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Lifecycle
          </h2>
          <ol className="mt-4 space-y-px bg-border">
            {STEPS.map((s, i) => {
              const locked = i > 0 && !poolValid;
              const active = i === step;
              return (
                <li key={s.n} className="bg-background">
                  <button
                    onClick={() => goTo(i)}
                    disabled={locked}
                    aria-current={active ? "step" : undefined}
                    className={`flex w-full items-baseline gap-3 py-3 text-left transition-colors ${
                      locked
                        ? "cursor-default text-muted-foreground/50"
                        : active
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className={`font-mono text-xs ${active ? "text-glow" : "text-glow/70"}`}>
                      {s.n}
                    </span>
                    <span className={`text-sm ${active ? "font-medium" : ""}`}>{s.label}</span>
                    {done[i] && <Check className="ml-auto size-3.5 shrink-0 self-center text-success" />}
                    {locked && <Lock className="ml-auto size-3 shrink-0 self-center" />}
                  </button>
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

        <div className="step-stage">
          {/* One card at a time. Keyed by step so it remounts and replays the
              flip; the class picks the edge it turns in from. */}
          <section
            key={step}
            className={`overflow-hidden rounded-xl border border-border bg-surface ${
              dir === 1 ? "step-forward" : "step-back"
            }`}
          >
            <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border px-6 py-4">
              <span className="font-mono text-xs text-glow">{current.n}</span>
              <h2 className="text-sm font-medium">{current.label}</h2>
              {done[step] && (
                <span className="inline-flex items-center gap-1 text-xs text-success">
                  <Check className="size-3" /> done
                </span>
              )}
              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {current.note}
              </span>
            </header>

            <div className="p-6">{renderPanel()}</div>
          </section>

          {/* Move between steps by hand as well as automatically. */}
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => goTo(step - 1)}
              disabled={step === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-4 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-30"
            >
              <ChevronLeft className="size-4" /> Back
            </button>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </span>
            <button
              onClick={() => goTo(step + 1)}
              disabled={step === 3 || !poolValid}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-4 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-30"
            >
              Next <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
