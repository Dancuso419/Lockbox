import ClaimForm from "@/components/ClaimForm";
import Eyebrow from "@/components/Eyebrow";

export default function Recipient() {
  return (
    <div className="shell shell-narrow py-16">
      <div className="mb-8">
        <Eyebrow>Recipient</Eyebrow>
        <h1 className="font-display mt-5 text-[clamp(2rem,4vw,2.75rem)]">Claim your prize</h1>
        <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground">
          Your allocation is sealed inside the TEE. You unlock a voucher for your amount alone —
          no one else's share is ever revealed to you.
        </p>
      </div>
      <ClaimForm />
    </div>
  );
}
