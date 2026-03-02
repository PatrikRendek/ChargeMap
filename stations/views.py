from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth import login
from django.http import JsonResponse
from django.conf import settings
from .models import SearchHistory, FavoriteStation
from django.views.decorators.http import require_POST
import requests
import traceback
import json
from django.core.cache import cache

@login_required
def map_view(request):
    return render(request, 'stations/map.html')

def signup_view(request):
    if request.method == 'POST':
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect('map_view')
    else:
        form = UserCreationForm()
    return render(request, 'registration/signup.html', {'form': form})

def fetch_chargers_proxy(request):
    boundingbox = request.GET.get('boundingbox')
    if not boundingbox:
        return JsonResponse({'error': 'Missing boundingbox parameter'}, status=400)
    
    # Use a safe cache key derived from the boundingbox
    cache_key = f"chargers_{boundingbox.replace(',', '_')}"
    cached_data = cache.get(cache_key)

    if cached_data:
        return JsonResponse(cached_data, safe=False)

    # Hide the API key on the server (loaded from .env) to bypass browser limitations/CORS securely
    api_key = getattr(settings, 'OPENCHARGEMAP_API_KEY', '')
    url = f"https://api.openchargemap.io/v3/poi/?output=json&maxresults=100&boundingbox={boundingbox}&key={api_key}"
    headers = {
        'User-Agent': 'ChargeMapApp/1.0 (Django Backend Proxy)',
        'Accept': 'application/json'
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        # HTTPError will be raised for 403, 429, etc., and passed back to the frontend
        response.raise_for_status()
        
        # OCM API might return an empty string instead of [] for some empty areas, which breaks the .json() decoder.
        text_data = response.text.strip()
        if not text_data:
            data = []
        else:
            data = response.json()
            
        # Store in cache for 10 minutes (600 seconds)
        cache.set(cache_key, data, timeout=600)
        
        return JsonResponse(data, safe=False)
    except requests.RequestException as e:
        return JsonResponse({'error': f'Failed to fetch from OpenChargeMap: {str(e)}'}, status=502)
    except ValueError as e:
        # Catches .json() parsing errors if the API returns a malformed string instead of a valid JSON array
        return JsonResponse({'error': f'Invalid JSON from API: {str(e)}'}, status=502)

@login_required
@require_POST
def save_search(request):
    try:
        data = json.loads(request.body)
        display_name = data.get('display_name')
        lat = data.get('lat')
        lon = data.get('lon')

        if display_name and lat and lon:
            # Check if this exact search was the last one, to avoid spam
            last_search = SearchHistory.objects.filter(user=request.user).first()
            if not last_search or last_search.display_name != display_name:
                SearchHistory.objects.create(
                    user=request.user,
                    display_name=display_name,
                    lat=lat,
                    lon=lon
                )
            return JsonResponse({'status': 'success'})
        return JsonResponse({'error': 'Missing parameters'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@login_required
def get_search_history(request):
    history = SearchHistory.objects.filter(user=request.user)[:5]
    data = [
        {
            'display_name': item.display_name,
            'lat': item.lat,
            'lon': item.lon
        }
        for item in history
    ]
    return JsonResponse(data, safe=False)

@login_required
@require_POST
def toggle_favorite(request):
    try:
        data = json.loads(request.body)
        station_id = data.get('station_id')
        station_name = data.get('station_name')

        if not station_id or not station_name:
            return JsonResponse({'error': 'Missing parameters'}, status=400)

        favorite = FavoriteStation.objects.filter(user=request.user, station_id=station_id).first()
        
        if favorite:
            favorite.delete()
            return JsonResponse({'status': 'removed'})
        else:
            FavoriteStation.objects.create(
                user=request.user, 
                station_id=station_id, 
                station_name=station_name
            )
            return JsonResponse({'status': 'added'})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@login_required
def get_favorites(request):
    favorites = list(FavoriteStation.objects.filter(user=request.user).values('station_id', 'station_name'))
    return JsonResponse(favorites, safe=False)
