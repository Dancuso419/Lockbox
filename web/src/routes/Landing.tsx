import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Lock, Eye, ShieldCheck } from "lucide-react";
import Keyhole from "@/components/Keyhole";
import Reveal from "@/components/Reveal";

// Scroll progress (0..1) of an element travelling through the viewport.
// Plain rAF-throttled scroll math — no animation library, no WAAPI.
function useScrollProgress(ref: React.RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      setP(total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [ref]);
  return p;
}

function stepOpacity(p: number, index: number, total: number) {
  const center = (index + 0.5) / total;
  return Math.max(0.18, 1 - Math.abs(p - center) * total * 1.05);
}

const STEPS = [
  {
    n: "01",
    title: "Fund the pool once",
    body: "The organizer deposits the entire prize in a single public transaction. The total is visible — the split is not.",
  },
  {
    n: "02",
    title: "Allocate in the dark",
    body: "Per-recipient amounts are sealed and computed inside a Trusted Execution Environment. No individual allocation ever touches the chain in cleartext.",
  },
  {
    n: "03",
    title: "Claim only what's yours",
    body: "Each recipient proves their identity and unlocks a signed voucher for their amount alone. They see their prize — and no one else's.",
  },
  {
    n: "04",
    title: "Prove without revealing",
    body: "A TEE-signed attestation lets anyone verify the split balances against the deposit — while every individual amount stays hidden.",
  },
];

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-2xl font-medium tabular-nums text-foreground sm:text-3xl">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="glow-radial pointer-events-none absolute inset-0 opacity-70" />
      <div className="grain absolute inset-0" />
      <div className="relative mx-auto grid min-h-[92vh] max-w-6xl grid-cols-1 items-center gap-10 px-6 py-24 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            <Lock className="size-3" /> Confidential by construction
          </span>
          <h1 className="mt-6 text-[clamp(2.6rem,7vw,5rem)] font-medium leading-[0.98] tracking-tight">
            <span className="font-light text-muted-foreground">Fund the pool once.</span>
            <br />
            Reveal only what's <span className="italic">yours.</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
            A prize pool where the organizer allocates privately, recipients claim individually, and
            no one's share is ever written on-chain in the open.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              to="/claim"
              className="group inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              Claim your prize
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/organizer"
              className="inline-flex items-center gap-2 rounded-full border border-border-strong px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Create a pool
            </Link>
          </div>
          <div className="mt-14 flex gap-10 border-t border-border pt-8">
            <Stat value="0" label="Allocations on-chain" />
            <Stat value="1:1" label="Voucher per recipient" />
            <Stat value="TEE" label="Sealed computation" />
          </div>
        </div>

        <div className="relative mx-auto aspect-[4/5] w-full max-w-sm">
          <div className="glow-radial absolute inset-0 scale-125 opacity-80" />
          <Keyhole className="relative h-full w-full" />
        </div>
      </div>
    </section>
  );
}

function Scrolly() {
  const ref = useRef<HTMLDivElement>(null);
  const p = useScrollProgress(ref);
  const scale = 0.82 + p * 0.5;

  return (
    <section ref={ref} className="relative md:h-[380vh]">
      {/* Static stacked fallback on small screens + reduced-motion (no pinning) */}
      <div className="mx-auto max-w-6xl px-6 py-20 md:hidden">
        <h2 className="mb-10 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          How the secret stays a secret
        </h2>
        <div className="space-y-8">
          {STEPS.map((s) => (
            <div key={s.n} className="border-l border-border-strong py-2 pl-6">
              <div className="font-mono text-xs text-glow">{s.n}</div>
              <h3 className="mt-2 text-2xl font-medium tracking-tight">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pinned scrollytelling on md+ */}
      <div className="sticky top-0 hidden h-screen items-center overflow-hidden md:flex motion-reduce:static motion-reduce:h-auto motion-reduce:py-24">
        <div className="glow-radial pointer-events-none absolute inset-0" />
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-8 px-6 lg:grid-cols-2">
          <div className="relative hidden aspect-square items-center justify-center lg:flex">
            <div
              className="glow-radial absolute inset-0 motion-reduce:!opacity-70"
              style={{ transform: `scale(${scale})`, opacity: 0.4 + p * 0.6 }}
            />
            <div
              className="relative h-[80%] w-[80%] motion-reduce:!scale-100"
              style={{ transform: `scale(${scale})` }}
            >
              <Keyhole className="h-full w-full" />
            </div>
          </div>
          <div>
            <h2 className="mb-4 font-mono text-sm uppercase tracking-widest text-muted-foreground">
              How the secret stays a secret
            </h2>
            <div className="relative">
              {STEPS.map((s, i) => (
                <div
                  key={s.n}
                  className="border-l border-border-strong py-8 pl-6 transition-opacity duration-200 motion-reduce:!opacity-100"
                  style={{ opacity: stepOpacity(p, i, STEPS.length) }}
                >
                  <div className="font-mono text-xs text-glow">{s.n}</div>
                  <h3 className="mt-2 text-2xl font-medium tracking-tight">{s.title}</h3>
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const PRINCIPLES = [
  {
    icon: Lock,
    title: "Sealed allocation",
    body: "Individual amounts are encrypted to the enclave and computed where no operator — not even the organizer's server — can read them.",
  },
  {
    icon: Eye,
    title: "Need-to-know claims",
    body: "A recipient's signed voucher decrypts to exactly one number: their own. Identity and payout can be unlinked with a fresh address.",
  },
  {
    icon: ShieldCheck,
    title: "Verifiable, not visible",
    body: "An on-chain attestation proves the allocations sum to the deposit. Auditors get certainty; no one gets the breakdown.",
  },
];

function Principles() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <Reveal>
        <h2 className="max-w-2xl text-[clamp(1.8rem,4vw,3rem)] font-medium leading-tight tracking-tight">
          Confidentiality isn't a setting. It's the architecture.
        </h2>
      </Reveal>
      <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        {PRINCIPLES.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.08} className="bg-background">
            <div className="h-full p-8">
              <p.icon className="size-5 text-glow" strokeWidth={1.5} />
              <h3 className="mt-5 text-lg font-medium">{p.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function CtaFooter() {
  return (
    <section className="relative overflow-hidden border-t border-border">
      <div className="glow-radial pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative mx-auto max-w-3xl px-6 py-28 text-center">
        <Reveal>
          <h2 className="text-[clamp(2rem,5vw,3.5rem)] font-medium leading-tight tracking-tight">
            Step up to the keyhole.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-muted-foreground">
            Explore a live pool, claim an allocation, or stand up your own — the private way.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              to="/pool"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              Explore a pool <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/organizer"
              className="inline-flex items-center gap-2 rounded-full border border-border-strong px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              Create a pool
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div>
      <Hero />
      <Scrolly />
      <Principles />
      <CtaFooter />
    </div>
  );
}
