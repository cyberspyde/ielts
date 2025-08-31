@echo off
echo ========================================
echo IELTS Platform Docker Startup Script
echo ========================================
echo.

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker is not running. Please start Docker Desktop first.
    pause
    exit /b 1
)

REM Check if .env file exists
if not exist ".env" (
    echo Creating .env file from template...
    copy "env.example" ".env"
    echo Please edit .env file with your configuration
    echo.
)

REM Start database and Redis services
echo Starting database and Redis services...
docker-compose up -d postgres redis

REM Wait for services to be ready
echo Waiting for services to be ready...
timeout /t 10 /nobreak >nul

REM Install dependencies if needed
echo Installing dependencies...
if not exist "node_modules" (
    echo Installing root dependencies...
    npm install
)

if not exist "server\node_modules" (
    echo Installing server dependencies...
    cd server
    npm install
    cd ..
)

if not exist "client\node_modules" (
    echo Installing client dependencies...
    cd client
    npm install
    cd ..
)

REM Build the server
echo Building server...
cd server
npm run build
if %errorlevel% neq 0 (
    echo Failed to build server
    pause
    exit /b 1
)
cd ..

REM Start the application
echo Starting IELTS Platform...
echo.
echo Backend will run on: http://localhost:7000
echo Frontend will run on: http://localhost:5173
echo Database is running on: localhost:5432
echo Redis is running on: localhost:6379
echo.
echo Press Ctrl+C to stop all services
echo.

REM Start both server and client concurrently
npm run dev

pause
