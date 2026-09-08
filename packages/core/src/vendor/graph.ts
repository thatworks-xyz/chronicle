export interface GraphAsJson<Node> {
    nodes: { [id: string]: Node };
    edges: { [id: string]: string[] };
    roots: string[];
}

export class Graph<Node> implements Iterable<[Node, Node[], number]> {
    _list: Map<Node, Node[]> = new Map();

    [Symbol.iterator](): Iterator<[Node, Node[], number]> {
        return new GraphIterator(this);
    }

    addNode(node: Node, edges: Node[] = []) {
        if (this._list.has(node)) {
            this._list.delete(node);
        }
        this._list.set(node, edges);
    }

    addEdge(node: Node, edge: Node) {
        const n = this._list.get(node);
        if (!n) {
            throw new Error('Node does not exist');
        }
        n.push(edge);
    }

    setEdges(node: Node, edges: Node[]) {
        this._list.set(node, edges);
    }

    getNodes() {
        return Array.from(this._list.keys());
    }

    getEdges(node: Node) {
        return this._list.get(node) || [];
    }

    getRootNode(node: Node): Node {
        let res: Node = node;
        for (const [k, v] of this._list) {
            if (v.includes(node)) {
                res = this.getRootNode(k);
                break;
            }
        }
        return res;
    }

    findParents(node: Node): Node[] {
        const res: Node[] = [];
        for (const [k, v] of this._list) {
            if (v.includes(node)) {
                res.push(k);
            }
        }
        return res;
    }

    getGraphRoots(): Node[] {
        const allNodes = this.getNodes();
        const roots = new Set<Node>();
        allNodes.forEach((v) => {
            const r = this.getRootNode(v);
            roots.add(r);
        });
        return Array.from(roots);
    }

    bfs(startNode: Node, itr: (n: Node, levelFromStart: number, parent: Node | undefined) => void) {
        let graphLevel = 0;
        const visited = new Set<Node>();
        const queue: { node: Node; level: number; parent: Node | undefined }[] = [
            {
                node: startNode,
                level: graphLevel,
                parent: undefined,
            },
        ];

        while (queue.length) {
            const toProcess = queue.shift();
            if (!toProcess) {
                continue;
            }

            itr(toProcess.node, toProcess.level, toProcess.parent);

            const edges = this.getEdges(toProcess.node);

            if (edges.length && graphLevel === toProcess.level) {
                graphLevel++;
            }

            edges.forEach((e) => {
                if (!visited.has(e)) {
                    visited.add(e);
                    queue.push({ node: e, level: graphLevel, parent: toProcess.node });
                }
            });
        }
    }

    getNodesPerLevel(root: Node): Array<Array<Node>> {
        const res: Array<Array<Node>> = [];
        this.bfs(root, (n, level) => {
            if (res.length <= level) {
                res.push([n]);
            } else {
                res[level].push(n);
            }
        });
        return res;
    }

    /**
     * Returns the height from a root node to the tip of its children, not including the root
     * @param root Node from which to calculate the height
     */
    getNumLevelsToTip(root: Node): number {
        let height = 0;
        this.bfs(root, (_n, level) => {
            height = level;
        });
        return height;
    }

    getJson(sort?: (a: Node, b: Node) => number): GraphAsJson<Node> {
        const res: GraphAsJson<Node> = { nodes: {}, edges: {}, roots: [] };

        const allNodes = this.getNodes();
        const indexMap: Map<Node, number> = new Map();
        allNodes.forEach((v, i) => {
            indexMap.set(v, i);
            res.nodes[`${i}`] = v;
        });

        for (const [k, v] of this._list) {
            const edgeIndexes = v.map((n) => {
                const e = indexMap.get(n);
                if (e === undefined) {
                    throw new Error(`Edge is invalid when it should not be`);
                }
                return e;
            });
            if (sort) {
                edgeIndexes.sort((a, b) => {
                    return sort(allNodes[a], allNodes[b]);
                });
            }
            res.edges[`${indexMap.get(k)}`] = edgeIndexes.map((n) => n.toString());
        }

        const roots = new Set<Node>();
        allNodes.forEach((v) => {
            const r = this.getRootNode(v);
            roots.add(r);
        });

        const rootIndexes: number[] = [];
        for (const r of roots) {
            const n = indexMap.get(r);
            if (n === undefined) {
                throw new Error(`Node is invalid when it should not be`);
            }
            rootIndexes.push(n);
        }
        if (sort) {
            rootIndexes.sort((a, b) => sort(allNodes[a], allNodes[b]));
        }
        res.roots = rootIndexes.map((v) => v.toString());

        return res;
    }

    removeNodeAndChildrenDfsOnly(node: Node, nodesAreEqual: (a: Node, b: Node) => boolean) {
        if (!this._list.has(node)) {
            return;
        }

        const parents = this.findParents(node);
        parents.forEach((parent) => {
            const parentEdges = this.getEdges(parent);
            const filtered = parentEdges.filter((v) => !nodesAreEqual(v, node));
            this._list.set(parent, filtered);
        });

        const nodesToRemove: Node[] = [node];
        this.dfs(node, (n) => {
            nodesToRemove.push(n);
            return true;
        });
        nodesToRemove.forEach((n) => this._list.delete(n));
    }

    /**
     * Removes nodes until the provided node is reached
     * @param root root node to start from
     * @param untilNode node to stop at
     */
    removeNodesUntil(root: Node, untilNode: Node) {
        if (root === untilNode) {
            return;
        }

        const nodesToRemove: Node[] = [root];
        this.dfs(root, (n) => {
            if (n === untilNode) {
                return false;
            }
            nodesToRemove.push(n);
            return true;
        });
        nodesToRemove.forEach((n) => {
            this.removeNode(n);
        });
    }

    /**
     * Checks if a node has shared ancestry to the provided root node
     * @param node node to check for shared ancestry
     * @param root root node to traverse from
     */
    nodeHasSharedAncestryTo(node: Node, root: Node): boolean {
        let hasSharedAncestry = false;
        this.bfs(root, (n) => {
            if (n === node) {
                hasSharedAncestry = true;
            }
        });
        return hasSharedAncestry;
    }

    /**
     * Removes nodes and transfers their children to their parent.
     * If no parent exists, the children are promoted to root nodes.
     * @param node Node to start from
     * @param shouldRemove Function to determine if a node should be removed
     */
    removeNodesAndTransferChildrenToParentBfs(node: Node, shouldRemove: (n: Node) => boolean) {
        if (!this._list.has(node)) {
            return;
        }

        const nodesToRemove = new Map<Node, { node: Node; parent: Node | undefined }>();
        this.bfs(node, (n, _, parent) => {
            if (shouldRemove(n)) {
                const parentAlreadyMarked = parent ? nodesToRemove.get(parent) : undefined;
                if (parentAlreadyMarked) {
                    parent = parentAlreadyMarked.parent;
                }

                nodesToRemove.set(n, { node: n, parent });
                return;
            }
            parent = n;
        });

        nodesToRemove.forEach((n) => {
            const edges = this.getEdges(n.node).filter((v) => !nodesToRemove.has(v));
            if (n.parent === undefined) {
                edges.forEach((e) => {
                    this.addNode(e, this.getEdges(e));
                });
                return;
            }
            const existingEdges = this.getEdges(n.parent).filter((v) => v !== n.node);
            this.setEdges(n.parent, Array.from(new Set(existingEdges.concat(edges))));
        });
        nodesToRemove.forEach((n) => {
            this.removeNode(n.node);
        });
    }

    /**
     * Removes nodes that do not have shared ancestry to the provided nodes
     * @param nodes Root nodes and descendendents to keep
     */
    removeNodesWithoutSharedAncestryTo(nodes: Node[]) {
        const ancestry = new Set<Node>();
        nodes.forEach((node) => {
            this.bfs(node, (n) => {
                ancestry.add(n);
            });
        });

        const nodesToRemove: Node[] = [];
        this.getNodes().forEach((n) => {
            if (!ancestry.has(n)) {
                nodesToRemove.push(n);
            }
        });

        nodesToRemove.forEach((n) => {
            this.removeNode(n);
        });
    }

    /**
     * Flattens the graph to the root nodes. All edges are moved to the root nodes and the children are left with no edges
     * @param filter Optional filter to apply to the edges
     */
    flattenToRootNodes(filter: (n: Node) => boolean = () => true) {
        const roots = this.getGraphRoots();
        const collectedRoots = roots.map((root) => {
            const edges: Node[] = [];
            this.dfs(root, (n) => {
                if (n === root) {
                    return true;
                }
                edges.push(n);
                return true;
            });
            return { root, edges };
        });
        collectedRoots.forEach((c) => {
            const filteredEdges = c.edges.filter(filter);
            this.setEdges(c.root, filteredEdges);
            filteredEdges.forEach((e) => {
                this.setEdges(e, []);
            });
        });
    }

    /**
     * Removes a node and nothing else. Children are not updated and edges on parents, if they exist, are left as is
     * @param node Node to remove
     */
    removeNode(node: Node) {
        this._list.delete(node);
    }

    /**
     * Performs transitive reduction on the graph.
     * For each node with multiple parents, removes edges from ancestors
     * that are reachable through other parents (keeping only closest parents).
     *
     *   Before:                     After:
     *
     *   ┌────────┐                  ┌────────┐
     *   │  Root  │                  │  Root  │
     *   └────────┘                  └────────┘
     *        │                           │
     *        ├───────────┐               │
     *        │           │               │
     *        ▼           │               ▼
     *   ┌────────┐       │          ┌────────┐
     *   │ Node A │       │          │ Node A │
     *   └────────┘       │          └────────┘
     *        │           │               │
     *        ▼           │               ▼
     *   ┌────────┐       │          ┌────────┐
     *   │ Node B │◄──────┘          │ Node B │
     *   └────────┘                  └────────┘
     *
     * @param nodesAreEqual Function to compare nodes for equality
     * @param nodeFilter Optional filter - only process nodes that return true
     */
    transitiveReduction(nodesAreEqual: (a: Node, b: Node) => boolean, nodeFilter?: (node: Node) => boolean): void {
        const nodes = this.getNodes();

        for (const node of nodes) {
            // Skip nodes that don't pass the filter
            if (nodeFilter && !nodeFilter(node)) {
                continue;
            }

            const parents = this.findParents(node);

            if (parents.length <= 1) {
                continue;
            }

            const parentsToRemove: Node[] = [];

            for (const parent of parents) {
                for (const otherParent of parents) {
                    if (nodesAreEqual(parent, otherParent)) {
                        continue;
                    }

                    // If parent can reach otherParent (parent is ancestor of otherParent),
                    // then parent → node is redundant because we have parent → ... → otherParent → node
                    if (this.nodeHasSharedAncestryTo(otherParent, parent)) {
                        parentsToRemove.push(parent);
                        break;
                    }
                }
            }

            // Remove redundant edges
            for (const parentToRemove of parentsToRemove) {
                const edges = this.getEdges(parentToRemove);
                const filteredEdges = edges.filter((e) => !nodesAreEqual(e, node));
                this.setEdges(parentToRemove, filteredEdges);
            }
        }
    }

    dfs(startNode: Node, itr: (node: Node) => boolean) {
        const edges = this.getEdges(startNode);
        edges.forEach((e) => {
            if (itr(e)) {
                this.dfs(e, itr);
            }
        });
    }

    /**
     * Detects a cycle in the graph and optionally fixes it by removing the edge causing the cycle
     * @param opts Fix the cycle by removing the edge causing the cycle
     * @returns The node and its parent that form the cycle
     */
    detectCycle(opts?: { fixCycle: boolean }): { node: Node; parent: Node | undefined } | undefined {
        const visited = new Set<Node>();
        const recStack = new Set<Node>();

        const dfs = (node: Node, parent: Node | undefined): { node: Node; parent: Node | undefined } | undefined => {
            if (recStack.has(node)) {
                if (opts?.fixCycle && parent !== undefined) {
                    // Remove the edge causing the cycle
                    const edges = this._list.get(parent);
                    if (edges) {
                        const index = edges.indexOf(node);
                        if (index > -1) {
                            edges.splice(index, 1);
                        }
                    }
                }
                return { node, parent }; // Cycle detected, return the node and its parent
            }
            if (visited.has(node)) {
                return undefined;
            }

            visited.add(node);
            recStack.add(node);

            const edges = this._list.get(node) || [];
            for (const edge of edges) {
                const cycleNode = dfs(edge, node);
                if (cycleNode) {
                    return cycleNode;
                }
            }

            recStack.delete(node);
            return undefined;
        };

        for (const node of this._list.keys()) {
            const cycleNode = dfs(node, undefined);
            if (cycleNode) {
                return cycleNode;
            }
        }

        return undefined;
    }

    /**
     * Fixes all cycles in the graph by removing the edges causing the cycles
     * @returns An array of nodes and their parents that form cycles
     */
    fixAllCycles(): { node: Node; parent: Node | undefined }[] {
        const cycleNodes: { node: Node; parent: Node | undefined }[] = [];
        let cycleNode: { node: Node; parent: Node | undefined } | undefined;

        do {
            cycleNode = this.detectCycle({ fixCycle: true });
            if (cycleNode) {
                cycleNodes.push(cycleNode);
            }
        } while (cycleNode);

        return cycleNodes;
    }

    static fromJson<Node>(json: GraphAsJson<Node>): Graph<Node> {
        const g = new Graph<Node>();
        const o = new GraphJsonObject(json);

        for (const [node, edges] of o) {
            g.addNode(node, edges);
        }

        return g;
    }

    static merge<Node>(graphs: Graph<Node>[]): Graph<Node> {
        const res = new Graph<Node>();
        graphs.forEach((g) => {
            g._list.forEach((v, k) => {
                res._list.set(k, v);
            });
        });
        return res;
    }

    debugGraphToString(getStr: (n: Node) => string) {
        const res: string[] = [];
        for (const k of this._list.keys()) {
            const v = this._list.get(k);
            if (!v) {
                continue;
            }

            const root = getStr(k);
            const children = v.map((v) => getStr(v));
            res.push(`${root} => ${children.join(', ')}`);
        }
        return res;
    }
}

class GraphIterator<Node> implements Iterator<[Node, Node[], number]> {
    _index = 0;
    _done = false;
    _graph: Graph<Node>;
    _nodes: Node[];

    constructor(graph: Graph<Node>) {
        this._graph = graph;
        this._nodes = graph.getNodes();
    }

    next(): IteratorResult<[Node, Node[], number], number | undefined> {
        if (this._done) {
            return {
                done: this._done,
                value: undefined,
            };
        }
        if (this._index === this._nodes.length) {
            this._done = true;
            return {
                done: this._done,
                value: this._index,
            };
        }
        const currentIndex = this._index;
        const node = this._nodes[currentIndex];
        const edges = this._graph.getEdges(node);
        this._index++;
        return {
            done: this._done,
            value: [node, edges, currentIndex],
        };
    }
}

class GraphJsonIterator<Node> implements Iterator<[Node, Node[]]> {
    _index = 0;
    _done = false;
    _graph: GraphAsJson<Node>;
    _nodes: Node[];

    constructor(graph: GraphAsJson<Node>) {
        this._graph = graph;
        this._nodes = Object.values(graph.nodes);
    }

    next(): IteratorResult<[Node, Node[]], number | undefined> {
        if (this._done) {
            return {
                done: this._done,
                value: undefined,
            };
        }
        if (this._index === this._nodes.length) {
            this._done = true;
            return {
                done: this._done,
                value: this._index,
            };
        }
        const node = this._nodes[this._index];
        const edgeIndexes = this._graph.edges[this._index.toString()];
        const edges = edgeIndexes.map((v) => this._graph.nodes[v]);

        this._index++;
        return {
            done: this._done,
            value: [node, edges],
        };
    }
}

class GraphJsonObject<Node> implements Iterable<[Node, Node[]]> {
    _graph: GraphAsJson<Node>;

    constructor(graph: GraphAsJson<Node>) {
        this._graph = graph;
    }

    [Symbol.iterator](): Iterator<[Node, Node[]]> {
        return new GraphJsonIterator(this._graph);
    }
}
