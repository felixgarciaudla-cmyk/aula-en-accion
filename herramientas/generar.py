"""Construye un HTML autónomo y el catálogo del servidor desde un curso JSON."""

import argparse
import base64
import json
import re
from html import escape
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from diapositivas import slides, course_map

ROOT = Path(__file__).resolve().parents[1]
TOKEN = re.compile(r"\{\{([A-Z_]+(?::[^{}]+)?)\}\}")
MEDIA_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
}


def fill(template, fields, files=None):
    def lookup(match):
        key = match[1]
        if files and key.startswith("ARCHIVO:"):
            return files(key.removeprefix("ARCHIVO:"))
        return str(fields[key])

    return TOKEN.sub(lookup, template)


def text(value, name, maximum=5000):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{name} debe contener texto de hasta {maximum} caracteres.")
    return value


def array(value, name, minimum=0, maximum=60):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ValueError(f"{name} debe tener entre {minimum} y {maximum} elementos.")
    return value


def url_http(value):
    if not isinstance(value, str) or "\n" in value or "\r" in value:
        raise ValueError("La URL debe ser absoluta y usar HTTPS o HTTP local.")
    url = urlsplit(value)
    if not url.hostname or url.username or url.password or not (
        url.scheme == "https" or (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"})
    ):
        raise ValueError(f"URL inválida: {value}")
    return url


def server_origin(value):
    if not value:
        return ""
    url = url_http(value)
    if url.path not in ("", "/") or url.query or url.fragment:
        raise ValueError("El servidor debe ser un origen, sin ruta, consulta ni fragmento.")
    return f"{url.scheme}://{url.netloc}"


def get_zone(course):
    name = course.get("zonaHoraria", "America/Guayaquil")
    try:
        ZoneInfo(name)
    except ZoneInfoNotFoundError as error:
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_+/-]{1,64}", name) or Path("/usr/share/zoneinfo").is_dir():
            raise ValueError(f"Zona horaria desconocida: {name}.") from error
    return name


def data_uri(value, directory, kind=None):
    filename = Path(value)
    path = (directory / filename).resolve()
    if filename.is_absolute() or not path.is_relative_to(directory.resolve()):
        raise ValueError(f"Guarda el recurso dentro de la carpeta del JSON: {value}")
    content_type = MEDIA_TYPES.get(path.suffix.lower())
    if not content_type or (kind and not content_type.startswith(kind + "/")):
        raise ValueError(f"Formato no admitido para {value}.")
    return f"data:{content_type};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def safe_json(value):
    return json.dumps(value, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def validate(course):
    for key in ("titulo", "autor", "institucion", "siglas", "descripcion"):
        text(course[key], key, 600)
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", course["slug"]):
        raise ValueError("slug debe contener minúsculas, números y guiones.")
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", course.get("color", "#b91e22")):
        raise ValueError("color debe ser hexadecimal, por ejemplo #b91e22.")
    get_zone(course)
    for result in array(course.get("resultados", []), "resultados", 1, 12):
        text(result["titulo"], "resultados.titulo", 110)
        text(result["descripcion"], "resultados.descripcion", 390)
    identifiers = set()
    modules = array(course.get("modulos"), "modulos", 1, 60)
    for module in modules:
        id_ = module["id"]
        if type(id_) is not int or not 1 <= id_ <= 999 or id_ in identifiers:
            raise ValueError("Cada módulo requiere un id entero único entre 1 y 999.")
        identifiers.add(id_)
        text(module["titulo"], "modulos.titulo", 110)
        text(module["explicacion"], "modulos.explicacion", 1200)
        for subtopic in array(module.get("subtemas"), "subtemas", 1, 9):
            text(subtopic, "subtema", 200)
        if module.get("imagen"):
            text(module["imagen"]["alt"], "imagen.alt", 210)
        question = module.get("practica")
        if question:
            for field, size in (("titulo", 110), ("consigna", 650), ("pregunta", 220), ("retroalimentacion", 550)):
                text(question[field], "practica." + field, size)
            options = array(question["opciones"], "practica.opciones", 2, 6)
            for option in options:
                text(option, "opcion", 190)
            if len({option.casefold().strip() for option in options}) != len(options):
                raise ValueError("La práctica requiere opciones distintas.")
            correct = question["correcta"]
            if type(correct) is not int or not 1 <= correct <= len(options):
                raise ValueError("correcta debe ser la posición de la respuesta, empezando en 1.")
    if not any(module.get("practica") for module in modules):
        raise ValueError("Agrega al menos una práctica para generar el catálogo del curso.")
    for project in array(course.get("proyectos", []), "proyectos", 0, 24):
        if project["modulo"] not in identifiers:
            raise ValueError("El proyecto debe referirse al id de un módulo existente.")
        for field in ("titulo", "descripcion", "entregable"):
            text(project[field], "proyectos." + field, 650)
        for step in array(project["pasos"], "pasos", 1, 8):
            text(step, "paso", 250)
    for resource in array(course.get("recursos", []), "recursos", 0, 18):
        text(resource["titulo"], "recursos.titulo", 120)
        url_http(resource["url"])
    return course


def question_catalog(modules):
    entries = []
    for number, module in enumerate(modules, 1):
        practice = module.get("practica")
        if not practice:
            continue
        entries.append({
            "id": str(module["id"]), "module": f"Módulo {number:02}", "title": practice["titulo"],
            "prompt": practice["pregunta"], "options": [
                {"letter": chr(65 + i), "value": str(i + 1), "label": label}
                for i, label in enumerate(practice["opciones"])
            ], "correct": str(practice["correcta"]), "feedback": practice["retroalimentacion"],
        })
    return entries


def runtime_fields(course, origin, qr_mark="", footer=""):
    engine = ROOT / "motor"
    color = course.get("color", "#b91e22")
    style = (engine / "estilos.css").read_text(encoding="utf-8")
    style += "\n:root{--accent:" + color
    if footer:
        style += ';--course-footer-art:url("' + footer + '")'
    style += "}\n"
    return {
        "ESTILOS": style,
        "AJUSTES": safe_json({
            "slug": course["slug"], "server": origin, "qrMark": qr_mark,
            "timeZone": get_zone(course),
        }),
        "QR_LIB": (engine / "qrcode.js").read_text(encoding="utf-8"),
        "PDF_LIB": "",
        "PDF": "",
        "PDF_MAPA": "{}",
        "MOTOR": (engine / "presentacion.js").read_text(encoding="utf-8"),
    }


def build_original(origin):
    course = read_json(ROOT / "contenido/curso-codex.json")
    example = ROOT / "ejemplos/curso-codex"
    asset = lambda path: data_uri(path, ROOT)
    fields = runtime_fields(course, origin, asset(course["escudoQR"]), asset(course["franja"]))
    fields.update({
        "PDF": base64.b64encode((example / "Curso_Codex_2026.pdf").read_bytes()).decode("ascii"),
        "PDF_MAPA": (example / "pdf-layout.json").read_text(encoding="utf-8"),
        "PDF_LIB": (ROOT / "motor/pdf-lib.js").read_text(encoding="utf-8"),
    })
    deck = fill((example / "presentacion.html").read_text(encoding="utf-8"), fields, asset)
    return course, deck, read_json(example / "preguntas.json"), ROOT / course["logotipo"]


def image_tag(image, alt, classes="", size=""):
    if not image:
        return ""
    return f'<img class="{classes}" src="{image}" alt="{escape(alt)}" {size}>'


def build_new(path, origin):
    course = validate(read_json(path))

    def asset(resource, kind="image"):
        return data_uri(resource, path.parent, kind) if resource else ""

    logo = asset(course.get("logotipo"))
    qr_mark = asset(course.get("escudoQR"))
    audio = asset(course.get("musica"), "audio")
    footer = asset(course.get("franja"))
    for module in course["modulos"]:
        if module.get("imagen"):
            module["imagen"]["uri"] = asset(module["imagen"]["archivo"])
    catalog = question_catalog(course["modulos"])
    template = ROOT / "plantilla"
    controls = (template / "controles-portada.html").read_text(encoding="utf-8")
    controls = fill(controls, {"MUSICA_OCULTA": "" if audio else "hidden"})
    quiz_controls = (template / "controles-practica.html").read_text(encoding="utf-8")
    slides_html, count = slides(course, catalog, controls, quiz_controls, logo, audio)
    fields = runtime_fields(course, origin, qr_mark, footer)
    band = "institutional-band" + ("" if footer else " generic-footer")
    fields.update({
        "TITULO": escape(course["titulo"]), "DESCRIPCION": escape(course["descripcion"]),
        "HORA": escape(course.get("etiquetaHora", "Hora del curso")),
        "LOGO_CABECERA": image_tag(logo, course["siglas"], "institution-logo"),
        "LOGO_DIALOGO": image_tag(logo, course["siglas"], size='width="33" height="37"'),
        "PIE": f'<div class="{band}"><span class="footer-teacher">{escape(course["autor"])}</span></div>',
        "TOTAL": f"{count:02}", "RESUMEN": f'{len(course["modulos"])} módulos · {len(course.get("proyectos", []))} proyectos',
        "DIAPOSITIVAS": slides_html,
        "MAPA": course_map(course),
    })
    logo_path = path.parent / course["logotipo"] if course.get("logotipo") else None
    return course, fill((template / "base.html").read_text(encoding="utf-8"), fields), catalog, logo_path


def write_server(server, course, questions, logo):
    if not (server / "lib/practice-catalog.ts").is_file():
        raise ValueError("Indica una copia de la carpeta servidor.")
    if logo is not None and logo.suffix.lower() != ".png":
        raise ValueError("Para el servidor usa un logotipo PNG.")
    png = logo.read_bytes() if logo else (ROOT / "recursos/logotipo-plantilla.png").read_bytes()
    course_settings = {
        "slug": course["slug"], "title": course["titulo"], "teacher": course["autor"],
        "institution": course["institucion"], "shortName": course["siglas"],
        "color": course.get("color", "#b91e22"), "timeZone": course.get("zonaHoraria", "America/Guayaquil"),
    }
    for name, value in (("course-settings.json", course_settings), ("practice-questions.json", questions)):
        (server / "lib" / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (server / "public/curso-logo.png").write_bytes(png)
    (server / "lib/report-assets/logo-data.ts").write_text(
        'export const courseLogo = "' + base64.b64encode(png).decode("ascii") + '";\n', encoding="utf-8",
    )


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--curso", type=Path, help="Archivo JSON de un curso nuevo.")
    source.add_argument("--original", action="store_true", help="Reconstruye el curso Codex incluido.")
    parser.add_argument("--salida", type=Path, required=True, help="Ruta del HTML generado.")
    parser.add_argument("--servidor", default="", help="Origen HTTPS propio para sesiones en vivo.")
    parser.add_argument("--actualizar-servidor", type=Path, help="Escribe el catálogo y la identidad en una copia de servidor.")
    args = parser.parse_args()
    try:
        origin = server_origin(args.servidor)
        course, deck, questions, logo = build_original(origin) if args.original else build_new(args.curso.resolve(), origin)
        if args.actualizar_servidor:
            write_server(args.actualizar_servidor.resolve(), course, questions, logo)
        args.salida.parent.mkdir(parents=True, exist_ok=True)
        args.salida.write_text(deck, encoding="utf-8")
    except (ValueError, KeyError, OSError, TypeError, ZoneInfoNotFoundError) as error:
        parser.exit(2, f"No se pudo generar el curso. {error}\n")
    print(f"{args.salida} generado con {len(questions)} prácticas.")


if __name__ == "__main__":
    main()
