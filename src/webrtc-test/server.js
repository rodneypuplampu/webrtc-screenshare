const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const http = require('http');

// --- Configuration ---
const HTTP_PORT = 8080; // Port for serving client files (optional)
const WSS_PORT = 8081; // Port for WebSocket connections
const METRICS_DIR = '/network-data'; // WARNING: Absolute path! Requires permissions. Consider './network-data' instead.
// const METRICS_DIR = path.join(__dirname, 'network-data'); // Safer alternative: relative path

// --- Ensure Metrics Directory Exists ---
// If using a relative path, create it if it doesn't exist.
// If using an absolute path like /network-data, this script likely CAN'T create it.
// You MUST create /network-data manually and ensure the node process user has write permissions.
if (!path.isAbsolute(METRICS_DIR)) {
    if (!fs.existsSync(METRICS_DIR)) {
        console.log(`Creating metrics directory: ${METRICS_DIR}`);
        fs.mkdirSync(METRICS_DIR, { recursive: true });
    }
} else {
    console.warn(`\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
    console.warn(`WARNING: Using absolute path for metrics: ${METRICS_DIR}`);
    console.warn(`Ensure this directory exists and the user running this script`);
    console.warn(`has write permissions. e.g.,`);
    console.warn(`  sudo mkdir ${METRICS_DIR}`);
    console.warn(`  sudo chown $(whoami) ${METRICS_DIR}`);
    console.warn(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
    // Optional check - will likely fail if permissions are wrong
    try {
        fs.accessSync(METRICS_DIR, fs.constants.W_OK);
        console.log(`Write access to ${METRICS_DIR} confirmed.`);
    } catch (err) {
        console.error(`ERROR: No write access to ${METRICS_DIR}. Metrics saving will fail.`, err);
        // process.exit(1); // Optionally exit if directory is not writable
    }
}


// --- Simple HTTP Server for Client Files (Optional) ---
// Serves files from the ../client directory
const server = http.createServer((req, res) => {
    const clientDir = path.join(__dirname, '..', 'client');
    let filePath = path.join(clientDir, req.url === '/' ? 'index.html' : req.url);
    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css', // Add other types as needed
    };
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('404 Not Found');
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});
server.listen(HTTP_PORT, () => {
    console.log(`HTTP server listening on port ${HTTP_PORT} (serving files from ../client)`);
});


// --- WebSocket Server (Signaling & Data Collection) ---
const wss = new WebSocket.Server({ port: WSS_PORT });
const clients = new Map(); // Store clients for basic signaling

console.log(`WebSocket server listening on port ${WSS_PORT}`);

wss.on('connection', (ws) => {
    const clientId = Date.now().toString(); // Simple unique ID
    clients.set(clientId, ws);
    console.log(`Client connected: ${clientId}`);

    // Send client ID back to the client
    ws.send(JSON.stringify({ type: 'your-id', payload: clientId }));

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
            // console.log(`Received message from ${clientId}:`, data.type); // Log message type
        } catch (e) {
            console.error(`Failed to parse message or invalid message format from ${clientId}:`, message);
            return;
        }

        switch (data.type) {
            // --- Basic Signaling ---
            // This is very rudimentary, just broadcasting. A real app needs rooms/pairing.
            case 'offer':
            case 'answer':
            case 'candidate':
                console.log(`Relaying ${data.type} from ${clientId} to others`);
                broadcast(data, clientId); // Send to all *other* clients
                break;

            // --- Metrics Collection ---
            case 'metrics':
                console.log(`Received metrics from ${clientId}`);
                saveMetrics(clientId, data.payload);
                break;

            default:
                console.log(`Unknown message type from ${clientId}: ${data.type}`);
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        clients.delete(clientId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
        clients.delete(clientId); // Remove on error as well
    });
});

// Broadcast to all clients except the sender
function broadcast(data, senderId) {
    const message = JSON.stringify(data);
    clients.forEach((client, id) => {
        if (id !== senderId && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Function to save metrics
function saveMetrics(clientId, metrics) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `metrics_${clientId}_${timestamp}.json`;
    const filepath = path.join(METRICS_DIR, filename);

    try {
        fs.writeFile(filepath, JSON.stringify(metrics, null, 2), (err) => {
            if (err) {
                console.error(`Error writing metrics file for ${clientId}:`, err);
            } else {
                // console.log(`Metrics saved to ${filepath}`); // Can be verbose
            }
        });
    } catch (err) {
        console.error(`Synchronous error during metrics save setup for ${clientId}:`, err);
    }
}

console.log('Server setup complete.');