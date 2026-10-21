const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
const ioClient = require('socket.io-client');
const { createRoomStore, setupRedisAdapter } = require('../server/storage');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

async function createAppInstance(port = 0) {
    const app = express();
    const server = http.createServer(app);
    const io = socketIO(server, {
        cors: { origin: '*', methods: ['GET', 'POST'] }
    });

    const roomStore = createRoomStore(REDIS_URL);
    await roomStore.init();
    const adapter = await setupRedisAdapter(io, REDIS_URL);

    io.on('connection', (socket) => {
        socket.on('join-room', async (data) => {
            const { roomId, roomName, userName, userColor, capacity, isHost } = data;
            if (isHost) {
                await roomStore.createRoom(roomId, roomName, capacity);
            }
            const room = await roomStore.getRoom(roomId);
            if (!room) {
                socket.emit('room-error', { message: 'Room not found' });
                return;
            }

            await roomStore.addUser(roomId, socket.id, { name: userName, color: userColor });
            socket.join(roomId);
            socket.roomId = roomId;
            socket.userName = userName;

            const users = await roomStore.getRoomUsers(roomId);
            socket.emit('users-list', { users });

            socket.to(roomId).emit('user-joined', {
                userId: socket.id,
                userName,
                userColor,
                users
            });

            const history = await roomStore.getDrawingHistory(roomId);
            if (history.length > 0) {
                socket.emit('drawing-history', { history });
            }
        });

        socket.on('draw', async (data) => {
            if (!socket.roomId) return;
            await roomStore.addDrawingStroke(socket.roomId, {
                ...data,
                userId: socket.id
            });
            socket.to(socket.roomId).emit('draw', {
                userId: socket.id,
                userName: socket.userName,
                ...data
            });
        });

        socket.on('draw-line', async (data) => {
            if (!socket.roomId) return;
            await roomStore.addDrawingStroke(socket.roomId, {
                ...data,
                userId: socket.id
            });
            socket.to(socket.roomId).emit('draw-line', {
                userId: socket.id,
                userName: socket.userName,
                ...data
            });
        });

        socket.on('undo', async () => {
            if (!socket.roomId) return;
            const { history, removedGroup } = await roomStore.undo(socket.roomId, socket.id);
            if (removedGroup && removedGroup.length > 0) {
                io.to(socket.roomId).emit('full-history-update', { history });
            }
        });

        socket.on('disconnect', async () => {
            if (socket.roomId) {
                await roomStore.removeUser(socket.roomId, socket.id);
                const users = await roomStore.getRoomUsers(socket.roomId);
                io.to(socket.roomId).emit('user-left', {
                    userId: socket.id,
                    users
                });
            }
        });
    });

    app.get('/ready', async (req, res) => {
        const isHealthy = await roomStore.isHealthy();
        if (!isHealthy) {
            return res.status(503).json({ status: 'NOT_READY', storage: 'DOWN' });
        }
        res.status(200).json({ status: 'READY', storage: 'UP' });
    });

    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    const assignedPort = server.address().port;

    return {
        port: assignedPort,
        url: `http://127.0.0.1:${assignedPort}`,
        roomStore,
        adapter,
        server,
        io,
        close: async () => {
            await new Promise((r) => io.close(r));
            if (adapter) await adapter.close();
            await roomStore.close();
        }
    };
}

test('Multi-Replica Scaling Test: Clients on different Node instances share state via Redis', async () => {
    // 1. Boot Instance A and Instance B
    const instanceA = await createAppInstance(0);
    const instanceB = await createAppInstance(0);

    assert.notEqual(instanceA.port, instanceB.port, 'Instances must run on different ports');

    const roomId = 'SCALE-ROOM-TEST';

    // 2. Connect Client 1 to Instance A
    const client1 = ioClient(instanceA.url, { transports: ['websocket'], reconnection: false });
    await new Promise((resolve) => client1.on('connect', resolve));

    // 3. Client 1 joins room on Instance A
    const client1JoinPromise = new Promise((resolve) => {
        client1.on('users-list', resolve);
    });

    client1.emit('join-room', {
        roomId,
        roomName: 'Scaling Room',
        userName: 'Alice',
        userColor: '#3b82f6',
        capacity: 10,
        isHost: true
    });

    const client1Users = await client1JoinPromise;
    assert.equal(client1Users.users.length, 1);
    assert.equal(client1Users.users[0].name, 'Alice');

    // 4. Client 1 draws on Instance A
    client1.emit('draw', {
        fromX: 10,
        fromY: 10,
        toX: 100,
        toY: 100,
        color: '#3b82f6',
        width: 4,
        tool: 'brush',
        strokeId: 'stroke-instance-a'
    });

    // Short tick to ensure Redis list write completes
    await new Promise((r) => setTimeout(r, 100));

    // 5. Connect Client 2 to Instance B
    const client2 = ioClient(instanceB.url, { transports: ['websocket'], reconnection: false });
    await new Promise((resolve) => client2.on('connect', resolve));

    // Client 1 on Instance A expects user-joined relayed from Instance B
    const client1UserJoinedPromise = new Promise((resolve) => {
        client1.on('user-joined', resolve);
    });

    // Client 2 on Instance B expects drawing-history retrieved from Redis
    const client2HistoryPromise = new Promise((resolve) => {
        client2.on('drawing-history', resolve);
    });

    // 6. Client 2 joins SAME room on Instance B
    client2.emit('join-room', {
        roomId,
        roomName: 'Scaling Room',
        userName: 'Bob',
        userColor: '#10b981',
        capacity: 10,
        isHost: false
    });

    const userJoinedEvent = await client1UserJoinedPromise;
    assert.equal(userJoinedEvent.userName, 'Bob', 'Instance A must receive user-joined broadcast via Redis adapter');

    const client2History = await client2HistoryPromise;
    assert.ok(client2History.history.length >= 1, 'Instance B must supply drawing history from Redis to Client 2');
    assert.equal(client2History.history[0].color, '#3b82f6');
    assert.equal(client2History.history[0].strokeId, 'stroke-instance-a');

    // 7. Client 2 (on Instance B) draws a line -> Client 1 (on Instance A) receives broadcast
    const client1DrawPromise = new Promise((resolve) => {
        client1.on('draw-line', resolve);
    });

    client2.emit('draw-line', {
        fromX: 200,
        fromY: 200,
        toX: 300,
        toY: 300,
        color: '#10b981',
        width: 5,
        tool: 'line',
        strokeId: 'stroke-instance-b'
    });

    const receivedLine = await client1DrawPromise;
    assert.equal(receivedLine.userName, 'Bob');
    assert.equal(receivedLine.color, '#10b981');
    assert.equal(receivedLine.strokeId, 'stroke-instance-b');

    // 8. Client 1 (on Instance A) triggers undo -> Client 2 (on Instance B) receives full-history-update
    const client2UndoPromise = new Promise((resolve) => {
        client2.on('full-history-update', resolve);
    });

    client1.emit('undo');

    const updatedHistory = await client2UndoPromise;
    // Alice's stroke was undone, so remaining stroke in history should be Bob's line
    assert.equal(updatedHistory.history.length, 1);
    assert.equal(updatedHistory.history[0].strokeId, 'stroke-instance-b');

    // 9. Client 2 disconnects from Instance B -> Client 1 on Instance A receives user-left
    const client1UserLeftPromise = new Promise((resolve) => {
        client1.on('user-left', resolve);
    });

    client2.disconnect();
    const userLeftData = await client1UserLeftPromise;
    assert.equal(userLeftData.users.length, 1);
    assert.equal(userLeftData.users[0].name, 'Alice');

    // Cleanup
    client1.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    await instanceA.close();
    await instanceB.close();
});

test('Readiness probe returns 503 when Redis cannot be reached', async () => {
    // Deliberately point store to unreachable port
    const badRedisStore = createRoomStore('redis://127.0.0.1:63799');
    // IsHealthy check should return false without crashing
    const healthy = await badRedisStore.isHealthy();
    assert.equal(healthy, false, 'Storage must report unhealthy when Redis is unreachable');
    await badRedisStore.close().catch(() => {});
});
