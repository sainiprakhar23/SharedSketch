const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const MemoryRoomStore = require('./memoryStore');
const RedisRoomStore = require('./redisStore');

function createRoomStore(redisUrl) {
    if (redisUrl) {
        return new RedisRoomStore(redisUrl);
    }
    return new MemoryRoomStore();
}

async function setupRedisAdapter(io, redisUrl) {
    if (!redisUrl) {
        return null;
    }

    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => console.error('Redis Adapter PubClient error:', err.message));
    subClient.on('error', (err) => console.error('Redis Adapter SubClient error:', err.message));

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));
    console.log('Socket.IO Redis adapter enabled.');

    return {
        pubClient,
        subClient,
        close: async () => {
            await Promise.all([
                pubClient.isOpen ? pubClient.quit() : Promise.resolve(),
                subClient.isOpen ? subClient.quit() : Promise.resolve()
            ]);
        }
    };
}

module.exports = {
    createRoomStore,
    setupRedisAdapter,
    MemoryRoomStore,
    RedisRoomStore
};
