const WebSocket = require('ws');

// Verwendet den von Render zugewiesenen Port oder standardmäßig 3000
const PORT = process.env.PORT || 3000;
const server = new WebSocket.Server({ port: PORT });

let waitingUser = null;

server.on('connection', (socket) => {
    socket.partner = null;

    // Wenn bereits ein User wartet, verbinde die beiden
    if (waitingUser && waitingUser.readyState === WebSocket.OPEN) {
        socket.partner = waitingUser;
        waitingUser.partner = socket;

        socket.send(JSON.stringify({ type: 'system', message: 'Connected to a random stranger. Say hi!' }));
        waitingUser.send(JSON.stringify({ type: 'system', message: 'Connected to a random stranger. Say hi!' }));

        waitingUser = null;
    } else {
        // Keiner wartet -> auf den nächsten Warten
        waitingUser = socket;
        socket.send(JSON.stringify({ type: 'system', message: 'Looking for a stranger...' }));
    }

    socket.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Nachricht an Partner weiterleiten
            if (data.type === 'message' && socket.partner && socket.partner.readyState === WebSocket.OPEN) {
                socket.partner.send(JSON.stringify({
                    type: 'message',
                    text: data.text,
                    nick: data.nick || 'Stranger',
                    color: data.color || '#ff0015'
                }));
            } 
            // Skip-Button gedrückt
            else if (data.type === 'skip') {
                if (socket.partner && socket.partner.readyState === WebSocket.OPEN) {
                    socket.partner.send(JSON.stringify({ type: 'system', message: 'Stranger has disconnected.' }));
                    socket.partner.partner = null;
                }
                
                socket.partner = null;
                socket.send(JSON.stringify({ type: 'system', message: 'Looking for a new stranger...' }));

                // Sucht direkt nach neuem Partner
                if (waitingUser && waitingUser !== socket && waitingUser.readyState === WebSocket.OPEN) {
                    socket.partner = waitingUser;
                    waitingUser.partner = socket;
                    socket.send(JSON.stringify({ type: 'system', message: 'Connected to a random stranger. Say hi!' }));
                    waitingUser.send(JSON.stringify({ type: 'system', message: 'Connected to a random stranger. Say hi!' }));
                    waitingUser = null;
                } else {
                    waitingUser = socket;
                }
            }
        } catch (err) {
            console.error('Fehler beim Verarbeiten der Nachricht:', err);
        }
    });

    // Wenn ein User den Chat schließt oder die Seite verlässt
    socket.on('close', () => {
        if (socket.partner && socket.partner.readyState === WebSocket.OPEN) {
            socket.partner.send(JSON.stringify({ type: 'system', message: 'Stranger has disconnected.' }));
            socket.partner.partner = null;
        }
        if (waitingUser === socket) {
            waitingUser = null;
        }
    });

    socket.on('error', (err) => {
        console.error('WebSocket Fehler:', err);
    });
});

console.log(`KDS Chat Server läuft auf Port ${PORT}`);
