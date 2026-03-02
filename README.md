# ⚡ ChargeMap Slovakia

**🚀 Live Demo:** [https://chargemap.onrender.com/](https://chargemap.onrender.com/)

An interactive, responsive Django web application that maps electric vehicle (EV) charging stations across Slovakia and Europe. Features real-time routing, live operational status checks, POI Search Autocomplete, and Google OAuth secure authentication.

## ✨ Features

- **Interactive Map:** Powered by Leaflet.js with custom-designed visual markers.
- **EV Charger Data:** Dynamically retrieves and visualizes data directly from the [OpenChargeMap API](https://openchargemap.org/site/develop/api).
- **IP Geolocation:** The map intelligently centers on the user's specific real-world location silently on initial load.
- **Favorites System:** Logged-in users can heart ❤️ their favorite charging stations to save them to their personalized profile dropdown list.
- **Nearby POIs:** Click a button next to any station to fetch nearby amenities (cafes, restaurants, supermarkets) in a 400m radius using the Overpass API.
- **Status Indicators:** Chargers glow green (Operational) or red (Offline/Out of Service) based on live API checks.
- **Smart POI Search:** Fast location geocoding powered by Nominatim OpenStreetMap with a debounced autocomplete dropdown list.
- **Personalized History:** Authenticated users have their 5 most recent location queries securely stored in PostgreSQL and accessible via a history dropdown.
- **Full Navigation:** Integration with Leaflet Routing Machine providing turn-by-turn routing directly from any searched place to a chosen charging station.
- **Multiple Map Modes:** Users can seamlessly toggle between Standard OSM, Satellite imagery (Esri), Dark Mode, and Light Mode layouts.
- **Authentication:** Users can log in manually or seamlessly using Google Social Login via `django-allauth`.

## 🛠️ Tech Stack

- **Backend:** Python 3.12, Django 5.x
- **Frontend:** Vanilla JavaScript, HTML5, CSS3, Flexbox Layouts
- **Libraries:** Leaflet.js, Leaflet Routing Machine
- **Authentication:** django-allauth (with Google OAuth Provider)
- **Database:** PostgreSQL
- **Caching:** Redis (`django-redis` used for backend API proxy acceleration)
- **Deployment:** Docker, Gunicorn, Whitenoise (Production-ready for Render.com)

---

## 🚀 Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### 1. Requirements

Ensure you have Python installed on your machine. You will also need a virtual environment.

### 2. Installation

Clone the repository:
```bash
git clone https://github.com/PatrikRendek/ChargeMap.git
cd ChargeMap
```

Create and activate the virtual environment:
```bash
# On Windows:
python -m venv .venv
.venv\Scripts\activate

# On macOS/Linux:
python3 -m venv venv
source venv/bin/activate
```

Install the required Python dependencies:
```bash
pip install -r requirements.txt
```

### 3. Environment Variables Configuration

Since API keys and secret keys are protected, you need to create your own configuration file.
Create a `.env` file in the root project directory (`chargemap/`) and add the following keys:

```env
OPENCHARGEMAP_API_KEY=your_openchargemap_api_key_here
GOOGLE_OAUTH_CLIENT_ID=your_google_client_id_here
GOOGLE_OAUTH_CLIENT_SECRET=your_google_secret_here

# Local Development DB
DB_NAME=chargemap
DB_USER=postgres
DB_PASSWORD=your_db_password
DB_HOST=127.0.0.1
DB_PORT=5432

# Production (Render)
# DATABASE_URL=postgres://...
# REDIS_URL=rediss://...
```
*Note: You can obtain your free OpenChargeMap API key by registering a developer account at openchargemap.org.*

### 4. Database Setup & Migrations

Make sure to run all database migrations needed for Django and `allauth`:
```bash
python manage.py migrate
```

*(Optional)* Create a superuser to access the Django built-in admin panel:
```bash
python manage.py createsuperuser
```

### 5. Run the Server

Start the local development server:
```bash
python manage.py runserver
```

Open your browser and navigate to `http://127.0.0.1:8000/`.
