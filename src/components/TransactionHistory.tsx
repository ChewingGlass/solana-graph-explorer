import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CopyButton } from "@/components/CopyButton";
import { LoadMoreFooter } from "@/components/LoadMoreFooter";
import { HistoryControls } from "@/components/HistoryControls";
import { useTransactionHistory } from "@/hooks/useTransactionHistory";
import type { TransactionFilter } from "@/types/transaction";
import { History, Loader2 } from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { shortenAddress, formatRelativeTime, formatAbsoluteTime } from "@/utils/format";
import { COMPUTE_BUDGET_PROGRAM_ID } from "@/solana/builtinIdls";

interface TransactionHistoryProps {
  address: string;
  rpcUrl: string;
  onTransactionClick: (signature: string) => void;
}

export function TransactionHistory({
  address,
  rpcUrl,
  onTransactionClick,
}: TransactionHistoryProps) {
  const {
    allTransactions,
    isLoading,
    error,
    filter,
    setFilter,
    hasMore,
    loadMore,
    loadInitial,
    isHelius,
    pageSize,
    setPageSize,
    totalFiltered,
    sortOrder,
    setSortOrder,
  } = useTransactionHistory(address, rpcUrl);

  const [dateOpen, setDateOpen] = useState(false);
  const [absoluteTime, setAbsoluteTime] = useState(false);

  const hasLoaded = allTransactions.length > 0 || isLoading || error !== null;

  const instructionNames = useMemo(() => {
    const names = new Set<string>();
    for (const tx of allTransactions) {
      for (const ix of tx.instructions) {
        if (ix.decoded?.instructionName && ix.programId !== COMPUTE_BUDGET_PROGRAM_ID) {
          names.add(ix.decoded.instructionName);
        }
      }
    }
    return names;
  }, [allTransactions]);

  const updateFilter = useCallback(
    (partial: Partial<TransactionFilter>) => {
      setFilter((prev) => ({ ...prev, ...partial }));
    },
    [],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <History className="size-3.5" />
          Transaction History
        </h4>
      </div>

      {!hasLoaded ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={loadInitial}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="size-3.5 mr-1 animate-spin" />
              Loading...
            </>
          ) : (
            "Load Transaction History"
          )}
        </Button>
      ) : (
        <div className="space-y-2">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-end">
            {/* Status filter */}
            <Select
              value={filter.statusFilter}
              onValueChange={(v) =>
                updateFilter({ statusFilter: v as TransactionFilter["statusFilter"] })
              }
            >
              <SelectTrigger className="h-7 text-xs w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>

            {/* Instruction filter */}
            {instructionNames.size > 0 && (
              <Select
                value={filter.instructionFilter || "__all__"}
                onValueChange={(v) =>
                  updateFilter({
                    instructionFilter: v === "__all__" ? undefined : v,
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All instructions</SelectItem>
                  {Array.from(instructionNames)
                    .sort()
                    .map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}

          </div>

          {/* Secondary controls row */}
          <HistoryControls
            dateOpen={dateOpen}
            setDateOpen={setDateOpen}
            fromDate={filter.fromDate}
            toDate={filter.toDate}
            onFromDateChange={(ts) => updateFilter({ fromDate: ts })}
            onToDateChange={(ts) => updateFilter({ toDate: ts })}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            absoluteTime={absoluteTime}
            onAbsoluteTimeChange={setAbsoluteTime}
            isHelius={isHelius}
            sortOrder={sortOrder}
            onSortOrderChange={setSortOrder}
          />

          {/* Results count */}
          {totalFiltered > 0 && (
            <div className="text-[10px] text-muted-foreground">
              {totalFiltered} transaction{totalFiltered !== 1 ? "s" : ""}
              {isHelius && (
                <Badge variant="outline" className="text-[8px] px-1 py-0 ml-1.5">
                  Helius
                </Badge>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
              {error}
            </div>
          )}

          {/* Transaction table */}
          {allTransactions.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-2 py-1 font-medium text-muted-foreground">
                      Signature
                    </th>
                    <th className="text-left px-2 py-1 font-medium text-muted-foreground">
                      Time
                    </th>
                    <th className="text-right px-2 py-1 font-medium text-muted-foreground">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allTransactions.map((tx) => {
                    const isSuccess = tx.err === null;
                    const ixNames: string[] = [];
                    for (const ix of tx.instructions) {
                      if (ix.decoded?.instructionName && ix.programId !== COMPUTE_BUDGET_PROGRAM_ID && !ixNames.includes(ix.decoded.instructionName)) {
                        ixNames.push(ix.decoded.instructionName);
                      }
                    }
                    return (
                      <tr key={tx.signature} className="border-t">
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-1">
                            <button
                              className="font-mono text-blue-500 hover:underline cursor-pointer"
                              onClick={() => onTransactionClick(tx.signature)}
                            >
                              {shortenAddress(tx.signature, 4)}
                            </button>
                            <CopyButton value={tx.signature} iconSize="size-2.5" />
                          </div>
                          {ixNames.length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-0.5">
                              {ixNames.map((name) => (
                                <Badge key={name} variant="outline" className="text-[8px] px-1 py-0">
                                  {name}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground whitespace-nowrap align-top">
                          {tx.blockTime ? (absoluteTime ? formatAbsoluteTime(tx.blockTime) : formatRelativeTime(tx.blockTime)) : "-"}
                        </td>
                        <td className="px-2 py-1 text-right align-top">
                          <Badge
                            variant={isSuccess ? "outline" : "destructive"}
                            className={`text-[9px] px-1.5 py-0 ${isSuccess ? "text-green-600 border-green-600/30 bg-green-500/10" : ""}`}
                          >
                            {isSuccess ? "Success" : "Failed"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Load More */}
          <LoadMoreFooter isLoading={isLoading} hasMore={hasMore} onLoadMore={loadMore} />

          {/* Empty state */}
          {!isLoading && allTransactions.length === 0 && !error && (
            <div className="text-xs text-muted-foreground text-center py-2">
              No transactions found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
