# Prompt para generar un curso nuevo

Copia el bloque en una sesión donde esté abierto el repositorio. Sustituye los campos entre corchetes y proporciona tus materiales de referencia.

```text
Prepara una presentación interactiva usando este repositorio.

Tema [tema]
Público [quiénes asistirán y qué saben]
Duración [tiempo disponible]
Docente e institución [nombres]
Materiales [archivos y enlaces autorizados]
Resultado final [qué deben poder producir o demostrar]

1. Lee README.md, docs/Personalizar.md y contenido/mi-curso.json.
2. Crea contenido/nuevo-curso.json con un slug único. Mantén el formato
   de la plantilla. Diseña módulos con objetivos observables, subtemas,
   una explicación breve y prácticas congruentes con el material.
3. Para cada práctica redacta una consigna, una pregunta, opciones
   distintas, una única respuesta correcta y retroalimentación concreta.
   La posición de la respuesta correcta comienza en 1.
4. Añade un proyecto con pasos y evidencia de entrega. Usa únicamente
   imágenes y materiales propios o autorizados.
5. Ejecuta python herramientas/generar.py --curso contenido/nuevo-curso.json
   --salida presentacion/nuevo-curso.html como un solo comando.
6. Prueba portada, mapa, enlaces, subtemas, pizarra, prácticas y reinicio.
   Si indiqué el origen HTTPS de un servidor propio, genera también el
   catálogo para esa copia y prueba asistencia, resultados y PDF.
7. Entrega el HTML y su JSON editable. Describe las pruebas que hiciste y
   cualquier función que quede pendiente de verificar.
```
