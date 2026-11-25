import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createEmbedSnippet, isSiteIndexable, LEGACY_SITE_URL, OFFICIAL_SITE_URL, resolveSiteUrl } from '../lib/site';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import { isSameOriginMutation } from '../lib/platform/supabase-auth';
import {
  ensureOfficialWidgetScript,
  hasCompetingWidget,
  OFFICIAL_ELEVENLABS_AGENT_ID,
  OFFICIAL_WIDGET_HOST_ATTR,
  OFFICIAL_WIDGET_SCRIPT_ATTR,
  OFFICIAL_WIDGET_SCRIPT_SRC,
  patchCantoneseLanguageEntry,
  shouldRenderOfficialWidget,
} from '../components/voicepilot/MarketingVoiceEmbed';
import { VOICEPILOT_SCRIPT } from '../components/voicepilot/site-script';

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

test('official homepage widget renders only on root homepage and avoids legacy /orai-widget.js', () => {
  assert.equal(OFFICIAL_ELEVENLABS_AGENT_ID, 'agent_8201m7sbetj3e36s1a2nv3fgcqna');
  assert.equal(OFFICIAL_WIDGET_SCRIPT_SRC, 'https://unpkg.com/@elevenlabs/convai-widget-embed');
  assert.equal(shouldRenderOfficialWidget('/'), true);
  for (const path of ['/admin', '/dashboard', '/beauty', '/pricing', '/services', '/booking', '', null, undefined]) {
    assert.equal(shouldRenderOfficialWidget(path), false);
  }

  const embedSource = readFileSync('components/voicepilot/MarketingVoiceEmbed.tsx', 'utf8');
  assert.ok(!embedSource.includes('/orai-widget.js'));
  assert.ok(!embedSource.includes('override-language'));
  assert.ok(embedSource.includes('<elevenlabs-convai'));
  assert.ok(readFileSync('orai-widget.js', 'utf8').includes('elevenlabs-convai'));
  assert.ok(readFileSync('public/embed.js', 'utf8').includes('/api/client-config'));

  const minified = 'var Fy={en:{name:`English`,flagCode:`us`,languageCode:`en`},zh:{name:`中文`,flagCode:`cn`,languageCode:`zh`}};';
  const patched = patchCantoneseLanguageEntry(minified);
  assert.ok(patched.includes('yue:{name:"Cantonese",flagCode:"hk",languageCode:"yue"},en:{name:`English`'));
  assert.equal(patchCantoneseLanguageEntry(patched), patched);
});

test('official widget helpers prevent duplicate script injection and competing widget mounts', async () => {
  const appended: Array<Record<string, unknown>> = [];
  let fetchCalls = 0;
  const docStub = {
    body: {
      appendChild(node: Record<string, unknown>) {
        appended.push(node);
        return node;
      },
    },
    createElement(tag: string) {
      assert.equal(tag, 'script');
      const attrs: Record<string, string> = {};
      return {
        src: '',
        async: false,
        type: '',
        attrs,
        setAttribute(k: string, v: string) {
          attrs[k] = v;
        },
        addEventListener() {},
      };
    },
    querySelector(selector: string) {
      if (selector.includes(OFFICIAL_WIDGET_SCRIPT_SRC) || selector.includes(OFFICIAL_WIDGET_SCRIPT_ATTR)) {
        return appended.length > 0 ? appended[0] : null;
      }
      return null;
    },
  } as unknown as Document;

  const mockWin = {
    customElements: { get: () => undefined } as unknown as CustomElementRegistry,
    fetch: (async () => {
      fetchCalls += 1;
      return new Response('var Fy={en:{name:`English`,flagCode:`us`,languageCode:`en`}};', { status: 200 });
    }) as typeof fetch,
  };

  const [first, concurrent] = await Promise.all([
    ensureOfficialWidgetScript(docStub, mockWin),
    ensureOfficialWidgetScript(docStub, mockWin),
  ]);
  assert.ok(first);
  assert.equal(concurrent, first);
  assert.equal(fetchCalls, 1);
  assert.equal(appended.length, 1);
  assert.ok(String(appended[0].src).startsWith('blob:'));
  assert.equal(appended[0].async, true);
  assert.equal(appended[0].type, 'text/javascript');
  assert.equal((appended[0].attrs as Record<string, string>)[OFFICIAL_WIDGET_SCRIPT_ATTR], 'true');

  const second = await ensureOfficialWidgetScript(docStub, mockWin);
  assert.equal(second, first);
  assert.equal(appended.length, 1);

  const emptyDocWithDefinedElement = {
    body: {
      appendChild() {
        assert.fail('must not append duplicate script when custom element is already defined');
      },
    },
    createElement() {
      assert.fail('must not create duplicate script when custom element is already defined');
    },
    querySelector() {
      return null;
    },
  } as unknown as Document;
  const skipped = await ensureOfficialWidgetScript(emptyDocWithDefinedElement, {
    customElements: { get: (name: string) => (name === 'elevenlabs-convai' ? (class {} as CustomElementConstructor) : undefined) },
  } as Pick<Window, 'customElements' | 'fetch'>);
  assert.equal(skipped, null);

  const ownHost = { contains: (el: unknown) => el === ownWidget } as unknown as Element;
  const ownWidget = {} as Element;
  const foreignWidget = {} as Element;
  const otherHost = {} as Element;

  assert.equal(
    hasCompetingWidget(
      { querySelector: (sel: string) => (sel === 'elevenlabs-convai' ? ownWidget : ownHost) } as unknown as Document,
      ownHost,
    ),
    false,
  );
  assert.equal(
    hasCompetingWidget(
      { querySelector: (sel: string) => (sel === 'elevenlabs-convai' ? foreignWidget : null) } as unknown as Document,
      ownHost,
    ),
    true,
  );
  assert.equal(
    hasCompetingWidget(
      {
        querySelector: (sel: string) =>
          sel.includes(OFFICIAL_WIDGET_HOST_ATTR) ? otherHost : null,
      } as unknown as Document,
      ownHost,
    ),
    true,
  );
});

test('homepage navigation script still defines valid window.navigateToPage without /orai-widget.js', () => {
  assert.ok(VOICEPILOT_SCRIPT.includes('window.navigateToPage'));
  assert.doesNotThrow(() => new Function(VOICEPILOT_SCRIPT));
});
