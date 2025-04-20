from ninja import Router

router = Router()


@router.get("/health/live")
def health(request):
    return {"status": "ok"}
