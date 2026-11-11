import { Camera } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * "Shot 3460 McMillan St nearby · 0.1 mi · Oct 23": the reason this cold lead
 * can be texted first — he photographed a home around the corner. The strings
 * are formatted by the page (milesLabel / shortDate) so this stays presentation
 * only, like the badges in ./badges.
 */
export function NearShootBadge({ address, miles, date }: { address: string; miles: string; date: string }) {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Camera />
      Shot {address} nearby · {miles} · {date}
    </Badge>
  );
}
