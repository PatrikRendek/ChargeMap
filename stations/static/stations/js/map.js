/**
 * @fileoverview Main JavaScript logic for the ChargeMap application.
 * Handles Leaflet map initialization, fetching charging stations from the
 * backend proxy (OpenChargeMap API), geocoding locations via Nominatim, 
 * autocomplete search suggestions, and routing via Leaflet Routing Machine.
 */

// 1. Initialize the map, centered on Slovakia by default
const map = L.map('map').setView([48.669, 19.699], 8);

// Attempt to globally locate user via an IP Geolocation API silently
fetch('https://get.geojs.io/v1/ip/geo.json')
    .then(response => response.json())
    .then(data => {
        if (data && data.latitude && data.longitude) {
            // Animate to user's local city/country region safely
            map.flyTo([data.latitude, data.longitude], 13, { duration: 2 });
        }
    })
    .catch(err => console.error("Silent IP geocoding failed:", err));

// 2. Add base tile layers
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
});

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP'
});

const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>'
});

const lightLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>'
});

// Set default layer
osmLayer.addTo(map);

// Add layer control widget to map
const baseMaps = {
    "Standard (OSM)": osmLayer,
    "Satellite": satelliteLayer,
    "Dark Mode": darkLayer,
    "Light (Clean)": lightLayer
};

L.control.layers(baseMaps, null, { position: 'bottomright' }).addTo(map);

// Global variables
/** @type {L.Marker[]} Array to keep track of current charging station markers */
let markers = [];
/** @type {L.Marker|null} Marker denoting the user-searched destination or POI */
let searchMarker = null;
/** @type {L.Routing.Control|null} Instance of the Leaflet Routing Machine control */
let routingControl = null;
/** @type {boolean} Flag to prevent map moveend event from re-fetching data during flyTo animations */
let isInteractingWithList = false;
/** @type {L.CircleMarker[]} Array to keep track of temporary small POI markers near a charger */
let activePoiMarkers = [];
/** @type {Set<number>} Set to keep track of user favorite station IDs */
let userFavorites = new Set();

/**
 * Sync favorites from backend into local Set
 */
async function loadFavorites() {
    try {
        const query = `query { myFavorites { stationId } }`;
        const response = await fetch('/graphql/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                // csrftoken is globally available here
            },
            body: JSON.stringify({ query })
        });
        const result = await response.json();
        if (result.data && result.data.myFavorites) {
            const data = result.data.myFavorites.map(f => f.stationId);
            userFavorites = new Set(data);
        }
    } catch (err) {
        console.error("Failed to load favorites via GraphQL:", err);
    }
}

/**
 * Toggle favorite status
 */
async function toggleFavorite(stationId, stationName, elementIdentifier) {
    try {
        // Optimistic UI update
        const buttonTexts = document.querySelectorAll(`.fav-btn-${stationId}`);
        const isCurrentlyFav = userFavorites.has(stationId);

        if (isCurrentlyFav) {
            userFavorites.delete(stationId);
            buttonTexts.forEach(el => {
                el.innerHTML = '♡';
                el.style.color = '#94a3b8';
            });
        } else {
            userFavorites.add(stationId);
            buttonTexts.forEach(el => {
                el.innerHTML = '❤️';
                el.style.color = '#ef4444';
            });
        }

        // Backend sync via GraphQL Mutation
        const CSRFTokenElement = document.querySelector('[name=csrfmiddlewaretoken]');

        const mutation = `
            mutation ToggleFav($id: Int!, $name: String!) {
                toggleFavorite(stationId: $id, stationName: $name) {
                    status
                    stationId
                }
            }
        `;

        await fetch('/graphql/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRFTokenElement ? CSRFTokenElement.value : ''
            },
            body: JSON.stringify({
                query: mutation,
                variables: {
                    id: stationId,
                    name: stationName
                }
            })
        });
    } catch (err) {
        console.error("Failed to toggle favorite via GraphQL:", err);
    }
}

/**
 * Clears the currently active route and routing panel from the map.
 */
function clearRoute() {
    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }
}

/**
 * Fetches nearby amenities (restaurants, cafes, etc.) within 400m of a charger using Overpass API.
 * @param {number} stationId - ID of the charger to target the right HTML container
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 */
async function loadNearbyAmenities(stationId, lat, lng) {
    const containers = document.querySelectorAll(`.poi-container-${stationId}`);
    if (containers.length === 0) return;

    // Toggle logic: hide if already visible
    const firstContainer = containers[0];
    if (firstContainer.style.display === 'block') {
        containers.forEach(c => c.style.display = 'none');
        activePoiMarkers.forEach(m => map.removeLayer(m));
        activePoiMarkers = [];
        return;
    }

    // Hide others and clear old points
    document.querySelectorAll('.poi-container').forEach(el => el.style.display = 'none');
    activePoiMarkers.forEach(m => map.removeLayer(m));
    activePoiMarkers = [];

    if (firstContainer.dataset.loaded === 'true') {
        containers.forEach(c => c.style.display = 'block');
    }

    containers.forEach(c => {
        c.style.display = 'block';
        c.innerHTML = '<div style="color: #64748b; font-style: italic;">Loading nearby places...</div>';
    });

    try {
        const query = `[out:json][timeout:10];node(around:400,${lat},${lng})[amenity~"restaurant|cafe|fast_food|pharmacy|supermarket"];out 20;`;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        const data = await res.json();

        let html = '<div style="font-weight: 600; color: #475569; margin-bottom: 5px;">Nearby (400m radius):</div>';

        if (data.elements && data.elements.length > 0) {
            data.elements.forEach(poi => {
                const name = poi.tags.name || 'Unnamed place';
                const type = (poi.tags.amenity || 'Place').replace('_', ' ');

                // Customize POI icon based on amenity type
                let iconChar = '📍';
                let iconColor = '#64748b'; // Default Grey

                if (type.includes('restaurant') || type.includes('fast food')) {
                    iconChar = '🍔';
                    iconColor = '#ef4444'; // Red
                } else if (type.includes('cafe')) {
                    iconChar = '☕';
                    iconColor = '#8b5cf6'; // Purple
                } else if (type.includes('pharmacy')) {
                    iconChar = '💊';
                    iconColor = '#10b981'; // Green
                } else if (type.includes('supermarket')) {
                    iconChar = '🛒';
                    iconColor = '#3b82f6'; // Blue
                }

                html += `<div style="margin-bottom: 4px; display: flex; align-items: start; gap: 6px; padding: 4px; background: #fff; border-radius: 6px; border: 1px solid #e2e8f0;">
                            <span style="font-size: 14px; line-height: 1;">${iconChar}</span>
                            <div>
                                <strong style="color: #0f172a; display: block; line-height: 1.2;">${name}</strong> 
                                <span style="color: #94a3b8; font-size: 10px; text-transform: uppercase;">${type}</span>
                            </div>
                         </div>`;

                // Draw custom styled map markers for POIs
                const customIcon = L.divIcon({
                    html: `<div style="background-color: ${iconColor}; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 6px rgba(0,0,0,0.3); border: 2px solid white; font-size: 13px;">${iconChar}</div>`,
                    className: 'custom-poi-marker',
                    iconSize: [26, 26],
                    iconAnchor: [13, 13],
                    popupAnchor: [0, -13]
                });

                const m = L.marker([poi.lat, poi.lon], { icon: customIcon })
                    .bindPopup(`<b>${name}</b><br><span style="text-transform: capitalize;">${type}</span>`)
                    .addTo(map);

                activePoiMarkers.push(m);
            });
        } else {
            html += '<div style="color: #94a3b8; font-size: 12px; margin-top: 5px;">No recorded amenities found nearby.</div>';
        }

        containers.forEach(c => {
            c.innerHTML = html;
            c.dataset.loaded = 'true';
        });

    } catch (err) {
        console.error("Overpass API error:", err);
        containers.forEach(c => c.innerHTML = '<div style="color: #ef4444;">Failed to load nearby places.</div>');
    }
}

/**
 * 3. Fetches charging stations within the current map bounding box from the backend API.
 * Clears existing markers and populates the map and sidebar with the new data.
 */
async function fetchChargers() {
    const bounds = map.getBounds();
    const boundingBox = `(${bounds.getSouth()},${bounds.getWest()}),(${bounds.getNorth()},${bounds.getEast()})`;
    const apiUrl = `/api/chargers/?boundingbox=${boundingBox}`;
    const listContainer = document.getElementById('stationList');

    try {
        listContainer.innerHTML = '<div style="text-align:center; padding: 20px; color:#64748b;">Loading stations...</div>';

        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const chargingStations = await response.json();

        // Remove old markers from the map and clear the array
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];
        // Clear the sidebar list container
        listContainer.innerHTML = '';

        if (!Array.isArray(chargingStations) || chargingStations.length === 0) {
            listContainer.innerHTML = '<div style="text-align:center; padding: 20px; color:#64748b;">No stations found in this area. Move map to explore.</div>';
            return;
        }

        // Add results to the map and sidebar
        chargingStations.forEach(station => {
            if (station.AddressInfo && station.AddressInfo.Latitude && station.AddressInfo.Longitude) {
                const lat = station.AddressInfo.Latitude;
                const lng = station.AddressInfo.Longitude;

                // Extract detailed information from OCM API response
                const title = station.AddressInfo.Title || 'Unknown station';
                const address = `${station.AddressInfo.AddressLine1 || ''} ${station.AddressInfo.Town || ''}`.trim() || 'Address unavailable';
                const usageCost = station.UsageCost ? `<br/><b>Cost:</b> ${station.UsageCost}` : '';
                const operator = station.OperatorInfo ? station.OperatorInfo.Title : 'Unknown operator';
                const points = station.NumberOfPoints ? `<br/><b>Points:</b> ${station.NumberOfPoints}x` : '';

                // Station Status / Occupancy Logic
                let statusInfo = '<span style="color:#94a3b8; font-weight:600;">&#x2022; Unknown status</span>';
                if (station.StatusType) {
                    if (station.StatusType.IsOperational === true || station.StatusType.ID === 50) {
                        statusInfo = `<span style="color:#10b981; font-weight:600;">&#x2022; Operational</span>`;
                    } else if (station.StatusType.IsOperational === false) {
                        statusInfo = `<span style="color:#ef4444; font-weight:600;">&#x2022; ${station.StatusType.Title || 'Offline'}</span>`;
                    } else if (station.StatusType.Title) {
                        statusInfo = `<span style="color:#f59e0b; font-weight:600;">&#x2022; ${station.StatusType.Title}</span>`;
                    }
                }

                // Retrieve high-resolution image if available
                let popupImageHtml = '';
                let cardImageHtml = '';
                if (station.MediaItems && station.MediaItems.length > 0) {
                    // Prefer full resolution image over the small thumbnail
                    const imgUrl = station.MediaItems[0].ItemURL || station.MediaItems[0].ItemThumbnailURL;
                    popupImageHtml = `<img src="${imgUrl}" alt="Station" style="width:100%; height:120px; object-fit:cover; border-radius:8px; margin-bottom:8px; border: 1px solid #e2e8f0;">`;
                    cardImageHtml = `<img src="${imgUrl}" alt="Station" style="width:100%; height:120px; object-fit:cover; border-radius:8px; margin-bottom:8px; border: 1px solid #e2e8f0;">`;
                }

                // Extract power information
                let powerInfo = '';
                if (station.Connections && station.Connections.length > 0) {
                    const maxKw = Math.max(...station.Connections.map(c => c.PowerKW || 0));
                    if (maxKw > 0) powerInfo = `<br/><b>Max power:</b> ${maxKw} kW`;
                }

                // Route navigation and POIs buttons shown in the map popup
                const isFav = userFavorites.has(station.ID);
                const favIcon = isFav ? '❤️' : '♡';
                const favColor = isFav ? '#ef4444' : '#94a3b8';
                const escapedTitle = title.replace(/'/g, "\\'");

                const popupActionsHtml = `<div style="margin-top: 10px; display: flex; gap: 8px; justify-content: center;">
                    <button onclick="toggleFavorite(${station.ID}, '${escapedTitle}')" style="background:#f8fafc; color:#475569; border:1px solid #cbd5e1; padding:6px 10px; border-radius:15px; cursor:pointer; font-weight:600; transition: all 0.2s; font-size: 14px;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f8fafc'"><span class="fav-btn-${station.ID}" style="color:${favColor}">${favIcon}</span></button>
                    <button onclick="loadNearbyAmenities(${station.ID}, ${lat}, ${lng})" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; padding:6px 12px; border-radius:15px; cursor:pointer; font-weight:600; font-family:'Outfit', sans-serif; transition: all 0.2s;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">POIs</button>
                    <button onclick="calculateRouteTo(${lat}, ${lng})" style="background:linear-gradient(135deg, #0284c7, #059669); color:white; border:none; padding:6px 12px; border-radius:15px; cursor:pointer; font-weight:600; font-family:'Outfit', sans-serif;">Navigate Here</button>
                </div>
                <!-- Popup internal POI container -->
                <div class="poi-container poi-container-${station.ID}" style="display:none; margin-top: 10px; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; max-height: 160px; overflow-y: auto;"></div>`;

                // HTML content for the map Marker popup
                const popupContent = `
                    <div style="font-size: 14px; font-family: 'Outfit', sans-serif; min-width: 220px;">
                        ${popupImageHtml}
                        <h3 style="margin: 0 0 5px 0; color: #0284c7; font-size: 16px;">${title}</h3>
                        <div style="color: #64748b; font-size: 12px; margin-bottom: 5px;">${operator} ${statusInfo}</div>
                        ${address}
                        ${usageCost}
                        ${points}
                        ${powerInfo}
                        ${popupActionsHtml}
                    </div>
                `;

                // Identify correct pin color based on operational status
                let pinColor = '#0284c7'; // Default blue
                if (station.StatusType && station.StatusType.IsOperational === false) {
                    pinColor = '#ef4444'; // Red for offline
                } else if (station.StatusType && station.StatusType.IsOperational === true) {
                    pinColor = '#10b981'; // Green for operational
                }

                // Custom visually appealing electric lightning bolt icon for chargers
                const chargerIcon = L.divIcon({
                    html: `<div style="background-color: ${pinColor}; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 8px rgba(0,0,0,0.3); border: 2.5px solid white; transition: all 0.2s;">
                             <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                           </div>`,
                    className: 'custom-charger-icon',
                    iconSize: [34, 34],
                    iconAnchor: [17, 17],
                    popupAnchor: [0, -17]
                });

                // Create and assign the map marker
                const marker = L.marker([lat, lng], { icon: chargerIcon }).bindPopup(popupContent);
                marker.addTo(map);
                markers.push(marker);

                // Create the charging station card for the left sidebar list
                const stationCard = document.createElement('div');
                stationCard.className = 'station-item';
                stationCard.innerHTML = `
                    ${cardImageHtml}
                    <h4 class="station-title">${title}</h4>
                    <div style="font-size:11px; color:#94a3b8; margin-bottom:4px; text-transform: uppercase; font-weight:600;">${operator} ${statusInfo}</div>
                    <div class="station-address">${address}</div>
                    <div style="font-size:12px; color:#334155; display:flex; justify-content:space-between; align-items:center;">
                        <span style="display:flex; align-items:center; gap: 6px;">
                            <button onclick="event.stopPropagation(); toggleFavorite(${station.ID}, '${escapedTitle}')" style="background:transparent; border:none; cursor:pointer; font-size:16px; padding:0;"><span class="fav-btn-${station.ID}" style="color:${favColor}">${favIcon}</span></button>
                            ${powerInfo.replace('<br/>', '') || 'Power n/a'}
                        </span>
                        <div style="display:flex; gap: 6px;">
                            <button onclick="event.stopPropagation(); loadNearbyAmenities(${station.ID}, ${lat}, ${lng})" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; padding:4px 10px; border-radius:12px; cursor:pointer; font-family:'Outfit',sans-serif; font-size:11px; font-weight:600; transition: all 0.2s;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">POIs</button>
                            <button onclick="event.stopPropagation(); calculateRouteTo(${lat}, ${lng})" style="background:#e2e8f0; color:#0f172a; border:none; padding:4px 10px; border-radius:12px; cursor:pointer; font-family:'Outfit',sans-serif; font-size:11px; font-weight:600; transition: all 0.2s;" onmouseover="this.style.background='#cbd5e1'" onmouseout="this.style.background='#e2e8f0'">Route</button>
                        </div>
                    </div>
                    <div class="poi-container poi-container-${station.ID}" style="display:none; margin-top: 10px; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 11px;"></div>
                `;

                // Hovering over the card opens the map popup subtly
                stationCard.addEventListener('mouseenter', () => {
                    marker.openPopup();
                });

                // Clicking the card centers the map on the station and opens the popup
                stationCard.onclick = () => {
                    const targetLatLng = L.latLng(lat, lng);

                    // If the map is already centered nearby at the correct zoom level, skip the flyTo animation
                    if (map.getZoom() === 15 && map.getCenter().distanceTo(targetLatLng) < 10) {
                        marker.openPopup();
                        return;
                    }

                    // Engage the safety lock to prevent moveend from triggering a new fetch during the flight
                    isInteractingWithList = true;
                    map.flyTo([lat, lng], 15);
                    marker.openPopup();
                };
                listContainer.appendChild(stationCard);
            }
        });
    } catch (error) {
        console.error("Error fetching chargers from OpenChargeMap:", error);
        if (listContainer) {
            listContainer.innerHTML = `<div style="text-align:center; padding: 20px; color:#e11d48; font-weight:500;">Problem loading data.<br><span style="font-size:13px; color:#64748b; font-weight:normal;">API might be busy or returning bad format. Move map slightly to try again.</span></div>`;
        }
    }
}

// 4. Fetch data immediately after page load
fetchChargers();

// Start watching map movements once initialized
map.on('moveend', () => {
    // If "moveend" occurred because of a card click animation, skip the fetch to avoid deleting the opened popup. Restart safety lock.
    if (isInteractingWithList) {
        isInteractingWithList = false;
        return;
    }
    fetchChargers();
});

// 6. LOCATION & POI SEARCH (Nominatim Geocoding + Autocomplete)
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const autocompleteList = document.getElementById('autocomplete-list');
/** @type {number} Timeout handle for debouncing API requests */
let searchDebounceTimer;

/**
 * Executes the map flight and processes the marker for a selected search location.
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} displayName - Human readable name of the location
 */
function executeSearch(lat, lon, displayName) {
    if (searchMarker) {
        map.removeLayer(searchMarker);
    }

    // Custom visually appealing map pin with a star inside for searched POI/Destination
    const poiIcon = L.divIcon({
        html: `<div style="background-color: #f59e0b; width: 34px; height: 34px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: -3px 3px 6px rgba(0,0,0,0.4); border: 2.5px solid white;">
                 <div style="transform: rotate(45deg); display: flex; align-items: center; justify-content: center;">
                   <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                 </div>
               </div>`,
        className: 'custom-poi-icon',
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -34]
    });

    searchMarker = L.marker([lat, lon], {
        icon: poiIcon,
        title: displayName,
        zIndexOffset: 1000
    }).addTo(map);

    searchMarker.bindPopup(`<b>Your origin / POI:</b><br>${displayName}`).openPopup();

    // Silently perform an API request to save this search history to User's database account via GraphQL
    try {
        const mutation = `
            mutation SaveHistory($name: String!, $lat: Float!, $lon: Float!) {
                saveSearchHistory(displayName: $name, lat: $lat, lon: $lon) {
                    status
                }
            }
        `;
        fetch('/graphql/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrftoken
            },
            body: JSON.stringify({
                query: mutation,
                variables: {
                    name: displayName,
                    lat: lat,
                    lon: lon
                }
            })
        });
    } catch (e) {
        console.error('Failed to save search history via GraphQL', e);
    }

    // Clear any previous routing lines when a new location is searched
    clearRoute();
    map.flyTo([lat, lon], 14, { animate: true, duration: 1.5 });
}

// Close autocomplete dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (e.target !== searchInput && e.target !== autocompleteList) {
        autocompleteList.style.display = 'none';
    }
    if (headerHistoryList && headerHistoryList.style.display === 'block' && e.target !== headerHistoryBtn && !headerHistoryList.contains(e.target)) {
        headerHistoryList.style.display = 'none';
    }
    if (headerFavoritesList && headerFavoritesList.style.display === 'block' && e.target !== headerFavoritesBtn && !headerFavoritesList.contains(e.target)) {
        headerFavoritesList.style.display = 'none';
    }
});

// Top-Right User Menu History Dropdown
const headerHistoryBtn = document.getElementById('headerHistoryBtn');
const headerHistoryList = document.getElementById('header-history-list');

const headerFavoritesBtn = document.getElementById('headerFavoritesBtn');
const headerFavoritesList = document.getElementById('header-favorites-list');

if (headerFavoritesBtn) {
    headerFavoritesBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        if (headerFavoritesList.style.display === 'block') {
            headerFavoritesList.style.display = 'none';
            return;
        }

        headerHistoryList.style.display = 'none'; // Close the other one

        try {
            const query = `query { myFavorites { stationName } }`;
            const response = await fetch('/graphql/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });
            const result = await response.json();
            const results = result.data.myFavorites;

            headerFavoritesList.innerHTML = '<div style="padding: 10px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Saved Stations</div>';

            if (results && results.length > 0) {
                results.forEach(fav => {
                    const item = document.createElement('div');
                    item.className = 'header-history-item';

                    item.innerHTML = `
                        <span style="color:#ef4444; font-size:18px;">❤️</span>
                        <div style="overflow: hidden;"><strong>${fav.stationName}</strong></div>
                    `;

                    // Not strictly geocoded via DB to avoid complexity, but we can search for it visually
                    item.addEventListener('click', () => {
                        headerFavoritesList.style.display = 'none';
                        searchInput.value = fav.stationName;
                        performSearch(); // Triggers the Nominatim search manually
                    });

                    headerFavoritesList.appendChild(item);
                });
            } else {
                headerFavoritesList.innerHTML += '<div style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">No favorites yet.</div>';
            }

            headerFavoritesList.style.display = 'block';
        } catch (error) {
            console.error('Favorites fetch error:', error);
        }
    });
}

headerHistoryBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    // Toggle menu
    if (headerHistoryList.style.display === 'block') {
        headerHistoryList.style.display = 'none';
        return;
    }

    if (headerFavoritesList) headerFavoritesList.style.display = 'none'; // Close the other one

    try {
        const query = `query { myHistory(limit: 5) { displayName lat lon } }`;
        const response = await fetch('/graphql/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const result = await response.json();
        const results = result.data.myHistory;

        headerHistoryList.innerHTML = '<div style="padding: 10px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Recent searches</div>';

        if (results && results.length > 0) {
            results.forEach(place => {
                const item = document.createElement('div');
                item.className = 'header-history-item';

                const mainName = place.displayName.split(',')[0] || 'Location';
                const detail = place.displayName.split(',').slice(1, 3).join(',');

                item.innerHTML = `
                    <span style="color:#94a3b8; font-size:18px;">&#128338;</span>
                    <div style="overflow: hidden;"><strong>${mainName}</strong><small>${detail}</small></div>
                `;

                item.addEventListener('click', () => {
                    headerHistoryList.style.display = 'none';
                    searchInput.value = mainName;
                    executeSearch(place.lat, place.lon, place.displayName);
                });

                headerHistoryList.appendChild(item);
            });
        } else {
            headerHistoryList.innerHTML += '<div style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">No history yet.</div>';
        }

        headerHistoryList.style.display = 'block';
    } catch (error) {
        console.error('History fetch error:', error);
    }
});

// Show recent history immediately when clicking into the empty search bar
searchInput.addEventListener('click', async function () {
    if (this.value.trim().length > 0) return; // If already typing, ignore

    try {
        const query = `query { myHistory(limit: 5) { displayName lat lon } }`;
        const response = await fetch('/graphql/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const result = await response.json();
        const results = result.data.myHistory;

        if (results && results.length > 0 && this.value.trim().length === 0) {
            autocompleteList.innerHTML = '<div style="padding: 8px 16px; background: #f8fafc; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Recent searches</div>';
            autocompleteList.style.display = 'flex';

            results.forEach(place => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';

                const mainName = place.displayName.split(',')[0] || 'Location';
                const detail = place.displayName.split(',').slice(1, 3).join(',');

                // Clock icon to denote history
                item.innerHTML = `<div style="display:flex; align-items:center; gap:8px;">
                                    <span style="color:#94a3b8; font-size:16px;">&#128338;</span>
                                    <div><strong>${mainName}</strong><small>${detail}</small></div>
                                  </div>`;

                item.addEventListener('click', () => {
                    searchInput.value = mainName;
                    autocompleteList.style.display = 'none';
                    executeSearch(place.lat, place.lon, place.displayName);
                });

                autocompleteList.appendChild(item);
            });
        }
    } catch (error) {
        console.error('History load error API:', error);
    }
});

// Trigger autocomplete while typing
searchInput.addEventListener('input', function () {
    clearTimeout(searchDebounceTimer);
    const query = this.value.trim();

    if (query.length < 3) {
        autocompleteList.style.display = 'none';
        return;
    }

    // Debounce to prevent API spam while typing
    searchDebounceTimer = setTimeout(async () => {
        const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;
        try {
            const response = await fetch(geocodeUrl);
            const results = await response.json();

            autocompleteList.innerHTML = '';

            if (results && results.length > 0) {
                autocompleteList.style.display = 'flex';

                results.forEach(place => {
                    const item = document.createElement('div');
                    item.className = 'autocomplete-item';

                    // Parse proper main title and secondary subtitle for aesthetics
                    const mainName = (place.address && (place.address.road || place.address.city || place.address.town || place.address.village)) || place.name || 'Location';
                    const detail = place.display_name.split(',').slice(0, 3).join(','); // Only first 3 address segments for preview

                    item.innerHTML = `<div><strong>${mainName}</strong><small>${detail}</small></div>`;

                    item.addEventListener('click', () => {
                        searchInput.value = place.name || mainName;
                        autocompleteList.style.display = 'none';
                        executeSearch(parseFloat(place.lat), parseFloat(place.lon), place.display_name);
                    });

                    autocompleteList.appendChild(item);
                });
            } else {
                autocompleteList.style.display = 'none';
            }
        } catch (error) {
            console.error('Autocomplete error:', error);
        }
    }, 400); // 400ms delay before firing API request
});

/**
 * Hard-click search button fallback logic (direct fetch without autocomplete)
 */
async function performSearch() {
    const query = searchInput.value;
    if (!query) return;

    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    autocompleteList.style.display = 'none';

    try {
        const btnOriginalText = searchBtn.innerText;
        searchBtn.innerText = '...';

        const response = await fetch(geocodeUrl);
        const results = await response.json();

        searchBtn.innerText = btnOriginalText;

        if (results && results.length > 0) {
            const place = results[0];
            executeSearch(parseFloat(place.lat), parseFloat(place.lon), place.display_name);
        } else {
            alert('Place not found. Try a different query.');
        }
    } catch (error) {
        console.error('Error during geocoding:', error);
        alert('Search service temporary unavailable.');
    }
}

searchBtn.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        clearTimeout(searchDebounceTimer);
        performSearch();
    }
});

// 7. ROUTE CALCULATION (Leaflet Routing Machine)
/**
 * Triggers the Leaflet Routing Machine to calculate and draw a path
 * between the currently active searchMarker and the specified destination.
 * 
 * @param {number} destLat - Destination Latitude
 * @param {number} destLng - Destination Longitude
 */
window.calculateRouteTo = function (destLat, destLng) {
    if (!searchMarker) {
        alert('Please search for an origin place or POI first to calculate the route.');
        document.getElementById('searchInput').focus();
        return;
    }

    clearRoute();

    const originLatLng = searchMarker.getLatLng();
    const destLatLng = L.latLng(destLat, destLng);

    routingControl = L.Routing.control({
        waypoints: [
            originLatLng,
            destLatLng
        ],
        router: L.Routing.osrmv1({
            language: 'en',
            profile: 'driving'
        }),
        lineOptions: {
            styles: [{ color: '#0284c7', opacity: 0.8, weight: 6 }]
        },
        createMarker: function () { return null; }, // Prevent duplicate routing markers 
        show: true // Display the English step-by-step turn instructions panel
    }).addTo(map);
};
