# Smarter search: plan

_22 Oct 2026. Not built yet._

## The problem

Search passes your text straight to OneMap. OneMap is an **address** search: it ranks by how well
the words match, with no idea which places people actually go to. "clementi" matches hundreds
of addresses (Clementi Ave 1–6, Clementi Road, every HDB block), so **The Clementi Mall** only
surfaces once you type "mall" or "the". Nothing tells OneMap a mall matters more than block 321.

## The idea: Kayuh's own place index, ranked by popularity

Build a gazetteer of the ~15–20k places people ride to and from, give each a popularity score,
and search it in the app as you type. OneMap stays for what it's good at: postal codes and street
addresses.

### 1. Places (built by the pipeline, like the path network)

| Source | What |
|---|---|
| OpenStreetMap | Malls (`shop=mall`), MRT/LRT stations, parks, beaches, attractions, museums, viewpoints, sports centres, community clubs, libraries, schools, hospitals, notable buildings, plus their `alt_name`/`short_name`/`name:en` |
| data.gov.sg | Hawker centres (NEA), parks and nature areas (NParks), PCN loop names |
| LTA DataMall | Bus interchanges, MRT exits |
| Kayuh itself | HDB town names, PCN names from the path network |

### 2. Popularity: free, open signals only

| Signal | How | Good for |
|---|---|---|
| **Wikipedia page views** | OSM `wikidata`/`wikipedia` tags → Wikimedia pageviews API (free, monthly totals) | Malls, MRT stations, attractions, parks: anything people look up |
| **Wikidata notability** | Number of language editions (sitelinks) | A stable tie-breaker |
| **Category weight** | Hand-set: MRT, mall, park, hawker > school > office building > single address | Places without Wikipedia pages |
| **Footprint size** | Area of the OSM building or park polygon | Big malls over small shops |
| **Your crew's usage** (later) | How often places are searched, saved or ridden to by you and your friends | The best signal over time, personal to your group |
| _Optional:_ Overture Maps Places | Open dataset (from Meta, Microsoft and others) with a confidence score and categories | Cafés and shops OSM misses |

What I'd **not** use: Google Places "popular times" and ratings. The API is paid, its terms forbid
storing or re-ranking the data outside Google Maps, and scraping it would break those terms.

### 3. Matching that forgives how people type

- Normalise both sides: lower case; drop "the"; "&" → "and"; expand common abbreviations
  (Ave, St, Rd, Blk, CC = community club, PCN = park connector, Stn/MRT = station).
- **Prefix match on every word of the name**, so "clementi" finds *The Clementi Mall*,
  *Clementi MRT* and *Clementi Woods Park* straight away. "jem", "vivo" and "gbtb" work through
  short and alt names.
- Typo tolerance: one wrong letter in words of five or more letters ("macritchi", "punngol").
- **Score** = how well it matches (exact > starts with > word starts with > fuzzy)
  + log(popularity) + category weight + a little for being near you or the map
  + a boost for places you've used before.
- Group results with icons and short labels: _Mall · Clementi_, _MRT · EW23_, _Park connector_.

### 4. Where it runs

- In the app, inside the routing Web Worker: an index of ~20k places is about 1 MB gzipped,
  loads with the path network, and answers every keystroke in a few milliseconds, even offline.
- Six-digit postal codes and "Blk …" queries go to OneMap. For everything else, Kayuh's results
  come first and OneMap addresses are listed below.

### 5. How we'll know it's better

A "golden searches" test, like the golden routes: ~30 real queries with the place that must be
in the top 3. Examples: clementi → The Clementi Mall; jem; vivo → VivoCity; ecp → East Coast Park;
botanic → Singapore Botanic Gardens; macritchie → MacRitchie Reservoir; jewel → Jewel Changi;
changi village; tampines hub → Our Tampines Hub. Run against both the old and the new search.

### Effort

About a day:
- the pipeline step, including a one-off page-view fetch for ~3–5k places with Wikipedia links,
  cached and refreshed monthly
- the search index and ranking in the worker
- the golden tests
- the result UI
