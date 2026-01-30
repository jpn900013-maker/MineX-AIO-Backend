const mongoose = require('mongoose');

// Schemas
const UserSchema = new mongoose.Schema({
    id: String,
    username: { type: String, unique: true },
    password: String,
    credits: { type: Number, default: 0 },
    lastDailyClaim: String,
    unlockedModes: { type: [String], default: [] }, // ['attack', 'mining', 'butcher']
    createdAt: Number
});

const PasteSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    userId: String,
    title: String,
    content: String,
    language: String,
    createdAt: Number,
    expiresAt: Number,
    password: String,
    views: Number
});

const IpLogSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    userId: String,
    imageData: String,
    createdAt: Number,
    visitors: Array
});

const AccountSchema = new mongoose.Schema({
    service: String,
    data: String,
    addedAt: Number
});

const ToolAccessCodeSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    createdAt: Number,
    expiresAt: Number,
    isUsed: Boolean,
    usedBy: String,
    usedAt: Number
});

const GeneratedLinkSchema = new mongoose.Schema({
    linkId: { type: String, unique: true },
    userId: String,
    service: String,
    data: String,
    createdAt: Number
});

const BotSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    username: { type: String, required: true },
    host: { type: String, required: true },
    port: { type: Number, default: 25565 },
    version: { type: String, default: false },
    sessionId: { type: String, required: true, unique: true },
    status: { type: String, default: 'offline' }, // 'online', 'offline', 'stopping'
    config: {
        autoReconnect: { type: Boolean, default: false },
        autoChat: { type: Boolean, default: false },
        randomMovement: { type: Boolean, default: false }
    },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
});

// Models
const User = mongoose.model('User', UserSchema);
const Paste = mongoose.model('Paste', PasteSchema);
const IpLog = mongoose.model('IpLog', IpLogSchema);
const Account = mongoose.model('Account', AccountSchema);
const ToolAccessCode = mongoose.model('ToolAccessCode', ToolAccessCodeSchema);
const GeneratedLink = mongoose.model('GeneratedLink', GeneratedLinkSchema);
const Bot = mongoose.model('Bot', BotSchema);

class DatabaseManager {
    constructor() {
        this.status = 'disconnected'; // 'disconnected' or 'mongodb'
        this.activeAlias = null;
        this.databases = new Map(); // alias -> connectionString
    }

    addDatabase(alias, connectionString) {
        this.databases.set(alias, connectionString);
        return { success: true, databases: Array.from(this.databases.entries()) };
    }

    async initializeDefault() {
        // Auto-connect to default MongoDB if MONGODB_URI is set, or use fallback
        const defaultUri = process.env.MONGODB_URI || 'mongodb+srv://jpn900013_db_user:ZoscA8dimL4AO1SV@cluster0.jmx8i6c.mongodb.net/?appName=Cluster0';

        console.log('Connecting to MongoDB...');
        this.addDatabase('default', defaultUri);
        const result = await this.switchDatabase('default');
        if (result.success) {
            console.log('✅ Connected to MongoDB');
        } else {
            console.error('❌ Failed to connect to MongoDB:', result.error);
            console.error('CRITICAL: MongoDB connection required. Server format: MongoDB-only.');
        }
        return result;
    }

    getDatabases() {
        return Array.from(this.databases.entries()).map(([alias, url]) => ({ alias, url, active: this.activeAlias === alias }));
    }

    async switchDatabase(alias) {
        const url = this.databases.get(alias);
        if (!url) return { success: false, error: 'Database alias not found' };

        try {
            // Disconnect valid existing connection
            if (mongoose.connection.readyState !== 0) {
                await mongoose.disconnect();
            }

            await mongoose.connect(url);
            this.status = 'mongodb';
            this.activeAlias = alias;
            console.log(`Switched to MongoDB: ${alias}`);
            return { success: true };
        } catch (error) {
            console.error('MongoDB Connection Error:', error);
            return { success: false, error: error.message };
        }
    }

    async connect(connectionString) {
        // Legacy single-connect support (defaults to alias 'default')
        return this.addDatabase('default', connectionString) && this.switchDatabase('default');
    }

    async disconnect() {
        if (this.status === 'mongodb') {
            await mongoose.disconnect();
            this.status = 'disconnected';
            this.activeAlias = null;
            return { success: true };
        }
        return { success: true };
    }

    // Migration: Memory -> MongoDB (Selective)
    async migrateToMongo(options = { users: true, tools: true }) {
        if (this.status !== 'mongodb') return { success: false, error: 'Not connected to MongoDB' };

        try {
            const results = { users: 0, pastes: 0, logs: 0 };

            // 1. Migrate Users
            if (options.users) {
                const userOps = [];
                for (const user of this.memUsers.values()) {
                    userOps.push({ updateOne: { filter: { username: user.username }, update: user, upsert: true } });
                }
                if (userOps.length > 0) {
                    await User.bulkWrite(userOps);
                    results.users = userOps.length;
                }
            }

            // 2. Migrate Tools Data
            if (options.tools) {
                // Pastes
                const pasteOps = [];
                for (const [code, paste] of this.memPastes.entries()) {
                    pasteOps.push({ updateOne: { filter: { code }, update: { ...paste, code }, upsert: true } });
                }
                if (pasteOps.length > 0) {
                    await Paste.bulkWrite(pasteOps);
                    results.pastes = pasteOps.length;
                }

                // IP Logs
                const logOps = [];
                for (const [code, log] of this.memIpLogs.entries()) {
                    logOps.push({ updateOne: { filter: { code }, update: { ...log, code }, upsert: true } });
                }
                if (logOps.length > 0) {
                    await IpLog.bulkWrite(logOps);
                    results.logs = logOps.length;
                }
            }

            return { success: true, count: results };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    deleteDatabase(alias) {
        if (this.activeAlias === alias) {
            return { success: false, error: 'Cannot delete active database' };
        }
        if (!this.databases.has(alias)) {
            return { success: false, error: 'Database alias not found' };
        }
        this.databases.delete(alias);
        return { success: true };
    }

    async migrateDbToDb(sourceAlias, targetAlias, options) {
        const sourceUrl = this.databases.get(sourceAlias);
        const targetUrl = this.databases.get(targetAlias);

        if (!sourceUrl || !targetUrl) return { success: false, error: 'Invalid source or target database' };

        try {
            // Connect to source
            const sourceConn = await mongoose.createConnection(sourceUrl).asPromise();
            const SourceUser = sourceConn.model('User', User.schema);
            const SourcePaste = sourceConn.model('Paste', Paste.schema);
            const SourceIpLog = sourceConn.model('IpLog', IpLog.schema);

            // Connect to target
            const targetConn = await mongoose.createConnection(targetUrl).asPromise();
            const TargetUser = targetConn.model('User', User.schema);
            const TargetPaste = targetConn.model('Paste', Paste.schema);
            const TargetIpLog = targetConn.model('IpLog', IpLog.schema);

            const results = { users: 0, pastes: 0, logs: 0 };

            // 1. Migrate Users
            if (options.users) {
                const users = await SourceUser.find({});
                if (users.length > 0) {
                    const ops = users.map(u => ({
                        updateOne: { filter: { username: u.username }, update: u.toObject(), upsert: true }
                    }));
                    await TargetUser.bulkWrite(ops);
                    results.users = users.length;
                }
            }

            // 2. Migrate Tools
            if (options.tools) {
                // Pastes
                const pastes = await SourcePaste.find({});
                if (pastes.length > 0) {
                    const ops = pastes.map(p => ({
                        updateOne: { filter: { code: p.code }, update: p.toObject(), upsert: true }
                    }));
                    await TargetPaste.bulkWrite(ops);
                    results.pastes = pastes.length;
                }

                // IP Logs
                const logs = await SourceIpLog.find({});
                if (logs.length > 0) {
                    const ops = logs.map(l => ({
                        updateOne: { filter: { code: l.code }, update: l.toObject(), upsert: true }
                    }));
                    await TargetIpLog.bulkWrite(ops);
                    results.logs = logs.length;
                }
            }

            await sourceConn.close();
            await targetConn.close();

            return { success: true, count: results };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}
// Proxy methods to get/set data based on active mode
// (This part is tricky without rewriting the whole index.js, 
//  so for now the Admin Panel will just migrate data, 
//  and we might need to update index.js to use this Manager for all ops)
// End of Class


module.exports = { DatabaseManager, User, Paste, IpLog, Account, ToolAccessCode, GeneratedLink, Bot };
