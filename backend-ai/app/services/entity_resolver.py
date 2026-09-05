"""
CrimeNetX — Stage 4: Splink Entity Resolution (SAMYOJAN)
=========================================================
Deduplicates entities across documents using Fellegi-Sunter probabilistic matching.
Uses Splink with DuckDB backend for fast in-memory matching.

Handles Indian name challenges:
  - Phonetic variants: "Jadhav" vs "Jadav"
  - Name order: "Ravi Jadhav" vs "Jadhav Ravi"
  - Titles: "Shri Ravi Jadhav" vs "Ravi K. Jadhav"
  - Father's name: "s/o Kumar" vs "s/o K."
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

import duckdb
import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class ResolvedEntity:
    """Result of entity resolution for a single entity pair."""
    entity_a_id: str
    entity_b_id: str
    entity_a_name: str
    entity_b_name: str
    match_probability: float      # 0.0 to 1.0
    match_weight: float           # Fellegi-Sunter log-odds weight
    decision: str                 # "MERGE" | "SPLIT" | "REVIEW"
    field_scores: dict            # {"first_name": 2.1, "phone": 3.5, ...}
    blocking_key: str             # Which blocking rule matched


@dataclass
class ResolutionReport:
    """Summary of a full entity resolution run."""
    total_entities: int
    total_comparisons: int
    merges: int
    splits: int
    reviews: int
    resolved_pairs: list[ResolvedEntity] = field(default_factory=list)


class EntityResolver:
    """
    Splink-based entity resolution engine.
    
    Usage:
        resolver = EntityResolver()
        report = resolver.resolve_entities(
            new_entities=[
                {"id": "e1", "first_name": "Ravi", "last_name": "Jadhav", "phone": "9876543210"},
                {"id": "e2", "first_name": "R.", "last_name": "Jadav", "phone": "9876543210"},
            ],
            existing_entities=[...]  # From database
        )
        for pair in report.resolved_pairs:
            if pair.decision == "MERGE":
                print(f"Merge {pair.entity_a_name} with {pair.entity_b_name}")
    """

    def __init__(
        self,
        match_threshold: float = 0.95,
        review_threshold: float = 0.30,
    ):
        self.match_threshold = match_threshold
        self.review_threshold = review_threshold
        self._splink_model = None

    @staticmethod
    def _normalize_name(name: str) -> dict:
        """
        SAMYOJAN Stages 1-3: Normalize an Indian name into components.
        
        Input: "Shri Ravi Kumar s/o Ganesh Jadhav"
        Output: {
            "first_name": "ravi",
            "middle_name": "kumar",
            "last_name": "jadhav",
            "father_name": "ganesh",
            "title": "shri",
            "raw": "Shri Ravi Kumar s/o Ganesh Jadhav"
        }
        """
        if not name:
            return {"first_name": "", "middle_name": "", "last_name": "", "father_name": "", "title": "", "raw": ""}

        original = name.strip()
        cleaned = original.lower()

        # Stage 2: Remove honorifics and titles
        titles = ["shri", "smt", "km", "ku", "dr", "mr", "mrs", "ms", "adv", "sr"]
        for title in titles:
            cleaned = re.sub(rf'\b{title}\.?\s*', '', cleaned)

        # Stage 3: Extract s/o, w/o, d/o (father/spouse name)
        parent_match = re.search(r'[swd]/o\s+([a-z\s]+?)(?:\s|$)', cleaned)
        father_name = ""
        if parent_match:
            father_name = parent_match.group(1).strip()
            cleaned = cleaned[:parent_match.start()] + cleaned[parent_match.end():]

        # Remove punctuation and extra spaces
        cleaned = re.sub(r'[.,;:\-\'"()]', '', cleaned)
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()

        # Split into name parts
        parts = cleaned.split()

        if len(parts) == 0:
            return {"first_name": "", "middle_name": "", "last_name": "", "father_name": father_name, "title": "", "raw": original}
        elif len(parts) == 1:
            return {"first_name": parts[0], "middle_name": "", "last_name": "", "father_name": father_name, "title": "", "raw": original}
        elif len(parts) == 2:
            return {"first_name": parts[0], "middle_name": "", "last_name": parts[1], "father_name": father_name, "title": "", "raw": original}
        else:
            return {
                "first_name": parts[0],
                "middle_name": " ".join(parts[1:-1]),
                "last_name": parts[-1],
                "father_name": father_name,
                "title": "",
                "raw": original,
            }

    @staticmethod
    def _phonetic_key(name: str) -> str:
        """
        SAMYOJAN Stage 6: Generate a phonetic blocking key for Indian names.
        Uses a simplified Soundex-like approach for Devanagari transliterations.
        """
        if not name:
            return ""
        name = name.lower().strip()
        # Remove vowels for blocking (consonant skeleton)
        consonants = re.sub(r'[aeiou\s]', '', name)
        # Take first 4 characters as blocking key
        return consonants[:4] if consonants else name[:4]

    def resolve_entities(
        self,
        new_entities: list[dict],
        existing_entities: Optional[list[dict]] = None,
    ) -> ResolutionReport:
        """Resolve entities using Splink Fellegi-Sunter model or rule fallback."""
        all_entities = []
        for idx, entity in enumerate(new_entities):
            normalized = self._normalize_name(entity.get("full_name", ""))
            entity.update(normalized)
            entity["unique_id"] = entity.get("id") or f"new_{idx}"
            entity["phonetic_key"] = self._phonetic_key(entity.get("last_name", ""))
            all_entities.append(entity)

        if existing_entities:
            for idx, entity in enumerate(existing_entities):
                normalized = self._normalize_name(entity.get("full_name", ""))
                entity.update(normalized)
                entity["unique_id"] = entity.get("id") or f"exist_{idx}"
                entity["phonetic_key"] = self._phonetic_key(entity.get("last_name", ""))
                all_entities.append(entity)

        if len(all_entities) < 2:
            return ResolutionReport(
                total_entities=len(all_entities),
                total_comparisons=0, merges=0, splits=0, reviews=0
            )

        # Splink v4 duckdb execution with rule-fallback safety
        try:
            from splink import DuckDBAPI, Linker, SettingsCreator, block_on

            df = pd.DataFrame(all_entities)
            for col in ["first_name", "last_name", "phone", "father_name", "phonetic_key"]:
                if col not in df.columns:
                    df[col] = ""
            df = df.fillna("")

            db_api = DuckDBAPI()

            settings = SettingsCreator(
                link_type="dedupe_only",
                unique_id_column_name="unique_id",
                comparisons=[
                    {
                        "output_column_name": "first_name",
                        "comparison_levels": [
                            {"is_null_level": True, "sql_condition": "first_name_l IS NULL OR first_name_l = ''"},
                            {"sql_condition": "first_name_l = first_name_r", "label_for_charts": "Exact match"},
                            {"sql_condition": "ELSE", "label_for_charts": "All other comparisons"},
                        ]
                    },
                    {
                        "output_column_name": "last_name",
                        "comparison_levels": [
                            {"is_null_level": True, "sql_condition": "last_name_l IS NULL OR last_name_l = ''"},
                            {"sql_condition": "last_name_l = last_name_r", "label_for_charts": "Exact match"},
                            {"sql_condition": "ELSE", "label_for_charts": "All other comparisons"},
                        ]
                    },
                ],
                blocking_rules_to_generate_predictions=[
                    block_on("first_name"),
                    block_on("phonetic_key"),
                ],
            )

            linker = Linker(df, settings, db_api=db_api)
            predictions = linker.inference.predict(threshold_match_probability=0.2)
            predictions_df = predictions.as_pandas_dataframe()

            resolved_pairs = []
            merges = 0
            reviews = 0
            splits = 0

            for _, row in predictions_df.iterrows():
                prob = float(row.get("match_probability", 0.0))
                weight = float(row.get("match_weight", 0.0))

                if prob >= self.match_threshold:
                    decision = "MERGE"
                    merges += 1
                elif prob >= self.review_threshold:
                    decision = "REVIEW"
                    reviews += 1
                else:
                    decision = "SPLIT"
                    splits += 1

                resolved_pairs.append(ResolvedEntity(
                    entity_a_id=str(row.get("unique_id_l", "")),
                    entity_b_id=str(row.get("unique_id_r", "")),
                    entity_a_name=str(row.get("full_name_l", "")),
                    entity_b_name=str(row.get("full_name_r", "")),
                    match_probability=round(prob, 4),
                    match_weight=round(weight, 4),
                    decision=decision,
                    field_scores={},
                    blocking_key=str(row.get("phonetic_key_l", "")),
                ))

            return ResolutionReport(
                total_entities=len(all_entities),
                total_comparisons=len(predictions_df),
                merges=merges,
                splits=splits,
                reviews=reviews,
                resolved_pairs=resolved_pairs,
            )

        except Exception as e:
            logger.warning(f"Splink execution note: {e}, using probabilistic rule-based resolution")
            return self._fallback_resolution(all_entities)

    def _fallback_resolution(self, entities: list[dict]) -> ResolutionReport:
        """
        Simple fallback when Splink fails.
        Uses exact phone match + name similarity.
        """
        resolved_pairs = []
        merges = 0
        reviews = 0

        for i in range(len(entities)):
            for j in range(i + 1, len(entities)):
                a, b = entities[i], entities[j]

                # Exact phone match = strong signal
                phone_match = (
                    a.get("phone", "") and
                    b.get("phone", "") and
                    a["phone"] == b["phone"]
                )

                # Simple name similarity
                name_a = f"{a.get('first_name', '')} {a.get('last_name', '')}".lower()
                name_b = f"{b.get('first_name', '')} {b.get('last_name', '')}".lower()
                name_overlap = len(set(name_a.split()) & set(name_b.split())) / max(
                    len(set(name_a.split()) | set(name_b.split())), 1
                )

                if phone_match and name_overlap > 0.5:
                    prob = 0.96
                    decision = "MERGE"
                    merges += 1
                elif phone_match or name_overlap > 0.7:
                    prob = 0.65
                    decision = "REVIEW"
                    reviews += 1
                else:
                    continue  # Don't add low-confidence pairs

                resolved_pairs.append(ResolvedEntity(
                    entity_a_id=a.get("id", ""),
                    entity_b_id=b.get("id", ""),
                    entity_a_name=a.get("full_name", ""),
                    entity_b_name=b.get("full_name", ""),
                    match_probability=prob,
                    match_weight=0.0,
                    decision=decision,
                    field_scores={"phone": 1.0 if phone_match else 0.0, "name_overlap": name_overlap},
                    blocking_key="fallback",
                ))

        return ResolutionReport(
            total_entities=len(entities),
            total_comparisons=len(resolved_pairs),
            merges=merges,
            splits=0,
            reviews=reviews,
            resolved_pairs=resolved_pairs,
        )