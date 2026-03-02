from django.contrib import admin
from .models import SearchHistory

@admin.register(SearchHistory)
class SearchHistoryAdmin(admin.ModelAdmin):
    list_display = ('user', 'display_name', 'searched_at', 'lat', 'lon')
    list_filter = ('searched_at', 'user')
    search_fields = ('display_name', 'user__username')
