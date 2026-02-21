function handler(event) {
    var request = event.request;
    var uri = request.uri;
    // Rewrite /tracks/{xid}/... to the static page, but not /tracks/ itself
    if (/^\/tracks\/[a-z0-9]+/.test(uri) && uri !== '/tracks/' && uri !== '/tracks/index.html') {
        request.uri = '/tracks/index.html';
    } else if (uri.endsWith('/')) {
        request.uri += 'index.html';
    } else if (!uri.includes('.')) {
        request.uri += '/index.html';
    }
    return request;
}
