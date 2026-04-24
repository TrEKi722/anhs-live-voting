// ==========================================
// ANHS Live Voting - Common Script
// ==========================================

// ==========================================
// 1. Variables
// ==========================================
const auth = firebase.auth();
const db = firebase.firestore();
const fns = window._fns || firebase.app().functions('us-central1');

const CONFIG_DOCS = {
    poll_config: 'config/poll',
    hats_config: 'config/hats',
    name_game_config: 'config/name_game',
    yearbook_config: 'config/yearbook',
    wally_config: 'config/wally'
};

const COUNTER_DOCS = {
    poll: 'counters/poll',
    hats: 'counters/hats',
    yearbook: 'counters/yearbook'
};

const LEADERBOARD_DOCS = {
    hats: 'leaderboards/hats',
    name_game: 'leaderboards/name_game',
    yearbook: 'leaderboards/yearbook',
    wally: 'leaderboards/wally'
};

const DOC_ID_BUILDERS = {
    votes: ({ user_id }) => user_id,
    hats_presses: ({ user_id }) => user_id,
    name_game_scores: ({ user_id }) => user_id,
    yearbook_scores: ({ user_id }) => user_id,
    user_profiles: ({ user_id }) => user_id,
    yearbook_votes: ({ user_id, round_id }) => `${user_id}_${round_id}`,
    wally_scores: ({ user_id, round_id }) => `${user_id}_${round_id}`
};

let authBootstrapPromise = null;

function normalizeFirestoreValue(value) {
    if (value?.toDate) return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
    if (value && typeof value === 'object') {
        const out = {};
        Object.entries(value).forEach(([k, v]) => {
            out[k] = normalizeFirestoreValue(v);
        });
        return out;
    }
    return value;
}

function normalizeDoc(id, data) {
    return { id, ...normalizeFirestoreValue(data || {}) };
}

function normalizeAuthUser(user, metadata) {
    if (!user) return null;
    const userMetadata = {
        username: metadata?.username || null
    };
    return {
        id: user.uid,
        uid: user.uid,
        email: user.email || null,
        isAnonymous: !!user.isAnonymous,
        user_metadata: userMetadata
    };
}

async function getUserProfile(uid) {
    if (!uid) return null;
    const snap = await db.collection('user_profiles').doc(uid).get();
    return snap.exists ? normalizeDoc(snap.id, snap.data()) : null;
}

async function buildSession(user) {
    if (!user) return null;
    const profile = await getUserProfile(user.uid);
    const tokenResult = await user.getIdTokenResult().catch(() => null);
    return {
        user: normalizeAuthUser(user, profile),
        access_token: tokenResult?.token || null
    };
}

async function ensureAuthBootstrap() {
    if (!authBootstrapPromise) {
        authBootstrapPromise = auth.getRedirectResult().catch((error) => {
            console.error('Auth redirect error:', error);
            return null;
        });
    }
    await authBootstrapPromise;
}

function firebaseProviderFor(name) {
    if (name === 'google') return new firebase.auth.GoogleAuthProvider();
    if (name === 'azure') return new firebase.auth.OAuthProvider('microsoft.com');
    throw new Error(`Unsupported OAuth provider: ${name}`);
}

function getDocIdFromFilters(table, filters, row) {
    if (row) return DOC_ID_BUILDERS[table]?.(row) || null;

    const filterMap = new Map(filters.map((f) => [f.field, f.value]));
    if (table === 'votes' || table === 'hats_presses' || table === 'name_game_scores' || table === 'yearbook_scores' || table === 'user_profiles') {
        return filterMap.get('user_id') || null;
    }
    if (table === 'yearbook_votes' || table === 'wally_scores') {
        const userId = filterMap.get('user_id');
        const roundId = filterMap.get('round_id');
        return userId != null && roundId != null ? `${userId}_${roundId}` : null;
    }
    return null;
}

function applyFieldSelection(row, fields) {
    if (!row || !fields || fields === '*') return row;
    const selected = {};
    fields.split(',').map((f) => f.trim()).filter(Boolean).forEach((field) => {
        if (field in row) selected[field] = row[field];
    });
    return selected;
}

function docsFromCounter(counter, valueKeyPrefix) {
    const total = counter?.total || 0;
    const docs = [];
    for (let i = 0; i < 4; i++) {
        const count = counter?.[`${valueKeyPrefix}${i}`] || 0;
        for (let j = 0; j < count; j++) docs.push({ option_index: i });
    }
    return { docs, total };
}

class FirebaseQueryBuilder {
    constructor(table) {
        this.table = table;
        this.filters = [];
        this.sort = null;
        this.rowLimit = null;
        this.expectSingle = false;
        this.allowMissing = false;
        this.selectedFields = '*';
        this.countOptions = null;
        this.mode = 'select';
        this.payload = null;
        this.returningFields = null;
    }

    select(fields, options) {
        this.selectedFields = fields || '*';
        this.countOptions = options || null;
        if (this.mode !== 'select') this.returningFields = fields || '*';
        return this;
    }

    eq(field, value) {
        this.filters.push({ op: '==', field, value });
        return this;
    }

    neq(field, value) {
        this.filters.push({ op: '!=', field, value });
        return this;
    }

    lte(field, value) {
        this.filters.push({ op: '<=', field, value });
        return this;
    }

    order(field, { ascending } = {}) {
        this.sort = { field, ascending: ascending !== false };
        return this;
    }

    limit(value) {
        this.rowLimit = value;
        return this;
    }

    single() {
        this.expectSingle = true;
        this.allowMissing = false;
        return this;
    }

    maybeSingle() {
        this.expectSingle = true;
        this.allowMissing = true;
        return this;
    }

    update(payload) {
        this.mode = 'update';
        this.payload = payload;
        return this;
    }

    insert(payload) {
        this.mode = 'insert';
        this.payload = payload;
        return this;
    }

    upsert(payload) {
        this.mode = 'upsert';
        this.payload = payload;
        return this;
    }

    delete() {
        this.mode = 'delete';
        return this;
    }

    then(resolve, reject) {
        return this.execute().then(resolve, reject);
    }

    async execute() {
        try {
            if (CONFIG_DOCS[this.table]) return await this.executeConfigDoc();
            return await this.executeCollection();
        } catch (error) {
            return { data: null, error };
        }
    }

    async executeConfigDoc() {
        const ref = db.doc(CONFIG_DOCS[this.table]);
        if (this.mode === 'select') {
            const snap = await ref.get();
            const row = snap.exists ? normalizeDoc('main', snap.data()) : null;
            return { data: this.expectSingle ? row : row ? [row] : [], error: null };
        }

        if (this.mode === 'update' || this.mode === 'upsert' || this.mode === 'insert') {
            await ref.set(this.payload || {}, { merge: true });
            const snap = await ref.get();
            const row = snap.exists ? applyFieldSelection(normalizeDoc('main', snap.data()), this.returningFields) : null;
            return { data: row ? (this.expectSingle ? row : [row]) : null, error: null };
        }

        throw new Error(`Unsupported operation for ${this.table}: ${this.mode}`);
    }

    async executeCollection() {
        if (this.mode === 'insert' || this.mode === 'upsert') {
            const row = Array.isArray(this.payload) ? this.payload[0] : this.payload;
            const docId = getDocIdFromFilters(this.table, this.filters, row);
            if (!docId) throw new Error(`Unable to derive document id for ${this.table}`);
            const ref = db.collection(this.table).doc(docId);
            const data = normalizeFirestoreValue(row);
            const opts = this.mode === 'upsert' ? { merge: true } : undefined;
            await ref.set(data, opts);
            const snap = await ref.get();
            const out = applyFieldSelection(normalizeDoc(snap.id, snap.data()), this.returningFields);
            return { data: this.expectSingle ? out : [out], error: null };
        }

        if (this.mode === 'update') {
            const docId = getDocIdFromFilters(this.table, this.filters, this.payload);
            const ref = docId ? db.collection(this.table).doc(docId) : null;
            if (!ref) throw new Error(`Update needs a resolvable document id for ${this.table}`);
            await ref.set(this.payload || {}, { merge: true });
            const snap = await ref.get();
            const out = applyFieldSelection(normalizeDoc(snap.id, snap.data()), this.returningFields);
            return { data: this.expectSingle ? out : [out], error: null };
        }

        if (this.mode === 'delete') {
            const docId = getDocIdFromFilters(this.table, this.filters);
            if (docId) {
                await db.collection(this.table).doc(docId).delete();
                return { data: null, error: null };
            }

            let query = db.collection(this.table);
            this.filters.forEach((filter) => {
                if (filter.op === '==') query = query.where(filter.field, '==', filter.value);
                if (filter.op === '<=') query = query.where(filter.field, '<=', filter.value);
                if (filter.op === '!=') query = query.where(filter.field, '!=', filter.value);
            });
            const snap = await query.get();
            const batch = db.batch();
            snap.forEach((docSnap) => batch.delete(docSnap.ref));
            await batch.commit();
            return { data: null, error: null };
        }

        if (this.table === 'votes' && this.filters.length === 0 && !this.expectSingle) {
            const counterSnap = await db.doc(COUNTER_DOCS.poll).get();
            const { docs } = docsFromCounter(counterSnap.data(), 'o');
            return { data: docs, error: null };
        }

        const directDocId = getDocIdFromFilters(this.table, this.filters);
        if (directDocId) {
            const snap = await db.collection(this.table).doc(directDocId).get();
            const row = snap.exists ? normalizeDoc(snap.id, snap.data()) : null;
            if (!row && !this.allowMissing) return { data: null, error: new Error('Document not found') };
            return {
                data: this.expectSingle ? row : row ? [applyFieldSelection(row, this.selectedFields)] : [],
                error: null
            };
        }

        let query = db.collection(this.table);
        this.filters.forEach((filter) => {
            query = query.where(filter.field, filter.op, filter.value);
        });
        if (this.sort) query = query.orderBy(this.sort.field, this.sort.ascending ? 'asc' : 'desc');
        if (this.rowLimit) query = query.limit(this.rowLimit);

        const snap = await query.get();
        const rows = snap.docs.map((docSnap) => applyFieldSelection(normalizeDoc(docSnap.id, docSnap.data()), this.selectedFields));

        if (this.countOptions?.head) {
            return { data: null, count: snap.size, error: null };
        }

        if (this.expectSingle) {
            const row = rows[0] || null;
            if (!row && !this.allowMissing) return { data: null, error: new Error('Document not found') };
            return { data: row, error: null };
        }

        return { data: rows, error: null };
    }
}

const supabaseC = {
    auth: {
        async getSession() {
            await ensureAuthBootstrap();
            const session = await buildSession(auth.currentUser);
            return { data: { session }, error: null };
        },
        async signInAnonymously() {
            const cred = await auth.signInAnonymously();
            const session = await buildSession(cred.user);
            return { data: { user: session?.user || null, session }, error: null };
        },
        async signInWithOAuth({ provider }) {
            const redirectParam = new URLSearchParams(window.location.search).get('redirect');
            if (redirectParam) sessionStorage.setItem('postAuthRedirect', redirectParam);
            await auth.signInWithRedirect(firebaseProviderFor(provider));
            return { error: null };
        },
        async signInWithPassword({ email, password, options }) {
            const call = fns.httpsCallable('adminEmailPasswordSignIn');
            const result = await call({ email, password, recaptchaToken: options?.captchaToken || null });
            const cred = await auth.signInWithCustomToken(result.data.customToken);
            const session = await buildSession(cred.user);
            return { data: { user: session?.user || null, session }, error: null };
        },
        async signOut() {
            await auth.signOut();
            return { error: null };
        }
    },
    from(table) {
        return new FirebaseQueryBuilder(table);
    }
};

function subscribeToDoc(path, callback) {
    return db.doc(path).onSnapshot((snap) => {
        callback({ new: snap.exists ? normalizeDoc(snap.id, snap.data()) : null });
    });
}

function subscribeToCollection(table, callback, queryBuilder) {
    let query = db.collection(table);
    if (queryBuilder) query = queryBuilder(query);
    return query.onSnapshot((snap) => {
        snap.docChanges().forEach((change) => {
            callback({
                eventType: change.type === 'removed' ? 'DELETE' : change.type === 'added' ? 'INSERT' : 'UPDATE',
                new: change.type === 'removed' ? null : normalizeDoc(change.doc.id, change.doc.data()),
                old: change.type === 'added' ? null : normalizeDoc(change.doc.id, change.doc.data())
            });
        });
    });
}

function callFunction(name, data) {
    return fns.httpsCallable(name)(data || {});
}

let currentUser = null;
let currentSession = null;
let pollIsLocked = false;
let pollIsHidden = false;
let question = "Loading question...";
let options = ["Loading...", "Loading...", "Loading...", "Loading..."];
let myVote = null;
let isAdmin = false;
let isSuperAdmin = false;
let displayName = 'Anonymous';

// Cups state
let cupsIsActive = false;
let cupsCorrectOption = null;
let cupsMyPress = null;
let cupsMyRank = null; // rank among correct presses (1/2/3/4+), null if wrong or no press
let cupsTopScores = null; // top 5 correct presses
let cupsModalShown = false;

// Yearbook state
let ybPhase = 'waiting';       // 'waiting' | 'guessing' | 'reveal'
let ybTeacherIndex = null;     // index into YEARBOOK_TEACHERS
let ybOptionIndices = [];      // array of 4 teacher indices (shuffled)
let ybRoundId = null;          // increments each round
let ybMyVote = null;           // teacher index I voted for (null = not voted)
let ybMyScore = 0;
let ybScoredRoundId = null;    // round_id for which score has been awarded locally
let ybVoteCounts = {};         // { teacherIndex: count } populated during reveal
let ybTeacherQueue = [];       // ordered list of teacher indices for the session
let ybQueuePosition = 0;       // current position in the queue (0-indexed)
let ybAutoAdvanceEnabled = false;
let ybGuessingDurationMs = 20000;
let ybRevealDurationMs = 10000;
let ybPhaseStartedAt = null;   // timestamp when current phase started
let ybAutoAdvanceTimer = null;
let ybModalShown = false;

// Wally state
let wallyIsActive = false;
let wallySceneId = null;
let wallyRoundId = null;
let wallyStartedAt = null;
let wallyImageLoadTime = null;
let wallyFoundTime = null;
let wallyMyRank = null;
let wallyTopScores = null;
let wallyRaf = null;
let wallyRoundEnded = false;
let wallyScale = 1;
let wallyTranslateX = 0;
let wallyTranslateY = 0;
let wallyMinScale = 0.1;
const WALLY_MAX_SCALE = 5;
let wallyZoomPanSetup = false;
let wallyModalShown = false;

// Name Game state
let ngIsActive = false;
let ngImageSet = null;
let ngImageOrder = [];
let ngDurationSeconds = 10;
let ngMemorizeDurationSeconds = 10;
let ngRoundStartTime = null;
let ngRoundEndTime = null;
let ngMyScore = 0;
let ngCorrectSet = new Set();
let ngCountdownRaf = null;
let ngWallCountdownRaf = null;
let ngModalShown = false;

// ==========================================
// 2. Authentication & Initialization
// ==========================================

const USERNAME_ADJECTIVES = [
    'agile', 'amber', 'ashen', 'astral', 'atomic', 'azure',
    'bold', 'brash', 'brave', 'breezy', 'bright', 'brisk',
    'bronze', 'buoyant', 'calm', 'candid', 'cardinal', 'charred',
    'chilly', 'chrome', 'chunky', 'cinder', 'civic', 'clever',
    'coastal', 'cobalt', 'colossal', 'cool', 'cosmic', 'crafty',
    'crimson', 'crisp', 'crystal', 'cubic', 'cunning', 'curious',
    'daring', 'dauntless', 'dawning', 'deep', 'deft', 'delta',
    'dense', 'distant', 'dizzy', 'dreamy', 'drifting', 'dusk',
    'dusty', 'eager', 'ebony', 'elastic', 'electric', 'elegant',
    'ember', 'emerald', 'endless', 'epic', 'erratic', 'faint',
    'fast', 'feral', 'fierce', 'fiery', 'firm', 'fizzy',
    'flinty', 'fluffy', 'focal', 'foggy', 'forged', 'frantic',
    'frosty', 'frozen', 'funky', 'furious', 'galactic', 'garnet',
    'gentle', 'ghostly', 'giant', 'giddy', 'gilded', 'glad',
    'glowing', 'golden', 'grand', 'green', 'gritty', 'grounded',
    'gusty', 'happy', 'hasty', 'hazy', 'heavy', 'honed',
    'howling', 'humble', 'hushed', 'hyper', 'icy', 'indigo',
    'inky', 'inner', 'iron', 'ivory', 'jade', 'jagged',
    'jaunty', 'jolly', 'jovial', 'jumpy', 'keen', 'kinetic',
    'knightly', 'knotty', 'laser', 'lavender', 'lean', 'lively',
    'lofty', 'lone', 'looming', 'loud', 'lucky', 'lunar',
    'marble', 'marine', 'maverick', 'mellow', 'metallic', 'mighty',
    'mint', 'misty', 'molten', 'mossy', 'muted', 'mysterious',
    'narrow', 'neon', 'nimble', 'noble', 'north', 'nuclear',
    'obsidian', 'onyx', 'opal', 'orbital', 'parallel', 'patient',
    'peppy', 'phantom', 'phasmic', 'pixel', 'plucky', 'plush',
    'polar', 'primal', 'prime', 'prismatic', 'proud', 'pure',
    'quartz', 'quick', 'quiet', 'quirky', 'radiant', 'raging',
    'rapid', 'raw', 'reckless', 'relic', 'remote', 'rigid',
    'ringed', 'risen', 'roaming', 'robust', 'rocky', 'roguish',
    'rosy', 'rumbling', 'rusty', 'sacred', 'sandy', 'savage',
    'scarlet', 'scattered', 'scorched', 'sealed', 'serene', 'shallow',
    'sharp', 'shifting', 'shiny', 'silent', 'silver', 'skeletal',
    'sleek', 'sleepy', 'smart', 'smooth', 'snappy', 'soaring',
    'solar', 'solemn', 'solid', 'sonic', 'spare', 'spectral',
    'speedy', 'spicy', 'spiky', 'splendid', 'squat', 'static',
    'steady', 'stellar', 'stiff', 'stony', 'stormy', 'stripped',
    'strong', 'submerged', 'sudden', 'sullen', 'sunny', 'super',
    'surging', 'swift', 'swirling', 'tangled', 'tawny', 'teal',
    'tepid', 'thick', 'thorny', 'timid', 'tiny', 'towering',
    'tranquil', 'trembling', 'tundra', 'turbo', 'twilight', 'unbound',
    'unruly', 'upbeat', 'upright', 'vaporous', 'vast', 'vaulted',
    'veiled', 'velvety', 'verdant', 'violet', 'virid', 'vivid',
    'volcanic', 'wacky', 'wandering', 'warm', 'warped', 'weathered',
    'whirring', 'wild', 'windy', 'wired', 'wise', 'woolly',
    'worn', 'wry', 'zany', 'zealous', 'zippy'
];

const USERNAME_NOUNS = [
    'albatross', 'alligator', 'alpaca', 'anaconda', 'anchovy', 'antelope',
    'anvil', 'ape', 'armadillo', 'axolotl', 'baboon', 'badger',
    'barnacle', 'barracuda', 'bat', 'bear', 'beaver', 'beetle',
    'bison', 'blobfish', 'bluejay', 'boar', 'bolt', 'bongo',
    'buffalo', 'bullfrog', 'bumblebee', 'camel', 'capybara', 'caribou',
    'cassowary', 'cat', 'catfish', 'centipede', 'chameleon', 'cheetah',
    'chipmunk', 'cicada', 'clam', 'cloud', 'clownfish', 'cobra',
    'cockatoo', 'comet', 'condor', 'coral', 'cormorant', 'cougar',
    'coyote', 'crab', 'crane', 'crayfish', 'cricket', 'crocodile',
    'crow', 'curlew', 'cuttlefish', 'dartfrog', 'deer', 'dingo',
    'dolphin', 'dormouse', 'dragon', 'dragonfly', 'duck', 'dugong',
    'dunlin', 'eagle', 'earthworm', 'eel', 'egret', 'elk',
    'ermine', 'falcon', 'ferret', 'finch', 'firefly', 'flamingo',
    'flounder', 'flycatcher', 'fox', 'frog', 'gannet', 'gazelle',
    'gecko', 'gharial', 'gibbon', 'giraffe', 'glowworm', 'gnu',
    'goat', 'goose', 'gopher', 'gorilla', 'grasshopper', 'grebe',
    'groundhog', 'grouper', 'gull', 'hamster', 'hare', 'harrier',
    'hawk', 'hedgehog', 'hermitcrab', 'heron', 'hippo', 'hoopoe',
    'hornbill', 'hornet', 'hummingbird', 'hyena', 'ibis', 'iguana',
    'impala', 'jackal', 'jaguar', 'jellyfish', 'katydid', 'kingfisher',
    'kite', 'kiwi', 'koala', 'komodo', 'kudu', 'lamprey',
    'langur', 'lapwing', 'leafhopper', 'lemur', 'leopard', 'lion',
    'lizard', 'llama', 'lobster', 'lorikeet', 'lynx', 'mackerel',
    'manatee', 'mandrill', 'mantis', 'marlin', 'marmot', 'meerkat',
    'millipede', 'mink', 'mole', 'monarch', 'mongoose', 'moose',
    'moth', 'mouse', 'mudskipper', 'mule', 'mussel', 'narwhal',
    'newt', 'nighthawk', 'numbat', 'ocelot', 'octopus', 'opossum',
    'orca', 'oryx', 'osprey', 'otter', 'owl', 'oyster',
    'panda', 'pangolin', 'parrot', 'pelican', 'penguin', 'perch',
    'peregrine', 'pheasant', 'pigeon', 'pike', 'piranha', 'platypus',
    'plover', 'pollock', 'porcupine', 'porpoise', 'prawn', 'pronghorn',
    'ptarmigan', 'puffin', 'puma', 'quail', 'quetzal', 'quokka',
    'rabbit', 'raccoon', 'raven', 'ray', 'razorbill', 'reindeer',
    'rhino', 'roadrunner', 'rooster', 'sable', 'sailfish', 'salamander',
    'salmon', 'sandpiper', 'sawfish', 'scallop', 'scorpion', 'seagull',
    'seahorse', 'seal', 'shark', 'shrew', 'shrimp', 'skink',
    'skunk', 'sloth', 'snail', 'snapper', 'snipe', 'sparrow',
    'spider', 'springbok', 'squid', 'stag', 'starfish', 'stingray',
    'stoat', 'stork', 'sturgeon', 'sunfish', 'swan', 'swift',
    'tapir', 'tarantula', 'tarpon', 'termite', 'tern', 'thrush',
    'tiger', 'toad', 'toucan', 'treefrog', 'trout', 'tuna',
    'turtle', 'urchin', 'viper', 'vole', 'vulture', 'walrus',
    'warthog', 'wasp', 'weasel', 'whale', 'whelk', 'wildcat',
    'wildebeest', 'wolf', 'wolverine', 'wombat', 'woodpecker', 'wren',
    'yak', 'zorilla'
];
function generateUsername() {
    const adj = USERNAME_ADJECTIVES[Math.floor(Math.random() * USERNAME_ADJECTIVES.length)];
    const noun = USERNAME_NOUNS[Math.floor(Math.random() * USERNAME_NOUNS.length)];
    return `${adj}-${noun}`;
}

async function getOrCreateUsername(user) {
    if (user.user_metadata?.username) return user.user_metadata.username;

    const existing = await getUserProfile(user.id);
    if (existing?.username) {
        currentUser = {
            ...user,
            user_metadata: { ...(user.user_metadata || {}), username: existing.username }
        };
        return existing.username;
    }

    for (let attempt = 0; attempt < 20; attempt++) {
        const name = generateUsername();
        const collision = await db.collection('user_profiles').where('username', '==', name).limit(1).get();
        if (!collision.empty) continue;

        await db.collection('user_profiles').doc(user.id).set({ user_id: user.id, username: name }, { merge: true });
        currentUser = {
            ...user,
            user_metadata: { ...(user.user_metadata || {}), username: name }
        };
        return name;
    }

    return generateUsername();
}

function getRecaptchaToken() {
    return new Promise((resolve, reject) => {
        function renderWidget() {
            const container = document.createElement('div');
            container.style.display = 'none';
            document.body.appendChild(container);
            const widgetId = grecaptcha.render(container, {
                sitekey: '6LdHwsYsAAAAAAPo5oL0Yl5BAHuRoQPSFek9svoh',
                size: 'invisible',
                callback: (t) => { document.body.removeChild(container); resolve(t); },
                'error-callback': () => reject(new Error('reCAPTCHA failed')),
                'expired-callback': () => reject(new Error('reCAPTCHA expired')),
            });
            grecaptcha.execute(widgetId);
        }

        if (window.grecaptcha && grecaptcha.render) {
            renderWidget();
        } else {
            const script = document.createElement('script');
            script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
            script.onload = () => grecaptcha.ready(renderWidget);
            script.onerror = () => reject(new Error('reCAPTCHA script failed to load'));
            document.head.appendChild(script);
        }
    });
}

async function voterSignIn() {
    const { data: { session } } = await supabaseC.auth.getSession();
    if (session) {
        currentUser = session.user;
        currentSession = session;
    } else {
        try {
            const recaptchaToken = await getRecaptchaToken();
            await callFunction('verifyVoterCaptcha', { recaptchaToken });
        } catch (e) {
            showToast('Could not complete verification. Please reload.');
            return false;
        }
        const { data, error } = await supabaseC.auth.signInAnonymously();
        if (error) { showToast('Could not sign in. Please reload.'); return false; }
        currentUser = data.user;
        currentSession = data.session;
    }
    displayName = await getOrCreateUsername(currentUser);
    injectUsernameBar(displayName);
    return true;
}

function injectUsernameBar(username) {
    if (document.getElementById('username-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'username-bar';
    bar.innerHTML = `<span class="username-bar-label">You are:</span> <span class="username-bar-name">${username}</span>`;
    document.body.prepend(bar);
}

async function initAuth(token) {
    try {
        await ensureAuthBootstrap();
        const { data: { session } } = await supabaseC.auth.getSession();

        if (session) {
            currentUser = session.user;
            currentSession = session;
        }

        await checkRole();

        if (currentUser) {
            console.log("Authenticated as:", currentUser.id, isSuperAdmin ? "(Super Admin)" : isAdmin ? "(Admin)" : "(Voter)");
        }

        // Guard: admin & wall pages require admin role
        const _p = window.location.pathname;
        if ((_p === '/admin' || _p.startsWith('/admin/') || _p === '/wall' || _p.startsWith('/wall/')) && !isAdmin) {
            showToast("Please sign in with admin credentials.");
            setTimeout(() => {
                window.location.href = '/sign-in';
            }, 1500);
            return;
        }

        // Finish OAuth redirect flow after claims/session have settled
        const postAuthRedirect = sessionStorage.getItem('postAuthRedirect');
        if (postAuthRedirect && currentUser && window.location.pathname === '/sign-in') {
            sessionStorage.removeItem('postAuthRedirect');
            window.location.href = postAuthRedirect;
            return;
        }

        // If already signed in as admin on sign-in page, redirect
        if (window.location.pathname === '/sign-in' && isAdmin) {
            window.location.href = '/admin';
            return;
        }

        initalUIUpdate();
        fetchInitialData();
        setupRealtimeSubscriptions();

    } catch (error) {
        if (!window.location.pathname.startsWith('/admin') && window.location.pathname !== '/sign-in') {
            console.error("Auth error:", error);
            showToast("Authentication failed. Check console.");
        }
    }
    if (typeof updateAdminUI === 'function') await updateAdminUI();
}

addEventListener("DOMContentLoaded", async (event) => {
    const { data: { session } } = await supabaseC.auth.getSession();
    const authCon = document.getElementById('auth-container');
    const path = window.location.pathname;

    // /admin menu — auth required, no admin JS loaded here
    if (path === '/admin') {
        await initAuth(null);
        if (isAdmin) {
            const adminMenu = document.getElementById('admin-menu');
            if (adminMenu) adminMenu.style.display = 'flex';
            const adminsBtn = document.getElementById('adminMenuAdmins');
            if (adminsBtn && isSuperAdmin) adminsBtn.style.display = 'inline-block';
        }
        return;
    }

    // /admin/* sub-pages — auth + admin JS loaded by each page
    if (path.startsWith('/admin/')) {
        await initAuth(null);
        if (path === '/admin/cups') {
            await fetchCupsConfig();
            setupCupsRealtime();
            if (typeof updateCupsAdminUI === 'function') updateCupsAdminUI();
        }
        if (path === '/admin/name-game') {
            await fetchNameGameConfig();
            setupNameGameRealtime();
            if (typeof updateNGAdminUI === 'function') updateNGAdminUI();
        }
        if (path === '/admin/yearbook') {
            await fetchYearbookConfig();
            setupYearbookRealtime();
            if (typeof updateYBAdminUI === 'function') updateYBAdminUI();
        }
        if (path === '/admin/wally') {
            await fetchWallyConfig();
            setupWallyRealtime();
            if (typeof updateWallyAdminUI === 'function') updateWallyAdminUI();
        }
        return;
    }

    // Wall menu
    if (path === '/wall') {
        await initAuth(null);
        if (isAdmin) {
            const wallMenu = document.getElementById('wall-menu');
            if (wallMenu) wallMenu.style.display = 'flex';
        }
        return;
    }

    // Wall sub-pages
    if (path.startsWith('/wall/')) {
        await initAuth(null);
        if (path === '/wall/cups') {
            await fetchCupsConfig();
            setupCupsRealtime();
            await initWallCups();
        }
        if (path === '/wall/ng') {
            await fetchNameGameConfig();
            setupNameGameRealtime();
            initWallNG();
        }
        if (path === '/wall/yearbook') {
            await fetchYearbookConfig();
            setupYearbookRealtime();
            await initWallYearbook();
        }
        if (path === '/wall/wally') {
            await fetchWallyConfig();
            setupWallyRealtime();
            await initWallWally();
        }
        // /wall/vote uses fetchInitialData + setupRealtimeSubscriptions already called via initAuth
        return;
    }

    // Sign-in route
    if (path === '/sign-in') {
        if (session) {
            await initAuth(null);
            if (isAdmin) {
                window.location.href = '/admin';
                return;
            }
            // If voter is on sign-in page, let them stay to sign in as admin
        }
        loadRecaptcha();
        return;
    }

    // Cups route
    if (path === '/cups' || path === '/cups.html') {
        if (!await voterSignIn()) return;
        await initAuth(null);
        await initCups();
        return;
    }

    // Yearbook route
    if (path === '/yearbook' || path === '/yearbook.html') {
        if (!await voterSignIn()) return;
        await initAuth(null);
        await initYearbook();
        return;
    }

    // Wally route
    if (path === '/wally' || path === '/wally.html') {
        if (!await voterSignIn()) return;
        await initAuth(null);
        await initWally();
        return;
    }

    // Name Game route
    if (path === '/name-game' || path === '/name-game.html') {
        if (!await voterSignIn()) return;
        await initAuth(null);
        await initNameGame();
        return;
    }

    // Vote route
    if (path === '/vote' || path === '/vote.html') {
        if (!await voterSignIn()) return;
        await initAuth(null);
        return;
    }

    // Index/menu route
    if (!await voterSignIn()) return;
    const menuCon = document.getElementById('menu-container');
    if (menuCon) menuCon.style.display = 'flex';
});

window.signInWithGoogle = async function() {
    const redirectParam = new URLSearchParams(window.location.search).get('redirect');
    const redirectPath = redirectParam || window.location.pathname.replace(/\/$/, '') || '/';
    const { error } = await supabaseC.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${window.location.origin}${redirectPath}`,
            scopes: 'openid email profile'
        }
    });
    if (error) showToast("Google sign in failed: " + error.message);
}

window.signInWithMicrosoft = async function() {
    const redirectParam = new URLSearchParams(window.location.search).get('redirect');
    const redirectPath = redirectParam || window.location.pathname.replace(/\/$/, '') || '/';
    const { error } = await supabaseC.auth.signInWithOAuth({
        provider: 'azure',
        options: {
            redirectTo: `${window.location.origin}${redirectPath}`,
            scopes: 'openid email profile'
        }
    });
    if (error) showToast("Microsoft sign in failed: " + error.message);
}

window.loginUser = async function() {
    const email = document.getElementById('admin-email')?.value;
    const pass = document.getElementById('admin-pass')?.value;

    if (!email || !pass) return showToast("Please enter an email and password.");
    if (recaptchaAdminWidgetId === null) return showToast("Security check still loading, please try again in a moment.");

    await supabaseC.auth.signOut();

    try {
        const recaptchaToken = await getAdminRecaptchaToken();
        const { data, error } = await supabaseC.auth.signInWithPassword({
            email,
            password: pass,
            options: { captchaToken: recaptchaToken }
        });

        if (error) throw error;

        currentUser = data.user;
        currentSession = data.session;
        showToast("User logged in successfully.");
        await initAuth(null);
    } catch (error) {
        showToast("Login failed: " + error.message);
        if (typeof recaptchaAdminWidgetId !== 'undefined') grecaptcha.reset(recaptchaAdminWidgetId);
    }
};

window.logoutUser = async function() {
    try {
        await supabaseC.auth.signOut();
        isAdmin = false;
        isSuperAdmin = false;
        currentUser = null;
        currentSession = null;
        // If on sign-in page, stay there; otherwise go home
        if (window.location.pathname !== '/sign-in') {
            window.location.href = '/';
        }
    } catch (error) {
        console.log("Logout error:", error);
        showToast("Error logging out.");
    }
};

let recaptchaAdminWidgetId = null;
let recaptchaAdminResolve = null;

function recaptchaAdminComplete(token) {
    if (recaptchaAdminResolve) {
        recaptchaAdminResolve(token);
        recaptchaAdminResolve = null;
    }
}

function getAdminRecaptchaToken() {
    return new Promise((resolve) => {
        recaptchaAdminResolve = resolve;
        grecaptcha.execute(recaptchaAdminWidgetId);
    });
}

function loadRecaptcha() {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = 'https://www.google.com';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => {
        grecaptcha.ready(() => {
            const container = document.getElementById('recaptcha-container');
            recaptchaAdminWidgetId = grecaptcha.render(container, {
                sitekey: '6LdHwsYsAAAAAAPo5oL0Yl5BAHuRoQPSFek9svoh',
                size: 'invisible',
                callback: recaptchaAdminComplete,
            });
        });
    };
    document.head.appendChild(script);
}

// ==========================================
// 3. Supabase
// ==========================================
async function fetchInitialData() {
    const { data: configData } = await supabaseC
        .from('poll_config')
        .select('results_hidden, is_locked, results_hidden, question, option0, option1, option2, option3')
        .eq('id', 'main')
        .single();
    
    if (configData) {
        pollIsHidden = configData.results_hidden;
        pollIsLocked = configData.is_locked;
        question = configData.question || question;
        options[0] = configData.option0 || options[0];
        options[1] = configData.option1 || options[1];
        options[2] = configData.option2 || options[2];
        options[3] = configData.option3 || options[3];
        if (typeof updateAdminOptionInputs === 'function') updateAdminOptionInputs();
    }

    if (currentUser) {
        const { data: myVoteData } = await supabaseC
            .from('votes')
            .select('option_index')
            .eq('user_id', currentUser.id)
            .maybeSingle();

        myVote = myVoteData ? myVoteData.option_index : null;
    }

    updateVoteBtns();
    updateQandA();
    if (typeof updateAdminUI === 'function') updateAdminUI();
    fetchAndUpdateAllVotes();
}

async function fetchAndUpdateAllVotes() {
    try {
        const snap = await db.doc(COUNTER_DOCS.poll).get();
        const data = snap.data() || {};
        updateResults([
            data.o0 || 0,
            data.o1 || 0,
            data.o2 || 0,
            data.o3 || 0
        ], data.total || 0);
    } catch (error) {
        console.error("Error fetching votes:", error);
        showToast("Error fetching votes. Check console or reload.");
    }
}

function setupRealtimeSubscriptions() {
    subscribeToDoc(CONFIG_DOCS.poll_config, (payload) => {
        if (!payload.new) return;
        pollIsLocked = !!payload.new.is_locked;
        pollIsHidden = !!payload.new.results_hidden;
        question = payload.new.question || question;
        options[0] = payload.new.option0 || options[0];
        options[1] = payload.new.option1 || options[1];
        options[2] = payload.new.option2 || options[2];
        options[3] = payload.new.option3 || options[3];
        updateQandA();
        updateVoteBtns();
        fetchAndUpdateAllVotes();
        if (typeof updateAdminUI === 'function') updateAdminUI();
        if (typeof updateAdminOptionInputs === 'function') updateAdminOptionInputs();
    });

    subscribeToDoc(COUNTER_DOCS.poll, () => {
        fetchAndUpdateAllVotes();
    });

    if (currentUser) {
        subscribeToDoc(`votes/${currentUser.id}`, (payload) => {
            myVote = payload.new?.option_index ?? null;
            updateVoteBtns();
        });
    }
}

async function checkRole() {
    try {
        if (!currentUser) {
            isAdmin = false;
            isSuperAdmin = false;
            return;
        }

        const tokenResult = await auth.currentUser?.getIdTokenResult(true);
        const role = tokenResult?.claims?.role || null;

        isAdmin = role === 'admin' || role === 'super_admin';
        isSuperAdmin = role === 'super_admin';

    } catch (err) {
        console.error("Error checking role:", err);
        isAdmin = false;
        isSuperAdmin = false;
    }
}

// ==========================================
// 4. UI
// ==========================================

function showRankModal(modalId, rank, subMsg) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const emojis = ['🥇', '🥈', '🥉'];
    const places = ['1st Place!', '2nd Place!', '3rd Place!'];
    const emojiEl = modal.querySelector('.rank-modal-emoji');
    const placeEl = modal.querySelector('.rank-modal-place');
    if (emojiEl) emojiEl.textContent = emojis[rank - 1];
    if (placeEl) placeEl.textContent = places[rank - 1];
    if (subMsg) {
        const msgEl = modal.querySelector('[id$="-rank-modal-msg"]');
        if (msgEl) msgEl.textContent = subMsg;
    }
    const crumblEl = modal.querySelector('.rank-modal-crumbl');
    if (crumblEl) crumblEl.style.display = rank === 1 ? 'block' : 'none';
    modal.style.display = 'block';
}

function renderLeaderboardTable(scores, scoreField, formatFn) {
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    if (!scores || !scores.length) return '<p style="color:var(--text-muted);">No scores yet.</p>';
    return `<table class="yb-leaderboard" style="max-width:360px; margin:0 auto;"><tbody>
        ${scores.map((row, i) => `<tr>
            <td style="font-size:1.4rem; padding:0.6rem;">${medals[i] || (i+1)+'.'}</td>
            <td style="text-align:left; padding:0.6rem;">${row.display_name || 'Anonymous'}</td>
            <td style="font-weight:bold; color:var(--primary); padding:0.6rem; font-variant-numeric:tabular-nums;">${formatFn ? formatFn(row) : row[scoreField]}</td>
        </tr>`).join('')}
    </tbody></table>`;
}


function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.innerText = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

function initalUIUpdate() {
    const path = window.location.pathname;

    // Show #full-page for vote and wall sub-page routes
    const fPage = document.getElementById('full-page');
    if (fPage) fPage.style.display = 'flex';

    // Show #adminDash for admin sub-pages
    const adminDash = document.getElementById('adminDash');
    if (adminDash) {
        if (isAdmin) {
            adminDash.style.display = 'flex';
        } else {
            adminDash.style.display = 'none';
        }
    }

    updateVoteBtns();
    updateResults();
    updateQandA();
    if (typeof updateAdminUI === 'function') updateAdminUI();
}

// ==========================================
// 4.a Voter & Wall UI Updates
// ==========================================

function updateVoteBtns() {
    // Only update vote buttons on vote route
    const voterPaths = ['/vote', '/vote.html'];
    const isVoterPage = voterPaths.includes(window.location.pathname);

    const lBadge = document.getElementById('locked-status-badge');
    if (lBadge) {
        if (pollIsLocked) {
            lBadge.textContent = '🚫 Voting is locked 🚫';
            lBadge.classList.add('status-locked');
            lBadge.classList.remove('status-open');
        } else {
            lBadge.textContent = '😎 Voting is open 😎';
            lBadge.classList.remove('status-locked');
            lBadge.classList.add('status-open');
        }
    }

    if (!isVoterPage) return;

    const buttons = document.querySelectorAll('.vote-btn');
    const wRes = document.getElementById('resultGrid');
    const hid = document.getElementById('hiddenGrid');
    const hBadge = document.getElementById('hidden-status-badge');

    if (wRes && hid && hBadge) {
        if (pollIsHidden) {
            wRes.classList.add('hidden');
            hid.classList.remove('hidden');
            hBadge.style.display = 'block';
        } else {
            wRes.classList.remove('hidden');
            hid.classList.add('hidden');
            hBadge.style.display = 'none';
        }
    }

    buttons.forEach((button) => {
        const optionIndex = parseInt(button.dataset.option, 10);
        button.classList.remove('selected');

        if (myVote !== null) {
            button.disabled = true;
            if (myVote === optionIndex) button.classList.add('selected');
        } else if (pollIsLocked) {
            button.disabled = true;
        } else {
            button.disabled = false;
        }
    });
}

// Updates live results bars
function updateResults(counts = [], total = 0) {
    const total_count = document.getElementById('total-count');
    if (total_count) total_count.innerText = total;

    counts.forEach((count, index) => {
        const barElement = document.getElementById(`bar-${index}`);
        const pctElement = document.getElementById(`pct-${index}`);
        const colors = ["yellow", "green", "blue", "red"];
        
        if (barElement && pctElement) {
            const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
            barElement.style.width = `${percentage}%`;
            barElement.style.background = colors[index] || 'var(--primary)';
            pctElement.innerText = `${percentage}% (${count})`;
        } else if (pctElement) {
            const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
            pctElement.innerText = `${percentage}%`;
        }
    });

    const hText = document.getElementById('hidden-text');
    const lChart = document.getElementById('live-chart');

    if (hText && lChart) {
        if (pollIsHidden) {
            hText.style.display = 'block';
            lChart.style.display = 'none';
        } else {
            hText.style.display = 'none';
            lChart.style.display = 'block';
        }
    }
}

function updateQandA() {
    const questionEl = document.getElementById('question');
    const optionEls = [
        document.getElementById('option0'),
        document.getElementById('option1'),
        document.getElementById('option2'),
        document.getElementById('option3')
    ];

    if (questionEl) questionEl.innerText = question;

    if (optionEls) {
        optionEls.forEach((el, idx) => {
            if (el) {
                el.innerText = options[idx] || `Option ${idx + 1}`;
                el.style.display = options[idx] ? 'block' : 'none';
            }
        });
    }
}

// ==========================================
// 5. User Actions
// 
// 5.a Voters
// ==========================================

document.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const optionIndex = parseInt(btn.dataset.option);
        castVote(optionIndex);
    });
});

window.castVote = async function(optionIndex) {
    if (!currentUser) return showToast("Not authenticated yet.");
    if (pollIsLocked) return showToast("Voting is currently locked.");
    if (myVote !== null) return showToast("You have already voted!");

    try {
        const { error } = await supabaseC
            .from('votes')
            .upsert({ user_id: currentUser.id, option_index: optionIndex });
            
        if (error) throw error;

        myVote = optionIndex;
        updateVoteBtns();
        showToast("Vote cast successfully!");
    } catch (error) {
        console.error("Voting error:", error);
        showToast("Error casting vote.");
    }
}

// ==========================================
// 6. Cups
// ==========================================

async function fetchCupsConfig() {
    const { data: config } = await supabaseC
        .from('hats_config')
        .select('correct_option, is_active')
        .eq('id', 'main')
        .single();
    if (config) {
        cupsIsActive = config.is_active;
        cupsCorrectOption = config.correct_option;
    }
}

async function initCups() {
    await fetchCupsConfig();
    cupsTopScores = await loadCupsLeaderboard(5);

    if (currentUser) {
        const { data: press } = await supabaseC
            .from('hats_presses')
            .select('choice, timestamp, rank')
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (press) {
            cupsMyPress = press.choice;
            cupsMyRank = press.rank ?? null;
        }
    }

    updateCupsUI();
    setupCupsRealtime();

    const fullPage = document.getElementById('full-page');
    if (fullPage) fullPage.style.display = 'flex';
}

function updateCupsUI() {
    const badge = document.getElementById('cups-status-badge');
    const pickDiv = document.getElementById('cups-pick');
    const inactiveDiv = document.getElementById('cups-inactive');
    const resultDiv = document.getElementById('cups-result');
    const lbDiv = document.getElementById('cups-leaderboard');
    const lbList = document.getElementById('cups-leaderboard-list');

    if (!badge) return;

    if (cupsMyPress !== null) {
        // User has submitted — show result and leaderboard
        if (pickDiv) pickDiv.style.display = 'none';
        if (inactiveDiv) inactiveDiv.style.display = 'none';
        if (resultDiv) {
            resultDiv.style.display = 'block';
            const isCorrect = cupsMyPress === cupsCorrectOption;
            const isTopFive = isCorrect && cupsMyRank !== null && cupsMyRank <= 5;

            if (isTopFive) {
                const emoji = ['', '🥇', '🥈', '🥉', '🏅', '🏅'][cupsMyRank];
                const place = ['', '1st Place!', '2nd Place!', '3rd Place!', '4th Place!', '5th Place!'][cupsMyRank];
                resultDiv.innerHTML = `
                    <div class="cups-result-card cups-result-win">
                        <div class="cups-result-emoji">${emoji}</div>
                        <h2>${place}</h2>
                        <p>You picked the right cup!</p>
                    </div>`;
                if (cupsMyRank <= 3 && !cupsModalShown) {
                    cupsModalShown = true;
                    showRankModal('cups-rank-modal', cupsMyRank);
                }
            } else {
                const heading = isCorrect ? "Didn't place" : "Wrong answer";
                const sub = isCorrect
                    ? "You got it right, but didn't place in the top 5."
                    : "Better luck next time!";
                resultDiv.innerHTML = `
                    <div class="cups-result-card cups-result-neutral">
                        <h2>${heading}</h2>
                        <p>${sub}</p>
                    </div>`;
            }
        }
        if (lbDiv) {
            lbDiv.style.display = 'block';
            if (lbList) lbList.innerHTML = renderCupsLeaderboardHTML(cupsTopScores);
        }
        badge.textContent = 'Round over';
        badge.className = 'status-badge status-locked';
    } else if (cupsIsActive) {
        if (pickDiv) pickDiv.style.display = 'block';
        if (inactiveDiv) inactiveDiv.style.display = 'none';
        if (resultDiv) resultDiv.style.display = 'none';
        if (lbDiv) lbDiv.style.display = 'none';
        badge.textContent = 'Round is open — pick a cup!';
        badge.className = 'status-badge status-open';
    } else {
        if (pickDiv) pickDiv.style.display = 'none';
        if (inactiveDiv) inactiveDiv.style.display = 'block';
        if (resultDiv) resultDiv.style.display = 'none';
        if (lbDiv) {
            lbDiv.style.display = 'block';
            if (lbList) lbList.innerHTML = renderCupsLeaderboardHTML(cupsTopScores);
        }
        badge.textContent = 'Waiting for round to start...';
        badge.className = 'status-badge status-locked';
    }
}

/**
 * Fetches the top N Cups leaderboard entries from Firestore
 * @param {number} limit - Maximum number of entries to return (default: 5)
 * @returns {Promise<Array>} Array of {display_name, timestamp} objects
 */
async function loadCupsLeaderboard(limit) {
    const snap = await db.doc(LEADERBOARD_DOCS.hats).get();
    const data = snap.data() || {};
    return (data.top || []).slice(0, limit || 5);
}

function renderCupsLeaderboardHTML(scores) {
    const medals = ['🥇', '🥈', '🥉', '🏅', '🏅'];
    if (!scores || !scores.length) {
        return '<p style="color: var(--text-muted); text-align: center; padding: 1rem;">No scores yet</p>';
    }
    return `<table class="yb-leaderboard" style="max-width: 360px; margin: 0 auto;"><tbody>
        ${scores.map((row, i) => `
            <tr>
                <td style="font-size: 1.4rem; padding: 0.6rem;">${medals[i] || (i + 1) + '.'}</td>
                <td style="text-align: left; padding: 0.6rem;">${row.display_name || 'Anonymous'}</td>
            </tr>
        `).join('')}
    </tbody></table>`;
}

function setupCupsRealtime() {
    subscribeToDoc(CONFIG_DOCS.hats_config, (payload) => {
        if (!payload.new) return;
        const newCorrectOption = payload.new.correct_option ?? null;
        if (newCorrectOption === null && cupsCorrectOption !== null) {
            cupsMyPress = null;
            cupsMyRank = null;
            cupsTopScores = null;
            cupsModalShown = false;
        }
        cupsIsActive = !!payload.new.is_active;
        cupsCorrectOption = newCorrectOption;
        updateCupsUI();
        if (typeof updateCupsAdminUI === 'function') updateCupsAdminUI();
        if (typeof updateWallCupsUI === 'function') updateWallCupsUI();
    });

    subscribeToDoc(LEADERBOARD_DOCS.hats, (payload) => {
        cupsTopScores = (payload.new?.top || []).slice(0, 5);
        updateCupsUI();
        if (typeof updateWallCupsUI === 'function') updateWallCupsUI();
    });

    if (currentUser) {
        subscribeToDoc(`hats_presses/${currentUser.id}`, (payload) => {
            const press = payload.new;
            if (!press) {
                cupsMyPress = null;
                cupsMyRank = null;
            } else {
                cupsMyPress = press.choice ?? null;
                cupsMyRank = press.rank ?? null;
            }
            updateCupsUI();
        });
    }
}

window.pressCup = async function(option) {
    if (!currentUser) return showToast("Not authenticated.");
    if (!cupsIsActive) return showToast("Round is not active.");
    if (cupsMyPress !== null) return showToast("You already picked!");
    if (cupsCorrectOption === null) return showToast("Round not configured.");

    // Disable buttons immediately to prevent double-tap
    [1, 2, 3].forEach(n => {
        const btn = document.getElementById(`cups-btn-${n}`);
        if (btn) btn.disabled = true;
    });

    try {
        const { data: myPress, error } = await supabaseC
            .from('hats_presses')
            .insert({ user_id: currentUser.id, choice: option, timestamp: new Date().toISOString(), display_name: displayName })
            .select('choice')
            .single();

        if (error) throw error;

        cupsMyPress = option;
        // Don't set rank here — let the realtime listener get it from the Cloud Function
        // The rank is set asynchronously, so we'll get it from the onSnapshot listener below

        updateCupsUI();
    } catch (error) {
        console.error("Cups press error:", error);
        showToast("Error recording your pick.");
        [1, 2, 3].forEach(n => {
            const btn = document.getElementById(`cups-btn-${n}`);
            if (btn) btn.disabled = false;
        });
    }
}

// ==========================================
// 7. Name Game
// ==========================================

async function fetchNameGameConfig() {
    const { data: config } = await supabaseC
        .from('name_game_config')
        .select('*')
        .eq('id', 'main')
        .single();
    if (config) {
        ngIsActive = config.is_active;
        ngImageSet = config.image_set;
        ngImageOrder = config.image_order || [];
        ngDurationSeconds = config.round_duration_seconds || 10;
        ngMemorizeDurationSeconds = config.memorize_duration_seconds || 10;
        ngRoundStartTime = config.round_start_time ? new Date(config.round_start_time).getTime() : null;
        ngRoundEndTime = config.round_end_time ? new Date(config.round_end_time).getTime() : null;
    }
}

// Returns current game phase: 'idle' | 'memorize' | 'recall' | 'done'
function ngGetPhase() {
    if (!ngIsActive || !ngRoundStartTime) return ngRoundStartTime ? 'done' : 'idle';
    const now = Date.now();
    const recallStart = ngRoundStartTime + ngMemorizeDurationSeconds * 1000;
    let recallEnd = recallStart + ngDurationSeconds * 1000;
    if (ngRoundEndTime) recallEnd = Math.min(recallEnd, ngRoundEndTime);
    if (now < recallStart) return 'memorize';
    if (now < recallEnd) return 'recall';
    return 'done';
}

async function initNameGame() {
    await fetchNameGameConfig();

    if (currentUser) {
        const { data: scoreRow } = await supabaseC
            .from('name_game_scores')
            .select('score')
            .eq('user_id', currentUser.id)
            .maybeSingle();
        if (scoreRow) ngMyScore = scoreRow.score;
    }

    const fullPage = document.getElementById('full-page');
    if (fullPage) fullPage.style.display = 'flex';

    setupNameGameRealtime();
    updateNameGameUI();
}

function updateNameGameUI() {
    if (ngCountdownRaf) { cancelAnimationFrame(ngCountdownRaf); ngCountdownRaf = null; }

    const phase = ngGetPhase();
    ['ng-idle', 'ng-memorize', 'ng-recall', 'ng-done'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const activeEl = document.getElementById({ idle: 'ng-idle', memorize: 'ng-memorize', recall: 'ng-recall', done: 'ng-done' }[phase]);
    if (activeEl) activeEl.style.display = 'block';

    const timerSection = document.getElementById('ng-timer-section');
    if (timerSection) timerSection.style.display = (phase === 'memorize' || phase === 'recall') ? 'block' : 'none';

    if (phase === 'memorize') {
        buildNGImageGrid('ng-memorize-grid');
        startNGCountdown('memorize');
    } else if (phase === 'recall') {
        updateNGScoreDisplay();
        startNGCountdown('recall');
        const input = document.getElementById('ng-input');
        if (input) { input.value = ''; input.focus(); }
    } else if (phase === 'done') {
        showNGFinalScore();
        showNGDoneLeaderboard();
    }
}

async function showNGDoneLeaderboard() {
    const el = document.getElementById('ng-done-scores');
    if (!el || ngModalShown) return;
    try {
        const snap = await db.doc(LEADERBOARD_DOCS.name_game).get();
        const scores = snap.data()?.top || [];
        el.innerHTML = scores.length ? renderLeaderboardTable(scores, 'score') : '';
        const userRank = scores.findIndex(r => r.display_name === displayName && r.score === ngMyScore);
        if (userRank >= 0 && userRank < 3 && ngMyScore > 0) {
            ngModalShown = true;
            const msgEl = document.getElementById('ng-rank-modal-msg');
            if (msgEl) msgEl.textContent = `You got ${ngMyScore} correct!`;
            showRankModal('ng-rank-modal', userRank + 1);
        }
    } catch (e) { /* leaderboard unavailable */ }
}

function buildNGImageGrid(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !NAME_GAME_SETS?.[ngImageSet]) return;
    if (container.dataset.built === ngImageSet) return;
    const images = NAME_GAME_SETS[ngImageSet].images;
    container.innerHTML = '';
    ngImageOrder.forEach(idx => {
        if (!images[idx]) return;
        const img = document.createElement('img');
        img.src = images[idx].path;
        img.className = 'ng-grid-img';
        img.alt = '';
        container.appendChild(img);
    });
    container.dataset.built = ngImageSet;
}

function updateNGScoreDisplay() {
    const el = document.getElementById('ng-score-display');
    if (el) el.textContent = `Score: ${ngMyScore}`;
}

function startNGCountdown(phase) {
    const bar = document.getElementById('ng-timer-bar');
    const timerText = document.getElementById('ng-timer-text');
    const badge = document.getElementById('ng-phase-badge');
    if (!bar || !ngRoundStartTime) return;

    const recallStart = ngRoundStartTime + ngMemorizeDurationSeconds * 1000;
    const endTime = phase === 'memorize'
        ? recallStart
        : Math.min(recallStart + ngDurationSeconds * 1000, ngRoundEndTime || Infinity);
    const totalMs = phase === 'memorize' ? ngMemorizeDurationSeconds * 1000 : ngDurationSeconds * 1000;

    function tick() {
        const remaining = Math.max(0, endTime - Date.now());
        const pct = (remaining / totalMs) * 100;

        bar.style.width = pct + '%';
        bar.classList.remove('ng-timer-warning', 'ng-timer-danger');
        if (phase === 'recall') {
            if (pct <= 20) bar.classList.add('ng-timer-danger');
            else if (pct <= 40) bar.classList.add('ng-timer-warning');
        }

        const secs = Math.ceil(remaining / 1000);
        if (timerText) timerText.textContent = secs + 's';
        if (badge) badge.textContent = phase === 'memorize' ? `Memorize! ${secs}s` : `Recall — ${secs}s left`;

        if (remaining <= 0) { updateNameGameUI(); return; }
        ngCountdownRaf = requestAnimationFrame(tick);
    }
    ngCountdownRaf = requestAnimationFrame(tick);
}

function ngGameOver() {
    if (ngCountdownRaf) { cancelAnimationFrame(ngCountdownRaf); ngCountdownRaf = null; }
    updateNameGameUI();
}

function showNGFinalScore() {
    const finalEl = document.getElementById('ng-final-score');
    if (finalEl) finalEl.textContent = `You got ${ngMyScore} right!`;
}

function showNGFeedback(type, message) {
    const el = document.getElementById('ng-feedback');
    if (!el) return;
    el.textContent = message;
    el.className = `ng-feedback ng-feedback-show ng-${type}`;
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => {
        el.classList.remove('ng-feedback-show');
    }, type === 'correct' ? 600 : 1000);
}

function setupNameGameRealtime() {
    subscribeToDoc(CONFIG_DOCS.name_game_config, (payload) => {
        if (!payload.new) return;
        const wasActive = ngIsActive;
        const newActive = !!payload.new.is_active;
        const newSet = payload.new.image_set ?? null;

        if (!newActive && newSet === null) {
            ngMyScore = 0;
            ngCorrectSet = new Set();
        }

        ngIsActive = newActive;
        ngImageSet = newSet;
        ngImageOrder = payload.new.image_order || [];
        ngDurationSeconds = payload.new.round_duration_seconds || 10;
        ngMemorizeDurationSeconds = payload.new.memorize_duration_seconds || 10;
        ngRoundStartTime = payload.new.round_start_time ? new Date(payload.new.round_start_time).getTime() : null;
        ngRoundEndTime = payload.new.round_end_time ? new Date(payload.new.round_end_time).getTime() : null;

        if (!wasActive && newActive) {
            ngMyScore = 0;
            ngCorrectSet = new Set();
            ngModalShown = false;
            ['ng-memorize-grid', 'ng-wall-memorize-grid'].forEach(id => {
                const el = document.getElementById(id);
                if (el) delete el.dataset.built;
            });
        }

        updateNameGameUI();
        if (typeof updateNGAdminUI === 'function') updateNGAdminUI();
        if (typeof updateWallNGUI === 'function') updateWallNGUI();
    });
}

window.submitNGAnswer = async function() {
    if (ngGetPhase() !== 'recall') return;

    const input = document.getElementById('ng-input');
    if (!input) return;
    const answer = input.value.trim().toLowerCase();
    if (!answer) return;

    const images = NAME_GAME_SETS?.[ngImageSet]?.images;
    if (!images) return;

    // Find any unanswered image that matches this answer
    let matchedIdx = null;
    for (let i = 0; i < ngImageOrder.length; i++) {
        const imgIdx = ngImageOrder[i];
        if (ngCorrectSet.has(imgIdx)) continue;
        if (images[imgIdx]?.answers.map(a => a.toLowerCase()).includes(answer)) {
            matchedIdx = imgIdx;
            break;
        }
    }

    input.value = '';
    input.focus();

    if (matchedIdx !== null) {
        ngCorrectSet.add(matchedIdx);
        ngMyScore++;
        showNGFeedback('correct', '✓ Correct!');
        updateNGScoreDisplay();

        await supabaseC.from('name_game_scores').upsert({
            user_id: currentUser.id,
            display_name: displayName,
            score: ngMyScore
        });
    } else {
        showNGFeedback('wrong', '✗ Try again');
    }
}

// ==========================================
// 8. Wall — Cups Display
// ==========================================

async function initWallCups() {
    cupsTopScores = await loadCupsLeaderboard(5);
    const fullPage = document.getElementById('full-page');
    if (fullPage) fullPage.style.display = 'flex';
    updateWallCupsUI();
    setupWallCupsRealtime();
}

function updateWallCupsUI() {
    const badge = document.getElementById('cups-wall-badge');
    const inactiveDiv = document.getElementById('cups-wall-inactive');
    const activeDiv = document.getElementById('cups-wall-active');
    const lbEl = document.getElementById('cups-wall-leaderboard');

    if (!badge) return;

    badge.textContent = cupsIsActive ? 'Round is live!' : 'Waiting...';
    badge.className = cupsIsActive ? 'status-badge status-open' : 'status-badge status-locked';
    if (inactiveDiv) inactiveDiv.style.display = cupsIsActive ? 'none' : 'block';
    if (activeDiv) activeDiv.style.display = cupsIsActive ? 'block' : 'none';

    if (lbEl) {
        const scores = cupsTopScores || [];
        const medals = ['🥇', '🥈', '🥉', '🏅', '🏅'];
        lbEl.innerHTML = scores.length
            ? scores.map((row, i) => `
                <tr>
                    <td style="padding: 0.75rem; font-size: 1.5rem;">${medals[i]}</td>
                    <td style="padding: 0.75rem; text-align: left;">${row.display_name || 'Anonymous'}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="2" style="color: var(--text-muted); text-align: center; padding: 1rem;">No scores yet</td></tr>';
    }
}

function setupWallCupsRealtime() {
    subscribeToDoc(LEADERBOARD_DOCS.hats, async () => {
        cupsTopScores = await loadCupsLeaderboard(5);
        updateWallCupsUI();
    });
}

// ==========================================
// 9. Wall — Name Game Display
// ==========================================

let ngWallScoresChannel = null;

function initWallNG() {
    updateWallNGUI();
}

function updateWallNGUI() {
    const badge = document.getElementById('ng-wall-badge');
    if (!badge) return;

    if (ngWallCountdownRaf) { cancelAnimationFrame(ngWallCountdownRaf); ngWallCountdownRaf = null; }

    const phase = ngGetPhase();
    const phaseIds = ['ng-wall-idle', 'ng-wall-memorize', 'ng-wall-recall', 'ng-wall-done'];
    const showId = { idle: 'ng-wall-idle', memorize: 'ng-wall-memorize', recall: 'ng-wall-recall', done: 'ng-wall-done' }[phase];
    phaseIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === showId ? 'block' : 'none';
    });

    const timerSection = document.getElementById('ng-wall-timer-section');

    if (phase === 'idle') {
        badge.textContent = 'Waiting for round to start...';
        badge.className = 'status-badge status-locked';
        if (timerSection) timerSection.style.display = 'none';
        if (ngWallScoresChannel) { ngWallScoresChannel.unsubscribe(); ngWallScoresChannel = null; }

    } else if (phase === 'memorize') {
        badge.textContent = 'Memorize!';
        badge.className = 'status-badge status-open';
        if (timerSection) timerSection.style.display = 'block';
        buildNGImageGrid('ng-wall-memorize-grid');
        startWallNGCountdown('memorize');
        if (ngWallScoresChannel) { ngWallScoresChannel.unsubscribe(); ngWallScoresChannel = null; }

    } else if (phase === 'recall') {
        badge.textContent = ngRoundEndTime ? 'Ending soon!' : 'Recall phase!';
        badge.className = ngRoundEndTime ? 'status-badge status-locked' : 'status-badge status-open';
        if (timerSection) timerSection.style.display = 'block';
        startWallNGCountdown('recall');
        loadWallNGLeaderboard();
        setupWallNGScoresRealtime();

    } else if (phase === 'done') {
        badge.textContent = "Time's up!";
        badge.className = 'status-badge status-locked';
        if (timerSection) timerSection.style.display = 'none';
        loadWallNGLeaderboard();
        if (ngWallScoresChannel) { ngWallScoresChannel.unsubscribe(); ngWallScoresChannel = null; }
    }
}

function startWallNGCountdown(phase) {
    const bar = document.getElementById('ng-wall-timer-bar');
    const timerText = document.getElementById('ng-wall-timer-text');
    if (!bar || !ngRoundStartTime) return;

    const recallStart = ngRoundStartTime + ngMemorizeDurationSeconds * 1000;
    const endTime = phase === 'memorize'
        ? recallStart
        : Math.min(recallStart + ngDurationSeconds * 1000, ngRoundEndTime || Infinity);
    const totalMs = phase === 'memorize' ? ngMemorizeDurationSeconds * 1000 : (ngRoundEndTime ? 5000 : ngDurationSeconds * 1000);

    function tick() {
        const remaining = Math.max(0, endTime - Date.now());
        const pct = (remaining / totalMs) * 100;

        bar.style.width = pct + '%';
        bar.classList.remove('ng-timer-warning', 'ng-timer-danger');
        if (phase === 'recall') {
            if (ngRoundEndTime || pct <= 20) bar.classList.add('ng-timer-danger');
            else if (pct <= 40) bar.classList.add('ng-timer-warning');
        }

        const secs = Math.ceil(remaining / 1000);
        if (timerText) timerText.textContent = secs + 's';

        if (remaining <= 0) { updateWallNGUI(); return; }
        ngWallCountdownRaf = requestAnimationFrame(tick);
    }
    ngWallCountdownRaf = requestAnimationFrame(tick);
}

function setupWallNGScoresRealtime() {
    if (ngWallScoresChannel) return;
    ngWallScoresChannel = {
        unsubscribe: subscribeToDoc(LEADERBOARD_DOCS.name_game, () => {
            loadWallNGLeaderboard();
        })
    };
}

async function loadWallNGLeaderboard() {
    const tables = ['ng-wall-leaderboard', 'ng-wall-done-leaderboard']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    if (!tables.length) return;

    const snap = await db.doc(LEADERBOARD_DOCS.name_game).get();
    const scores = snap.data()?.top || [];

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const html = scores?.length
        ? scores.map((row, i) => `
            <tr style="border-bottom: 1px solid var(--card-border);">
                <td style="padding: 0.75rem; font-size: 1.5rem;">${medals[i] || (i + 1) + '.'}</td>
                <td style="padding: 0.75rem; text-align: left;">${row.display_name || 'Anonymous'}</td>
                <td style="padding: 0.75rem; font-weight: bold;">${row.score}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="3" style="color:var(--text-muted);text-align:center;padding:1rem;">No scores yet.</td></tr>';

    tables.forEach(t => t.innerHTML = html);
}

// ==========================================
// 10. Yearbook
// ==========================================

async function fetchYearbookConfig() {
    const { data: config } = await supabaseC
        .from('yearbook_config')
        .select('*')
        .eq('id', 'main')
        .single();
    if (config) {
        ybPhase = config.phase || 'waiting';
        ybTeacherIndex = config.teacher_index ?? null;
        ybOptionIndices = config.option_indices || [];
        ybRoundId = config.round_id ?? null;
        ybTeacherQueue = config.teacher_queue || [];
        ybQueuePosition = config.queue_position ?? 0;
        ybAutoAdvanceEnabled = config.auto_advance_enabled ?? false;
        ybGuessingDurationMs = (config.guessing_duration_ms ?? 20) * 1000;
        ybRevealDurationMs = (config.reveal_duration_ms ?? 10) * 1000;
        ybPhaseStartedAt = config.phase_started_at ? new Date(config.phase_started_at).getTime() : null;
    }
}

async function initYearbook() {
    await fetchYearbookConfig();

    if (currentUser) {
        if (ybRoundId !== null) {
            const { data: vote } = await supabaseC
                .from('yearbook_votes')
                .select('teacher_index')
                .eq('user_id', currentUser.id)
                .eq('round_id', ybRoundId)
                .maybeSingle();
            if (vote) ybMyVote = vote.teacher_index;
        }

        const { data: scoreRow } = await supabaseC
            .from('yearbook_scores')
            .select('score')
            .eq('user_id', currentUser.id)
            .maybeSingle();
        if (scoreRow) ybMyScore = scoreRow.score;
    }

    const fullPage = document.getElementById('full-page');
    if (fullPage) fullPage.style.display = 'flex';

    setupYearbookRealtime();
    updateYearbookUI();
}

function updateYearbookUI() {
    ['yb-waiting', 'yb-guessing', 'yb-reveal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const activeEl = document.getElementById(`yb-${ybPhase}`);
    if (activeEl) activeEl.style.display = 'block';

    if (ybPhase === 'guessing') {
        renderYBOptions();
    } else if (ybPhase === 'reveal') {
        renderYBReveal();
    }
}

function renderYBOptions() {
    if (!YEARBOOK_TEACHERS || !ybOptionIndices.length) return;

    // Throwback photo
    const img = document.getElementById('yb-throwback-img');
    if (img && ybTeacherIndex !== null) {
        const _t = YEARBOOK_TEACHERS[ybTeacherIndex];
        img.src = `../media/teachers/throwbacks/${ybTeacherIndex}.${_t?.throwbackExt || _t?.ext || 'jpg'}`;
        img.alt = 'Who is this teacher?';
    }

    // Answer buttons
    const grid = document.getElementById('yb-options-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444'];
    ybOptionIndices.forEach((teacherIdx, i) => {
        const teacher = YEARBOOK_TEACHERS[teacherIdx];
        if (!teacher) return;
        const btn = document.createElement('button');
        btn.className = 'yb-option-btn';
        btn.style.borderColor = colors[i];
        btn.textContent = teacher.name;
        btn.disabled = ybMyVote !== null;
        if (ybMyVote === teacherIdx) {
            btn.classList.add('yb-option-selected');
            btn.style.background = colors[i];
        }
        btn.onclick = () => submitYearbookVote(teacherIdx);
        grid.appendChild(btn);
    });
}

async function renderYBReveal() {
    if (!YEARBOOK_TEACHERS || ybTeacherIndex === null) return;

    // Photos
    const throwbackImg = document.getElementById('yb-reveal-throwback');
    const currentImg = document.getElementById('yb-reveal-current');
    const correctName = document.getElementById('yb-reveal-name');
    const teacher = YEARBOOK_TEACHERS[ybTeacherIndex];
    if (throwbackImg) throwbackImg.src = `../media/teachers/throwbacks/${ybTeacherIndex}.${teacher?.throwbackExt || teacher?.ext || 'jpg'}`;
    if (currentImg) currentImg.src = `../media/teachers/current/${ybTeacherIndex}.${teacher?.currentExt || teacher?.ext || 'jpg'}`;
    if (correctName) correctName.textContent = teacher?.name || '';

    // Personal result chip
    const chip = document.getElementById('yb-result-chip');
    if (chip && ybMyVote !== null) {
        const correct = ybMyVote === ybTeacherIndex;
        chip.textContent = correct ? 'Correct! +1 point' : 'Wrong answer';
        chip.className = `yb-result-chip ${correct ? 'yb-chip-correct' : 'yb-chip-wrong'}`;
        chip.style.display = 'inline-block';
    }

    // Fetch vote counts
    if (ybOptionIndices.length && ybRoundId !== null) {
        const snap = await db.doc(COUNTER_DOCS.yearbook).get();
        const data = snap.data() || {};
        ybVoteCounts = data.round_id === ybRoundId ? (data.counts || {}) : {};
        renderYBVoteBars();
    }

    // Award score if correct and not yet scored this round
    if (currentUser && ybMyVote === ybTeacherIndex && ybScoredRoundId !== ybRoundId) {
        ybScoredRoundId = ybRoundId;
        ybMyScore++;
        await supabaseC.from('yearbook_scores').upsert({
            user_id: currentUser.id,
            display_name: displayName,
            score: ybMyScore
        });
    }

    showYBRevealLeaderboard();
}

async function showYBRevealLeaderboard() {
    const el = document.getElementById('yb-reveal-scores');
    if (!el) return;
    try {
        const snap = await db.doc(LEADERBOARD_DOCS.yearbook).get();
        const scores = snap.data()?.top || [];
        el.innerHTML = scores.length ? renderLeaderboardTable(scores, 'score') : '';
        if (!ybModalShown && ybMyScore > 0) {
            const userRank = scores.findIndex(r => r.display_name === displayName && r.score === ybMyScore);
            if (userRank >= 0 && userRank < 3) {
                ybModalShown = true;
                const msgEl = document.getElementById('yb-rank-modal-msg');
                if (msgEl) msgEl.textContent = `You have ${ybMyScore} point${ybMyScore !== 1 ? 's' : ''}!`;
                showRankModal('yb-rank-modal', userRank + 1);
            }
        }
    } catch (e) { /* leaderboard unavailable */ }
}

function renderYBVoteBars() {
    const grid = document.getElementById('yb-vote-bars');
    if (!grid || !YEARBOOK_TEACHERS) return;
    grid.innerHTML = '';

    const total = Object.values(ybVoteCounts).reduce((a, b) => a + b, 0);
    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444'];

    ybOptionIndices.forEach((teacherIdx, i) => {
        const teacher = YEARBOOK_TEACHERS[teacherIdx];
        if (!teacher) return;
        const count = ybVoteCounts[teacherIdx] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isCorrect = teacherIdx === ybTeacherIndex;

        const row = document.createElement('div');
        row.className = `yb-vote-row${isCorrect ? ' yb-vote-correct' : ''}`;
        row.innerHTML = `
            <div class="yb-vote-label">
                <span>${isCorrect ? '✓ ' : ''}${teacher.name}</span>
                <span>${pct}% (${count})</span>
            </div>
            <div class="yb-vote-track">
                <div class="yb-vote-bar" style="width:${pct}%; background:${isCorrect ? '#10b981' : colors[i]};"></div>
            </div>`;
        grid.appendChild(row);
    });
}

function setupYearbookRealtime() {
    subscribeToDoc(CONFIG_DOCS.yearbook_config, async (payload) => {
        if (!payload.new) return;
        const prevRoundId = ybRoundId;

        ybPhase = payload.new.phase || 'waiting';
        ybTeacherIndex = payload.new.teacher_index ?? null;
        ybOptionIndices = payload.new.option_indices || [];
        ybRoundId = payload.new.round_id ?? null;
        ybTeacherQueue = payload.new.teacher_queue || [];
        ybQueuePosition = payload.new.queue_position ?? 0;
        ybAutoAdvanceEnabled = payload.new.auto_advance_enabled ?? false;
        ybGuessingDurationMs = (payload.new.guessing_duration_ms ?? 20) * 1000;
        ybRevealDurationMs = (payload.new.reveal_duration_ms ?? 10) * 1000;
        ybPhaseStartedAt = payload.new.phase_started_at ? new Date(payload.new.phase_started_at).getTime() : null;

        if (ybRoundId !== prevRoundId) {
            ybMyVote = null;
            ybVoteCounts = {};
            ybModalShown = false;
        }

        ybStartAutoAdvanceTimer();
        updateYearbookUI();
        if (typeof updateYBAdminUI === 'function') updateYBAdminUI();
        if (typeof updateWallYearbookUI === 'function') updateWallYearbookUI();
    });

    subscribeToDoc(COUNTER_DOCS.yearbook, (payload) => {
        const data = payload.new || {};
        ybVoteCounts = data.round_id === ybRoundId ? (data.counts || {}) : {};
        if (ybPhase === 'reveal') renderYBVoteBars();
        if (typeof updateWallYBVoteCounts === 'function') updateWallYBVoteCounts();
    });
}

function ybStartAutoAdvanceTimer() {
    if (ybAutoAdvanceTimer) clearInterval(ybAutoAdvanceTimer);
    if (!ybAutoAdvanceEnabled || !ybPhaseStartedAt || ybPhase === 'waiting') return;

    const checkAdvance = async () => {
        if (!ybAutoAdvanceEnabled || !ybPhaseStartedAt) {
            if (ybAutoAdvanceTimer) clearInterval(ybAutoAdvanceTimer);
            ybAutoAdvanceTimer = null;
            return;
        }
        const elapsed = Date.now() - ybPhaseStartedAt;
        const duration = ybPhase === 'guessing' ? ybGuessingDurationMs : ybRevealDurationMs;

        if (elapsed >= duration) {
            if (ybAutoAdvanceTimer) clearInterval(ybAutoAdvanceTimer);
            ybAutoAdvanceTimer = null;

            if (ybPhase === 'guessing') {
                await ybReveal();
            } else if (ybPhase === 'reveal') {
                const hasNext = ybTeacherQueue.length > 0 && ybQueuePosition < ybTeacherQueue.length - 1;
                if (hasNext) {
                    await ybNextTeacher();
                }
            }
        }
    };

    ybAutoAdvanceTimer = setInterval(checkAdvance, 100);
    checkAdvance();
}

window.submitYearbookVote = async function(teacherIdx) {
    if (!currentUser) return showToast("Not authenticated.");
    if (ybPhase !== 'guessing') return showToast("Voting is not open.");
    if (ybMyVote !== null) return showToast("You already voted!");
    if (ybRoundId === null) return showToast("No active round.");

    // Disable all buttons immediately
    document.querySelectorAll('.yb-option-btn').forEach(b => b.disabled = true);

    try {
        const { error } = await supabaseC
            .from('yearbook_votes')
            .insert({ user_id: currentUser.id, round_id: ybRoundId, teacher_index: teacherIdx });
        if (error) throw error;

        ybMyVote = teacherIdx;
        renderYBOptions();
        showToast("Vote submitted!");
    } catch (e) {
        console.error("Yearbook vote error:", e);
        showToast("Error submitting vote.");
        document.querySelectorAll('.yb-option-btn').forEach(b => b.disabled = false);
    }
}

// ==========================================
// 11. Wall — Yearbook Display
// ==========================================

let ybWallScoresChannel = null;

async function initWallYearbook() {
    const fullPage = document.getElementById('full-page');
    if (fullPage) fullPage.style.display = 'flex';
    await updateWallYearbookUI();
}

async function updateWallYearbookUI() {
    const badge = document.getElementById('yb-wall-badge');
    if (!badge) return;

    ['yb-wall-waiting', 'yb-wall-guessing', 'yb-wall-reveal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    if (ybPhase === 'waiting') {
        badge.textContent = 'Waiting for round to start...';
        badge.className = 'status-badge status-locked';
        const el = document.getElementById('yb-wall-waiting');
        if (el) el.style.display = 'block';
        if (ybWallScoresChannel) { ybWallScoresChannel.unsubscribe(); ybWallScoresChannel = null; }

    } else if (ybPhase === 'guessing') {
        badge.textContent = 'Round is live!';
        badge.className = 'status-badge status-open';
        const el = document.getElementById('yb-wall-guessing');
        if (el) el.style.display = 'block';
        renderWallYBOptions();
        await updateWallYBVoteCounts();
        setupWallYBVotesRealtime();

    } else if (ybPhase === 'reveal') {
        badge.textContent = 'Reveal!';
        badge.className = 'status-badge status-open';
        const el = document.getElementById('yb-wall-reveal');
        if (el) el.style.display = 'block';
        renderWallYBReveal();
        await loadYBLeaderboard();
        setupWallYBScoresRealtime();
    }
}

function renderWallYBOptions() {
    if (!YEARBOOK_TEACHERS || !ybOptionIndices.length) return;
    const img = document.getElementById('yb-wall-throwback');
    if (img && ybTeacherIndex !== null) {
        const _t2 = YEARBOOK_TEACHERS[ybTeacherIndex];
        img.src = `../media/teachers/throwbacks/${ybTeacherIndex}.${_t2?.throwbackExt || _t2?.ext || 'jpg'}`;
    }
    const grid = document.getElementById('yb-wall-options');
    if (!grid) return;
    grid.innerHTML = '';
    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444'];
    ybOptionIndices.forEach((teacherIdx, i) => {
        const teacher = YEARBOOK_TEACHERS[teacherIdx];
        if (!teacher) return;
        const div = document.createElement('div');
        div.className = 'yb-wall-option';
        div.style.borderColor = colors[i];
        div.innerHTML = `<span>${teacher.name}</span><span class="yb-wall-count" id="yb-wall-count-${teacherIdx}">0</span>`;
        grid.appendChild(div);
    });
}

async function updateWallYBVoteCounts() {
    if (ybRoundId === null || !ybOptionIndices.length) return;
    const snap = await db.doc(COUNTER_DOCS.yearbook).get();
    const data = snap.data() || {};
    const counts = data.round_id === ybRoundId ? (data.counts || {}) : {};
    ybOptionIndices.forEach(idx => {
        const el = document.getElementById(`yb-wall-count-${idx}`);
        if (el) el.textContent = counts[idx] || 0;
    });
}

function setupWallYBVotesRealtime() {
    subscribeToDoc(COUNTER_DOCS.yearbook, () => {
        updateWallYBVoteCounts();
    });
}

function renderWallYBReveal() {
    if (!YEARBOOK_TEACHERS || ybTeacherIndex === null) return;
    const teacher = YEARBOOK_TEACHERS[ybTeacherIndex];
    const throwbackImg = document.getElementById('yb-wall-reveal-throwback');
    const currentImg = document.getElementById('yb-wall-reveal-current');
    const nameEl = document.getElementById('yb-wall-reveal-name');
    if (throwbackImg) throwbackImg.src = `../media/teachers/throwbacks/${ybTeacherIndex}.${teacher?.throwbackExt || teacher?.ext || 'jpg'}`;
    if (currentImg) currentImg.src = `../media/teachers/current/${ybTeacherIndex}.${teacher?.currentExt || teacher?.ext || 'jpg'}`;
    if (nameEl) nameEl.textContent = teacher?.name || '';
}

function setupWallYBScoresRealtime() {
    if (ybWallScoresChannel) return;
    ybWallScoresChannel = {
        unsubscribe: subscribeToDoc(LEADERBOARD_DOCS.yearbook, () => {
            loadYBLeaderboard();
        })
    };
}

async function loadYBLeaderboard() {
    const tables = ['yb-wall-leaderboard', 'yb-wall-done-leaderboard']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    if (!tables.length) return;

    const snap = await db.doc(LEADERBOARD_DOCS.yearbook).get();
    const scores = snap.data()?.top || [];

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const html = scores?.length
        ? scores.map((row, i) => `
            <tr>
                <td style="padding: 0.75rem; font-size: 1.5rem;">${medals[i] || (i + 1) + '.'}</td>
                <td style="padding: 0.75rem; text-align: left;">${row.display_name || 'Anonymous'}</td>
                <td style="padding: 0.75rem; font-weight: bold; color: var(--primary);">${row.score}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="3" style="color:var(--text-muted);text-align:center;padding:1rem;">No scores yet.</td></tr>';

    tables.forEach(t => t.innerHTML = html);
}
// ==========================================
// 12. Wally
// ==========================================

async function fetchWallyConfig() {
    const { data } = await supabaseC
        .from('wally_config')
        .select('*')
        .eq('id', 'main')
        .single();
    if (data) {
        wallyIsActive = data.is_active || false;
        wallySceneId = data.scene_id || null;
        wallyRoundId = data.round_id || null;
        wallyStartedAt = data.started_at || null;
    }
}

async function initWally() {
    await fetchWallyConfig();

    // Check if player already found Wally this round (page refresh mid-round)
    if (wallyIsActive && wallyRoundId && currentUser) {
        const { data: existing } = await supabaseC
            .from('wally_scores')
            .select('time_ms, rank')
            .eq('user_id', currentUser.id)
            .eq('round_id', wallyRoundId)
            .maybeSingle();
        if (existing) {
            wallyFoundTime = existing.time_ms;
            wallyMyRank = existing.rank ?? null;
            wallyTopScores = await loadWallyLeaderboard(3);
        }
    }

    setupWallyRealtime();
    wallySetupZoomPan();
    updateWallyUI();
}

function updateWallyUI() {
    const fullPage = document.getElementById('full-page');
    if (!fullPage) return;
    fullPage.style.display = 'flex';

    const waitingEl = document.getElementById('wally-waiting');
    const activeEl = document.getElementById('wally-active');
    const foundEl = document.getElementById('wally-found');
    const endedEl = document.getElementById('wally-ended');
    const badge = document.getElementById('wally-status-badge');

    if (waitingEl) waitingEl.style.display = 'none';
    if (activeEl) activeEl.style.display = 'none';
    if (foundEl) foundEl.style.display = 'none';
    if (endedEl) endedEl.style.display = 'none';

    if (wallyFoundTime !== null) {
        // Found state
        if (foundEl) foundEl.style.display = 'block';
        if (badge) { badge.className = 'status-badge status-open'; badge.textContent = 'Found!'; }

        const timeEl = document.getElementById('wally-your-time');
        const rankEl = document.getElementById('wally-your-rank');
        const top3El = document.getElementById('wally-top3');

        if (timeEl) timeEl.textContent = `Your time: ${(wallyFoundTime / 1000).toFixed(3)}s`;

        if (rankEl) {
            if (wallyMyRank !== null) {
                const suffix = wallyMyRank === 1 ? 'st' : wallyMyRank === 2 ? 'nd' : wallyMyRank === 3 ? 'rd' : 'th';
                rankEl.textContent = `You placed ${wallyMyRank}${suffix}!`;
            } else {
                rankEl.textContent = 'Submitting...';
            }
        }

        if (top3El) {
            if (wallyTopScores) {
                const medals = ['🥇', '🥈', '🥉'];
                top3El.innerHTML = wallyTopScores.length
                    ? `<table class="yb-leaderboard" style="max-width: 360px; margin: 1rem auto;">
                        <tbody>
                            ${wallyTopScores.map((row, i) => `
                                <tr>
                                    <td style="font-size: 1.4rem; padding: 0.6rem;">${medals[i] || (i + 1) + '.'}</td>
                                    <td style="text-align: left; padding: 0.6rem;">${row.display_name || 'Anonymous'}</td>
                                    <td style="font-weight: bold; color: var(--primary); padding: 0.6rem; font-variant-numeric: tabular-nums;">${(row.time_ms / 1000).toFixed(3)}s</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>`
                    : '<p style="color: var(--text-muted);">No scores yet.</p>';
            } else {
                top3El.textContent = '';
            }
        }

    } else if (wallyRoundEnded) {
        // Round ended while player was still hunting
        if (endedEl) endedEl.style.display = 'block';
        if (badge) { badge.className = 'status-badge status-locked'; badge.textContent = 'Round Over'; }
        const endedScoresEl = document.getElementById('wally-ended-scores');
        if (endedScoresEl && wallyTopScores) {
            endedScoresEl.innerHTML = renderLeaderboardTable(wallyTopScores, null, r => (r.time_ms / 1000).toFixed(3) + 's');
        }

    } else if (wallyIsActive) {
        // Hunting state
        if (activeEl) activeEl.style.display = 'flex';
        if (badge) { badge.className = 'status-badge status-open'; badge.textContent = 'Active'; }

        const img = document.getElementById('wally-img');
        const scene = typeof WALLY_SCENES !== 'undefined' ? WALLY_SCENES.find(s => s.id === wallySceneId) : null;
        if (img && scene) {
            const fullUrl = window.location.origin + scene.image;
            if (img.src !== fullUrl) {
                const loadingEl = document.getElementById('wally-loading');
                if (loadingEl) loadingEl.style.display = 'flex';
                wallyScale = 0.1;
                wallyTranslateX = 0;
                wallyTranslateY = 0;
                wallyApplyTransform();

                img.onload = () => {
                    const vp = document.getElementById('wally-image-viewport');
                    if (vp && img.naturalWidth && vp.clientWidth > 0 && vp.clientHeight > 0) {
                        wallyMinScale = Math.min(vp.clientWidth / img.naturalWidth, vp.clientHeight / img.naturalHeight);
                        wallyScale = wallyMinScale;
                        wallyTranslateX = 0;
                        wallyTranslateY = 0;
                        wallyClampTranslate();
                        wallyApplyTransform();
                    }
                    if (loadingEl) loadingEl.style.display = 'none';
                    wallyImageLoadTime = Date.now();
                    startWallyStopwatch();
                };
                img.onerror = () => {
                    if (loadingEl) loadingEl.textContent = 'Failed to load scene image.';
                };
                img.src = scene.image;
            }
        }

    } else {
        // Waiting state
        if (waitingEl) waitingEl.style.display = 'block';
        if (badge) { badge.className = 'status-badge status-locked'; badge.textContent = 'Waiting'; }
        stopWallyStopwatch();
    }
}

function setupWallyRealtime() {
    subscribeToDoc(CONFIG_DOCS.wally_config, (payload) => {
        if (!payload.new) return;
        const prevRoundId = wallyRoundId;
        const prevActive = wallyIsActive;

        wallyIsActive = payload.new.is_active || false;
        wallySceneId = payload.new.scene_id || null;
        wallyRoundId = payload.new.round_id || null;
        wallyStartedAt = payload.new.started_at || null;

        if (wallyRoundId !== prevRoundId) {
            wallyFoundTime = null;
            wallyMyRank = null;
            wallyTopScores = null;
            wallyRoundEnded = false;
            wallyImageLoadTime = null;
            wallyModalShown = false;
        }

        if (!wallyIsActive && prevActive) {
            if (wallyFoundTime === null) {
                wallyRoundEnded = true;
                stopWallyStopwatch();
                loadWallyLeaderboard(5).then(scores => {
                    wallyTopScores = scores;
                    updateWallyUI();
                });
            } else if (wallyMyRank !== null && wallyMyRank <= 3 && !wallyModalShown) {
                wallyModalShown = true;
                showRankModal('wally-rank-modal', wallyMyRank);
            }
        }

        if (wallyRoundId === null) {
            wallyFoundTime = null;
            wallyMyRank = null;
            wallyTopScores = null;
            wallyRoundEnded = false;
        }

        updateWallyUI();
        if (typeof updateWallyAdminUI === 'function') updateWallyAdminUI();

        if (document.getElementById('wally-wall-leaderboard')) {
            loadWallyLeaderboard(5).then(scores => {
                wallyTopScores = scores;
                updateWallWallyUI();
            });
        }
    });

}

function startWallyStopwatch() {
    if (wallyRaf) return;
    function tick() {
        if (!wallyImageLoadTime) { wallyRaf = null; return; }
        const elapsed = Date.now() - wallyImageLoadTime;
        const el = document.getElementById('wally-stopwatch');
        if (el) el.textContent = (elapsed / 1000).toFixed(2) + 's';
        wallyRaf = requestAnimationFrame(tick);
    }
    wallyRaf = requestAnimationFrame(tick);
}

function stopWallyStopwatch() {
    if (wallyRaf) {
        cancelAnimationFrame(wallyRaf);
        wallyRaf = null;
    }
}

function wallyApplyTransform() {
    const wrapper = document.getElementById('wally-image-wrapper');
    if (wrapper) {
        wrapper.style.transform = `scale(${wallyScale}) translate(${wallyTranslateX}px, ${wallyTranslateY}px)`;
    }
}

function wallyClampTranslate() {
    const img = document.getElementById('wally-img');
    const vp = document.getElementById('wally-image-viewport');
    if (!img?.naturalWidth || !vp) return;

    const minTx = vp.clientWidth / wallyScale - img.naturalWidth;
    wallyTranslateX = minTx >= 0
        ? minTx / 2
        : Math.max(minTx, Math.min(0, wallyTranslateX));

    const minTy = vp.clientHeight / wallyScale - img.naturalHeight;
    wallyTranslateY = minTy >= 0
        ? minTy / 2
        : Math.max(minTy, Math.min(0, wallyTranslateY));
}

function wallySetupZoomPan() {
    if (wallyZoomPanSetup) return;
    const vp = document.getElementById('wally-image-viewport');
    if (!vp) { console.log('[Wally] wallySetupZoomPan: viewport element not found!'); return; }
    wallyZoomPanSetup = true;
    console.log('[Wally] zoom/pan listeners attached');

    let lastPinchDist = 0;
    let lastPanX = 0, lastPanY = 0;
    let tapStartX = 0, tapStartY = 0, tapStartTime = 0;
    let isPinching = false;

    function getTouchDist(t1, t2) {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    vp.addEventListener('touchstart', e => {
        e.preventDefault();
        if (e.touches.length >= 2) {
            isPinching = true;
            lastPinchDist = getTouchDist(e.touches[0], e.touches[1]);
        } else {
            isPinching = false;
            lastPanX = e.touches[0].clientX;
            lastPanY = e.touches[0].clientY;
            tapStartX = lastPanX;
            tapStartY = lastPanY;
            tapStartTime = Date.now();
        }
    }, { passive: false });

    vp.addEventListener('touchmove', e => {
        e.preventDefault();
        if (e.touches.length >= 2) {
            isPinching = true;
            const newDist = getTouchDist(e.touches[0], e.touches[1]);
            if (!newDist) return;
            const scaleFactor = newDist / lastPinchDist;
            const newScale = Math.max(wallyMinScale, Math.min(WALLY_MAX_SCALE, wallyScale * scaleFactor));

            const rect = vp.getBoundingClientRect();
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

            // Keep pinch midpoint stationary in image space
            const imgMidX = midX / wallyScale - wallyTranslateX;
            const imgMidY = midY / wallyScale - wallyTranslateY;
            wallyTranslateX = midX / newScale - imgMidX;
            wallyTranslateY = midY / newScale - imgMidY;
            wallyScale = newScale;

            wallyClampTranslate();
            wallyApplyTransform();
            lastPinchDist = newDist;
        } else if (e.touches.length === 1 && !isPinching) {
            const dx = e.touches[0].clientX - lastPanX;
            const dy = e.touches[0].clientY - lastPanY;
            wallyTranslateX += dx / wallyScale;
            wallyTranslateY += dy / wallyScale;
            wallyClampTranslate();
            wallyApplyTransform();
            lastPanX = e.touches[0].clientX;
            lastPanY = e.touches[0].clientY;
        }
    }, { passive: false });

    vp.addEventListener('touchend', e => {
        e.preventDefault();
        if (e.touches.length === 1) {
            // Went from 2 to 1 touch — reset pan reference
            lastPanX = e.touches[0].clientX;
            lastPanY = e.touches[0].clientY;
            isPinching = false;
        } else if (e.touches.length === 0) {
            if (!isPinching) {
                const dx = Math.abs(e.changedTouches[0].clientX - tapStartX);
                const dy = Math.abs(e.changedTouches[0].clientY - tapStartY);
                const dt = Date.now() - tapStartTime;
                console.log('[Wally] touchend — dx:', dx.toFixed(1), 'dy:', dy.toFixed(1), 'dt:', dt + 'ms', isPinching ? '(pinch)' : '');
                if (dx < 10 && dy < 10 && dt < 300) {
                    wallyHandleTap(e.changedTouches[0]);
                }
            }
            isPinching = false;
        }
    }, { passive: false });

    // Desktop: scroll wheel to zoom
    vp.addEventListener('wheel', e => {
        e.preventDefault();
        const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(wallyMinScale, Math.min(WALLY_MAX_SCALE, wallyScale * scaleFactor));
        const rect = vp.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const imgMx = mx / wallyScale - wallyTranslateX;
        const imgMy = my / wallyScale - wallyTranslateY;
        wallyTranslateX = mx / newScale - imgMx;
        wallyTranslateY = my / newScale - imgMy;
        wallyScale = newScale;
        wallyClampTranslate();
        wallyApplyTransform();
    }, { passive: false });

    // Desktop: click to test hit detection (touch events suppress this on mobile)
    vp.addEventListener('click', e => {
        if (wallyFoundTime !== null || !wallyIsActive) {
            console.log('[Wally] Click ignored — active:', wallyIsActive, 'alreadyFound:', wallyFoundTime !== null);
            return;
        }
        const img = document.getElementById('wally-img');
        if (!img?.naturalWidth) {
            console.log('[Wally] Click ignored — image not loaded (naturalWidth=0)');
            return;
        }
        const rect = vp.getBoundingClientRect();
        const imgPixelX = (e.clientX - rect.left) / wallyScale - wallyTranslateX;
        const imgPixelY = (e.clientY - rect.top) / wallyScale - wallyTranslateY;
        const xPct = (imgPixelX / img.naturalWidth) * 100;
        const yPct = (imgPixelY / img.naturalHeight) * 100;
        console.log('[Wally] Click at:', xPct.toFixed(2) + '%', yPct.toFixed(2) + '%');
        wallyCheckHit(xPct, yPct);
    });
}

function wallyHandleTap(touch) {
    if (wallyFoundTime !== null || !wallyIsActive) {
        console.log('[Wally] Tap ignored — active:', wallyIsActive, 'alreadyFound:', wallyFoundTime !== null);
        return;
    }
    const img = document.getElementById('wally-img');
    if (!img?.naturalWidth) {
        console.log('[Wally] Tap ignored — image not loaded (naturalWidth=0)');
        return;
    }

    const vp = document.getElementById('wally-image-viewport');
    const rect = vp.getBoundingClientRect();
    const imgPixelX = (touch.clientX - rect.left) / wallyScale - wallyTranslateX;
    const imgPixelY = (touch.clientY - rect.top) / wallyScale - wallyTranslateY;

    const tapXPct = (imgPixelX / img.naturalWidth) * 100;
    const tapYPct = (imgPixelY / img.naturalHeight) * 100;

    console.log('[Wally] Tap at:', tapXPct.toFixed(2) + '%', tapYPct.toFixed(2) + '%');

    wallyCheckHit(tapXPct, tapYPct);
}

function wallyCheckHit(tapXPct, tapYPct) {
    const scene = typeof WALLY_SCENES !== 'undefined' ? WALLY_SCENES.find(s => s.id === wallySceneId) : null;
    if (!scene) return;
    const { x, y, radius } = scene.hitbox;
    const dist = Math.sqrt((tapXPct - x) ** 2 + (tapYPct - y) ** 2);
    if (dist <= radius) {
        const timeMs = Date.now() - wallyImageLoadTime;
        wallySubmitScore(timeMs);
    }
}

async function wallySubmitScore(timeMs) {
    if (!currentUser || !wallyRoundId) return;
    if (wallyFoundTime !== null) return;
    wallyFoundTime = timeMs;
    stopWallyStopwatch();
    updateWallyUI(); // show "Submitting..." while rank loads

    try {
        const { error } = await supabaseC
            .from('wally_scores')
            .insert({
                user_id: currentUser.id,
                round_id: wallyRoundId,
                time_ms: timeMs,
                display_name: displayName
            });
        if (error) throw error;

        // Rank is stamped asynchronously by the Cloud Function — subscribe and
        // self-cancel once it arrives rather than querying too early.
        const scoreDocPath = `wally_scores/${currentUser.id}_${wallyRoundId}`;
        const unsubRank = subscribeToDoc(scoreDocPath, async (payload) => {
            if (payload.new?.rank != null) {
                unsubRank();
                wallyMyRank = payload.new.rank;
                wallyTopScores = await loadWallyLeaderboard(3);
                updateWallyUI();
            }
        });
    } catch (e) {
        console.error('[Wally] Submit error:', e);
        showToast('Error submitting your time.');
        wallyFoundTime = null;
        startWallyStopwatch();
        updateWallyUI();
    }
}

async function loadWallyLeaderboard(limit) {
    if (!wallyRoundId) return [];
    const snap = await db.doc(LEADERBOARD_DOCS.wally).get();
    const data = snap.data() || {};
    if (data.round_id !== wallyRoundId) return [];
    return (data.top || []).slice(0, limit || 5);
}

// Wall page
async function initWallWally() {
    wallyTopScores = await loadWallyLeaderboard(5);
    setupWallWallyRealtime();
    updateWallWallyUI();
}

function updateWallWallyUI() {
    const fullPage = document.getElementById('full-page');
    if (fullPage) fullPage.style.display = 'flex';

    const badge = document.getElementById('wally-wall-badge');
    const inactiveEl = document.getElementById('wally-wall-inactive');
    const activeEl = document.getElementById('wally-wall-active');
    const lbEl = document.getElementById('wally-wall-leaderboard');

    if (badge) {
        badge.className = wallyIsActive ? 'status-badge status-open' : 'status-badge status-locked';
        badge.textContent = wallyIsActive ? 'Active' : 'Waiting';
    }
    if (inactiveEl) inactiveEl.style.display = wallyIsActive ? 'none' : 'block';
    if (activeEl) activeEl.style.display = wallyIsActive ? 'block' : 'none';

    if (lbEl) {
        const scores = wallyTopScores || [];
        const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
        lbEl.innerHTML = scores.length
            ? scores.map((row, i) => `
                <tr>
                    <td style="padding: 0.75rem; font-size: 1.5rem;">${medals[i]}</td>
                    <td style="padding: 0.75rem; text-align: left;">${row.display_name || 'Anonymous'}</td>
                    <td style="padding: 0.75rem; font-weight: bold; color: var(--primary); font-variant-numeric: tabular-nums;">${(row.time_ms / 1000).toFixed(3)}s</td>
                </tr>
            `).join('')
            : '<tr><td colspan="3" style="color: var(--text-muted); text-align: center; padding: 1rem;">No scores yet — go find Wally!</td></tr>';
    }
}

function setupWallWallyRealtime() {
    subscribeToDoc(LEADERBOARD_DOCS.wally, async () => {
        wallyTopScores = await loadWallyLeaderboard(5);
        updateWallWallyUI();
    });
}
