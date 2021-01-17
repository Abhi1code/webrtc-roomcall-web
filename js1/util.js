function $$(selector) {
    return document.querySelector(selector);
}

// Return a random numerical string.
function randomString(strLength) {
    var result = [];
    strLength = strLength || 5;
    var charSet = '0123456789';
    while (strLength--) {
        result.push(charSet.charAt(Math.floor(Math.random() * charSet.length)));
    }
    return result.join('');
}

function findGetParameter(parameterName) {
    var result = null,
        tmp = [];
    location.search
        .substr(1)
        .split("&")
        .forEach(function(item) {
            tmp = item.split("=");
            if (tmp[0] === parameterName) result = decodeURIComponent(tmp[1]);
        });
    return result;
}

function trace(text) {
    // This function is used for logging.
    console.log(text);
}