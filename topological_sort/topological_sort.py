"""
topological_sort.py

A comprehensive module containing implementations of Topological Sort and its variations
commonly used in LeetCode Hard and advanced graph algorithms.
"""

from collections import deque
import heapq
from typing import List, Tuple, Dict, Set, Optional

def kahns_topological_sort(num_nodes: int, edges: List[Tuple[int, int]]) -> List[int]:
    """
    Standard Kahn's Algorithm (BFS-based) for Topological Sort.
    
    Given num_nodes nodes (labeled 0 to num_nodes - 1) and a list of directed edges
    where edges[i] = (u, v) represents a dependency u -> v (u must come before v).
    
    Returns a valid topological ordering of nodes.
    If the graph contains a cycle, returns an empty list [].
    
    Time Complexity: O(V + E)
    Space Complexity: O(V + E)
    """
    # 1. Build adjacency list and calculate in-degrees
    adj = {i: [] for i in range(num_nodes)}
    in_degree = {i: 0 for i in range(num_nodes)}
    
    for u, v in edges:
        adj[u].append(v)
        in_degree[v] += 1
        
    # 2. Add all nodes with in-degree 0 to the queue
    queue = deque([node for node in range(num_nodes) if in_degree[node] == 0])
    topo_order = []
    
    # 3. Process the queue
    while queue:
        u = queue.popleft()
        topo_order.append(u)
        
        for v in adj[u]:
            in_degree[v] -= 1
            if in_degree[v] == 0:
                queue.append(v)
                
    # 4. If topo_order contains all nodes, we have a valid sort. Otherwise, there is a cycle.
    if len(topo_order) == num_nodes:
        return topo_order
    return []

def dfs_topological_sort(num_nodes: int, edges: List[Tuple[int, int]]) -> List[int]:
    """
    DFS-based Topological Sort using 3-state coloring for cycle detection.
    
    States:
      0 = UNVISITED
      1 = VISITING (currently in the recursion stack)
      2 = VISITED (fully processed)
      
    If a cycle is detected, returns an empty list [].
    
    Time Complexity: O(V + E)
    Space Complexity: O(V + E)
    """
    # 1. Build adjacency list
    adj = {i: [] for i in range(num_nodes)}
    for u, v in edges:
        adj[u].append(v)
        
    state = [0] * num_nodes
    topo_order = []
    has_cycle = False
    
    def dfs(u: int) -> bool:
        nonlocal has_cycle
        if has_cycle:
            return False
            
        state[u] = 1  # Mark as VISITING
        
        for v in adj[u]:
            if state[v] == 1:
                has_cycle = True
                return False
            elif state[v] == 0:
                if not dfs(v):
                    return False
                    
        state[u] = 2  # Mark as VISITED
        topo_order.append(u)
        return True

    # 2. Run DFS for all unvisited nodes
    for i in range(num_nodes):
        if state[i] == 0:
            if not dfs(i):
                return []
                
    # 3. The topological order is the reverse of the post-order list
    return topo_order[::-1]

def lexicographical_topological_sort(num_nodes: int, edges: List[Tuple[int, int]]) -> List[int]:
    """
    Kahn's Algorithm variation using a Min-Heap instead of a Queue.
    
    Guarantees the lexicographically smallest topological ordering.
    Useful for problems where tasks must be scheduled in numerical/alphabetical order
    whenever they have equal precedence.
    
    Returns the sorted list of nodes, or [] if a cycle is detected.
    
    Time Complexity: O(V log V + E log V)
    Space Complexity: O(V + E)
    """
    # 1. Build adjacency list and calculate in-degrees
    adj = {i: [] for i in range(num_nodes)}
    in_degree = {i: 0 for i in range(num_nodes)}
    
    for u, v in edges:
        adj[u].append(v)
        in_degree[v] += 1
        
    # 2. Store in-degree 0 nodes in a Min-Heap
    heap = [node for node in range(num_nodes) if in_degree[node] == 0]
    heapq.heapify(heap)
    
    topo_order = []
    
    # 3. Process the heap
    while heap:
        u = heapq.heappop(heap)
        topo_order.append(u)
        
        for v in adj[u]:
            in_degree[v] -= 1
            if in_degree[v] == 0:
                heapq.heappush(heap, v)
                
    # 4. Cycle detection
    if len(topo_order) == num_nodes:
        return topo_order
    return []

def alien_dictionary(words: List[str]) -> str:
    """
    LeetCode Hard Variation: Alien Dictionary.
    
    Given a list of words from an alien language sorted lexicographically,
    find the unique alphabetical order of characters.
    
    Returns the ordering as a string (e.g., "wertf").
    If the ordering is invalid or has cycles, returns "".
    
    Time Complexity: O(C) where C is the total number of characters in all words combined.
    Space Complexity: O(U + E) where U is unique characters (<= 26) and E is the dependencies.
    """
    if not words:
        return ""
        
    # 1. Initialize adjacency list and in-degrees for all unique characters
    adj: Dict[str, Set[str]] = {}
    in_degree: Dict[str, int] = {}
    
    for word in words:
        for char in word:
            if char not in adj:
                adj[char] = set()
                in_degree[char] = 0
                
    # 2. Build the graph by comparing adjacent words
    for i in range(len(words) - 1):
        w1, w2 = words[i], words[i+1]
        min_len = min(len(w1), len(w2))
        
        # Edge case: prefix check (e.g., "abc" comes before "ab" -> invalid)
        if len(w1) > len(w2) and w1[:min_len] == w2[:min_len]:
            return ""
            
        for j in range(min_len):
            if w1[j] != w2[j]:
                # Found the first mismatch
                if w2[j] not in adj[w1[j]]:
                    adj[w1[j]].add(w2[j])
                    in_degree[w2[j]] += 1
                break
                
    # 3. Kahn's Algorithm to find ordering (using Min-Heap for stable ordering, or regular deque)
    # Using a Min-Heap provides a deterministic, lexicographical order if multiple are valid
    heap = [char for char in in_degree if in_degree[char] == 0]
    heapq.heapify(heap)
    
    result = []
    
    while heap:
        char = heapq.heappop(heap)
        result.append(char)
        
        for neighbor in adj[char]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                heapq.heappush(heap, neighbor)
                
    # 4. Check if we visited all unique characters
    if len(result) == len(in_degree):
        return "".join(result)
    return ""

def parallel_courses(num_nodes: int, relations: List[Tuple[int, int]]) -> int:
    """
    LeetCode Hard Variation: Parallel Courses (level-by-level BFS).
    
    Given num_nodes courses labeled from 1 to num_nodes (1-indexed),
    and a list of relations where relations[i] = (prevCourse, nextCourse)
    representing that prevCourse must be completed before nextCourse.
    
    Return the minimum number of semesters needed to study all courses.
    If it is impossible to study all courses, return -1.
    
    Time Complexity: O(V + E)
    Space Complexity: O(V + E)
    """
    # 1. Build adjacency list and calculate in-degrees (1-indexed)
    adj = {i: [] for i in range(1, num_nodes + 1)}
    in_degree = {i: 0 for i in range(1, num_nodes + 1)}
    
    for u, v in relations:
        adj[u].append(v)
        in_degree[v] += 1
        
    # 2. Add in-degree 0 nodes to queue
    queue = deque([node for node in range(1, num_nodes + 1) if in_degree[node] == 0])
    
    semesters = 0
    visited_count = 0
    
    # 3. Level-by-level BFS
    while queue:
        level_size = len(queue)
        semesters += 1
        
        for _ in range(level_size):
            u = queue.popleft()
            visited_count += 1
            
            for v in adj[u]:
                in_degree[v] -= 1
                if in_degree[v] == 0:
                    queue.append(v)
                    
    # 4. Check if all courses were completed
    if visited_count == num_nodes:
        return semesters
    return -1

def longest_path_dag(num_nodes: int, edges: List[Tuple[int, int, int]]) -> Tuple[int, List[int]]:
    """
    Dynamic Programming on DAGs: Longest Path with path reconstruction.
    
    Given num_nodes vertices (labeled 0 to num_nodes - 1) and a list of weighted directed
    edges where edges[i] = (u, v, weight).
    
    Returns a tuple (max_path_length, path_nodes) representing the weight of the longest path
    and the sequence of vertices in that path.
    
    If the graph contains a cycle, raises ValueError.
    
    Time Complexity: O(V + E)
    Space Complexity: O(V + E)
    """
    # 1. Build graph & count in-degrees (without weights for topological sort)
    adj_with_weights = {i: [] for i in range(num_nodes)}
    topo_edges = []
    
    for u, v, w in edges:
        adj_with_weights[u].append((v, w))
        topo_edges.append((u, v))
        
    # 2. Get topological sort order
    topo_order = kahns_topological_sort(num_nodes, topo_edges)
    if not topo_order and num_nodes > 0 and edges:
        raise ValueError("Graph contains a cycle; cannot perform topological sort.")
        
    # If no edges, the longest path is 0 with a single node (or empty if num_nodes == 0)
    if num_nodes == 0:
        return 0, []
    if not edges:
        return 0, [0]
        
    # 3. Initialize DP arrays
    # dist[i] represents the length of the longest path ending at node i.
    # parent[i] tracks the predecessor node to reconstruct the path.
    dist = [0] * num_nodes
    parent = [-1] * num_nodes
    
    # 4. Relax edges in topological order
    for u in topo_order:
        for v, w in adj_with_weights[u]:
            if dist[v] < dist[u] + w:
                dist[v] = dist[u] + w
                parent[v] = u
                
    # 5. Find the node with the maximum distance
    max_len = max(dist)
    end_node = dist.index(max_len)
    
    # 6. Reconstruct the path backwards
    path = []
    curr = end_node
    while curr != -1:
        path.append(curr)
        curr = parent[curr]
    path.reverse()
    
    return max_len, path
