#!/usr/bin/env pwsh
# =============================================================
# Nanjil VIP – Capacitor Mobile Setup Script (PowerShell)
# =============================================================
# Run this script from the project root:
#   .\setup-mobile.ps1
# =============================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  Nanjil VIP – Capacitor Mobile Setup" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# ---- Step 1: Install Capacitor packages ----
Write-Host "Step 1/7 - Installing Capacitor packages..." -ForegroundColor Yellow
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios --legacy-peer-deps
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm install failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Capacitor packages installed." -ForegroundColor Green

# ---- Step 2: Build the React web app ----
Write-Host ""
Write-Host "Step 2/7 - Building the React web app..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm run build failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Build completed. dist/ folder created." -ForegroundColor Green

# ---- Step 3: Initialize Capacitor ----
Write-Host ""
Write-Host "Step 3/7 - Initializing Capacitor..." -ForegroundColor Yellow
npx cap init "Nanjil VIP" com.nanjil.vip --web-dir dist
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: cap init may have already been run. Continuing..." -ForegroundColor Yellow
}
Write-Host "  Capacitor initialized." -ForegroundColor Green

# ---- Step 4: Add Android platform ----
Write-Host ""
Write-Host "Step 4/7 - Adding Android platform..." -ForegroundColor Yellow
npx cap add android
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: Android platform may already exist. Continuing..." -ForegroundColor Yellow
}
Write-Host "  Android project added at ./android/" -ForegroundColor Green

# ---- Step 5: Configure Android permissions ----
Write-Host ""
Write-Host "Step 5/7 - Configuring Android permissions..." -ForegroundColor Yellow

$androidManifestPath = Join-Path $ProjectRoot "android\app\src\main\AndroidManifest.xml"
$networkConfigDir = Join-Path $ProjectRoot "android\app\src\main\res\xml"

if (Test-Path $androidManifestPath) {
    # Copy network security config
    New-Item -ItemType Directory -Force -Path $networkConfigDir | Out-Null
    Copy-Item (Join-Path $ProjectRoot "android-config\network_security_config.xml") $networkConfigDir
    Write-Host "  Network security config copied." -ForegroundColor Green

    # Patch AndroidManifest.xml to add permissions
    $manifest = Get-Content $androidManifestPath -Raw

    $permissionsToAdd = @(
        'android.permission.INTERNET',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.CAMERA',
        'android.permission.VIBRATE',
        'android.permission.POST_NOTIFICATIONS'
    )

    $permissionXml = ""
    foreach ($perm in $permissionsToAdd) {
        if ($manifest -notmatch $perm) {
            $permissionXml += "    <uses-permission android:name=`"$perm`" />`n"
        }
    }

    if ($permissionXml -ne "") {
        $manifest = $manifest -replace '(<manifest[^>]*>)', "`$1`n$permissionXml"
        Set-Content $androidManifestPath $manifest -Encoding UTF8
        Write-Host "  Android permissions configured." -ForegroundColor Green
    } else {
        Write-Host "  Android permissions already present." -ForegroundColor Green
    }
} else {
    Write-Host "  AndroidManifest.xml not found. Skipping permission patch." -ForegroundColor Yellow
}

# ---- Step 6: Sync Capacitor ----
Write-Host ""
Write-Host "Step 6/7 - Syncing Capacitor..." -ForegroundColor Yellow
npx cap sync
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: cap sync failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Capacitor synced successfully." -ForegroundColor Green

# ---- Step 7: iOS (macOS only) ----
Write-Host ""
Write-Host "Step 7/7 - iOS Platform..." -ForegroundColor Yellow
if ($IsMacOS) {
    Write-Host "  macOS detected. Adding iOS platform..." -ForegroundColor Yellow
    npx cap add ios
    Write-Host "  iOS platform added at ./ios/" -ForegroundColor Green
    Write-Host "  Run 'pod install' inside ios/App/ to install CocoaPods dependencies." -ForegroundColor Cyan
} else {
    Write-Host "  Windows detected. iOS build requires macOS + Xcode." -ForegroundColor Yellow
    Write-Host "  iOS config files are in ./ios-config/ for when you have a Mac." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=================================================" -ForegroundColor Green
Write-Host "  SETUP COMPLETE!" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    1. Run: npm run android" -ForegroundColor Cyan
Write-Host "       → Opens Android Studio" -ForegroundColor Gray
Write-Host "    2. Wait for Gradle sync to complete in Android Studio" -ForegroundColor Gray
Write-Host "    3. Click Run (▶) to launch on emulator or device" -ForegroundColor Gray
Write-Host ""
Write-Host "  To rebuild and sync after code changes:" -ForegroundColor White
Write-Host "    npm run mobile:build" -ForegroundColor Cyan
Write-Host ""
