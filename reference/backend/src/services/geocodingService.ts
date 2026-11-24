import { randomUUID } from 'node:crypto'

import { env } from '../config/env'
import { logger } from '../utils/logger'

/**
 * Geocoding (address <-> coordinates).
 *
 * All map/geocoding traffic goes through this module so the provider can be
 * swapped without touching callers. Google is the default provider:
 *
 * - Places API (New) Text Search powers pickup search, including landmarks.
 * - Geocoding API handles reverse lookup for map pins and GPS fixes.
 *
 * Google failures fail closed: no fallback provider is queried and no location
 * is invented. Mapbox remains an explicit optional provider; Nominatim is a
 * development fallback, and `none` disables lookups entirely.
 */

export interface GeocodeResult {
  latitude: number
  longitude: number
  address: string
  placeName: string | null
  /** Extra geographic context (state, city, area) for suggestion rows. */
  detail?: string | null
  provider: string
}

export interface GeocodeSearchOptions {
  /** Real user location used only to bias results — never stored as a pickup. */
  latitude?: number
  longitude?: number
}

export interface GeocodingProvider {
  readonly name: string
  reverse(latitude: number, longitude: number): Promise<GeocodeResult | null>
  search(query: string, limit: number, options?: GeocodeSearchOptions): Promise<GeocodeResult[]>
}

const TIMEOUT_MS = 5000
const MAPBOX_TYPES = 'address,postcode,locality,neighborhood,place,district,region'
const SEARCHBOX_TYPES = 'address,poi,place,locality,neighborhood,street'
const GEOCODE_V6_TYPES = 'address,street,place,locality,neighborhood,district,region'

async function requestJson(url: string, init: RequestInit = {}): Promise<any | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Geocoding request failed')
      return null
    }
    return await res.json()
  } catch (err) {
    logger.warn({ err }, 'Geocoding request failed')
    return null
  }
}

function getJson(url: string, headers: Record<string, string> = {}): Promise<any | null> {
  return requestJson(url, { headers })
}

function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any | null> {
  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function hasValidProximity(options?: GeocodeSearchOptions): options is GeocodeSearchOptions & {
  latitude: number
  longitude: number
} {
  if (!options) return false
  const lat = Number(options.latitude)
  const lng = Number(options.longitude)
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

function proximityValue(options?: GeocodeSearchOptions): string | null {
  return hasValidProximity(options) ? `${options.longitude},${options.latitude}` : null
}

/** Shared search-text guard: no semicolons, max 20 words and 256 characters. */
function safeSearchQuery(query: string): string {
  return query
    .replace(/;/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 20)
    .join(' ')
    .slice(0, 256)
}

function validCoordinates(longitude: unknown, latitude: unknown): { latitude: number; longitude: number } | null {
  const lng = Number(longitude)
  const lat = Number(latitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { latitude: lat, longitude: lng }
}

function resultKey(result: GeocodeResult): string {
  return `${result.latitude.toFixed(5)},${result.longitude.toFixed(5)}`
}

function appendUnique(target: GeocodeResult[], incoming: GeocodeResult[], limit: number): void {
  const seen = new Set(target.map(resultKey))
  for (const result of incoming) {
    if (target.length >= limit) return
    const key = resultKey(result)
    if (seen.has(key)) continue
    seen.add(key)
    target.push(result)
  }
}

/** Structured `properties.context` used by Search Box and Geocoding v6. */
function contextTextV6(properties: any): string | null {
  const placeFormatted = nonEmptyText(properties?.place_formatted)
  const context = properties?.context
  if (!context || typeof context !== 'object') return placeFormatted

  const keys = ['neighborhood', 'locality', 'place', 'district', 'region', 'street', 'postcode']
  const parts = keys
    .map((key) => nonEmptyText(context[key]?.name))
    .filter((text: string | null): text is string => text !== null)
  const unique = Array.from(new Set(parts))
  return unique.length > 0 ? unique.join(', ') : placeFormatted
}

/** GeoJSON feature from Search Box `/retrieve` or Geocoding v6. */
function toV6Result(feature: any): GeocodeResult | null {
  const properties = feature?.properties ?? {}
  const coordinates = Array.isArray(feature?.geometry?.coordinates)
    ? feature.geometry.coordinates
    : null
  const point = validCoordinates(
    coordinates ? coordinates[0] : properties?.coordinates?.longitude,
    coordinates ? coordinates[1] : properties?.coordinates?.latitude
  )
  if (!point) return null

  const name =
    nonEmptyText(properties.name_preferred) ??
    nonEmptyText(properties.name) ??
    nonEmptyText(properties.address)
  const fullAddress = nonEmptyText(properties.full_address)
  const combined = [name, nonEmptyText(properties.place_formatted)].filter(Boolean).join(', ')
  const address = fullAddress ?? combined ?? null
  if (!address) return null

  return {
    latitude: point.latitude,
    longitude: point.longitude,
    address,
    placeName: name ?? fullAddress ?? null,
    detail: contextTextV6(properties),
    provider: 'mapbox'
  }
}

/** Nigeria-wide bias used when the requester has no usable prior location. */
const NIGERIA_BIAS = {
  rectangle: {
    low: { latitude: 4, longitude: 2.6 },
    high: { latitude: 14, longitude: 14.7 }
  }
}

const GOOGLE_DETAIL_COMPONENT_TYPES = new Set([
  'neighborhood',
  'sublocality',
  'locality',
  'administrative_area_level_2',
  'administrative_area_level_1'
])

function googleDetailFromComponents(components: unknown): string | null {
  if (!Array.isArray(components)) return null
  const parts = components
    .filter((component: any) =>
      Array.isArray(component?.types) &&
      component.types.some((type: unknown) => GOOGLE_DETAIL_COMPONENT_TYPES.has(String(type)))
    )
    .map((component: any) => nonEmptyText(component?.long_name))
    .filter((text: string | null): text is string => text !== null)
  return Array.from(new Set(parts)).join(', ') || null
}

/**
 * Google Places (New) Text Search + Google Geocoding API.
 *
 * Text Search returns name, address and coordinates in one response, so the
 * mobile picker can move the pin when a suggestion is tapped. Field masks keep
 * the billed payload limited to the data MediMove actually displays. Failures
 * return `[]`/`null`; no Mapbox or Nominatim fallback is queried.
 */
export function createGoogleProvider(apiKey: string): GeocodingProvider {
  const placesUrl = 'https://places.googleapis.com/v1/places:searchText'
  const geocodeUrl = 'https://maps.googleapis.com/maps/api/geocode/json'
  const placesHeaders = {
    'X-Goog-Api-Key': apiKey,
    'X-Goog-FieldMask': [
      'places.displayName',
      'places.formattedAddress',
      'places.shortFormattedAddress',
      'places.location'
    ].join(',')
  }

  const toSearchResult = (place: any): GeocodeResult | null => {
    const point = validCoordinates(place?.location?.longitude, place?.location?.latitude)
    if (!point) return null

    const name = nonEmptyText(place?.displayName?.text)
    const formatted = nonEmptyText(place?.formattedAddress)
    const short = nonEmptyText(place?.shortFormattedAddress)
    const address = formatted ?? short ?? name
    if (!address) return null

    const detail = short && short !== address && short !== name ? short : null
    return { ...point, address, placeName: name, detail, provider: 'google' }
  }

  return {
    name: 'google',
    async reverse(latitude, longitude) {
      const params = new URLSearchParams({
        latlng: `${latitude},${longitude}`,
        language: 'en',
        region: 'ng',
        key: apiKey
      })
      const data = await getJson(`${geocodeUrl}?${params.toString()}`)
      if (data?.status !== 'OK' || !Array.isArray(data.results)) return null

      const result = data.results.find((row: any) =>
        validCoordinates(row?.geometry?.location?.lng, row?.geometry?.location?.lat)
      )
      if (!result) return null

      const point = validCoordinates(result.geometry.location.lng, result.geometry.location.lat)!
      const address = nonEmptyText(result.formatted_address)
      if (!address) return null

      return {
        ...point,
        address,
        placeName: null,
        detail: googleDetailFromComponents(result.address_components),
        provider: 'google'
      }
    },
    async search(query, limit, options) {
      const safeQuery = safeSearchQuery(query)
      if (!safeQuery) return []

      const body: Record<string, unknown> = {
        textQuery: safeQuery,
        languageCode: 'en',
        regionCode: 'NG',
        pageSize: Math.min(Math.max(limit, 1), 10),
        locationBias: hasValidProximity(options)
          ? {
              circle: {
                center: { latitude: options.latitude, longitude: options.longitude },
                radius: 50_000
              }
            }
          : NIGERIA_BIAS
      }

      const data = await postJson(placesUrl, body, placesHeaders)
      const places = Array.isArray(data?.places) ? (data.places as any[]) : []
      return places
        .map(toSearchResult)
        .filter((result: GeocodeResult | null): result is GeocodeResult => result !== null)
    }
  }
}

/** Mapbox Geocoding v5 — coverage fallback for thin Nigerian results. */
function createMapboxV5Provider(token: string): GeocodingProvider {
  const base = 'https://api.mapbox.com/geocoding/v5/mapbox.places'

  const contextText = (feature: any): string | null => {
    const context = Array.isArray(feature?.context) ? feature.context : []
    const parts = context
      .filter((item: any) => !String(item?.id ?? '').startsWith('country.'))
      .map((item: any) => nonEmptyText(item?.text))
      .filter((text: string | null): text is string => text !== null)

    const unique = Array.from(new Set(parts))
    return unique.length > 0 ? unique.join(', ') : null
  }

  const placeLabel = (feature: any): string | null => {
    const name = nonEmptyText(feature?.properties?.name)
    if (name) return name

    const text = nonEmptyText(feature?.text)
    const houseNumber = nonEmptyText(feature?.address ?? feature?.properties?.address)
    const primaryType = Array.isArray(feature?.place_type) ? String(feature.place_type[0]) : null
    if (primaryType === 'address' && houseNumber && text) return `${houseNumber} ${text}`
    if (primaryType === 'address' && houseNumber) return houseNumber
    return text
  }

  const toResult = (feature: any): GeocodeResult | null => {
    const center = feature?.center
    if (!Array.isArray(center) || center.length < 2) return null

    const point = validCoordinates(center[0], center[1])
    if (!point) return null

    const placeName = placeLabel(feature)
    const detail = contextText(feature)
    const fullName = nonEmptyText(feature?.place_name) ?? nonEmptyText(feature?.matching_place_name)
    const address = fullName ?? [placeName, detail].filter(Boolean).join(', ')
    if (!address) return null

    return { ...point, address, placeName, detail, provider: 'mapbox' }
  }

  return {
    name: 'mapbox',
    async reverse(latitude, longitude) {
      const params = new URLSearchParams({
        access_token: token,
        limit: '1',
        language: 'en',
        country: 'ng'
      })
      const data = await getJson(`${base}/${longitude},${latitude}.json?${params.toString()}`)
      const feature = Array.isArray(data?.features)
        ? data.features.find((row: any) => Array.isArray(row?.center)) ?? data.features[0]
        : null
      return feature ? toResult(feature) : null
    },
    async search(query, limit, options) {
      const safeQuery = safeSearchQuery(query)
      if (!safeQuery) return []

      const params = new URLSearchParams({
        access_token: token,
        limit: String(limit),
        country: 'ng',
        language: 'en',
        autocomplete: 'true',
        fuzzyMatch: 'true',
        types: MAPBOX_TYPES
      })

      const proximity = proximityValue(options)
      if (proximity) params.set('proximity', proximity)

      const data = await getJson(`${base}/${encodeURIComponent(safeQuery)}.json?${params.toString()}`)
      if (!Array.isArray(data?.features)) return []
      return data.features
        .map(toResult)
        .filter((result: GeocodeResult | null): result is GeocodeResult => result !== null)
    }
  }
}

/** Mapbox Geocoding v6 — address lookup and reverse geocoding. */
function createMapboxV6Provider(token: string): GeocodingProvider {
  const base = 'https://api.mapbox.com/search/geocode/v6'
  const auth = { access_token: token }

  return {
    name: 'mapbox',
    async reverse(latitude, longitude) {
      const params = new URLSearchParams({
        ...auth,
        latitude: String(latitude),
        longitude: String(longitude),
        country: 'ng',
        language: 'en',
        limit: '1'
      })
      const data = await getJson(`${base}/reverse?${params.toString()}`)
      if (!Array.isArray(data?.features)) return null
      return data.features.map(toV6Result).find((row: GeocodeResult | null) => row !== null) ?? null
    },
    async search(query, limit, options) {
      const safeQuery = safeSearchQuery(query)
      if (!safeQuery) return []

      const params = new URLSearchParams({
        ...auth,
        q: safeQuery,
        limit: String(limit),
        country: 'ng',
        language: 'en',
        autocomplete: 'true',
        types: GEOCODE_V6_TYPES
      })

      const proximity = proximityValue(options)
      if (proximity) params.set('proximity', proximity)

      const data = await getJson(`${base}/forward?${params.toString()}`)
      if (!Array.isArray(data?.features)) return []
      return data.features
        .map(toV6Result)
        .filter((result: GeocodeResult | null): result is GeocodeResult => result !== null)
    }
  }
}

/**
 * Search Box autocomplete. `/suggest` omits coordinates, so each selected
 * suggestion is resolved through `/retrieve` with the same session token.
 */
function searchBoxSearcher(
  token: string
): (query: string, limit: number, options?: GeocodeSearchOptions) => Promise<GeocodeResult[]> {
  const base = 'https://api.mapbox.com/search/searchbox/v1'

  return async (query, limit, options) => {
    const safeQuery = safeSearchQuery(query)
    if (!safeQuery) return []

    const sessionToken = randomUUID()
    const suggestParams = new URLSearchParams({
      access_token: token,
      session_token: sessionToken,
      q: safeQuery,
      limit: String(limit),
      country: 'ng',
      language: 'en',
      types: SEARCHBOX_TYPES
    })

    const proximity = proximityValue(options)
    if (proximity) suggestParams.set('proximity', proximity)

    const suggestData = await getJson(`${base}/suggest?${suggestParams.toString()}`)
    const suggestions = Array.isArray(suggestData?.suggestions) ? suggestData.suggestions : []
    const ids = suggestions
      .map((row: any) => nonEmptyText(row?.mapbox_id))
      .filter((id: string | null): id is string => id !== null)
      .slice(0, limit)
    if (ids.length === 0) return []

    const retrieved = await Promise.all(
      ids.map(async (id: string) => {
        const params = new URLSearchParams({
          access_token: token,
          session_token: sessionToken,
          language: 'en'
        })
        const data = await getJson(`${base}/retrieve/${encodeURIComponent(id)}?${params.toString()}`)
        const feature = Array.isArray(data?.features) ? data.features[0] : null
        return feature ? toV6Result(feature) : null
      })
    )

    return retrieved.filter((result: GeocodeResult | null): result is GeocodeResult => result !== null)
  }
}

/**
 * Public Mapbox provider used by the API.
 *
 * Search Box leads autocomplete; v6 fills address gaps and handles reverse;
 * v5 returns only when Nigerian coverage is too thin to be useful. The provider
 * name stays `mapbox` so existing API responses do not change shape.
 */
export function createMapboxProvider(token: string): GeocodingProvider {
  const v5 = createMapboxV5Provider(token)
  const v6 = createMapboxV6Provider(token)
  const searchBox = searchBoxSearcher(token)

  return {
    name: 'mapbox',
    async reverse(latitude, longitude) {
      return (await v6.reverse(latitude, longitude)) ?? v5.reverse(latitude, longitude)
    },
    async search(query, limit, options) {
      const safeQuery = safeSearchQuery(query)
      if (!safeQuery) return []

      const results: GeocodeResult[] = []
      appendUnique(results, await searchBox(safeQuery, limit, options), limit)

      // v6 has no POI data but often has stronger address coverage in Nigeria.
      if (results.length < limit) {
        appendUnique(results, await v6.search(safeQuery, limit, options), limit)
      }

      // Final fallback when both newer products return too few usable results.
      const minUseful = Math.min(limit, 3)
      if (results.length < minUseful) {
        appendUnique(results, await v5.search(safeQuery, limit, options), limit)
      }

      return results.slice(0, limit)
    }
  }
}

/** OpenStreetMap Nominatim — free fallback for development. */
function nominatimProvider(): GeocodingProvider {
  const headers = { 'User-Agent': 'MediMove-Nigeria-Dispatch/1.0' }

  return {
    name: 'nominatim',
    async reverse(latitude, longitude) {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
      const data = await getJson(url, headers)
      if (!data || !data.display_name) return null
      return {
        latitude: Number(data.lat ?? latitude),
        longitude: Number(data.lon ?? longitude),
        address: String(data.display_name),
        placeName: data.name ? String(data.name) : null,
        detail: null,
        provider: 'nominatim'
      }
    },
    async search(query, limit) {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}&countrycodes=ng`
      const data = await getJson(url, headers)
      if (!Array.isArray(data)) return []
      return data.map((row: any) => ({
        latitude: Number(row.lat),
        longitude: Number(row.lon),
        address: String(row.display_name ?? ''),
        placeName: row.name ? String(row.name) : null,
        detail: null,
        provider: 'nominatim'
      }))
    }
  }
}

/** No-op provider: geocoding disabled, callers fall back to user input. */
function nullProvider(): GeocodingProvider {
  return {
    name: 'none',
    async reverse() {
      return null
    },
    async search() {
      return []
    }
  }
}

function selectProvider(): GeocodingProvider {
  if (env.GEOCODING_PROVIDER === 'none') return nullProvider()
  if (env.GEOCODING_PROVIDER === 'google') {
    return createGoogleProvider(env.GOOGLE_MAPS_API_KEY as string)
  }
  if (env.GEOCODING_PROVIDER === 'nominatim') return nominatimProvider()
  // Mapbox is opt-in; without a token it degrades to Nominatim for local dev.
  if (env.MAPBOX_ACCESS_TOKEN) return createMapboxProvider(env.MAPBOX_ACCESS_TOKEN)
  return nominatimProvider()
}

const provider = selectProvider()

export const geocodingService = {
  providerName: provider.name,
  reverse(latitude: number, longitude: number): Promise<GeocodeResult | null> {
    return provider.reverse(latitude, longitude)
  },
  search(query: string, limit = 5, options?: GeocodeSearchOptions): Promise<GeocodeResult[]> {
    const trimmed = query.trim()
    if (trimmed.length < 3) return Promise.resolve([])
    return provider.search(trimmed, Math.min(Math.max(limit, 1), 10), options)
  }
}

export type GeocodingService = typeof geocodingService
