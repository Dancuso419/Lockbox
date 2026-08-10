import { useMemo, useState } from "react";
import { ArrowRight, RotateCcw, Check, X } from "lucide-react";
import { formatEther, parseEther, getAddress } from "viem";
import BoxWall from "./BoxWall";
import {
  sealAllocations,
  issueVoucher,
  newEphemeralKey,
  elide,
  type DemoAlloc,
  type DemoVoucher,
} from "@/lib/demo";

const DEPOSIT = parseEther("1000");

// Vanity addresses, EIP-55 checksummed at load — viem rejects a bad checksum.
const PEOPLE = [
  { label: "Ada", address: getAddress("0xa11ce0000000000000000000000000000000a11c"), start: "500" },
  { label: "Bo", address: getAddress("0xb0b0000000000000000000000000000000000b0b"), start: "300" },
  { label: "Cy", address: getAddress("0xc7c0000000000000000000000000000000000c7c"), start: "200" },
] as const;

const OUTSIDER = getAddress("0x9999999999999999999999999999999999999999");

const STEPS = ["Fund", "Allocate", "Claim"] as const;

function fmt(v: bigint) {
  const s = formatEther(v);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** A single-line label/value row in the "what the chain sees" panel. */
function ChainRow({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className={`font-mono text-xs tabular-nums ${dim ? "text-muted-foreground" : "text-foreground"}`}>
        {v}
      </span>
    </div>
  );
}

export default function LockboxDemo() {
  const [step, setStep] = useState(0);
  const [amounts, setAmounts] = useState<string[]>(PEOPLE.map((p) => p.start));
  const [sealed, setSealed] = useState<Uint8Array | null>(null);
  const [claimant, setClaimant] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<DemoVoucher | null | "none">(null);

  // Throwaway keypair standing in for the enclave, fresh per page load.
  const tee = useMemo(() => newEphemeralKey(), []);

  const parsed: DemoAlloc[] = PEOPLE.map((p, i) => {
    let amount = 0n;
    try {
      amount = parseEther(amounts[i] || "0");
    } catch {
      amount = 0n;
    }
    return { label: p.label, address: p.address as `0x${string}`, amount };
  });
  const total = parsed.reduce((s, a) => s + a.amount, 0n);
  const overCap = total > DEPOSIT;

  function seal() {
    setSealed(sealAllocations(tee.pubHex, parsed));
    setStep(2);
    setClaimant(null);
    setVoucher(null);
  }

  function claim(address: string) {
    if (!sealed) return;
    setClaimant(address);
    try {
      setVoucher(issueVoucher(tee.privHex, sealed, address as `0x${string}`) ?? "none");
    } catch {
      setVoucher("none"); // never leave the panel blank
    }
  }

  function reset() {
    setStep(0);
    setSealed(null);
    setClaimant(null);
    setVoucher(null);
    setAmounts(PEOPLE.map((p) => p.start));
  }

  const revealed = voucher && voucher !== "none" ? voucher : null;

  return (
    <div className="overflow-hidden border border-border bg-surface">
      {/* Step rail */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-3 sm:px-5">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => (i === 2 && !sealed ? undefined : setStep(i))}
            disabled={i === 2 && !sealed}
            className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors disabled:opacity-40 ${
              step === i ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="text-glow">{`0${i + 1}`}</span> {s}
          </button>
        ))}
        <button
          onClick={reset}
          className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw className="size-3" /> Reset
        </button>
      </div>

      <div className="grid gap-px bg-border md:grid-cols-[1fr_0.85fr]">
        {/* Panel */}
        <div className="bg-surface p-8">
          {step === 0 && (
            <>
              <h3 className="font-display text-2xl sm:text-[1.75rem]">The organizer funds the pool once.</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                One public deposit. Anyone can audit that the money is there — that part was never
                the secret.
              </p>
              <div className="mt-6 border border-border bg-surface-2 p-5">
                <div className="text-xs text-muted-foreground">Deposited</div>
                <div className="mt-1 font-mono text-3xl tabular-nums">{fmt(DEPOSIT)} <span className="text-base text-muted-foreground">FLR</span></div>
              </div>
              <button
                onClick={() => setStep(1)}
                className="group mt-6 inline-flex items-center gap-2 bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-0.5"
              >
                Now split it privately
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </>
          )}

          {step === 1 && (
            <>
              <h3 className="font-display text-2xl sm:text-[1.75rem]">Who gets what — sealed before it leaves the browser.</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Edit the split. It's encrypted to the enclave's key right here; nothing but
                ciphertext ever leaves.
              </p>
              <div className="mt-6 space-y-2">
                {PEOPLE.map((p, i) => (
                  <label key={p.label} className="flex items-center gap-3 border border-border bg-surface-2 px-4 py-3">
                    <span className="w-8 text-sm font-medium">{p.label}</span>
                    <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                      {elide(p.address, 8, 6)}
                    </span>
                    <input
                      value={amounts[i]}
                      inputMode="decimal"
                      onChange={(e) => {
                        const next = [...amounts];
                        next[i] = e.target.value;
                        setAmounts(next);
                      }}
                      className="ml-auto w-24 border border-input bg-background px-2 py-1 text-right font-mono text-sm tabular-nums outline-none focus-visible:border-glow"
                    />
                    <span className="text-xs text-muted-foreground">FLR</span>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Allocated of {fmt(DEPOSIT)}</span>
                <span className={`font-mono tabular-nums ${overCap ? "text-destructive" : "text-muted-foreground"}`}>
                  {fmt(total)} FLR
                </span>
              </div>
              {overCap && (
                <p className="mt-2 text-xs text-destructive">
                  Over the deposit — the contract rejects this, encrypted or not.
                </p>
              )}
              <button
                onClick={seal}
                disabled={overCap || total === 0n}
                className="group mt-6 inline-flex items-center gap-2 bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-40"
              >
                Seal the allocations
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h3 className="font-display text-2xl sm:text-[1.75rem]">Each recipient unlocks one number: their own.</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Pick who you are. The enclave opens the table, finds your row, and signs a voucher
                for that row alone.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {PEOPLE.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => claim(p.address)}
                    className={`border px-4 py-2 text-sm transition-colors ${
                      claimant === p.address
                        ? "border-glow bg-accent text-foreground"
                        : "border-border-strong text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    I'm {p.label}
                  </button>
                ))}
                <button
                  onClick={() => claim(OUTSIDER)}
                  className={`border px-4 py-2 text-sm transition-colors ${
                    claimant === OUTSIDER
                      ? "border-destructive/50 bg-accent text-foreground"
                      : "border-border-strong text-muted-foreground hover:text-foreground"
                  }`}
                >
                  I'm a stranger
                </button>
              </div>

              {revealed && (
                <div className="mt-6 border border-border bg-surface-2 p-5">
                  <div className="flex items-center gap-2 text-xs text-glow">
                    <Check className="size-3.5" /> Voucher issued
                  </div>
                  <div className="mt-2 font-mono text-3xl tabular-nums">
                    {fmt(revealed.amount)} <span className="text-base text-muted-foreground">FLR</span>
                  </div>
                  <dl className="mt-4 space-y-1 border-t border-border pt-3">
                    <ChainRow k="nonce" v={elide(revealed.nonce)} dim />
                    <ChainRow k="signature" v={elide(revealed.signature)} dim />
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Redeemable once, by this address, for this amount. The other two shares stayed
                    sealed.
                  </p>
                </div>
              )}

              {voucher === "none" && (
                <div className="mt-6 border border-destructive/40 bg-surface-2 p-5">
                  <div className="flex items-center gap-2 text-xs text-destructive">
                    <X className="size-3.5" /> No allocation found
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    A stranger learns nothing — not the amounts, not the recipients, not even how
                    many there are.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Stage: vault + what the chain sees */}
        <div className="bg-surface p-8">
          <div className="relative mx-auto w-full max-w-[380px]">
            <div className="glow-radial absolute inset-0 scale-125" style={{ opacity: revealed ? 0.9 : 0.35 }} />
            <BoxWall
              className="relative h-full w-full"
              openIndex={revealed ? 5 : null}
              amount={revealed ? fmt(revealed.amount) : undefined}
            />
          </div>

          <div className="mt-6 border border-border bg-surface-2 px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              What the chain sees
            </div>
            <div className="mt-2 divide-y divide-border">
              <ChainRow k="pool balance" v={`${fmt(DEPOSIT)} FLR`} />
              <ChainRow k="allocations" v={sealed ? "0 rows" : "—"} dim />
              <ChainRow
                k="sealed payload"
                v={sealed ? `${sealed.length} bytes` : "—"}
                dim
              />
              <ChainRow k="claimed" v={revealed ? `${fmt(revealed.amount)} FLR` : "0"} dim />
            </div>
            {sealed && (
              <p className="mt-3 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
                {elide(
                  "0x" + Array.from(sealed.slice(0, 40)).map((b) => b.toString(16).padStart(2, "0")).join(""),
                  40,
                  8
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
