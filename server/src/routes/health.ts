import { Router, Request, Response } from 'express';
import { healthCheck } from '../config/database-no-redis';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// Basic health check
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const health = await healthCheck();
  
  const healthStatus = {
    status: health.database ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    services: {
      database: health.database ? 'connected' : 'disconnected'
    },
    system: {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      pid: process.pid,
    }
  };

  const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(healthStatus);
}));

// Detailed health check (for monitoring systems)
router.get('/detailed', asyncHandler(async (req: Request, res: Response) => {
  const health = await healthCheck();
  
  const detailedHealth = {
    status: health.database ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: process.uptime(),
      human: formatUptime(process.uptime())
    },
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    node_version: process.version,
    services: {
      database: {
        status: health.database ? 'connected' : 'disconnected',
        type: 'PostgreSQL'
      }
    },
    system: {
      memory: {
        ...process.memoryUsage(),
        free: process.memoryUsage().heapTotal - process.memoryUsage().heapUsed,
        usage_percent: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100)
      },
      cpu: process.cpuUsage(),
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      load_average: process.platform !== 'win32' ? require('os').loadavg() : 'N/A (Windows)',
    },
    endpoints: {
      auth: '/api/auth',
      exams: '/api/exams',
      admin: '/api/admin',
      health: '/api/health'
    }
  };

  const statusCode = detailedHealth.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(detailedHealth);
}));

// Liveness probe (for Kubernetes)
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

// Readiness probe (for Kubernetes)
router.get('/ready', asyncHandler(async (req: Request, res: Response) => {
  const health = await healthCheck();
  
  if (health.database) {
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      services: health
    });
  }
}));

// Metrics endpoint (basic)
router.get('/metrics', asyncHandler(async (req: Request, res: Response) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  const metrics = {
    uptime_seconds: process.uptime(),
    memory_heap_used_bytes: memUsage.heapUsed,
    memory_heap_total_bytes: memUsage.heapTotal,
    memory_external_bytes: memUsage.external,
    memory_rss_bytes: memUsage.rss,
    cpu_user_microseconds: cpuUsage.user,
    cpu_system_microseconds: cpuUsage.system,
    process_id: process.pid,
    node_version: process.version,
    timestamp: Date.now()
  };

  res.json(metrics);
}));

// Helper function to format uptime
function formatUptime(uptime: number): string {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(' ');
}

export default router;