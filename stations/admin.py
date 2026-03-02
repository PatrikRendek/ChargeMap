from django.contrib import admin
from .models import SearchHistory, FavoriteStation

@admin.register(SearchHistory)
class SearchHistoryAdmin(admin.ModelAdmin):
    list_display = ('user', 'display_name', 'searched_at', 'lat', 'lon')
    list_filter = ('searched_at', 'user')
    search_fields = ('display_name', 'user__username')

@admin.register(FavoriteStation)
class FavoriteStationAdmin(admin.ModelAdmin):
    list_display = ('user', 'station_name', 'station_id', 'added_at')
    list_filter = ('added_at', 'user')
    search_fields = ('station_name', 'user__username')
