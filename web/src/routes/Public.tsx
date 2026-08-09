import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Public() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Public View</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Pool totals and compliance verification — coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
