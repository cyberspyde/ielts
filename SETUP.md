# IELTS Platform Setup Guide (No Redis/Docker)

## Prerequisites

1. **Node.js** (v16 or higher)
2. **PostgreSQL** (v14 or higher)

## Quick Start

### Using Startup Script (Recommended)

1. **Copy environment file:**
   ```bash
   copy env.example .env
   ```

2. **Edit `.env` file** with your PostgreSQL credentials:
   ```env
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=ielts
   DB_USER=postgres
   DB_PASSWORD=your_postgres_password
   ```

3. **Run startup script:**
   ```bash
   startup-no-redis.bat
   ```

## Manual Setup

### 1. Database Setup

1. **Install PostgreSQL** from https://www.postgresql.org/download/

2. **Create database:**
   ```sql
   -- Connect as postgres user
   psql -U postgres
   
   -- Create database
   CREATE DATABASE ielts;
   
   -- Connect to the database
   \c ielts
   
   -- Run the setup script
   \i setup-existing-db.sql
   ```

### 2. Environment Configuration

1. **Copy environment template:**
   ```bash
   copy env.example .env
   ```

2. **Edit `.env` file** with your settings:
   ```env
   # Database Configuration
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=ielts
   DB_USER=postgres
   DB_PASSWORD=your_postgres_password
   ```

### 3. Install Dependencies

```bash
# Root dependencies
npm install

# Server dependencies
cd server
npm install
cd ..

# Client dependencies
cd client
npm install
cd ..
```

### 4. Build and Start

```bash
# Build server
cd server
npm run build
cd ..

# Start application
npm run dev
```

## Access URLs

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:7000
- **Database:** localhost:5432

## Login Credentials

- **Admin:** `admin@bestcenter.com` / `admin123`
- **Test Ticket:** `TEST123456`

## Troubleshooting

### Database Connection Issues

1. **Check if PostgreSQL is running:**
   ```bash
   pg_isready -h localhost -p 5432
   ```

2. **Verify credentials in `.env` file**

3. **Test connection:**
   ```bash
   psql -h localhost -U postgres -d ielts
   ```

### Port Conflicts

If ports are already in use:

1. **Change ports in `.env` file**
2. **Kill processes using the ports:**
   ```bash
   # Windows
   netstat -ano | findstr :7000
   taskkill /PID <PID> /F
   ```

## Development

### Database Migrations

```bash
cd server
npm run migrate
```

### Seed Data

```bash
cd server
npm run seed
```

### Testing

```bash
# Server tests
cd server
npm test

# Client tests
cd client
npm test
```

## Features

### What's Included:
- ✅ Complete IELTS exam platform
- ✅ User authentication and authorization
- ✅ Exam creation and management
- ✅ Student exam taking interface
- ✅ Admin dashboard
- ✅ Ticket-based exam access
- ✅ Session management (in-memory)
- ✅ Rate limiting (in-memory)
- ✅ PostgreSQL database
- ✅ Real-time features with WebSocket

### What's Not Included (No Redis/Docker):
- ❌ Redis caching
- ❌ Docker containers
- ❌ Distributed session storage
- ❌ Redis-based rate limiting

## Notes

- **Sessions are stored in memory** - they will be lost when the server restarts
- **Rate limiting is in-memory** - limits reset when the server restarts
- **For production**, consider using Redis for better scalability
- **All data is stored in PostgreSQL** - no external caching dependencies
