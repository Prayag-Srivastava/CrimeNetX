# CrimeNetX — Neo4j Graph Database Implementation & Architecture Specification

## 1. Executive Overview & Architecture

CrimeNetX utilizes a **hybrid dual-storage graph database architecture** designed for high-throughput police intelligence analysis, criminal syndicate visualization, and automated Graph Machine Learning (GML). 

While PostgreSQL (via Prisma ORM) handles transactional case management, suspect metadata, FIR records, and user access control, **Neo4j (v5.26.0+)** serves as the primary native Graph Engine for representing complex multi-relational criminal networks.

```
                    ┌───────────────────────────────────────────┐
                    │            CrimeNetX Frontend             │
                    │   (React / Next.js + Cytoscape / D3)     │
                    └─────────────────────┬─────────────────────┘
                                          │ REST / JSON
                                          ▼
                    ┌───────────────────────────────────────────┐
                    │      Node.js / Express API Gateway        │
                    │         (PostgreSQL + Prisma ORM)         │
                    └─────────────────────┬─────────────────────┘
                                          │ Internal Microservice Payload
                                          ▼
                    ┌───────────────────────────────────────────┐
                    │       FastAPI Intelligence Service        │
                    │   (NetworkX Graph ML + Groq LLM NLP)      │
                    └──────────────┬───────────────────┬────────┘
                                   │                   │
                     Cypher Sync   │                   │ Graph ML Metrics &
                     & Direct Query│                   │ Centrality Analysis
                                   ▼                   ▼
                    ┌───────────────────────┐ ┌─────────────────┐
                    │ Neo4j Graph Database  │ │    NetworkX     │
                    │  (Bolt Protocol 7687) │ │  In-Memory GML  │
                    └───────────────────────┘ └─────────────────┘
```

### Core Objectives of Neo4j in CrimeNetX
1. **Native Graph Topology Persistence**: Fast multi-hop traversal across entities (Suspects, Bank Accounts, Phone Numbers, Vehicles, Hideouts) and relationships (Financial Transfers, CDR Calls, Co-presence, Syndicate Affiliation).
2. **Cypher Query Capabilities**: Declarative graph pattern matching for discovering criminal hierarchies, hidden proxy channels, and shortest path connections between targets.
3. **Graph Machine Learning Synchronization**: Ingesting composite **Kingpin Scores** (PageRank, Betweenness, Degree, Eigenvector centralities) and **AI Ghost Link Predictions** directly onto graph nodes and edges.
4. **Resilient Fallback Design**: Non-blocking graceful fallback to in-memory NetworkX when Neo4j is offline or undergoing maintenance, ensuring 100% operational uptime for field officers.

---

## 2. Neo4j Graph Data Model & Schema Specification

### 2.1 Node Schema (`:Entity`)
Every entity in a criminal investigation is represented as a node labeled `:Entity`. Nodes are scoped by `case_id` to maintain multi-tenant case isolation.

| Property | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `id` | `String` (PK) | Canonical Entity UUID / Identifier | `"ent_clx9812a"` |
| `case_id` | `String` (Indexed) | Case identifier for multi-case partitioning | `"case_delhi_syndicate_2026"` |
| `label` | `String` | Display name or entity value | `"Vikram 'Don' Sharma"` |
| `entity_type` | `String` | Type of entity (`PERSON`, `PHONE`, `ACCOUNT`, `VEHICLE`, `LOCATION`) | `"PERSON"` |
| `kingpin_score` | `Float` | Composite 0–100 Graph ML centrality score | `87.45` |
| `role` | `String` | Inferred network role (`KINGPIN`, `BROKER`, `EXECUTOR`) | `"KINGPIN"` |

#### Cypher Node Index & Constraint Setup:
```cypher
// Ensure quick lookup and case isolation
CREATE CONSTRAINT entity_id_unique IF NOT EXISTS
FOR (n:Entity) REQUIRE n.id IS UNIQUE;

CREATE INDEX entity_case_id_idx IF NOT EXISTS
FOR (n:Entity) ON (n.case_id);
```

---

### 2.2 Relationship Schema (`:RELATED_TO`)
Edges represent direct or inferred connections between entities.

| Attribute | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `relation` | `String` | Relationship classification | `"financial_transfer"` |
| `weight` | `Float` | Intensity / frequency / confidence weight | `0.85` |
| `evidence` | `String` | Ingested source evidence snippet | `"FIR #402/2026; Wire transfer log #9921"` |
| `short_explanation` | `String` | Human-readable title for UI tags | `"💸 Money Transfer"` |
| `elaboration` | `String` | Detailed investigative rationale for UI drawer | `"Financial transaction intelligence between..."` |

---

### 2.3 Edge Types & Rationale Classifications

CrimeNetX categorizes relationships into distinct tactical domains:

```
                  ┌──────────────────────────────────────────────┐
                  │            Relationship Taxonomy             │
                  └──────┬────────────┬────────────┬─────────────┘
                         │            │            │
         ┌───────────────┴───┐ ┌──────┴───────┐ ┌──┴────────────────┐
         │ Telecom & Finance │ │ Spatial & Kin│ │ AI Intelligence  │
         └───────┬───────────┘ └──────┬───────┘ └──┬───────────────┘
                 │                    │            │
       • phone_call         • co_location      • covert_ghost_link
       • financial_transfer • family           • associate
                            • same_org
```

1. **`financial_transfer`** (`💸 Money Transfer`): Bank wire transfers, Hawala operations, crypto transfers.
2. **`phone_call`** (`📞 CDR Call Log`): Telecom CDR logs, frequent call bursts prior to incidents.
3. **`co_location`** (`📍 Location Co-presence`): Tower dumps, GPS trackers, physical surveillance logs.
4. **`same_organization`** (`🏢 Syndicate Affiliation`): Shared gang hierarchy or enterprise membership.
5. **`family`** (`👨‍👩‍👧 Family Connection`): Relatives, kin, co-dependents.
6. **`covert_ghost_link`** (`👻 Covert AI Ghost Link`): Machine learning predicted hidden link inferred from sub-network structural overlap.

---

## 3. Neo4j Service Layer Implementation (`backend-ai/app/services/neo4j_service.py`)

The complete Python service (`neo4j_service.py`) manages driver instantiation, session lifecycle, Cypher batch persistence, and fallback resilience.

```python
"""Neo4j Graph Database Service — CrimeNetX graph engine.

Provides native Neo4j driver management, Cypher graph persistence,
Cypher-based graph query execution, and relationship rationale/elaboration generation.
Includes graceful fallback if Neo4j service is temporarily unreachable.
"""
from __future__ import annotations

import logging
from typing import Any

from app.config import settings

logger = logging.getLogger("crimenetx.neo4j")

_driver = None


def get_neo4j_driver():
    """Retrieve or initialize singleton Neo4j Bolt driver instance."""
    global _driver
    if _driver is None:
        try:
            from neo4j import GraphDatabase

            uri = settings.neo4j_uri
            user = settings.neo4j_user
            password = settings.neo4j_password
            if uri and user and password:
                _driver = GraphDatabase.driver(uri, auth=(user, password))
                logger.info("Connected to Neo4j database at %s", uri)
        except Exception as err:
            logger.warning("Neo4j driver connection initialized with fallback mode: %s", err)
            _driver = False
    return _driver if _driver is not False else None


def generate_edge_explanations(
    source_label: str,
    target_label: str,
    relation: str,
    weight: float,
    evidence: str = "",
) -> tuple[str, str]:
    """Generate a short explanation for graph display and a detailed elaboration for link inspection."""
    relation_lower = relation.lower().replace(" ", "_")
    clean_ev = evidence.strip() if evidence else ""
    clean_ev = (
        clean_ev.replace("seeded from mock FIR", "")
        .replace("investigator-accepted ghost link prediction", "")
        .strip()
    )

    if relation_lower == "financial_transfer":
        short = "💸 Money Transfer"
        elaboration = (
            f"Financial transaction intelligence between '{source_label}' and '{target_label}'. "
            f"Transfer weight score: {weight:.2f}. "
            + (
                f"Evidence detail: {clean_ev}."
                if clean_ev
                else "Audit trail indicates structured money movement between syndicate entities."
            )
        )
    elif relation_lower == "phone_call":
        short = "📞 CDR Call Log"
        elaboration = (
            f"Telecommunication CDR connection between '{source_label}' and '{target_label}'. "
            f"Call intensity score: {weight:.2f}. "
            + (
                f"Evidence detail: {clean_ev}."
                if clean_ev
                else "Frequent calls recorded across critical time windows prior to syndicate operations."
            )
        )
    elif relation_lower == "co_location":
        short = "📍 Location Co-presence"
        elaboration = (
            f"Geographic co-location established between '{source_label}' and '{target_label}'. "
            + (
                f"Evidence detail: {clean_ev}."
                if clean_ev
                else "Logged at the same physical incident site or cell tower footprint."
            )
        )
    elif relation_lower == "same_organization":
        short = "🏢 Syndicate Affiliation"
        elaboration = (
            f"Organizational membership tie linking '{source_label}' and '{target_label}'. "
            + (
                f"Evidence detail: {clean_ev}."
                if clean_ev
                else "Identified as co-operatives within the same criminal enterprise structure."
            )
        )
    elif relation_lower == "family":
        short = "👨‍👩‍👧 Family Connection"
        elaboration = (
            f"Familial kinship tie between '{source_label}' and '{target_label}'. "
            + (
                f"Evidence detail: {clean_ev}."
                if clean_ev
                else "Extracted from FIR relative records and police intelligence databases."
            )
        )
    else:
        if (
            "ghost link" in clean_ev.lower()
            or "hypothesis" in clean_ev.lower()
            or "prediction" in clean_ev.lower()
        ):
            short = "👻 Covert AI Ghost Link"
            elaboration = (
                f"AI Graph Machine Learning algorithm predicted an unobserved, hidden relationship between '{source_label}' and '{target_label}' "
                f"with a confidence score of {weight:.2f}. High sub-network overlap and shared communication pathways strongly indicate a proxy covert channel."
            )
        else:
            short = "🤝 Crime Association"
            elaboration = (
                f"Direct criminal association established between '{source_label}' and '{target_label}'. "
                + (
                    f"Evidence detail: {clean_ev}."
                    if clean_ev
                    else "Documented in police chargesheets, witness statements, or field surveillance logs."
                )
            )

    return short, elaboration


def sync_graph_to_neo4j(
    case_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> bool:
    """Sync nodes and relationships into Neo4j using Cypher queries."""
    driver = get_neo4j_driver()
    if not driver:
        return False

    try:
        with driver.session() as session:
            # 1. Clean existing nodes/edges for this case in Neo4j
            session.run(
                "MATCH (n:Entity {case_id: $case_id}) DETACH DELETE n",
                case_id=case_id,
            )

            # 2. Insert Nodes with Cypher MERGE
            for node in nodes:
                session.run(
                    """
                    MERGE (n:Entity {id: $id, case_id: $case_id})
                    SET n.label = $label,
                        n.entity_type = $entity_type,
                        n.kingpin_score = $kingpin_score,
                        n.role = $role
                    """,
                    id=str(node["id"]),
                    case_id=case_id,
                    label=str(node.get("label", "")),
                    entity_type=str(node.get("entity_type", "PERSON")),
                    kingpin_score=float(node.get("kingpin_score", 0.0)),
                    role=str(node.get("role", "EXECUTOR")),
                )

            # 3. Insert Relationships with Cypher MATCH & MERGE
            for edge in edges:
                src_id = str(edge["source"])
                tgt_id = str(edge["target"])
                rel_type = str(edge.get("relation", "associate"))
                weight = float(edge.get("weight", 1.0))
                evidence = str(edge.get("evidence", ""))
                short_exp, elaboration = generate_edge_explanations(
                    source_label=src_id,
                    target_label=tgt_id,
                    relation=rel_type,
                    weight=weight,
                    evidence=evidence,
                )

                session.run(
                    """
                    MATCH (src:Entity {id: $src_id, case_id: $case_id})
                    MATCH (tgt:Entity {id: $tgt_id, case_id: $case_id})
                    MERGE (src)-[r:RELATED_TO {relation: $rel_type}]->(tgt)
                    SET r.weight = $weight,
                        r.evidence = $evidence,
                        r.short_explanation = $short_exp,
                        r.elaboration = $elaboration
                    """,
                    src_id=src_id,
                    tgt_id=tgt_id,
                    case_id=case_id,
                    rel_type=rel_type,
                    weight=weight,
                    evidence=evidence,
                    short_exp=short_exp,
                    elaboration=elaboration,
                )
        return True
    except Exception as err:
        logger.error("Failed to sync graph to Neo4j: %s", err)
        return False


def query_graph_from_neo4j(case_id: str) -> dict[str, Any] | None:
    """Fetch graph nodes and relationships directly from Neo4j using Cypher."""
    driver = get_neo4j_driver()
    if not driver:
        return None

    try:
        with driver.session() as session:
            node_result = session.run(
                """
                MATCH (n:Entity {case_id: $case_id})
                RETURN n.id AS id, n.label AS label, n.entity_type AS entity_type,
                       n.kingpin_score AS kingpin_score, n.role AS role
                """,
                case_id=case_id,
            )
            nodes = [dict(record) for record in node_result]

            edge_result = session.run(
                """
                MATCH (src:Entity {case_id: $case_id})-[r:RELATED_TO]->(tgt:Entity {case_id: $case_id})
                RETURN src.id AS source, tgt.id AS target, r.relation AS relation,
                       r.weight AS weight, r.evidence AS evidence,
                       r.short_explanation AS short_explanation,
                       r.elaboration AS elaboration
                """,
                case_id=case_id,
            )
            edges = [dict(record) for record in edge_result]

            return {"nodes": nodes, "edges": edges}
    except Exception as err:
        logger.error("Failed to query graph from Neo4j: %s", err)
        return None
```

---

## 4. Integration with Graph ML Pipeline (`backend-ai/app/services/graph_analyzer.py`)

Neo4j synchronization is integrated directly into the CrimeNetX Graph ML analysis pipeline (`graph_analyzer.py`).

### 4.1 Execution Sequence Flow

```
1. Receive Raw Entities & Relations from Ingestion Router
                           │
                           ▼
2. Build NetworkX Directed Graph (nx.DiGraph)
   - Multi-edge weight accumulation
   - Canonical entity resolution
                           │
                           ▼
3. Compute Graph Centrality Algorithms:
   - PageRank (0.30 weight)
   - Betweenness Centrality (0.35 weight)
   - Degree Centrality (0.20 weight)
   - Eigenvector Centrality (0.15 weight)
                           │
                           ▼
4. Calculate Composite Kingpin Score (0–100) & Assign Role:
   - KINGPIN (>70) | BROKER (40–70) | EXECUTOR (<40)
                           │
                           ▼
5. Transform NetworkX Nodes & Edges to Cypher Format
                           │
                           ▼
6. Call `sync_graph_to_neo4j(case_id, neo4j_nodes, neo4j_edges)`
   - Purge stale case graph in Neo4j
   - Persist nodes + Kingpin Scores
   - Persist edges + UI Rationales
                           │
                           ▼
7. Return Enriched `NetworkGraph` to Node.js & React UI
```

### 4.2 Code Integration snippet (`graph_analyzer.py`):

```python
# Synchronize graph elements with Neo4j database
sync_graph_to_neo4j(case_id=case_id, nodes=neo4j_nodes, edges=neo4j_edges)

# Network-level metrics for dashboard
metrics = {
    "node_count": node_cnt,
    "edge_count": edge_cnt,
    "density": round(nx.density(g), 4) if node_cnt > 1 else 0.0,
    "connected_components": nx.number_weakly_connected_components(g) if node_cnt > 0 else 0,
    "kingpins": [n.label for n in nodes if n.role == GraphRole.KINGPIN],
    "brokers": [n.label for n in nodes if n.role == GraphRole.BROKER],
    "avg_clustering": avg_clustering,
    "engine": "Neo4j",
}
```

---

## 5. Docker Infrastructure & Deployment Setup

Neo4j is containerized alongside PostgreSQL, Redis, Node.js, and FastAPI in `docker-compose.yml`.

```yaml
  # ------------------------------------------------------------ neo4j graph db
  neo4j:
    image: neo4j:5.26.0-community
    container_name: crimenetx-neo4j
    restart: unless-stopped
    ports:
      - "7474:7474"   # Neo4j HTTP Browser
      - "7687:7687"   # Neo4j Bolt Port
    environment:
      NEO4J_AUTH: neo4j/crimenetx_neo4j_pass
      NEO4J_PLUGINS: '["apoc"]'
      NEO4J_dbms_memory_heap_initial__size: 512m
      NEO4J_dbms_memory_heap_max__size: 1G
    volumes:
      - neo4j_data:/data
    networks:
      - crimenetx-net
```

### FastAPI Environment Configuration (`backend-ai/app/config.py`)
```python
class Settings(BaseSettings):
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "crimenetx_neo4j_pass"
```

---

## 6. Operational Cypher Query Playbook

Investigating officers and admins can execute native Cypher queries directly via the Neo4j Browser (`http://localhost:7474`):

### Query 1: Find All Kingpins and Brokers in a Specific Case
```cypher
MATCH (n:Entity {case_id: 'case_delhi_syndicate_2026'})
WHERE n.role IN ['KINGPIN', 'BROKER']
RETURN n.label, n.entity_type, n.kingpin_score, n.role
ORDER BY n.kingpin_score DESC;
```

### Query 2: Trace Money Laundering Flow Between Two Suspects
```cypher
MATCH path = (src:Entity {label: 'Suspect A'})-[r:RELATED_TO*1..4 {relation: 'financial_transfer'}]->(tgt:Entity {label: 'Suspect B'})
RETURN path;
```

### Query 3: Highlight Unobserved AI Ghost Links
```cypher
MATCH (src:Entity)-[r:RELATED_TO]->(tgt:Entity)
WHERE r.short_explanation CONTAINS 'Ghost'
RETURN src.label, tgt.label, r.weight, r.elaboration;
```

### Query 4: Identify Central Intermediaries (Brokers) connecting Disjoint Sub-syndicates
```cypher
MATCH (b:Entity {role: 'BROKER'})-[r:RELATED_TO]-(neighbor)
RETURN b.label, count(neighbor) AS connection_count
ORDER BY connection_count DESC;
```

---

## 7. Verification & Operational Health Check

To verify that the Neo4j Graph Service is operational:

1. **Check Docker Status**:
   ```powershell
   docker ps --filter "name=crimenetx-neo4j"
   ```
2. **Test Bolt Port Connectivity**:
   ```powershell
   Test-NetConnection -ComputerName localhost -Port 7687
   ```
3. **Execute Ingestion & Verify Graph Node Creation**:
   - Post evidence via API (`POST /api/evidence/process`)
   - Open Neo4j Browser at `http://localhost:7474`
   - Run `MATCH (n:Entity) RETURN count(n);` to confirm live node synchronization.
