import { KeyRound, EyeOff, Wallet } from "lucide-react";
import ClaimForm from "@/components/ClaimForm";
import PageHeader from "@/components/PageHeader";

const ASSURANCES = [
  {
    icon: Wallet,
    title: "Your signature is the key",
    body: "You sign a challenge with the wallet that holds the allocation. Nothing is revealed until the enclave has checked that signature.",
  },
  {
    icon: EyeOff,
    title: "You see one number",
    body: "The voucher decrypts to your amount and nothing else. Not the other recipients, not their shares, not how many there are.",
  },
  {
    icon: KeyRound,
    title: "Claim anywhere",
    body: "Redeem to a fresh address and the payout stops pointing back at you. Fund that address independently and the link is gone.",
  },
];

export default function Recipient() {
  return (
    <div className="shell space-y-12 py-16">
      <PageHeader
        eyebrow="Recipient"
        title="Claim your prize"
        lede="Your allocation is sealed inside the enclave. You unlock a voucher for your amount alone — no one else's share is ever revealed to you."
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-14">
        {/* The form is the page; it gets the width and the surface. */}
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <header className="flex items-baseline gap-4 border-b border-border px-6 py-4">
            <span className="font-mono text-xs text-glow">01</span>
            <h2 className="text-sm font-medium">Unlock your voucher</h2>
          </header>
          <div className="p-6">
            <ClaimForm />
          </div>
        </div>

        <aside className="space-y-px self-start overflow-hidden rounded-xl bg-border">
          {ASSURANCES.map((a) => (
            <div key={a.title} className="bg-background p-6">
              <a.icon className="size-4 text-glow" strokeWidth={1.6} />
              <h3 className="mt-4 text-sm font-medium">{a.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{a.body}</p>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
