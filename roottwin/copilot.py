"""T24 - LLM copilot with retrieval over the repair manuals (RAG).

Answers "why?" and "what do I do?" for an alert, ONLY from docs/manuals/*.md:
1. retrieval: BM25 over manual sections, boosted for the fault codes the
   diagnosis/explanation proposes (no vector DB needed for 11 short manuals);
2. generation:
   - with Anthropic credentials (ANTHROPIC_API_KEY ...): Claude Opus 5.5 writes the
     answer from the retrieved excerpts and must cite them as [FAULT_CODE §Section];
   - without credentials: extractive mode, returns the relevant sections verbatim
     (the demo never depends on the network);
3. guardrail: every answer must cite at least one retrieved section and may cite
   nothing else; otherwise it is blocked ("no source, no answer").
"""
from __future__ import annotations

import math
import os
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

MANUALS = Path(__file__).resolve().parents[1] / "docs" / "manuals"
MODEL = "claude-opus-5-5"
CITE = re.compile(r"\[([A-Z_]+) §([^\]]+)\]")
_WORD = re.compile(r"[a-z0-9]+")
_STOP = set("the a an of to and or in on for is are be with at by it this that as from if not no do i my what why how "
            "should we you can".split())


@dataclass
class Chunk:
    fault_code: str
    section: str
    text: str

    @property
    def ref(self) -> str:
        return f"[{self.fault_code} §{self.section}]"


def _tokens(s: str) -> list[str]:
    return [w for w in _WORD.findall(s.lower()) if w not in _STOP]


def load_chunks(folder: Path = MANUALS) -> list[Chunk]:
    chunks = []
    for path in sorted(folder.glob("*.md")):
        code = path.stem
        header, *sections = re.split(r"^## ", path.read_text(encoding="utf-8"), flags=re.M)
        meta = header.split("\n", 2)[-1].strip()
        chunks.append(Chunk(code, "Summary", meta))
        for sec in sections:
            title, _, body = sec.partition("\n")
            chunks.append(Chunk(code, title.strip(), body.strip()))
    return chunks


class BM25:
    def __init__(self, docs: list[list[str]], k1: float = 1.5, b: float = 0.75):
        self.docs, self.k1, self.b = docs, k1, b
        self.avgdl = sum(map(len, docs)) / max(len(docs), 1)
        df = Counter(t for d in docs for t in set(d))
        n = len(docs)
        self.idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
        self.tf = [Counter(d) for d in docs]

    def scores(self, query: list[str]) -> list[float]:
        out = []
        for tf, d in zip(self.tf, self.docs):
            s = 0.0
            for q in query:
                if q in tf:
                    f = tf[q]
                    s += self.idf[q] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * len(d) / self.avgdl))
            out.append(s)
        return out


@dataclass
class Answer:
    text: str
    sources: list[str]
    mode: str                       # "llm" | "extractive" | "blocked"
    retrieved: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"text": self.text, "sources": self.sources, "mode": self.mode, "retrieved": self.retrieved}


SYSTEM = """You are the maintenance copilot of a factory digital twin. A technician reads your answer on a tablet next to the machine.

Rules:
- Use ONLY the manual excerpts given in the user message. Do not use outside knowledge about machines or repairs.
- After every sentence or step that uses an excerpt, cite it exactly as written in its header, e.g. [BEARING_WEAR §Repair procedure].
- If the excerpts do not contain the answer, reply exactly: "Not covered by the manuals - escalate to the maintenance supervisor." and nothing else.
- When the manual requires lockout/tagout (LOTO), state the LOTO steps BEFORE any repair step. Never suggest skipping safety steps.
- If the alert could be a sensor fault rather than a machine fault, say how to tell the difference first.
- Be short: numbered steps, no introduction, no closing remarks."""


class Copilot:
    def __init__(self, folder: Path = MANUALS, use_llm: bool | None = None):
        self.chunks = load_chunks(folder)
        self.codes = sorted({c.fault_code for c in self.chunks})
        self.index = BM25([_tokens(f"{c.fault_code.replace('_', ' ')} {c.section} {c.text}") for c in self.chunks])
        self.use_llm = _has_credentials() if use_llm is None else use_llm
        self._client = None

    # -- retrieval ----------------------------------------------------------
    def retrieve(self, question: str, fault_codes: list[str] | None = None, k: int = 5) -> list[Chunk]:
        q = _tokens(question) + [t for c in (fault_codes or []) for t in _tokens(c.replace("_", " "))]
        scores = self.index.scores(q)
        mentioned = {c for c in self.codes if c.lower() in question.lower().replace(" ", "_")}
        boost = set(fault_codes or []) | mentioned
        if boost:
            top = max(scores) or 1.0
            scores = [s + (top if ch.fault_code in boost else 0.0) for s, ch in zip(scores, self.chunks)]
        order = sorted(range(len(self.chunks)), key=lambda i: -scores[i])
        picked = [self.chunks[i] for i in order[:k] if scores[i] > 0]
        # safety first: if a picked fault requires LOTO, always include its LOTO section
        for code in dict.fromkeys(c.fault_code for c in picked):
            loto = next((c for c in self.chunks if c.fault_code == code and c.section.startswith("Safety")), None)
            if loto and loto not in picked and _is_repair_question(question):
                picked.append(loto)
        return picked

    # -- answer -------------------------------------------------------------
    def ask(self, question: str, fault_codes: list[str] | None = None, alert_text: str | None = None) -> Answer:
        ctx = self.retrieve(question if not alert_text else f"{question} {alert_text}", fault_codes)
        if not ctx:
            return Answer("Not covered by the manuals - escalate to the maintenance supervisor.", [], "blocked")
        refs = [c.ref for c in ctx]
        if self.use_llm:
            text = self._llm(question, ctx, alert_text)
        else:
            text = self._extractive(question, ctx)
        return self._guard(text, refs, "llm" if self.use_llm else "extractive")

    def _extractive(self, question: str, ctx: list[Chunk]) -> str:
        wanted = _sections_for(question)
        main = ctx[0].fault_code
        chosen = [c for c in ctx if c.fault_code == main and any(c.section.startswith(w) for w in wanted)] or ctx[:2]
        chosen.sort(key=lambda c: 0 if c.section.startswith("Safety") else 1)  # LOTO first
        return "\n\n".join(f"{c.section} {c.ref}\n{c.text}" for c in chosen)

    def _llm(self, question: str, ctx: list[Chunk], alert_text: str | None) -> str:
        import anthropic
        if self._client is None:
            self._client = anthropic.Anthropic()
        excerpts = "\n\n".join(f"{c.ref}\n{c.text}" for c in ctx)
        user = (f"Manual excerpts:\n\n{excerpts}\n\n"
                + (f"Current alert: {alert_text}\n\n" if alert_text else "")
                + f"Technician question: {question}")
        try:
            resp = self._client.beta.messages.create(
                model=MODEL,
                max_tokens=16000,
                output_config={"effort": "medium"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                system=SYSTEM,
                messages=[{"role": "user", "content": user}],
            )
        except anthropic.APIConnectionError:
            return self._extractive(question, ctx)
        except anthropic.RateLimitError:
            return self._extractive(question, ctx)
        except anthropic.APIStatusError as e:
            if e.status_code >= 500:
                return self._extractive(question, ctx)
            raise
        if resp.stop_reason == "refusal":
            return ""
        return "".join(b.text for b in resp.content if b.type == "text").strip()

    @staticmethod
    def _guard(text: str, allowed: list[str], mode: str) -> Answer:
        if text.startswith("Not covered by the manuals"):
            return Answer(text, [], "blocked", allowed)
        cited = [f"[{a} §{b}]" for a, b in CITE.findall(text)]
        if not cited or any(c not in allowed for c in cited):
            return Answer("No reliable source in the manuals for this answer - escalate to the maintenance "
                          "supervisor.", [], "blocked", allowed)
        return Answer(text, list(dict.fromkeys(cited)), mode, allowed)


def _is_repair_question(q: str) -> bool:
    return bool(re.search(r"\b(repair|fix|replace|do|procedure|steps?|how)\b", q.lower()))


def _sections_for(q: str) -> list[str]:
    ql = q.lower()
    if re.search(r"\bwhy\b|cause|symptom|what is (happening|wrong)", ql):
        return ["Symptoms", "Diagnosis"]
    if re.search(r"part|spare|reference", ql):
        return ["Spare parts", "Summary"]
    if re.search(r"restart|after|verify", ql):
        return ["Restart"]
    return ["Safety", "Repair procedure"]


def _has_credentials() -> bool:
    return any(os.getenv(v) for v in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"))
