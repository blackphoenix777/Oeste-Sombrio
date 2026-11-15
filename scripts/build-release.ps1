# Script de build local, assinatura Minisign, geração do latest.json e publicação no GitHub Releases (Tauri v2)
param(
    [string]$PrivateKeyPath = "",
    [string]$ReleaseNotes = "",
    [string]$Password = "",
    [switch]$SkipPublish = $false,
    [switch]$SkipBuild = $false
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repoRoot = Split-Path -Parent $PSScriptRoot
$tauriConfPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"

if (-not (Test-Path $tauriConfPath)) {
    throw "Arquivo tauri.conf.json não encontrado em: $tauriConfPath"
}

$tauriConf = Get-Content -Path $tauriConfPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $tauriConf.version
$pubkey = $tauriConf.plugins.updater.pubkey
$endpoint = $tauriConf.plugins.updater.endpoints | Select-Object -First 1

if ([string]::IsNullOrWhiteSpace($version)) {
    throw "Campo 'version' ausente em tauri.conf.json."
}
if ([string]::IsNullOrWhiteSpace($pubkey)) {
    throw "Campo 'plugins.updater.pubkey' ausente em tauri.conf.json."
}

Write-Host "=== Dark West Release Builder v$version ===" -ForegroundColor Cyan
Write-Host "Endpoint configurado: $endpoint"

# Extrai URL base e slug (owner/repo) do repositório GitHub a partir do endpoint
$repoSlug = "blackphoenix777/Oeste-Sombrio"
$githubRepoUrl = "https://github.com/$repoSlug"
if ($endpoint -match "^https://github\.com/([^/]+/[^/]+)/releases/") {
    $repoSlug = $Matches[1]
    $githubRepoUrl = "https://github.com/$repoSlug"
}

$tagName = "v$version"
$uploadDir = Join-Path $repoRoot "src-tauri\target\release\bundle\release-upload"

# Monta notas de lançamento diretas (sem depender de Pull Requests / --generate-notes)
if ([string]::IsNullOrWhiteSpace($ReleaseNotes)) {
    $commitLog = ""
    try {
        $rawCommits = & git -C $repoRoot -c i18n.logOutputEncoding=UTF-8 log -n 5 --pretty=format:"- %s" 2>$null
        if ($LASTEXITCODE -eq 0 -and $rawCommits) {
            $commitLog = ($rawCommits -join "`n").Trim()
        }
    } catch {
        $commitLog = ""
    }

    $ReleaseNotes = "Nova versão do Dark West contendo melhorias e correções recentes."
    if (-not [string]::IsNullOrWhiteSpace($commitLog)) {
        $ReleaseNotes += "`n`nAlterações recentes:`n$commitLog"
    }
}

if (-not $SkipBuild) {
    # Localiza a chave privada Minisign sem gravar no repositório
    $foundKeyPath = $null
    $candidatePaths = @()
    if (-not [string]::IsNullOrWhiteSpace($PrivateKeyPath)) {
        $candidatePaths += $PrivateKeyPath
    }
    $candidatePaths += "C:\.tauri\darkwest.key"
    $candidatePaths += (Join-Path $env:USERPROFILE ".tauri\darkwest.key")
    $candidatePaths += (Join-Path $env:USERPROFILE ".tauri\darkwest")

    foreach ($p in $candidatePaths) {
        if ($p -and (Test-Path $p)) {
            $contentCheck = Get-Content -Path $p -Raw -Encoding UTF8
            if ($contentCheck -match "encrypted key" -or $contentCheck -match "RW" -or $p.EndsWith(".key")) {
                $foundKeyPath = $p
                break
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
        if (-not $foundKeyPath) {
            $foundKeyPath = Read-Host "Informe o caminho completo para a chave privada Minisign (ex: C:\.tauri\darkwest.key)"
        }

        if (-not $foundKeyPath -or -not (Test-Path $foundKeyPath)) {
            throw "Chave privada não encontrada. Gere uma com 'npx tauri signer generate -w `"$env:USERPROFILE\.tauri\darkwest.key`"' ou informe o caminho correto."
        }

        Write-Host "Carregando chave privada de: $foundKeyPath" -ForegroundColor DarkGray
        $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Path $foundKeyPath -Raw -Encoding UTF8).Trim()
    }

    if (-not [string]::IsNullOrEmpty($Password)) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $Password
    }
    $env:CI = "true"

    Write-Host "`nExecutando 'npx tauri build --ci'..." -ForegroundColor Yellow
    Push-Location $repoRoot
    try {
        & npx tauri build --ci
        if ($LASTEXITCODE -ne 0) {
            throw "Falha no comando 'npx tauri build --ci' (código $LASTEXITCODE)."
        }
    } finally {
        Pop-Location
    }

    $nsisDir = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"
    if (-not (Test-Path $nsisDir)) {
        throw "Diretório de saída NSIS não encontrado em: $nsisDir"
    }

    $installerFile = Get-ChildItem -Path $nsisDir -Filter "*-setup.exe" |
        Where-Object { $_.Name -like "*$version*" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $installerFile) {
        $installerFile = Get-ChildItem -Path $nsisDir -Filter "*-setup.exe" |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
    }

    if (-not $installerFile) {
        throw "Instalador NSIS (*-setup.exe) não encontrado em $nsisDir."
    }

    $sigFile = "$($installerFile.FullName).sig"
    if (-not (Test-Path $sigFile)) {
        Write-Host "Assinatura automática não gerada pelo build. Executando fallback 'tauri signer sign'..." -ForegroundColor Yellow
        $effectivePass = if ($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD } else { $Password }
        $tauriCliJs = Join-Path $repoRoot "node_modules\@tauri-apps\cli\tauri.js"
        if ($foundKeyPath -and (Test-Path $foundKeyPath)) {
            & node $tauriCliJs signer sign -f $foundKeyPath "--password=$effectivePass" $installerFile.FullName
        } else {
            & node $tauriCliJs signer sign -k $env:TAURI_SIGNING_PRIVATE_KEY "--password=$effectivePass" $installerFile.FullName
        }
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $sigFile)) {
            throw "Arquivo de assinatura '$sigFile' não foi gerado. Verifique a chave privada e a senha."
        }
    }

    $signature = (Get-Content -Path $sigFile -Raw -Encoding UTF8).Trim()
    if ([string]::IsNullOrWhiteSpace($signature)) {
        throw "Arquivo .sig está vazio: $sigFile"
    }

    # Prepara pasta limpa de upload sem espaços no nome (evita que o GitHub altere espaços para pontos na URL)
    New-Item -ItemType Directory -Force -Path $uploadDir | Out-Null

    $safeExeName = $installerFile.Name -replace "\s+", "."
    $safeSigName = "$safeExeName.sig"

    $destExe = Join-Path $uploadDir $safeExeName
    $destSig = Join-Path $uploadDir $safeSigName
    Copy-Item -Path $installerFile.FullName -Destination $destExe -Force
    Copy-Item -Path $sigFile -Destination $destSig -Force

    $downloadUrl = "$githubRepoUrl/releases/download/$tagName/$safeExeName"
    $pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    $latestObj = [ordered]@{
        version   = $version
        notes     = $ReleaseNotes
        pub_date  = $pubDate
        platforms = [ordered]@{
            "windows-x86_64" = [ordered]@{
                signature = $signature
                url       = $downloadUrl
            }
        }
    }

    $latestJsonPath = Join-Path $uploadDir "latest.json"
    $latestJsonContent = $latestObj | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($latestJsonPath, $latestJsonContent, [System.Text.UTF8Encoding]::new($false))

    Write-Host "`n=== Build e Assinatura Concluídos com Sucesso! ===" -ForegroundColor Green
} else {
    if (-not (Test-Path $uploadDir)) {
        throw "Pasta de upload não encontrada: $uploadDir. Execute sem -SkipBuild primeiro."
    }
    $exeObj = Get-ChildItem -Path $uploadDir -Filter "*-setup.exe" | Select-Object -First 1
    if (-not $exeObj) {
        throw "Instalador *-setup.exe não encontrado em $uploadDir."
    }
    $destExe = $exeObj.FullName
    $destSig = "$destExe.sig"
    $latestJsonPath = Join-Path $uploadDir "latest.json"
    if (-not (Test-Path $destSig) -or -not (Test-Path $latestJsonPath)) {
        throw "Arquivos .sig ou latest.json ausentes em $uploadDir."
    }
    $safeExeName = $exeObj.Name
    $safeSigName = "$safeExeName.sig"
    $downloadUrl = "$githubRepoUrl/releases/download/$tagName/$safeExeName"
    Write-Host "`nReutilizando artefatos existentes em: $uploadDir" -ForegroundColor Cyan
}

Write-Host "Artefatos para a Release '$tagName':" -ForegroundColor White
Write-Host "  1. $safeExeName"
Write-Host "  2. $safeSigName"
Write-Host "  3. latest.json"
Write-Host "URL configurada no latest.json: $downloadUrl" -ForegroundColor DarkGray

if ($SkipPublish) {
    Write-Host "`nPublicação no GitHub ignorada (-SkipPublish)." -ForegroundColor Yellow
    return
}

$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
if ($ghCmd) {
    Write-Host "`nPublicando release '$tagName' via GitHub CLI (com notas diretas, sem exigir PRs)..." -ForegroundColor Yellow
    $releaseExists = $false
    try {
        & $ghCmd.Source release view $tagName --repo $repoSlug 2>$null | Out-Null
        $releaseExists = ($LASTEXITCODE -eq 0)
    } catch {
        $releaseExists = $false
    }

    if ($releaseExists) {
        Write-Host "Release '$tagName' já existe. Atualizando arquivos e notas..." -ForegroundColor DarkGray
        & $ghCmd.Source release upload $tagName $destExe $destSig $latestJsonPath --repo $repoSlug --clobber
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao enviar arquivos para a release '$tagName' via gh."
        }
        & $ghCmd.Source release edit $tagName --repo $repoSlug --title "Dark West $tagName" --notes $ReleaseNotes
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao atualizar notas da release '$tagName' via gh."
        }
    } else {
        & $ghCmd.Source release create $tagName $destExe $destSig $latestJsonPath --repo $repoSlug --target "main" --title "Dark West $tagName" --notes $ReleaseNotes
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar release '$tagName' via gh."
        }
    }

    Write-Host "`n=== Release '$tagName' Publicada com Sucesso via GitHub CLI! ===" -ForegroundColor Green
    return
}

# Fallback via API REST do GitHub usando token do ambiente ou Git Credential Manager
Write-Host "`nGitHub CLI ('gh') não encontrado no PATH. Publicando via API REST do GitHub (sem exigir PRs)..." -ForegroundColor Yellow

$ghToken = $env:GITHUB_TOKEN
if ([string]::IsNullOrWhiteSpace($ghToken)) {
    $ghToken = $env:GH_TOKEN
}
if ([string]::IsNullOrWhiteSpace($ghToken)) {
    $credInput = "protocol=https`nhost=github.com`n`n"
    $credLines = $credInput | & git credential fill 2>$null
    $passLine = $credLines | Where-Object { $_ -like "password=*" } | Select-Object -First 1
    if ($passLine) {
        $ghToken = $passLine -replace "^password=", ""
    }
}

if ([string]::IsNullOrWhiteSpace($ghToken)) {
    throw "Não foi possível obter credencial do GitHub. Instale o 'gh' (gh auth login) ou defina GITHUB_TOKEN."
}

$apiHeaders = @{
    "Authorization"        = "Bearer $ghToken"
    "Accept"               = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent"           = "DarkWest-Release-Builder"
}

$release = $null
$tagUrl = "https://api.github.com/repos/$repoSlug/releases/tags/$tagName"
try {
    $release = Invoke-RestMethod -Method Get -Uri $tagUrl -Headers $apiHeaders
    Write-Host "Release '$tagName' já existe (ID: $($release.id)). Atualizando notas e artefatos..." -ForegroundColor DarkGray
    $patchPayload = [ordered]@{
        name                   = "Dark West $tagName"
        body                   = $ReleaseNotes
        draft                  = $false
        prerelease             = $false
        generate_release_notes = $false
    } | ConvertTo-Json -Depth 3
    $patchBytes = [System.Text.Encoding]::UTF8.GetBytes($patchPayload)
    $release = Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$repoSlug/releases/$($release.id)" -Headers $apiHeaders -Body $patchBytes -ContentType "application/json; charset=utf-8"
} catch {
    $statusCode = $null
    if ($_.Exception.Response) {
        try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { }
    }
    if ($statusCode -ne 404) {
        throw "Erro ao consultar release '$tagName' no GitHub: $($_.Exception.Message)"
    }
}

if (-not $release) {
    Write-Host "Criando nova release '$tagName' (generate_release_notes = false)..." -ForegroundColor DarkGray
    $createPayload = [ordered]@{
        tag_name               = $tagName
        target_commitish       = "main"
        name                   = "Dark West $tagName"
        body                   = $ReleaseNotes
        draft                  = $false
        prerelease             = $false
        generate_release_notes = $false
    } | ConvertTo-Json -Depth 3
    $createBytes = [System.Text.Encoding]::UTF8.GetBytes($createPayload)
    $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repoSlug/releases" -Headers $apiHeaders -Body $createBytes -ContentType "application/json; charset=utf-8"
}

$filesToUpload = @($destExe, $destSig, $latestJsonPath)
foreach ($filePath in $filesToUpload) {
    $fileName = [System.IO.Path]::GetFileName($filePath)
    $existingAsset = $null
    if ($release.assets) {
        $existingAsset = $release.assets | Where-Object { $_.name -eq $fileName } | Select-Object -First 1
    }
    if ($existingAsset) {
        Write-Host "  Substituindo asset existente: $fileName..." -ForegroundColor DarkGray
        Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repoSlug/releases/assets/$($existingAsset.id)" -Headers $apiHeaders | Out-Null
    }

    Write-Host "  Enviando asset: $fileName..." -ForegroundColor Cyan
    $encodedName = [System.Uri]::EscapeDataString($fileName)
    $uploadAssetUrl = "https://uploads.github.com/repos/$repoSlug/releases/$($release.id)/assets?name=$encodedName"
    Invoke-RestMethod -Method Post -Uri $uploadAssetUrl -Headers $apiHeaders -InFile $filePath -ContentType "application/octet-stream" -TimeoutSec 300 | Out-Null
}

Write-Host "`n=== Release '$tagName' Publicada com Sucesso no GitHub! ===" -ForegroundColor Green
Write-Host "Página da Release: $($release.html_url)" -ForegroundColor Cyan
