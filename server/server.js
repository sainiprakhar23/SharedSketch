// server/server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const {
    register,
    metricsMiddleware,
    activeConnections,
    activeRooms,
    socketEventsTotal
} = require('./metrics');
const { createRoomStore, setupRedisAdapter } = require('./storage');

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST']
    }
});

// Middleware
app.use(metricsMiddleware);
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());

// Serve client files from server/public
app.use(express.static(path.join(__dirname, 'public')));

// Room storage
const REDIS_URL = process.env.REDIS_URL || null;
const roomStore = createRoomStore(REDIS_URL);
let redisAdapterInstance = null;

async function initServerDependencies() {
    await roomStore.init();
    if (REDIS_URL) {
        redisAdapterInstance = await setupRedisAdapter(io, REDIS_URL);
    }
}

io.on('connection', (socket) => {
    activeConnections.inc();
    console.log(`New connection: ${socket.id}`);

    socket.on('join-room', async (data) => {
        socketEventsTotal.inc({ event_type: 'join-room' });
        const { roomId, roomName, userName, userColor, capacity, isHost } = data;

        if (isHost) {
            await roomStore.createRoom(roomId, roomName, capacity);
            const stats = await roomStore.getStats();
            activeRooms.set(stats.totalRooms);
        }

        const room = await roomStore.getRoom(roomId);
        if (!room) {
            socket.emit('room-error', { message: 'ERROR: Room not found' });
            return;
        }

        const usersCount = (await roomStore.getRoomUsers(roomId)).length;
        if (usersCount >= room.capacity) {
            socket.emit('room-error', { message: 'ERROR: Room is full' });
            return;
        }

        const added = await roomStore.addUser(roomId, socket.id, {
            name: userName,
            color: userColor
        });

        if (!added) {
            socket.emit('room-error', { message: 'ERROR: Could not join room' });
            return;
        }

        socket.join(roomId);
        socket.roomId = roomId;
        socket.userName = userName;
        socket.userColor = userColor;

        const users = await roomStore.getRoomUsers(roomId);
        socket.emit('users-list', { users });

        socket.to(roomId).emit('user-joined', {
            userId: socket.id,
            userName: userName,
            userColor: userColor,
            users: users
        });

        const history = await roomStore.getDrawingHistory(roomId);
        if (history.length > 0) {
            socket.emit('drawing-history', { history });
        }

        console.log(`Room ${roomId} has ${users.length} user(s)`);
    });

    socket.on('draw', async (data) => {
        socketEventsTotal.inc({ event_type: 'draw' });
        if (!socket.roomId) return;

        const { fromX, fromY, toX, toY, color, width, tool, strokeId } = data;

        if (tool === 'brush' || tool === 'eraser') {
            await roomStore.addDrawingStroke(socket.roomId, {
                fromX, fromY, toX, toY, color, width, tool,
                userId: socket.id,
                strokeId: strokeId || null
            });
        }

        socket.to(socket.roomId).emit('draw', {
            userId: socket.id,
            userName: socket.userName,
            fromX,
            fromY,
            toX,
            toY,
            color,
            width,
            tool,
            strokeId
        });
    });

    socket.on('draw-line', async (data) => {
        socketEventsTotal.inc({ event_type: 'draw-line' });
        if (!socket.roomId) return;

        await roomStore.addDrawingStroke(socket.roomId, {
            ...data,
            userId: socket.id,
            strokeId: data.strokeId || null
        });

        socket.to(socket.roomId).emit('draw-line', {
            userId: socket.id,
            userName: socket.userName,
            ...data
        });
    });

    socket.on('clear-canvas', async () => {
        socketEventsTotal.inc({ event_type: 'clear-canvas' });
        if (!socket.roomId) return;

        await roomStore.clearDrawingHistory(socket.roomId);
        console.log(`Room ${socket.roomId} canvas cleared by ${socket.id}`);

        io.to(socket.roomId).emit('full-history-update', { history: [] });
    });

    socket.on('cursor-move', async (data) => {
        socketEventsTotal.inc({ event_type: 'cursor-move' });
        if (!socket.roomId) return;

        const { x, y } = data;
        await roomStore.updateUserCursor(socket.roomId, socket.id, x, y);

        socket.to(socket.roomId).emit('cursor-move', {
            userId: socket.id,
            userName: socket.userName,
            userColor: socket.userColor,
            x,
            y
        });
    });

    socket.on('undo', async () => {
        socketEventsTotal.inc({ event_type: 'undo' });
        if (!socket.roomId) return;

        const { history, removedGroup } = await roomStore.undo(socket.roomId, socket.id);
        if (removedGroup && removedGroup.length > 0) {
            io.to(socket.roomId).emit('full-history-update', { history });
        }
    });

    socket.on('redo', async () => {
        socketEventsTotal.inc({ event_type: 'redo' });
        if (!socket.roomId) return;

        const { history, restoredGroup } = await roomStore.redo(socket.roomId, socket.id);
        if (restoredGroup && restoredGroup.length > 0) {
            io.to(socket.roomId).emit('full-history-update', { history });
        }
    });

    socket.on('disconnect', async () => {
        activeConnections.dec();
        if (socket.roomId) {
            const { remainingUsers } = await roomStore.removeUser(socket.roomId, socket.id);
            const users = await roomStore.getRoomUsers(socket.roomId);

            io.to(socket.roomId).emit('user-left', {
                userId: socket.id,
                users: users
            });

            if (remainingUsers === 0) {
                const stats = await roomStore.getStats();
                activeRooms.set(stats.totalRooms);
            }
        }

        console.log(`User disconnected: ${socket.id}`);
    });

    socket.on('ping', () => {
        socketEventsTotal.inc({ event_type: 'ping' });
        socket.emit('pong');
    });
});

// HTTP Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/canvas', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'canvas.html'));
});

// Liveness probe (cheap check)
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'UP',
        timestamp: new Date().toISOString()
    });
});

// Readiness probe (checks storage connectivity)
app.get('/ready', async (req, res) => {
    const isHealthy = await roomStore.isHealthy();
    if (!isHealthy) {
        return res.status(503).json({
            status: 'NOT_READY',
            checks: {
                server: 'UP',
                storage: 'DOWN',
                storageType: roomStore.type
            }
        });
    }

    res.status(200).json({
        status: 'READY',
        checks: {
            server: 'UP',
            storage: 'UP',
            storageType: roomStore.type
        }
    });
});

// Metrics probe for Prometheus scraping
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (err) {
        res.status(500).end(err.message);
    }
});

// Safe aggregated stats (non-sensitive)
app.get('/stats', async (req, res) => {
    try {
        const stats = await roomStore.getStats();
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve stats' });
    }
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

let serverInstance = null;
if (process.env.NODE_ENV !== 'test') {
    initServerDependencies().then(() => {
        serverInstance = server.listen(PORT, HOST, () => {
            console.log(`
   Collaborative Canvas Server
Server running on http://${HOST}:${PORT}
Storage: ${roomStore.type}
Health:  http://${HOST}:${PORT}/health
Ready:   http://${HOST}:${PORT}/ready
Metrics: http://${HOST}:${PORT}/metrics
Stats:   http://${HOST}:${PORT}/stats
            `);
        });
    }).catch((err) => {
        console.error('Failed to initialize server dependencies:', err);
        process.exit(1);
    });
}

async function shutdown(signal) {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    if (serverInstance) {
        serverInstance.close(async () => {
            console.log('HTTP server closed.');
            io.close(async () => {
                console.log('Socket.IO server closed.');
                if (redisAdapterInstance) {
                    await redisAdapterInstance.close();
                }
                await roomStore.close();
                process.exit(0);
            });
        });

        setTimeout(() => {
            console.error('Forced shutdown due to timeout.');
            process.exit(1);
        }, 10000).unref();
    } else {
        process.exit(0);
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = {
    app,
    server,
    io,
    roomStore,
    initServerDependencies
};
