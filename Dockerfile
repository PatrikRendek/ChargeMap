FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt /app/
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy the Django project code
COPY . /app/

# Expose the port the app runs on
EXPOSE 8000

# Default command to start the application (migrations, static files, and application server)
CMD bash -c "python manage.py migrate --noinput && python manage.py collectstatic --noinput && gunicorn chargemap.wsgi:application --bind 0.0.0.0:${PORT}"
