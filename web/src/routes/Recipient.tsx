import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import ClaimForm from "@/components/ClaimForm";

export default function Recipient() {
  return (
    <div className="container mx-auto max-w-xl px-4 py-10">
      <Card className="bg-white shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-semibold text-gray-900">Claim Your Prize</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Your allocation is kept confidential inside the TEE. Only you can see your own amount.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClaimForm />
        </CardContent>
      </Card>
    </div>
  );
}
