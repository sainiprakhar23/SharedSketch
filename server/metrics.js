const client = require('prom-client');

const register = new client.Registry();

// Add default process and node metrics
client.collectDefaultMetrics({
    register,
    prefix: 'sharedsketch_'
});

// Custom HTTP Metrics
const httpRequestsTotal = new client.Counter({
    name: 'sharedsketch_http_requests_total',
    help: 'Total number of HTTP requests processed',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register]
});

const httpRequestDurationSeconds = new client.Histogram({
    name: 'sharedsketch_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register]
});

// Custom WebSocket / Room Metrics
const activeConnections = new client.Gauge({
    name: 'sharedsketch_active_connections',
    help: 'Current number of active Socket.IO connections',
    registers: [register]
});

const activeRooms = new client.Gauge({
    name: 'sharedsketch_active_rooms',
    help: 'Current number of active drawing rooms',
    registers: [register]
});

const socketEventsTotal = new client.Counter({
    name: 'sharedsketch_socket_events_total',
    help: 'Total count of Socket.IO events processed',
    labelNames: ['event_type'],
    registers: [register]
});

function normalizeRoute(url) {
    if (!url) return 'unknown';
    const parsed = url.split('?')[0];
    if (parsed.startsWith('/socket.io')) return '/socket.io';
    if (parsed === '/' || parsed === '/index.html') return '/';
    if (parsed === '/canvas' || parsed === '/canvas.html') return '/canvas';
    if (parsed === '/health') return '/health';
    if (parsed === '/ready') return '/ready';
    if (parsed === '/stats') return '/stats';
    if (parsed === '/metrics') return '/metrics';
    if (parsed.endsWith('.css') || parsed.endsWith('.js') || parsed.endsWith('.svg') || parsed.endsWith('.png')) {
        return 'static_asset';
    }
    return 'other';
}

function metricsMiddleware(req, res, next) {
    const start = process.hrtime();

    res.on('finish', () => {
        const diff = process.hrtime(start);
        const durationInSeconds = diff[0] + diff[1] / 1e9;
        const route = normalizeRoute(req.originalUrl || req.url);
        const statusCode = res.statusCode ? res.statusCode.toString() : 'unknown';

        httpRequestsTotal.inc({
            method: req.method,
            route,
            status_code: statusCode
        });

        httpRequestDurationSeconds.observe({
            method: req.method,
            route,
            status_code: statusCode
        }, durationInSeconds);
    });

    next();
}

module.exports = {
    register,
    metricsMiddleware,
    activeConnections,
    activeRooms,
    socketEventsTotal
};
