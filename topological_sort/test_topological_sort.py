"""
test_topological_sort.py

Unit tests for topological sort algorithms and variations.
Run with: python -m unittest topological_sort/test_topological_sort.py
"""

import unittest
from topological_sort.topological_sort import (
    kahns_topological_sort,
    dfs_topological_sort,
    lexicographical_topological_sort,
    alien_dictionary,
    parallel_courses,
    longest_path_dag
)

class TestTopologicalSorts(unittest.TestCase):

    def _is_valid_topological_sort(self, num_nodes: int, edges: list[tuple[int, int]], order: list[int]) -> bool:
        """Helper to verify if a given order is a valid topological sort."""
        if len(order) != num_nodes:
            return False
        # Create a mapping from node to its position in the topological order
        pos = {node: idx for idx, node in enumerate(order)}
        if len(pos) != num_nodes:
            return False
        # Every edge u -> v must satisfy pos[u] < pos[v]
        for u, v in edges:
            if u not in pos or v not in pos or pos[u] >= pos[v]:
                return False
        return True

    def test_kahns_basic_dag(self):
        num_nodes = 4
        edges = [(0, 1), (1, 2), (2, 3), (0, 2)]
        order = kahns_topological_sort(num_nodes, edges)
        self.assertTrue(self._is_valid_topological_sort(num_nodes, edges, order))

    def test_kahns_cycle(self):
        num_nodes = 3
        edges = [(0, 1), (1, 2), (2, 0)]
        order = kahns_topological_sort(num_nodes, edges)
        self.assertEqual(order, [])

    def test_kahns_disconnected(self):
        num_nodes = 4
        edges = [(0, 1), (2, 3)]
        order = kahns_topological_sort(num_nodes, edges)
        self.assertTrue(self._is_valid_topological_sort(num_nodes, edges, order))

    def test_dfs_basic_dag(self):
        num_nodes = 4
        edges = [(0, 1), (1, 2), (2, 3), (0, 2)]
        order = dfs_topological_sort(num_nodes, edges)
        self.assertTrue(self._is_valid_topological_sort(num_nodes, edges, order))

    def test_dfs_cycle(self):
        num_nodes = 3
        edges = [(0, 1), (1, 2), (2, 0)]
        order = dfs_topological_sort(num_nodes, edges)
        self.assertEqual(order, [])

    def test_dfs_disconnected(self):
        num_nodes = 4
        edges = [(0, 1), (2, 3)]
        order = dfs_topological_sort(num_nodes, edges)
        self.assertTrue(self._is_valid_topological_sort(num_nodes, edges, order))

    def test_lexicographical_sort(self):
        # Without edges, output should be lexicographically sorted [0, 1, 2, 3]
        num_nodes = 4
        edges = []
        order = lexicographical_topological_sort(num_nodes, edges)
        self.assertEqual(order, [0, 1, 2, 3])

        # DAG with choices: 0->2, 1->2, 2->3. Nodes 0 and 1 have in-degree 0.
        # Min-heap will pop 0 first, then 1, then 2, then 3.
        num_nodes = 4
        edges = [(0, 2), (1, 2), (2, 3)]
        order = lexicographical_topological_sort(num_nodes, edges)
        self.assertEqual(order, [0, 1, 2, 3])

        # Cycle should still return []
        num_nodes = 3
        edges = [(0, 1), (1, 2), (2, 0)]
        self.assertEqual(lexicographical_topological_sort(num_nodes, edges), [])

    def test_alien_dictionary_valid(self):
        words = ["wrt", "wrf", "er", "ett", "rftt"]
        # In this dictionary, we have:
        # 't' -> 'f' (from "wrt" and "wrf")
        # 'w' -> 'e' (from "wrt" and "er")
        # 'r' -> 't' (from "er" and "ett")
        # 'e' -> 'r' (from "ett" and "rftt")
        # Combined order: w -> e -> r -> t -> f
        order = alien_dictionary(words)
        self.assertEqual(order, "wertf")

    def test_alien_dictionary_cycle(self):
        words = ["z", "x", "z"]
        # z -> x, and x -> z is a cycle
        order = alien_dictionary(words)
        self.assertEqual(order, "")

    def test_alien_dictionary_prefix_invalid(self):
        words = ["abc", "ab"]
        # Prefix mismatch: "abc" cannot come before "ab" if they are sorted lexicographically
        order = alien_dictionary(words)
        self.assertEqual(order, "")

    def test_alien_dictionary_single_word(self):
        words = ["z"]
        self.assertEqual(alien_dictionary(words), "z")

    def test_parallel_courses_valid(self):
        # 1-indexed courses: 1, 2, 3
        # 1->3, 2->3. Semesters required:
        # Semester 1: Course 1 and 2
        # Semester 2: Course 3
        num_nodes = 3
        relations = [(1, 3), (2, 3)]
        self.assertEqual(parallel_courses(num_nodes, relations), 2)

        # Chain: 1->2, 2->3. Semesters required: 3
        num_nodes = 3
        relations = [(1, 2), (2, 3)]
        self.assertEqual(parallel_courses(num_nodes, relations), 3)

    def test_parallel_courses_cycle(self):
        num_nodes = 3
        relations = [(1, 2), (2, 3), (3, 1)]
        self.assertEqual(parallel_courses(num_nodes, relations), -1)

    def test_longest_path_dag_valid(self):
        # Graph: 0 -> 1 (w=5), 1 -> 2 (w=10), 0 -> 2 (w=2)
        # Paths:
        # 0 -> 1 -> 2: length = 15
        # 0 -> 2: length = 2
        # Longest path: 15, path: [0, 1, 2]
        num_nodes = 3
        edges = [(0, 1, 5), (1, 2, 10), (0, 2, 2)]
        length, path = longest_path_dag(num_nodes, edges)
        self.assertEqual(length, 15)
        self.assertEqual(path, [0, 1, 2])

    def test_longest_path_dag_single_node(self):
        num_nodes = 1
        edges = []
        length, path = longest_path_dag(num_nodes, edges)
        self.assertEqual(length, 0)
        self.assertEqual(path, [0])

    def test_longest_path_dag_cycle(self):
        num_nodes = 3
        edges = [(0, 1, 5), (1, 2, 10), (2, 0, 1)]
        with self.assertRaises(ValueError):
            longest_path_dag(num_nodes, edges)

if __name__ == "__main__":
    unittest.main()
