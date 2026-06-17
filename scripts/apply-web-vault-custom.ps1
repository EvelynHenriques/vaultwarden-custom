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
    "apps/web/src/app/auth/settings/account/account.component.ts",
    "apps/web/src/app/auth/settings/account/account.component.html",
    "apps/web/src/app/auth/settings/two-factor/two-factor-setup.component.ts",
    "apps/web/src/app/auth/settings/two-factor/two-factor-setup.component.html",
    "apps/web/src/app/auth/settings/two-factor/two-factor-setup-authenticator.component.ts",
    "apps/web/src/app/auth/settings/two-factor/two-factor-setup-authenticator.component.html",
    "apps/web/src/app/layouts/frontend-layout.component.ts",
    "apps/web/src/app/layouts/frontend-layout.component.html",
    "apps/web/src/app/vault/guards/mandatory-authenticator.guard.ts",
    "apps/web/src/app/vault/guards/mandatory-authenticator.policy.ts"
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
