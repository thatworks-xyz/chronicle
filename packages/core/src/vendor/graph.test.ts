import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Graph, GraphAsJson } from './graph.js';

interface Data {
    id: string;
    parentId: string | undefined;
    score?: number;
}

function makeGraph(data: Data[]) {
    const map = data.reduce<Map<string, Data>>((p, c) => p.set(c.id, c), new Map());

    const g = new Graph<Data>();
    map.forEach((v) => {
        g.addNode(v);
    });

    g.getNodes().forEach((v) => {
        if (v.parentId) {
            const parent = map.get(v.parentId);
            if (parent) {
                g.addEdge(parent, v);
            }
        }
    });

    return g;
}

describe('Graph', () => {
    it('Returns expected relationships', () => {
        const data: Data[] = [
            { id: `0`, parentId: undefined },
            { id: `1`, parentId: undefined },
            { id: `2`, parentId: `1` },
            { id: `3`, parentId: `2` },
            { id: `4`, parentId: `0` },
            { id: `5`, parentId: `4` },
        ];

        const expectedEdges = [1, 1, 1, 0, 1, 0];

        const g = makeGraph(data);
        assert.equal(g.getNodes().length, data.length);
        for (const [, e, i] of g) {
            assert.equal(expectedEdges[i], e.length);
        }
    });

    it('Returns correct root', () => {
        const data: Data[] = [
            { id: `0`, parentId: undefined },
            { id: `1`, parentId: `0` },
            { id: `2`, parentId: `1` },
            { id: `3`, parentId: `2` },
            { id: `4`, parentId: `3` },
            { id: `5`, parentId: `4` },
        ];

        const g = makeGraph(data);
        const nodes = g.getNodes();
        assert.equal(g.getRootNode(nodes[5]).id, data[0].id);
        assert.equal(g.getRootNode(nodes[0]).id, data[0].id);
    });

    it('Converts to json and back', () => {
        const data: Data[] = [
            { id: `0`, parentId: undefined },
            { id: `1`, parentId: `0` },
            { id: `2`, parentId: `1` },
            { id: `3`, parentId: `2` },
            { id: `4`, parentId: `3` },
            { id: `5`, parentId: `4` },
        ];

        const g1 = makeGraph(data);
        const json = JSON.stringify(g1.getJson());
        const jsonObj: GraphAsJson<Data> = JSON.parse(json);
        const g2 = Graph.fromJson<Data>(jsonObj);

        assert.equal(g1.getNodes().length, g2.getNodes().length);
        g1.getNodes().forEach((n, i) => {
            const g2Node = g2.getNodes()[i];
            assert.equal(g1.getEdges(n).length, g2.getEdges(g2Node).length);
        });
    });

    it('Converts to json with sorting', () => {
        const data: Data[] = [
            { id: `0`, parentId: undefined, score: 0.2 },
            { id: `1`, parentId: `0`, score: 0.2 },
            { id: `2`, parentId: `0`, score: 0.7 },
            { id: `3`, parentId: `0`, score: 0.5 },
            { id: `4`, parentId: `0`, score: 0.3 },
            { id: `5`, parentId: `0`, score: 0.1 },
            { id: `10`, parentId: undefined, score: 0.6 },
            { id: `11`, parentId: `10`, score: 0.3 },
            { id: `12`, parentId: `10`, score: 0.1 },
            { id: `13`, parentId: `10`, score: 0.6 },
            { id: `20`, parentId: undefined, score: 0.3 },
        ];

        const g1 = makeGraph(data);
        const json = JSON.stringify(
            g1.getJson((a, b) => {
                if (!a.score || !b.score) {
                    return 0;
                }
                if (a.score > b.score) {
                    return -1;
                }
                if (a.score < b.score) {
                    return 1;
                }
                return 0;
            }),
        );
        const jsonObj: GraphAsJson<Data> = JSON.parse(json);
        const g2 = Graph.fromJson<Data>(jsonObj);
        const roots = jsonObj.roots;
        assert.equal(roots.length, 3);

        const expectedRootIds = ['10', '20', '0'];
        expectedRootIds.forEach((expected, i) => assert.equal(expected, jsonObj.nodes[roots[i]].id));

        const rootToTest = g2.getGraphRoots().find((v) => v.id === '0');
        if (!rootToTest) {
            assert(rootToTest);
        }

        const sortedEdgeIds = g2.getEdges(rootToTest).map((v) => v.id);
        const expectedEdgeIds = ['2', '3', '4', '1', '5'];

        expectedEdgeIds.forEach((expected, i) => assert.equal(expected, sortedEdgeIds[i]));
    });

    it('bfs', () => {
        const data: Data[] = [
            { id: `0`, parentId: undefined },
            { id: `1`, parentId: `0` },
            { id: `4`, parentId: `2` },
            { id: `2`, parentId: `1` },
            { id: `6`, parentId: `3` },
            { id: `3`, parentId: `1` },
            { id: `5`, parentId: `2` },
        ];

        const res: { node: Data; level: number; parent: Data | undefined }[] = [];
        const g = makeGraph(data);
        const roots = g.getGraphRoots();
        assert.equal(roots.length, 1);
        assert.equal(roots[0].id, '0');
        g.bfs(roots[0], (n, level, parent) => {
            res.push({ node: n, level, parent });
        });

        assert.equal(res.length, data.length);
        const expectedLevels = [0, 1, 2, 2, 3, 3, 3];
        const expectedParents = [undefined, `0`, `1`, `1`, `2`, `2`, `3`];
        res.forEach((v, i) => {
            assert.equal(v.level, expectedLevels[i]);
            assert.equal(v.parent?.id, expectedParents[i], `Failed on ${i}`);
        });
    });

    it('gets nodes per level', () => {
        const data: Data[] = [
            { id: `0`, parentId: undefined },
            { id: `1`, parentId: `0` },
            { id: `4`, parentId: `2` },
            { id: `2`, parentId: `1` },
            { id: `6`, parentId: `3` },
            { id: `3`, parentId: `1` },
            { id: `5`, parentId: `2` },
        ];

        const g = makeGraph(data);
        const roots = g.getGraphRoots();
        assert.equal(roots.length, 1);
        assert.equal(roots[0].id, '0');

        const nodesPerLevel = g.getNodesPerLevel(roots[0]);
        assert.equal(nodesPerLevel.length, 4);
        const expectedNodesPerLevel = [1, 1, 2, 3];
        nodesPerLevel.forEach((v, i) => {
            assert.equal(v.length, expectedNodesPerLevel[i]);
        });
    });

    it('dfs', () => {
        const data: Data[] = [
            { id: `0`, parentId: undefined },
            { id: `1`, parentId: `0` },
            { id: `2`, parentId: `1` },
            { id: `3`, parentId: `2` },
            { id: `4`, parentId: `3` },
            { id: `5`, parentId: `4` },
        ];

        const g = makeGraph(data);
        const dfsRes: Data[] = [];
        g.dfs(g.getGraphRoots()[0], (n) => {
            dfsRes.push(n);
            return true;
        });
        const expected = ['1', '2', '3', '4', '5'];
        assert.equal(dfsRes.length, expected.length);
        dfsRes.forEach((d, i) => assert.equal(d.id, expected[i]));
    });

    it('removes node and children (dfs only)', () => {
        const data: Data[] = [
            { id: `0`, parentId: undefined },
            { id: `1`, parentId: `0` },
            { id: `2`, parentId: `1` },
            { id: `3`, parentId: `2` },
            { id: `4`, parentId: `3` },
            { id: `5`, parentId: `4` },
            { id: `6`, parentId: `3` },
        ];

        const g = makeGraph(data);
        const nodeToRemove = g.getNodes()[4];
        g.removeNodeAndChildrenDfsOnly(nodeToRemove, (a, b) => a.id === b.id);

        const dfsRes: Data[] = [];
        g.dfs(g.getGraphRoots()[0], (n) => {
            dfsRes.push(n);
            return true;
        });
        const expected = ['1', '2', '3', '6'];
        assert.equal(dfsRes.length, expected.length);
        dfsRes.forEach((d, i) => assert.equal(d.id, expected[i]));

        // confirm it isn't existing as a dangled edge
        for (const e of g.getEdges(g.getGraphRoots()[0])) {
            assert.notEqual(e.id, nodeToRemove.id);
        }
    });

    it('finds parent', () => {
        const data: Data[] = [
            { id: `0`, parentId: undefined },
            { id: `1`, parentId: `0` },
            { id: `2`, parentId: `1` },
            { id: `3`, parentId: `2` },
        ];

        const g = makeGraph(data);
        let parents = g.findParents(data[2]);
        assert.equal(parents[0].id, '1');

        parents = g.findParents(data[0]);
        assert.equal(parents.length, 0);
    });

    it('returns height from root to tip', () => {
        const data: Data[] = [
            { id: `0`, parentId: undefined },
            { id: `1`, parentId: `0` },
            { id: `2`, parentId: `1` },
            { id: `3`, parentId: `2` },
        ];

        const g = makeGraph(data);
        assert.equal(g.getNumLevelsToTip(data[1]), 2);
    });

    it('merges two graphs', () => {
        const data1: Data[] = [
            { id: `0`, parentId: undefined },
            { id: `1`, parentId: `0` },
            { id: `2`, parentId: `1` },
            { id: `3`, parentId: `2` },
        ];

        const data2: Data[] = [
            { id: `4`, parentId: undefined },
            { id: `5`, parentId: `4` },
            { id: `6`, parentId: `5` },
        ];

        const g1 = makeGraph(data1);
        const g2 = makeGraph(data2);

        const merged = Graph.merge<Data>([g1, g2]);
        assert.equal(merged.getNodes().length, data1.length + data2.length);

        const mergedRoots = merged.getGraphRoots();
        assert.equal(mergedRoots.length, 2);
        assert.equal(merged.getNumLevelsToTip(mergedRoots[0]), 3);
        assert.equal(merged.getNumLevelsToTip(mergedRoots[1]), 2);
    });

    it('detect no cycle', () => {
        const data: Data[] = [
            { id: `0`, parentId: undefined },
            { id: `1`, parentId: `0` },
            { id: `2`, parentId: `1` },
        ];

        const g = makeGraph(data);
        assert.equal(g.detectCycle(), undefined);
    });

    it('detect cycle', () => {
        const data: Data[] = [
            { id: `1`, parentId: `2` },
            { id: `2`, parentId: `1` },
        ];

        const g = makeGraph(data);
        const c = g.detectCycle();
        assert.notEqual(c, undefined);
        assert.equal(c?.node.id, '1');
        assert.equal(c?.parent?.id, '2');
    });

    it('detect and fix cycle', () => {
        const data: Data[] = [
            { id: `1`, parentId: `2` },
            { id: `2`, parentId: `1` },
        ];

        const g = makeGraph(data);
        const c = g.detectCycle({ fixCycle: true });
        assert.notEqual(c, undefined);
        assert.equal(c?.node.id, '1');
        assert.equal(c?.parent?.id, '2');
        assert.equal(g.detectCycle(), undefined);
    });

    it('detects cycle in a graph with multiple roots', () => {
        const data: Data[] = [
            { id: `1`, parentId: `2` },
            { id: `2`, parentId: `1` },
            { id: `3`, parentId: undefined },
            { id: `4`, parentId: `3` },
        ];

        const g = makeGraph(data);
        const c = g.detectCycle();
        assert.notEqual(c, undefined);
        assert.equal(c?.node.id, '1');
        assert.equal(c?.parent?.id, '2');
    });

    it('detects cycle in a graph with multiple roots and fixes it', () => {
        const data: Data[] = [
            { id: `1`, parentId: `2` },
            { id: `2`, parentId: `1` },
            { id: `3`, parentId: undefined },
            { id: `4`, parentId: `3` },
        ];

        const g = makeGraph(data);
        const c = g.detectCycle({ fixCycle: true });
        assert.notEqual(c, undefined);
        assert.equal(c?.node.id, '1');
        assert.equal(c?.parent?.id, '2');
        assert.equal(g.detectCycle(), undefined);
    });

    it('detects and fixes multiple cycles', () => {
        const data: Data[] = [
            { id: `1`, parentId: `2` },
            { id: `2`, parentId: `1` },
            { id: `3`, parentId: `4` },
            { id: `4`, parentId: `3` },
        ];
        const g = makeGraph(data);
        const cycleNodes = g.fixAllCycles();
        assert.equal(cycleNodes.length, 2);
    });

    it('does not remove children: shared ancestry', () => {
        const data: Data[] = [
            { id: `1`, parentId: `2` },
            { id: `2`, parentId: `3` },
            { id: `3`, parentId: undefined },
            { id: `4`, parentId: `5` },
            { id: `5`, parentId: `3` },
        ];
        const g = makeGraph(data);
        const roots = g.getGraphRoots();
        g.removeNodesWithoutSharedAncestryTo([roots[0]]);
        const expectedTopography = ['1 => ', '2 => 1', '3 => 2, 5', '4 => ', '5 => 4'];
        const res = g.debugGraphToString((n) => n.id);
        assert.ok(res.length > 0);
        res.forEach((v, i) => assert.equal(v, expectedTopography[i]));
    });

    it('does not remove children: shared ancestry, deeper hierarchy', () => {
        const data: Data[] = [
            { id: `1`, parentId: `2` },
            { id: `2`, parentId: `3` },
            { id: `3`, parentId: undefined },
            { id: `4`, parentId: `5` },
            { id: `5`, parentId: `2` },
        ];
        const g = makeGraph(data);
        const roots = g.getGraphRoots();
        g.removeNodesWithoutSharedAncestryTo([roots[0]]);
        const expectedTopography = ['1 => ', '2 => 1, 5', '3 => 2', '4 => ', '5 => 4'];
        const res = g.debugGraphToString((n) => n.id);
        assert.ok(res.length > 0);
        res.forEach((v, i) => assert.equal(v, expectedTopography[i]));
    });

    it('removes children: shared ancestry', () => {
        const data = [
            { id: `1`, parents: [`2`] },
            { id: `2`, parents: [`3`] },
            { id: `3`, parents: undefined },
            { id: `4`, parents: [`5`] },
            { id: `5`, parents: [`2`, '6'] },
            { id: `6`, parents: [`7`] },
            { id: `7`, parents: undefined },
        ];

        const map = data.reduce<Map<string, (typeof data)[number]>>((p, c) => p.set(c.id, c), new Map());
        const g = new Graph<(typeof data)[number]>();
        map.forEach((v) => {
            g.addNode(v);
        });

        g.getNodes().forEach((v) => {
            if (v.parents) {
                v.parents.forEach((parentId) => {
                    const parent = map.get(parentId);
                    if (parent) {
                        g.addEdge(parent, v);
                    }
                });
            }
        });

        const roots = g.getGraphRoots();
        g.removeNodesWithoutSharedAncestryTo([roots[0]]);
        const expectedTopography = ['1 => ', '2 => 1, 5', '3 => 2', '4 => ', '5 => 4'];
        const res = g.debugGraphToString((n) => n.id);
        assert.ok(res.length > 0);
        res.forEach((v, i) => assert.equal(v, expectedTopography[i]));
    });

    it('removes children: shared ancestry, multiple roots', () => {
        const data = [
            { id: `1`, parents: [`2`] },
            { id: `2`, parents: [`3`] },
            { id: `3`, parents: undefined },
            { id: `4`, parents: [`5`] },
            { id: `5`, parents: [`2`, '6'] },
            { id: `6`, parents: [`7`] },
            { id: `7`, parents: undefined },
            { id: 'a', parents: ['b'] },
            { id: 'b', parents: ['c'] },
            { id: 'c', parents: undefined },
        ];

        const map = data.reduce<Map<string, (typeof data)[number]>>((p, c) => p.set(c.id, c), new Map());
        const g = new Graph<(typeof data)[number]>();
        map.forEach((v) => {
            g.addNode(v);
        });

        g.getNodes().forEach((v) => {
            if (v.parents) {
                v.parents.forEach((parentId) => {
                    const parent = map.get(parentId);
                    if (parent) {
                        g.addEdge(parent, v);
                    }
                });
            }
        });

        const roots = g.getGraphRoots();
        g.removeNodesWithoutSharedAncestryTo([roots[0], roots[2]]);
        const expectedTopography = ['1 => ', '2 => 1, 5', '3 => 2', '4 => ', '5 => 4', 'a => ', 'b => a', 'c => b'];
        const res = g.debugGraphToString((n) => n.id);
        assert.ok(res.length > 0);
        res.forEach((v, i) => assert.equal(v, expectedTopography[i]));
    });

    it('flattens deep hierarchies to root node', () => {
        const data = [
            { id: `1`, parents: [`2`] },
            { id: `2`, parents: [`3`] },
            { id: `3`, parents: undefined },
            { id: `4`, parents: [`5`] },
            { id: `5`, parents: [`2`, '6'] },
            { id: `6`, parents: [`7`] },
            { id: `7`, parents: undefined },
            { id: 'a', parents: ['b'] },
            { id: 'b', parents: ['c'] },
            { id: 'c', parents: undefined },
        ];

        const map = data.reduce<Map<string, (typeof data)[number]>>((p, c) => p.set(c.id, c), new Map());
        const g = new Graph<(typeof data)[number]>();
        map.forEach((v) => {
            g.addNode(v);
        });

        g.getNodes().forEach((v) => {
            if (v.parents) {
                v.parents.forEach((parentId) => {
                    const parent = map.get(parentId);
                    if (parent) {
                        g.addEdge(parent, v);
                    }
                });
            }
        });

        g.flattenToRootNodes();
        const expectedTopography = [
            '1 => ',
            '2 => ',
            '3 => 2, 1, 5, 4',
            '4 => ',
            '5 => ',
            '6 => ',
            '7 => 6, 5, 4',
            'a => ',
            'b => ',
            'c => b, a',
        ];
        const res = g.debugGraphToString((n) => n.id);
        assert.ok(res.length > 0);
        res.forEach((v, i) => assert.equal(v, expectedTopography[i]));
    });

    it('removes nodes and transfers children to parent', () => {
        const data: Data[] = [
            { id: `1`, parentId: `2` },
            { id: `2`, parentId: `3` },
            { id: `3`, parentId: undefined },
            { id: `4`, parentId: `5` },
            { id: `5`, parentId: `3` },
        ];
        const g = makeGraph(data);
        const roots = g.getGraphRoots();

        g.removeNodesAndTransferChildrenToParentBfs(roots[0], (n) => n.id === '2' || n.id === '5');
        const expectedTopography = ['1 => ', '3 => 1, 4', '4 => '];
        const res = g.debugGraphToString((n) => n.id);
        assert.ok(res.length > 0);
        res.forEach((v, i) => assert.equal(v, expectedTopography[i]));
    });

    describe('transitiveReduction', () => {
        interface MultiParentData {
            id: string;
            parents: string[] | undefined;
            connector?: string;
        }

        function makeGraphWithMultipleParents(data: MultiParentData[]) {
            const map = data.reduce<Map<string, MultiParentData>>((p, c) => p.set(c.id, c), new Map());
            const g = new Graph<MultiParentData>();
            map.forEach((v) => {
                g.addNode(v);
            });

            g.getNodes().forEach((v) => {
                if (v.parents) {
                    v.parents.forEach((parentId) => {
                        const parent = map.get(parentId);
                        if (parent) {
                            g.addEdge(parent, v);
                        }
                    });
                }
            });

            return g;
        }

        it('removes redundant edge when parent is ancestor of another parent', () => {
            // Node B has parents [Root, A], A has parent [Root]
            // Edge Root -> B should be removed
            const data: MultiParentData[] = [
                { id: 'Root', parents: undefined },
                { id: 'A', parents: ['Root'] },
                { id: 'B', parents: ['Root', 'A'] },
            ];

            const g = makeGraphWithMultipleParents(data);

            // Before reduction: Root -> A, Root -> B, A -> B
            assert.equal(g.findParents(data[2]).length, 2);

            g.transitiveReduction((a, b) => a.id === b.id);

            // After reduction: Root -> A, A -> B (Root -> B removed)
            const bParents = g.findParents(data[2]);
            assert.equal(bParents.length, 1);
            assert.equal(bParents[0].id, 'A');

            // Root should only have A as child now
            const rootEdges = g.getEdges(data[0]);
            assert.equal(rootEdges.length, 1);
            assert.equal(rootEdges[0].id, 'A');
        });

        it('preserves edges in diamond pattern when neither parent is ancestor of other', () => {
            // A -> B, A -> C, B -> D, C -> D
            // Both B->D and C->D should be kept (neither B nor C is ancestor of the other)
            const data: MultiParentData[] = [
                { id: 'A', parents: undefined },
                { id: 'B', parents: ['A'] },
                { id: 'C', parents: ['A'] },
                { id: 'D', parents: ['B', 'C'] },
            ];

            const g = makeGraphWithMultipleParents(data);
            g.transitiveReduction((a, b) => a.id === b.id);

            const dParents = g.findParents(data[3]);
            assert.equal(dParents.length, 2);
        });

        it('handles deep hierarchies correctly', () => {
            // Root -> A -> B -> C, and Root -> C
            // Edge Root -> C should be removed
            const data: MultiParentData[] = [
                { id: 'Root', parents: undefined },
                { id: 'A', parents: ['Root'] },
                { id: 'B', parents: ['A'] },
                { id: 'C', parents: ['Root', 'B'] },
            ];

            const g = makeGraphWithMultipleParents(data);
            g.transitiveReduction((a, b) => a.id === b.id);

            const cParents = g.findParents(data[3]);
            assert.equal(cParents.length, 1);
            assert.equal(cParents[0].id, 'B');
        });

        it('does nothing for nodes with single parent', () => {
            const data: MultiParentData[] = [
                { id: 'Root', parents: undefined },
                { id: 'A', parents: ['Root'] },
                { id: 'B', parents: ['A'] },
            ];

            const g = makeGraphWithMultipleParents(data);
            const beforeEdges = g.debugGraphToString((n) => n.id);
            g.transitiveReduction((a, b) => a.id === b.id);
            const afterEdges = g.debugGraphToString((n) => n.id);

            assert.deepEqual(beforeEdges, afterEdges);
        });

        it('only applies to nodes matching the filter', () => {
            // Two nodes with multiple parents, but only one matches the filter
            const data: MultiParentData[] = [
                { id: 'Root', parents: undefined, connector: 'jira' },
                { id: 'A', parents: ['Root'], connector: 'jira' },
                { id: 'B', parents: ['Root', 'A'], connector: 'jira' }, // Should NOT be reduced (filter excludes)
                { id: 'C', parents: ['Root', 'A'], connector: 'notion' }, // Should be reduced (filter includes)
            ];

            const g = makeGraphWithMultipleParents(data);

            g.transitiveReduction(
                (a, b) => a.id === b.id,
                (node) => node.connector === 'notion',
            );

            // B should still have two parents (not reduced)
            const bParents = g.findParents(data[2]);
            assert.equal(bParents.length, 2);

            // C should have only one parent (reduced)
            const cParents = g.findParents(data[3]);
            assert.equal(cParents.length, 1);
            assert.equal(cParents[0].id, 'A');
        });

        it('handles multiple redundant parents correctly', () => {
            // Root -> A -> B -> C, and Root -> C, A -> C
            // Edges Root -> C and A -> C should be removed, only B -> C kept
            const data: MultiParentData[] = [
                { id: 'Root', parents: undefined },
                { id: 'A', parents: ['Root'] },
                { id: 'B', parents: ['A'] },
                { id: 'C', parents: ['Root', 'A', 'B'] },
            ];

            const g = makeGraphWithMultipleParents(data);
            g.transitiveReduction((a, b) => a.id === b.id);

            const cParents = g.findParents(data[3]);
            assert.equal(cParents.length, 1);
            assert.equal(cParents[0].id, 'B');
        });
    });
});
