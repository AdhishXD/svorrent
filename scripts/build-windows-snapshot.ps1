param(
    [string]$SourceCommit = '',
    [string]$SignerThumbprint = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root 'dist-win'
$staging = Join-Path $build 'staging'
if ($SourceCommit -and $SourceCommit -cnotmatch '^[0-9a-f]{40}$') { throw 'Invalid source commit' }
if ($SignerThumbprint -and $SignerThumbprint -cnotmatch '^[0-9A-F]{40}$') { throw 'Invalid signing thumbprint' }

Remove-Item -LiteralPath $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path (Join-Path $staging 'backend'), (Join-Path $staging 'frontend\dist') -Force | Out-Null
Copy-Item (Join-Path $root 'frontend\dist\*') (Join-Path $staging 'frontend\dist') -Recurse -Force
Copy-Item (Join-Path $root 'frontend\public\favicon.ico') (Join-Path $build 'svorrent.ico')
Copy-Item (Join-Path $build 'svorrent.ico') (Join-Path $staging 'svorrent.ico')

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual C++ build tools are missing' }
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
$launcher = Join-Path $staging 'Svorrent.exe'
$command = 'call "' + $vcvars + '" >nul && cl /nologo /O2 "' + (Join-Path $root 'scripts\launcher.c') + '" /Fe:"' + $launcher + '" /link /SUBSYSTEM:WINDOWS ws2_32.lib shell32.lib user32.lib'
cmd /c $command
if ($LASTEXITCODE -ne 0) { throw 'Windows launcher compilation failed' }

if ($SourceCommit) {
    if (-not $env:SVORRENT_WINDOWS_PFX -or -not $env:SVORRENT_WINDOWS_PFX_PASSWORD -or -not $SignerThumbprint) {
        throw 'Signed main builds require a certificate and its thumbprint'
    }
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $signtool = Get-ChildItem -LiteralPath $kits -Filter signtool.exe -Recurse |
        Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
        Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    if (-not $signtool) { throw 'Windows SDK SignTool is missing' }
    function Sign-File([string]$file) {
        & $signtool sign /f $env:SVORRENT_WINDOWS_PFX /p $env:SVORRENT_WINDOWS_PFX_PASSWORD /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $file
        if ($LASTEXITCODE -ne 0) { throw "Signing failed: $file" }
        $signature = Get-AuthenticodeSignature -LiteralPath $file
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -cne $SignerThumbprint) {
            throw "Signed file verification failed: $file"
        }
    }
    Sign-File $launcher
}

$backend = Join-Path $staging 'backend'
Copy-Item (Join-Path $root 'backend\server.js'), (Join-Path $root 'backend\package.json') $backend
Copy-Item (Join-Path $root 'backend\lib'), (Join-Path $root 'backend\scripts'), (Join-Path $root 'backend\node_modules') $backend -Recurse
if ($SourceCommit) {
    @{ commit = $SourceCommit; signerThumbprint = $SignerThumbprint } |
        ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $backend 'build-info.json') -Encoding UTF8
}

# Use the same NSIS definition as the ordinary Windows release build.
Copy-Item (Join-Path $root 'scripts\installer.nsi') (Join-Path $build 'installer.nsi')
$makensis = Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'
if (-not (Test-Path -LiteralPath $makensis)) { throw 'NSIS is missing; install it before building the Windows installer' }
Push-Location $build
try {
    & $makensis 'installer.nsi'
    if ($LASTEXITCODE -ne 0) { throw 'NSIS installer compilation failed' }
} finally {
    Pop-Location
}
if ($SourceCommit) { Sign-File (Join-Path $build 'Svorrent-Setup.exe') }
Write-Output (Join-Path $build 'Svorrent-Setup.exe')
