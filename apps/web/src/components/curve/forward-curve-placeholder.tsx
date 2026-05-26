import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ForwardCurvePlaceholder() {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base font-medium">
            Forward curve
          </CardTitle>
          <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
            v1.5
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
        <p>
          A live JCC forward curve isn't available in the free tier. CME's JCC
          futures (the only liquid market for the curve) IP-block scraping; the
          underlying decomposition into Dubai, Oman, Murban, and Brent forwards
          needs ICE / DME / IFAD subscriptions to access.
        </p>
        <p className="text-zinc-700 dark:text-zinc-300">
          When data access is procured, this section will show:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-xs">
          <li>The current JCC futures curve from CME (out to ~60 months).</li>
          <li>
            Recent-week overlays so you can see how the curve has shifted in the
            last month.
          </li>
          <li>
            A decomposition (stacked-area attribution) into Dubai / Oman / Murban
            / Brent forwards plus residual basis — i.e. <em>where</em> the curve
            is coming from.
          </li>
        </ul>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          The implied next-month forecast above is the closest v1 proxy: it uses
          today's WTI + Brent spot averages through the historical regression to
          project the next print.
        </p>
      </CardContent>
    </Card>
  );
}
