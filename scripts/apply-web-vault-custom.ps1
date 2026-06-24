param(
    [string]$ClientsDir = "clients"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CustomDir = (Join-Path (Join-Path $ScriptDir "..") "web-vault-custom") | Resolve-Path

if (-not (Test-Path $ClientsDir)) {
    throw "Bitwarden clients directory not found: $ClientsDir"
}

$OverlayFiles = @(
    "apps/web/src/app/app.component.ts",
    "apps/web/src/app/auth/settings/account/account.component.ts",
    "apps/web/src/app/auth/settings/account/account.component.html",
    "apps/web/src/app/auth/settings/two-factor/two-factor-setup.component.ts",
    "apps/web/src/app/auth/settings/two-factor/two-factor-setup.component.html",
    "apps/web/src/app/auth/settings/two-factor/two-factor-setup-authenticator.component.ts",
    "apps/web/src/app/auth/settings/two-factor/two-factor-setup-authenticator.component.html",
    "apps/web/src/app/auth/settings/two-factor/two-factor-verify.component.ts",
    "apps/web/src/app/auth/settings/two-factor/two-factor-verify.component.html",
    "apps/web/src/app/layouts/frontend-layout.component.ts",
    "apps/web/src/app/layouts/frontend-layout.component.html",
    "libs/auth/src/angular/login/login-secondary-content.component.ts",
    "apps/web/src/app/layouts/user-layout.component.ts",
    "apps/web/src/app/layouts/user-layout.component.html",
    "apps/web/src/app/layouts/web-side-nav.component.html",
    "apps/web/src/app/layouts/product-switcher/navigation-switcher/navigation-switcher.component.html",
    "apps/web/src/app/layouts/product-switcher/product-switcher.component.html",
    "libs/components/src/anon-layout/anon-layout.component.html",
    "libs/components/src/landing-layout/landing-header.component.html",
    "libs/components/src/landing-layout/landing-hero.component.html",
    "libs/components/src/navigation/nav-logo.component.html",
    "libs/auth/src/angular/registration/registration-start/registration-start.component.html",
    "apps/web/src/app/admin-console/organizations/settings/two-factor-setup.component.ts",
    "apps/web/src/app/vault/guards/mandatory-authenticator-account.util.ts",
    "apps/web/src/app/vault/guards/mandatory-authenticator.guard.ts",
    "apps/web/src/app/vault/guards/mandatory-authenticator.policy.ts",
    "apps/web/src/app/vault/guards/mandatory-authenticator-lock.service.ts",
    "apps/web/src/app/vault/guards/mandatory-authenticator-enforcement.service.ts",
    "apps/web/src/app/auth/settings/security/security-routing.module.ts",
    "apps/web/src/app/auth/settings/security/security.component.ts",
    "apps/web/src/app/auth/settings/security/security.component.html",
    "apps/web/src/app/admin-console/organizations/layouts/organization-layout.component.ts",
    "apps/web/src/app/admin-console/organizations/layouts/organization-layout.component.html"
)

Write-Host "Applying EBvault web-vault customizations from $CustomDir"

foreach ($relative in $OverlayFiles) {
    $source = Join-Path $CustomDir $relative
    if (-not (Test-Path $source)) {
        throw "Missing overlay file: $relative"
    }
    $destination = Join-Path $ClientsDir $relative
    $destinationDir = Split-Path $destination -Parent
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    Copy-Item $source $destination -Force
    Write-Host "  updated $relative"
}

$shieldLogoSource = Join-Path $CustomDir "apps\web\src\images\icons\logo-shield.svg"
$shieldLogoDestination = Join-Path $ClientsDir "apps\web\src\images\icons\logo-shield.svg"
if (-not (Test-Path $shieldLogoSource)) {
    throw "Missing overlay file: apps/web/src/images/icons/logo-shield.svg"
}
New-Item -ItemType Directory -Force -Path (Split-Path $shieldLogoDestination -Parent) | Out-Null
Copy-Item $shieldLogoSource $shieldLogoDestination -Force
Write-Host "  updated apps/web/src/images/icons/logo-shield.svg"

$ebvaultLogoSource = Join-Path $CustomDir "apps\web\src\images\icons\logo-ebvault.svg"
$ebvaultLogoDestination = Join-Path $ClientsDir "apps\web\src\images\icons\logo-ebvault.svg"
if (-not (Test-Path $ebvaultLogoSource)) {
    throw "Missing overlay file: apps/web/src/images/icons/logo-ebvault.svg"
}
New-Item -ItemType Directory -Force -Path (Split-Path $ebvaultLogoDestination -Parent) | Out-Null
Copy-Item $ebvaultLogoSource $ebvaultLogoDestination -Force
Write-Host "  updated apps/web/src/images/icons/logo-ebvault.svg"

$serverLogo = Join-Path (Join-Path $ScriptDir "..") "src\static\images\logo-ebvault.svg"
New-Item -ItemType Directory -Force -Path (Split-Path $serverLogo -Parent) | Out-Null
Copy-Item $ebvaultLogoSource $serverLogo -Force
Write-Host "  updated src/static/images/logo-ebvault.svg"

$python = $null
foreach ($candidate in @("python3", "python", "py")) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
        $python = $candidate
        break
    }
}
if (-not $python) {
    throw "python3 or python is required to apply EBvault routing/favicon patches"
}

$patcher = Join-Path $ScriptDir "apply-web-vault-source-patches.py"
& $python $patcher $ClientsDir
if ($LASTEXITCODE -ne 0) {
    throw "apply-web-vault-source-patches.py failed with exit code $LASTEXITCODE"
}

$rejFiles = Get-ChildItem -Path $ClientsDir -Filter "*.rej" -Recurse -ErrorAction SilentlyContinue
if ($rejFiles) {
    $rejFiles | ForEach-Object { Write-Error "Stale reject file: $($_.FullName)" }
    throw "Patch reject (.rej) files remain under $ClientsDir"
}

Write-Host "Done."
