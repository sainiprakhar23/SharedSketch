class MemoryRoomStore {
    constructor() {
        this.rooms = new Map();
        this.type = 'memory';
    }

    async init() {
        return true;
    }

    async close() {
        this.rooms.clear();
    }

    async isHealthy() {
        return true;
    }

    async createRoom(roomId, roomName, capacity) {
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, {
                roomId,
                roomName,
                capacity: Number(capacity) || 5,
                users: new Map(),
                drawingHistory: [],
                userRedoStacks: new Map(),
                createdAt: new Date().toISOString()
            });
        }
        return this.rooms.get(roomId);
    }

    async getRoom(roomId) {
        return this.rooms.get(roomId) || null;
    }

    async addUser(roomId, userId, userData) {
        const room = this.rooms.get(roomId);
        if (!room) return false;
        if (room.users.size >= room.capacity) return false;

        room.users.set(userId, {
            id: userId,
            name: userData.name,
            color: userData.color,
            x: userData.x || 0,
            y: userData.y || 0
        });
        return true;
    }

    async removeUser(roomId, userId) {
        const room = this.rooms.get(roomId);
        if (!room) return { remainingUsers: 0, deletedRoom: false };

        const removed = room.users.delete(userId);
        if (room.users.size === 0) {
            this.rooms.delete(roomId);
            return { remainingUsers: 0, deletedRoom: true, user: removed };
        }
        return { remainingUsers: room.users.size, deletedRoom: false, user: removed };
    }

    async getRoomUsers(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return [];
        return Array.from(room.users.values());
    }

    async updateUserCursor(roomId, userId, x, y) {
        const room = this.rooms.get(roomId);
        if (room && room.users.has(userId)) {
            const user = room.users.get(userId);
            user.x = x;
            user.y = y;
        }
    }

    async addDrawingStroke(roomId, strokeData, maxHistory = 1000) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        room.drawingHistory.push({
            ...strokeData,
            timestamp: Date.now()
        });

        if (strokeData.userId) {
            room.userRedoStacks.delete(strokeData.userId);
        }

        if (room.drawingHistory.length > maxHistory) {
            room.drawingHistory.shift();
        }
    }

    async getDrawingHistory(roomId) {
        const room = this.rooms.get(roomId);
        return room ? [...room.drawingHistory] : [];
    }

    async clearDrawingHistory(roomId) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.drawingHistory = [];
            room.userRedoStacks.clear();
        }
    }

    async undo(roomId, userId) {
        const room = this.rooms.get(roomId);
        if (!room || room.drawingHistory.length === 0) return { history: [], removedGroup: [] };

        let targetStrokeId = null;
        for (let i = room.drawingHistory.length - 1; i >= 0; i--) {
            const stroke = room.drawingHistory[i];
            if (stroke.userId === userId) {
                targetStrokeId = stroke.strokeId || null;
                break;
            }
        }

        if (targetStrokeId === null) {
            for (let i = room.drawingHistory.length - 1; i >= 0; i--) {
                const stroke = room.drawingHistory[i];
                if (stroke.userId === userId) {
                    const removed = room.drawingHistory.splice(i, 1)[0];
                    if (!room.userRedoStacks.has(userId)) room.userRedoStacks.set(userId, []);
                    room.userRedoStacks.get(userId).push({ strokes: [removed] });
                    return { history: [...room.drawingHistory], removedGroup: [removed] };
                }
            }
            return { history: [...room.drawingHistory], removedGroup: [] };
        }

        const removedGroup = [];
        for (let i = room.drawingHistory.length - 1; i >= 0; i--) {
            const stroke = room.drawingHistory[i];
            if (stroke.userId === userId && stroke.strokeId === targetStrokeId) {
                removedGroup.unshift(room.drawingHistory.splice(i, 1)[0]);
            }
        }

        if (removedGroup.length > 0) {
            if (!room.userRedoStacks.has(userId)) room.userRedoStacks.set(userId, []);
            room.userRedoStacks.get(userId).push({ strokes: removedGroup });
        }

        return { history: [...room.drawingHistory], removedGroup };
    }

    async redo(roomId, userId) {
        const room = this.rooms.get(roomId);
        if (!room) return { history: [], restoredGroup: [] };

        const userRedoStack = room.userRedoStacks.get(userId);
        if (userRedoStack && userRedoStack.length > 0) {
            const group = userRedoStack.pop();
            if (group && Array.isArray(group.strokes)) {
                group.strokes.forEach(st => room.drawingHistory.push(st));
                return { history: [...room.drawingHistory], restoredGroup: group.strokes };
            }
        }
        return { history: [...room.drawingHistory], restoredGroup: [] };
    }

    async getStats() {
        const totalRooms = this.rooms.size;
        const totalUsers = Array.from(this.rooms.values()).reduce((sum, r) => sum + r.users.size, 0);
        return { totalRooms, totalUsers };
    }
}

module.exports = MemoryRoomStore;
