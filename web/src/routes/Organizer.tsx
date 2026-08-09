import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Organizer() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Organizer View</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Create pools, submit allocations, publish compliance — coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
