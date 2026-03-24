import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FlaskConical } from "lucide-react";
import { useView } from "@/contexts/ViewContext";

interface InspectTransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InspectTransactionModal({
  open,
  onOpenChange,
}: InspectTransactionModalProps) {
  const [rawInput, setRawInput] = useState("");
  const { inspectMessage } = useView();

  const handleSimulate = useCallback(() => {
    const trimmed = rawInput.trim();
    if (!trimmed) return;
    onOpenChange(false);
    inspectMessage(trimmed);
  }, [rawInput, onOpenChange, inspectMessage]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="size-4" />
            Inspect Transaction
          </DialogTitle>
          <DialogDescription>
            Paste a base64 or base58 encoded transaction to simulate and inspect it.
          </DialogDescription>
        </DialogHeader>

        <textarea
          className="w-full h-40 p-3 font-mono text-xs bg-muted border rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Paste encoded transaction here..."
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSimulate();
            }
          }}
          spellCheck={false}
        />

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSimulate}
            disabled={!rawInput.trim()}
          >
            <FlaskConical className="size-3.5 mr-1" />
            Simulate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
