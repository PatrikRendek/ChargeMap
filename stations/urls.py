from django.urls import path
from . import views

urlpatterns = [
    path('', views.map_view, name='map_view'),
    path('signup/', views.signup_view, name='signup'),
    path('api/chargers/', views.fetch_chargers_proxy, name='fetch_chargers_proxy'),
]
