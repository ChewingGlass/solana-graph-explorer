import { useMemo, useEffect, useCallback, useRef, useState } from "react";
import { useAsync } from "react-async-hook";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { TransactionViewData } from "@/types/transaction";
import type { Idl } from "@/types/idl";
import type { AccountNode } from "@/types/graph";
import {
  buildInstructionGraphs,
  type InstructionDetail,
} from "@/engine/instructionGraphBuilder";
import { getIdl } from "@/solana/idlCache";
import { fetchAndDecode, fetchAndDecodeMany } from "@/engine/expandAccount";
import { useGraph } from "@/contexts/GraphContext";
import { useSettings } from "@/contexts/SettingsContext";
import { AccountNodeComponent } from "@/components/AccountNode";
import { AccountEdgeComponent } from "@/components/AccountEdge";
import { ArgsNodeMemo } from "@/components/ArgsNode";
import { InstructionClusterNodeMemo } from "@/components/InstructionClusterNode";
import { InstructionLegend } from "@/components/InstructionLegend";

// Node types must be defined outside component
const nodeTypes = {
  account: AccountNodeComponent,
  txArgs: ArgsNodeMemo,
  ixCluster: InstructionClusterNodeMemo,
};

const edgeTypes = {
  account: AccountEdgeComponent,
};

interface TransactionCanvasInnerProps {
  txData: TransactionViewData;
  onInstructionSelect?: (detail: InstructionDetail | null) => void;
}

/** Convert a FetchDecodeResult to the data shape needed for node enrichment. */
function toEnrichData(result: import("@/engine/expandAccount").FetchDecodeResult): Record<string, unknown> {
  if (result.error || result.notFound) {
    return {
      isLoading: false,
      accountType: result.notFound ? "Not Found" : undefined,
      error: result.error,
    };
  }
  return {
    isLoading: false,
    programId: result.programId ?? undefined,
    programName: result.programName ?? undefined,
    balance: result.balance ?? undefined,
    accountType: result.accountType ?? "Unknown",
    decodedData: result.decodedData ?? undefined,
    thumbnail: result.thumbnail,
  };
}

function TransactionCanvasInner({ txData, onInstructionSelect }: TransactionCanvasInnerProps) {
  const { fitView } = useReactFlow();
  const { state: graphState, dispatch } = useGraph();
  const { rpcEndpoint } = useSettings();
  const knownGraphNodeIds = useRef(new Set<string>());

  // Build IDL map from cache
  const idls = useMemo(() => {
    const map = new Map<string, Idl>();
    const programIds = new Set<string>();
    for (const ix of txData.transaction.instructions) {
      programIds.add(ix.programId);
    }
    for (const innerSet of txData.transaction.innerInstructions) {
      for (const ix of innerSet.instructions) {
        programIds.add(ix.programId);
      }
    }
    for (const pid of programIds) {
      const idl = getIdl(pid);
      if (idl) map.set(pid, idl);
    }
    return map;
  }, [txData]);

  // Build graph
  const { initialNodes, initialEdges, clusters } = useMemo(() => {
    const result = buildInstructionGraphs(txData.transaction, idls);
    return {
      initialNodes: result.nodes,
      initialEdges: result.edges,
      clusters: result.clusters,
    };
  }, [txData, idls]);

  // Seed the GraphContext with initial nodes so NodeDetailPanel can work
  useEffect(() => {
    const accountNodes = initialNodes.filter(
      (n): n is AccountNode => n.type === "account",
    );
    if (accountNodes.length > 0) {
      dispatch({ type: "ADD_NODES", nodes: accountNodes });
    }
    // Track all initial GraphContext node IDs so we can detect new ones
    knownGraphNodeIds.current = new Set(accountNodes.map((n) => n.id));
  }, [initialNodes, dispatch]);

  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Sync new nodes from GraphContext (added by useExploreAddress) into the canvas.
  // When a user clicks a pubkey field, useExploreAddress adds a node (id = raw address)
  // and an edge (source = cluster-prefixed source node id). We detect the new node,
  // find the source's cluster, and add the new node inside it.
  useEffect(() => {
    const newGraphNodes = graphState.nodes.filter(
      (n) => !knownGraphNodeIds.current.has(n.id),
    );
    if (newGraphNodes.length === 0) return;

    // Mark as known so we don't re-process
    for (const n of newGraphNodes) {
      knownGraphNodeIds.current.add(n.id);
    }

    const currentNodes = nodesRef.current;
    const nodesToAdd: Node[] = [];
    const edgesToAdd: Edge[] = [];

    for (const gNode of newGraphNodes) {
      const addr = gNode.data.address;
      if (!addr) continue;

      // Check if this address is already on the canvas
      const alreadyOnCanvas = currentNodes.some(
        (n) => n.type === "account" && (n.data as Record<string, unknown>).address === addr,
      );
      if (alreadyOnCanvas) continue;

      // Find the source canvas node via the edge in GraphContext.
      // The edge source is the cluster-prefixed node ID (e.g. "cluster-0-Alice111").
      const relatedEdge = graphState.edges.find(
        (e) => e.target === gNode.id,
      );
      const sourceCanvasNode = relatedEdge
        ? currentNodes.find((n) => n.id === relatedEdge.source)
        : undefined;

      const parentCluster = sourceCanvasNode?.parentId;
      const canvasNodeId = parentCluster ? `${parentCluster}-${addr}` : `explored-${addr}`;

      // Position near the source node, offset to the right
      const baseX = sourceCanvasNode?.position.x ?? 50;
      const baseY = sourceCanvasNode?.position.y ?? 50;
      const offset = nodesToAdd.length * 320;

      const newNode: Node = {
        id: canvasNodeId,
        type: "account",
        position: { x: baseX + 320 + offset, y: baseY },
        ...(parentCluster
          ? { parentId: parentCluster, extent: "parent" as const }
          : {}),
        data: {
          address: addr,
          isExpanded: false,
          isLoading: true,
        },
      };
      nodesToAdd.push(newNode);

      // Create edge from source to new node on the canvas
      if (sourceCanvasNode && relatedEdge) {
        edgesToAdd.push({
          id: `${sourceCanvasNode.id}-explore-${canvasNodeId}`,
          source: sourceCanvasNode.id,
          target: canvasNodeId,
          label: relatedEdge.data?.fieldName ?? relatedEdge.data?.label ?? "",
          style: { stroke: "#6b7280", strokeWidth: 2 },
          data: { label: relatedEdge.data?.fieldName ?? relatedEdge.data?.label ?? "", relationshipType: "has_one" },
        });
      }

      // Also register in GraphContext with the canvas ID so sidebar selection works
      dispatch({
        type: "ADD_NODES",
        nodes: [{
          id: canvasNodeId,
          type: "account",
          position: newNode.position,
          data: { address: addr, isExpanded: false, isLoading: true },
        } as AccountNode],
      });
      dispatch({ type: "SELECT_NODE", nodeId: canvasNodeId });
      knownGraphNodeIds.current.add(canvasNodeId);

      // Grow the parent cluster to fit the new node
      if (parentCluster) {
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== parentCluster) return n;
            const curWidth = (n.style?.width as number) ?? 0;
            const curHeight = (n.style?.height as number) ?? 0;
            return {
              ...n,
              style: {
                ...n.style,
                width: Math.max(curWidth, baseX + 320 + offset + 360),
                height: Math.max(curHeight, baseY + 300),
              },
            };
          }),
        );
      }

      // Fetch and enrich the new node
      (async () => {
        try {
          const result = await fetchAndDecode(addr, rpcEndpoint);
          const enrichData = toEnrichData(result);
          dispatch({ type: "SET_NODE_DATA", nodeId: canvasNodeId, data: enrichData });
          setNodes((prev) =>
            prev.map((n) =>
              n.id === canvasNodeId ? { ...n, data: { ...n.data, ...enrichData } } : n,
            ),
          );
        } catch (err) {
          console.warn(`Failed to fetch and decode account ${addr} for transaction canvas`, err);
          const errData = { isLoading: false, error: "Failed to fetch" };
          dispatch({ type: "SET_NODE_DATA", nodeId: canvasNodeId, data: errData });
          setNodes((prev) =>
            prev.map((n) =>
              n.id === canvasNodeId ? { ...n, data: { ...n.data, ...errData } } : n,
            ),
          );
        }
      })();
    }

    if (nodesToAdd.length > 0) {
      setNodes((prev) => [...prev, ...nodesToAdd]);
    }
    if (edgesToAdd.length > 0) {
      setEdges((prev) => [...prev, ...edgesToAdd]);
    }
  }, [graphState.nodes, graphState.edges, dispatch, rpcEndpoint]);

  // Inner instruction filter state
  const [activeFilter, setActiveFilter] = useState<{ clusterIdx: number; innerIdx: number } | null>(null);

  // Derived: apply inner instruction filter visibility to nodes and edges
  const filteredNodes = useMemo(() => {
    if (!activeFilter) return nodes;

    const cluster = clusters[activeFilter.clusterIdx];
    if (!cluster) return nodes;

    const inner = cluster.innerInstructions[activeFilter.innerIdx];
    if (!inner) return nodes;

    const visibleNodeIds = inner.nodeIds;
    const targetClusterId = cluster.clusterId;

    return nodes.map((n) => {
      if (n.type === "ixCluster") return { ...n, hidden: false };
      if (n.parentId !== targetClusterId) return { ...n, hidden: false };
      const shouldShow = visibleNodeIds.has(n.id);
      return n.hidden === !shouldShow ? n : { ...n, hidden: !shouldShow };
    });
  }, [nodes, activeFilter, clusters]);

  const filteredEdges = useMemo(() => {
    if (!activeFilter) return edges;

    const cluster = clusters[activeFilter.clusterIdx];
    if (!cluster) return edges;

    const inner = cluster.innerInstructions[activeFilter.innerIdx];
    if (!inner) return edges;

    const visibleNodeIds = inner.nodeIds;
    const targetClusterId = cluster.clusterId;

    const allVisibleNodes = new Set<string>();
    for (const node of nodes) {
      if (node.type === "ixCluster") {
        allVisibleNodes.add(node.id);
      } else if (node.parentId !== targetClusterId) {
        allVisibleNodes.add(node.id);
      } else if (visibleNodeIds.has(node.id)) {
        allVisibleNodes.add(node.id);
      }
    }
    return edges.map((e) => {
      const shouldShow = allVisibleNodes.has(e.source) && allVisibleNodes.has(e.target);
      return e.hidden === !shouldShow ? e : { ...e, hidden: !shouldShow };
    });
  }, [edges, activeFilter, clusters, nodes]);

  // Async account enrichment: fetch and decode all unique accounts.
  // For simulated transactions, just clear loading flags without fetching.
  useAsync(async () => {
    const accountNodes = initialNodes.filter((n) => n.type === "account");
    if (accountNodes.length === 0) return;

    // Collect unique addresses
    const addrToNodeIds = new Map<string, string[]>();
    for (const node of accountNodes) {
      const addr = (node.data as { address: string }).address;
      const existing = addrToNodeIds.get(addr) ?? [];
      existing.push(node.id);
      addrToNodeIds.set(addr, existing);
    }

    // Filter out invalid addresses (e.g. "idx:8" from unresolved address table lookups)
    for (const addr of addrToNodeIds.keys()) {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
        const nodeIds = addrToNodeIds.get(addr)!;
        for (const nodeId of nodeIds) {
          dispatch({ type: "SET_NODE_DATA", nodeId, data: { isLoading: false } });
        }
        setNodes((prev) =>
          prev.map((n) =>
            nodeIds.includes(n.id) ? { ...n, data: { ...n.data, isLoading: false } } : n,
          ),
        );
        addrToNodeIds.delete(addr);
      }
    }

    const uniqueAddrs = Array.from(addrToNodeIds.keys());
    const batchMap = await fetchAndDecodeMany(uniqueAddrs, rpcEndpoint);

    for (const [addr, nodeIds] of addrToNodeIds) {
      const result = batchMap.get(addr);
      if (!result) continue;

      const enrichData = toEnrichData(result);

      for (const nodeId of nodeIds) {
        dispatch({ type: "SET_NODE_DATA", nodeId, data: enrichData });
      }

      setNodes((prev) =>
        prev.map((n) =>
          nodeIds.includes(n.id)
            ? { ...n, data: { ...n.data, ...enrichData } }
            : n,
        ),
      );
    }
  }, [initialNodes, rpcEndpoint, dispatch]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  // Click to select node in GraphContext (for NodeDetailPanel) or instruction
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "account") {
        onInstructionSelect?.(null);
        dispatch({ type: "SELECT_NODE", nodeId: node.id });
      } else if (node.type === "ixCluster") {
        dispatch({ type: "SELECT_NODE", nodeId: null });
        const detail = node.data?.instructionDetail as InstructionDetail | undefined;
        if (detail) onInstructionSelect?.(detail);
      }
    },
    [dispatch, onInstructionSelect],
  );

  const onPaneClick = useCallback(() => {
    dispatch({ type: "SELECT_NODE", nodeId: null });
    onInstructionSelect?.(null);
  }, [dispatch, onInstructionSelect]);

  // Fit view once on initial mount (key prop handles remount on txData change)
  useEffect(() => {
    if (nodes.length === 0) return;

    const t1 = setTimeout(() => {
      fitView({ duration: 300, padding: 0.1 });
    }, 200);
    const t2 = setTimeout(() => {
      fitView({ duration: 300, padding: 0.1 });
    }, 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={filteredNodes}
        edges={filteredEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        defaultEdgeOptions={{ type: "account" }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={() => "hsl(var(--primary))"}
          className="!bg-muted"
        />
        <InstructionLegend
          clusters={clusters}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
        />
      </ReactFlow>
    </div>
  );
}

interface TransactionCanvasProps {
  txData: TransactionViewData;
  onInstructionSelect?: (detail: InstructionDetail | null) => void;
}

export function TransactionCanvas({ txData, onInstructionSelect }: TransactionCanvasProps) {
  return <TransactionCanvasInner key={txData.transaction.signature} txData={txData} onInstructionSelect={onInstructionSelect} />;
}
