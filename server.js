const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const server = new WebSocket.Server({ port: PORT });

// Admin Passwort
const ADMIN_PASSWORD = 'Kaan';

// In-Memory Speicher für Sperren
const bannedNicks = new Set();
const bannedIPs = new Set();

// Datei zum permanenten Speichern der Owner-IP
const OWNER_FILE = path.join(__dirname, 'owner.json');
let permanentOwnerIP = null;

// Beim Start versuchen, die gespeicherte Owner-IP zu laden
if (fs.existsSync(OWNER_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf8'));
        permanentOwnerIP = data.ip || null;
        console.log(`🔒 Permanent Owner IP geladen: ${permanentOwnerIP}`);
    } catch (e) {
        console.error('Fehler beim Laden der Owner-Datei:', e);
    }
}

let waitingUser = null;

// Hilfsfunktion: Versucht wartende User zu matchen
function matchUsers(socket) {
    if (waitingUser && waitingUser !== socket && waitingUser.readyState === WebSocket.OPEN) {
        const partner = waitingUser;
        waitingUser = null;

        socket.partner = partner;
        partner.partner = socket;

        socket.send(JSON.stringify({ type: 'matched' }));
        partner.send(JSON.stringify({ type: 'matched' }));
    } else {
        waitingUser = socket;
        socket.send(JSON.stringify({ type: 'searching' }));
    }
}

// Hilfsfunktion: Trennt zwei Partner sauber
function disconnectPartner(socket) {
    if (socket.partner && socket.partner.readyState === WebSocket.OPEN) {
        socket.partner.send(JSON.stringify({ type: 'system', message: 'Stranger has disconnected.' }));
        const formerPartner = socket.partner;
        formerPartner.partner = null;
        socket.partner = null;
        
        matchUsers(formerPartner);
    } else {
        socket.partner = null;
    }
}

server.on('connection', (socket, req) => {
    // IP-Adresse ermitteln (Proxy-Support für Render/Cloudflare)
    const clientIP = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : req.socket.remoteAddress;
    socket.ip = clientIP;

    // PRÜFEN, OB ES DER PERMANENTE OWNER IST
    if (permanentOwnerIP && clientIP === permanentOwnerIP) {
        socket.isAdmin = true;
        bannedIPs.delete(clientIP); // Falls sie blockiert war
    }

    // IP-Ban Prüfen (Owner wird IMMER ignoriert)
    if (bannedIPs.has(clientIP) && clientIP !== permanentOwnerIP) {
        socket.send(JSON.stringify({ type: 'system', message: '❌ You are permanently banned from this server.' }));
        socket.close();
        return;
    }

    socket.partner = null;
    socket.nick = 'Stranger';
    socket.color = '#ff0015';

    socket.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. JOIN LOGIK
            if (data.type === 'join') {
                const requestedNick = data.nick ? data.nick.trim() : 'Stranger';

                if (bannedNicks.has(requestedNick.toLowerCase()) && socket.ip !== permanentOwnerIP) {
                    socket.send(JSON.stringify({ type: 'system', message: '❌ Your nickname is banned.' }));
                    socket.close();
                    return;
                }

                socket.nick = requestedNick;
                socket.color = data.color || '#ff0015';

                matchUsers(socket);
            }

            // 2. NACHRICHTEN
            else if (data.type === 'message') {
                if (socket.partner && socket.partner.readyState === WebSocket.OPEN) {
                    socket.partner.send(JSON.stringify({
                        type: 'message',
                        text: data.text,
                        nick: socket.nick,
                        color: socket.color
                    }));
                } else {
                    socket.send(JSON.stringify({ type: 'system', message: 'No one is listening. Looking for a stranger...' }));
                }
            }

            // 3. SKIP LOGIK
            else if (data.type === 'skip') {
                if (waitingUser === socket) return;

                disconnectPartner(socket);
                matchUsers(socket);
            }

            // 4. ADMIN AUTHENTIFIZIERUNG (/admin Kaan)
            else if (data.type === 'admin_auth') {
                if (data.password === ADMIN_PASSWORD) {
                    // Prüfen, ob schon ein anderer Owner existiert (Sicherheitsnetz)
                    if (permanentOwnerIP && permanentOwnerIP !== socket.ip) {
                        socket.send(JSON.stringify({ type: 'system', message: '❌ Ein Owner ist bereits registriert! Zugriff verweigert.' }));
                        return;
                    }

                    // Erste Registrierung des Owners permanent speichern
                    if (!permanentOwnerIP) {
                        permanentOwnerIP = socket.ip;
                        try {
                            fs.writeFileSync(OWNER_FILE, JSON.stringify({ ip: permanentOwnerIP }), 'utf8');
                            console.log(`👑 Neue permanente Owner-IP gespeichert: ${permanentOwnerIP}`);
                        } catch (e) {
                            console.error('Fehler beim Speichern der Owner-Datei:', e);
                        }
                    }

                    socket.isAdmin = true;
                    bannedIPs.delete(socket.ip);

                    socket.send(JSON.stringify({ type: 'admin_ok', message: '⚡ Permanent Owner-Rechte aktiviert! Deine IP ist für immer geschützt.' }));
                } else {
                    socket.send(JSON.stringify({ type: 'system', message: '❌ Falsches Admin-Passwort.' }));
                }
            }

            // 5. ADMIN BAN BEFEHL (/ban Nickname)
            else if (data.type === 'admin_ban') {
                if (!socket.isAdmin) return;

                const targetNick = data.target.toLowerCase();

                // Schutz: Verhindert, dass der Owner gebannt wird
                if (socket.partner && socket.partner.ip === permanentOwnerIP) {
                    socket.send(JSON.stringify({ type: 'system', message: '🛡️ Aktion abgebrochen: Ziel ist der geschützte Server-Owner!' }));
                    return;
                }

                bannedNicks.add(targetNick);

                if (socket.partner && socket.partner.nick.toLowerCase() === targetNick) {
                    const targetSocket = socket.partner;
                    const targetIP = targetSocket.ip;

                    if (targetIP && targetIP !== permanentOwnerIP) {
                        bannedIPs.add(targetIP);
                    }

                    targetSocket.send(JSON.stringify({ type: 'system', message: '❌ You have been banned by an admin.' }));
                    targetSocket.close();
                    socket.send(JSON.stringify({ type: 'system', message: `✅ Banned ${data.target} | IP: ${targetIP}` }));
                } else {
                    socket.send(JSON.stringify({ type: 'system', message: `✅ Nickname '${data.target}' zur Ban-Liste hinzugefügt.` }));
                }
            }

            // 6. ADMIN UNBAN BEFEHL (/unban Nickname)
            else if (data.type === 'admin_unban') {
                if (!socket.isAdmin) return;
                
                bannedNicks.delete(data.target.toLowerCase());
                socket.send(JSON.stringify({ type: 'system', message: `✅ Unbanned nickname '${data.target}'.` }));
            }

            // 7. ADMIN UNBAN IP BEFEHL (/unbanip IP)
            else if (data.type === 'admin_unban_ip') {
                if (!socket.isAdmin) return;

                bannedIPs.delete(data.ip);
                socket.send(JSON.stringify({ type: 'system', message: `✅ Unbanned IP '${data.ip}'.` }));
            }

        } catch (err) {
            console.error('Server Error:', err);
        }
    });

    socket.on('close', () => {
        if (waitingUser === socket) {
            waitingUser = null;
        }
        disconnectPartner(socket);
    });
});

console.log(`KDS Chat Server läuft auf Port ${PORT}`);
