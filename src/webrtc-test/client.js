const WS_URL = `ws://localhost:8081`; // Make sure this matches your server host/port
const METRICS_INTERVAL_MS = 5000; // Collect stats every 5 seconds

const statusElem = document.getElementById('status');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const metricsDisplay = document.getElementById('metricsDisplay');

let ws = null;
let peerConnection = null;
let metricsIntervalId = null;
let localClientId = null;
let dataChannel = null; // Example Data Channel

function updateStatus(message) {
    console.log("Status:", message);
    statusElem.textContent = message;
}

function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        updateStatus("WebSocket already connecting or open.");
        return;
    }

    updateStatus("Connecting to WebSocket server...");
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        updateStatus("WebSocket connected. Ready to start.");
        startButton.disabled = false;
    };

    ws.onmessage = (event) => {
        let message;
        try {
            message = JSON.parse(event.data);
            // console.log('Message from server: ', message);
        } catch (e) {
            console.error('Failed to parse server message:', event.data);
            return;
        }

        switch (message.type) {
            case 'your-id':
                localClientId = message.payload;
                updateStatus(`WebSocket connected (ID: ${localClientId}). Ready.`);
                break;
            // Basic Signaling handlers (for a potential peer-to-peer connection if needed)
            // In this example, we primarily focus on collecting stats, maybe via loopback or dummy connection
            case 'offer':
                console.log('Received offer');
                // Handle offer if setting up P2P
                // await handleOffer(message.payload);
                break;
            case 'answer':
                console.log('Received answer');
                // Handle answer if setting up P2P
                // await handleAnswer(message.payload);
                break;
            case 'candidate':
                console.log('Received ICE candidate');
                // Handle candidate if setting up P2P
                // await handleCandidate(message.payload);
                break;
            default:
                console.log('Unknown message type from server:', message.type);
        }
    };

    ws.onerror = (error) => {
        updateStatus(`WebSocket error: ${error.message || 'Unknown error'}`);
        console.error('WebSocket error:', error);
        startButton.disabled = true;
        stopButton.disabled = true;
    };

    ws.onclose = () => {
        updateStatus("WebSocket closed.");
        console.log("WebSocket connection closed.");
        stopCollecting(); // Ensure cleanup if connection drops
        startButton.disabled = true;
        stopButton.disabled = true;
        ws = null;
        // Optionally try to reconnect
    };
}

function setupPeerConnection() {
    updateStatus("Setting up Peer Connection...");
    const configuration = {
        iceServers: [ // Add public STUN servers
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
            // Add TURN servers here if needed for NAT traversal
        ]
    };
    peerConnection = new RTCPeerConnection(configuration);

    // --- Event Handlers ---
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            console.log('Sending ICE candidate');
            // Send candidate to the server (for signaling to a potential peer)
            // ws.send(JSON.stringify({ type: 'candidate', payload: event.candidate }));
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        updateStatus(`ICE Connection State: ${peerConnection.iceConnectionState}`);
        console.log(`ICE Connection State: ${peerConnection.iceConnectionState}`);
         // You could potentially start/stop metric collection based on 'connected' or 'completed' state
    };

    peerConnection.onconnectionstatechange = () => {
         updateStatus(`Connection State: ${peerConnection.connectionState}`);
         console.log(`Connection State: ${peerConnection.connectionState}`);
         if(peerConnection.connectionState === 'connected') {
            // Start collecting stats once connected
            startMetricsInterval();
         } else if (['disconnected', 'failed', 'closed'].includes(peerConnection.connectionState)) {
             stopMetricsInterval();
         }
    };

    // --- Create a Data Channel (optional but helps generate stats) ---
    // This acts as something to establish a connection over
    dataChannel = peerConnection.createDataChannel("metricsChannel");
    dataChannel.onopen = () => {
         console.log("Data channel open");
         updateStatus("Data channel open. Collecting metrics.");
    };
    dataChannel.onclose = () => console.log("Data channel closed");
    dataChannel.onerror = (error) => console.error("Data channel error:", error);
    dataChannel.onmessage = (event) => console.log("Data channel message:", event.data); // We don't expect messages here

    // Example: Initiate connection (e.g., create offer for loopback or send to peer)
    // For simplicity, we'll create an offer. In a real P2P, you'd send this via WebSocket.
    // Here, we just set it locally to potentially trigger state changes and stats generation.
    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            console.log("Local description (offer) set.");
             // In a real P2P, you would now send peerConnection.localDescription via WebSocket
             // ws.send(JSON.stringify({ type: 'offer', payload: peerConnection.localDescription }));

             // --- Loopback Example ---
             // To generate stats without a *real* peer, you can try setting the remote
             // description with the same offer. This isn't a standard P2P flow but
             // can sometimes establish a local connection state for stats.
             // WARNING: This loopback might not generate all stat types or realistic values.
              // return peerConnection.setRemoteDescription(peerConnection.localDescription);
        })
        // .then(() => console.log("Remote description (loopback offer) set.")) // Only if doing loopback
        .catch(error => console.error("Error creating offer or setting description:", error));


    updateStatus("Peer Connection setup initiated. Waiting for connection state changes...");
}

async function collectAndSendMetrics() {
    if (!peerConnection || !ws || ws.readyState !== WebSocket.OPEN) {
        console.log("Cannot collect metrics: PC or WS not ready.");
        return;
    }

    try {
        const statsReport = await peerConnection.getStats();
        const metrics = {};
        let hasRelevantStats = false;

        statsReport.forEach(report => {
            // You can filter specific report types:
            // 'candidate-pair', 'local-candidate', 'remote-candidate',
            // 'transport', 'inbound-rtp', 'outbound-rtp', 'remote-inbound-rtp', etc.
             if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                metrics[`candidate-pair_${report.id}`] = report;
                hasRelevantStats = true;
            } else if (report.type === 'transport') {
                 metrics[`transport_${report.id}`] = report;
                 hasRelevantStats = true;
             } else if (report.type.includes('rtp')) { // inbound/outbound RTP streams
                 metrics[`${report.type}_${report.id}`] = report;
                 hasRelevantStats = true;
             }
            // Add more types as needed
            // metrics[report.id] = report; // Or collect everything (can be large)
        });

        if (hasRelevantStats) {
            // console.log('Sending metrics:', metrics);
            metricsDisplay.textContent = JSON.stringify(metrics, null, 2);
            ws.send(JSON.stringify({ type: 'metrics', payload: metrics }));
        } else {
             metricsDisplay.textContent = `Waiting for relevant stats (e.g., connected candidate pair)... \nLast Check: ${new Date().toLocaleTimeString()}`;
            // console.log("No relevant stats found in this batch.");
        }
    } catch (error) {
        console.error('Error getting stats:', error);
        metricsDisplay.textContent = `Error getting stats: ${error.message}`;
        stopCollecting(); // Stop if there's an error getting stats
    }
}

function startMetricsInterval() {
    if (metricsIntervalId) clearInterval(metricsIntervalId); // Clear existing interval if any
    metricsIntervalId = setInterval(collectAndSendMetrics, METRICS_INTERVAL_MS);
    console.log(`Started metrics collection interval (${METRICS_INTERVAL_MS}ms).`);
    // Run once immediately
    collectAndSendMetrics();
}

function stopMetricsInterval() {
     if (metricsIntervalId) {
        clearInterval(metricsIntervalId);
        metricsIntervalId = null;
        console.log("Stopped metrics collection interval.");
    }
}

function startCollecting() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        updateStatus("WebSocket not connected. Cannot start.");
        return;
    }
    if (peerConnection) {
        updateStatus("Already collecting or connection exists. Stop first if needed.");
        return;
    }

    startButton.disabled = true;
    stopButton.disabled = false;
    setupPeerConnection();
    // Metrics interval will be started by the 'connected' state change handler,
    // but we can trigger an initial check too.
     // startMetricsInterval(); // Might start this here OR wait for connection state 'connected'
    updateStatus("Attempting to establish connection and start metrics collection...");
}

function stopCollecting() {
    stopMetricsInterval();

    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
        console.log("Peer connection closed.");
    }

    updateStatus("Collection stopped.");
    metricsDisplay.textContent = "Collection stopped.";
    startButton.disabled = !(ws && ws.readyState === WebSocket.OPEN); // Enable start if WS is still open
    stopButton.disabled = true;
}

// --- Event Listeners ---
startButton.addEventListener('click', startCollecting);
stopButton.addEventListener('click', stopCollecting);

// --- Initial connection ---
connectWebSocket();