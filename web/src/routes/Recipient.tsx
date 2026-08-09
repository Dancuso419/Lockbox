import { Card, CardContent } from "@/components/ui/card";
import ClaimForm from "@/components/ClaimForm";

export default function Recipient() {
  return (
    <div className="mx-auto max-w-xl px-6 py-14">
      <div className="mb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-glow">Recipient</p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight">Claim your prize</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your allocation is sealed inside the TEE. You unlock a voucher for your amount alone —
          no one else's share is ever revealed to you.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <ClaimForm />
        </CardContent>
      </Card>
    </div>
  );
}
