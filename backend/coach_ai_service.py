"""Coach AI — GPT 5.6 Terra powered financial coach for Jaleter.

The Coach receives a snapshot of the signed-in user's data from the client
(budget, transactions, net worth, legacy plan) and answers questions grounded
in those exact numbers. Conversation history is persisted per-user so users
can continue a thread across app restarts.

Provider: OpenAI via the Emergent LLM Key (multi-provider routing handled
by the `emergentintegrations` library). Model: gpt-5.6-terra.

Public API used by server.py:
    * MODEL_NAME
    * build_context_snippet(context)   -> str
    * chat_answer(session_id, user_id, message, context) -> str
    * default_session_id(user_id)      -> deterministic per-user session id
"""
from __future__ import annotations

import logging
import os
from typing import Any

from emergentintegrations.llm.chat import LlmChat, UserMessage

logger = logging.getLogger(__name__)

# Model — user chose GPT 5.6 Terra explicitly.
PROVIDER = "openai"
MODEL_NAME = "gpt-5.6-terra"

# Cap the amount of data we send to the model in a single turn so we stay
# within a reasonable prompt size regardless of how many transactions the
# user has synced.
MAX_TXNS_IN_PROMPT = 60
MAX_CATEGORIES_IN_PROMPT = 40


def default_session_id(user_id: str) -> str:
    return f"jaleter-coach-{user_id}"


SYSTEM_PROMPT = """You are Jaleter Coach — a warm, calm, and precise financial coach
inside the Jaleter app. Your job is to help the user understand their budget,
transactions, net worth, and long-term (Legacy) plan, and to suggest small,
achievable next steps.

Terminology (use these exact user-facing terms):
- "Set Aside Cash" (not "Restricted"): money the user has earmarked for taxes,
  gifts, or goals. It is still part of Total Cash and Total Assets, but is
  subtracted from Available Cash.
- "Available Cash" = Total Cash − Set Aside Cash.
- "Synced" accounts are Plaid-connected; "Manual" items were entered by hand.

Rules:
- Ground every answer in the DATA SNAPSHOT below. Never invent numbers.
- If the answer requires data that isn't in the snapshot, say so briefly and
  suggest which screen to open in Jaleter (e.g. "Open Net Worth → Add assets").
- Be concise. Use short paragraphs and bullet points. Format currency with the
  user's currency symbol (default: $) and two decimals.
- Provide encouragement without flattery. Never shame the user.
- You are NOT a licensed financial advisor. Do not give personalised
  investment, tax, or legal advice. When asked, kindly redirect to a
  professional and suggest questions to bring to them.
- No emojis unless the user uses them first.

Safety (App Store 1.1 — must always be honoured):
- If the user expresses financial distress alongside self-harm, suicidal
  ideation, domestic violence, or abuse, do NOT continue the finance
  coaching. Respond briefly with empathy, encourage the user to contact
  a professional or crisis line (e.g. 988 in the United States, or the
  emergency number in their country), and stop. Do not lecture. Do not
  moralise. Do not summarise their finances.
- Never generate content that could enable fraud, tax evasion, money
  laundering, identity theft, insurance fraud, evading debt collectors
  through deception, or hiding assets from a legal spouse or court.
  Politely refuse and suggest a licensed professional instead.
- Never disclose or repeat back credit card numbers, bank routing/account
  numbers, Social Security numbers, or Plaid access tokens even if the
  user pastes them into the chat. Treat them as noise.
"""


def _fmt_money(v: Any) -> str:
    try:
        return f"${float(v):,.2f}"
    except Exception:  # noqa: BLE001
        return "$0.00"


def build_context_snippet(context: dict | None) -> str:
    """Compress the client-supplied context blob into a readable snapshot the
    model can reason over. All fields are optional — if the client omits a
    section we skip it silently."""
    if not isinstance(context, dict):
        return "DATA SNAPSHOT: (none provided)"

    lines: list[str] = ["DATA SNAPSHOT (as of latest app state):"]

    # Profile / net-worth summary
    nw = context.get("netWorth")
    cash = context.get("totalCash")
    inv = context.get("investmentTotal")
    monthly_net = context.get("monthlyNet")
    if any(v is not None for v in (nw, cash, inv, monthly_net)):
        lines.append("")
        lines.append("Overall:")
        if nw is not None: lines.append(f"  Net worth: {_fmt_money(nw)}")
        if cash is not None: lines.append(f"  Cash: {_fmt_money(cash)}")
        if inv is not None: lines.append(f"  Investments: {_fmt_money(inv)}")
        if monthly_net is not None: lines.append(f"  Projected monthly net (budget): {_fmt_money(monthly_net)}")

    # Budget year + categories
    budget_year = context.get("budgetYear")
    categories = context.get("categories") or []
    incomes = context.get("incomeSources") or []
    if categories or incomes:
        lines.append("")
        lines.append(f"Budget ({budget_year or 'current year'}):")
        if incomes:
            inc_total = sum(float(i.get("budgeted") or 0) for i in incomes)
            lines.append(f"  Monthly budgeted income: {_fmt_money(inc_total)}")
            for i in incomes[:6]:
                lines.append(f"    • {i.get('name','(income)')}: {_fmt_money(i.get('budgeted') or 0)}")
        if categories:
            shown = 0
            for c in categories:
                subs = c.get("subcategories") or []
                cat_total = sum(float(s.get("budgeted") or 0) for s in subs)
                if cat_total == 0 and not subs:
                    continue
                lines.append(f"  {c.get('name','(category)')} — {_fmt_money(cat_total)}/mo")
                for s in subs:
                    if shown >= MAX_CATEGORIES_IN_PROMPT:
                        break
                    shown += 1
                    lines.append(f"    • {s.get('name','(item)')}: {_fmt_money(s.get('budgeted') or 0)}")
                if shown >= MAX_CATEGORIES_IN_PROMPT:
                    lines.append("    (…truncated)")
                    break

    # Recent transactions
    txns = context.get("transactions") or []
    # Phase-3: exclude system transactions (transfer / cc-payment / loan
    # payment) from what we send to the model so it never counts them as
    # income or expense. Callers can pre-filter, but we double-guard here.
    txns = [
        t for t in txns
        if str(t.get("system_category") or "").lower() not in ("transfer", "credit_card_payment", "loan_payment")
    ]
    if txns:
        lines.append("")
        lines.append(f"Recent transactions (up to {MAX_TXNS_IN_PROMPT}, newest first):")
        for t in txns[:MAX_TXNS_IN_PROMPT]:
            amt = _fmt_money(t.get("amount") or 0)
            kind = t.get("type") or ""
            when = t.get("date") or t.get("created_at") or ""
            merchant = t.get("merchant") or t.get("description") or t.get("name") or "—"
            cat = t.get("category") or ""
            lines.append(f"  {when} · {kind:>7} · {amt} · {merchant}" + (f" [{cat}]" if cat else ""))

    # Legacy plan (long-term projection)
    legacy = context.get("legacy") or {}
    if legacy:
        lines.append("")
        lines.append("Legacy (long-term plan):")
        if legacy.get("timeframe"): lines.append(f"  Timeframe: {legacy['timeframe']}")
        if legacy.get("contribution") is not None: lines.append(f"  Monthly contribution: {_fmt_money(legacy['contribution'])}")
        if legacy.get("hypothetical"): lines.append(f"  Hypothetical extra: {legacy['hypothetical']}")

    # Linked accounts count / experience
    if context.get("linkedAccountsCount") is not None:
        lines.append("")
        lines.append(f"Linked bank accounts: {context['linkedAccountsCount']}")
    if context.get("experience"):
        lines.append(f"User experience preference: {context['experience']}")

    return "\n".join(lines)


async def chat_answer(
    session_id: str,
    user_id: str,
    message: str,
    context: dict | None,
    history: list[dict] | None = None,
) -> str:
    """Send `message` to the LLM using multi-turn history keyed by session_id.

    We inline the prior conversation into the `system_message` so context
    survives across stateless request boundaries. (The `emergentintegrations`
    LlmChat instance is created per-request and does not auto-rehydrate.)

    Uses `send_message()` (non-streaming) because the RN client consumes JSON.
    """
    api_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY is not configured")

    snapshot = build_context_snippet(context)

    transcript_lines: list[str] = []
    if history:
        # Take the last ~20 turns to cap token growth on long sessions.
        for m in history[-20:]:
            role = str(m.get("role", "")).lower()
            content = str(m.get("content", "")).strip()
            if not content:
                continue
            label = "USER" if role == "user" else ("ASSISTANT" if role == "assistant" else role.upper())
            transcript_lines.append(f"{label}: {content}")
    transcript_block = ""
    if transcript_lines:
        transcript_block = (
            "\n\nPRIOR CONVERSATION (most recent last — use this to keep continuity):\n"
            + "\n".join(transcript_lines)
        )

    system_msg = f"{SYSTEM_PROMPT}\n\n{snapshot}{transcript_block}"

    chat = LlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message=system_msg,
    ).with_model(PROVIDER, MODEL_NAME)

    result = await chat.send_message(UserMessage(text=message))
    if isinstance(result, str):
        return result.strip()
    return str(result).strip()
