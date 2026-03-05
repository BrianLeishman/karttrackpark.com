function handler(event) {
    var request = event.request;
    var uri = request.uri;
    // Rewrite /{prefix}/{xid}/... to the static page, but not /{prefix}/ itself
    var prefixes = ['tracks', 'events', 'championships', 'series'];
    var matched = false;
    for (var i = 0; i < prefixes.length; i++) {
        var p = prefixes[i];
        if (new RegExp('^/' + p + '/[a-z0-9]+').test(uri) && uri !== '/' + p + '/' && uri !== '/' + p + '/index.html') {
            request.uri = '/' + p + '/index.html';
            matched = true;
            break;
        }
    }
    if (!matched) {
        if (uri.endsWith('/')) {
            request.uri += 'index.html';
        } else if (!uri.includes('.')) {
            request.uri += '/index.html';
        }
    }
    return request;
}
