import json
import sys

from curl_cffi import requests


TARGET_URL = "https://portal.cpevalencia.com/#User"
CHALLENGE_MARKERS = (
    "challenge-platform",
    "cf-chl-",
    "cf_chl_",
    "just a moment",
    "verificación de seguridad",
    "verificacion de seguridad",
    "verify you are human",
)
LOGIN_MARKERS = (
    'title="usuario"',
    "iniciar sesión",
    "iniciar sesion",
    "loginfields",
)


def main() -> int:
    try:
        response = requests.get(
            TARGET_URL,
            impersonate="chrome",
            timeout=45,
            allow_redirects=True,
        )
    except Exception as error:
        print(json.dumps({"ok": False, "error": type(error).__name__}))
        return 1

    body = response.text.lower()
    challenge = any(marker in body for marker in CHALLENGE_MARKERS)
    login_form = any(marker in body for marker in LOGIN_MARKERS)
    result = {
        "ok": response.status_code < 500,
        "status": response.status_code,
        "challenge": challenge,
        "loginForm": login_form,
        "finalUrl": str(response.url).split("?")[0],
        "bodyBytes": len(response.content),
        "server": response.headers.get("server", ""),
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0 if response.status_code < 500 else 1


if __name__ == "__main__":
    sys.exit(main())
