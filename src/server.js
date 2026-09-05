require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb', type: 'text/*' }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests from this IP, please try again later." }
});
app.use('/v1/', limiter);

app.use(express.static(path.join(__dirname, '../public')));

app.use(require('./routes/messages'));
app.use(require('./routes/completions'));
app.use(require('./routes/models'));
app.use('/admin', require('./routes/admin'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

initDB();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Bedrock VPS Proxy listening on http://0.0.0.0:${PORT}`);
});
