"""CrimeNetX mock data generator (SIH26189).

Populates:
  5 sample FIR PDFs      (fabricated Indian crime narratives — realistic structure)
  1 CDR CSV              (100 call records with an embedded suspect cell pattern)
  3 bank statement CSVs  (200+ transactions with a money-laundering layering trail)
  50 suspect profiles    (JSON — names, aliases, phones, addresses, placeholder photos)
  20 historical cases    (JSON summaries for cross-reference testing)

Outputs land in backend-ai/data/generated/ (gitignored). Idempotent — safe to re-run.

⚠️ ALL DATA IS FABRICATED for hackathon/demo purposes. No real persons or cases.
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta
from pathlib import Path

random.seed(2026)

OUT = Path(__file__).parent / "generated"
OUT.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Shared fabricated universe — consistent across FIRs so cross-referencing works
# ---------------------------------------------------------------------------
SUSPECTS = [
    {"id": "S-001", "name": "Ravi Jadhav", "aliases": ["Ravi Anna", "RJ"], "phone": "9822012345", "address": "Pune, Maharashtra", "role": "KINGPIN", "kingpin_score": 88.2},
    {"id": "S-002", "name": "Imran Shaikh", "aliases": ["Chhota", "Chhota Imran"], "phone": "9867001122", "address": "Mumbai, Maharashtra", "role": "BROKER", "kingpin_score": 62.4},
    {"id": "S-003", "name": "Gurpreet Singh", "aliases": ["Happy"], "phone": "9988776655", "address": "Ludhiana, Punjab", "role": "EXECUTOR", "kingpin_score": 33.7},
    {"id": "S-004", "name": "Sunil More", "aliases": ["Sunny"], "phone": "9876543210", "address": "Nashik, Maharashtra", "role": "EXECUTOR", "kingpin_score": 28.1},
    {"id": "S-005", "name": "Farhan Qureshi", "aliases": ["Fairy"], "phone": "9765432109", "address": "Mumbai, Maharashtra", "role": "BROKER", "kingpin_score": 55.9},
    {"id": "S-006", "name": "Arjun Deshmukh", "aliases": ["DJ"], "phone": "9612345678", "address": "Pune, Maharashtra", "role": "EXECUTOR", "kingpin_score": 24.5},
    {"id": "S-007", "name": "Manish Gupta", "aliases": ["Mintu"], "phone": "9543216780", "address": "Nagpur, Maharashtra", "role": "BROKER", "kingpin_score": 47.2},
    {"id": "S-008", "name": "Sandeep Wagh", "aliases": ["Wagh"], "phone": "9421122334", "address": "Solapur, Maharashtra", "role": "EXECUTOR", "kingpin_score": 30.8},
    {"id": "S-009", "name": "Nitin Kale", "aliases": ["Kale Sir"], "phone": "9309988776", "address": "Kolhapur, Maharashtra", "role": "BROKER", "kingpin_score": 51.3},
    {"id": "S-010", "name": "Ramesh Patil", "aliases": ["RP"], "phone": "9012345678", "address": "Sangli, Maharashtra", "role": "EXECUTOR", "kingpin_score": 19.9},
    {"id": "S-011", "name": "Vikram Pawar", "aliases": ["Vicky"], "phone": "8887654321", "address": "Pune, Maharashtra", "role": "EXECUTOR", "kingpin_score": 22.0},
    {"id": "S-012", "name": "Shabir Khan", "aliases": ["Shabir"], "phone": "8790543210", "address": "Mumbai, Maharashtra", "role": "EXECUTOR", "kingpin_score": 26.4},
]

# Reusable vehicles / accounts / locations woven into the narratives
VEHICLES = ["MH-12-AB-4521", "MH-01-CD-8890", "MH-14-XY-1122", "MH-04-PQ-7788", "MH-13-EF-3344"]
ACCOUNTS = [
    "50100234567890",
    "30201112223344",
    "60230099887766",
    "40110223344556",
    "70331144556677",
    "20120556677889",
    "15022010101011",
    "11029988776655",
]
LOCATIONS = ["Pune", "Mumbai", "Nashik", "Nagpur", "Solapur", "Kolhapur", "Ludhiana", "Sangli"]

# Placeholder photo URLs (will not load in sandboxed previews — fine, they are seeds)
def _photo_url(sid: str) -> str:
    return f"https://placehold.co/400x500?text={sid}"

def suspect_profiles() -> list[dict]:
    profiles = []
    for s in SUSPECTS:
        profiles.append(
            {
                "id": s["id"],
                "name": s["name"],
                "aliases": s["aliases"],
                "dob": f"19{random.randint(65, 95)}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}",
                "gender": "Male",
                "address": s["address"],
                "phoneNumbers": [s["phone"]],
                "photoUrl": _photo_url(s["id"]),
                "criminalHistory": [
                    f"2018 — theft (CCTV witness in {random.choice(LOCATIONS)})",
                    "2021 — housebreaking",
                ],
                "kingpinScore": s["kingpin_score"],
                "role": s["role"],
            }
        )
    # Pad to 50 with generic profiles
    surnames = ["Yadav", "Shinde", "Gavaskar", "Kulkarni", "Joshi", "Naik", "Bhosale", "Rathod", "Mohite", "Chavan"]
    first = ["Aakash", "Pranav", "Karan", "Rohit", "Sameer", "Tushar", "Yogesh", "Dinesh", "Prakash", "Suresh"]
    for i in range(len(profiles), 50):
        sid = f"S-{i + 1:03d}"
        profiles.append(
            {
                "id": sid,
                "name": f"{random.choice(first)} {random.choice(surnames)}",
                "aliases": [],
                "dob": f"19{random.randint(70, 98)}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}",
                "gender": random.choice(["Male", "Male", "Female"]),
                "address": f"{random.choice(LOCATIONS)}, Maharashtra",
                "phoneNumbers": [f"9{random.randint(100000000, 999999999)}"],
                "photoUrl": _photo_url(sid),
                "criminalHistory": [],
                "kingpinScore": round(random.uniform(5, 45), 1),
                "role": random.choice(["EXECUTOR", "EXECUTOR", "BROKER"]),
            }
        )
    return profiles

# ---------------------------------------------------------------------------
# FIR narratives (fabricated)
# ---------------------------------------------------------------------------
FIR_TEMPLATE = """FIRST INFORMATION REPORT (FIR)
Under Section 154 of the Code of Criminal Procedure, 1973 / BNS 2023

FIR No.: {fir_no}
Police Station: {ps}
District: {district}
Date of Registration: {date}
Offences: {sections}
Received by: {officer}, {rank}

BRIEF FACTS OF THE CASE:
On {date}, complainant {complainant}, {age} years, resident of {address},
appeared before the undersigned and reported as follows:

"On {incident_date} at approximately {time}, I was {activity} at {location}
when {accused_desc} {crime_verb} {object_desc}. The accused, who were
{travelling} {vehicle}, {outcome}. I believe the accused persons are
{names} alias {aliases}, who are known in the area. One of the accused
was using mobile number {phone} at the time. I have come to know that the
stolen {object} was later seen near {second_location}."

The complainant further stated that the accused persons demanded
{money_demand} and threatened him with dire consequences if he reported
the matter to the police.

INVESTIGATION NOTES:
Preliminary enquiry revealed that the accused had parked the vehicle
{vehicle} near {third_location} for approximately {hours} hours before the
incident. CCTV footage from nearby establishments is being collected.
Bank account {account} in the name of {beneficiary} was allegedly used to
receive {money_demand}.

Signature of Complainant
Signature of Investigating Officer
"""

FIR_RECIPES = [
    {
        "fir_no": "PUN-2024-0118",
        "ps": "Hinjewadi Police Station",
        "district": "Pune",
        "date": "2024-03-14",
        "incident_date": "12-03-2024",
        "time": "22:40 hours",
        "sections": "IPC 392, 397; BNS 304",
        "complainant": "Mahesh Kulkarni",
        "age": "41",
        "address": "Hinjewadi, Pune",
        "activity": "returning home from work on my scooter",
        "location": "near Rajiv Gandhi Infotech Park, Hinjewadi Phase 2",
        "accused_desc": "three masked persons on two motorcycles",
        "crime_verb": "snatched my mobile phone and wallet",
        "object_desc": "containing cash of Rs. 45,000 and a Samsung mobile",
        "travelling": "travelling on",
        "vehicle": VEHICLES[0],
        "outcome": "fled towards Mulshi road",
        "names": "Ravi Jadhav and Imran Shaikh",
        "aliases": "Ravi Anna, Chhota",
        "phone": SUSPECTS[0]["phone"],
        "second_location": "Paud",
        "money_demand": "Rs. 2,00,000",
        "hours": "3",
        "account": ACCOUNTS[0],
        "beneficiary": "Sunil More",
        "third_location": "Bhosari",
    },
    {
        "fir_no": "MUM-2024-0331",
        "ps": "Dharavi Police Station",
        "district": "Mumbai",
        "date": "2024-05-02",
        "incident_date": "01-05-2024",
        "time": "04:15 hours",
        "sections": "IPC 457, 380; BNS 305, 308",
        "complainant": "Kavita Iyer",
        "age": "37",
        "address": "Sion, Mumbai",
        "activity": "sleeping in my residence",
        "location": "her residence at Sion, Mumbai",
        "accused_desc": "two unknown persons",
        "crime_verb": "broke open the back door and decamped with jewellery and cash",
        "object_desc": "gold ornaments worth approx. Rs. 8,50,000 and cash Rs. 1,20,000",
        "travelling": "seen escaping in a white sedan bearing registration",
        "vehicle": VEHICLES[1],
        "outcome": "according to neighbours",
        "names": "Gurpreet Singh and Farhan Qureshi",
        "aliases": "Happy, Fairy",
        "phone": SUSPECTS[2]["phone"],
        "second_location": "Wadala",
        "money_demand": "Rs. 5,00,000",
        "hours": "2",
        "account": ACCOUNTS[1],
        "beneficiary": "Imran Shaikh",
        "third_location": "Byculla",
    },
    {
        "fir_no": "NAG-2024-0057",
        "ps": "Sitabuldi Police Station",
        "district": "Nagpur",
        "date": "2024-06-21",
        "incident_date": "20-06-2024",
        "time": "13:20 hours",
        "sections": "IPC 420, 467, 471; BNS 308, 318, 336",
        "complainant": "Rohit Agrawal",
        "age": "52",
        "address": "Dharampeth, Nagpur",
        "activity": "checking my business bank statement online",
        "location": "my office at Sitabuldi, Nagpur",
        "accused_desc": "fraudsters posing as bank executives",
        "crime_verb": "obtained my OTP through a phishing call and transferred funds",
        "object_desc": "Rs. 12,40,000 from my account",
        "travelling": "later traced to",
        "vehicle": VEHICLES[2],
        "outcome": "the amount was moved through multiple accounts",
        "names": "Nitin Kale and Manish Gupta",
        "aliases": "Kale Sir, Mintu",
        "phone": SUSPECTS[8]["phone"],
        "second_location": "Wardha",
        "money_demand": "Rs. 20,00,000",
        "hours": "5",
        "account": ACCOUNTS[2],
        "beneficiary": "Arjun Deshmukh",
        "third_location": "Amravati",
    },
    {
        "fir_no": "NASH-2024-0092",
        "ps": "Gangapur Road Police Station",
        "district": "Nashik",
        "date": "2024-08-09",
        "incident_date": "08-08-2024",
        "time": "19:05 hours",
        "sections": "IPC 395, 412; BNS 309, 312",
        "complainant": "Seema Bansal",
        "age": "45",
        "address": "College Road, Nashik",
        "activity": "travelling with family",
        "location": "near Dwarka Circle, Nashik",
        "accused_desc": "five persons in a grey SUV",
        "crime_verb": "stopped the car, threatened us and looted cash and jewellery",
        "object_desc": "Rs. 3,60,000 cash and gold chain",
        "travelling": "they were in",
        "vehicle": VEHICLES[3],
        "outcome": "they escaped towards Sinnar",
        "names": "Ravi Jadhav, Sandeep Wagh and Vikram Pawar",
        "aliases": "Ravi Anna, Wagh, Vicky",
        "phone": SUSPECTS[7]["phone"],
        "second_location": "Sinnar",
        "money_demand": "Rs. 10,00,000",
        "hours": "4",
        "account": ACCOUNTS[3],
        "beneficiary": "Ramesh Patil",
        "third_location": "Igatpuri",
    },
    {
        "fir_no": "SOL-2024-0044",
        "ps": "North Solapur Police Station",
        "district": "Solapur",
        "date": "2024-10-17",
        "incident_date": "16-10-2024",
        "time": "23:55 hours",
        "sections": "IPC 384, 506; BNS 308, 351",
        "complainant": "Dinesh Pawar",
        "age": "38",
        "address": "Market Yard, Solapur",
        "activity": "closing my shop",
        "location": "Market Yard, Solapur",
        "accused_desc": "two men on a motorcycle",
        "crime_verb": "demanded extortion money and fired a shot in the air",
        "object_desc": "Rs. 1,00,000 as monthly extortion",
        "travelling": "riding",
        "vehicle": VEHICLES[4],
        "outcome": "they warned of serious consequences",
        "names": "Imran Shaikh and Shabir Khan",
        "aliases": "Chhota, Shabir",
        "phone": SUSPECTS[1]["phone"],
        "second_location": "Pandharpur",
        "money_demand": "Rs. 25,00,000",
        "hours": "1",
        "account": ACCOUNTS[4],
        "beneficiary": "Farhan Qureshi",
        "third_location": "Akkalkot",
    },
]


def build_fir_pdf(recipe: dict) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    from reportlab.lib.units import mm

    styles = getSampleStyleSheet()
    path = OUT / "mock_firs" / f"FIR_{recipe['fir_no'].replace('-', '_')}.pdf"
    path.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(str(path), pagesize=A4)
    story = []
    # Header
    from reportlab.lib.enums import TA_CENTER

    styles["Title"].alignment = TA_CENTER
    story.append(Paragraph("GOVERNMENT OF MAHARASHTRA", styles["Title"]))
    story.append(Paragraph("State Crime Investigation Department", styles["Title"].clone("hdr", parent=styles["Normal"])))
    story.append(Spacer(1, 6 * mm))
    defaults = {"officer": "Inspector A. Deshpande", "rank": "Police Inspector", "object": "property"}
    body = FIR_TEMPLATE.format(**{**defaults, **recipe}).split("\n")
    for line in body:
        if not line.strip():
            continue
        story.append(Paragraph(line, styles["Normal"]))
    doc.build(story)


# ---------------------------------------------------------------------------
# CDR (100 call records) — embedded cell pattern: executor -> broker -> kingpin
# ---------------------------------------------------------------------------
def build_cdr_csv() -> None:
    import csv

    phones = [s["phone"] for s in SUSPECTS[:12]]
    base = datetime(2024, 3, 1, 9, 0, 0)
    rows = []
    # Pattern: Sunil More (S-004) calls Imran (S-002) 12x; Imran calls Ravi (S-001) 9x
    pattern = [("9876543210", "9867001122", 12), ("9867001122", "9822012345", 9), ("9876543210", "9822012345", 4), ("9765432109", "9867001122", 7), ("9421122334", "9867001122", 5)]
    idx = 0
    for src, tgt, count in pattern:
        for _ in range(count):
            rows.append(
                [
                    src,
                    tgt,
                    random.randint(20, 900),
                    (base + timedelta(minutes=idx * 47 + random.randint(0, 20))).strftime("%Y-%m-%d %H:%M:%S"),
                    f"TOWER-{random.randint(1, 12):03d}",
                    f"IMEI{random.randint(100000000000000, 999999999999999)}",
                ]
            )
            idx += 1
    # Fill remaining with random calls among all suspects
    while len(rows) < 100:
        src, tgt = random.sample(phones, 2)
        rows.append(
            [
                src,
                tgt,
                random.randint(5, 1800),
                (base + timedelta(minutes=idx * 31)).strftime("%Y-%m-%d %H:%M:%S"),
                f"TOWER-{random.randint(1, 12):03d}",
                f"IMEI{random.randint(100000000000000, 999999999999999)}",
            ]
        )
        idx += 1

    path = OUT / "mock_cdrs" / "cdr_case_PUN_2024_0118.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["from_number", "to_number", "duration_sec", "call_time", "cell_tower", "imei"])
        w.writerows(rows)


# ---------------------------------------------------------------------------
# Bank statements (3 CSVs, 200+ txns) — layering trail victim -> mule accounts
# Each case: victim -> mule1 -> mule2 -> mule3 -> mule4 -> kingpin-account
# (5 hops = HIGH layering risk). Background txns use a separate filler pool so
# the trail stays clean and traceable for the Money-Flow Tracer demo.
# ---------------------------------------------------------------------------
FILLER_ACCOUNTS = ["90010000000001", "90010000000002", "90010000000003", "90010000000004", "90010000000005", "90010000000006", "90010000000007", "90010000000008"]


def build_bank_csvs() -> None:
    import csv

    base = datetime(2024, 2, 1)
    for bank_idx in range(3):
        n = len(ACCOUNTS)
        victim = ACCOUNTS[bank_idx]
        mule1 = ACCOUNTS[(bank_idx + 3) % n]
        mule2 = ACCOUNTS[(bank_idx + 5) % n]
        mule3 = ACCOUNTS[(bank_idx + 7) % n]
        mule4 = ACCOUNTS[(bank_idx + 2) % n]
        final = ACCOUNTS[(bank_idx + 1) % n]  # kingpin-linked destination
        assert len({victim, mule1, mule2, mule3, mule4, final}) == 6, "trail accounts must be distinct"

        chain = [
            (victim, mule1, 14, "NEFT"),
            (mule1, mule2, 11, "IMPS"),
            (mule2, mule3, 9, "UPI"),
            (mule3, mule4, 7, "NEFT"),
            (mule4, final, 5, "RTGS"),
        ]
        rows = []
        day_offset = 0
        for src, tgt, count, method in chain:
            for i in range(count):
                rows.append(
                    [
                        src,
                        tgt,
                        round(random.uniform(35000, 95000), 2),
                        (base + timedelta(days=day_offset, hours=i * 4 + bank_idx)).strftime("%Y-%m-%d %H:%M:%S"),
                        method,
                    ]
                )
            day_offset += 1
        # Legit-looking background txns (filler pool only — keeps trail clean)
        while len(rows) < 200:
            a, b = random.sample(FILLER_ACCOUNTS, 2)
            rows.append(
                [a, b, round(random.uniform(500, 50000), 2), (base + timedelta(days=random.randint(0, 90), hours=random.randint(8, 21))).strftime("%Y-%m-%d %H:%M:%S"), random.choice(["NEFT", "UPI", "IMPS", "RTGS"])]
            )
        path = OUT / "mock_bank" / f"bank_case_{bank_idx + 1}.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["from_account", "to_account", "amount", "timestamp", "transaction_type"])
            w.writerows(rows)


# ---------------------------------------------------------------------------
# Historical cases (20) for cross-reference testing
# ---------------------------------------------------------------------------
def build_historical_cases() -> None:
    cases = []
    for i in range(1, 21):
        s = random.choice(SUSPECTS)
        cases.append(
            {
                "id": f"HC-{i:03d}",
                "case_number": f"{random.choice(['PUN', 'MUM', 'NAG', 'NASH', 'SOL'])}-2023-{random.randint(100, 999)}",
                "title": f"Unnatural death / theft / fraud incident {i}",
                "summary": f"Reported case involving suspect {s['name']} (alias {s['aliases'][0] if s['aliases'] else 'unknown'}), "
                f"phone {s['phone']}, vehicle {random.choice(VEHICLES)}, account {random.choice(ACCOUNTS)}. "
                f"Occurred at {random.choice(LOCATIONS)}. Modus operandi: {random.choice(['night-time housebreaking', 'highway loot', 'bank fraud via phishing', 'extortion ring'])}.",
                "entities": [
                    {"type": "PERSON", "value": s["name"]},
                    {"type": "PHONE", "value": s["phone"]},
                    {"type": "VEHICLE", "value": random.choice(VEHICLES)},
                    {"type": "BANK_ACCOUNT", "value": random.choice(ACCOUNTS)},
                    {"type": "LOCATION", "value": random.choice(LOCATIONS)},
                ],
                "date": f"2023-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}",
            }
        )
    path = OUT / "historical_cases.json"
    with open(path, "w") as fh:
        json.dump(cases, fh, indent=2)


def main() -> None:
    print("Generating CrimeNetX mock data into", OUT)
    for recipe in FIR_RECIPES:
        build_fir_pdf(recipe)
        print("  FIR:", recipe["fir_no"])
    build_cdr_csv()
    print("  CDR: 100 records ->", "mock_cdrs/cdr_case_PUN_2024_0118.csv")
    build_bank_csvs()
    print("  3 bank CSVs (200+ txns each)")
    build_historical_cases()
    print("  20 historical cases ->", "historical_cases.json")
    with open(OUT / "suspects.json", "w") as fh:
        json.dump(suspect_profiles(), fh, indent=2)
    print("  50 suspect profiles ->", "suspects.json")
    # Case entity bundle for seeding the cross-reference corpus
    bundle = []
    for recipe in FIR_RECIPES:
        names = recipe["names"].replace(" and ", ", ").split(", ")
        bundle.append(
            {
                "case_id": recipe["fir_no"].split("-")[0] + recipe["fir_no"].split("-")[-1],
                "case_number": recipe["fir_no"],
                "entities": [
                    {"type": "PERSON", "value": n} for n in names
                ]
                + [
                    {"type": "PHONE", "value": recipe["phone"]},
                    {"type": "VEHICLE", "value": recipe["vehicle"]},
                    {"type": "BANK_ACCOUNT", "value": recipe["account"]},
                    {"type": "LOCATION", "value": recipe["district"]},
                ],
            }
        )
    with open(OUT / "case_entity_bundle.json", "w") as fh:
        json.dump(bundle, fh, indent=2)
    print("  case entity bundle ->", "case_entity_bundle.json")
    print("Done ✓")


if __name__ == "__main__":
    main()
