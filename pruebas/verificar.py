"""Comprueba que ambos ejemplos se reconstruyen y que los catálogos coinciden."""

from base64 import b64decode
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import json
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "herramientas"))
from generar import build_new, build_original, read_json, server_origin, write_server


class Deck(HTMLParser):
    def __init__(self, contents):
        super().__init__()
        self.ids = Counter()
        self.slides = []
        self.links = []
        self.questions = {}
        self.options = {}
        self.parse_quiz = None
        self.feed(contents)

    def handle_starttag(self, tag, attributes):
        a = dict(attributes)
        classes = a.get("class", "").split()
        if "id" in a:
            self.ids[a["id"]] += 1
        if "slide" in classes:
            self.slides.append(a["aria-labelledby"])
        if tag == "a" and a.get("href", "").startswith("#") and len(a["href"]) > 1:
            self.links.append(a["href"][1:])
        if tag == "form" and "quiz" in classes:
            self.parse_quiz = a["data-theme"]
            self.questions[self.parse_quiz] = a["data-answer"]
            self.options[self.parse_quiz] = []
        if tag == "input" and self.parse_quiz and a.get("type") == "radio":
            self.options[self.parse_quiz].append(a["value"])

    def handle_endtag(self, tag):
        if tag == "form":
            self.parse_quiz = None


def verify(result, relative, slide_count, question_count):
    _, html, questions, _ = result
    assert (ROOT / relative).read_text(encoding="utf-8") == html, relative
    deck = Deck(html)
    assert len(deck.slides) == slide_count
    assert all(deck.ids[id_] == 1 for id_ in deck.slides)
    assert not set(deck.links) - set(deck.ids), set(deck.links) - set(deck.ids)
    assert len(questions) == question_count
    assert deck.questions == {q["id"]: q["correct"] for q in questions}
    assert deck.options == {q["id"]: [o["value"] for o in q["options"]] for q in questions}
    assert "chatgpt.site" not in html
    assert "TEACHER_CODE" not in html


original = build_original("")
sample = build_new(ROOT / "contenido/mi-curso.json", "")
verify(original, "presentacion/Curso_Codex_2026.html", 62, 14)
verify(sample, "presentacion/index.html", 11, 2)
assert b64decode(original[1].split('id="deck-pdf">', 1)[1].split("</script>")[0].strip()).startswith(b"%PDF")
assert read_json(ROOT / "servidor/lib/practice-questions.json") == original[2]

with tempfile.TemporaryDirectory() as directory:
    server = Path(directory)
    (server / "lib/report-assets").mkdir(parents=True)
    (server / "lib/practice-catalog.ts").touch()
    (server / "public").mkdir()
    write_server(server, sample[0], sample[2], sample[3])
    assert read_json(server / "lib/practice-questions.json") == sample[2]
    settings = read_json(server / "lib/course-settings.json")
    assert settings["slug"] == sample[0]["slug"]
    assert (server / "public/curso-logo.png").read_bytes().startswith(b"\x89PNG")
for unsafe in ("javascript:alert(1)", "https://user:pass@example.org", "https://example.org/private"):
    try:
        server_origin(unsafe)
    except ValueError:
        continue
    raise AssertionError(unsafe)

assert json.loads((ROOT / "servidor/wrangler.jsonc").read_text())["d1_databases"][0]["binding"] == "DB"
print("Dos HTML reproducibles, 73 diapositivas revisadas y 16 prácticas coherentes con sus catálogos.")
