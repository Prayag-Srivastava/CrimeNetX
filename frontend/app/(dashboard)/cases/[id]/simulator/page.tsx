"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ShieldCheck,
  Clock,
  FileText,
  RefreshCw,
  Zap,
  MapPin,
  Info,
  User2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";

/* ================================================================
   HELPERS
================================================================ */

const PHONE_RE = /^\+?\d[\d\s-]{7,}$/;
const PLATE_RE = /\b[A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{1,2}[-\s]?\d{1,4}\b/i;
const WALLET_RE = /^(0x[a-fA-F0-9]{6,}|bc1[a-z0-9]{6,}|[13][a-km-zA-HJ-NP-Z1-9]{10,})/;
const ACCOUNT_RE = /^\d{9,18}$/;

type ActorKind = "person" | "phone" | "vehicle" | "wallet" | "account";

interface ClassifiedActor {
  raw: string;
  label: string;
  kind: ActorKind;
  color: string;
}

function classifyActor(raw: string, i: number): ClassifiedActor {
  const s = (raw || "").toString().trim();
  const palette = ["#34d399", "#fbbf24", "#60a5fa", "#f472b6", "#a78bfa", "#f97316"];
  const color = palette[i % palette.length]!;

  if (!s) return { raw: "Unknown", label: "Unknown", kind: "person", color };
  if (PLATE_RE.test(s))
    return { raw: s, label: s.toUpperCase().replace(/\s+/g, ""), kind: "vehicle", color: "#f59e0b" };
  if (WALLET_RE.test(s))
    return { raw: s, label: s.slice(0, 10) + "…", kind: "wallet", color: "#a855f7" };
  if (ACCOUNT_RE.test(s))
    return { raw: s, label: "A/C " + s.slice(-4), kind: "account", color: "#22d3ee" };
  if (PHONE_RE.test(s))
    return { raw: s, label: s.replace(/\s+/g, ""), kind: "phone", color: "#38bdf8" };
  const nameLabel = s.length > 16 ? s.slice(0, 14) + "…" : s;
  return { raw: s, label: nameLabel, kind: "person", color };
}

function classifyActors(list: string[] = []): ClassifiedActor[] {
  const seen = new Set<string>();
  const out: ClassifiedActor[] = [];
  list.forEach((a, i) => {
    const key = String(a || "").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(classifyActor(a, out.length));
  });
  return out;
}

function padActorsToMinimum(actors: ClassifiedActor[], min: number, prefix = "Suspect") {
  const persons = actors.filter((a) => a.kind === "person");
  const others = actors.filter((a) => a.kind !== "person");
  const palette = ["#34d399", "#fbbf24", "#60a5fa", "#f472b6", "#a78bfa"];
  const needed = Math.max(0, min - persons.length);
  const filler: ClassifiedActor[] = Array.from({ length: needed }).map((_, i) => ({
    raw: `${prefix} ${String.fromCharCode(65 + persons.length + i)}`,
    label: `${prefix} ${String.fromCharCode(65 + persons.length + i)}`,
    kind: "person",
    color: palette[(persons.length + i) % palette.length]!,
  }));
  return [...persons, ...filler, ...others];
}

function labelPill(x: number, y: number, text: string, color = "#e2e8f0") {
  const width = Math.max(38, Math.min(120, text.length * 6.4 + 12));
  return (
    <g transform={`translate(${x - width / 2}, ${y})`}>
      <rect width={width} height={16} rx={4} fill="rgba(2,6,23,0.85)" stroke="rgba(148,163,184,0.35)" />
      <text
        x={width / 2}
        y={11}
        textAnchor="middle"
        fill={color}
        fontSize="10"
        fontFamily="ui-monospace, monospace"
      >
        {text}
      </text>
    </g>
  );
}

/* ================================================================
   ATOMS: Person / Vehicle / Phone / Wallet / Victim
================================================================ */

function StickPerson({
  actor,
  x,
  y,
  delay = 0,
  masked = false,
  weapon = false,
}: {
  actor: ClassifiedActor;
  x: number;
  y: number;
  delay?: number;
  masked?: boolean;
  weapon?: boolean;
}) {
  const c = actor.color;
  return (
    <motion.g
      initial={{ opacity: 0, y: y + 14 }}
      animate={{ opacity: 1, y }}
      transition={{ delay, duration: 0.5 }}
    >
      {/* head */}
      <circle cx={x} cy={y - 32} r={8} fill={c} />
      {masked && <rect x={x - 8} y={y - 34} width={16} height={5} fill="#0f172a" />}
      {/* body */}
      <line x1={x} y1={y - 24} x2={x} y2={y - 2} stroke={c} strokeWidth={3} strokeLinecap="round" />
      {/* arms */}
      <line x1={x} y1={y - 18} x2={x - 12} y2={y - 8} stroke={c} strokeWidth={3} strokeLinecap="round" />
      <line x1={x} y1={y - 18} x2={x + 12} y2={y - 8} stroke={c} strokeWidth={3} strokeLinecap="round" />
      {/* weapon */}
      {weapon && (
        <line x1={x + 12} y1={y - 8} x2={x + 24} y2={y - 16} stroke="#f87171" strokeWidth={3} strokeLinecap="round" />
      )}
      {/* legs */}
      <line x1={x} y1={y - 2} x2={x - 10} y2={y + 16} stroke={c} strokeWidth={3} strokeLinecap="round" />
      <line x1={x} y1={y - 2} x2={x + 10} y2={y + 16} stroke={c} strokeWidth={3} strokeLinecap="round" />
      {/* label */}
      {labelPill(x, y + 22, actor.label, c)}
    </motion.g>
  );
}

function VictimPerson({ x, y }: { x: number; y: number }) {
  return (
    <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
      <circle cx={x} cy={y - 32} r={8} fill="#e2e8f0" />
      <line x1={x} y1={y - 24} x2={x} y2={y - 2} stroke="#e2e8f0" strokeWidth={3} strokeLinecap="round" />
      <line x1={x} y1={y - 18} x2={x - 12} y2={y - 8} stroke="#e2e8f0" strokeWidth={3} strokeLinecap="round" />
      <line x1={x} y1={y - 18} x2={x + 12} y2={y - 8} stroke="#e2e8f0" strokeWidth={3} strokeLinecap="round" />
      <line x1={x} y1={y - 2} x2={x - 10} y2={y + 16} stroke="#e2e8f0" strokeWidth={3} strokeLinecap="round" />
      <line x1={x} y1={y - 2} x2={x + 10} y2={y + 16} stroke="#e2e8f0" strokeWidth={3} strokeLinecap="round" />
      {/* gold chain */}
      <motion.circle
        cx={x} cy={y - 20} r={3} fill="#facc15"
        animate={{ y: [y - 20, y + 4, y - 20] }} transition={{ duration: 2, repeat: Infinity }}
      />
      {labelPill(x, y + 22, "Victim", "#e2e8f0")}
    </motion.g>
  );
}

function VehicleIcon({ actor, x, y, animateMove = false }: { actor: ClassifiedActor; x: number; y: number; animateMove?: boolean }) {
  return (
    <motion.g
      initial={{ x: animateMove ? -80 : 0, opacity: 0 }}
      animate={{ x: animateMove ? 260 : 0, opacity: 1 }}
      transition={
        animateMove
          ? { duration: 3.2, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.4 }
          : { duration: 0.4 }
      }
    >
      <g transform={`translate(${x}, ${y})`}>
        <rect x={-40} y={-14} width={80} height={26} rx={6} fill="#f59e0b" />
        <rect x={-28} y={-26} width={40} height={14} rx={4} fill="#fde68a" />
        <circle cx={-25} cy={16} r={7} fill="#0f172a" stroke="#94a3b8" strokeWidth={2} />
        <circle cx={22} cy={16} r={7} fill="#0f172a" stroke="#94a3b8" strokeWidth={2} />
        {labelPill(0, 26, actor.label, "#fde68a")}
      </g>
    </motion.g>
  );
}

function PhoneIcon({ actor, x, y }: { actor: ClassifiedActor; x: number; y: number }) {
  return (
    <motion.g initial={{ opacity: 0, y: y + 8 }} animate={{ opacity: 1, y }} transition={{ duration: 0.4 }}>
      <rect x={x - 12} y={y - 22} width={24} height={40} rx={4} fill="#0f172a" stroke="#38bdf8" strokeWidth={2} />
      <rect x={x - 9} y={y - 18} width={18} height={26} rx={2} fill="#164e63" />
      {labelPill(x, y + 22, actor.label, "#7dd3fc")}
    </motion.g>
  );
}

function WalletIcon({ actor, x, y }: { actor: ClassifiedActor; x: number; y: number }) {
  return (
    <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <rect x={x - 22} y={y - 16} width={44} height={30} rx={4} fill="#1e1b4b" stroke="#a855f7" strokeWidth={2} />
      <text x={x} y={y + 4} textAnchor="middle" fill="#c4b5fd" fontSize="14" fontWeight="700">₿</text>
      {labelPill(x, y + 22, actor.label, "#c4b5fd")}
    </motion.g>
  );
}

function AccountIcon({ actor, x, y }: { actor: ClassifiedActor; x: number; y: number }) {
  return (
    <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <rect x={x - 22} y={y - 16} width={44} height={30} rx={4} fill="#083344" stroke="#22d3ee" strokeWidth={2} />
      <text x={x} y={y + 4} textAnchor="middle" fill="#67e8f9" fontSize="12" fontWeight="700">🏦</text>
      {labelPill(x, y + 22, actor.label, "#67e8f9")}
    </motion.g>
  );
}

/* Auto-render any actor with proper icon and position */
function AutoActor({ actor, x, y, delay = 0, masked = false, weapon = false }: any) {
  if (actor.kind === "vehicle") return <VehicleIcon actor={actor} x={x} y={y} />;
  if (actor.kind === "phone") return <PhoneIcon actor={actor} x={x} y={y} />;
  if (actor.kind === "wallet") return <WalletIcon actor={actor} x={x} y={y} />;
  if (actor.kind === "account") return <AccountIcon actor={actor} x={x} y={y} />;
  return <StickPerson actor={actor} x={x} y={y} delay={delay} masked={masked} weapon={weapon} />;
}

/* ================================================================
   SCENES (all responsive, safe padding, minimum crew)
================================================================ */

const VB = { w: 640, h: 320, padX: 60, floorY: 250 };

function Background({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <defs>
        <linearGradient id="skyGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#0b1220" />
          <stop offset="100%" stopColor="#020617" />
        </linearGradient>
      </defs>
      <rect width={VB.w} height={VB.h} fill="url(#skyGrad)" />
      {Array.from({ length: 28 }).map((_, i) => (
        <circle key={i} cx={(i * 41) % VB.w} cy={(i * 17) % 90} r="1" fill="#334155" />
      ))}
      <rect x="0" y={VB.floorY} width={VB.w} height={VB.h - VB.floorY} fill="#0f172a" />
      {children}
    </>
  );
}

function positionsAcross(count: number) {
  const startX = VB.padX + 20;
  const endX = VB.w - VB.padX - 20;
  if (count === 1) return [(startX + endX) / 2];
  const step = (endX - startX) / (count - 1);
  return Array.from({ length: count }, (_, i) => startX + step * i);
}

function SceneAssembly({ actors }: { actors: ClassifiedActor[] }) {
  const crew = padActorsToMinimum(actors, 3);
  const persons = crew.filter((a) => a.kind === "person").slice(0, 5);
  const xs = positionsAcross(persons.length);

  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <Background />
      {/* safe house */}
      <rect x="180" y="70" width="280" height="180" rx="6" fill="#111827" stroke="#334155" strokeWidth="2" />
      <polygon points="170,70 320,20 470,70" fill="#1e293b" stroke="#475569" strokeWidth="2" />
      <rect x="290" y="170" width="60" height="80" rx="3" fill="#0f172a" stroke="#10b981" strokeWidth="1.5" />
      <motion.rect x="210" y="110" width="46" height="34" rx="2" fill="#064e3b"
        animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }} />
      <motion.rect x="384" y="110" width="46" height="34" rx="2" fill="#064e3b"
        animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity }} />
      <text x={VB.w / 2} y={55} textAnchor="middle" fill="#34d399" fontSize="12" fontFamily="monospace">
        ⚑ SAFE HOUSE / PLANNING BRIEFING
      </text>

      {persons.map((a, i) => (
        <AutoActor key={i} actor={a} x={xs[i]} y={230} delay={0.1 * i} />
      ))}
    </svg>
  );
}

function ScenePhoneCall({ actors }: { actors: ClassifiedActor[] }) {
  const people = actors.filter((a) => a.kind === "person");
  const phones = actors.filter((a) => a.kind === "phone");
  const A = people[0] || classifyActor("Caller", 0);
  const B = people[1] || classifyActor("Receiver", 1);
  const P1 = phones[0];
  const P2 = phones[1];

  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <Background />
      {/* towers */}
      <rect x="80" y="100" width="10" height="150" fill="#334155" />
      <rect x="550" y="100" width="10" height="150" fill="#334155" />
      <motion.circle cx="85" cy="95" r="8" fill="#3b82f6"
        animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }} />
      <motion.circle cx="555" cy="95" r="8" fill="#3b82f6"
        animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />

      <AutoActor actor={A} x={160} y={230} delay={0.1} />
      <AutoActor actor={B} x={480} y={230} delay={0.2} />
      {P1 && <PhoneIcon actor={P1} x={220} y={200} />}
      {P2 && <PhoneIcon actor={P2} x={420} y={200} />}

      {[0, 1, 2].map((i) => (
        <motion.path
          key={i}
          d={`M 220 160 Q ${VB.w / 2} ${120 - i * 12} 420 160`}
          fill="none" stroke="#22d3ee" strokeWidth="2" strokeDasharray="6 6"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.3, repeat: Infinity, delay: i * 0.25 }}
        />
      ))}

      <motion.g initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.3 }}>
        <rect x={VB.w / 2 - 40} y="110" width="80" height="30" rx="15" fill="#0ea5e9" />
        <text x={VB.w / 2} y="130" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700">
          📞 CALL
        </text>
      </motion.g>

      <text x={VB.w / 2} y={40} textAnchor="middle" fill="#38bdf8" fontSize="12" fontFamily="monospace">
        📡 ENCRYPTED COORDINATION CALL
      </text>
    </svg>
  );
}

function SceneTravel({ actors }: { actors: ClassifiedActor[] }) {
  const vehicle =
    actors.find((a) => a.kind === "vehicle") || classifyActor("Vehicle", 0);
  const persons = actors.filter((a) => a.kind === "person").slice(0, 3);

  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width={VB.w} height="200" fill="#020617" />
      <rect x="0" y="200" width={VB.w} height="120" fill="#111827" />
      <motion.line x1="0" y1="260" x2={VB.w} y2="260"
        stroke="#fbbf24" strokeWidth="3" strokeDasharray="20 16"
        animate={{ strokeDashoffset: [0, -36] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />

      {/* skyline buildings */}
      {[40, 130, 220, 420, 520].map((x, i) => (
        <rect key={i} x={x} y={110 + (i % 2) * 15} width={60 - (i % 2) * 15} height={90 - (i % 2) * 10} fill={i % 2 ? "#334155" : "#1e293b"} />
      ))}
      <text x={VB.w / 2} y={40} textAnchor="middle" fill="#94a3b8" fontSize="12" fontFamily="monospace">
        🚗 EN-ROUTE TO TARGET
      </text>

      <VehicleIcon actor={vehicle} x={80} y={230} animateMove />

      {/* Crew badges at bottom */}
      {persons.map((p, i) => (
        <g key={i} transform={`translate(${VB.padX + i * 130}, 290)`}>
          <rect width="120" height="20" rx="4" fill="rgba(2,6,23,0.85)" stroke="rgba(148,163,184,0.4)" />
          <text x="60" y="14" textAnchor="middle" fill={p.color} fontSize="10" fontFamily="ui-monospace, monospace">
            👤 {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function SceneBreach({ actors }: { actors: ClassifiedActor[] }) {
  const crew = padActorsToMinimum(actors, 3);
  const persons = crew.filter((a) => a.kind === "person").slice(0, 4);
  const xs = positionsAcross(persons.length).map((x) => x - 140); // shift left of building

  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <Background />
      {/* target building */}
      <rect x="340" y="60" width="220" height="200" fill="#1e293b" stroke="#ef4444" strokeWidth="2" />
      {[0, 1, 2].map((i) =>
        [0, 1].map((j) => (
          <motion.rect
            key={`${i}${j}`}
            x={360 + i * 60} y={80 + j * 50} width="40" height="30" fill="#450a0a"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.5 + i * 0.3, repeat: Infinity }}
          />
        ))
      )}
      <rect x="420" y="200" width="60" height="60" fill="#0f172a" stroke="#f87171" strokeWidth="1.5" />
      <text x="450" y="50" textAnchor="middle" fill="#f87171" fontSize="12" fontFamily="monospace">
        ⚠ TARGET BREACH
      </text>

      {/* victim near shop */}
      <VictimPerson x={300} y={230} />

      {/* attackers approach */}
      <motion.g animate={{ x: [0, 60, 0] }} transition={{ duration: 2, repeat: Infinity }}>
        {persons.map((a, i) => (
          <AutoActor key={i} actor={{ ...a, color: ["#ef4444", "#f97316", "#f59e0b", "#dc2626"][i] }} x={80 + i * 55} y={230} delay={i * 0.1} masked weapon={i === 0} />
        ))}
      </motion.g>

      {/* shock lines on victim */}
      {[0, 1, 2, 3].map((i) => (
        <motion.line
          key={i}
          x1="300" y1="200" x2={300 + Math.cos((i * Math.PI) / 2) * 25} y2={200 + Math.sin((i * Math.PI) / 2) * 25}
          stroke="#f87171" strokeWidth="2"
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}

      <motion.circle
        cx="450" cy="160" r="20" fill="none" stroke="#ef4444" strokeWidth="2"
        animate={{ r: [16, 45], opacity: [0.9, 0] }}
        transition={{ duration: 1.2, repeat: Infinity }}
      />
    </svg>
  );
}

function SceneMoneyTransfer({ actors }: { actors: ClassifiedActor[] }) {
  const walletActor = actors.find((a) => a.kind === "wallet") || classifyActor("0xExitWallet", 0);
  const accountActor = actors.find((a) => a.kind === "account") || classifyActor("500123456", 0);
  const handler = actors.find((a) => a.kind === "person") || classifyActor("Mule Handler", 0);

  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <Background />
      {/* Source */}
      <rect x="70" y="120" width="130" height="80" rx="10" fill="#1e293b" stroke="#34d399" strokeWidth="2" />
      <text x="135" y="160" textAnchor="middle" fill="#34d399" fontSize="14" fontWeight="700">🏦 SOURCE BANK</text>
      <text x="135" y="180" textAnchor="middle" fill="#94a3b8" fontSize="10">Victim Account</text>

      {/* Mules row */}
      {[240, 330, 420].map((x, i) => (
        <g key={i}>
          <rect x={x - 22} y="150" width="44" height="30" rx="4" fill="#083344" stroke="#22d3ee" strokeWidth="1.5" />
          <text x={x} y="170" textAnchor="middle" fill="#67e8f9" fontSize="10" fontWeight="700">MULE {i + 1}</text>
        </g>
      ))}

      {/* flow lines */}
      <motion.line x1="200" y1="160" x2="240" y2="160" stroke="#fbbf24" strokeWidth="3" strokeDasharray="8 6"
        animate={{ strokeDashoffset: [0, -28] }} transition={{ duration: 0.6, repeat: Infinity, ease: "linear" }} />
      <motion.line x1="280" y1="160" x2="310" y2="160" stroke="#fbbf24" strokeWidth="3" strokeDasharray="8 6"
        animate={{ strokeDashoffset: [0, -28] }} transition={{ duration: 0.6, repeat: Infinity, ease: "linear" }} />
      <motion.line x1="370" y1="160" x2="400" y2="160" stroke="#fbbf24" strokeWidth="3" strokeDasharray="8 6"
        animate={{ strokeDashoffset: [0, -28] }} transition={{ duration: 0.6, repeat: Infinity, ease: "linear" }} />
      <motion.line x1="440" y1="160" x2="490" y2="160" stroke="#a855f7" strokeWidth="3" strokeDasharray="8 6"
        animate={{ strokeDashoffset: [0, -28] }} transition={{ duration: 0.6, repeat: Infinity, ease: "linear" }} />

      {/* moving money dots */}
      {[0, 1, 2, 3].map((i) => (
        <motion.circle
          key={i}
          cy="160" r="6" fill="#f59e0b"
          initial={{ cx: 210, opacity: 0 }}
          animate={{ cx: [210, 500], opacity: [0, 1, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}
        />
      ))}

      {/* Exit wallet */}
      <rect x="500" y="120" width="90" height="80" rx="10" fill="#1e1b4b" stroke="#a855f7" strokeWidth="2" />
      <text x="545" y="160" textAnchor="middle" fill="#c4b5fd" fontSize="14" fontWeight="700">₿ EXIT</text>
      <text x="545" y="180" textAnchor="middle" fill="#94a3b8" fontSize="10">{walletActor.label}</text>

      <text x={VB.w / 2} y={40} textAnchor="middle" fill="#f87171" fontSize="12" fontFamily="monospace">
        ⚠ MONEY LAYERING → CRYPTO EXIT
      </text>

      {/* handler stick figure */}
      <AutoActor actor={handler} x={VB.w / 2} y={240} />
    </svg>
  );
}

function SceneSurveillance({ actors }: { actors: ClassifiedActor[] }) {
  const observer = actors.find((a) => a.kind === "person") || classifyActor("Observer", 0);
  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <Background />
      <rect x="380" y="120" width="180" height="120" fill="#1e293b" stroke="#f87171" />
      <text x="470" y="180" textAnchor="middle" fill="#f87171" fontSize="12" fontFamily="monospace">TARGET</text>

      <AutoActor actor={observer} x={120} y={230} />
      <motion.path
        d={`M 140 200 L 380 130 L 380 240 Z`}
        fill="rgba(168,85,247,0.15)" stroke="#a78bfa" strokeDasharray="4 4"
        animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.5, repeat: Infinity }}
      />
      <motion.circle cx="380" cy="185" r="6" fill="#a78bfa"
        animate={{ r: [4, 12, 4] }} transition={{ duration: 1.2, repeat: Infinity }} />
      <text x={VB.w / 2} y={40} textAnchor="middle" fill="#a78bfa" fontSize="12" fontFamily="monospace">
        🔍 SURVEILLANCE / RECON
      </text>
    </svg>
  );
}

function SceneEscape({ actors }: { actors: ClassifiedActor[] }) {
  const persons = actors.filter((a) => a.kind === "person").slice(0, 3);
  const list = persons.length ? persons : [classifyActor("Suspect", 0)];
  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <Background />
      <motion.line x1="0" y1={VB.floorY + 20} x2={VB.w} y2={VB.floorY + 20}
        stroke="#f87171" strokeWidth="3" strokeDasharray="16 10"
        animate={{ strokeDashoffset: [0, -32] }} transition={{ duration: 0.6, repeat: Infinity, ease: "linear" }} />
      <text x={VB.w / 2} y={40} textAnchor="middle" fill="#f87171" fontSize="12" fontFamily="monospace">
        🏃 ESCAPE / DISPERSAL
      </text>
      <motion.g initial={{ x: 20 }} animate={{ x: 300 }}
        transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}>
        {list.map((a, i) => (
          <AutoActor key={i} actor={{ ...a, color: ["#ef4444", "#f97316", "#f59e0b"][i] }} x={80 + i * 55} y={230} delay={i * 0.1} />
        ))}
      </motion.g>
    </svg>
  );
}

function SceneArrest({ actors }: { actors: ClassifiedActor[] }) {
  const suspect = actors.find((a) => a.kind === "person") || classifyActor("Suspect", 0);
  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <Background />
      <motion.rect x="90" y="90" width="160" height="100" rx="6" fill="#1e40af"
        animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.2, repeat: Infinity }} />
      <text x="170" y="150" textAnchor="middle" fill="#dbeafe" fontSize="13" fontWeight="700">POLICE UNIT</text>

      <AutoActor actor={classifyActor("Officer", 0)} x={220} y={240} />
      <AutoActor actor={{ ...suspect, color: "#ef4444" }} x={400} y={240} />

      <motion.line x1="240" y1="220" x2="380" y2="220"
        stroke="#60a5fa" strokeWidth="2" strokeDasharray="6 6"
        animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }} />
      <text x={VB.w / 2} y={40} textAnchor="middle" fill="#60a5fa" fontSize="12" fontFamily="monospace">
        🚔 ARREST / DETENTION
      </text>
    </svg>
  );
}

function SceneGeneric({ actors, location }: { actors: ClassifiedActor[]; location?: string }) {
  const list = actors.slice(0, 4);
  const xs = positionsAcross(Math.max(1, list.length));
  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <Background />
      <motion.circle cx={VB.w / 2} cy={140} r={16} fill="#10b981"
        animate={{ r: [12, 26, 12] }} transition={{ duration: 1.5, repeat: Infinity }} />
      <text x={VB.w / 2} y={200} textAnchor="middle" fill="#94a3b8" fontSize="13">
        {location || "Incident Location"}
      </text>
      {list.map((a, i) => (
        <AutoActor key={i} actor={a} x={xs[i]} y={240} delay={i * 0.1} />
      ))}
    </svg>
  );
}

function VisualScene({
  actionType,
  actors,
  location,
}: {
  actionType?: string;
  actors: ClassifiedActor[];
  location?: string;
}) {
  const t = (actionType || "").toLowerCase();
  if (/assembly|meet|plan/.test(t)) return <SceneAssembly actors={actors} />;
  if (/phone|call|cdr|communicat/.test(t)) return <ScenePhoneCall actors={actors} />;
  if (/surveill|recon|watch|observe/.test(t)) return <SceneSurveillance actors={actors} />;
  if (/travel|move|route|transit/.test(t)) return <SceneTravel actors={actors} />;
  if (/breach|attack|snatch|robbery|execution|assault/.test(t)) return <SceneBreach actors={actors} />;
  if (/money|transfer|launder|financial|crypto|payment/.test(t)) return <SceneMoneyTransfer actors={actors} />;
  if (/escape|flee|abscond|disappear/.test(t)) return <SceneEscape actors={actors} />;
  if (/arrest|detain|apprehend/.test(t)) return <SceneArrest actors={actors} />;
  return <SceneGeneric actors={actors} location={location} />;
}

/* ================================================================
   PAGE
================================================================ */

function riskColor(level?: string) {
  const l = (level || "").toUpperCase();
  if (l === "CRITICAL") return "text-red-400 border-red-500/40 bg-red-500/10";
  if (l === "HIGH") return "text-orange-400 border-orange-500/40 bg-orange-500/10";
  if (l === "MEDIUM") return "text-amber-400 border-amber-500/40 bg-amber-500/10";
  return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
}

export default function ExecutionSimulatorPage() {
  const params = useParams();
  const caseId = params?.id as string;
  const [loading, setLoading] = useState(true);
  const [simulation, setSimulation] = useState<any>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get(`/cases/${caseId}/simulation`);
      if (res.data?.simulation) {
        setSimulation(res.data.simulation);
        setIdx(0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (caseId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  useEffect(() => {
    if (!playing || !simulation?.steps) return;
    const t = setInterval(() => {
      setIdx((p) => {
        if (p >= simulation.steps.length - 1) {
          setPlaying(false);
          return p;
        }
        return p + 1;
      });
    }, 4000);
    return () => clearInterval(t);
  }, [playing, simulation]);

  const steps = simulation?.steps || [];
  const active = steps[idx] || {};
  const actors = useMemo(() => classifyActors(active.actors || []), [active.actors]);
  const progressPct = steps.length ? ((idx + 1) / steps.length) * 100 : 0;

  if (loading) {
    return (
      <div className="p-8 text-slate-400 font-mono flex items-center gap-2">
        <Clock className="animate-spin h-5 w-5 text-emerald-500" />
        Reconstructing crime scene using AI…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 text-white bg-slate-950 min-h-screen">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-emerald-400 flex items-center gap-2">
            🎬 2.5D Crime Execution Simulator
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">
            {simulation?.crime_type ? `${simulation.crime_type} • ` : ""}
            {simulation?.total_duration ? `${simulation.total_duration} • ` : ""}
            AI-reconstructed visual playback
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-full text-xs text-emerald-400 font-mono">
            <ShieldCheck className="h-4 w-4" /> AI Verified Reconstruction
          </div>
          <Button size="sm" variant="outline" onClick={load} className="border-slate-700 text-slate-200">
            <RefreshCw className="h-4 w-4 mr-1" /> Regenerate
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      {simulation?.summary && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300 leading-relaxed">
          <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-mono mb-1">
            Executive Reconstruction Summary
          </div>
          {simulation.summary}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6 h-[640px]">
        {/* LEFT SCENE */}
        <div className="col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden">
          <div className="flex justify-between text-xs font-mono text-slate-400">
            <span>TACTICAL VISUAL SCENE</span>
            <span className="text-emerald-400">
              STEP {steps.length ? idx + 1 : 0} OF {steps.length}
            </span>
          </div>

          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <motion.div className="h-full bg-emerald-500" animate={{ width: `${progressPct}%` }} transition={{ duration: 0.4 }} />
          </div>

          <div className="flex-1 rounded-xl border border-slate-800 bg-[#020617] overflow-hidden relative min-h-[380px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={idx}
                className="absolute inset-0"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                transition={{ duration: 0.35 }}
              >
                <VisualScene actionType={active.action_type} actors={actors} location={active.location_name} />
              </motion.div>
            </AnimatePresence>

            {/* Top overlay */}
            <div className="absolute top-3 left-3 right-3 flex justify-between pointer-events-none">
              <div className="bg-slate-950/85 border border-slate-700 rounded-lg px-3 py-2 max-w-[70%]">
                <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-mono">
                  {active.action_type || "EVENT"}
                </div>
                <div className="text-sm font-semibold text-white truncate">{active.title || "Step"}</div>
                <div className="text-[11px] text-slate-400 flex items-center gap-1 truncate">
                  <MapPin className="h-3 w-3 text-emerald-400" /> {active.location_name}
                </div>
              </div>
              {active.risk_level && (
                <div className={`border rounded-lg px-3 py-1.5 text-[10px] font-mono h-fit ${riskColor(active.risk_level)}`}>
                  RISK: {active.risk_level}
                </div>
              )}
            </div>

            {/* Bottom overlay */}
            <div className="absolute bottom-3 left-3 right-3 bg-slate-950/85 border border-slate-800 rounded-lg px-3 py-2">
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-emerald-400">⏱ {active.time_label}</span>
                <span className="text-slate-400 flex items-center gap-1">
                  <Info className="h-3 w-3" /> {active.evidence_source}
                </span>
              </div>
              <div className="text-xs text-slate-300 mt-1 line-clamp-2">{active.description}</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {actors.slice(0, 6).map((a, i) => (
                  <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700" style={{ color: a.color }}>
                    <User2 className="inline h-3 w-3 mr-1" />
                    {a.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex items-center justify-between">
            <span className="font-mono text-sm text-emerald-400 font-bold">⏱ {active.time_label || "--:--"}</span>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" onClick={() => setIdx((p) => Math.max(0, p - 1))} disabled={idx === 0} className="border-slate-800">
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button size="sm" onClick={() => setPlaying(!playing)} className="bg-emerald-600 hover:bg-emerald-500 font-bold px-6">
                {playing ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                {playing ? "PAUSE" : "PLAY"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIdx((p) => Math.min(steps.length - 1, p + 1))} disabled={idx >= steps.length - 1} className="border-slate-800">
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>
            <span className="text-xs font-mono text-slate-500">4s / Step</span>
          </div>
        </div>

        {/* RIGHT STEP LOG */}
        <div className="col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-y-auto space-y-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-emerald-400" /> Execution Log Sequence
          </h2>

          {steps.map((step: any, i: number) => {
            const isActive = i === idx;
            return (
              <div
                key={i}
                onClick={() => { setIdx(i); setPlaying(false); }}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                  isActive
                    ? "bg-slate-950 border-emerald-500 shadow-lg shadow-emerald-500/10"
                    : "bg-slate-950/40 border-slate-800/80 hover:border-slate-700 opacity-70"
                }`}
              >
                <div className="flex justify-between items-center text-xs font-mono mb-1">
                  <span className={isActive ? "text-emerald-400 font-bold" : "text-slate-400"}>
                    Phase {step.step_number} · {step.time_label}
                  </span>
                  <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${riskColor(step.risk_level)}`}>
                    {step.action_type}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-slate-200">{step.title}</h3>
                <p className="text-xs text-slate-400 mt-1 line-clamp-3">{step.description}</p>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                    <FileText className="h-3 w-3 text-emerald-500" /> {step.evidence_source}
                  </div>
                  {typeof step.confidence === "number" && (
                    <div className="text-[10px] font-mono text-emerald-400">conf {(step.confidence * 100).toFixed(0)}%</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}