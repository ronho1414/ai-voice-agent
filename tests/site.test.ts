import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createEmbedSnippet, isSiteIndexable, LEGACY_SITE_URL, OFFICIAL_SITE_URL, resolveSiteUrl } from '../lib/site';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import { isSameOriginMutation } from '../lib/platform/supabase-auth';

const saved = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

test('public origin defaults to the official domain and accepts explicit isolated staging/local origins', () => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  assert.equal(resolveSiteUrl(), OFFICIAL_SITE_URL);
  for (const url of [LEGACY_SITE_URL, 'https://orai-pr4-staging.vercel.app', 'http://localhost:3010', 'http://127.0.0.1:3010']) {
    assert.equal(resolveSiteUrl(url + '/'), url);
  }
  for (const url of ['javascript:alert(1)', 'https://x.test/path', 'https://user:pw@x.test', 'https://x.test/?x=1', 'https://x.test/#part', 'http://x.test', '//x.test']) {
    assert.throws(() => resolveSiteUrl(url));
  }
});

test('indexing requires explicit approval on the official origin, never on staging/preview', () => {
  delete process.env.NEXT_PUBLIC_SITE_INDEXING;
  process.env.NEXT_PUBLIC_SITE_URL = OFFICIAL_SITE_URL;
  assert.equal(isSiteIndexable(), false);
  assert.deepEqual(robots(), { rules: { userAgent: '*', disallow: '/' } });
  assert.deepEqual(sitemap(), []);
  process.env.NEXT_PUBLIC_SITE_INDEXING = 'true';
  process.env.VERCEL_ENV = 'production';
  assert.equal(isSiteIndexable(), true);
  assert.deepEqual(sitemap().map(item => item.url), [OFFICIAL_SITE_URL + '/']);
  assert.equal(robots().sitemap, OFFICIAL_SITE_URL + '/sitemap.xml');
  process.env.NEXT_PUBLIC_SITE_URL = 'https://orai-pr4-staging.vercel.app';
  assert.equal(isSiteIndexable(), false);
  process.env.NEXT_PUBLIC_SITE_URL = OFFICIAL_SITE_URL;
  process.env.VERCEL_ENV = 'preview';
  assert.equal(isSiteIndexable(), false);
});

test('generated embeds use the configured site and encode the merchant slug as data', () => {
  process.env.NEXT_PUBLIC_SITE_URL = OFFICIAL_SITE_URL;
  assert.equal(createEmbedSnippet('merchant-a'), '<script src="https://oraiservice.com/embed.js?client=merchant-a" defer></script>');
  assert.ok(!createEmbedSnippet('\"><script>bad</script>').includes('<script>bad'));
  process.env.NEXT_PUBLIC_SITE_URL = 'https://orai-pr4-staging.vercel.app';
  assert.ok(createEmbedSnippet('merchant-a').startsWith('<script src="https://orai-pr4-staging.vercel.app/'));
});

test('existing embeds keep fetching from their own script origin, with no customer cookies', async () => {
  for (const origin of [OFFICIAL_SITE_URL, LEGACY_SITE_URL]) {
    let called = '';
    let credentials = '';
    runInNewContext(readFileSync('public/embed.js', 'utf8'), {
      URL, window: { location: { href: 'https://fictional-merchant.test/' } },
      document: { currentScript: { src: `${origin}/embed.js?client=merchant-a` }, addEventListener() {} },
      fetch: async (url: string, init: RequestInit) => {
        called = url; credentials = init.credentials!;
        return { ok: false };
      },
    });
    assert.equal(called, `${origin}/api/client-config?client=merchant-a`);
    assert.equal(credentials, 'omit');
  }
});

test('new and legacy domains retain strict same-origin mutation protection', () => {
  for (const origin of [OFFICIAL_SITE_URL, LEGACY_SITE_URL]) {
    const request = (source?: string, forwarded?: string) => new Request(origin + '/api/platform/auth/session', {
      method: 'POST', headers: { host: new URL(origin).host, ...(source ? { origin: source } : {}), ...(forwarded ? { 'x-forwarded-host': forwarded } : {}) },
    });
    assert.equal(isSameOriginMutation(request(origin)), true);
    assert.equal(isSameOriginMutation(request()), false);
    assert.equal(isSameOriginMutation(request('https://foreign.test', 'foreign.test')), false);
    assert.equal(isSameOriginMutation(request(origin === OFFICIAL_SITE_URL ? LEGACY_SITE_URL : OFFICIAL_SITE_URL)), false);
  }
});
