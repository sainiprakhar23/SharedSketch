const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const ioClient = require('socket.io-client');

process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // ephemeral port for test isolation
const { app, server, io, rooms } = require('../server/server');

let testPort;
let baseUrl;

test.before((t, done) => {
    server.listen(0, '127.0.0.1', () => {
        testPort = server.address().port;
        baseUrl = `http://127.0.0.1:${testPort}`;
        done();
    });
});

test.after((t, done) => {
    io.close(() => {
        done();
    });
});

function httpGet(path) {
    return new Promise((resolve, reject) => {
        http.get(`${baseUrl}${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    parsed = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        }).on('error', reject);
    });
}

test('Health endpoint (/health) returns UP status', async () => {
    const res = await httpGet('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'UP');
    assert.ok(res.body.timestamp);
});

test('Readiness endpoint (/ready) returns READY status', async () => {
    const res = await httpGet('/ready');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'READY');
    assert.equal(res.body.checks.server, 'UP');
});

test('Metrics endpoint (/metrics) exposes Prometheus formatted metrics', async () => {
    const res = await httpGet('/metrics');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/plain/);
    assert.match(res.body, /sharedsketch_http_requests_total/);
    assert.match(res.body, /sharedsketch_active_connections/);
    assert.match(res.body, /sharedsketch_active_rooms/);
});

test('Stats endpoint (/stats) returns aggregated metrics without leaking room details', async () => {
    const res = await httpGet('/stats');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.totalRooms, 'number');
    assert.equal(typeof res.body.totalUsers, 'number');
    // Ensure room details and user identities are not leaked
    assert.equal(res.body.rooms, undefined);
});

test('Static routes serve index and canvas pages', async () => {
    const indexRes = await httpGet('/');
    assert.equal(indexRes.status, 200);
    assert.match(indexRes.body, /SharedSketch/);

    const canvasRes = await httpGet('/canvas');
    assert.equal(canvasRes.status, 200);
    assert.match(canvasRes.body, /canvas/);
});

test('Socket.IO real-time collaboration workflow', async () => {
    const roomId = 'TESTROOM1234';
    
    // Connect first client (Host)
    const client1 = ioClient(baseUrl, {
        transports: ['websocket'],
        reconnection: false
    });

    await new Promise((resolve) => client1.on('connect', resolve));
    assert.ok(client1.connected);

    // Host joins room
    const hostJoinPromise = new Promise((resolve) => {
        client1.on('users-list', (data) => {
            resolve(data);
        });
    });

    client1.emit('join-room', {
        roomId,
        roomName: 'Automated Test Room',
        userName: 'Alice',
        userColor: '#ff0000',
        capacity: 5,
        isHost: true
    });

    const hostUsers = await hostJoinPromise;
    assert.equal(hostUsers.users.length, 1);
    assert.equal(hostUsers.users[0].name, 'Alice');

    // Host sends drawing event
    client1.emit('draw', {
        fromX: 10,
        fromY: 10,
        toX: 50,
        toY: 50,
        color: '#ff0000',
        width: 3,
        tool: 'brush',
        strokeId: 'stroke-1'
    });

    // Connect second client (Peer)
    const client2 = ioClient(baseUrl, {
        transports: ['websocket'],
        reconnection: false
    });

    await new Promise((resolve) => client2.on('connect', resolve));

    // Client 2 joins and expects drawing-history and users-list
    const peerHistoryPromise = new Promise((resolve) => {
        client2.on('drawing-history', (data) => {
            resolve(data);
        });
    });

    client2.emit('join-room', {
        roomId,
        roomName: 'Automated Test Room',
        userName: 'Bob',
        userColor: '#00ff00',
        capacity: 5,
        isHost: false
    });

    const historyData = await peerHistoryPromise;
    assert.ok(historyData.history.length >= 1);
    assert.equal(historyData.history[0].color, '#ff0000');

    // Verify drawing broadcast from client 2 to client 1
    const drawBroadcastPromise = new Promise((resolve) => {
        client1.on('draw', (data) => {
            resolve(data);
        });
    });

    client2.emit('draw', {
        fromX: 60,
        fromY: 60,
        toX: 100,
        toY: 100,
        color: '#00ff00',
        width: 4,
        tool: 'brush',
        strokeId: 'stroke-2'
    });

    const broadcastedDraw = await drawBroadcastPromise;
    assert.equal(broadcastedDraw.color, '#00ff00');
    assert.equal(broadcastedDraw.userName, 'Bob');

    // Cleanup clients
    client1.disconnect();
    client2.disconnect();
});
