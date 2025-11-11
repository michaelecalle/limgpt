@echo off
cd /d "C:\Dev\limgpt"

echo -----------------------------------------
echo     Incrementation du numero de version
echo -----------------------------------------
node tools\bump-version.mjs

echo.
echo Lancement de LIMGPT (Vite) dans une nouvelle fenetre...
echo Tu pourras fermer LIMGPT en fermant cette nouvelle fenetre.
echo -----------------------------------------
echo.

start cmd /K "cd /d C:\Dev\limgpt && echo [LIMGPT] Demarrage serveur dev... && npm run dev && echo. && echo [LIMGPT] Serveur arrete. && pause"

echo.
echo (Cette fenetre-ci peut etre fermee.)

