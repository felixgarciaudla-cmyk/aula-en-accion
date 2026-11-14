"""Secciones del curso que el motor de la presentación reconoce."""

from html import escape


def section(id_, classes, kind, body, theme=None):
    theme_attr = f' data-theme="{theme}"' if theme is not None else ""
    hidden = "" if id_ == "portada" else " hidden"
    return f'<section class="slide {classes}" aria-labelledby="{id_}" data-kind="{kind}"{theme_attr}{hidden}>\n{body}\n</section>'


def image(uri, alt):
    return f'<img src="{uri}" alt="{escape(alt)}" decoding="async">' if uri else ""


def module_picture(module):
    source = module.get("imagen")
    if not source:
        return '<div class="module-image-placeholder" aria-hidden="true"></div>'
    return image(source["uri"], source["alt"])


def tabs(id_, current, practice):
    tabs_ = [("temas", "Subtemas", "subtopics"), ("capitulo", "Explicación", "explanation")]
    if practice:
        tabs_.append(("practica", "Práctica", "practice"))
    links = []
    for prefix, title, icon in tabs_:
        selected = ' aria-current="page"' if prefix == current else ""
        links.append(f'<a href="#{prefix}-{id_}" data-nav-icon="{icon}"{selected}><span class="nav-icon" aria-hidden="true"></span>{title}</a>')
    return '<nav class="module-tabs" aria-label="Diapositivas del módulo">' + "".join(links) + "</nav>"


def marks(module):
    id_ = module["id"]
    practice = f'<span class="done" data-done="{id_}" role="img" aria-label="Práctica resuelta" hidden>✓</span>' if module.get("practica") else ""
    return f'<span class="module-marks">{practice}<span class="completion-check module-complete" data-subtopics-complete="{id_}" role="img" aria-label="Subtemas completados" hidden></span></span>'


def covers(course, controls, logo, audio):
    modules = course["modulos"]
    groups = [modules[i:i + 6] for i in range(0, len(modules), 6)]
    dots, frames = [], []
    for i, group in enumerate(groups, 1):
        first, last = 6 * (i - 1) + 1, 6 * (i - 1) + len(group)
        label = f"Módulo {first:02}" if first == last else f"Módulos {first:02} a {last:02}"
        current = str(i == 1).lower()
        dots.append(f'<button type="button" class="course-route-dot" aria-controls="course-route-frame-{i}" aria-current="{current}" aria-label="{label}" title="{label}"></button>')
        links = []
        for number, module in enumerate(group, first):
            links.append(f'<a href="#temas-{module["id"]}" class="route"><i>{number:02}</i><span class="topic-label">{escape(module["titulo"])}</span><span class="course-route-meta">{marks(module)}<b aria-hidden="true">→</b></span></a>')
        frames.append(
            f'<div id="course-route-frame-{i}" class="course-route-frame" role="group" aria-label="{label}" aria-hidden="{str(i != 1).lower()}">'
            f'<figure class="photo hero-photo">{module_picture(group[0])}<figcaption class="course-route-phase">{label}</figcaption></figure>'
            f'<div class="flow">{"".join(links)}</div></div>'
        )
    audio_source = f' src="{audio}"' if audio else ""
    body = f'''
<div class="hero-content">
  <div class="cover-institution">{image(logo, "")}<p class="kicker">{escape(course["institucion"])}</p></div>
  <h1 id="portada">{escape(course["titulo"])}</h1>
  <p class="lead">{escape(course["descripcion"])}</p>
  <p class="teacher"><strong>{escape(course["autor"])}</strong></p>
  <div class="facts"><span><strong>{len(modules)}</strong> módulos</span><span><strong>{len(course.get("proyectos", []))}</strong> proyectos</span></div>
  {controls}
  <p class="cover-action-status" id="cover-action-status" role="status" hidden></p>
  <button type="button" class="control teacher-link-button" id="link-teacher-tools" data-open-link-dialog aria-haspopup="dialog" aria-controls="presentation-link-dialog" hidden>Vincular presentación</button>
  <audio id="ambient-audio" preload="none"{audio_source}></audio>
</div>
<section id="course-route" class="workspace course-route" aria-label="Temario del curso" aria-roledescription="carrusel">
  <div class="window-bar">
    <div class="course-route-pager" role="group" aria-label="Grupos del temario">
      {"".join(dots)}
      <button type="button" class="course-route-toggle" data-paused="false" aria-label="Pausar recorrido automático" title="Pausar recorrido automático"></button>
    </div>
    <a class="course-route-overview" href="#temario">Temario del curso</a>
  </div>
  <div class="course-route-frames">{"".join(frames)}</div>
</section>'''
    return section("portada", "hero", "Inicio", body)


def objectives(course):
    cards = "".join(f'<article><h3>{escape(result["titulo"])}</h3><p>{escape(result["descripcion"])}</p></article>' for result in course["resultados"])
    return section("resultados", "outcomes", "Resultados", f'''
<p class="kicker">Resultados de aprendizaje</p>
<h2 id="resultados">Al finalizar el curso, podrás</h2>
<div class="outcome-grid">{cards}</div>
<div class="slide-actions"><a class="control primary top-link" href="#temario">Ver el temario →</a></div>''')


def syllabus(course, question_count):
    cards = []
    for number, module in enumerate(course["modulos"], 1):
        cards.append(
            f'<article class="phase-card"><figure class="photo">{module_picture(module)}</figure>'
            f'<h3>{escape(module["titulo"])}</h3><a href="#temas-{module["id"]}"><span class="topic-number">{number:02}</span>'
            f'<span>Explorar subtemas</span>{marks(module)}</a></article>'
        )
    return section("temario", "module-hub", "Temario", f'''
<div class="hub-header">
  <div><p class="kicker">{escape(course["titulo"])}</p><h2 id="temario">Temario del curso</h2></div>
  <p class="course-status" id="course-status" aria-live="polite">0 de {question_count} comprobaciones resueltas en esta sesión</p>
</div>
<div class="phase-grid">{"".join(cards)}</div>''')


def module_sections(module, number, question, controls):
    id_ = module["id"]
    title = escape(module["titulo"])
    show_tabs = lambda current: tabs(id_, current, bool(question))
    checks = []
    for index, name in enumerate(module["subtemas"], 1):
        key = f"subtema-{id_}-{index}"
        label = "titulo-" + key
        checks.append(f'<li><span id="{label}">{escape(name)}</span><label class="subtopic-control" title="Marcar o desmarcar subtema"><input class="subtopic-check sr" id="{key}" type="checkbox" aria-labelledby="{label}"><span class="completion-check" aria-hidden="true"></span></label></li>')
    yield section(f"temas-{id_}", "module-outline", "Detalle", f'''
<div class="outline-heading">{show_tabs("temas")}<p class="kicker">Módulo {number:02} · Temario</p><h2 id="temas-{id_}">{title}</h2></div>
<figure class="module-art">{module_picture(module)}</figure>
<div class="outline-body"><ol class="outline-points">{"".join(checks)}</ol>
<div class="slide-actions"><a class="control primary" href="#capitulo-{id_}">Ir a la explicación →</a><a class="control" href="#temario">Volver al temario</a></div></div>''', id_)
    yield section(f"capitulo-{id_}", "lesson lesson-explanation", "Capítulo", f'''
<div class="lesson-header">{show_tabs("capitulo")}<p class="kicker">Módulo {number:02}</p>
<h2 id="capitulo-{id_}">{title}</h2><p class="lead explanation-summary">{escape(module["explicacion"])}</p></div>
<div class="board-slot"></div>''', id_)
    if question:
        info = module["practica"]
        choices = "".join(
            f'<label><input type="radio" name="pregunta-{id_}" value="{option["value"]}"><span>{escape(option["label"])}</span></label>'
            for option in question["options"]
        )
        buttons = controls.replace("{{ID_PRACTICA}}", str(id_))
        yield section(f"practica-{id_}", "lesson", "Práctica", f'''
<div class="lesson-header">{show_tabs("practica")}<p class="kicker">Módulo {number:02} · Práctica</p>
<h2 id="practica-{id_}">{escape(question["title"])}</h2><p class="activity">{escape(info["consigna"])}</p></div>
<div class="lesson-body"><form class="quiz" data-theme="{id_}" data-answer="{question["correct"]}" data-feedback="{escape(question["feedback"])}">
  <fieldset style="border:0;padding:0;margin:0;min-width:0"><legend>Comprobación</legend><h3>{escape(question["prompt"])}</h3><div class="choices">{choices}</div></fieldset>
  {buttons}</form></div>''', id_)


def project_section(project, number):
    id_ = f"proyecto-{number}"
    steps = "".join(f'<li><span>{i:02}</span><p>{escape(step)}</p></li>' for i, step in enumerate(project["pasos"], 1))
    return section(id_, "lesson lab", "Proyecto", f'''
<div class="lesson-header"><p class="kicker">Proyecto práctico {number:02}</p>
<h2 id="{id_}">{escape(project["titulo"])}</h2><p class="lead">{escape(project["descripcion"])}</p>
<div class="slide-actions"><a class="control" href="#capitulo-{project["modulo"]}">Volver al módulo</a></div></div>
<div class="lesson-body"><ol class="step-list">{steps}</ol>
<aside class="check-panel"><strong>Evidencia de entrega</strong><p>{escape(project["entregable"])}</p></aside></div>''')


def resources(course, logo):
    links = "".join(
        f'<a href="{escape(resource["url"])}" data-course-link="{escape(resource["titulo"])}" aria-haspopup="dialog" aria-controls="course-link-dialog">{escape(resource["titulo"])} <span aria-hidden="true">→</span></a>'
        for resource in course.get("recursos", [])
    )
    stamp = f'<img class="closing-mark" src="{logo}" alt="{escape(course["siglas"])}">' if logo else ""
    return section("recursos", "split theme-closing", "Recursos", f'{stamp}<div><p class="kicker">Cierre</p><h2 id="recursos">Recursos del curso</h2></div><div class="resources">{links}</div>')


def slides(course, catalog, cover_controls, quiz_controls, logo, audio):
    content = [covers(course, cover_controls, logo, audio), objectives(course), syllabus(course, len(catalog))]
    questions = {int(question["id"]): question for question in catalog}
    for i, module in enumerate(course["modulos"], 1):
        content.extend(module_sections(module, i, questions.get(module["id"]), quiz_controls))
    content.extend(project_section(p, i) for i, p in enumerate(course.get("proyectos", []), 1))
    content.append(resources(course, logo))
    return "\n".join(content), len(content)


def course_map(course):
    stops = []
    for number, module in enumerate(course["modulos"], 1):
        id_ = module["id"]
        title = escape(module["titulo"])
        practice = f'<a href="#practica-{id_}" aria-label="Práctica de {title}">Práctica</a>' if module.get("practica") else ""
        stops.append(
            f'<li class="map-stop"><span class="map-stop-no" aria-hidden="true">{number:02}</span><div class="map-stop-body">'
            f'<a class="map-stop-main" href="#temas-{id_}" data-map-destination><span>{title}</span>{marks(module)}</a>'
            f'<div class="map-stop-actions"><a href="#capitulo-{id_}" aria-label="Explicación de {title}">Explicación</a>{practice}</div></div></li>'
        )
    projects = "".join(
        f'<li><a class="map-project" href="#proyecto-{i}" data-map-destination><span class="map-project-no">P{i:02}</span><span>{escape(p["titulo"])}</span><span class="map-project-arrow" aria-hidden="true">↗</span></a></li>'
        for i, p in enumerate(course.get("proyectos", []), 1)
    )
    project_list = f'<h4>Proyectos</h4><ol class="map-projects">{projects}</ol>' if projects else ""
    return f'<section class="map-phase" style="--phase:var(--accent)" aria-labelledby="map-phase-1"><div class="map-phase-title"><h3 id="map-phase-1">Módulos</h3><span>{len(stops)} en total</span></div><ol class="map-stops">{"".join(stops)}</ol>{project_list}</section>'
