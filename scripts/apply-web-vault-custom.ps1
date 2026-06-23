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
    "libs/auth/src/angular/registration/registration-start/registration-start.component.html",
    "apps/web/src/app/admin-console/organizations/settings/two-factor-setup.component.ts",
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

Write-Host "Applying Vaultwarden web-vault customizations from $CustomDir"

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
if (Test-Path $shieldLogoSource) {
    $shieldLogoDestinationDir = Split-Path $shieldLogoDestination -Parent
    New-Item -ItemType Directory -Force -Path $shieldLogoDestinationDir | Out-Null
    Copy-Item $shieldLogoSource $shieldLogoDestination -Force
    Write-Host "  updated apps/web/src/images/icons/logo-shield.svg"
} else {
    Write-Warning "Missing logo image: apps/web/src/images/icons/logo-shield.svg"
}

$ebvaultLogoSource = Join-Path $CustomDir "apps\web\src\images\icons\logo-ebvault.svg"
$ebvaultLogoDestination = Join-Path $ClientsDir "apps\web\src\images\icons\logo-ebvault.svg"
if (Test-Path $ebvaultLogoSource) {
    $ebvaultLogoDestinationDir = Split-Path $ebvaultLogoDestination -Parent
    New-Item -ItemType Directory -Force -Path $ebvaultLogoDestinationDir | Out-Null
    Copy-Item $ebvaultLogoSource $ebvaultLogoDestination -Force
    Write-Host "  updated apps/web/src/images/icons/logo-ebvault.svg"
} else {
    Write-Warning "Missing logo image: apps/web/src/images/icons/logo-ebvault.svg"
}

$indexFaviconPatch = Join-Path $CustomDir "patches\index-favicon.patch"
if (Test-Path $indexFaviconPatch) {
    Push-Location $ClientsDir
    try {
        git apply --ignore-space-change --check $indexFaviconPatch 2>$null
        if ($LASTEXITCODE -eq 0) {
            git apply --ignore-space-change $indexFaviconPatch
            Write-Host "  applied patches/index-favicon.patch"
        } else {
            Write-Warning "Could not apply index-favicon.patch; update apps/web/src/index.html manually."
        }
    } finally {
        Pop-Location
    }
}

$patchFile = Join-Path $CustomDir "patches\oss-routing.module.patch"
if (Test-Path $patchFile) {
    Push-Location $ClientsDir
    try {
        git apply --check $patchFile 2>$null
        if ($LASTEXITCODE -eq 0) {
            git apply $patchFile
            Write-Host "  applied patches/oss-routing.module.patch"
        } else {
            Write-Warning "Could not apply oss-routing.module.patch; add mandatoryAuthenticatorGuard manually."
        }
    } finally {
        Pop-Location
    }
}

Write-Host "Done."
