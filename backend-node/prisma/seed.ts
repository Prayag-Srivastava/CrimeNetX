/**
 * CrimeNetX seed script.
 *
 * Creates:
 *   1. Four test users (one per role) — password: Test@1234
 *   2. Mock cases, suspects, entities, CDR rows, transactions, alerts
 *   3. Optionally loads richer mock data from backend-ai/data/generated
 *      (JSON produced by python -m data.generate_mock_data)
 *
 * Run: npx prisma db seed   (or npm run seed)
 */
import { PrismaClient, Role, GraphRole, CasePriority, CaseStatus, EntityType, RelationType, AlertSeverity, AlertType } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

const PASSWORD = "Test@1234";

const USERS: { email: string; name: string; role: Role; department: string; badgeNumber: string }[] = [
  { email: "investigator@crimenetx.gov.in", name: "Insp. Aarav Deshpande", role: "INVESTIGATOR", department: "Pune City", badgeNumber: "MH-PN-1042" },
  { email: "dsp@crimenetx.gov.in", name: "DSP Meera Kulkarni", role: "DSP", department: "Pune Rural", badgeNumber: "MH-PN-2031" },
  { email: "sp@crimenetx.gov.in", name: "SP Rohan Patil", role: "SP", department: "Pune Range", badgeNumber: "MH-RG-1102" },
  { email: "dgp@crimenetx.gov.in", name: "DGP Sanjay Mhaiskar", role: "DGP", department: "Maharashtra State", badgeNumber: "MH-ST-0001" },
];

const CASES = [
  {
    caseNumber: "PUN-2024-0118",
    title: "Chain snatching gang — Hinjewadi",
    description: "Organized chain-snatching by a masked gang operating between Pune and Nashik. Multiple victims; CCTV corroboration available.",
    status: "UNDER_INVESTIGATION" as CaseStatus,
    priority: "HIGH" as CasePriority,
    jurisdiction: "Pune",
    startDate: new Date("2024-03-14"),
  },
  {
    caseNumber: "MUM-2024-0331",
    title: "Housebreaking at Sion",
    description: "Housebreaking with theft of jewellery. Suspects escaped in a white sedan; CDR analysis points to an interstate link.",
    status: "OPEN" as CaseStatus,
    priority: "MEDIUM" as CasePriority,
    jurisdiction: "Mumbai",
    startDate: new Date("2024-05-02"),
  },
  {
    caseNumber: "NAG-2024-0057",
    title: "Bank fraud via phishing — Sitabuldi",
    description: "Phishing-based OTP fraud; funds laundered through multiple mule accounts within 72 hours.",
    status: "UNDER_INVESTIGATION" as CaseStatus,
    priority: "CRITICAL" as CasePriority,
    jurisdiction: "Nagpur",
    startDate: new Date("2024-06-21"),
  },
  {
    caseNumber: "NASH-2024-0092",
    title: "Highway loot near Dwarka Circle",
    description: "Armed highway loot; five suspects in a grey SUV. Suspects known to the Hinjewadi snatching cell.",
    status: "PENDING_REVIEW" as CaseStatus,
    priority: "HIGH" as CasePriority,
    jurisdiction: "Nashik",
    startDate: new Date("2024-08-09"),
  },
  {
    caseNumber: "SOL-2024-0044",
    title: "Extortion ring — Market Yard",
    description: "Extortion demand with firing in the air; linked to the same broker network as Pune and Nashik cases.",
    status: "OPEN" as CaseStatus,
    priority: "MEDIUM" as CasePriority,
    jurisdiction: "Solapur",
    startDate: new Date("2024-10-17"),
  },
];

const SUSPECTS = [
  { name: "Ravi Jadhav", aliases: ["Ravi Anna", "RJ"], phone: "9822012345", address: "Pune, Maharashtra", role: "KINGPIN" as GraphRole, score: 88.2 },
  { name: "Imran Shaikh", aliases: ["Chhota", "Chhota Imran"], phone: "9867001122", address: "Mumbai, Maharashtra", role: "BROKER" as GraphRole, score: 62.4 },
  { name: "Gurpreet Singh", aliases: ["Happy"], phone: "9988776655", address: "Ludhiana, Punjab", role: "EXECUTOR" as GraphRole, score: 33.7 },
  { name: "Sunil More", aliases: ["Sunny"], phone: "9876543210", address: "Nashik, Maharashtra", role: "EXECUTOR" as GraphRole, score: 28.1 },
  { name: "Farhan Qureshi", aliases: ["Fairy"], phone: "9765432109", address: "Mumbai, Maharashtra", role: "BROKER" as GraphRole, score: 55.9 },
  { name: "Arjun Deshmukh", aliases: ["DJ"], phone: "9612345678", address: "Pune, Maharashtra", role: "EXECUTOR" as GraphRole, score: 24.5 },
  { name: "Manish Gupta", aliases: ["Mintu"], phone: "9543216780", address: "Nagpur, Maharashtra", role: "BROKER" as GraphRole, score: 47.2 },
  { name: "Sandeep Wagh", aliases: ["Wagh"], phone: "9421122334", address: "Solapur, Maharashtra", role: "EXECUTOR" as GraphRole, score: 30.8 },
];

const CDR_ROWS = [
  ["9876543210", "9867001122", 420, "2024-03-10 10:15:00", "TOWER-004"],
  ["9867001122", "9822012345", 315, "2024-03-10 10:35:00", "TOWER-001"],
  ["9876543210", "9822012345", 95, "2024-03-11 09:20:00", "TOWER-001"],
  ["9765432109", "9867001122", 540, "2024-03-11 22:05:00", "TOWER-007"],
  ["9421122334", "9867001122", 180, "2024-03-12 08:40:00", "TOWER-009"],
  ["9876543210", "9867001122", 260, "2024-03-12 23:10:00", "TOWER-004"],
  ["9867001122", "9822012345", 90, "2024-03-13 07:55:00", "TOWER-001"],
  ["9765432109", "9867001122", 610, "2024-03-13 20:30:00", "TOWER-007"],
  ["9612345678", "9867001122", 130, "2024-03-14 12:45:00", "TOWER-003"],
  ["9822012345", "9612345678", 75, "2024-03-14 13:00:00", "TOWER-001"],
  ["9543216780", "9867001122", 355, "2024-03-15 18:25:00", "TOWER-011"],
  ["9421122334", "9822012345", 210, "2024-03-15 19:10:00", "TOWER-009"],
];

const BANK_TXNS = [
  ["50100234567890", "40110223344556", 48000, "2024-03-10 11:00:00", "NEFT"],
  ["40110223344556", "20120556677889", 45000, "2024-03-10 14:20:00", "IMPS"],
  ["20120556677889", "11029988776655", 44000, "2024-03-10 16:45:00", "UPI"],
  ["11029988776655", "60230099887766", 42000, "2024-03-11 09:30:00", "NEFT"],
  ["60230099887766", "30201112223344", 40000, "2024-03-11 12:10:00", "RTGS"],
  ["50100234567890", "40110223344556", 52000, "2024-03-12 10:00:00", "NEFT"],
  ["40110223344556", "20120556677889", 51000, "2024-03-12 13:15:00", "IMPS"],
  ["20120556677889", "11029988776655", 50000, "2024-03-12 15:40:00", "UPI"],
  ["11029988776655", "60230099887766", 48000, "2024-03-13 09:00:00", "NEFT"],
  ["60230099887766", "30201112223344", 46000, "2024-03-13 11:30:00", "RTGS"],
];

async function main() {
  console.log("Seeding CrimeNetX database…");

  // Idempotent: reset domain tables (users preserved) so re-seeding is clean.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "ModusOperandi", "Dossier", "Alert", "CallRecord", "Transaction",
      "NetworkEdge", "NetworkNode", "Entity", "Evidence", "RefreshToken", "AuditLog",
      "Suspect", "Case" RESTART IDENTITY CASCADE
  `);

  // --- Users -----------------------------------------------------------------
  const users: Record<string, string> = {};
  for (const u of USERS) {
    const existing = await prisma.user.findUnique({
  where: { email: u.email },
});

if (existing) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: {
      passwordHash,
      name: u.name,
      role: u.role,
      department: u.department,
      badgeNumber: u.badgeNumber,
    },
  });

  users[u.role] = updated.id;
  continue;
}
    const created = await prisma.user.create({
      data: { ...u, passwordHash: await bcrypt.hash(PASSWORD, 12) },
    });
    users[u.role] = created.id;
  }
  console.log("  ✓ users (password: Test@1234)");

  // --- Cases -----------------------------------------------------------------
  const investigatorId = users.INVESTIGATOR;
  for (const c of CASES) {
    const existing = await prisma.case.findUnique({ where: { caseNumber: c.caseNumber } });
    if (existing) continue;
    await prisma.case.create({
      data: {
        caseNumber: c.caseNumber,
        title: c.title,
        description: c.description,
        status: c.status,
        priority: c.priority,
        jurisdiction: c.jurisdiction,
        startDate: c.startDate,
        assignedInvestigatorId: investigatorId,
      },
    });
  }
  console.log("  ✓ 5 mock cases");

  // --- Suspects ---------------------------------------------------------------
  for (const s of SUSPECTS) {
    const existing = await prisma.suspect.findFirst({ where: { name: s.name } });
    if (existing) continue;
    await prisma.suspect.create({
      data: {
        name: s.name,
        aliases: s.aliases,
        phoneNumbers: [s.phone],
        address: s.address,
        role: s.role,
        kingpinScore: s.score,
        criminalHistory: ["2018 theft case", "2021 housebreaking"],
      },
    });
  }
  console.log("  ✓ suspects");

  // Link suspects to cases (first case = Pune snatching network)
  const puneCase = await prisma.case.findUnique({ where: { caseNumber: "PUN-2024-0118" } });
  if (puneCase) {
    const suspects = await prisma.suspect.findMany();
    const caseSuspect = await prisma.case.update({
      where: { id: puneCase.id },
      data: { suspects: { connect: suspects.map((s) => ({ id: s.id })) } },
    });
    void caseSuspect;
  }

  // --- CDR rows + transactions (case 1) ----------------------------------------
  if (puneCase) {
    const cdrCount = await prisma.callRecord.count({ where: { caseId: puneCase.id } });
    if (cdrCount === 0) {
      for (const [from, to, dur, time, tower] of CDR_ROWS) {
        await prisma.callRecord.create({
          data: {
            caseId: puneCase.id,
            fromNumber: String(from),
            toNumber: String(to),
            durationSec: dur as number,
            callTime: new Date(time as string),
            cellTower: tower as string,
          },
        });
      }
    }
    const txnCount = await prisma.transaction.count({ where: { caseId: puneCase.id } });
    if (txnCount === 0) {
      for (const [from, to, amt, time, type] of BANK_TXNS) {
        await prisma.transaction.create({
          data: {
            caseId: puneCase.id,
            fromAccount: String(from),
            toAccount: String(to),
            amount: amt as number,
            timestamp: new Date(time as string),
            transactionType: type as string,
            riskScore: 0.7,
          },
        });
      }
    }
    // Entities from FIR
    const entityCount = await prisma.entity.count({ where: { caseId: puneCase.id } });
    if (entityCount === 0) {
      const entitySeed: [EntityType, string][] = [
        ["PERSON", "Ravi Jadhav"],
        ["PERSON", "Imran Shaikh"],
        ["PERSON", "Sunil More"],
        ["PERSON", "Farhan Qureshi"],
        ["PHONE", "9822012345"],
        ["PHONE", "9867001122"],
        ["PHONE", "9876543210"],
        ["VEHICLE", "MH-12-AB-4521"],
        ["BANK_ACCOUNT", "50100234567890"],
        ["LOCATION", "Pune"],
        ["LOCATION", "Nashik"],
        ["ORGANIZATION", "Hinjewadi Police Station"],
      ];
      for (const [type, value] of entitySeed) {
        await prisma.entity.create({
          data: { caseId: puneCase.id, type, value, confidence: 0.9, layer: "seed" },
        });
      }
      // Network nodes + edges from entities (simple layout)
      const entities = await prisma.entity.findMany({ where: { caseId: puneCase.id } });
      const nodeIds: Record<string, string> = {};
      // Backdate node creation times so Time-Machine playback (?upto=) is meaningful.
      const caseStart = new Date("2024-03-10T09:00:00Z");
      for (const [i, e] of entities.entries()) {
        const role =
          e.value === "Ravi Jadhav" ? "KINGPIN"
          : ["Imran Shaikh", "Farhan Qureshi"].includes(e.value) ? "BROKER"
          : "EXECUTOR";
        const score = e.value === "Ravi Jadhav" ? 88.2 : ["Imran Shaikh", "Farhan Qureshi"].includes(e.value) ? 58 : 30;
        nodeIds[e.value] = e.id;
        await prisma.networkNode.create({
          data: {
            id: e.id,
            caseId: puneCase.id,
            entityId: e.id,
            label: e.value,
            x: 100 + (i % 4) * 120,
            y: 80 + Math.floor(i / 4) * 110,
            kingpinScore: score,
            role,
            centrality: { pagerank: 0.1 + i * 0.01, betweenness: 0.05 + i * 0.005 },
            createdAt: new Date(caseStart.getTime() + i * 6 * 3600 * 1000),
          },
        });
      }
      const linkPairs: [string, string, RelationType, string, string][] = [
        ["Ravi Jadhav", "Imran Shaikh", "associate", "Key Syndicate Partner", "Primary operational association between Kingpin Ravi Jadhav and Broker Imran Shaikh for handling local distribution."],
        ["Imran Shaikh", "Sunil More", "phone_call", "14 CDR Calls Exchanged", "Frequent telecommunication exchanges recorded between Imran Shaikh and Sunil More prior to incident."],
        ["Imran Shaikh", "Farhan Qureshi", "associate", "Co-Broker Relationship", "Joint coordination identified between brokers Imran Shaikh and Farhan Qureshi."],
        ["Ravi Jadhav", "Sunil More", "phone_call", "Direct Kingpin Command Calls", "Direct encrypted phone communications logged between Kingpin Ravi Jadhav and executor Sunil More."],
        ["Imran Shaikh", "9822012345", "phone_call", "Registered Phone Line Match", "Imran Shaikh frequently used phone number 9822012345 to coordinate logistics."],
      ];
      for (const [i, [a, b, rel, short, elab]] of linkPairs.entries()) {
        const sa = nodeIds[a];
        const sb = nodeIds[b];
        if (!sa || !sb) continue;
        await prisma.networkEdge.create({
          data: {
            caseId: puneCase.id,
            sourceId: sa,
            targetId: sb,
            relationType: rel,
            weight: 1,
            evidence: "Seeded from FIR statement",
            shortExplanation: short,
            elaboration: elab,
            createdAt: new Date(caseStart.getTime() + (i + 2) * 6 * 3600 * 1000),
          },
        });
      }
    }
    // Alerts
    const alertCount = await prisma.alert.count({ where: { caseId: puneCase.id } });
    if (alertCount === 0) {
      await prisma.alert.createMany({
        data: [
          { caseId: puneCase.id, type: "HIGH_RISK" as AlertType, severity: "CRITICAL" as AlertSeverity, message: "Kingpin candidate identified: Ravi Jadhav (score 88.2)", data: { suspect: "Ravi Jadhav" } },
          { caseId: puneCase.id, type: "LAUNDERING_RISK" as AlertType, severity: "HIGH" as AlertSeverity, message: "5-hop layering chain detected from victim account 50100234567890", data: { hops: 5 } },
          { caseId: puneCase.id, type: "ANOMALY" as AlertType, severity: "MEDIUM" as AlertSeverity, message: "10 anomalous transactions flagged by Isolation Forest", data: { count: 10 } },
          { caseId: puneCase.id, type: "GHOST_LINK" as AlertType, severity: "LOW" as AlertSeverity, message: "Predicted hidden link: Sunil More ↔ Farhan Qureshi (Jaccard 0.77)", data: { source: "Sunil More", target: "Farhan Qureshi" } },
        ],
      });
    }
    // Modus operandi
    await prisma.modusOperandi.upsert({
      where: { caseId: puneCase.id },
      create: {
        caseId: puneCase.id,
        fingerprint: { entry_method: "masked snatching on two-wheelers", tools_used: ["motorcycle", "mask"], time_of_day: "night", target_type: "solo commuter", signature_traits: ["two vehicles", "flee toward Mulshi"] },
        similarCaseIds: ["NASH-2024-0092"],
      },
      update: {},
    });
  }
  console.log("  ✓ CDR / transactions / entities / network / alerts / MO");

  // Try to enrich from backend-ai generated mock data (optional)
  enrichFromGeneratedMockData().catch(() => undefined);

  console.log("Seed complete ✓");
}

/** Optional: load richer mock data produced by backend-ai generator. */
async function enrichFromGeneratedMockData() {
  const candidates = [
    path.join(__dirname, "..", "..", "backend-ai", "data", "generated", "suspects.json"),
    path.join(__dirname, "..", "..", "..", "backend-ai", "data", "generated", "suspects.json"),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) return;
  const profiles = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    id: string;
    name: string;
    aliases: string[];
    dob: string;
    gender: string;
    address: string;
    phoneNumbers: string[];
    photoUrl: string;
    criminalHistory: string[];
    kingpinScore: number;
    role: GraphRole;
  }[];
  for (const p of profiles) {
    const exists = await prisma.suspect.findFirst({ where: { name: p.name } });
    if (exists) continue;
    await prisma.suspect.create({
      data: {
        name: p.name,
        aliases: p.aliases,
        dob: new Date(p.dob),
        gender: p.gender,
        address: p.address,
        phoneNumbers: p.phoneNumbers,
        photoUrl: p.photoUrl,
        criminalHistory: p.criminalHistory,
        kingpinScore: p.kingpinScore,
        role: p.role,
      },
    });
  }
  console.log("  ✓ enriched with generated suspect profiles");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
