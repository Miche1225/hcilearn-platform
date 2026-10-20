// src/middleware/rateLimit.js
//
// Small in-memory rate limiter (no extra packages).
// Counts requests per key inside a time window and answers 429 when the
// limit is reached. Counts reset when the server restarts, which is fine
// for a single Render instance.

const DEFAULT_MESSAGE = 'Too many attempts. Please wait a few minutes and try again.';

function rateLimit({ windowMs, max, keyFn, message }) {
    const hits = new Map(); // key -> { count, resetAt }

    // Forget expired entries so the map doesn't grow forever
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) {
            if (entry.resetAt <= now) hits.delete(key);
        }
    }, Math.min(windowMs, 60 * 1000)).unref();

    // Records one attempt for `key`. Returns { limited, retryAfter }.
    function hit(key) {
        const now = Date.now();
        let entry = hits.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }
        entry.count += 1;
        return {
            limited: entry.count > max,
            retryAfter: Math.ceil((entry.resetAt - now) / 1000),
        };
    }

    // Sends the standard "too many attempts" reply
    function reject(res, retryAfter) {
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({ error: message || DEFAULT_MESSAGE });
    }

    function middleware(req, res, next) {
        const { limited, retryAfter } = hit(keyFn ? keyFn(req) : req.ip);
        if (limited) return reject(res, retryAfter);
        next();
    }

    // Use as Express middleware, or call .hit()/.reject() inside a route
    middleware.hit = hit;
    middleware.reject = reject;
    return middleware;
}

module.exports = { rateLimit };
