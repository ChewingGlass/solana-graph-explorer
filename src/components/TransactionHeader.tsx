import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { useView } from "@/contexts/ViewContext";
import {
  shortenAddress,
  lamportsToSol,
  formatRelativeTime,
  formatAbsoluteTime,
} from "@/utils/format";
import type { ParsedTransaction } from "@/types/transaction";

interface TransactionHeaderProps {
  tx: ParsedTransaction;
  simulated?: boolean;
  computeUnits?: number;
}

export function TransactionHeader({ tx, simulated, computeUnits }: TransactionHeaderProps) {
  const { backToGraph } = useView();

  const isSuccess = tx.err === null;

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 border-b bg-background">
      <Button variant="ghost" size="sm" onClick={() => backToGraph()}>
        <ArrowLeft className="size-4 mr-1" />
        Back
      </Button>

      {simulated ? (
        <Badge variant="outline" className="shrink-0 text-amber-600 border-amber-600/30 bg-amber-500/10">
          Simulated
        </Badge>
      ) : (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-sm font-medium truncate" title={tx.signature}>
            {shortenAddress(tx.signature, 8)}
          </span>
          <CopyButton value={tx.signature} />
          <a
            href={`https://explorer.solana.com/tx/${tx.signature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-blue-500 shrink-0 cursor-pointer"
            title="View in Explorer"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}

      <Badge variant={isSuccess ? "default" : "destructive"} className="shrink-0">
        {isSuccess ? "Success" : "Failed"}
      </Badge>

      {!simulated && (
        <div className="text-xs text-muted-foreground shrink-0">
          Slot: <span className="font-mono">{tx.slot.toLocaleString()}</span>
        </div>
      )}

      {tx.blockTime && (
        <div className="text-xs text-muted-foreground shrink-0">
          {formatRelativeTime(tx.blockTime)} ({formatAbsoluteTime(tx.blockTime)})
        </div>
      )}

      {computeUnits != null && (
        <div className="text-xs text-muted-foreground shrink-0">
          Compute: <span className="font-mono">{computeUnits.toLocaleString()} units</span>
        </div>
      )}

      <div className="text-xs text-muted-foreground shrink-0">
        Fee: <span className="font-mono">{lamportsToSol(tx.fee)} SOL</span>
      </div>
    </div>
  );
}
