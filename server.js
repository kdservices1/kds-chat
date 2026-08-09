// server.js - 24/7 WebSocket Server
const WebSocket = require('ws');

// Verwendet den System-Port des Hosters oder 8765 für lokales Testen
const PORT = process.env.PORT || 8765;
const server = new WebSocket.Server({ port: PORT });

let waitingUser = null;

// Regex-Filter für verbotene Begriffe (Genaue Wortübereinstimmung)
const forbiddenPattern = /\b(cp|pedof|pedoph|childporn|child\s*abuse|kidporn|kinderporno)\b/i;

function isForbidden(text) {
    return forbiddenPattern.test(text);
}

server.on('connection', (ws) => {
    ws.partner = null;

    // Nutzersuche und Matchmaking
    if (waitingUser && waitingUser !== ws) {
        ws.partner = waitingUser;
        waitingUser.partner = ws;

        ws.send(JSON.stringify({ type: 'system', message: 'Connected to a random stranger. Say hi!' }));
        waitingUser.send(JSON.stringify({ type: 'system', message: 'Connected to a random stranger. Say hi!' }));

        waitingUser = null;
    } else {
        waitingUser = ws;
        ws.send(JSON.stringify({ type: 'system', message: 'Looking for a stranger...' }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'message') {
                // Sicherheitsüberprüfung
                if (isForbidden(data.text)) {
                    ws.send(JSON.stringify({ type: 'system', message: 'Kicked: Zero-tolerance policy violation.' }));
                    
                    if (ws.partner) {
                        ws.partner.send(JSON.stringify({ type: 'system', message: 'Stranger was kicked for violating rules.' }));
                        ws.partner.partner = null;
                    }
                    
                    ws.partner = null;
                    ws.close();
                    return;
                }

                // Nachricht an Partner weiterleiten
                if (ws.partner && ws.partner.readyState === WebSocket.OPEN) {
                    ws.partner.send(JSON.stringify({ type: 'message', text: data.text }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', message: 'No one is connected to you.' }));
                }
            } else if (data.type === 'skip') {
                // Partner trennen und neu matchen
                if (ws.partner) {
                    ws.partner.send(JSON.stringify({ type: 'system', message: 'Stranger skipped the chat.' }));
                    ws.partner.partner = null;
                    ws.partner = null;
                }

                if (waitingUser && waitingUser !== ws) {
                    ws.partner = waitingUser;
                    waitingUser.partner = ws;

                    ws.send(JSON.stringify({ type: 'system', message: 'Connected to a new stranger.' }));
                    waitingUser.send(JSON.stringify({ type: 'system', message: 'Connected to a new stranger.' }));

                    waitingUser = null;
                } else {
                    waitingUser = ws;
                    ws.send(JSON.stringify({ type: 'system', message: 'Looking for a stranger...' }));
                }
            }
        } catch (err) {
            console.error('Message error:', err);
        }
    });

    ws.on('close', () => {
        if (waitingUser === ws) {
            waitingUser = null;
        }
        if (ws.partner) {
            ws.partner.send(JSON.stringify({ type: 'system', message: 'Stranger disconnected.' }));
            ws.partner.partner = null;
        }
    });
});

console.log(`Server is running on port ${PORT}`);