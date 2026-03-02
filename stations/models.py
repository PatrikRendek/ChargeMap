from django.db import models
from django.contrib.auth.models import User

class SearchHistory(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='search_history')
    display_name = models.CharField(max_length=255)
    lat = models.FloatField()
    lon = models.FloatField()
    searched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-searched_at']

    def __str__(self):
        return f"{self.user.username} - {self.display_name}"

class FavoriteStation(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='favorite_stations')
    station_id = models.IntegerField()
    station_name = models.CharField(max_length=255)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-added_at']
        unique_together = ('user', 'station_id')

    def __str__(self):
        return f"{self.user.username} loved {self.station_name}"
