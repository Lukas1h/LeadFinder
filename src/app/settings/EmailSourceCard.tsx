import { Mail } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CopyableEmail } from "./CopyableEmail";

export function EmailSourceCard({ email }: { email: string }) {
  return (
    <Card className="flex-row items-start justify-between gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-foreground">Zillow email alerts</h3>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Forward Zillow saved-search and recommendation emails here to be ingested.
        </p>
        <div className="mt-2 max-w-sm">
          <CopyableEmail email={email} />
        </div>
      </div>
    </Card>
  );
}
