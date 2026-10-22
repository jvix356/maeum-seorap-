// Aggregate visits only: no diary content, IP, user-agent, or visitor identifiers stored.
const { redis, cors, send } = require('./_lib');
const dayKey = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const COUNT = `
local today = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 7776000)
local total = redis.call('INCR', KEYS[2])
redis.call('SET', KEYS[3], ARGV[1], 'NX')
return {today, total, redis.call('GET', KEYS[3])}
`;
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: '지원하지 않는 요청이에요.' });
  try {
    const day = dayKey();
    const keys = ['visits:day:' + day, 'visits:total', 'visits:started'];
    let values;
    if (req.method === 'POST') {
      if (!req.headers.origin || !['https://maeum-seorap.vercel.app', 'https://jvix356.github.io'].includes(req.headers.origin)) return send(res, 403, { error: '사이트에서 방문해 주세요.' });
      if (!req.body || req.body.visit !== true) return send(res, 400, { error: '잘못된 요청이에요.' });
      values = await redis('EVAL', COUNT, 3, ...keys, day);
    } else values = await redis('MGET', ...keys);
    return send(res, 200, { today: Number(values[0] || 0), total: Number(values[1] || 0), since: values[2] || null, day, unit: 'visits' });
  } catch (e) {
    return send(res, 503, { error: '지금은 방문 통계를 불러올 수 없어요.' });
  }
};
