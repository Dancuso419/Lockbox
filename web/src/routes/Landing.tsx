import { Link } from "react-router-dom";
import { ArrowRight, ArrowDown } from "lucide-react";
import BoxWall from "@/components/BoxWall";
import LockboxDemo from "@/components/LockboxDemo";
import Eyebrow from "@/components/Eyebrow";

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Split panel: the right half sits a shade deeper, with a hairline seam. */}
      <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-surface-2 md:block" />
      <div className="absolute inset-y-0 left-1/2 hidden w-px bg-border md:block" />

      <div className="shell relative grid grid-cols-1 items-center gap-10 pb-14 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-16 lg:pb-16 lg:pt-6">
        <div className="lg:pr-10">
          <Eyebrow>Confidential compute · Flare</Eyebrow>
          <h1 className="font-display mt-6 text-[clamp(2.75rem,6vw,4.75rem)]">
            Confidential
            <br />
            prize pools.
          </h1>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
            Fund the pot in the open. Decide the split inside a sealed enclave. Every winner claims
            their own amount — and <span className="text-foreground">nobody learns anyone else's.</span>
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/claim"
              className="group inline-flex items-center gap-2 bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              Claim your prize
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/organizer"
              className="inline-flex items-center gap-2 border border-border-strong px-6 py-3 text-sm font-medium transition-colors hover:bg-accent"
            >
              Run a pool
            </Link>
          </div>

          {/* Anchors the bottom of the text column, so the two columns end
              together instead of leaving a hole under the buttons. */}
          <div className="mt-14 flex items-center gap-4">
            <div className="h-0.5 w-24 bg-glow" />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Coston2 testnet
            </span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[34rem]">
          <BoxWall className="h-full w-full" openIndex={5} interactive />
        </div>
      </div>

      {/* Bottom strip — two flat blocks, the way the reference pins its captions */}
      <div className="shell relative pb-14">
        <div className="grid gap-px bg-border md:grid-cols-[1fr_1fr_15rem]">
          <div className="bg-surface p-7">
            <h2 className="text-sm font-medium">Built for payouts that shouldn't be public.</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Grant rounds, bug bounties, hackathon placings — the pot audits, the line items stay
              between you and each recipient.
            </p>
          </div>
          <div className="bg-surface p-7">
            <h2 className="text-sm font-medium">See it actually encrypt.</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The walkthrough below runs the real thing in your browser — real ciphertext, real
              signature, no video.
            </p>
          </div>
          <a
            href="#demo"
            className="group flex items-center justify-between gap-6 bg-surface p-7 transition-colors hover:bg-accent"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Try it
            </span>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-glow text-glow-foreground transition-transform group-hover:translate-y-0.5">
              <ArrowDown className="size-4" />
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}

const STEPS: [string, string, string][] = [
  ["01", "Fund once, in public", "One deposit anyone can audit. The total was never the secret."],
  ["02", "Allocate in the dark", "Amounts are encrypted in your browser and only opened inside the enclave."],
  ["03", "Claim one share", "Each recipient unlocks a signed voucher for their own amount alone."],
  ["04", "Prove it balances", "A signed attestation shows the split sums to the deposit — no breakdown."],
];

function How() {
  return (
    <section id="demo" className="border-t border-border bg-surface-2">
      <div className="shell py-24">
        <div>
          <Eyebrow>Real encryption, running in this tab</Eyebrow>
          <h2 className="font-display mt-6 max-w-2xl text-[clamp(2rem,4vw,3.25rem)]">
            Fund it. Seal it.
            <br />
            Unlock one share.
          </h2>
        </div>

        <div className="mt-14 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([n, title, body]) => (
            <div key={n} className="bg-surface-2">
              <div className="h-full p-7">
                <div className="font-mono text-xs text-glow">{n}</div>
                <h3 className="mt-3 text-sm font-medium">{title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <LockboxDemo />
        </div>
      </div>
    </section>
  );
}

const PRINCIPLES: [string, string][] = [
  [
    "Sealed allocation",
    "Amounts are encrypted in the organizer's browser and only opened inside the enclave. No server — not ours, not the organizer's — ever holds the plaintext split.",
  ],
  [
    "Need-to-know claims",
    "A recipient's voucher decrypts to exactly one number: their own. Claim to a fresh address and even the payout stops pointing back at you.",
  ],
  [
    "Verifiable, not visible",
    "The enclave signs an attestation that the allocations sum to the deposit, publishable on-chain. Auditors get certainty; nobody gets the breakdown.",
  ],
];

function Principles() {
  return (
    <section className="border-t border-border">
      <div className="shell py-24">
        <div>
          <Eyebrow>Why it holds</Eyebrow>
          <h2 className="font-display mt-6 max-w-2xl text-[clamp(2rem,4vw,3.25rem)]">
            Confidentiality isn't a setting.
            <br />
            It's the architecture.
          </h2>
        </div>
        <div className="mt-14 grid gap-px bg-border md:grid-cols-3">
          {PRINCIPLES.map(([title, body]) => (
            <div key={title} className="bg-background">
              <div className="h-full p-7">
                <div className="h-0.5 w-8 bg-glow" />
                <h3 className="mt-5 text-base font-medium">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FACTS: [string, string][] = [
  ["Network", "Flare · Coston2"],
  ["Compute", "Flare Confidential Compute (TEE)"],
  ["Claim proof", "EIP-712 signed voucher"],
  ["Assets", "Native FLR + ERC-20 / FXRP"],
];

function CtaFooter() {
  return (
    <section className="border-t border-border bg-surface-2">
      <div className="shell py-24">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-end">
          <div>
            <h2 className="font-display text-[clamp(2.25rem,5vw,4rem)]">Open the box.</h2>
            <p className="mt-5 max-w-sm text-sm text-muted-foreground">
              Explore a live pool, claim an allocation, or stand up your own — the private way.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/pool"
                className="inline-flex items-center gap-2 bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-0.5"
              >
                Explore a pool <ArrowRight className="size-4" />
              </Link>
              <Link
                to="/organizer"
                className="inline-flex items-center gap-2 border border-border-strong px-6 py-3 text-sm font-medium transition-colors hover:bg-accent"
              >
                Run a pool
              </Link>
            </div>
          </div>

          <div>
            <dl className="grid gap-px bg-border sm:grid-cols-2">
              {FACTS.map(([k, v]) => (
                <div key={k} className="bg-surface-2 p-5">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {k}
                  </dt>
                  <dd className="mt-2 text-sm">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div>
      <Hero />
      <How />
      <Principles />
      <CtaFooter />
    </div>
  );
}
