class WebSocketManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.callbacks = {};
    }

    connect(url = 'http://localhost:3000') {
        return new Promise((resolve, reject) => {
            try {
                if (typeof io === 'undefined') {
                    this.loadSocketIO(url).then(() => {
                        this.initSocket(url);
                        resolve();
                    }).catch(reject);
                } else {
                    this.initSocket(url);
                    resolve();
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    loadSocketIO(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `${url}/socket.io/socket.io.js`;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    initSocket(url) {
        this.socket = io(url, {
            reconnection: true,
            reconnectionDelay: this.reconnectDelay,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: this.maxReconnectAttempts,
            transports: ['websocket', 'polling']
        });

        this.setupListeners();
    }

    setupListeners() {
        this.socket.on('connect', () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            console.log('Connected to server');
            this.updateStatus(true);
            this.emit('connected');
        });

        this.socket.on('disconnect', () => {
            this.isConnected = false;
            console.log('Disconnected from server');
            this.updateStatus(false);
            this.emit('disconnected');
        });

        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.updateStatus(false);
        });

        this.socket.on('reconnect_attempt', () => {
            this.reconnectAttempts++;
            console.log(`Reconnection attempt ${this.reconnectAttempts}`);
        });

        this.socket.on('reconnect_failed', () => {
            console.log('Reconnection failed');
            this.updateStatus(false);
        });

        this.socket.on('users-list', (data) => this.emit('users-list', data));
        this.socket.on('user-joined', (data) => this.emit('user-joined', data));
        this.socket.on('user-left', (data) => this.emit('user-left', data));
        this.socket.on('room-error', (data) => this.emit('room-error', data));

        this.socket.on('draw', (data) => this.emit('remote-draw', data));
        this.socket.on('draw-line', (data) => this.emit('remote-draw-line', data));
        this.socket.on('clear-canvas', () => this.emit('remote-clear-canvas'));
        this.socket.on('drawing-history', (data) => this.emit('drawing-history', data));
        this.socket.on('full-history-update', (data) => this.emit('full-history-update', data));

        this.socket.on('cursor-move', (data) => this.emit('remote-cursor-move', data));

        this.socket.on('undo', (data) => this.emit('remote-undo', data));
        this.socket.on('redo', (data) => this.emit('remote-redo', data));
        this.socket.on('undo-received', (data) => {
            console.log('>>> Client received undo-received from server:', data);
            this.emit('undo-received', data);
        });

        this.socket.on('pong', () => console.log('Pong'));
    }

    joinRoom(data) {
        this.socket.emit('join-room', data);
    }

    sendDraw(data) {
        this.socket.emit('draw', data);
    }

    sendDrawLine(data) {
        this.socket.emit('draw-line', data);
    }

    clearCanvas() {
        this.socket.emit('clear-canvas');
    }

    sendCursorMove(x, y) {
        this.socket.emit('cursor-move', { x, y });
    }

    sendUndo() {
        console.log('>>> WebSocketManager.sendUndo() called');
        if (!this.socket) {
            console.error('>>> ERROR: socket is null');
            return;
        }
        console.log('>>> Emitting "undo" event to server');
        this.socket.emit('undo');
        console.log('>>> "undo" event emitted to server');
    }

    sendRedo() {
        this.socket.emit('redo');
    }

    ping() {
        this.socket.emit('ping');
    }

    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }

    emit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => callback(data));
        }
    }

    updateStatus(connected) {
        const statusDisplay = document.getElementById('statusDisplay');
        if (statusDisplay) {
            if (connected) {
                statusDisplay.textContent = 'Connected';
                statusDisplay.classList.remove('error');
            } else {
                statusDisplay.textContent = 'Disconnected';
                statusDisplay.classList.add('error');
            }
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }

    isSocketConnected() {
        return this.isConnected && this.socket && this.socket.connected;
    }
}

const wsManager = new WebSocketManager();