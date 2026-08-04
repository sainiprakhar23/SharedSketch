// server/server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST']
    }
});

// Basic middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());

// Serve client files from server/public
app.use(express.static(path.join(__dirname, 'public')));

// Rooms data structure
const rooms = new Map();

function createRoom(roomId, roomName, capacity) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            roomId,
            roomName,
            capacity,
            users: new Map(),
            drawingHistory: [],
            userRedoStacks: new Map(),
            createdAt: new Date()
        });
        console.log(`Room created: ${roomName} (${roomId})`);
    }
}

function addUserToRoom(roomId, userId, userName, userColor) {
    const room = rooms.get(roomId);
    if (room && room.users.size < room.capacity) {
        room.users.set(userId, {
            id: userId,
            name: userName,
            color: userColor,
            x: 0,
            y: 0
        });
        console.log(`${userName} joined room ${roomId} (${room.users.size}/${room.capacity})`);
        return true;
    }
    return false;
}

function removeUserFromRoom(roomId, userId) {
    const room = rooms.get(roomId);
    if (room) {
        const user = room.users.get(userId);
        if (user) {
            room.users.delete(userId);
            console.log(`${user.name} left room ${roomId}`);
        }

        if (room.users.size === 0) {
            rooms.delete(roomId);
            console.log(`Room deleted: ${roomId}`);
        }
    }
}

function getRoomUsers(roomId) {
    const room = rooms.get(roomId);
    if (room) {
        return Array.from(room.users.values());
    }
    return [];
}

io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    socket.on('join-room', (data) => {
        const { roomId, roomName, userName, userColor, capacity, isHost } = data;

        if (isHost) {
            createRoom(roomId, roomName, capacity);
        }

        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('room-error', { message: 'ERROR: Room not found' });
            return;
        }

        if (room.users.size >= room.capacity) {
            socket.emit('room-error', { message: 'ERROR: Room is full' });
            return;
        }

        addUserToRoom(roomId, socket.id, userName, userColor);

        socket.join(roomId);
        socket.roomId = roomId;
        socket.userName = userName;
        socket.userColor = userColor;

        const users = getRoomUsers(roomId);
        socket.emit('users-list', { users });

        socket.to(roomId).emit('user-joined', {
            userId: socket.id,
            userName: userName,
            userColor: userColor,
            users: users
        });

        if (room.drawingHistory.length > 0) {
            socket.emit('drawing-history', { history: room.drawingHistory });
        }

        console.log(`Room ${roomId} has ${room.users.size} user(s)`);
    });

    socket.on('draw', (data) => {
        if (!socket.roomId) return;

        const { fromX, fromY, toX, toY, color, width, tool, strokeId } = data;

        if (tool === 'brush' || tool === 'eraser') {
            const room = rooms.get(socket.roomId);
            if (room) {
                room.drawingHistory.push({
                    fromX, fromY, toX, toY, color, width, tool,
                    userId: socket.id,
                    strokeId: strokeId || null,
                    timestamp: Date.now()
                });

                room.userRedoStacks.delete(socket.id);

                if (room.drawingHistory.length > 1000) {
                    room.drawingHistory.shift();
                }
            }
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

    socket.on('draw-line', (data) => {
        if (!socket.roomId) return;

        const room = rooms.get(socket.roomId);
        if (room) {
            room.drawingHistory.push({
                ...data,
                userId: socket.id,
                strokeId: data.strokeId || null,
                timestamp: Date.now()
            });

            room.userRedoStacks.delete(socket.id);
        }

        socket.to(socket.roomId).emit('draw-line', {
            userId: socket.id,
            userName: socket.userName,
            ...data
        });
    });

    socket.on('clear-canvas', () => {
        if (!socket.roomId) return;

        const room = rooms.get(socket.roomId);
        if (room) {
            room.drawingHistory = [];
            room.userRedoStacks = new Map();
            console.log(`Room ${socket.roomId} canvas cleared by ${socket.id}`);

            io.to(socket.roomId).emit('full-history-update', { history: room.drawingHistory });
        }
    });

    socket.on('cursor-move', (data) => {
        if (!socket.roomId) return;

        const { x, y } = data;

        const room = rooms.get(socket.roomId);
        if (room) {
            const user = room.users.get(socket.id);
            if (user) {
                user.x = x;
                user.y = y;
            }
        }

        socket.to(socket.roomId).emit('cursor-move', {
            userId: socket.id,
            userName: socket.userName,
            userColor: socket.userColor,
            x,
            y
        });
    });

    socket.on('undo', () => {
        console.log(`\n>>>>>>>>>>> UNDO RECEIVED FROM CLIENT <<<<<<<<<<<`);
        console.log(`User ${socket.id} requested undo`);

        if (!socket.roomId) {
            console.log('No room ID, returning');
            return;
        }

        const room = rooms.get(socket.roomId);
        console.log(`Room found:`, !!room);
        if (!room) return;

        console.log(`Current history length: ${room.drawingHistory.length}`);
        console.log(`Looking for last stroke group by userId: ${socket.id}`);

        let targetStrokeId = null;
        for (let i = room.drawingHistory.length - 1; i >= 0; i--) {
            const stroke = room.drawingHistory[i];
            if (stroke.userId === socket.id) {
                targetStrokeId = stroke.strokeId || null;
                break;
            }
        }

        if (targetStrokeId === null) {
            for (let i = room.drawingHistory.length - 1; i >= 0; i--) {
                const stroke = room.drawingHistory[i];
                if (stroke.userId === socket.id) {
                    const removed = room.drawingHistory.splice(i, 1)[0];
                    if (!room.userRedoStacks.has(socket.id)) room.userRedoStacks.set(socket.id, []);
                    room.userRedoStacks.get(socket.id).push({ strokes: [removed] });
                    console.log(`Removed single stroke (no strokeId) at index ${i}`);
                    io.to(socket.roomId).emit('full-history-update', { history: room.drawingHistory });
                    return;
                }
            }

            console.log('No strokes found for user to undo');
            return;
        }

        const removedGroup = [];
        for (let i = room.drawingHistory.length - 1; i >= 0; i--) {
            const stroke = room.drawingHistory[i];
            if (stroke.userId === socket.id && stroke.strokeId === targetStrokeId) {
                removedGroup.unshift(room.drawingHistory.splice(i, 1)[0]);
            }
        }

        if (removedGroup.length > 0) {
            if (!room.userRedoStacks.has(socket.id)) room.userRedoStacks.set(socket.id, []);
            room.userRedoStacks.get(socket.id).push({ strokes: removedGroup });
            console.log(`SUCCESS: Removed stroke group with id ${targetStrokeId}, items: ${removedGroup.length}`);

            io.to(socket.roomId).emit('full-history-update', { history: room.drawingHistory });
            console.log('Broadcasted full-history-update after undo');
        } else {
            console.log('No stroke group removed (maybe already undone)');
        }
    });

    socket.on('redo', () => {
        console.log(`\n>>>>>>>>>>> REDO RECEIVED FROM CLIENT <<<<<<<<<<<`);
        console.log(`User ${socket.id} requested redo`);

        if (!socket.roomId) {
            console.log('No room ID, returning');
            return;
        }

        const room = rooms.get(socket.roomId);
        if (!room) return;

        const userRedoStack = room.userRedoStacks.get(socket.id);
        console.log(`User's redo stack has ${userRedoStack?.length || 0} items`);

        if (userRedoStack && userRedoStack.length > 0) {
            const group = userRedoStack.pop();
            if (group && Array.isArray(group.strokes) && group.strokes.length > 0) {
                group.strokes.forEach(st => room.drawingHistory.push(st));
                console.log(`Restored group with ${group.strokes.length} strokes`);

                io.to(socket.roomId).emit('full-history-update', { history: room.drawingHistory });
                console.log('Broadcasted full-history-update after redo');
            }
        } else {
            console.log('No items in redo stack');
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId) {
            removeUserFromRoom(socket.roomId, socket.id);

            const users = getRoomUsers(socket.roomId);
            io.to(socket.roomId).emit('user-left', {
                userId: socket.id,
                users: users
            });
        }

        console.log(`User disconnected: ${socket.id}`);
    });

    socket.on('ping', () => {
        socket.emit('pong');
    });
});

// Serve index and canvas (from server/public)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/canvas', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'canvas.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'Server is running' });
});

app.get('/stats', (req, res) => {
    const stats = {
        totalRooms: rooms.size,
        totalUsers: Array.from(rooms.values()).reduce((sum, room) => sum + room.users.size, 0),
        rooms: Array.from(rooms.values()).map(room => ({
            roomId: room.roomId,
            roomName: room.roomName,
            users: room.users.size,
            capacity: room.capacity
        }))
    };
    res.json(stats);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
   Collaborative Canvas Server
Server running on port ${PORT}
Stats: http://localhost:${PORT}/stats
    `);
});

process.on('SIGTERM', () => {
    console.log('Shutting down...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
