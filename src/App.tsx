import { useRef, useCallback, useState, useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { GraphProvider } from "@/contexts/GraphContext";
import { SettingsProvider, useSettings } from "@/contexts/SettingsContext";
import { ViewProvider, useView } from "@/contexts/ViewContext";
import { SearchBar, DepthControl, RpcSelector, BookmarksButton } from "@/components/SearchBar";
import { GraphCanvas } from "@/components/GraphCanvas";
import { NodeDetailPanel } from "@/components/NodeDetailPanel";
import { RelationshipEditor } from "@/components/RelationshipEditor";
import { ProgramBrowser } from "@/components/ProgramBrowser";
import { PdaSearch } from "@/components/PdaSearch";
import { TransactionView } from "@/components/TransactionView";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRelationshipRules } from "@/hooks/useRelationshipRules";
import { useClearAndExplore } from "@/hooks/useClearAndExplore";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Download, Upload, Menu, Sun, Moon, FlaskConical } from "lucide-react";
import { HistoryProvider } from "@/contexts/HistoryContext";
import { InspectTransactionModal } from "@/components/InspectTransactionModal";

function RelationshipRuleEngine() {
  useRelationshipRules();
  return null;
}

function SettingsIO() {
  const { exportSettings, importSettings } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    const json = exportSettings();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "solana-graph-explorer-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [exportSettings]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          importSettings(reader.result as string);
        } catch {
          alert("Invalid settings file");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [importSettings],
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button variant="ghost" size="icon" className="size-7" onClick={handleExport} title="Export settings">
        <Download className="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" onClick={handleImport} title="Import settings">
        <Upload className="size-3.5" />
      </Button>
    </>
  );
}

function DarkModeToggle() {
  const { darkMode, setDarkMode } = useSettings();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      onClick={() => setDarkMode(!darkMode)}
      title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
    >
      {darkMode ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </Button>
  );
}

function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const isSm = useMediaQuery("(max-width: 767px)");
  const { state: viewState, dispatch: viewDispatch, backToGraph } = useView();
  const clearAndExplore = useClearAndExplore();

  // When switching back from transaction mode with a pending address, explore it
  useEffect(() => {
    if (viewState.mode === "graph" && viewState.pendingExplore) {
      const address = viewState.pendingExplore;
      viewDispatch({ type: "CLEAR_PENDING_EXPLORE" });
      clearAndExplore(address);
    }
  }, [viewState.mode, viewState.pendingExplore, viewDispatch, clearAndExplore]);

  // Handle browser back/forward button for view switching
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const txParam = params.get("tx");
      if (txParam && viewState.mode !== "transaction") {
        viewDispatch({ type: "OPEN_TRANSACTION", signature: txParam });
      } else if (!txParam && viewState.mode === "transaction") {
        viewDispatch({ type: "BACK_TO_GRAPH" });
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [viewState.mode, viewDispatch, backToGraph]);

  return (
    <div className="h-screen w-screen flex flex-col">
      <header className="flex items-center gap-2 shrink-0 border-b bg-background">
        <SearchBar />
        {/* RPC Selector: visible at md+, right after search/history */}
        <div className="hidden md:flex">
          <RpcSelector />
        </div>
        {/* Right side controls — pushed to far right */}
        <div className="ml-auto flex items-center gap-2 pr-3">
          {/* Bookmarks */}
          <BookmarksButton onSelect={(addr) => clearAndExplore(addr)} />
          {/* Inspect Transaction */}
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => setInspectOpen(true)}
            title="Inspect a raw encoded transaction"
          >
            <FlaskConical className="size-4 mr-1" />
            Inspect
          </Button>
          <InspectTransactionModal open={inspectOpen} onOpenChange={setInspectOpen} />
          {/* PdaSearch: visible at md+, hidden on sm */}
          <div className="hidden md:flex">
            <PdaSearch />
          </div>
          {/* Rules: visible at md+ */}
          <div className="hidden md:flex">
            <RelationshipEditor />
          </div>
          {/* Hamburger menu */}
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-4" />
          </Button>
        </div>
      </header>
      {viewState.mode === "transaction" ? (
        <TransactionView />
      ) : (
        <div className="flex-1 flex min-h-0">
          <main className="flex-1 relative min-w-0">
            <GraphCanvas />
          </main>
          {!viewState.pendingExplore && <NodeDetailPanel />}
        </div>
      )}
      <RelationshipRuleEngine />

      {/* Hamburger slide-in menu */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" className="w-72 sm:max-w-xs overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            {/* PdaSearch: only in menu on sm screens */}
            {isSm && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">PDA Search</h4>
                <PdaSearch />
              </div>
            )}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Depth</h4>
              <DepthControl />
            </div>
            {isSm && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">RPC Endpoint</h4>
                <RpcSelector />
              </div>
            )}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Programs</h4>
              <ProgramBrowser />
            </div>
            {/* Rules: only in menu on sm screens */}
            {isSm && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Relationships</h4>
                <RelationshipEditor />
              </div>
            )}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Settings</h4>
              <div className="flex items-center gap-2">
                <DarkModeToggle />
                <SettingsIO />
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function App() {
  return (
    <SettingsProvider>
      <HistoryProvider>
        <GraphProvider>
          <ViewProvider>
            <ReactFlowProvider>
              <AppLayout />
            </ReactFlowProvider>
          </ViewProvider>
        </GraphProvider>
      </HistoryProvider>
    </SettingsProvider>
  );
}

export default App;
