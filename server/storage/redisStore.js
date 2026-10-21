const { createClient } = require('redis');

class RedisRoomStore {
    constructor(redisUrl) {
        this.redisUrl = redisUrl;
        this.client = createClient({ url: redisUrl });
        this.type = 'redis';
        this.connected = false;

        this.client.on('error', (err) => {
            console.error('Redis client error:', err.message);
        });

        this.client.on('ready', () => {
            this.connected = true;
        });

        this.client.on('end', () => {
            this.connected = false;
        });
    }

    async init() {
        if (!this.client.isOpen) {
            await this.client.connect();
        }
        this.connected = true;
        console.log(`Connected to Redis at ${this.redisUrl.replace(/:[^:@]*@/, ':****@')}`);
    }

    async close() {
        if (this.client.isOpen) {
            await this.client.quit();
        }
        this.connected = false;
    }

    async isHealthy() {
        if (!this.client.isOpen) return false;
        try {
            const reply = await this.client.ping();
            return reply === 'PONG';
        } catch {
            return false;
        }
    }

    keyPrefix(roomId) {
        return `sharedsketch:room:${roomId}`;
    }

    async createRoom(roomId, roomName, capacity) {
        const metaKey = `${this.keyPrefix(roomId)}:meta`;
        const exists = await this.client.exists(metaKey);

        if (!exists) {
            const createdAt = new Date().toISOString();
            await this.client.hSet(metaKey, {
                roomId,
                roomName,
                capacity: String(capacity || 5),
                createdAt
            });
            await this.client.sAdd('sharedsketch:rooms:active', roomId);
            return {
                roomId,
                roomName,
                capacity: Number(capacity) || 5,
                createdAt
            };
        }

        return this.getRoom(roomId);
    }

    async getRoom(roomId) {
        const metaKey = `${this.keyPrefix(roomId)}:meta`;
        const meta = await this.client.hGetAll(metaKey);
        if (!meta || !meta.roomId) return null;

        const usersCount = await this.client.hLen(`${this.keyPrefix(roomId)}:users`);
        return {
            roomId: meta.roomId,
            roomName: meta.roomName,
            capacity: Number(meta.capacity) || 5,
            createdAt: meta.createdAt,
            userCount: usersCount
        };
    }

    async addUser(roomId, userId, userData) {
        const room = await this.getRoom(roomId);
        if (!room) return false;

        const usersKey = `${this.keyPrefix(roomId)}:users`;
        const currentCount = await this.client.hLen(usersKey);
        if (currentCount >= room.capacity) return false;

        const userObj = {
            id: userId,
            name: userData.name,
            color: userData.color,
            x: userData.x || 0,
            y: userData.y || 0
        };

        await this.client.hSet(usersKey, userId, JSON.stringify(userObj));
        return true;
    }

    async removeUser(roomId, userId) {
        const usersKey = `${this.keyPrefix(roomId)}:users`;
        await this.client.hDel(usersKey, userId);

        const remainingUsers = await this.client.hLen(usersKey);
        if (remainingUsers === 0) {
            // Delete room keys and remove from active rooms
            const metaKey = `${this.keyPrefix(roomId)}:meta`;
            const historyKey = `${this.keyPrefix(roomId)}:history`;
            
            await this.client.del([metaKey, usersKey, historyKey]);
            await this.client.sRem('sharedsketch:rooms:active', roomId);

            // Clean up redo keys for this room
            try {
                const redoKeys = await this.client.keys(`${this.keyPrefix(roomId)}:redo:*`);
                if (redoKeys.length > 0) {
                    await this.client.del(redoKeys);
                }
            } catch (err) {
                console.warn('Error clearing redo keys on room cleanup:', err.message);
            }

            return { remainingUsers: 0, deletedRoom: true };
        }

        return { remainingUsers, deletedRoom: false };
    }

    async getRoomUsers(roomId) {
        const usersKey = `${this.keyPrefix(roomId)}:users`;
        const userStrings = await this.client.hVals(usersKey);
        return userStrings.map((str) => {
            try {
                return JSON.parse(str);
            } catch {
                return null;
            }
        }).filter(Boolean);
    }

    async updateUserCursor(roomId, userId, x, y) {
        const usersKey = `${this.keyPrefix(roomId)}:users`;
        const userStr = await this.client.hGet(usersKey, userId);
        if (userStr) {
            try {
                const user = JSON.parse(userStr);
                user.x = x;
                user.y = y;
                await this.client.hSet(usersKey, userId, JSON.stringify(user));
            } catch (err) {
                console.warn('Failed to update user cursor in Redis:', err.message);
            }
        }
    }

    async addDrawingStroke(roomId, strokeData, maxHistory = 1000) {
        const historyKey = `${this.keyPrefix(roomId)}:history`;
        const strokePayload = JSON.stringify({
            ...strokeData,
            timestamp: Date.now()
        });

        // Atomic pipeline: push stroke, trim to maxHistory, clear user's redo stack
        const multi = this.client.multi();
        multi.rPush(historyKey, strokePayload);
        multi.lTrim(historyKey, -maxHistory, -1);
        if (strokeData.userId) {
            const redoKey = `${this.keyPrefix(roomId)}:redo:${strokeData.userId}`;
            multi.del(redoKey);
        }
        await multi.exec();
    }

    async getDrawingHistory(roomId) {
        const historyKey = `${this.keyPrefix(roomId)}:history`;
        const strokes = await this.client.lRange(historyKey, 0, -1);
        return strokes.map((s) => {
            try {
                return JSON.parse(s);
            } catch {
                return null;
            }
        }).filter(Boolean);
    }

    async clearDrawingHistory(roomId) {
        const historyKey = `${this.keyPrefix(roomId)}:history`;
        await this.client.del(historyKey);

        try {
            const redoKeys = await this.client.keys(`${this.keyPrefix(roomId)}:redo:*`);
            if (redoKeys.length > 0) {
                await this.client.del(redoKeys);
            }
        } catch (err) {
            console.warn('Error clearing redo keys in clearDrawingHistory:', err.message);
        }
    }

    async undo(roomId, userId) {
        const historyKey = `${this.keyPrefix(roomId)}:history`;
        const redoKey = `${this.keyPrefix(roomId)}:redo:${userId}`;

        const rawHistory = await this.client.lRange(historyKey, 0, -1);
        if (!rawHistory || rawHistory.length === 0) {
            return { history: [], removedGroup: [] };
        }

        const history = rawHistory.map((s) => {
            try { return JSON.parse(s); } catch { return null; }
        }).filter(Boolean);

        let targetStrokeId = null;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].userId === userId) {
                targetStrokeId = history[i].strokeId || null;
                break;
            }
        }

        const remainingHistory = [];
        const removedGroup = [];

        if (targetStrokeId === null) {
            let removedOne = false;
            for (let i = history.length - 1; i >= 0; i--) {
                if (!removedOne && history[i].userId === userId) {
                    removedGroup.push(history[i]);
                    removedOne = true;
                } else {
                    remainingHistory.unshift(history[i]);
                }
            }
        } else {
            for (let i = 0; i < history.length; i++) {
                if (history[i].userId === userId && history[i].strokeId === targetStrokeId) {
                    removedGroup.push(history[i]);
                } else {
                    remainingHistory.push(history[i]);
                }
            }
        }

        if (removedGroup.length > 0) {
            // Atomic rewrite of history and push to redo stack
            const multi = this.client.multi();
            multi.del(historyKey);
            if (remainingHistory.length > 0) {
                const serialized = remainingHistory.map(s => JSON.stringify(s));
                multi.rPush(historyKey, serialized);
            }
            multi.rPush(redoKey, JSON.stringify({ strokes: removedGroup }));
            await multi.exec();
        }

        return { history: remainingHistory, removedGroup };
    }

    async redo(roomId, userId) {
        const historyKey = `${this.keyPrefix(roomId)}:history`;
        const redoKey = `${this.keyPrefix(roomId)}:redo:${userId}`;

        const lastRedoRaw = await this.client.rPop(redoKey);
        if (!lastRedoRaw) {
            const currentHistory = await this.getDrawingHistory(roomId);
            return { history: currentHistory, restoredGroup: [] };
        }

        let group = null;
        try {
            group = JSON.parse(lastRedoRaw);
        } catch {
            group = null;
        }

        if (group && Array.isArray(group.strokes) && group.strokes.length > 0) {
            const serialized = group.strokes.map(s => JSON.stringify(s));
            await this.client.rPush(historyKey, serialized);
        }

        const updatedHistory = await this.getDrawingHistory(roomId);
        return { history: updatedHistory, restoredGroup: group ? group.strokes : [] };
    }

    async getStats() {
        const activeRooms = await this.client.sMembers('sharedsketch:rooms:active');
        let totalUsers = 0;

        for (const roomId of activeRooms) {
            const count = await this.client.hLen(`${this.keyPrefix(roomId)}:users`);
            totalUsers += count;
        }

        return {
            totalRooms: activeRooms.length,
            totalUsers
        };
    }
}

module.exports = RedisRoomStore;
