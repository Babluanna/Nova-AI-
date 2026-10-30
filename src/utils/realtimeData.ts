import type { LivePulseSnapshot, RealtimeSource } from '../types/nova.ts';

const FETCH_TIMEOUT_MS = 2800;
const PULSE_CACHE_TTL_MS = 90_000;

let cachedPulse: { data: LivePulseSnapshot; expiresAt: number } | null = null;

const STOP_PHRASES = [
  /^(what('s| is| are)|tell me|show me|give me|can you (tell|find|search|show)( me)?|search( for)?|find( out)?|look up)\s+/i,
  /^(the )?(latest|current|live|real[- ]?time|today'?s|breaking|recent)\s+(news|updates?|info|information|data|headlines?|events?)\s+(on|about|for|in|regarding)?\s*/i,
];

export interface RealtimeIntents {
  keywords: string;
  weatherCities: string[];
  wantsMarkets: boolean;
  wantsTech: boolean;
}

export function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .trim();
}

export function stripHtmlTags(input: string): string {
  return decodeXmlEntities(input.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSearchKeywords(rawQuery: string): string {
  const firstParagraph = rawQuery
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 240);

  let cleaned = firstParagraph;
  for (const pattern of STOP_PHRASES) {
    cleaned = cleaned.replace(pattern, '');
  }
  cleaned = cleaned.replace(/[?!.]+$/g, '').trim();

  if (cleaned.length < 2) {
    return firstParagraph.replace(/[?!.]+$/g, '').trim() || 'world news today';
  }
  return cleaned.slice(0, 120);
}

function cleanCandidateCity(raw: string): string | null {
  const trimmed = raw
    .replace(
      /\b(today|right now|now|currently|please|tomorrow|this week|weather|temperature|forecast|conditions?|bitcoin|btc|eth|ethereum|price|prices|stock|market|markets|keep|short|sentences?)\b[\s\S]*$/i,
      ''
    )
    .replace(/[?!.,;]+$/g, '')
    .trim();

  if (
    trimmed.length < 2 ||
    trimmed.length > 32 ||
    /^(the|current|live|local|my|today|major|global|cities)$/i.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

export function detectRealtimeIntents(rawQuery: string): RealtimeIntents {
  const normalized = rawQuery.trim();
  const lower = normalized.toLowerCase();
  const keywords = extractSearchKeywords(normalized);

  const weatherCities: string[] = [];
  const hasWeatherKeyword =
    /\b(weather|temperature|forecast|climate|humidity|rain|snow|wind)\b/i.test(normalized);

  if (hasWeatherKeyword) {
    const inListMatch = normalized.match(
      /\b(?:weather|temperature|forecast|climate|conditions?)(?:\s+\w+){0,2}\s+(?:in|for|at|around|across)\s+([a-zA-Z\u00C0-\u017F][a-zA-Z\u00C0-\u017F\s,]{1,64})/i
    );
    if (inListMatch?.[1]) {
      const parts = inListMatch[1].split(/,|\band\b|\bvs\.?\b/i);
      for (const part of parts) {
        const cleaned = cleanCandidateCity(part);
        if (cleaned && !weatherCities.includes(cleaned)) {
          weatherCities.push(cleaned);
        }
        if (weatherCities.length >= 3) break;
      }
    }

    if (weatherCities.length === 0) {
      const cityFirstMatch = normalized.match(
        /\b([a-zA-Z\u00C0-\u017F][a-zA-Z\u00C0-\u017F\s]{1,26}?)\s+(?:weather|temperature|forecast)\b/i
      );
      if (cityFirstMatch?.[1]) {
        const strippedPrefix = cityFirstMatch[1]
          .replace(/^(what is the|what's the|current|live|today's|todays|check|get)\s+/i, '')
          .trim();
        const cleaned = cleanCandidateCity(strippedPrefix);
        if (cleaned) weatherCities.push(cleaned);
      }
    }
  }

  const wantsMarkets =
    /\b(bitcoin|btc|ethereum|eth|solana|sol|crypto|cryptocurrency|price|market|markets|stock|stocks|nasdaq|s&p|dow|usd|eur|gbp|jpy|inr|cad|aud|exchange rate|forex|currency|gold|economy|finance)\b/i.test(
      lower
    );

  const wantsTech =
    /\b(ai|artificial intelligence|llm|openrouter|openai|gemini|anthropic|nvidia|gpu|apple|google|microsoft|startup|tech|technology|software|developer|programming|rust|typescript|python|cybersecurity|chip|semiconductor|hacker news)\b/i.test(
      lower
    );

  return {
    keywords,
    weatherCities,
    wantsMarkets,
    wantsTech,
  };
}

export function parseGoogleNewsRss(xml: string, limit = 5): RealtimeSource[] {
  const results: RealtimeSource[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && results.length < limit) {
    const block = match[1];
    const rawTitle = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
    const rawLink = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
    const rawPubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '';
    const rawSource = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || '';

    let title = decodeXmlEntities(rawTitle);
    const publisherFromTag = decodeXmlEntities(rawSource);
    let publisher = publisherFromTag || 'Google News';

    // Strip trailing " - Publisher" from Google News titles if redundant
    if (publisherFromTag && title.endsWith(` - ${publisherFromTag}`)) {
      title = title.slice(0, -(` - ${publisherFromTag}`.length)).trim();
    } else if (!publisherFromTag) {
      const dashIdx = title.lastIndexOf(' - ');
      if (dashIdx > 16) {
        publisher = title.slice(dashIdx + 3).trim();
        title = title.slice(0, dashIdx).trim();
      }
    }

    const url = decodeXmlEntities(rawLink);
    if (!title || !url.startsWith('http')) continue;

    let publishedAt: string | undefined;
    if (rawPubDate) {
      const parsedDate = new Date(decodeXmlEntities(rawPubDate));
      if (!Number.isNaN(parsedDate.getTime())) {
        publishedAt = formatRelativeAge(parsedDate.getTime());
      }
    }

    results.push({
      title,
      url,
      publisher,
      publishedAt,
    });
  }

  return results;
}

function formatRelativeAge(timestampMs: number, nowMs = Date.now()): string {
  const diffMin = Math.max(1, Math.round((nowMs - timestampMs) / 60_000));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.round(diffHr / 24);
  if (diffDays <= 7) return `${diffDays}d ago`;
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function describeWmoWeatherCode(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Light drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snowfall';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Variable conditions';
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': 'NovaAI-RealtimeGrounding/1.0',
        Accept: 'application/json, application/rss+xml, text/xml, */*',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGoogleNews(query: string, limit = 5): Promise<RealtimeSource[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) return [];
  const xml = await resp.text();
  return parseGoogleNewsRss(xml, limit);
}

interface WikiSnippet {
  title: string;
  snippet: string;
  url: string;
}

async function fetchWikipediaSnippets(query: string, limit = 3): Promise<WikiSnippet[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&utf8=&format=json&srlimit=${limit}`;
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) return [];
  const data = (await resp.json()) as {
    query?: {
      search?: Array<{ title?: string; snippet?: string }>;
    };
  };

  const items = data.query?.search || [];
  return items
    .filter((item) => Boolean(item.title))
    .map((item) => {
      const title = item.title!.trim();
      return {
        title,
        snippet: stripHtmlTags(item.snippet || ''),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
      };
    });
}

async function fetchHackerNewsStories(query: string, limit = 3): Promise<RealtimeSource[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encoded}&tags=story&hitsPerPage=${limit}`;
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) return [];
  const data = (await resp.json()) as {
    hits?: Array<{
      title?: string;
      url?: string;
      objectID?: string;
      created_at?: string;
    }>;
  };

  const results: RealtimeSource[] = [];
  for (const hit of data.hits || []) {
    if (!hit.title) continue;
    const storyUrl =
      hit.url && hit.url.startsWith('http')
        ? hit.url
        : `https://news.ycombinator.com/item?id=${hit.objectID || ''}`;
    let publishedAt: string | undefined;
    if (hit.created_at) {
      const ts = new Date(hit.created_at).getTime();
      if (!Number.isNaN(ts)) publishedAt = formatRelativeAge(ts);
    }
    results.push({
      title: hit.title.trim(),
      url: storyUrl,
      publisher: 'Hacker News',
      publishedAt,
    });
  }
  return results;
}

interface WeatherReading {
  locationLabel: string;
  tempC: number;
  tempF: number;
  feelsLikeC: number;
  humidity: number;
  windKmh: number;
  condition: string;
  sourceUrl: string;
}

async function fetchLiveWeather(city: string): Promise<WeatherReading | null> {
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const geoResp = await fetchWithTimeout(geoUrl, 3600);
  if (!geoResp.ok) return null;
  const geoJson = (await geoResp.json()) as {
    results?: Array<{
      name?: string;
      admin1?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
    }>;
  };

  const place = geoJson.results?.[0];
  if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') {
    return null;
  }

  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`;
  const wxResp = await fetchWithTimeout(forecastUrl, 3600);
  if (!wxResp.ok) return null;
  const wxJson = (await wxResp.json()) as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      relative_humidity_2m?: number;
      wind_speed_10m?: number;
      weather_code?: number;
    };
  };

  const cur = wxJson.current;
  if (!cur || typeof cur.temperature_2m !== 'number') return null;

  const tempC = Math.round(cur.temperature_2m * 10) / 10;
  const tempF = Math.round(((tempC * 9) / 5 + 32) * 10) / 10;
  const feelsLikeC =
    typeof cur.apparent_temperature === 'number'
      ? Math.round(cur.apparent_temperature * 10) / 10
      : tempC;

  const parts = [place.name, place.admin1, place.country].filter(Boolean);
  return {
    locationLabel: parts.join(', '),
    tempC,
    tempF,
    feelsLikeC,
    humidity: cur.relative_humidity_2m ?? 0,
    windKmh: cur.wind_speed_10m ?? 0,
    condition: describeWmoWeatherCode(cur.weather_code ?? 0),
    sourceUrl: 'https://open-meteo.com/',
  };
}

async function fetchSpotPriceUsd(pair: string): Promise<string | null> {
  const resp = await fetchWithTimeout(`https://api.coinbase.com/v2/prices/${pair}/spot`, 2000);
  if (!resp.ok) return null;
  const json = (await resp.json()) as { data?: { amount?: string } };
  const amount = Number(json.data?.amount);
  if (!Number.isFinite(amount)) return null;
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  });
}

async function fetchMarketSnapshot(): Promise<{
  btcUsd: string | null;
  ethUsd: string | null;
  solUsd: string | null;
  fxSummary: string | null;
}> {
  const [btcRes, ethRes, solRes, fxRes] = await Promise.allSettled([
    fetchSpotPriceUsd('BTC-USD'),
    fetchSpotPriceUsd('ETH-USD'),
    fetchSpotPriceUsd('SOL-USD'),
    (async () => {
      const r = await fetchWithTimeout(
        'https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,INR,CAD',
        2200
      );
      if (!r.ok) return null;
      const j = (await r.json()) as { rates?: Record<string, number>; date?: string };
      if (!j.rates) return null;
      const pairs = Object.entries(j.rates)
        .map(([sym, val]) => `1 USD = ${val} ${sym}`)
        .join(', ');
      return pairs ? `${pairs} (ECB ref ${j.date || 'latest'})` : null;
    })(),
  ]);

  return {
    btcUsd: btcRes.status === 'fulfilled' ? btcRes.value : null,
    ethUsd: ethRes.status === 'fulfilled' ? ethRes.value : null,
    solUsd: solRes.status === 'fulfilled' ? solRes.value : null,
    fxSummary: fxRes.status === 'fulfilled' ? fxRes.value : null,
  };
}

export async function gatherRealtimeContext(userQuery: string): Promise<{
  contextBlock: string;
  sources: RealtimeSource[];
  fetchedAtIso: string;
}> {
  const now = new Date();
  const fetchedAtIso = now.toISOString();
  const humanUtc = now.toUTCString();
  const intents = detectRealtimeIntents(userQuery);

  const [newsSettled, wikiSettled, hnSettled, weatherSettled, marketsSettled] =
    await Promise.allSettled([
      fetchGoogleNews(intents.keywords, 5),
      fetchWikipediaSnippets(intents.keywords, 3),
      intents.wantsTech ? fetchHackerNewsStories(intents.keywords, 3) : Promise.resolve([]),
      intents.weatherCities.length > 0
        ? Promise.all(intents.weatherCities.slice(0, 3).map((c) => fetchLiveWeather(c)))
        : Promise.resolve([]),
      intents.wantsMarkets ? fetchMarketSnapshot() : Promise.resolve(null),
    ]);

  const newsItems = newsSettled.status === 'fulfilled' ? newsSettled.value : [];
  const wikiItems = wikiSettled.status === 'fulfilled' ? wikiSettled.value : [];
  const hnItems = hnSettled.status === 'fulfilled' ? hnSettled.value : [];
  const weatherReadings =
    weatherSettled.status === 'fulfilled'
      ? weatherSettled.value.filter((w): w is WeatherReading => w !== null)
      : [];
  const markets = marketsSettled.status === 'fulfilled' ? marketsSettled.value : null;

  const lines: string[] = [
    `[REAL-TIME LIVE DATA GROUNDING — Retrieved ${humanUtc}]`,
    `Current UTC Date & Time: ${humanUtc} (${fetchedAtIso})`,
  ];

  const collectedSources: RealtimeSource[] = [];

  if (weatherReadings.length > 0) {
    lines.push('\nLive Weather Readings (Open-Meteo):');
    for (const weather of weatherReadings) {
      lines.push(
        `- ${weather.locationLabel}: ${weather.tempC}°C (${weather.tempF}°F), feels like ${weather.feelsLikeC}°C · ${weather.condition} · Humidity ${weather.humidity}% · Wind ${weather.windKmh} km/h.`
      );
    }
    collectedSources.push({
      title: `Live Weather (${weatherReadings.map((w) => w.locationLabel.split(',')[0]).join(', ')})`,
      url: 'https://open-meteo.com/',
      publisher: 'Open-Meteo Live',
      publishedAt: 'Now',
    });
  }

  if (markets && (markets.btcUsd || markets.ethUsd || markets.solUsd || markets.fxSummary)) {
    const cryptoParts = [
      markets.btcUsd ? `BTC: ${markets.btcUsd}` : null,
      markets.ethUsd ? `ETH: ${markets.ethUsd}` : null,
      markets.solUsd ? `SOL: ${markets.solUsd}` : null,
    ].filter(Boolean);

    if (cryptoParts.length > 0) {
      lines.push(`\nLive Crypto Spot Prices (Coinbase): ${cryptoParts.join(' · ')}`);
      collectedSources.push({
        title: `Spot Crypto (${cryptoParts.join(' · ')})`,
        url: 'https://www.coinbase.com/explore',
        publisher: 'Coinbase Spot',
        publishedAt: 'Live',
      });
    }
    if (markets.fxSummary) {
      lines.push(`Live Foreign Exchange Rates: ${markets.fxSummary}`);
    }
  }

  if (newsItems.length > 0) {
    lines.push('\nLatest Live News Headlines:');
    newsItems.forEach((item, idx) => {
      const age = item.publishedAt ? ` (${item.publishedAt})` : '';
      lines.push(`${idx + 1}. "${item.title}" — ${item.publisher}${age}`);
      collectedSources.push(item);
    });
  }

  if (hnItems.length > 0) {
    lines.push('\nLive Tech & Developer Discussions (Hacker News):');
    hnItems.forEach((item, idx) => {
      const age = item.publishedAt ? ` (${item.publishedAt})` : '';
      lines.push(`${idx + 1}. "${item.title}"${age}`);
      collectedSources.push(item);
    });
  }

  if (wikiItems.length > 0) {
    lines.push('\nReference Context (Wikipedia):');
    wikiItems.forEach((w) => {
      lines.push(`- ${w.title}: ${w.snippet}`);
      if (collectedSources.length < 5) {
        collectedSources.push({
          title: w.title,
          url: w.url,
          publisher: 'Wikipedia',
        });
      }
    });
  }

  lines.push(
    '\nInstructions for using Real-Time Data: Ground your response in the live facts, timestamps, prices, weather readings, and headlines above whenever the user asks about current events, today, recent news, live prices, weather, or up-to-date facts. Mention source publishers naturally in prose when citing news. If the user asks a timeless coding, math, or creative writing question unrelated to the retrieved headlines, answer directly without forcing unrelated headlines.'
  );

  // Deduplicate sources by URL and cap at 5 clean citations
  const seenUrls = new Set<string>();
  const uniqueSources: RealtimeSource[] = [];
  for (const src of collectedSources) {
    if (!src.url || seenUrls.has(src.url)) continue;
    seenUrls.add(src.url);
    uniqueSources.push(src);
    if (uniqueSources.length >= 5) break;
  }

  return {
    contextBlock: lines.join('\n'),
    sources: uniqueSources,
    fetchedAtIso,
  };
}

export async function fetchLivePulseSnapshot(forceRefresh = false): Promise<LivePulseSnapshot> {
  const now = Date.now();
  if (!forceRefresh && cachedPulse && now < cachedPulse.expiresAt) {
    return cachedPulse.data;
  }

  const [headlinesRes, btcRes, ethRes] = await Promise.allSettled([
    fetchGoogleNews('world technology science finance', 4),
    fetchSpotPriceUsd('BTC-USD'),
    fetchSpotPriceUsd('ETH-USD'),
  ]);

  const snapshot: LivePulseSnapshot = {
    updatedAtIso: new Date(now).toISOString(),
    btcUsd: btcRes.status === 'fulfilled' ? btcRes.value || undefined : undefined,
    ethUsd: ethRes.status === 'fulfilled' ? ethRes.value || undefined : undefined,
    headlines: headlinesRes.status === 'fulfilled' ? headlinesRes.value.slice(0, 3) : [],
  };

  cachedPulse = {
    data: snapshot,
    expiresAt: now + PULSE_CACHE_TTL_MS,
  };

  return snapshot;
}
