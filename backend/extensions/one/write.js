'use strict';
let tail = Promise.resolve();
module.exports = function serializeWrite(callback) {
    const result = tail.then(callback);
    tail = result.catch(() => {});
    return result;
};
