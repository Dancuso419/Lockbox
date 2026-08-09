import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Recipient() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Claim Your Prize</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Ephemeral key generation, TEE claim verification, on-chain claim — coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
