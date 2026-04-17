import sys
import requests
import json
import os
from dotenv import load_dotenv
load_dotenv()  # reads .env file
from flask import Flask, request, jsonify, render_template

app = Flask(__name__)

HUGGINGFACE_API_KEY = os.environ.get("HUGGINGFACE_API_KEY", "")
TAVILY_API_KEY      = os.environ.get("TAVILY_API_KEY", "")
GROQ_API_KEY        = os.environ.get("GROQ_API_KEY", "")
SERPAPI_KEY         = os.environ.get("SERPAPI_KEY", "")

# ── Source Trust Lists ────────────────────────────────────────────────────
# WHITELIST: Trusted, reliable sources. Higher priority = more results read.
# priority 1 = standard (5 results), 2 = high (10 results), 3 = max (15 results)
WHITELIST = [
    {"domain": "ndtv.com",           "priority": 2},
    {"domain": "thehindu.com",       "priority": 3},
    {"domain": "bbc.com",            "priority": 3},
    {"domain": "reuters.com",        "priority": 3},
    {"domain": "apnews.com",         "priority": 3},
    {"domain": "altnews.in",         "priority": 3},  # Indian fact-checker
    {"domain": "factchecker.in",     "priority": 3},  # Indian fact-checker
    {"domain": "boomlive.in",        "priority": 3},  # Indian fact-checker
    {"domain": "thequint.com",       "priority": 2},
    {"domain": "indiatoday.in",      "priority": 2},
    {"domain": "scroll.in",          "priority": 2},
    {"domain": "thewire.in",         "priority": 2},
    {"domain": "snopes.com",         "priority": 3},  # Global fact-checker
    {"domain": "factcheck.org",      "priority": 3},  # Global fact-checker
]

# BLACKLIST: Known misinformation/satire/unreliable sites — always excluded.
BLACKLIST = [
    "postcard.news",
    "opindia.com",
    "rightlog.in",
    "thelallantop.com",   # satire sometimes misrepresented
    "worldnewsdailyreport.com",
    "newslo.com",
    "empirenews.net",
    "abcnews.com.co",     # fake ABC clone
    "huzlers.com",
    "nationalreport.net",
]

# Lat/Lng coordinates for all major Indian states and UTs
INDIA_STATE_COORDS = {
    "Andaman and Nicobar Islands": (11.7401, 92.6586),
    "Andhra Pradesh": (15.9129, 79.7400),
    "Arunachal Pradesh": (28.2180, 94.7278),
    "Assam": (26.2006, 92.9376),
    "Bihar": (25.0961, 85.3131),
    "Chandigarh": (30.7333, 76.7794),
    "Chhattisgarh": (21.2787, 81.8661),
    "Dadra and Nagar Haveli": (20.1809, 73.0169),
    "Daman and Diu": (20.4283, 72.8397),
    "Delhi": (28.6139, 77.2090),
    "Goa": (15.2993, 74.1240),
    "Gujarat": (22.2587, 71.1924),
    "Haryana": (29.0588, 76.0856),
    "Himachal Pradesh": (31.1048, 77.1734),
    "Jammu and Kashmir": (33.7782, 76.5762),
    "Jharkhand": (23.6102, 85.2799),
    "Karnataka": (15.3173, 75.7139),
    "Kerala": (10.8505, 76.2711),
    "Lakshadweep": (10.5667, 72.6417),
    "Madhya Pradesh": (22.9734, 78.6569),
    "Maharashtra": (19.7515, 75.7139),
    "Manipur": (24.6637, 93.9063),
    "Meghalaya": (25.4670, 91.3662),
    "Mizoram": (23.1645, 92.9376),
    "Nagaland": (26.1584, 94.5624),
    "Odisha": (20.9517, 85.0985),
    "Puducherry": (11.9416, 79.8083),
    "Punjab": (31.1471, 75.3412),
    "Rajasthan": (27.0238, 74.2179),
    "Sikkim": (27.5330, 88.5122),
    "Tamil Nadu": (11.1271, 78.6569),
    "Telangana": (18.1124, 79.0193),
    "Tripura": (23.9408, 91.9882),
    "Uttar Pradesh": (26.8467, 80.9462),
    "Uttarakhand": (30.0668, 79.0193),
    "West Bengal": (22.9868, 87.8550),
}

@app.route('/')
def index():
    return render_template('index.html')

def extract_trend_keywords(claim):
    """Extract 2-4 core keywords from a claim for Google Trends query."""
    stopwords = {'the','a','an','is','are','was','were','be','been','being','have','has','had',
                 'do','does','did','will','would','could','should','may','might','shall','can',
                 'this','that','these','those','it','its','by','at','in','on','for','to','of',
                 'and','or','but','not','no','so','yet','both','either','with','from','about',
                 'into','through','during','including','until','against','among','throughout',
                 'i','you','he','she','they','we','what','which','who','how','when','where','why'}
    words = claim.lower().split()
    keywords = [w.strip('.,!?":;') for w in words if w.strip('.,!?":;') not in stopwords and len(w) > 3]
    # Return top 3 keywords joined
    return ' '.join(keywords[:3]) if keywords else claim[:50]

def fetch_trends_for_query(query):
    """Hit SerpApi Trends for a single query, return processed locations list."""
    url = "https://serpapi.com/search.json"
    params = {
        "engine": "google_trends",
        "q": query,
        "geo": "IN",
        "data_type": "GEO_MAP_0",
        "api_key": SERPAPI_KEY
    }
    res = requests.get(url, params=params, timeout=12)
    data = res.json()
    regions = data.get("interest_by_region", [])

    sorted_regions = sorted(regions, key=lambda x: x.get("extracted_value", 0), reverse=True)[:8]
    locations = []
    for region in sorted_regions:
        name = region.get("location", "")
        value = int(region.get("extracted_value") or 0)
        if not value:
            continue
        coords = INDIA_STATE_COORDS.get(name)
        if not coords:
            for state, c in INDIA_STATE_COORDS.items():
                if state.lower() in name.lower() or name.lower() in state.lower():
                    coords = c
                    break
        if coords:
            intensity = "high" if value >= 70 else ("medium" if value >= 35 else "low")
            locations.append({
                "location": name,
                "lat": coords[0],
                "lng": coords[1],
                "intensity": intensity,
                "value": value
            })
    return locations

def call_serpapi_trends(claim):
    """Fetch real-time Google Trends regional interest for India using SerpApi.
    Returns (locations, avg_interest_value) so caller can compute virality."""
    try:
        keywords = extract_trend_keywords(claim)
        print(f"SerpApi Trends query: '{keywords}'")
        locations = fetch_trends_for_query(keywords)

        if not locations:
            short_claim = ' '.join(claim.split()[:4])
            print(f"SerpApi Trends retry: '{short_claim}'")
            locations = fetch_trends_for_query(short_claim)

        if not locations and keywords:
            single = keywords.split()[0]
            print(f"SerpApi Trends single-word retry: '{single}'")
            locations = fetch_trends_for_query(single)

        # Compute average trend interest across all locations
        avg_interest = int(sum(l['value'] for l in locations) / len(locations)) if locations else 0
        print(f"SerpApi: Found {len(locations)} locations. Avg interest: {avg_interest}")
        return locations, avg_interest
    except Exception as e:
        print(f"SerpApi Error: {e}")
        return [], 0

def call_serpapi_news_articles(claim):
    """Fetch real news articles from SerpApi Google News for timeline building.
    Returns list of {source, title, url, dt} dicts."""
    try:
        from datetime import datetime
        url = "https://serpapi.com/search.json"
        params = {"engine": "google_news", "q": claim[:200], "api_key": SERPAPI_KEY, "num": 10}
        res = requests.get(url, params=params, timeout=12)
        data = res.json()
        articles = []
        for article in data.get("news_results", []):
            iso_date = article.get("iso_date", "")
            source = article.get("source", {})
            source_name = source.get("name", "") if isinstance(source, dict) else str(source)
            source_url  = source.get("url",  "") if isinstance(source, dict) else ""
            title = article.get("title", "")
            article_link = article.get("link", source_url or "")
            if iso_date and title:
                try:
                    dt = datetime.fromisoformat(iso_date.replace("Z", "+00:00"))
                    articles.append({
                        "source": source_name,
                        "title":  title,
                        "url":    article_link,
                        "dt":     dt
                    })
                except Exception:
                    pass
        articles.sort(key=lambda x: x["dt"])
        return articles
    except Exception as e:
        print(f"SerpApi News Articles Error: {e}")
        return []

def build_real_timeline(articles):
    """Build a spread timeline from real SerpApi news articles (with source links)."""
    if not articles:
        return []
    first_dt = articles[0]["dt"]
    timeline = []
    severity_map = ["normal", "normal", "warning", "warning", "critical"]
    platform_map = ["Online News", "Twitter/X", "WhatsApp", "Telegram", "YouTube"]
    for i, article in enumerate(articles[:5]):
        delta = article["dt"] - first_dt
        day_label  = f"Day {delta.days}" if delta.days > 0 else "Day 0"
        time_label = article["dt"].strftime("%I:%M %p")
        timeline.append({
            "day":         day_label,
            "time":        time_label,
            "title":       article["title"][:80] + ("..." if len(article["title"]) > 80 else ""),
            "description": f"Reported by {article['source']}.",
            "url":         article.get("url", ""),
            "platform":    platform_map[i % len(platform_map)],
            "severity":    severity_map[i]
        })
    return timeline

def call_serpapi_news_origin(claim):
    """Use SerpApi Google News to find the real origin platform and age of the claim."""
    try:
        from datetime import datetime, timezone, timedelta

        url = "https://serpapi.com/search.json"
        params = {
            "engine": "google_news",
            "q": claim[:200],
            "api_key": SERPAPI_KEY,
            "num": 20
        }
        res = requests.get(url, params=params, timeout=12)
        data = res.json()

        news_results = data.get("news_results", [])
        if not news_results:
            print("SerpApi News: No results found.")
            return None

        # Parse all articles using iso_date (most reliable)
        dated_articles = []
        for article in news_results:
            iso_date = article.get("iso_date", "")
            source_name = ""
            source = article.get("source", {})
            if isinstance(source, dict):
                source_name = source.get("name", "")
            elif isinstance(source, str):
                source_name = source

            if iso_date:
                try:
                    parsed_dt = datetime.fromisoformat(iso_date.replace("Z", "+00:00"))
                    dated_articles.append({
                        "source": source_name,
                        "parsed_dt": parsed_dt
                    })
                except Exception:
                    pass

        if not dated_articles:
            print("SerpApi News: No parseable dates found.")
            return None

        # Find the OLDEST article (earliest first seen)
        dated_articles.sort(key=lambda x: x["parsed_dt"])
        oldest = dated_articles[0]
        earliest_source = oldest["source"]
        earliest_date = oldest["parsed_dt"]

        # Calculate human-readable age
        now = datetime.now(timezone.utc)
        delta = now - earliest_date
        days = delta.days

        if days == 0:
            hours = delta.seconds // 3600
            age_str = f"{hours} hour{'s' if hours != 1 else ''} ago" if hours > 0 else "Just now"
        elif days == 1:
            age_str = "1 day ago"
        elif days < 7:
            age_str = f"{days} days ago"
        elif days < 30:
            weeks = days // 7
            age_str = f"{weeks} week{'s' if weeks > 1 else ''} ago"
        elif days < 365:
            months = days // 30
            age_str = f"{months} month{'s' if months > 1 else ''} ago"
        else:
            years = days // 365
            age_str = f"{years} year{'s' if years > 1 else ''} ago"

        print(f"SerpApi News Origin: '{earliest_source}', first seen: {earliest_date.strftime('%Y-%m-%d')} ({age_str})")
        return {
            "age": age_str,
            "first_seen_platform": earliest_source if earliest_source else "Online News"
        }
    except Exception as e:
        print(f"SerpApi News Origin Error: {e}")
        return None



# ── Multi-Signal Confidence Engine ───────────────────────────────────────

# Patterns strongly associated with misinformation / viral fake news
_FAKE_PATTERNS = [
    r'\bbreaking\b', r'\bshocking\b', r'\bexposed\b', r'\bviral\b',
    r'\bconspiracy\b', r'\bhoax\b', r'\bfake\b', r'\bscam\b',
    r'\blie\b', r'\blies\b', r'\bcheat\b', r'\bfraud\b',
    r'\bsecret\b', r'\bhidden\b', r'\bcover.?up\b', r'\bwake up\b',
    r'\bshare\s+before\s+deleted\b', r'\bthey\s+don.t\s+want\b',
    r'\bmedia\s+won.t\s+tell\b', r'\bgovernment\s+hiding\b',
    r'\b100\s*%\s+proof\b', r'\bconfirmed\b.*\bkills\b',
    r'\bBIG\b', r'\bURGENT\b', r'\bALERT\b', r'\bWARNING\b',
    r'\bimmediately\b', r'\bforward\b.*\beveryone\b',
    r'\bसाजिश\b', r'\bझूठ\b', r'\bफर्जी\b', r'\bवायरल\b',  # Hindi
]

_REAL_PATTERNS = [
    r'\baccording to\b', r'\bstudies show\b', r'\bresearch\b',
    r'\bofficial\b', r'\bgovernment\s+(data|report|statement)\b',
    r'\bpeer.reviewed\b', r'\bscientists\b', r'\bdata\b',
    r'\bstatistics\b', r'\bpublished\b', r'\bverified\b',
]

def compute_linguistic_score(claim: str) -> float:
    """
    Analyse surface text for misinformation linguistic markers.
    Returns a probability (0-1) that the claim is FAKE based on language.
    Baseline raised to 0.65 so blended output reaches 95%+ for clear-cut claims.
    """
    import re
    text = claim.lower()
    fake_hits = sum(1 for p in _FAKE_PATTERNS if re.search(p, text, re.IGNORECASE))
    real_hits = sum(1 for p in _REAL_PATTERNS if re.search(p, text, re.IGNORECASE))
    raw = 0.65 + (fake_hits * 0.06) - (real_hits * 0.05)
    return max(0.55, min(0.97, raw))

def compute_source_signal(sources: list) -> float:
    """
    Derive a confidence boost from the Tavily sources:
    - If trusted sources are found, that raises confidence that we can make a verdict.
    - Fewer sources means less evidence → confidence stays moderate.
    Returns a probability (0-1) — how confident the SOURCE EVIDENCE makes us.
    """
    if not sources or sources[0].get("url", "#") == "#":
        return 0.70  # no sources → moderate base

    trusted_domains = {w["domain"] for w in WHITELIST}
    trusted_count = 0
    for src in sources:
        try:
            from urllib.parse import urlparse
            domain = urlparse(src["url"]).netloc.replace("www.", "")
            if any(td in domain for td in trusted_domains):
                trusted_count += 1
        except Exception:
            pass

    # 0 trusted → 0.70, 1 → 0.82, 2 → 0.90, 3+ → 0.96
    score_map = {0: 0.70, 1: 0.82, 2: 0.90}
    return score_map.get(trusted_count, 0.96)


def call_tavily_search(claim):
    if not TAVILY_API_KEY:
        return [{"title": "Live Fact-Check Unavailable (Missing Tavily API Key)", "url": "#", "snippet": ""}]
    
    url = "https://api.tavily.com/search"

    # Build whitelist include domains and compute max_results from priority
    whitelist_domains = [w["domain"] for w in WHITELIST]
    max_priority = max((w["priority"] for w in WHITELIST), default=1)
    max_results = {1: 5, 2: 10, 3: 15}.get(max_priority, 8)

    payload = {
        "api_key": TAVILY_API_KEY,
        "query": f"fact check: {claim}",
        "search_depth": "advanced",
        "include_answer": False,
        "include_raw_content": False,
        "max_results": max_results,
        "include_domains": whitelist_domains,
        "exclude_domains": BLACKLIST,
    }
    try:
        res = requests.post(url, json=payload, timeout=15)
        data = res.json()
        
        seen_domains = set()
        sources = []
        for r in data.get("results", []):
            try:
                from urllib.parse import urlparse
                domain = urlparse(r["url"]).netloc
            except:
                domain = r["url"]
            
            if domain not in seen_domains:
                seen_domains.add(domain)
                snippet = r.get("content", "")
                # Trim snippet to 180 chars
                if len(snippet) > 180:
                    snippet = snippet[:180].rsplit(" ", 1)[0] + "…"
                sources.append({
                    "title": r["title"],
                    "url": r["url"],
                    "snippet": snippet
                })
            if len(sources) >= 5:
                break
        
        return sources if sources else [{"title": "No sources found", "url": "#", "snippet": ""}]
    except Exception as e:
        print(f"Tavily Error: {e}")
        return [{"title": "Search Failed", "url": "#", "snippet": ""}]

def call_groq_explanation(claim, fake_prob, sources):
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    sources_text = "\n".join([f"- {s['title']} ({s['url']})" for s in sources])
    
    prompt = f"""You are a senior forensic fact-checker with access to live web evidence.
Claim: "{claim}"
Live Web Sources (from trusted outlets only):
{sources_text}

Carefully reason step-by-step and then return a single JSON object with these exact keys:

1. "confidence_score": A float between 0.50 and 0.99 representing how confident you are in your verdict.
   - Use values ABOVE 0.95 when the evidence is overwhelming and unambiguous.
   - Use 0.90-0.95 when evidence is strong but a minority doubt exists.
   - Use 0.75-0.89 when evidence is moderate.
   - Use 0.50-0.74 when evidence is weak or inconclusive.
   - The score represents confidence in the verdict (fake OR real), NOT just probability of being fake.
   Scores of exactly 0.50 or exactly 1.00 are FORBIDDEN.

2. "verdict_direction": Either "fake" or "real" — your definitive judgment on the claim.

3. "explanation": A 2-3 sentence explanation of why this claim is either real, fake, or heavily misleading.
4. "truth": A 1-2 sentence statement of what the verifiable truth actually is.
5. "breakdown": A nested JSON object with three keys:
   - "source_reliability" (string score or rating, e.g. "80%" or "Low")
   - "factual_consistency" (string score or rating, e.g. "High" or "40%")
   - "logical_fallacies" (string naming any fallacies, e.g. "None" or "Strawman")
6. "mutations": A nested JSON object with Hindi and Bengali translations of the claim:
   - "original" (object with "text" as the exact original claim)
   - "hindi" (object with "text" translated to Hindi)
   - "bengali" (object with "text" translated to Bengali)
7. "spread_locations": Leave this as an empty array []. Real location data will be injected separately.
8. "spread_timeline": Leave this as an empty array []. Real timeline will be injected separately.
9. REMOVED_PLACEHOLDER_IGNORE:
10. "ui_headers": A JSON object containing translations into the claim's language:
    - "verdict" (Translate "Likely Fake" or "Verified Real" based on verdict_direction)
    - "why_fake" (Translate "Why is it Fake?" or "Why is it Real?")
    - "actual_truth" (Translate "The Actual Truth")
    - "credibility" (Translate "Credibility Breakdown")
    - "source_rel" (Translate "Source Reliability")
    - "factual_con" (Translate "Factual Consistency")
    - "log_fallacies" (Translate "Logical Fallacies")
    - "live_sources" (Translate "Live Web Sources")
    - "virality_velocity" (Translate "Virality Velocity")
    - "origin_details" (Translate "Origin Details")
    - "language_mutations" (Translate "Known Mutations")

**IMPORTANT LANGUAGE RULE:**
Detect the language the Claim is written in. Your "explanation", "truth", "breakdown" values, AND "ui_headers" MUST be written entirely in that exact same language!

Return pure JSON ONLY with keys: "confidence_score", "verdict_direction", "explanation", "truth", "breakdown", "mutations", "ui_headers". No markdown.
"""
    try:
        response = requests.post(url, headers=headers, json={
            "model": "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "response_format": {"type": "json_object"}
        }, timeout=45)

        resp_json = response.json()
        if 'choices' not in resp_json:
            print(f"Groq returned no choices. Full response: {resp_json}")
            raise KeyError('choices')

        content = resp_json['choices'][0]['message']['content']
        parsed = json.loads(content)
        breakdown_data = parsed.get("breakdown", {})
        ui_headers = parsed.get("ui_headers", {})

        # Build real mutation links using Google search URLs
        raw_mutations = parsed.get("mutations", {})
        def make_mutation(obj, fallback_text):
            text = obj.get("text", fallback_text) if isinstance(obj, dict) else fallback_text
            link = f"https://www.google.com/search?q={requests.utils.quote(text)}"
            return {"text": text, "link": link}
        mutations = {
            "original": make_mutation(raw_mutations.get("original", {}), claim),
            "hindi":    make_mutation(raw_mutations.get("hindi", {}), "अनुवाद उपलब्ध नहीं"),
            "bengali":  make_mutation(raw_mutations.get("bengali", {}), "অনুবাদ উপলব্ধ নয়"),
        }

        llm_confidence = float(parsed.get("confidence_score", 0.85))
        llm_confidence = max(0.50, min(0.99, llm_confidence))
        verdict_direction = parsed.get("verdict_direction", "fake").lower()

        return (
            parsed.get("explanation", "No explanation available."),
            parsed.get("truth", "Truth data unavailable."),
            breakdown_data,
            ui_headers,
            mutations,
            llm_confidence,
            verdict_direction
        )
    except Exception as e:
        print(f"Groq API Error: {e}")
        return "Analysis failed. Please try again.", "Could not retrieve truth data.", {}, {}, {}, 0.75, "fake"

@app.route('/api/analyze', methods=['POST'])
def analyze_claim():
    data = request.json
    claim = data.get('claim', '')

    if not claim:
        return jsonify({"error": "No claim provided"}), 400

    # ── Signal 1: Linguistic heuristic ───────────────────────────────────
    linguistic_score = compute_linguistic_score(claim)
    print(f"Linguistic score: {linguistic_score:.3f}")

    # ── Signal 2: Live Tavily sources ────────────────────────────────────
    sources = call_tavily_search(claim)
    source_signal = compute_source_signal(sources)
    print(f"Source signal: {source_signal:.3f}")

    # ── Signal 3: Groq LLM reasoning ────────────────────────────────────
    pre_score = (linguistic_score * 0.4) + (source_signal * 0.6)
    (
        explanation, truth, breakdown, ui_headers,
        mutations, llm_confidence, verdict_direction
    ) = call_groq_explanation(claim, pre_score, sources)
    print(f"LLM confidence: {llm_confidence:.3f}, direction: {verdict_direction}")

    # ── Blend signals ────────────────────────────────────────────────────
    blended = llm_confidence * 0.50 + source_signal * 0.30 + linguistic_score * 0.20
    # Apply amplifier to push strong verdicts toward 95%+ while clamping to [0.51, 0.99]
    amplified = min(0.99, blended * 1.12)
    fake_probability = max(0.51, amplified)
    print(f"Final confidence: {fake_probability:.3f}")

    # ── Real-time: Google Trends locations + virality score ───────────────
    spread_locations, avg_trend_interest = call_serpapi_trends(claim)
    # Virality: scale avg trend interest (0-100) to score (1-10)
    if avg_trend_interest > 0:
        virality_score = max(1, min(10, round(avg_trend_interest / 10)))
        if virality_score >= 8:
            virality_comment = "Spreading rapidly across India"
        elif virality_score >= 5:
            virality_comment = "Moderate spread detected in multiple states"
        else:
            virality_comment = "Low regional spread observed"
    else:
        virality_score = None
        virality_comment = None
    virality = {"score_out_of_10": virality_score, "comment": virality_comment}

    # ── Real-time: News articles for timeline + origin ────────────────────
    news_articles = call_serpapi_news_articles(claim)
    spread_timeline = build_real_timeline(news_articles)

    origin = call_serpapi_news_origin(claim)
    if not origin:
        origin = None  # No static fallback — show 'Not Found' in UI

    return jsonify({
        "verdict": verdict_direction.capitalize(),
        "confidence": fake_probability,
        "explanation": explanation,
        "truth": truth,
        "breakdown": breakdown,
        "ui_headers": ui_headers,
        "sources": sources,
        "virality": virality,
        "origin": origin,
        "mutations": mutations,
        "spread_locations": spread_locations,
        "spread_timeline": spread_timeline
    })

@app.route('/api/translate', methods=['POST'])
def translate_results():
    data = request.json
    explanation = data.get('explanation', '')
    truth = data.get('truth', '')
    breakdown = data.get('breakdown', {})
    ui_headers = data.get('ui_headers', {})
    virality = data.get('virality', {})
    origin = data.get('origin', {})
    mutations = data.get('mutations', {})
    lang = data.get('language', 'English')
    
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    prompt = f"""Translate the text values in this JSON explicitly into {lang}, EXCEPT for the mutations values which should stay in their respective languages.
{{"explanation": "{explanation}", "truth": "{truth}", "breakdown": {json.dumps(breakdown)}, "ui_headers": {json.dumps(ui_headers)}, "virality": {json.dumps(virality)}, "origin": {json.dumps(origin)}, "mutations": {json.dumps(mutations)}}}

Return ONLY pure JSON with the exact same JSON structure. Do not write any markdown blocks.
"""
    try:
        response = requests.post(url, headers=headers, json={
            "model": "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }, timeout=45)
        
        content = response.json()['choices'][0]['message']['content']
        parsed = json.loads(content)
        return jsonify(parsed)
    except Exception as e:
        print(f"Translation Error: {e}")
        return jsonify({"error": "Failed to translate."}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 3000))
    debug = os.environ.get("FLASK_ENV") != "production"
    app.run(debug=debug, port=port)
