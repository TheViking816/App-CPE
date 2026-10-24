# Prueba local de enlaces personales Noray (chapa 72683)

Esta rama incorpora una prueba aislada. No escribe en Supabase ni modifica el despliegue de Vercel. Solo lee los enlaces personales de la chapa 72683 y crea un archivo local, ignorado por Git, en `.local/noray-pilot-72683.json`. El archivo contiene jornales, calendario y vacaciones, sin el enlace de acceso, contraseña ni tokens. El servidor de desarrollo solo lo entrega a conexiones locales; Vite no lo incluye en la compilación.

## Ejecutar una lectura

En este equipo ya se guardó el enlace cifrado para el usuario de Windows y un perfil Chrome aislado en `%LOCALAPPDATA%\AppCPE\noray-personal-pilot-72683`. Desde la raíz de esta rama, con Node y Chrome instalados:

```powershell
.\scripts\run-noray-personal-pilot.ps1
npm run dev -- --port 5174
```

La ejecución imprime los conteos y `localFileUpdated:true`. Para comparar sin guardar se puede usar `.\scripts\run-noray-personal-pilot.ps1 -DryRun`. El perfil aislado debe poder abrir los enlaces personales en un Chrome visible. El enlace cifrado no está en el repositorio y solo puede descifrarlo la cuenta de Windows que lo guardó.

En la app local (`http://127.0.0.1:5174/App-CPE/` si se arranca con `npm run dev -- --port 5174`), los datos solo aparecen para la sesión 72683. Jornales se integran en el Sueldómetro, evitando duplicar los que ya se introdujeron manualmente. Descansos muestra las marcas del mes y su cabecera de grupos y FS. Vacaciones muestra los días en el calendario y los periodos concedidos. El navegador relee el archivo cada 60 segundos mientras la pestaña está visible.

## Automatización posterior

Noray no emite eventos a esta app al registrar un jornal o cambiar un descanso. La actualización automática requiere ejecutar este lector de forma periódica en un equipo encendido (por ejemplo, con el Programador de tareas de Windows), con el enlace guardado fuera del repositorio y protegido para el usuario del sistema. Cada ejecución compara el resultado anterior y sustituye el archivo local completo; si no hay cambios, no se duplican datos. Para servir los resultados a usuarios en Vercel haría falta, tras validar esta prueba, un almacenamiento y permisos de lectura por chapa en el backend.
