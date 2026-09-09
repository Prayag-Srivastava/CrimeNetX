"""Quick GLiNER test — verify crime-domain extraction works."""
from app.services.nlp_extractor import NLPExtractor

test_text = """
On 12th October 2024, complainant Ravi Kumar Jadhav (age 34) reported that his 
Maruti Swift bearing registration number MH12 AB 1234 was stolen from Kothrud, Pune.
He suspects Amol Deshmukh, a known member of the Powai gang, who was seen near 
Shivajinagar Police Station on 11th October. Ravi's phone number is 9876543210 
and his Aadhaar is 4567 8901 2345. The suspect allegedly transferred 
Rs. 50,000 to bank account HDFC0001234 via UPI id amol@ybl.
Case registered under BNS Section 303 and IT Act Section 66E.
"""

print("=" * 70)
print("🧪 GLINER + REGEX EXTRACTION TEST")
print("=" * 70)

extractor = NLPExtractor()
entities = extractor.extract_entities_with_spans(test_text)

print(f"\n✅ Found {len(entities)} entities using engine: {extractor._extraction_engine}\n")

# Group by label
by_label = {}
for e in entities:
    by_label.setdefault(e["label"], []).append(e)

for label, ents in sorted(by_label.items()):
    print(f"\n[{label}]")
    for e in ents:
        conf = e.get("confidence", 0)
        engine = e.get("engine", "?")
        gliner_label = e.get("gliner_label", "")
        print(f"  • '{e['text']}' → {gliner_label} (conf={conf}, engine={engine})")
        