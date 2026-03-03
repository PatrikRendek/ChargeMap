import graphene
from graphene_django import DjangoObjectType
from stations.models import FavoriteStation, SearchHistory
from django.contrib.auth.models import User

# --- GraphQL Types ---

class UserType(DjangoObjectType):
    class Meta:
        model = User
        fields = ("id", "username", "email")

class FavoriteStationType(DjangoObjectType):
    class Meta:
        model = FavoriteStation
        fields = ("id", "user", "station_id", "station_name", "added_at")

class SearchHistoryType(DjangoObjectType):
    class Meta:
        model = SearchHistory
        fields = ("id", "user", "display_name", "lat", "lon", "searched_at")

# --- GraphQL Queries ---

class Query(graphene.ObjectType):
    """
    All available query endpoints (reading data)
    """
    me = graphene.Field(UserType)
    my_favorites = graphene.List(FavoriteStationType)
    my_history = graphene.List(SearchHistoryType, limit=graphene.Int())

    def resolve_me(self, info):
        user = info.context.user
        if getattr(user, "is_authenticated", False):
            return user
        return None

    def resolve_my_favorites(self, info):
        user = info.context.user
        if getattr(user, "is_authenticated", False):
            return FavoriteStation.objects.filter(user=user)
        return []

    def resolve_my_history(self, info, limit=None):
        user = info.context.user
        if getattr(user, "is_authenticated", False):
            qs = SearchHistory.objects.filter(user=user)
            if limit:
                qs = qs[:limit]
            return qs
        return []

# --- GraphQL Mutations ---

class ToggleFavoriteMutation(graphene.Mutation):
    """
    Mutation endpoint to add or remove a favorite station
    """
    class Arguments:
        station_id = graphene.Int(required=True)
        station_name = graphene.String(required=True)

    status = graphene.String()
    station_id = graphene.Int()

    def mutate(self, info, station_id, station_name):
        user = info.context.user
        
        if not getattr(user, "is_authenticated", False):
            raise Exception("Authentication required")

        fav, created = FavoriteStation.objects.get_or_create(
            user=user,
            station_id=station_id,
            defaults={'station_name': station_name}
        )

        if not created:
            # It already existed, so remove it
            fav.delete()
            return ToggleFavoriteMutation(status="removed", station_id=station_id)
        else:
            # Newly created
            return ToggleFavoriteMutation(status="added", station_id=station_id)

class SaveSearchHistoryMutation(graphene.Mutation):
    """
    Mutation endpoint to save a searched location to history
    """
    class Arguments:
        display_name = graphene.String(required=True)
        lat = graphene.Float(required=True)
        lon = graphene.Float(required=True)

    status = graphene.String()

    def mutate(self, info, display_name, lat, lon):
        user = info.context.user
        if getattr(user, "is_authenticated", False):
            SearchHistory.objects.create(
                user=user,
                display_name=display_name,
                lat=lat,
                lon=lon
            )
            return SaveSearchHistoryMutation(status="saved")
        return SaveSearchHistoryMutation(status="unauthenticated")

class Mutation(graphene.ObjectType):
    toggle_favorite = ToggleFavoriteMutation.Field()
    save_search_history = SaveSearchHistoryMutation.Field()
