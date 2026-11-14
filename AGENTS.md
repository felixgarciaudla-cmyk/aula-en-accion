# Crear cursos con este repositorio

- Usa `contenido/mi-curso.json` como ejemplo de estructura. Crea un JSON nuevo con un `slug` propio y guarda los recursos de ese curso junto al JSON.
- Escribe resultados observables, explicaciones breves y prácticas con una respuesta verificable. Indica la posición correcta empezando en 1 y añade retroalimentación.
- Genera el HTML con `python herramientas/generar.py --curso contenido/nuevo-curso.json --salida presentacion/nuevo-curso.html`. Entrega también el JSON para que el docente pueda editarlo.
- Para usar asistencia y respuestas en vivo, usa el origen HTTPS del servidor del curso y sincroniza el catálogo de esa instalación con el mismo JSON. Consulta `servidor/README.md`.
- Comprueba portada, mapa, enlaces internos, respuesta correcta y reinicio. Para cambios en el motor común, ejecuta `python pruebas/verificar.py`.
- Usa materiales con permiso de publicación y guarda las claves docentes y los datos de asistencia fuera del repositorio.
