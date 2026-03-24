import { useState, useCallback, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RPC_OPTIONS, type RpcEndpointKey, useSettings } from "@/contexts/SettingsContext";
import { useView } from "@/contexts/ViewContext";
import { Search, Bookmark, Minus, Plus } from "lucide-react";
import { isTxSignature, shortenAddress } from "@/utils/format";
import { useClearAndExplore } from "@/hooks/useClearAndExplore";
import { HistoryButton } from "@/components/HistoryButton";

// Accept both addresses and transaction signatures
const searchSchema = z.object({
  address: z
    .string()
    .trim()
    .min(1, "Enter an address or transaction signature")
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,90}$/, "Invalid Solana address or transaction signature"),
});

type SearchForm = z.infer<typeof searchSchema>;

export function DepthControl() {
  const { expansionDepth, setExpansionDepth } = useSettings();
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground whitespace-nowrap">Depth</span>
      <Button
        variant="outline"
        size="icon"
        className="size-7"
        onClick={() => setExpansionDepth(prev => prev - 1)}
        disabled={expansionDepth <= 1}
      >
        <Minus className="size-3" />
      </Button>
      <span className="text-sm font-mono w-4 text-center">{expansionDepth}</span>
      <Button
        variant="outline"
        size="icon"
        className="size-7"
        onClick={() => setExpansionDepth(prev => prev + 1)}
        disabled={expansionDepth >= 5}
      >
        <Plus className="size-3" />
      </Button>
    </div>
  );
}

export function RpcSelector() {
  const { rpcEndpointKey, setRpcEndpointKey, customRpcUrl, setCustomRpcUrl } = useSettings();
  return (
    <div className="flex items-center gap-2">
      <Select
        value={rpcEndpointKey}
        onValueChange={(v) => setRpcEndpointKey(v as RpcEndpointKey)}
      >
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RPC_OPTIONS.map((opt) => (
            <SelectItem key={opt.key} value={opt.key}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {rpcEndpointKey === "custom" && (
        <Input
          placeholder="https://..."
          value={customRpcUrl}
          onChange={(e) => setCustomRpcUrl(e.target.value)}
          className="w-60"
          size={1}
        />
      )}
    </div>
  );
}

export function SearchBar() {
  const params = new URLSearchParams(window.location.search);
  const initialInput = params.get("address") ?? params.get("tx") ?? "";

  const form = useForm<SearchForm>({
    resolver: zodResolver(searchSchema),
    defaultValues: {
      address: initialInput,
    },
  });

  const { state: viewState, openTransaction, inspectMessage } = useView();
  const clearAndExplore = useClearAndExplore();
  const hasAutoExplored = useRef(false);

  // Sync search bar with URL when returning from transaction view
  useEffect(() => {
    if (viewState.mode === "graph") {
      const address = new URLSearchParams(window.location.search).get("address");
      if (address) {
        form.setValue("address", address);
      }
    }
  }, [viewState.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const addressError = form.formState.errors.address?.message;

  const handleExplore = useCallback(
    (data: SearchForm) => {
      const input = data.address.trim();
      if (isTxSignature(input)) {
        openTransaction(input);
      } else {
        clearAndExplore(input);
      }
    },
    [clearAndExplore, openTransaction],
  );

  // Auto-explore on mount if URL has an address, tx signature, or message
  useEffect(() => {
    if (hasAutoExplored.current) return;
    const urlParams = new URLSearchParams(window.location.search);

    // Check for message param first (inspect transaction)
    const messageParam = urlParams.get("message");
    if (messageParam) {
      hasAutoExplored.current = true;
      inspectMessage(messageParam);
      return;
    }

    // Check for tx param
    const txParam = urlParams.get("tx");
    if (txParam && isTxSignature(txParam.trim())) {
      hasAutoExplored.current = true;
      openTransaction(txParam.trim());
      return;
    }

    const addr = form.getValues("address");
    if (addr && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim())) {
      hasAutoExplored.current = true;
      clearAndExplore(addr.trim());
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center gap-2 p-3">
      <div className="flex items-center gap-2 flex-1 max-w-2xl">
        <div className="flex-1 relative">
          <Input
            placeholder="Enter Solana address or tx signature..."
            {...form.register("address")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                form.handleSubmit(handleExplore)();
              }
            }}
            className={addressError ? "border-destructive" : ""}
          />
          {addressError && (
            <div className="absolute text-[11px] text-destructive mt-0.5">
              {addressError}
            </div>
          )}
        </div>
        <Button onClick={form.handleSubmit(handleExplore)} size="sm">
          <Search className="size-4 mr-1" />
          Explore
        </Button>

        {/* History button — right next to Explore */}
        <HistoryButton
          onAccountClick={(addr) => clearAndExplore(addr)}
          onTransactionClick={(sig) => openTransaction(sig)}
        />

      </div>

    </div>
  );
}

export function BookmarksButton({ onSelect }: { onSelect: (address: string) => void }) {
  const { addressLabels } = useSettings();
  const [showLabels, setShowLabels] = useState(false);
  const labelsRef = useRef<HTMLDivElement>(null);

  const labelEntries = Object.entries(addressLabels);

  // Close on outside click
  useEffect(() => {
    if (!showLabels) return;
    const handler = (e: MouseEvent) => {
      if (labelsRef.current && !labelsRef.current.contains(e.target as Node)) {
        setShowLabels(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLabels]);

  if (labelEntries.length === 0) return null;

  return (
    <div className="relative" ref={labelsRef}>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={() => setShowLabels((p) => !p)}
        title="Saved labels"
      >
        <Bookmark className="size-4" />
      </Button>
      {showLabels && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-background border rounded-md shadow-lg min-w-[240px] max-h-[300px] overflow-y-auto">
          {labelEntries.map(([addr, lbl]) => (
            <button
              key={addr}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between gap-2"
              onClick={() => {
                setShowLabels(false);
                onSelect(addr);
              }}
            >
              <span className="font-medium truncate">{lbl}</span>
              <span className="text-xs text-muted-foreground font-mono shrink-0">
                {shortenAddress(addr, 6)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
