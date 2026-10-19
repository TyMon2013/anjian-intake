const buckets = new Map();

export function rateLimit({ windowMs, max, message, keyPrefix = 'default' }) {
  return function limiter(req, res, next) {
    const now = Date.now();
    const key = `${keyPrefix}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: message || '请求过于频繁，请稍后再试',
        retryAfter,
      });
    }

    if (buckets.size > 5000) {
      for (const [bucketKey, item] of buckets) {
        if (item.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    return next();
  };
}
