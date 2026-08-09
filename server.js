const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const server = new WebSocket.Server({ port: PORT });

let waitingUser = null;

server.on('connection', (socket) => {
    socket.partner = null;
    socket.nick = 'Stranger';
    socket.color = '#ff0015';

    socket.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'join') {
                socket.nick = data.nick || 'Stranger';
                socket.color = data.color || '#ff0015';

                if (waitingUser && waitingUser !== socket && waitingUser.readyState === WebSocket.OPEN) {
                    socket.partner = waitingUser;
                    waitingUser.partner = socket;

                    socket.send(JSON.stringify({ type: 'system', message: 'Connected to a random stranger. Say hi!' }));
                    waitingUser.send(JSON.stringify({ type: 'system', message: 'Connected to a random stranger. Say hi!' }));

                    waitingUser = null;
                } else {
                    waitingUser = socket;
                    socket.send(JSON.stringify({ type: 'system', message: 'Looking for a stranger...' }));
                }
            }
            else if (data.type === 'message' && socket.partner && socket.partner.readyState === WebSocket.OPEN) {
                socket.partner.send(JSON.stringify({
                    type: 'message',
                    text: data.text,
                    nick: socket.nick,
                    color: socket.color
                }));
            } 
            else if (data.type === 'skip') {
                if (socket.partner && socket.partner.readyState === WebSocket.OPEN) {
                    socket.partner.send(JSON.stringify({ type: 'system', message: 'Stranger has disconnected.' }));
                    socket.partner.partner = null;
                }
                
                socket.partner = null;
                socket.send(JSON.stringify({ type: 'system', message: 'Looking for a new stranger...' }));

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
            console.error('Fehler:', err);
        }
    });

    socket.on('close', () => {
        if (socket.partner && socket.partner.readyState === WebSocket.OPEN) {
            socket.partner.send(JSON.stringify({ type: 'system', message: 'Stranger has disconnected.' }));
            socket.partner.partner = null;
        }
        if (waitingUser === socket) {
            waitingUser = null;
        }
    });
});

console.log(`KDS Chat Server läuft auf Port ${PORT}`);
