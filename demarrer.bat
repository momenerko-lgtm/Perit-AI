@echo off
cd /d "%~dp0"

if not exist ".env" (
    echo.
    echo Aucune cle API Groq trouvee sur cette machine.
    echo Cree-la gratuitement sur console.groq.com si ce n'est pas deja fait.
    echo.
    set /p GROQ_KEY="Colle ta cle API Groq puis appuie sur Entree : "
    echo GROQ_API_KEY=%GROQ_KEY%> .env
    echo.
    echo Cle enregistree dans .env - a ne jamais partager ni publier.
    echo.
)

node server.mjs
echo.
echo Le serveur s'est arrete.
pause
