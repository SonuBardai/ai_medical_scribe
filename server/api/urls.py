from django.contrib import admin
from django.urls import path
from ninja import NinjaAPI
from .routes_handler.health_handler import router as health_router
from .routes_handler.socket_handler import router as socket_router
from .routes_handler.visits_handler import router as visits_router


api = NinjaAPI()

api.add_router("", health_router)  # /live
api.add_router("", socket_router)
api.add_router("", visits_router)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("rest/", api.urls),
]
