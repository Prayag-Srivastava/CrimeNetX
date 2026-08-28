"""Regex-based entity extractors for Indian context (Layer 2 of the NLP pipeline).

Covers: Indian mobile numbers, landlines with STD codes, vehicle registration
plates, bank account numbers / IFSC codes, PAN, Aadhaar-like IDs, email,
and crypto wallets (BTC + ETH).
"""
from __future__ import annotations

import re

# --- Patterns ---------------------------------------------------------------

# Indian mobile: optional +91 / 0, 10 digits starting 6-9
MOBILE_RE = re.compile(r"(?:\+?91[\s-]?|0)?([6-9]\d{9})")

# Landline with STD code: 0XX-XXXXXXX / (0XX) XXXXXXX
LANDLINE_RE = re.compile(r"(?:0\d{2,3})[\s-]?(\d{6,8})")

# Vehicle registration: XX 00 XX 0000 (state code, series, number)
VEHICLE_RE = re.compile(
    r"\b((?:[A-Z]{2})[\s-]?(?:0[1-9]|[1-9][0-9])"
    r"[\s-]?[A-Z]{1,2}[\s-]?\d{1,4})\b",
    re.IGNORECASE,
)

# Bank account: 9-18 digit number appearing near bank/account/a/c keywords
ACCOUNT_RE = re.compile(
    r"(?i)(?:account|a\/c|bank)[^0-9]{0,12}(\d{9,18})"
)

# IFSC code: 4 letters + 0 + 6 digits
IFSC_RE = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")

# PAN: AAAAA9999A
PAN_RE = re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")

# Email
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")

# Bitcoin:
# - Legacy (1...), P2SH (3...), Bech32 (bc1...)
# NOTE: previous bc1[a-zA-09-9] was INVALID — fixed below
BTC_WALLET_RE = re.compile(
    r"\b("
    r"(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34})"   # legacy / P2SH
    r"|"
    r"(?:bc1[a-z0-9]{25,90})"                 # bech32 / bech32m
    r")\b"
)

# Ethereum / EVM-compatible: 0x + 40 hex chars
ETH_WALLET_RE = re.compile(r"\b(0x[a-fA-F0-9]{40})\b")


def extract_phones(text: str) -> list[str]:
    """Return deduplicated normalized Indian phone numbers."""
    nums = [m.group(1) for m in MOBILE_RE.finditer(text)]
    nums += [m.group(1) for m in LANDLINE_RE.finditer(text)]
    return list(dict.fromkeys(nums))  # dedupe, keep order


def extract_vehicles(text: str) -> list[str]:
    return list(
        dict.fromkeys(v.replace(" ", "").replace("-", "").upper() for v in VEHICLE_RE.findall(text))
    )


def extract_bank_accounts(text: str) -> list[str]:
    return list(dict.fromkeys(ACCOUNT_RE.findall(text)))


def extract_ifsc(text: str) -> list[str]:
    return list(dict.fromkeys(IFSC_RE.findall(text)))


def extract_pan(text: str) -> list[str]:
    return list(dict.fromkeys(PAN_RE.findall(text)))


def extract_emails(text: str) -> list[str]:
    return list(dict.fromkeys(EMAIL_RE.findall(text)))


def extract_crypto_wallets(text: str) -> list[str]:
    """
    Return deduplicated crypto wallet addresses as plain strings.
    (NLP layer stores chain metadata separately if needed.)
    """
    wallets: list[str] = []
    wallets += [m.group(1) for m in BTC_WALLET_RE.finditer(text)]
    wallets += [m.group(1) for m in ETH_WALLET_RE.finditer(text)]
    return list(dict.fromkeys(wallets))


def extract_crypto_wallets_detailed(text: str) -> list[dict[str, str]]:
    """Optional helper when you need chain labels for UI / graph attributes."""
    detailed: list[dict[str, str]] = []
    for m in BTC_WALLET_RE.finditer(text):
        detailed.append({"type": "CRYPTO_WALLET", "value": m.group(1), "chain": "BITCOIN"})
    for m in ETH_WALLET_RE.finditer(text):
        detailed.append({"type": "CRYPTO_WALLET", "value": m.group(1), "chain": "ETHEREUM"})

    # Dedupe by value
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for item in detailed:
        if item["value"] not in seen:
            seen.add(item["value"])
            out.append(item)
    return out


def extract_all(text: str) -> dict[str, list[str]]:
    """Run all regex layers and group results."""
    return {
        "phones": extract_phones(text),
        "vehicles": extract_vehicles(text),
        "bank_accounts": extract_bank_accounts(text),
        "ifsc": extract_ifsc(text),
        "pan": extract_pan(text),
        "emails": extract_emails(text),
        "crypto_wallets": extract_crypto_wallets(text),  # CRITICAL — was missing
    }