"""Google Places / Geocoding proxy — keeps the API key server-side.

The web settings UI needs address autocomplete + reverse geocoding to set
geofence sites. Nominatim (OSM) is free but sparse for MU/TZ business POIs
("Le Flamant", hotels, small shops — the things Google returns), so this
proxies Google's Places Text Search + Geocoding through the backend.

Requires GOOGLE_MAPS_API_KEY in backend/.env with BOTH of these enabled in
the GCP console (the key's project currently only has Maps JavaScript API):
  * Places API   → /search  (text search → formatted address + lat/lng)
  * Geocoding API → /reverse (latlng → formatted address)

Auth-gated (get_current_user) so the key is never reachable anonymously.
"""
import logging
import os

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional

from core.dependencies import get_current_user

router = APIRouter(prefix="/geocode", tags=["geocode"])

logger = logging.getLogger(__name__)

_PLACES_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"


class GeocodeHit(BaseModel):
    display_name: str
    latitude: float
    longitude: float


class GeocodeSearchResult(BaseModel):
    results: List[GeocodeHit]


class GeocodeReverseResult(BaseModel):
    display_name: Optional[str] = None


def _key() -> str:
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Google Maps API key not configured (GOOGLE_MAPS_API_KEY)")
    return key


@router.get("/search", response_model=GeocodeSearchResult)
async def geocode_search(
    q: str = Query(..., min_length=1, max_length=200),
    country: Optional[str] = Query(None, min_length=2, max_length=2),
    current_user=Depends(get_current_user),
):
    """Address autocomplete — Google Places Text Search.

    `country` (uppercase ISO code, e.g. 'MU') restricts results to that
    country so "Le Flamant" doesn't surface same-named French streets.
    """
    params: dict = {"query": q.strip(), "key": _key()}
    if country:
        params["components"] = f"country:{country.lower()}"
    try:
        resp = requests.get(_PLACES_URL, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("Google Places text search failed: %s", exc)
        raise HTTPException(status_code=502, detail="Geocoding service unavailable")
    if data.get("status") != "OK":
        logger.warning("Google Places text search rejected: %s %s", data.get("status"), data.get("error_message", ""))
        raise HTTPException(status_code=502, detail=data.get("error_message") or data.get("status"))
    hits: List[GeocodeHit] = []
    for res in data.get("results", []):
        loc = (res.get("geometry") or {}).get("location") or {}
        if res.get("formatted_address") and loc.get("lat") is not None and loc.get("lng") is not None:
            hits.append(GeocodeHit(display_name=res["formatted_address"], latitude=loc["lat"], longitude=loc["lng"]))
    return GeocodeSearchResult(results=hits)


@router.get("/reverse", response_model=GeocodeReverseResult)
async def geocode_reverse(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    current_user=Depends(get_current_user),
):
    """Reverse geocode a dropped pin / current location into a readable address."""
    params = {"latlng": f"{lat},{lng}", "language": "en", "key": _key()}
    try:
        resp = requests.get(_GEOCODE_URL, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("Google reverse geocode failed: %s", exc)
        raise HTTPException(status_code=502, detail="Geocoding service unavailable")
    if data.get("status") != "OK":
        logger.warning("Google reverse geocode rejected: %s %s", data.get("status"), data.get("error_message", ""))
        raise HTTPException(status_code=502, detail=data.get("error_message") or data.get("status"))
    results = data.get("results") or []
    return GeocodeReverseResult(display_name=results[0].get("formatted_address") if results else None)
