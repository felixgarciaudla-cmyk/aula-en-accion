# Subir y compartir el repositorio

## Desde GitHub Desktop

1. Descomprime el ZIP en una carpeta con un nombre sencillo, por ejemplo `presentaciones-interactivas`.
2. En GitHub Desktop, selecciona **File → Add local repository**. Si la carpeta aún carece de Git, usa el enlace para crear un repositorio en esa misma carpeta. Elige la carpeta que contiene el `README.md`.
3. Confirma los archivos con un mensaje como «Versión inicial de la plantilla».
4. Pulsa **Publish repository**, selecciona la cuenta correcta y decide la visibilidad. Para compartirlo con cualquier persona, revisa primero los [créditos y recursos](../CREDITOS.md) y elige un repositorio público. Copia la dirección del repositorio para compartir el código.

## Desde Git Bash o una terminal

Crea primero un repositorio vacío en GitHub. Desde la carpeta que contiene este proyecto, sustituye `TU-USUARIO` y `TU-REPOSITORIO` por los datos reales.

```bash
git init -b main
git add .
git commit -m "Plantilla de presentaciones interactivas"
git remote add origin https://github.com/TU-USUARIO/TU-REPOSITORIO.git
git push -u origin main
```

En un repositorio existente, usa su copia local y añade allí los archivos. También puedes cargar carpetas con **Add file → Upload files**; GitHub admite hasta 100 archivos por carga web y un máximo de 25 MiB por archivo. Si eliges esa vía, sube por carpetas y comprueba que aparecen `README.md` y `.gitignore`. [Documentación de GitHub sobre cargar archivos](https://docs.github.com/es/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)

## Publicar el HTML con GitHub Pages

Elige **Settings → Pages → Deploy from a branch**. Selecciona `main` y `/docs`, que son una de las combinaciones admitidas. Antes de confirmar, copia al directorio `docs/` el HTML que quieras publicar y llámalo `index.html`. Para publicar el ejemplo de Codex como una segunda página, copia también `presentacion/Curso_Codex_2026.html` con ese nombre. Sube los dos archivos modificados. Comparte la URL que aparece en la configuración de Pages una vez publicada. [Configuración de GitHub Pages](https://docs.github.com/es/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

GitHub Pages aloja el HTML y su contenido estático. Para recoger asistencias y respuestas desde los celulares, conecta el HTML a la [instalación del servidor](../servidor/README.md). [Acerca de GitHub Pages](https://docs.github.com/es/pages/getting-started-with-github-pages/about-github-pages)
