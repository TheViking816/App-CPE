// Removing a submitted form synchronously cancels the browser's default POST.
// Keep it connected until the browser has started that submission.
export function afterNativeSubmit(callback) {
  setTimeout(callback, 0);
}
