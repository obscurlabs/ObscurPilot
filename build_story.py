"""How ObscurPilot was built, told by the repository itself.

Reads the git history, the stage table in README.md and the current codebase, then plays
the build story back as an animated terminal timeline (about 25 seconds).

    python build_story.py            # animated
    python build_story.py --fast     # no animation
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FAST = "--fast" in sys.argv

# Windows terminals need this nudge before they honour ANSI colour codes.
if os.name == "nt":
    os.system("")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

RESET = "\x1b[0m"
BOLD = "\x1b[1m"
DIM = "\x1b[2m"
VIOLET = "\x1b[38;2;139;124;255m"
TEAL = "\x1b[38;2;45;212;191m"
GREEN = "\x1b[38;2;59;217;139m"
AMBER = "\x1b[38;2;245;184;76m"
MUTED = "\x1b[38;2;154;163;180m"
WHITE = "\x1b[38;2;238;241;247m"

FALLBACK_STAGES = [
    ("0", "Architecture and measurable contracts", "Complete"),
    ("1", "Monorepo and quality foundation", "Complete"),
    ("2", "Secure desktop shell and IPC spine", "Complete"),
    ("3", "Domain kernel and connection supervisor", "Complete"),
    ("4", "Push-to-talk and local audio pipeline", "Complete"),
    ("5", "Authoritative local OBS bridge", "Implemented"),
    ("6", "Supabase identity and persistence", "Implemented"),
    ("7", "Twitch OAuth, Helix, and EventSub", "Complete"),
    ("8", "Transcription adapter", "Complete"),
    ("9", "Reasoning and guarded tool ingestion", "Complete"),
]

VOICE_ERA = [
    ("Pilot", "an animated agent with an LED dot-matrix face and 15 moods"),
    ("Pilot", "drag it anywhere; it snaps to the nearest edge or corner"),
    ("Voice", "every clip transcribed by the Wispr Flow API"),
    ("OBS", "one-click connect: finds OBS, enables WebSocket, launches, connects"),
    ("Safety", "risky actions wait for approval; keys never reach the interface"),
    ("Logs", "a Logs page plus colour terminal logs with secret redaction"),
    ("Start", "Start Pilot: show Pilot, connect OBS, turn on hands-free voice"),
]


def pause(seconds: float) -> None:
    if not FAST:
        time.sleep(seconds)


def type_out(text: str, colour: str = WHITE, delay: float = 0.012, end: str = "\n") -> None:
    if FAST:
        print(f"{colour}{text}{RESET}", end=end)
        return
    sys.stdout.write(colour)
    for character in text:
        sys.stdout.write(character)
        sys.stdout.flush()
        time.sleep(delay)
    sys.stdout.write(RESET + end)
    sys.stdout.flush()


def progress_bar(label: str, status: str, width: int = 28) -> None:
    done = status.lower().startswith("complete")
    colour = GREEN if done else AMBER
    tag = "done" if done else "built, live check pending"
    fill = width if done else int(width * 0.85)
    steps = 1 if FAST else fill
    for step in range(1, steps + 1):
        shown = fill if FAST else step
        bar = "━" * shown + f"{DIM}{'─' * (width - shown)}{RESET}{colour}"
        sys.stdout.write(f"\r  {label:<52} {colour}{bar}{RESET}")
        sys.stdout.flush()
        pause(0.008)
    print(f" {colour}{tag}{RESET}")


def git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return ""


def read_stages() -> list[tuple[str, str, str]]:
    readme = ROOT / "README.md"
    if not readme.exists():
        return FALLBACK_STAGES
    rows = re.findall(
        r"^\|\s*Stage\s+(\d+)\s*-\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|",
        readme.read_text(encoding="utf-8"),
        flags=re.MULTILINE,
    )
    return [(n, name, status.split(";")[0]) for n, name, status in rows] or FALLBACK_STAGES


def code_stats() -> tuple[int, int]:
    files = [f for f in git("ls-files", "*.ts", "*.tsx").splitlines() if f and "/dist/" not in f]
    lines = 0
    for name in files:
        try:
            lines += sum(1 for _ in (ROOT / name).open(encoding="utf-8", errors="ignore"))
        except OSError:
            pass
    return len(files), lines


def banner() -> None:
    inner = 64
    print()
    type_out("  ╭" + "─" * inner + "╮", VIOLET, 0.002)
    for text, colour in (
        ("O B S C U R P I L O T", BOLD + VIOLET),
        ("a voice copilot for OBS and Twitch, and how it was built", MUTED),
    ):
        type_out(f"  {VIOLET}│{RESET}  ", WHITE, 0.0, end="")
        type_out(text.ljust(inner - 3), colour, 0.006, end="")
        type_out(f"{VIOLET} │{RESET}", WHITE, 0.0)
    type_out("  ╰" + "─" * inner + "╯", VIOLET, 0.002)
    pause(0.4)


def section(title: str) -> None:
    print()
    type_out(f"  {title}", BOLD + TEAL, 0.01)
    type_out("  " + "─" * 64, DIM, 0.001)
    pause(0.2)


def main() -> None:
    banner()

    section("PHASE 1 · Foundations, stage by stage")
    for number, name, status in read_stages():
        progress_bar(f"Stage {number:>2}  {name}", status)
    pause(0.4)

    section("PHASE 2 · Built by voice: Wispr Flow → Claude Code")
    for area, detail in VOICE_ERA:
        type_out(f"  {GREEN}✓{RESET} {VIOLET}{area:<7}{RESET}", WHITE, 0.0, end="")
        type_out(detail, WHITE, 0.01)
        pause(0.15)
    pause(0.4)

    section("COMMITS")
    commits = [line.split("|", 1) for line in git("log", "--reverse", "--format=%ad|%s", "--date=short").splitlines()]
    for date, message in commits[-8:]:
        message = message if len(message) <= 66 else message[:63] + "..."
        type_out(f"  {MUTED}{date}{RESET}  {message}", WHITE, 0.004)
    pause(0.4)

    section("CODEBASE TODAY")
    files, lines = code_stats()
    stats = [
        ("TypeScript files", f"{files}"),
        ("lines of TypeScript", f"{lines:,}"),
        ("commits", f"{len(commits)}"),
        ("packages", "4"),
    ]
    for label, value in stats:
        type_out(f"  {BOLD}{WHITE}{value:>8}{RESET}  {MUTED}{label}{RESET}", WHITE, 0.0)
        pause(0.25)
    type_out(f"  {'':>8}  {MUTED}contracts · domain · adapters · desktop{RESET}", WHITE, 0.0)

    print()
    type_out("  Spoken, not typed.  Wispr Flow  →  Claude Code  →  ObscurPilot", BOLD + VIOLET, 0.02)
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(RESET)
