# Personalizar una presentación

El archivo `contenido/mi-curso.json` es el punto de partida para nuevas presentaciones. Puedes duplicarlo con otro nombre y conservar el ejemplo original.

| Campo | Uso |
|---|---|
| `slug` | Identificador único en minúsculas con guiones, por ejemplo `taller-planeacion` |
| `titulo`, `autor`, `institucion`, `siglas` | Identidad de la portada y del reporte en vivo |
| `descripcion`, `resultados` | Presentación del curso y resultados observables de aprendizaje |
| `color` | Color institucional en formato hexadecimal, por ejemplo `#b91e22` |
| `zonaHoraria`, `etiquetaHora` | Zona IANA para registrar horas y etiqueta del reloj de la presentación |
| `modulos` | Id entero único, título, explicación y lista de subtemas por módulo |
| `modulos[].practica` | Título, consigna, pregunta, opciones, posición correcta y retroalimentación |
| `proyectos` | Id de módulo relacionado, título, descripción, pasos y evidencia de entrega |
| `recursos` | Títulos y URL HTTPS para los enlaces con QR |

Puedes agregar activos propios en una subcarpeta junto al JSON. Deja los campos opcionales vacíos mientras preparas tus recursos.

```json
{
  "logotipo": "multimedia/logotipo.png",
  "escudoQR": "multimedia/escudo.png",
  "musica": "multimedia/ambiente.mp3",
  "franja": "multimedia/pie.png"
}
```

Para la imagen de un módulo usa `"imagen": {"archivo": "multimedia/modulo-1.webp", "alt": "Descripción breve"}`. El generador admite PNG, JPEG y WebP para imágenes, y MP3 y OGG para música. Usa PNG para el logotipo cuando sincronices el servidor. Elige un color de acento que conserve contraste con texto blanco.

## Reconstruir Codex 2026

```bash
python herramientas/generar.py --original --salida presentacion/Curso_Codex_2026.html
```

El ejemplo conserva su HTML editable en `ejemplos/curso-codex/presentacion.html`. Su PDF y el mapa de coordenadas corresponden a esa versión exacta. Si cambias el número de diapositivas o el diseño de las prácticas, usa el generador de la plantilla para imprimir la versión nueva desde el navegador.

## Conectar tu propia sesión en vivo

Copia `servidor/` para tu curso y aplica la configuración de su [README](../servidor/README.md). Usa el mismo JSON para generar el HTML y el catálogo de preguntas.

```bash
python herramientas/generar.py --curso contenido/mi-curso.json --salida presentacion/mi-curso.html --servidor https://tu-curso.example.org --actualizar-servidor servidor
```

Cambia el origen de ejemplo por el de tu instalación. Vuelve a compilar y publicar el servidor si cambian preguntas, identidad o logotipo. Abre el HTML de la nueva versión y prueba asistencia, pregunta, resultados y descarga antes de la clase. Conserva el mismo `slug` si quieres mantener las marcas locales al regenerar un curso.
