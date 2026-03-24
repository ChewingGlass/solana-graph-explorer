import { useEffect, useState, useCallback, useRef } from "react";
import { useAsync } from "react-async-hook";
import { ReactFlowProvider } from "@xyflow/react";
import { Loader2, ChevronUp, ChevronDown, GripHorizontal } from "lucide-react";
import { useView } from "@/contexts/ViewContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useHistory } from "@/contexts/HistoryContext";
import { GraphProvider, useGraph } from "@/contexts/GraphContext";
import { fetchTransactionBySignature } from "@/solana/fetchTransaction";
import { simulateRawTransaction } from "@/solana/simulateTransaction";
import { COMPUTE_BUDGET_PROGRAM_ID } from "@/solana/builtinIdls";
import { decodeTransaction } from "@/engine/transactionDecoder";
import { TransactionHeader } from "@/components/TransactionHeader";
import { TransactionLogs } from "@/components/TransactionLogs";
import { BalanceChanges } from "@/components/BalanceChanges";
import { TransactionCanvas } from "@/components/TransactionCanvas";
import { NodeDetailPanel } from "@/components/NodeDetailPanel";
import { InstructionDetailPanel } from "@/components/InstructionDetailPanel";
import type { InstructionDetail } from "@/engine/instructionGraphBuilder";

/** Wrapper that provides address click → node selection via GraphContext */
function InstructionDetailPanelWithGraph({
  detail,
  onClose,
}: {
  detail: InstructionDetail;
  onClose: () => void;
}) {
  const { dispatch } = useGraph();
  const handleAddressClick = useCallback(
    (address: string) => {
      const nodeId = `${detail.clusterId}-${address}`;
      dispatch({ type: "SELECT_NODE", nodeId });
      onClose(); // switch to node detail panel
    },
    [detail.clusterId, dispatch, onClose],
  );
  return (
    <InstructionDetailPanel
      detail={detail}
      onClose={onClose}
      onAddressClick={handleAddressClick}
    />
  );
}

const DEFAULT_INFO_HEIGHT = 300;
const MIN_INFO_HEIGHT = 60;
const MAX_INFO_RATIO = 0.7; // max 70% of container

export function TransactionView() {
  const { state, dispatch } = useView();
  const { rpcEndpoint } = useSettings();
  const { addHistoryItem } = useHistory();
  const [infoHeight, setInfoHeight] = useState(DEFAULT_INFO_HEIGHT);
  const [collapsed, setCollapsed] = useState<"none" | "info" | "graph">("none");
  const [preCollapseHeight, setPreCollapseHeight] = useState(DEFAULT_INFO_HEIGHT);
  const [selectedInstruction, setSelectedInstruction] = useState<InstructionDetail | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const didDrag = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Fetch and decode transaction when signature changes (skip for simulated txs)
  useAsync(async () => {
    if (!state.txSignature || !state.txLoading || state.txSimulated) return;

    try {
      const tx = await fetchTransactionBySignature(
        state.txSignature,
        rpcEndpoint,
      );

      if (!tx) {
        dispatch({
          type: "SET_TX_ERROR",
          error: "Transaction not found. It may not have been confirmed yet.",
        });
        return;
      }

      const viewData = await decodeTransaction(tx, rpcEndpoint);
      dispatch({ type: "SET_TX_DATA", data: viewData });

      // Track transaction visit in history
      const instructionNames = viewData.transaction.instructions
        .filter((ix) => ix.programId !== COMPUTE_BUDGET_PROGRAM_ID)
        .map((ix) => ix.decoded?.instructionName)
        .filter((n): n is string => !!n);
      addHistoryItem({
        type: "transaction",
        id: state.txSignature,
        timestamp: Date.now(),
        blockTime: viewData.transaction.blockTime ?? undefined,
        instructionNames: instructionNames.length > 0 ? instructionNames : undefined,
      });
    } catch (err) {
      dispatch({
        type: "SET_TX_ERROR",
        error:
          err instanceof Error
            ? err.message
            : "Failed to fetch transaction",
      });
    }
  }, [state.txSignature, state.txLoading, rpcEndpoint]);

  // Simulate transaction when raw message is provided
  useAsync(async () => {
    if (!state.txRawMessage || !state.txLoading || !state.txSimulated) return;

    try {
      const { parsedTransaction, computeUnits } = await simulateRawTransaction(
        state.txRawMessage,
        rpcEndpoint,
      );
      const viewData = await decodeTransaction(parsedTransaction, rpcEndpoint);
      dispatch({ type: "SET_SIMULATED_TX", data: viewData, computeUnits });
    } catch (err) {
      dispatch({
        type: "SET_TX_ERROR",
        error: err instanceof Error ? err.message : "Failed to simulate transaction",
      });
    }
  }, [state.txRawMessage, state.txLoading, state.txSimulated, rpcEndpoint]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = infoHeight;
    e.preventDefault();
  }, [infoHeight]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientY - startY.current;
      const containerHeight = containerRef.current?.clientHeight ?? 800;
      const maxHeight = containerHeight * MAX_INFO_RATIO;
      setInfoHeight(Math.max(MIN_INFO_HEIGHT, Math.min(maxHeight, startHeight.current + delta)));
    };
    const onMouseUp = () => {
      isDragging.current = false;
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Loading state
  if (state.txLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">Loading transaction...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (state.txError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-sm text-destructive">{state.txError}</div>
          <button
            className="text-xs text-blue-500 hover:underline cursor-pointer"
            onClick={() => {
              if (state.txSignature) {
                dispatch({
                  type: "OPEN_TRANSACTION",
                  signature: state.txSignature,
                });
              }
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // No data
  if (!state.txData) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        No transaction data.
      </div>
    );
  }

  const { transaction, balanceChanges, tokenBalanceChanges } = state.txData;

  return (
    <GraphProvider>
      <ReactFlowProvider>
        <div ref={containerRef} className="flex-1 flex min-h-0 w-full">
          {/* Main content column */}
          <div className="flex-1 flex flex-col min-h-0">
            <TransactionHeader tx={transaction} simulated={state.txSimulated} computeUnits={state.txComputeUnits} />

            {/* Scrollable info section - logs first per user preference */}
            {collapsed !== "info" && (
              <div
                className="overflow-y-auto shrink-0 relative"
                style={collapsed === "graph" ? { flex: 1 } : { height: infoHeight }}
              >
                <TransactionLogs logs={transaction.logMessages} />
                <BalanceChanges
                  balanceChanges={balanceChanges}
                  tokenBalanceChanges={tokenBalanceChanges}
                />
                {/* Fade-out at bottom edge */}
                <div className="sticky bottom-0 h-6 bg-gradient-to-t from-background to-transparent pointer-events-none" />
              </div>
            )}

            {/* Divider bar with collapse controls */}
            <div className="shrink-0 h-7 bg-muted/50 border-y border-border shadow-[0_-4px_12px_rgba(0,0,0,0.15)] flex items-center justify-center relative z-10">
              {/* Drag zone on sides */}
              {collapsed === "none" && (
                <div
                  className="absolute inset-0 cursor-row-resize z-0"
                  onMouseDown={onMouseDown}
                />
              )}
              {/* Control buttons */}
              <div className="relative z-10 flex items-center gap-2">
                <button
                  className={`p-1.5 rounded transition-colors ${collapsed === "info" ? "bg-foreground text-background" : "hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground"}`}
                  onClick={() => {
                    if (collapsed === "info") {
                      setCollapsed("none");
                      setInfoHeight(preCollapseHeight);
                    } else {
                      setPreCollapseHeight(infoHeight);
                      setCollapsed("info");
                    }
                  }}
                  title={collapsed === "info" ? "Show logs" : "Hide logs"}
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  className="p-1.5 rounded hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-colors cursor-grab active:cursor-grabbing"
                  onClick={() => {
                    if (didDrag.current) {
                      didDrag.current = false;
                      return;
                    }
                    setCollapsed("none");
                    setInfoHeight(DEFAULT_INFO_HEIGHT);
                  }}
                  onMouseDown={(e) => {
                    didDrag.current = false;
                    const handleUp = () => {
                      document.removeEventListener("mouseup", handleUp);
                      document.removeEventListener("mousemove", handleMove);
                    };
                    const handleMove = (moveEvt: MouseEvent) => {
                      if (Math.abs(moveEvt.clientY - e.clientY) > 3) {
                        didDrag.current = true;
                        handleUp();
                        if (collapsed !== "none") {
                          setCollapsed("none");
                          setInfoHeight(preCollapseHeight);
                        }
                        isDragging.current = true;
                        startY.current = e.clientY;
                        startHeight.current = infoHeight;
                      }
                    };
                    document.addEventListener("mouseup", handleUp);
                    document.addEventListener("mousemove", handleMove);
                    e.stopPropagation();
                  }}
                  title="Click to reset, drag to resize"
                >
                  <GripHorizontal className="size-4" />
                </button>
                <button
                  className={`p-1.5 rounded transition-colors ${collapsed === "graph" ? "bg-foreground text-background" : "hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground"}`}
                  onClick={() => {
                    if (collapsed === "graph") {
                      setCollapsed("none");
                      setInfoHeight(preCollapseHeight);
                    } else {
                      setPreCollapseHeight(infoHeight);
                      setCollapsed("graph");
                    }
                  }}
                  title={collapsed === "graph" ? "Show graph" : "Hide graph"}
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
            </div>

            {/* Instruction graph canvas takes remaining space */}
            {collapsed !== "graph" && (
              <div className="flex-1 min-h-0">
                <TransactionCanvas txData={state.txData} onInstructionSelect={setSelectedInstruction} />
              </div>
            )}
          </div>

          {/* Detail panel spans full height */}
          {selectedInstruction ? (
            <InstructionDetailPanelWithGraph
              detail={selectedInstruction}
              onClose={() => setSelectedInstruction(null)}
            />
          ) : (
            <NodeDetailPanel />
          )}
        </div>
      </ReactFlowProvider>
    </GraphProvider>
  );
}
