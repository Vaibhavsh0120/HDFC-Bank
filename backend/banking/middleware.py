class ApiNoStoreMiddleware:
    """Keep account details and session responses out of browser and proxy caches."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path_info.startswith("/api/"):
            response["Cache-Control"] = "no-store, private"
        return response
