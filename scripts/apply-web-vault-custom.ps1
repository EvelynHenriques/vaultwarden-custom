param(
    [string]$ClientsDir = "clients"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CustomDir = (Join-Path (Join-Path $ScriptDir "..") "web-vault-custom") | Resolve-Path

if (-not (Test-Path $ClientsDir)) {
    throw "Bitwarden clients directory not found: $ClientsDir"
}

Write-Host "Applying Vaultwarden web-vault customizations from $CustomDir"

Get-ChildItem $CustomDir -Recurse -File | Where-Object {
    $_.FullName -notmatch [regex]::Escape([IO.Path]::Combine($CustomDir.Path, "patches"))
} | ForEach-Object {
    $relative = $_.FullName.Substring($CustomDir.Path.Length + 1)
    $destination = Join-Path $ClientsDir $relative
    $destinationDir = Split-Path $destination -Parent
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    Copy-Item $_.FullName $destination -Force
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
