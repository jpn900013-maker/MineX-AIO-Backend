// MineX AIO Hub - Backend Server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mineflayer = require('mineflayer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { DatabaseManager, User, Paste, IpLog, Account, GeneratedLink } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// Root route - Backend Status Page
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MineX AIO Backend</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #0a0f0a 0%, #1a2a1a 100%);
            font-family: 'Courier New', monospace;
            color: #00ff00;
        }
        .container {
            text-align: center;
            padding: 40px;
            border: 2px solid #00ff00;
            background: rgba(0, 255, 0, 0.05);
            box-shadow: 0 0 30px rgba(0, 255, 0, 0.2);
        }
        h1 { font-size: 2.5rem; margin-bottom: 20px; text-shadow: 0 0 10px #00ff00; }
        .status { font-size: 1.2rem; margin: 10px 0; }
        .dot { display: inline-block; width: 12px; height: 12px; background: #00ff00; border-radius: 50%; margin-right: 8px; animation: pulse 1s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .endpoints { margin-top: 30px; text-align: left; font-size: 0.9rem; color: #88ff88; }
        .endpoints li { margin: 5px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚡ MineX AIO Backend</h1>
        <p class="status"><span class="dot"></span> Server is ONLINE</p>
        <p class="status">Database: ${dbManager.status.toUpperCase()}</p>
        <p class="status">Active Bots: ${activeBots.size}</p>
        <div class="endpoints">
            <p><strong>Available Endpoints:</strong></p>
            <ul>
                <li>POST /api/auth/register</li>
                <li>POST /api/auth/login</li>
                <li>POST /api/paste/create</li>
                <li>GET /api/paste/:code</li>
                <li>POST /api/iplogger/create</li>
                <li>GET /api/admin/stats</li>
            </ul>
        </div>
    </div>
</body>
</html>
    `);
});

const JWT_SECRET = process.env.JWT_SECRET || 'minex-secret-key-change-this';

// In-Memory Data Stores
const memUsers = new Map();
const memPastes = new Map();
const memIpLogs = new Map();
const activeBots = new Map();

// Initialize Database Manager
const dbManager = new DatabaseManager(memUsers, memPastes, memIpLogs);

// --- HELPER FUNCTIONS (Unified Data Access) ---

async function findUser(username) {
    if (dbManager.status === 'mongodb') {
        const user = await User.findOne({ username });
        return user ? user.toObject() : null;
    }
    return memUsers.get(username);
}

async function createUser(userData) {
    if (dbManager.status === 'mongodb') {
        const user = new User(userData);
        await user.save();
        return user.toObject();
    }
    memUsers.set(userData.username, userData);
    return userData;
}

// Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err) req.user = user;
        next();
    });
};

const requireAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};
// const authenticateToken = requireAuth; // Removed duplicate declaration

// ============= ADMIN ROUTES =============

app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;
    // Hardcoded Admin Credentials
    if (email === 'operators130@gmail.com' && password === '0po98iu76yt5@SS') {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: 'Invalid admin credentials' });
    }
});

const requireAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err || decoded.role !== 'admin') return res.sendStatus(403);
        next();
    });
};

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    let stats = {
        users: memUsers.size,
        pastes: memPastes.size,
        links: memIpLogs.size,
        bots: activeBots.size,
        dbStatus: dbManager.status
    };

    if (dbManager.status === 'mongodb') {
        try {
            stats.users = await User.countDocuments();
            stats.pastes = await Paste.countDocuments();
            stats.links = await IpLog.countDocuments();
        } catch (e) {
            console.error(e);
        }
    }
    res.json({ success: true, stats });
});

app.get('/api/admin/databases', requireAdmin, (req, res) => {
    res.json({ success: true, databases: dbManager.getDatabases() });
});

app.post('/api/admin/database/add', requireAdmin, (req, res) => {
    const { alias, connectionString } = req.body;
    if (!alias || !connectionString) return res.json({ success: false, error: 'Alias and URL required' });
    const result = dbManager.addDatabase(alias, connectionString);
    res.json(result);
});

app.post('/api/admin/database/switch', requireAdmin, async (req, res) => {
    const { alias } = req.body;
    const result = await dbManager.switchDatabase(alias);
    res.json(result);
});

app.post('/api/admin/database/disconnect', requireAdmin, async (req, res) => {
    const result = await dbManager.disconnect();
    res.json(result);
});

app.post('/api/admin/database/migrate', requireAdmin, async (req, res) => {
    const { options, targetAlias } = req.body; // { users: boolean, tools: boolean }, targetAlias: string

    if (targetAlias) {
        const switchResult = await dbManager.switchDatabase(targetAlias);
        if (!switchResult.success) return res.json(switchResult);
    }

    const result = await dbManager.migrateToMongo(options || { users: true, tools: true });
    res.json(result);
});

// Delete a database config (not the actual DB, just removes from list)
app.post('/api/admin/database/delete', requireAdmin, (req, res) => {
    const { alias } = req.body;
    if (!alias) return res.json({ success: false, error: 'Alias required' });
    const result = dbManager.deleteDatabase(alias);
    res.json(result);
});

// Migrate data from one MongoDB to another
app.post('/api/admin/database/migrate-db', requireAdmin, async (req, res) => {
    const { sourceAlias, targetAlias, options } = req.body;
    if (!sourceAlias || !targetAlias) {
        return res.json({ success: false, error: 'Source and target aliases required' });
    }
    const result = await dbManager.migrateDbToDb(sourceAlias, targetAlias, options || { users: true, tools: true });
    res.json(result);
});

// Admin User Search
app.get('/api/admin/users/search', requireAdmin, async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json({ success: true, users: [] });

    try {
        let users = [];
        if (dbManager.status === 'mongodb') {
            users = await User.find({ username: { $regex: q, $options: 'i' } })
                .select('id username credits')
                .limit(20);
        } else {
            const regex = new RegExp(q, 'i');
            for (const user of memUsers.values()) {
                if (regex.test(user.username)) {
                    users.push({ id: user.id || 'mem', username: user.username, credits: user.credits || 0 });
                    if (users.length >= 20) break;
                }
            }
        }
        res.json({ success: true, users });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// Admin Add Credits
app.post('/api/admin/users/add-credits', requireAdmin, async (req, res) => {
    const { username, amount } = req.body;
    if (!username || !amount) return res.json({ success: false, error: 'Username and amount required' });

    try {
        let newCredits = 0;
        if (dbManager.status === 'mongodb') {
            const user = await User.findOneAndUpdate(
                { username },
                { $inc: { credits: parseInt(amount) } },
                { new: true }
            );
            if (!user) return res.json({ success: false, error: 'User not found' });
            newCredits = user.credits;
        } else {
            const user = memUsers.get(username);
            if (!user) return res.json({ success: false, error: 'User not found' });
            user.credits = (user.credits || 0) + parseInt(amount);
            memUsers.set(username, user);
            newCredits = user.credits;
        }
        res.json({ success: true, credits: newCredits, message: `Added ${amount} credits to ${username}` });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to add credits' });
    }
});

// ============= AUTH ROUTES =============

app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Missing fields' });

    const existing = await findUser(username);
    if (existing) return res.status(400).json({ success: false, error: 'Username taken' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
        id: Date.now().toString(),
        username,
        password: hashedPassword,
        createdAt: Date.now()
    };
    await createUser(user);

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, username: user.username } });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await findUser(username);
    if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });

    if (await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: { id: user.id, username: user.username } });
    } else {
        res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ success: true, user: req.user });
});

app.get('/api/user/history', requireAuth, async (req, res) => {
    const userId = req.user.id;
    let userPastes = [];
    let userLinks = [];

    if (dbManager.status === 'mongodb') {
        userPastes = await Paste.find({ userId });
        userLinks = await IpLog.find({ userId });
    } else {
        for (const [code, paste] of memPastes.entries()) {
            if (paste.userId === userId) userPastes.push({ ...paste, code });
        }
        for (const [code, link] of memIpLogs.entries()) {
            if (link.userId === userId) userLinks.push({ ...link, code });
        }
    }
    res.json({ success: true, pastes: userPastes, links: userLinks });
});

// ============= CREDITS SYSTEM =============

// In-memory credits storage (per user)
// In-memory credits storage (per user)
// const userCredits = new Map(); // Deprecated: Now stored in User model
// const dailyClaims = new Map(); // Deprecated: Now stored in User model

// Get user credits
app.get('/api/user/credits', requireAuth, async (req, res) => {
    try {
        const user = await findUser(req.user.username);
        res.json({ success: true, credits: user ? (user.credits || 0) : 0 });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Add credits (after watching ad/AFK)
app.post('/api/user/credits/add', requireAuth, async (req, res) => {
    const { amount, source } = req.body;
    if (!amount || amount < 0) return res.json({ success: false, error: 'Invalid amount' });

    try {
        let credits = 0;
        if (dbManager.status === 'mongodb') {
            const user = await User.findOneAndUpdate(
                { username: req.user.username },
                { $inc: { credits: amount } },
                { new: true }
            );
            credits = user.credits;
        } else {
            const user = memUsers.get(req.user.username);
            if (user) {
                user.credits = (user.credits || 0) + amount;
                memUsers.set(req.user.username, user);
                credits = user.credits;
            }
        }
        res.json({ success: true, credits, added: amount, source });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to update credits' });
    }
});

// Daily bonus claim
app.post('/api/user/credits/daily', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const today = new Date().toDateString();

    try {
        // Preferred: Check DB logic
        if (dbManager.status === 'mongodb') {
            const user = await findUser(req.user.username);

            if (user && user.lastDailyClaim === today) {
                return res.json({ success: false, error: 'Daily bonus already claimed today' });
            }

            const DAILY_BONUS = 10;
            const updatedUser = await User.findOneAndUpdate(
                { username: req.user.username },
                {
                    $inc: { credits: DAILY_BONUS },
                    $set: { lastDailyClaim: today }
                },
                { new: true }
            );
            return res.json({ success: true, credits: updatedUser.credits, added: DAILY_BONUS });
        }

        // Fallback: In-Memory
        const user = memUsers.get(req.user.username);
        // Fallback to checking map if user obj doesn't have it
        const lastClaim = user.lastDailyClaim || dailyClaims.get(userId);

        if (lastClaim === today) {
            return res.json({ success: false, error: 'Daily bonus already claimed today' });
        }

        const DAILY_BONUS = 10;
        user.credits = (user.credits || 0) + DAILY_BONUS;
        user.lastDailyClaim = today;
        memUsers.set(req.user.username, user);

        // Keep map synced for safety until removal
        dailyClaims.set(userId, today);

        res.json({ success: true, credits: user.credits, added: DAILY_BONUS });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: 'Failed to claim bonus' });
    }
});

// Get generation history
app.get('/api/user/generation-history', requireAuth, async (req, res) => {
    // This would need a proper history collection in MongoDB
    // For now, return empty array as placeholder
    res.json({ success: true, history: [] });
});

// ============= MC BOT ROUTES =============

app.post('/api/bot/create', (req, res) => {
    const { sessionId, host, port, username, version } = req.body;

    if (activeBots.has(sessionId)) return res.json({ success: false, error: 'Bot exists' });

    try {
        const bot = mineflayer.createBot({
            host: host,
            port: port || 25565,
            username: username || 'MineXBot',
            version: version || false,
            auth: 'offline',
            viewDistance: 'tiny',
            hideErrors: false,
            checkTimeoutInterval: 120000, // 2 mins timeout
            skipValidation: true // Skip some validation checks
        });

        bot.on('spawn', () => {
            io.to(sessionId).emit('bot:spawned', { position: bot.entity.position, health: bot.health, food: bot.food });
        });

        bot.on('chat', (username, message) => io.to(sessionId).emit('bot:chat', { username, message, timestamp: Date.now() }));
        bot.on('message', (message) => io.to(sessionId).emit('bot:message', { message: message.toString(), timestamp: Date.now() }));

        bot.on('error', (err) => {
            const errorMsg = typeof err === 'string' ? err : err.message || JSON.stringify(err);
            io.to(sessionId).emit('bot:error', { error: errorMsg });
            console.error(`Bot Error [${sessionId}]:`, errorMsg);
        });

        bot.on('kicked', (reason) => {
            io.to(sessionId).emit('bot:kicked', { reason });
            activeBots.delete(sessionId);
        });

        bot.on('end', () => {
            io.to(sessionId).emit('bot:disconnected');
            activeBots.delete(sessionId);
        });

        activeBots.set(sessionId, bot);
        res.json({ success: true, message: 'Bot created' });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/bot/chat', (req, res) => {
    const { sessionId, message } = req.body;
    const bot = activeBots.get(sessionId);
    if (!bot) return res.json({ success: false, error: 'Bot not found' });
    bot.chat(message);
    res.json({ success: true });
});

app.post('/api/bot/action', (req, res) => {
    const { sessionId, action } = req.body;
    const bot = activeBots.get(sessionId);
    if (!bot) return res.json({ success: false, error: 'Bot not found' });

    try {
        switch (action) {
            case 'jump': bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500); break;
            case 'forward': bot.setControlState('forward', true); setTimeout(() => bot.setControlState('forward', false), 2000); break;
            case 'back': bot.setControlState('back', true); setTimeout(() => bot.setControlState('back', false), 2000); break;
            case 'left': bot.setControlState('left', true); setTimeout(() => bot.setControlState('left', false), 1000); break;
            case 'right': bot.setControlState('right', true); setTimeout(() => bot.setControlState('right', false), 1000); break;
            case 'sneak': bot.setControlState('sneak', !bot.controlState.sneak); break;
            case 'stop': bot.clearControlStates(); break;
        }
        res.json({ success: true, action });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/bot/disconnect', (req, res) => {
    const { sessionId } = req.body;
    const bot = activeBots.get(sessionId);
    if (bot) {
        bot.quit();
        activeBots.delete(sessionId);
        res.json({ success: true });
    } else res.json({ success: false, error: 'Bot not found' });
});

app.get('/api/bot/status/:sessionId', (req, res) => {
    const bot = activeBots.get(req.params.sessionId);
    if (bot && bot.entity) {
        res.json({ online: true, health: bot.health, food: bot.food, position: bot.entity.position, players: Object.keys(bot.players).length });
    } else res.json({ online: false });
});

// ============= IP LOGGER ROUTES =============

app.post('/api/iplogger/create', authenticateToken, async (req, res) => {
    const { imageData, code: providedCode } = req.body;
    const code = providedCode || Math.random().toString(36).substring(2, 10);
    const logData = {
        code, // for Mongo
        userId: req.user ? req.user.id : null,
        imageData,
        createdAt: Date.now(),
        visitors: []
    };

    if (dbManager.status === 'mongodb') {
        const log = new IpLog(logData);
        await log.save();
        // Optional: Implement limit logic for Mongo if desired
    } else {
        memIpLogs.set(code, logData);
        if (memIpLogs.size > 3) memIpLogs.delete(memIpLogs.keys().next().value);
    }
    res.json({ success: true, code, url: `/track/${code}` });
});

app.get('/track/:code', async (req, res) => {
    const { code } = req.params;
    let data;

    if (dbManager.status === 'mongodb') {
        data = await IpLog.findOne({ code });
    } else {
        data = memIpLogs.get(code);
    }

    if (!data) return res.status(404).send('Not found');

    // Get real IP (handle proxies)
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ip = rawIp.split(',')[0].trim(); // Take first IP if multiple

    let geoData = {};
    try {
        // Fetch location data (HTTP is fine server-side)
        const geoReq = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,zip,isp,org,as,mobile,proxy,hosting,lat,lon`);
        const geo = await geoReq.json();
        if (geo.status === 'success') {
            geoData = {
                city: geo.city,
                region: geo.regionName,
                country: geo.country,
                postal: geo.zip,
                isp: geo.isp,
                org: geo.org,
                mobile: geo.mobile,
                proxy: geo.proxy,
                hosting: geo.hosting,
                lat: geo.lat,
                lon: geo.lon
            };
        }
    } catch (e) {
        console.error('Geo lookup failed:', e);
    }

    const visitorInfo = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        ip: ip, // Store clean IP
        userAgent: req.headers['user-agent'],
        referer: req.headers['referer'] || 'Direct',
        ...geoData // Spread geo fields
    };

    // Update visitors
    data.visitors.push(visitorInfo);
    if (data.visitors.length > 20) data.visitors = data.visitors.slice(-20); // Increase limit to 20

    if (dbManager.status === 'mongodb') {
        await IpLog.updateOne({ code }, { visitors: data.visitors });
    }

    if (data.imageData.startsWith('data:image')) {
        const base64Data = data.imageData.split(',')[1];
        const imgBuffer = Buffer.from(base64Data, 'base64');
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(imgBuffer);
    } else {
        res.redirect(data.imageData);
    }
});

app.get('/api/iplogger/visitors/:code', async (req, res) => {
    const { code } = req.params;
    let data;
    if (dbManager.status === 'mongodb') {
        data = await IpLog.findOne({ code });
    } else {
        data = memIpLogs.get(code);
    }

    if (!data) return res.json({ success: false, error: 'Not found' });
    res.json({ success: true, visitors: data.visitors, createdAt: data.createdAt });
});

// ============= GENERATOR ROUTES =============

// Get Stock Count
app.get('/api/generator/:service/stock', async (req, res) => {
    const { service } = req.params;
    if (dbManager.status === 'mongodb') {
        const count = await Account.countDocuments({ service });
        res.json({ success: true, count });
    } else {
        res.json({ success: true, count: 0, error: 'Database required' });
    }
});

// Generate Account (Dispense one and remove)
// Generate Account (Dispense one and remove)
app.post('/api/generator/:service/generate', requireAuth, async (req, res) => {
    const { service } = req.params;
    // req.user populated by authenticateToken
    const username = req.user.username;

    if (dbManager.status !== 'mongodb') {
        return res.status(503).json({ success: false, error: 'Database not connected (MongoDB required for credits)' });
    }

    try {
        // 1. Find User & Check Credits
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const cost = 2;
        if ((user.credits || 0) < cost) {
            return res.json({ success: false, error: `Insufficient credits. You need ${cost} credits.` });
        }

        // 2. Check Stock & Get Account
        const account = await Account.findOneAndDelete({ service });
        if (!account) {
            return res.json({ success: false, error: 'Out of stock' });
        }

        // 3. Deduct Credits
        user.credits = (user.credits || 0) - cost;
        await user.save();

        // 4. Create Generated Link
        const linkId = Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);

        await new GeneratedLink({
            linkId,
            userId: user.id,
            service,
            data: account.data,
            createdAt: Date.now()
        }).save();

        res.json({ success: true, linkId, remainingCredits: user.credits });

    } catch (e) {
        console.error("Generation error:", e);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Get Generated Link (Idempotent View)
app.get('/api/generator/link/:linkId', requireAuth, async (req, res) => {
    const { linkId } = req.params;

    if (dbManager.status !== 'mongodb') {
        // Fallback or error
        return res.status(503).json({ success: false, error: 'Database not connected' });
    }

    try {
        const link = await GeneratedLink.findOne({ linkId });
        if (!link) return res.status(404).json({ success: false, error: 'Link not found' });

        // Return account data
        res.json({ success: true, data: link.data, service: link.service, date: link.createdAt });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
});

// Add Accounts (Admin only - for now just protected by JWT)
app.post('/api/generator/:service/add', requireAuth, async (req, res) => {
    const { service } = req.params;
    const { accounts } = req.body; // Array of strings or single string (newline separated)

    if (!accounts) return res.json({ success: false, error: 'No accounts provided' });

    let accountList = [];
    if (Array.isArray(accounts)) {
        accountList = accounts;
    } else {
        accountList = accounts.split('\n').map(a => a.trim()).filter(a => a);
    }

    if (dbManager.status === 'mongodb') {
        const docs = accountList.map(data => ({
            service,
            data,
            addedAt: Date.now()
        }));
        await Account.insertMany(docs);
        res.json({ success: true, added: docs.length });
    } else {
        res.json({ success: false, error: 'Database required' });
    }
});

// Admin View Stock (List all accounts)
app.get('/api/generator/:service/check', requireAuth, async (req, res) => {
    const { service } = req.params;
    if (dbManager.status === 'mongodb') {
        // In real app check admin permissions here
        const accounts = await Account.find({ service }).select('data addedAt');
        res.json({ success: true, accounts });
    } else {
        res.json({ success: true, accounts: [], error: 'Database required' });
    }
});

// ============= PASTEBIN ROUTES =============

app.post('/api/paste/create', authenticateToken, async (req, res) => {
    const { title, content, language, expiresIn, password } = req.body;
    if (!content) return res.json({ success: false, error: 'Content required' });
    const code = Math.random().toString(36).substring(2, 10);

    // ... expiry logic (simplified for brevity, identical to before)
    let expiresAt = null; // Add logic if needed

    const pasteData = {
        code,
        userId: req.user ? req.user.id : null,
        title: title || 'Untitled',
        content,
        language: language || 'plaintext',
        createdAt: Date.now(),
        expiresAt,
        password: password || null,
        views: 0
    };

    if (dbManager.status === 'mongodb') {
        await new Paste(pasteData).save();
    } else {
        memPastes.set(code, pasteData);
    }

    res.json({ success: true, code, url: `/paste/${code}`, hasPassword: !!password });
});

app.post('/api/paste/view/:code', async (req, res) => {
    const { code } = req.params;
    const { password } = req.body;
    let paste;

    if (dbManager.status === 'mongodb') {
        paste = await Paste.findOne({ code });
    } else {
        paste = memPastes.get(code);
    }

    if (!paste) return res.json({ success: false, error: 'Not found' });
    if (paste.password && paste.password !== password) return res.json({ success: false, error: 'Incorrect password', requiresPassword: true });

    if (dbManager.status === 'mongodb') {
        await Paste.updateOne({ code }, { $inc: { views: 1 } });
    } else {
        paste.views++;
    }

    res.json({ success: true, paste });
});

app.get('/api/paste/check/:code', async (req, res) => {
    const { code } = req.params;
    let paste;
    if (dbManager.status === 'mongodb') paste = await Paste.findOne({ code });
    else paste = memPastes.get(code);

    if (!paste) return res.json({ success: false, error: 'Not found' });
    res.json({ success: true, requiresPassword: !!paste.password, title: paste.title, language: paste.language });
});

app.get('/raw/:code', async (req, res) => {
    const { code } = req.params;
    let paste;
    if (dbManager.status === 'mongodb') paste = await Paste.findOne({ code });
    else paste = memPastes.get(code);

    if (!paste || paste.password) return res.status(404).send('Not found or locked');
    res.setHeader('Content-Type', 'text/plain');
    res.send(paste.content);
});

// Socket.io
io.on('connection', (socket) => {
    socket.on('join:session', (id) => socket.join(id));
});

// Start
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
    console.log(`MineX Server running on port ${PORT}`);

    // Auto-connect to default MongoDB if configured
    await dbManager.initializeDefault();
});
