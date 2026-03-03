import json
from unittest.mock import patch
from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.urls import reverse
from stations.models import FavoriteStation, SearchHistory

class StationModelTests(TestCase):
    def setUp(self):
        """Executed before each test to setup clean data."""
        self.user = User.objects.create_user(username='testuser', password='testpassword123')

    def test_favorite_station_string_representation(self):
        """Tests if the model is correctly represented as a string (__str__)."""
        fav = FavoriteStation.objects.create(
            user=self.user, 
            station_id=999, 
            station_name='Supercharger Bratislava'
        )
        self.assertEqual(str(fav), 'testuser loved Supercharger Bratislava')

class FavoritesAPITests(TestCase):
    def setUp(self):
        # Create a client (simulated browser) and a test user
        self.client = Client()
        self.user = User.objects.create_user(username='testuser', password='testpassword123')
        self.toggle_url = reverse('toggle_favorite')

    def test_toggle_favorite_unauthenticated(self):
        """Unauthenticated user should receive a 302 status (redirect to login)."""
        response = self.client.post(self.toggle_url, {'station_id': 1}, content_type='application/json')
        self.assertEqual(response.status_code, 302)

    def test_toggle_favorite_add_and_remove(self):
        """Authenticated user adds and then removes a station via the API."""
        self.client.login(username='testuser', password='testpassword123')

        # Step 1: Add the station
        payload = {'station_id': 12345, 'station_name': 'Aupark Charger'}
        response = self.client.post(self.toggle_url, payload, content_type='application/json')
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'added')
        self.assertEqual(FavoriteStation.objects.count(), 1)

        # Step 2: Remove the same station (Toggling)
        response_remove = self.client.post(self.toggle_url, payload, content_type='application/json')
        
        self.assertEqual(response_remove.status_code, 200)
        self.assertEqual(response_remove.json()['status'], 'removed')
        self.assertEqual(FavoriteStation.objects.count(), 0) # Database is empty again

class ChargersProxyTests(TestCase):
    @patch('stations.views.requests.get')
    def test_fetch_chargers_proxy_success(self, mock_get):
        """
        Mocking external API: Tests how our app handles data
        without actually making network calls to OpenChargeMap servers.
        """
        # Mock a successful response (Status 200) with a list containing 1 station
        mock_get.return_value.status_code = 200
        mock_get.return_value.text = json.dumps([{"ID": 555, "AddressInfo": {"Title": "Mocked Charger"}}])
        mock_get.return_value.json.return_value = [{"ID": 555, "AddressInfo": {"Title": "Mocked Charger"}}]

        client = Client()
        # Since the boundingbox parameter is required, we add it to the GET parameters
        response = client.get(reverse('fetch_chargers_proxy'), {'boundingbox': '18.0,48.0,19.0,49.0'})

        self.assertEqual(response.status_code, 200)
        # Verify that we are processing data from our mock and not the real cloud
        self.assertEqual(response.json()[0]['ID'], 555)
        self.assertEqual(response.json()[0]['AddressInfo']['Title'], "Mocked Charger")
