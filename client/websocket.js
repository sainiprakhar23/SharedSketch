// updated WebSocketManager (client-side)
class WebSocketManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.callbacks = {};
        this._connectResolve = null;
        this._connectReject = null;/* server/public/websocket.js
   Client-side WebSocketManager (Socket.IO)
   - Put under your served public folder (server/public)
   - Include via <script src="/websocket.js"></script> in your pages
*/

class WebSocketManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.callbacks = {};           // local event callbacks
        this._connectResolve = null;   // internal promise handlers for connect()
        this._connectReject = null;
    }

    /**
     * Connect to the server.
     * @param {string} url defaults to current origin (works on Render: https/wss)
     * @returns {Promise<void>} resolves when socket connects
     */
    connect(url = (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')) {
        return new Promise((resolve, reject) => {
            this._connectResolve = resolve;
            this._connectReject = reject;

            try {
                // If Socket.IO client 'io' is missing, load it from server-origin
                if (typeof io === 'undefined') {
                    this.loadSocketIO(url).then(() => {
                        this.initSocket(url);
                    }).catch((err) => {
                        console.error('Failed to load socket.io client script:', err);
                        // Try to init anyway (in case io is available later)
                        try {
                            this.initSocket(url);
                        } catch (e) {
                            reject(e);
                        }
                    });
                } else {
                    this.initSocket(url);
                }

                // Safety timeout — reject if not connected in N ms
                const timeoutMs = 20000; // 20s
                setTimeout(() => {
                    if (!this.isConnected && this._connectReject) {
                        this._connectReject(new Error('Socket connection timeout'));
                        this._connectReject = null;
                        this._connectResolve = null;
                    }
                }, timeoutMs);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Loads socket.io client script from same origin
     * @param {string} origin
     * @returns {Promise<void>}
     */
    loadSocketIO(origin) {
        return new Promise((resolve, reject) => {
            try {
                const scriptUrl = `${origin.replace(/\/$/, '')}/socket.io/socket.io.js`;
                // don't inject twice
                if (document.querySelector(`script[src="${scriptUrl}"]`)) {
                    return resolve();
                }
                const script = document.createElement('script');
                script.src = scriptUrl;
                script.async = true;
                script.onload = () => setTimeout(resolve, 10);
                script.onerror = (e) => reject(new Error('Failed to load socket.io client: ' + e));
                document.head.appendChild(script);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Initialize socket instance
     * @param {string} url
     */
    initSocket(url) {
        if (typeof io === 'undefined') {
            throw new Error('socket.io client (io) is not available.');
        }

        // Disconnect existing socket if present
        if (this.socket) {
            try { this.socket.disconnect(); } catch (e) { /* noop */ }
        }

        // Create socket pointing to provided url (keeps same-origin protocol)
        this.socket = io(url, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: this.reconnectDelay,
            reconnectionDelayMax: 5000,
            autoConnect: true
        });

        this.setupListeners();
    }

    setupListeners() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            console.log('Connected to server', this.socket.id);
            this.updateStatus(true);
            this.emit('connected');

            // resolve pending connect() promise
            if (this._connectResolve) {
                this._connectResolve();
                this._connectResolve = null;
                this._connectReject = null;
            }
        });

        this.socket.on('disconnect', (reason) => {
            this.isConnected = false;
            console.log('Disconnected from server', reason);
            this.updateStatus(false);
            this.emit('disconnected');
        });

        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.updateStatus(false);
            // if initial connect still pending, reject it
            if (!this.isConnected && this._connectReject) {
                this._connectReject(error);
                this._connectReject = null;
                this._connectResolve = null;
            }
        });

        this.socket.on('reconnect_attempt', () => {
            this.reconnectAttempts++;
            console.log(`Reconnection attempt ${this.reconnectAttempts}`);
        });

        this.socket.on('reconnect_failed', () => {
            console.log('Reconnection failed');
            this.updateStatus(false);
        });

        // Application-level events (keeps same names you used)
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

    // --- Public emitters (safe-guard socket existence) ---
    joinRoom(data) {
        if (!this.socket) return;
        this.socket.emit('join-room', data);
    }

    sendDraw(data) {
        if (!this.socket) return;
        this.socket.emit('draw', data);
    }

    sendDrawLine(data) {
        if (!this.socket) return;
        this.socket.emit('draw-line', data);
    }

    clearCanvas() {
        if (!this.socket) return;
        this.socket.emit('clear-canvas');
    }

    sendCursorMove(x, y) {
        if (!this.socket) return;
        this.socket.emit('cursor-move', { x, y });
    }

    sendUndo() {
        console.log('>>> WebSocketManager.sendUndo() called');
        if (!this.socket) {
            console.error('>>> ERROR: socket is null');
            return;
        }
        this.socket.emit('undo');
        console.log('>>> "undo" event emitted to server');
    }

    sendRedo() {
        if (!this.socket) return;
        this.socket.emit('redo');
    }

    ping() {
        if (!this.socket) return;
        this.socket.emit('ping');
    }

    // --- Local pub/sub for client-side handling of server events ---
    on(event, callback) {
        if (!this.callbacks[event]) this.callbacks[event] = [];
        this.callbacks[event].push(callback);
    }

    off(event, callback) {
        if (!this.callbacks[event]) return;
        this.callbacks[event] = this.callbacks[event].filter(fn => fn !== callback);
    }

    emit(event, data) {
        if (!this.callbacks[event]) return;
        this.callbacks[event].forEach(cb => {
            try { cb(data); } catch (e) { console.error('Callback error for', event, e); }
        });
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
            try { this.socket.disconnect(); } catch (e) { console.warn('Error disconnecting socket', e); }
        }
    }

    isSocketConnected() {
        return this.isConnected && this.socket && this.socket.connected;
    }
}

// Export singleton for easy use in your app
const wsManager = new WebSocketManager();
window.wsManager = wsManager; // optional: expose globally so other scripts can access it

    }

    /**
     * Connect to the server.
     * @param {string} url defaults to current origin (works on Render: https/wss)
     * @returns {Promise<void>} resolves when socket connects
     */
    connect(url = (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')) {
        return new Promise((resolve, reject) => {
            // keep references so we can resolve/reject from listeners
            this._connectResolve = resolve;
            this._connectReject = reject;

            try {
                // If io is not present, load client script from the same origin
                if (typeof io === 'undefined') {
                    this.loadSocketIO(url).then(() => {
                        this.initSocket(url);
                        // resolution will happen on 'connect' event
                    }).catch((err) => {
                        console.error('Failed to load socket.io client script:', err);
                        // try to init anyway (in case io becomes available)
                        try {
                            this.initSocket(url);
                        } catch (e) {
                            reject(e);
                        }
                    });
                } else {
                    this.initSocket(url);
                }

                // Safety: if socket doesn't connect within N ms, reject (optional)
                const timeoutMs = 20000; // 20s
                setTimeout(() => {
                    if (!this.isConnected && this._connectReject) {
                        this._connectReject(new Error('Socket connection timeout'));
                        this._connectReject = null;
                        this._connectResolve = null;
                    }
                }, timeoutMs);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Loads the socket.io client script from the server.
     * @param {string} origin
     * @returns {Promise<void>}
     */
    loadSocketIO(origin) {
        return new Promise((resolve, reject) => {
            try {
                // prefer same origin path so protocol matches (http->ws, https->wss)
                const scriptUrl = `${origin.replace(/\/$/, '')}/socket.io/socket.io.js`;
                if (document.querySelector(`script[src="${scriptUrl}"]`)) {
                    // already injected
                    return resolve();
                }
                const script = document.createElement('script');
                script.src = scriptUrl;
                script.async = true;
                script.onload = () => {
                    // small delay to ensure io global is ready
                    setTimeout(resolve, 10);
                };
                script.onerror = (e) => reject(new Error('Failed to load socket.io client: ' + e));
                document.head.appendChild(script);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Initialize socket.io client instance
     * @param {string} url
     */
    initSocket(url) {
        // guard: if io still undefined, throw
        if (typeof io === 'undefined') {
            throw new Error('socket.io client (io) is not available.');
        }

        // disconnect previous socket if exists
        if (this.socket) {
            try { this.socket.disconnect(); } catch (e) { /* noop */ }
        }

        this.socket = io(url, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: this.reconnectDelay,
            reconnectionDelayMax: 5000,
            autoConnect: true
        });

        this.setupListeners();
    }

    setupListeners() {
        if (!this.socket) return;

        // connect
        this.socket.on('connect', () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            console.log('Connected to server', this.socket.id);
            this.updateStatus(true);
            this.emit('connected');

            // resolve the connect() promise if pending
            if (this._connectResolve) {
                this._connectResolve();
                this._connectResolve = null;
                this._connectReject = null;
            }
        });

        // disconnect
        this.socket.on('disconnect', (reason) => {
            this.isConnected = false;
            console.log('Disconnected from server', reason);
            this.updateStatus(false);
            this.emit('disconnected');
        });

        // connection errors
        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.updateStatus(false);
            // if we haven't resolved the initial connect promise, reject it
            if (!this.isConnected && this._connectReject) {
                this._connectReject(error);
                this._connectReject = null;
                this._connectResolve = null;
            }
        });

        this.socket.on('reconnect_attempt', () => {
            this.reconnectAttempts++;
            console.log(`Reconnection attempt ${this.reconnectAttempts}`);
        });

        this.socket.on('reconnect_failed', () => {
            console.log('Reconnection failed');
            this.updateStatus(false);
        });

        // room / user events
        this.socket.on('users-list', (data) => this.emit('users-list', data));
        this.socket.on('user-joined', (data) => this.emit('user-joined', data));
        this.socket.on('user-left', (data) => this.emit('user-left', data));
        this.socket.on('room-error', (data) => this.emit('room-error', data));

        // drawing events
        this.socket.on('draw', (data) => this.emit('remote-draw', data));
        this.socket.on('draw-line', (data) => this.emit('remote-draw-line', data));
        this.socket.on('clear-canvas', () => this.emit('remote-clear-canvas'));
        this.socket.on('drawing-history', (data) => this.emit('drawing-history', data));
        this.socket.on('full-history-update', (data) => this.emit('full-history-update', data));

        // cursor events
        this.socket.on('cursor-move', (data) => this.emit('remote-cursor-move', data));

        // undo / redo
        this.socket.on('undo', (data) => this.emit('remote-undo', data));
        this.socket.on('redo', (data) => this.emit('remote-redo', data));
        this.socket.on('undo-received', (data) => {
            console.log('>>> Client received undo-received from server:', data);
            this.emit('undo-received', data);
        });

        // health/pong
        this.socket.on('pong', () => console.log('Pong'));
    }

    joinRoom(data) {
        if (!this.socket) return;
        this.socket.emit('join-room', data);
    }

    sendDraw(data) {
        if (!this.socket) return;
        this.socket.emit('draw', data);
    }

    sendDrawLine(data) {
        if (!this.socket) return;
        this.socket.emit('draw-line', data);
    }

    clearCanvas() {
        if (!this.socket) return;
        this.socket.emit('clear-canvas');
    }

    sendCursorMove(x, y) {
        if (!this.socket) return;
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
        if (!this.socket) return;
        this.socket.emit('redo');
    }

    ping() {
        if (!this.socket) return;
        this.socket.emit('ping');
    }

    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }

    off(event, callback) {
        if (!this.callbacks[event]) return;
        this.callbacks[event] = this.callbacks[event].filter(fn => fn !== callback);
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
            try {
                this.socket.disconnect();
            } catch (e) {
                console.warn('Error disconnecting socket', e);
            }
        }
    }

    isSocketConnected() {
        return this.isConnected && this.socket && this.socket.connected;
    }
}

const wsManager = new WebSocketManager();
