import graphene
import stations.schema

class Query(stations.schema.Query, graphene.ObjectType):
    pass

class Mutation(stations.schema.Mutation, graphene.ObjectType):
    pass

schema = graphene.Schema(query=Query, mutation=Mutation)
