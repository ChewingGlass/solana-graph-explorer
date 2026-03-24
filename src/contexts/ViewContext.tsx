import {
  createContext,
  useContext,
  useReducer,
  useMemo,
  useCallback,
  type Dispatch,
  type ReactNode,
} from "react";
import type { TransactionViewData } from "@/types/transaction";

export interface ViewState {
  mode: "graph" | "transaction";
  txSignature: string | null;
  txData: TransactionViewData | null;
  txLoading: boolean;
  txError: string | null;
  /** True when the transaction was simulated (not fetched from chain) */
  txSimulated: boolean;
  /** Raw encoded message for simulation (set by INSPECT_TRANSACTION) */
  txRawMessage: string | null;
  /** Compute units consumed (only available for simulated transactions) */
  txComputeUnits?: number;
  /** Address to explore after switching back from transaction mode */
  pendingExplore: string | null;
  /** Address that was in the URL before opening a transaction */
  previousAddress: string | null;
}

export type ViewAction =
  | { type: "OPEN_TRANSACTION"; signature: string; previousAddress?: string | null }
  | { type: "SET_TX_DATA"; data: TransactionViewData }
  | { type: "SET_TX_ERROR"; error: string }
  | { type: "BACK_TO_GRAPH"; pendingExplore?: string }
  | { type: "CLEAR_PENDING_EXPLORE" }
  | { type: "INSPECT_TRANSACTION"; rawMessage: string }
  | { type: "SET_SIMULATED_TX"; data: TransactionViewData; computeUnits?: number };

const initialState: ViewState = {
  mode: "graph",
  txSignature: null,
  txData: null,
  txLoading: false,
  txError: null,
  txSimulated: false,
  txRawMessage: null,
  pendingExplore: null,
  previousAddress: null,
};

function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "OPEN_TRANSACTION":
      return {
        ...state,
        mode: "transaction",
        txSignature: action.signature,
        txData: null,
        txLoading: true,
        txError: null,
        txSimulated: false,
        txRawMessage: null,
        txComputeUnits: undefined,
        previousAddress: action.previousAddress ?? state.previousAddress,
      };
    case "SET_TX_DATA":
      return {
        ...state,
        txData: action.data,
        txLoading: false,
        txError: null,
      };
    case "SET_TX_ERROR":
      return {
        ...state,
        txLoading: false,
        txError: action.error,
      };
    case "INSPECT_TRANSACTION":
      return {
        ...state,
        mode: "transaction",
        txSignature: null,
        txData: null,
        txLoading: true,
        txError: null,
        txSimulated: true,
        txRawMessage: action.rawMessage,
        txComputeUnits: undefined,
      };
    case "SET_SIMULATED_TX":
      return {
        ...state,
        txData: action.data,
        txLoading: false,
        txError: null,
        txSimulated: true,
        txComputeUnits: action.computeUnits,
      };
    case "BACK_TO_GRAPH":
      return {
        ...state,
        mode: "graph",
        txSignature: null,
        txData: null,
        txLoading: false,
        txError: null,
        txSimulated: false,
        txRawMessage: null,
        txComputeUnits: undefined,
        pendingExplore: action.pendingExplore ?? null,
        previousAddress: null,
      };
    case "CLEAR_PENDING_EXPLORE":
      return {
        ...state,
        pendingExplore: null,
      };
  }
}

interface ViewContextValue {
  state: ViewState;
  dispatch: Dispatch<ViewAction>;
  openTransaction: (signature: string) => void;
  inspectMessage: (rawMessage: string) => void;
  backToGraph: (pendingExplore?: string) => void;
}

const ViewContext = createContext<ViewContextValue | null>(null);

export function ViewProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(viewReducer, initialState);

  const openTransaction = useCallback(
    (signature: string) => {
      const url = new URL(window.location.href);
      const currentAddress = url.searchParams.get("address") ?? null;
      url.searchParams.delete("address");
      url.searchParams.set("tx", signature);
      window.history.pushState({}, "", url.toString());
      dispatch({ type: "OPEN_TRANSACTION", signature, previousAddress: currentAddress });
    },
    [dispatch],
  );

  const inspectMessage = useCallback(
    (rawMessage: string) => {
      const url = new URL(window.location.href);
      url.searchParams.delete("address");
      url.searchParams.delete("tx");
      url.searchParams.set("message", rawMessage);
      window.history.pushState({}, "", url.toString());
      dispatch({ type: "INSPECT_TRANSACTION", rawMessage });
    },
    [dispatch],
  );

  const backToGraph = useCallback((pendingExplore?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("tx");
    url.searchParams.delete("message");
    const addressToRestore = pendingExplore ?? state.previousAddress;
    if (addressToRestore) {
      url.searchParams.set("address", addressToRestore);
    }
    window.history.pushState({}, "", url.toString());
    dispatch({ type: "BACK_TO_GRAPH", pendingExplore });
  }, [dispatch, state.previousAddress]);

  const value = useMemo(
    () => ({ state, dispatch, openTransaction, inspectMessage, backToGraph }),
    [state, dispatch, openTransaction, inspectMessage, backToGraph],
  );

  return (
    <ViewContext.Provider value={value}>{children}</ViewContext.Provider>
  );
}

export function useView(): ViewContextValue {
  const ctx = useContext(ViewContext);
  if (!ctx) {
    throw new Error("useView must be used within a ViewProvider");
  }
  return ctx;
}
