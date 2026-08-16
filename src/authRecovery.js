export const AUTH_NETWORK_ERROR_MESSAGE =
  "No se pudo conectar con el servidor. Comprueba tu conexion y vuelve a intentarlo.";

function errorText(error) {
  return [error?.message, error?.details, error?.cause?.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isNetworkRequestError(error) {
  return /failed to fetch|networkerror|network request failed|load failed/.test(errorText(error));
}

function isAlreadyRegisteredError(error) {
  return /chapa ya est[aá] registrada|already registered/.test(errorText(error));
}

function friendlyNetworkError() {
  return new Error(AUTH_NETWORK_ERROR_MESSAGE);
}

export async function registerWithNetworkRecovery({ register, login, wait }) {
  try {
    return await register();
  } catch (firstError) {
    if (!isNetworkRequestError(firstError)) throw firstError;
  }

  await wait();

  try {
    return await register();
  } catch (retryError) {
    if (!isAlreadyRegisteredError(retryError) && !isNetworkRequestError(retryError)) {
      throw retryError;
    }

    // The first request may have reached PostgreSQL even if the phone never
    // received its response. Logging in recovers that successful registration
    // without leaving the user stuck behind "ya esta registrada".
    try {
      return await login();
    } catch (loginError) {
      if (isNetworkRequestError(loginError) || isAlreadyRegisteredError(retryError)) {
        throw friendlyNetworkError();
      }
      throw loginError;
    }
  }
}
