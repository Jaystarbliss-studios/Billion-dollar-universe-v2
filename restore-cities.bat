@echo off
REM ═══════════════════════════════════════════════════════════════════════════
REM RESTORE-CITIES.BAT — Windows script to regenerate all cities
REM ═══════════════════════════════════════════════════════════════════════════

echo.
echo ╔═══════════════════════════════════════════════════════════════════════╗
echo ║              CITIES COLLECTION RESTORATION SCRIPT                    ║
echo ╚═══════════════════════════════════════════════════════════════════════╝
echo.

REM Set Firebase credentials
set GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json

REM Check if service account key exists
if not exist "%GOOGLE_APPLICATION_CREDENTIALS%" (
    echo ❌ ERROR: serviceAccountKey.json not found!
    echo   Make sure you're running this from the project root directory.
    pause
    exit /b 1
)

echo ✓ Firebase credentials found
echo.
echo Restoring cities (this may take 10-20 minutes)...
echo.

REM Check if node is installed
where node >nul 2>nul
if errorlevel 1 (
    echo ❌ ERROR: Node.js not found! Please install Node.js first.
    pause
    exit /b 1
)

echo Starting city generation...
echo.

REM Set counter for successful/failed cities
setlocal enabledelayedexpansion

set CITIES=^
Lagos|Nigeria|1000,^
New York|USA|5000,^
London|United Kingdom|4500,^
Tokyo|Japan|6000,^
Dubai|United Arab Emirates|5500

set SUCCESS=0
set FAILED=0

for %%G in (%CITIES%) do (
    for /f "tokens=1,2,3 delims=|" %%A in ("%%G") do (
        set CITY=%%A
        set COUNTRY=%%B
        set PRICE=%%C
        
        echo.
        echo ─────────────────────────────────────────────────────────────────
        echo 🏙️  Generating: !CITY!, !COUNTRY! ^(basePrice: !PRICE!^)
        echo ─────────────────────────────────────────────────────────────────
        echo.
        
        node tools/generateCityData.js --city="!CITY!" --country="!COUNTRY!" --basePrice=!PRICE!
        
        if errorlevel 1 (
            echo.
            echo ❌ Failed to generate !CITY!
            set /a FAILED+=1
        ) else (
            echo.
            echo ✅ Successfully generated !CITY!
            set /a SUCCESS+=1
        )
    )
)

echo.
echo ═════════════════════════════════════════════════════════════════════════
echo 📊 RESTORATION SUMMARY
echo ═════════════════════════════════════════════════════════════════════════
echo ✅ Successful: !SUCCESS!
echo ❌ Failed: !FAILED!
echo 📍 Total: %CITIES:,= ! cities processed
echo.

if %FAILED% equ 0 (
    echo 🎉 All cities restored successfully!
    echo    Your cities collection is now fully populated.
) else (
    echo ⚠️  Some cities failed to generate.
    echo    Check the output above for error details.
)

echo.
echo Verifying restoration...
node tools/check-cities.js

echo.
pause
