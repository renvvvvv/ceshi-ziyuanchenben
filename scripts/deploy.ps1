# 数据中心测试验证平台 - 部署脚本 (Windows PowerShell)
# 在项目根目录执行：.\note\deploy.ps1
#
# 模式：
#   build   - 仅构建前后端（默认）
#   dev     - 启动本地开发服务器
#   docker  - 本地 Docker 部署

param(
    [string]$Mode = "build",
    [string]$ApiKey = $env:MINIMAX_API_KEY
)

$ErrorActionPreference = "Stop"
$ROOT_DIR = (Get-Item (Join-Path $PSScriptRoot "..")).FullName

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  数据中心测试验证平台 - 部署脚本" -ForegroundColor Cyan
Write-Host "  模式: $Mode" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

function Build-Frontend {
    Write-Host "==> [1/2] 构建前端" -ForegroundColor Yellow
    Set-Location $ROOT_DIR
    $env:NODE_OPTIONS = "--max-old-space-size=8192"
    npm install --ignore-scripts
    npx vite build

    if (-not (Test-Path "dist")) {
        Write-Host "ERROR: 前端构建失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "OK 前端构建完成" -ForegroundColor Green
}

function Build-Backend {
    Write-Host "==> [2/2] 构建后端" -ForegroundColor Yellow
    Set-Location (Join-Path $ROOT_DIR "server")
    npm install --ignore-scripts
    npx tsc

    if (-not (Test-Path "dist")) {
        Write-Host "ERROR: 后端构建失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "OK 后端构建完成" -ForegroundColor Green
}

function Deploy-Docker {
    Build-Frontend
    Build-Backend

    Write-Host "==> Docker 构建镜像" -ForegroundColor Yellow
    Set-Location $ROOT_DIR
    docker-compose build --no-cache
    docker-compose down --remove-orphans 2>$null

    Write-Host "==> 启动服务" -ForegroundColor Yellow
    $env:MINIMAX_API_KEY = $ApiKey
    docker-compose up -d

    Start-Sleep -Seconds 3
    try {
        $code = (Invoke-WebRequest -Uri "http://localhost:80/" -UseBasicParsing -TimeoutSec 5).StatusCode
        if ($code -eq 200) {
            Write-Host "OK 部署完成" -ForegroundColor Green
            Write-Host "   前端: http://localhost:80"
            Write-Host "   后端: http://localhost:3001/api/health"
        }
    } catch {
        Write-Host "ERROR: 服务未正常启动" -ForegroundColor Red
        docker-compose logs --tail 50
    }
}

function Start-DevServer {
    Write-Host "==> 启动后端 :3001" -ForegroundColor Yellow
    $proc1 = Start-Process -FilePath "npx" -ArgumentList "tsx","src/index.ts" `
        -WorkingDirectory (Join-Path $ROOT_DIR "server") -PassThru -NoNewWindow

    Write-Host "==> 启动前端 :3000" -ForegroundColor Yellow
    $proc2 = Start-Process -FilePath "npx" -ArgumentList "vite","--host" `
        -WorkingDirectory $ROOT_DIR -PassThru -NoNewWindow

    Start-Sleep -Seconds 3
    Write-Host "OK 开发服务器已启动" -ForegroundColor Green
    Write-Host "   前端: http://localhost:3000" -ForegroundColor Green
    Write-Host "   后端: http://localhost:3001/api/health" -ForegroundColor Green
}

switch ($Mode) {
    "build" {
        Build-Frontend
        Build-Backend
        Write-Host "OK 构建完成" -ForegroundColor Green
        Write-Host "   前端: dist/" -ForegroundColor Green
        Write-Host "   后端: server/dist/" -ForegroundColor Green
        Write-Host ""
        Write-Host "下一步：使用 Git Bash 执行 ./note/deploy.sh 部署到云服务器" -ForegroundColor Yellow
    }
    "docker" {
        Deploy-Docker
    }
    "dev" {
        Start-DevServer
    }
    default {
        Write-Host "ERROR: 未知模式 '$Mode'。支持: build | docker | dev" -ForegroundColor Red
        exit 1
    }
}
