# IELTS Online Testing Platform

A comprehensive IELTS online testing platform for Best Center, featuring real-time exam monitoring, ticket-based access control, and comprehensive admin management.

## Features

### For Students
- Secure online IELTS exam taking
- Real-time timer and progress tracking
- All IELTS sections: Reading, Listening, Writing, Speaking
- Instant results and detailed analytics
- Browser lockdown for exam security

### For Administrators
- Complete exam creation and management
- Student and ticket management
- Real-time exam monitoring via WebSockets
- Comprehensive analytics and reporting
- Question bank management

### Technical Features
- PostgreSQL database for reliable data storage
- WebSocket integration for real-time features
- JWT-based authentication and authorization
- Automated scoring with detailed analytics
- Docker containerization for easy deployment

## Technology Stack

### Frontend
- React 18 with TypeScript
- Vite for fast development
- Tailwind CSS for styling
- Socket.io for real-time communication
- React Router for navigation

### Backend
- Node.js with Express and TypeScript
- PostgreSQL database
- Socket.io for WebSocket communication
- JWT for authentication
- Redis for session management

### Infrastructure
- Docker and Docker Compose
- Nginx reverse proxy
- Environment-based configuration

## Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL 14+
- Redis 6+
- Docker (optional)

### Installation

1. Clone and install dependencies:
```bash
git clone <repository>
cd ielts-online-platform
npm install
```

2. Set up environment variables:
```bash
cp server/.env.example server/.env
# Edit server/.env with your database credentials
```

3. Start the development environment:
```bash
# With Docker
npm run docker:dev

# Or manually
npm run dev
```

4. Run database migrations:
```bash
npm run migrate
```

## Project Structure

```
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # Custom React hooks
│   │   ├── contexts/       # React contexts
│   │   ├── types/          # TypeScript definitions
│   │   └── utils/          # Utility functions
├── server/                 # Node.js backend
│   ├── src/
│   │   ├── routes/         # API routes
│   │   ├── middleware/     # Express middleware
│   │   ├── models/         # Database models
│   │   ├── services/       # Business logic
│   │   ├── utils/          # Utility functions
│   │   └── config/         # Configuration files
│   ├── migrations/         # Database migrations
│   └── tests/              # Backend tests
├── shared/                 # Shared types and utilities
├── docker/                 # Docker configuration
└── docs/                   # Additional documentation
```

## API Documentation

### Authentication
- `POST /api/auth/login` - Student/Admin login
- `POST /api/auth/register` - Student registration  
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Tickets
- `POST /api/admin/tickets` - Create exam tickets
- `GET /api/tickets/:code` - Validate ticket
- `POST /api/tickets/:code/use` - Use ticket for exam

### Exams
- `GET /api/exams` - List available exams
- `POST /api/exams/:id/start` - Start exam session
- `POST /api/exams/:id/submit` - Submit exam answers
- `GET /api/exams/:id/results` - Get exam results

### Admin
- `GET /api/admin/dashboard` - Dashboard statistics
- `POST /api/admin/exams` - Create exam
- `GET /api/admin/students` - Manage students
- `GET /api/admin/analytics` - Analytics data

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details