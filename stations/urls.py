from django.urls import path
from . import views

urlpatterns = [
    path('', views.map_view, name='map_view'),
    path('signup/', views.signup_view, name='signup'),
    path('api/chargers/', views.fetch_chargers_proxy, name='fetch_chargers_proxy'),
    path('api/search-history/save/', views.save_search, name='save_search'),
    path('api/search-history/', views.get_search_history, name='get_search_history'),
    path('api/favorites/toggle/', views.toggle_favorite, name='toggle_favorite'),
    path('api/favorites/', views.get_favorites, name='get_favorites'),
]
