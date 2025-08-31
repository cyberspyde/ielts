@echo off
echo ========================================
echo IELTS Platform Startup Script
echo ========================================
echo.

REM Check if .env file exists
if not exist ".env" (
    echo Creating .env file from template...
    copy "env.example" ".env"
    echo Please edit .env file with your configuration
    echo.
)

REM Check if PostgreSQL is running
echo Checking PostgreSQL...
pg_isready -h localhost -p 5432 >nul 2>&1
if %errorlevel% neq 0 (
    echo PostgreSQL is not running. Please start PostgreSQL first.
    echo You can install PostgreSQL from: https://www.postgresql.org/download/
    echo Or use Docker: docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:14
    pause
    exit /b 1
)

REM Check if Redis is running
echo Checking Redis...
redis-cli ping >nul 2>&1
if %errorlevel% neq 0 (
    echo Redis is not running. Starting Redis with Docker...
    docker run --name redis -p 6379:6379 -d redis:7-alpine
    if %errorlevel% neq 0 (
        echo Failed to start Redis. Please install Redis or Docker.
        pause
        exit /b 1
    )
)

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
echo.
echo Press Ctrl+C to stop all services
echo.

REM Start both server and client concurrently
npm run dev

pause
